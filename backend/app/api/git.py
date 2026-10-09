# Bucket: PER-APP (plan 29 #9, #11). The per-app deployment read gates on app
# visibility (require_app_member); webhook reads are scoped to the linked app's
# visibility (an unlinked webhook stays panel-wide viewer-visible). Webhook
# mutations and the Gitea host lifecycle stay admin-only.
"""Git webhook + deployment API — the deploy-pipeline half.

The Gitea self-host surface (lifecycle + repo browsing) moved to the
serverkit-git extension (plan 52 Phase 6), which mounts it back at this same
/api/v1/git prefix when installed."""

from flask import Blueprint, request, jsonify

from ..middleware.rbac import (
    admin_required, viewer_required, require_app_member,
    get_current_user, app_access_tier,
)
from ..models import Application, GitWebhook
from ..services.webhook_service import WebhookService
from ..services.git_deploy_service import GitDeployService
from app.exceptions import not_found, permission_denied

git_bp = Blueprint('git', __name__)


def _webhook_visible_to(user, webhook):
    """A webhook with no app linkage is a panel-wide viewer-visible resource; an
    app-linked webhook is visible only to callers who can reach that app
    (owner/admin/grant/workspace member — plan 29 #11)."""
    if not getattr(webhook, 'app_id', None):
        return True
    # Deliberately unfiltered: this gate falls through to "panel-wide visible"
    # when the app can't be resolved, so hiding tombstones here would WIDEN
    # access — deleting an app would publish its webhook to every viewer.
    app = Application.query.get(webhook.app_id)
    if app is None:
        return True
    return app_access_tier(user, app) is not None




# ==================== WEBHOOK ENDPOINTS ====================

@git_bp.route('/webhooks', methods=['GET'])
@viewer_required
def list_webhooks():
    """List webhooks the caller can see (plan 29 #11): every unlinked webhook
    plus any app-linked webhook whose app they can reach."""
    user = get_current_user()
    result = WebhookService.list_webhooks()
    webhooks = result.get('webhooks', [])
    visible = []
    for w in webhooks:
        wh = GitWebhook.query.get(w.get('id'))
        if wh is None or _webhook_visible_to(user, wh):
            visible.append(w)
    result['webhooks'] = visible
    if 'count' in result:
        result['count'] = len(visible)
    return jsonify(result), 200


