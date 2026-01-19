import os
import subprocess
import re
from typing import Dict, List, Optional
from pathlib import Path


class NginxService:
    """Service for Nginx configuration management."""

    # Default paths (can be overridden via environment)
    NGINX_CONF_DIR = os.environ.get('NGINX_CONF_DIR', '/etc/nginx')
    SITES_AVAILABLE = os.path.join(NGINX_CONF_DIR, 'sites-available')
    SITES_ENABLED = os.path.join(NGINX_CONF_DIR, 'sites-enabled')
    NGINX_BIN = os.environ.get('NGINX_BIN', '/usr/sbin/nginx')

    # Templates
    PHP_SITE_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};

    root {root_path};
    index index.php index.html index.htm;

    access_log /var/log/nginx/{name}.access.log;
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

    access_log /var/log/nginx/{name}.access.log;
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

    access_log /var/log/nginx/{name}.access.log;
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

    access_log /var/log/nginx/{name}.access.log;
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

    add_header Strict-Transport-Security "max-age=63072000" always;
'''

    SSL_REDIRECT_TEMPLATE = '''server {{
    listen 80;
    listen [::]:80;
    server_name {domains};
    return 301 https://$server_name$request_uri;
}}
'''

    @classmethod
    def test_config(cls) -> Dict:
        """Test Nginx configuration syntax."""
        try:
            result = subprocess.run(
                ['sudo', cls.NGINX_BIN, '-t'],
                capture_output=True,
                text=True,
                timeout=30
            )
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
            result = subprocess.run(
                ['sudo', 'systemctl', 'reload', 'nginx'],
                capture_output=True,
                text=True,
                timeout=30
            )
            return {
                'success': result.returncode == 0,
                'message': 'Nginx reloaded successfully' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart(cls) -> Dict:
        """Restart Nginx service."""
        try:
            result = subprocess.run(
                ['sudo', 'systemctl', 'restart', 'nginx'],
                capture_output=True,
                text=True,
                timeout=30
            )
            return {
                'success': result.returncode == 0,
                'message': 'Nginx restarted successfully' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_status(cls) -> Dict:
        """Get Nginx service status."""
        try:
            result = subprocess.run(
                ['sudo', 'systemctl', 'status', 'nginx'],
                capture_output=True,
                text=True,
                timeout=30
            )

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
    def create_site(cls, name: str, app_type: str, domains: List[str],
                    root_path: str, port: int = None, php_version: str = '8.2') -> Dict:
        """Create a new site configuration."""
        if not domains:
            return {'success': False, 'error': 'At least one domain is required'}

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
                return {'success': False, 'error': 'Port is required for Python apps'}
            config = cls.PYTHON_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                root_path=root_path,
                port=port
            )
        elif app_type == 'docker':
            if not port:
                return {'success': False, 'error': 'Port is required for Docker apps'}
            config = cls.DOCKER_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                port=port
            )
        elif app_type == 'static':
            config = cls.STATIC_SITE_TEMPLATE.format(
                name=name,
                domains=domains_str,
                root_path=root_path
            )
        else:
            return {'success': False, 'error': f'Unknown app type: {app_type}'}

        # Write config file
        config_path = os.path.join(cls.SITES_AVAILABLE, name)
        try:
            # Use sudo to write
            process = subprocess.run(
                ['sudo', 'tee', config_path],
                input=config,
                capture_output=True,
                text=True
            )
            if process.returncode != 0:
                return {'success': False, 'error': process.stderr}

            return {'success': True, 'message': f'Site {name} created', 'path': config_path}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def enable_site(cls, name: str) -> Dict:
        """Enable a site by creating symlink in sites-enabled."""
        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        enabled_path = os.path.join(cls.SITES_ENABLED, name)

        if not os.path.exists(available_path):
            return {'success': False, 'error': f'Site {name} not found in sites-available'}

        try:
            result = subprocess.run(
                ['sudo', 'ln', '-sf', available_path, enabled_path],
                capture_output=True,
                text=True
            )
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

        try:
            result = subprocess.run(
                ['sudo', 'rm', '-f', enabled_path],
                capture_output=True,
                text=True
            )
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
        # First disable it
        cls.disable_site(name)

        available_path = os.path.join(cls.SITES_AVAILABLE, name)
        try:
            result = subprocess.run(
                ['sudo', 'rm', '-f', available_path],
                capture_output=True,
                text=True
            )
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
            with open(config_path, 'r') as f:
                content = f.read()

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

            # Write updated config
            process = subprocess.run(
                ['sudo', 'tee', config_path],
                input=final_content,
                capture_output=True,
                text=True
            )

            if process.returncode == 0:
                return cls.reload()
            return {'success': False, 'error': process.stderr}

        except Exception as e:
            return {'success': False, 'error': str(e)}
