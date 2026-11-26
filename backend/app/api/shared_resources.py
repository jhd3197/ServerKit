"""Polymorphic shared resources API — tags + shared variable groups.

Mounted at ``/api/v1/shared``. Everything here is a JWT-protected facade over
:class:`~app.services.shared_resource_service.SharedResourceService`. Secret
variable values are always masked in responses via ``to_dict(mask_secrets=True)``
plus a defense-in-depth pass through :func:`mask_sensitive`.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.middleware.rbac import (
    get_current_user, require_workspace_access, require_workspace_role,
)
from app.services.resource_grant_service import ResourceGrantService
from app.services.shared_resource_service import SharedResourceService
from app.models.shared_resource import SharedVariableGroup
from app.utils.sensitive_data_filter import mask_sensitive
from app.api._request import json_object

shared_resources_bp = Blueprint('shared_resources', __name__)

# Workspace roles allowed to mutate shared variable groups and attachments.
_WRITE_ROLES = ['owner', 'admin', 'member']


def _bad(msg, code=400):
    return jsonify({'error': msg}), code


def _require(data, *keys):
    """Return the first missing key name, or None if all present/truthy."""
    for k in keys:
        if data.get(k) in (None, ''):
            return k
    return None


# ------------------------------------------------------------ authorization

def _scope_workspace_id(scope_type, scope_id):
    """Resolve a group scope to its owning workspace id, or None.

    Hierarchy: Workspace ← Project ← Environment. A dangling or malformed
    scope returns None so callers can deny without leaking what exists.
    """
    from app.models.workspace import Workspace
    from app.models.project import Project
    from app.models.environment import Environment
    try:
        sid = int(scope_id)
    except (TypeError, ValueError):
        return None
    if scope_type == SharedVariableGroup.SCOPE_WORKSPACE:
        ws = Workspace.query.get(sid)
        return ws.id if ws else None
    if scope_type == SharedVariableGroup.SCOPE_PROJECT:
        project = Project.query.get(sid)
        return project.workspace_id if project else None
    if scope_type == SharedVariableGroup.SCOPE_ENVIRONMENT:
        env = Environment.query.get(sid)
        if not env:
            return None
        project = Project.query.get(env.project_id)
        return project.workspace_id if project else None
    return None


def _resolve_app(resource_type, resource_id):
    """Resolve an app-backed resource (application, wordpress) to its
    Application, or None."""
    from app.models.application import Application
    from app.models.wordpress_site import WordPressSite
    try:
        rid = int(resource_id)
    except (TypeError, ValueError):
        return None
    if resource_type == 'application':
        return Application.query_active().filter_by(id=rid).first()
    if resource_type == 'wordpress':
        site = WordPressSite.query.get(rid)
        return (Application.query_active().filter_by(id=site.application_id).first()
                if site else None)
    return None


def _check_scope(scope_type, scope_id, write=False):
    """Authorize the current user against a variable-group scope.

    Returns None when allowed, else a ``(response, status)`` tuple. Panel
    admins bypass. 'application' scopes gate on can_access_app / can_edit_app;
    workspace/project/environment scopes resolve to the owning workspace and
    gate on membership (read) or write roles (mutation).
    """
    user = get_current_user()
    if user is None:
        return _bad('authentication required', 401)
    if user.is_admin:
        return None
    if scope_type == 'application':
        application = _resolve_app('application', scope_id)
        if application is None:
            return _bad('scope not found', 404)
        allowed = (ResourceGrantService.can_edit_app(user, application) if write
                   else ResourceGrantService.can_access_app(user, application))
        return None if allowed else _bad('access denied', 403)
    workspace_id = _scope_workspace_id(scope_type, scope_id)
    if workspace_id is None:
        return _bad('scope not found', 404)
    if write:
        return require_workspace_role(workspace_id, user, _WRITE_ROLES)
    return require_workspace_access(workspace_id, user)


def _get_scoped_group(group_id, write=False):
    """Fetch a group and authorize the caller against its scope.

    Returns ``(group, None)`` on success or ``(None, response)`` to return.
    """
    group = SharedResourceService.get_group(group_id)
    if not group:
        return None, _bad('group not found', 404)
    denied = _check_scope(group.scope_type, group.scope_id, write=write)
    if denied:
        return None, denied
    return group, None


def _check_resource_write(resource_type, resource_id):
    """Authorize attaching/detaching a group to a target resource.

    Attachments inject the group's variables into the target at deploy time,
    so this fails closed: app-backed targets (application, wordpress) require
    operate (member+) access; workspace-owned targets (database, server)
    require a write role in their workspace; types with no ownership seam
    ('service', ...) are admin-only.
    """
    user = get_current_user()
    if user is None:
        return _bad('authentication required', 401)
    if user.is_admin:
        return None
    if resource_type in ('application', 'wordpress'):
        application = _resolve_app(resource_type, resource_id)
        if application is None:
            return _bad('resource not found', 404)
        if not ResourceGrantService.can_operate_app(user, application):
            return _bad('access denied', 403)
        return None
    if resource_type == 'database':
        from app.models.managed_database import ManagedDatabase
        try:
            row = ManagedDatabase.query_active().filter_by(id=int(resource_id)).first()
        except (TypeError, ValueError):
            row = None
        if row is None:
            return _bad('resource not found', 404)
        if row.workspace_id is None:
            return _bad('access denied', 403)
        return require_workspace_role(row.workspace_id, user, _WRITE_ROLES)
    if resource_type == 'server':
        from app.models.server import Server
        server = Server.query.get(str(resource_id))
        if server is None:
            return _bad('resource not found', 404)
        if server.workspace_id is None:
            return _bad('access denied', 403)
        return require_workspace_role(server.workspace_id, user, _WRITE_ROLES)
    return _bad('access denied', 403)


def _check_resource_read(resource_type, resource_id):
    """Authorize reading the variables resolved FOR a target resource.

    The read-side twin of ``_check_resource_write``, and it fails closed the
    same way: the resolved set is the target's effective configuration, so the
    caller must be able to read the target itself. Returns None when allowed,
    else a ``(response, status)`` tuple.
    """
    user = get_current_user()
    if user is None:
        return _bad('authentication required', 401)
    if user.is_admin:
        return None
    if resource_type in ('application', 'wordpress'):
        application = _resolve_app(resource_type, resource_id)
        if application is None:
            return _bad('resource not found', 404)
        if not ResourceGrantService.can_access_app(user, application):
            return _bad('access denied', 403)
        return None
    if resource_type == 'database':
        from app.services.managed_database_service import ManagedDatabaseService
        try:
            row = ManagedDatabaseService.get(int(resource_id))
        except (TypeError, ValueError):
            row = None
        if row is None:
            return _bad('resource not found', 404)
        if row.workspace_id is None:
            return _bad('access denied', 403)
        return require_workspace_access(row.workspace_id, user)
    if resource_type == 'server':
        from app.services.workspace_service import WorkspaceService
        if WorkspaceService.get_accessible_server(user, str(resource_id)) is None:
            return _bad('resource not found', 404)
        return None
    return _bad('access denied', 403)


def _check_scope_context(context):
    """Authorize every scope a hierarchical resolve was asked to layer in.

    The scope ids arrive as query parameters, so without this any caller could
    name another workspace's id and read its variable groups
    (GHSA-893r-j92f-5q9x).
    """
    for scope_type, key in ((SharedVariableGroup.SCOPE_WORKSPACE, 'workspace_id'),
                            (SharedVariableGroup.SCOPE_PROJECT, 'project_id'),
                            (SharedVariableGroup.SCOPE_ENVIRONMENT, 'environment_id')):
        scope_id = context.get(key)
        if scope_id in (None, ''):
            continue
        denied = _check_scope(scope_type, scope_id)
        if denied:
            return denied
    return None


# ---------------------------------------------------------------- metadata

@shared_resources_bp.route('/resource-types', methods=['GET'])
@jwt_required()
def resource_types():
    """The catalog of supported polymorphic resource types."""
    return jsonify({'resource_types': list(SharedResourceService.RESOURCE_TYPES)})


# -------------------------------------------------------------------- tags

@shared_resources_bp.route('/tags', methods=['GET'])
@jwt_required()
def list_tags():
    """List tags for a resource, or resources for a tag.

    ``?resource_type=&resource_id=`` → tags on that resource.
    ``?tag=`` (optionally with ``resource_type``) → resources carrying the tag.
    """
    tag = request.args.get('tag')
    resource_type = request.args.get('resource_type')
    resource_id = request.args.get('resource_id')

    if tag:
        rows = SharedResourceService.list_resources_by_tag(tag, resource_type)
        return jsonify({'resources': [r.to_dict() for r in rows]})

    if not resource_type or resource_id in (None, ''):
        return _bad('resource_type and resource_id (or tag) are required')

    rows = SharedResourceService.list_tags(resource_type, resource_id)
    return jsonify({'tags': [r.to_dict() for r in rows]})


@shared_resources_bp.route('/tags', methods=['POST'])
@jwt_required()
def add_tag():
    data = json_object()
    missing = _require(data, 'resource_type', 'resource_id', 'tag')
    if missing:
        return _bad(f'{missing} is required')
    denied = _check_resource_write(data['resource_type'], data['resource_id'])
    if denied:
        return denied
    try:
        row = SharedResourceService.add_tag(
            data['resource_type'], data['resource_id'], data['tag']
        )
    except ValueError as e:
        return _bad(str(e))
    return jsonify(row.to_dict()), 201


@shared_resources_bp.route('/tags', methods=['DELETE'])
@jwt_required()
def remove_tag():
    # Accept either body or query params for convenience.
    data = json_object(optional=True)
    resource_type = data.get('resource_type') or request.args.get('resource_type')
    resource_id = data.get('resource_id')
    if resource_id is None:
        resource_id = request.args.get('resource_id')
    tag = data.get('tag') or request.args.get('tag')

    if not resource_type or resource_id in (None, '') or not tag:
        return _bad('resource_type, resource_id and tag are required')

    denied = _check_resource_write(resource_type, resource_id)
    if denied:
        return denied

    removed = SharedResourceService.remove_tag(resource_type, resource_id, tag)
    return jsonify({'removed': removed})


# --------------------------------------------------------- variable groups

@shared_resources_bp.route('/variable-groups', methods=['GET'])
@jwt_required()
def list_groups():
    scope_type = request.args.get('scope_type')
    scope_id = request.args.get('scope_id')
    if scope_type and scope_id not in (None, ''):
        denied = _check_scope(scope_type, scope_id)
        if denied:
            return denied
    else:
        # An unscoped listing spans every workspace — panel admins only.
        user = get_current_user()
        if user is None or not user.is_admin:
            return _bad('admin access required', 403)
    groups = SharedResourceService.list_groups(
        scope_type=scope_type,
        scope_id=scope_id,
    )
    return jsonify({'groups': [g.to_dict() for g in groups]})


@shared_resources_bp.route('/variable-groups', methods=['POST'])
@jwt_required()
def create_group():
    data = json_object()
    missing = _require(data, 'scope_type', 'scope_id', 'name')
    if missing:
        return _bad(f'{missing} is required')
    denied = _check_scope(data['scope_type'], data['scope_id'], write=True)
    if denied:
        return denied
    try:
        group = SharedResourceService.create_group(
            data['scope_type'], data['scope_id'], data['name'],
            data.get('description'),
        )
    except ValueError as e:
        return _bad(str(e))
    return jsonify(group.to_dict(include_variables=True)), 201


@shared_resources_bp.route('/variable-groups/<int:group_id>', methods=['GET'])
@jwt_required()
def get_group(group_id):
    group, denied = _get_scoped_group(group_id)
    if denied:
        return denied
    payload = group.to_dict(include_variables=True, mask_secrets=True)
    payload['attachments'] = [a.to_dict() for a in group.attachments]
    return jsonify(mask_sensitive(payload))


@shared_resources_bp.route('/variable-groups/<int:group_id>', methods=['PUT'])
@jwt_required()
def update_group(group_id):
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    data = json_object()
    try:
        group = SharedResourceService.update_group(
            group.id, name=data.get('name'), description=data.get('description')
        )
    except ValueError as e:
        return _bad(str(e))
    if not group:
        return _bad('group not found', 404)
    return jsonify(group.to_dict(include_variables=True))


@shared_resources_bp.route('/variable-groups/<int:group_id>', methods=['DELETE'])
@jwt_required()
def delete_group(group_id):
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    if not SharedResourceService.delete_group(group.id):
        return _bad('group not found', 404)
    return jsonify({'message': 'group deleted'})


# --------------------------------------------- variables within a group

@shared_resources_bp.route('/variable-groups/<int:group_id>/variables', methods=['POST'])
@jwt_required()
def add_variable(group_id):
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    data = json_object()
    if data.get('key') in (None, ''):
        return _bad('key is required')
    try:
        var = SharedResourceService.set_variable(
            group.id, data['key'], data.get('value', ''),
            is_secret=bool(data.get('is_secret', False)),
            target_service=data.get('target_service') if 'target_service' in data else None,
        )
    except ValueError as e:
        return _bad(str(e))
    if not var:
        return _bad('group not found', 404)
    return jsonify(var.to_dict(mask_secrets=True)), 201


@shared_resources_bp.route(
    '/variable-groups/<int:group_id>/variables/<int:variable_id>', methods=['PUT'])
@jwt_required()
def update_variable(group_id, variable_id):
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    from app.models.shared_resource import SharedVariable
    existing = SharedVariable.query.get(variable_id)
    if not existing or existing.group_id != group.id:
        return _bad('variable not found', 404)
    data = json_object()
    _kwargs = {'value': data.get('value'), 'is_secret': data.get('is_secret')}
    if 'target_service' in data:
        # Only forward when the client sent it, so it's preserved otherwise.
        _kwargs['target_service'] = data.get('target_service')
    var = SharedResourceService.update_variable(variable_id, **_kwargs)
    if not var:
        return _bad('variable not found', 404)
    return jsonify(var.to_dict(mask_secrets=True))


@shared_resources_bp.route(
    '/variable-groups/<int:group_id>/variables/<int:variable_id>', methods=['DELETE'])
@jwt_required()
def delete_variable(group_id, variable_id):
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    from app.models.shared_resource import SharedVariable
    var = SharedVariable.query.get(variable_id)
    if not var or var.group_id != group.id:
        return _bad('variable not found', 404)
    SharedResourceService.delete_variable(variable_id)
    return jsonify({'message': 'variable deleted'})


# --------------------------------------------------------------- attach

@shared_resources_bp.route('/variable-groups/<int:group_id>/attach', methods=['POST'])
@jwt_required()
def attach_group(group_id):
    data = json_object()
    missing = _require(data, 'resource_type', 'resource_id')
    if missing:
        return _bad(f'{missing} is required')
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    denied = _check_resource_write(data['resource_type'], data['resource_id'])
    if denied:
        return denied
    att = SharedResourceService.attach_group(
        group.id, data['resource_type'], data['resource_id']
    )
    if not att:
        return _bad('group not found', 404)
    return jsonify(att.to_dict()), 201


@shared_resources_bp.route('/variable-groups/<int:group_id>/detach', methods=['POST'])
@jwt_required()
def detach_group(group_id):
    data = json_object()
    missing = _require(data, 'resource_type', 'resource_id')
    if missing:
        return _bad(f'{missing} is required')
    group, denied = _get_scoped_group(group_id, write=True)
    if denied:
        return denied
    denied = _check_resource_write(data['resource_type'], data['resource_id'])
    if denied:
        return denied
    removed = SharedResourceService.detach_group(
        group.id, data['resource_type'], data['resource_id']
    )
    return jsonify({'detached': removed})


# -------------------------------------------------------------- resolved

@shared_resources_bp.route('/resolved', methods=['GET'])
@jwt_required()
def resolved():
    """Effective merged variables for a resource (secrets masked)."""
    resource_type = request.args.get('resource_type')
    resource_id = request.args.get('resource_id')
    if not resource_type or resource_id in (None, ''):
        return _bad('resource_type and resource_id are required')
    denied = _check_resource_read(resource_type, resource_id)
    if denied:
        return denied

    variables = SharedResourceService.resolve_variables(
        resource_type, resource_id, mask_secrets=True
    )
    groups = SharedResourceService.list_attached_groups(resource_type, resource_id)
    payload = {
        'resource_type': resource_type,
        'resource_id': str(resource_id),
        'variables': variables,
        'groups': [g.to_dict() for g in groups],
    }
    return jsonify(mask_sensitive(payload))


@shared_resources_bp.route('/resolved/hierarchical', methods=['GET'])
@jwt_required()
def resolved_hierarchical():
    """Hierarchical effective variables for a resource (secrets masked).

    Merges scope-inherited groups with the resource's directly-attached groups.
    Precedence, lowest → highest:

        workspace < project < environment < direct attachments

    Each returned variable carries a ``source_scope`` provenance marker. Pass the
    scope ids via ``?workspace_id=&project_id=&environment_id=``; any omitted
    scope simply contributes no layer.
    """
    resource_type = request.args.get('resource_type')
    resource_id = request.args.get('resource_id')
    if not resource_type or resource_id in (None, ''):
        return _bad('resource_type and resource_id are required')

    context = {
        'workspace_id': request.args.get('workspace_id'),
        'project_id': request.args.get('project_id'),
        'environment_id': request.args.get('environment_id'),
    }
    denied = _check_resource_read(resource_type, resource_id) or _check_scope_context(context)
    if denied:
        return denied
    variables = SharedResourceService.resolve_hierarchical(
        resource_type, resource_id, context=context, mask_secrets=True
    )
    payload = {
        'resource_type': resource_type,
        'resource_id': str(resource_id),
        'context': {k: v for k, v in context.items() if v not in (None, '')},
        'variables': variables,
    }
    return jsonify(mask_sensitive(payload))
