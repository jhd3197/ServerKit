"""Project endpoints (Workspace -> Project -> Environment -> Applications).

Projects are workspace-scoped. The active workspace is resolved the same way the
rest of the app resolves it: the X-Workspace-Id header (or ?workspace_id=), via
WorkspaceService.resolve_workspace_id (membership-checked, lenient). With no
active context we fall back to the workspaces the caller can access, so the list
always reflects the user's own projects without needing a header.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.models.project import Project
from app.services.project_service import ProjectService
from app.services.workspace_service import WorkspaceService
from app.middleware.rbac import get_current_user
from app.exceptions import permission_denied

projects_bp = Blueprint('projects', __name__)


def _active_workspace_id(user):
    """Resolve the active workspace for stamping a new project, defaulting to the
    user's Default workspace when no valid context is supplied."""
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id
    return ws_id


def _accessible_workspace_ids(user):
    """Workspace ids the caller may see projects for. With an explicit, valid
    workspace context, just that one; otherwise all the user's workspaces (admins
    see all)."""
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is not None:
        return [ws_id]
    if user.is_admin:
        from app.models.workspace import Workspace
        return [w.id for w in Workspace.query.all()]
    return [w.id for w in WorkspaceService.list_workspaces(user_id=user.id)]


def _can_view_project(user, project):
    if user.is_admin:
        return True
    return project.workspace_id in set(_accessible_workspace_ids(user))


@projects_bp.route('', methods=['GET'])
@projects_bp.route('/', methods=['GET'])
@jwt_required()
def list_projects():
    """List projects in the accessible workspace(s), each with resource counts."""
    user = get_current_user()
    ws_ids = _accessible_workspace_ids(user)
    projects = []
    for ws_id in ws_ids:
        projects.extend(ProjectService.list_projects(ws_id))
    return jsonify({'projects': [p.to_dict(include_counts=True) for p in projects]}), 200


@projects_bp.route('', methods=['POST'])
@projects_bp.route('/', methods=['POST'])
@jwt_required()
def create_project():
    """Create a project (auto-creates a default environment)."""
    user = get_current_user()
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Project name is required'}), 400

    ws_id = _active_workspace_id(user)
    if not WorkspaceService.can_write_in_workspace(user, ws_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403

    try:
        project = ProjectService.create_project(
            workspace_id=ws_id,
            name=name,
            description=data.get('description'),
            metadata=data.get('metadata'),
            default_environment=data.get('default_environment') or 'production',
        )
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    result = project.to_dict(include_counts=True)
    result['environments'] = [e.to_dict(include_counts=True)
                              for e in ProjectService.list_environments(project.id)]
    return jsonify({'message': 'Project created', 'project': result}), 201


@projects_bp.route('/<int:project_id>', methods=['GET'])
@jwt_required()
def get_project(project_id):
    """Get a project with its environments and resource counts."""
    user = get_current_user()
    project = ProjectService.get_project(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    if not _can_view_project(user, project):
        raise permission_denied()

    result = project.to_dict(include_counts=True)
    result['environments'] = [e.to_dict(include_counts=True)
                              for e in ProjectService.list_environments(project_id)]
    return jsonify({'project': result}), 200


@projects_bp.route('/<int:project_id>', methods=['PUT'])
@jwt_required()
def update_project(project_id):
    user = get_current_user()
    project = ProjectService.get_project(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    if not _can_view_project(user, project):
        raise permission_denied()
    if not WorkspaceService.can_write_in_workspace(user, project.workspace_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403

    data = request.get_json() or {}
    updated = ProjectService.update_project(
        project_id,
        name=data.get('name'),
        description=data.get('description'),
        metadata=data.get('metadata'),
    )
    return jsonify({'message': 'Project updated', 'project': updated.to_dict(include_counts=True)}), 200


@projects_bp.route('/<int:project_id>', methods=['DELETE'])
@jwt_required()
def delete_project(project_id):
    """Delete a project. Refuses (409) if it still has applications assigned."""
    user = get_current_user()
    project = ProjectService.get_project(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    if not _can_view_project(user, project):
        raise permission_denied()
    if not WorkspaceService.can_write_in_workspace(user, project.workspace_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403

    result = ProjectService.delete_project(project_id)
    if result == 'has_apps':
        return jsonify({
            'error': 'Project still has applications assigned. Reassign or remove them first.',
            'app_count': ProjectService.count_project_apps(project_id),
        }), 409
    return jsonify({'message': 'Project deleted'}), 200
