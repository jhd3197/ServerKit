"""API Key management endpoints."""
from datetime import datetime
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.middleware.rbac import get_current_user
from app.middleware.api_scope_middleware import SCOPES, require_scope
from app.services.api_key_service import ApiKeyService
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog
from app.exceptions import not_found

api_keys_bp = Blueprint('api_keys', __name__)


@api_keys_bp.route('/scopes', methods=['GET'])
@jwt_required()
def list_scopes():
    """Return the canonical catalog of assignable API key scopes."""
    return jsonify({'scopes': SCOPES})


@api_keys_bp.route('/', methods=['GET'])
@jwt_required()
@require_scope('read')
def list_keys():
    """List the current user's API keys."""
    user = get_current_user()
    if not user or not user.is_developer:
        return jsonify({'error': 'Developer access required'}), 403

    keys = ApiKeyService.list_keys(user.id)
    return jsonify({'api_keys': [k.to_dict() for k in keys]})


@api_keys_bp.route('/', methods=['POST'])
@jwt_required()
def create_key():
    """Create a new API key."""
    user = get_current_user()
    if not user or not user.is_developer:
        return jsonify({'error': 'Developer access required'}), 403

    data = request.get_json() or {}
    name = data.get('name')
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    scopes = data.get('scopes')
    tier = data.get('tier', 'standard')
    expires_at = None
    if data.get('expires_at'):
        try:
            expires_at = datetime.fromisoformat(data['expires_at'].replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            return jsonify({'error': 'Invalid expires_at format'}), 400

    api_key, raw_key = ApiKeyService.create_key(
        user_id=user.id,
        name=name,
        scopes=scopes,
        tier=tier,
        expires_at=expires_at,
    )

    AuditService.log(
        AuditLog.ACTION_API_KEY_CREATE,
        user_id=user.id,
        target_type='api_key',
        target_id=api_key.id,
        details={'name': name, 'tier': tier}
    )

    result = api_key.to_dict()
    result['raw_key'] = raw_key  # Only exposed once at creation
    return jsonify(result), 201


@api_keys_bp.route('/<int:key_id>', methods=['GET'])
@jwt_required()
def get_key(key_id):
    """Get API key details."""
    user = get_current_user()
    if not user:
        raise not_found('user')

    api_key = ApiKeyService.get_key(key_id, user.id)
    if not api_key:
        return jsonify({'error': 'API key not found'}), 404

    return jsonify(api_key.to_dict())


@api_keys_bp.route('/<int:key_id>', methods=['PUT'])
@jwt_required()
def update_key(key_id):
    """Update API key metadata."""
    # Same bar as create_key: a viewer (e.g. demoted after key creation) must
    # not widen an existing key's scopes/tier.
    user = get_current_user()
    if not user or not user.is_developer:
        return jsonify({'error': 'Developer access required'}), 403

    data = request.get_json() or {}
    api_key = ApiKeyService.update_key(
        key_id=key_id,
        user_id=user.id,
        name=data.get('name'),
        scopes=data.get('scopes'),
        tier=data.get('tier'),
    )
    if not api_key:
        return jsonify({'error': 'API key not found'}), 404

    return jsonify(api_key.to_dict())


@api_keys_bp.route('/<int:key_id>', methods=['DELETE'])
@jwt_required()
def revoke_key(key_id):
    """Revoke an API key."""
    user = get_current_user()
    if not user:
        raise not_found('user')

    api_key = ApiKeyService.revoke_key(key_id, user.id)
    if not api_key:
        return jsonify({'error': 'API key not found'}), 404

    AuditService.log(
        AuditLog.ACTION_API_KEY_REVOKE,
        user_id=user.id,
        target_type='api_key',
        target_id=key_id,
        details={'name': api_key.name}
    )

    return jsonify({'message': 'API key revoked'})


@api_keys_bp.route('/<int:key_id>/rotate', methods=['POST'])
@jwt_required()
def rotate_key(key_id):
    """Rotate an API key (revoke + recreate with same config)."""
    user = get_current_user()
    if not user:
        raise not_found('user')

    new_key, raw_key = ApiKeyService.rotate_key(key_id, user.id)
    if not new_key:
        return jsonify({'error': 'API key not found'}), 404

    AuditService.log(
        AuditLog.ACTION_API_KEY_ROTATE,
        user_id=user.id,
        target_type='api_key',
        target_id=new_key.id,
        details={'old_key_id': key_id, 'name': new_key.name}
    )

    result = new_key.to_dict()
    result['raw_key'] = raw_key
    return jsonify(result)
