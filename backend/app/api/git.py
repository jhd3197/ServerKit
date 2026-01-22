"""Git Server API endpoints for managing integrated Gitea instance and webhooks."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from ..services.git_service import GitService
from ..services.webhook_service import WebhookService
from ..services.gitea_api_service import GiteaAPIService
from ..services.git_deploy_service import GitDeployService

git_bp = Blueprint('git', __name__)


@git_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get Gitea installation status."""
    result = GitService.get_gitea_status()
    return jsonify(result), 200


@git_bp.route('/requirements', methods=['GET'])
@jwt_required()
def get_requirements():
    """Get resource requirements for Gitea installation."""
    result = GitService.get_gitea_resource_requirements()
    return jsonify(result), 200


@git_bp.route('/install', methods=['POST'])
@jwt_required()
def install():
    """Install Gitea with PostgreSQL."""
    data = request.get_json() or {}

    result = GitService.install_gitea(
        admin_user=data.get('adminUser', 'admin'),
        admin_email=data.get('adminEmail'),
        admin_password=data.get('adminPassword')
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@git_bp.route('/uninstall', methods=['POST'])
@jwt_required()
def uninstall():
    """Uninstall Gitea and optionally remove data."""
    data = request.get_json() or {}

    result = GitService.uninstall_gitea(
        remove_data=data.get('removeData', False)
    )

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/start', methods=['POST'])
@jwt_required()
def start():
    """Start Gitea server."""
    result = GitService.start_gitea()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/stop', methods=['POST'])
@jwt_required()
def stop():
    """Stop Gitea server."""
    result = GitService.stop_gitea()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/restart', methods=['POST'])
@jwt_required()
def restart():
    """Restart Gitea server."""
    result = GitService.restart_gitea()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# ==================== WEBHOOK ENDPOINTS ====================

@git_bp.route('/webhooks', methods=['GET'])
@jwt_required()
def list_webhooks():
    """List all configured webhooks."""
    result = WebhookService.list_webhooks()
    return jsonify(result), 200


@git_bp.route('/webhooks', methods=['POST'])
@jwt_required()
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
        zero_downtime=data.get('zeroDowntime', False)
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>', methods=['GET'])
@jwt_required()
def get_webhook(webhook_id):
    """Get a specific webhook."""
    result = WebhookService.get_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/webhooks/<int:webhook_id>', methods=['PUT'])
@jwt_required()
def update_webhook(webhook_id):
    """Update a webhook."""
    data = request.get_json() or {}

    result = WebhookService.update_webhook(webhook_id, data)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>', methods=['DELETE'])
@jwt_required()
def delete_webhook(webhook_id):
    """Delete a webhook."""
    result = WebhookService.delete_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>/toggle', methods=['POST'])
@jwt_required()
def toggle_webhook(webhook_id):
    """Toggle webhook active status."""
    result = WebhookService.toggle_webhook(webhook_id)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/webhooks/<int:webhook_id>/logs', methods=['GET'])
@jwt_required()
def get_webhook_logs(webhook_id):
    """Get logs for a specific webhook."""
    limit = request.args.get('limit', 50, type=int)
    result = WebhookService.get_webhook_logs(webhook_id, limit=limit)
    return jsonify(result), 200


@git_bp.route('/webhooks/<int:webhook_id>/test', methods=['POST'])
@jwt_required()
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


# ==================== REPOSITORY ENDPOINTS ====================

@git_bp.route('/repos', methods=['GET'])
@jwt_required()
def list_repositories():
    """List all repositories in Gitea."""
    token = request.args.get('token')
    limit = request.args.get('limit', 50, type=int)

    result = GiteaAPIService.list_repositories(token=token, limit=limit)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/repos/<owner>/<repo>', methods=['GET'])
@jwt_required()
def get_repository(owner, repo):
    """Get repository details."""
    token = request.args.get('token')

    result = GiteaAPIService.get_repository(owner, repo, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/repos/<owner>/<repo>/stats', methods=['GET'])
@jwt_required()
def get_repo_stats(owner, repo):
    """Get repository statistics."""
    token = request.args.get('token')

    result = GiteaAPIService.get_repo_stats(owner, repo, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/repos/<owner>/<repo>/branches', methods=['GET'])
@jwt_required()
def list_branches(owner, repo):
    """List repository branches."""
    token = request.args.get('token')

    result = GiteaAPIService.list_branches(owner, repo, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/repos/<owner>/<repo>/branches/<branch>', methods=['GET'])
@jwt_required()
def get_branch(owner, repo, branch):
    """Get branch details."""
    token = request.args.get('token')

    result = GiteaAPIService.get_branch(owner, repo, branch, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/repos/<owner>/<repo>/commits', methods=['GET'])
@jwt_required()
def list_commits(owner, repo):
    """List repository commits."""
    token = request.args.get('token')
    branch = request.args.get('branch')
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 30, type=int)

    result = GiteaAPIService.list_commits(
        owner, repo,
        branch=branch,
        page=page,
        limit=limit,
        token=token
    )

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/repos/<owner>/<repo>/commits/<sha>', methods=['GET'])
@jwt_required()
def get_commit(owner, repo, sha):
    """Get commit details."""
    token = request.args.get('token')

    result = GiteaAPIService.get_commit(owner, repo, sha, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/repos/<owner>/<repo>/contents', methods=['GET'])
@jwt_required()
def list_files(owner, repo):
    """List files in repository directory."""
    token = request.args.get('token')
    ref = request.args.get('ref', 'main')
    path = request.args.get('path', '')

    result = GiteaAPIService.list_files(owner, repo, ref=ref, path=path, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/repos/<owner>/<repo>/contents/<path:filepath>', methods=['GET'])
@jwt_required()
def get_file_content(owner, repo, filepath):
    """Get file content."""
    token = request.args.get('token')
    ref = request.args.get('ref', 'main')

    result = GiteaAPIService.get_file_content(owner, repo, filepath, ref=ref, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/repos/<owner>/<repo>/readme', methods=['GET'])
@jwt_required()
def get_readme(owner, repo):
    """Get repository README."""
    token = request.args.get('token')
    ref = request.args.get('ref')

    result = GiteaAPIService.get_readme(owner, repo, ref=ref, token=token)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/version', methods=['GET'])
@jwt_required()
def get_gitea_version():
    """Get Gitea server version."""
    result = GiteaAPIService.get_server_version()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


# ==================== DEPLOYMENT ENDPOINTS ====================

@git_bp.route('/deployments/app/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app_deployments(app_id):
    """Get deployment history for an application."""
    limit = request.args.get('limit', 20, type=int)
    result = GitDeployService.get_deployments(app_id, limit=limit)
    return jsonify(result), 200


@git_bp.route('/deployments/<int:deployment_id>', methods=['GET'])
@jwt_required()
def get_deployment(deployment_id):
    """Get a specific deployment with logs."""
    include_logs = request.args.get('logs', 'false').lower() == 'true'
    result = GitDeployService.get_deployment(deployment_id, include_logs=include_logs)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@git_bp.route('/deployments/app/<int:app_id>/deploy', methods=['POST'])
@jwt_required()
def manual_deploy(app_id):
    """Trigger a manual deployment for an application."""
    data = request.get_json() or {}
    branch = data.get('branch')

    result = GitDeployService.manual_deploy(app_id, branch=branch)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/deployments/app/<int:app_id>/rollback', methods=['POST'])
@jwt_required()
def rollback_deployment(app_id):
    """Rollback to a previous deployment version."""
    data = request.get_json() or {}
    target_version = data.get('targetVersion')

    result = GitDeployService.rollback(app_id, target_version=target_version)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@git_bp.route('/deployments/webhook/<int:webhook_id>', methods=['GET'])
@jwt_required()
def get_webhook_deployments(webhook_id):
    """Get deployments triggered by a specific webhook."""
    from app.models import GitDeployment

    limit = request.args.get('limit', 20, type=int)
    deployments = GitDeployment.query.filter_by(webhook_id=webhook_id)\
        .order_by(GitDeployment.created_at.desc())\
        .limit(limit).all()

    return jsonify({
        'success': True,
        'deployments': [d.to_dict() for d in deployments],
        'count': len(deployments)
    }), 200
