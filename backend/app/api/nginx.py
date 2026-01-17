from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.nginx_service import NginxService

nginx_bp = Blueprint('nginx', __name__)


def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


@nginx_bp.route('/status', methods=['GET'])
@jwt_required()
@admin_required
def get_status():
    """Get Nginx service status."""
    status = NginxService.get_status()
    return jsonify(status), 200


@nginx_bp.route('/test', methods=['POST'])
@jwt_required()
@admin_required
def test_config():
    """Test Nginx configuration syntax."""
    result = NginxService.test_config()
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/reload', methods=['POST'])
@jwt_required()
@admin_required
def reload_nginx():
    """Reload Nginx configuration."""
    result = NginxService.reload()
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/restart', methods=['POST'])
@jwt_required()
@admin_required
def restart_nginx():
    """Restart Nginx service."""
    result = NginxService.restart()
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/sites', methods=['GET'])
@jwt_required()
@admin_required
def list_sites():
    """List all Nginx sites."""
    sites = NginxService.list_sites()
    return jsonify({'sites': sites}), 200


@nginx_bp.route('/sites', methods=['POST'])
@jwt_required()
@admin_required
def create_site():
    """Create a new Nginx site configuration."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required_fields = ['name', 'app_type', 'domains', 'root_path']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = NginxService.create_site(
        name=data['name'],
        app_type=data['app_type'],
        domains=data['domains'],
        root_path=data['root_path'],
        port=data.get('port'),
        php_version=data.get('php_version', '8.2')
    )

    return jsonify(result), 201 if result['success'] else 400


@nginx_bp.route('/sites/<name>/enable', methods=['POST'])
@jwt_required()
@admin_required
def enable_site(name):
    """Enable a site."""
    result = NginxService.enable_site(name)
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/sites/<name>/disable', methods=['POST'])
@jwt_required()
@admin_required
def disable_site(name):
    """Disable a site."""
    result = NginxService.disable_site(name)
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/sites/<name>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_site(name):
    """Delete a site configuration."""
    result = NginxService.delete_site(name)
    return jsonify(result), 200 if result['success'] else 400


@nginx_bp.route('/sites/<name>/ssl', methods=['POST'])
@jwt_required()
@admin_required
def add_ssl_to_site(name):
    """Add SSL configuration to a site."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    cert_path = data.get('cert_path')
    key_path = data.get('key_path')

    if not cert_path or not key_path:
        return jsonify({'error': 'cert_path and key_path are required'}), 400

    result = NginxService.add_ssl_to_site(name, cert_path, key_path)
    return jsonify(result), 200 if result['success'] else 400
