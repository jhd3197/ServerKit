# Bucket: PER-APP (plan 29 #9). App-linked job reads gate on the app-grant
# seam (can_access_app); retries require can_operate_app. App-less jobs
# (template installs, simulated deploys) are requester-or-admin only. The
# job list is admin-only globally and app-access-gated when app_id is given.
"""Deployment job API endpoints."""

from flask import Blueprint, current_app, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.middleware.rbac import app_access_tier, get_current_user
from app.models import User, Application
from app.models.deployment_job import DeploymentJob, DeploymentJobLog
from app.services.deployment_job_service import DeploymentJobService
from app.services.resource_grant_service import ResourceGrantService
from app.exceptions import not_found, permission_denied

deployment_jobs_bp = Blueprint('deployment_jobs', __name__)


def _job_visible_to(user, job):
    """Read gate for one job: app-linked jobs follow the app's grant seam;
    app-less jobs belong to their requester (or a panel admin)."""
    if job.app_id:
        app = Application.query_active().filter_by(id=job.app_id).first()
        return app is not None and ResourceGrantService.can_access_app(user, app)
    return user.is_admin or job.requested_by == user.id


def _job_operable_by(user, job):
    """Operate gate (retry): app-linked jobs need member+ on the app; app-less
    jobs stay requester-or-admin."""
    if job.app_id:
        app = Application.query_active().filter_by(id=job.app_id).first()
        return app is not None and ResourceGrantService.can_operate_app(user, app)
    return user.is_admin or job.requested_by == user.id


def _job_payload(job, user, include_plan=False, include_logs=False):
    """Serialize action authority beside the deployment record.

    Deployments have a retry endpoint but no cancellation endpoint. Permission
    is evaluated per caller here so viewers never receive an optimistic action
    that the mutation route would reject.
    """
    payload = job.to_dict(include_plan=include_plan, include_logs=include_logs)
    payload['can_cancel'] = False
    payload['can_retry'] = job.status == 'failed' and _job_operable_by(user, job)
    return payload


@deployment_jobs_bp.route('/simulate', methods=['GET'])
@jwt_required()
def get_simulate_info():
    """Simulated-deploy availability + scenario catalog (plan 51.5 dev tool).

    404 when the DEMO_DEPLOYS_ENABLED gate is off (production default), so the
    surface simply doesn't exist outside dev.
    """
    if not current_app.config.get('DEMO_DEPLOYS_ENABLED'):
        return jsonify({'error': 'Not found'}), 404
    from app.services.demo_deploy_service import DemoDeployService
    return jsonify({'enabled': True,
                    'scenarios': DemoDeployService.list_scenarios()}), 200


@deployment_jobs_bp.route('/simulate', methods=['POST'])
@jwt_required()
def simulate_deployment():
    """Create a simulated deployment job that streams scripted output through
    the real console pipeline. Body: {scenario, speed?}; ?wait=true runs it
    synchronously (tests)."""
    if not current_app.config.get('DEMO_DEPLOYS_ENABLED'):
        return jsonify({'error': 'Not found'}), 404
    # Even with the demo flag on, creating jobs is not a viewer capability.
    user = get_current_user()
    if not user or not user.is_developer:
        return jsonify({'error': 'Developer access required'}), 403
    from flask_jwt_extended import get_jwt_identity
    from app.services.demo_deploy_service import DemoDeployService

    data = request.get_json(silent=True) or {}
    wait = request.args.get('wait', 'false').lower() == 'true'
    result = DemoDeployService.create(
        scenario=data.get('scenario') or '',
        speed=data.get('speed') or 'fast',
        user_id=get_jwt_identity(),
        wait=wait,
        params=data.get('params') if isinstance(data.get('params'), dict) else None,
        title=data.get('title'),
    )
    if not result.get('success'):
        return jsonify({'error': result.get('error')}), 400
    return jsonify(result), 202


@deployment_jobs_bp.route('', methods=['GET'])
@jwt_required()
def list_deployment_jobs():
    """List deployment jobs. App-scoped queries require access to that app;
    global queries (no app_id) are restricted to panel admins."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    status = request.args.get('status')
    target_server_id = request.args.get('server_id')
    app_id = request.args.get('app_id', type=int)
    limit = request.args.get('limit', 50, type=int)

    scoped_app = None
    if app_id:
        app = Application.query_active().filter_by(id=app_id).first()
        if not app:
            raise not_found('service')
        if not user or app_access_tier(user, app) is None:
            raise permission_denied()
        scoped_app = app
    elif not user or not user.is_admin:
        raise permission_denied()

    jobs = DeploymentJobService.list_jobs(
        status=status,
        target_server_id=target_server_id,
        app_id=app_id,
        limit=min(limit, 200),
    )
    can_retry_scoped = bool(
        user and scoped_app and ResourceGrantService.can_operate_app(user, scoped_app)
    )
    for job in jobs:
        job['can_cancel'] = False
        job['can_retry'] = job.get('status') == 'failed' and (
            bool(user and user.is_admin) if scoped_app is None else can_retry_scoped
        )
    return jsonify({'jobs': jobs}), 200


@deployment_jobs_bp.route('/<job_id>', methods=['GET'])
@jwt_required()
def get_deployment_job(job_id):
    include_logs = request.args.get('logs', 'true').lower() == 'true'
    include_plan = request.args.get('plan', 'false').lower() == 'true'
    job = DeploymentJob.query.get(job_id)
    if not job:
        raise not_found('deployment')
    user = get_current_user()
    if not user or not _job_visible_to(user, job):
        raise permission_denied()
    return jsonify({'job': _job_payload(
        job, user, include_logs=include_logs, include_plan=include_plan,
    )}), 200


@deployment_jobs_bp.route('/<job_id>/retry', methods=['POST'])
@jwt_required()
def retry_deployment_job(job_id):
    """Retry a failed deployment job by cloning it and enqueuing a fresh run
    (plan 51 D8). Only failed jobs may be retried."""
    job = DeploymentJob.query.get(job_id)
    if not job:
        raise not_found('deployment')
    user = get_current_user()
    if not user or not _job_operable_by(user, job):
        raise permission_denied()
    result = DeploymentJobService.retry_job(job_id, user_id=get_jwt_identity())
    if not result.get('success'):
        # Distinguish "no such job" from a state/enqueue error by the result's
        # code, never by its wording.
        if result.get('code') == 'not_found':
            raise not_found('deployment')
        return jsonify({'error': result.get('error')}), 400
    if result.get('job'):
        # A retry creates a pending clone. It has neither a retry nor cancel
        # endpoint at this point, matching the capability contract above.
        result['job']['can_cancel'] = False
        result['job']['can_retry'] = False
    return jsonify(result), 202


@deployment_jobs_bp.route('/<job_id>/logs', methods=['GET'])
@jwt_required()
def get_deployment_job_logs(job_id):
    job = DeploymentJob.query.get(job_id)
    if not job:
        raise not_found('deployment')
    user = get_current_user()
    if not user or not _job_visible_to(user, job):
        raise permission_denied()

    after_id = request.args.get('after_id', type=int)
    query = DeploymentJobLog.query.filter_by(job_id=job_id)
    if after_id:
        query = query.filter(DeploymentJobLog.id > after_id)

    logs = query.order_by(DeploymentJobLog.created_at.asc()).all()
    return jsonify({'logs': [log.to_dict() for log in logs]}), 200
