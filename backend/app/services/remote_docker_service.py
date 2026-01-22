"""
Remote Docker Service

Provides Docker operations on remote servers via agents.
This service routes Docker commands to the appropriate agent
and returns the results.
"""

from typing import Optional, List, Dict, Any
from flask_jwt_extended import get_jwt_identity

from app.services.agent_registry import agent_registry
from app.models.server import Server


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
                containers = DockerService.list_containers(all=all)
                return {'success': True, 'data': containers}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return agent_registry.send_command(
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
                info = DockerService.inspect_container(container_id)
                return {'success': True, 'data': info}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
            server_id=server_id,
            action='docker:container:stats',
            params={'id': container_id},
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
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

        return agent_registry.send_command(
            server_id=server_id,
            action='docker:network:list',
            params={},
            user_id=user_id
        )

    # ==================== System ====================

    @staticmethod
    def get_system_metrics(server_id: str, user_id: int = None) -> Dict[str, Any]:
        """Get system metrics from a remote server"""
        if not server_id or server_id == 'local':
            from app.services.system_service import SystemService
            try:
                metrics = SystemService.get_all_metrics()
                return {'success': True, 'data': metrics}
            except Exception as e:
                return {'success': False, 'error': str(e)}

        return agent_registry.send_command(
            server_id=server_id,
            action='system:metrics',
            params={},
            user_id=user_id
        )

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

        return agent_registry.send_command(
            server_id=server_id,
            action='system:info',
            params={},
            user_id=user_id
        )

    # ==================== Utility ====================

    @staticmethod
    def get_available_servers() -> List[Dict[str, Any]]:
        """
        Get list of available servers for Docker operations.

        Returns servers that are online and have Docker permissions.
        """
        # Always include local server
        servers = [{
            'id': 'local',
            'name': 'Local (this server)',
            'status': 'online',
            'is_local': True
        }]

        # Get remote servers
        connected_ids = set(agent_registry.get_connected_servers())

        remote_servers = Server.query.filter(
            Server.status.in_(['online', 'connecting'])
        ).all()

        for server in remote_servers:
            has_docker_perm = server.has_permission('docker:container:read')
            servers.append({
                'id': server.id,
                'name': server.name,
                'status': 'online' if server.id in connected_ids else server.status,
                'is_local': False,
                'has_docker': has_docker_perm,
                'group_name': server.group.name if server.group else None
            })

        return servers
