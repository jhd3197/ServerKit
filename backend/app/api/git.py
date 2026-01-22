"""Git Server API endpoints for managing integrated Gitea instance."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from ..services.git_service import GitService

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
