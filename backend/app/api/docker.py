from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.docker_service import DockerService
from app import db, paths

docker_bp = Blueprint('docker', __name__)


def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


# ==================== DOCKER STATUS ====================

@docker_bp.route('/status', methods=['GET'])
@jwt_required()
def get_docker_status():
    """Check if Docker is installed and running."""
    status = DockerService.is_docker_installed()
    return jsonify(status), 200


@docker_bp.route('/info', methods=['GET'])
@jwt_required()
def get_docker_info():
    """Get Docker system information."""
    info = DockerService.get_docker_info()
    if info:
        return jsonify({'info': info}), 200
    return jsonify({'error': 'Could not get Docker info'}), 400


@docker_bp.route('/disk-usage', methods=['GET'])
@jwt_required()
def get_disk_usage():
    """Get Docker disk usage."""
    usage = DockerService.get_disk_usage()
    return jsonify({'usage': usage}), 200


# ==================== CONTAINER MANAGEMENT ====================

@docker_bp.route('/containers', methods=['GET'])
@jwt_required()
def list_containers():
    """List all containers."""
    all_containers = request.args.get('all', 'true').lower() == 'true'
    containers = DockerService.list_containers(all_containers)
    return jsonify({'containers': containers}), 200


@docker_bp.route('/containers/<container_id>', methods=['GET'])
@jwt_required()
def get_container(container_id):
    """Get container details."""
    container = DockerService.get_container(container_id)
    if container:
        return jsonify({'container': container}), 200
    return jsonify({'error': 'Container not found'}), 404


@docker_bp.route('/containers', methods=['POST'])
@jwt_required()
@admin_required
def create_container():
    """Create a new container."""
    data = request.get_json()

    if not data or 'image' not in data:
        return jsonify({'error': 'image is required'}), 400

    result = DockerService.create_container(
        image=data['image'],
        name=data.get('name'),
        ports=data.get('ports', []),
        volumes=data.get('volumes', []),
        env=data.get('env', {}),
        network=data.get('network'),
        restart_policy=data.get('restart_policy', 'unless-stopped'),
        command=data.get('command')
    )

    return jsonify(result), 201 if result['success'] else 400


@docker_bp.route('/containers/run', methods=['POST'])
@jwt_required()
@admin_required
def run_container():
    """Run a new container (create and start)."""
    data = request.get_json()

    if not data or 'image' not in data:
        return jsonify({'error': 'image is required'}), 400

    result = DockerService.run_container(
        image=data['image'],
        name=data.get('name'),
        ports=data.get('ports', []),
        volumes=data.get('volumes', []),
        env=data.get('env', {}),
        network=data.get('network'),
        restart_policy=data.get('restart_policy', 'unless-stopped'),
        command=data.get('command')
    )

    return jsonify(result), 201 if result['success'] else 400


@docker_bp.route('/containers/<container_id>/start', methods=['POST'])
@jwt_required()
@admin_required
def start_container(container_id):
    """Start a container."""
    result = DockerService.start_container(container_id)
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/containers/<container_id>/stop', methods=['POST'])
@jwt_required()
@admin_required
def stop_container(container_id):
    """Stop a container."""
    data = request.get_json() or {}
    timeout = data.get('timeout', 10)
    result = DockerService.stop_container(container_id, timeout)
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/containers/<container_id>/restart', methods=['POST'])
@jwt_required()
@admin_required
def restart_container(container_id):
    """Restart a container."""
    data = request.get_json() or {}
    timeout = data.get('timeout', 10)
    result = DockerService.restart_container(container_id, timeout)
    return jsonify(result), 200 if result['success'] else 400


PROTECTED_CONTAINERS = ['serverkit-frontend', 'serverkit_frontend', 'serverkit']

