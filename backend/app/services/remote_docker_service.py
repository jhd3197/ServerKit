"""
Remote Docker Service

Provides Docker operations on remote servers via agents.
This service routes Docker commands to the appropriate agent
and returns the results.
"""

from typing import List, Dict, Any

from app.services.agent_registry import agent_registry
from app.services.remote_command_dispatcher import dispatch_agent_command
from app.models.server import Server
from app.utils.formatting import format_bytes


class RemoteDockerService:
    """
    Service for executing Docker commands on remote servers.

    All methods accept a server_id parameter to target a specific server.
    If server_id is None or 'local', the command is executed locally
    using the existing DockerService.
    """

    # ==================== Containers ====================

    @staticmethod
    def list_containers(server_id: str, all: bool = False, user_id: int = None) -> Dict[str, Any]:
        """
        List containers on a remote server.

        Args:
            server_id: Target server ID
            all: Include stopped containers
            user_id: User ID for audit logging

        Returns:
            dict: {success, data: [containers], error}
        """
        if not server_id or server_id == 'local':
            # Use local Docker
            from app.services.docker_service import DockerService
            try:
                containers = DockerService.list_containers(all_containers=all)
                return {'success': True, 'data': containers}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:list',
            params={'all': all},
            user_id=user_id
        )

    @staticmethod
    def inspect_container(server_id: str, container_id: str, user_id: int = None) -> Dict[str, Any]:
        """Inspect a container on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                info = DockerService.get_container(container_id)
                return {'success': True, 'data': info}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:inspect',
            params={'id': container_id},
            user_id=user_id
        )

    @staticmethod
    def start_container(server_id: str, container_id: str, user_id: int = None) -> Dict[str, Any]:
        """Start a container on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.start_container(container_id)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:start',
            params={'id': container_id},
            user_id=user_id
        )

    @staticmethod
    def stop_container(server_id: str, container_id: str, timeout: int = None, user_id: int = None) -> Dict[str, Any]:
        """Stop a container on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.stop_container(container_id, timeout=timeout)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        params = {'id': container_id}
        if timeout:
            params['timeout'] = timeout

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:stop',
            params=params,
            user_id=user_id
        )

    @staticmethod
    def restart_container(server_id: str, container_id: str, timeout: int = None, user_id: int = None) -> Dict[str, Any]:
        """Restart a container on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.restart_container(container_id, timeout=timeout)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        params = {'id': container_id}
        if timeout:
            params['timeout'] = timeout

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:restart',
            params=params,
            user_id=user_id
        )

    @staticmethod
    def remove_container(
        server_id: str,
        container_id: str,
        force: bool = False,
        remove_volumes: bool = False,
        user_id: int = None
    ) -> Dict[str, Any]:
        """Remove a container on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.remove_container(container_id, force=force, v=remove_volumes)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:remove',
            params={
                'id': container_id,
                'force': force,
                'remove_volumes': remove_volumes
            },
            user_id=user_id
        )

    @staticmethod
    def get_container_stats(server_id: str, container_id: str, user_id: int = None) -> Dict[str, Any]:
        """Get container stats from a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                stats = DockerService.get_container_stats(container_id)
                return {'success': True, 'data': stats}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:stats',
            params={'id': container_id},
            user_id=user_id
        )

    @staticmethod
    def get_container_logs(server_id: str, container_id: str, tail: str = '100',
                           since: str = None, timestamps: bool = True,
                           user_id: int = None) -> Dict[str, Any]:
        """
        Get container logs from a remote server.

        Args:
            server_id: Target server ID
            container_id: Container ID or name
            tail: Number of lines to show from end (default 100, 'all' for all)
            since: Show logs since timestamp (e.g., '2021-01-01T00:00:00Z')
            timestamps: Include timestamps in output
            user_id: User ID for audit logging

        Returns:
            dict: {success, data: {logs: str}, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                logs = DockerService.get_container_logs(
                    container_id,
                    tail=tail,
                    since=since,
                    timestamps=timestamps
                )
                return {'success': True, 'data': {'logs': logs}}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:container:logs',
            params={
                'id': container_id,
                'tail': tail,
                'since': since or '',
                'timestamps': timestamps
            },
            timeout=30.0,
            user_id=user_id
        )

    # ==================== Images ====================

    @staticmethod
    def list_images(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """List images on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                images = DockerService.list_images()
                return {'success': True, 'data': images}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:image:list',
            params={},
            user_id=user_id
        )

    @staticmethod
    def pull_image(server_id: str, image: str, user_id: int = None) -> Dict[str, Any]:
        """Pull an image on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                result = DockerService.pull_image(image)
                return {'success': True, 'data': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:image:pull',
            params={'image': image},
            timeout=300.0,  # 5 minutes for pull
            user_id=user_id
        )

    @staticmethod
    def remove_image(server_id: str, image_id: str, force: bool = False, user_id: int = None) -> Dict[str, Any]:
        """Remove an image on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.remove_image(image_id, force=force)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:image:remove',
            params={'id': image_id, 'force': force},
            user_id=user_id
        )

    # ==================== Volumes ====================

    @staticmethod
    def list_volumes(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """List volumes on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                volumes = DockerService.list_volumes()
                return {'success': True, 'data': volumes}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:volume:list',
            params={},
            user_id=user_id
        )

    @staticmethod
    def remove_volume(server_id: str, name: str, force: bool = False, user_id: int = None) -> Dict[str, Any]:
        """Remove a volume on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.remove_volume(name, force=force)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:volume:remove',
            params={'name': name, 'force': force},
            user_id=user_id
        )

    # ==================== Networks ====================

    @staticmethod
    def list_networks(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """List networks on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                networks = DockerService.list_networks()
                return {'success': True, 'data': networks}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:network:list',
            params={},
            user_id=user_id
        )

    @staticmethod
    def remove_network(server_id: str, network_id: str, user_id: int = None) -> Dict[str, Any]:
        """Remove a network on a remote server"""
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                DockerService.remove_network(network_id)
                return {'success': True}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:network:remove',
            params={'id': network_id},
            user_id=user_id
        )

    # ==================== System ====================

    @staticmethod
    def _human_bytes(n: int) -> str:
        return format_bytes(n, suffix_sep='')

    @classmethod
    def _normalize_agent_metrics(cls, flat: Dict[str, Any]) -> Dict[str, Any]:
        # Agent emits a flat shape (cpu_percent, memory_used, …); the panel
        # frontend (Dashboard, MetricsGraph) was designed against the nested
        # shape that local SystemService.get_all_metrics returns. Project the
        # flat agent payload into the nested shape and keep the flat fields
        # for callers that still consume them (ServerDetail MetricsTab).
        if not isinstance(flat, dict):
            return flat

        def h(value):
            # Probe honesty: a counter the agent could not
            # determine stays None — never 0, which would render as a real
            # reading — and gets no human string.
            return cls._human_bytes(value) if value is not None else None

        mem_total = flat.get('memory_total')
        mem_used = flat.get('memory_used')
        mem_avail = (max(mem_total - mem_used, 0)
                     if mem_total is not None and mem_used is not None else None)
        disk_total = flat.get('disk_total')
        disk_used = flat.get('disk_used')
        disk_free = (max(disk_total - disk_used, 0)
                     if disk_total is not None and disk_used is not None else None)
        swap_total = flat.get('swap_total')
        swap_used = flat.get('swap_used')
        net_tx = flat.get('network_tx')
        net_rx = flat.get('network_rx')
        nested = {
            'cpu': {
                'percent': flat.get('cpu_percent'),
                'count_logical': len(flat.get('cpu_per_core') or []) or None,
                'per_cpu': flat.get('cpu_per_core') or [],
            },
            'memory': {
                'ram': {
                    'total': mem_total,
                    'used': mem_used,
                    'available': mem_avail,
                    'cached': None,  # agents do not report cached memory
                    'percent': flat.get('memory_percent'),
                    'total_human': h(mem_total),
                    'used_human': h(mem_used),
                    'available_human': h(mem_avail),
                    'cached_human': None,
                },
                'swap': {
                    'total': swap_total,
                    'used': swap_used,
                    'percent': flat.get('swap_percent'),
                    'total_human': h(swap_total),
                    'used_human': h(swap_used),
                },
            },
            'disk': {
                'partitions': [{
                    'mountpoint': '/',
                    'total': disk_total,
                    'used': disk_used,
                    'free': disk_free,
                    'percent': flat.get('disk_percent'),
                    'total_human': h(disk_total),
                    'used_human': h(disk_used),
                    'free_human': h(disk_free),
                }],
            },
            'network': {
                'io': {
                    'bytes_sent': net_tx,
                    'bytes_recv': net_rx,
                    'bytes_sent_human': h(net_tx),
                    'bytes_recv_human': h(net_rx),
                },
            },
            'load_average': {
                '1min': flat.get('load_avg_1'),
                '5min': flat.get('load_avg_5'),
                '15min': flat.get('load_avg_15'),
            },
        }
        # Merge — flat keys preserved for legacy consumers
        merged = dict(flat)
        merged.update(nested)
        return merged

    @classmethod
    def get_system_metrics(cls, server_id: str, user_id: int = None) -> Dict[str, Any]:
        """Get system metrics from a remote server"""
        if not server_id or server_id == 'local':
            from app.services.system_service import SystemService
            try:
                metrics = SystemService.get_all_metrics()
                return {'success': True, 'data': metrics}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        result = dispatch_agent_command(
            server_id=server_id,
            action='system:metrics',
            params={},
            user_id=user_id
        )
        if result.get('success') and isinstance(result.get('data'), dict):
            result = dict(result)
            result['data'] = cls._normalize_agent_metrics(result['data'])
        return result

    @staticmethod
    def get_system_info(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """Get system info from a remote server"""
        if not server_id or server_id == 'local':
            from app.services.system_service import SystemService
            try:
                info = SystemService.get_system_info()
                return {'success': True, 'data': info}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='system:info',
            params={},
            user_id=user_id
        )

    # ==================== Utility ====================

    @staticmethod
    def get_available_servers(user=None) -> List[Dict[str, Any]]:
        """
        Get list of available servers for Docker operations.

        Returns servers that are online and have Docker permissions.
        """
        # Always include local server. Its capacity is read live rather than
        # from the Server table — there is no Server row for the panel host.
        servers = [{
            'id': 'local',
            'name': 'Local (this server)',
            'status': 'online',
            'is_local': True,
            **RemoteDockerService._local_capacity(),
        }]

        # Get remote servers
        connected_ids = set(agent_registry.get_connected_servers())

        query = Server.query.filter(Server.status.in_(['online', 'connecting']))
        if user is not None:
            from app.services.workspace_service import WorkspaceService
            query = WorkspaceService.filter_accessible_servers(query, user)
        remote_servers = query.all()

        for server in remote_servers:
            has_docker_perm = server.has_permission('docker:container:read')
            # Capabilities and allowed_paths are only meaningful when the
            # agent is actually connected (in-memory registry state).
            caps = agent_registry.get_capabilities(server.id) if server.id in connected_ids else None
            allowed_paths = agent_registry.get_allowed_paths(server.id) if server.id in connected_ids else []
            servers.append({
                'id': server.id,
                'name': server.name,
                'status': 'online' if server.id in connected_ids else server.status,
                'is_local': False,
                'has_docker': has_docker_perm,
                'group_name': server.group.name if server.group else None,
                'capabilities': caps or {},
                'allowed_paths': allowed_paths,
                # linux/windows/darwin — lets target-aware UIs (File Manager
                # quick links) offer paths that exist on that box.
                'os_type': server.os_type,
                # Agent's self-reported footprint (null until an agent that
                # reports it connects) — preferred over installer conventions.
                'agent_install_dir': server.agent_install_dir,
                'agent_config_dir': server.agent_config_dir,
                # Capacity, so placement UIs (the template deploy drawer) can
                # show what a target actually has before you pick it. Null until
                # an agent reports system info.
                'cpu_cores': server.cpu_cores,
                'total_memory': server.total_memory,
                'total_disk': server.total_disk,
            })

        return servers

    @staticmethod
    def _local_capacity() -> Dict[str, Any]:
        """Best-effort CPU/RAM/disk for the panel host. Absent psutil (or on a
        platform where a probe raises) the keys come back null and capacity is
        simply not shown — never a hard failure of the server list."""
        capacity = {'cpu_cores': None, 'total_memory': None, 'total_disk': None}
        try:
            import psutil
            capacity['cpu_cores'] = psutil.cpu_count(logical=True)
            capacity['total_memory'] = psutil.virtual_memory().total
            capacity['total_disk'] = psutil.disk_usage('/').total
        except Exception:
            pass
        return capacity

    # ==================== Docker Compose ====================

    @staticmethod
    def compose_list(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """
        List compose projects on a remote server.

        Args:
            server_id: Target server ID
            user_id: User ID for audit logging

        Returns:
            dict: {success, data: [projects], error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                projects = DockerService.compose_list()
                return {'success': True, 'data': projects}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:list',
            params={},
            user_id=user_id
        )

    @staticmethod
    def compose_ps(server_id: str, project_path: str, user_id: int = None) -> Dict[str, Any]:
        """
        List containers for a compose project.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            user_id: User ID for audit logging

        Returns:
            dict: {success, data: [containers], error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                containers = DockerService.compose_ps(project_path)
                return {'success': True, 'data': containers}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:ps',
            params={'project_path': project_path},
            user_id=user_id
        )

    @staticmethod
    def compose_up(server_id: str, project_path: str, detach: bool = True,
                   build: bool = False, user_id: int = None) -> Dict[str, Any]:
        """
        Start a compose project.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            detach: Run in detached mode
            build: Build images before starting
            user_id: User ID for audit logging

        Returns:
            dict: {success, output, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                result = DockerService.compose_up(project_path, detach=detach, build=build)
                return {'success': True, 'data': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:up',
            params={
                'project_path': project_path,
                'detach': detach,
                'build': build
            },
            timeout=300.0,  # 5 minutes for compose up
            user_id=user_id
        )

    @staticmethod
    def compose_down(server_id: str, project_path: str, volumes: bool = False,
                     remove_orphans: bool = True, user_id: int = None) -> Dict[str, Any]:
        """
        Stop a compose project.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            volumes: Remove volumes
            remove_orphans: Remove orphan containers
            user_id: User ID for audit logging

        Returns:
            dict: {success, output, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                result = DockerService.compose_down(project_path, volumes=volumes, remove_orphans=remove_orphans)
                return {'success': True, 'data': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:down',
            params={
                'project_path': project_path,
                'volumes': volumes,
                'remove_orphans': remove_orphans
            },
            timeout=120.0,  # 2 minutes for compose down
            user_id=user_id
        )

    @staticmethod
    def compose_logs(server_id: str, project_path: str, service: str = None,
                     tail: int = 100, user_id: int = None) -> Dict[str, Any]:
        """
        Get logs from a compose project.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            service: Specific service name (optional)
            tail: Number of lines to retrieve
            user_id: User ID for audit logging

        Returns:
            dict: {success, data: {logs: str}, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                logs = DockerService.compose_logs(project_path, service=service, tail=tail)
                return {'success': True, 'data': {'logs': logs}}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:logs',
            params={
                'project_path': project_path,
                'service': service or '',
                'tail': tail
            },
            timeout=30.0,
            user_id=user_id
        )

    @staticmethod
    def compose_restart(server_id: str, project_path: str, service: str = None,
                        user_id: int = None) -> Dict[str, Any]:
        """
        Restart a compose project or specific service.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            service: Specific service name (optional)
            user_id: User ID for audit logging

        Returns:
            dict: {success, output, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                result = DockerService.compose_restart(project_path, service=service)
                return {'success': True, 'data': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:restart',
            params={
                'project_path': project_path,
                'service': service or ''
            },
            user_id=user_id
        )

    @staticmethod
    def compose_pull(server_id: str, project_path: str, service: str = None,
                     user_id: int = None) -> Dict[str, Any]:
        """
        Pull images for a compose project.

        Args:
            server_id: Target server ID
            project_path: Path to docker-compose.yml
            service: Specific service name (optional)
            user_id: User ID for audit logging

        Returns:
            dict: {success, output, error}
        """
        if not server_id or server_id == 'local':
            from app.services.docker_service import DockerService
            try:
                result = DockerService.compose_pull(project_path, service=service)
                return {'success': True, 'data': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return dispatch_agent_command(
            server_id=server_id,
            action='docker:compose:pull',
            params={
                'project_path': project_path,
                'service': service or ''
            },
            timeout=300.0,  # 5 minutes for pull
            user_id=user_id
        )
