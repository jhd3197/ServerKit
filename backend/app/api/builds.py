# Bucket: PER-APP (plan 29 #9). Per-app build routes gate via the app-grant
# family (can_access_app / can_edit_app). See docs/WORKSPACE_SCOPING.md.
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
from app.middleware.rbac import admin_required
from app.models import User, Application, Deployment
from app.services.build_service import BuildService
from app.services.deployment_service import DeploymentService
from app.services.resource_grant_service import ResourceGrantService
from app.exceptions import not_found, permission_denied

builds_bp = Blueprint('builds', __name__)


# ==================== BUILD CONFIGURATION ====================

@builds_bp.route('/apps/<int:app_id>/build-config', methods=['GET'])
@jwt_required()
def get_build_config(app_id):
    """Get build configuration for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    config = BuildService.get_app_build_config(app_id)
    if not config:
        return jsonify({'configured': False}), 200

    return jsonify({'configured': True, 'config': config}), 200


@builds_bp.route('/apps/<int:app_id>/build-config', methods=['POST'])
@admin_required
def configure_build(app_id):
    """Configure build settings for an app."""
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')

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
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    detection = BuildService.detect_build_method(app.root_path)
    return jsonify(detection), 200


@builds_bp.route('/apps/<int:app_id>/nixpacks-plan', methods=['GET'])
@jwt_required()
def get_nixpacks_plan(app_id):
    """Get Nixpacks build plan for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    result = BuildService.get_nixpacks_plan(app.root_path)
    return jsonify(result), 200 if result.get('success') else 400


# ==================== BUILD EXECUTION ====================

@builds_bp.route('/apps/<int:app_id>/build', methods=['POST'])
@jwt_required()
def trigger_build(app_id):
    """Trigger a build for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

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
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    limit = request.args.get('limit', 20, type=int)
    logs = BuildService.get_build_logs(app_id, limit)
    return jsonify({'logs': logs}), 200


@builds_bp.route('/apps/<int:app_id>/build-logs/<timestamp>', methods=['GET'])
@jwt_required()
def get_build_log_detail(app_id, timestamp):
    """Get detailed build log including output."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    log = BuildService.get_build_log_detail(app_id, timestamp)
    if log:
        return jsonify(log), 200
    return jsonify({'error': 'Build log not found'}), 404


@builds_bp.route('/apps/<int:app_id>/clear-cache', methods=['POST'])
@admin_required
def clear_build_cache(app_id):
    """Clear build cache for an app."""
    result = BuildService.clear_build_cache(app_id)
    return jsonify(result), 200 if result.get('success') else 400


# ==================== DEPLOYMENTS ====================

@builds_bp.route('/apps/<int:app_id>/deploy', methods=['POST'])
@jwt_required()
def deploy_app(app_id):
    """Deploy an application (build + deploy).

    Every deploy is a job (plan 51 D7): by default this enqueues an `app_deploy`
    DeploymentJob and returns 202 + {deploy_job_id} so the UI can open the live
    Deploy Console. `?wait=true` preserves the old synchronous contract for
    CLI/tests (runs inline, returns the deployment result body).
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    data = request.get_json() or {}
    no_cache = data.get('no_cache', False)
    version_tag = data.get('version_tag')
    wait = request.args.get('wait', 'false').lower() == 'true'

    if wait:
        result = DeploymentService.deploy(
            app_id=app_id,
            user_id=current_user_id,
            no_cache=no_cache,
            trigger='manual',
            version_tag=version_tag,
        )
        return jsonify(result), 200 if result.get('success') else 400

    from app.services.deployment_job_service import DeploymentJobService
    job_result = DeploymentJobService.enqueue_app_deploy(
        app, user_id=current_user_id, trigger='manual',
        no_cache=no_cache, version_tag=version_tag,
    )
    if not job_result.get('success'):
        return jsonify({'error': job_result.get('error') or 'Failed to queue deployment'}), 400
    return jsonify({
        'success': True,
        'deploy_job_id': job_result['job_id'],
        'job': job_result.get('job'),
    }), 202


@builds_bp.route('/apps/<int:app_id>/deployments', methods=['GET'])
@jwt_required()
def get_deployments(app_id):
    """Get deployment history for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

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
        raise not_found('deployment')

    app = Application.query_active().filter_by(id=deployment.app_id).first()
    if not app:
        raise not_found('service')
    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

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
        raise not_found('deployment')

    app = Application.query_active().filter_by(id=deployment.app_id).first()
    if not app:
        raise not_found('service')
    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

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
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

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
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    deployment = DeploymentService.get_current_deployment(app_id)
    if deployment:
        return jsonify(deployment), 200
    return jsonify({'error': 'No live deployment'}), 404
