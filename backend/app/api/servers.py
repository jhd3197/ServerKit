"""
Server Management API

Endpoints for managing remote servers and their agents.
"""

import os
import hashlib
import hmac
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from sqlalchemy.orm import joinedload
from app import db, limiter
from app.services.server_metrics_service import latest_metrics_by_server
from app.api._query import apply_query, QueryParseError
from app.api._request import json_object
from app.models.server import Server, ServerGroup, ServerMetrics, ServerCommand, AgentSession
from app.services.agent_registry import agent_registry
from app.services.remote_command_dispatcher import dispatch_agent_command
from app.services import connection_string as connection_string_codec
from app.middleware.rbac import admin_required, auth_required, developer_required, get_current_user
from app.middleware.api_scope_middleware import require_scope
from app.exceptions import (
    PermissionDeniedError, ValidationError, agent_offline, field_required, not_found,
)
from app.utils.ip_utils import validate_ip_pattern
from app.models.security_alert import SecurityAlert
from app.services.anomaly_detection_service import anomaly_detection_service
from app.services.server_metrics_service import ServerMetricsService


# Default token lifetime when the caller doesn't specify one. 7 days is
# the sweet spot from the design discussion: long enough that "I'll set
# this up later tonight" survives, short enough that an abandoned string
# doesn't linger forever as a usable bearer credential.
_DEFAULT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

# Sentinel placeholder name used while a server row exists but no agent
# has registered against it yet. The register endpoint replaces this
# with the agent's reported hostname; the prefix check there is the
# reason the format here must stay stable.
_PLACEHOLDER_NAME_PREFIX = "Pending pairing ("


def _placeholder_name(server_id: str) -> str:
    """Generate the placeholder name shown in the panel until pairing
    completes. Includes a short id suffix so multiple unpaired rows are
    distinguishable."""
    return f"{_PLACEHOLDER_NAME_PREFIX}{server_id[:8]})"


def _is_placeholder_name(name) -> bool:
    """True if the given name is the placeholder we issued at create
    time. Used by the register endpoint to decide whether overwriting
    with the agent's hostname is safe (a user-chosen name shouldn't be
    clobbered on re-pair)."""
    return isinstance(name, str) and name.startswith(_PLACEHOLDER_NAME_PREFIX)


def _resolve_token_expiry(expires_in):
    """Convert an ``expires_in`` request field to a concrete datetime.

    - missing / None       → default 7 days
    - positive int seconds → that many seconds from now
    - -1                   → "never" (100 years out — DB-safe sentinel)
    """
    if expires_in is None:
        seconds = _DEFAULT_TOKEN_TTL_SECONDS
    elif expires_in == -1:
        return datetime.utcnow() + timedelta(days=365 * 100)
    else:
        try:
            seconds = int(expires_in)
        except (TypeError, ValueError):
            seconds = _DEFAULT_TOKEN_TTL_SECONDS
        if seconds <= 0:
            seconds = _DEFAULT_TOKEN_TTL_SECONDS
    return datetime.utcnow() + timedelta(seconds=seconds)

servers_bp = Blueprint('servers', __name__)


def _agent_failure_status(result):
    """HTTP status for a failed agent command: an offline agent is a 503 and
    a refused command a 403, so the UI can say which; anything else is 500."""
    return {'AGENT_OFFLINE': 503, 'PERMISSION_DENIED': 403}.get(result.get('code'), 500)


def _get_operable_server(server_id):
    """The server, if the current user may operate it; 404 otherwise, so a
    non-member can't tell a foreign workspace's server from a missing one."""
    from app.services.workspace_service import WorkspaceService
    server = WorkspaceService.get_accessible_server(get_current_user(), server_id)
    if server is None:
        raise not_found('server')
    return server


def _ip_pattern_errors(allowed_ips):
    """One message per invalid allow-list entry; empty when all are valid."""
    if not isinstance(allowed_ips, list):
        return ['allowed_ips must be a list']
    errors = []
    for ip_pattern in allowed_ips:
        is_valid, error = validate_ip_pattern(ip_pattern)
        if not is_valid:
            errors.append(f"Invalid pattern '{ip_pattern}': {error}")
    return errors


def _get_external_base_url():
    """Return the public origin agents should use when this app sits behind a proxy."""
    public_url = current_app.config.get('PUBLIC_URL') or os.environ.get('SERVERKIT_PUBLIC_URL')
    if public_url:
        return public_url.rstrip('/')

    forwarded_proto = request.headers.get('X-Forwarded-Proto', request.scheme)
    forwarded_host = request.headers.get('X-Forwarded-Host', request.host)

    scheme = forwarded_proto.split(',')[0].strip() or request.scheme
    host = forwarded_host.split(',')[0].strip() or request.host

    return f"{scheme}://{host}".rstrip('/')


def _get_external_websocket_url():
    base_url = _get_external_base_url()

    if base_url.startswith('https://'):
        return f"wss://{base_url[len('https://'):]}/agent"
    if base_url.startswith('http://'):
        return f"ws://{base_url[len('http://'):]}/agent"

    return f"{base_url}/agent"


