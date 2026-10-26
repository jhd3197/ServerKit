"""Pure vhost rendering. Inputs are values; output is text or a validation error."""
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

from . import templates
from .validation import _validate_domain, _validate_path


@dataclass(frozen=True)
class RenderSettings:
    """Template values, isolated from the service's filesystem/process methods."""
    DOCKER_SITE_TEMPLATE: str = templates.DOCKER_SITE_TEMPLATE
    IMMUTABLE_ASSET_HEADERS: str = templates.IMMUTABLE_ASSET_HEADERS
    IMMUTABLE_ASSET_PATTERN: str = templates.IMMUTABLE_ASSET_PATTERN
    MICROCACHE_FASTCGI_BLOCK: str = templates.MICROCACHE_FASTCGI_BLOCK
    MICROCACHE_PROXY_BLOCK: str = templates.MICROCACHE_PROXY_BLOCK
    MICROCACHE_SKIP_BLOCK: str = templates.MICROCACHE_SKIP_BLOCK
    MICROCACHE_TTL_DEFAULT: int = templates.MICROCACHE_TTL_DEFAULT
    MICROCACHE_TTL_MAX: int = templates.MICROCACHE_TTL_MAX
    PHP_SITE_TEMPLATE: str = templates.PHP_SITE_TEMPLATE
    PYTHON_SITE_TEMPLATE: str = templates.PYTHON_SITE_TEMPLATE
    REMOTE_UPSTREAM_TEMPLATE: str = templates.REMOTE_UPSTREAM_TEMPLATE
    SSL_BLOCK: str = templates.SSL_BLOCK
    SSL_REDIRECT_TEMPLATE: str = templates.SSL_REDIRECT_TEMPLATE
    STATIC_SITE_TEMPLATE: str = templates.STATIC_SITE_TEMPLATE
    WORDPRESS_PROTECTION_BLOCK: str = templates.WORDPRESS_PROTECTION_BLOCK


DEFAULT_SETTINGS = RenderSettings()


def render_site_config(name: str, app_type: str, domains: List[str],
                       root_path: str = None, port: int = None,
                       php_version: str = '8.2',
                       ssl_cert: str = None, ssl_key: str = None,
                       upstream: str = None,
                       micro_cache: bool = False,
                       micro_cache_ttl: Optional[int] = None,
                       immutable_assets: bool = False,
                       wordpress_protection: bool = False, *,
                       cert_groups: Optional[List[tuple]] = None,
                       settings: RenderSettings = DEFAULT_SETTINGS) -> Dict:
    """Render the vhost config for a site to a string — no side effects.

    This is the exact template pipeline :meth:`create_site` writes to disk;
    it is exposed separately so callers (e.g. drift detection) can compute
    the expected on-disk content without touching the filesystem.

    ``cert_groups`` — ``[(domains, cert, key), ...]`` — serves each group of
    domains from its own certificate (``cert=None`` for plain HTTP): one
    server set per group, since a server block has exactly one certificate.
    It replaces ``domains``/``ssl_cert``/``ssl_key``. Templates hold only
    ``server`` blocks, so concatenated groups are a valid file.
    Returns ``{'success': True, 'config': str}`` or
    ``{'success': False, 'error': msg}``.
    """
    if cert_groups:
        parts = []
        for group_domains, group_cert, group_key in cert_groups:
            rendered = render_site_config(
                name, app_type, list(group_domains), root_path, port, php_version,
                group_cert, group_key, upstream, micro_cache, micro_cache_ttl,
                immutable_assets, wordpress_protection, settings=settings)
            if not rendered.get('success'):
                return rendered
            parts.append(rendered['config'])
        return {'success': True, 'config': '\n'.join(parts)}

    if not domains:
        return {'success': False, 'error': 'At least one domain is required'}

    # Validate all domains
    for domain in domains:
        if domain == '_':
            return {'success': False, 'error': 'Wildcard server_name "_" is reserved for the ServerKit panel'}
        if not _validate_domain(domain):
            return {'success': False, 'error': f'Invalid domain name: {domain}'}

    # Validate root_path if provided
    if root_path and not _validate_path(root_path):
        return {'success': False, 'error': f'Invalid root path: {root_path}'}

    domains_str = ' '.join(domains)

    # Select template based on app type
    if app_type in ['php', 'wordpress']:
        config = settings.PHP_SITE_TEMPLATE.format(
            name=name,
            domains=domains_str,
            root_path=root_path,
            php_version=php_version
        )
    elif app_type in ['flask', 'django', 'python']:
        if not port:
            return {'success': False, 'error': 'Python services need a port'}
        config = settings.PYTHON_SITE_TEMPLATE.format(
            name=name,
            domains=domains_str,
            root_path=root_path,
            port=port
        )
    elif app_type == 'docker':
        if not port:
            return {'success': False, 'error': 'Docker services need a port'}
        config = settings.DOCKER_SITE_TEMPLATE.format(
            name=name,
            domains=domains_str,
            port=port
        )
    elif app_type == 'remote':
        if not upstream:
            return {'success': False, 'error': 'Services on remote servers need an upstream (host:port)'}
        config = settings.REMOTE_UPSTREAM_TEMPLATE.format(
            name=name,
            domains=domains_str,
            upstream=upstream,
        )
    elif app_type == 'static':
        config = settings.STATIC_SITE_TEMPLATE.format(
            name=name,
            domains=domains_str,
            root_path=root_path
        )
    else:
        return {'success': False, 'error': f'Unknown service type: {app_type}'}

    if immutable_assets:
        config = _with_immutable_assets(config, app_type, settings=settings)

    if micro_cache:
        # Inject before the SSL wrap so the redirect server block (which
        # also carries a server_name line) never receives cache directives.
        config = _with_micro_cache(config, app_type, micro_cache_ttl, settings=settings)

    if wordpress_protection:
        if app_type != 'docker' or not port:
            return {
                'success': False,
                'error': 'WordPress protection requires a Docker proxy port',
            }
        config = _with_wordpress_protection(config, port, settings=settings)

    if ssl_cert and ssl_key:
        config = _with_ssl(config, domains_str, ssl_cert, ssl_key, settings=settings)

    return {'success': True, 'config': config}


