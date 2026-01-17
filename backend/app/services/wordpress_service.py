import os
import subprocess
import secrets
import string
import shutil
import json
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path


class WordPressService:
    """Service for WordPress installation and management."""

    WP_CLI_PATH = '/usr/local/bin/wp'
    WP_DOWNLOAD_URL = 'https://wordpress.org/latest.tar.gz'
    BACKUP_DIR = '/var/backups/serverkit/wordpress'

    # Security headers for wp-config.php
    SECURITY_CONSTANTS = '''
// ServerKit Security Hardening
define('DISALLOW_FILE_EDIT', true);
define('DISALLOW_FILE_MODS', false);
define('FORCE_SSL_ADMIN', true);
define('WP_AUTO_UPDATE_CORE', 'minor');

// Security Keys (auto-generated)
'''

    @classmethod
    def is_wp_cli_installed(cls) -> bool:
        """Check if WP-CLI is installed."""
        return os.path.exists(cls.WP_CLI_PATH)

    @classmethod
    def install_wp_cli(cls) -> Dict:
        """Install WP-CLI."""
        try:
            commands = [
                ['curl', '-O', 'https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar'],
                ['chmod', '+x', 'wp-cli.phar'],
                ['sudo', 'mv', 'wp-cli.phar', cls.WP_CLI_PATH]
            ]

            for cmd in commands:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}

            return {'success': True, 'message': 'WP-CLI installed successfully'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def wp_cli(cls, path: str, command: List[str], user: str = 'www-data') -> Dict:
        """Execute a WP-CLI command."""
        if not cls.is_wp_cli_installed():
            install_result = cls.install_wp_cli()
            if not install_result['success']:
                return install_result

        try:
            cmd = ['sudo', '-u', user, cls.WP_CLI_PATH, '--path=' + path] + command
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,
                cwd=path
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def install_wordpress(cls, path: str, config: Dict) -> Dict:
        """Install WordPress at the specified path."""
        site_url = config.get('site_url')
        site_title = config.get('site_title', 'My WordPress Site')
        admin_user = config.get('admin_user', 'admin')
        admin_password = config.get('admin_password') or cls._generate_password()
        admin_email = config.get('admin_email')
        db_name = config.get('db_name')
        db_user = config.get('db_user')
        db_password = config.get('db_password')
        db_host = config.get('db_host', 'localhost')
        db_prefix = config.get('db_prefix', 'wp_')

        if not all([site_url, admin_email, db_name, db_user, db_password]):
            return {'success': False, 'error': 'Missing required configuration'}

        try:
            # Create directory
            subprocess.run(['sudo', 'mkdir', '-p', path], capture_output=True)
            subprocess.run(['sudo', 'chown', 'www-data:www-data', path], capture_output=True)

            # Download WordPress
            download_result = cls.wp_cli(path, ['core', 'download', '--locale=en_US'])
            if not download_result['success']:
                return download_result

            # Create wp-config.php
            config_result = cls.wp_cli(path, [
                'config', 'create',
                f'--dbname={db_name}',
                f'--dbuser={db_user}',
                f'--dbpass={db_password}',
                f'--dbhost={db_host}',
                f'--dbprefix={db_prefix}'
            ])
            if not config_result['success']:
                return config_result

            # Install WordPress
            install_result = cls.wp_cli(path, [
                'core', 'install',
                f'--url={site_url}',
                f'--title={site_title}',
                f'--admin_user={admin_user}',
                f'--admin_password={admin_password}',
                f'--admin_email={admin_email}',
                '--skip-email'
            ])
            if not install_result['success']:
                return install_result

            # Set permissions
            cls._set_permissions(path)

            # Apply security hardening
            cls.harden_wordpress(path)

            return {
                'success': True,
                'message': 'WordPress installed successfully',
                'admin_user': admin_user,
                'admin_password': admin_password,
                'path': path,
                'url': site_url
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_wordpress_info(cls, path: str) -> Optional[Dict]:
        """Get WordPress installation info."""
        if not os.path.exists(os.path.join(path, 'wp-config.php')):
            return None

        info = {'path': path}

        # Get core version
        version_result = cls.wp_cli(path, ['core', 'version'])
        if version_result['success']:
            info['version'] = version_result['output'].strip()

        # Check for updates
        update_result = cls.wp_cli(path, ['core', 'check-update', '--format=json'])
        if update_result['success'] and update_result['output'].strip():
            try:
                updates = json.loads(update_result['output'])
                info['update_available'] = len(updates) > 0
                info['latest_version'] = updates[0]['version'] if updates else info.get('version')
            except:
                info['update_available'] = False

        # Get site URL
        url_result = cls.wp_cli(path, ['option', 'get', 'siteurl'])
        if url_result['success']:
            info['url'] = url_result['output'].strip()

        # Get site title
        title_result = cls.wp_cli(path, ['option', 'get', 'blogname'])
        if title_result['success']:
            info['title'] = title_result['output'].strip()

        # Get admin email
        email_result = cls.wp_cli(path, ['option', 'get', 'admin_email'])
        if email_result['success']:
            info['admin_email'] = email_result['output'].strip()

        return info

    @classmethod
    def update_wordpress(cls, path: str) -> Dict:
        """Update WordPress core."""
        result = cls.wp_cli(path, ['core', 'update'])
        if result['success']:
            # Update database if needed
            cls.wp_cli(path, ['core', 'update-db'])
            return {'success': True, 'message': 'WordPress updated successfully'}
        return result

    @classmethod
    def get_plugins(cls, path: str) -> List[Dict]:
        """Get list of installed plugins."""
        result = cls.wp_cli(path, ['plugin', 'list', '--format=json'])
        if result['success']:
            try:
                return json.loads(result['output'])
            except:
                return []
        return []

    @classmethod
    def install_plugin(cls, path: str, plugin: str, activate: bool = True) -> Dict:
        """Install a WordPress plugin."""
        cmd = ['plugin', 'install', plugin]
        if activate:
            cmd.append('--activate')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': f'Plugin {plugin} installed'}
        return result

    @classmethod
    def uninstall_plugin(cls, path: str, plugin: str) -> Dict:
        """Uninstall a WordPress plugin."""
        # Deactivate first
        cls.wp_cli(path, ['plugin', 'deactivate', plugin])

        result = cls.wp_cli(path, ['plugin', 'delete', plugin])
        if result['success']:
            return {'success': True, 'message': f'Plugin {plugin} uninstalled'}
        return result

    @classmethod
    def activate_plugin(cls, path: str, plugin: str) -> Dict:
        """Activate a plugin."""
        result = cls.wp_cli(path, ['plugin', 'activate', plugin])
        return result

    @classmethod
    def deactivate_plugin(cls, path: str, plugin: str) -> Dict:
        """Deactivate a plugin."""
        result = cls.wp_cli(path, ['plugin', 'deactivate', plugin])
        return result

    @classmethod
    def update_plugins(cls, path: str, plugins: List[str] = None) -> Dict:
        """Update plugins."""
        cmd = ['plugin', 'update']
        if plugins:
            cmd.extend(plugins)
        else:
            cmd.append('--all')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': 'Plugins updated'}
        return result

    @classmethod
    def get_themes(cls, path: str) -> List[Dict]:
        """Get list of installed themes."""
        result = cls.wp_cli(path, ['theme', 'list', '--format=json'])
        if result['success']:
            try:
                return json.loads(result['output'])
            except:
                return []
        return []

    @classmethod
    def install_theme(cls, path: str, theme: str, activate: bool = False) -> Dict:
        """Install a WordPress theme."""
        cmd = ['theme', 'install', theme]
        if activate:
            cmd.append('--activate')

        result = cls.wp_cli(path, cmd)
        if result['success']:
            return {'success': True, 'message': f'Theme {theme} installed'}
        return result

    @classmethod
    def activate_theme(cls, path: str, theme: str) -> Dict:
        """Activate a theme."""
        result = cls.wp_cli(path, ['theme', 'activate', theme])
        return result

    @classmethod
    def backup_wordpress(cls, path: str, include_db: bool = True) -> Dict:
        """Create a backup of WordPress installation."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        site_name = os.path.basename(path)
        backup_name = f'{site_name}_{timestamp}'
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        try:
            # Create backup directory
            subprocess.run(['sudo', 'mkdir', '-p', backup_path], capture_output=True)

            # Backup files
            files_backup = os.path.join(backup_path, 'files.tar.gz')
            subprocess.run(
                ['sudo', 'tar', '-czf', files_backup, '-C', os.path.dirname(path), os.path.basename(path)],
                capture_output=True,
                timeout=600
            )

            # Backup database
            if include_db:
                db_backup = os.path.join(backup_path, 'database.sql')
                result = cls.wp_cli(path, ['db', 'export', db_backup])
                if not result['success']:
                    return {'success': False, 'error': f'Database backup failed: {result.get("error")}'}

            # Get backup size
            try:
                size = sum(os.path.getsize(os.path.join(backup_path, f))
                          for f in os.listdir(backup_path)
                          if os.path.isfile(os.path.join(backup_path, f)))
            except:
                size = 0

            return {
                'success': True,
                'message': 'Backup created successfully',
                'backup_path': backup_path,
                'backup_name': backup_name,
                'size': size,
                'timestamp': timestamp
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_backups(cls, site_name: str = None) -> List[Dict]:
        """List available backups."""
        backups = []

        if not os.path.exists(cls.BACKUP_DIR):
            return backups

        try:
            for name in os.listdir(cls.BACKUP_DIR):
                backup_path = os.path.join(cls.BACKUP_DIR, name)
                if os.path.isdir(backup_path):
                    if site_name and not name.startswith(site_name):
                        continue

                    # Get backup info
                    files_backup = os.path.join(backup_path, 'files.tar.gz')
                    db_backup = os.path.join(backup_path, 'database.sql')

                    size = 0
                    for f in [files_backup, db_backup]:
                        if os.path.exists(f):
                            size += os.path.getsize(f)

                    # Parse timestamp from name
                    parts = name.rsplit('_', 2)
                    if len(parts) >= 3:
                        timestamp = f'{parts[-2]}_{parts[-1]}'
                    else:
                        timestamp = 'unknown'

                    backups.append({
                        'name': name,
                        'path': backup_path,
                        'has_files': os.path.exists(files_backup),
                        'has_database': os.path.exists(db_backup),
                        'size': size,
                        'timestamp': timestamp
                    })
        except:
            pass

        return sorted(backups, key=lambda x: x['timestamp'], reverse=True)

    @classmethod
    def restore_backup(cls, backup_name: str, target_path: str) -> Dict:
        """Restore a WordPress backup."""
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup not found'}

        try:
            files_backup = os.path.join(backup_path, 'files.tar.gz')
            db_backup = os.path.join(backup_path, 'database.sql')

            # Restore files
            if os.path.exists(files_backup):
                # Remove existing files
                if os.path.exists(target_path):
                    subprocess.run(['sudo', 'rm', '-rf', target_path], capture_output=True)

                # Extract backup
                subprocess.run(
                    ['sudo', 'tar', '-xzf', files_backup, '-C', os.path.dirname(target_path)],
                    capture_output=True,
                    timeout=600
                )

            # Restore database
            if os.path.exists(db_backup):
                result = cls.wp_cli(target_path, ['db', 'import', db_backup])
                if not result['success']:
                    return {'success': False, 'error': f'Database restore failed: {result.get("error")}'}

            # Fix permissions
            cls._set_permissions(target_path)

            return {'success': True, 'message': 'Backup restored successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_backup(cls, backup_name: str) -> Dict:
        """Delete a backup."""
        backup_path = os.path.join(cls.BACKUP_DIR, backup_name)

        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup not found'}

        try:
            subprocess.run(['sudo', 'rm', '-rf', backup_path], capture_output=True)
            return {'success': True, 'message': 'Backup deleted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def harden_wordpress(cls, path: str) -> Dict:
        """Apply security hardening to WordPress."""
        results = []

        try:
            # Disable file editing in admin
            cls.wp_cli(path, ['config', 'set', 'DISALLOW_FILE_EDIT', 'true', '--raw'])
            results.append('Disabled file editing')

            # Force SSL for admin
            cls.wp_cli(path, ['config', 'set', 'FORCE_SSL_ADMIN', 'true', '--raw'])
            results.append('Enabled SSL for admin')

            # Disable XML-RPC (common attack vector)
            cls.wp_cli(path, ['config', 'set', 'XMLRPC_REQUEST', 'false', '--raw'])
            results.append('Disabled XML-RPC')

            # Set secure file permissions
            cls._set_permissions(path)
            results.append('Set secure file permissions')

            # Create .htaccess security rules
            cls._create_htaccess_security(path)
            results.append('Added .htaccess security rules')

            # Regenerate security keys
            cls.wp_cli(path, ['config', 'shuffle-salts'])
            results.append('Regenerated security keys')

            return {'success': True, 'message': 'Security hardening applied', 'actions': results}

        except Exception as e:
            return {'success': False, 'error': str(e), 'partial_actions': results}

    @classmethod
    def _set_permissions(cls, path: str):
        """Set secure file permissions for WordPress."""
        try:
            # Set ownership
            subprocess.run(['sudo', 'chown', '-R', 'www-data:www-data', path], capture_output=True)

            # Set directory permissions
            subprocess.run(
                ['sudo', 'find', path, '-type', 'd', '-exec', 'chmod', '755', '{}', ';'],
                capture_output=True
            )

            # Set file permissions
            subprocess.run(
                ['sudo', 'find', path, '-type', 'f', '-exec', 'chmod', '644', '{}', ';'],
                capture_output=True
            )

            # Protect wp-config.php
            wp_config = os.path.join(path, 'wp-config.php')
            if os.path.exists(wp_config):
                subprocess.run(['sudo', 'chmod', '600', wp_config], capture_output=True)

        except:
            pass

    @classmethod
    def _create_htaccess_security(cls, path: str):
        """Create security rules in .htaccess."""
        htaccess_path = os.path.join(path, '.htaccess')

        security_rules = '''
# ServerKit Security Rules
# Protect wp-config.php
<files wp-config.php>
order allow,deny
deny from all
</files>

# Protect .htaccess
<files .htaccess>
order allow,deny
deny from all
</files>

# Disable directory browsing
Options -Indexes

# Block access to sensitive files
<FilesMatch "^(wp-config\\.php|\\.htaccess|readme\\.html|license\\.txt)$">
Order allow,deny
Deny from all
</FilesMatch>

# Block PHP execution in uploads
<IfModule mod_rewrite.c>
RewriteEngine On
RewriteRule ^wp-content/uploads/.*\\.php$ - [F]
</IfModule>
'''

        try:
            # Read existing htaccess
            existing = ''
            if os.path.exists(htaccess_path):
                with open(htaccess_path, 'r') as f:
                    existing = f.read()

            # Only add if not already present
            if '# ServerKit Security Rules' not in existing:
                new_content = security_rules + '\n' + existing
                subprocess.run(
                    ['sudo', 'tee', htaccess_path],
                    input=new_content,
                    capture_output=True,
                    text=True
                )
        except:
            pass

    @classmethod
    def search_replace(cls, path: str, search: str, replace: str, dry_run: bool = False) -> Dict:
        """Search and replace in WordPress database."""
        cmd = ['search-replace', search, replace, '--all-tables']

        if dry_run:
            cmd.append('--dry-run')

        result = cls.wp_cli(path, cmd)
        return result

    @classmethod
    def optimize_database(cls, path: str) -> Dict:
        """Optimize WordPress database."""
        result = cls.wp_cli(path, ['db', 'optimize'])
        return result

    @classmethod
    def flush_cache(cls, path: str) -> Dict:
        """Flush WordPress cache."""
        results = []

        # Flush rewrite rules
        cls.wp_cli(path, ['rewrite', 'flush'])
        results.append('Flushed rewrite rules')

        # Flush transients
        cls.wp_cli(path, ['transient', 'delete', '--all'])
        results.append('Deleted transients')

        # Flush object cache if available
        cache_result = cls.wp_cli(path, ['cache', 'flush'])
        if cache_result['success']:
            results.append('Flushed object cache')

        return {'success': True, 'message': 'Cache flushed', 'actions': results}

    @classmethod
    def create_user(cls, path: str, username: str, email: str, role: str = 'subscriber', password: str = None) -> Dict:
        """Create a new WordPress user."""
        if not password:
            password = cls._generate_password()

        result = cls.wp_cli(path, [
            'user', 'create', username, email,
            f'--role={role}',
            f'--user_pass={password}'
        ])

        if result['success']:
            return {
                'success': True,
                'message': f'User {username} created',
                'password': password
            }
        return result

    @classmethod
    def reset_password(cls, path: str, user: str, password: str = None) -> Dict:
        """Reset a user's password."""
        if not password:
            password = cls._generate_password()

        result = cls.wp_cli(path, ['user', 'update', user, f'--user_pass={password}'])

        if result['success']:
            return {'success': True, 'message': 'Password reset', 'password': password}
        return result

    @staticmethod
    def _generate_password(length: int = 16) -> str:
        """Generate a secure random password."""
        alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
        return ''.join(secrets.choice(alphabet) for _ in range(length))
