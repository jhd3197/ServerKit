"""Remote Docker and Compose routes for a paired server.

Registered on the shared ``servers_bp`` blueprint (see app.api.servers)."""
from app.services.remote_docker_service import RemoteDockerService
from app.middleware.rbac import developer_required, get_current_user
from app.exceptions import field_required
from flask_jwt_extended import get_jwt_identity, jwt_required
from flask import jsonify, request
from app.api.servers import _agent_failure_status, _get_operable_server, servers_bp
from app.api._request import json_object


# ==================== Remote Docker Operations ====================


@servers_bp.route('/available', methods=['GET'])
@jwt_required()
def get_available_servers():
    """Get list of servers available for Docker operations"""
    servers = RemoteDockerService.get_available_servers(get_current_user())
    return jsonify(servers)


@servers_bp.route('/<server_id>/docker/containers', methods=['GET'])
@jwt_required()
def list_remote_containers(server_id):
    """List containers on a remote server"""
    _get_operable_server(server_id)
    all_containers = request.args.get('all', 'false').lower() == 'true'
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_containers(server_id, all=all_containers, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['GET'])
@jwt_required()
def inspect_remote_container(server_id, container_id):
    """Inspect a container on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.inspect_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/containers/<container_id>/start', methods=['POST'])
@developer_required
def start_remote_container(server_id, container_id):
    """Start a container on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.start_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Container started'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stop', methods=['POST'])
@developer_required
def stop_remote_container(server_id, container_id):
    """Stop a container on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()
    timeout = data.get('timeout')

    result = RemoteDockerService.stop_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Container stopped'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/restart', methods=['POST'])
@developer_required
def restart_remote_container(server_id, container_id):
    """Restart a container on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()
    timeout = data.get('timeout')

    result = RemoteDockerService.restart_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Container restarted'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['DELETE'])
@developer_required
def remove_remote_container(server_id, container_id):
    """Remove a container on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'
    remove_volumes = request.args.get('v', 'false').lower() == 'true'

    result = RemoteDockerService.remove_container(
        server_id, container_id,
        force=force, remove_volumes=remove_volumes,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Container removed'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stats', methods=['GET'])
@jwt_required()
def get_remote_container_stats(server_id, container_id):
    """Get container stats from a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_container_stats(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/containers/<container_id>/logs', methods=['GET'])
@jwt_required()
def get_remote_container_logs(server_id, container_id):
    """
    Get container logs from a remote server.

    Query params:
        tail: Number of lines (default 100, 'all' for all lines)
        since: Show logs since timestamp
        timestamps: Include timestamps (default true)
    """
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    tail = request.args.get('tail', '100')
    since = request.args.get('since')
    timestamps = request.args.get('timestamps', 'true').lower() == 'true'

    result = RemoteDockerService.get_container_logs(
        server_id, container_id,
        tail=tail, since=since, timestamps=timestamps,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/images', methods=['GET'])
@jwt_required()
def list_remote_images(server_id):
    """List images on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_images(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/images/pull', methods=['POST'])
@developer_required
def pull_remote_image(server_id):
    """Pull an image on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('image'):
        return jsonify({'error': 'Image name required'}), 400

    result = RemoteDockerService.pull_image(server_id, data['image'], user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/images/<image_id>', methods=['DELETE'])
@developer_required
def remove_remote_image(server_id, image_id):
    """Remove an image on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'

    result = RemoteDockerService.remove_image(server_id, image_id, force=force, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Image removed'})


@servers_bp.route('/<server_id>/docker/volumes', methods=['GET'])
@jwt_required()
def list_remote_volumes(server_id):
    """List volumes on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_volumes(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/volumes/<volume_name>', methods=['DELETE'])
@developer_required
def remove_remote_volume(server_id, volume_name):
    """Remove a volume on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'

    result = RemoteDockerService.remove_volume(server_id, volume_name, force=force, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Volume removed'})


@servers_bp.route('/<server_id>/docker/networks', methods=['GET'])
@jwt_required()
def list_remote_networks(server_id):
    """List networks on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_networks(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/networks/<network_id>', methods=['DELETE'])
@developer_required
def remove_remote_network(server_id, network_id):
    """Remove a network on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.remove_network(server_id, network_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify({'message': 'Network removed'})


@servers_bp.route('/<server_id>/system/metrics', methods=['GET'])
@jwt_required()
def get_remote_system_metrics(server_id):
    """Get system metrics from a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_metrics(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/system/info', methods=['GET'])
@jwt_required()
def get_remote_system_info(server_id):
    """Get system info from a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_info(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


# ==================== Remote Docker Compose Operations ====================

@servers_bp.route('/<server_id>/docker/compose/projects', methods=['GET'])
@jwt_required()
def list_remote_compose_projects(server_id):
    """List compose projects on a remote server"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()

    result = RemoteDockerService.compose_list(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/compose/ps', methods=['POST'])
@developer_required
def remote_compose_ps(server_id):
    """List containers for a compose project"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_ps(
        server_id,
        data['project_path'],
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/compose/up', methods=['POST'])
@developer_required
def remote_compose_up(server_id):
    """Start a compose project"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_up(
        server_id,
        data['project_path'],
        detach=data.get('detach', True),
        build=data.get('build', False),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/down', methods=['POST'])
@developer_required
def remote_compose_down(server_id):
    """Stop a compose project"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_down(
        server_id,
        data['project_path'],
        volumes=data.get('volumes', False),
        remove_orphans=data.get('remove_orphans', True),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/logs', methods=['POST'])
@developer_required
def remote_compose_logs(server_id):
    """Get logs from a compose project"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_logs(
        server_id,
        data['project_path'],
        service=data.get('service'),
        tail=data.get('tail', 100),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/compose/restart', methods=['POST'])
@developer_required
def remote_compose_restart(server_id):
    """Restart a compose project or specific service"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_restart(
        server_id,
        data['project_path'],
        service=data.get('service'),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/pull', methods=['POST'])
@developer_required
def remote_compose_pull(server_id):
    """Pull images for a compose project"""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_pull(
        server_id,
        data['project_path'],
        service=data.get('service'),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)
