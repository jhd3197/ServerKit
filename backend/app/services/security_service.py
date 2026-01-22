"""
Security Service

Handles security scanning and monitoring:
- ClamAV malware scanning
- File integrity monitoring
- Suspicious activity detection
- Integration with notification system for alerts
"""

import os
import json
import subprocess
import hashlib
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path

from .notification_service import NotificationService


class SecurityService:
    """Service for security scanning and monitoring."""

    CONFIG_DIR = '/etc/serverkit'
    SECURITY_CONFIG = os.path.join(CONFIG_DIR, 'security.json')
    INTEGRITY_DB = os.path.join(CONFIG_DIR, 'file_integrity.json')
    SCAN_LOG = '/var/log/serverkit/security_scans.log'
    ALERTS_LOG = '/var/log/serverkit/security_alerts.log'

    # Scan status tracking
    _current_scan = None
    _scan_thread = None

    @classmethod
    def get_config(cls) -> Dict:
        """Get security configuration."""
        if os.path.exists(cls.SECURITY_CONFIG):
            try:
                with open(cls.SECURITY_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            'clamav': {
                'enabled': True,
                'scan_paths': ['/var/www', '/home'],
                'exclude_paths': ['/var/www/cache', '*.log'],
                'scan_on_upload': True,
                'quarantine_path': '/var/quarantine',
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
        }

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save security configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.SECURITY_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True, 'message': 'Configuration saved'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # CLAMAV INTEGRATION
    # ==========================================
    @classmethod
    def get_clamav_status(cls) -> Dict:
        """Get ClamAV installation and service status."""
        result = {
            'installed': False,
            'service_running': False,
            'version': None,
            'database_version': None,
            'last_update': None,
            'definitions_count': None
        }

        # Check if ClamAV is installed
        try:
            version_output = subprocess.run(
                ['clamscan', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if version_output.returncode == 0:
                result['installed'] = True
                result['version'] = version_output.stdout.strip()
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        # Check if clamd service is running
        try:
            service_check = subprocess.run(
                ['systemctl', 'is-active', 'clamav-daemon'],
                capture_output=True,
                text=True,
                timeout=5
            )
            result['service_running'] = service_check.stdout.strip() == 'active'
        except Exception:
            # Try alternative service name
            try:
                service_check = subprocess.run(
                    ['systemctl', 'is-active', 'clamd'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                result['service_running'] = service_check.stdout.strip() == 'active'
            except Exception:
                pass

        # Get database info
        try:
            db_path = '/var/lib/clamav'
            if os.path.exists(db_path):
                for db_file in ['main.cvd', 'main.cld', 'daily.cvd', 'daily.cld']:
                    full_path = os.path.join(db_path, db_file)
                    if os.path.exists(full_path):
                        stat = os.stat(full_path)
                        result['last_update'] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                        break
        except Exception:
            pass

        return result

    @classmethod
    def install_clamav(cls) -> Dict:
        """Install ClamAV packages."""
        try:
            # Detect package manager
            if os.path.exists('/usr/bin/apt'):
                install_cmd = ['apt', 'install', '-y', 'clamav', 'clamav-daemon', 'clamav-freshclam']
            elif os.path.exists('/usr/bin/dnf'):
                install_cmd = ['dnf', 'install', '-y', 'clamav', 'clamd', 'clamav-update']
            elif os.path.exists('/usr/bin/yum'):
                install_cmd = ['yum', 'install', '-y', 'clamav', 'clamd', 'clamav-update']
            else:
                return {'success': False, 'error': 'Unsupported package manager'}

            result = subprocess.run(
                install_cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            # Update virus definitions
            cls.update_definitions()

            return {'success': True, 'message': 'ClamAV installed successfully'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_definitions(cls) -> Dict:
        """Update ClamAV virus definitions."""
        try:
            # Stop freshclam if running to avoid conflicts
            subprocess.run(['systemctl', 'stop', 'clamav-freshclam'], capture_output=True, timeout=10)

            result = subprocess.run(
                ['freshclam'],
                capture_output=True,
                text=True,
                timeout=300
            )

            # Restart freshclam
            subprocess.run(['systemctl', 'start', 'clamav-freshclam'], capture_output=True, timeout=10)

            if result.returncode == 0:
                return {'success': True, 'message': 'Definitions updated', 'output': result.stdout}

            # Return code 1 might just mean "already up to date"
            if 'up to date' in result.stdout.lower() or 'up to date' in result.stderr.lower():
                return {'success': True, 'message': 'Definitions already up to date'}

            return {'success': False, 'error': result.stderr or result.stdout}

        except FileNotFoundError:
            return {'success': False, 'error': 'freshclam not found. Is ClamAV installed?'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Update timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def scan_file(cls, file_path: str) -> Dict:
        """Scan a single file for malware."""
        if not os.path.exists(file_path):
            return {'success': False, 'error': 'File not found'}

        try:
            result = subprocess.run(
                ['clamscan', '--no-summary', file_path],
                capture_output=True,
                text=True,
                timeout=60
            )

            infected = result.returncode == 1
            scan_result = {
                'success': True,
                'file': file_path,
                'infected': infected,
                'output': result.stdout.strip(),
                'scanned_at': datetime.now().isoformat()
            }

            if infected:
                # Log and send notification
                cls._log_alert('malware', f'Malware detected in {file_path}', {
                    'file': file_path,
                    'output': result.stdout.strip()
                })
                cls._send_security_notification(
                    'malware_detected',
                    f'Malware detected: {file_path}',
                    severity='critical'
                )

            return scan_result

        except FileNotFoundError:
            return {'success': False, 'error': 'clamscan not found. Is ClamAV installed?'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Scan timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def scan_directory(cls, directory: str, recursive: bool = True) -> Dict:
        """Start a directory scan (runs in background for large directories)."""
        if not os.path.isdir(directory):
            return {'success': False, 'error': 'Directory not found'}

        if cls._scan_thread and cls._scan_thread.is_alive():
            return {'success': False, 'error': 'A scan is already in progress'}

        # Initialize scan status
        cls._current_scan = {
            'status': 'running',
            'directory': directory,
            'started_at': datetime.now().isoformat(),
            'files_scanned': 0,
            'infected_files': [],
            'errors': []
        }

        # Start scan in background thread
        cls._scan_thread = threading.Thread(
            target=cls._run_directory_scan,
            args=(directory, recursive),
            daemon=True
        )
        cls._scan_thread.start()

        return {
            'success': True,
            'message': f'Scan started for {directory}',
            'scan_id': cls._current_scan['started_at']
        }

    @classmethod
    def _run_directory_scan(cls, directory: str, recursive: bool) -> None:
        """Execute directory scan (internal method)."""
        config = cls.get_config()
        exclude_paths = config.get('clamav', {}).get('exclude_paths', [])

        try:
            cmd = ['clamscan']
            if recursive:
                cmd.append('-r')
            cmd.extend(['--infected', '--no-summary'])

            # Add exclusions
            for exclude in exclude_paths:
                cmd.extend(['--exclude', exclude])

            cmd.append(directory)

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=3600  # 1 hour timeout
            )

            # Parse output
            infected_files = []
            for line in result.stdout.strip().split('\n'):
                if ': ' in line and 'FOUND' in line:
                    file_path = line.split(':')[0]
                    infected_files.append(file_path)

            cls._current_scan['status'] = 'completed'
            cls._current_scan['completed_at'] = datetime.now().isoformat()
            cls._current_scan['infected_files'] = infected_files
            cls._current_scan['output'] = result.stdout

            # Log scan result
            cls._log_scan(cls._current_scan)

            # Send notification if malware found
            if infected_files:
                cls._send_security_notification(
                    'malware_detected',
                    f'Malware detected in {len(infected_files)} file(s) during scan of {directory}',
                    severity='critical',
                    details={'files': infected_files}
                )

        except subprocess.TimeoutExpired:
            cls._current_scan['status'] = 'timeout'
            cls._current_scan['error'] = 'Scan timed out after 1 hour'
        except Exception as e:
            cls._current_scan['status'] = 'error'
            cls._current_scan['error'] = str(e)

    @classmethod
    def get_scan_status(cls) -> Dict:
        """Get current scan status."""
        if cls._current_scan is None:
            return {'status': 'idle', 'message': 'No scan in progress'}
        return cls._current_scan.copy()

    @classmethod
    def cancel_scan(cls) -> Dict:
        """Cancel running scan."""
        if cls._scan_thread and cls._scan_thread.is_alive():
            # We can't easily kill the subprocess, but we can mark it
            cls._current_scan['status'] = 'cancelled'
            return {'success': True, 'message': 'Scan marked as cancelled'}
        return {'success': False, 'error': 'No scan running'}

    @classmethod
    def quarantine_file(cls, file_path: str) -> Dict:
        """Move infected file to quarantine."""
        config = cls.get_config()
        quarantine_path = config.get('clamav', {}).get('quarantine_path', '/var/quarantine')

        if not os.path.exists(file_path):
            return {'success': False, 'error': 'File not found'}

        try:
            # Create quarantine directory
            os.makedirs(quarantine_path, exist_ok=True)

            # Generate unique quarantine name
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            original_name = os.path.basename(file_path)
            quarantine_name = f"{timestamp}_{original_name}.quarantine"
            quarantine_full_path = os.path.join(quarantine_path, quarantine_name)

            # Move file
            os.rename(file_path, quarantine_full_path)

            # Log the quarantine action
            cls._log_alert('quarantine', f'File quarantined: {file_path}', {
                'original_path': file_path,
                'quarantine_path': quarantine_full_path
            })

            return {
                'success': True,
                'message': 'File quarantined',
                'original_path': file_path,
                'quarantine_path': quarantine_full_path
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_quarantined_files(cls) -> Dict:
        """List quarantined files."""
        config = cls.get_config()
        quarantine_path = config.get('clamav', {}).get('quarantine_path', '/var/quarantine')

        if not os.path.exists(quarantine_path):
            return {'success': True, 'files': []}

        try:
            files = []
            for filename in os.listdir(quarantine_path):
                full_path = os.path.join(quarantine_path, filename)
                stat = os.stat(full_path)
                files.append({
                    'name': filename,
                    'path': full_path,
                    'size': stat.st_size,
                    'quarantined_at': datetime.fromtimestamp(stat.st_mtime).isoformat()
                })

            return {'success': True, 'files': files}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_quarantined_file(cls, filename: str) -> Dict:
        """Permanently delete a quarantined file."""
        config = cls.get_config()
        quarantine_path = config.get('clamav', {}).get('quarantine_path', '/var/quarantine')
        file_path = os.path.join(quarantine_path, filename)

        if not os.path.exists(file_path):
            return {'success': False, 'error': 'File not found'}

        # Security check: ensure file is in quarantine directory
        if not os.path.abspath(file_path).startswith(os.path.abspath(quarantine_path)):
            return {'success': False, 'error': 'Invalid file path'}

        try:
            os.remove(file_path)
            return {'success': True, 'message': 'File deleted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

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
    @classmethod
    def check_failed_logins(cls, since_hours: int = 24) -> Dict:
        """Check for failed login attempts."""
        try:
            # Check auth.log or secure log
            log_files = ['/var/log/auth.log', '/var/log/secure']
            log_file = None
            for lf in log_files:
                if os.path.exists(lf):
                    log_file = lf
                    break

            if not log_file:
                return {'success': False, 'error': 'Auth log not found'}

            cutoff_time = datetime.now() - timedelta(hours=since_hours)
            failed_attempts = []

            with open(log_file, 'r') as f:
                for line in f:
                    if 'Failed password' in line or 'authentication failure' in line.lower():
                        # Parse the log line to extract IP and user
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
        """Get overall security status summary."""
        clamav_status = cls.get_clamav_status()
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

        # Check scan status
        scan_status = cls.get_scan_status()

        return {
            'clamav': clamav_status,
            'scan_status': scan_status.get('status', 'idle'),
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
    # FAIL2BAN INTEGRATION
    # ==========================================
    @classmethod
    def get_fail2ban_status(cls) -> Dict:
        """Get Fail2ban installation and service status."""
        result = {
            'installed': False,
            'service_running': False,
            'version': None,
            'jails': []
        }

        try:
            version_output = subprocess.run(
                ['fail2ban-client', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if version_output.returncode == 0:
                result['installed'] = True
                result['version'] = version_output.stdout.strip().split('\n')[0]
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        if result['installed']:
            try:
                service_check = subprocess.run(
                    ['systemctl', 'is-active', 'fail2ban'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                result['service_running'] = service_check.stdout.strip() == 'active'
            except Exception:
                pass

            if result['service_running']:
                try:
                    jails_output = subprocess.run(
                        ['fail2ban-client', 'status'],
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    if jails_output.returncode == 0:
                        for line in jails_output.stdout.split('\n'):
                            if 'Jail list:' in line:
                                jails_str = line.split(':')[1].strip()
                                if jails_str:
                                    result['jails'] = [j.strip() for j in jails_str.split(',')]
                except Exception:
                    pass

        return result

    @classmethod
    def install_fail2ban(cls) -> Dict:
        """Install Fail2ban."""
        try:
            if os.path.exists('/usr/bin/apt'):
                install_cmd = ['apt', 'install', '-y', 'fail2ban']
            elif os.path.exists('/usr/bin/dnf'):
                install_cmd = ['dnf', 'install', '-y', 'fail2ban']
            elif os.path.exists('/usr/bin/yum'):
                install_cmd = ['yum', 'install', '-y', 'fail2ban']
            else:
                return {'success': False, 'error': 'Unsupported package manager'}

            result = subprocess.run(
                install_cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            subprocess.run(['systemctl', 'enable', 'fail2ban'], capture_output=True, timeout=10)
            subprocess.run(['systemctl', 'start', 'fail2ban'], capture_output=True, timeout=10)

            return {'success': True, 'message': 'Fail2ban installed successfully'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_fail2ban_jail_status(cls, jail: str) -> Dict:
        """Get status of a specific Fail2ban jail."""
        try:
            result = subprocess.run(
                ['fail2ban-client', 'status', jail],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode != 0:
                return {'success': False, 'error': f'Jail {jail} not found'}

            status = {
                'jail': jail,
                'currently_banned': 0,
                'total_banned': 0,
                'banned_ips': [],
                'currently_failed': 0,
                'total_failed': 0
            }

            for line in result.stdout.split('\n'):
                line = line.strip()
                if 'Currently banned:' in line:
                    status['currently_banned'] = int(line.split(':')[1].strip())
                elif 'Total banned:' in line:
                    status['total_banned'] = int(line.split(':')[1].strip())
                elif 'Banned IP list:' in line:
                    ips_str = line.split(':')[1].strip()
                    if ips_str:
                        status['banned_ips'] = ips_str.split()
                elif 'Currently failed:' in line:
                    status['currently_failed'] = int(line.split(':')[1].strip())
                elif 'Total failed:' in line:
                    status['total_failed'] = int(line.split(':')[1].strip())

            return {'success': True, **status}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_all_fail2ban_bans(cls) -> Dict:
        """Get all banned IPs across all jails."""
        status = cls.get_fail2ban_status()
        if not status['service_running']:
            return {'success': False, 'error': 'Fail2ban is not running'}

        all_bans = []
        for jail in status['jails']:
            jail_status = cls.get_fail2ban_jail_status(jail)
            if jail_status.get('success'):
                for ip in jail_status.get('banned_ips', []):
                    all_bans.append({'ip': ip, 'jail': jail})

        return {'success': True, 'banned_ips': all_bans, 'total': len(all_bans)}

    @classmethod
    def unban_ip(cls, ip: str, jail: str = None) -> Dict:
        """Unban an IP from Fail2ban."""
        try:
            if jail:
                result = subprocess.run(
                    ['fail2ban-client', 'set', jail, 'unbanip', ip],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
            else:
                result = subprocess.run(
                    ['fail2ban-client', 'unban', ip],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

            if result.returncode == 0:
                return {'success': True, 'message': f'IP {ip} unbanned'}
            return {'success': False, 'error': result.stderr or 'Failed to unban IP'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def ban_ip(cls, ip: str, jail: str = 'sshd') -> Dict:
        """Manually ban an IP in Fail2ban."""
        try:
            result = subprocess.run(
                ['fail2ban-client', 'set', jail, 'banip', ip],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode == 0:
                return {'success': True, 'message': f'IP {ip} banned in {jail}'}
            return {'success': False, 'error': result.stderr or 'Failed to ban IP'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # SSH KEY MANAGEMENT
    # ==========================================
    SSH_DIR = '/root/.ssh'
    AUTHORIZED_KEYS = '/root/.ssh/authorized_keys'

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
                for idx, line in enumerate(f):
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue

                    parts = line.split()
                    if len(parts) >= 2:
                        key_type = parts[0]
                        key_data = parts[1]
                        comment = ' '.join(parts[2:]) if len(parts) > 2 else ''

                        fingerprint = cls._get_key_fingerprint(line)

                        keys.append({
                            'id': idx,
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
            result = subprocess.run(
                ['ssh-keygen', '-lf', '-'],
                input=key_line,
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                parts = result.stdout.strip().split()
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
        if len(parts) < 2 or parts[0] not in ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']:
            return {'success': False, 'error': 'Invalid SSH key format'}

        if user == 'root':
            ssh_dir = cls.SSH_DIR
            auth_keys_path = cls.AUTHORIZED_KEYS
        else:
            ssh_dir = f'/home/{user}/.ssh'
            auth_keys_path = f'{ssh_dir}/authorized_keys'

        try:
            os.makedirs(ssh_dir, mode=0o700, exist_ok=True)

            if os.path.exists(auth_keys_path):
                with open(auth_keys_path, 'r') as f:
                    if key in f.read():
                        return {'success': False, 'error': 'Key already exists'}

            with open(auth_keys_path, 'a') as f:
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

            key_lines = []
            other_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped and not stripped.startswith('#'):
                    key_lines.append(line)
                else:
                    other_lines.append(line)

            if key_id < 0 or key_id >= len(key_lines):
                return {'success': False, 'error': 'Invalid key ID'}

            key_lines.pop(key_id)

            with open(auth_keys_path, 'w') as f:
                f.writelines(other_lines + key_lines)

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
            uname = subprocess.run(['uname', '-a'], capture_output=True, text=True, timeout=5)
            audit['system']['kernel'] = uname.stdout.strip() if uname.returncode == 0 else 'Unknown'
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
            ufw_result = subprocess.run(['ufw', 'status'], capture_output=True, text=True, timeout=5)
            if ufw_result.returncode == 0 and 'active' in ufw_result.stdout.lower():
                checks['passed_checks'] += 1
                checks['findings'].append({'severity': 'pass', 'message': 'UFW firewall is active'})
            else:
                firewalld_result = subprocess.run(['firewall-cmd', '--state'], capture_output=True, text=True, timeout=5)
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
        status = cls.get_fail2ban_status()
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
            if os.path.exists('/usr/bin/apt'):
                result = subprocess.run(['apt', 'list', '--upgradable'], capture_output=True, text=True, timeout=60)
                if result.returncode == 0:
                    lines = [l for l in result.stdout.split('\n') if '/' in l]
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

    # ==========================================
    # VULNERABILITY SCANNING (Lynis)
    # ==========================================
    @classmethod
    def get_lynis_status(cls) -> Dict:
        """Check if Lynis is installed."""
        try:
            result = subprocess.run(['lynis', '--version'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                return {'installed': True, 'version': result.stdout.strip()}
        except FileNotFoundError:
            pass
        except Exception:
            pass
        return {'installed': False, 'version': None}

    @classmethod
    def install_lynis(cls) -> Dict:
        """Install Lynis security auditing tool."""
        try:
            if os.path.exists('/usr/bin/apt'):
                install_cmd = ['apt', 'install', '-y', 'lynis']
            elif os.path.exists('/usr/bin/dnf'):
                install_cmd = ['dnf', 'install', '-y', 'lynis']
            elif os.path.exists('/usr/bin/yum'):
                install_cmd = ['yum', 'install', '-y', 'lynis']
            else:
                return {'success': False, 'error': 'Unsupported package manager'}

            result = subprocess.run(install_cmd, capture_output=True, text=True, timeout=300)

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'message': 'Lynis installed successfully'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    _lynis_scan = None
    _lynis_thread = None

    @classmethod
    def run_lynis_scan(cls) -> Dict:
        """Run a Lynis security audit scan."""
        if cls._lynis_thread and cls._lynis_thread.is_alive():
            return {'success': False, 'error': 'A scan is already in progress'}

        status = cls.get_lynis_status()
        if not status['installed']:
            return {'success': False, 'error': 'Lynis is not installed'}

        cls._lynis_scan = {
            'status': 'running',
            'started_at': datetime.now().isoformat(),
            'output': '',
            'warnings': [],
            'suggestions': [],
            'hardening_index': None
        }

        cls._lynis_thread = threading.Thread(target=cls._run_lynis_scan_thread, daemon=True)
        cls._lynis_thread.start()

        return {'success': True, 'message': 'Lynis scan started'}

    @classmethod
    def _run_lynis_scan_thread(cls) -> None:
        """Execute Lynis scan in background thread."""
        try:
            result = subprocess.run(
                ['lynis', 'audit', 'system', '--quick', '--no-colors'],
                capture_output=True,
                text=True,
                timeout=1800
            )

            cls._lynis_scan['output'] = result.stdout
            cls._lynis_scan['status'] = 'completed'
            cls._lynis_scan['completed_at'] = datetime.now().isoformat()

            for line in result.stdout.split('\n'):
                if 'Warning:' in line:
                    cls._lynis_scan['warnings'].append(line.strip())
                elif 'Suggestion:' in line:
                    cls._lynis_scan['suggestions'].append(line.strip())
                elif 'Hardening index' in line:
                    try:
                        idx = line.split(':')[1].strip().split()[0]
                        cls._lynis_scan['hardening_index'] = int(idx)
                    except Exception:
                        pass

        except subprocess.TimeoutExpired:
            cls._lynis_scan['status'] = 'timeout'
            cls._lynis_scan['error'] = 'Scan timed out'
        except Exception as e:
            cls._lynis_scan['status'] = 'error'
            cls._lynis_scan['error'] = str(e)

    @classmethod
    def get_lynis_scan_status(cls) -> Dict:
        """Get current Lynis scan status."""
        if cls._lynis_scan is None:
            return {'status': 'idle', 'message': 'No scan in progress'}
        return cls._lynis_scan.copy()

    # ==========================================
    # AUTOMATIC SECURITY UPDATES
    # ==========================================
    @classmethod
    def get_auto_updates_status(cls) -> Dict:
        """Get automatic security updates status."""
        result = {
            'supported': False,
            'enabled': False,
            'package': None,
            'settings': {}
        }

        if os.path.exists('/usr/bin/apt'):
            result['supported'] = True
            result['package'] = 'unattended-upgrades'

            try:
                check = subprocess.run(
                    ['dpkg', '-l', 'unattended-upgrades'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                result['installed'] = check.returncode == 0 and 'ii' in check.stdout
            except Exception:
                result['installed'] = False

            config_path = '/etc/apt/apt.conf.d/20auto-upgrades'
            if os.path.exists(config_path):
                try:
                    with open(config_path, 'r') as f:
                        content = f.read()
                        result['enabled'] = 'APT::Periodic::Unattended-Upgrade "1"' in content
                        result['settings']['auto_update'] = 'APT::Periodic::Update-Package-Lists "1"' in content
                except Exception:
                    pass

        elif os.path.exists('/usr/bin/dnf'):
            result['supported'] = True
            result['package'] = 'dnf-automatic'

            try:
                check = subprocess.run(['systemctl', 'is-enabled', 'dnf-automatic.timer'],
                                       capture_output=True, text=True, timeout=10)
                result['enabled'] = check.stdout.strip() == 'enabled'
            except Exception:
                pass

        return result

    @classmethod
    def install_auto_updates(cls) -> Dict:
        """Install automatic security updates package."""
        try:
            if os.path.exists('/usr/bin/apt'):
                result = subprocess.run(
                    ['apt', 'install', '-y', 'unattended-upgrades', 'apt-listchanges'],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}
                return {'success': True, 'message': 'unattended-upgrades installed'}

            elif os.path.exists('/usr/bin/dnf'):
                result = subprocess.run(
                    ['dnf', 'install', '-y', 'dnf-automatic'],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}
                return {'success': True, 'message': 'dnf-automatic installed'}

            return {'success': False, 'error': 'Unsupported package manager'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def enable_auto_updates(cls) -> Dict:
        """Enable automatic security updates."""
        try:
            if os.path.exists('/usr/bin/apt'):
                config_content = '''APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
'''
                config_path = '/etc/apt/apt.conf.d/20auto-upgrades'
                with open(config_path, 'w') as f:
                    f.write(config_content)
                return {'success': True, 'message': 'Automatic updates enabled'}

            elif os.path.exists('/usr/bin/dnf'):
                subprocess.run(['systemctl', 'enable', 'dnf-automatic.timer'], capture_output=True, timeout=10)
                subprocess.run(['systemctl', 'start', 'dnf-automatic.timer'], capture_output=True, timeout=10)
                return {'success': True, 'message': 'Automatic updates enabled'}

            return {'success': False, 'error': 'Unsupported package manager'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def disable_auto_updates(cls) -> Dict:
        """Disable automatic security updates."""
        try:
            if os.path.exists('/usr/bin/apt'):
                config_content = '''APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Unattended-Upgrade "0";
'''
                config_path = '/etc/apt/apt.conf.d/20auto-upgrades'
                with open(config_path, 'w') as f:
                    f.write(config_content)
                return {'success': True, 'message': 'Automatic updates disabled'}

            elif os.path.exists('/usr/bin/dnf'):
                subprocess.run(['systemctl', 'disable', 'dnf-automatic.timer'], capture_output=True, timeout=10)
                subprocess.run(['systemctl', 'stop', 'dnf-automatic.timer'], capture_output=True, timeout=10)
                return {'success': True, 'message': 'Automatic updates disabled'}

            return {'success': False, 'error': 'Unsupported package manager'}

        except Exception as e:
            return {'success': False, 'error': str(e)}
