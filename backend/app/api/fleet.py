"""
Fleet API

Cross-server endpoints that don't belong to any single server's resource
tree — primarily the target-picker support that every agent-aware
feature page consumes.

The "target" abstraction:

    target = {"kind": "local"}
            | {"kind": "agent", "server_id": "...", "server_name": "..."}

Pages render a picker; clicks send `target` in the request body of
feature CRUD calls; the backend dispatches against `target.kind`. See
`backend/app/services/fleet_targeting.py` (Phase 1) for the dispatch
helper.

This module is read-only; it does not write any state.
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.services.agent_registry import agent_registry
from app.services.workspace_service import WorkspaceService
from app.middleware.rbac import get_current_user


fleet_bp = Blueprint('fleet', __name__)


@fleet_bp.route('/targets', methods=['GET'])
@jwt_required()
def list_targets():
    """List runnable targets, optionally filtered by feature.

    Query params:
        feature  — capability name (cron, docker, systemd, …). When
                   present, only agents whose advertised capability
                   map has feature=true are returned. When absent,
                   every connected agent is returned regardless of
                   capabilities.

    The local panel host is always included as the first entry. Even
    if no agent has the requested feature the caller still gets the
    local target back, which matches the behaviour the UI expects:
    "the local target is always available, agents are additive."
    """
    feature = (request.args.get('feature') or '').strip() or None

    targets = [{'kind': 'local'}]
    user = get_current_user()

    # Walk the in-memory registry of connected agents. We intentionally
    # do NOT pull from the Server table — capabilities are per-session
    # state, and a server with status=offline can't take a command no
    # matter what it last reported.
    for server_id in agent_registry.get_connected_servers():
        if feature and not agent_registry.has_capability(server_id, feature):
            continue

        # Look up the display name. We could cache this on
        # ConnectedAgent, but the table is small and the lookup is
        # cheap; not worth the staleness risk.
        server = WorkspaceService.get_accessible_server(user, server_id)
        if not server:
            # Connected agent without a Server row would be a bug
            # elsewhere; skip rather than 500.
            continue

        caps = agent_registry.get_capabilities(server_id) or {}

        targets.append({
            'kind': 'agent',
            'server_id': server.id,
            'server_name': server.name,
            'hostname': server.hostname,
            'capabilities': caps,
        })

    return jsonify({'targets': targets})
