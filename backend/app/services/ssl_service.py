import os
import subprocess
import json
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path


class SSLService:
    """Service for SSL certificate management with Let's Encrypt."""

    CERTBOT_BIN = os.environ.get('CERTBOT_BIN', '/usr/bin/certbot')
    CERTS_DIR = '/etc/letsencrypt/live'
    RENEWAL_DIR = '/etc/letsencrypt/renewal'

    @classmethod
    def is_certbot_installed(cls) -> bool:
        """Check if certbot is installed."""
        try:
            result = subprocess.run(
                ['which', 'certbot'],
                capture_output=True,
                text=True
            )
            return result.returncode == 0
        except Exception:
            return False

    @classmethod
    def install_certbot(cls) -> Dict:
        """Install certbot if not present."""
        try:
            # For Ubuntu/Debian
            commands = [
                ['sudo', 'apt-get', 'update'],
                ['sudo', 'apt-get', 'install', '-y', 'certbot', 'python3-certbot-nginx']
            ]

            for cmd in commands:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}

            return {'success': True, 'message': 'Certbot installed successfully'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def obtain_certificate(cls, domains: List[str], email: str,
                           webroot_path: str = None, use_nginx: bool = True) -> Dict:
        """Obtain a new SSL certificate from Let's Encrypt."""
        if not cls.is_certbot_installed():
            install_result = cls.install_certbot()
            if not install_result['success']:
                return install_result

        try:
            # Build certbot command
            cmd = ['sudo', cls.CERTBOT_BIN, 'certonly']

            if use_nginx:
                cmd.append('--nginx')
            elif webroot_path:
                cmd.extend(['--webroot', '-w', webroot_path])
            else:
                return {'success': False, 'error': 'Either use_nginx or webroot_path is required'}

            # Add domains
            for domain in domains:
                cmd.extend(['-d', domain])

            # Add email and agree to TOS
            cmd.extend([
                '--email', email,
                '--agree-tos',
                '--non-interactive',
                '--expand'
            ])

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            if result.returncode == 0:
                primary_domain = domains[0]
                cert_path = f'{cls.CERTS_DIR}/{primary_domain}/fullchain.pem'
                key_path = f'{cls.CERTS_DIR}/{primary_domain}/privkey.pem'

                return {
                    'success': True,
                    'message': 'Certificate obtained successfully',
                    'certificate_path': cert_path,
                    'private_key_path': key_path,
                    'domains': domains
                }
            else:
                return {'success': False, 'error': result.stderr}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Certificate request timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def renew_certificate(cls, domain: str = None) -> Dict:
        """Renew SSL certificate(s)."""
        try:
            cmd = ['sudo', cls.CERTBOT_BIN, 'renew', '--non-interactive']

            if domain:
                cmd.extend(['--cert-name', domain])

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            return {
                'success': result.returncode == 0,
                'message': result.stdout if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def revoke_certificate(cls, domain: str) -> Dict:
        """Revoke an SSL certificate."""
        cert_path = f'{cls.CERTS_DIR}/{domain}/fullchain.pem'

        try:
            cmd = [
                'sudo', cls.CERTBOT_BIN, 'revoke',
                '--cert-path', cert_path,
                '--non-interactive'
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

            if result.returncode == 0:
                # Also delete the certificate
                delete_cmd = [
                    'sudo', cls.CERTBOT_BIN, 'delete',
                    '--cert-name', domain,
                    '--non-interactive'
                ]
                subprocess.run(delete_cmd, capture_output=True, text=True)

                return {'success': True, 'message': f'Certificate for {domain} revoked and deleted'}

            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_certificates(cls) -> List[Dict]:
        """List all installed certificates."""
        certificates = []

        try:
            result = subprocess.run(
                ['sudo', cls.CERTBOT_BIN, 'certificates'],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                return certificates

            # Parse certbot output
            current_cert = None
            for line in result.stdout.split('\n'):
                line = line.strip()

                if line.startswith('Certificate Name:'):
                    if current_cert:
                        certificates.append(current_cert)
                    current_cert = {'name': line.split(':', 1)[1].strip()}

                elif current_cert:
                    if line.startswith('Domains:'):
                        current_cert['domains'] = line.split(':', 1)[1].strip().split()
                    elif line.startswith('Expiry Date:'):
                        expiry_str = line.split(':', 1)[1].strip()
                        # Parse expiry date
                        try:
                            # Format: 2024-03-15 12:00:00+00:00
                            expiry_part = expiry_str.split(' (')[0]
                            current_cert['expiry'] = expiry_part
                            current_cert['expiry_valid'] = 'VALID' in expiry_str
                        except:
                            current_cert['expiry'] = expiry_str
                    elif line.startswith('Certificate Path:'):
                        current_cert['cert_path'] = line.split(':', 1)[1].strip()
                    elif line.startswith('Private Key Path:'):
                        current_cert['key_path'] = line.split(':', 1)[1].strip()

            if current_cert:
                certificates.append(current_cert)

        except Exception as e:
            pass

        return certificates

    @classmethod
    def get_certificate_info(cls, domain: str) -> Optional[Dict]:
        """Get detailed information about a specific certificate."""
        cert_path = f'{cls.CERTS_DIR}/{domain}/fullchain.pem'

        try:
            # Use openssl to get certificate details
            result = subprocess.run(
                ['sudo', 'openssl', 'x509', '-in', cert_path, '-noout',
                 '-subject', '-issuer', '-dates', '-serial'],
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                return None

            info = {'domain': domain, 'cert_path': cert_path}

            for line in result.stdout.split('\n'):
                if line.startswith('subject='):
                    info['subject'] = line.split('=', 1)[1].strip()
                elif line.startswith('issuer='):
                    info['issuer'] = line.split('=', 1)[1].strip()
                elif line.startswith('notBefore='):
                    info['valid_from'] = line.split('=', 1)[1].strip()
                elif line.startswith('notAfter='):
                    info['valid_until'] = line.split('=', 1)[1].strip()
                elif line.startswith('serial='):
                    info['serial'] = line.split('=', 1)[1].strip()

            return info

        except Exception as e:
            return None

    @classmethod
    def check_expiry(cls, domain: str) -> Dict:
        """Check if a certificate is expiring soon."""
        try:
            cert_path = f'{cls.CERTS_DIR}/{domain}/fullchain.pem'

            # Check expiry with openssl
            result = subprocess.run(
                ['sudo', 'openssl', 'x509', '-in', cert_path, '-checkend', '2592000'],  # 30 days
                capture_output=True,
                text=True
            )

            expiring_soon = result.returncode != 0

            # Get actual expiry date
            date_result = subprocess.run(
                ['sudo', 'openssl', 'x509', '-in', cert_path, '-noout', '-enddate'],
                capture_output=True,
                text=True
            )

            expiry_date = None
            if date_result.returncode == 0:
                expiry_date = date_result.stdout.replace('notAfter=', '').strip()

            return {
                'domain': domain,
                'expiring_soon': expiring_soon,
                'expiry_date': expiry_date,
                'needs_renewal': expiring_soon
            }

        except Exception as e:
            return {'domain': domain, 'error': str(e)}

    @classmethod
    def setup_auto_renewal(cls) -> Dict:
        """Set up automatic certificate renewal via cron/systemd timer."""
        try:
            # Check if systemd timer exists
            result = subprocess.run(
                ['sudo', 'systemctl', 'is-enabled', 'certbot.timer'],
                capture_output=True,
                text=True
            )

            if result.returncode == 0:
                return {'success': True, 'message': 'Auto-renewal already configured via systemd'}

            # Enable systemd timer
            enable_result = subprocess.run(
                ['sudo', 'systemctl', 'enable', '--now', 'certbot.timer'],
                capture_output=True,
                text=True
            )

            if enable_result.returncode == 0:
                return {'success': True, 'message': 'Auto-renewal enabled via systemd timer'}

            # Fall back to cron
            cron_job = '0 0,12 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"'
            cron_file = '/etc/cron.d/certbot-renewal'

            subprocess.run(
                ['sudo', 'tee', cron_file],
                input=cron_job + '\n',
                capture_output=True,
                text=True
            )

            return {'success': True, 'message': 'Auto-renewal configured via cron'}

        except Exception as e:
            return {'success': False, 'error': str(e)}
