"""
Agent polling fallback transport.

Provides REST endpoints that mirror the heartbeat / command / result
exchange normally carried over Socket.IO, for agents behind tunnels that
mangle WebSocket frames (Cloudflare quick tunnels, free-tier ngrok, some
restrictive corporate proxies). Streaming features — live logs,
real-time metrics fan-out, terminal sessions — are intentionally NOT
supported here; they degrade to "view recent only" via the regular API.

Auth model:
  - POST /connect with the same HMAC payload the WS namespace uses;
    receive a session_token.
  - All subsequent calls send "X-Session-Token: <token>". The token
    looks up the ConnectedAgent in the registry (transport='poll'),
    which is what authenticates the request — no per-call HMAC.
"""

import logging
from flask import Blueprint, jsonify, request

from app.services.agent_registry import agent_registry
from app.api._request import json_object


logger = logging.getLogger(__name__)

agent_poll_bp = Blueprint('agent_poll', __name__)


def _client_ip():
    # ProxyFix-corrected real client IP when TRUST_PROXY_HEADERS is on,
    # so the shared per-IP auth throttle keys on the real agent, not nginx.
    return request.remote_addr or 'unknown'


@agent_poll_bp.route('/connect', methods=['POST'])
def connect():
    """Authenticate an agent and return a session_token bound to a
    polling-mode ConnectedAgent.

    Thin adapter over agent_registry.authenticate_and_register
    — the exact sequence the WS on_auth handler runs, minus the socket-room
    bookkeeping; this endpoint only translates the outcome to HTTP."""
    data = request.get_json(silent=True) or {}
    ip = _client_ip()

    session_token, server, error = agent_registry.authenticate_and_register(
        data,
        ip,
        user_agent=request.headers.get('User-Agent') or '',
        transport='poll',
    )

    if error == 'rate_limited':
        return jsonify({'success': False, 'error': 'Rate limit exceeded. Try again later.'}), 429
    if error == 'missing_fields':
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    if error == 'auth_failed':
        return jsonify({'success': False, 'error': 'Authentication failed'}), 401
    if error == 'ip_not_allowed':
        return jsonify({'success': False, 'error': 'IP not allowed'}), 403
    if error is not None:
        return jsonify({'success': False, 'error': 'Registration failed'}), 500

    return jsonify({
        'success': True,
        'session_token': session_token,
        'server_id': server.id,
        # Hint for the agent on how often to poll. Long-polls for up to
        # this many seconds before returning empty so loops are gentle.
        'poll_interval_s': 25,
    })


@agent_poll_bp.route('/poll', methods=['POST'])
def poll():
    """Long-polling endpoint. The agent posts a heartbeat (with metrics);
    we record it, then block up to ~25s waiting for queued commands. On
    return, the agent dispatches whatever commands came back and POSTs
    each result via /result.

    Body: {"metrics": {...}, "system_info": {...} (optional, sent once)}
    """
    token = request.headers.get('X-Session-Token')
    agent = agent_registry.get_agent_by_token(token)
    if not agent:
        return jsonify({'error': 'invalid session'}), 401

    body = json_object(optional=True)
    metrics = body.get('metrics') or {}
    sysinfo = body.get('system_info')
    caps = body.get('capabilities')

    # Diagnostic: log whenever the agent ships state. Helps debug the
    # "panel shows N/A" failure mode where the agent is connected but
    # the periodic resend isn't actually reaching us.
    import logging as _logging
    _log = _logging.getLogger(__name__)
    _log.info(
        "agent /poll from %s: metrics=%s sysinfo_keys=%s caps_keys=%s",
        agent.server_id,
        bool(metrics),
        list(sysinfo.keys()) if isinstance(sysinfo, dict) else None,
        list(caps.keys()) if isinstance(caps, dict) else None,
    )

    # Shared transport-neutral ingest: capability
    # side-effects (e.g. tunnel reconcile) fire exactly as on the WS path.
    agent_registry.ingest_agent_state(agent, metrics=metrics, sysinfo=sysinfo,
                                      capabilities=caps,
                                      permission_level=body.get('permission_level'),
                                      service_checks=body.get('service_checks'))

    # Long-poll up to 25s for any queued command. Below the typical
    # tunnel idle-timeout (Cloudflare ~100s, ngrok ~60s) so we never
    # discover a dead idle connection mid-wait.
    commands = agent_registry.drain_outbound(agent, max_wait_s=25.0)
    return jsonify({
        'commands': commands,
        # Echo the heartbeat ack so the agent can detect a still-live
        # session even when no commands arrive.
        'ack': True,
    })


@agent_poll_bp.route('/result', methods=['POST'])
def result():
    """Agent posts the outcome of a command it received from /poll.
    Wakes the synchronous send_command waiter on the panel side."""
    token = request.headers.get('X-Session-Token')
    body = request.get_json(silent=True) or {}
    if not agent_registry.deliver_result_by_token(token, body):
        return jsonify({'error': 'unknown command or session'}), 404
    return jsonify({'ok': True})


@agent_poll_bp.route('/disconnect', methods=['POST'])
def disconnect():
    """Clean shutdown when the agent is going offline or switching
    transports. Idempotent — missing token is fine."""
    token = request.headers.get('X-Session-Token')
    agent_registry.unregister_by_token(token, reason='client_disconnect')
    return jsonify({'ok': True})
