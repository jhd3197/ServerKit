from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Domain, Application, User

domains_bp = Blueprint('domains', __name__)


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

    # TODO: Actually request Let's Encrypt certificate
    domain.ssl_enabled = True
    db.session.commit()

    return jsonify({
        'message': 'SSL enabled for domain',
        'domain': domain.to_dict()
    }), 200
