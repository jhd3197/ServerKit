from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Domain, Application, User
from app.services.nginx_service import NginxService
from app.services.ssl_service import SSLService

domains_bp = Blueprint('domains', __name__)


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


@domains_bp.route('', methods=['GET'])
@jwt_required()
def get_domains():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role == 'admin':
        domains = Domain.query.all()
    else:
        # Get domains for user's applications
        user_app_ids = [app.id for app in Application.query.filter_by(user_id=current_user_id).all()]
        domains = Domain.query.filter(Domain.application_id.in_(user_app_ids)).all()

    return jsonify({
        'domains': [domain.to_dict() for domain in domains]
    }), 200


@domains_bp.route('/<int:domain_id>', methods=['GET'])
@jwt_required()
def get_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    return jsonify({'domain': domain.to_dict()}), 200


@domains_bp.route('', methods=['POST'])
@jwt_required()
def create_domain():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    application_id = data.get('application_id')

    if not all([name, application_id]):
        return jsonify({'error': 'Missing required fields: name, application_id'}), 400

    # Check if domain already exists
    if Domain.query.filter_by(name=name).first():
        return jsonify({'error': 'Domain already exists'}), 409

    # Check if application exists and user has access
    app = Application.query.get(application_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Check if this should be the primary domain
    is_primary = data.get('is_primary', False)
    if is_primary:
        # Unset any existing primary domain for this app
        Domain.query.filter_by(application_id=application_id, is_primary=True).update({'is_primary': False})

    domain = Domain(
        name=name,
        is_primary=is_primary,
        ssl_enabled=data.get('ssl_enabled', False),
        ssl_auto_renew=data.get('ssl_auto_renew', True),
        application_id=application_id
    )

    db.session.add(domain)
    db.session.commit()

    return jsonify({
        'message': 'Domain created successfully',
        'domain': domain.to_dict()
    }), 201


@domains_bp.route('/<int:domain_id>', methods=['PUT'])
@jwt_required()
def update_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    if 'is_primary' in data and data['is_primary']:
        # Unset any existing primary domain for this app
        Domain.query.filter_by(application_id=domain.application_id, is_primary=True).update({'is_primary': False})
        domain.is_primary = True

    if 'ssl_enabled' in data:
        domain.ssl_enabled = data['ssl_enabled']
    if 'ssl_auto_renew' in data:
        domain.ssl_auto_renew = data['ssl_auto_renew']

    db.session.commit()

    return jsonify({
        'message': 'Domain updated successfully',
        'domain': domain.to_dict()
    }), 200


@domains_bp.route('/<int:domain_id>', methods=['DELETE'])
@jwt_required()
def delete_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(domain)
    db.session.commit()

    return jsonify({'message': 'Domain deleted successfully'}), 200


@domains_bp.route('/<int:domain_id>/ssl/enable', methods=['POST'])
@jwt_required()
def enable_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    email = data.get('email')

    if not email:
        return jsonify({'error': 'Email is required for SSL certificate'}), 400

    # Request Let's Encrypt certificate
    result = SSLService.obtain_certificate(
        domains=[domain.name],
        email=email,
        use_nginx=True
    )

    if not result['success']:
        return jsonify({'error': result.get('error', 'Failed to obtain certificate')}), 400

    # Add SSL to Nginx site
    nginx_result = NginxService.add_ssl_to_site(
        app.name,
        result['certificate_path'],
        result['private_key_path']
    )

    if not nginx_result['success']:
        return jsonify({'error': nginx_result.get('error', 'Failed to configure Nginx')}), 400

    domain.ssl_enabled = True
    domain.ssl_certificate_path = result['certificate_path']
    domain.ssl_private_key_path = result['private_key_path']
    db.session.commit()

    return jsonify({
        'message': 'SSL enabled for domain',
        'domain': domain.to_dict(),
        'certificate': result
    }), 200


@domains_bp.route('/<int:domain_id>/ssl/disable', methods=['POST'])
@jwt_required()
def disable_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    domain.ssl_enabled = False
    db.session.commit()

    return jsonify({
        'message': 'SSL disabled for domain',
        'domain': domain.to_dict()
    }), 200


@domains_bp.route('/<int:domain_id>/ssl/renew', methods=['POST'])
@jwt_required()
def renew_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if not domain.ssl_enabled:
        return jsonify({'error': 'SSL is not enabled for this domain'}), 400

    result = SSLService.renew_certificate(domain.name)

    if result['success']:
        return jsonify({
            'message': 'SSL certificate renewed',
            'domain': domain.to_dict()
        }), 200

    return jsonify({'error': result.get('error', 'Failed to renew certificate')}), 400


@domains_bp.route('/<int:domain_id>/verify', methods=['GET'])
@jwt_required()
def verify_domain(domain_id):
    """Verify domain DNS configuration."""
    import socket

    domain = Domain.query.get(domain_id)
    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    try:
        # Try to resolve the domain
        ip_address = socket.gethostbyname(domain.name)
        return jsonify({
            'verified': True,
            'domain': domain.name,
            'ip_address': ip_address
        }), 200
    except socket.gaierror:
        return jsonify({
            'verified': False,
            'domain': domain.name,
            'error': 'Domain could not be resolved'
        }), 200


@domains_bp.route('/nginx/sites', methods=['GET'])
@jwt_required()
@admin_required
def list_nginx_sites():
    """List all Nginx site configurations."""
    sites = NginxService.list_sites()
    return jsonify({'sites': sites}), 200


@domains_bp.route('/ssl/status', methods=['GET'])
@jwt_required()
@admin_required
def get_ssl_status():
    """Get overall SSL status."""
    is_installed = SSLService.is_certbot_installed()
    certificates = SSLService.list_certificates()

    return jsonify({
        'certbot_installed': is_installed,
        'total_certificates': len(certificates),
        'certificates': certificates
    }), 200
