"""
Environment Variables API

Provides endpoints for managing application environment variables.
All values are encrypted at rest.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import Application, User
from app.services.env_service import EnvService

env_vars_bp = Blueprint('env_vars', __name__)


def check_app_access(app_id, user_id):
    """Check if user has access to the application."""
    user = User.query.get(user_id)
    app = Application.query.get(app_id)

    if not app:
        return None, None, jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != user_id:
        return None, None, jsonify({'error': 'Access denied'}), 403

    return user, app, None, None


@env_vars_bp.route('/<int:app_id>/env', methods=['GET'])
@jwt_required()
def get_env_vars(app_id):
    """Get all environment variables for an application."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    # Check if secrets should be masked
    mask_secrets = request.args.get('mask', 'false').lower() == 'true'

    env_vars = EnvService.get_env_vars(app_id, mask_secrets=mask_secrets)

    return jsonify({
        'env_vars': env_vars,
        'count': len(env_vars)
    }), 200


@env_vars_bp.route('/<int:app_id>/env', methods=['POST'])
@jwt_required()
def create_env_var(app_id):
    """Create a new environment variable."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    key = data.get('key')
    value = data.get('value', '')
    is_secret = data.get('is_secret', False)
    description = data.get('description')

    if not key:
        return jsonify({'error': 'Key is required'}), 400

    env_var, created, err = EnvService.set_env_var(
        app_id, key, value, is_secret, description, current_user_id
    )

    if err:
        return jsonify({'error': err}), 400

    return jsonify({
        'message': 'Environment variable created' if created else 'Environment variable updated',
        'env_var': env_var.to_dict(),
        'created': created
    }), 201 if created else 200


@env_vars_bp.route('/<int:app_id>/env/<string:key>', methods=['GET'])
@jwt_required()
def get_env_var(app_id, key):
    """Get a single environment variable by key."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    env_var = EnvService.get_env_var(app_id, key)

    if not env_var:
        return jsonify({'error': 'Environment variable not found'}), 404

    return jsonify({
        'env_var': env_var.to_dict()
    }), 200


@env_vars_bp.route('/<int:app_id>/env/<string:key>', methods=['PUT'])
@jwt_required()
def update_env_var(app_id, key):
    """Update an existing environment variable."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    value = data.get('value')
    is_secret = data.get('is_secret')
    description = data.get('description')

    # Get existing
    existing = EnvService.get_env_var(app_id, key)
    if not existing:
        return jsonify({'error': 'Environment variable not found'}), 404

    # Update only provided fields
    if value is not None:
        old_value = existing.value
        existing.value = value
        from app.models import EnvironmentVariableHistory
        from app import db
        EnvironmentVariableHistory.record_change(
            existing, 'updated', old_value=old_value, new_value=value, user_id=current_user_id
        )

    if is_secret is not None:
        existing.is_secret = is_secret

    if description is not None:
        existing.description = description

    from app import db
    db.session.commit()

    return jsonify({
        'message': 'Environment variable updated',
        'env_var': existing.to_dict()
    }), 200


@env_vars_bp.route('/<int:app_id>/env/<string:key>', methods=['DELETE'])
@jwt_required()
def delete_env_var(app_id, key):
    """Delete an environment variable."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    success, err = EnvService.delete_env_var(app_id, key, current_user_id)

    if not success:
        return jsonify({'error': err}), 404

    return jsonify({
        'message': 'Environment variable deleted',
        'key': key
    }), 200


@env_vars_bp.route('/<int:app_id>/env/bulk', methods=['POST'])
@jwt_required()
def bulk_set_env_vars(app_id):
    """Set multiple environment variables at once."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    data = request.get_json()
    if not data or 'env_vars' not in data:
        return jsonify({'error': 'env_vars object is required'}), 400

    count, errors = EnvService.bulk_set_env_vars(
        app_id, data['env_vars'], current_user_id
    )

    return jsonify({
        'message': f'{count} environment variables set',
        'count': count,
        'errors': errors if errors else None
    }), 200 if not errors else 207  # 207 Multi-Status if partial success


@env_vars_bp.route('/<int:app_id>/env/import', methods=['POST'])
@jwt_required()
def import_env_file(app_id):
    """Import environment variables from .env file content."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    data = request.get_json()
    if not data or 'content' not in data:
        return jsonify({'error': 'content is required'}), 400

    # Parse the .env content
    env_vars, parse_errors = EnvService.parse_env_file(data['content'])

    if not env_vars and parse_errors:
        return jsonify({
            'error': 'Failed to parse .env content',
            'parse_errors': parse_errors
        }), 400

    # Whether to overwrite existing
    overwrite = data.get('overwrite', True)

    if not overwrite:
        # Filter out existing keys
        existing_keys = {ev.key for ev in EnvService.get_env_vars(app_id)}
        env_vars = {k: v for k, v in env_vars.items() if k not in existing_keys}

    # Import the variables
    count, errors = EnvService.bulk_set_env_vars(app_id, env_vars, current_user_id)

    return jsonify({
        'message': f'{count} environment variables imported',
        'count': count,
        'parse_errors': parse_errors if parse_errors else None,
        'import_errors': errors if errors else None
    }), 200


@env_vars_bp.route('/<int:app_id>/env/export', methods=['GET'])
@jwt_required()
def export_env_file(app_id):
    """Export environment variables as .env file content."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    include_secrets = request.args.get('include_secrets', 'true').lower() == 'true'

    content = EnvService.export_to_env_format(app_id, include_secrets=include_secrets)

    return jsonify({
        'content': content,
        'filename': f'{app.name}.env'
    }), 200


@env_vars_bp.route('/<int:app_id>/env/history', methods=['GET'])
@jwt_required()
def get_env_history(app_id):
    """Get change history for environment variables."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    limit = request.args.get('limit', 50, type=int)
    history = EnvService.get_history(app_id, limit=limit)

    return jsonify({
        'history': history,
        'count': len(history)
    }), 200


@env_vars_bp.route('/<int:app_id>/env/clear', methods=['DELETE'])
@jwt_required()
def clear_all_env_vars(app_id):
    """Delete all environment variables for an application."""
    current_user_id = get_jwt_identity()
    user, app, error, status = check_app_access(app_id, current_user_id)
    if error:
        return error, status

    count = EnvService.clear_all(app_id, current_user_id)

    return jsonify({
        'message': f'{count} environment variables deleted',
        'count': count
    }), 200
