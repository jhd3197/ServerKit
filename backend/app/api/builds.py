"""
Build and Deployment API Endpoints

Provides REST endpoints for:
- Build configuration
- Build triggering and monitoring
- Deployment management
- Rollback functionality
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application, Deployment
from app.services.build_service import BuildService
from app.services.deployment_service import DeploymentService

builds_bp = Blueprint('builds', __name__)


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


# ==================== BUILD CONFIGURATION ====================

@builds_bp.route('/apps/<int:app_id>/build-config', methods=['GET'])
@jwt_required()
def get_build_config(app_id):
    """Get build configuration for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    config = BuildService.get_app_build_config(app_id)
    if not config:
        return jsonify({'configured': False}), 200

    return jsonify({'configured': True, 'config': config}), 200


@builds_bp.route('/apps/<int:app_id>/build-config', methods=['POST'])
@jwt_required()
@admin_required
def configure_build(app_id):
    """Configure build settings for an app."""
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    result = BuildService.configure_build(
        app_id=app_id,
        app_path=app.root_path,
        build_method=data.get('build_method', 'auto'),
        dockerfile_path=data.get('dockerfile_path'),
        custom_build_cmd=data.get('custom_build_cmd'),
        custom_start_cmd=data.get('custom_start_cmd'),
        build_args=data.get('build_args'),
        env_vars=data.get('env_vars'),
        cache_enabled=data.get('cache_enabled', True),
        timeout=data.get('timeout'),
        keep_deployments=data.get('keep_deployments', 5)
    )

    return jsonify(result), 201 if result.get('success') else 400


@builds_bp.route('/apps/<int:app_id>/build-config', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_build_config(app_id):
    """Remove build configuration for an app."""
    config = BuildService.get_config()
    if str(app_id) in config.get('apps', {}):
        del config['apps'][str(app_id)]
        BuildService.save_config(config)
        return jsonify({'success': True}), 200
    return jsonify({'success': False, 'error': 'Build not configured'}), 404


# ==================== BUILD DETECTION ====================

@builds_bp.route('/apps/<int:app_id>/detect', methods=['GET'])
@jwt_required()
def detect_build_method(app_id):
    """Auto-detect build method for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    detection = BuildService.detect_build_method(app.root_path)
    return jsonify(detection), 200


@builds_bp.route('/apps/<int:app_id>/nixpacks-plan', methods=['GET'])
@jwt_required()
def get_nixpacks_plan(app_id):
    """Get Nixpacks build plan for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    result = BuildService.get_nixpacks_plan(app.root_path)
    return jsonify(result), 200 if result.get('success') else 400


# ==================== BUILD EXECUTION ====================

@builds_bp.route('/apps/<int:app_id>/build', methods=['POST'])
@jwt_required()
def trigger_build(app_id):
    """Trigger a build for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    no_cache = data.get('no_cache', False)

    result = BuildService.build(app_id, no_cache=no_cache)
    return jsonify(result), 200 if result.get('success') else 400


@builds_bp.route('/apps/<int:app_id>/build-logs', methods=['GET'])
@jwt_required()
def get_build_logs(app_id):
    """Get build log history for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    limit = request.args.get('limit', 20, type=int)
    logs = BuildService.get_build_logs(app_id, limit)
    return jsonify({'logs': logs}), 200


@builds_bp.route('/apps/<int:app_id>/build-logs/<timestamp>', methods=['GET'])
@jwt_required()
def get_build_log_detail(app_id, timestamp):
    """Get detailed build log including output."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    log = BuildService.get_build_log_detail(app_id, timestamp)
    if log:
        return jsonify(log), 200
    return jsonify({'error': 'Build log not found'}), 404


@builds_bp.route('/apps/<int:app_id>/clear-cache', methods=['POST'])
@jwt_required()
@admin_required
def clear_build_cache(app_id):
    """Clear build cache for an app."""
    result = BuildService.clear_build_cache(app_id)
    return jsonify(result), 200 if result.get('success') else 400


# ==================== DEPLOYMENTS ====================

@builds_bp.route('/apps/<int:app_id>/deploy', methods=['POST'])
@jwt_required()
def deploy_app(app_id):
    """Deploy an application (build + deploy)."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}

    result = DeploymentService.deploy(
        app_id=app_id,
        user_id=current_user_id,
        no_cache=data.get('no_cache', False),
        trigger='manual',
        version_tag=data.get('version_tag')
    )

    return jsonify(result), 200 if result.get('success') else 400


@builds_bp.route('/apps/<int:app_id>/deployments', methods=['GET'])
@jwt_required()
def get_deployments(app_id):
    """Get deployment history for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    limit = request.args.get('limit', 20, type=int)
    offset = request.args.get('offset', 0, type=int)

    deployments = DeploymentService.get_deployments(app_id, limit, offset)
    current = DeploymentService.get_current_deployment(app_id)

    return jsonify({
        'deployments': deployments,
        'current': current
    }), 200


@builds_bp.route('/deployments/<int:deployment_id>', methods=['GET'])
@jwt_required()
def get_deployment(deployment_id):
    """Get a specific deployment."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    deployment = Deployment.query.get(deployment_id)
    if not deployment:
        return jsonify({'error': 'Deployment not found'}), 404

    app = Application.query.get(deployment.app_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    include_logs = request.args.get('include_logs', 'false').lower() == 'true'
    return jsonify(deployment.to_dict(include_logs=include_logs)), 200


@builds_bp.route('/deployments/<int:deployment_id>/diff', methods=['GET'])
@jwt_required()
def get_deployment_diff(deployment_id):
    """Get diff for a deployment."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    deployment = Deployment.query.get(deployment_id)
    if not deployment:
        return jsonify({'error': 'Deployment not found'}), 404

    app = Application.query.get(deployment.app_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    diff = DeploymentService.get_deployment_diff(deployment_id)
    if diff:
        return jsonify(diff), 200
    return jsonify({'error': 'No diff available'}), 404


# ==================== ROLLBACK ====================

@builds_bp.route('/apps/<int:app_id>/rollback', methods=['POST'])
@jwt_required()
def rollback(app_id):
    """Rollback to a previous deployment."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    target_version = data.get('version')  # Optional - if not provided, rolls back to previous

    result = DeploymentService.rollback(
        app_id=app_id,
        target_version=target_version,
        user_id=current_user_id
    )

    return jsonify(result), 200 if result.get('success') else 400


@builds_bp.route('/apps/<int:app_id>/current-deployment', methods=['GET'])
@jwt_required()
def get_current_deployment(app_id):
    """Get the currently live deployment."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    deployment = DeploymentService.get_current_deployment(app_id)
    if deployment:
        return jsonify(deployment), 200
    return jsonify({'error': 'No live deployment'}), 404
