"""SpamAssassin management service."""

import os
import re
import subprocess
from typing import Dict

from app.utils.system import PackageManager, ServiceControl, run_privileged


class SpamAssassinService:
    """Service for managing SpamAssassin spam filtering."""

    SPAMASSASSIN_CONF = '/etc/spamassassin/local.cf'
    SPAMASSASSIN_DEFAULT = '/etc/default/spamassassin'
    SPAMASS_MILTER_DEFAULT = '/etc/default/spamass-milter'

    LOCAL_CF_TEMPLATE = """# SpamAssassin local configuration - Managed by ServerKit
required_score {required_score}
report_safe {report_safe}
rewrite_header Subject {rewrite_subject}

use_bayes {use_bayes}
bayes_auto_learn {bayes_auto_learn}
bayes_auto_learn_threshold_nonspam 0.1
bayes_auto_learn_threshold_spam 12.0

skip_rbl_checks {skip_rbl_checks}
use_razor2 0
use_pyzor 0

# Network checks
dns_available yes

# Trusted networks
trusted_networks 127.0.0.0/8
internal_networks 127.0.0.0/8
"""

    DEFAULT_CONFIG = {
        'required_score': 5.0,
        'report_safe': 0,
        'rewrite_subject': '[SPAM]',
        'use_bayes': 1,
        'bayes_auto_learn': 1,
        'skip_rbl_checks': 0,
    }

    @classmethod
    def get_status(cls) -> Dict:
        """Get SpamAssassin installation and running status."""
        installed = False
        running = False
        enabled = False
        version = None
        milter_installed = False
        milter_running = False

        try:
            installed = PackageManager.is_installed('spamassassin')

            if installed:
                running = ServiceControl.is_active('spamassassin')
                enabled = ServiceControl.is_enabled('spamassassin')

                result = subprocess.run(['spamassassin', '--version'], capture_output=True, text=True)
                match = re.search(r'version\s+(\S+)', result.stdout)
                if match:
                    version = match.group(1)

            # Check milter
            milter_installed = PackageManager.is_installed('spamass-milter')
            if milter_installed:
                milter_running = ServiceControl.is_active('spamass-milter')

        except (subprocess.SubprocessError, FileNotFoundError):
            pass

        return {
            'installed': installed,
            'running': running,
            'enabled': enabled,
            'version': version,
            'milter_installed': milter_installed,
            'milter_running': milter_running,
        }

    @classmethod
    def install(cls) -> Dict:
        """Install SpamAssassin and spamass-milter."""
        try:
            manager = PackageManager.detect()
            if manager == 'apt':
                packages = ['spamassassin', 'spamass-milter', 'spamc']
            else:
                packages = ['spamassassin', 'spamass-milter-postfix']

            result = PackageManager.install(packages, timeout=300)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to install SpamAssassin'}

            # Enable spamd on Debian/Ubuntu
            if manager == 'apt' and os.path.exists(cls.SPAMASSASSIN_DEFAULT):
                result = run_privileged(['cat', cls.SPAMASSASSIN_DEFAULT])
                content = result.stdout or ''
                content = re.sub(r'ENABLED=0', 'ENABLED=1', content)
                content = re.sub(r'CRON=0', 'CRON=1', content)
                run_privileged(['tee', cls.SPAMASSASSIN_DEFAULT], input=content)

            # Configure milter to listen on port 8893
            milter_config = 'OPTIONS="-u spamass-milter -i 127.0.0.1 -p inet:8893@localhost -- --socket=/var/run/spamassassin/spamd.sock"\n'
            if os.path.exists(cls.SPAMASS_MILTER_DEFAULT):
                run_privileged(['tee', cls.SPAMASS_MILTER_DEFAULT], input=milter_config)

            # Write default config
            cls.configure(cls.DEFAULT_CONFIG)

            # Update rules
            run_privileged(['sa-update'], timeout=120)

            ServiceControl.enable('spamassassin')
            ServiceControl.start('spamassassin', timeout=30)

            if PackageManager.is_installed('spamass-milter'):
                ServiceControl.enable('spamass-milter')
                ServiceControl.start('spamass-milter', timeout=30)

            return {'success': True, 'message': 'SpamAssassin installed successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def configure(cls, settings: Dict = None) -> Dict:
        """Write SpamAssassin configuration."""
        try:
            config = dict(cls.DEFAULT_CONFIG)
            if settings:
                config.update(settings)

            content = cls.LOCAL_CF_TEMPLATE.format(**config)
            run_privileged(['tee', cls.SPAMASSASSIN_CONF], input=content)

            return {'success': True, 'message': 'SpamAssassin configured'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_config(cls) -> Dict:
        """Get current SpamAssassin configuration."""
        try:
            if not os.path.exists(cls.SPAMASSASSIN_CONF):
                return {'success': True, 'config': dict(cls.DEFAULT_CONFIG)}

            result = run_privileged(['cat', cls.SPAMASSASSIN_CONF])
            content = result.stdout or ''

            config = dict(cls.DEFAULT_CONFIG)

            # Parse values
            score_match = re.search(r'required_score\s+(\S+)', content)
            if score_match:
                config['required_score'] = float(score_match.group(1))

            report_match = re.search(r'report_safe\s+(\d+)', content)
            if report_match:
                config['report_safe'] = int(report_match.group(1))

            subject_match = re.search(r'rewrite_header Subject\s+(.+)', content)
            if subject_match:
                config['rewrite_subject'] = subject_match.group(1).strip()

            bayes_match = re.search(r'use_bayes\s+(\d+)', content)
            if bayes_match:
                config['use_bayes'] = int(bayes_match.group(1))

            auto_learn_match = re.search(r'bayes_auto_learn\s+(\d+)', content)
            if auto_learn_match:
                config['bayes_auto_learn'] = int(auto_learn_match.group(1))

            rbl_match = re.search(r'skip_rbl_checks\s+(\d+)', content)
            if rbl_match:
                config['skip_rbl_checks'] = int(rbl_match.group(1))

            return {'success': True, 'config': config}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_rules(cls) -> Dict:
        """Update SpamAssassin rules."""
        try:
            result = run_privileged(['sa-update'], timeout=120)
            # sa-update returns 0 for updates, 1 for no updates, 2+ for errors
            if result.returncode <= 1:
                ServiceControl.restart('spamassassin', timeout=30)
                return {
                    'success': True,
                    'message': 'Rules updated' if result.returncode == 0 else 'Rules already up to date',
                    'updated': result.returncode == 0,
                }
            return {'success': False, 'error': result.stderr or 'Update failed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def train_spam(cls, message_path: str) -> Dict:
        """Train SpamAssassin with a spam message."""
        try:
            result = run_privileged(['sa-learn', '--spam', message_path])
            if result.returncode == 0:
                return {'success': True, 'message': 'Message learned as spam'}
            return {'success': False, 'error': result.stderr or 'Training failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def train_ham(cls, message_path: str) -> Dict:
        """Train SpamAssassin with a ham (non-spam) message."""
        try:
            result = run_privileged(['sa-learn', '--ham', message_path])
            if result.returncode == 0:
                return {'success': True, 'message': 'Message learned as ham'}
            return {'success': False, 'error': result.stderr or 'Training failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_stats(cls) -> Dict:
        """Get SpamAssassin Bayes statistics."""
        try:
            result = run_privileged(['sa-learn', '--dump', 'magic'])
            output = result.stdout or ''

            stats = {
                'nspam': 0,
                'nham': 0,
                'ntokens': 0,
            }
            for line in output.splitlines():
                parts = line.split()
                if len(parts) >= 4:
                    if parts[2] == 'nspam':
                        stats['nspam'] = int(parts[1])
                    elif parts[2] == 'nham':
                        stats['nham'] = int(parts[1])
                    elif parts[2] == 'ntokens':
                        stats['ntokens'] = int(parts[1])

            return {'success': True, 'stats': stats}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def reload(cls) -> Dict:
        """Reload SpamAssassin."""
        try:
            result = ServiceControl.restart('spamassassin', timeout=30)
            if result.returncode == 0:
                return {'success': True, 'message': 'SpamAssassin restarted'}
            return {'success': False, 'error': result.stderr or 'Restart failed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
