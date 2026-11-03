"""Monitor-mode agent report endpoint.

``POST /api/v1/agent/report`` is the ONLY channel a monitor-level agent uses:
a signed, outbound-only HTTPS POST. The reply never carries commands.

Auth (no JWT/CSRF; the HMAC is the credential):
  X-Agent-Key: <api key>          -> server looked up by its key prefix
  X-Timestamp: <unix seconds>     -> |skew| <= 300s
  X-Nonce:     <hex, >=32 chars>  -> single use (TTL cache, 5 min)
  X-Signature: hex(HMAC_SHA256(api_secret, ts + "." + nonce + "." + sha256hex(body)))
"""

from flask import Blueprint, jsonify, request

from app import limiter
from app.services import agent_health_service, permission_levels
from app.utils.ip_utils import is_ip_allowed


agent_report_bp = Blueprint('agent_report', __name__)

MAX_BODY_BYTES = 64 * 1024
MAX_SKEW_SECONDS = 300


def _rate_key():
    return f"{request.remote_addr}:{(request.headers.get('X-Agent-Key') or '')[:12]}"


@agent_report_bp.route('/report', methods=['POST'])
@limiter.limit("30 per minute", key_func=_rate_key)
def report():
    if (request.content_length or 0) > MAX_BODY_BYTES:
        return jsonify({'error': 'payload too large'}), 413
    raw = request.get_data(cache=True)
    if len(raw) > MAX_BODY_BYTES:
        return jsonify({'error': 'payload too large'}), 413

    server = agent_health_service.authenticate_report(raw, request.headers, MAX_SKEW_SECONDS)
    if not server:
        return jsonify({'error': 'authentication failed'}), 401
    if server.allowed_ips and not is_ip_allowed(request.remote_addr, server.allowed_ips):
        return jsonify({'error': 'IP not allowed'}), 403

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({'error': 'JSON object required'}), 400
    level = body.get('permission_level')
    if level not in permission_levels.LEVELS:
        return jsonify({'error': 'permission_level must be monitor, protect or full'}), 400

    interval = agent_health_service.ingest_report(server, level, body)
    return jsonify({'ok': True, 'interval_seconds': interval})
