"""FTP server management service for vsftpd and proftpd."""

import os
import subprocess
import re
import pwd
import crypt
import secrets
from typing import Dict, List, Optional
from datetime import datetime


class FTPService:
    """Service for managing FTP servers (vsftpd, proftpd)."""

    # Configuration file locations
    VSFTPD_CONF = '/etc/vsftpd.conf'
    VSFTPD_USER_LIST = '/etc/vsftpd.userlist'
    PROFTPD_CONF = '/etc/proftpd/proftpd.conf'

    # FTP user home base directory
    FTP_HOME_BASE = '/home/ftp'

    @classmethod
    def get_status(cls) -> Dict:
        """Get FTP server status and information."""
        vsftpd = cls._check_service('vsftpd')
        proftpd = cls._check_service('proftpd')

        # Determine which server is installed/active
        active_server = None
        if vsftpd['installed'] and vsftpd['running']:
            active_server = 'vsftpd'
        elif proftpd['installed'] and proftpd['running']:
            active_server = 'proftpd'
        elif vsftpd['installed']:
            active_server = 'vsftpd'
        elif proftpd['installed']:
            active_server = 'proftpd'

        return {
            'vsftpd': vsftpd,
            'proftpd': proftpd,
            'active_server': active_server,
            'any_installed': vsftpd['installed'] or proftpd['installed'],
            'any_running': vsftpd['running'] or proftpd['running']
        }

    @classmethod
    def _check_service(cls, service: str) -> Dict:
        """Check if a service is installed and running."""
        installed = False
        running = False
        enabled = False
        version = None

        try:
            # Check if installed
            result = subprocess.run(
                ['which', service if service != 'proftpd' else 'proftpd'],
                capture_output=True, text=True
            )
            installed = result.returncode == 0

            if not installed:
                # Try checking if package is installed
                result = subprocess.run(
                    ['dpkg', '-l', service],
                    capture_output=True, text=True
                )
                installed = 'ii' in result.stdout

            if installed:
                # Check if running
                result = subprocess.run(
                    ['systemctl', 'is-active', service],
                    capture_output=True, text=True
                )
                running = result.stdout.strip() == 'active'

                # Check if enabled
                result = subprocess.run(
                    ['systemctl', 'is-enabled', service],
                    capture_output=True, text=True
                )
                enabled = result.stdout.strip() == 'enabled'

                # Get version
                if service == 'vsftpd':
                    result = subprocess.run(
                        ['vsftpd', '-v'],
                        capture_output=True, text=True, stderr=subprocess.STDOUT
                    )
                    version_match = re.search(r'version (\d+\.\d+\.\d+)', result.stdout)
                    if version_match:
                        version = version_match.group(1)
                elif service == 'proftpd':
                    result = subprocess.run(
                        ['proftpd', '-v'],
                        capture_output=True, text=True
                    )
                    version_match = re.search(r'ProFTPD Version (\d+\.\d+\.\d+)', result.stdout)
                    if version_match:
                        version = version_match.group(1)

        except (subprocess.SubprocessError, FileNotFoundError):
            pass

        return {
            'installed': installed,
            'running': running,
            'enabled': enabled,
            'version': version
        }

    @classmethod
    def control_service(cls, service: str, action: str) -> Dict:
        """Control FTP service (start, stop, restart, enable, disable)."""
        if service not in ['vsftpd', 'proftpd']:
            return {'success': False, 'error': 'Invalid service name'}

        if action not in ['start', 'stop', 'restart', 'enable', 'disable']:
            return {'success': False, 'error': 'Invalid action'}

        try:
            result = subprocess.run(
                ['sudo', 'systemctl', action, service],
                capture_output=True, text=True, timeout=30
            )

            if result.returncode == 0:
                return {'success': True, 'service': service, 'action': action}
            else:
                return {'success': False, 'error': result.stderr or 'Operation failed'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Operation timed out'}
        except subprocess.SubprocessError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_config(cls, service: str = None) -> Dict:
        """Get FTP server configuration."""
        if service is None:
            status = cls.get_status()
            service = status['active_server']

        if service == 'vsftpd':
            return cls._get_vsftpd_config()
        elif service == 'proftpd':
            return cls._get_proftpd_config()
        else:
            return {'success': False, 'error': 'No FTP server found'}

    @classmethod
    def _get_vsftpd_config(cls) -> Dict:
        """Parse vsftpd configuration."""
        if not os.path.exists(cls.VSFTPD_CONF):
            return {'success': False, 'error': 'vsftpd.conf not found'}

        try:
            config = {}
            with open(cls.VSFTPD_CONF, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        if '=' in line:
                            key, value = line.split('=', 1)
                            config[key.strip()] = value.strip()

            return {
                'success': True,
                'service': 'vsftpd',
                'config_file': cls.VSFTPD_CONF,
                'config': config,
                'settings': {
                    'anonymous_enable': config.get('anonymous_enable', 'NO') == 'YES',
                    'local_enable': config.get('local_enable', 'NO') == 'YES',
                    'write_enable': config.get('write_enable', 'NO') == 'YES',
                    'chroot_local_user': config.get('chroot_local_user', 'NO') == 'YES',
                    'ssl_enable': config.get('ssl_enable', 'NO') == 'YES',
                    'pasv_enable': config.get('pasv_enable', 'YES') == 'YES',
                    'listen_port': int(config.get('listen_port', 21)),
                    'max_clients': int(config.get('max_clients', 0)),
                    'max_per_ip': int(config.get('max_per_ip', 0)),
                    'local_umask': config.get('local_umask', '022'),
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _get_proftpd_config(cls) -> Dict:
        """Parse proftpd configuration."""
        if not os.path.exists(cls.PROFTPD_CONF):
            return {'success': False, 'error': 'proftpd.conf not found'}

        try:
            config = {}
            with open(cls.PROFTPD_CONF, 'r') as f:
                content = f.read()

            # Parse basic directives
            directives = [
                'ServerName', 'ServerType', 'Port', 'MaxClients',
                'MaxClientsPerHost', 'DefaultRoot', 'RequireValidShell'
            ]
            for directive in directives:
                match = re.search(rf'^{directive}\s+(.+)$', content, re.MULTILINE)
                if match:
                    config[directive] = match.group(1).strip().strip('"')

            return {
                'success': True,
                'service': 'proftpd',
                'config_file': cls.PROFTPD_CONF,
                'config': config,
                'settings': {
                    'server_name': config.get('ServerName', 'ProFTPD'),
                    'port': int(config.get('Port', 21)),
                    'max_clients': int(config.get('MaxClients', 0)) if config.get('MaxClients') else 0,
                    'max_per_ip': int(config.get('MaxClientsPerHost', 0)) if config.get('MaxClientsPerHost') else 0,
                    'default_root': config.get('DefaultRoot', '~'),
                    'require_valid_shell': config.get('RequireValidShell', 'on') == 'on',
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_config(cls, service: str, settings: Dict) -> Dict:
        """Update FTP server configuration."""
        if service == 'vsftpd':
            return cls._update_vsftpd_config(settings)
        elif service == 'proftpd':
            return cls._update_proftpd_config(settings)
        else:
            return {'success': False, 'error': 'Invalid service'}

    @classmethod
    def _update_vsftpd_config(cls, settings: Dict) -> Dict:
        """Update vsftpd configuration."""
        if not os.path.exists(cls.VSFTPD_CONF):
            return {'success': False, 'error': 'vsftpd.conf not found'}

        try:
            # Read current config
            with open(cls.VSFTPD_CONF, 'r') as f:
                lines = f.readlines()

            # Map settings to config keys
            mapping = {
                'anonymous_enable': ('anonymous_enable', lambda v: 'YES' if v else 'NO'),
                'local_enable': ('local_enable', lambda v: 'YES' if v else 'NO'),
                'write_enable': ('write_enable', lambda v: 'YES' if v else 'NO'),
                'chroot_local_user': ('chroot_local_user', lambda v: 'YES' if v else 'NO'),
                'ssl_enable': ('ssl_enable', lambda v: 'YES' if v else 'NO'),
                'listen_port': ('listen_port', str),
                'max_clients': ('max_clients', str),
                'max_per_ip': ('max_per_ip', str),
                'local_umask': ('local_umask', str),
            }

            # Update lines
            updated_keys = set()
            for i, line in enumerate(lines):
                stripped = line.strip()
                if stripped and not stripped.startswith('#') and '=' in stripped:
                    key = stripped.split('=')[0].strip()
                    for setting_key, (config_key, transform) in mapping.items():
                        if key == config_key and setting_key in settings:
                            lines[i] = f"{config_key}={transform(settings[setting_key])}\n"
                            updated_keys.add(config_key)

            # Add missing settings
            for setting_key, (config_key, transform) in mapping.items():
                if setting_key in settings and config_key not in updated_keys:
                    lines.append(f"{config_key}={transform(settings[setting_key])}\n")

            # Write config
            with open(cls.VSFTPD_CONF, 'w') as f:
                f.writelines(lines)

            return {'success': True, 'message': 'Configuration updated. Restart vsftpd to apply changes.'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _update_proftpd_config(cls, settings: Dict) -> Dict:
        """Update proftpd configuration."""
        # Similar implementation for proftpd
        return {'success': False, 'error': 'ProFTPD configuration update not yet implemented'}

    @classmethod
    def list_users(cls) -> Dict:
        """List FTP users."""
        try:
            users = []

            # Get system users that have FTP access
            # Check vsftpd userlist if exists
            allowed_users = set()
            if os.path.exists(cls.VSFTPD_USER_LIST):
                with open(cls.VSFTPD_USER_LIST, 'r') as f:
                    allowed_users = set(line.strip() for line in f if line.strip())

            # Get users from /etc/passwd with home in FTP directories
            for user in pwd.getpwall():
                # Skip system users
                if user.pw_uid < 1000 or user.pw_uid == 65534:
                    continue

                # Check if user has FTP-related home directory or is in userlist
                is_ftp_user = (
                    user.pw_dir.startswith(cls.FTP_HOME_BASE) or
                    user.pw_name in allowed_users or
                    '/ftp' in user.pw_dir.lower()
                )

                if is_ftp_user or allowed_users:
                    home_exists = os.path.exists(user.pw_dir)
                    home_size = 0
                    if home_exists:
                        try:
                            for root, dirs, files in os.walk(user.pw_dir):
                                for f in files:
                                    home_size += os.path.getsize(os.path.join(root, f))
                        except (OSError, PermissionError):
                            pass

                    users.append({
                        'username': user.pw_name,
                        'uid': user.pw_uid,
                        'gid': user.pw_gid,
                        'home': user.pw_dir,
                        'shell': user.pw_shell,
                        'home_exists': home_exists,
                        'home_size': home_size,
                        'home_size_human': cls._format_size(home_size),
                        'in_userlist': user.pw_name in allowed_users,
                        'is_active': user.pw_shell not in ['/usr/sbin/nologin', '/bin/false']
                    })

            return {'success': True, 'users': users}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_user(cls, username: str, password: str = None, home_dir: str = None) -> Dict:
        """Create a new FTP user."""
        # Validate username
        if not re.match(r'^[a-z][a-z0-9_-]{2,31}$', username):
            return {'success': False, 'error': 'Invalid username. Use lowercase letters, numbers, underscore, hyphen. 3-32 chars.'}

        # Check if user exists
        try:
            pwd.getpwnam(username)
            return {'success': False, 'error': 'User already exists'}
        except KeyError:
            pass

        # Generate password if not provided
        if not password:
            password = secrets.token_urlsafe(16)

        # Set home directory
        if not home_dir:
            home_dir = os.path.join(cls.FTP_HOME_BASE, username)

        try:
            # Create user with restricted shell
            result = subprocess.run([
                'sudo', 'useradd',
                '-m',  # Create home directory
                '-d', home_dir,
                '-s', '/usr/sbin/nologin',  # No shell access
                '-c', f'FTP User {username}',
                username
            ], capture_output=True, text=True)

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to create user'}

            # Set password
            proc = subprocess.Popen(
                ['sudo', 'chpasswd'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            proc.communicate(input=f'{username}:{password}'.encode())

            # Add to vsftpd userlist if it exists
            if os.path.exists(cls.VSFTPD_USER_LIST):
                with open(cls.VSFTPD_USER_LIST, 'a') as f:
                    f.write(f'{username}\n')

            # Set proper permissions on home directory
            subprocess.run(['sudo', 'chmod', '755', home_dir], capture_output=True)

            return {
                'success': True,
                'username': username,
                'password': password,
                'home': home_dir,
                'message': 'FTP user created successfully'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_user(cls, username: str, delete_home: bool = False) -> Dict:
        """Delete an FTP user."""
        try:
            # Check if user exists
            try:
                pwd.getpwnam(username)
            except KeyError:
                return {'success': False, 'error': 'User not found'}

            # Delete user
            cmd = ['sudo', 'userdel']
            if delete_home:
                cmd.append('-r')
            cmd.append(username)

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to delete user'}

            # Remove from vsftpd userlist if exists
            if os.path.exists(cls.VSFTPD_USER_LIST):
                with open(cls.VSFTPD_USER_LIST, 'r') as f:
                    users = [line.strip() for line in f if line.strip() != username]
                with open(cls.VSFTPD_USER_LIST, 'w') as f:
                    f.write('\n'.join(users) + '\n')

            return {'success': True, 'message': f'User {username} deleted'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def change_password(cls, username: str, new_password: str = None) -> Dict:
        """Change FTP user password."""
        try:
            # Check if user exists
            try:
                pwd.getpwnam(username)
            except KeyError:
                return {'success': False, 'error': 'User not found'}

            # Generate password if not provided
            if not new_password:
                new_password = secrets.token_urlsafe(16)

            # Set password
            proc = subprocess.Popen(
                ['sudo', 'chpasswd'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, stderr = proc.communicate(input=f'{username}:{new_password}'.encode())

            if proc.returncode != 0:
                return {'success': False, 'error': stderr.decode() or 'Failed to change password'}

            return {
                'success': True,
                'username': username,
                'password': new_password,
                'message': 'Password changed successfully'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_connections(cls) -> Dict:
        """Get active FTP connections."""
        try:
            connections = []

            # Check for vsftpd connections
            result = subprocess.run(
                ['ss', '-tnp', 'state', 'established', 'sport', '=', ':21'],
                capture_output=True, text=True
            )

            for line in result.stdout.strip().split('\n')[1:]:  # Skip header
                if line:
                    parts = line.split()
                    if len(parts) >= 5:
                        local = parts[3]
                        remote = parts[4]
                        connections.append({
                            'local': local,
                            'remote': remote,
                            'state': 'ESTABLISHED'
                        })

            return {'success': True, 'connections': connections, 'count': len(connections)}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_logs(cls, lines: int = 100) -> Dict:
        """Get FTP server logs."""
        log_files = [
            '/var/log/vsftpd.log',
            '/var/log/proftpd/proftpd.log',
            '/var/log/xferlog',
            '/var/log/syslog'
        ]

        for log_file in log_files:
            if os.path.exists(log_file):
                try:
                    result = subprocess.run(
                        ['tail', '-n', str(lines), log_file],
                        capture_output=True, text=True
                    )
                    # Filter FTP-related entries if using syslog
                    log_content = result.stdout
                    if 'syslog' in log_file:
                        log_content = '\n'.join(
                            line for line in log_content.split('\n')
                            if 'ftp' in line.lower() or 'vsftpd' in line.lower() or 'proftpd' in line.lower()
                        )

                    return {
                        'success': True,
                        'log_file': log_file,
                        'content': log_content
                    }
                except Exception as e:
                    continue

        return {'success': False, 'error': 'No FTP log files found'}

    @classmethod
    def toggle_user(cls, username: str, enabled: bool) -> Dict:
        """Enable or disable an FTP user."""
        try:
            # Check if user exists
            try:
                pwd.getpwnam(username)
            except KeyError:
                return {'success': False, 'error': 'User not found'}

            if enabled:
                # Change shell to allow FTP (but still no login)
                shell = '/usr/sbin/nologin'
            else:
                # Change shell to /bin/false to disable
                shell = '/bin/false'

            result = subprocess.run(
                ['sudo', 'usermod', '-s', shell, username],
                capture_output=True, text=True
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to update user'}

            return {
                'success': True,
                'username': username,
                'enabled': enabled,
                'message': f'User {username} {"enabled" if enabled else "disabled"}'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def disconnect_session(cls, pid: int) -> Dict:
        """Disconnect an active FTP session by PID."""
        try:
            result = subprocess.run(
                ['sudo', 'kill', str(pid)],
                capture_output=True, text=True
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to disconnect session'}

            return {'success': True, 'message': f'Session {pid} disconnected'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def install_ftp_server(cls, service: str = 'vsftpd') -> Dict:
        """Install FTP server (vsftpd or proftpd)."""
        if service not in ['vsftpd', 'proftpd']:
            return {'success': False, 'error': 'Invalid service. Use vsftpd or proftpd'}

        try:
            # Update package list
            subprocess.run(['sudo', 'apt-get', 'update'], capture_output=True, timeout=120)

            # Install the service
            result = subprocess.run(
                ['sudo', 'apt-get', 'install', '-y', service],
                capture_output=True, text=True, timeout=300
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Installation failed'}

            # Create FTP home base directory
            os.makedirs(cls.FTP_HOME_BASE, exist_ok=True)

            # Create default configuration for vsftpd
            if service == 'vsftpd':
                default_config = """# vsftpd configuration
listen=YES
listen_ipv6=NO
anonymous_enable=NO
local_enable=YES
write_enable=YES
local_umask=022
dirmessage_enable=YES
use_localtime=YES
xferlog_enable=YES
connect_from_port_20=YES
chroot_local_user=YES
allow_writeable_chroot=YES
secure_chroot_dir=/var/run/vsftpd/empty
pam_service_name=vsftpd
rsa_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem
rsa_private_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
ssl_enable=NO
userlist_enable=YES
userlist_file=/etc/vsftpd.userlist
userlist_deny=NO
"""
                with open(cls.VSFTPD_CONF, 'w') as f:
                    f.write(default_config)

                # Create empty userlist
                with open(cls.VSFTPD_USER_LIST, 'w') as f:
                    f.write('')

            # Enable and start the service
            subprocess.run(['sudo', 'systemctl', 'enable', service], capture_output=True)
            subprocess.run(['sudo', 'systemctl', 'start', service], capture_output=True)

            return {
                'success': True,
                'service': service,
                'message': f'{service} installed and started successfully'
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def test_connection(cls, host: str = 'localhost', port: int = 21,
                       username: str = None, password: str = None) -> Dict:
        """Test FTP connection."""
        import socket

        try:
            # Basic connection test
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10)
            result = sock.connect_ex((host, port))
            sock.close()

            if result != 0:
                return {
                    'success': False,
                    'error': f'Cannot connect to {host}:{port}'
                }

            # If credentials provided, try to authenticate
            if username and password:
                try:
                    from ftplib import FTP
                    ftp = FTP()
                    ftp.connect(host, port, timeout=10)
                    ftp.login(username, password)
                    ftp.quit()
                    return {
                        'success': True,
                        'message': f'Successfully connected and authenticated to {host}:{port}'
                    }
                except Exception as e:
                    return {
                        'success': False,
                        'error': f'Connection succeeded but authentication failed: {str(e)}'
                    }

            return {
                'success': True,
                'message': f'FTP server is reachable at {host}:{port}'
            }

        except socket.timeout:
            return {'success': False, 'error': 'Connection timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in human-readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"
