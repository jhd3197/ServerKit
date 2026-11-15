import psutil
import subprocess
import platform
from typing import List, Dict, Optional

from app.utils.system import run_checked, run_privileged, unit_is_active


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
                    # psutil 6 renamed connections() and will remove the old name.
                    'connections': len((getattr(proc, 'net_connections', None)
                                        or proc.connections)())
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

    # Properties fetched per unit. Id is what the name actually resolves to,
    # so two aliases of one unit collapse into a single row.
    _SHOW_PROPERTIES = ('Id', 'LoadState', 'ActiveState', 'MainPID')

    @classmethod
    def _systemd_unit_states(cls, units: List[str]) -> Dict[str, Dict[str, str]]:
        """``systemctl show`` output for *units*, keyed by the requested name.

        One subprocess for the whole list rather than one per unit: this backs
        a polled list, and MONITORED_SERVICES is long. systemctl emits one
        property block per unit, in argument order, separated by blank lines.
        Returns ``{}`` on anything unexpected so the caller can fall back
        instead of reporting a wrong state.
        """
        cmd = ['systemctl', 'show', *units]
        cmd += [f'--property={p}' for p in cls._SHOW_PROPERTIES]
        result = run_checked(cmd, timeout=15)
        if not result['success']:
            return {}

        blocks: List[Dict[str, str]] = []
        current: Dict[str, str] = {}
        for line in result['output'].splitlines():
            line = line.strip()
            if not line:
                if current:
                    blocks.append(current)
                    current = {}
                continue
            key, _, value = line.partition('=')
            current[key] = value
        if current:
            blocks.append(current)

        # Index-matched by contract; if the block count disagrees the parse is
        # not trustworthy and the caller falls back rather than guessing.
        if len(blocks) != len(units):
            return {}
        return dict(zip(units, blocks))

    @classmethod
    def get_services_status(cls) -> List[Dict]:
        """Status of the monitored services, as systemd sees them.

        This used to substring-match psutil process names, which disagreed
        with control_service() -- which acts through systemctl -- in both
        directions. `mysql` matched the process `mysqld`, so a MariaDB box
        whose unit is `mariadb` showed a running `mysql` row whose
        start/stop/restart buttons systemctl could not honour; `docker`
        matched `dockerd` and `redis` matched `redis-server`, listing the same
        daemon two and three times; and any unrelated process whose name
        merely contained a service name (say `php-fpm` inside a build script's
        command) reported that service up. Asking systemd directly means the
        list cannot claim a state the buttons are unable to act on.

        Units the host does not have are dropped rather than listed as
        stopped: MONITORED_SERVICES deliberately carries several spellings of
        the same daemon so that whichever one a distro uses is found, and
        showing all of them as stopped was noise. Aliases that resolve to one
        unit collapse to a single row.
        """
        if platform.system() != 'Linux':
            return cls._process_name_status()

        states = cls._systemd_unit_states(cls.MONITORED_SERVICES)
        if not states:
            return cls._process_name_status()

        services = []
        seen_units = set()
        for name in cls.MONITORED_SERVICES:
            info = states.get(name) or {}
            if info.get('LoadState') != 'loaded':
                continue
            unit_id = info.get('Id') or name
            if unit_id in seen_units:
                continue
            seen_units.add(unit_id)
            try:
                pid = int(info.get('MainPID') or 0) or None
            except ValueError:
                pid = None
            services.append({
                'name': name,
                'status': 'running' if info.get('ActiveState') == 'active' else 'stopped',
                'pid': pid,
            })
        return services

    @classmethod
    def _process_name_status(cls) -> List[Dict]:
        """Legacy process-name heuristic, kept for hosts without systemd.

        Only reached off Linux (a Windows/macOS dev box) or when systemctl
        cannot be queried at all. It matches loosely and can report a service
        as running on a coincidental process name -- which is precisely why it
        is no longer the Linux path.
        """
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
                result = run_privileged(
                    ['systemctl', action, service_name], timeout=30
                )

                if result.returncode != 0:
                    # Fall back to service command
                    result = run_privileged(
                        ['service', service_name, action], timeout=30
                    )

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

                result = run_checked(cmd, timeout=30)
                return {
                    'success': result['success'],
                    'message': result['output'] if result['success'] else result['error']
                }

            else:
                return {'success': False, 'error': f'Unsupported platform: {system}'}

        except FileNotFoundError:
            return {'success': False, 'error': 'systemctl/service command not found'}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_service_logs(cls, service_name: str, lines: int = 100) -> Dict:
        """Get recent logs for a service via LogService fallback chain."""
        from app.services.log_service import LogService
        return LogService.get_journalctl_logs(unit=service_name, lines=lines)

    @classmethod
    def get_systemd_unit_status(cls, unit_name: str) -> Dict:
        """Check whether a systemd unit is active — via ``unit_is_active``.

        The probe itself was re-inlined in four other services; this keeps the
        dict shape its own callers read and lets one implementation answer.
        """
        if platform.system() != 'Linux':
            return {'success': True, 'status': 'unknown', 'active': False}

        active = unit_is_active(unit_name)
        if active is None:
            return {'success': False, 'error': 'could not query systemd'}
        return {'success': True,
                'status': 'active' if active else 'inactive',
                'active': active}

    @classmethod
    def get_compose_project_status(cls, project_path: str, compose_file: str = None) -> Dict:
        """Return running/stopped status for a Docker Compose project directory."""
        from app.services.docker_service import DockerService
        containers = DockerService.compose_ps(project_path, compose_file=compose_file)
        running = sum(
            1 for c in containers
            if (c.get('Status', c.get('status', '')).startswith('Up'))
        )
        total = len(containers)
        if total == 0:
            actual = 'stopped'
        elif running == total:
            actual = 'running'
        elif running > 0:
            actual = 'partial'
        else:
            actual = 'stopped'
        return {'success': True, 'status': actual, 'running': running, 'total': total, 'containers': containers}
