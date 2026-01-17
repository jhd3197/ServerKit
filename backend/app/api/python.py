from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.python_service import PythonService
from app import db

python_bp = Blueprint('python', __name__)


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


def get_app_or_404(app_id, current_user_id):
    """Get application and verify access."""
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return None, ({'error': 'Application not found'}, 404)

    if user.role != 'admin' and app.user_id != current_user_id:
        return None, ({'error': 'Access denied'}, 403)

    if app.app_type not in ['flask', 'django']:
        return None, ({'error': 'Application is not a Python app'}, 400)

    return app, None


# Python version management
@python_bp.route('/versions', methods=['GET'])
@jwt_required()
def get_versions():
    """Get available Python versions."""
    versions = PythonService.get_python_versions()
    default = PythonService.get_default_python()
    return jsonify({
        'versions': versions,
        'default': default
    }), 200


# Application creation
@python_bp.route('/apps/flask', methods=['POST'])
@jwt_required()
@admin_required
def create_flask_app():
    """Create a new Flask application."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required_fields = ['name', 'path']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    python_version = data.get('python_version', '3.11')
    port = data.get('port', 8000)

    # Create Flask app
    result = PythonService.create_flask_app(
        data['path'],
        data['name'],
        python_version
    )

    if not result['success']:
        return jsonify(result), 400

    # Create Gunicorn service
    service_result = PythonService.create_gunicorn_service(
        data['name'],
        data['path'],
        port=port,
        workers=data.get('workers', 2)
    )

    if not service_result['success']:
        return jsonify(service_result), 400

    # Create application record
    current_user_id = get_jwt_identity()
    app = Application(
        name=data['name'],
        app_type='flask',
        status='stopped',
        python_version=python_version,
        port=port,
        root_path=data['path'],
        user_id=current_user_id
    )
    db.session.add(app)
    db.session.commit()

    return jsonify({
        'success': True,
        'app_id': app.id,
        'message': 'Flask application created successfully'
    }), 201


@python_bp.route('/apps/django', methods=['POST'])
@jwt_required()
@admin_required
def create_django_app():
    """Create a new Django application."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required_fields = ['name', 'path']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    python_version = data.get('python_version', '3.11')
    port = data.get('port', 8000)

    # Create Django app
    result = PythonService.create_django_app(
        data['path'],
        data['name'],
        python_version
    )

    if not result['success']:
        return jsonify(result), 400

    # Create Gunicorn service
    service_result = PythonService.create_gunicorn_service(
        data['name'],
        data['path'],
        port=port,
        workers=data.get('workers', 2)
    )

    if not service_result['success']:
        return jsonify(service_result), 400

    # Create application record
    current_user_id = get_jwt_identity()
    app = Application(
        name=data['name'],
        app_type='django',
        status='stopped',
        python_version=python_version,
        port=port,
        root_path=data['path'],
        user_id=current_user_id
    )
    db.session.add(app)
    db.session.commit()

    return jsonify({
        'success': True,
        'app_id': app.id,
        'project_name': result.get('project_name'),
        'message': 'Django application created successfully'
    }), 201


# Virtual environment management
@python_bp.route('/apps/<int:app_id>/venv', methods=['POST'])
@jwt_required()
@admin_required
def create_venv(app_id):
    """Create or recreate virtual environment."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.create_virtualenv(app.root_path, app.python_version)
    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/packages', methods=['GET'])
@jwt_required()
def get_packages(app_id):
    """Get installed packages."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    packages = PythonService.get_installed_packages(app.root_path)
    return jsonify({'packages': packages}), 200


@python_bp.route('/apps/<int:app_id>/packages', methods=['POST'])
@jwt_required()
@admin_required
def install_packages(app_id):
    """Install packages."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    data = request.get_json()
    packages = data.get('packages') if data else None

    result = PythonService.install_requirements(app.root_path, packages)
    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/requirements', methods=['POST'])
@jwt_required()
@admin_required
def freeze_requirements(app_id):
    """Freeze requirements to requirements.txt."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.freeze_requirements(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


