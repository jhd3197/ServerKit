import os
import subprocess
import glob
from typing import Dict, List, Optional, Generator
from datetime import datetime
import threading
import queue


class LogService:
    """Service for log management and streaming."""

    # Common log locations
    LOG_PATHS = {
        'nginx_access': '/var/log/nginx/access.log',
        'nginx_error': '/var/log/nginx/error.log',
        'php_fpm': '/var/log/php*-fpm.log',
        'mysql': '/var/log/mysql/error.log',
        'postgresql': '/var/log/postgresql/postgresql-*-main.log',
        'syslog': '/var/log/syslog',
        'auth': '/var/log/auth.log',
    }

    # Allowed directories for log file access (path traversal protection)
    ALLOWED_LOG_DIRECTORIES = [
        '/var/log',
        '/var/serverkit',
        '/var/www',
        '/home',
        '/opt',
    ]

    @classmethod
    def is_path_allowed(cls, filepath: str) -> bool:
        """Check if the filepath is within allowed directories."""
        try:
            # Resolve the absolute path to prevent traversal attacks
            real_path = os.path.realpath(filepath)

            # Check if the path starts with any allowed directory
            for allowed_dir in cls.ALLOWED_LOG_DIRECTORIES:
                if real_path.startswith(allowed_dir):
                    return True

            return False
        except (ValueError, OSError):
            return False

    @classmethod
    def get_log_files(cls) -> List[Dict]:
        """Get list of available log files."""
        logs = []

        for name, pattern in cls.LOG_PATHS.items():
            matching_files = glob.glob(pattern)
            for filepath in matching_files:
                if os.path.exists(filepath):
                    try:
                        stat = os.stat(filepath)
                        logs.append({
                            'name': name,
                            'path': filepath,
                            'size': stat.st_size,
                            'size_human': cls._format_size(stat.st_size),
                            'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                        })
                    except (PermissionError, OSError):
                        continue

        return logs

    @classmethod
    def read_log(cls, filepath: str, lines: int = 100, from_end: bool = True) -> Dict:
        """Read lines from a log file."""
        if not cls.is_path_allowed(filepath):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Log file not found'}

        try:
            if from_end:
                # Use tail to get last N lines
                result = subprocess.run(
                    ['sudo', 'tail', '-n', str(lines), filepath],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            else:
                # Use head to get first N lines
                result = subprocess.run(
                    ['sudo', 'head', '-n', str(lines), filepath],
                    capture_output=True,
                    text=True,
                    timeout=30
                )

            if result.returncode == 0:
                log_lines = result.stdout.split('\n')
                return {
                    'success': True,
                    'lines': log_lines,
                    'count': len(log_lines),
                    'filepath': filepath
                }
            else:
                return {'success': False, 'error': result.stderr}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def search_log(cls, filepath: str, pattern: str, lines: int = 100) -> Dict:
        """Search log file for pattern."""
        if not cls.is_path_allowed(filepath):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Log file not found'}

        try:
            result = subprocess.run(
                ['sudo', 'grep', '-i', '-m', str(lines), pattern, filepath],
                capture_output=True,
                text=True,
                timeout=60
            )

            # grep returns 1 if no matches (not an error)
            if result.returncode in [0, 1]:
                matches = result.stdout.split('\n') if result.stdout else []
                return {
                    'success': True,
                    'matches': [m for m in matches if m],
                    'count': len([m for m in matches if m]),
                    'pattern': pattern
                }
            else:
                return {'success': False, 'error': result.stderr}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_app_logs(cls, app_name: str, log_type: str = 'access', lines: int = 100) -> Dict:
        """Get logs for a specific application.

        Checks for Docker-based apps first, then falls back to nginx logs.
        """
        # Check if this is a Docker-based app
        docker_compose_paths = [
            f'/var/serverkit/apps/{app_name}/docker-compose.yml',
            f'/var/www/{app_name}/docker-compose.yml',
        ]

        for compose_path in docker_compose_paths:
            if os.path.exists(compose_path):
                return cls.get_docker_app_logs(app_name, os.path.dirname(compose_path), lines)

        # Fall back to nginx logs for host-based apps
        if log_type == 'access':
            filepath = f'/var/log/nginx/{app_name}.access.log'
        elif log_type == 'error':
            filepath = f'/var/log/nginx/{app_name}.error.log'
        else:
            return {'success': False, 'error': 'Invalid log type. Use "access" or "error"'}

        return cls.read_log(filepath, lines)

    @classmethod
    def get_docker_app_logs(cls, app_name: str, app_dir: str, lines: int = 100) -> Dict:
        """Get logs for a Docker Compose application."""
        try:
            result = subprocess.run(
                ['docker', 'compose', 'logs', '--tail', str(lines), '--no-color'],
                capture_output=True,
                text=True,
                timeout=30,
                cwd=app_dir
            )

            if result.returncode == 0:
                log_lines = result.stdout.split('\n') if result.stdout else []
                return {
                    'success': True,
                    'lines': log_lines,
                    'count': len(log_lines),
                    'source': 'docker',
                    'app_dir': app_dir
                }
            else:
                # Try with docker-compose (older syntax) as fallback
                result = subprocess.run(
                    ['docker-compose', 'logs', '--tail', str(lines), '--no-color'],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    cwd=app_dir
                )
                if result.returncode == 0:
                    log_lines = result.stdout.split('\n') if result.stdout else []
                    return {
                        'success': True,
                        'lines': log_lines,
                        'count': len(log_lines),
                        'source': 'docker',
                        'app_dir': app_dir
                    }
                return {'success': False, 'error': result.stderr or 'Failed to get Docker logs'}

        except FileNotFoundError:
            return {'success': False, 'error': 'Docker not found'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Timeout getting logs'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_journalctl_logs(cls, unit: str = None, lines: int = 100,
                            since: str = None, priority: str = None) -> Dict:
        """Get logs from systemd journal."""
        try:
            cmd = ['sudo', 'journalctl', '-n', str(lines), '--no-pager', '-o', 'short-iso']

            if unit:
                cmd.extend(['-u', unit])
            if since:
                cmd.extend(['--since', since])
            if priority:
                cmd.extend(['-p', priority])

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

            if result.returncode == 0:
                log_lines = result.stdout.split('\n')
                return {
                    'success': True,
                    'lines': log_lines,
                    'count': len(log_lines)
                }
            else:
                return {'success': False, 'error': result.stderr}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def clear_log(cls, filepath: str) -> Dict:
        """Clear/truncate a log file."""
        if not cls.is_path_allowed(filepath):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Log file not found'}

        try:
            result = subprocess.run(
                ['sudo', 'truncate', '-s', '0', filepath],
                capture_output=True,
                text=True
            )

            if result.returncode == 0:
                return {'success': True, 'message': f'Log file {filepath} cleared'}
            else:
                return {'success': False, 'error': result.stderr}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def rotate_logs(cls) -> Dict:
        """Trigger log rotation."""
        try:
            result = subprocess.run(
                ['sudo', 'logrotate', '-f', '/etc/logrotate.conf'],
                capture_output=True,
                text=True,
                timeout=120
            )

            return {
                'success': result.returncode == 0,
                'message': 'Logs rotated' if result.returncode == 0 else result.stderr
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def tail_log(cls, filepath: str, callback, stop_event: threading.Event = None):
        """Stream log file in real-time (for WebSocket use)."""
        if not cls.is_path_allowed(filepath):
            callback({'error': 'Access denied: path not in allowed directories'})
            return

        if not os.path.exists(filepath):
            callback({'error': 'Log file not found'})
            return

        try:
            process = subprocess.Popen(
                ['sudo', 'tail', '-f', '-n', '0', filepath],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            while True:
                if stop_event and stop_event.is_set():
                    process.terminate()
                    break

                line = process.stdout.readline()
                if line:
                    callback({'line': line.strip(), 'filepath': filepath})
                elif process.poll() is not None:
                    break

        except Exception as e:
            callback({'error': str(e)})

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in bytes to human readable."""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.1f}{unit}"
            size /= 1024
        return f"{size:.1f}TB"


class LogStreamer:
    """Manages multiple log streams for real-time monitoring."""

    def __init__(self):
        self.streams = {}
        self.queues = {}

    def start_stream(self, stream_id: str, filepath: str) -> queue.Queue:
        """Start a new log stream."""
        if stream_id in self.streams:
            self.stop_stream(stream_id)

        log_queue = queue.Queue()
        stop_event = threading.Event()

        def callback(data):
            log_queue.put(data)

        thread = threading.Thread(
            target=LogService.tail_log,
            args=(filepath, callback, stop_event),
            daemon=True
        )
        thread.start()

        self.streams[stream_id] = {
            'thread': thread,
            'stop_event': stop_event,
            'filepath': filepath
        }
        self.queues[stream_id] = log_queue

        return log_queue

    def stop_stream(self, stream_id: str):
        """Stop a log stream."""
        if stream_id in self.streams:
            self.streams[stream_id]['stop_event'].set()
            del self.streams[stream_id]
            if stream_id in self.queues:
                del self.queues[stream_id]

    def stop_all(self):
        """Stop all log streams."""
        for stream_id in list(self.streams.keys()):
            self.stop_stream(stream_id)
