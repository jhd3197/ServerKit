"""
Environment Pipeline API

REST endpoints for WordPress multi-environment management:
- Project listing and pipeline overview
- Environment CRUD and lifecycle (start/stop/restart)
- Code/database promotion between environments
- Sync from production
- Environment comparison
- Locking/unlocking
- Activity log
- Container logs
"""

import threading
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app import db, limiter
from app.models.application import Application
from app.models.wordpress_site import WordPressSite
from app.models.environment_activity import EnvironmentActivity
from app.models.promotion_job import PromotionJob
from app.models.sanitization_profile import SanitizationProfile
from app.services.environment_pipeline_service import EnvironmentPipelineService
from app.services.environment_docker_service import EnvironmentDockerService
from app.services.git_wordpress_service import GitWordPressService

environment_pipeline_bp = Blueprint('environment_pipeline', __name__)


# =============================================================================
# Helper: Verify ownership of a production site
# =============================================================================

def _get_production_site(prod_id, user_id):
    """Get a production site with ownership check.

    Returns (site, error_response) tuple.
    If site is found and owned by user, returns (site, None).
    Otherwise returns (None, error_response).
    """
    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == prod_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return None, (jsonify({'error': 'Project not found'}), 404)

    if not site.is_production and site.environment_type not in ('production', 'standalone'):
        return None, (jsonify({'error': 'Site is not a production environment'}), 400)

    return site, None


def _get_environment_site(env_id, user_id):
    """Get an environment site with ownership check."""
    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == env_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return None, (jsonify({'error': 'Environment not found'}), 404)

    return site, None


# =============================================================================
# Project Listing
# =============================================================================

@environment_pipeline_bp.route('', methods=['GET'])
@jwt_required()
def list_projects():
    """List all WordPress projects with environment summary.

    Returns production sites with a count of child environments for each.
    """
    user_id = get_jwt_identity()

    sites = WordPressSite.query.join(Application).filter(
        Application.user_id == user_id,
        Application.app_type == 'wordpress',
        WordPressSite.is_production == True
    ).all()

    projects = []
    for site in sites:
        project = site.to_dict()
        project['environment_count'] = len(site.environments)
        project['environment_types'] = [
            e.environment_type for e in site.environments
        ]
        projects.append(project)

    return jsonify({
        'projects': projects,
        'total': len(projects)
    })


