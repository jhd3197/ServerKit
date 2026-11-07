"""Remote terminal, cron, cloudflared, packages, systemd, runtimes and file routes.

Registered on the shared ``servers_bp`` blueprint (see app.api.servers)."""
from app.services.remote_cloudflared_service import RemoteCloudflaredService
from app.services.remote_cron_service import RemoteCronService
from app.services.remote_file_service import RemoteFileService
from app.services.remote_packages_service import RemotePackagesService
from app.services.remote_runtimes_service import RemoteRuntimesService
from app.services.remote_systemd_service import RemoteSystemdService
from app.services.terminal_service import TerminalService
from app.middleware.rbac import developer_required
from app.services.remote_command_dispatcher import dispatch_agent_command
from app.exceptions import field_required
from flask_jwt_extended import get_jwt_identity, jwt_required
from flask import jsonify, request
from app.api.servers import _agent_failure_status, _get_operable_server, servers_bp
from app.api._request import json_object


# ==================== Remote Terminal ====================

@servers_bp.route('/<server_id>/terminal', methods=['POST'])
@developer_required
def create_terminal_session(server_id):
    """Create a new terminal session on a remote server.

    Body:
        cols: Terminal width (default: 80)
        rows: Terminal height (default: 24)
    """
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object()

    cols = data.get('cols', 80)
    rows = data.get('rows', 24)

    result = TerminalService.create_session(
        server_id=server_id,
        user_id=user_id,
        cols=cols,
        rows=rows
    )

    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)

    return jsonify(result)


@servers_bp.route('/terminal/<session_id>/input', methods=['POST'])
@developer_required
def terminal_input(session_id):
    """Send input to a terminal session.

    Body:
        data: Base64-encoded input data
    """
    user_id = get_jwt_identity()
    data = json_object()

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
    data = json_object()

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


# ==================== Remote Cron Operations ====================
#
# Endpoints under /servers/<id>/cron/ proxy to the agent's cron:*
# command handlers. They mirror the panel-local /api/v1/cron/* surface
# (CronService) but target a remote host. The agent owns validation and
# crontab IO; this layer is just transport.


def _agent_result(result, ok_status=200):
    """Translate an agent_registry.send_command result into an HTTP
    response: a failure with its status, success unwrapped."""
    if not result.get('success'):
        return jsonify(result), _agent_failure_status(result)
    # Unwrap the agent's data payload so callers see the same shape as
    # the local CronService responses.
    data = result.get('data')
    if isinstance(data, dict):
        return jsonify(data), ok_status
    return jsonify({'data': data, 'success': True}), ok_status


