"""Attach a custom domain to any managed app, end to end.

This generalizes the WordPress "one-call attach a custom domain" pattern
(``wordpress_service.attach_custom_domain``) so plain apps (docker, python,
php, static) can use the same DNS + vhost + optional-SSL flow.

The public entry point is :meth:`DomainAttachService.attach`. Every external
stage (DNS provider API, nginx vhost write, certbot) degrades to a *warning*
and never raises — HTTPS is optional in ServerKit and a certificate failure
must never block the domain attach. The idempotent Domain row is the only
hard requirement; everything after it is best-effort.

Stateless — all classmethods, no instance state — matching the repo style.
"""
import os
from typing import Dict, Optional

from app import db
from app.models.domain import Domain
from app.services.site_domain_service import SiteDomainService
from app.services.dns_provider_service import DNSProviderService


class DomainAttachService:
    """Point a user-owned domain at a managed app in one call."""

    @staticmethod
    def _normalize_host(host: str) -> str:
        """Reduce a bare host or a full URL down to a lowercase hostname."""
        h = (host or '').strip().lower()
        if '://' in h:
            h = h.split('://', 1)[1]
        h = h.split('/', 1)[0].split(':', 1)[0]
        return h.strip().strip('.').rstrip('.')

    @classmethod
    def attach(cls, app, host: str, ssl: str = 'auto',
               email: Optional[str] = None, make_primary: bool = False) -> Dict:
        """Attach ``host`` to ``app``: record the Domain, ensure DNS, publish the
        vhost, and optionally obtain a certificate.

        Args:
            app: the ``Application`` row to attach the domain to.
            host: the custom hostname (bare host or full URL).
            ssl: ``'auto'``/``'on'``/``True`` obtains a certificate best-effort;
                ``'off'``/``False`` skips SSL entirely.
            email: ACME account email (defaults to ``admin@<host>``).
            make_primary: when true, make this the app's primary domain
                (unsetting any existing primary first).

        Returns a dict with the EXACT shape the manifest applier consumes::

            {'success': True, 'domain': host, 'created': bool,
             'dns': <ensure_a_record result>,
             'ssl': {'enabled': bool, 'error'?: str},
             'warnings': [str, ...]}

        or ``{'success': False, 'error': msg}`` on an invalid host / DB failure.
        """
        if not app:
            return {'success': False, 'error': 'Choose a service'}

        host = cls._normalize_host(host)
        if not host or '.' not in host:
            return {'success': False, 'error': 'A valid custom domain (e.g. example.com) is required'}

        warnings = []

        # 1) Idempotent Domain row (create if missing, honor make_primary).
        try:
            # query_active: finding a TOMBSTONE here made attach report success
            # while never creating a live row -- the domain was never published,
            # and the code below then mutated a recycle-bin record.
            domain = Domain.query_active().filter_by(name=host, application_id=app.id).first()
            created = domain is None
            if make_primary:
                Domain.query_active().filter_by(application_id=app.id, is_primary=True).update(
                    {'is_primary': False})
            if domain is None:
                # Guard against the host being claimed by a *different* app —
                # `name` is globally unique, so we can't silently steal it.
                # query_active: a tombstone must not count as a clash. Migration
                # 083 made the unique index partial precisely so deleting a domain
                # frees its name; checking tombstones here re-imposes the burn.
                clash = Domain.query_active().filter_by(name=host).first()
                if clash and clash.application_id != app.id:
                    return {'success': False,
                            'error': f'{host} is already attached to another service'}
                domain = Domain(name=host, is_primary=bool(make_primary),
                                application_id=app.id)
                db.session.add(domain)
            elif make_primary:
                domain.is_primary = True
            db.session.flush()
        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': f'Could not record domain: {e}'}

        # 2) DNS: auto-create the A record best-effort (or report what to add).
        dns = None
        try:
            dns = DNSProviderService.ensure_a_record(host, SiteDomainService.server_ip())
            if dns and not dns.get('created'):
                warnings.append(dns.get('message')
                                or f'Add the {host} A record manually.')
        except Exception as e:
            warnings.append(f'DNS auto-config skipped: {e}')

        # 3) Publish the vhost so the host is actually served. Linux-only —
        #    on a Windows dev box nginx is unavailable, so skip with a warning
        #    rather than crashing.
        if os.name == 'nt':
            warnings.append('nginx vhost not written (not a Linux host).')
        else:
            try:
                v = SiteDomainService.write_app_vhost(app)
                if v and v.get('warning'):
                    warnings.append(v['warning'])
            except Exception as e:
                warnings.append(f'nginx vhost not written: {e}')

        # 4) Optional HTTPS. Best-effort — a cert failure never fails the attach.
        ssl_result = {'enabled': False}
        want_ssl = ssl in ('auto', 'on', True)
        if want_ssl:
            try:
                from app.services.ssl_service import SSLService, get_acme_contact
                from app.services.nginx_service import NginxService
                # The stored panel contact before the admin@<host> guess —
                # that guess is where Let's Encrypt expiry notices went to
                # die, since the address usually does not exist.
                cert = SSLService.obtain_certificate(
                    [host], get_acme_contact(email) or f'admin@{host}')
                if cert and cert.get('success'):
                    domain.ssl_enabled = True
                    domain.ssl_certificate_path = cert.get('certificate_path')
                    domain.ssl_key_path = cert.get('private_key_path')
                    ssl_result['enabled'] = True
                    try:
                        NginxService.add_ssl_to_site(
                            app.name, cert.get('certificate_path'),
                            cert.get('private_key_path'))
                    except Exception as e:
                        warnings.append(f'certificate issued but nginx SSL wiring failed: {e}')
                else:
                    err = (cert or {}).get('error') or 'certificate request failed'
                    ssl_result['error'] = err
                    warnings.append(
                        'HTTPS is not set up yet — enable SSL once DNS has '
                        f'propagated to this server ({err}).')
            except Exception as e:
                ssl_result['error'] = str(e)
                warnings.append(f'HTTPS is not set up yet: {e}')

        # 5) Commit the Domain row (row + any SSL fields).
        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': f'Could not save domain: {e}'}

        return {
            'success': True,
            'domain': host,
            'created': created,
            'dns': dns,
            'ssl': ssl_result,
            'warnings': warnings,
        }
