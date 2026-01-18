from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.git_service import GitService

deploy_bp = Blueprint('deploy', __name__)


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


@deploy_bp.route('/apps/<int:app_id>/config', methods=['GET'])
@jwt_required()
def get_deploy_config(app_id):
    """Get deployment configuration for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    config = GitService.get_app_config(app_id)
    if not config:
        return jsonify({'configured': False}), 200

    return jsonify({
        'configured': True,
        'config': config
    }), 200


@deploy_bp.route('/apps/<int:app_id>/config', methods=['POST'])
@jwt_required()
@admin_required
def configure_deployment(app_id):
    """Configure Git deployment for an app."""
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    if 'repo_url' not in data:
        return jsonify({'error': 'repo_url is required'}), 400

    result = GitService.configure_deployment(
        app_id=app_id,
        app_path=app.root_path,
        repo_url=data['repo_url'],
        branch=data.get('branch', 'main'),
        auto_deploy=data.get('auto_deploy', True),
        pre_deploy_script=data.get('pre_deploy_script'),
        post_deploy_script=data.get('post_deploy_script')
    )

    return jsonify(result), 201 if result['success'] else 400


@deploy_bp.route('/apps/<int:app_id>/config', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_deployment(app_id):
    """Remove deployment configuration."""
    result = GitService.remove_deployment(app_id)
    return jsonify(result), 200 if result['success'] else 400


@deploy_bp.route('/apps/<int:app_id>/deploy', methods=['POST'])
@jwt_required()
def trigger_deploy(app_id):
    """Trigger a deployment."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    result = GitService.deploy(app_id, force=data.get('force', False))

    return jsonify(result), 200 if result['success'] else 400


@deploy_bp.route('/apps/<int:app_id>/pull', methods=['POST'])
@jwt_required()
def pull_changes(app_id):
    """Pull latest changes without running deploy scripts."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    result = GitService.pull_changes(app.root_path, data.get('branch'))

    return jsonify(result), 200 if result['success'] else 400


@deploy_bp.route('/apps/<int:app_id>/git-status', methods=['GET'])
@jwt_required()
def get_git_status(app_id):
    """Get Git status for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    status = GitService.get_git_status(app.root_path)
    return jsonify(status), 200


@deploy_bp.route('/apps/<int:app_id>/commit', methods=['GET'])
@jwt_required()
def get_commit_info(app_id):
    """Get current commit info for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    commit_info = GitService.get_commit_info(app.root_path)
    if commit_info:
        return jsonify({'commit': commit_info}), 200
    return jsonify({'error': 'Not a Git repository'}), 404


@deploy_bp.route('/history', methods=['GET'])
@jwt_required()
def get_deployment_history():
    """Get deployment history."""
    app_id = request.args.get('app_id', type=int)
    limit = request.args.get('limit', 50, type=int)

    history = GitService.get_deployment_history(app_id, limit)
    return jsonify({'deployments': history}), 200


@deploy_bp.route('/clone', methods=['POST'])
@jwt_required()
@admin_required
def clone_repository():
    """Clone a Git repository to a new location."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['repo_url', 'app_path']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = GitService.clone_repository(
        app_path=data['app_path'],
        repo_url=data['repo_url'],
        branch=data.get('branch', 'main')
    )

    return jsonify(result), 201 if result['success'] else 400


@deploy_bp.route('/apps/<int:app_id>/branches', methods=['GET'])
@jwt_required()
def get_branches(app_id):
    """Get list of remote branches for an app's repository."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    result = GitService.get_remote_branches(app.root_path)
    return jsonify(result), 200 if result.get('success') else 400


@deploy_bp.route('/branches', methods=['POST'])
@jwt_required()
def get_branches_from_url():
    """Get list of branches from a repository URL (before cloning)."""
    data = request.get_json()
    if not data or 'repo_url' not in data:
        return jsonify({'error': 'repo_url is required'}), 400

    result = GitService.get_remote_branches_from_url(data['repo_url'])
    return jsonify(result), 200 if result.get('success') else 400


@deploy_bp.route('/webhook-logs', methods=['GET'])
@jwt_required()
def get_webhook_logs():
    """Get webhook logs for debugging."""
    app_id = request.args.get('app_id', type=int)
    limit = request.args.get('limit', 50, type=int)

    logs = GitService.get_webhook_logs(app_id, limit)
    return jsonify({'logs': logs}), 200


# Webhook endpoint (no auth required)
@deploy_bp.route('/webhook/<int:app_id>/<token>', methods=['POST'])
def webhook(app_id, token):
    """Handle incoming webhook from Git provider."""
    # Detect provider based on headers
    provider = 'github'  # default
    signature = None

    if request.headers.get('X-Gitlab-Token'):
        provider = 'gitlab'
        signature = request.headers.get('X-Gitlab-Token')
    elif request.headers.get('X-Hub-Signature-256'):
        # Could be GitHub or Bitbucket
        if request.headers.get('X-Bitbucket-Type'):
            provider = 'bitbucket'
        else:
            provider = 'github'
        signature = request.headers.get('X-Hub-Signature-256')
    elif request.headers.get('X-Hub-Signature'):
        # Bitbucket uses X-Hub-Signature
        provider = 'bitbucket'
        signature = request.headers.get('X-Hub-Signature')

    # Log webhook for debugging
    GitService.log_webhook(app_id, provider, request.headers.to_wsgi_list(), request.data)

    # Verify webhook
    if not GitService.verify_webhook(app_id, token, signature, request.data, provider):
        return jsonify({'error': 'Invalid webhook'}), 403

    # Parse payload
    try:
        payload = request.get_json()
    except Exception:
        return jsonify({'error': 'Invalid payload'}), 400

    # Handle webhook
    result = GitService.handle_webhook(app_id, payload)

    return jsonify(result), 200 if result.get('success') else 400
