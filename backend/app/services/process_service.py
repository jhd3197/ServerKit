import psutil
import subprocess
import platform
from typing import List, Dict, Optional


class ProcessService:
    """Service for process and service management."""

    # Common services to monitor
    MONITORED_SERVICES = [
        'nginx',
        'mysql', 'mysqld', 'mariadb',
        'postgresql', 'postgres',
        'redis', 'redis-server',
        'docker', 'dockerd',
        'php-fpm', 'php-fpm8.2', 'php-fpm8.1', 'php-fpm8.0',
        'gunicorn',
        'supervisor', 'supervisord'
    ]

    @classmethod
    def get_processes(cls, limit: int = 50, sort_by: str = 'cpu') -> List[Dict]:
        """Get list of running processes sorted by resource usage."""
        processes = []

        for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent',
                                          'memory_percent', 'status', 'create_time']):
            try:
                pinfo = proc.info
                # Filter out idle processes
                if pinfo['cpu_percent'] > 0 or pinfo['memory_percent'] > 0.1:
                    processes.append({
                        'pid': pinfo['pid'],
                        'name': pinfo['name'],
                        'username': pinfo['username'],
                        'cpu_percent': round(pinfo['cpu_percent'], 1),
                        'memory_percent': round(pinfo['memory_percent'], 2),
                        'status': pinfo['status'],
                        'create_time': pinfo['create_time']
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue

        # Sort by specified field
        sort_key = 'cpu_percent' if sort_by == 'cpu' else 'memory_percent'
        processes.sort(key=lambda x: x[sort_key], reverse=True)

        return processes[:limit]

    @classmethod
    def get_process_details(cls, pid: int) -> Optional[Dict]:
        """Get detailed information about a specific process."""
        try:
            proc = psutil.Process(pid)
            with proc.oneshot():
                return {
                    'pid': proc.pid,
                    'name': proc.name(),
                    'status': proc.status(),
                    'username': proc.username(),
                    'cpu_percent': proc.cpu_percent(),
                    'memory_percent': round(proc.memory_percent(), 2),
                    'memory_info': {
                        'rss': proc.memory_info().rss,
                        'vms': proc.memory_info().vms
                    },
                    'create_time': proc.create_time(),
                    'cmdline': proc.cmdline(),
                    'cwd': proc.cwd() if hasattr(proc, 'cwd') else None,
                    'num_threads': proc.num_threads(),
                    'connections': len(proc.connections()) if hasattr(proc, 'connections') else 0
                }
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            return None

    @classmethod
    def kill_process(cls, pid: int, force: bool = False) -> Dict:
        """Kill a process by PID."""
        try:
            proc = psutil.Process(pid)
            name = proc.name()

            if force:
                proc.kill()
            else:
                proc.terminate()

            return {'success': True, 'message': f'Process {name} (PID: {pid}) terminated'}
        except psutil.NoSuchProcess:
            return {'success': False, 'error': f'Process {pid} not found'}
        except psutil.AccessDenied:
            return {'success': False, 'error': f'Access denied to kill process {pid}'}

    @classmethod
    def get_services_status(cls) -> List[Dict]:
        """Get status of monitored services."""
        services = []
        running_procs = {p.name().lower(): p for p in psutil.process_iter(['name', 'pid'])}

        for service_name in cls.MONITORED_SERVICES:
            status = 'stopped'
            pid = None

            # Check if service is running
            for proc_name, proc in running_procs.items():
                if service_name.lower() in proc_name.lower():
                    status = 'running'
                    pid = proc.pid
                    break

            services.append({
                'name': service_name,
                'status': status,
                'pid': pid
            })

        return services

    @classmethod
    def control_service(cls, service_name: str, action: str) -> Dict:
        """Control a system service (start, stop, restart, reload)."""
        valid_actions = ['start', 'stop', 'restart', 'reload', 'status']
        if action not in valid_actions:
            return {'success': False, 'error': f'Invalid action. Must be one of: {valid_actions}'}

        system = platform.system()

        try:
            if system == 'Linux':
                # Try systemctl first (systemd)
                cmd = ['sudo', 'systemctl', action, service_name]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

                if result.returncode != 0:
                    # Fall back to service command
                    cmd = ['sudo', 'service', service_name, action]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

                if result.returncode == 0:
                    return {'success': True, 'message': f'Service {service_name} {action} successful'}
                else:
                    return {'success': False, 'error': result.stderr or 'Command failed'}

            elif system == 'Windows':
                if action == 'status':
                    cmd = ['sc', 'query', service_name]
                else:
                    action_map = {'start': 'start', 'stop': 'stop', 'restart': 'restart'}
                    cmd = ['net', action_map.get(action, action), service_name]

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                return {
                    'success': result.returncode == 0,
                    'message': result.stdout if result.returncode == 0 else result.stderr
                }

            else:
                return {'success': False, 'error': f'Unsupported platform: {system}'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_service_logs(cls, service_name: str, lines: int = 100) -> Dict:
        """Get recent logs for a service."""
        system = platform.system()

        try:
            if system == 'Linux':
                # Use journalctl for systemd services
                cmd = ['sudo', 'journalctl', '-u', service_name, '-n', str(lines), '--no-pager']
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

                if result.returncode == 0:
                    return {'success': True, 'logs': result.stdout}
                else:
                    return {'success': False, 'error': result.stderr}

            else:
                return {'success': False, 'error': 'Log retrieval not supported on this platform'}

        except Exception as e:
            return {'success': False, 'error': str(e)}