@git_bp.route('/webhooks', methods=['POST'])
@admin_required
def create_webhook():
    """Create a new webhook."""
    data = request.get_json() or {}

    result = WebhookService.create_webhook(
        name=data.get('name'),
        source=data.get('source'),
        source_repo_url=data.get('sourceRepoUrl'),
        source_branch=data.get('sourceBranch', 'main'),
        local_repo_name=data.get('localRepoName'),
        sync_direction=data.get('syncDirection', 'pull'),
        auto_sync=data.get('autoSync', True),
        app_id=data.get('appId'),
        deploy_on_push=data.get('deployOnPush', False),
        pre_deploy_script=data.get('preDeployScript'),
        post_deploy_script=data.get('postDeployScript'),
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>', methods=['GET'])
@viewer_required
def get_webhook(webhook_id):
    """Get a specific webhook (scoped to the linked app's visibility, #11)."""
    user = get_current_user()
    wh = GitWebhook.query.get(webhook_id)
    if wh is None or not _webhook_visible_to(user, wh):
        return jsonify({'error': 'Not found'}), 404

    result = WebhookService.get_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/webhooks/<int:webhook_id>', methods=['PUT'])
@admin_required
def update_webhook(webhook_id):
    """Update a webhook."""
    data = request.get_json() or {}

    result = WebhookService.update_webhook(webhook_id, data)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>', methods=['DELETE'])
@admin_required
def delete_webhook(webhook_id):
    """Delete a webhook."""
    result = WebhookService.delete_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>/toggle', methods=['POST'])
@admin_required
def toggle_webhook(webhook_id):
    """Toggle webhook active status."""
    result = WebhookService.toggle_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>/logs', methods=['GET'])
@viewer_required
def get_webhook_logs(webhook_id):
    """Get logs for a specific webhook (scoped to the linked app's visibility)."""
    user = get_current_user()
    wh = GitWebhook.query.get(webhook_id)
    if wh is None or not _webhook_visible_to(user, wh):
        return jsonify({'error': 'Not found'}), 404
    limit = request.args.get('limit', 50, type=int)
    result = WebhookService.get_webhook_logs(webhook_id, limit=limit)
    return jsonify(result), 200


@git_bp.route('/webhooks/<int:webhook_id>/test', methods=['POST'])
@admin_required
def test_webhook(webhook_id):
    """Test a webhook by triggering a manual sync."""
    result = WebhookService.test_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# Public endpoint - no auth required (verified by signature)
@git_bp.route('/webhooks/receive/<token>', methods=['POST'])
def receive_webhook(token):
    """Receive incoming webhook from GitHub/GitLab/Bitbucket."""
    # Determine source from headers
    if 'X-GitHub-Event' in request.headers:
        source = 'github'
        event_type = request.headers.get('X-GitHub-Event')
        signature = request.headers.get('X-Hub-Signature-256')
        delivery_id = request.headers.get('X-GitHub-Delivery')
    elif 'X-Gitlab-Event' in request.headers:
        source = 'gitlab'
        event_type = request.headers.get('X-Gitlab-Event')
        signature = request.headers.get('X-Gitlab-Token')
        delivery_id = None
    elif 'X-Event-Key' in request.headers:
        source = 'bitbucket'
        event_type = request.headers.get('X-Event-Key')
        signature = request.headers.get('X-Hub-Signature')
        delivery_id = request.headers.get('X-Request-Id')
    else:
        return jsonify({'error': 'Unknown webhook source'}), 400

    result = WebhookService.handle_webhook(
        token=token,
        source=source,
        event_type=event_type,
        signature=signature,
        delivery_id=delivery_id,
        headers=dict(request.headers),
        payload=request.get_data(),
        payload_json=request.get_json(silent=True)
    )

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# ==================== DEPLOYMENT ENDPOINTS ====================

@git_bp.route('/deployments/app/<int:app_id>', methods=['GET'])
@require_app_member()
def get_app_deployments(app_id):
    """Get deployment history for an application."""
    limit = request.args.get('limit', 20, type=int)
    result = GitDeployService.get_deployments(app_id, limit=limit)
    return jsonify(result), 200


@git_bp.route('/deployments/<int:deployment_id>', methods=['GET'])
@viewer_required
def get_deployment(deployment_id):
    """Get a specific deployment with logs."""
    from app.models import GitDeployment

    deployment = GitDeployment.query.get(deployment_id)
    if deployment is None:
        raise not_found('deployment')

    app = Application.query_active().filter_by(id=deployment.app_id).first()
    if app is None or app_access_tier(get_current_user(), app) is None:
        raise permission_denied()

    include_logs = request.args.get('logs', 'false').lower() == 'true'
    result = GitDeployService.get_deployment(deployment_id, include_logs=include_logs)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/deployments/app/<int:app_id>/deploy', methods=['POST'])
@admin_required
def manual_deploy(app_id):
    """Trigger a manual deployment for an application."""
    data = request.get_json() or {}
    branch = data.get('branch')

    result = GitDeployService.manual_deploy(app_id, branch=branch)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/deployments/app/<int:app_id>/rollback', methods=['POST'])
@admin_required
def rollback_deployment(app_id):
    """Rollback to a previous deployment version."""
    data = request.get_json() or {}
    target_version = data.get('targetVersion')

    result = GitDeployService.rollback(app_id, target_version=target_version)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/deployments/webhook/<int:webhook_id>', methods=['GET'])
@viewer_required
def get_webhook_deployments(webhook_id):
    """Get deployments triggered by a specific webhook."""
    from app.models import GitDeployment

    webhook = GitWebhook.query.get(webhook_id)
    if webhook is None:
        return jsonify({'success': False, 'error': 'Webhook not found'}), 404
    if not _webhook_visible_to(get_current_user(), webhook):
        raise permission_denied()

    limit = request.args.get('limit', 20, type=int)
    deployments = GitDeployment.query.filter_by(webhook_id=webhook_id)\
        .order_by(GitDeployment.created_at.desc())\
        .limit(limit).all()

    return jsonify({
        'success': True,
        'deployments': [d.to_dict() for d in deployments],
        'count': len(deployments)
    }), 200