# Environment variables
@python_bp.route('/apps/<int:app_id>/env', methods=['GET'])
@jwt_required()
def get_env_vars(app_id):
    """Get environment variables."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    env_vars = PythonService.get_env_vars(app.root_path)

    # Mask sensitive values
    masked_vars = {}
    sensitive_keys = ['SECRET', 'PASSWORD', 'KEY', 'TOKEN', 'PRIVATE']
    for key, value in env_vars.items():
        if any(s in key.upper() for s in sensitive_keys):
            masked_vars[key] = '********'
        else:
            masked_vars[key] = value

    return jsonify({'env_vars': masked_vars, 'count': len(env_vars)}), 200


@python_bp.route('/apps/<int:app_id>/env', methods=['PUT'])
@jwt_required()
@admin_required
def set_env_vars(app_id):
    """Set environment variables."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    data = request.get_json()
    if not data or 'env_vars' not in data:
        return jsonify({'error': 'env_vars is required'}), 400

    result = PythonService.set_env_vars(app.root_path, data['env_vars'])
    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/env/<key>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_env_var(app_id, key):
    """Delete an environment variable."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.delete_env_var(app.root_path, key)
    return jsonify(result), 200 if result['success'] else 400


# Process control
@python_bp.route('/apps/<int:app_id>/start', methods=['POST'])
@jwt_required()
@admin_required
def start_app(app_id):
    """Start the application."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.start_app(app.name)
    if result['success']:
        app.status = 'running'
        db.session.commit()

    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/stop', methods=['POST'])
@jwt_required()
@admin_required
def stop_app(app_id):
    """Stop the application."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.stop_app(app.name)
    if result['success']:
        app.status = 'stopped'
        db.session.commit()

    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/restart', methods=['POST'])
@jwt_required()
@admin_required
def restart_app(app_id):
    """Restart the application."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.restart_app(app.name)
    if result['success']:
        app.status = 'running'
        db.session.commit()

    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/status', methods=['GET'])
@jwt_required()
def get_status(app_id):
    """Get application status."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    status = PythonService.get_app_status(app.name)
    return jsonify(status), 200


# Gunicorn configuration
@python_bp.route('/apps/<int:app_id>/gunicorn', methods=['GET'])
@jwt_required()
def get_gunicorn_config(app_id):
    """Get Gunicorn configuration."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    config = PythonService.get_gunicorn_config(app.root_path)
    return jsonify(config), 200


@python_bp.route('/apps/<int:app_id>/gunicorn', methods=['PUT'])
@jwt_required()
@admin_required
def update_gunicorn_config(app_id):
    """Update Gunicorn configuration."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    data = request.get_json()
    if not data or 'content' not in data:
        return jsonify({'error': 'content is required'}), 400

    result = PythonService.save_gunicorn_config(app.root_path, data['content'])
    return jsonify(result), 200 if result['success'] else 400


# Django-specific
@python_bp.route('/apps/<int:app_id>/migrate', methods=['POST'])
@jwt_required()
@admin_required
def run_migrations(app_id):
    """Run database migrations."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    result = PythonService.run_migrations(app.root_path, app.app_type)
    return jsonify(result), 200 if result['success'] else 400


@python_bp.route('/apps/<int:app_id>/collectstatic', methods=['POST'])
@jwt_required()
@admin_required
def collect_static(app_id):
    """Collect static files (Django only)."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    if app.app_type != 'django':
        return jsonify({'error': 'Only supported for Django apps'}), 400

    result = PythonService.collect_static(app.root_path, app.app_type)
    return jsonify(result), 200 if result['success'] else 400


# Command execution
@python_bp.route('/apps/<int:app_id>/run', methods=['POST'])
@jwt_required()
@admin_required
def run_command(app_id):
    """Run a command in the app context."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    data = request.get_json()
    if not data or 'command' not in data:
        return jsonify({'error': 'command is required'}), 400

    # Basic command validation - block dangerous commands
    command = data['command']
    blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:']
    if any(b in command for b in blocked):
        return jsonify({'error': 'Command not allowed'}), 403

    result = PythonService.run_command(app.root_path, command)
    return jsonify(result), 200


# Delete application
@python_bp.route('/apps/<int:app_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_app(app_id):
    """Delete a Python application."""
    current_user_id = get_jwt_identity()
    app, error = get_app_or_404(app_id, current_user_id)
    if error:
        return jsonify(error[0]), error[1]

    data = request.get_json() or {}
    remove_files = data.get('remove_files', False)

    result = PythonService.delete_app(app.name, app.root_path, remove_files)

    if result['success']:
        db.session.delete(app)
        db.session.commit()

    return jsonify(result), 200 if result['success'] else 400
