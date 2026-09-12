import os
import subprocess
import glob
from typing import Dict, List, Optional, Generator
from datetime import datetime
import threading
import queue

from app import paths
from app.utils.formatting import format_bytes
from app.utils.system import (run_privileged, privileged_cmd, is_command_available,
                             run_checked, sourced_result)


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
        paths.SERVERKIT_DIR,
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
        """Read lines from a log file. Falls back to Python I/O when tail/head are unavailable."""
        if not cls.is_path_allowed(filepath):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Log file not found'}

        tool = 'tail' if from_end else 'head'

        if is_command_available(tool):
            try:
                result = run_privileged(
                    [tool, '-n', str(lines), filepath],
                    timeout=30
                )

                if result.returncode == 0:
                    log_lines = result.stdout.split('\n')
                    return {**sourced_result(log_lines, tool, tool), 'filepath': filepath}
                else:
                    return {'success': False, 'error': result.stderr}

            except Exception as e:
                return {'success': False, 'error': str(e)}

        # Fallback: Python file I/O
        try:
            with open(filepath, 'r', errors='replace') as f:
                all_lines = f.readlines()

            if from_end:
                log_lines = [l.rstrip('\n') for l in all_lines[-lines:]]
            else:
                log_lines = [l.rstrip('\n') for l in all_lines[:lines]]

            return {**sourced_result(log_lines, 'python', 'direct file read'), 'filepath': filepath}

        except PermissionError:
            return {'success': False, 'error': f'Permission denied reading {filepath}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def search_log(cls, filepath: str, pattern: str, lines: int = 100) -> Dict:
        """Search log file for pattern. Falls back to Python regex when grep is unavailable."""
        if not cls.is_path_allowed(filepath):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(filepath):
            return {'success': False, 'error': 'Log file not found'}

        if is_command_available('grep'):
            try:
                result = run_privileged(
                    ['grep', '-i', '-m', str(lines), pattern, filepath],
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

        # Fallback: Python regex search
        import re
        try:
            regex = re.compile(pattern, re.IGNORECASE)
            matches = []
            with open(filepath, 'r', errors='replace') as f:
                for line in f:
                    if regex.search(line):
                        matches.append(line.rstrip('\n'))
                        if len(matches) >= lines:
                            break

            return {
                'success': True,
                'matches': matches,
                'count': len(matches),
                'pattern': pattern
            }

        except re.error:
            # Pattern might be a plain string, not valid regex — use substring match
            matches = []
            with open(filepath, 'r', errors='replace') as f:
                for line in f:
                    if pattern.lower() in line.lower():
                        matches.append(line.rstrip('\n'))
                        if len(matches) >= lines:
                            break

            return {
                'success': True,
                'matches': matches,
                'count': len(matches),
                'pattern': pattern
            }
        except PermissionError:
            return {'success': False, 'error': f'Permission denied reading {filepath}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_app_logs(cls, app_name: str, log_type: str = 'access', lines: int = 100) -> Dict:
        """Get logs for a specific application.

        Checks for Docker-based apps first, then falls back to nginx logs.
        """
        # Check if this is a Docker-based app
        docker_compose_paths = [
            f'{paths.APPS_DIR}/{app_name}/docker-compose.yml',
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
    def get_docker_app_logs(cls, app_name: str, app_dir: str, lines: int = 100,
                            compose_file: str = None, timestamps: bool = False) -> Dict:
        """Get logs for a Docker Compose application."""
        try:
            cmd = ['docker', 'compose']
            if compose_file:
                cmd.extend(['-f', compose_file])
            cmd.extend(['logs', '--tail', str(lines), '--no-color'])
            if timestamps:
                cmd.append('--timestamps')

            result = run_checked(cmd, timeout=30, cwd=app_dir)

            if result['success']:
                log_lines = result['output'].split('\n') if result['output'] else []
                return {**sourced_result(log_lines, 'docker', 'Docker Compose'), 'app_dir': app_dir}
            else:
                # Try with docker-compose (older syntax) as fallback
                cmd = ['docker-compose']
                if compose_file:
                    cmd.extend(['-f', compose_file])
                cmd.extend(['logs', '--tail', str(lines), '--no-color'])
                if timestamps:
                    cmd.append('--timestamps')
                result = run_checked(cmd, timeout=30, cwd=app_dir)
                if result['success']:
                    log_lines = result['output'].split('\n') if result['output'] else []
                    return {**sourced_result(log_lines, 'docker', 'Docker Compose (legacy)'), 'app_dir': app_dir}
                return {'success': False, 'error': result['error']}

        except FileNotFoundError:
            return {'success': False, 'error': 'Docker not found'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Timeout getting logs'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_journalctl_logs(cls, unit: str = None, lines: int = 100,
                            since: str = None, priority: str = None,
                            precise: bool = False) -> Dict:
        """Get system logs, trying journalctl → syslog → Windows Event Log."""
        if is_command_available('journalctl'):
            return cls._read_journalctl(unit, lines, since, priority, precise)

        syslog_path = cls._find_syslog()
        if syslog_path:
            return cls._read_syslog(syslog_path, unit, lines)

        if os.name == 'nt':
            return cls._read_windows_eventlog(lines)

        return {'success': False, 'error': 'No system log source available — journalctl, syslog, and Windows Event Log are all unavailable'}

    @classmethod
    def _read_journalctl(cls, unit: str, lines: int, since: str, priority: str,
                        precise: bool = False) -> Dict:
        """Read logs from systemd journal."""
        try:
            output = 'short-iso-precise' if precise else 'short-iso'
            cmd = ['journalctl', '-n', str(lines), '--no-pager', '-o', output]

            if unit:
                cmd.extend(['-u', unit])
            if since:
                cmd.extend(['--since', since])
            if priority:
                cmd.extend(['-p', priority])

            result = run_privileged(cmd, timeout=60)

            if result.returncode == 0:
                log_lines = result.stdout.split('\n')
                return sourced_result(log_lines, 'journalctl', 'systemd journal')
            else:
                return {'success': False, 'error': result.stderr}

        except FileNotFoundError:
            return {'success': False, 'error': 'journalctl command not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _find_syslog() -> Optional[str]:
        """Return the first existing syslog path, or None."""
        for path in ['/var/log/syslog', '/var/log/messages']:
            if os.path.exists(path):
                return path
        return None

    @classmethod
    def _read_syslog(cls, filepath: str, service: str, lines: int) -> Dict:
        """Read system logs from a syslog file, optionally filtering by service."""
        try:
            if service:
                # No shell: list2cmdline() is cmd.exe-style quoting and does
                # not protect against $(...)/backtick expansion under bash.
                # grep runs as argv and the tail happens in Python instead.
                # -F: the unit name is a literal string, not a regex — names
                # like 'nginx.service' must not have '.' match any character.
                result = run_privileged(
                    ['grep', '-F', '-i', '--', service, filepath],
                    timeout=60,
                )
            else:
                result = run_privileged(
                    ['tail', '-n', str(lines), filepath],
                    timeout=60,
                )

            if result.returncode == 0 or (service and result.returncode == 1):
                log_lines = result.stdout.split('\n') if result.stdout else []
                if log_lines and log_lines[-1] == '':
                    log_lines.pop()  # trailing newline artifact
                if service:
                    # Clamp like `tail -n`: -0 would slice as [0:] (all
                    # lines) and a negative count would keep nearly all.
                    tail_lines = max(0, int(lines))
                    log_lines = log_lines[-tail_lines:] if tail_lines else []
                return sourced_result(log_lines, 'syslog', filepath)
            else:
                return {'success': False, 'error': result.stderr}

        except FileNotFoundError:
            return {'success': False, 'error': 'Required commands not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _read_windows_eventlog(lines: int) -> Dict:
        """Read system logs from Windows Event Log via wevtutil."""
        try:
            result = run_checked(
                ['wevtutil', 'qe', 'System', f'/c:{int(lines)}', '/f:text', '/rd:true'],
                timeout=60)

            if result['success']:
                log_lines = result['output'].split('\n') if result['output'] else []
                return sourced_result(log_lines, 'eventlog', 'Windows Event Log')
            else:
                return {'success': False, 'error': result['error']}

        except FileNotFoundError:
            return {'success': False, 'error': 'wevtutil command not found'}
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
            result = run_privileged(
                ['truncate', '-s', '0', filepath]
            )

            if result.returncode == 0:
                return {'success': True, 'message': f'Log file {filepath} cleared'}
            else:
                return {'success': False, 'error': result.stderr}

        except FileNotFoundError:
            return {'success': False, 'error': 'truncate command not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def rotate_logs(cls) -> Dict:
        """Trigger log rotation."""
        try:
            result = run_privileged(
                ['logrotate', '-f', '/etc/logrotate.conf'],
                timeout=120
            )

            return {
                'success': result.returncode == 0,
                'message': 'Logs rotated' if result.returncode == 0 else result.stderr
            }
        except FileNotFoundError:
            return {'success': False, 'error': 'logrotate command not found'}
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
                privileged_cmd(['tail', '-f', '-n', '0', filepath]),
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
        return format_bytes(size, suffix_sep='')


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
