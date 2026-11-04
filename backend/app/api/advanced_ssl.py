import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services.advanced_ssl_service import AdvancedSSLService
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog
from app.middleware.rbac import get_current_user
from app.api._request import json_object

logger = logging.getLogger(__name__)

advanced_ssl_bp = Blueprint('advanced_ssl', __name__)


@advanced_ssl_bp.route('/profiles', methods=['GET'])
@jwt_required()
def get_profiles():
    return jsonify({'profiles': AdvancedSSLService.get_ssl_profiles()})


@advanced_ssl_bp.route('/wildcard', methods=['POST'])
@jwt_required()
def issue_wildcard():
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = json_object()
    domain = data.get('domain')
    provider = data.get('dns_provider')
    creds = data.get('credentials', {})

    if not domain or not provider:
        return jsonify({'error': 'domain and dns_provider required'}), 400

    result = AdvancedSSLService.issue_wildcard_cert(domain, provider, creds)
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_CREATE, user_id=user.id,
        target_type='ssl_wildcard', target_id=0,
        details={'domain': domain, 'success': result.get('success')}
    )
    status = 200 if result.get('success') else 400
    return jsonify(result), status


@advanced_ssl_bp.route('/san', methods=['POST'])
@jwt_required()
def issue_san():
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = json_object()
    domains = data.get('domains', [])
    if not domains:
        return jsonify({'error': 'domains list required'}), 400

    try:
        result = AdvancedSSLService.issue_san_cert(domains)
        status = 200 if result.get('success') else 400
        return jsonify(result), status
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@advanced_ssl_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_cert():
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = json_object()
    domain = data.get('domain')
    cert = data.get('certificate')
    key = data.get('private_key')
    chain = data.get('chain')

    if not domain or not cert or not key:
        return jsonify({'error': 'domain, certificate, and private_key required'}), 400

    try:
        result = AdvancedSSLService.upload_custom_cert(domain, cert, key, chain)
        return jsonify(result), 201
    except Exception:
        logger.exception('Custom certificate upload failed')
        return jsonify({'error': 'Could not install the certificate'}), 400


@advanced_ssl_bp.route('/health/<domain>', methods=['GET'])
@jwt_required()
def cert_health(domain):
    result = AdvancedSSLService.get_cert_health(domain)
    return jsonify(result)


@advanced_ssl_bp.route('/expiry-alerts', methods=['GET'])
@jwt_required()
def expiry_alerts():
    days = request.args.get('days', 30, type=int)
    alerts = AdvancedSSLService.get_expiry_alerts(days)
    return jsonify({'alerts': alerts, 'threshold_days': days})
