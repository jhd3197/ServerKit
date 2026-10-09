"""Environment endpoints (under a Project).

Environments are children of a project; access is derived from the parent
project's workspace, mirroring projects.py.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.project_service import ProjectService
from app.services.workspace_service import WorkspaceService
from app.middleware.rbac import get_current_user
from app.exceptions import permission_denied

environments_bp = Blueprint('environments', __name__)


def _accessible_workspace_ids(user):
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is not None:
        return [ws_id]
    if user.is_admin:
        from app.models.workspace import Workspace
        return [w.id for w in Workspace.query.all()]
    return [w.id for w in WorkspaceService.list_workspaces(user_id=user.id)]


def _project_for_write(user, project_id):
    """Return (project, error_response). error_response is a (json, status) tuple
    when the project can't be written by this user, else None."""
    project = ProjectService.get_project(project_id)
    if not project:
        return None, (jsonify({'error': 'Project not found'}), 404)
    if not user.is_admin and project.workspace_id not in set(_accessible_workspace_ids(user)):
        raise permission_denied()
    if not WorkspaceService.can_write_in_workspace(user, project.workspace_id):
        return None, (jsonify({'error': 'You have read-only access to this workspace'}), 403)
    return project, None


@environments_bp.route('', methods=['POST'])
@environments_bp.route('/', methods=['POST'])
@jwt_required()
def create_environment():
    """Create an environment under a project. Body: {project_id, name, is_default?}."""
    user = get_current_user()
    data = request.get_json() or {}
    project_id = data.get('project_id')
    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Environment name is required'}), 400

    project, err = _project_for_write(user, project_id)
    if err:
        return err

    try:
        env = ProjectService.create_environment(
            project_id, name=name, is_default=bool(data.get('is_default')))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    from app import db
    db.session.commit()
    return jsonify({'message': 'Environment created', 'environment': env.to_dict(include_counts=True)}), 201


@environments_bp.route('/<int:environment_id>', methods=['PUT'])
@jwt_required()
def update_environment(environment_id):
    user = get_current_user()
    env = ProjectService.get_environment(environment_id)
    if not env:
        return jsonify({'error': 'Environment not found'}), 404
    _, err = _project_for_write(user, env.project_id)
    if err:
        return err

    data = request.get_json() or {}
    updated = ProjectService.update_environment(
        environment_id, name=data.get('name'), is_default=data.get('is_default'))
    return jsonify({'message': 'Environment updated', 'environment': updated.to_dict(include_counts=True)}), 200


@environments_bp.route('/<int:environment_id>', methods=['DELETE'])
@jwt_required()
def delete_environment(environment_id):
    """Delete an environment. Refuses (409) if it's the project's only one;
    detaches assigned apps (environment_id -> NULL) otherwise."""
    user = get_current_user()
    env = ProjectService.get_environment(environment_id)
    if not env:
        return jsonify({'error': 'Environment not found'}), 404
    _, err = _project_for_write(user, env.project_id)
    if err:
        return err

    result = ProjectService.delete_environment(environment_id)
    if result == 'last':
        return jsonify({'error': 'Cannot delete the only environment of a project.'}), 409
    return jsonify({'message': 'Environment deleted'}), 200


@environments_bp.route('/reorder', methods=['POST'])
@jwt_required()
def reorder_environments():
    """Reorder a project's environments. Body: {project_id, ordered_ids:[...]}"""
    user = get_current_user()
    data = request.get_json() or {}
    project_id = data.get('project_id')
    ordered_ids = data.get('ordered_ids')
    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    if not isinstance(ordered_ids, list):
        return jsonify({'error': 'ordered_ids must be a list'}), 400

    _, err = _project_for_write(user, project_id)
    if err:
        return err

    envs = ProjectService.reorder_environments(project_id, ordered_ids)
    return jsonify({'environments': [e.to_dict(include_counts=True) for e in envs]}), 200
