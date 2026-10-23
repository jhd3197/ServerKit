"""
Security Service — the lean core baseline.

What stays here works on every box with zero host packages: the shared
security config, legacy file-integrity monitoring, suspicious-activity /
event surfaces, SSH keys, IP allow/block lists, the security audit, and the
scan/alert logs + notification helpers the extensions also write through.

The install-gated tools were extracted to installable extensions:
ClamAV/YARA scanning and quarantine →
serverkit-clamav, fail2ban management → serverkit-fail2ban (status probing
lives on core ``Fail2banJailService``), Lynis → serverkit-lynis,
unattended-upgrades → serverkit-auto-updates, container CVE/SBOM scanning →
serverkit-image-scan.
"""

import os
import re
import json
import shlex
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from .notification_service import NotificationService
from app import paths
from app.utils.config_store import load_json_config, save_json_config
from app.utils.system import (
    PackageManager,
    run_checked,
    run_privileged,
)

# The two stamps an auth log line starts with. RFC 3339 is rsyslog's
# high-precision format, the default on recent Ubuntu releases:
# "2026-10-22T09:15:02.123456+02:00". The traditional BSD stamp, still written
# on Debian and the RHEL family and by syslog-ng, is local time with no year:
# "Oct  2 09:15:02". Its month names are English whatever the locale, so they
# are matched by hand rather than through strptime's %b.
_RFC3339_STAMP_RE = re.compile(r'^(\d{4}-\d{2}-\d{2}T\S+)\s')
_BSD_STAMP_RE = re.compile(r'^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2})\s')
_SYSLOG_MONTHS = {m: i for i, m in enumerate(
    ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'), start=1)}


class SecurityService:
    """Service for security scanning and monitoring."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    SECURITY_CONFIG = os.path.join(CONFIG_DIR, 'security.json')
    INTEGRITY_DB = os.path.join(CONFIG_DIR, 'file_integrity.json')
    SCAN_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'security_scans.log')
    ALERTS_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'security_alerts.log')
    # Where sshd/PAM failures land: Debian family, then the RHEL family.
    AUTH_LOGS = ('/var/log/auth.log', '/var/log/secure')

    # Scan status tracking
    _current_scan = None
    _scan_thread = None

    @classmethod
    def get_config(cls) -> Dict:
        """Get security configuration."""
        return load_json_config(cls.SECURITY_CONFIG, {
            'clamav': {
                'enabled': True,
                'scan_paths': ['/var/www', '/home'],
                'exclude_paths': ['/var/www/cache', '*.log'],
                'scan_on_upload': True,
                'quarantine_path': paths.SERVERKIT_QUARANTINE_DIR,
                'max_file_size': 100 * 1024 * 1024,  # 100MB
                'scheduled_scan': {
                    'enabled': False,
                    'schedule': 'daily',  # daily, weekly
                    'time': '03:00'
                }
            },
            'file_integrity': {
                'enabled': False,
                'monitored_paths': ['/etc', '/usr/bin', '/usr/sbin'],
                'check_interval': 3600,  # seconds
                'alert_on_change': True
            },
            'suspicious_activity': {
                'enabled': True,
                'monitor_failed_logins': True,
                'failed_login_threshold': 5,
                'monitor_port_scans': True,
                'monitor_file_changes': True
            },
            'notifications': {
                'on_malware_found': True,
                'on_integrity_change': True,
                'on_suspicious_activity': True,
                'severity': 'critical'
            }
        })

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save security configuration."""
        return save_json_config(cls.SECURITY_CONFIG, config)


    # ==========================================
    # FILE INTEGRITY MONITORING
    # ==========================================
    @classmethod
    def initialize_integrity_database(cls, paths: List[str] = None) -> Dict:
        """Create baseline for file integrity monitoring."""
        config = cls.get_config()
        if paths is None:
            paths = config.get('file_integrity', {}).get('monitored_paths', ['/etc'])

        database = {
            'created_at': datetime.now().isoformat(),
            'files': {}
        }

        try:
            for base_path in paths:
                if not os.path.exists(base_path):
                    continue

                for root, dirs, files in os.walk(base_path):
                    for filename in files:
                        file_path = os.path.join(root, filename)
                        try:
                            file_hash = cls._calculate_file_hash(file_path)
                            stat = os.stat(file_path)
                            database['files'][file_path] = {
                                'hash': file_hash,
                                'size': stat.st_size,
                                'mtime': stat.st_mtime,
                                'mode': stat.st_mode
                            }
                        except (PermissionError, FileNotFoundError):
                            continue

            # Save database
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.INTEGRITY_DB, 'w') as f:
                json.dump(database, f, indent=2)

            return {
                'success': True,
                'message': f'Integrity database created with {len(database["files"])} files',
                'file_count': len(database['files'])
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def check_file_integrity(cls) -> Dict:
        """Check files against integrity database."""
        if not os.path.exists(cls.INTEGRITY_DB):
            return {'success': False, 'error': 'Integrity database not initialized'}

        try:
            with open(cls.INTEGRITY_DB, 'r') as f:
                database = json.load(f)

            changes = {
                'modified': [],
                'deleted': [],
                'new': [],
                'permission_changed': []
            }

            config = cls.get_config()
            monitored_paths = config.get('file_integrity', {}).get('monitored_paths', [])

            # Check existing files
            for file_path, expected in database['files'].items():
                if not os.path.exists(file_path):
                    changes['deleted'].append(file_path)
                    continue

                try:
                    current_hash = cls._calculate_file_hash(file_path)
                    stat = os.stat(file_path)

                    if current_hash != expected['hash']:
                        changes['modified'].append({
                            'path': file_path,
                            'old_hash': expected['hash'],
                            'new_hash': current_hash
                        })
                    elif stat.st_mode != expected['mode']:
                        changes['permission_changed'].append({
                            'path': file_path,
                            'old_mode': oct(expected['mode']),
                            'new_mode': oct(stat.st_mode)
                        })
                except (PermissionError, FileNotFoundError):
                    continue

            # Check for new files
            for base_path in monitored_paths:
                if not os.path.exists(base_path):
                    continue

                for root, dirs, files in os.walk(base_path):
                    for filename in files:
                        file_path = os.path.join(root, filename)
                        if file_path not in database['files']:
                            changes['new'].append(file_path)

            # Send notifications if changes detected
            total_changes = sum(len(v) for v in changes.values())
            if total_changes > 0:
                cls._log_alert('integrity', f'File integrity changes detected: {total_changes} changes', changes)

                if config.get('notifications', {}).get('on_integrity_change', True):
                    cls._send_security_notification(
                        'integrity_change',
                        f'File integrity alert: {total_changes} file(s) changed',
                        severity='warning',
                        details=changes
                    )

            return {
                'success': True,
                'changes': changes,
                'total_changes': total_changes,
                'checked_at': datetime.now().isoformat()
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _calculate_file_hash(cls, file_path: str) -> str:
        """Calculate SHA256 hash of a file."""
        sha256_hash = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for byte_block in iter(lambda: f.read(4096), b''):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    # ==========================================
    # SUSPICIOUS ACTIVITY DETECTION
    # ==========================================
    @staticmethod
    def _auth_log_time(line: str, now: datetime) -> Optional[datetime]:
        """When an auth log line was written, as naive local time, or None
        when its stamp is neither of the two rsyslog writes by default.

        The BSD stamp has no year, so it takes ``now``'s and steps back one
        when that would put the line more than a day in the future, as a
        December line read in January would be.
        """
        match = _RFC3339_STAMP_RE.match(line)
        if match:
            try:
                stamp = datetime.fromisoformat(match.group(1))
            except ValueError:
                return None
            return stamp.astimezone().replace(tzinfo=None)

        match = _BSD_STAMP_RE.match(line)
        if not match or match.group(1) not in _SYSLOG_MONTHS:
            return None
        month = _SYSLOG_MONTHS[match.group(1)]
        day, hour, minute, second = (int(part) for part in match.groups()[1:])
        try:
            stamp = datetime(now.year, month, day, hour, minute, second)
            if stamp > now + timedelta(days=1):
                stamp = stamp.replace(year=now.year - 1)
        except ValueError:  # Feb 29 outside a leap year, or a garbled stamp
            return None
        return stamp

    @classmethod
    def check_failed_logins(cls, since_hours: int = 24) -> Dict:
        """Count failed logins in the auth log over the last ``since_hours``."""
        try:
            log_file = None
            for lf in cls.AUTH_LOGS:
                if os.path.exists(lf):
                    log_file = lf
                    break

            if not log_file:
                return {'success': False, 'error': 'Auth log not found'}

            now = datetime.now()
            cutoff_time = now - timedelta(hours=since_hours)
            failed_attempts = []

            with open(log_file, 'r') as f:
                for line in f:
                    if 'Failed password' in line or 'authentication failure' in line.lower():
                        # A line whose stamp cannot be read is kept rather
                        # than dropped: it may be recent, and leaving it out
                        # would hide failures instead of counting them.
                        written = cls._auth_log_time(line, now)
                        if written is not None and written < cutoff_time:
                            continue
                        failed_attempts.append(line.strip())

            config = cls.get_config()
            threshold = config.get('suspicious_activity', {}).get('failed_login_threshold', 5)

            if len(failed_attempts) >= threshold:
                cls._send_security_notification(
                    'failed_logins',
                    f'High number of failed login attempts: {len(failed_attempts)} in the last {since_hours} hours',
                    severity='warning',
                    details={'count': len(failed_attempts)}
                )

            return {
                'success': True,
                'failed_attempts': len(failed_attempts),
                'threshold': threshold,
                'alert_triggered': len(failed_attempts) >= threshold,
                'recent_failures': failed_attempts[-20:]  # Last 20 failures
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_security_events(cls, limit: int = 100) -> Dict:
        """Get recent security events/alerts."""
        events = []

        if not os.path.exists(cls.ALERTS_LOG):
            return {'success': True, 'events': events}

        try:
            with open(cls.ALERTS_LOG, 'r') as f:
                lines = f.readlines()

            for line in lines[-limit:]:
                try:
                    event = json.loads(line.strip())
                    events.append(event)
                except json.JSONDecodeError:
                    continue

            events.reverse()  # Most recent first
            return {'success': True, 'events': events}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_scan_history(cls, limit: int = 50) -> Dict:
        """Get scan history."""
        scans = []

        if not os.path.exists(cls.SCAN_LOG):
            return {'success': True, 'scans': scans}

        try:
            with open(cls.SCAN_LOG, 'r') as f:
                lines = f.readlines()

            for line in lines[-limit:]:
                try:
                    scan = json.loads(line.strip())
                    scans.append(scan)
                except json.JSONDecodeError:
                    continue

            scans.reverse()  # Most recent first
            return {'success': True, 'scans': scans}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # HELPER METHODS
    # ==========================================
    @classmethod
    def _log_scan(cls, scan_data: Dict) -> None:
        """Log scan result to file."""
        try:
            log_dir = os.path.dirname(cls.SCAN_LOG)
            os.makedirs(log_dir, exist_ok=True)

            with open(cls.SCAN_LOG, 'a') as f:
                f.write(json.dumps(scan_data) + '\n')
        except Exception:
            pass

    @classmethod
    def _log_alert(cls, alert_type: str, message: str, details: Dict = None) -> None:
        """Log security alert to file."""
        try:
            log_dir = os.path.dirname(cls.ALERTS_LOG)
            os.makedirs(log_dir, exist_ok=True)

            entry = {
                'timestamp': datetime.now().isoformat(),
                'type': alert_type,
                'message': message,
                'details': details or {}
            }

            with open(cls.ALERTS_LOG, 'a') as f:
                f.write(json.dumps(entry) + '\n')
        except Exception:
            pass

    @classmethod
    def _send_security_notification(cls, alert_type: str, message: str, severity: str = 'warning', details: Dict = None) -> None:
        """Send security notification via configured channels."""
        config = cls.get_config()
        notify_config = config.get('notifications', {})

        # Check if notifications are enabled for this type
        should_notify = False
        if alert_type == 'malware_detected' and notify_config.get('on_malware_found', True):
            should_notify = True
        elif alert_type == 'integrity_change' and notify_config.get('on_integrity_change', True):
            should_notify = True
        elif alert_type in ['failed_logins', 'suspicious_activity'] and notify_config.get('on_suspicious_activity', True):
            should_notify = True

        if not should_notify:
            return

        # Create alert payload
        alerts = [{
            'type': f'security_{alert_type}',
            'severity': severity,
            'message': message,
            'value': details.get('count', 'N/A') if details else 'N/A',
            'threshold': 'N/A'
        }]

        # Send to all configured notification channels
        NotificationService.send_all(alerts)

    @classmethod
    def get_security_summary(cls) -> Dict:
        """Get overall security status summary.

        Core-only view: malware scanning lives in the serverkit-clamav
        extension now, so the summary no longer carries `clamav`/`scan_status`
        fields — the extension's own tabs report scanner state. Events,
        integrity and notification toggles are core-owned and stay.
        """
        config = cls.get_config()

        # Get recent events count
        events_result = cls.get_security_events(limit=100)
        recent_events = events_result.get('events', [])

        # Count events by type in last 24 hours
        cutoff = datetime.now() - timedelta(hours=24)
        recent_malware = 0
        recent_integrity = 0
        recent_suspicious = 0

        for event in recent_events:
            try:
                event_time = datetime.fromisoformat(event.get('timestamp', ''))
                if event_time > cutoff:
                    event_type = event.get('type', '')
                    if 'malware' in event_type:
                        recent_malware += 1
                    elif 'integrity' in event_type:
                        recent_integrity += 1
                    else:
                        recent_suspicious += 1
            except Exception:
                continue

        return {
            'file_integrity': {
                'enabled': config.get('file_integrity', {}).get('enabled', False),
                'database_exists': os.path.exists(cls.INTEGRITY_DB)
            },
            'recent_alerts': {
                'malware_detections': recent_malware,
                'integrity_changes': recent_integrity,
                'suspicious_activity': recent_suspicious,
                'total': recent_malware + recent_integrity + recent_suspicious
            },
            'notifications_enabled': any([
                config.get('notifications', {}).get('on_malware_found', True),
                config.get('notifications', {}).get('on_integrity_change', True),
                config.get('notifications', {}).get('on_suspicious_activity', True)
            ])
        }

    # ==========================================
    # SSH KEY MANAGEMENT
    # ==========================================
    SSH_DIR = '/root/.ssh'
    AUTHORIZED_KEYS = '/root/.ssh/authorized_keys'
    SSH_KEY_TYPES = frozenset({
        'ssh-rsa',
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
    })

    @classmethod
    def _parse_ssh_public_key(cls, key_line: str) -> Optional[Dict[str, str]]:
        """Return key fields from an authorized_keys line.

        Existing entries may begin with restrictions such as ``from=`` or
        ``command=``.  Splitting those lines at fixed indexes mistakes an
        option for the key type and can miss duplicate key data, especially
        when a quoted option contains spaces.
        """
        try:
            parts = shlex.split(key_line, comments=False, posix=True)
        except ValueError:
            return None

        for index, part in enumerate(parts[:-1]):
            if part not in cls.SSH_KEY_TYPES:
                continue
            return {
                'type': part,
                'data': parts[index + 1],
                'comment': ' '.join(parts[index + 2:]),
            }
        return None

    @classmethod
    def get_ssh_keys(cls, user: str = 'root') -> Dict:
        """Get SSH authorized keys for a user."""
        if user == 'root':
            auth_keys_path = cls.AUTHORIZED_KEYS
        else:
            auth_keys_path = f'/home/{user}/.ssh/authorized_keys'

        if not os.path.exists(auth_keys_path):
            return {'success': True, 'keys': []}

        try:
            keys = []
            with open(auth_keys_path, 'r') as f:
                # The id must index the same sequence remove_ssh_key pops
                # from: non-blank, non-comment lines in file order. Numbering
                # over raw file lines shifts every id past a comment banner,
                # so delete-by-id would remove the wrong key.
                key_idx = -1
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    key_idx += 1

                    parsed = cls._parse_ssh_public_key(line)
                    if parsed:
                        key_type = parsed['type']
                        key_data = parsed['data']
                        comment = parsed['comment']

                        fingerprint = cls._get_key_fingerprint(line)

                        keys.append({
                            'id': key_idx,
                            'type': key_type,
                            'fingerprint': fingerprint,
                            'comment': comment,
                            'key': key_data[:20] + '...' + key_data[-20:] if len(key_data) > 50 else key_data
                        })

            return {'success': True, 'keys': keys, 'user': user}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _get_key_fingerprint(cls, key_line: str) -> str:
        """Get SSH key fingerprint."""
        try:
            result = run_checked(['ssh-keygen', '-lf', '-'], input=key_line, timeout=5)
            if result['success']:
                parts = result['output'].strip().split()
                if len(parts) >= 2:
                    return parts[1]
        except Exception:
            pass
        return 'Unknown'

    @classmethod
    def add_ssh_key(cls, key: str, user: str = 'root') -> Dict:
        """Add an SSH public key."""
        key = key.strip()
        if not key:
            return {'success': False, 'error': 'Key cannot be empty'}

        parts = key.split()
        if len(parts) < 2 or parts[0] not in cls.SSH_KEY_TYPES:
            return {'success': False, 'error': 'Invalid SSH key format'}

        if user == 'root':
            ssh_dir = cls.SSH_DIR
            auth_keys_path = cls.AUTHORIZED_KEYS
        else:
            ssh_dir = f'/home/{user}/.ssh'
            auth_keys_path = f'{ssh_dir}/authorized_keys'

        try:
            os.makedirs(ssh_dir, mode=0o700, exist_ok=True)

            existing = ''
            if os.path.exists(auth_keys_path):
                with open(auth_keys_path, 'r') as f:
                    existing = f.read()
                # Compare the key-data token, not a raw substring: a key whose
                # text happens to be contained in a longer line is not the
                # same key.
                for existing_line in existing.splitlines():
                    parsed = cls._parse_ssh_public_key(existing_line)
                    if parsed and parsed['data'] == parts[1]:
                        return {'success': False, 'error': 'Key already exists'}

            with open(auth_keys_path, 'a') as f:
                if existing and not existing.endswith('\n'):
                    f.write('\n')
                f.write(key + '\n')

            os.chmod(auth_keys_path, 0o600)

            return {'success': True, 'message': 'SSH key added successfully'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_ssh_key(cls, key_id: int, user: str = 'root') -> Dict:
        """Remove an SSH key by index."""
        if user == 'root':
            auth_keys_path = cls.AUTHORIZED_KEYS
        else:
            auth_keys_path = f'/home/{user}/.ssh/authorized_keys'

        if not os.path.exists(auth_keys_path):
            return {'success': False, 'error': 'No authorized_keys file'}

        try:
            with open(auth_keys_path, 'r') as f:
                lines = f.readlines()

            # Same id space as get_ssh_keys: the nth non-blank, non-comment
            # line. Delete it in place so comments/blank lines keep their
            # position and the remaining ids stay stable.
            key_indices = [i for i, line in enumerate(lines)
                           if line.strip() and not line.strip().startswith('#')]

            if key_id < 0 or key_id >= len(key_indices):
                return {'success': False, 'error': 'Invalid key ID'}

            del lines[key_indices[key_id]]

            with open(auth_keys_path, 'w') as f:
                f.writelines(lines)

            return {'success': True, 'message': 'SSH key removed'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # IP ALLOWLIST/BLOCKLIST
    # ==========================================
    IP_LISTS_FILE = os.path.join(CONFIG_DIR, 'ip_lists.json')

    @classmethod
    def get_ip_lists(cls) -> Dict:
        """Get IP allowlist and blocklist."""
        if os.path.exists(cls.IP_LISTS_FILE):
            try:
                with open(cls.IP_LISTS_FILE, 'r') as f:
                    return {'success': True, **json.load(f)}
            except Exception:
                pass

        return {
            'success': True,
            'allowlist': [],
            'blocklist': []
        }

    @classmethod
    def add_to_ip_list(cls, ip: str, list_type: str, comment: str = '') -> Dict:
        """Add IP to allowlist or blocklist."""
        if list_type not in ['allowlist', 'blocklist']:
            return {'success': False, 'error': 'Invalid list type'}

        ip = ip.strip()
        if not cls._validate_ip(ip):
            return {'success': False, 'error': 'Invalid IP address format'}

        try:
            lists = cls.get_ip_lists()
            current_list = lists.get(list_type, [])

            if any(item['ip'] == ip for item in current_list):
                return {'success': False, 'error': f'IP already in {list_type}'}

            current_list.append({
                'ip': ip,
                'comment': comment,
                'added_at': datetime.now().isoformat()
            })

            lists[list_type] = current_list
            del lists['success']

            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.IP_LISTS_FILE, 'w') as f:
                json.dump(lists, f, indent=2)

            return {'success': True, 'message': f'IP added to {list_type}'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_from_ip_list(cls, ip: str, list_type: str) -> Dict:
        """Remove IP from allowlist or blocklist."""
        if list_type not in ['allowlist', 'blocklist']:
            return {'success': False, 'error': 'Invalid list type'}

        try:
            lists = cls.get_ip_lists()
            current_list = lists.get(list_type, [])

            new_list = [item for item in current_list if item['ip'] != ip]

            if len(new_list) == len(current_list):
                return {'success': False, 'error': 'IP not found in list'}

            lists[list_type] = new_list
            del lists['success']

            with open(cls.IP_LISTS_FILE, 'w') as f:
                json.dump(lists, f, indent=2)

            return {'success': True, 'message': f'IP removed from {list_type}'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _validate_ip(cls, ip: str) -> bool:
        """Validate IP address or CIDR notation."""
        import re
        ipv4_pattern = r'^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$'
        ipv6_pattern = r'^([0-9a-fA-F:]+)(\/\d{1,3})?$'

        if re.match(ipv4_pattern, ip):
            parts = ip.split('/')[0].split('.')
            return all(0 <= int(p) <= 255 for p in parts)
        elif re.match(ipv6_pattern, ip):
            return True
        return False

    # ==========================================
    # SECURITY AUDIT REPORTS
    # ==========================================
    @classmethod
    def generate_security_audit(cls) -> Dict:
        """Generate a comprehensive security audit report."""
        audit = {
            'generated_at': datetime.now().isoformat(),
            'system': {},
            'services': {},
            'vulnerabilities': [],
            'recommendations': [],
            'score': 0
        }

        total_checks = 0
        passed_checks = 0

        try:
            uname = run_checked(['uname', '-a'], timeout=5)
            audit['system']['kernel'] = uname['output'].strip() if uname['success'] else 'Unknown'
        except Exception:
            audit['system']['kernel'] = 'Unknown'

        ssh_config_checks = cls._audit_ssh_config()
        audit['services']['ssh'] = ssh_config_checks
        total_checks += ssh_config_checks['total_checks']
        passed_checks += ssh_config_checks['passed_checks']

        firewall_checks = cls._audit_firewall()
        audit['services']['firewall'] = firewall_checks
        total_checks += firewall_checks['total_checks']
        passed_checks += firewall_checks['passed_checks']

        fail2ban_checks = cls._audit_fail2ban()
        audit['services']['fail2ban'] = fail2ban_checks
        total_checks += fail2ban_checks['total_checks']
        passed_checks += fail2ban_checks['passed_checks']

        updates_check = cls._audit_updates()
        audit['services']['updates'] = updates_check
        total_checks += updates_check['total_checks']
        passed_checks += updates_check['passed_checks']

        if total_checks > 0:
            audit['score'] = round((passed_checks / total_checks) * 100)

        audit['recommendations'] = cls._generate_recommendations(audit)

        return {'success': True, 'audit': audit}

    @classmethod
    def _audit_ssh_config(cls) -> Dict:
        """Audit SSH configuration."""
        checks = {
            'total_checks': 0,
            'passed_checks': 0,
            'findings': []
        }

        ssh_config_path = '/etc/ssh/sshd_config'
        if not os.path.exists(ssh_config_path):
            checks['findings'].append({'severity': 'info', 'message': 'SSH config not found'})
            return checks

        try:
            with open(ssh_config_path, 'r') as f:
                config = f.read()

            checks['total_checks'] += 1
            if 'PermitRootLogin no' in config or 'PermitRootLogin prohibit-password' in config:
                checks['passed_checks'] += 1
                checks['findings'].append({'severity': 'pass', 'message': 'Root login is restricted'})
            else:
                checks['findings'].append({'severity': 'warning', 'message': 'Root login may be enabled'})

            checks['total_checks'] += 1
            if 'PasswordAuthentication no' in config:
                checks['passed_checks'] += 1
                checks['findings'].append({'severity': 'pass', 'message': 'Password authentication disabled'})
            else:
                checks['findings'].append({'severity': 'info', 'message': 'Password authentication is enabled'})

            checks['total_checks'] += 1
            if 'Port 22' in config or 'Port' not in config:
                checks['findings'].append({'severity': 'info', 'message': 'SSH running on default port 22'})
            else:
                checks['passed_checks'] += 1
                checks['findings'].append({'severity': 'pass', 'message': 'SSH running on non-default port'})

        except Exception as e:
            checks['findings'].append({'severity': 'error', 'message': f'Failed to read SSH config: {e}'})

        return checks

    @classmethod
    def _audit_firewall(cls) -> Dict:
        """Audit firewall status."""
        checks = {
            'total_checks': 0,
            'passed_checks': 0,
            'findings': []
        }

        checks['total_checks'] += 1
        try:
            ufw_result = run_privileged(['ufw', 'status'], timeout=5)
            if ufw_result.returncode == 0 and 'active' in ufw_result.stdout.lower():
                checks['passed_checks'] += 1
                checks['findings'].append({'severity': 'pass', 'message': 'UFW firewall is active'})
            else:
                firewalld_result = run_privileged(['firewall-cmd', '--state'], timeout=5)
                if firewalld_result.returncode == 0 and 'running' in firewalld_result.stdout.lower():
                    checks['passed_checks'] += 1
                    checks['findings'].append({'severity': 'pass', 'message': 'firewalld is active'})
                else:
                    checks['findings'].append({'severity': 'critical', 'message': 'No firewall is active'})
        except Exception:
            checks['findings'].append({'severity': 'warning', 'message': 'Could not determine firewall status'})

        return checks

    @classmethod
    def _audit_fail2ban(cls) -> Dict:
        """Audit Fail2ban status."""
        checks = {
            'total_checks': 0,
            'passed_checks': 0,
            'findings': []
        }

        checks['total_checks'] += 1
        from app.services.fail2ban_jail_service import Fail2banJailService
        status = Fail2banJailService.get_fail2ban_status()
        if status['service_running']:
            checks['passed_checks'] += 1
            checks['findings'].append({'severity': 'pass', 'message': f'Fail2ban is running with {len(status["jails"])} jails'})
        elif status['installed']:
            checks['findings'].append({'severity': 'warning', 'message': 'Fail2ban installed but not running'})
        else:
            checks['findings'].append({'severity': 'warning', 'message': 'Fail2ban is not installed'})

        return checks

    @classmethod
    def _audit_updates(cls) -> Dict:
        """Audit system updates."""
        checks = {
            'total_checks': 0,
            'passed_checks': 0,
            'findings': []
        }

        checks['total_checks'] += 1
        try:
            if PackageManager.detect() == 'apt':
                result = run_checked(['apt', 'list', '--upgradable'], timeout=60)
                if result['success']:
                    lines = [l for l in result['output'].split('\n') if '/' in l]
                    if len(lines) == 0:
                        checks['passed_checks'] += 1
                        checks['findings'].append({'severity': 'pass', 'message': 'System is up to date'})
                    else:
                        checks['findings'].append({'severity': 'warning', 'message': f'{len(lines)} updates available'})
            else:
                checks['findings'].append({'severity': 'info', 'message': 'Update check not supported'})
        except Exception:
            checks['findings'].append({'severity': 'info', 'message': 'Could not check for updates'})

        return checks

    @classmethod
    def _generate_recommendations(cls, audit: Dict) -> List[str]:
        """Generate security recommendations based on audit findings."""
        recommendations = []

        ssh_findings = audit.get('services', {}).get('ssh', {}).get('findings', [])
        for finding in ssh_findings:
            if 'Root login may be enabled' in finding.get('message', ''):
                recommendations.append('Disable root login in SSH configuration')
            if 'Password authentication is enabled' in finding.get('message', ''):
                recommendations.append('Consider disabling password authentication and using SSH keys')

        firewall_findings = audit.get('services', {}).get('firewall', {}).get('findings', [])
        for finding in firewall_findings:
            if 'No firewall is active' in finding.get('message', ''):
                recommendations.append('Enable a firewall (UFW or firewalld) immediately')

        fail2ban_findings = audit.get('services', {}).get('fail2ban', {}).get('findings', [])
        for finding in fail2ban_findings:
            if 'not installed' in finding.get('message', '').lower():
                recommendations.append('Install Fail2ban to protect against brute force attacks')
            elif 'not running' in finding.get('message', '').lower():
                recommendations.append('Start the Fail2ban service')

        updates_findings = audit.get('services', {}).get('updates', {}).get('findings', [])
        for finding in updates_findings:
            if 'updates available' in finding.get('message', '').lower():
                recommendations.append('Apply pending security updates')

        return recommendations

