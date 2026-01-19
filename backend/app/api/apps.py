import os
import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User
from app.services.docker_service import DockerService
from app.services.log_service import LogService

apps_bp = Blueprint('apps', __name__)


# ==================== ENVIRONMENT LINKING ====================

@apps_bp.route('/<int:app_id>/link', methods=['POST'])
@jwt_required()
def link_apps(app_id):
    """Link two apps as prod/dev pair sharing database resources."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    target_app_id = data.get('target_app_id')
    as_environment = data.get('as_environment', 'development')

    if not target_app_id:
        return jsonify({'error': 'target_app_id is required'}), 400

    valid_environments = ['production', 'development', 'staging']
    if as_environment not in valid_environments:
        return jsonify({'error': f'Invalid environment. Must be one of: {", ".join(valid_environments)}'}), 400

    target_app = Application.query.get(target_app_id)
    if not target_app:
        return jsonify({'error': 'Target application not found'}), 404

    if user.role != 'admin' and target_app.user_id != current_user_id:
        return jsonify({'error': 'Access denied to target application'}), 403

    if app.app_type != target_app.app_type:
        return jsonify({'error': 'Apps must be of the same type to link'}), 400

    if app_id == target_app_id:
        return jsonify({'error': 'Cannot link an app to itself'}), 400

    # Set environment types based on as_environment
    if as_environment == 'development':
        app.environment_type = 'development'
        target_app.environment_type = 'production'
    elif as_environment == 'production':
        app.environment_type = 'production'
        target_app.environment_type = 'development'
    else:  # staging
        app.environment_type = 'staging'
        target_app.environment_type = 'production'

    # Link bidirectionally
    app.linked_app_id = target_app_id
    target_app.linked_app_id = app_id

    # Store shared config
    from datetime import datetime
    shared_config = {
        'linked_at': datetime.now().isoformat(),
        'link_type': 'environment_pair'
    }

    # Propagate DB credentials for Docker/WordPress apps
    propagation_result = None
    if app.app_type == 'docker' and data.get('propagate_credentials', True):
        from app.services.template_service import TemplateService
        # Determine which app is the source (prod) and which is target (dev)
        if as_environment == 'development':
            # Current app is dev, target is prod - propagate from target to current
            propagation_result = TemplateService.propagate_db_credentials(
                target_app_id, app_id, data.get('table_prefix')
            )
        else:
            # Current app is prod, target is dev - propagate from current to target
            propagation_result = TemplateService.propagate_db_credentials(
                app_id, target_app_id, data.get('table_prefix')
            )

        if propagation_result and propagation_result.get('success'):
            shared_config['db_credentials_propagated'] = True
            shared_config['shared_db'] = propagation_result.get('shared_config', {})

    app.shared_config = json.dumps(shared_config)
    target_app.shared_config = json.dumps(shared_config)

    db.session.commit()

    response = {
        'message': 'Apps linked successfully',
        'app': app.to_dict(include_linked=True),
        'target_app': target_app.to_dict(include_linked=True)
    }
    if propagation_result:
        response['credential_propagation'] = propagation_result

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/linked', methods=['GET'])
@jwt_required()
def get_linked_apps(app_id):
    """Get apps linked to this app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    linked_apps = []

    # Get directly linked app
    if app.linked_app:
        linked_apps.append({
            'id': app.linked_app.id,
            'name': app.linked_app.name,
            'app_type': app.linked_app.app_type,
            'environment_type': app.linked_app.environment_type,
            'status': app.linked_app.status,
            'port': app.linked_app.port
        })

    # Get apps that link to this one
    for linked_from in app.linked_from:
        if linked_from.id != app.linked_app_id:  # Avoid duplicates
            linked_apps.append({
                'id': linked_from.id,
                'name': linked_from.name,
                'app_type': linked_from.app_type,
                'environment_type': linked_from.environment_type,
                'status': linked_from.status,
                'port': linked_from.port
            })

    return jsonify({
        'app_id': app_id,
        'environment_type': app.environment_type,
        'linked_apps': linked_apps,
        'shared_config': json.loads(app.shared_config) if app.shared_config else None
    }), 200


@apps_bp.route('/<int:app_id>/link', methods=['DELETE'])
@jwt_required()
def unlink_apps(app_id):
    """Unlink apps and reset environment types."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if not app.linked_app_id:
        return jsonify({'error': 'App is not linked to any other app'}), 400

    target_app = Application.query.get(app.linked_app_id)

    # Reset both apps
    app.linked_app_id = None
    app.environment_type = 'standalone'
    app.shared_config = None

    if target_app:
        target_app.linked_app_id = None
        target_app.environment_type = 'standalone'
        target_app.shared_config = None

    db.session.commit()

    return jsonify({
        'message': 'Apps unlinked successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/environment', methods=['PUT'])
@jwt_required()
def update_environment(app_id):
    """Update environment type for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    environment_type = data.get('environment_type')
    valid_types = ['production', 'development', 'staging', 'standalone']

    if environment_type not in valid_types:
        return jsonify({'error': f'Invalid environment_type. Must be one of: {", ".join(valid_types)}'}), 400

    app.environment_type = environment_type
    db.session.commit()

    return jsonify({
        'message': 'Environment type updated',
        'app': app.to_dict()
    }), 200