# =============================================================================
# Pipeline View
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/pipeline', methods=['GET'])
@jwt_required()
def get_pipeline(prod_id):
    """Get full pipeline view: all environments, statuses, last actions."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    result = EnvironmentPipelineService.get_pipeline_status(prod_id)
    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


# =============================================================================
# Environment CRUD
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments', methods=['POST'])
@jwt_required()
def create_environment(prod_id):
    """Create a new environment (dev/staging/multidev).

    Body: {
        type: "development" | "staging" | "multidev",
        branch?: string,  (required for multidev)
        domain?: string,
        clone_db?: boolean (default true),
        resource_limits?: { memory, cpus, db_memory, db_cpus },
        name?: string
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_type = data.get('type', 'development')
    if env_type not in ('development', 'staging', 'multidev'):
        return jsonify({'error': 'Invalid environment type. Must be development, staging, or multidev.'}), 400

    # Emit WebSocket event for operation start
    _emit_pipeline_event(prod_id, 'environment_creating', {
        'type': env_type,
        'message': f'Creating {env_type} environment...'
    })

    def progress_callback(progress_data):
        _emit_pipeline_event(prod_id, 'operation_progress', progress_data)

    result = EnvironmentPipelineService.create_project_environment(
        production_site_id=prod_id,
        env_type=env_type,
        config=data,
        user_id=user_id,
        progress_callback=progress_callback
    )

    # Emit completion event
    _emit_pipeline_event(prod_id, 'environment_created' if result.get('success') else 'environment_create_failed', {
        'type': env_type,
        'success': result.get('success', False),
        'message': result.get('message') or result.get('error'),
    })

    if result.get('success'):
        return jsonify(result), 201
    else:
        return jsonify(result), 500


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>', methods=['DELETE'])
@jwt_required()
def delete_environment(prod_id, env_id):
    """Delete an environment and all its resources."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    result = EnvironmentPipelineService.delete_environment(env_id, user_id=user_id)

    _emit_pipeline_event(prod_id, 'environment_deleted' if result.get('success') else 'environment_delete_failed', {
        'env_id': env_id,
        'success': result.get('success', False),
        'message': result.get('message') or result.get('error'),
    })

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Container Lifecycle
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/start', methods=['POST'])
@jwt_required()
def start_environment(prod_id, env_id):
    """Start an environment's containers."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found for this environment'}), 400

    result = EnvironmentDockerService.start_environment(compose_path)

    if result.get('success'):
        env_site.application.status = 'running'
        db.session.commit()
        _emit_pipeline_event(prod_id, 'environment_started', {'env_id': env_id})

    return jsonify(result) if result.get('success') else (jsonify(result), 500)


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/stop', methods=['POST'])
@jwt_required()
def stop_environment(prod_id, env_id):
    """Stop an environment's containers."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found for this environment'}), 400

    result = EnvironmentDockerService.stop_environment(compose_path)

    if result.get('success'):
        env_site.application.status = 'stopped'
        db.session.commit()
        _emit_pipeline_event(prod_id, 'environment_stopped', {'env_id': env_id})

    return jsonify(result) if result.get('success') else (jsonify(result), 500)


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/restart', methods=['POST'])
@jwt_required()
def restart_environment(prod_id, env_id):
    """Restart an environment's containers."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found for this environment'}), 400

    result = EnvironmentDockerService.restart_environment(compose_path)

    if result.get('success'):
        env_site.application.status = 'running'
        db.session.commit()
        _emit_pipeline_event(prod_id, 'environment_restarted', {'env_id': env_id})

    return jsonify(result) if result.get('success') else (jsonify(result), 500)


