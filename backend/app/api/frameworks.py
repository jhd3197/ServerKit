"""Framework picker API: "Start from a framework" in the New Service wizard.

``GET  /api/v1/frameworks``           the registry (what the picker renders)
``POST /api/v1/frameworks/scaffold``  scaffold + provision + deploy a project
"""

from flask import Blueprint, jsonify, request

from app.api._request import json_object
from app.api.apps import _resolve_project_env
from app.middleware.rbac import admin_required, get_current_user
from app.services.framework_registry import list_frameworks
from app.services.framework_scaffold_service import FrameworkError, FrameworkScaffoldService
from app.services.workspace_service import WorkspaceService

frameworks_bp = Blueprint('frameworks', __name__)


@frameworks_bp.route('', methods=['GET'])
@admin_required
def list_registered_frameworks():
    """GET /api/v1/frameworks -> {'frameworks': [...]}."""
    return jsonify({'frameworks': list_frameworks()}), 200


@frameworks_bp.route('/scaffold', methods=['POST'])
@admin_required
def scaffold_framework_project():
    """POST /api/v1/frameworks/scaffold

    Body: ``{framework, name, domain?, add_database?, project_id?, environment_id?}``.
    Returns the new service and the Deploy Console job (``deploy_job_id``).
    """
    user = get_current_user()
    data = json_object()

    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id
    project_id, environment_id = _resolve_project_env(data, ws_id)

    try:
        started = FrameworkScaffoldService.start(
            framework_id=data.get('framework'), name=data.get('name'),
            user_id=user.id, domain=data.get('domain'),
            add_database=data.get('add_database'),
            project_id=project_id, environment_id=environment_id, workspace_id=ws_id,
            public_host=request.host.split(':', 1)[0],
        )
    except FrameworkError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({
        'message': 'Framework project queued',
        'app': started['app'].to_dict(),
        'deploy_job_id': started['job_id'],
    }), 202