@docker_bp.route('/containers/<container_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_container(container_id):
    """Remove a container."""
    # Protect ServerKit containers from deletion
    container = DockerService.get_container(container_id)
    if container:
        container_name = container.get('name', '').lower().replace('/', '')
        if any(protected in container_name for protected in PROTECTED_CONTAINERS):
            return jsonify({
                'success': False,
                'error': 'Cannot delete ServerKit system container. This container is required for the panel to function.'
            }), 403

    data = request.get_json() or {}
    force = data.get('force', False)
    volumes = data.get('volumes', False)
    result = DockerService.remove_container(container_id, force, volumes)
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/containers/<container_id>/logs', methods=['GET'])
@jwt_required()
def get_container_logs(container_id):
    """Get container logs."""
    tail = request.args.get('tail', 100, type=int)
    since = request.args.get('since')
    result = DockerService.get_container_logs(container_id, tail, since)
    return jsonify(result), 200


@docker_bp.route('/containers/<container_id>/stats', methods=['GET'])
@jwt_required()
def get_container_stats(container_id):
    """Get container resource stats."""
    stats = DockerService.get_container_stats(container_id)
    if stats:
        return jsonify({'stats': stats}), 200
    return jsonify({'error': 'Could not get stats'}), 400


@docker_bp.route('/containers/<container_id>/exec', methods=['POST'])
@jwt_required()
@admin_required
def exec_container(container_id):
    """Execute a command in a container."""
    data = request.get_json()

    if not data or 'command' not in data:
        return jsonify({'error': 'command is required'}), 400

    result = DockerService.exec_command(container_id, data['command'])
    return jsonify(result), 200


# ==================== IMAGE MANAGEMENT ====================

@docker_bp.route('/images', methods=['GET'])
@jwt_required()
def list_images():
    """List all images."""
    images = DockerService.list_images()
    return jsonify({'images': images}), 200


@docker_bp.route('/images/pull', methods=['POST'])
@jwt_required()
@admin_required
def pull_image():
    """Pull an image from registry."""
    data = request.get_json()

    if not data or 'image' not in data:
        return jsonify({'error': 'image is required'}), 400

    result = DockerService.pull_image(
        data['image'],
        data.get('tag', 'latest')
    )
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/images/<image_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_image(image_id):
    """Remove an image."""
    data = request.get_json() or {}
    force = data.get('force', False)
    result = DockerService.remove_image(image_id, force)
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/images/build', methods=['POST'])
@jwt_required()
@admin_required
def build_image():
    """Build an image from Dockerfile."""
    data = request.get_json()

    if not data or 'path' not in data or 'tag' not in data:
        return jsonify({'error': 'path and tag are required'}), 400

    result = DockerService.build_image(
        data['path'],
        data['tag'],
        data.get('dockerfile', 'Dockerfile'),
        data.get('no_cache', False)
    )
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/images/tag', methods=['POST'])
@jwt_required()
@admin_required
def tag_image():
    """Tag an image."""
    data = request.get_json()

    if not data or 'source' not in data or 'target' not in data:
        return jsonify({'error': 'source and target are required'}), 400

    result = DockerService.tag_image(data['source'], data['target'])
    return jsonify(result), 200 if result['success'] else 400


# ==================== NETWORK MANAGEMENT ====================

@docker_bp.route('/networks', methods=['GET'])
@jwt_required()
def list_networks():
    """List all networks."""
    networks = DockerService.list_networks()
    return jsonify({'networks': networks}), 200


@docker_bp.route('/networks', methods=['POST'])
@jwt_required()
@admin_required
def create_network():
    """Create a network."""
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'error': 'name is required'}), 400

    result = DockerService.create_network(
        data['name'],
        data.get('driver', 'bridge')
    )
    return jsonify(result), 201 if result['success'] else 400


@docker_bp.route('/networks/<network_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_network(network_id):
    """Remove a network."""
    result = DockerService.remove_network(network_id)
    return jsonify(result), 200 if result['success'] else 400


# ==================== VOLUME MANAGEMENT ====================

@docker_bp.route('/volumes', methods=['GET'])
@jwt_required()
def list_volumes():
    """List all volumes."""
    volumes = DockerService.list_volumes()
    return jsonify({'volumes': volumes}), 200


@docker_bp.route('/volumes', methods=['POST'])
@jwt_required()
@admin_required
def create_volume():
    """Create a volume."""
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'error': 'name is required'}), 400

    result = DockerService.create_volume(
        data['name'],
        data.get('driver', 'local')
    )
    return jsonify(result), 201 if result['success'] else 400


