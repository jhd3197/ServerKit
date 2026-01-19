import os
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User
from app.services.docker_service import DockerService
from app.services.log_service import LogService

apps_bp = Blueprint('apps', __name__)


@apps_bp.route('', methods=['GET'])
@jwt_required()
def get_apps():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role == 'admin':
        apps = Application.query.all()
    else:
        apps = Application.query.filter_by(user_id=current_user_id).all()

    return jsonify({
        'apps': [app.to_dict() for app in apps]
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

    return jsonify({'app': app.to_dict()}), 200


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
