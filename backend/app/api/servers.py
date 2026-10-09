"""
Server Management API

Endpoints for managing remote servers and their agents.
"""

import os
import re
import hashlib
import hmac
import requests
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, Response, current_app, redirect
from flask_jwt_extended import jwt_required, get_jwt_identity

from sqlalchemy.orm import joinedload
from app import db, limiter
from app.services.server_metrics_service import latest_metrics_by_server
from app.api._query import apply_query, QueryParseError
from app.models import User
from app.models.server import Server, ServerGroup, ServerMetrics, ServerCommand, AgentSession, AgentVersion, AgentRollout
from app.services.agent_registry import agent_registry
from app.services.remote_command_dispatcher import dispatch_agent_command
from app.services.agent_fleet_service import fleet_service
from app.services.discovery_service import discovery_service
from app.services import connection_string as connection_string_codec
from app.middleware.rbac import admin_required, auth_required, developer_required, get_current_user
from app.middleware.api_scope_middleware import require_scope
from app.exceptions import ValidationError, agent_offline, field_required, not_found


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
            # Fleet doctor / survey reads (plan 28 #7): let the panel probe
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
    data = request.get_json()

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

    data = request.get_json()

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
    data = request.get_json() or {}
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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    target = (request.get_json() or {}).get('workspace_id')
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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    data = request.get_json()

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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

    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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

    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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

    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    data = request.get_json(silent=True) or {}
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
    data = request.get_json()

    token = data.get('token')
    if not token:
        return jsonify({'error': 'Registration token required'}), 400

    # Find server by token (need to check all servers)
    server = None
    for s in Server.query.filter(Server.registration_token_hash.isnot(None)).all():
        if s.verify_registration_token(token):
            server = s
            break

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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

    result = {}
    for server_id in server_ids:
        server = Server.query.get(server_id)
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
    servers = Server.query.options(joinedload(Server.group)).all()
    metrics_by_server = latest_metrics_by_server(server.id for server in servers)
    connected_ids = set(agent_registry.get_connected_servers())

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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

from app.utils.ip_utils import is_ip_allowed, validate_ip_pattern
from app.models.security_alert import SecurityAlert
from app.services.anomaly_detection_service import anomaly_detection_service


@servers_bp.route('/<server_id>/allowed-ips', methods=['GET'])
@jwt_required()
def get_allowed_ips(server_id):
    """Get allowed IPs for a server"""
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    data = request.get_json()
    allowed_ips = data.get('allowed_ips', [])

    # Validate each IP pattern
    errors = []
    for ip_pattern in allowed_ips:
        is_valid, error = validate_ip_pattern(ip_pattern)
        if not is_valid:
            errors.append(f"Invalid pattern '{ip_pattern}': {error}")

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

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


# ==================== Remote Docker Operations ====================

from app.services.remote_docker_service import RemoteDockerService
from app.services.server_metrics_service import ServerMetricsService
from app.services.terminal_service import TerminalService


@servers_bp.route('/available', methods=['GET'])
@jwt_required()
def get_available_servers():
    """Get list of servers available for Docker operations"""
    servers = RemoteDockerService.get_available_servers()
    return jsonify(servers)


@servers_bp.route('/<server_id>/docker/containers', methods=['GET'])
@jwt_required()
def list_remote_containers(server_id):
    """List containers on a remote server"""
    all_containers = request.args.get('all', 'false').lower() == 'true'
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_containers(server_id, all=all_containers, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500 if result.get('code') != 'AGENT_OFFLINE' else 503

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['GET'])
@jwt_required()
def inspect_remote_container(server_id, container_id):
    """Inspect a container on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.inspect_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/containers/<container_id>/start', methods=['POST'])
@developer_required
def start_remote_container(server_id, container_id):
    """Start a container on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.start_container(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container started'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stop', methods=['POST'])
@developer_required
def stop_remote_container(server_id, container_id):
    """Stop a container on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    timeout = data.get('timeout')

    result = RemoteDockerService.stop_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container stopped'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/restart', methods=['POST'])
@developer_required
def restart_remote_container(server_id, container_id):
    """Restart a container on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    timeout = data.get('timeout')

    result = RemoteDockerService.restart_container(server_id, container_id, timeout=timeout, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container restarted'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>', methods=['DELETE'])
