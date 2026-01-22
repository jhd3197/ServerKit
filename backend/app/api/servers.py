"""
Server Management API

Endpoints for managing remote servers and their agents.
"""

import os
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, Response, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from app import db
from app.models import User
from app.models.server import Server, ServerGroup, ServerMetrics, ServerCommand, AgentSession
from app.services.agent_registry import agent_registry
from app.middleware.rbac import admin_required, developer_required

servers_bp = Blueprint('servers', __name__)


# ==================== Permission Profiles ====================

PERMISSION_PROFILES = {
    'docker_readonly': {
        'name': 'Docker Read-Only',
        'description': 'View containers, images, and metrics',
        'permissions': [
            'docker:container:read',
            'docker:image:read',
            'docker:compose:read',
            'docker:volume:read',
            'docker:network:read',
            'system:metrics:read',
        ]
    },
    'docker_manager': {
        'name': 'Docker Manager',
        'description': 'Full Docker management and metrics',
        'permissions': [
            'docker:container:*',
            'docker:image:*',
            'docker:compose:*',
            'docker:volume:*',
            'docker:network:*',
            'system:metrics:read',
            'system:logs:read',
        ]
    },
    'full_access': {
        'name': 'Full Access',
        'description': 'All permissions including system commands',
        'permissions': ['*']
    }
}


# ==================== Server Groups ====================

@servers_bp.route('/groups', methods=['GET'])
@jwt_required()
def list_groups():
    """List all server groups"""
    groups = ServerGroup.query.all()
    return jsonify([g.to_dict() for g in groups])


@servers_bp.route('/groups', methods=['POST'])
@jwt_required()
@developer_required
def create_group():
    """Create a new server group"""
    data = request.get_json()

    if not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400

    group = ServerGroup(
        name=data['name'],
        description=data.get('description'),
        color=data.get('color', '#6366f1'),
        icon=data.get('icon', 'server'),
        parent_id=data.get('parent_id')
    )

    db.session.add(group)
    db.session.commit()

    return jsonify(group.to_dict()), 201


@servers_bp.route('/groups/<group_id>', methods=['GET'])
@jwt_required()
def get_group(group_id):
    """Get a server group by ID"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    return jsonify(group.to_dict(include_servers=True))


@servers_bp.route('/groups/<group_id>', methods=['PUT'])
@jwt_required()
@developer_required
def update_group(group_id):
    """Update a server group"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    data = request.get_json()

    if 'name' in data:
        group.name = data['name']
    if 'description' in data:
        group.description = data['description']
    if 'color' in data:
        group.color = data['color']
    if 'icon' in data:
        group.icon = data['icon']
    if 'parent_id' in data:
        group.parent_id = data['parent_id']

    db.session.commit()
    return jsonify(group.to_dict())