# ==================== Permission Profiles ====================

PERMISSION_PROFILES = {
    'docker_readonly': {
        'name': 'Docker Read-Only',
        'description': 'View containers, images, and metrics',
        'permissions': [
            'docker:container:read',
            'docker:image:read',
            'docker:compose:read',
            'docker:volume:read',
            'docker:network:read',
            'system:metrics:read',
            # Fleet doctor / survey reads: let the panel probe
            # host health without granting any mutating verb.
            'doctor:read',
            'systemd:read',
            'survey:read',
        ]
    },
    'docker_manager': {
        'name': 'Docker Manager',
        'description': 'Full Docker management and metrics',
        'permissions': [
            'docker:container:*',
            'docker:image:*',
            'docker:compose:*',
            'docker:volume:*',
            'docker:network:*',
            'system:metrics:read',
            'system:logs:read',
            'doctor:read',
            'systemd:read',
            'survey:read',
        ]
    },
    'deployment_runner': {
        'name': 'Deployment Runner',
        'description': 'Deploy and operate ServerKit-managed Docker Compose apps',
        'permissions': [
            'docker:container:*',
            'docker:image:*',
            'docker:compose:*',
            'docker:volume:*',
            'docker:network:*',
            'file:read',
            'file:write',
            'file:list',
            'system:metrics:read',
            'system:logs:read',
            'doctor:read',
            'systemd:read',
            'survey:read',
        ]
    },
    'full_access': {
        'name': 'Full Access',
        'description': 'All permissions including system commands',
        'permissions': ['*']
    }
}


# ==================== Server Groups ====================

@servers_bp.route('/groups', methods=['GET'])
@jwt_required()
def list_groups():
    """List all server groups"""
    groups = ServerGroup.query.all()
    return jsonify([g.to_dict() for g in groups])


@servers_bp.route('/groups', methods=['POST'])
@developer_required
def create_group():
    """Create a new server group"""
    data = json_object()

    if not data.get('name'):
        raise field_required('Name')

    group = ServerGroup(
        name=data['name'],
        description=data.get('description'),
        color=data.get('color', '#6366f1'),
        icon=data.get('icon', 'server'),
        parent_id=data.get('parent_id')
    )

    db.session.add(group)
    db.session.commit()

    return jsonify(group.to_dict()), 201


@servers_bp.route('/groups/<group_id>', methods=['GET'])
@jwt_required()
def get_group(group_id):
    """Get a server group by ID"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    return jsonify(group.to_dict(include_servers=True))


@servers_bp.route('/groups/<group_id>', methods=['PUT'])
@developer_required
def update_group(group_id):
    """Update a server group"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    data = json_object()

    if 'name' in data:
        group.name = data['name']
    if 'description' in data:
        group.description = data['description']
    if 'color' in data:
        group.color = data['color']
    if 'icon' in data:
        group.icon = data['icon']
    if 'parent_id' in data:
        group.parent_id = data['parent_id']

    db.session.commit()
    return jsonify(group.to_dict())