def _with_wordpress_protection(config: str, port: int, *,
                               settings: RenderSettings = DEFAULT_SETTINGS) -> str:
    """Add exact-match throttling locations before the catch-all proxy."""
    anchor = '    location / {\n'
    if anchor not in config:
        return config
    block = settings.WORDPRESS_PROTECTION_BLOCK.format(port=port)
    return config.replace(anchor, block + anchor, 1)


def _with_immutable_assets(config: str, app_type: str, *,
                           settings: RenderSettings = DEFAULT_SETTINGS) -> str:
    """Add a regex location for fingerprinted assets to a proxied vhost:
    the same proxying as ``location /`` plus a one-year immutable cache.
    Appended after ``location /`` (a matching regex location wins over the
    ``/`` prefix wherever it sits) so the micro-cache injection still
    anchors on the real ``location /``."""
    if (app_type or '').lower() not in ('flask', 'django', 'python', 'docker', 'remote'):
        return config
    match = re.search(r'^    location / \{\n(.*?)^    \}\n', config, re.MULTILINE | re.DOTALL)
    if not match:
        return config
    block = ('\n    # ServerKit: fingerprinted assets never change\n'
             f'    location ~* "{settings.IMMUTABLE_ASSET_PATTERN}" {{\n'
             + match.group(1) + settings.IMMUTABLE_ASSET_HEADERS + '    }\n')
    return config[:match.end()] + block + config[match.end():]


def _with_micro_cache(config: str, app_type: str,
                      ttl: Optional[int] = None, *,
                      settings: RenderSettings = DEFAULT_SETTINGS) -> str:
    """Inject the shared-zone micro-cache directives into a rendered vhost.

    fastcgi_cache for PHP-FPM-served sites, proxy_cache for reverse-proxied
    ones; static sites are a no-op (files already come straight off disk).
    Scheme-agnostic — nothing here depends on HTTP vs HTTPS. The referenced
    zones are declared once in conf.d by :meth:`ensure_cache_zone`.
    """
    t = (app_type or '').lower()
    ttl = clamp_micro_cache_ttl(ttl, settings=settings)
    if t in ('php', 'wordpress'):
        anchor = '        include fastcgi_params;\n'
        if anchor not in config:
            return config
        config = config.replace(
            anchor, anchor + settings.MICROCACHE_FASTCGI_BLOCK.format(ttl=ttl), 1)
    elif t in ('flask', 'django', 'python', 'docker', 'remote'):
        # proxy_cache_bypass may only be declared once per location, so
        # fold $sk_skip_cache into the template's existing $http_upgrade
        # bypass instead of adding a duplicate directive.
        anchor = '        proxy_cache_bypass $http_upgrade;\n'
        if anchor not in config:
            return config
        config = config.replace(
            anchor,
            '        proxy_cache_bypass $sk_skip_cache $http_upgrade;\n'
            + settings.MICROCACHE_PROXY_BLOCK.format(ttl=ttl),
            1,
        )
    else:
        return config

    # Server-level $sk_skip_cache logic, right after server_name.
    match = re.search(r'^(    server_name [^;]+;\n)', config, re.MULTILINE)
    if match:
        config = config.replace(
            match.group(1), match.group(1) + '\n' + settings.MICROCACHE_SKIP_BLOCK, 1)
    return config


def clamp_micro_cache_ttl(ttl, *, settings: RenderSettings = DEFAULT_SETTINGS) -> int:
    """A stored TTL as the seconds the vhost uses: unset → the 10s
    default, anything else clamped to 1..MICROCACHE_TTL_MAX."""
    if ttl in (None, ''):
        return settings.MICROCACHE_TTL_DEFAULT
    return max(1, min(int(ttl), settings.MICROCACHE_TTL_MAX))


def _with_ssl(http_config: str, domains: str, ssl_cert: str, ssl_key: str, *,
              settings: RenderSettings = DEFAULT_SETTINGS) -> str:
    """Turn an HTTP server block into HTTPS: swap the :80 listens for the TLS
    block (so the existing server serves 443) and prepend an HTTP->HTTPS
    redirect. Idempotent because create_site regenerates the whole file."""
    ssl_block = settings.SSL_BLOCK.format(ssl_cert=ssl_cert, ssl_key=ssl_key)
    https_config = http_config.replace(
        '    listen 80;\n    listen [::]:80;',
        ssl_block.strip('\n'),
        1,
    )
    redirect = settings.SSL_REDIRECT_TEMPLATE.format(domains=domains)
    return redirect + '\n' + https_config