# ==================== APP CRUD ====================


@apps_bp.route('', methods=['GET'])
@jwt_required()
def get_apps():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    # Optional filter by environment type
    environment_filter = request.args.get('environment')
    include_linked = request.args.get('include_linked', 'false').lower() == 'true'

    if user.role == 'admin':
        query = Application.query
    else:
        query = Application.query.filter_by(user_id=current_user_id)

    if environment_filter:
        query = query.filter_by(environment_type=environment_filter)

    apps = query.all()

    return jsonify({
        'apps': [app.to_dict(include_linked=include_linked) for app in apps]
    }), 200


@apps_bp.route('/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Single app requests include linked app info by default
    return jsonify({'app': app.to_dict(include_linked=True)}), 200


@apps_bp.route('', methods=['POST'])
@jwt_required()
def create_app():
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    app_type = data.get('app_type')

    if not all([name, app_type]):
        return jsonify({'error': 'Missing required fields: name, app_type'}), 400

    valid_types = ['php', 'wordpress', 'flask', 'django', 'docker', 'static']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    app = Application(
        name=name,
        app_type=app_type,
        status='stopped',
        php_version=data.get('php_version'),
        python_version=data.get('python_version'),
        port=data.get('port'),
        root_path=data.get('root_path'),
        docker_image=data.get('docker_image'),
        user_id=current_user_id
    )

    db.session.add(app)
    db.session.commit()

    return jsonify({
        'message': 'Application created successfully',
        'app': app.to_dict()
    }), 201


@apps_bp.route('/<int:app_id>', methods=['PUT'])
@jwt_required()
def update_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    if 'name' in data:
        app.name = data['name']
    if 'status' in data:
        app.status = data['status']
    if 'php_version' in data:
        app.php_version = data['php_version']
    if 'python_version' in data:
        app.python_version = data['python_version']
    if 'port' in data:
        app.port = data['port']
    if 'root_path' in data:
        app.root_path = data['root_path']
    if 'docker_image' in data:
        app.docker_image = data['docker_image']

    db.session.commit()

    return jsonify({
        'message': 'Application updated successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>', methods=['DELETE'])
@jwt_required()
def delete_app(app_id):
    import shutil
    from app.services.nginx_service import NginxService

    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    cleanup_results = {
        'docker': None,
        'folder': None,
        'nginx': None
    }

    # For Docker apps, stop and remove containers/volumes
    if app.app_type == 'docker' and app.root_path:
        try:
            # Stop and remove containers, networks, and volumes
            result = DockerService.compose_down(app.root_path, volumes=True, remove_orphans=True)
            cleanup_results['docker'] = result
        except Exception as e:
            cleanup_results['docker'] = {'error': str(e)}

        # Delete the app folder
        try:
            if app.root_path and app.root_path.startswith('/var/serverkit/apps/'):
                if os.path.exists(app.root_path):
                    shutil.rmtree(app.root_path)
                    cleanup_results['folder'] = {'success': True}
        except Exception as e:
            cleanup_results['folder'] = {'error': str(e)}

    # Remove nginx site config
    try:
        NginxService.disable_site(app.name)
        NginxService.delete_site(app.name)
        cleanup_results['nginx'] = {'success': True}
    except Exception as e:
        cleanup_results['nginx'] = {'error': str(e)}

    # Delete from database
    db.session.delete(app)
    db.session.commit()

    return jsonify({
        'message': 'Application deleted successfully',
        'cleanup': cleanup_results
    }), 200


@apps_bp.route('/<int:app_id>/start', methods=['POST'])
@jwt_required()
def start_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        result = DockerService.compose_up(app.root_path, detach=True)
        if not result.get('success'):
            return jsonify({'error': result.get('error', 'Failed to start containers')}), 400

    app.status = 'running'
    db.session.commit()

    return jsonify({
        'message': 'Application started',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/stop', methods=['POST'])
@jwt_required()
def stop_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        result = DockerService.compose_down(app.root_path)
        if not result.get('success'):
            return jsonify({'error': result.get('error', 'Failed to stop containers')}), 400

    app.status = 'stopped'
    db.session.commit()

    return jsonify({
        'message': 'Application stopped',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/restart', methods=['POST'])
@jwt_required()
def restart_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        result = DockerService.compose_restart(app.root_path)
        if not result.get('success'):
            return jsonify({'error': result.get('error', 'Failed to restart containers')}), 400

    app.status = 'running'
    db.session.commit()

    return jsonify({
        'message': 'Application restarted',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/logs', methods=['GET'])
@jwt_required()
def get_app_logs(app_id):
    """Get logs for a specific application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    lines = request.args.get('lines', 100, type=int)
    log_type = request.args.get('type', 'all')

    # For Docker apps, get docker compose logs
    if app.app_type == 'docker' and app.root_path:
        result = LogService.get_docker_app_logs(app.name, app.root_path, lines)
        return jsonify(result), 200 if result.get('success') else 400

    # For other apps, get nginx logs
    result = LogService.get_app_logs(app.name, log_type, lines)
    return jsonify(result), 200 if result.get('success') else 400


@apps_bp.route('/<int:app_id>/container-logs', methods=['GET'])
@jwt_required()
def get_container_logs(app_id):
    """Get container logs for a Docker application.

    Query params:
        - tail: Number of lines from end (default: 100, max: 10000)
        - since: ISO timestamp or duration (e.g., '10m', '1h', '2024-01-01T00:00:00Z')
        - timestamps: Include timestamps (default: true)
        - format: Output format - 'raw' or 'json' (default: 'raw')
        - service: Specific service/container name for compose apps (optional)

    Returns:
        {
            "success": true,
            "logs": "...",  // Raw format
            "lines": [...]  // JSON format with parsed lines
            "container_id": "...",
            "container_name": "...",
            "app_id": 1,
            "containers": [...] // Available containers for compose apps
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Parse query parameters
    tail = request.args.get('tail', 100, type=int)
    tail = min(tail, 10000)  # Cap at 10000 lines
    since = request.args.get('since')
    timestamps = request.args.get('timestamps', 'true').lower() == 'true'
    output_format = request.args.get('format', 'raw')
    service = request.args.get('service')

    # Get all available containers for this app
    all_containers = DockerService.get_all_app_containers(app)

    # Determine which container to get logs from
    container_id = None
    container_name = None

    if service:
        # Find specific service container
        for c in all_containers:
            if c.get('service') == service or c.get('name') == service:
                container_id = c.get('id') or c.get('name')
                container_name = c.get('name')
                break
        if not container_id:
            return jsonify({
                'success': False,
                'error': f'Service "{service}" not found',
                'available_services': [c.get('service') or c.get('name') for c in all_containers]
            }), 404
    else:
        # Get main container
        container_id = DockerService.get_app_container_id(app)
        if all_containers:
            container_name = all_containers[0].get('name')

    if not container_id:
        return jsonify({
            'success': False,
            'error': 'No container found for this application',
            'hint': 'The application may not have been started yet'
        }), 404

    # Check container state
    container_state = DockerService.get_container_state(container_id)
    if not container_state:
        return jsonify({
            'success': False,
            'error': 'Container not found or no longer exists'
        }), 404

    # Get logs
    result = DockerService.get_container_logs(
        container_id,
        tail=tail,
        since=since,
        timestamps=timestamps
    )

    if not result.get('success'):
        return jsonify({
            'success': False,
            'error': result.get('error', 'Failed to fetch logs')
        }), 400

    logs = result.get('logs', '')

    response = {
        'success': True,
        'app_id': app_id,
        'container_id': container_id,
        'container_name': container_name,
        'container_state': container_state,
        'containers': all_containers
    }

    if output_format == 'json':
        response['lines'] = DockerService.parse_logs_to_lines(logs)
    else:
        response['logs'] = logs

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/containers', methods=['GET'])
@jwt_required()
def get_app_containers(app_id):
    """Get list of containers for a Docker application.

    Useful for compose apps with multiple services.

    Returns:
        {
            "success": true,
            "app_id": 1,
            "containers": [
                {"id": "abc123", "name": "app-web", "service": "web", "state": "running"},
                {"id": "def456", "name": "app-db", "service": "db", "state": "running"}
            ]
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    containers = DockerService.get_all_app_containers(app)

    return jsonify({
        'success': True,
        'app_id': app_id,
        'containers': containers
    }), 200


@apps_bp.route('/<int:app_id>/status', methods=['GET'])
@jwt_required()
def get_app_status(app_id):
    """Get real-time status for a Docker application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if app.app_type == 'docker' and app.root_path:
        # Get container status from Docker
        containers = DockerService.compose_ps(app.root_path)

        # Determine overall status
        running_count = sum(1 for c in containers if c.get('Status', c.get('status', '')).startswith('Up'))
        total_count = len(containers)

        if total_count == 0:
            actual_status = 'stopped'
        elif running_count == total_count:
            actual_status = 'running'
        elif running_count > 0:
            actual_status = 'partial'
        else:
            actual_status = 'stopped'

        # Update DB if status changed
        if app.status != actual_status and actual_status in ['running', 'stopped']:
            app.status = actual_status
            db.session.commit()

        # Check port accessibility
        port_status = None
        if app.port:
            port_status = DockerService.check_port_accessible(app.port)

        return jsonify({
            'status': actual_status,
            'containers': containers,
            'running': running_count,
            'total': total_count,
            'port': app.port,
            'port_accessible': port_status.get('accessible') if port_status else None
        }), 200

    # Non-Docker apps
    port_status = None
    if app.port:
        port_status = DockerService.check_port_accessible(app.port)

    return jsonify({
        'status': app.status,
        'containers': [],
        'running': 1 if app.status == 'running' else 0,
        'total': 1,
        'port': app.port,
        'port_accessible': port_status.get('accessible') if port_status else None
    }), 200