@servers_bp.route('/groups/<group_id>', methods=['DELETE'])
@admin_required
def delete_group(group_id):
    """Delete a server group"""
    group = ServerGroup.query.get(group_id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404

    # Move servers to no group
    for server in group.servers:
        server.group_id = None

    db.session.delete(group)
    db.session.commit()

    return jsonify({'message': 'Group deleted'})


# ==================== Servers ====================

@servers_bp.route('', methods=['GET'])
@auth_required()
@require_scope('servers:read')
def list_servers():
    """List all servers.

    API-key capable by deliberate decision (jwt_only_census exception):
    a Vela host holds one scoped ServerKit key and polls this route, so
    an X-API-Key with the servers:read scope is accepted alongside JWT.
    """
    # Query parameters
    group_id = request.args.get('group_id')
    status = request.args.get('status')
    tag = request.args.get('tag')

    # Workspace-aware scoping (#33). Servers are global today, so with no workspace
    # context this stays unfiltered; with a workspace context it filters to it.
    from app.models import User
    from app.services.workspace_service import WorkspaceService
    user = get_current_user()
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    query = WorkspaceService.scope_query(Server.query, Server, user,
                                         workspace_id=ws_id, owner_attr=None)
    query = WorkspaceService.filter_accessible_servers(query, user)

    if group_id:
        query = query.filter_by(group_id=group_id)
    if status:
        query = query.filter_by(status=status)
    if tag:
        query = query.filter(Server.tags.contains([tag]))

    # $select / $filter / $orderby / $skip / $top, all optional. No paging meta
    # is emitted here: this route answers with a bare JSON array, and wrapping
    # it in an envelope would break every existing caller.
    try:
        narrowed = apply_query(query, Server, request, select_extra=Server.DERIVED_FIELDS)
    except QueryParseError as exc:
        return jsonify({'error': str(exc)}), 400
    query = narrowed.query
    fields = narrowed.fields

    # `group_name` is a relationship load per row; hoist it when it is wanted.
    if fields is None or 'group_name' in fields:
        query = query.options(joinedload(Server.group))

    # An explicit $orderby wins; otherwise keep the by-name default the list UI
    # has always relied on.
    servers = (query.all() if request.args.get('$orderby')
               else query.order_by(Server.name).all())

    # Keep the list's insertion-order contract; monitoring uses sample time.
    metrics_by_server = latest_metrics_by_server(
        (server.id for server in servers), order_by='id',
    )

    result = []
    for server in servers:
        server_dict = server.to_dict(fields=fields)
        server_dict['is_connected'] = agent_registry.is_agent_connected(server.id)
        metrics = metrics_by_server.get(server.id)
        if metrics:
            server_dict['metrics'] = metrics.to_dict()
        result.append(server_dict)

    return jsonify(result)


@servers_bp.route('', methods=['POST'])
@developer_required
def create_server():
    """
    Create a new server slot and generate a connection string.

    The user no longer types a server name here — the agent's hostname
    becomes the name on first register. We just allocate a row, mint a
    single-use registration token, and bundle URL+token+expiry into one
    pasteable string.

    Body fields (all optional):
      expires_in: token TTL in seconds. -1 = never, missing = 7 days.
      description, group_id, tags, permissions, permission_profile,
      allowed_ips: passed through unchanged.
    """
    data = json_object()
    # Through the one identity door: @developer_required admits API-key
    # callers, for whom reading the JWT directly raises.
    creator = get_current_user()
    user_id = creator.id if creator else None

    # Generate registration token
    registration_token = Server.generate_registration_token()

    # Get permissions from profile or custom list. Default is `['*']`
    # (full access) — ServerKit is single-tenant by default and the
    # previous default of `[]` left every new server 403'ing on every
    # action. Users who want a locked-down ACL pass an explicit list
    # or `permission_profile`.
    permissions = data.get('permissions')
    profile = data.get('permission_profile')
    if profile and profile in PERMISSION_PROFILES:
        permissions = PERMISSION_PROFILES[profile]['permissions']
    elif permissions is None:
        permissions = ['*']

    expires_at = _resolve_token_expiry(data.get('expires_in'))

    # Stamp the workspace (#33): the requested one (membership-checked) or the default.
    from app.services.workspace_service import WorkspaceService
    user = creator
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    # Role reconciliation (#33): a workspace 'viewer' member has read-only access to
    # the active workspace and may not create resources in it (checked only when a
    # workspace context is explicitly active, so no-context behavior is unchanged).
    if ws_id is not None and not WorkspaceService.can_write_in_workspace(user, ws_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    # Enforce workspace server quota.
    server_count = Server.query.filter_by(workspace_id=ws_id).count()
    quota_error = WorkspaceService.check_quota(ws_id, server_count, 'max_servers')
    if quota_error:
        return jsonify({'error': quota_error}), 403

    server = Server(
        # Temporary name — replaced with the agent's hostname when the
        # agent calls /register. _is_placeholder_name() in the register
        # endpoint detects this and overwrites it; user-chosen names are
        # left alone.
        name=_PLACEHOLDER_NAME_PREFIX + "...)",
        description=data.get('description'),
        group_id=data.get('group_id'),
        tags=data.get('tags', []),
        permissions=permissions,
        allowed_ips=data.get('allowed_ips', []),
        registered_by=user_id,
        workspace_id=ws_id,
        registration_token_expires=expires_at,
    )
    server.set_registration_token(registration_token)

    db.session.add(server)
    db.session.commit()

    # Now that the row has its UUID, give it a placeholder with a short
    # id suffix so multiple unpaired rows are distinguishable in the UI.
    server.name = _placeholder_name(server.id)
    db.session.commit()

    panel_url = _get_external_base_url()
    conn_string = connection_string_codec.encode(
        url=panel_url,
        token=registration_token,
        expires_at=expires_at,
    )

    result = server.to_dict()
    result['registration_token'] = registration_token
    result['registration_expires'] = server.registration_token_expires.isoformat()
    result['connection_string'] = conn_string
    result['panel_url'] = panel_url

    return jsonify(result), 201


@servers_bp.route('/<server_id>/workspace', methods=['PUT'])
@developer_required
def set_server_workspace(server_id):
    """Reassign a server to a workspace (#33). Developer+; the target must be a
    workspace the caller can access (member or admin). A null/'default' target
    moves it back to the default workspace."""
    from app.models import User
    from app.models.workspace import Workspace
    from app.services.workspace_service import WorkspaceService
    user = get_current_user()
    server = _get_operable_server(server_id)
    if server.workspace_id and not WorkspaceService.can_write_in_workspace(user, server.workspace_id):
        raise PermissionDeniedError("You have read-only access to this server's workspace")

    target = json_object().get('workspace_id')
    if target in (None, '', 'default'):
        ws_id = WorkspaceService.ensure_default_workspace().id
    else:
        ws = Workspace.query.get(target)
        if not ws:
            return jsonify({'error': 'Workspace not found'}), 404
        if not user.is_admin and WorkspaceService.get_user_role(ws.id, user.id) is None:
            return jsonify({'error': 'Not a member of the target workspace'}), 403
        # Role reconciliation (#33): a 'viewer' member can't move resources into it.
        if not WorkspaceService.can_write_in_workspace(user, ws.id):
            return jsonify({'error': 'You have read-only access to the target workspace'}), 403
        # Enforce workspace server quota when moving a server into a workspace.
        if server.workspace_id != ws.id:
            server_count = Server.query.filter_by(workspace_id=ws.id).count()
            quota_error = WorkspaceService.check_quota(ws.id, server_count, 'max_servers')
            if quota_error:
                return jsonify({'error': quota_error}), 403
        ws_id = ws.id

    server.workspace_id = ws_id
    db.session.commit()
    return jsonify({'message': 'Workspace updated', 'server': server.to_dict()}), 200


@servers_bp.route('/<server_id>', methods=['GET'])
@jwt_required()
def get_server(server_id):
    """Get a server by ID"""
    server = _get_operable_server(server_id)

    result = server.to_dict(include_metrics=True)
    # Surface the live transport so the UI can disable / banner features
    # that don't work when the agent is on the polling fallback (live
    # logs, real-time metrics fan-out, terminal). Possible values:
    #   "ws"   — long-lived Socket.IO connection, all features work
    #   "poll" — REST polling fallback, streams unavailable
    #   None   — agent not connected
    agent = agent_registry.get_agent(server.id)
    # Self-healing inconsistency check: if the Server row claims
    # "online" but there's no in-memory agent (panel was restarted, or
    # the agent process died without a clean disconnect), the status
    # is lying. Flip it to "offline" so the UI doesn't show the user
    # an "online" pill while the Docker tab errors with "Agent not
    # connected." Persist the correction so subsequent reads agree.
    if not agent and server.status == 'online':
        server.status = 'offline'
        try:
            db.session.commit()
            result['status'] = 'offline'
        except Exception:
            db.session.rollback()
    result['is_connected'] = agent is not None
    result['transport'] = agent.transport if agent else None
    # Capability map the agent advertised on connect. When the agent is
    # connected, prefer the live in-memory copy; when offline, fall back
    # to the snapshot persisted by update_capabilities so the Overview
    # tab can still render the last-known state instead of an empty
    # screen. capabilities_stale + capabilities_at let the UI badge the
    # data as cached.
    if agent:
        result['capabilities'] = dict(agent.capabilities)
        result['runtimes'] = dict(agent.runtimes)
        result['runtime_managers'] = dict(getattr(agent, 'runtime_managers', {}) or {})
        result['allowed_paths'] = list(getattr(agent, 'allowed_paths', []) or [])
        result['sudo'] = getattr(agent, 'sudo', '') or (server.cached_sudo or '')
        result['systemd_json'] = bool(getattr(agent, 'systemd_json', server.cached_systemd_json or False))
        result['platform'] = agent.platform
        result['distro'] = agent.distro
        result['distro_version'] = agent.distro_version
        result['capabilities_stale'] = False
        result['capabilities_at'] = server.capabilities_at.isoformat() + 'Z' if server.capabilities_at else None
    else:
        result['capabilities'] = dict(server.cached_capabilities or {})
        result['runtimes'] = dict(server.cached_runtimes or {})
        result['runtime_managers'] = dict(server.cached_runtime_managers or {})
        result['allowed_paths'] = list(server.cached_allowed_paths or [])
        result['sudo'] = server.cached_sudo or ''
        result['systemd_json'] = bool(server.cached_systemd_json)
        result['capabilities_stale'] = bool(server.capabilities_at)
        result['capabilities_at'] = server.capabilities_at.isoformat() + 'Z' if server.capabilities_at else None

    return jsonify(result)


@servers_bp.route('/<server_id>/timeline', methods=['GET'])
@developer_required
def get_server_timeline(server_id):
    """Merge the server's accessible audit and checkpoint history."""
    allowed = {'types', 'before', 'limit'}
    unknown = set(request.args) - allowed
    if unknown:
        raise ValidationError(
            'Unknown query parameters',
            details={'fields': sorted(unknown)},
        )
    for key in allowed:
        if len(request.args.getlist(key)) > 1:
            raise ValidationError(
                f'{key} must be provided at most once',
                details={'field': key},
            )

    from app.services.server_timeline_service import ServerTimelineService

    page = ServerTimelineService.get_timeline(
        get_current_user(),
        server_id,
        types=request.args.get('types'),
        before=request.args.get('before'),
        limit=request.args.get('limit'),
    )
    return jsonify({
        'events': page.events,
        'next_cursor': page.next_cursor,
    }), 200


@servers_bp.route('/<server_id>', methods=['PUT'])
@developer_required
def update_server(server_id):
    """Update a server"""
    server = _get_operable_server(server_id)

    data = json_object()

    if 'name' in data:
        server.name = data['name']
    if 'description' in data:
        server.description = data['description']
    if 'group_id' in data:
        server.group_id = data['group_id']
    if 'tags' in data:
        server.tags = data['tags']
    if 'permissions' in data:
        server.permissions = data['permissions']
    if 'allowed_ips' in data:
        errors = _ip_pattern_errors(data['allowed_ips'])
        if errors:
            raise ValidationError('Invalid IP patterns', details={'patterns': errors})
        server.allowed_ips = data['allowed_ips']

    # Handle permission profile
    if 'permission_profile' in data:
        profile = data['permission_profile']
        if profile in PERMISSION_PROFILES:
            server.permissions = PERMISSION_PROFILES[profile]['permissions']

    db.session.commit()
    return jsonify(server.to_dict())


@servers_bp.route('/<server_id>', methods=['DELETE'])
@admin_required
def delete_server(server_id):
    """Delete a server"""
    server = _get_operable_server(server_id)

    # Disconnect agent if connected
    if agent_registry.is_agent_connected(server_id):
        # TODO: Send disconnect command to agent
        pass

    db.session.delete(server)
    db.session.commit()

    return jsonify({'message': 'Server deleted'})


# ==================== Onboarding State Machine ====================

@servers_bp.route('/<server_id>/onboarding/start', methods=['POST'])
@developer_required
def start_server_onboarding(server_id):
    """Begin the onboarding lifecycle for a server (pending -> validating ...)."""
    from app.services.server_onboarding_service import ServerOnboardingService

    _get_operable_server(server_id)

    try:
        status = ServerOnboardingService.start(server_id)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 404
    return jsonify(status)


@servers_bp.route('/<server_id>/onboarding/retry', methods=['POST'])
@developer_required
def retry_server_onboarding(server_id):
    """Clear a failed onboarding and resume from validation."""
    from app.services.server_onboarding_service import ServerOnboardingService

    _get_operable_server(server_id)

    try:
        status = ServerOnboardingService.retry(server_id)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 404
    return jsonify(status)


@servers_bp.route('/<server_id>/onboarding/status', methods=['GET'])
@jwt_required()
def get_server_onboarding_status(server_id):
    """Return the onboarding state + ordered progress log for a server."""
    from app.services.server_onboarding_service import ServerOnboardingService

    _get_operable_server(server_id)

    try:
        status = ServerOnboardingService.get_status(server_id)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 404
    return jsonify(status)


# ==================== Registration ====================

@servers_bp.route('/<server_id>/regenerate-token', methods=['POST'])
@developer_required
def regenerate_token(server_id):
    """Regenerate the registration token for a server and return a fresh
    connection string.

    Used both for first-pair (panel just created the row) and re-pair
    (the agent was uninstalled / reinstalled and lost its credentials).
    Body is optional; only ``expires_in`` is read (same semantics as
    create_server).
    """
    server = _get_operable_server(server_id)

    data = json_object(optional=True)
    expires_at = _resolve_token_expiry(data.get('expires_in'))

    registration_token = Server.generate_registration_token()
    server.set_registration_token(registration_token)
    server.registration_token_expires = expires_at
    server.status = 'pending'
    server.agent_id = None

    db.session.commit()

    panel_url = _get_external_base_url()
    conn_string = connection_string_codec.encode(
        url=panel_url,
        token=registration_token,
        expires_at=expires_at,
    )

    return jsonify({
        'registration_token': registration_token,
        'registration_expires': server.registration_token_expires.isoformat(),
        'connection_string': conn_string,
        'panel_url': panel_url,
    })


@servers_bp.route('/register', methods=['POST'])
@limiter.limit("5 per minute")
def register_agent():
    """
    Agent registration endpoint.

    Called by agents during initial setup.

    Expected data:
    {
        "token": "sk_reg_xxx",
        "name": "server-name",
        "system_info": {...},
        "agent_version": "1.0.0"
    }
    """
    data = json_object()

    token = data.get('token')
    if not token or not isinstance(token, str):
        return jsonify({'error': 'Registration token required'}), 400

    server = Server.find_by_registration_token(token)

    if not server:
        return jsonify({'error': 'Invalid or expired registration token'}), 401

    # Generate API credentials
    api_key, api_secret = Server.generate_api_credentials()

    # Update server with agent info
    server.agent_id = data.get('agent_id') or str(__import__('uuid').uuid4())
    server.set_api_key(api_key)
    server.set_api_secret_encrypted(api_secret)  # Store encrypted secret for signature verification
    server.status = 'connecting'
    server.registered_at = datetime.utcnow()

    # Clear registration token (single use)
    server.registration_token_hash = None
    server.registration_token_expires = None

    # Update system info if provided
    system_info = data.get('system_info', {})
    if system_info:
        server.hostname = system_info.get('hostname', server.hostname)
        server.os_type = system_info.get('os', server.os_type)
        server.os_version = system_info.get('platform_version', server.os_version)
        server.platform = system_info.get('platform', server.platform)
        server.architecture = system_info.get('architecture', server.architecture)
        server.cpu_cores = system_info.get('cpu_cores', server.cpu_cores)
        server.total_memory = system_info.get('total_memory', server.total_memory)
        server.total_disk = system_info.get('total_disk', server.total_disk)

    server.agent_version = data.get('agent_version')

    # Replace the panel-issued placeholder name with whatever the agent
    # reports — preferring the OS hostname over the agent's optional
    # top-level "name" field. Once a user has renamed the server in the
    # UI, the placeholder check fails and we leave their name alone, so
    # re-pair after reinstall doesn't clobber renames.
    if _is_placeholder_name(server.name):
        reported_name = (system_info.get('hostname') if system_info else None) or data.get('name')
        if reported_name:
            server.name = reported_name

    db.session.commit()

    # Security note: api_secret is returned once during registration so the agent
    # can store it. The server-side copy is stored encrypted. The registration token
    # is already cleared above (single-use), preventing re-registration.
    return jsonify({
        'agent_id': server.agent_id,
        'name': server.name,
        'api_key': api_key,
        'api_secret': api_secret,
        'websocket_url': _get_external_websocket_url(),
        'server_id': server.id
    })


# ==================== Server Status ====================

@servers_bp.route('/<server_id>/status', methods=['GET'])
@jwt_required()
def get_server_status(server_id):
    """Get current server status and live metrics"""
    server = _get_operable_server(server_id)

    is_connected = agent_registry.is_agent_connected(server_id)

    result = {
        'id': server.id,
        'name': server.name,
        'status': 'online' if is_connected else server.status,
        'is_connected': is_connected,
        'last_seen': server.last_seen.isoformat() if server.last_seen else None,
        'last_error': server.last_error,
    }

    # Get latest metrics
    latest_metrics = server.metrics.order_by(ServerMetrics.timestamp.desc()).first()
    if latest_metrics:
        result['metrics'] = latest_metrics.to_dict()

    return jsonify(result)


@servers_bp.route('/<server_id>/ping', methods=['POST'])
@developer_required
def ping_server(server_id):
    """Force a ping/health check on a server"""
    _get_operable_server(server_id)

    if not agent_registry.is_agent_connected(server_id):
        raise agent_offline()

    # Send system:metrics command to get fresh data
    result = dispatch_agent_command(
        server_id=server_id,
        action='system:metrics',
        timeout=10.0
    )

    return jsonify(result)


# ==================== Metrics ====================

@servers_bp.route('/<server_id>/metrics', methods=['GET'])
@jwt_required()
def get_server_metrics(server_id):
    """Get historical metrics for a server"""
    _get_operable_server(server_id)

    # Query parameters
    from_time = request.args.get('from')
    to_time = request.args.get('to')
    limit = request.args.get('limit', 100, type=int)

    query = ServerMetrics.query.filter_by(server_id=server_id)

    if from_time:
        try:
            from_dt = datetime.fromisoformat(from_time.replace('Z', '+00:00'))
            query = query.filter(ServerMetrics.timestamp >= from_dt)
        except:
            pass

    if to_time:
        try:
            to_dt = datetime.fromisoformat(to_time.replace('Z', '+00:00'))
            query = query.filter(ServerMetrics.timestamp <= to_dt)
        except:
            pass

    metrics = query.order_by(ServerMetrics.timestamp.desc()).limit(limit).all()

    return jsonify([m.to_dict() for m in reversed(metrics)])


@servers_bp.route('/metrics/compare', methods=['GET'])
@jwt_required()
def compare_server_metrics():
    """Compare metrics across multiple servers"""
    server_ids = request.args.get('ids', '').split(',')
    metric = request.args.get('metric', 'cpu_percent')
    limit = request.args.get('limit', 50, type=int)

    if not server_ids or server_ids == ['']:
        return jsonify({'error': 'Server IDs required'}), 400

    from app.services.workspace_service import WorkspaceService
    result = {}
    for server_id in server_ids:
        server = WorkspaceService.get_accessible_server(get_current_user(), server_id)
        if not server:
            continue

        metrics = ServerMetrics.query.filter_by(server_id=server_id)\
            .order_by(ServerMetrics.timestamp.desc())\
            .limit(limit)\
            .all()

        result[server_id] = {
            'name': server.name,
            'data': [
                {
                    'timestamp': m.timestamp.isoformat(),
                    'value': getattr(m, metric, None)
                }
                for m in reversed(metrics)
            ]
        }

    return jsonify(result)


# ==================== Server Overview ====================

@servers_bp.route('/overview', methods=['GET'])
@jwt_required()
def get_servers_overview():
    """Get overview of all servers health"""
    from app.services.workspace_service import WorkspaceService
    servers = WorkspaceService.accessible_servers(get_current_user())
    metrics_by_server = latest_metrics_by_server(server.id for server in servers)
    connected_ids = set(agent_registry.get_connected_servers()) & {s.id for s in servers}

    total = len(servers)
    online = len(connected_ids)
    offline = total - online

    total_containers = 0
    total_running = 0

    servers_data = []
    for server in servers:
        is_online = server.id in connected_ids

        # Get latest metrics
        latest = metrics_by_server.get(server.id)

        server_summary = {
            'id': server.id,
            'name': server.name,
            'status': 'online' if is_online else server.status,
            'group_id': server.group_id,
            'group_name': server.group.name if server.group else None,
            'tags': server.tags or [],
        }

        if latest:
            server_summary['cpu_percent'] = latest.cpu_percent
            server_summary['memory_percent'] = latest.memory_percent
            server_summary['disk_percent'] = latest.disk_percent
            server_summary['container_count'] = latest.container_count
            server_summary['container_running'] = latest.container_running

            if latest.container_count:
                total_containers += latest.container_count
            if latest.container_running:
                total_running += latest.container_running

        servers_data.append(server_summary)

    return jsonify({
        'summary': {
            'total': total,
            'online': online,
            'offline': offline,
            'total_containers': total_containers,
            'running_containers': total_running,
        },
        'servers': servers_data
    })


# ==================== Command History ====================

@servers_bp.route('/<server_id>/commands', methods=['GET'])
@jwt_required()
def get_command_history(server_id):
    """Get command history for a server"""
    _get_operable_server(server_id)

    limit = request.args.get('limit', 50, type=int)

    commands = ServerCommand.query.filter_by(server_id=server_id)\
        .order_by(ServerCommand.created_at.desc())\
        .limit(limit)\
        .all()

    return jsonify([c.to_dict() for c in commands])


# ==================== Permission Profiles ====================

@servers_bp.route('/permission-profiles', methods=['GET'])
@jwt_required()
def get_permission_profiles():
    """Get available permission profiles"""
    return jsonify(PERMISSION_PROFILES)


# ==================== Security Features ====================


@servers_bp.route('/<server_id>/allowed-ips', methods=['GET'])
@jwt_required()
def get_allowed_ips(server_id):
    """Get allowed IPs for a server"""
    server = _get_operable_server(server_id)

    return jsonify({
        'allowed_ips': server.allowed_ips or [],
        'is_enforced': bool(server.allowed_ips and len(server.allowed_ips) > 0)
    })


@servers_bp.route('/<server_id>/allowed-ips', methods=['PUT'])
@developer_required
def update_allowed_ips(server_id):
    """
    Update allowed IPs for a server.

    Body: { "allowed_ips": ["192.168.1.0/24", "10.0.0.5"] }

    Supports:
    - Single IP: "192.168.1.100"
    - CIDR: "192.168.1.0/24"
    - Wildcards: "192.168.1.*"
    """
    server = _get_operable_server(server_id)

    data = json_object()
    allowed_ips = data.get('allowed_ips', [])

    errors = _ip_pattern_errors(allowed_ips)
    if errors:
        return jsonify({'error': 'Invalid IP patterns', 'details': errors}), 400

    server.allowed_ips = allowed_ips
    db.session.commit()

    return jsonify({
        'allowed_ips': server.allowed_ips,
        'is_enforced': bool(server.allowed_ips and len(server.allowed_ips) > 0)
    })


@servers_bp.route('/<server_id>/connection-info', methods=['GET'])
@jwt_required()
def get_connection_info(server_id):
    """Get connection info for a server (current IP, connected status, etc.)"""
    server = _get_operable_server(server_id)

    is_connected = agent_registry.is_agent_connected(server_id)
    agent = agent_registry.get_agent(server_id) if is_connected else None

    # Get active session from database
    active_session = AgentSession.query.filter_by(
        server_id=server_id,
        is_active=True
    ).first()

    return jsonify({
        'connected': is_connected,
        'ip_address': agent.ip_address if agent else (active_session.ip_address if active_session else None),
        'connected_since': active_session.connected_at.isoformat() if active_session else None,
        'agent_version': agent.agent_version if agent else server.agent_version,
        'last_heartbeat': agent.last_heartbeat.isoformat() if agent else None
    })


@servers_bp.route('/<server_id>/rotate-api-key', methods=['POST'])
@admin_required
def rotate_api_key(server_id):
    """
    Initiate API key rotation for a server.

    This generates new credentials and sends them to the connected agent.
    The agent must acknowledge the update within 5 minutes.
    """
    server = _get_operable_server(server_id)

    if not agent_registry.is_agent_connected(server_id):
        raise agent_offline()

    # Check if there's already a pending rotation
    if server.api_key_rotation_id and server.api_key_rotation_expires:
        if datetime.utcnow() < server.api_key_rotation_expires:
            return jsonify({
                'error': 'API key rotation already in progress',
                'rotation_id': server.api_key_rotation_id,
                'expires': server.api_key_rotation_expires.isoformat()
            }), 409

    # Start rotation
    new_api_key, new_api_secret, rotation_id = server.start_key_rotation()
    db.session.commit()

    # Send credential update to agent. The agent verifies an HMAC over
    # the new credentials computed with its *current* secret before
    # applying the rotation, so a session-level WS auth bypass alone
    # can't be used to silently rotate fleet credentials to attacker-
    # controlled values. The agent expects:
    #   hex(HMAC-SHA256("rotation_id:agent_id:new_api_key:new_api_secret",
    #                    current_api_secret))
    current_secret = server.get_api_secret() or ''
    if not current_secret:
        # Agents paired before the api_secret_encrypted column existed
        # can't be verified. Better to fail the rotation than silently
        # ship an unsigned credential update — operators can re-pair to
        # establish a verifiable secret on disk.
        return jsonify({
            'error': 'Server has no recoverable secret on file; re-pair the agent before rotating.',
            'code': 'NO_CURRENT_SECRET'
        }), 409
    payload = f'{rotation_id}:{server.agent_id}:{new_api_key}:{new_api_secret}'
    sig = hmac.new(
        current_secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()

    agent = agent_registry.get_agent(server_id)
    if agent and agent_registry._socketio:
        agent_registry._socketio.emit(
            'credential_update',
            {
                'type': 'credential_update',
                'rotation_id': rotation_id,
                'api_key': new_api_key,
                'api_secret': new_api_secret,
                'hmac_sig': sig,
            },
            room=agent.socket_id,
            namespace='/agent'
        )

    return jsonify({
        'success': True,
        'rotation_id': rotation_id,
        'message': 'Credential update sent to agent. Waiting for acknowledgment.',
        'expires': server.api_key_rotation_expires.isoformat()
    })


@servers_bp.route('/<server_id>/security/alerts', methods=['GET'])
@jwt_required()
def get_server_security_alerts(server_id):
    """Get security alerts for a specific server"""
    _get_operable_server(server_id)

    status = request.args.get('status')
    severity = request.args.get('severity')
    limit = request.args.get('limit', 100, type=int)

    alerts = anomaly_detection_service.get_alerts(
        server_id=server_id,
        status=status,
        severity=severity,
        limit=limit
    )

    return jsonify([a.to_dict() for a in alerts])


@servers_bp.route('/security/alerts', methods=['GET'])
@jwt_required()
def get_all_security_alerts():
    """Get security alerts for all servers"""
    status = request.args.get('status')
    severity = request.args.get('severity')
    alert_type = request.args.get('type')
    limit = request.args.get('limit', 100, type=int)

    alerts = anomaly_detection_service.get_alerts(
        status=status,
        severity=severity,
        alert_type=alert_type,
        limit=limit
    )

    return jsonify([a.to_dict() for a in alerts])


@servers_bp.route('/security/alerts/counts', methods=['GET'])
@jwt_required()
def get_security_alert_counts():
    """Get counts of security alerts by status and severity"""
    server_id = request.args.get('server_id')
    counts = anomaly_detection_service.get_alert_counts(server_id=server_id)
    return jsonify(counts)


@servers_bp.route('/security/alerts/<alert_id>/acknowledge', methods=['POST'])
@developer_required
def acknowledge_alert(alert_id):
    """Acknowledge a security alert"""
    alert = SecurityAlert.query.get(alert_id)
    if not alert:
        return jsonify({'error': 'Alert not found'}), 404

    user_id = get_jwt_identity()
    alert.acknowledge(user_id=user_id)

    return jsonify(alert.to_dict())


@servers_bp.route('/security/alerts/<alert_id>/resolve', methods=['POST'])
@developer_required
def resolve_alert(alert_id):
    """Resolve a security alert"""
    alert = SecurityAlert.query.get(alert_id)
    if not alert:
        return jsonify({'error': 'Alert not found'}), 404

    user_id = get_jwt_identity()
    alert.resolve(user_id=user_id)

    return jsonify(alert.to_dict())


# ==================== Historical Metrics ====================

@servers_bp.route('/<server_id>/metrics/history', methods=['GET'])
@jwt_required()
def get_server_metrics_history(server_id):
    """Get historical metrics for a server.

    Query params:
        period: '1h', '6h', '24h', '7d', '30d' (default: '24h')
    """
    _get_operable_server(server_id)
    period = request.args.get('period', '24h')

    result = ServerMetricsService.get_server_history(server_id, period)
    return jsonify(result)


@servers_bp.route('/<server_id>/metrics/aggregated', methods=['GET'])
@jwt_required()
def get_server_metrics_aggregated(server_id):
    """Get aggregated metrics for a server.

    Query params:
        period: '24h', '7d', '30d' (default: '24h')
        aggregation: 'hourly', 'daily' (default: 'hourly')
    """
    _get_operable_server(server_id)
    period = request.args.get('period', '24h')
    aggregation = request.args.get('aggregation', 'hourly')

    result = ServerMetricsService.get_aggregated_metrics(server_id, period, aggregation)
    return jsonify(result)


@servers_bp.route('/metrics/retention', methods=['GET'])
@developer_required
def get_metrics_retention_stats():
    """Get metrics retention statistics."""
    result = ServerMetricsService.get_retention_stats()
    return jsonify(result)


@servers_bp.route('/metrics/cleanup', methods=['POST'])
@developer_required
def trigger_metrics_cleanup():
    """Trigger cleanup of old metrics data."""
    result = ServerMetricsService.cleanup_old_metrics()
    return jsonify({
        'success': True,
        'deleted': result
    })


# Area modules register their routes on servers_bp when imported.
from app.api import servers_agents, servers_docker, servers_remote  # noqa: E402,F401