@servers_bp.route('/groups/<group_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_group(group_id):
    """Delete a server group"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    # Move servers to no group
    for server in group.servers:
        server.group_id = None

    db.session.delete(group)
    db.session.commit()

    return jsonify({'message': 'Group deleted'})


# ==================== Servers ====================

@servers_bp.route('', methods=['GET'])
@jwt_required()
def list_servers():
    """List all servers"""
    # Query parameters
    group_id = request.args.get('group_id')
    status = request.args.get('status')
    tag = request.args.get('tag')

    query = Server.query

    if group_id:
        query = query.filter_by(group_id=group_id)
    if status:
        query = query.filter_by(status=status)
    if tag:
        query = query.filter(Server.tags.contains([tag]))

    servers = query.order_by(Server.name).all()

    # Add connection status
    result = []
    for server in servers:
        server_dict = server.to_dict()
        server_dict['is_connected'] = agent_registry.is_agent_connected(server.id)
        result.append(server_dict)

    return jsonify(result)


@servers_bp.route('', methods=['POST'])
@jwt_required()
@developer_required
def create_server():
    """
    Create a new server and generate registration token.

    Returns server info with registration token for agent installation.
    """
    data = request.get_json()
    user_id = get_jwt_identity()

    if not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400

    # Generate registration token
    registration_token = Server.generate_registration_token()

    # Get permissions from profile or custom list
    permissions = data.get('permissions', [])
    profile = data.get('permission_profile')
    if profile and profile in PERMISSION_PROFILES:
        permissions = PERMISSION_PROFILES[profile]['permissions']

    server = Server(
        name=data['name'],
        description=data.get('description'),
        group_id=data.get('group_id'),
        tags=data.get('tags', []),
        permissions=permissions,
        allowed_ips=data.get('allowed_ips', []),
        registered_by=user_id,
        registration_token_expires=datetime.utcnow() + timedelta(hours=24)
    )
    server.set_registration_token(registration_token)

    db.session.add(server)
    db.session.commit()

    result = server.to_dict()
    result['registration_token'] = registration_token
    result['registration_expires'] = server.registration_token_expires.isoformat()

    return jsonify(result), 201


@servers_bp.route('/<server_id>', methods=['GET'])
@jwt_required()
def get_server(server_id):
    """Get a server by ID"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    result = server.to_dict(include_metrics=True)
    result['is_connected'] = agent_registry.is_agent_connected(server.id)

    return jsonify(result)


@servers_bp.route('/<server_id>', methods=['PUT'])
@jwt_required()
@developer_required
def update_server(server_id):
    """Update a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    data = request.get_json()

    if 'name' in data:
        server.name = data['name']
    if 'description' in data:
        server.description = data['description']
    if 'group_id' in data:
        server.group_id = data['group_id']
    if 'tags' in data:
        server.tags = data['tags']
    if 'permissions' in data:
        server.permissions = data['permissions']
    if 'allowed_ips' in data:
        server.allowed_ips = data['allowed_ips']

    # Handle permission profile
    if 'permission_profile' in data:
        profile = data['permission_profile']
        if profile in PERMISSION_PROFILES:
            server.permissions = PERMISSION_PROFILES[profile]['permissions']

    db.session.commit()
    return jsonify(server.to_dict())


@servers_bp.route('/<server_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_server(server_id):
    """Delete a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    # Disconnect agent if connected
    if agent_registry.is_agent_connected(server_id):
        # TODO: Send disconnect command to agent
        pass

    db.session.delete(server)
    db.session.commit()

    return jsonify({'message': 'Server deleted'})


# ==================== Registration ====================

@servers_bp.route('/<server_id>/regenerate-token', methods=['POST'])
@jwt_required()
@developer_required
def regenerate_token(server_id):
    """Regenerate registration token for a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    registration_token = Server.generate_registration_token()
    server.set_registration_token(registration_token)
    server.registration_token_expires = datetime.utcnow() + timedelta(hours=24)
    server.status = 'pending'
    server.agent_id = None

    db.session.commit()

    return jsonify({
        'registration_token': registration_token,
        'registration_expires': server.registration_token_expires.isoformat()
    })


@servers_bp.route('/register', methods=['POST'])
def register_agent():
    """
    Agent registration endpoint.

    Called by agents during initial setup.

    Expected data:
    {
        "token": "sk_reg_xxx",
        "name": "server-name",
        "system_info": {...},
        "agent_version": "1.0.0"
    }
    """
    data = request.get_json()

    token = data.get('token')
    if not token:
        return jsonify({'error': 'Registration token required'}), 400

    # Find server by token (need to check all servers)
    server = None
    for s in Server.query.filter(Server.registration_token_hash.isnot(None)).all():
        if s.verify_registration_token(token):
            server = s
            break

    if not server:
        return jsonify({'error': 'Invalid or expired registration token'}), 401

    # Generate API credentials
    api_key, api_secret = Server.generate_api_credentials()

    # Update server with agent info
    server.agent_id = data.get('agent_id') or str(__import__('uuid').uuid4())
    server.set_api_key(api_key)
    server.status = 'connecting'
    server.registered_at = datetime.utcnow()

    # Clear registration token (single use)
    server.registration_token_hash = None
    server.registration_token_expires = None

    # Update system info if provided
    system_info = data.get('system_info', {})
    if system_info:
        server.hostname = system_info.get('hostname', server.hostname)
        server.os_type = system_info.get('os', server.os_type)
        server.os_version = system_info.get('platform_version', server.os_version)
        server.platform = system_info.get('platform', server.platform)
        server.architecture = system_info.get('architecture', server.architecture)
        server.cpu_cores = system_info.get('cpu_cores', server.cpu_cores)
        server.total_memory = system_info.get('total_memory', server.total_memory)
        server.total_disk = system_info.get('total_disk', server.total_disk)

    server.agent_version = data.get('agent_version')

    # Update name if provided and different
    if data.get('name') and not server.name:
        server.name = data['name']

    db.session.commit()

    # Construct WebSocket URL
    ws_scheme = 'wss' if request.is_secure else 'ws'
    ws_url = f"{ws_scheme}://{request.host}/agent"

    return jsonify({
        'agent_id': server.agent_id,
        'name': server.name,
        'api_key': api_key,
        'api_secret': api_secret,
        'websocket_url': ws_url,
        'server_id': server.id
    })


# ==================== Server Status ====================

@servers_bp.route('/<server_id>/status', methods=['GET'])
@jwt_required()
def get_server_status(server_id):
    """Get current server status and live metrics"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    is_connected = agent_registry.is_agent_connected(server_id)

    result = {
        'id': server.id,
        'name': server.name,
        'status': 'online' if is_connected else server.status,
        'is_connected': is_connected,
        'last_seen': server.last_seen.isoformat() if server.last_seen else None,
        'last_error': server.last_error,
    }

    # Get latest metrics
    latest_metrics = server.metrics.order_by(ServerMetrics.timestamp.desc()).first()
    if latest_metrics:
        result['metrics'] = latest_metrics.to_dict()

    return jsonify(result)


@servers_bp.route('/<server_id>/ping', methods=['POST'])
@jwt_required()
def ping_server(server_id):
    """Force a ping/health check on a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    if not agent_registry.is_agent_connected(server_id):
        return jsonify({
            'success': False,
            'error': 'Agent not connected'
        })

    # Send system:metrics command to get fresh data
    result = agent_registry.send_command(
        server_id=server_id,
        action='system:metrics',
        timeout=10.0
    )

    return jsonify(result)


# ==================== Metrics ====================

@servers_bp.route('/<server_id>/metrics', methods=['GET'])
@jwt_required()
def get_server_metrics(server_id):
    """Get historical metrics for a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    # Query parameters
    from_time = request.args.get('from')
    to_time = request.args.get('to')
    limit = request.args.get('limit', 100, type=int)

    query = ServerMetrics.query.filter_by(server_id=server_id)

    if from_time:
        try:
            from_dt = datetime.fromisoformat(from_time.replace('Z', '+00:00'))
            query = query.filter(ServerMetrics.timestamp >= from_dt)
        except:
            pass

    if to_time:
        try:
            to_dt = datetime.fromisoformat(to_time.replace('Z', '+00:00'))
            query = query.filter(ServerMetrics.timestamp <= to_dt)
        except:
            pass

    metrics = query.order_by(ServerMetrics.timestamp.desc()).limit(limit).all()

    return jsonify([m.to_dict() for m in reversed(metrics)])


@servers_bp.route('/metrics/compare', methods=['GET'])
@jwt_required()
def compare_server_metrics():
    """Compare metrics across multiple servers"""
    server_ids = request.args.get('ids', '').split(',')
    metric = request.args.get('metric', 'cpu_percent')
    limit = request.args.get('limit', 50, type=int)

    if not server_ids or server_ids == ['']:
        return jsonify({'error': 'Server IDs required'}), 400

    result = {}
    for server_id in server_ids:
        server = Server.query.get(server_id)
        if not server:
            continue

        metrics = ServerMetrics.query.filter_by(server_id=server_id)\
            .order_by(ServerMetrics.timestamp.desc())\
            .limit(limit)\
            .all()

        result[server_id] = {
            'name': server.name,
            'data': [
                {
                    'timestamp': m.timestamp.isoformat(),
                    'value': getattr(m, metric, None)
                }
                for m in reversed(metrics)
            ]
        }

    return jsonify(result)


# ==================== Server Overview ====================

@servers_bp.route('/overview', methods=['GET'])
@jwt_required()
def get_servers_overview():
    """Get overview of all servers health"""
    servers = Server.query.all()
    connected_ids = set(agent_registry.get_connected_servers())

    total = len(servers)
    online = len(connected_ids)
    offline = total - online

    total_containers = 0
    total_running = 0

    servers_data = []
    for server in servers:
        is_online = server.id in connected_ids

        # Get latest metrics
        latest = server.metrics.order_by(ServerMetrics.timestamp.desc()).first()

        server_summary = {
            'id': server.id,
            'name': server.name,
            'status': 'online' if is_online else server.status,
            'group_id': server.group_id,
            'group_name': server.group.name if server.group else None,
            'tags': server.tags or [],
        }

        if latest:
            server_summary['cpu_percent'] = latest.cpu_percent
            server_summary['memory_percent'] = latest.memory_percent
            server_summary['disk_percent'] = latest.disk_percent
            server_summary['container_count'] = latest.container_count
            server_summary['container_running'] = latest.container_running

            if latest.container_count:
                total_containers += latest.container_count
            if latest.container_running:
                total_running += latest.container_running

        servers_data.append(server_summary)

    return jsonify({
        'summary': {
            'total': total,
            'online': online,
            'offline': offline,
            'total_containers': total_containers,
            'running_containers': total_running,
        },
        'servers': servers_data
    })


# ==================== Command History ====================

@servers_bp.route('/<server_id>/commands', methods=['GET'])
@jwt_required()
def get_command_history(server_id):
    """Get command history for a server"""
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    limit = request.args.get('limit', 50, type=int)

    commands = ServerCommand.query.filter_by(server_id=server_id)\
        .order_by(ServerCommand.created_at.desc())\
        .limit(limit)\
        .all()

    return jsonify([c.to_dict() for c in commands])


# ==================== Permission Profiles ====================

@servers_bp.route('/permission-profiles', methods=['GET'])
@jwt_required()
def get_permission_profiles():
    """Get available permission profiles"""
    return jsonify(PERMISSION_PROFILES)


# ==================== Remote Docker Operations ====================

from app.services.remote_docker_service import RemoteDockerService


@servers_bp.route('/available', methods=['GET'])
@jwt_required()
def get_available_servers():
    """Get list of servers available for Docker operations"""
    servers = RemoteDockerService.get_available_servers()
    return jsonify(servers)


@servers_bp.route('/<server_id>/docker/containers', methods=['GET'])
@jwt_required()
def list_remote_containers(server_id):
    """List containers on a remote server"""
    all_containers = request.args.get('all', 'false').lower() == 'true'
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_containers(server_id, all=all_containers, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500 if result.get('code') != 'AGENT_OFFLINE' else 503

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['GET'])
@jwt_required()
def inspect_remote_container(server_id, container_id):
    """Inspect a container on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.inspect_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/containers/<container_id>/start', methods=['POST'])
@jwt_required()
@developer_required
def start_remote_container(server_id, container_id):
    """Start a container on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.start_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container started'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stop', methods=['POST'])