# =============================================================================
# Promotion
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/promote', methods=['POST'])
@jwt_required()
@limiter.limit("5 per minute")
def promote(prod_id):
    """Promote code/DB between environments.

    Body: {
        source_env_id: int,
        target_env_id: int,
        type: "code" | "database" | "full",
        config: {
            include_plugins?: boolean,
            include_themes?: boolean,
            include_mu_plugins?: boolean,
            include_uploads?: boolean,
            backup_target_first?: boolean,
            search_replace?: { old: new },
            sanitize?: boolean,
            truncate_tables?: [string],
            exclude_tables?: [string]
        }
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    source_env_id = data.get('source_env_id')
    target_env_id = data.get('target_env_id')
    promotion_type = data.get('type', 'code')

    if not source_env_id or not target_env_id:
        return jsonify({'error': 'source_env_id and target_env_id are required'}), 400

    if promotion_type not in ('code', 'database', 'full'):
        return jsonify({'error': 'type must be code, database, or full'}), 400

    # Verify ownership of both environments
    source_site, error = _get_environment_site(source_env_id, user_id)
    if error:
        return error

    target_site, error = _get_environment_site(target_env_id, user_id)
    if error:
        return error

    # Verify both belong to this project (or are the production site itself)
    for env_site, label in [(source_site, 'Source'), (target_site, 'Target')]:
        if env_site.id != prod_id and env_site.production_site_id != prod_id:
            return jsonify({'error': f'{label} environment does not belong to this project'}), 400

    config = data.get('config', {})

    # Emit WebSocket event for operation start
    _emit_pipeline_event(prod_id, 'promotion_started', {
        'source_env_id': source_env_id,
        'target_env_id': target_env_id,
        'type': promotion_type,
        'message': f'Promoting {promotion_type} from {source_site.environment_type} to {target_site.environment_type}...'
    })

    # Progress callback emits WebSocket events
    def progress_callback(progress_data):
        _emit_pipeline_event(prod_id, 'operation_progress', progress_data)

    # Run promotion (long-running operations run in the request thread)
    if promotion_type == 'code':
        result = EnvironmentPipelineService.promote_code(
            source_env_id, target_env_id, config=config, user_id=user_id,
            progress_callback=progress_callback
        )
    elif promotion_type == 'database':
        result = EnvironmentPipelineService.promote_database(
            source_env_id, target_env_id, config=config, user_id=user_id,
            progress_callback=progress_callback
        )
    else:
        result = EnvironmentPipelineService.promote_full(
            source_env_id, target_env_id, config=config, user_id=user_id,
            progress_callback=progress_callback
        )

    # Emit completion event
    _emit_pipeline_event(prod_id, 'promotion_completed' if result.get('success') else 'promotion_failed', {
        'source_env_id': source_env_id,
        'target_env_id': target_env_id,
        'type': promotion_type,
        'success': result.get('success', False),
        'message': result.get('message') or result.get('error'),
    })

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Sync from Production
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/sync', methods=['POST'])
@jwt_required()
@limiter.limit("5 per minute")
def sync_environment(prod_id, env_id):
    """Pull from production into environment.

    Body: {
        type: "database" | "files" | "full",
        sanitize?: boolean,
        search_replace?: { old: new },
        truncate_tables?: [string],
        exclude_tables?: [string]
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    sync_type = data.get('type', 'full')
    if sync_type not in ('database', 'files', 'full'):
        return jsonify({'error': 'type must be database, files, or full'}), 400

    _emit_pipeline_event(prod_id, 'sync_started', {
        'env_id': env_id,
        'type': sync_type,
        'message': f'Syncing {sync_type} from production...'
    })

    def progress_callback(progress_data):
        _emit_pipeline_event(prod_id, 'operation_progress', progress_data)

    result = EnvironmentPipelineService.sync_from_production(
        env_site_id=env_id,
        sync_type=sync_type,
        options=data,
        user_id=user_id,
        progress_callback=progress_callback
    )

    _emit_pipeline_event(prod_id, 'sync_completed' if result.get('success') else 'sync_failed', {
        'env_id': env_id,
        'type': sync_type,
        'success': result.get('success', False),
        'message': result.get('message') or result.get('error'),
    })

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Environment Comparison
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/compare', methods=['GET'])
@jwt_required()
def compare_environments(prod_id):
    """Compare two environments (plugins, themes, versions).

    Query: ?env_a=:id&env_b=:id
    """
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_a_id = request.args.get('env_a', type=int)
    env_b_id = request.args.get('env_b', type=int)

    if not env_a_id or not env_b_id:
        return jsonify({'error': 'env_a and env_b query parameters are required'}), 400

    # Verify ownership
    env_a, error = _get_environment_site(env_a_id, user_id)
    if error:
        return error

    env_b, error = _get_environment_site(env_b_id, user_id)
    if error:
        return error

    # Verify both belong to this project
    for env_site, label in [(env_a, 'env_a'), (env_b, 'env_b')]:
        if env_site.id != prod_id and env_site.production_site_id != prod_id:
            return jsonify({'error': f'{label} does not belong to this project'}), 400

    result = EnvironmentPipelineService.compare_environments(env_a_id, env_b_id)
    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Environment Locking
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/lock', methods=['POST'])
@jwt_required()
def lock_environment(prod_id, env_id):
    """Lock an environment.

    Body: {
        reason: string,
        duration_minutes?: int (default 30)
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    reason = data.get('reason', 'Manually locked')
    duration = data.get('duration_minutes', 30)

    result = EnvironmentPipelineService.lock_environment(
        site_id=env_id,
        reason=reason,
        user_id=user_id,
        duration_minutes=duration
    )

    if result.get('success'):
        _emit_pipeline_event(prod_id, 'environment_locked', {
            'env_id': env_id,
            'reason': reason,
        })
        return jsonify(result)
    else:
        return jsonify(result), 400


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/lock', methods=['DELETE'])
@jwt_required()
def unlock_environment(prod_id, env_id):
    """Unlock an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    result = EnvironmentPipelineService.unlock_environment(
        site_id=env_id,
        user_id=user_id
    )

    if result.get('success'):
        _emit_pipeline_event(prod_id, 'environment_unlocked', {'env_id': env_id})
        return jsonify(result)
    else:
        return jsonify(result), 400


# =============================================================================
# Activity Log
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/activity', methods=['GET'])
@jwt_required()
def get_activity(prod_id):
    """Activity log for all environments in project.

    Query: ?env_id=&action=&limit=50&offset=0
    """
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    # Build query for all environments in this project
    env_ids = [prod_id] + [e.id for e in site.environments]

    # Filter by specific environment if requested
    filter_env_id = request.args.get('env_id', type=int)
    if filter_env_id:
        if filter_env_id not in env_ids:
            return jsonify({'error': 'Environment does not belong to this project'}), 400
        env_ids = [filter_env_id]

    query = EnvironmentActivity.query.filter(
        EnvironmentActivity.site_id.in_(env_ids)
    )

    # Filter by action
    action = request.args.get('action')
    if action:
        query = query.filter(EnvironmentActivity.action == action)

    # Pagination
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)

    total = query.count()
    activities = query.order_by(
        EnvironmentActivity.created_at.desc()
    ).offset(offset).limit(limit).all()

    return jsonify({
        'activities': [a.to_dict() for a in activities],
        'total': total,
        'limit': limit,
        'offset': offset
    })


