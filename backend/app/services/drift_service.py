"""Configuration drift detection + explicit per-resource repair.

ServerKit's service layer is imperative: it writes nginx vhosts and compose
override files from DB state and assumes they stay put. This module closes the
loop *gradually*: it re-renders what each managed file **should** contain
(through the exact same renderers the panel uses when writing them), compares
against what is actually on disk, and reports the difference. Nothing here
auto-repairs — :meth:`DriftService.repair` runs only when explicitly invoked
(API / doctor batch), per single resource.

Check framework
---------------
``DRIFT_CHECKS`` maps a resource ``type`` to a small check dict:

    {
        'type': 'nginx_vhost',
        'title': 'Nginx vhosts',
        'supported': fn() -> (bool, reason),          # optional platform gate
        'list_resources': fn() -> [(id, name)],
        'render_expected': fn(resource_id) -> {path: content|None},
        'read_actual': fn(paths) -> {path: content|None},  # optional; default
                                                           # reads the files
        'repair': fn(resource_id) -> {'success', 'wrote', 'reloaded', ...},
    }

``render_expected`` values: a string is the exact content the file must have;
``None`` means the file must NOT exist (e.g. a stale compose override that
should have been removed). An empty dict means nothing applies to this
resource → it reports ``in_sync``.

Platform policy (documented choice): the built-in checks cover Linux server
paths (``/etc/nginx/...``, app roots). On a non-Linux host each built-in check
reports a single ``status='error'`` entry with detail ``'unsupported on this
host'`` — we deliberately do NOT report ``in_sync`` there, because "we couldn't
look" is not "it matches". The gate lives per-check (``supported``) so tests
and future cross-platform checks run anywhere.

Systemd units: the panel *does* template gunicorn units
(``PythonService.create_gunicorn_service``), but their render inputs (worker
count, run-as user, and a point-in-time snapshot of the app's ``.env``) are
not persisted anywhere, so a faithful expected-render is impossible —
re-rendering with today's defaults would flag false drift. The ServerKit
panel/agent units themselves are installer-owned. No systemd drift check is
registered for now.
"""
import difflib
import json
import logging
import os
import re
import sys
from datetime import datetime

logger = logging.getLogger(__name__)

DRIFT_JOB_KIND = 'drift.check'
DRIFT_SCHEDULE_NAME = 'drift-check'
LAST_REPORT_KEY = 'drift_last_report'
DIFF_MAX_LINES = 200

# type -> check dict (see module docstring for the shape).
DRIFT_CHECKS = {}


def register_check(check):
    """Register (or replace) a drift check. Plugins may add their own."""
    DRIFT_CHECKS[check['type']] = check
    return check


def _is_linux():
    return sys.platform.startswith('linux')


def _linux_only():
    if _is_linux():
        return True, None
    return False, 'unsupported on this host'


def _default_read_actual(paths):
    """Read each path from disk; ``None`` for a file that doesn't exist."""
    actual = {}
    for path in paths:
        try:
            if os.path.exists(path):
                with open(path, 'r', encoding='utf-8', errors='replace') as f:
                    actual[path] = f.read()
            else:
                actual[path] = None
        except OSError as e:
            raise RuntimeError(f'cannot read {path}: {e}')
    return actual


def _unified_diff(path, actual, expected):
    """Unified diff actual → expected for one file, as a list of lines."""
    a = (actual or '').splitlines()
    b = (expected or '').splitlines()
    return list(difflib.unified_diff(
        a, b,
        fromfile=f'{path} (actual)',
        tofile=f'{path} (expected)',
        lineterm='',
    ))


