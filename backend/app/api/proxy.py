"""Managed reverse-proxy stack API.

Per-server endpoints for the opt-in Dockerized proxy (Traefik/Caddy). Host
nginx remains the default; these routes let an operator switch a server to a
managed proxy stack, preview the generated compose, and (best-effort)
regenerate/deploy it.

Mounted by the app factory at ``/api/v1/servers`` so paths are
``/servers/<server_id>/proxy*``. Reads require auth; mutations require
developer access (matching servers.py group/server mutations).
"""
from flask import Blueprint, request, jsonify

from flask_jwt_extended import jwt_required

from app.middleware.rbac import developer_required
from app.services.proxy_stack_service import ProxyStackService
from app.api._request import json_object

proxy_bp = Blueprint('proxy', __name__)


def _require_server(server_id):
    """Return (server, None) or (None, error_response_tuple)."""
    from app.middleware.rbac import get_current_user
    from app.services.workspace_service import WorkspaceService
    server = WorkspaceService.get_accessible_server(get_current_user(), server_id)
    if not server:
        return None, (jsonify({'error': 'Server not found'}), 404)
    return server, None


@proxy_bp.route('/proxy/overview', methods=['GET'])
@jwt_required()
def proxy_overview():
    """Fleet-wide proxy posture: one row per server.

    Mounted under ``/api/v1/servers`` → full path ``/api/v1/servers/proxy/
    overview``. The static ``proxy`` segment can't match the ``<server_id>``
    converter on ``/<server_id>/proxy``, and Werkzeug prefers static rules over
    dynamic ones, so the two never collide. Best-effort; always returns JSON.
    """
    return jsonify({'servers': ProxyStackService.fleet_overview()})


@proxy_bp.route('/<server_id>/proxy', methods=['GET'])
@jwt_required()
def get_proxy(server_id):
    """Get the managed proxy stack state for a server (best-effort status)."""
    _, err = _require_server(server_id)
    if err:
        return err
    return jsonify(ProxyStackService.status(server_id))


@proxy_bp.route('/<server_id>/proxy/ingress-audit', methods=['GET'])
@jwt_required()
def ingress_audit(server_id):
    """Which of a server's apps disagree with its configured proxy mode.

    Returns the expected ingress plane for the server plus a per-app list with
    a ``mismatch`` flag, so the UI can warn when host-Nginx apps are running on
    a server whose active proxy is a Dockerized stack (or vice versa).
    """
    _, err = _require_server(server_id)
    if err:
        return err
    return jsonify(ProxyStackService.ingress_audit(server_id))


@proxy_bp.route('/<server_id>/proxy/compose-preview', methods=['GET'])
@jwt_required()
def compose_preview(server_id):
    """Preview the generated docker-compose for a proxy type (no writes).

    ``?proxy_type=traefik|caddy|nginx`` overrides the stored type so the UI
    can preview before switching. Returns ``compose: null`` for nginx.
    """
    _, err = _require_server(server_id)
    if err:
        return err

    stack = ProxyStackService.get_or_create(server_id)
    proxy_type = request.args.get('proxy_type', stack.proxy_type)

    options = {}
    if request.args.get('acme_email'):
        options['acme_email'] = request.args.get('acme_email')
    if request.args.get('dashboard') in ('1', 'true', 'yes'):
        options['dashboard'] = True

    try:
        compose = ProxyStackService.generate_compose(server_id, proxy_type, options)
        config = ProxyStackService.generate_config(
            proxy_type, [], stack.custom_snippet
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    return jsonify({
        'proxy_type': proxy_type,
        'compose': compose,
        'config': config,
    })


@proxy_bp.route('/<server_id>/proxy/configure', methods=['POST'])
@developer_required
def configure_proxy(server_id):
    """Update proxy type and/or custom snippet for a server.

    Body: ``{proxy_type?, custom_snippet?, deploy?}``. When ``deploy`` is
    truthy and the type is a stack proxy, a best-effort compose-up runs.
    """
    _, err = _require_server(server_id)
    if err:
        return err

    data = json_object()
    proxy_type = data.get('proxy_type')
    custom_snippet = data.get('custom_snippet')

    try:
        stack = ProxyStackService.configure(
            server_id,
            proxy_type=proxy_type,
            custom_snippet=custom_snippet,
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    result = stack.to_dict()
    if data.get('deploy') and stack.proxy_type != 'nginx':
        result['deploy'] = ProxyStackService.deploy_stack(server_id)

    return jsonify(result)


@proxy_bp.route('/<server_id>/proxy/regenerate', methods=['POST'])
@developer_required
def regenerate_proxy(server_id):
    """Rewrite the proxy config and best-effort hot-reload the stack."""
    _, err = _require_server(server_id)
    if err:
        return err

    data = json_object()
    sites = data.get('sites')
    result = ProxyStackService.regenerate(server_id, sites=sites)
    status = 200 if result.get('success') else 502
    return jsonify(result), status


@proxy_bp.route('/<server_id>/proxy/switch', methods=['POST'])
@developer_required
def switch_proxy(server_id):
    """Switch a server to a different proxy type (nginx/traefik/caddy)."""
    _, err = _require_server(server_id)
    if err:
        return err

    data = json_object()
    proxy_type = data.get('proxy_type')
    if not proxy_type:
        return jsonify({'error': 'proxy_type is required'}), 400

    try:
        stack = ProxyStackService.switch(server_id, proxy_type)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    return jsonify(stack.to_dict())