# =============================================================================
# Container Logs
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/logs', methods=['GET'])
@jwt_required()
def get_container_logs(prod_id, env_id):
    """Docker container logs for environment.

    Query: ?service=wordpress|mysql&lines=100
    """
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found for this environment'}), 400

    service = request.args.get('service', 'wordpress')
    if service not in ('wordpress', 'db'):
        return jsonify({'error': 'service must be wordpress or db'}), 400

    lines = request.args.get('lines', 100, type=int)
    lines = min(lines, 1000)  # Cap at 1000 lines

    result = EnvironmentDockerService.get_container_logs(compose_path, service=service, lines=lines)
    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Promotion History
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/promotions', methods=['GET'])
@jwt_required()
def get_promotions(prod_id):
    """Get promotion history for a project.

    Query: ?limit=20&offset=0&status=
    """
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_ids = [prod_id] + [e.id for e in site.environments]

    query = PromotionJob.query.filter(
        (PromotionJob.source_site_id.in_(env_ids)) |
        (PromotionJob.target_site_id.in_(env_ids))
    )

    status = request.args.get('status')
    if status:
        query = query.filter(PromotionJob.status == status)

    limit = request.args.get('limit', 20, type=int)
    offset = request.args.get('offset', 0, type=int)

    total = query.count()
    promotions = query.order_by(
        PromotionJob.created_at.desc()
    ).offset(offset).limit(limit).all()

    return jsonify({
        'promotions': [p.to_dict() for p in promotions],
        'total': total,
        'limit': limit,
        'offset': offset
    })