class DriftService:
    """Detect + repair drift between DB-derived config and files on disk."""

    # ------------------------------------------------------------------ #
    # Detection
    # ------------------------------------------------------------------ #

    @classmethod
    def check_resource(cls, check, resource_id, name):
        """Run one check against one resource. Returns a report entry."""
        entry = {
            'type': check['type'],
            'id': resource_id,
            'name': name,
            'status': 'in_sync',
            'diff': None,
            'checked_at': datetime.utcnow().isoformat() + 'Z',
        }
        try:
            expected = check['render_expected'](resource_id) or {}
            if not expected:
                # Nothing applies to this resource (e.g. app publishes no
                # files) — by definition nothing can have drifted.
                return entry
            reader = check.get('read_actual') or _default_read_actual
            actual = reader(list(expected.keys()))

            diff_lines = []
            statuses = set()
            for path, want in expected.items():
                have = actual.get(path)
                if want is None:
                    # File must not exist.
                    if have is None:
                        statuses.add('in_sync')
                    else:
                        statuses.add('drifted')
                        diff_lines += _unified_diff(path, have, '')
                elif have is None:
                    statuses.add('missing')
                    diff_lines += _unified_diff(path, '', want)
                elif have == want:
                    statuses.add('in_sync')
                else:
                    statuses.add('drifted')
                    diff_lines += _unified_diff(path, have, want)

            if 'drifted' in statuses:
                entry['status'] = 'drifted'
            elif 'missing' in statuses:
                entry['status'] = 'missing'
            if diff_lines:
                if len(diff_lines) > DIFF_MAX_LINES:
                    kept = diff_lines[:DIFF_MAX_LINES]
                    kept.append(
                        f'... (diff truncated at {DIFF_MAX_LINES} lines)')
                    diff_lines = kept
                entry['diff'] = '\n'.join(diff_lines)
        except Exception as e:  # noqa: BLE001 — one bad resource must not kill the sweep
            entry['status'] = 'error'
            entry['detail'] = str(e)
        return entry

    @classmethod
    def check_all(cls):
        """Run every registered check against every resource.

        Returns a list of entries ``{type, id, name, status, diff,
        checked_at}`` with ``status`` in
        ``in_sync | drifted | missing | error``.
        """
        results = []
        for check in DRIFT_CHECKS.values():
            supported = check.get('supported')
            if supported:
                ok, reason = supported()
                if not ok:
                    results.append({
                        'type': check['type'],
                        'id': None,
                        'name': check.get('title', check['type']),
                        'status': 'error',
                        'diff': None,
                        'detail': reason or 'unsupported on this host',
                        'checked_at': datetime.utcnow().isoformat() + 'Z',
                    })
                    continue
            try:
                resources = check['list_resources']()
            except Exception as e:  # noqa: BLE001
                results.append({
                    'type': check['type'],
                    'id': None,
                    'name': check.get('title', check['type']),
                    'status': 'error',
                    'diff': None,
                    'detail': str(e),
                    'checked_at': datetime.utcnow().isoformat() + 'Z',
                })
                continue
            for resource in resources:
                if isinstance(resource, dict):
                    # list_resources may report a per-resource probe failure
                    # inline (an app it could not even inspect) — pass it
                    # through as an error entry instead of dropping the app.
                    resource.setdefault('type', check['type'])
                    resource.setdefault('checked_at',
                                        datetime.utcnow().isoformat() + 'Z')
                    results.append(resource)
                    continue
                resource_id, name = resource
                results.append(cls.check_resource(check, resource_id, name))
        return results

    # ------------------------------------------------------------------ #
    # Last-report storage
    # ------------------------------------------------------------------ #

    @classmethod
    def build_report(cls):
        results = cls.check_all()
        return {
            'results': results,
            'drifted': sum(1 for r in results if r['status'] in ('drifted', 'missing')),
            'errors': sum(1 for r in results if r['status'] == 'error'),
            'generated_at': datetime.utcnow().isoformat() + 'Z',
        }

    @classmethod
    def store_report(cls, report):
        from app.services.settings_service import SettingsService
        SettingsService.set(LAST_REPORT_KEY, json.dumps(report))

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
    # Repair (explicit, per-resource — never automatic)
    # ------------------------------------------------------------------ #

    @classmethod
    def repair(cls, check_type, resource_id):
        """Re-render + rewrite one resource through the panel's normal write
        path (incl. nginx reload / compose up where applicable).

        Returns ``{'success': bool, 'wrote': [paths], 'reloaded': bool}`` (plus
        ``'error'`` on failure). Strictly on-demand.
        """
        check = DRIFT_CHECKS.get(check_type)
        if not check:
            return {'success': False, 'error': f'Unknown drift check type: {check_type}',
                    'wrote': [], 'reloaded': False}
        supported = check.get('supported')
        if supported:
            ok, reason = supported()
            if not ok:
                return {'success': False, 'error': reason or 'unsupported on this host',
                        'wrote': [], 'reloaded': False}
        repair_fn = check.get('repair')
        if not repair_fn:
            return {'success': False, 'error': f'{check_type} is not repairable',
                    'wrote': [], 'reloaded': False}
        try:
            result = repair_fn(resource_id) or {}
        except Exception as e:  # noqa: BLE001 — surface as a clean error
            return {'success': False, 'error': str(e), 'wrote': [], 'reloaded': False}
        result.setdefault('success', False)
        result.setdefault('wrote', [])
        result.setdefault('reloaded', False)
        return result

    # ------------------------------------------------------------------ #
    # Job plumbing
    # ------------------------------------------------------------------ #

    @classmethod
    def run_drift_check_job(cls, job):
        """Job handler for ``drift.check``: sweep, store, notify on drift."""
        report = cls.build_report()
        cls.store_report(report)
        if report['drifted'] > 0:
            cls._notify_drift(report)
        return {'drifted': report['drifted'], 'errors': report['errors'],
                'checked': len(report['results'])}

    @classmethod
    def _notify_drift(cls, report):
        """Best-effort admin notification — never breaks the sweep."""
        try:
            from app.plugins_sdk import notify
            names = [r['name'] for r in report['results']
                     if r['status'] in ('drifted', 'missing')]
            summary = ', '.join(names[:5]) + ('…' if len(names) > 5 else '')
            notify.send('drift.detected', to='admins', data={
                'count': report['drifted'],
                'resources': names,
                'message': (
                    f"{report['drifted']} managed configuration file(s) no longer match "
                    f"what ServerKit expects: {summary}. Review them on "
                    'Monitoring → Doctor and repair the ones you did not change '
                    'on purpose.'),
            })
        except Exception as e:  # noqa: BLE001
            logger.debug('drift notification failed: %s', e)

    @classmethod
    def register_jobs(cls):
        """Register the drift sweep handler with the job registry.
        Called once at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(DRIFT_JOB_KIND, cls.run_drift_check_job, replace=True)


# --------------------------------------------------------------------------- #
# Built-in checks
# --------------------------------------------------------------------------- #

def _nginx_list_resources():
    """Apps published via host nginx = apps that have Domain rows."""
    from app.models.application import Application
    from app.models.domain import Domain
    # Both sides must be live: drift REPAIR rewrites the vhost, so a tombstoned
    # app (or an app whose only remaining domains are tombstoned) would have the
    # config the delete removed written back.
    rows = (Application.query_active()
            .join(Domain, Domain.application_id == Application.id)
            .filter(Domain.deleted_at.is_(None))
            .distinct()
            .all())
    return [(app.id, app.name) for app in rows]


def _nginx_render_expected(app_id):
    from app.models.application import Application
    from app.services.nginx_service import NginxService
    from app.services.site_domain_service import SiteDomainService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None:
        return {}
    kwargs, warning = SiteDomainService.app_vhost_kwargs(app)
    if kwargs is None:
        if warning:
            # App has domains but can't be published via host nginx — there is
            # nothing the panel would have written, so nothing to compare.
            logger.debug('drift: nginx vhost n/a for %s: %s', app.name, warning)
        return {}
    rendered = NginxService.render_site_config(**kwargs)
    if not rendered.get('success'):
        raise RuntimeError(rendered.get('error') or 'vhost render failed')
    config = rendered['config']

    # Feature blocks live in the vhost but not in the template: an app with
    # an enforcing WAF policy has its include wired post-render
    # (WafService.apply). Render the expected file through the SAME injector,
    # or every WAF'd app reads as permanently drifted and one "repair" click
    # regenerates the vhost without the include — silently unprotecting the
    # site while the DB still says enforcing (plan 82 §F.1).
    config = _with_expected_waf(app.id, config)

    path = os.path.join(NginxService.SITES_AVAILABLE, app.name)
    return {path: config}


def _with_expected_waf(app_id, config):
    from app.models.waf_policy import WafPolicy
    from app.services.waf_service import WafService

    policy = WafPolicy.query.filter_by(application_id=app_id).first()
    if policy is None or policy.mode not in ('block', 'detect'):
        return config
    injected = WafService.inject_include_text(
        config, WafService.include_path_for(app_id))
    return injected if injected is not None else config


# A vhost written before the timed log format (plan 86 §A1) has a bare
# `access_log <path>;`. That is not drift: the format only changes what the log
# records, and the next regeneration adopts it. Read such lines as the timed
# form so an upgrade doesn't flag (and notify about) every existing site.
_LEGACY_ACCESS_LOG_RE = re.compile(
    r'^(\s*access_log /var/log/nginx/[^\s;]+\.access\.log);$', re.MULTILINE)


def _nginx_read_actual(paths):
    actual = _default_read_actual(paths)
    return {
        path: (_LEGACY_ACCESS_LOG_RE.sub(r'\1 serverkit_timed;', content)
               if content is not None else None)
        for path, content in actual.items()
    }


def _nginx_repair(app_id):
    from app.models.application import Application
    from app.services.nginx_service import NginxService
    from app.services.site_domain_service import SiteDomainService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None:
        return {'success': False, 'error': 'Service not found'}
    res = SiteDomainService.write_app_vhost(app)
    if res.get('warning') and not (res.get('nginx') or {}).get('success'):
        return {'success': False, 'error': res['warning']}

    # write_app_vhost regenerates from the template, which drops the WAF
    # include; re-wire it for apps with an enforcing policy so a repair
    # never strips protection the DB still records (plan 82 §F.1).
    from app.services.waf_service import WafService
    WafService.reapply_if_enforcing(app_id)

    reload_res = NginxService.reload()
    return {
        'success': True,
        'wrote': [os.path.join(NginxService.SITES_AVAILABLE, app.name)],
        'reloaded': bool(reload_res.get('success')),
        'warning': res.get('warning') or (None if reload_res.get('success')
                                          else reload_res.get('error')),
    }


register_check({
    'type': 'nginx_vhost',
    'title': 'Nginx vhosts',
    'supported': _linux_only,
    'list_resources': _nginx_list_resources,
    'render_expected': _nginx_render_expected,
    'read_actual': _nginx_read_actual,
    'repair': _nginx_repair,
})


def _list_error_entry(check_type, resource_id, name, detail):
    """An inline 'could not check this resource' entry for list_resources to
    return alongside healthy (id, name) tuples — same shape check_all builds
    for a whole-check failure, so a resource one app could not inspect is
    reported as an error instead of vanishing from the sweep."""
    return {
        'type': check_type,
        'id': resource_id,
        'name': name,
        'status': 'error',
        'diff': None,
        'detail': detail,
        'checked_at': datetime.utcnow().isoformat() + 'Z',
    }


def _compose_list_resources():
    """Managed apps that live in a project dir (candidate compose apps)."""
    from app.models.application import Application
    rows = Application.query_active().filter(Application.root_path.isnot(None)).all()
    out = []
    for app in rows:
        try:
            from app.services.compose_env_service import ComposeEnvService
            if app.root_path and os.path.isdir(app.root_path) and \
                    ComposeEnvService.find_base_compose(app.root_path, app.compose_file):
                out.append((app.id, app.name))
        except Exception as e:  # noqa: BLE001 — an unreadable app is an error, not an absence
            out.append(_list_error_entry(
                'compose_override', app.id, app.name,
                f'Could not inspect this app: {e}'))
    return out


def _compose_render_expected(app_id):
    from app.models.application import Application
    from app.services.compose_env_service import ComposeEnvService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None or not app.root_path:
        return {}
    spec = ComposeEnvService.render_override(app.root_path, app.compose_file)
    if not spec['applies']:
        return {}
    # content None → the override must not exist (stale file = drift).
    return {spec['path']: spec['content']}


def _compose_repair(app_id):
    from app.models.application import Application
    from app.services.compose_env_service import ComposeEnvService
    from app.services.docker_service import DockerService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None:
        return {'success': False, 'error': 'Service not found'}
    written = ComposeEnvService.refresh_for_project(app.root_path, app.compose_file)
    # Apply the regenerated override the same way a deploy does.
    up = DockerService.compose_up(app.root_path, detach=True,
                                  compose_file=app.compose_file)
    return {
        'success': True,
        'wrote': [written] if written else [],
        'reloaded': bool(up.get('success')),
        'warning': None if up.get('success') else up.get('error'),
    }


register_check({
    'type': 'compose_override',
    'title': 'Compose env overrides',
    'supported': _linux_only,
    'list_resources': _compose_list_resources,
    'render_expected': _compose_render_expected,
    'repair': _compose_repair,
})

# ---------------------------------------------------------------------------
# manifest reconciliation (#18)
#
# Unlike the file-based checks above, this one compares *config*, not files:
# for every manifest-managed app it asks ManifestApplyService for the
# (expected, observed) pair over the manifest-declared surface (port,
# healthcheck, env keys, volumes, domains) and reports drift when they differ.
# Because there is no file on disk to read, we supply a custom ``read_actual``
# that re-derives the observed side instead of touching the filesystem. The
# synthetic path key is ``manifest://app/<id>``.
# ---------------------------------------------------------------------------


def _manifest_list_resources():
    """Every Application that is governed by a stored manifest."""
    from app.models.application import Application
    from app.services.manifest_apply_service import ManifestApplyService

    out = []
    rows = Application.query_active().filter(Application.project_id.isnot(None)).all()
    for app in rows:
        try:
            if ManifestApplyService.resolved_for_app(app) is not None:
                out.append((app.id, app.name))
        except Exception as e:  # noqa: BLE001 — an unresolvable app is an error, not an absence
            out.append(_list_error_entry(
                'manifest', app.id, app.name,
                f'Could not resolve this app\'s manifest: {e}'))
    return out


def _manifest_render_expected(app_id):
    from app.models.application import Application
    from app.services.manifest_apply_service import ManifestApplyService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None:
        return {}
    resolved = ManifestApplyService.resolved_for_app(app)
    if resolved is None:
        return {}
    expected, _observed = ManifestApplyService.drift_pair(app, resolved)
    return {f'manifest://app/{app_id}': json.dumps(expected, sort_keys=True)}


def _manifest_read_actual(paths):
    from app.models.application import Application
    from app.services.manifest_apply_service import ManifestApplyService

    actual = {}
    for path in paths:
        try:
            app_id = int(path.rsplit('/', 1)[-1])
        except (ValueError, IndexError):
            actual[path] = None
            continue
        app = Application.query_active().filter_by(id=app_id).first()
        resolved = ManifestApplyService.resolved_for_app(app) if app else None
        if app is None or resolved is None:
            actual[path] = None
            continue
        _expected, observed = ManifestApplyService.drift_pair(app, resolved)
        actual[path] = json.dumps(observed, sort_keys=True)
    return actual


def _manifest_repair(app_id):
    from app.models.application import Application
    from app.services.manifest_apply_service import ManifestApplyService

    app = Application.query_active().filter_by(id=app_id).first()
    if app is None:
        return {'success': False, 'error': 'Service not found'}
    if not app.project_id:
        return {'success': False, 'error': 'This service is not managed by a manifest'}
    result = ManifestApplyService.apply_stored(app.project_id)
    ok = bool(result.get('success', False))
    return {
        'success': ok,
        'wrote': [f'app:{app_id}'],
        'reloaded': ok,
        'error': None if ok else result.get('error'),
    }


register_check({
    'type': 'manifest',
    'title': 'Manifest reconciliation',
    'list_resources': _manifest_list_resources,
    'render_expected': _manifest_render_expected,
    'read_actual': _manifest_read_actual,
    'repair': _manifest_repair,
})

# NOTE: no systemd unit check — see the module docstring. The panel-templated
# gunicorn units (PythonService.create_gunicorn_service) render from inputs
# that aren't persisted (workers/user/.env snapshot), so an expected render
# can't be reproduced faithfully; everything else under /etc/systemd/system is
# installer-owned.
