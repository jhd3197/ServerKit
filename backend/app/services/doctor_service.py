"""One-shot "doctor" health sweep + explicit batch repair.

Aggregates the drift report (drift_service) with a handful of cheap host
health probes into a single ``{'checks': [...], 'ran_at': ...}`` report the
Monitoring → Doctor tab renders. Everything is best-effort and bounded — the
doctor is interactive (the API runs it synchronously), so no probe may hang.

Nothing here repairs anything automatically: :meth:`DoctorService.repair`
runs only for the explicit items the operator selected.
"""
import ipaddress
import json
import logging
import socket
import sys
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

DOCTOR_JOB_KIND = 'doctor.run'
DOCTOR_REPAIR_JOB_KIND = 'doctor.repair'
# Name of the built-in ScheduledJob row that runs the doctor sweep daily
# (seeded by app/jobs/builtin_handlers.py:seed_builtin_schedules).
DOCTOR_SCHEDULE_NAME = 'doctor'
LAST_REPORT_KEY = 'doctor_last_report'

# Core host services the doctor probes and is allowed to restart on demand.
CORE_SERVICES = ('nginx', 'docker')

CERT_WARN_DAYS = 14
DISK_WARN_FREE_PCT = 10.0
DISK_FAIL_FREE_PCT = 5.0

# Cap for the synchronous probes that shell out (systemctl is-active).
PROBE_TIMEOUT_SECONDS = 10

# Upper bound on how many site domains the DNS sweep resolves in one run — a
# synchronous check that does a live lookup per domain must stay bounded so the
# interactive doctor can never hang on a large portfolio. Domains past the cap
# are reported (not silently dropped) in a single roll-up check.
DNS_CHECK_MAX_DOMAINS = 25

# Host suffixes that are development / reserved and never resolve publicly, so
# the DNS sweep skips them (RFC 2606/6761 + the dev wildcard base lvh.me). Note
# these are single-label reserved TLDs — ``example.com`` is a real public zone
# and is intentionally NOT skipped.
_DNS_SKIP_SUFFIXES = (
    '.lvh.me', '.localhost', '.local', '.internal', '.test', '.invalid',
    '.example', '.lan', '.home.arpa',
)


# getaddrinfo errnos that mean "the name does not exist" (NXDOMAIN-ish), as
# opposed to a resolver-side failure (no DNS server reachable, timeout, …).
# Only the former may read as "does not resolve"; the latter is "could not
# check". EAI_NODATA is absent on some platforms (Windows), hence the getattr.
_EAI_UNRESOLVED = tuple(
    code for code in (getattr(socket, 'EAI_NONAME', None),
                      getattr(socket, 'EAI_NODATA', None))
    if code is not None)


def _resolve_host_ips(host):
    """Return the list of IP addresses ``host`` resolves to (A + AAAA).

    Raises ``socket.gaierror`` when the name does not resolve *or* the
    resolver itself failed — callers must distinguish (see
    ``_EAI_UNRESOLVED``): only a genuine NXDOMAIN is an unresolved domain,
    anything else is "could not check". Split out as a module-level function
    so tests can stub the resolver.
    """
    ips = []
    for info in socket.getaddrinfo(host, None):
        ip = info[4][0]
        if ip not in ips:
            ips.append(ip)
    return ips


def _normalize_ip(ip):
    """Canonical form of an IP string for comparison (compressed/lower-cased
    for IPv6); falls back to the stripped input when unparseable."""
    try:
        return str(ipaddress.ip_address((ip or '').strip()))
    except ValueError:
        return (ip or '').strip().lower()


def _local_host_ips():
    """This host's own IP addresses across all interfaces (best-effort).

    Used to tell "this server" apart from "somewhere else" when judging
    whether a resolved AAAA record is a stray. Returns a set of normalized
    address strings; empty when undetectable. Module-level so tests can stub.
    """
    ips = set()
    try:
        import psutil
        for addrs in (psutil.net_if_addrs() or {}).values():
            for addr in addrs:
                if addr.family in (socket.AF_INET, socket.AF_INET6):
                    # strip a zone id (fe80::1%eth0) before normalizing
                    ips.add(_normalize_ip(addr.address.split('%', 1)[0]))
    except Exception:  # noqa: BLE001 — detection is best-effort
        pass
    return ips


def _aaaa_conflicts(ips, server_ip, known_ips=None):
    """IPv6 addresses among ``ips`` that do not belong to this server.

    "This server" = the configured public IP plus every local interface
    address. A stray AAAA record pointing elsewhere breaks Let's Encrypt
    HTTP-01 issuance — the CA prefers IPv6 when a AAAA record exists — so the
    sweep must surface it even when the A record is perfectly correct, which
    is exactly the case that looks healthy and is not.

    ``known_ips`` is passed in by callers that sweep many domains so the
    interface enumeration happens once per run rather than once per domain.
    """
    v6 = []
    for ip in ips or []:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if addr.version == 6:
            v6.append(str(addr))
    if not v6:
        return []
    if known_ips is None:
        known_ips = _local_host_ips()
    known = {_normalize_ip(a) for a in known_ips}
    if server_ip:
        known.add(_normalize_ip(server_ip))
    return [ip for ip in v6 if ip not in known]