# =============================================================================
# Environment Status (single environment detail)
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>', methods=['GET'])
@jwt_required()
def get_environment(prod_id, env_id):
    """Get detailed status for a single environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    env_data = env_site.to_dict(include_snapshots=True)

    # Add container status
    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if compose_path:
        env_data['container_status'] = EnvironmentDockerService.get_environment_status(compose_path)

    # Add last promotion info
    last_promotion = PromotionJob.query.filter(
        (PromotionJob.source_site_id == env_id) |
        (PromotionJob.target_site_id == env_id)
    ).order_by(PromotionJob.created_at.desc()).first()
    if last_promotion:
        env_data['last_promotion'] = last_promotion.to_dict()

    # Add recent activity
    recent_activities = EnvironmentActivity.query.filter_by(
        site_id=env_id
    ).order_by(
        EnvironmentActivity.created_at.desc()
    ).limit(10).all()
    env_data['recent_activity'] = [a.to_dict() for a in recent_activities]

    return jsonify(env_data)


# =============================================================================
# Git Branches
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/git/branches', methods=['GET'])
@jwt_required()
def list_branches(prod_id):
    """List available git branches for multidev creation.

    Returns remote branches with latest commit info and whether
    a multidev environment already exists for each branch.
    """
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    result = GitWordPressService.list_branches(prod_id)
    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 400


# =============================================================================
# Multidev Cleanup
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/multidev/cleanup', methods=['POST'])
@jwt_required()
def cleanup_multidevs(prod_id):
    """Check for multidev environments with merged/deleted branches and clean them up.

    Body: {
        dry_run?: boolean (default true - only report, don't delete)
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    dry_run = data.get('dry_run', True)

    result = EnvironmentPipelineService.cleanup_stale_multidevs(
        production_site_id=prod_id,
        dry_run=dry_run,
        user_id=user_id
    )

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Sanitization Profiles
# =============================================================================

@environment_pipeline_bp.route('/sanitization-profiles', methods=['GET'])
@jwt_required()
def list_sanitization_profiles():
    """List all sanitization profiles for the current user.

    Automatically seeds built-in profiles on first access.
    """
    user_id = get_jwt_identity()

    # Seed built-in profiles if none exist
    existing = SanitizationProfile.query.filter_by(user_id=user_id).count()
    if existing == 0:
        SanitizationProfile.seed_builtins(user_id)

    profiles = SanitizationProfile.query.filter_by(
        user_id=user_id
    ).order_by(
        SanitizationProfile.is_builtin.desc(),
        SanitizationProfile.is_default.desc(),
        SanitizationProfile.name
    ).all()

    return jsonify({
        'profiles': [p.to_dict() for p in profiles],
        'total': len(profiles)
    })


@environment_pipeline_bp.route('/sanitization-profiles', methods=['POST'])
@jwt_required()
def create_sanitization_profile():
    """Create a new sanitization profile.

    Body: {
        name: string,
        description?: string,
        config: { ... },
        is_default?: boolean
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Profile name is required'}), 400

    if len(name) > 100:
        return jsonify({'error': 'Profile name must be 100 characters or less'}), 400

    config = data.get('config', {})
    if not isinstance(config, dict):
        return jsonify({'error': 'Config must be a JSON object'}), 400

    # If setting as default, unset any existing default
    is_default = data.get('is_default', False)
    if is_default:
        SanitizationProfile.query.filter_by(
            user_id=user_id, is_default=True
        ).update({'is_default': False})

    import json
    profile = SanitizationProfile(
        user_id=user_id,
        name=name,
        description=data.get('description', ''),
        config=json.dumps(config),
        is_default=is_default,
        is_builtin=False,
    )
    db.session.add(profile)
    db.session.commit()

    return jsonify({
        'success': True,
        'profile': profile.to_dict()
    }), 201


@environment_pipeline_bp.route('/sanitization-profiles/<int:profile_id>', methods=['PUT'])
@jwt_required()
def update_sanitization_profile(profile_id):
    """Update a sanitization profile.

    Body: {
        name?: string,
        description?: string,
        config?: { ... },
        is_default?: boolean
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    profile = SanitizationProfile.query.filter_by(
        id=profile_id, user_id=user_id
    ).first()

    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    if 'name' in data:
        name = data['name'].strip()
        if not name:
            return jsonify({'error': 'Profile name is required'}), 400
        if len(name) > 100:
            return jsonify({'error': 'Profile name must be 100 characters or less'}), 400
        profile.name = name

    if 'description' in data:
        profile.description = data['description']

    if 'config' in data:
        if not isinstance(data['config'], dict):
            return jsonify({'error': 'Config must be a JSON object'}), 400
        import json
        profile.config = json.dumps(data['config'])

    if 'is_default' in data:
        if data['is_default']:
            SanitizationProfile.query.filter_by(
                user_id=user_id, is_default=True
            ).update({'is_default': False})
        profile.is_default = data['is_default']

    db.session.commit()

    return jsonify({
        'success': True,
        'profile': profile.to_dict()
    })


@environment_pipeline_bp.route('/sanitization-profiles/<int:profile_id>', methods=['DELETE'])
@jwt_required()
def delete_sanitization_profile(profile_id):
    """Delete a sanitization profile. Built-in profiles cannot be deleted."""
    user_id = get_jwt_identity()

    profile = SanitizationProfile.query.filter_by(
        id=profile_id, user_id=user_id
    ).first()

    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    if profile.is_builtin:
        return jsonify({'error': 'Built-in profiles cannot be deleted'}), 400

    db.session.delete(profile)
    db.session.commit()

    return jsonify({
        'success': True,
        'message': f'Profile "{profile.name}" deleted'
    })


# =============================================================================
# Resource Limits
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/resources', methods=['PUT'])
@jwt_required()
def update_resource_limits(prod_id, env_id):
    """Update memory/CPU limits for an environment, restart containers.

    Body: {
        memory: "512M",
        cpus: "1.0",
        db_memory: "384M",
        db_cpus: "0.5"
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found'}), 400

    import json as json_lib
    result = EnvironmentDockerService.update_resource_limits(compose_path, data)

    if result.get('success'):
        env_site.resource_limits = json_lib.dumps(data)
        db.session.commit()
        _emit_pipeline_event(prod_id, 'environment_restarted', {'env_id': env_id, 'reason': 'resource_limits_updated'})
        return jsonify({'success': True, 'message': 'Resource limits updated, containers restarted', 'limits': data})
    else:
        return jsonify(result), 500


# =============================================================================
# Basic Auth
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/auth', methods=['POST'])
@jwt_required()
def enable_basic_auth(prod_id, env_id):
    """Enable Basic Auth for an environment. Returns generated credentials.

    Body: { username?: string }  (password is auto-generated)
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    from app.services.environment_domain_service import EnvironmentDomainService
    import secrets
    import string

    username = data.get('username', 'admin')
    password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))

    # Determine site_name for Nginx config
    site_name = f'wp-{env_site.container_prefix}' if env_site.container_prefix else None
    if not site_name:
        return jsonify({'error': 'Cannot determine Nginx config name'}), 400

    result = EnvironmentDomainService.enable_basic_auth(site_name, username, password)

    if result.get('success'):
        env_site.basic_auth_enabled = True
        env_site.basic_auth_user = username
        env_site.basic_auth_password_hash = result.get('password_hash', '')
        db.session.commit()

        return jsonify({
            'success': True,
            'enabled': True,
            'username': username,
            'password': password,
            'message': 'Basic Auth enabled. Save these credentials - password will not be shown again.'
        })
    else:
        return jsonify(result), 500


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/auth', methods=['DELETE'])
@jwt_required()
def disable_basic_auth(prod_id, env_id):
    """Disable Basic Auth for an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    from app.services.environment_domain_service import EnvironmentDomainService

    site_name = f'wp-{env_site.container_prefix}' if env_site.container_prefix else None
    if not site_name:
        return jsonify({'error': 'Cannot determine Nginx config name'}), 400

    result = EnvironmentDomainService.disable_basic_auth(site_name)

    if result.get('success'):
        env_site.basic_auth_enabled = False
        env_site.basic_auth_user = None
        env_site.basic_auth_password_hash = None
        db.session.commit()
        return jsonify({'success': True, 'enabled': False, 'message': 'Basic Auth disabled'})
    else:
        return jsonify(result), 500


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/auth', methods=['GET'])
@jwt_required()
def get_basic_auth_status(prod_id, env_id):
    """Get Basic Auth status for an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    return jsonify({
        'enabled': env_site.basic_auth_enabled or False,
        'username': env_site.basic_auth_user if env_site.basic_auth_enabled else None,
    })


# =============================================================================
# WP-CLI Execution
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/exec', methods=['POST'])
@jwt_required()
@limiter.limit("30 per minute")
def execute_wp_cli(prod_id, env_id):
    """Execute a WP-CLI command in an environment container.

    Body: { command: "wp plugin list --format=table" }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    command = data.get('command', '').strip()
    if not command:
        return jsonify({'error': 'command is required'}), 400

    # Ensure command starts with 'wp'
    if not command.startswith('wp '):
        command = f'wp {command}'

    # Add --allow-root flag if not present
    if '--allow-root' not in command:
        command += ' --allow-root'

    compose_path = EnvironmentPipelineService._get_compose_path(env_site)
    if not compose_path:
        return jsonify({'error': 'No Docker compose configuration found'}), 400

    result = EnvironmentDockerService.exec_in_container(compose_path, 'wordpress', command)

    return jsonify({
        'success': result.get('success', False),
        'output': result.get('output', ''),
        'error': result.get('error', ''),
        'command': command,
    })


# =============================================================================
# Health Checks
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/health', methods=['GET'])
@jwt_required()
def get_environment_health(prod_id, env_id):
    """Run and return health check results for an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    from app.services.environment_health_service import EnvironmentHealthService
    result = EnvironmentHealthService.check_health(env_id)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


@environment_pipeline_bp.route('/<int:prod_id>/health', methods=['GET'])
@jwt_required()
def get_project_health(prod_id):
    """Health summary for all project environments."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    from app.services.environment_health_service import EnvironmentHealthService
    result = EnvironmentHealthService.check_all_project_health(prod_id)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Disk Usage
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/disk-usage', methods=['GET'])
@jwt_required()
def get_environment_disk_usage(prod_id, env_id):
    """Return disk usage breakdown for an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    from app.services.environment_health_service import EnvironmentHealthService
    result = EnvironmentHealthService.get_disk_usage(env_id)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


@environment_pipeline_bp.route('/<int:prod_id>/disk-usage', methods=['GET'])
@jwt_required()
def get_project_disk_usage(prod_id):
    """Disk usage for all project environments."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    from app.services.environment_health_service import EnvironmentHealthService
    result = EnvironmentHealthService.get_disk_usage_for_project(prod_id)

    if result.get('success'):
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Bulk Operations
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/bulk', methods=['POST'])
@jwt_required()
@limiter.limit("5 per minute")
def bulk_operations(prod_id):
    """Execute bulk operations on multiple environments.

    Body: {
        operations: [
            { action: "stop"|"start"|"restart"|"sync", env_ids: [1, 2, 3] }
        ]
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    operations = data.get('operations', [])
    if not operations:
        return jsonify({'error': 'operations array is required'}), 400

    results = []
    env_ids_in_project = {prod_id} | {e.id for e in site.environments}

    for op in operations:
        action = op.get('action')
        env_ids = op.get('env_ids', [])

        if action not in ('stop', 'start', 'restart', 'sync'):
            results.append({'action': action, 'error': 'Invalid action'})
            continue

        op_results = []
        for env_id in env_ids:
            if env_id not in env_ids_in_project:
                op_results.append({'env_id': env_id, 'success': False, 'error': 'Not in this project'})
                continue

            env_site = WordPressSite.query.get(env_id)
            if not env_site:
                op_results.append({'env_id': env_id, 'success': False, 'error': 'Not found'})
                continue

            compose_path = EnvironmentPipelineService._get_compose_path(env_site)
            if not compose_path:
                op_results.append({'env_id': env_id, 'success': False, 'error': 'No compose config'})
                continue

            if action == 'stop':
                result = EnvironmentDockerService.stop_environment(compose_path)
                if result.get('success') and env_site.application:
                    env_site.application.status = 'stopped'
            elif action == 'start':
                result = EnvironmentDockerService.start_environment(compose_path)
                if result.get('success') and env_site.application:
                    env_site.application.status = 'running'
            elif action == 'restart':
                result = EnvironmentDockerService.restart_environment(compose_path)
                if result.get('success') and env_site.application:
                    env_site.application.status = 'running'
            elif action == 'sync':
                result = EnvironmentPipelineService.sync_from_production(
                    env_site_id=env_id, sync_type='full', user_id=user_id
                )

            op_results.append({
                'env_id': env_id,
                'success': result.get('success', False),
                'message': result.get('message') or result.get('error'),
            })

        results.append({'action': action, 'results': op_results})

    db.session.commit()

    _emit_pipeline_event(prod_id, 'bulk_operation_completed', {
        'operations': [op.get('action') for op in operations],
    })

    return jsonify({'success': True, 'results': results})


# =============================================================================
# Auto-Sync Schedule
# =============================================================================

@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/auto-sync', methods=['PUT'])
@jwt_required()
def update_auto_sync_schedule(prod_id, env_id):
    """Set/update auto-sync schedule for an environment.

    Body: {
        enabled: true,
        schedule: "0 3 * * *"
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    if env_site.is_production or env_site.environment_type == 'production':
        return jsonify({'error': 'Cannot set auto-sync on production environment'}), 400

    enabled = data.get('enabled', False)
    schedule = data.get('schedule', '')

    if enabled and not schedule:
        return jsonify({'error': 'schedule is required when enabled is true'}), 400

    # Validate cron expression
    if enabled and schedule:
        try:
            from croniter import croniter
            if not croniter.is_valid(schedule):
                return jsonify({'error': 'Invalid cron expression'}), 400
        except ImportError:
            # If croniter is not installed, do basic validation
            parts = schedule.split()
            if len(parts) != 5:
                return jsonify({'error': 'Invalid cron expression (must have 5 fields)'}), 400

    env_site.auto_sync_enabled = enabled
    env_site.auto_sync_schedule = schedule if enabled else None
    db.session.commit()

    return jsonify({
        'success': True,
        'enabled': enabled,
        'schedule': schedule if enabled else None,
        'message': f'Auto-sync {"enabled" if enabled else "disabled"}',
    })


@environment_pipeline_bp.route('/<int:prod_id>/environments/<int:env_id>/auto-sync', methods=['GET'])
@jwt_required()
def get_auto_sync_schedule(prod_id, env_id):
    """Get current auto-sync schedule for an environment."""
    user_id = get_jwt_identity()

    site, error = _get_production_site(prod_id, user_id)
    if error:
        return error

    env_site, error = _get_environment_site(env_id, user_id)
    if error:
        return error

    if env_site.id != prod_id and env_site.production_site_id != prod_id:
        return jsonify({'error': 'Environment does not belong to this project'}), 400

    result = {
        'enabled': env_site.auto_sync_enabled or False,
        'schedule': env_site.auto_sync_schedule,
    }

    # Calculate next run times if enabled
    if env_site.auto_sync_enabled and env_site.auto_sync_schedule:
        try:
            from croniter import croniter
            from datetime import datetime
            cron = croniter(env_site.auto_sync_schedule, datetime.utcnow())
            result['next_runs'] = [
                cron.get_next(datetime).isoformat() for _ in range(3)
            ]
        except ImportError:
            result['next_runs'] = []

    return jsonify(result)


# =============================================================================
# WebSocket Helper
# =============================================================================

def _emit_pipeline_event(prod_id, event_type, data):
    """Emit a WebSocket event for pipeline operations.

    Events are broadcast to the room 'pipeline_{prod_id}'.
    """
    try:
        from app import get_socketio
        sio = get_socketio()
        if sio:
            import time
            sio.emit('pipeline_event', {
                'project_id': prod_id,
                'event': event_type,
                'data': data,
                'timestamp': time.time()
            }, room=f'pipeline_{prod_id}')
    except Exception:
        pass  # WebSocket emit is best-effort, don't fail the request
