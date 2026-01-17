import os
import subprocess
import re
from typing import Dict, List, Optional
from pathlib import Path


class PHPService:
    """Service for PHP-FPM management."""

    SUPPORTED_VERSIONS = ['8.0', '8.1', '8.2', '8.3']
    PHP_FPM_CONF_DIR = '/etc/php/{version}/fpm/pool.d'
    PHP_CLI_CONF_DIR = '/etc/php/{version}/cli'
    PHP_FPM_SERVICE = 'php{version}-fpm'

    # Pool configuration template
    POOL_TEMPLATE = '''[{pool_name}]
user = {user}
group = {group}
listen = /run/php/php{version}-fpm-{pool_name}.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

pm = {pm_type}
pm.max_children = {max_children}
pm.start_servers = {start_servers}
pm.min_spare_servers = {min_spare}
pm.max_spare_servers = {max_spare}
pm.max_requests = {max_requests}

; Logging
php_admin_value[error_log] = /var/log/php/{pool_name}.error.log
php_admin_flag[log_errors] = on

; Security
php_admin_value[open_basedir] = {open_basedir}
php_admin_value[disable_functions] = {disable_functions}

; Performance
php_value[max_execution_time] = {max_execution_time}
php_value[max_input_time] = {max_input_time}
php_value[memory_limit] = {memory_limit}
php_value[post_max_size] = {post_max_size}
php_value[upload_max_filesize] = {upload_max_filesize}

; OPcache
php_value[opcache.enable] = {opcache_enable}
php_value[opcache.memory_consumption] = {opcache_memory}
php_value[opcache.max_accelerated_files] = {opcache_files}

; Environment
env[PATH] = /usr/local/bin:/usr/bin:/bin
env[TMP] = /tmp
env[TMPDIR] = /tmp
env[TEMP] = /tmp
'''

    @classmethod
    def get_installed_versions(cls) -> List[Dict]:
        """Get list of installed PHP versions."""
        versions = []

        for version in cls.SUPPORTED_VERSIONS:
            php_bin = f'/usr/bin/php{version}'
            fpm_bin = f'/usr/sbin/php-fpm{version}'

            if os.path.exists(php_bin):
                # Get detailed version
                try:
                    result = subprocess.run(
                        [php_bin, '-v'],
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    full_version = result.stdout.split('\n')[0] if result.returncode == 0 else version
                except:
                    full_version = version

                # Check if FPM is installed
                fpm_installed = os.path.exists(fpm_bin)

                # Check if FPM service is running
                fpm_running = False
                if fpm_installed:
                    try:
                        result = subprocess.run(
                            ['systemctl', 'is-active', f'php{version}-fpm'],
                            capture_output=True,
                            text=True
                        )
                        fpm_running = result.stdout.strip() == 'active'
                    except:
                        pass

                versions.append({
                    'version': version,
                    'full_version': full_version,
                    'cli_path': php_bin,
                    'fpm_installed': fpm_installed,
                    'fpm_running': fpm_running,
                    'fpm_service': f'php{version}-fpm'
                })

        return versions

    @classmethod
    def get_default_version(cls) -> Optional[str]:
        """Get the default PHP version."""
        try:
            result = subprocess.run(
                ['php', '-v'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                match = re.search(r'PHP (\d+\.\d+)', result.stdout)
                if match:
                    return match.group(1)
        except:
            pass
        return None

    @classmethod
    def set_default_version(cls, version: str) -> Dict:
        """Set the default PHP CLI version."""
        if version not in cls.SUPPORTED_VERSIONS:
            return {'success': False, 'error': f'Unsupported PHP version: {version}'}

        php_bin = f'/usr/bin/php{version}'
        if not os.path.exists(php_bin):
            return {'success': False, 'error': f'PHP {version} is not installed'}

        try:
            # Update alternatives
            result = subprocess.run(
                ['sudo', 'update-alternatives', '--set', 'php', php_bin],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                return {'success': True, 'message': f'Default PHP version set to {version}'}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def install_version(cls, version: str) -> Dict:
        """Install a PHP version."""
        if version not in cls.SUPPORTED_VERSIONS:
            return {'success': False, 'error': f'Unsupported PHP version: {version}'}

        try:
            # Add PHP repository if needed
            subprocess.run(
                ['sudo', 'add-apt-repository', '-y', 'ppa:ondrej/php'],
                capture_output=True,
                text=True,
                timeout=120
            )

            subprocess.run(
                ['sudo', 'apt-get', 'update'],
                capture_output=True,
                text=True,
                timeout=120
            )

            # Install PHP and common extensions
            packages = [
                f'php{version}-fpm',
                f'php{version}-cli',
                f'php{version}-common',
                f'php{version}-mysql',
                f'php{version}-xml',
                f'php{version}-xmlrpc',
                f'php{version}-curl',
                f'php{version}-gd',
                f'php{version}-imagick',
                f'php{version}-mbstring',
                f'php{version}-opcache',
                f'php{version}-soap',
                f'php{version}-zip',
                f'php{version}-intl',
                f'php{version}-bcmath',
            ]

            result = subprocess.run(
                ['sudo', 'apt-get', 'install', '-y'] + packages,
                capture_output=True,
                text=True,
                timeout=600
            )

            if result.returncode == 0:
                # Start FPM service
                subprocess.run(
                    ['sudo', 'systemctl', 'enable', f'php{version}-fpm'],
                    capture_output=True,
                    text=True
                )
                subprocess.run(
                    ['sudo', 'systemctl', 'start', f'php{version}-fpm'],
                    capture_output=True,
                    text=True
                )
                return {'success': True, 'message': f'PHP {version} installed successfully'}

            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_extensions(cls, version: str) -> List[Dict]:
        """Get installed PHP extensions for a version."""
        extensions = []
        php_bin = f'/usr/bin/php{version}'

        if not os.path.exists(php_bin):
            return extensions

        try:
            result = subprocess.run(
                [php_bin, '-m'],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                for ext in result.stdout.strip().split('\n'):
                    if ext and not ext.startswith('['):
                        extensions.append({
                            'name': ext,
                            'enabled': True
                        })
        except:
            pass

        return extensions

    @classmethod
    def install_extension(cls, version: str, extension: str) -> Dict:
        """Install a PHP extension."""
        package = f'php{version}-{extension}'

        try:
            result = subprocess.run(
                ['sudo', 'apt-get', 'install', '-y', package],
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode == 0:
                # Restart FPM to load extension
                cls.restart_fpm(version)
                return {'success': True, 'message': f'Extension {extension} installed'}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_pools(cls, version: str) -> List[Dict]:
        """Get FPM pools for a PHP version."""
        pools = []
        pool_dir = cls.PHP_FPM_CONF_DIR.format(version=version)

        if not os.path.exists(pool_dir):
            return pools

        try:
            for filename in os.listdir(pool_dir):
                if filename.endswith('.conf'):
                    pool_name = filename[:-5]  # Remove .conf
                    filepath = os.path.join(pool_dir, filename)
                    config = cls._parse_pool_config(filepath)
                    pools.append({
                        'name': pool_name,
                        'file': filepath,
                        'user': config.get('user', 'www-data'),
                        'listen': config.get('listen', ''),
                        'pm': config.get('pm', 'dynamic'),
                        'max_children': config.get('pm.max_children', '5')
                    })
        except Exception as e:
            pass

        return pools

    @classmethod
    def _parse_pool_config(cls, filepath: str) -> Dict:
        """Parse a pool configuration file."""
        config = {}
        try:
            with open(filepath, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith(';') and '=' in line:
                        key, value = line.split('=', 1)
                        config[key.strip()] = value.strip()
        except:
            pass
        return config

    @classmethod
    def create_pool(cls, version: str, pool_name: str, config: Dict = None) -> Dict:
        """Create a new FPM pool."""
        pool_dir = cls.PHP_FPM_CONF_DIR.format(version=version)
        pool_file = os.path.join(pool_dir, f'{pool_name}.conf')

        if os.path.exists(pool_file):
            return {'success': False, 'error': f'Pool {pool_name} already exists'}

        # Default configuration
        default_config = {
            'pool_name': pool_name,
            'version': version,
            'user': config.get('user', 'www-data'),
            'group': config.get('group', 'www-data'),
            'pm_type': config.get('pm_type', 'dynamic'),
            'max_children': config.get('max_children', 10),
            'start_servers': config.get('start_servers', 2),
            'min_spare': config.get('min_spare', 1),
            'max_spare': config.get('max_spare', 3),
            'max_requests': config.get('max_requests', 500),
            'open_basedir': config.get('open_basedir', '/var/www:/tmp:/usr/share'),
            'disable_functions': config.get('disable_functions', 'exec,passthru,shell_exec,system,proc_open,popen'),
            'max_execution_time': config.get('max_execution_time', 300),
            'max_input_time': config.get('max_input_time', 300),
            'memory_limit': config.get('memory_limit', '256M'),
            'post_max_size': config.get('post_max_size', '64M'),
            'upload_max_filesize': config.get('upload_max_filesize', '64M'),
            'opcache_enable': config.get('opcache_enable', 1),
            'opcache_memory': config.get('opcache_memory', 128),
            'opcache_files': config.get('opcache_files', 10000)
        }

        pool_content = cls.POOL_TEMPLATE.format(**default_config)

        try:
            # Ensure log directory exists
            subprocess.run(['sudo', 'mkdir', '-p', '/var/log/php'], capture_output=True)

            # Write pool config
            process = subprocess.run(
                ['sudo', 'tee', pool_file],
                input=pool_content,
                capture_output=True,
                text=True
            )

            if process.returncode == 0:
                # Restart FPM
                cls.restart_fpm(version)
                return {'success': True, 'message': f'Pool {pool_name} created', 'file': pool_file}

            return {'success': False, 'error': process.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_pool(cls, version: str, pool_name: str) -> Dict:
        """Delete an FPM pool."""
        pool_dir = cls.PHP_FPM_CONF_DIR.format(version=version)
        pool_file = os.path.join(pool_dir, f'{pool_name}.conf')

        if not os.path.exists(pool_file):
            return {'success': False, 'error': f'Pool {pool_name} not found'}

        # Don't delete default www pool
        if pool_name == 'www':
            return {'success': False, 'error': 'Cannot delete default www pool'}

        try:
            result = subprocess.run(
                ['sudo', 'rm', pool_file],
                capture_output=True,
                text=True
            )

            if result.returncode == 0:
                cls.restart_fpm(version)
                return {'success': True, 'message': f'Pool {pool_name} deleted'}

            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart_fpm(cls, version: str) -> Dict:
        """Restart PHP-FPM service."""
        service = cls.PHP_FPM_SERVICE.format(version=version)

        try:
            result = subprocess.run(
                ['sudo', 'systemctl', 'restart', service],
                capture_output=True,
                text=True,
                timeout=30
            )

            return {
                'success': result.returncode == 0,
                'message': f'{service} restarted' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload_fpm(cls, version: str) -> Dict:
        """Reload PHP-FPM service."""
        service = cls.PHP_FPM_SERVICE.format(version=version)

        try:
            result = subprocess.run(
                ['sudo', 'systemctl', 'reload', service],
                capture_output=True,
                text=True,
                timeout=30
            )

            return {
                'success': result.returncode == 0,
                'message': f'{service} reloaded' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_fpm_status(cls, version: str) -> Dict:
        """Get PHP-FPM service status."""
        service = cls.PHP_FPM_SERVICE.format(version=version)

        try:
            result = subprocess.run(
                ['systemctl', 'status', service],
                capture_output=True,
                text=True,
                timeout=10
            )

            is_running = 'active (running)' in result.stdout

            return {
                'version': version,
                'service': service,
                'running': is_running,
                'status': 'running' if is_running else 'stopped'
            }
        except Exception as e:
            return {'version': version, 'running': False, 'error': str(e)}

    @classmethod
    def get_php_info(cls, version: str) -> Dict:
        """Get PHP configuration info."""
        php_bin = f'/usr/bin/php{version}'

        if not os.path.exists(php_bin):
            return {'error': f'PHP {version} not found'}

        try:
            result = subprocess.run(
                [php_bin, '-i'],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                return {'error': result.stderr}

            # Parse key configuration values
            info = {}
            for line in result.stdout.split('\n'):
                if '=>' in line:
                    parts = line.split('=>')
                    if len(parts) >= 2:
                        key = parts[0].strip()
                        value = parts[1].strip()
                        if key in ['memory_limit', 'max_execution_time', 'upload_max_filesize',
                                   'post_max_size', 'max_input_time', 'date.timezone']:
                            info[key] = value

            return info
        except Exception as e:
            return {'error': str(e)}