def _is_public_site_host(host):
    """True when ``host`` is a real, public hostname worth a DNS lookup — not
    localhost, a bare label, an IP literal, or a dev/reserved suffix."""
    h = (host or '').strip().lower().rstrip('.')
    if not h or h == 'localhost':
        return False
    if '.' not in h:
        return False
    try:
        ipaddress.ip_address(h)
        return False  # an IP literal, not a hostname
    except ValueError:
        pass
    return not any(h.endswith(suffix) for suffix in _DNS_SKIP_SUFFIXES)


def _check(key, title, status, detail, repairable=False, repair_ref=None):
    return {
        'key': key,
        'title': title,
        'status': status,  # 'ok' | 'warn' | 'fail'
        'detail': detail,
        'repairable': bool(repairable),
        'repair_ref': repair_ref,
    }


class DoctorService:
    """Run the health sweep, store the last report, batch-repair on demand."""

    # ------------------------------------------------------------------ #
    # Sub-checks (each best-effort; a probe failure = a 'warn' entry, never
    # an exception out of run()).
    # ------------------------------------------------------------------ #

    @classmethod
    def _drift_checks(cls):
        from app.services.drift_service import DriftService
        checks = []
        try:
            results = DriftService.check_all()
        except Exception as e:  # noqa: BLE001
            return [_check('drift', 'Configuration drift', 'warn',
                           f'Drift sweep failed: {e}')]
        for r in results:
            key = f"drift.{r['type']}.{r['id']}" if r['id'] is not None else f"drift.{r['type']}"
            title = f"Drift: {r['name']}"
            if r['status'] == 'in_sync':
                checks.append(_check(key, title, 'ok', 'Matches the expected configuration.'))
            elif r['status'] in ('drifted', 'missing'):
                detail = ('Managed file is missing on disk.' if r['status'] == 'missing'
                          else 'On-disk file differs from what ServerKit would write.')
                entry = _check(
                    key, title, 'warn', detail, repairable=True,
                    repair_ref={'kind': 'drift', 'type': r['type'], 'id': r['id']},
                )
                entry['diff'] = r.get('diff')
                checks.append(entry)
            else:  # error
                checks.append(_check(key, title, 'warn',
                                     r.get('detail') or 'Check could not run.'))
        return checks

    @classmethod
    def _expected_services(cls):
        """
        Core services this install is actually supposed to be running.

        The minimal install profile ships without Docker on purpose, so probing
        for it there would report a permanent, unfixable failure on a perfectly
        healthy box. Docker is only dropped when it is genuinely both
        unexpected *and* absent — an operator who installed it later, or a
        standard/full install that has lost it (real drift), still gets probed.
        """
        from app.services import install_profile_service as ips

        services = []
        for name in CORE_SERVICES:
            if name != 'docker':
                services.append(name)
                continue
            try:
                unexpected = ips.get_profile() == ips.PROFILE_MINIMAL
                docker_state = ips.get_capabilities().get('docker')
            except Exception:  # noqa: BLE001
                # Never let profile resolution suppress a real health check.
                services.append(name)
                continue
            if docker_state is None:
                # The probe itself failed — 'unknown' is not 'absent', so the
                # box still gets probed (and reports a warn, not a green skip).
                services.append(name)
            elif not (unexpected and not docker_state):
                services.append(name)
        return services

    @classmethod
    def _skipped_service_checks(cls, probed):
        """An 'ok' row explaining each core service deliberately not probed."""
        return [
            _check(f'service.{name}', f'{name} service', 'ok',
                   'Not installed — this install uses the Minimal profile. '
                   'Add it from Settings to enable app hosting.')
            for name in CORE_SERVICES if name not in probed
        ]

    @classmethod
    def _service_checks(cls):
        checks = []
        probed = cls._expected_services()
        if not sys.platform.startswith('linux'):
            for name in CORE_SERVICES:
                checks.append(_check(f'service.{name}', f'{name} service', 'warn',
                                     'unsupported on this host'))
            return checks
        checks.extend(cls._skipped_service_checks(probed))
        from app.utils.system import ServiceControl
        for name in probed:
            try:
                active = ServiceControl.is_active(name)
            except Exception as e:  # noqa: BLE001
                checks.append(_check(f'service.{name}', f'{name} service', 'warn',
                                     f'Status probe failed: {e}'))
                continue
            if active:
                checks.append(_check(f'service.{name}', f'{name} service', 'ok', 'Running.'))
            else:
                checks.append(_check(
                    f'service.{name}', f'{name} service', 'fail', 'Not running.',
                    repairable=True, repair_ref={'kind': 'service', 'name': name},
                ))
        if 'nginx' in probed:
            checks.append(cls._nginx_config_check())
        return checks

    @classmethod
    def _nginx_config_check(cls):
        """A running-but-misconfigured nginx passes ``systemctl is-active``;
        only ``nginx -t`` sees it. Not repairable: config repair is operator
        territory, and a wrong guess can take every site on the host down."""
        key = 'nginx.config'
        title = 'nginx configuration'
        from app.utils.system import is_command_available
        if not is_command_available('nginx'):
            return _check(key, title, 'warn',
                          'nginx binary not found — configuration test skipped.')
        from app.services.nginx_service import NginxService
        try:
            result = NginxService.test_config()
        except Exception as e:  # noqa: BLE001
            return _check(key, title, 'warn', f'Config test could not run: {e}')
        if result.get('success'):
            return _check(key, title, 'ok', 'nginx configuration test passed.')
        output = (result.get('message') or result.get('error') or '').strip()
        detail = 'nginx configuration test (nginx -t) failed'
        if output:
            detail += f': {output}'
        detail += ('. nginx will refuse to reload/restart until the '
                   'configuration parses — review the file nginx names above.')
        return _check(key, title, 'fail', detail, repairable=False)

    @classmethod
    def _cert_check(cls):
        """Nearest tracked certificate expiry (Domain.ssl_expires_at)."""
        try:
            from app.models.domain import Domain
            rows = (Domain.query
                    .filter(Domain.ssl_expires_at.isnot(None))
                    .order_by(Domain.ssl_expires_at.asc())
                    .all())
        except Exception as e:  # noqa: BLE001
            return _check('certs.expiry', 'Certificate expiry', 'warn',
                          f'Could not read certificate data: {e}')
        if not rows:
            # Nothing in production writes Domain.ssl_expires_at yet, so an
            # empty table does not mean "nothing expiring" — it means expiry
            # is not being monitored at all. ok must be positively earned.
            return _check('certs.expiry', 'Certificate expiry', 'warn',
                          'No certificate expiry data is being collected — '
                          'expiry is not being monitored.')
        now = datetime.utcnow()
        soon = [d for d in rows if d.ssl_expires_at <= now + timedelta(days=CERT_WARN_DAYS)]
        expired = [d for d in soon if d.ssl_expires_at <= now]
        if expired:
            names = ', '.join(d.name for d in expired[:5])
            return _check('certs.expiry', 'Certificate expiry', 'fail',
                          f'Expired certificate(s): {names}')
        if soon:
            nearest = soon[0]
            days = max(0, (nearest.ssl_expires_at - now).days)
            return _check('certs.expiry', 'Certificate expiry', 'warn',
                          f'{len(soon)} certificate(s) expire within {CERT_WARN_DAYS} days '
                          f'(nearest: {nearest.name} in {days}d).')
        nearest = rows[0]
        return _check('certs.expiry', 'Certificate expiry', 'ok',
                      f'Nearest expiry: {nearest.name} on '
                      f'{nearest.ssl_expires_at.date().isoformat()}.')

    @classmethod
    def _disk_check(cls):
        try:
            import psutil
            usage = psutil.disk_usage('/')
            free_pct = 100.0 - usage.percent
        except Exception as e:  # noqa: BLE001
            return _check('disk.headroom', 'Disk headroom', 'warn',
                          f'Could not read disk usage: {e}')
        detail = f'{free_pct:.1f}% free on /.'
        if free_pct < DISK_FAIL_FREE_PCT:
            return _check('disk.headroom', 'Disk headroom', 'fail', detail)
        if free_pct < DISK_WARN_FREE_PCT:
            return _check('disk.headroom', 'Disk headroom', 'warn', detail)
        return _check('disk.headroom', 'Disk headroom', 'ok', detail)

    @classmethod
    def _db_check(cls):
        try:
            from sqlalchemy import text
            from app import db
            db.session.execute(text('SELECT 1'))
            return _check('db.reachable', 'Database', 'ok', 'Reachable.')
        except Exception as e:  # noqa: BLE001
            return _check('db.reachable', 'Database', 'fail', f'Query failed: {e}')

    # ------------------------------------------------------------------ #
    # Site-DNS sweep: do the managed site domains still resolve,
    # and do they point at this server? Each unresolved public domain becomes a
    # fail row, repairable via a connected DNS provider when one is set up.
    # ------------------------------------------------------------------ #

    @classmethod
    def _site_domains(cls):
        """Hostnames of every managed-site domain (Domain rows attached to an
        Application), or ``None`` when the query itself fails — an unreadable
        Domain table is 'could not check', never 'no domains'."""
        try:
            from app.models.domain import Domain
            # query_active: tombstones became permanent red 'does not resolve'
            # rows, and this same set is the allowlist for one-click DNS repair --
            # so Repair would create a record for a deleted domain.
            rows = Domain.query_active().filter(Domain.application_id.isnot(None)).all()
        except Exception as e:  # noqa: BLE001
            logger.warning('could not read site domains: %s', e)
            return None
        return [d.name for d in rows if d.name]

    @classmethod
    def _dns_provider_available(cls):
        """True when at least one DNS provider is connected, so an unresolved
        domain can be repaired automatically."""
        try:
            from app import db
            from app.models.email import DNSProviderConfig
            return db.session.query(DNSProviderConfig.id).first() is not None
        except Exception:  # noqa: BLE001
            return False

    @classmethod
    def _dns_checks(cls):
        """One check per public site domain, plus a single roll-up over any
        domains past the per-run cap. Returns a single ``ok`` check when there
        are no public site domains to verify."""
        from app.services.site_domain_service import SiteDomainService

        domains = cls._site_domains()
        if domains is None:
            return [_check('dns.resolve', 'Site DNS', 'warn',
                           'Could not read site domains — the DNS sweep could '
                           'not run this time.')]
        public = [h for h in domains if _is_public_site_host(h)]
        if not public:
            return [_check('dns.resolve', 'Site DNS', 'ok',
                           'No public site domains to check.')]

        try:
            server_ip = SiteDomainService.server_ip()
        except Exception:  # noqa: BLE001
            server_ip = None
        provider_available = cls._dns_provider_available()

        capped = public[:DNS_CHECK_MAX_DOMAINS]
        # Enumerated once for the whole sweep, not once per domain.
        local_ips = _local_host_ips()
        checks = [cls._dns_check_one(host, server_ip, provider_available, local_ips)
                  for host in capped]

        overflow = len(public) - len(capped)
        if overflow > 0:
            checks.append(_check(
                'dns.resolve', 'Site DNS', 'warn',
                f'Checked the first {DNS_CHECK_MAX_DOMAINS} of {len(public)} site '
                f'domains this run; {overflow} more domain(s) were not checked.'))
        return checks

    @classmethod
    def _dns_check_one(cls, host, server_ip, provider_available, local_ips=None):
        key = f'dns.resolve.{host}'
        title = f'DNS: {host}'
        try:
            ips = _resolve_host_ips(host)
        except socket.gaierror as e:
            if e.errno in _EAI_UNRESOLVED:
                ips = None  # a genuine NXDOMAIN — the existing fail path
            else:
                # A resolver-side failure (no DNS server, timeout, …) is not
                # proof the domain is gone — paging admins over our own outage
                # is exactly the false-NXDOMAIN bug this branch exists to kill.
                return _check(key, title, 'warn',
                              f'DNS lookup failed: {e} — could not check.')
        except Exception as e:  # noqa: BLE001 — same rule for non-gaierror
            return _check(key, title, 'warn',
                          f'DNS lookup failed: {e} — could not check.')
        if not ips:
            return cls._dns_unresolved(key, title, host, server_ip, provider_available)
        if server_ip and server_ip in ips:
            # The A record is right, which is exactly why a stray AAAA hides
            # here: everything looks correct until issuance tries IPv6 first.
            conflicts = _aaaa_conflicts(ips, server_ip, local_ips)
            if conflicts:
                return _check(
                    key, title, 'warn',
                    f'{host} points at this server over IPv4, but its AAAA record '
                    f'resolves to {", ".join(conflicts)}, which is not this '
                    f"server. Let's Encrypt prefers IPv6, so HTTP-01 issuance "
                    f'will be attempted against that address and fail. Remove '
                    f"the AAAA record, or point it at this server's IPv6 "
                    f'address.')
            return _check(key, title, 'ok', f'{host} resolves to {server_ip}.')
        resolved = ', '.join(ips)
        if server_ip:
            return _check(key, title, 'warn',
                          f'{host} resolves to {resolved}, not this server '
                          f'({server_ip}).')
        return _check(key, title, 'warn',
                      f'{host} resolves to {resolved} (server public IP is not '
                      f'set, so this cannot be verified).')

    @classmethod
    def _dns_unresolved(cls, key, title, host, server_ip, provider_available):
        if not server_ip:
            return _check(
                key, title, 'fail',
                f'{host} does not resolve. Set the server public IP in Settings so '
                f'ServerKit can create and verify its DNS record.',
                repairable=False)
        if provider_available:
            return _check(
                key, title, 'fail',
                f'{host} does not resolve. ServerKit can create the A record '
                f'{host} → {server_ip} via a connected DNS provider.',
                repairable=True, repair_ref={'kind': 'dns', 'host': host})
        return _check(
            key, title, 'fail',
            f'{host} does not resolve. Add an A record {host} → {server_ip} at your '
            f'DNS host, or connect a DNS provider so ServerKit can do it for you.',
            repairable=False)

    @classmethod
    def _repair_dns(cls, host):
        """Create the missing A record for a managed site ``host`` via a
        connected DNS provider. Refuses any hostname ServerKit doesn't manage so
        a caller can't steer a provider write at an arbitrary name."""
        host = (host or '').strip().lower().rstrip('.')
        if not host:
            return {'success': False, 'error': 'No host given for DNS repair.'}
        managed = {(h or '').strip().lower().rstrip('.')
                   for h in (cls._site_domains() or [])}
        if host not in managed:
            return {'success': False, 'error': f'Not a managed site domain: {host}'}

        from app.services.site_domain_service import SiteDomainService
        try:
            ip = SiteDomainService.server_ip()
        except Exception:  # noqa: BLE001
            ip = None
        if not ip:
            return {'success': False,
                    'error': 'Set the server public IP in Settings before '
                             'creating DNS records.'}

        from app.services.dns_provider_service import DNSProviderService
        res = DNSProviderService.ensure_a_record(host, ip)
        if res.get('created'):
            return {'success': True, 'provider': res.get('provider'),
                    'zone': res.get('zone'), 'record': res.get('record')}
        msg = (res.get('message') or res.get('error')
               or 'DNS record could not be created.')
        return {'success': False, 'error': msg, 'reason': res.get('reason'),
                'record': res.get('record')}

    @staticmethod
    def _failed_dns_hosts(checks):
        """Hostnames of the ``dns.resolve.<host>`` checks currently failing."""
        prefix = 'dns.resolve.'
        hosts = []
        for c in checks or []:
            key = c.get('key', '')
            if c.get('status') == 'fail' and key.startswith(prefix) and key != 'dns.resolve':
                hosts.append(key[len(prefix):])
        return hosts

    @classmethod
    def _notify_dns_failures(cls, hosts):
        """Alert admins that site domains newly stopped resolving."""
        try:
            from app.plugins_sdk import notify
            listed = ', '.join(hosts[:5])
            if len(hosts) > 5:
                listed += f' (+{len(hosts) - 5} more)'
            notify.send(
                'dns.unresolved', to='admins',
                data={'count': len(hosts), 'domains': list(hosts),
                      'summary': listed,
                      'message': f'Site domain(s) no longer resolve: {listed}. '
                                 f'Check the Monitoring → Doctor tab to repair them.'})
        except Exception as e:  # noqa: BLE001 — notification is best-effort
            logger.warning('could not send dns.unresolved notification: %s', e)

    # ------------------------------------------------------------------ #
    # Backup restore-proof: is each policy's latest backup
    # actually restorable? Two check families per policy:
    #   backup_drill_stale.<id> — cadence'd policies whose last drill is stale /
    #                             failed / never (skipped when cadence is 'off').
    #   backup_unverified.<id>  — policies whose latest successful run has not
    #                             been verified beyond the 'none' level.
    # ------------------------------------------------------------------ #

    @staticmethod
    def _policy_label(policy):
        return f'{policy.target_type}:{policy.target_id}'

    @classmethod
    def _backup_proof_checks(cls):
        """One drill-staleness check per cadence'd policy plus one verification
        check per policy that has a successful run. Best-effort — any read
        failure degrades to a single warn."""
        checks = []
        try:
            from app.models.backup_policy import BackupPolicy
            policies = BackupPolicy.query.all()
        except Exception as e:  # noqa: BLE001
            return [_check('backup.proof', 'Backup restore proof', 'warn',
                           f'Could not read backup policies: {e}')]
        for policy in policies:
            try:
                stale = cls._backup_drill_stale_check(policy)
                if stale is not None:
                    checks.append(stale)
                unverified = cls._backup_unverified_check(policy)
                if unverified is not None:
                    checks.append(unverified)
            except Exception as e:  # noqa: BLE001 — one bad row must not 500 the sweep
                pid = getattr(policy, 'id', 'unknown')
                checks.append(_check(
                    f'backup_proof.{pid}', 'Backup restore proof', 'warn',
                    f'Could not evaluate backup policy {pid}: {e}'))
        return checks

    @classmethod
    def _backup_drill_stale_check(cls, policy):
        """Drill-staleness for one policy, or ``None`` when it has no drill
        cadence (``drill_cadence == 'off'``)."""
        if (policy.drill_cadence or 'off') == 'off':
            return None
        from app.services.backup_policy_service import BackupPolicyService
        badge = BackupPolicyService._drill_badge(policy)
        key = f'backup_drill_stale.{policy.id}'
        title = f'Restore drill: {cls._policy_label(policy)}'
        repair_ref = {'kind': 'backup_drill', 'policy_id': policy.id}
        if badge == 'ok':
            return _check(key, title, 'ok',
                          'A recent restore drill proved this backup restores.')
        if badge == 'stale':
            return _check(key, title, 'warn',
                          "The last restore drill is older than this policy's "
                          'cadence — run a fresh drill.',
                          repairable=True, repair_ref=repair_ref)
        if badge == 'skipped':
            # "Could not run" is its own answer. It used to render as ok, which
            # told the operator a drill that never happened had proved the
            # backup restores.
            return _check(key, title, 'warn',
                          'The last restore drill could not run — not enough '
                          'scratch space to restore into. Nothing has been '
                          'proven about this backup; free space and re-run.',
                          repairable=True, repair_ref=repair_ref)
        if badge == 'unknown':
            return _check(key, title, 'warn',
                          'The last restore drill finished in a state the panel '
                          'does not recognise, so this backup is unproven.',
                          repairable=True, repair_ref=repair_ref)
        detail = ('This backup has never been restore-drilled.'
                  if badge == 'never'
                  else 'The last restore drill failed — the backup may not restore.')
        return _check(key, title, 'fail', detail,
                      repairable=True, repair_ref=repair_ref)

    @classmethod
    def _backup_unverified_check(cls, policy):
        """Verification state of the latest successful run for one policy, or
        ``None`` when the policy has no successful run yet."""
        key = f'backup_unverified.{policy.id}'
        title = f'Backup verification: {cls._policy_label(policy)}'
        try:
            from app.models.backup_run import BackupRun
            run = (BackupRun.query
                   .filter_by(policy_id=policy.id, status='success')
                   .order_by(BackupRun.started_at.desc()).first())
        except Exception as e:  # noqa: BLE001
            # The check silently vanished before — "couldn't check" is its own
            # answer and must be visible.
            return _check(key, title, 'warn',
                          f'Could not read backup runs: {e}')
        if not run:
            return None
        repair_ref = {'kind': 'backup_verify', 'policy_id': policy.id,
                      'run_id': run.id}
        level = run.effective_verify_level()
        err = (run.verify_error or '').strip()
        if err and (level == 'none' or err.lower().startswith('checksum mismatch')):
            # Verification RAN and came back bad — an unreadable archive, or a
            # checksum that disagrees with the manifest. That is positive
            # evidence the backup may not restore, not an absence of evidence;
            # it used to render as ok ("Latest backup verified (listed).").
            return _check(key, title, 'fail',
                          f'The latest backup failed verification: {err}',
                          repairable=True, repair_ref=repair_ref)
        if err:
            # Readable archive, but no stored checksum to compare against —
            # 'listed' here is "couldn't check", not "verified".
            return _check(key, title, 'warn',
                          'The latest backup is readable, but there is no '
                          'stored checksum to verify it against — it is '
                          'unproven.',
                          repairable=True, repair_ref=repair_ref)
        if level == 'none':
            return _check(
                key, title, 'warn',
                'The latest backup has not been verified (no integrity check or '
                'restore drill has run against it yet).',
                repairable=True, repair_ref=repair_ref)
        return _check(key, title, 'ok', f'Latest backup verified ({level}).')

    @classmethod
    def _setup_checks(cls):
        """Panel setup-health items as ``setup.*`` doctor checks. Imported
        lazily to avoid an import cycle; best-effort."""
        try:
            from app.services.setup_health_service import SetupHealthService
            return list(SetupHealthService.doctor_checks())
        except Exception as e:  # noqa: BLE001
            logger.warning('setup-health doctor section failed: %s', e)
            return [_check('setup.health', 'Setup health', 'warn',
                           f'Could not run setup-health checks: {e}')]

    @classmethod
    def _extension_checks(cls):
        """Checks contributed by extensions (see doctor_check_registry).

        The registry owns the per-provider isolation and time budget, so a
        third-party check can't take the sweep down with it."""
        try:
            from app.services import doctor_check_registry
            return list(doctor_check_registry.collect())
        except Exception as e:  # noqa: BLE001
            logger.warning('extension doctor section failed: %s', e)
            return [_check('extensions.checks', 'Extension checks', 'warn',
                           f'Could not collect extension checks: {e}')]

    @classmethod
    def _unmanaged_site_checks(cls):
        """Sites host nginx is serving that no application accounts for.

        Such a site is live but invisible to the panel: no monitoring,
        backups, SSL status or logs, while its database may well be listed
        under Databases. One warning per site; a host with none adds nothing.
        Not repairable — adopting is the operator's call, and it is one
        command (or one click) away in the detail."""
        try:
            from app.services import site_adoption_service
            sites = site_adoption_service.unmanaged()
        except Exception as e:  # noqa: BLE001
            logger.warning('unmanaged-site doctor section failed: %s', e)
            return [_check('sites.unmanaged', 'Unmanaged sites', 'warn',
                           f'Could not read the host nginx config: {e}')]
        checks = []
        for site in sites:
            if site['kind'] == site_adoption_service.KIND_REDIRECT:
                continue  # a redirect-only vhost has no site behind it
            if site['adoptable']:
                detail = (f"Served by host nginx ({site['vhost_file']}) but not registered "
                          f"in ServerKit. Adopt it from Services, or run: "
                          f"serverkit adopt-site {site['primary_domain']} --apply")
            else:
                detail = (f"Served by host nginx ({site['vhost_file']}) but not registered "
                          f"in ServerKit. {site['reason']}")
            checks.append(_check(f"sites.unmanaged.{site['id']}",
                                 f"Unmanaged site: {site['primary_domain']}", 'warn', detail))
        return checks

    # ------------------------------------------------------------------ #
    # Sweep
    # ------------------------------------------------------------------ #

    @classmethod
    def run(cls):
        """Run the full sweep synchronously and store the report.

        Returns ``{'checks': [...], 'ran_at': iso}``.
        """
        checks = []
        checks += cls._drift_checks()
        checks += cls._service_checks()
        checks += cls._unmanaged_site_checks()
        checks += cls._dns_checks()
        checks += cls._backup_proof_checks()
        checks.append(cls._cert_check())
        checks.append(cls._disk_check())
        checks.append(cls._db_check())
        checks += cls._setup_checks()
        checks += cls._extension_checks()
        report = {
            'checks': checks,
            'ran_at': datetime.utcnow().isoformat() + 'Z',
        }
        cls.store_report(report)
        return report

    @classmethod
    def store_report(cls, report):
        try:
            from app.services.settings_service import SettingsService
            SettingsService.set(LAST_REPORT_KEY, json.dumps(report))
        except Exception as e:  # noqa: BLE001 — storage is best-effort
            logger.warning('could not store doctor report: %s', e)

    @classmethod
    def get_last_report(cls):
        from app.services.settings_service import SettingsService
        raw = SettingsService.get(LAST_REPORT_KEY)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------ #
    # Batch repair (explicit only)
    # ------------------------------------------------------------------ #

    @classmethod
    def repair(cls, items):
        """Repair an explicit list of items.

        ``items``: ``[{'kind': 'drift', 'type': ..., 'id': ...} |
        {'kind': 'service', 'name': ...}]``. Returns per-item results (same
        order), each carrying the input item plus ``success``/detail fields.
        """
        results = []
        for item in items or []:
            kind = (item or {}).get('kind')
            if kind == 'drift':
                from app.services.drift_service import DriftService
                res = DriftService.repair(item.get('type'), item.get('id'))
                results.append({'item': item, **res})
            elif kind == 'service':
                results.append({'item': item, **cls._restart_service(item.get('name'))})
            elif kind == 'dns':
                results.append({'item': item, **cls._repair_dns(item.get('host'))})
            elif kind == 'extension':
                # Routed back to the plugin that contributed the check. The
                # registry is the allowlist: an unregistered namespace can't be
                # repaired, so a crafted ref reaches nothing.
                from app.services import doctor_check_registry
                results.append({'item': item, **doctor_check_registry.repair(
                    item.get('namespace'), item.get('ref'))})
            elif kind == 'backup_drill':
                results.append({'item': item,
                                **cls._repair_backup_drill(item.get('policy_id'))})
            elif kind == 'backup_verify':
                results.append({'item': item, **cls._repair_backup_verify(
                    item.get('policy_id'), item.get('run_id'))})
            else:
                results.append({'item': item, 'success': False,
                                'error': f'Unknown repair kind: {kind}'})
        return results

    @staticmethod
    def _load_policy(policy_id):
        """Resolve a backup policy for a repair, or ``None``.

        The id arrives from the client echoing back a repair_ref, so it is
        looked up rather than trusted — an id for a policy that has since been
        deleted must read as "gone", not raise.
        """
        try:
            from app.models.backup_policy import BackupPolicy
            return BackupPolicy.query.filter_by(id=policy_id).first()
        except Exception:  # noqa: BLE001
            return None

    @classmethod
    def _repair_backup_drill(cls, policy_id):
        """Run a fresh restore drill for a policy.

        Asynchronous: request_drill enqueues a ``backup.drill.run`` job and
        returns it, so the answer carries the job id for the console to link
        to rather than pretending the drill is already done.
        """
        policy = cls._load_policy(policy_id)
        if policy is None:
            return {'success': False,
                    'error': f'Backup policy {policy_id} no longer exists.'}
        from app.services.backup_drill_service import (
            BackupDrillError, BackupDrillService,
        )
        try:
            job = BackupDrillService.request_drill(policy, trigger='doctor')
        except BackupDrillError as e:
            # "already drilling" / "no successful backup to drill" are ordinary
            # refusals, not faults — surface the reason as-is.
            return {'success': False, 'error': str(e)}
        except Exception as e:  # noqa: BLE001
            return {'success': False, 'error': str(e)}
        return {'success': True, 'job_id': getattr(job, 'id', None),
                'detail': 'Restore drill queued.'}

    @classmethod
    def _repair_backup_verify(cls, policy_id, run_id):
        """Verify a backup run by whatever means that run allows.

        Two ladders exist and the check cannot tell them apart from outside. A
        run with an offsite copy is verified against the provider (size +
        checksum via verify_run). A local-only run is verified in place: read
        the archive and checksum it against the stored manifest. Routing every
        run down the remote path would make this button useless for anyone who
        has not configured offsite storage — which is most installs, and which
        is the same "button that always fails" defect this item exists to
        remove.

        Synchronous either way, unlike the drill, so there is no job id.
        """
        policy = cls._load_policy(policy_id)
        if policy is None:
            return {'success': False,
                    'error': f'Backup policy {policy_id} no longer exists.'}
        from app.services.backup_policy_service import (
            BackupPolicyError, BackupPolicyService,
        )
        try:
            run = BackupPolicyService.get_run(policy, run_id)
        except Exception:  # noqa: BLE001
            run = None
        if run is None:
            return {'success': False, 'error': 'Backup not found.'}

        if not getattr(run, 'remote_key', None):
            return cls._verify_run_locally(run)

        try:
            result = BackupPolicyService.verify_run(policy, run_id)
        except BackupPolicyError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:  # noqa: BLE001
            return {'success': False, 'error': str(e)}
        if not result.get('verified'):
            # The check ran and the copy did NOT match — a real answer, and a
            # worse one than "unverified". Do not report it as a fix.
            return {'success': False,
                    'error': 'Verification ran but the remote copy did not '
                             'match — this backup may not restore.',
                    'detail': result.get('detail')}
        return {'success': True, 'verified': True,
                'detail': 'Remote copy verified.'}

    @staticmethod
    def _verify_run_locally(run):
        """Tier-1 (on-disk) verification: is the archive readable, and does it
        still checksum to what the manifest recorded?

        verify_run_tier1 mutates the run's verify ladder without committing,
        so the commit is ours.
        """
        from app import db
        from app.services import backup_verify_service
        try:
            backup_verify_service.verify_run_tier1(run, run.get_metadata() or {})
            db.session.commit()
        except Exception as e:  # noqa: BLE001
            db.session.rollback()
            return {'success': False, 'error': str(e)}

        level = run.verify_level or 'none'
        if level == 'none':
            # Unreadable archive — the worst answer, and the one most worth
            # knowing before a restore depends on it.
            return {'success': False,
                    'error': run.verify_error
                             or 'The backup archive could not be read.'}
        if run.verify_error:
            # Readable but the checksum disagrees with the manifest.
            return {'success': False, 'error': run.verify_error,
                    'verify_level': level}
        return {'success': True, 'verify_level': level,
                'detail': f'Backup verified on disk ({level}).'}

    @classmethod
    def _restart_service(cls, name):
        if name not in CORE_SERVICES:
            return {'success': False, 'error': f'Service not repairable: {name}'}
        if not sys.platform.startswith('linux'):
            return {'success': False, 'error': 'unsupported on this host'}
        try:
            from app.utils.system import ServiceControl
            proc = ServiceControl.restart(name, timeout=60)
            if proc.returncode == 0:
                return {'success': True, 'restarted': name}
            return {'success': False, 'error': (proc.stderr or '').strip()
                    or f'systemctl restart {name} failed'}
        except Exception as e:  # noqa: BLE001
            return {'success': False, 'error': str(e)}

    # ------------------------------------------------------------------ #
    # Job plumbing
    # ------------------------------------------------------------------ #

    @classmethod
    def run_doctor_job(cls, job):
        """Job handler for ``doctor.run`` (background variant of run()).

        Diffs the site-DNS results against the previous report and alerts admins
        about domains that *newly* stopped resolving — so a persistently-broken
        domain nags once, not on every daily sweep.
        """
        prev = cls.get_last_report() or {}
        prev_failed = set(cls._failed_dns_hosts(prev.get('checks', [])))

        report = cls.run()  # stores the new report as the last report

        now_failed = cls._failed_dns_hosts(report['checks'])
        new_failures = [h for h in now_failed if h not in prev_failed]
        if new_failures:
            cls._notify_dns_failures(new_failures)

        counts = {}
        for c in report['checks']:
            counts[c['status']] = counts.get(c['status'], 0) + 1
        return {'ran_at': report['ran_at'], 'counts': counts,
                'dns_new_failures': new_failures}

    @classmethod
    def run_doctor_repair_job(cls, job):
        """Run an explicit repair batch as a persisted shell operation."""
        from app import db
        from app.services.run_log_service import stream_for

        items = (job.get_payload() or {}).get('items')
        if not isinstance(items, list) or not items:
            raise ValueError('doctor repair job requires a non-empty items list')

        stream = stream_for(job)
        stream.log('info', f'Starting {len(items)} doctor repair(s)')
        results = cls.repair(items)
        failed = []
        for index, result in enumerate(results, start=1):
            kind = ((result.get('item') or {}).get('kind') or 'repair')
            if result.get('success'):
                stream.log('info', f'{kind} repair succeeded', step_index=index)
            else:
                failed.append(result)
                stream.log(
                    'error',
                    f'{kind} repair failed: {result.get("error") or "unknown error"}',
                    step_index=index,
                )
        summary = {
            'results': results,
            'completed': len(results),
            'total': len(items),
            'failed': len(failed),
        }
        # Keep the item-level result when the consumer marks a partial failure
        # terminal after this handler raises.
        job.set_result(summary)
        db.session.commit()
        stream.flush()
        if failed:
            raise RuntimeError(
                f'{len(failed)} of {len(items)} doctor repairs failed'
            )
        return summary

    @classmethod
    def register_jobs(cls):
        """Register the doctor handler with the job registry.
        Called once at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(DOCTOR_JOB_KIND, cls.run_doctor_job, replace=True)
        registry.register(
            DOCTOR_REPAIR_JOB_KIND, cls.run_doctor_repair_job, replace=True,
        )
