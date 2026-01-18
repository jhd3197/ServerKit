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
