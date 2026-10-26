import logging
import os
import subprocess
import re
from typing import Dict, List, Optional
from pathlib import Path

from app.utils.system import (ServiceControl, is_command_available,
                             run_privileged, write_privileged_file)

from app.services.nginx import templates, rendering, compression
from app.services.nginx.validation import _validate_domain, _validate_path  # compatibility exports

logger = logging.getLogger(__name__)


def _auto_capture_vhost(name, action):
    """Best-effort checkpoint for request-bound vhost lifecycle mutations."""
    from flask import has_app_context

    if not has_app_context():
        return None
    from app.services.restore_point_service import auto_capture, get_adapter

    if get_adapter('nginx_vhost') is None:
        return None
    return auto_capture('nginx_vhost', name, action)


class NginxService:
    """Service for Nginx configuration management."""

    # Default paths (can be overridden via environment)
    NGINX_CONF_DIR = os.environ.get('NGINX_CONF_DIR', '/etc/nginx')
    SITES_AVAILABLE = os.path.join(NGINX_CONF_DIR, 'sites-available')
    SITES_ENABLED = os.path.join(NGINX_CONF_DIR, 'sites-enabled')
    NGINX_BIN = os.environ.get('NGINX_BIN', '/usr/sbin/nginx')
    LOCATIONS_DIR = os.path.join(NGINX_CONF_DIR, 'serverkit-locations')
    # Per-site log directory. Must stay in sync with the access_log/error_log
    # paths hard-coded in nginx/templates.py. site_access_log_path() is the
    # single source of truth consumers should use (e.g. the fail2ban jail layer
    # watches this exact file), so the path can never drift from what nginx writes.
    LOG_DIR = '/var/log/nginx'

    # Compatibility aliases; configuration text is owned by nginx/templates.py.
    PHP_SITE_TEMPLATE = templates.PHP_SITE_TEMPLATE
    PYTHON_SITE_TEMPLATE = templates.PYTHON_SITE_TEMPLATE
    STATIC_SITE_TEMPLATE = templates.STATIC_SITE_TEMPLATE
    DOCKER_SITE_TEMPLATE = templates.DOCKER_SITE_TEMPLATE
    WORDPRESS_RATE_LIMIT_CONF_NAME = templates.WORDPRESS_RATE_LIMIT_CONF_NAME
    WORDPRESS_RATE_LIMIT_ZONE_SNIPPET = templates.WORDPRESS_RATE_LIMIT_ZONE_SNIPPET
    WORDPRESS_PROTECTION_BLOCK = templates.WORDPRESS_PROTECTION_BLOCK
    REMOTE_UPSTREAM_TEMPLATE = templates.REMOTE_UPSTREAM_TEMPLATE
    SSL_BLOCK = templates.SSL_BLOCK
    SSL_REDIRECT_TEMPLATE = templates.SSL_REDIRECT_TEMPLATE
    PRIVATE_URL_CONFIG_NAME = templates.PRIVATE_URL_CONFIG_NAME
    GITEA_CONFIG_NAME = templates.GITEA_CONFIG_NAME
    WORDPRESS_CONFIG_NAME = templates.WORDPRESS_CONFIG_NAME
    GITEA_LOCATION_TEMPLATE = templates.GITEA_LOCATION_TEMPLATE
    WORDPRESS_LOCATION_TEMPLATE = templates.WORDPRESS_LOCATION_TEMPLATE
    PRIVATE_URL_LOCATION_TEMPLATE = templates.PRIVATE_URL_LOCATION_TEMPLATE
    TIMED_LOG_FORMAT = templates.TIMED_LOG_FORMAT
    TIMED_LOG_CONF_NAME = templates.TIMED_LOG_CONF_NAME
    TIMED_LOG_FORMAT_SNIPPET = templates.TIMED_LOG_FORMAT_SNIPPET
    COMPRESSION_CONF_NAME = templates.COMPRESSION_CONF_NAME
    COMPRESSION_TYPES = templates.COMPRESSION_TYPES
    GZIP_DIRECTIVES = templates.GZIP_DIRECTIVES
    BROTLI_DIRECTIVES = templates.BROTLI_DIRECTIVES
    IMMUTABLE_ASSET_PATTERN = templates.IMMUTABLE_ASSET_PATTERN
    IMMUTABLE_ASSET_HEADERS = templates.IMMUTABLE_ASSET_HEADERS
    MICROCACHE_CONF_NAME = templates.MICROCACHE_CONF_NAME
    MICROCACHE_DIR = templates.MICROCACHE_DIR
    MICROCACHE_ZONE_SNIPPET = templates.MICROCACHE_ZONE_SNIPPET
    MICROCACHE_SKIP_BLOCK = templates.MICROCACHE_SKIP_BLOCK
    MICROCACHE_TTL_DEFAULT = templates.MICROCACHE_TTL_DEFAULT
    MICROCACHE_TTL_MAX = templates.MICROCACHE_TTL_MAX
    MICROCACHE_PROXY_BLOCK = templates.MICROCACHE_PROXY_BLOCK
    MICROCACHE_FASTCGI_BLOCK = templates.MICROCACHE_FASTCGI_BLOCK
    PRIVATE_URL_MAIN_CONFIG = templates.PRIVATE_URL_MAIN_CONFIG

    @classmethod
    def _render_settings(cls):
        """Pass only template values into the pure rendering layer."""
        return rendering.RenderSettings(
            DOCKER_SITE_TEMPLATE=cls.DOCKER_SITE_TEMPLATE,
            IMMUTABLE_ASSET_HEADERS=cls.IMMUTABLE_ASSET_HEADERS,
            IMMUTABLE_ASSET_PATTERN=cls.IMMUTABLE_ASSET_PATTERN,
            MICROCACHE_FASTCGI_BLOCK=cls.MICROCACHE_FASTCGI_BLOCK,
            MICROCACHE_PROXY_BLOCK=cls.MICROCACHE_PROXY_BLOCK,
            MICROCACHE_SKIP_BLOCK=cls.MICROCACHE_SKIP_BLOCK,
            MICROCACHE_TTL_DEFAULT=cls.MICROCACHE_TTL_DEFAULT,
            MICROCACHE_TTL_MAX=cls.MICROCACHE_TTL_MAX,
            PHP_SITE_TEMPLATE=cls.PHP_SITE_TEMPLATE,
            PYTHON_SITE_TEMPLATE=cls.PYTHON_SITE_TEMPLATE,
            REMOTE_UPSTREAM_TEMPLATE=cls.REMOTE_UPSTREAM_TEMPLATE,
            SSL_BLOCK=cls.SSL_BLOCK,
            SSL_REDIRECT_TEMPLATE=cls.SSL_REDIRECT_TEMPLATE,
            STATIC_SITE_TEMPLATE=cls.STATIC_SITE_TEMPLATE,
            WORDPRESS_PROTECTION_BLOCK=cls.WORDPRESS_PROTECTION_BLOCK,
        )

    @classmethod
    def test_config(cls) -> Dict:
        """Test Nginx configuration syntax."""
        if not is_command_available('nginx'):
            return {'success': False, 'error': 'nginx is not installed'}

        try:
            result = run_privileged([cls.NGINX_BIN, '-t'], timeout=30)
            return {
                'success': result.returncode == 0,
                'message': result.stderr if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload(cls) -> Dict:
        """Reload Nginx configuration."""
        # Test config first
        test_result = cls.test_config()
        if not test_result['success']:
            return {'success': False, 'error': f"Config test failed: {test_result.get('message', test_result.get('error'))}"}

        try:
            result = ServiceControl.reload('nginx', timeout=30)
            return {
                'success': result.returncode == 0,
                'message': 'Nginx reloaded successfully' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart(cls) -> Dict:
        """Restart Nginx service.

        Config-tested first, exactly like reload — and the stakes are higher
        here. A reload against a broken config fails safe: nginx rejects the
        new config and keeps serving the old one. A restart stops nginx before
        it starts it, so the same broken config takes every site on the host
        down and leaves nginx dead until someone fixes it by hand. Testing
        first means a bad config costs an error message instead of an outage.
        """
        test_result = cls.test_config()
        if not test_result['success']:
            return {
                'success': False,
                'error': "Config test failed: "
                         f"{test_result.get('message') or test_result.get('error')}",
            }

        try:
            result = ServiceControl.restart('nginx', timeout=30)
            return ServiceControl.result_dict(
                result, 'Nginx restarted successfully', error_key='message')
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_status(cls) -> Dict:
        """Get Nginx service status."""
        try:
            result = run_privileged(['systemctl', 'status', 'nginx'], timeout=30)

            # Parse status
            is_running = 'active (running)' in result.stdout

            return {
                'running': is_running,
                'status': 'running' if is_running else 'stopped',
                'details': result.stdout
            }
        except Exception as e:
            return {'running': False, 'status': 'unknown', 'error': str(e)}

    @classmethod
    def list_sites(cls) -> List[Dict]:
        """List all configured sites."""
        sites = []

        if not os.path.exists(cls.SITES_AVAILABLE):
            return sites

        enabled_sites = set()
        if os.path.exists(cls.SITES_ENABLED):
            enabled_sites = {f for f in os.listdir(cls.SITES_ENABLED)}

        for filename in os.listdir(cls.SITES_AVAILABLE):
            if filename.startswith('.'):
                continue

            filepath = os.path.join(cls.SITES_AVAILABLE, filename)
            if os.path.isfile(filepath):
                config = cls._parse_site_config(filepath)
                sites.append({
                    'name': filename,
                    'enabled': filename in enabled_sites,
                    'domains': config.get('domains', []),
                    'root': config.get('root'),
                    'ssl': config.get('ssl', False)
                })

        return sites

    @classmethod
    def _parse_site_config(cls, filepath: str) -> Dict:
        """Parse basic info from a site config file."""
        config = {'domains': [], 'root': None, 'ssl': False}

        try:
            with open(filepath, 'r') as f:
                content = f.read()

            # Extract server_name
            match = re.search(r'server_name\s+([^;]+);', content)
            if match:
                domains = match.group(1).strip().split()
                config['domains'] = [d for d in domains if d != '_']

            # Extract root
            match = re.search(r'root\s+([^;]+);', content)
            if match:
                config['root'] = match.group(1).strip()

            # Check for SSL
            config['ssl'] = 'ssl_certificate' in content

        except Exception:
            pass

        return config

    @classmethod
    def render_site_config(cls, name: str, app_type: str, domains: List[str],
                           root_path: str = None, port: int = None,
                           php_version: str = '8.2',
                           ssl_cert: str = None, ssl_key: str = None,
                           upstream: str = None,
                           micro_cache: bool = False,
                           micro_cache_ttl: Optional[int] = None,
                           immutable_assets: bool = False,
                           wordpress_protection: bool = False,
                           cert_groups: Optional[List[tuple]] = None) -> Dict:
        """Compatibility entry point for the pure configuration layer."""
        return rendering.render_site_config(
            name, app_type, domains, root_path, port, php_version, ssl_cert,
            ssl_key, upstream, micro_cache, micro_cache_ttl, immutable_assets,
            wordpress_protection, cert_groups=cert_groups,
            settings=cls._render_settings())

    @classmethod
    def _with_wordpress_protection(cls, config: str, port: int) -> str:
        """Compatibility entry point for the pure configuration layer."""
        return rendering._with_wordpress_protection(
            config, port, settings=cls._render_settings())

    @classmethod
    def ensure_wordpress_rate_limit_zones(cls) -> Dict:
        """Write the shared WordPress rate-limit zones to nginx conf.d."""
        conf_path = os.path.join(
            cls.NGINX_CONF_DIR,
            'conf.d',
            cls.WORDPRESS_RATE_LIMIT_CONF_NAME,
        )
        try:
            if os.path.isfile(conf_path):
                with open(conf_path, 'r') as f:
                    if f.read() == cls.WORDPRESS_RATE_LIMIT_ZONE_SNIPPET:
                        return {
                            'success': True,
                            'changed': False,
                            'path': conf_path,
                            'message': 'WordPress rate-limit zones already configured',
                        }
            written = write_privileged_file(
                conf_path,
                cls.WORDPRESS_RATE_LIMIT_ZONE_SNIPPET,
            )
            if not written['success']:
                return {'success': False, 'error': written['error']}
            return {
                'success': True,
                'changed': True,
                'path': conf_path,
                'message': 'WordPress rate-limit zones configured',
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _with_immutable_assets(cls, config: str, app_type: str) -> str:
        """Compatibility entry point for the pure configuration layer."""
        return rendering._with_immutable_assets(
            config, app_type, settings=cls._render_settings())

    @classmethod
    def _with_micro_cache(cls, config: str, app_type: str,
                          ttl: Optional[int] = None) -> str:
        """Compatibility entry point for the pure configuration layer."""
        return rendering._with_micro_cache(
            config, app_type, ttl, settings=cls._render_settings())

    @classmethod
    def clamp_micro_cache_ttl(cls, ttl) -> int:
        """Compatibility entry point for the pure configuration layer."""
        return rendering.clamp_micro_cache_ttl(
            ttl, settings=cls._render_settings())

    @classmethod
    def ensure_cache_zone(cls) -> Dict:
        """Write the shared micro-cache zone declaration to conf.d (idempotent).

        The zone must live in the http context, so it is a conf.d snippet
        written once — not part of any per-site vhost. Also pre-creates the
        on-disk cache directories. Skips the write when the snippet on disk
        already matches.
        """
        conf_path = os.path.join(cls.NGINX_CONF_DIR, 'conf.d', cls.MICROCACHE_CONF_NAME)
        try:
            if os.path.isfile(conf_path):
                with open(conf_path, 'r') as f:
                    if f.read() == cls.MICROCACHE_ZONE_SNIPPET:
                        return {'success': True, 'changed': False, 'path': conf_path,
                                'message': 'Micro-cache zone already configured'}
            run_privileged(['mkdir', '-p',
                            os.path.join(cls.MICROCACHE_DIR, 'proxy'),
                            os.path.join(cls.MICROCACHE_DIR, 'fastcgi')])
            written = write_privileged_file(conf_path, cls.MICROCACHE_ZONE_SNIPPET)
            if not written['success']:
                return {'success': False, 'error': written['error']}
            return {'success': True, 'changed': True, 'path': conf_path,
                    'message': 'Micro-cache zone configured'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def ensure_log_format(cls) -> Dict:
        """Write the ``serverkit_timed`` log_format to conf.d (idempotent).

        ``log_format`` is http-context only, so like the micro-cache zone it is
        a conf.d snippet, not part of any vhost. :meth:`write_vhost` calls this
        before writing any vhost that references the format.
        """
        conf_path = os.path.join(cls.NGINX_CONF_DIR, 'conf.d', cls.TIMED_LOG_CONF_NAME)
        try:
            if os.path.isfile(conf_path):
                with open(conf_path, 'r') as f:
                    if f.read() == cls.TIMED_LOG_FORMAT_SNIPPET:
                        return {'success': True, 'changed': False, 'path': conf_path}
            written = write_privileged_file(conf_path, cls.TIMED_LOG_FORMAT_SNIPPET)
            if not written['success']:
                return {'success': False, 'error': written['error']}
            return {'success': True, 'changed': True, 'path': conf_path}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _http_level_directives(cls, dump: str, skip_file: str) -> set:
        """Compatibility entry point for the pure configuration layer."""
        return compression._http_level_directives(
            dump, skip_file)

    @classmethod
    def render_compression_snippet(cls, dump: str, conf_path: str,
                                   nginx_v: str = '') -> str:
        """Compatibility entry point for the pure configuration layer."""
        return compression.render_compression_snippet(
            dump, conf_path, nginx_v, gzip_directives=cls.GZIP_DIRECTIVES,
            brotli_directives=cls.BROTLI_DIRECTIVES)

    @classmethod
    def ensure_compression(cls) -> Dict:
        """Write the compression snippet once, best-effort.

        Skips when the snippet exists. A snippet that fails ``nginx -t`` is
        removed again, so compression can never take the web server down —
        it just stays off, and the error says why.
        """
        conf_path = os.path.join(cls.NGINX_CONF_DIR, 'conf.d', cls.COMPRESSION_CONF_NAME)
        if os.path.isfile(conf_path):
            return {'success': True, 'changed': False, 'path': conf_path}
        try:
            dump = run_privileged([cls.NGINX_BIN, '-T'], timeout=30)
            if dump.returncode != 0:
                return {'success': False, 'error': (dump.stderr or 'nginx -T failed').strip()}
            version = run_privileged([cls.NGINX_BIN, '-V'], timeout=30)
            snippet = cls.render_compression_snippet(
                dump.stdout or '', conf_path, (version.stderr or '') + (version.stdout or ''))
            written = write_privileged_file(conf_path, snippet)
            if not written['success']:
                return {'success': False, 'error': written['error']}
            test = cls.test_config()
            if not test['success']:
                run_privileged(['rm', '-f', conf_path])
                return {'success': False,
                        'error': f"compression snippet rejected: {test.get('message') or test.get('error')}"}
            return {'success': True, 'changed': True, 'path': conf_path}
        except Exception as e:  # noqa: BLE001 - best-effort, never blocks a vhost
            return {'success': False, 'error': str(e)}

    # rm argv batch size for a per-site purge (keeps argv far below ARG_MAX).
    PURGE_BATCH = 200

    @classmethod
    def purge_micro_cache(cls, hosts: Optional[List[str]] = None) -> Dict:
        """Clear cached pages. Linux-only; no nginx reload needed.

        With ``hosts`` only that site's entries go. nginx writes
        each entry's key as a ``KEY: <scheme>://<host><uri>`` header line in
        the cache file, so a fixed-string grep for ``KEY: http[s]://<host>/``
        finds exactly this site's files; the trailing ``/`` keeps
        ``shop.example.com`` from matching ``shop.example.com.evil``. Entries
        cached under an older key (before the vhost was rewritten) aren't
        found this way, and expire on their own TTL.

        Without ``hosts`` the whole shared directory is wiped (every site).
        """
        if os.name == 'nt':
            return {'success': False,
                    'error': 'Micro-cache purge is only available on Linux hosts'}
        subdirs = [os.path.join(cls.MICROCACHE_DIR, d) for d in ('proxy', 'fastcgi')]
        try:
            if hosts is None:
                process = run_privileged(['rm', '-rf'] + subdirs)
                if process.returncode != 0:
                    return {'success': False, 'error': process.stderr}
                run_privileged(['mkdir', '-p'] + subdirs)
                return {'success': True, 'message': 'Micro-cache cleared for every site'}

            hosts = [h.lower() for h in hosts if h]
            bad = [h for h in hosts if not _validate_domain(h)]
            if bad or not hosts:
                return {'success': False,
                        'error': f"Invalid host: {bad[0] if bad else '(none)'}"}
            argv = ['grep', '-rlaF']
            for host in hosts:
                argv += ['-e', f'KEY: http://{host}/', '-e', f'KEY: https://{host}/']
            found = run_privileged(argv + subdirs, timeout=60)
            # grep: 0 = matches, 1 = none; 2 = an error such as a missing
            # subdir, which only matters if it hid every result.
            if found.returncode not in (0, 1) and not (found.stdout or '').strip():
                if 'No such file' not in (found.stderr or ''):
                    return {'success': False, 'error': (found.stderr or 'grep failed').strip()}
            files = [f for f in (found.stdout or '').splitlines() if f.strip()]
            for i in range(0, len(files), cls.PURGE_BATCH):
                removed = run_privileged(['rm', '-f', '--'] + files[i:i + cls.PURGE_BATCH])
                if removed.returncode != 0:
                    return {'success': False, 'error': removed.stderr}
            return {'success': True, 'purged': len(files),
                    'message': f'Cleared {len(files)} cached page(s) for this site'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_site(cls, name: str, app_type: str, domains: List[str],
                    root_path: str = None, port: int = None, php_version: str = '8.2',
                    ssl_cert: str = None, ssl_key: str = None,
                    upstream: str = None, micro_cache: bool = False,
                    micro_cache_ttl: Optional[int] = None,
                    immutable_assets: bool = False,
                    wordpress_protection: bool = False,
                    cert_groups: Optional[List[tuple]] = None) -> Dict:
        """Create a new site configuration.

        When ``ssl_cert``/``ssl_key`` are given the generated vhost serves HTTPS
        (443) from that cert with an HTTP->HTTPS redirect — used to point managed
        subdomains at the base-domain wildcard cert. ``micro_cache`` opts the
        site into the shared 10s micro-cache (the global zone snippet is
        ensured first, since the vhost references it).
        """
        rendered = cls.render_site_config(
            name, app_type, domains, root_path=root_path, port=port,
            php_version=php_version, ssl_cert=ssl_cert, ssl_key=ssl_key,
            upstream=upstream, micro_cache=micro_cache,
            micro_cache_ttl=micro_cache_ttl, immutable_assets=immutable_assets,
            wordpress_protection=wordpress_protection, cert_groups=cert_groups,
        )
        if not rendered.get('success'):
            return rendered
        config = rendered['config']

        # The vhost references the shared cache zone — declare it (once)
        # before the write so `nginx -t` on the next reload passes.
        if micro_cache:
            zone = cls.ensure_cache_zone()
            if not zone.get('success'):
                return {'success': False,
                        'error': f"micro-cache zone setup failed: {zone.get('error')}"}

        if wordpress_protection:
            zones = cls.ensure_wordpress_rate_limit_zones()
            if not zones.get('success'):
                return {
                    'success': False,
                    'error': (
                        'WordPress rate-limit zone setup failed: '
                        f"{zones.get('error')}"
                    ),
                }

        try:
            result = cls.write_vhost(name, config)
            if result.get('success'):
                result['message'] = f'Site {name} created'
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _with_ssl(cls, http_config: str, domains: str, ssl_cert: str, ssl_key: str) -> str:
        """Compatibility entry point for the pure configuration layer."""
        return rendering._with_ssl(
            http_config, domains, ssl_cert, ssl_key, settings=cls._render_settings())

    @classmethod
    def site_access_log_path(cls, name: str) -> str:
        """Path of the per-site nginx access log for site ``name`` — the same
        ``/var/log/nginx/{name}.access.log`` the site templates write. This is the
        canonical accessor so consumers (e.g. the fail2ban brute-force jail) never
        hard-code the path and it can't drift from the generated vhost. Always a
        POSIX path (these are Linux server logs), independent of the panel's OS."""
        return f'{cls.LOG_DIR}/{name}.access.log'

    @classmethod
    def site_error_log_path(cls, name: str) -> str:
        """Path of the per-site nginx error log for site ``name`` (companion to
        :meth:`site_access_log_path`)."""
        return f'{cls.LOG_DIR}/{name}.error.log'

    @classmethod
    def read_vhost(cls, name: str) -> Optional[str]:
        """The vhost's current content, or ``None`` if it cannot be read.

        ``None`` means "could not determine", never "empty file". Callers
        that need to distinguish a missing vhost from an unreadable one check
        ``os.path.exists`` themselves.
        """
        try:
            result = run_privileged(['cat', os.path.join(cls.SITES_AVAILABLE, name)])
        except Exception:  # noqa: BLE001 - no cat, no permission, timeout
            return None
        return result.stdout if result.returncode == 0 else None

    @staticmethod
    def _invalid_site_name(name) -> Optional[Dict]:
        """The error for a site name that is not a plain filename, else None.

        Every site method joins `name` onto sites-available/sites-enabled and
        acts on the result as root, so a caller-controlled name must not
        traverse out (preview_diff applies the same rule for reads).
        """
        if (not name or not isinstance(name, str) or os.path.basename(name) != name
                or name in ('.', '..') or '\x00' in name):
            return {'success': False, 'error': f'Invalid site name: {name!r}'}
        return None

    @classmethod
    def write_vhost(cls, name: str, content: str, *, enable: bool = True) -> Dict:
        """Write, enable, config-test, roll back on failure, reload. One door.

        ``environment_domain_service`` re-implemented this whole sequence with
        raw ``sudo`` calls, and ``nginx_advanced_service`` wrote the file with a
        plain unprivileged ``open()``. Both bypass every guard NginxService
        already owns: the sudo-vs-root decision, argv[0] resolution for an
        sbin-resident nginx, and the config test.

        The rollback is the part a copy never has. Writing a broken vhost and
        *then* discovering ``nginx -t`` fails leaves the file on disk and
        symlinked; the next unrelated reload — a certificate renewal, another
        site going live — picks it up and fails, and the blame lands on
        whatever triggered that reload. Restoring the previous content (or
        removing a file that did not exist before) keeps the failure local to
        the caller that caused it.

        Returns ``{'success', 'path'}`` or ``{'success': False, 'error'}``.
        """
        invalid = cls._invalid_site_name(name)
        if invalid:
            return invalid

        # A vhost naming the timed format fails `nginx -t` until the
        # http-level log_format exists — declare it first.
        if f' {cls.TIMED_LOG_FORMAT};' in content:
            fmt = cls.ensure_log_format()
            if not fmt.get('success'):
                return {'success': False,
                        'error': f"log format setup failed: {fmt.get('error')}"}

        # Compression is global and best-effort: a box where it can't be set
        # up still gets its vhost.
        compression = cls.ensure_compression()
        if not compression.get('success'):
            logger.info('nginx compression not configured: %s', compression.get('error'))

        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        enabled_path = os.path.join(cls.SITES_ENABLED, name)
        previous = cls.read_vhost(name)
        was_enabled = os.path.exists(enabled_path)
        _auto_capture_vhost(name, 'write_vhost')

        written = write_privileged_file(available_path, content)
        if not written['success']:
            return {'success': False, 'error': written['error']}

        if enable and not was_enabled:
            link = run_privileged(['ln', '-sf', available_path, enabled_path])
            if link.returncode != 0:
                cls._restore_vhost(name, previous, was_enabled)
                return {'success': False,
                        'error': (link.stderr or f'failed to enable {name}').strip()}

        test = cls.test_config()
        if not test['success']:
            cls._restore_vhost(name, previous, was_enabled)
            return {'success': False,
                    'error': f"Config test failed: {test.get('message') or test.get('error')}"}

        reloaded = cls.reload()
        if not reloaded['success']:
            # A failed reload means nginx is still serving the previous config
            # (reload fails safe) — restore the file so on-disk state matches
            # what nginx actually runs, exactly like the config-test rollback.
            cls._restore_vhost(name, previous, was_enabled)
            return reloaded
        return {'success': True, 'path': available_path}

    @classmethod
    def _restore_vhost(cls, name: str, previous: Optional[str], was_enabled: bool) -> None:
        """Undo a :meth:`write_vhost` that did not survive the config test.

        Best-effort by nature — the write already failed, and a failure to
        clean up must not mask the error the caller is about to be told about.
        """
        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        enabled_path = os.path.join(cls.SITES_ENABLED, name)
        try:
            if previous is None:
                run_privileged(['rm', '-f', available_path])
            else:
                write_privileged_file(available_path, previous)
            if not was_enabled:
                run_privileged(['rm', '-f', enabled_path])
        except Exception:  # noqa: BLE001 - never mask the original failure
            pass

    @classmethod
    def enable_site(cls, name: str) -> Dict:
        """Enable a site by creating symlink in sites-enabled."""
        invalid = cls._invalid_site_name(name)
        if invalid:
            return invalid
        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        enabled_path = os.path.join(cls.SITES_ENABLED, name)

        if not os.path.exists(available_path):
            return {'success': False, 'error': f'Site {name} not found in sites-available'}

        _auto_capture_vhost(name, 'enable_site')

        try:
            result = run_privileged(['ln', '-sf', available_path, enabled_path])
            if result.returncode == 0:
                # Reload nginx
                reload_result = cls.reload()
                if reload_result['success']:
                    return {'success': True, 'message': f'Site {name} enabled'}
                return reload_result
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def disable_site(cls, name: str) -> Dict:
        """Disable a site by removing symlink from sites-enabled."""
        invalid = cls._invalid_site_name(name)
        if invalid:
            return invalid
        enabled_path = os.path.join(cls.SITES_ENABLED, name)
        _auto_capture_vhost(name, 'disable_site')

        try:
            result = run_privileged(['rm', '-f', enabled_path])
            if result.returncode == 0:
                reload_result = cls.reload()
                if reload_result['success']:
                    return {'success': True, 'message': f'Site {name} disabled'}
                return reload_result
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_site(cls, name: str) -> Dict:
        """Delete a site configuration."""
        invalid = cls._invalid_site_name(name)
        if invalid:
            return invalid
        _auto_capture_vhost(name, 'delete_site')
        # First disable it
        from app.services.restore_point_service import suppress_auto_capture
        with suppress_auto_capture():
            cls.disable_site(name)

        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        try:
            result = run_privileged(['rm', '-f', available_path])
            if result.returncode == 0:
                return {'success': True, 'message': f'Site {name} deleted'}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_ssl_to_site(cls, name: str, cert_path: str, key_path: str) -> Dict:
        """Add SSL configuration to an existing site."""
        config_path = os.path.join(cls.SITES_AVAILABLE, name)

        if not os.path.exists(config_path):
            return {'success': False, 'error': f'Site {name} not found'}

        try:
            content = cls.read_vhost(name)
            if content is None:
                return {'success': False, 'error': f'Could not read site {name}'}

            # Already HTTPS: swap the certificate in place. Re-running the
            # insert below would rewrite the redirect block's `listen 80;`
            # too and leave a duplicate 443 listen that fails `nginx -t`.
            if re.search(r'^\s*ssl_certificate\s', content, re.M):
                swapped = re.sub(r'^(\s*ssl_certificate)\s+[^;]+;',
                                 lambda m: f'{m.group(1)} {cert_path};', content, flags=re.M)
                swapped = re.sub(r'^(\s*ssl_certificate_key)\s+[^;]+;',
                                 lambda m: f'{m.group(1)} {key_path};', swapped, flags=re.M)
                return cls.write_vhost(name, swapped)

            # Extract domains for redirect
            match = re.search(r'server_name\s+([^;]+);', content)
            domains_str = match.group(1).strip() if match else name

            # Add SSL block after listen 80 lines
            ssl_config = cls.SSL_BLOCK.format(ssl_cert=cert_path, ssl_key=key_path)

            # Add redirect server block
            redirect_block = cls.SSL_REDIRECT_TEMPLATE.format(domains=domains_str)

            # Modify existing config - add SSL listen and certs
            new_content = content.replace(
                'listen 80;',
                f'listen 80;\n{ssl_config}'
            )

            # Prepend redirect block
            final_content = redirect_block + '\n' + new_content

            return cls.write_vhost(name, final_content)

        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== DIAGNOSTICS ====================

    @classmethod
    def get_site_config(cls, name: str) -> Dict:
        """Get the content of a site configuration file.

        Args:
            name: The site name (config filename)

        Returns:
            Dict with exists, enabled, content, and path
        """
        config_path = os.path.join(cls.SITES_AVAILABLE, name)
        if not os.path.exists(config_path):
            return {'exists': False, 'error': 'Config file not found', 'path': config_path}

        try:
            with open(config_path, 'r') as f:
                content = f.read()

            enabled_path = os.path.join(cls.SITES_ENABLED, name)
            is_enabled = os.path.exists(enabled_path) or os.path.islink(enabled_path)

            # Parse some basic info from the config
            parsed = cls._parse_site_config(config_path)

            return {
                'exists': True,
                'enabled': is_enabled,
                'content': content,
                'path': config_path,
                'enabled_path': enabled_path,
                'domains': parsed.get('domains', []),
                'ssl': parsed.get('ssl', False)
            }
        except Exception as e:
            return {'exists': True, 'error': str(e), 'path': config_path}

    @classmethod
    def diagnose_site(cls, name: str, port: int = None) -> Dict:
        """Full diagnostic for a site configuration.

        Args:
            name: The site name
            port: Optional port to check accessibility

        Returns:
            Dict with comprehensive diagnostic information
        """
        diagnosis = {
            'site_name': name,
            'config': cls.get_site_config(name),
            'nginx_status': cls.get_status(),
            'config_test': cls.test_config()
        }

        # Check port accessibility if provided
        if port:
            from app.services.docker_service import DockerService
            diagnosis['port_check'] = DockerService.check_port_accessible(port)

        # Determine overall health
        config_ok = diagnosis['config'].get('exists', False)
        enabled_ok = diagnosis['config'].get('enabled', False)
        nginx_ok = diagnosis['nginx_status'].get('running', False)
        syntax_ok = diagnosis['config_test'].get('success', False)
        port_ok = diagnosis.get('port_check', {}).get('accessible', True)  # True if no port to check

        diagnosis['health'] = {
            'config_exists': config_ok,
            'config_enabled': enabled_ok,
            'nginx_running': nginx_ok,
            'syntax_valid': syntax_ok,
            'port_accessible': port_ok,
            'overall': all([config_ok, enabled_ok, nginx_ok, syntax_ok, port_ok])
        }

        # Generate recommendations
        recommendations = []
        if not config_ok:
            recommendations.append('Create Nginx site configuration')
        if config_ok and not enabled_ok:
            recommendations.append('Enable the site with NginxService.enable_site()')
        if not nginx_ok:
            recommendations.append('Start Nginx service')
        if not syntax_ok:
            recommendations.append(f"Fix Nginx config syntax: {diagnosis['config_test'].get('message', '')}")
        if port and not port_ok:
            recommendations.append(f'Ensure container is running and exposing port {port}')

        diagnosis['recommendations'] = recommendations

        return diagnosis

    @classmethod
    def check_site_routing(cls, name: str, domain: str, port: int) -> Dict:
        """Test the full routing chain for a site.

        Args:
            name: The site name
            domain: The domain to test
            port: The backend port

        Returns:
            Dict with routing test results
        """
        import urllib.request
        import urllib.error

        results = {
            'site_name': name,
            'domain': domain,
            'port': port,
            'tests': {}
        }

        # Test 1: Port accessibility
        from app.services.docker_service import DockerService
        results['tests']['port_accessible'] = DockerService.check_port_accessible(port)

        # Test 2: Direct backend request
        try:
            req = urllib.request.Request(f'http://127.0.0.1:{port}/', method='HEAD')
            req.add_header('User-Agent', 'ServerKit-Diagnostic/1.0')
            with urllib.request.urlopen(req, timeout=5) as response:
                results['tests']['backend_responds'] = {
                    'success': True,
                    'status_code': response.status
                }
        except urllib.error.HTTPError as e:
            results['tests']['backend_responds'] = {
                'success': True,  # HTTP error still means backend responded
                'status_code': e.code
            }
        except Exception as e:
            results['tests']['backend_responds'] = {
                'success': False,
                'error': str(e)
            }

        # Test 3: Config exists and enabled
        config = cls.get_site_config(name)
        results['tests']['config_status'] = {
            'exists': config.get('exists', False),
            'enabled': config.get('enabled', False)
        }

        return results

    # ==================== PRIVATE URL MANAGEMENT ====================

    @classmethod
    def update_private_url_config(cls, app, old_slug: str = None) -> Dict:
        """Update Nginx config for a private URL.

        This regenerates the entire private URLs config file since changes
        are infrequent and full regeneration is simpler.

        Args:
            app: The Application object with private_slug and port
            old_slug: Optional old slug being replaced (unused, kept for API compatibility)

        Returns:
            Dict with success status and message
        """
        return cls.regenerate_all_private_urls()

    @classmethod
    def remove_private_url_config(cls, slug: str) -> Dict:
        """Remove a private URL from Nginx config.

        This regenerates the entire private URLs config file.

        Args:
            slug: The slug being removed (unused, full regeneration happens)

        Returns:
            Dict with success status and message
        """
        return cls.regenerate_all_private_urls()

    @classmethod
    def regenerate_all_private_urls(cls) -> Dict:
        """Regenerate the entire private URLs config from database.

        Queries all applications with private URLs enabled and regenerates
        the Nginx configuration file with all location blocks.

        Returns:
            Dict with success status, message, and count of URLs configured
        """
        from datetime import datetime
        from app.models import Application

        try:
            # Query all apps with private URLs enabled. query_active(): a
            # tombstoned app's container is gone, so re-publishing its /p/<slug>
            # would proxy to a dead port.
            apps = Application.query_active().filter(
                Application.private_url_enabled == True,
                Application.private_slug.isnot(None),
                Application.port.isnot(None)
            ).all()

            # Generate location blocks
            locations = []
            for app in apps:
                location = cls.PRIVATE_URL_LOCATION_TEMPLATE.format(
                    slug=app.private_slug,
                    port=app.port
                )
                locations.append(location)

            # Generate full config (location-only snippet, included by serverkit.conf)
            cls._ensure_locations_dir()
            if locations:
                config = cls.PRIVATE_URL_MAIN_CONFIG.format(
                    timestamp=datetime.utcnow().isoformat(),
                    locations='\n'.join(locations)
                )
            else:
                # No private URLs - create minimal fallback
                config = f'''# ServerKit Private URL Routes
# This file is auto-generated. Do not edit manually.
# Generated at: {datetime.utcnow().isoformat()}
# No private URLs configured

location /p/ {{
    return 404;
}}
'''

            # Write location snippet to serverkit-locations dir
            config_path = os.path.join(cls.LOCATIONS_DIR, f'{cls.PRIVATE_URL_CONFIG_NAME}.conf')
            written = write_privileged_file(config_path, config)
            if not written['success']:
                return {'success': False, 'error': f"Failed to write config: {written['error']}"}

            # Clean up legacy separate server block if it exists
            cls._remove_legacy_site(cls.PRIVATE_URL_CONFIG_NAME)

            # Reload Nginx
            reload_result = cls.reload()
            if not reload_result['success']:
                return reload_result

            return {
                'success': True,
                'message': f'Private URL config regenerated with {len(apps)} URLs',
                'url_count': len(apps),
                'config_path': config_path
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_private_url_config(cls) -> Dict:
        """Get the current private URL configuration.

        Returns:
            Dict with exists, enabled, content, and URL count
        """
        return cls.get_location_config(cls.PRIVATE_URL_CONFIG_NAME)

    # ==================== GITEA CONFIGURATION ====================

    @classmethod
    def get_location_config(cls, name: str) -> Dict:
        """Get a location snippet config from the serverkit-locations directory.

        Args:
            name: Config name (without .conf extension)

        Returns:
            Dict with exists, enabled, content, and path
        """
        config_path = os.path.join(cls.LOCATIONS_DIR, f'{name}.conf')
        config = {
            'exists': os.path.isfile(config_path),
            'enabled': os.path.isfile(config_path),  # If it exists, it's included
            'content': None,
            'path': config_path
        }

        if config['exists']:
            try:
                with open(config_path, 'r') as f:
                    config['content'] = f.read()
            except Exception:
                pass

        return config

    @classmethod
    def _ensure_locations_dir(cls):
        """Ensure the serverkit-locations directory exists."""
        run_privileged(['mkdir', '-p', cls.LOCATIONS_DIR])

    @classmethod
    def create_gitea_config(cls, port: int) -> Dict:
        """Create Nginx location config for Gitea at /gitea path.

        The config is a location-only snippet included inside the main
        serverkit.conf server block, preventing server_name conflicts.

        Args:
            port: The internal port Gitea is running on

        Returns:
            Dict with success status and message
        """
        try:
            cls._ensure_locations_dir()
            config = cls.GITEA_LOCATION_TEMPLATE.format(port=port)
            config_path = os.path.join(cls.LOCATIONS_DIR, f'{cls.GITEA_CONFIG_NAME}.conf')

            # Write location snippet (no separate server block, no sites-enabled symlink)
            written = write_privileged_file(config_path, config)
            if not written['success']:
                return {'success': False, 'error': f"Failed to write config: {written['error']}"}

            # Clean up legacy separate server block if it exists
            cls._remove_legacy_site(cls.GITEA_CONFIG_NAME)

            # Reload Nginx
            reload_result = cls.reload()
            if not reload_result['success']:
                return reload_result

            return {
                'success': True,
                'message': 'Gitea nginx config created',
                'config_path': config_path,
                'url_path': '/gitea'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_gitea_config(cls) -> Dict:
        """Remove Nginx configuration for Gitea.

        Returns:
            Dict with success status and message
        """
        try:
            # Remove location snippet
            config_path = os.path.join(cls.LOCATIONS_DIR, f'{cls.GITEA_CONFIG_NAME}.conf')
            run_privileged(['rm', '-f', config_path])

            # Clean up legacy separate server block if it exists
            cls._remove_legacy_site(cls.GITEA_CONFIG_NAME)

            # Reload Nginx
            cls.reload()

            return {'success': True, 'message': 'Gitea nginx config removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_gitea_config(cls) -> Dict:
        """Get the current Gitea nginx configuration.

        Returns:
            Dict with exists, enabled, content, and path
        """
        return cls.get_location_config(cls.GITEA_CONFIG_NAME)

    # ==================== WORDPRESS CONFIGURATION ====================

    @classmethod
    def create_wordpress_config(cls, port: int) -> Dict:
        """Create Nginx location config for WordPress at /wordpress path.

        The config is a location-only snippet included inside the main
        serverkit.conf server block, preventing server_name conflicts.

        Args:
            port: The internal port WordPress is running on

        Returns:
            Dict with success status and message
        """
        try:
            cls._ensure_locations_dir()
            config = cls.WORDPRESS_LOCATION_TEMPLATE.format(port=port)
            config_path = os.path.join(cls.LOCATIONS_DIR, f'{cls.WORDPRESS_CONFIG_NAME}.conf')

            # Write location snippet (no separate server block, no sites-enabled symlink)
            written = write_privileged_file(config_path, config)
            if not written['success']:
                return {'success': False, 'error': f"Failed to write config: {written['error']}"}

            # Clean up legacy separate server block if it exists
            cls._remove_legacy_site(cls.WORDPRESS_CONFIG_NAME)

            # Reload Nginx
            reload_result = cls.reload()
            if not reload_result['success']:
                return reload_result

            return {
                'success': True,
                'message': 'WordPress nginx config created',
                'config_path': config_path,
                'url_path': '/wordpress'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_wordpress_config(cls) -> Dict:
        """Remove Nginx configuration for WordPress.

        Returns:
            Dict with success status and message
        """
        try:
            # Remove location snippet
            config_path = os.path.join(cls.LOCATIONS_DIR, f'{cls.WORDPRESS_CONFIG_NAME}.conf')
            run_privileged(['rm', '-f', config_path])

            # Clean up legacy separate server block if it exists
            cls._remove_legacy_site(cls.WORDPRESS_CONFIG_NAME)

            # Reload Nginx
            cls.reload()

            return {'success': True, 'message': 'WordPress nginx config removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _remove_legacy_site(cls, name: str):
        """Remove legacy separate server block configs from sites-available/enabled.

        Old versions wrote WordPress/Gitea as full server blocks in sites-available
        with symlinks in sites-enabled. This caused server_name conflicts.
        """
        run_privileged(['rm', '-f', os.path.join(cls.SITES_ENABLED, name)])
        run_privileged(['rm', '-f', os.path.join(cls.SITES_AVAILABLE, name)])

    @classmethod
    def get_wordpress_config(cls) -> Dict:
        """Get the current WordPress nginx configuration.

        Returns:
            Dict with exists, enabled, content, and path
        """
        return cls.get_location_config(cls.WORDPRESS_CONFIG_NAME)
