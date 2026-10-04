# Bucket: PER-APP read (plan 29 #9). Per-app history gates via _access →
# can_access_app. See docs/WORKSPACE_SCOPING.md.
"""Unified deployment surface (§3 unification).

One read namespace over the deploy records that today live in three places:
versioned build ``Deployment`` rows, webhook-triggered ``GitDeployment`` rows,
and the canonical ``DeploymentJob`` execution records (mounted here under
``/jobs``). The per-system blueprints (/builds, /deploy, /git, /deployment-jobs)
are unchanged; this is an additive, federated view so the frontend can read one
history instead of merging two sources.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.models import Application
from app.models.deployment import Deployment
from app.models.webhook import GitDeployment
from app.middleware.rbac import get_current_user
from app.exceptions import not_found, permission_denied

deployments_bp = Blueprint('deployments', __name__)


def _access(app_id):
    from app.services.resource_grant_service import ResourceGrantService
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')
    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()
    return app, None


@deployments_bp.route('/apps/<int:app_id>/history', methods=['GET'])
@jwt_required()
def app_history(app_id):
    """Federated deploy history for an app: versioned build Deployments +
    webhook GitDeployments, each tagged with ``source``, newest first.
    Query: ?source=build|webhook|all (default all), ?limit= (<=500)."""
    app, err = _access(app_id)
    if err:
        return err
    source = (request.args.get('source') or 'all').lower()
    try:
        limit = min(int(request.args.get('limit', 100)), 500)
    except (TypeError, ValueError):
        limit = 100

    items = []
    if source in ('all', 'build'):
        for d in (Deployment.query.filter_by(app_id=app_id)
                  .order_by(Deployment.created_at.desc()).limit(limit).all()):
            row = d.to_dict()
            row['source'] = 'build'
            items.append(row)
    if source in ('all', 'webhook'):
        for g in (GitDeployment.query.filter_by(app_id=app_id)
                  .order_by(GitDeployment.created_at.desc()).limit(limit).all()):
            row = g.to_dict()
            row['source'] = 'webhook'
            items.append(row)
    items.sort(key=lambda r: r.get('created_at') or '', reverse=True)
    items = items[:limit]
    return jsonify({'deployments': items, 'count': len(items)}), 200


@deployments_bp.route('/<int:deployment_id>', methods=['GET'])
@jwt_required()
def get_deployment(deployment_id):
    """A versioned build Deployment by id (the release ledger detail)."""
    d = Deployment.query.get(deployment_id)
    if not d:
        raise not_found('deployment')
    _, err = _access(d.app_id)
    if err:
        return err
    return jsonify({'deployment': d.to_dict(include_logs=True)}), 200
