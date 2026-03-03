"""OpenDKIM management service for DKIM signing."""

import os
import re
import subprocess
from typing import Dict

from app.utils.system import PackageManager, ServiceControl, run_privileged


class DKIMService:
    """Service for managing OpenDKIM (DKIM email signing)."""

    OPENDKIM_CONF = '/etc/opendkim.conf'
    OPENDKIM_DIR = '/etc/opendkim'
    OPENDKIM_KEYS_DIR = '/etc/opendkim/keys'
    KEY_TABLE = '/etc/opendkim/KeyTable'
    SIGNING_TABLE = '/etc/opendkim/SigningTable'
    TRUSTED_HOSTS = '/etc/opendkim/TrustedHosts'

    OPENDKIM_CONF_CONTENT = """# OpenDKIM configuration - Managed by ServerKit
Syslog yes
SyslogSuccess yes
LogWhy yes
Canonicalization relaxed/simple
Mode sv
SubDomains no
AutoRestart yes
AutoRestartRate 10/1M
Background yes
DNSTimeout 5
SignatureAlgorithm rsa-sha256

KeyTable refile:/etc/opendkim/KeyTable
SigningTable refile:/etc/opendkim/SigningTable
ExternalIgnoreList /etc/opendkim/TrustedHosts
InternalHosts /etc/opendkim/TrustedHosts

Socket inet:8891@localhost
PidFile /run/opendkim/opendkim.pid
OversignHeaders From
UserID opendkim
UMask 007
"""

    TRUSTED_HOSTS_DEFAULT = """# Trusted hosts - Managed by ServerKit
127.0.0.1
::1
localhost
"""

    @classmethod
    def get_status(cls) -> Dict:
        """Get OpenDKIM installation and running status."""
        installed = False
        running = False
        enabled = False
        version = None

        try:
            result = subprocess.run(['which', 'opendkim'], capture_output=True, text=True)
            installed = result.returncode == 0

            if not installed:
                installed = PackageManager.is_installed('opendkim')

            if installed:
                running = ServiceControl.is_active('opendkim')
                enabled = ServiceControl.is_enabled('opendkim')

                result = subprocess.run(['opendkim', '-V'], capture_output=True, text=True, stderr=subprocess.STDOUT)
                match = re.search(r'OpenDKIM\s+Filter\s+v(\S+)', result.stdout)
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
        """Install OpenDKIM."""
        try:
            result = PackageManager.install(['opendkim', 'opendkim-tools'], timeout=300)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to install OpenDKIM'}

            # Create directories
            run_privileged(['mkdir', '-p', cls.OPENDKIM_KEYS_DIR])
            run_privileged(['chown', '-R', 'opendkim:opendkim', cls.OPENDKIM_DIR])

            # Create config files
            run_privileged(['tee', cls.OPENDKIM_CONF], input=cls.OPENDKIM_CONF_CONTENT)
            run_privileged(['tee', cls.TRUSTED_HOSTS], input=cls.TRUSTED_HOSTS_DEFAULT)
            run_privileged(['touch', cls.KEY_TABLE])
            run_privileged(['touch', cls.SIGNING_TABLE])

            # Set permissions
            run_privileged(['chown', '-R', 'opendkim:opendkim', cls.OPENDKIM_DIR])
            run_privileged(['chmod', '700', cls.OPENDKIM_KEYS_DIR])

            # Create PID directory
            run_privileged(['mkdir', '-p', '/run/opendkim'])
            run_privileged(['chown', 'opendkim:opendkim', '/run/opendkim'])

            # Add postfix to opendkim group
            run_privileged(['usermod', '-aG', 'opendkim', 'postfix'])

            ServiceControl.enable('opendkim')
            ServiceControl.start('opendkim', timeout=30)

            return {'success': True, 'message': 'OpenDKIM installed successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def generate_key(cls, domain: str, selector: str = 'default') -> Dict:
        """Generate DKIM key pair for a domain."""
        try:
            key_dir = os.path.join(cls.OPENDKIM_KEYS_DIR, domain)
            run_privileged(['mkdir', '-p', key_dir])

            # Generate key
            result = run_privileged([
                'opendkim-genkey',
                '-s', selector,
                '-d', domain,
                '-D', key_dir,
                '-b', '2048',
            ])
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Key generation failed'}

            # Set permissions
            run_privileged(['chown', '-R', 'opendkim:opendkim', key_dir])
            run_privileged(['chmod', '600', os.path.join(key_dir, f'{selector}.private')])

            # Read the public key TXT record
            txt_file = os.path.join(key_dir, f'{selector}.txt')
            result = run_privileged(['cat', txt_file])
            public_key_record = result.stdout.strip() if result.returncode == 0 else ''

            # Extract just the key value from the TXT record
            key_match = re.search(r'p=([A-Za-z0-9+/=\s]+)', public_key_record)
            public_key = key_match.group(1).replace(' ', '').replace('\n', '').replace('\t', '').replace('"', '') if key_match else ''

            return {
                'success': True,
                'domain': domain,
                'selector': selector,
                'private_key_path': os.path.join(key_dir, f'{selector}.private'),
                'public_key': public_key,
                'dns_record': public_key_record,
                'dns_name': f'{selector}._domainkey.{domain}',
                'dns_value': f'v=DKIM1; k=rsa; p={public_key}',
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_domain(cls, domain: str, selector: str = 'default') -> Dict:
        """Add domain to KeyTable and SigningTable."""
        try:
            key_path = os.path.join(cls.OPENDKIM_KEYS_DIR, domain, f'{selector}.private')

            # Add to KeyTable
            key_entry = f'{selector}._domainkey.{domain} {domain}:{selector}:{key_path}\n'
            result = run_privileged(['cat', cls.KEY_TABLE])
            if domain not in (result.stdout or ''):
                run_privileged(['tee', '-a', cls.KEY_TABLE], input=key_entry)

            # Add to SigningTable
            signing_entry = f'*@{domain} {selector}._domainkey.{domain}\n'
            result = run_privileged(['cat', cls.SIGNING_TABLE])
            if domain not in (result.stdout or ''):
                run_privileged(['tee', '-a', cls.SIGNING_TABLE], input=signing_entry)

            # Add to TrustedHosts
            result = run_privileged(['cat', cls.TRUSTED_HOSTS])
            if domain not in (result.stdout or ''):
                run_privileged(['tee', '-a', cls.TRUSTED_HOSTS], input=f'*.{domain}\n')

            # Reload OpenDKIM
            ServiceControl.restart('opendkim', timeout=30)

            return {'success': True, 'message': f'Domain {domain} added to DKIM'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_domain(cls, domain: str) -> Dict:
        """Remove domain from DKIM configuration."""
        try:
            # Remove from KeyTable
            result = run_privileged(['cat', cls.KEY_TABLE])
            lines = [l for l in (result.stdout or '').splitlines() if domain not in l]
            run_privileged(['tee', cls.KEY_TABLE], input='\n'.join(lines) + '\n')

            # Remove from SigningTable
            result = run_privileged(['cat', cls.SIGNING_TABLE])
            lines = [l for l in (result.stdout or '').splitlines() if domain not in l]
            run_privileged(['tee', cls.SIGNING_TABLE], input='\n'.join(lines) + '\n')

            # Remove from TrustedHosts
            result = run_privileged(['cat', cls.TRUSTED_HOSTS])
            lines = [l for l in (result.stdout or '').splitlines() if domain not in l]
            run_privileged(['tee', cls.TRUSTED_HOSTS], input='\n'.join(lines) + '\n')

            # Remove key files
            key_dir = os.path.join(cls.OPENDKIM_KEYS_DIR, domain)
            run_privileged(['rm', '-rf', key_dir])

            ServiceControl.restart('opendkim', timeout=30)

            return {'success': True, 'message': f'Domain {domain} removed from DKIM'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_dns_record(cls, domain: str, selector: str = 'default') -> Dict:
        """Get the DKIM DNS TXT record content for a domain."""
        try:
            txt_file = os.path.join(cls.OPENDKIM_KEYS_DIR, domain, f'{selector}.txt')
            result = run_privileged(['cat', txt_file])
            if result.returncode != 0:
                return {'success': False, 'error': 'DKIM key not found'}

            record = result.stdout.strip()
            key_match = re.search(r'p=([A-Za-z0-9+/=\s"]+)', record)
            public_key = ''
            if key_match:
                public_key = key_match.group(1).replace(' ', '').replace('\n', '').replace('\t', '').replace('"', '')

            return {
                'success': True,
                'dns_name': f'{selector}._domainkey.{domain}',
                'dns_value': f'v=DKIM1; k=rsa; p={public_key}',
                'raw_record': record,
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def verify_key(cls, domain: str, selector: str = 'default') -> Dict:
        """Verify DKIM key configuration."""
        try:
            result = run_privileged([
                'opendkim-testkey',
                '-d', domain,
                '-s', selector,
                '-vvv',
            ])

            success = result.returncode == 0
            output = (result.stdout or '') + (result.stderr or '')

            return {
                'success': success,
                'verified': success and 'key OK' in output,
                'output': output,
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload(cls) -> Dict:
        """Reload OpenDKIM."""
        try:
            result = ServiceControl.restart('opendkim', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'OpenDKIM restarted'}
            return {'success': False, 'error': result.stderr or 'Restart failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
