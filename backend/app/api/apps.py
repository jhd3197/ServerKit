from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User

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
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(app)
    db.session.commit()

    return jsonify({'message': 'Application deleted successfully'}), 200


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

    # TODO: Actually start the application service
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

    # TODO: Actually stop the application service
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

    # TODO: Actually restart the application service
    app.status = 'running'
    db.session.commit()

    return jsonify({
        'message': 'Application restarted',
        'app': app.to_dict()
    }), 200
