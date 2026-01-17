from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.php_service import PHPService

php_bp = Blueprint('php', __name__)


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


@php_bp.route('/versions', methods=['GET'])
@jwt_required()
@admin_required
def get_versions():
    """Get installed PHP versions."""
    versions = PHPService.get_installed_versions()
    default = PHPService.get_default_version()
    return jsonify({
        'versions': versions,
        'default': default,
        'supported': PHPService.SUPPORTED_VERSIONS
    }), 200


@php_bp.route('/versions/<version>/install', methods=['POST'])
@jwt_required()
@admin_required
def install_version(version):
    """Install a PHP version."""
    result = PHPService.install_version(version)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/default', methods=['POST'])
@jwt_required()
@admin_required
def set_default_version():
    """Set default PHP version."""
    data = request.get_json()
    version = data.get('version') if data else None

    if not version:
        return jsonify({'error': 'version is required'}), 400

    result = PHPService.set_default_version(version)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/<version>/extensions', methods=['GET'])
@jwt_required()
@admin_required
def get_extensions(version):
    """Get installed extensions for a PHP version."""
    extensions = PHPService.get_extensions(version)
    return jsonify({'extensions': extensions, 'version': version}), 200


@php_bp.route('/versions/<version>/extensions', methods=['POST'])
@jwt_required()
@admin_required
def install_extension(version):
    """Install a PHP extension."""
    data = request.get_json()
    extension = data.get('extension') if data else None

    if not extension:
        return jsonify({'error': 'extension is required'}), 400

    result = PHPService.install_extension(version, extension)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/<version>/pools', methods=['GET'])
@jwt_required()
@admin_required
def get_pools(version):
    """Get FPM pools for a PHP version."""
    pools = PHPService.get_pools(version)
    return jsonify({'pools': pools, 'version': version}), 200


@php_bp.route('/versions/<version>/pools', methods=['POST'])
@jwt_required()
@admin_required
def create_pool(version):
    """Create a new FPM pool."""
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'error': 'Pool name is required'}), 400

    result = PHPService.create_pool(version, data['name'], data)
    return jsonify(result), 201 if result['success'] else 400


@php_bp.route('/versions/<version>/pools/<pool_name>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_pool(version, pool_name):
    """Delete an FPM pool."""
    result = PHPService.delete_pool(version, pool_name)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/<version>/fpm/restart', methods=['POST'])
@jwt_required()
@admin_required
def restart_fpm(version):
    """Restart PHP-FPM service."""
    result = PHPService.restart_fpm(version)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/<version>/fpm/reload', methods=['POST'])
@jwt_required()
@admin_required
def reload_fpm(version):
    """Reload PHP-FPM service."""
    result = PHPService.reload_fpm(version)
    return jsonify(result), 200 if result['success'] else 400


@php_bp.route('/versions/<version>/fpm/status', methods=['GET'])
@jwt_required()
@admin_required
def get_fpm_status(version):
    """Get PHP-FPM service status."""
    status = PHPService.get_fpm_status(version)
    return jsonify(status), 200


@php_bp.route('/versions/<version>/info', methods=['GET'])
@jwt_required()
@admin_required
def get_php_info(version):
    """Get PHP configuration info."""
    info = PHPService.get_php_info(version)
    if 'error' in info:
        return jsonify(info), 400
    return jsonify({'info': info, 'version': version}), 200
