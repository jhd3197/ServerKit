import logging
import os
import subprocess
import re
from typing import Dict, List, Optional
from pathlib import Path

from app.utils.system import (ServiceControl, is_command_available,
                             run_privileged, write_privileged_file)

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


def _validate_domain(domain: str) -> bool:
    """Validate domain name to prevent nginx config injection."""
    return bool(re.match(r'^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?$', domain, re.IGNORECASE))


def _validate_path(path: str) -> bool:
    """Validate filesystem path for nginx config."""
    # Block path traversal and special characters
    if '..' in path or '\n' in path or '\r' in path or ';' in path:
        return False
    return bool(re.match(r'^/[a-zA-Z0-9/_\-\.]+$', path))


class NginxService:
    """Service for Nginx configuration management."""

    # Default paths (can be overridden via environment)
    NGINX_CONF_DIR = os.environ.get('NGINX_CONF_DIR', '/etc/nginx')
    SITES_AVAILABLE = os.path.join(NGINX_CONF_DIR, 'sites-available')
    SITES_ENABLED = os.path.join(NGINX_CONF_DIR, 'sites-enabled')
    NGINX_BIN = os.environ.get('NGINX_BIN', '/usr/sbin/nginx')
    LOCATIONS_DIR = os.path.join(NGINX_CONF_DIR, 'serverkit-locations')
    # Per-site log directory. Must stay in sync with the access_log/error_log
    # paths hard-coded in the site templates below. site_access_log_path() is the
    # single source of truth consumers should use (e.g. the fail2ban jail layer
    # watches this exact file), so the path can never drift from what nginx writes.
    LOG_DIR = '/var/log/nginx'

    # Templates
    PHP_SITE_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    root {root_path};
    index index.php index.html index.htm;

    access_log /var/log/nginx/{name}.access.log serverkit_timed;
    error_log /var/log/nginx/{name}.error.log;

    location / {{
        try_files $uri $uri/ /index.php?$query_string;
    }}

    location ~ \\.php$ {{
        fastcgi_pass unix:/run/php/php{php_version}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_intercept_errors on;
        fastcgi_buffer_size 16k;
        fastcgi_buffers 4 16k;
    }}

    location ~ /\\.ht {{
        deny all;
    }}

    location = /favicon.ico {{
        log_not_found off;
        access_log off;
    }}

    location = /robots.txt {{
        log_not_found off;
        access_log off;
        allow all;
    }}

    location ~* \\.(css|gif|ico|jpeg|jpg|js|png|svg|woff|woff2)$ {{
        expires 1y;
        log_not_found off;
    }}
}}
'''

    PYTHON_SITE_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    access_log /var/log/nginx/{name}.access.log serverkit_timed;
    error_log /var/log/nginx/{name}.error.log;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }}

    location /static {{
        alias {root_path}/static;
        expires 1y;
    }}
}}
'''

    STATIC_SITE_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    root {root_path};
    index index.html index.htm;

    access_log /var/log/nginx/{name}.access.log serverkit_timed;
    error_log /var/log/nginx/{name}.error.log;

    location / {{
        try_files $uri $uri/ =404;
    }}

    location ~* \\.(css|gif|ico|jpeg|jpg|js|png|svg|woff|woff2)$ {{
        expires 1y;
        log_not_found off;
    }}
}}
'''

    # Docker reverse proxy template (for containerized apps)
    DOCKER_SITE_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    access_log /var/log/nginx/{name}.access.log serverkit_timed;
    error_log /var/log/nginx/{name}.error.log;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
        proxy_connect_timeout 60;
        proxy_send_timeout 60;
    }}
}}
'''

    # WordPress authentication endpoints receive a dedicated request limit in
    # published reverse-proxy vhosts. The zones are shared across vhosts, while
    # the key includes server_name so traffic to one site cannot consume
    # another site's allowance.
    WORDPRESS_RATE_LIMIT_CONF_NAME = 'serverkit-wordpress-rate-limit.conf'
    WORDPRESS_RATE_LIMIT_ZONE_SNIPPET = '''# ServerKit WordPress request-limit zones (auto-generated; do not edit).
limit_req_zone $server_name$binary_remote_addr zone=serverkit_wp_login:10m rate=10r/m;
limit_req_zone $server_name$binary_remote_addr zone=serverkit_wp_xmlrpc:10m rate=30r/m;
'''

    WORDPRESS_PROTECTION_BLOCK = '''    # ServerKit WordPress brute-force protection
    location = /wp-login.php {{
        limit_req zone=serverkit_wp_login burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_connect_timeout 60;
        proxy_send_timeout 60;
    }}

    location = /xmlrpc.php {{
        limit_req zone=serverkit_wp_xmlrpc burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_connect_timeout 60;
        proxy_send_timeout 60;
    }}

'''

    # Reverse proxy to a service reached over a WireGuard tunnel (roadmap
    # #12). The upstream is a peer's WG IP:port; the private agent forwards
    # it to the real service. proxy_buffering off keeps media/streaming
    # (e.g. Jellyfin) responsive.
    REMOTE_UPSTREAM_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    access_log /var/log/nginx/{name}.access.log serverkit_timed;
    error_log /var/log/nginx/{name}.error.log;

    location / {{
        proxy_pass http://{upstream};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_connect_timeout 60;
        proxy_send_timeout 60;
    }}
}}
'''

    SSL_BLOCK = '''
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    ssl_certificate {ssl_cert};
    ssl_certificate_key {ssl_key};
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_ecdh_curve X25519:secp384r1;

    # HSTS: 2 years, all subdomains, preload-eligible. Submit the domain at
    # https://hstspreload.org to get onto the browser preload list (this is what
    # protects first-time visitors from an initial-request MITM downgrade).
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Baseline response-header hardening. These are safe for reverse-proxied apps;
    # the CSP is deliberately permissive so it does not break managed apps while
    # still satisfying "a CSP is present" and blocking cross-origin framing.
    # Tighten the CSP per-app when the upstream can support a stricter policy.
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'; upgrade-insecure-requests" always;
'''

    SSL_REDIRECT_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};
    return 301 https://$server_name$request_uri;
}}
'''

    # Private URL routing templates
    PRIVATE_URL_CONFIG_NAME = 'serverkit-private-urls'
    GITEA_CONFIG_NAME = 'serverkit-gitea'
    WORDPRESS_CONFIG_NAME = 'serverkit-wordpress'

    # Gitea location block for /gitea path (included inside main server block)
    GITEA_LOCATION_TEMPLATE = '''# Gitea at /gitea path
location /gitea/ {{
    proxy_pass http://127.0.0.1:{port}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400;
    proxy_connect_timeout 60;
    proxy_send_timeout 60;

    # Required for Gitea WebSocket connections
    proxy_buffering off;
    client_max_body_size 100M;
}}

# Handle /gitea without trailing slash
location = /gitea {{
    return 301 /gitea/;
}}
'''

    # WordPress location block for /wordpress path (included inside main server block)
    WORDPRESS_LOCATION_TEMPLATE = '''# WordPress at /wordpress path
location /wordpress/ {{
    proxy_pass http://127.0.0.1:{port}/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 300;
    proxy_connect_timeout 60;
    proxy_send_timeout 60;

    # WordPress file uploads
    client_max_body_size 256M;
}}

# Handle /wordpress without trailing slash
location = /wordpress {{
    return 301 /wordpress/;
}}
'''

    PRIVATE_URL_LOCATION_TEMPLATE = '''    # Private URL: /p/{slug}
    location /p/{slug}/ {{
        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Private-URL {slug};
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }}

    # Also handle without trailing slash
    location = /p/{slug} {{
        return 301 /p/{slug}/;
    }}
'''

    # ==================== TIMED ACCESS LOG (plan 86 §A1) ====================
    # Every vhost ServerKit writes logs in this format. The combined fields come
    # first, unchanged, so every existing combined-format reader (bandwidth
    # accounting, the fail2ban `^<HOST> -` filters) keeps matching; the timing
    # fields are appended after them. The app id is the log file itself
    # (/var/log/nginx/<app>.access.log) — a per-vhost `set` variable would make
    # `nginx -t` warn on every server block that never sets it.
    TIMED_LOG_FORMAT = 'serverkit_timed'
    TIMED_LOG_CONF_NAME = 'serverkit-log-format.conf'
    TIMED_LOG_FORMAT_SNIPPET = """# ServerKit timed access-log format (auto-generated; do not edit).
# Combined fields first (compatible with combined parsers), then timing.
log_format serverkit_timed '$remote_addr - $remote_user [$time_local] "$request" '
                           '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                           'rt=$request_time urt="$upstream_response_time" '
                           'cs=$upstream_cache_status h=$host';
"""

    # ==================== COMPRESSION (plan 86 §B1) ====================
    # gzip (and brotli when the module is loaded) for every site, as one
    # http-level conf.d snippet. Stock configs already set some of these —
    # Debian's nginx.conf ships `gzip on;` — and a repeated http-level
    # directive is fatal to `nginx -t`, so the snippet only carries the
    # directives the running config does not already set (read from `nginx -T`).
    COMPRESSION_CONF_NAME = 'serverkit-compression.conf'
    # text/html is always compressed by nginx; listing it again only warns.
    COMPRESSION_TYPES = (
        'text/plain text/css text/xml text/javascript application/javascript '
        'application/json application/xml application/rss+xml '
        'application/atom+xml image/svg+xml application/wasm '
        'font/ttf font/otf application/vnd.ms-fontobject'
    )
    GZIP_DIRECTIVES = (
        ('gzip', 'on'),
        ('gzip_vary', 'on'),
        ('gzip_proxied', 'any'),
        ('gzip_comp_level', '5'),
        ('gzip_min_length', '1024'),
        ('gzip_types', COMPRESSION_TYPES),
    )
    BROTLI_DIRECTIVES = (
        ('brotli', 'on'),
        ('brotli_comp_level', '5'),
        ('brotli_min_length', '1024'),
        ('brotli_types', COMPRESSION_TYPES),
    )

    # ==================== IMMUTABLE ASSETS (plan 86 §B2) ====================
    # Opt-in, proxied sites only: a fingerprinted asset (a hash in its name)
    # never changes, so the browser may keep it a year. Off by default because
    # the panel cannot know an app's asset layout. The hash must be 8+ chars
    # after a '.' or '-' AND contain a digit, so `app-settings.js` is never
    # pinned; a hash with no digit is simply not long-cached (the safe miss).
    IMMUTABLE_ASSET_PATTERN = (
        r'[.-](?=[A-Za-z0-9_]*[0-9])[A-Za-z0-9_]{8,}'
        r'\.(?:js|mjs|css|map|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$'
    )
    # One Cache-Control header: `expires` would emit its own max-age header
    # next to this one, and clients read either.
    IMMUTABLE_ASSET_HEADERS = '''        add_header Cache-Control "public, max-age=31536000, immutable";
'''

    # ==================== MICRO-CACHE (task #21) ====================
    # Opt-in per-site micro-cache: a very short (10s) full-page cache in front
    # of proxied/PHP sites, with hard bypasses for anything personalized.
    #
    # Design tradeoff — ONE shared zone/path for every opted-in site: nginx
    # cache zones must be declared statically in the http context, so a zone
    # per site does not scale (and can't be added/removed without touching a
    # global file per site). Purge is still per site: the cache key carries
    # $host, and purge_micro_cache(hosts) deletes only the files whose KEY
    # line names that host (plan 86 §B3). proxy_* and fastcgi_* caches cannot
    # share a keys_zone, hence two zones over one base directory.
    MICROCACHE_CONF_NAME = 'serverkit-microcache.conf'
    MICROCACHE_DIR = '/var/cache/nginx/serverkit-microcache'

    MICROCACHE_ZONE_SNIPPET = '''# ServerKit micro-cache zones (auto-generated; do not edit).
# One shared zone pair serves every site with micro-cache enabled — nginx
# requires cache zones to be declared statically in the http context, so
# per-site zones are not practical. Each site sets its own TTL; a purge
# removes only that site's entries (the cache key carries the host).
proxy_cache_path /var/cache/nginx/serverkit-microcache/proxy levels=1:2 keys_zone=serverkit_microcache:10m max_size=256m inactive=10m use_temp_path=off;
fastcgi_cache_path /var/cache/nginx/serverkit-microcache/fastcgi levels=1:2 keys_zone=serverkit_microcache_php:10m max_size=256m inactive=10m use_temp_path=off;
'''

    # Server-level bypass logic, shared by the proxy and fastcgi variants.
    # Cached responses are never stored/served for: non-GET/HEAD requests,
    # requests with a query string (safer default), session/auth/cart cookies,
    # or admin/login/cart paths.
    MICROCACHE_SKIP_BLOCK = '''    # ServerKit micro-cache bypass (never cache personalized responses)
    set $sk_skip_cache 0;
    if ($request_method !~ ^(GET|HEAD)$) { set $sk_skip_cache 1; }
    if ($query_string != "") { set $sk_skip_cache 1; }
    if ($http_cookie ~* "wordpress_logged_in_|wp-postpass|woocommerce_cart_hash|woocommerce_items_in_cart|comment_author|PHPSESSID|session|auth") { set $sk_skip_cache 1; }
    if ($request_uri ~* "^/(wp-admin|wp-login|admin|login|cart|checkout|my-account)") { set $sk_skip_cache 1; }
'''

    # Page-cache behaviour (plan 86 §B3):
    #   * the key is `$scheme://$host$request_uri`, so the cache files of one
    #     site can be found by host and purged alone (the proxy default key is
    #     `$scheme$proxy_host$request_uri` — the upstream port, not the site);
    #   * a failing or slow upstream serves the last good copy (use_stale), an
    #     expired entry is refreshed in the background while the stale copy is
    #     served, and cache_lock sends one request upstream per missing entry
    #     instead of a stampede. The zone's inactive=10m bounds how long a stale
    #     copy survives, so the TTL is capped well below it.
    MICROCACHE_TTL_DEFAULT = 10
    MICROCACHE_TTL_MAX = 300

    MICROCACHE_PROXY_BLOCK = '''        proxy_cache serverkit_microcache;
        proxy_cache_key $scheme://$host$request_uri;
        proxy_cache_valid 200 301 {ttl}s;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503;
        proxy_cache_background_update on;
        proxy_cache_lock on;
        proxy_no_cache $sk_skip_cache;
        add_header X-SK-Cache $upstream_cache_status;
'''

    MICROCACHE_FASTCGI_BLOCK = '''        fastcgi_cache serverkit_microcache_php;
        fastcgi_cache_key $scheme://$host$request_uri;
        fastcgi_cache_valid 200 301 {ttl}s;
        fastcgi_cache_use_stale error timeout updating http_500 http_503;
        fastcgi_cache_background_update on;
        fastcgi_cache_lock on;
        fastcgi_cache_bypass $sk_skip_cache;
        fastcgi_no_cache $sk_skip_cache;
        add_header X-SK-Cache $upstream_cache_status;
'''

    PRIVATE_URL_MAIN_CONFIG = '''# ServerKit Private URL Routes
# This file is auto-generated. Do not edit manually.
# Generated at: {timestamp}

{locations}

# Fallback for unknown slugs under /p/
location /p/ {{
    return 404;
}}
'''

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
                           wordpress_protection: bool = False) -> Dict:
        """Render the vhost config for a site to a string — no side effects.

        This is the exact template pipeline :meth:`create_site` writes to disk;
        it is exposed separately so callers (e.g. drift detection) can compute
        the expected on-disk content without touching the filesystem.
        Returns ``{'success': True, 'config': str}`` or
        ``{'success': False, 'error': msg}``.
        """
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
            config = cls.PHP_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                root_path=root_path,
                php_version=php_version
            )
        elif app_type in ['flask', 'django', 'python']:
            if not port:
                return {'success': False, 'error': 'Python services need a port'}
            config = cls.PYTHON_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                root_path=root_path,
                port=port
            )
        elif app_type == 'docker':
            if not port:
                return {'success': False, 'error': 'Docker services need a port'}
            config = cls.DOCKER_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                port=port
            )
        elif app_type == 'remote':
            if not upstream:
                return {'success': False, 'error': 'Services on remote servers need an upstream (host:port)'}
            config = cls.REMOTE_UPSTREAM_TEMPLATE.format(
                name=name,
                domains=domains_str,
                upstream=upstream,
            )
        elif app_type == 'static':
            config = cls.STATIC_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                root_path=root_path
            )
        else:
            return {'success': False, 'error': f'Unknown service type: {app_type}'}

        if immutable_assets:
            config = cls._with_immutable_assets(config, app_type)

        if micro_cache:
            # Inject before the SSL wrap so the redirect server block (which
            # also carries a server_name line) never receives cache directives.
            config = cls._with_micro_cache(config, app_type, micro_cache_ttl)

        if wordpress_protection:
            if app_type != 'docker' or not port:
                return {
                    'success': False,
                    'error': 'WordPress protection requires a Docker proxy port',
                }
            config = cls._with_wordpress_protection(config, port)

        if ssl_cert and ssl_key:
            config = cls._with_ssl(config, domains_str, ssl_cert, ssl_key)

        return {'success': True, 'config': config}

    @classmethod
    def _with_wordpress_protection(cls, config: str, port: int) -> str:
        """Add exact-match throttling locations before the catch-all proxy."""
        anchor = '    location / {\n'
        if anchor not in config:
            return config
        block = cls.WORDPRESS_PROTECTION_BLOCK.format(port=port)
        return config.replace(anchor, block + anchor, 1)

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
        block = ('\n    # ServerKit: fingerprinted assets never change (plan 86 §B2)\n'
                 f'    location ~* "{cls.IMMUTABLE_ASSET_PATTERN}" {{\n'
                 + match.group(1) + cls.IMMUTABLE_ASSET_HEADERS + '    }\n')
        return config[:match.end()] + block + config[match.end():]

    @classmethod
    def _with_micro_cache(cls, config: str, app_type: str,
                          ttl: Optional[int] = None) -> str:
        """Inject the shared-zone micro-cache directives into a rendered vhost.

        fastcgi_cache for PHP-FPM-served sites, proxy_cache for reverse-proxied
        ones; static sites are a no-op (files already come straight off disk).
        Scheme-agnostic — nothing here depends on HTTP vs HTTPS. The referenced
        zones are declared once in conf.d by :meth:`ensure_cache_zone`.
        """
        t = (app_type or '').lower()
        ttl = cls.clamp_micro_cache_ttl(ttl)
        if t in ('php', 'wordpress'):
            anchor = '        include fastcgi_params;\n'
            if anchor not in config:
                return config
            config = config.replace(
                anchor, anchor + cls.MICROCACHE_FASTCGI_BLOCK.format(ttl=ttl), 1)
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
                + cls.MICROCACHE_PROXY_BLOCK.format(ttl=ttl),
                1,
            )
        else:
            return config

        # Server-level $sk_skip_cache logic, right after server_name.
        match = re.search(r'^(    server_name [^;]+;\n)', config, re.MULTILINE)
        if match:
            config = config.replace(
                match.group(1), match.group(1) + '\n' + cls.MICROCACHE_SKIP_BLOCK, 1)
        return config

    @classmethod
    def clamp_micro_cache_ttl(cls, ttl) -> int:
        """A stored TTL as the seconds the vhost uses: unset → the 10s
        default, anything else clamped to 1..MICROCACHE_TTL_MAX."""
        if ttl in (None, ''):
            return cls.MICROCACHE_TTL_DEFAULT
        return max(1, min(int(ttl), cls.MICROCACHE_TTL_MAX))

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
        """Directive names set at http level in an ``nginx -T`` dump.

        ``nginx -T`` prints each file after a ``# configuration file <path>:``
        header. In the main nginx.conf, http level is depth 1 inside
        ``http {}``; every other file is included from the http block (conf.d)
        or a server (sites), so its depth-0 directives are the http-level
        ones. ``skip_file`` (our own snippet) is ignored so a rewrite never
        mistakes its own lines for someone else's.
        """
        found = set()
        current = None
        depth = 0
        in_http = False
        for raw in dump.splitlines():
            header = re.match(r'^# configuration file (.+):$', raw.strip())
            if header:
                current = header.group(1)
                depth = 0
                in_http = False
                continue
            if current is None or current == skip_file:
                continue
            line = raw.split('#', 1)[0].strip()
            if not line:
                continue
            is_main = current.endswith('/nginx.conf')
            http_level = (depth == 1 and in_http) if is_main else depth == 0
            name = line.split(None, 1)[0].rstrip(';{')
            if http_level and line.endswith(';'):
                found.add(name)
            if is_main and depth == 0 and name == 'http' and '{' in line:
                in_http = True
            depth += line.count('{') - line.count('}')
            if is_main and depth == 0:
                in_http = False
        return found

    @classmethod
    def render_compression_snippet(cls, dump: str, conf_path: str,
                                   nginx_v: str = '') -> str:
        """The snippet for this box. When the running config already sets
        everything it is comments only: still written, so the "already
        handled" check stays a file-exists test instead of an ``nginx -T``
        on every vhost write."""
        present = cls._http_level_directives(dump, conf_path)
        brotli = ('ngx_http_brotli_filter_module' in dump
                  or 'brotli' in (nginx_v or '').lower())
        wanted = list(cls.GZIP_DIRECTIVES)
        if brotli:
            wanted += list(cls.BROTLI_DIRECTIVES)
        lines = [f'{name} {value};' for name, value in wanted if name not in present]
        kept = sorted(name for name, _ in wanted if name in present)
        header = ['# ServerKit compression (auto-generated; do not edit).']
        if kept:
            header.append('# Already set elsewhere, left alone: ' + ', '.join(kept))
        return '\n'.join(header + lines) + '\n'

    @classmethod
    def ensure_compression(cls) -> Dict:
        """Write the compression snippet once, best-effort (plan 86 §B1).

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

        With ``hosts`` only that site's entries go (plan 86 §B3). nginx writes
        each entry's key as a ``KEY: <scheme>://<host><uri>`` header line in
        the cache file, so a fixed-string grep for ``KEY: http[s]://<host>/``
        finds exactly this site's files; the trailing ``/`` keeps
        ``shop.example.com`` from matching ``shop.example.com.evil``. Entries
        cached under the pre-§B3 key (before the vhost was rewritten) aren't
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
                    wordpress_protection: bool = False) -> Dict:
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
            wordpress_protection=wordpress_protection,
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
        """Turn an HTTP server block into HTTPS: swap the :80 listens for the TLS
        block (so the existing server serves 443) and prepend an HTTP->HTTPS
        redirect. Idempotent because create_site regenerates the whole file."""
        ssl_block = cls.SSL_BLOCK.format(ssl_cert=ssl_cert, ssl_key=ssl_key)
        https_config = http_config.replace(
            '    listen 80;\n    listen [::]:80;',
            ssl_block.strip('\n'),
            1,
        )
        redirect = cls.SSL_REDIRECT_TEMPLATE.format(domains=domains)
        return redirect + '\n' + https_config

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

        ``None`` means "could not determine", never "empty file" (§A). Callers
        that need to distinguish a missing vhost from an unreadable one check
        ``os.path.exists`` themselves.
        """
        try:
            result = run_privileged(['cat', os.path.join(cls.SITES_AVAILABLE, name)])
        except Exception:  # noqa: BLE001 - no cat, no permission, timeout
            return None
        return result.stdout if result.returncode == 0 else None

    @classmethod
    def write_vhost(cls, name: str, content: str, *, enable: bool = True) -> Dict:
        """Write, enable, config-test, roll back on failure, reload. One door (§G4).

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
        # `name` becomes a filesystem path below — refuse anything that is not
        # a plain filename so a caller-controlled name cannot traverse out of
        # sites-available (preview_diff applies the same rule for reads).
        if (not name or os.path.basename(name) != name
                or name in ('.', '..') or '\x00' in name):
            return {'success': False, 'error': f'Invalid site name: {name!r}'}

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
