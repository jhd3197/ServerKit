from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.ssl_service import SSLService

ssl_bp = Blueprint('ssl', __name__)


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


@ssl_bp.route('/certificates', methods=['GET'])
@jwt_required()
@admin_required
def list_certificates():
    """List all SSL certificates."""
    certificates = SSLService.list_certificates()
    return jsonify({'certificates': certificates}), 200


@ssl_bp.route('/certificates/<domain>', methods=['GET'])
@jwt_required()
@admin_required
def get_certificate(domain):
    """Get details for a specific certificate."""
    info = SSLService.get_certificate_info(domain)
    if info:
        return jsonify({'certificate': info}), 200
    return jsonify({'error': 'Certificate not found'}), 404


@ssl_bp.route('/certificates', methods=['POST'])
@jwt_required()
@admin_required
def obtain_certificate():
    """Obtain a new SSL certificate from Let's Encrypt."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    domains = data.get('domains')
    email = data.get('email')

    if not domains or not email:
        return jsonify({'error': 'domains and email are required'}), 400

    result = SSLService.obtain_certificate(
        domains=domains,
        email=email,
        webroot_path=data.get('webroot_path'),
        use_nginx=data.get('use_nginx', True)
    )

    return jsonify(result), 201 if result['success'] else 400


@ssl_bp.route('/certificates/<domain>/renew', methods=['POST'])
@jwt_required()
@admin_required
def renew_certificate(domain):
    """Renew a specific certificate."""
    result = SSLService.renew_certificate(domain)
    return jsonify(result), 200 if result['success'] else 400


@ssl_bp.route('/certificates/renew-all', methods=['POST'])
@jwt_required()
@admin_required
def renew_all_certificates():
    """Renew all certificates that need renewal."""
    result = SSLService.renew_certificate()
    return jsonify(result), 200 if result['success'] else 400


@ssl_bp.route('/certificates/<domain>', methods=['DELETE'])
@jwt_required()
@admin_required
def revoke_certificate(domain):
    """Revoke and delete a certificate."""
    result = SSLService.revoke_certificate(domain)
    return jsonify(result), 200 if result['success'] else 400


@ssl_bp.route('/certificates/<domain>/check', methods=['GET'])
@jwt_required()
@admin_required
def check_certificate_expiry(domain):
    """Check if a certificate is expiring soon."""
    result = SSLService.check_expiry(domain)
    return jsonify(result), 200


@ssl_bp.route('/auto-renewal', methods=['POST'])
@jwt_required()
@admin_required
def setup_auto_renewal():
    """Set up automatic certificate renewal."""
    result = SSLService.setup_auto_renewal()
    return jsonify(result), 200 if result['success'] else 400


@ssl_bp.route('/status', methods=['GET'])
@jwt_required()
@admin_required
def get_ssl_status():
    """Get overall SSL status."""
    is_installed = SSLService.is_certbot_installed()
    certificates = SSLService.list_certificates()

    expiring_soon = []
    for cert in certificates:
        check = SSLService.check_expiry(cert['name'])
        if check.get('expiring_soon'):
            expiring_soon.append(cert['name'])

    return jsonify({
        'certbot_installed': is_installed,
        'total_certificates': len(certificates),
        'expiring_soon': expiring_soon,
        'certificates': certificates
    }), 200
