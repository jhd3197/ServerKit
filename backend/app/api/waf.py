# Bucket: PER-APP. Reads are scoped to callers who can access the
# app (can_access_app); mutations + install stay admin-only.
"""Per-application WAF (ModSecurity v3 + OWASP CRS) API.

Routes are mounted at ``/api/v1/waf``. Reads require access to the target app;
mutations and install require an admin user (mirrors ``app/api/dns_zones.py``).
Service ``ValueError``s map to HTTP 400.
"""
import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.waf_service import WafService
from app.middleware.rbac import require_admin_user
from app.api._access import require_app
from app.api._request import json_object

logger = logging.getLogger(__name__)

waf_bp = Blueprint('waf', __name__)


@waf_bp.route('/applications/<int:app_id>/policy', methods=['GET'])
@jwt_required()
def get_policy(app_id):
    require_app(app_id, conceal=True)
    policy = WafService.get_or_create_policy(app_id)
    return jsonify(policy.to_dict())


@waf_bp.route('/applications/<int:app_id>/policy', methods=['PUT'])
@jwt_required()
def update_policy(app_id):
    require_admin_user()
    require_app(app_id, conceal=True)

    data = json_object()
    try:
        policy = WafService.set_policy(
            app_id,
            mode=data.get('mode'),
            paranoia_level=data.get('paranoia_level'),
            anomaly_threshold=data.get('anomaly_threshold'),
            disabled_rule_ids=data.get('disabled_rule_ids'),
        )
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    # Best-effort enforcement: never fail the policy write because nginx /
    # ModSecurity isn't present on the host.
    try:
        apply_result = WafService.apply(app_id)
    except Exception:  # pragma: no cover - defensive
        logger.exception('WAF apply failed for app %s', app_id)
        apply_result = {'success': False, 'error': 'Failed to apply WAF policy'}

    response = policy.to_dict()
    response['apply'] = apply_result
    return jsonify(response)


@waf_bp.route('/applications/<int:app_id>/apply', methods=['POST'])
@jwt_required()
def apply_policy(app_id):
    require_admin_user()
    require_app(app_id, conceal=True)
    result = WafService.apply(app_id)
    status = 200 if result.get('success') else 400
    return jsonify(result), status


@waf_bp.route('/applications/<int:app_id>/events', methods=['GET'])
@jwt_required()
def get_events(app_id):
    require_app(app_id, conceal=True)
    try:
        limit = int(request.args.get('limit', 50))
    except (TypeError, ValueError):
        limit = 50
    limit = max(1, min(500, limit))
    events = WafService.events(app_id, limit=limit)
    return jsonify({'events': events, 'count': len(events)})


@waf_bp.route('/status', methods=['GET'])
@jwt_required()
def status():
    return jsonify({'installed': WafService.modsecurity_installed()})


@waf_bp.route('/install', methods=['POST'])
@jwt_required()
def install():
    require_admin_user()
    result = WafService.install_modsecurity()
    status_code = 200 if result.get('success') else 400
    return jsonify(result), status_code
