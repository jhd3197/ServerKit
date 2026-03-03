"""Postfix mail server management service."""

import os
import re
import subprocess
from typing import Dict, List, Optional

from app.utils.system import PackageManager, ServiceControl, run_privileged
from app import paths


class PostfixService:
    """Service for managing Postfix MTA (Mail Transfer Agent)."""

    POSTFIX_MAIN_CF = '/etc/postfix/main.cf'
    POSTFIX_MASTER_CF = '/etc/postfix/master.cf'
    VIRTUAL_DOMAINS_FILE = '/etc/postfix/virtual_domains'
    VIRTUAL_MAILBOX_FILE = '/etc/postfix/virtual_mailboxes'
    VIRTUAL_ALIAS_FILE = '/etc/postfix/virtual_aliases'

    MAIN_CF_TEMPLATE = """# Postfix main configuration - Managed by ServerKit
# Basic settings
smtpd_banner = $myhostname ESMTP
myhostname = {hostname}
mydomain = {domain}
myorigin = $mydomain
mydestination = localhost, localhost.$mydomain
relayhost =
mynetworks = 127.0.0.0/8 [::1]/128
inet_interfaces = all
inet_protocols = all

# Virtual mailbox settings
virtual_mailbox_domains = hash:/etc/postfix/virtual_domains
virtual_mailbox_base = {vmail_dir}
virtual_mailbox_maps = hash:/etc/postfix/virtual_mailboxes
virtual_alias_maps = hash:/etc/postfix/virtual_aliases
virtual_minimum_uid = 100
virtual_uid_maps = static:{vmail_uid}
virtual_gid_maps = static:{vmail_gid}

# TLS settings
smtpd_tls_cert_file = {tls_cert}
smtpd_tls_key_file = {tls_key}
smtpd_use_tls = yes
smtpd_tls_auth_only = yes
smtpd_tls_security_level = may
smtp_tls_security_level = may
smtpd_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1
smtp_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1

# SASL authentication (via Dovecot)
smtpd_sasl_type = dovecot
smtpd_sasl_path = private/auth
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_sasl_local_domain = $myhostname

# Recipient restrictions
smtpd_recipient_restrictions =
    permit_sasl_authenticated,
    permit_mynetworks,
    reject_unauth_destination,
    reject_unknown_recipient_domain

# Milters (OpenDKIM + SpamAssassin)
milter_protocol = 6
milter_default_action = accept
smtpd_milters = inet:localhost:8891, inet:localhost:8893
non_smtpd_milters = inet:localhost:8891

# Size limits
message_size_limit = 52428800
mailbox_size_limit = 0

# Misc
recipient_delimiter = +
compatibility_level = 3.6
"""

    SUBMISSION_BLOCK = """
# Submission port (587) - Managed by ServerKit
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_tls_auth_only=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING

# SMTPS port (465) - Managed by ServerKit
smtps     inet  n       -       y       -       -       smtpd
  -o syslog_name=postfix/smtps
  -o smtpd_tls_wrappermode=yes
  -o smtpd_sasl_auth_enable=yes
  -o smtpd_reject_unlisted_recipient=no
  -o smtpd_recipient_restrictions=permit_sasl_authenticated,reject
  -o milter_macro_daemon_name=ORIGINATING
"""

    @classmethod
    def get_status(cls) -> Dict:
        """Get Postfix installation and running status."""
        installed = False
        running = False
        enabled = False
        version = None

        try:
            result = subprocess.run(['which', 'postfix'], capture_output=True, text=True)
            installed = result.returncode == 0

            if not installed:
                installed = PackageManager.is_installed('postfix')

            if installed:
                running = ServiceControl.is_active('postfix')
                enabled = ServiceControl.is_enabled('postfix')

                result = subprocess.run(
                    ['postconf', 'mail_version'],
                    capture_output=True, text=True
                )
                match = re.search(r'mail_version\s*=\s*(\S+)', result.stdout)
                if match:
                    version = match.group(1)
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
        """Install Postfix and create vmail user."""
        try:
            manager = PackageManager.detect()
            if manager == 'apt':
                # Pre-seed debconf to avoid interactive prompts
                run_privileged(
                    'debconf-set-selections <<< "postfix postfix/main_mailer_type select Internet Site"',
                    shell=True
                )
                run_privileged(
                    'debconf-set-selections <<< "postfix postfix/mailname string localhost"',
                    shell=True
                )

            result = PackageManager.install(['postfix', 'postfix-pcre'], timeout=300)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to install Postfix'}

            # Create vmail group and user
            run_privileged(['groupadd', '-g', str(paths.VMAIL_GID), 'vmail'])
            run_privileged([
                'useradd', '-r',
                '-u', str(paths.VMAIL_UID),
                '-g', str(paths.VMAIL_GID),
                '-d', paths.VMAIL_DIR,
                '-s', '/usr/sbin/nologin',
                '-c', 'Virtual Mail User',
                'vmail'
            ])

            # Create vmail directory
            run_privileged(['mkdir', '-p', paths.VMAIL_DIR])
            run_privileged(['chown', '-R', f'{paths.VMAIL_UID}:{paths.VMAIL_GID}', paths.VMAIL_DIR])
            run_privileged(['chmod', '750', paths.VMAIL_DIR])

            # Create empty map files
            for map_file in [cls.VIRTUAL_DOMAINS_FILE, cls.VIRTUAL_MAILBOX_FILE, cls.VIRTUAL_ALIAS_FILE]:
                run_privileged(['touch', map_file])
                run_privileged(['postmap', map_file])

            ServiceControl.enable('postfix')

            return {'success': True, 'message': 'Postfix installed successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def configure(cls, hostname: str, tls_cert: str = None, tls_key: str = None) -> Dict:
        """Write main.cf and configure submission ports in master.cf."""
        try:
            domain = hostname.split('.', 1)[1] if '.' in hostname else hostname

            config = cls.MAIN_CF_TEMPLATE.format(
                hostname=hostname,
                domain=domain,
                vmail_dir=paths.VMAIL_DIR,
                vmail_uid=paths.VMAIL_UID,
                vmail_gid=paths.VMAIL_GID,
                tls_cert=tls_cert or '/etc/ssl/certs/ssl-cert-snakeoil.pem',
                tls_key=tls_key or '/etc/ssl/private/ssl-cert-snakeoil.key',
            )

            # Write main.cf
            run_privileged(['tee', cls.POSTFIX_MAIN_CF], input=config)

            # Add submission/smtps to master.cf if not present
            result = run_privileged(['cat', cls.POSTFIX_MASTER_CF])
            if 'Managed by ServerKit' not in (result.stdout or ''):
                run_privileged(['tee', '-a', cls.POSTFIX_MASTER_CF], input=cls.SUBMISSION_BLOCK)

            # Restart to apply
            ServiceControl.restart('postfix', timeout=30)

            return {'success': True, 'message': 'Postfix configured successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_virtual_domain(cls, domain: str) -> Dict:
        """Add a virtual mailbox domain."""
        try:
            # Read current domains
            result = run_privileged(['cat', cls.VIRTUAL_DOMAINS_FILE])
            content = result.stdout or ''

            if domain in content:
                return {'success': True, 'message': 'Domain already exists'}

            # Append domain
            new_line = f'{domain}  OK\n'
            run_privileged(['tee', '-a', cls.VIRTUAL_DOMAINS_FILE], input=new_line)
            run_privileged(['postmap', cls.VIRTUAL_DOMAINS_FILE])

            return {'success': True, 'message': f'Domain {domain} added'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_virtual_domain(cls, domain: str) -> Dict:
        """Remove a virtual mailbox domain."""
        try:
            result = run_privileged(['cat', cls.VIRTUAL_DOMAINS_FILE])
            lines = (result.stdout or '').splitlines()
            new_lines = [l for l in lines if not l.strip().startswith(domain)]
            run_privileged(['tee', cls.VIRTUAL_DOMAINS_FILE], input='\n'.join(new_lines) + '\n')
            run_privileged(['postmap', cls.VIRTUAL_DOMAINS_FILE])

            return {'success': True, 'message': f'Domain {domain} removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_virtual_mailbox(cls, email: str, domain: str, username: str) -> Dict:
        """Add a virtual mailbox entry."""
        try:
            mailbox_path = f'{domain}/{username}/Maildir/'
            new_line = f'{email}  {mailbox_path}\n'

            result = run_privileged(['cat', cls.VIRTUAL_MAILBOX_FILE])
            if email in (result.stdout or ''):
                return {'success': True, 'message': 'Mailbox already exists'}

            run_privileged(['tee', '-a', cls.VIRTUAL_MAILBOX_FILE], input=new_line)
            run_privileged(['postmap', cls.VIRTUAL_MAILBOX_FILE])

            return {'success': True, 'message': f'Mailbox {email} added'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_virtual_mailbox(cls, email: str) -> Dict:
        """Remove a virtual mailbox entry."""
        try:
            result = run_privileged(['cat', cls.VIRTUAL_MAILBOX_FILE])
            lines = (result.stdout or '').splitlines()
            new_lines = [l for l in lines if not l.strip().startswith(email)]
            run_privileged(['tee', cls.VIRTUAL_MAILBOX_FILE], input='\n'.join(new_lines) + '\n')
            run_privileged(['postmap', cls.VIRTUAL_MAILBOX_FILE])

            return {'success': True, 'message': f'Mailbox {email} removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_virtual_alias(cls, source: str, destination: str) -> Dict:
        """Add a virtual alias mapping."""
        try:
            new_line = f'{source}  {destination}\n'

            result = run_privileged(['cat', cls.VIRTUAL_ALIAS_FILE])
            content = result.stdout or ''

            # Check for existing alias for this source
            lines = content.splitlines()
            updated = False
            new_lines = []
            for line in lines:
                if line.strip().startswith(source + ' ') or line.strip().startswith(source + '\t'):
                    # Update existing
                    new_lines.append(new_line.rstrip())
                    updated = True
                else:
                    new_lines.append(line)

            if not updated:
                new_lines.append(new_line.rstrip())

            run_privileged(['tee', cls.VIRTUAL_ALIAS_FILE], input='\n'.join(new_lines) + '\n')
            run_privileged(['postmap', cls.VIRTUAL_ALIAS_FILE])

            return {'success': True, 'message': f'Alias {source} -> {destination} added'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_virtual_alias(cls, source: str) -> Dict:
        """Remove a virtual alias mapping."""
        try:
            result = run_privileged(['cat', cls.VIRTUAL_ALIAS_FILE])
            lines = (result.stdout or '').splitlines()
            new_lines = [l for l in lines if not (l.strip().startswith(source + ' ') or l.strip().startswith(source + '\t'))]
            run_privileged(['tee', cls.VIRTUAL_ALIAS_FILE], input='\n'.join(new_lines) + '\n')
            run_privileged(['postmap', cls.VIRTUAL_ALIAS_FILE])

            return {'success': True, 'message': f'Alias {source} removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def rebuild_maps(cls) -> Dict:
        """Rebuild all Postfix hash maps."""
        try:
            for map_file in [cls.VIRTUAL_DOMAINS_FILE, cls.VIRTUAL_MAILBOX_FILE, cls.VIRTUAL_ALIAS_FILE]:
                if os.path.exists(map_file):
                    run_privileged(['postmap', map_file])

            return {'success': True, 'message': 'Maps rebuilt'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload(cls) -> Dict:
        """Reload Postfix configuration."""
        try:
            result = ServiceControl.reload('postfix', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'Postfix reloaded'}
            return {'success': False, 'error': result.stderr or 'Reload failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart(cls) -> Dict:
        """Restart Postfix."""
        try:
            result = ServiceControl.restart('postfix', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'Postfix restarted'}
            return {'success': False, 'error': result.stderr or 'Restart failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_queue(cls) -> Dict:
        """Get Postfix mail queue."""
        try:
            result = run_privileged(['mailq'])
            output = result.stdout or ''

            if 'Mail queue is empty' in output:
                return {'success': True, 'queue': [], 'count': 0}

            # Parse queue entries
            queue = []
            current = None
            for line in output.splitlines():
                match = re.match(r'^([A-F0-9]+)\s+(\d+)\s+(.+)\s+(\S+@\S+)', line)
                if match:
                    if current:
                        queue.append(current)
                    current = {
                        'id': match.group(1),
                        'size': int(match.group(2)),
                        'date': match.group(3).strip(),
                        'sender': match.group(4),
                        'recipients': [],
                    }
                elif current and line.strip() and not line.startswith('-'):
                    recipient = line.strip()
                    if '@' in recipient:
                        current['recipients'].append(recipient)

            if current:
                queue.append(current)

            return {'success': True, 'queue': queue, 'count': len(queue)}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def flush_queue(cls) -> Dict:
        """Flush the Postfix mail queue."""
        try:
            result = run_privileged(['postqueue', '-f'])
            return {'success': True, 'message': 'Queue flushed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_from_queue(cls, queue_id: str) -> Dict:
        """Delete a specific message from the queue."""
        try:
            result = run_privileged(['postsuper', '-d', queue_id])
            if result.returncode == 0:
                return {'success': True, 'message': f'Message {queue_id} deleted'}
            return {'success': False, 'error': result.stderr or 'Delete failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_logs(cls, lines: int = 100) -> Dict:
        """Get mail logs."""
        log_files = ['/var/log/mail.log', '/var/log/maillog', '/var/log/syslog']

        for log_file in log_files:
            if os.path.exists(log_file):
                try:
                    result = run_privileged(['tail', '-n', str(lines), log_file])
                    content = result.stdout or ''

                    if 'syslog' in log_file:
                        content = '\n'.join(
                            l for l in content.splitlines()
                            if 'postfix' in l.lower()
                        )

                    return {'success': True, 'log_file': log_file, 'content': content}
                except Exception:
                    continue

        return {'success': False, 'error': 'No mail log files found'}