@jwt_required()
@developer_required
def stop_remote_container(server_id, container_id):
    """Stop a container on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    timeout = data.get('timeout')

    result = RemoteDockerService.stop_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container stopped'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/restart', methods=['POST'])
@jwt_required()
@developer_required
def restart_remote_container(server_id, container_id):
    """Restart a container on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    timeout = data.get('timeout')

    result = RemoteDockerService.restart_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container restarted'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['DELETE'])
@jwt_required()
@developer_required
def remove_remote_container(server_id, container_id):
    """Remove a container on a remote server"""
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'
    remove_volumes = request.args.get('v', 'false').lower() == 'true'

    result = RemoteDockerService.remove_container(
        server_id, container_id,
        force=force, remove_volumes=remove_volumes,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container removed'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stats', methods=['GET'])
@jwt_required()
def get_remote_container_stats(server_id, container_id):
    """Get container stats from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_container_stats(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/images', methods=['GET'])
@jwt_required()
def list_remote_images(server_id):
    """List images on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_images(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/images/pull', methods=['POST'])
@jwt_required()
@developer_required
def pull_remote_image(server_id):
    """Pull an image on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('image'):
        return jsonify({'error': 'Image name required'}), 400

    result = RemoteDockerService.pull_image(server_id, data['image'], user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/images/<image_id>', methods=['DELETE'])
@jwt_required()
@developer_required
def remove_remote_image(server_id, image_id):
    """Remove an image on a remote server"""
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'

    result = RemoteDockerService.remove_image(server_id, image_id, force=force, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Image removed'})


@servers_bp.route('/<server_id>/docker/volumes', methods=['GET'])
@jwt_required()
def list_remote_volumes(server_id):
    """List volumes on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_volumes(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/networks', methods=['GET'])
@jwt_required()
def list_remote_networks(server_id):
    """List networks on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_networks(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/system/metrics', methods=['GET'])
@jwt_required()
def get_remote_system_metrics(server_id):
    """Get system metrics from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_metrics(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/system/info', methods=['GET'])
@jwt_required()
def get_remote_system_info(server_id):
    """Get system info from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_info(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


# ==================== Installation Scripts ====================

def _get_scripts_dir():
    """Get the scripts directory path"""
    # Go up from backend/app/api to backend, then to scripts
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    return os.path.join(base_dir, 'scripts')


@servers_bp.route('/install.sh', methods=['GET'])
def get_install_script_linux():
    """
    Get the Linux installation script.

    This endpoint serves the bash installation script for installing
    the ServerKit agent on Linux systems.

    Usage:
        curl -fsSL https://your-server/api/servers/install.sh | sudo bash -s -- \\
            --token "YOUR_TOKEN" --server "https://your-server"
    """
    script_path = os.path.join(_get_scripts_dir(), 'install.sh')

    if not os.path.exists(script_path):
        return jsonify({'error': 'Installation script not found'}), 404

    with open(script_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace placeholder URLs with actual server URL
    server_url = request.url_root.rstrip('/')
    content = content.replace('https://your-serverkit.com', server_url)

    return Response(
        content,
        mimetype='text/x-shellscript',
        headers={
            'Content-Disposition': 'inline; filename="install.sh"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install.ps1', methods=['GET'])
def get_install_script_windows():
    """
    Get the Windows installation script.

    This endpoint serves the PowerShell installation script for installing
    the ServerKit agent on Windows systems.

    Usage:
        irm https://your-server/api/servers/install.ps1 | iex; \\
            Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "https://your-server"
    """
    script_path = os.path.join(_get_scripts_dir(), 'install.ps1')

    if not os.path.exists(script_path):
        return jsonify({'error': 'Installation script not found'}), 404

    with open(script_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace placeholder URLs with actual server URL
    server_url = request.url_root.rstrip('/')
    content = content.replace('https://your-serverkit.com', server_url)

    return Response(
        content,
        mimetype='text/plain',
        headers={
            'Content-Disposition': 'inline; filename="install.ps1"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install-instructions/<server_id>', methods=['GET'])
@jwt_required()
def get_install_instructions(server_id):
    """
    Get installation instructions for a specific server.

    Returns the installation commands with the server's registration token
    already embedded.
    """
    server = Server.query.get(server_id)
    if not server:
        return jsonify({'error': 'Server not found'}), 404

    # Check if server has a valid registration token
    if not server.registration_token_hash:
        return jsonify({
            'error': 'No registration token available',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    if server.registration_token_expires and server.registration_token_expires < datetime.utcnow():
        return jsonify({
            'error': 'Registration token expired',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    # Get base URL
    base_url = request.url_root.rstrip('/')
    api_url = f"{base_url}/api/servers"

    return jsonify({
        'linux': {
            'one_liner': f'curl -fsSL {api_url}/install.sh | sudo bash -s -- --token "YOUR_TOKEN" --server "{base_url}"',
            'manual': [
                f'# Download the script',
                f'curl -fsSL {api_url}/install.sh -o install.sh',
                f'chmod +x install.sh',
                f'',
                f'# Run installation',
                f'sudo ./install.sh --token "YOUR_TOKEN" --server "{base_url}"'
            ]
        },
        'windows': {
            'one_liner': f'irm {api_url}/install.ps1 | iex; Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "{base_url}"',
            'manual': [
                f'# Download the script (run in PowerShell as Administrator)',
                f'Invoke-WebRequest -Uri "{api_url}/install.ps1" -OutFile install.ps1',
                f'',
                f'# Run installation',
                f'.\\install.ps1 -Token "YOUR_TOKEN" -Server "{base_url}"'
            ]
        },
        'note': 'Replace YOUR_TOKEN with the registration token shown in the UI'
    })