@servers_bp.route('/<server_id>/cron/status', methods=['GET'])
@jwt_required()
def remote_cron_status(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCronService.status(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs', methods=['GET'])
@jwt_required()
def remote_cron_list(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCronService.list_jobs(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs', methods=['POST'])
@developer_required
def remote_cron_add(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCronService.remove_job(server_id, job_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cron/jobs/<job_id>/toggle', methods=['POST'])
@developer_required
def remote_cron_toggle(server_id, job_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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


@servers_bp.route('/<server_id>/cloudflared/status', methods=['GET'])
@jwt_required()
def remote_cloudflared_status(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.status(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/login', methods=['POST'])
@developer_required
def remote_cloudflared_login(server_id):
    """Start `cloudflared tunnel login` on the agent. Returns
    {job_id, channel}; the panel subscribes to the corresponding
    Socket.IO room and renders the auth_url the agent surfaces."""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.login(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/tunnels', methods=['GET'])
@jwt_required()
def remote_cloudflared_list(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteCloudflaredService.list_tunnels(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/cloudflared/tunnels', methods=['POST'])
@developer_required
def remote_cloudflared_create(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
    name = (data.get('name') or '').strip()
    if not name:
        raise field_required('name')

    result = RemoteCloudflaredService.create_tunnel(server_id, name, user_id=user_id)
    return _agent_result(result, ok_status=201)


@servers_bp.route('/<server_id>/cloudflared/tunnels/<tunnel_ref>/route', methods=['POST'])
@developer_required
def remote_cloudflared_route(server_id, tunnel_ref):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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
    _get_operable_server(server_id)
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
    _get_operable_server(server_id)
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


@servers_bp.route('/<server_id>/packages', methods=['GET'])
@jwt_required()
def remote_packages_list(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemotePackagesService.list_installed(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/search', methods=['GET'])
@jwt_required()
def remote_packages_search(server_id):
    _get_operable_server(server_id)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemotePackagesService.info(server_id, name, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/update-cache', methods=['POST'])
@developer_required
def remote_packages_update_cache(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemotePackagesService.update_cache(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/packages/install', methods=['POST'])
@developer_required
def remote_packages_install(server_id):
    """Streaming install. Body: {names: ['nginx', 'redis-server']}.
    Returns {job_id, channel} immediately; the panel subscribes to the
    matching Socket.IO room for live install output."""
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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


@servers_bp.route('/<server_id>/services', methods=['GET'])
@jwt_required()
def remote_services_list(server_id):
    _get_operable_server(server_id)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteSystemdService.daemon_reload(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/services/<unit>/logs', methods=['GET'])
@jwt_required()
def remote_services_logs(server_id, unit):
    _get_operable_server(server_id)
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
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteSystemdService.status(server_id, unit, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/services/<unit>/<action>', methods=['POST'])
@developer_required
def remote_services_control(server_id, unit, action):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteSystemdService.control(server_id, unit, action, user_id=user_id)
    return _agent_result(result)


# ==================== Remote Runtimes (pyenv) ====================
#
# Manages Python versions via pyenv (Linux) and pyenv-win (Windows).
# Bootstrap and install return {job_id, channel} for streaming
# progress; everything else is a synchronous round-trip.


@servers_bp.route('/<server_id>/runtimes', methods=['GET'])
@jwt_required()
def remote_runtimes_list(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.list_state(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/pyenv/bootstrap', methods=['POST'])
@developer_required
def remote_runtimes_pyenv_bootstrap(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.pyenv_bootstrap(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python', methods=['GET'])
@jwt_required()
def remote_runtimes_python_installed(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_installed(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/available', methods=['GET'])
@jwt_required()
def remote_runtimes_python_available(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_available(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/current', methods=['GET'])
@jwt_required()
def remote_runtimes_python_current(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    result = RemoteRuntimesService.python_current(server_id, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/install', methods=['POST'])
@developer_required
def remote_runtimes_python_install(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_install(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/uninstall', methods=['POST'])
@developer_required
def remote_runtimes_python_uninstall(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_uninstall(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/global', methods=['POST'])
@developer_required
def remote_runtimes_python_set_global(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
    version = (data.get('version') or '').strip()
    if not version:
        raise field_required('version')
    result = RemoteRuntimesService.python_set_global(server_id, version, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/runtimes/python/local', methods=['POST'])
@developer_required
def remote_runtimes_python_set_local(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
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


@servers_bp.route('/<server_id>/files/allowed-paths', methods=['GET'])
@jwt_required()
def remote_file_allowed_paths(server_id):
    """Return the file roots the agent advertised on connect. Lets the
    file manager seed the browse picker without guessing or hardcoding."""
    _get_operable_server(server_id)
    paths = RemoteFileService.get_allowed_paths(server_id)
    return jsonify({'allowed_paths': paths})


@servers_bp.route('/<server_id>/files/browse', methods=['GET'])
@jwt_required()
def remote_file_browse(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    path = request.args.get('path')
    if not path:
        raise field_required('path')
    result = RemoteFileService.list_directory(server_id, path, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/files/read', methods=['GET'])
@jwt_required()
def remote_file_read(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    path = request.args.get('path')
    if not path:
        raise field_required('path')
    result = RemoteFileService.read_file(server_id, path, user_id=user_id)
    return _agent_result(result)


@servers_bp.route('/<server_id>/files/write', methods=['POST'])
@developer_required
def remote_file_write(server_id):
    _get_operable_server(server_id)
    user_id = get_jwt_identity()
    data = json_object(optional=True)
    path = (data.get('path') or '').strip()
    content = data.get('content')
    if not path:
        raise field_required('path')
    if content is None:
        raise field_required('content')
    result = RemoteFileService.write_file(server_id, path, content, user_id=user_id)
    return _agent_result(result)