@docker_bp.route('/volumes/<volume_name>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_volume(volume_name):
    """Remove a volume."""
    data = request.get_json() or {}
    force = data.get('force', False)
    result = DockerService.remove_volume(volume_name, force)
    return jsonify(result), 200 if result['success'] else 400


# ==================== DOCKER COMPOSE ====================

@docker_bp.route('/compose/up', methods=['POST'])
@jwt_required()
@admin_required
def compose_up():
    """Start Docker Compose services."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.compose_up(
        data['path'],
        data.get('detach', True),
        data.get('build', False)
    )
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/compose/down', methods=['POST'])
@jwt_required()
@admin_required
def compose_down():
    """Stop Docker Compose services."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.compose_down(
        data['path'],
        data.get('volumes', False),
        data.get('remove_orphans', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/compose/ps', methods=['POST'])
@jwt_required()
def compose_ps():
    """List Docker Compose services."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    services = DockerService.compose_ps(data['path'])
    return jsonify({'services': services}), 200


@docker_bp.route('/compose/logs', methods=['POST'])
@jwt_required()
def compose_logs():
    """Get Docker Compose logs."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.compose_logs(
        data['path'],
        data.get('service'),
        data.get('tail', 100)
    )
    return jsonify(result), 200


@docker_bp.route('/compose/restart', methods=['POST'])
@jwt_required()
@admin_required
def compose_restart():
    """Restart Docker Compose services."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.compose_restart(data['path'], data.get('service'))
    return jsonify(result), 200 if result['success'] else 400


# ==================== CLEANUP ====================

@docker_bp.route('/cleanup', methods=['POST'])
@jwt_required()
@admin_required
def docker_cleanup():
    """Clean up unused Docker resources.

    Removes:
    - Stopped containers (except ServerKit)
    - Unused images
    - Unused networks
    - Unused volumes (optional)

    Does NOT remove:
    - Running containers
    - ServerKit containers
    - Images in use
    """
    import subprocess

    data = request.get_json() or {}
    include_volumes = data.get('volumes', False)

    results = {
        'containers': None,
        'images': None,
        'networks': None,
        'volumes': None
    }

    # Get list of protected container IDs (ServerKit)
    protected_ids = set()
    try:
        list_result = subprocess.run(
            ['docker', 'ps', '-a', '--format', '{{.ID}} {{.Names}}'],
            capture_output=True, text=True
        )
        for line in list_result.stdout.strip().split('\n'):
            if line:
                parts = line.split(' ', 1)
                if len(parts) == 2:
                    container_id, name = parts
                    if any(p in name.lower() for p in PROTECTED_CONTAINERS):
                        protected_ids.add(container_id)
    except Exception:
        pass

    # Remove stopped containers (except protected ones)
    try:
        # Get stopped containers
        result = subprocess.run(
            ['docker', 'ps', '-a', '-q', '-f', 'status=exited'],
            capture_output=True, text=True
        )
        stopped_ids = [id for id in result.stdout.strip().split('\n') if id and id not in protected_ids]

        if stopped_ids:
            remove_result = subprocess.run(
                ['docker', 'rm'] + stopped_ids,
                capture_output=True, text=True
            )
            results['containers'] = {
                'removed': len(stopped_ids),
                'success': remove_result.returncode == 0
            }
        else:
            results['containers'] = {'removed': 0, 'success': True}
    except Exception as e:
        results['containers'] = {'error': str(e)}

    # Remove dangling images
    try:
        result = subprocess.run(
            ['docker', 'image', 'prune', '-f'],
            capture_output=True, text=True
        )
        results['images'] = {
            'success': result.returncode == 0,
            'output': result.stdout.strip()
        }
    except Exception as e:
        results['images'] = {'error': str(e)}

    # Remove unused networks
    try:
        result = subprocess.run(
            ['docker', 'network', 'prune', '-f'],
            capture_output=True, text=True
        )
        results['networks'] = {
            'success': result.returncode == 0,
            'output': result.stdout.strip()
        }
    except Exception as e:
        results['networks'] = {'error': str(e)}

    # Remove unused volumes (optional)
    if include_volumes:
        try:
            result = subprocess.run(
                ['docker', 'volume', 'prune', '-f'],
                capture_output=True, text=True
            )
            results['volumes'] = {
                'success': result.returncode == 0,
                'output': result.stdout.strip()
            }
        except Exception as e:
            results['volumes'] = {'error': str(e)}
    else:
        results['volumes'] = {'skipped': True, 'message': 'Volume cleanup not requested'}

    return jsonify({
        'success': True,
        'message': 'Docker cleanup completed',
        'results': results
    }), 200


@docker_bp.route('/cleanup/apps', methods=['POST'])
@jwt_required()
@admin_required
def cleanup_all_apps():
    """Remove all user-deployed Docker apps.

    This will:
    - Stop and remove all containers in /var/serverkit/apps/
    - Delete app folders
    - Remove apps from database

    Does NOT affect ServerKit itself.
    """
    import shutil
    import os

    apps_dir = paths.APPS_DIR
    results = []

    # Get all apps from database
    docker_apps = Application.query.filter_by(app_type='docker').all()

    for app in docker_apps:
        app_result = {'name': app.name, 'success': True, 'steps': []}

        # Stop and remove containers
        if app.root_path and os.path.exists(app.root_path):
            try:
                compose_result = DockerService.compose_down(app.root_path, volumes=True, remove_orphans=True)
                app_result['steps'].append({'action': 'docker_down', 'success': compose_result.get('success', False)})
            except Exception as e:
                app_result['steps'].append({'action': 'docker_down', 'error': str(e)})
                app_result['success'] = False

            # Delete folder
            try:
                shutil.rmtree(app.root_path)
                app_result['steps'].append({'action': 'delete_folder', 'success': True})
            except Exception as e:
                app_result['steps'].append({'action': 'delete_folder', 'error': str(e)})
                app_result['success'] = False

        # Remove from database
        try:
            db.session.delete(app)
            app_result['steps'].append({'action': 'delete_db', 'success': True})
        except Exception as e:
            app_result['steps'].append({'action': 'delete_db', 'error': str(e)})
            app_result['success'] = False

        results.append(app_result)

    # Commit database changes
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': f'Database commit failed: {str(e)}',
            'results': results
        }), 500

    return jsonify({
        'success': True,
        'message': f'Removed {len(results)} apps',
        'results': results
    }), 200


@docker_bp.route('/compose/pull', methods=['POST'])
@jwt_required()
@admin_required
def compose_pull():
    """Pull Docker Compose images."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.compose_pull(data['path'], data.get('service'))
    return jsonify(result), 200 if result['success'] else 400


@docker_bp.route('/compose/validate', methods=['POST'])
@jwt_required()
def compose_validate():
    """Validate a Docker Compose file."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.validate_compose_file(data['path'])
    return jsonify(result), 200


@docker_bp.route('/compose/config', methods=['POST'])
@jwt_required()
def compose_config():
    """Get parsed Docker Compose configuration."""
    data = request.get_json()

    if not data or 'path' not in data:
        return jsonify({'error': 'path is required'}), 400

    result = DockerService.get_compose_config(data['path'])
    return jsonify(result), 200 if result['success'] else 400


# ==================== UTILITY ====================

@docker_bp.route('/prune', methods=['POST'])
@jwt_required()
@admin_required
def prune_system():
    """Remove unused Docker resources."""
    data = request.get_json() or {}
    result = DockerService.prune_system(
        data.get('all', False),
        data.get('volumes', False)
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== DOCKER APP ====================

@docker_bp.route('/apps', methods=['POST'])
@jwt_required()
@admin_required
def create_docker_app():
    """Create a Docker-based application."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['name', 'path', 'image']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    # Create docker-compose based app
    result = DockerService.create_docker_app(
        app_path=data['path'],
        app_name=data['name'],
        image=data['image'],
        ports=data.get('ports', []),
        volumes=data.get('volumes', []),
        env=data.get('env', {})
    )

    if not result['success']:
        return jsonify(result), 400

    # Start the compose stack
    up_result = DockerService.compose_up(data['path'])

    # Create application record
    current_user_id = get_jwt_identity()
    app = Application(
        name=data['name'],
        app_type='docker',
        status='running' if up_result['success'] else 'stopped',
        root_path=data['path'],
        user_id=current_user_id
    )
    db.session.add(app)
    db.session.commit()

    return jsonify({
        'success': True,
        'app_id': app.id,
        'compose_started': up_result['success']
    }), 201
