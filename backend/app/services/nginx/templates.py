"""Configuration text and defaults only; no environment or host access."""

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
    # the CSP is permissive (inline allowed, no eval) so it does not break managed apps while
    # still satisfying "a CSP is present" and blocking cross-origin framing.
    # Tighten the CSP per-app when the upstream can support a stricter policy.
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self' 'unsafe-inline' data: blob: https:; frame-ancestors 'self'; upgrade-insecure-requests" always;
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

# ==================== TIMED ACCESS LOG ====================
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

# ==================== COMPRESSION ====================
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

# ==================== IMMUTABLE ASSETS ====================
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
# line names that host. proxy_* and fastcgi_* caches cannot
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

# Page-cache behaviour:
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