@developer_required
def remove_remote_container(server_id, container_id):
    """Remove a container on a remote server"""
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'
    remove_volumes = request.args.get('v', 'false').lower() == 'true'

    result = RemoteDockerService.remove_container(
        server_id, container_id,
        force=force, remove_volumes=remove_volumes,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Container removed'})


@servers_bp.route('/<server_id>/docker/containers/<container_id>/stats', methods=['GET'])
@jwt_required()
def get_remote_container_stats(server_id, container_id):
    """Get container stats from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_container_stats(server_id, container_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/containers/<container_id>/logs', methods=['GET'])
@jwt_required()
def get_remote_container_logs(server_id, container_id):
    """
    Get container logs from a remote server.

    Query params:
        tail: Number of lines (default 100, 'all' for all lines)
        since: Show logs since timestamp
        timestamps: Include timestamps (default true)
    """
    user_id = get_jwt_identity()
    tail = request.args.get('tail', '100')
    since = request.args.get('since')
    timestamps = request.args.get('timestamps', 'true').lower() == 'true'

    result = RemoteDockerService.get_container_logs(
        server_id, container_id,
        tail=tail, since=since, timestamps=timestamps,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/images', methods=['GET'])
@jwt_required()
def list_remote_images(server_id):
    """List images on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_images(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/images/pull', methods=['POST'])
@developer_required
def pull_remote_image(server_id):
    """Pull an image on a remote server"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('image'):
        return jsonify({'error': 'Image name required'}), 400

    result = RemoteDockerService.pull_image(server_id, data['image'], user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/images/<image_id>', methods=['DELETE'])
@developer_required
def remove_remote_image(server_id, image_id):
    """Remove an image on a remote server"""
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'

    result = RemoteDockerService.remove_image(server_id, image_id, force=force, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Image removed'})


@servers_bp.route('/<server_id>/docker/volumes', methods=['GET'])
@jwt_required()
def list_remote_volumes(server_id):
    """List volumes on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_volumes(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/volumes/<volume_name>', methods=['DELETE'])
@developer_required
def remove_remote_volume(server_id, volume_name):
    """Remove a volume on a remote server"""
    user_id = get_jwt_identity()
    force = request.args.get('force', 'false').lower() == 'true'

    result = RemoteDockerService.remove_volume(server_id, volume_name, force=force, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Volume removed'})


@servers_bp.route('/<server_id>/docker/networks', methods=['GET'])
@jwt_required()
def list_remote_networks(server_id):
    """List networks on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.list_networks(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/networks/<network_id>', methods=['DELETE'])
@developer_required
def remove_remote_network(server_id, network_id):
    """Remove a network on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.remove_network(server_id, network_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify({'message': 'Network removed'})


@servers_bp.route('/<server_id>/system/metrics', methods=['GET'])
@jwt_required()
def get_remote_system_metrics(server_id):
    """Get system metrics from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_metrics(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/system/info', methods=['GET'])
@jwt_required()
def get_remote_system_info(server_id):
    """Get system info from a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.get_system_info(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


# ==================== Remote Docker Compose Operations ====================

@servers_bp.route('/<server_id>/docker/compose/projects', methods=['GET'])
@jwt_required()
def list_remote_compose_projects(server_id):
    """List compose projects on a remote server"""
    user_id = get_jwt_identity()

    result = RemoteDockerService.compose_list(server_id, user_id=user_id)

    if not result.get('success'):
        return jsonify(result), 500 if result.get('code') != 'AGENT_OFFLINE' else 503

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/compose/ps', methods=['POST'])
@developer_required
def remote_compose_ps(server_id):
    """List containers for a compose project"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_ps(
        server_id,
        data['project_path'],
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data', []))


@servers_bp.route('/<server_id>/docker/compose/up', methods=['POST'])
@developer_required
def remote_compose_up(server_id):
    """Start a compose project"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_up(
        server_id,
        data['project_path'],
        detach=data.get('detach', True),
        build=data.get('build', False),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/down', methods=['POST'])
@developer_required
def remote_compose_down(server_id):
    """Stop a compose project"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_down(
        server_id,
        data['project_path'],
        volumes=data.get('volumes', False),
        remove_orphans=data.get('remove_orphans', True),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/logs', methods=['POST'])
@developer_required
def remote_compose_logs(server_id):
    """Get logs from a compose project"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_logs(
        server_id,
        data['project_path'],
        service=data.get('service'),
        tail=data.get('tail', 100),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result.get('data'))


@servers_bp.route('/<server_id>/docker/compose/restart', methods=['POST'])
@developer_required
def remote_compose_restart(server_id):
    """Restart a compose project or specific service"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_restart(
        server_id,
        data['project_path'],
        service=data.get('service'),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


@servers_bp.route('/<server_id>/docker/compose/pull', methods=['POST'])
@developer_required
def remote_compose_pull(server_id):
    """Pull images for a compose project"""
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('project_path'):
        raise field_required('project_path')

    result = RemoteDockerService.compose_pull(
        server_id,
        data['project_path'],
        service=data.get('service'),
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 500

    return jsonify(result)


# ==================== Historical Metrics ====================

@servers_bp.route('/<server_id>/metrics/history', methods=['GET'])
@jwt_required()
def get_server_metrics_history(server_id):
    """Get historical metrics for a server.

    Query params:
        period: '1h', '6h', '24h', '7d', '30d' (default: '24h')
    """
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


# ==================== Remote Terminal ====================

@servers_bp.route('/<server_id>/terminal', methods=['POST'])
@developer_required
def create_terminal_session(server_id):
    """Create a new terminal session on a remote server.

    Body:
        cols: Terminal width (default: 80)
        rows: Terminal height (default: 24)
    """
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    cols = data.get('cols', 80)
    rows = data.get('rows', 24)

    result = TerminalService.create_session(
        server_id=server_id,
        user_id=user_id,
        cols=cols,
        rows=rows
    )

    if not result.get('success'):
        return jsonify(result), 500 if result.get('code') != 'AGENT_OFFLINE' else 503

    return jsonify(result)


@servers_bp.route('/terminal/<session_id>/input', methods=['POST'])
@developer_required
def terminal_input(session_id):
    """Send input to a terminal session.

    Body:
        data: Base64-encoded input data
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('data'):
        raise field_required('data')

    result = TerminalService.send_input(
        session_id=session_id,
        data=data['data'],
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 400

    return jsonify(result)


@servers_bp.route('/terminal/<session_id>/resize', methods=['POST'])
@developer_required
def terminal_resize(session_id):
    """Resize a terminal session.

    Body:
        cols: New terminal width
        rows: New terminal height
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data or not data.get('cols') or not data.get('rows'):
        return jsonify({'error': 'cols and rows are required'}), 400

    result = TerminalService.resize_session(
        session_id=session_id,
        cols=data['cols'],
        rows=data['rows'],
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 400

    return jsonify(result)


@servers_bp.route('/terminal/<session_id>', methods=['DELETE'])
@developer_required
def close_terminal_session(session_id):
    """Close a terminal session."""
    user_id = get_jwt_identity()

    result = TerminalService.close_session(
        session_id=session_id,
        user_id=user_id
    )

    if not result.get('success'):
        return jsonify(result), 400

    return jsonify(result)


@servers_bp.route('/terminal/sessions', methods=['GET'])
@jwt_required()
def list_terminal_sessions():
    """List all terminal sessions for the current user."""
    user_id = get_jwt_identity()

    sessions = TerminalService.get_user_sessions(user_id)
    return jsonify({
        'sessions': sessions,
        'count': len(sessions)
    })


# ==================== Installation Scripts ====================

def _get_scripts_dir():
    """Resolve the directory holding the fleet-agent installer scripts.

    Every shipped layout has to land on a real directory here:

    * git checkout / release tarball -> ``<tree root>/scripts``
    * Docker image                   -> ``/app/scripts``, which exists only
      because the Dockerfile explicitly copies the two installers there.

    ``SERVERKIT_SCRIPTS_DIR`` overrides the guess for layouts that split the
    backend away from the rest of the tree.
    """
    override = os.environ.get('SERVERKIT_SCRIPTS_DIR')
    if override:
        return override
    # Go up from backend/app/api to backend, then to scripts
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    return os.path.join(base_dir, 'scripts')


def _load_installer(filename):
    """Read an agent installer off disk and stamp this panel's coordinates in.

    Returns ``(content, None)`` on success or ``(None, error_response)`` when the
    file is absent, so the two endpoints below cannot drift apart.
    """
    script_path = os.path.join(_get_scripts_dir(), filename)

    if not os.path.exists(script_path):
        # A missing installer is a packaging fault on THIS panel, never a bad
        # request. The old 404 asserted "no such URL", which is exactly what sent
        # issue #101's reporter hunting for a wrong path -- they filed it as
        # "incorrect paths in setup" -- when the file had simply never been
        # shipped into the image. 503 says "this server is broken, not your URL",
        # and the log line names the path actually searched so an operator can
        # confirm it in one look instead of guessing.
        current_app.logger.error(
            'Agent installer %s is missing from this deployment (searched %s). '
            'Fleet enrollment via /api/v1/servers/%s cannot work until it is '
            'restored; see docs/ARCHITECTURE.md.',
            filename, script_path, filename
        )
        return None, (jsonify({
            'error': f'{filename} is not present on this ServerKit panel',
            'detail': (
                'The panel serves this installer from its own filesystem and the '
                'file is missing, so this is a packaging/deployment problem with '
                'this panel rather than a wrong URL. The panel log records the '
                'exact path searched.'
            ),
            'searched_path': script_path,
        }), 503)

    with open(script_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace placeholders with actual values
    content = content.replace('https://your-serverkit.com', _get_external_base_url())
    content = content.replace('jhd3197/serverkit-agent', AGENT_GITHUB_REPO)
    return content, None


@servers_bp.route('/install.sh', methods=['GET'])
def get_install_script_linux():
    """
    Get the Linux installation script.

    This endpoint serves the bash installation script for installing
    the ServerKit agent on Linux systems.

    Usage (download-then-run, not `curl | bash`: a pipeline reports bash's exit
    status, so a failed download would exit 0 having installed nothing):
        curl -fsSL https://your-server/api/v1/servers/install.sh \\
            -o /tmp/serverkit-agent-install.sh \\
        && sudo bash /tmp/serverkit-agent-install.sh \\
            --token "YOUR_TOKEN" --server "https://your-server"
    """
    content, error = _load_installer('install.sh')
    if error is not None:
        return error

    # Inject the agent version the panel already resolved so enrollment does
    # not depend on the installer rediscovering it via the GitHub API. Best
    # effort: on failure the placeholder stays empty and the script falls
    # back to its own GitHub discovery.
    release = _get_latest_agent_release()
    version = (release or {}).get('version') or ''
    if version and all(c.isalnum() or c in '._-' for c in version):
        content = content.replace(
            'SERVERKIT_AGENT_VERSION=""',
            f'SERVERKIT_AGENT_VERSION="{version}"',
            1
        )

    return Response(
        content,
        mimetype='text/x-shellscript',
        headers={
            'Content-Disposition': 'inline; filename="install.sh"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install.ps1', methods=['GET'])
def get_install_script_windows():
    """
    Get the Windows installation script.

    This endpoint serves the PowerShell installation script for installing
    the ServerKit agent on Windows systems.

    Usage:
        irm https://your-server/api/v1/servers/install.ps1 | iex; \\
            Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "https://your-server"
    """
    content, error = _load_installer('install.ps1')
    if error is not None:
        return error

    return Response(
        content,
        mimetype='text/plain',
        headers={
            'Content-Disposition': 'inline; filename="install.ps1"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install-instructions/<server_id>', methods=['GET'])
@jwt_required()
def get_install_instructions(server_id):
    """
    Get installation instructions for a specific server.

    Returns installation commands with the correct API endpoint. Registration
    tokens are only shown when they are generated, so the UI supplies the token.
    """
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    # Check if server has a valid registration token
    if not server.registration_token_hash:
        return jsonify({
            'error': 'No registration token available',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    if server.registration_token_expires and server.registration_token_expires < datetime.utcnow():
        return jsonify({
            'error': 'Registration token expired',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    # Get base URL
    base_url = _get_external_base_url()
    api_url = f"{base_url}/api/v1/servers"

    return jsonify({
        'linux': {
            # Download-then-run rather than `curl … | sudo bash`: in a pipeline
            # the shell reports bash's exit status, so a failed download exits 0
            # and installs nothing without saying so (issue #101).
            'one_liner': (
                f'curl -fsSL {api_url}/install.sh -o /tmp/serverkit-agent-install.sh '
                f'&& sudo bash /tmp/serverkit-agent-install.sh '
                f'--token "YOUR_TOKEN" --server "{base_url}"'
            ),
            'manual': [
                f'# Download the script',
                f'curl -fsSL {api_url}/install.sh -o install.sh',
                f'chmod +x install.sh',
                f'',
                f'# Run installation',
                f'sudo ./install.sh --token "YOUR_TOKEN" --server "{base_url}"'
            ]
        },
        'windows': {
            'one_liner': f'irm {api_url}/install.ps1 | iex; Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "{base_url}"',
            'manual': [
                f'# Download the script (run in PowerShell as Administrator)',
                f'Invoke-WebRequest -Uri "{api_url}/install.ps1" -OutFile install.ps1',
                f'',
                f'# Run installation',
                f'.\\install.ps1 -Token "YOUR_TOKEN" -Server "{base_url}"'
            ]
        },
        'note': 'Replace YOUR_TOKEN with the registration token shown in the UI'
    })


# ==================== Agent Updates ====================

# Cache for GitHub releases to avoid rate limiting
_releases_cache = {
    'data': None,
    'expires': None
}

# The agent is built and released from its own repo, tagged plain `vX.Y.Z`. It
# used to ship from this monorepo under `agent-v*` tags; when it moved out,
# nothing here followed it, so this lookup searched a repo that has no agent
# releases at all -- /agent/version answered 503 for every agent polling for an
# update, and the served installer downloaded from a 404. Point both at the
# repo that actually publishes the binaries.
AGENT_GITHUB_REPO = os.environ.get('SERVERKIT_AGENT_GITHUB_REPO', 'jhd3197/serverkit-agent')

# Matches vX.Y.Z but not the malformed release tagged just "v" that sits in the
# agent repo's release list -- that one parses to an empty version and builds
# download URLs like .../releases/download/v/serverkit-agent--linux-amd64.tar.gz.
_AGENT_TAG_RE = re.compile(r'^v(\d[^\s]*)$')


def _get_latest_agent_release():
    """Fetch latest agent release from GitHub with caching"""
    now = datetime.utcnow()

    # Check cache
    if _releases_cache['data'] and _releases_cache['expires'] and _releases_cache['expires'] > now:
        return _releases_cache['data']

    try:
        # Every release in the agent repo is an agent release, but ask for 100
        # anyway so a run of pre-release tags cannot hide the newest stable one.
        response = requests.get(
            f'https://api.github.com/repos/{AGENT_GITHUB_REPO}/releases',
            headers={'Accept': 'application/vnd.github.v3+json'},
            params={'per_page': 100},
            timeout=10
        )
        response.raise_for_status()
        releases = response.json()

        # Find latest agent release
        for release in releases:
            match = _AGENT_TAG_RE.match(release.get('tag_name', ''))
            if match:
                version = match.group(1)

                # Build assets map
                assets = {}
                for asset in release.get('assets', []):
                    name = asset['name']
                    if 'linux-amd64' in name:
                        assets['linux-amd64'] = asset['browser_download_url']
                    elif 'linux-arm64' in name:
                        assets['linux-arm64'] = asset['browser_download_url']
                    elif 'windows-amd64' in name:
                        assets['windows-amd64'] = asset['browser_download_url']
                    elif name == 'checksums.txt':
                        assets['checksums'] = asset['browser_download_url']

                result = {
                    'version': version,
                    'tag': release['tag_name'],
                    'published_at': release['published_at'],
                    'release_url': release['html_url'],
                    'assets': assets,
                    'body': release.get('body', '')
                }

                # Cache for 5 minutes
                _releases_cache['data'] = result
                _releases_cache['expires'] = now + timedelta(minutes=5)

                return result

        return None

    except Exception as e:
        current_app.logger.error(f"Failed to fetch GitHub releases: {e}")
        # Return cached data if available, even if expired
        if _releases_cache['data']:
            return _releases_cache['data']
        return None


@servers_bp.route('/agent/version', methods=['GET'])
def get_agent_version():
    """
    Get the latest agent version information.

    This endpoint is called by agents to check for updates.
    Returns version info and download URLs for all platforms.
    """
    release = _get_latest_agent_release()

    if not release:
        return jsonify({
            'error': 'Unable to fetch version information',
            'message': 'GitHub API may be unavailable'
        }), 503

    # Get base URL for local downloads (fallback)
    base_url = request.url_root.rstrip('/')

    return jsonify({
        'version': release['version'],
        'published_at': release['published_at'],
        'release_notes_url': release['release_url'],
        'downloads': {
            'linux-amd64': release['assets'].get('linux-amd64'),
            'linux-arm64': release['assets'].get('linux-arm64'),
            'windows-amd64': release['assets'].get('windows-amd64'),
        },
        'checksums_url': release['assets'].get('checksums'),
        'update_available_message': f"A new version of ServerKit Agent is available: v{release['version']}"
    })


@servers_bp.route('/agent/version/check', methods=['POST'])
def check_agent_version():
    """
    Check if an agent needs to be updated.

    Called by agents with their current version to check if an update is needed.

    Request body:
    {
        "current_version": "1.0.0",
        "os": "linux",
        "arch": "amd64"
    }
    """
    data = request.get_json() or {}
    current_version = data.get('current_version', '0.0.0')
    agent_os = data.get('os', 'linux')
    agent_arch = data.get('arch', 'amd64')

    release = _get_latest_agent_release()

    if not release:
        return jsonify({
            'update_available': False,
            'error': 'Unable to check for updates'
        })

    latest_version = release['version']

    # Compare versions (simple string comparison works for semver)
    update_available = _compare_versions(current_version, latest_version) < 0

    platform_key = f"{agent_os}-{agent_arch}"
    download_url = release['assets'].get(platform_key)

    return jsonify({
        'update_available': update_available,
        'current_version': current_version,
        'latest_version': latest_version,
        'download_url': download_url,
        'checksums_url': release['assets'].get('checksums'),
        'release_notes_url': release['release_url'],
        'published_at': release['published_at']
    })


def _compare_versions(v1, v2):
    """
    Compare two semantic versions.
    Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
    """
    def parse_version(v):
        # Remove leading 'v' if present
        v = v.lstrip('v')
        # Split by dots and convert to integers
        parts = []
        for part in v.split('.'):
            # Handle pre-release versions like 1.0.0-beta.1
            if '-' in part:
                num, _ = part.split('-', 1)
                parts.append(int(num) if num.isdigit() else 0)
            else:
                parts.append(int(part) if part.isdigit() else 0)
        # Pad to at least 3 parts
        while len(parts) < 3:
            parts.append(0)
        return parts

    try:
        p1 = parse_version(v1)
        p2 = parse_version(v2)

        for a, b in zip(p1, p2):
            if a < b:
                return -1
            elif a > b:
                return 1
        return 0
    except:
        return 0


@servers_bp.route('/agent/download/<os_name>/<arch>', methods=['GET'])
def download_agent(os_name, arch):
    """
    Redirect to the appropriate agent download.

    This endpoint redirects to the GitHub release asset for the
    requested OS and architecture.
    """
    # Validate inputs
    valid_os = ['linux', 'windows', 'darwin']
    valid_arch = ['amd64', 'arm64']

    if os_name not in valid_os:
        return jsonify({'error': f'Invalid OS. Valid options: {valid_os}'}), 400

    if arch not in valid_arch:
        return jsonify({'error': f'Invalid architecture. Valid options: {valid_arch}'}), 400

    release = _get_latest_agent_release()

    if not release:
        return jsonify({'error': 'Unable to fetch release information'}), 503

    platform_key = f"{os_name}-{arch}"
    download_url = release['assets'].get(platform_key)

    if not download_url:
        return jsonify({
            'error': f'No release available for {os_name}-{arch}',
            'available': list(release['assets'].keys())
        }), 404

    # Redirect to GitHub release
    return redirect(download_url, code=302)


@servers_bp.route('/agent/checksums', methods=['GET'])
def get_agent_checksums():
    """
    Get SHA256 checksums for agent binaries.

    Returns the checksums.txt content from the latest release.
    """
    release = _get_latest_agent_release()

    if not release or not release['assets'].get('checksums'):
        return jsonify({'error': 'Checksums not available'}), 404

    try:
        response = requests.get(release['assets']['checksums'], timeout=10)
        response.raise_for_status()

        return Response(
            response.text,
            mimetype='text/plain',
            headers={
                'Content-Disposition': 'inline; filename="checksums.txt"',
                'X-Agent-Version': release['version']
            }
        )
    except Exception as e:
        current_app.logger.error(f"Failed to fetch checksums: {e}")
        return jsonify({'error': 'Failed to fetch checksums'}), 503


@servers_bp.route('/<server_id>/agent/update', methods=['POST'])
@developer_required
def trigger_agent_update(server_id):
    """
    Trigger an agent update on a specific server.

    Sends a command to the agent to check for and install updates.

    Developer role required — this replaces the agent binary and restarts the
    service across the fleet, so it must not be reachable by read-only viewers
    (every other state-changing server route is already @developer_required).
    """
    server = Server.query.get(server_id)
    if not server:
        raise not_found('server')

    if not agent_registry.is_agent_connected(server_id):
        raise agent_offline()

    # Get latest version info
    release = _get_latest_agent_release()
    if not release:
        return jsonify({
            'success': False,
            'error': 'Unable to fetch latest version'
        }), 503

    # Send update command to agent
    result = dispatch_agent_command(
        server_id=server_id,
        action='agent:update',
        params={
            'version': release['version'],
            'force': request.get_json().get('force', False) if request.get_json() else False
        },
        timeout=60.0  # Updates may take a while
    )

    return jsonify(result)


# ==================== Agent Fleet Management ====================

@servers_bp.route('/fleet/health', methods=['GET'])
@admin_required
def get_fleet_health():
    """Get aggregated health metrics for the agent fleet"""
    return jsonify(fleet_service.get_fleet_health())


@servers_bp.route('/fleet/versions', methods=['GET'])
@admin_required
def list_agent_versions():
    """List all available agent versions"""
    versions = AgentVersion.query.order_by(AgentVersion.version.desc()).all()
    return jsonify([v.to_dict() for v in versions])


@servers_bp.route('/fleet/versions', methods=['POST'])
@admin_required
def add_agent_version():
    """Add a new available agent version"""
    data = request.get_json()
    
    if not data.get('version'):
        raise field_required('Version')
        
    version = AgentVersion(
        version=data['version'],
        channel=data.get('channel', 'stable'),
        min_panel_version=data.get('min_panel_version'),
        max_panel_version=data.get('max_panel_version'),
        release_notes=data.get('release_notes'),
        assets=data.get('assets', {}),
        published_at=datetime.fromisoformat(data['published_at']) if data.get('published_at') else datetime.utcnow()
    )
    
    db.session.add(version)
    db.session.commit()
    
    return jsonify(version.to_dict()), 201


@servers_bp.route('/fleet/upgrade', methods=['POST'])
@admin_required
def upgrade_fleet():
    """Trigger upgrade for selected servers or entire fleet"""
    data = request.get_json()
    server_ids = data.get('server_ids', [])
    version_id = data.get('version_id')
    user_id = get_jwt_identity()
    
    if not server_ids:
        # If no IDs provided, upgrade all online servers
        servers = Server.query.filter_by(status='online').all()
        server_ids = [s.id for s in servers]
        
    if not server_ids:
        return jsonify({'success': True, 'message': 'No online servers to upgrade'})
        
    result = fleet_service.upgrade_servers(server_ids, version_id, user_id)
    return jsonify(result)


@servers_bp.route('/fleet/rollout', methods=['POST'])
@admin_required
def start_staged_rollout():
    """Start a staged rollout"""
    data = request.get_json()
    group_id = data.get('group_id')
    version_id = data.get('version_id')
    batch_size = data.get('batch_size', 5)
    delay_minutes = data.get('delay_minutes', 10)
    strategy = data.get('strategy', 'staged')
    server_ids = data.get('server_ids')
    user_id = get_jwt_identity()

    if not version_id:
        raise field_required('version_id')

    result = fleet_service.staged_rollout(
        group_id, version_id, batch_size, delay_minutes,
        strategy, user_id, server_ids
    )
    return jsonify(result)


@servers_bp.route('/fleet/rollouts', methods=['GET'])
@admin_required
def list_rollouts():
    """List rollout history"""
    status = request.args.get('status')
    limit = request.args.get('limit', 20, type=int)
    return jsonify(fleet_service.get_rollouts(status, limit))


@servers_bp.route('/fleet/rollouts/<rollout_id>', methods=['GET'])
@admin_required
def get_rollout(rollout_id):
    """Get a specific rollout"""
    rollout = fleet_service.get_rollout(rollout_id)
    if not rollout:
        return jsonify({'error': 'Rollout not found'}), 404
    return jsonify(rollout)


@servers_bp.route('/fleet/rollouts/<rollout_id>/cancel', methods=['POST'])
@admin_required
def cancel_rollout(rollout_id):
    """Cancel an active rollout"""
    success = fleet_service.cancel_rollout(rollout_id)
    if not success:
        return jsonify({'error': 'Cannot cancel rollout (not running or not found)'}), 400
    return jsonify({'success': True, 'message': 'Rollout cancelled'})


@servers_bp.route('/fleet/discovery', methods=['POST'])
@admin_required
def start_discovery_scan():
    """Start a network scan for new agents"""
    duration = request.args.get('duration', 10, type=int)
    agents = discovery_service.start_scan(duration)
    return jsonify(agents)


@servers_bp.route('/fleet/discovery', methods=['GET'])
@admin_required
def get_discovered_agents():
    """Get results of last discovery scan"""
    return jsonify(discovery_service.get_discovered_agents())


@servers_bp.route('/fleet/approve/<server_id>', methods=['POST'])
@admin_required
def approve_agent_registration(server_id):
    """Approve a pending agent registration"""
    user_id = get_jwt_identity()
    success = fleet_service.approve_registration(server_id, user_id)

    if not success:
        return jsonify({'error': 'Failed to approve registration'}), 400

    return jsonify({'success': True, 'message': 'Registration approved'})


@servers_bp.route('/fleet/reject/<server_id>', methods=['POST'])
@admin_required
def reject_agent_registration(server_id):
    """Reject a pending agent registration"""
    success = fleet_service.reject_registration(server_id)

    if not success:
        return jsonify({'error': 'Failed to reject registration'}), 400

    return jsonify({'success': True, 'message': 'Registration rejected'})


@servers_bp.route('/fleet/commands/queued', methods=['GET'])
@admin_required
def get_queued_commands():
    """Get all pending queued commands"""
    server_id = request.args.get('server_id')
    commands = fleet_service.get_queued_commands(server_id)
    return jsonify(commands)


@servers_bp.route('/fleet/commands/<command_id>/retry', methods=['POST'])
@admin_required
def retry_command(command_id):
    """Retry a failed command"""
    result = fleet_service.retry_command(command_id)
    if not result.get('success'):
        return jsonify(result), 400
    return jsonify(result)


@servers_bp.route('/fleet/diagnostics/<server_id>', methods=['GET'])
@admin_required
def get_server_diagnostics(server_id):
    """Get detailed connection diagnostics for a server"""
    diagnostics = fleet_service.get_server_diagnostics(server_id)
    if 'error' in diagnostics:
        return jsonify(diagnostics), 404
    return jsonify(diagnostics)


# ==================== Remote Cron Operations ====================
#
# Endpoints under /servers/<id>/cron/ proxy to the agent's cron:*
# command handlers. They mirror the panel-local /api/v1/cron/* surface
# (CronService) but target a remote host. The agent owns validation and
# crontab IO; this layer is just transport.

from app.services.remote_cron_service import RemoteCronService


def _agent_result(result, ok_status=200, missing_status=503):
    """Translate an agent_registry.send_command result into an HTTP
    response. AGENT_OFFLINE → 503; other failures → 500; success → ok."""
    if not result.get('success'):
        code = 500
        if result.get('code') == 'AGENT_OFFLINE':
            code = missing_status
        elif result.get('code') == 'PERMISSION_DENIED':
            code = 403
        return jsonify(result), code
    # Unwrap the agent's data payload so callers see the same shape as
    # the local CronService responses.
    data = result.get('data')
    if isinstance(data, dict):
        return jsonify(data), ok_status
    return jsonify({'data': data, 'success': True}), ok_status


@servers_bp.route('/<server_id>/cron/status', methods=['GET'])
@jwt_required()
def remote_cron_status(server_id):
    user_id = get_jwt_identity()
    result = RemoteCronService.status(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs', methods=['GET'])
@jwt_required()
def remote_cron_list(server_id):
    user_id = get_jwt_identity()
    result = RemoteCronService.list_jobs(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs', methods=['POST'])
@developer_required
def remote_cron_add(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    schedule = (data.get('schedule') or '').strip()
    command = (data.get('command') or '').strip()
    if not schedule:
        raise field_required('schedule')
    if not command:
        raise field_required('command')

    result = RemoteCronService.add_job(
        server_id, schedule, command,
        name=data.get('name'),
        description=data.get('description'),
        user_id=user_id,
    )
    return _agent_result(result, ok_status=201)


@servers_bp.route('/<server_id>/cron/jobs/<job_id>', methods=['DELETE'])
@developer_required
def remote_cron_remove(server_id, job_id):
    user_id = get_jwt_identity()
    result = RemoteCronService.remove_job(server_id, job_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs/<job_id>/toggle', methods=['POST'])
@developer_required
def remote_cron_toggle(server_id, job_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled', True))
    result = RemoteCronService.toggle_job(server_id, job_id, enabled, user_id=user_id)
    return _agent_result(result)


# ==================== Remote Cloudflared Operations ====================
#
# Auth: the user runs `cloudflared tunnel login` once per server.
# That writes ~/.cloudflared/cert.pem (or /etc/cloudflared/cert.pem
# when run as root). The panel never sees a Cloudflare API token —
# every cloudflared:* action just shells out to the binary, which
# uses the cert for auth.
#
# /status surfaces both "binary installed" and "cert present" so the
# UI can show a "log in first" prompt before letting users hit the
# CRUD actions and getting confusing errors.

from app.services.remote_cloudflared_service import RemoteCloudflaredService


@servers_bp.route('/<server_id>/cloudflared/status', methods=['GET'])
@jwt_required()
def remote_cloudflared_status(server_id):
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.status(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/login', methods=['POST'])
@developer_required
def remote_cloudflared_login(server_id):
    """Start `cloudflared tunnel login` on the agent. Returns
    {job_id, channel}; the panel subscribes to the corresponding
    Socket.IO room and renders the auth_url the agent surfaces."""
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.login(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/tunnels', methods=['GET'])
@jwt_required()
def remote_cloudflared_list(server_id):
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.list_tunnels(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/tunnels', methods=['POST'])
@developer_required
def remote_cloudflared_create(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        raise field_required('name')

    result = RemoteCloudflaredService.create_tunnel(server_id, name, user_id=user_id)
    return _agent_result(result, ok_status=201)


@servers_bp.route('/<server_id>/cloudflared/tunnels/<tunnel_ref>/route', methods=['POST'])
@developer_required
def remote_cloudflared_route(server_id, tunnel_ref):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    hostname = (data.get('hostname') or '').strip()
    if not hostname:
        raise field_required('hostname')

    result = RemoteCloudflaredService.route_tunnel(
        server_id, tunnel_ref, hostname, user_id=user_id,
    )
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/tunnels/<tunnel_ref>', methods=['DELETE'])
@developer_required
def remote_cloudflared_delete(server_id, tunnel_ref):
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.delete_tunnel(server_id, tunnel_ref, user_id=user_id)
    return _agent_result(result)


# ==================== Remote Capability Refresh ====================
#
# Lets the panel ask the agent to re-run its capability probe on
# demand — useful after the user installs a runtime, sudoers entry,
# or new package manager and wants new tabs to light up without an
# agent service restart. The agent's response is the freshly merged
# capabilities map; the agent additionally pushes via the persistent
# Capabilities message so all panel listeners stay in sync.

@servers_bp.route('/<server_id>/refresh-capabilities', methods=['POST'])
@developer_required
def remote_refresh_capabilities(server_id):
    user_id = get_jwt_identity()
    result = dispatch_agent_command(
        server_id=server_id, action='agent:recapabilities',
        params={}, user_id=user_id, timeout=20.0,
    )
    return _agent_result(result)


# ==================== Remote Packages ====================
#
# Exposes the agent's packages:* surface for the Packages tab.
# Long-running operations (install/upgrade) return {job_id, channel};
# the frontend subscribes to Socket.IO room
# server_<id>_<channel> for live progress events.

from app.services.remote_packages_service import RemotePackagesService


@servers_bp.route('/<server_id>/packages', methods=['GET'])
@jwt_required()
def remote_packages_list(server_id):
    user_id = get_jwt_identity()
    result = RemotePackagesService.list_installed(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/search', methods=['GET'])
@jwt_required()
def remote_packages_search(server_id):
    user_id = get_jwt_identity()
    query = (request.args.get('q') or '').strip()
    if not query:
        raise field_required('q')
    try:
        limit = int(request.args.get('limit', 100))
    except (TypeError, ValueError):
        limit = 100
    result = RemotePackagesService.search(server_id, query, limit=limit, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/info/<name>', methods=['GET'])
@jwt_required()
def remote_packages_info(server_id, name):
    user_id = get_jwt_identity()
    result = RemotePackagesService.info(server_id, name, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/update-cache', methods=['POST'])
@developer_required
def remote_packages_update_cache(server_id):
    user_id = get_jwt_identity()
    result = RemotePackagesService.update_cache(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/install', methods=['POST'])
@developer_required
def remote_packages_install(server_id):
    """Streaming install. Body: {names: ['nginx', 'redis-server']}.
    Returns {job_id, channel} immediately; the panel subscribes to the
    matching Socket.IO room for live install output."""
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    names = data.get('names') or []
    if isinstance(names, str):
        names = [names]
    if not names:
        raise field_required('names')
    result = RemotePackagesService.install_async(server_id, names, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/remove', methods=['POST'])
@developer_required
def remote_packages_remove(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        raise field_required('name')
    result = RemotePackagesService.remove(server_id, name, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/upgrade', methods=['POST'])
@developer_required
def remote_packages_upgrade(server_id):
    """Streaming upgrade. Body: {all: bool, names?: [...]}. Returns
    {job_id, channel}."""
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    names = data.get('names') or []
    all_pkgs = bool(data.get('all', False))
    if not all_pkgs and not names:
        return jsonify({'error': 'either all=true or names=[...] required'}), 400
    result = RemotePackagesService.upgrade(
        server_id,
        names=names if names else None,
        all_packages=all_pkgs,
        user_id=user_id,
    )
    return _agent_result(result)


# ==================== Remote Services (systemd) ====================

from app.services.remote_systemd_service import RemoteSystemdService


@servers_bp.route('/<server_id>/services', methods=['GET'])
@jwt_required()
def remote_services_list(server_id):
    user_id = get_jwt_identity()
    state = request.args.get('state')
    type_ = request.args.get('type', 'service')
    result = RemoteSystemdService.list_units(server_id, state=state, type_=type_, user_id=user_id)
    return _agent_result(result)


# Static-suffix routes must come before the generic <unit>/<action>
# route so Werkzeug picks the right matcher in registration order.

@servers_bp.route('/<server_id>/services/daemon-reload', methods=['POST'])
@developer_required
def remote_services_daemon_reload(server_id):
    user_id = get_jwt_identity()
    result = RemoteSystemdService.daemon_reload(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/services/<unit>/logs', methods=['GET'])
@jwt_required()
def remote_services_logs(server_id, unit):
    user_id = get_jwt_identity()
    try:
        lines = int(request.args.get('lines', 200))
    except (TypeError, ValueError):
        lines = 200
    result = RemoteSystemdService.logs(server_id, unit, lines=lines, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/services/<unit>', methods=['GET'])
@jwt_required()
def remote_services_status(server_id, unit):
    user_id = get_jwt_identity()
    result = RemoteSystemdService.status(server_id, unit, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/services/<unit>/<action>', methods=['POST'])
@developer_required
def remote_services_control(server_id, unit, action):
    user_id = get_jwt_identity()
    result = RemoteSystemdService.control(server_id, unit, action, user_id=user_id)
    return _agent_result(result)


# ==================== Remote Runtimes (pyenv) ====================
#
# Manages Python versions via pyenv (Linux) and pyenv-win (Windows).
# Bootstrap and install return {job_id, channel} for streaming
# progress; everything else is a synchronous round-trip.

from app.services.remote_runtimes_service import RemoteRuntimesService


@servers_bp.route('/<server_id>/runtimes', methods=['GET'])
@jwt_required()
def remote_runtimes_list(server_id):
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.list_state(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/pyenv/bootstrap', methods=['POST'])
@developer_required
def remote_runtimes_pyenv_bootstrap(server_id):
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.pyenv_bootstrap(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python', methods=['GET'])
@jwt_required()
def remote_runtimes_python_installed(server_id):
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_installed(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/available', methods=['GET'])
@jwt_required()
def remote_runtimes_python_available(server_id):
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_available(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/current', methods=['GET'])
@jwt_required()
def remote_runtimes_python_current(server_id):
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_current(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/install', methods=['POST'])
@developer_required
def remote_runtimes_python_install(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_install(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/uninstall', methods=['POST'])
@developer_required
def remote_runtimes_python_uninstall(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_uninstall(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/global', methods=['POST'])
@developer_required
def remote_runtimes_python_set_global(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_set_global(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/local', methods=['POST'])
@developer_required
def remote_runtimes_python_set_local(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    version = (data.get('version') or '').strip()
    dir_path = (data.get('dir') or '').strip()
    if not version or not dir_path:
        return jsonify({'error': 'version and dir are required'}), 400
    result = RemoteRuntimesService.python_set_local(server_id, version, dir_path, user_id=user_id)
    return _agent_result(result)


# ==================== Remote File Operations ====================
#
# Endpoints under /servers/<id>/files/ proxy to the agent's file:*
# command handlers. Phase 3b ships browse/read/write only — the broader
# verb set (delete, mkdir, rename, copy, chmod, search, disk_usage)
# requires new agent handlers and lands in a follow-up. The agent owns
# allowed_paths enforcement; the panel just transports.

from app.services.remote_file_service import RemoteFileService


@servers_bp.route('/<server_id>/files/allowed-paths', methods=['GET'])
@jwt_required()
def remote_file_allowed_paths(server_id):
    """Return the file roots the agent advertised on connect. Lets the
    file manager seed the browse picker without guessing or hardcoding."""
    paths = RemoteFileService.get_allowed_paths(server_id)
    return jsonify({'allowed_paths': paths})


@servers_bp.route('/<server_id>/files/browse', methods=['GET'])
@jwt_required()
def remote_file_browse(server_id):
    user_id = get_jwt_identity()
    path = request.args.get('path')
    if not path:
        raise field_required('path')
    result = RemoteFileService.list_directory(server_id, path, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/files/read', methods=['GET'])
@jwt_required()
def remote_file_read(server_id):
    user_id = get_jwt_identity()
    path = request.args.get('path')
    if not path:
        raise field_required('path')
    result = RemoteFileService.read_file(server_id, path, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/files/write', methods=['POST'])
@developer_required
def remote_file_write(server_id):
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    path = (data.get('path') or '').strip()
    content = data.get('content')
    if not path:
        raise field_required('path')
    if content is None:
        raise field_required('content')
    result = RemoteFileService.write_file(server_id, path, content, user_id=user_id)
    return _agent_result(result)
