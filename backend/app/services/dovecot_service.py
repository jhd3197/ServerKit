"""Dovecot IMAP/POP3 server management service."""

import os
import re
import subprocess
from typing import Dict, Optional

from app.utils.system import PackageManager, ServiceControl, run_privileged
from app import paths


class DovecotService:
    """Service for managing Dovecot (IMAP/POP3 server)."""

    DOVECOT_CONF_DIR = '/etc/dovecot'
    DOVECOT_CONF = '/etc/dovecot/dovecot.conf'
    DOVECOT_AUTH_CONF = '/etc/dovecot/conf.d/10-auth.conf'
    DOVECOT_MAIL_CONF = '/etc/dovecot/conf.d/10-mail.conf'
    DOVECOT_MASTER_CONF = '/etc/dovecot/conf.d/10-master.conf'
    DOVECOT_SSL_CONF = '/etc/dovecot/conf.d/10-ssl.conf'
    DOVECOT_PASSWD_FILE = '/etc/dovecot/users'
    AUTH_PASSWDFILE_CONF = '/etc/dovecot/conf.d/auth-passwdfile.conf.ext'

    MAIL_CONF_CONTENT = """# Dovecot mail configuration - Managed by ServerKit
mail_location = maildir:{vmail_dir}/%d/%n/Maildir
namespace inbox {{
  inbox = yes
  separator = /
}}
mail_uid = {vmail_uid}
mail_gid = {vmail_gid}
mail_privileged_group = vmail
first_valid_uid = {vmail_uid}
last_valid_uid = {vmail_uid}
"""

    AUTH_CONF_CONTENT = """# Dovecot auth configuration - Managed by ServerKit
disable_plaintext_auth = yes
auth_mechanisms = plain login
!include auth-passwdfile.conf.ext
"""

    AUTH_PASSWDFILE_CONTENT = """# Password file auth - Managed by ServerKit
passdb {
  driver = passwd-file
  args = scheme=SHA512-CRYPT /etc/dovecot/users
}
userdb {
  driver = static
  args = uid=%{vmail_uid} gid=%{vmail_gid} home=%{vmail_dir}/%d/%n
}
"""

    MASTER_CONF_CONTENT = """# Dovecot master configuration - Managed by ServerKit
service imap-login {
  inet_listener imap {
    port = 0
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}

service pop3-login {
  inet_listener pop3 {
    port = 0
  }
  inet_listener pop3s {
    port = 995
    ssl = yes
  }
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}

service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0666
    user = postfix
    group = postfix
  }
  unix_listener auth-userdb {
    mode = 0600
    user = vmail
    group = vmail
  }
  user = dovecot
}

service auth-worker {
  user = vmail
}
"""

    SSL_CONF_CONTENT = """# Dovecot SSL configuration - Managed by ServerKit
ssl = required
ssl_cert = <{tls_cert}
ssl_key = <{tls_key}
ssl_min_protocol = TLSv1.2
ssl_prefer_server_ciphers = yes
"""

    @classmethod
    def get_status(cls) -> Dict:
        """Get Dovecot installation and running status."""
        installed = False
        running = False
        enabled = False
        version = None

        try:
            result = subprocess.run(['which', 'dovecot'], capture_output=True, text=True)
            installed = result.returncode == 0

            if not installed:
                installed = PackageManager.is_installed('dovecot-core') or PackageManager.is_installed('dovecot')

            if installed:
                running = ServiceControl.is_active('dovecot')
                enabled = ServiceControl.is_enabled('dovecot')

                result = subprocess.run(['dovecot', '--version'], capture_output=True, text=True)
                version_match = re.search(r'(\d+\.\d+\.\d+)', result.stdout)
                if version_match:
                    version = version_match.group(1)
        except (subprocess.SubprocessError, FileNotFoundError):
            pass

        return {
            'installed': installed,
            'running': running,
            'enabled': enabled,
            'version': version,
        }

    @classmethod
    def install(cls) -> Dict:
        """Install Dovecot packages."""
        try:
            manager = PackageManager.detect()
            if manager == 'apt':
                packages = ['dovecot-core', 'dovecot-imapd', 'dovecot-pop3d', 'dovecot-lmtpd', 'dovecot-sieve']
            else:
                packages = ['dovecot']

            result = PackageManager.install(packages, timeout=300)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to install Dovecot'}

            # Create empty passwd file
            run_privileged(['touch', cls.DOVECOT_PASSWD_FILE])
            run_privileged(['chown', 'vmail:dovecot', cls.DOVECOT_PASSWD_FILE])
            run_privileged(['chmod', '640', cls.DOVECOT_PASSWD_FILE])

            ServiceControl.enable('dovecot')

            return {'success': True, 'message': 'Dovecot installed successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def configure(cls, tls_cert: str = None, tls_key: str = None) -> Dict:
        """Write Dovecot configuration files."""
        try:
            cert = tls_cert or '/etc/ssl/certs/ssl-cert-snakeoil.pem'
            key = tls_key or '/etc/ssl/private/ssl-cert-snakeoil.key'

            # 10-mail.conf
            mail_conf = cls.MAIL_CONF_CONTENT.format(
                vmail_dir=paths.VMAIL_DIR,
                vmail_uid=paths.VMAIL_UID,
                vmail_gid=paths.VMAIL_GID,
            )
            run_privileged(['tee', cls.DOVECOT_MAIL_CONF], input=mail_conf)

            # 10-auth.conf
            run_privileged(['tee', cls.DOVECOT_AUTH_CONF], input=cls.AUTH_CONF_CONTENT)

            # auth-passwdfile.conf.ext
            auth_passwd = cls.AUTH_PASSWDFILE_CONTENT.replace(
                '%{vmail_uid}', str(paths.VMAIL_UID)
            ).replace(
                '%{vmail_gid}', str(paths.VMAIL_GID)
            ).replace(
                '%{vmail_dir}', paths.VMAIL_DIR
            )
            run_privileged(['tee', cls.AUTH_PASSWDFILE_CONF], input=auth_passwd)

            # 10-master.conf
            run_privileged(['tee', cls.DOVECOT_MASTER_CONF], input=cls.MASTER_CONF_CONTENT)

            # 10-ssl.conf
            ssl_conf = cls.SSL_CONF_CONTENT.format(tls_cert=cert, tls_key=key)
            run_privileged(['tee', cls.DOVECOT_SSL_CONF], input=ssl_conf)

            # Restart to apply
            ServiceControl.restart('dovecot', timeout=30)

            return {'success': True, 'message': 'Dovecot configured successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_mailbox(cls, email: str, password: str, domain: str, username: str, quota_mb: int = 1024) -> Dict:
        """Create a virtual mailbox with password entry."""
        try:
            # Generate password hash using doveadm
            result = run_privileged(['doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', password])
            if result.returncode != 0:
                return {'success': False, 'error': 'Failed to hash password'}
            password_hash = result.stdout.strip()

            # Build passwd-file entry
            # Format: user@domain:{scheme}hash:uid:gid:home::userdb_quota_rule=*:storage=NM
            entry = f'{email}:{password_hash}:{paths.VMAIL_UID}:{paths.VMAIL_GID}:{paths.VMAIL_DIR}/{domain}/{username}::userdb_quota_rule=*:storage={quota_mb}M'

            # Append to passwd file
            run_privileged(['tee', '-a', cls.DOVECOT_PASSWD_FILE], input=entry + '\n')

            # Create Maildir
            maildir = os.path.join(paths.VMAIL_DIR, domain, username, 'Maildir')
            run_privileged(['mkdir', '-p', f'{maildir}/cur', f'{maildir}/new', f'{maildir}/tmp'])
            run_privileged(['chown', '-R', f'{paths.VMAIL_UID}:{paths.VMAIL_GID}',
                          os.path.join(paths.VMAIL_DIR, domain, username)])

            return {'success': True, 'message': f'Mailbox {email} created'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_mailbox(cls, email: str, domain: str, username: str, remove_files: bool = False) -> Dict:
        """Delete a virtual mailbox."""
        try:
            # Remove from passwd file
            result = run_privileged(['cat', cls.DOVECOT_PASSWD_FILE])
            lines = (result.stdout or '').splitlines()
            new_lines = [l for l in lines if not l.startswith(f'{email}:')]
            run_privileged(['tee', cls.DOVECOT_PASSWD_FILE], input='\n'.join(new_lines) + '\n')

            # Optionally remove Maildir
            if remove_files:
                mailbox_path = os.path.join(paths.VMAIL_DIR, domain, username)
                run_privileged(['rm', '-rf', mailbox_path])

            return {'success': True, 'message': f'Mailbox {email} deleted'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def change_password(cls, email: str, new_password: str) -> Dict:
        """Change a mailbox password."""
        try:
            # Generate new hash
            result = run_privileged(['doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', new_password])
            if result.returncode != 0:
                return {'success': False, 'error': 'Failed to hash password'}
            new_hash = result.stdout.strip()

            # Read current file
            result = run_privileged(['cat', cls.DOVECOT_PASSWD_FILE])
            lines = (result.stdout or '').splitlines()

            updated = False
            new_lines = []
            for line in lines:
                if line.startswith(f'{email}:'):
                    parts = line.split(':')
                    parts[1] = new_hash
                    new_lines.append(':'.join(parts))
                    updated = True
                else:
                    new_lines.append(line)

            if not updated:
                return {'success': False, 'error': f'Account {email} not found'}

            run_privileged(['tee', cls.DOVECOT_PASSWD_FILE], input='\n'.join(new_lines) + '\n')

            return {'success': True, 'message': 'Password changed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def set_quota(cls, email: str, quota_mb: int) -> Dict:
        """Update mailbox quota."""
        try:
            result = run_privileged(['cat', cls.DOVECOT_PASSWD_FILE])
            lines = (result.stdout or '').splitlines()

            updated = False
            new_lines = []
            for line in lines:
                if line.startswith(f'{email}:'):
                    # Replace quota in the userdb_quota_rule field
                    line = re.sub(r'userdb_quota_rule=\*:storage=\d+M',
                                  f'userdb_quota_rule=*:storage={quota_mb}M', line)
                    new_lines.append(line)
                    updated = True
                else:
                    new_lines.append(line)

            if not updated:
                return {'success': False, 'error': f'Account {email} not found'}

            run_privileged(['tee', cls.DOVECOT_PASSWD_FILE], input='\n'.join(new_lines) + '\n')

            return {'success': True, 'message': f'Quota set to {quota_mb}MB'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_quota_usage(cls, email: str) -> Dict:
        """Get mailbox quota usage."""
        try:
            result = run_privileged(['doveadm', 'quota', 'get', '-u', email])
            if result.returncode != 0:
                return {'success': False, 'error': 'Failed to get quota'}

            # Parse output
            usage = {'storage_used': 0, 'storage_limit': 0, 'message_count': 0}
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 4 and parts[0] == 'STORAGE':
                    usage['storage_used'] = int(parts[1]) // 1024  # KB to MB
                    usage['storage_limit'] = int(parts[2]) // 1024 if parts[2] != '-' else 0
                elif len(parts) >= 4 and parts[0] == 'MESSAGE':
                    usage['message_count'] = int(parts[1])

            return {'success': True, **usage}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload(cls) -> Dict:
        """Reload Dovecot configuration."""
        try:
            result = ServiceControl.reload('dovecot', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'Dovecot reloaded'}
            return {'success': False, 'error': result.stderr or 'Reload failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart(cls) -> Dict:
        """Restart Dovecot."""
        try:
            result = ServiceControl.restart('dovecot', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'Dovecot restarted'}
            return {'success': False, 'error': result.stderr or 'Restart failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
