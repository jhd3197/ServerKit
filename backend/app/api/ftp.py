"""FTP Server API endpoints for managing FTP services and users."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from ..services.ftp_service import FTPService

ftp_bp = Blueprint('ftp', __name__)


@ftp_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get FTP server status."""
    result = FTPService.get_status()
    return jsonify(result), 200


@ftp_bp.route('/service/<action>', methods=['POST'])
@jwt_required()
def control_service(action):
    """Start, stop, restart, or reload FTP service."""
    if action not in ['start', 'stop', 'restart', 'reload']:
        return jsonify({
            'success': False,
            'error': 'Invalid action. Use: start, stop, restart, or reload'
        }), 400

    data = request.get_json() or {}
    service = data.get('service')  # Optional: specify vsftpd or proftpd

    result = FTPService.control_service(service, action)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/config', methods=['GET'])
@jwt_required()
def get_config():
    """Get FTP server configuration."""
    service = request.args.get('service')  # Optional
    result = FTPService.get_config(service)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/config', methods=['POST'])
@jwt_required()
def update_config():
    """Update FTP server configuration."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    service = data.get('service')
    config_content = data.get('config')

    if not config_content:
        return jsonify({'success': False, 'error': 'Configuration content is required'}), 400

    result = FTPService.update_config(service, config_content)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    """List FTP users."""
    result = FTPService.list_users()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/users', methods=['POST'])
@jwt_required()
def create_user():
    """Create a new FTP user."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    username = data.get('username')
    password = data.get('password')  # Optional, can be auto-generated
    home_dir = data.get('home_dir')  # Optional

    if not username:
        return jsonify({'success': False, 'error': 'Username is required'}), 400

    # Validate username
    if not username.isalnum() and '_' not in username:
        return jsonify({
            'success': False,
            'error': 'Username must contain only alphanumeric characters and underscores'
        }), 400

    result = FTPService.create_user(username, password, home_dir)

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@ftp_bp.route('/users/<username>', methods=['DELETE'])
@jwt_required()
def delete_user(username):
    """Delete an FTP user."""
    delete_home = request.args.get('delete_home', 'false').lower() == 'true'

    result = FTPService.delete_user(username, delete_home=delete_home)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/users/<username>/password', methods=['POST'])
@jwt_required()
def change_password(username):
    """Change FTP user password."""
    data = request.get_json() or {}
    new_password = data.get('password')  # Optional, can be auto-generated

    result = FTPService.change_password(username, new_password)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/users/<username>/toggle', methods=['POST'])
@jwt_required()
def toggle_user(username):
    """Enable or disable an FTP user."""
    data = request.get_json() or {}
    enabled = data.get('enabled', True)

    result = FTPService.toggle_user(username, enabled)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/connections', methods=['GET'])
@jwt_required()
def get_connections():
    """Get active FTP connections."""
    result = FTPService.get_connections()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/connections/<int:pid>', methods=['DELETE'])
@jwt_required()
def disconnect_user(pid):
    """Disconnect an active FTP session."""
    result = FTPService.disconnect_session(pid)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/logs', methods=['GET'])
@jwt_required()
def get_logs():
    """Get FTP server logs."""
    lines = request.args.get('lines', 100, type=int)

    result = FTPService.get_logs(lines)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/install', methods=['POST'])
@jwt_required()
def install_ftp():
    """Install FTP server (vsftpd or proftpd)."""
    data = request.get_json() or {}
    service = data.get('service', 'vsftpd')

    if service not in ['vsftpd', 'proftpd']:
        return jsonify({
            'success': False,
            'error': 'Invalid service. Use: vsftpd or proftpd'
        }), 400

    result = FTPService.install_ftp_server(service)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@ftp_bp.route('/test', methods=['POST'])
@jwt_required()
def test_connection():
    """Test FTP connection."""
    data = request.get_json() or {}
    host = data.get('host', 'localhost')
    port = data.get('port', 21)
    username = data.get('username')
    password = data.get('password')

    result = FTPService.test_connection(host, port, username, password)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400
