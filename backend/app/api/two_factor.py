"""
Two-Factor Authentication API

Provides endpoints for enabling, disabling, and managing 2FA.
"""

import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import limiter
from app.middleware.session_auth import issue_session_tokens
from app.models import User
from app.services.totp_service import TOTPService, TwoFactorSetup
from app.services import auth_throttle_service
from app.utils.client_ip import get_client_ip
from app.exceptions import not_found

logger = logging.getLogger(__name__)

two_factor_bp = Blueprint('two_factor', __name__)


@two_factor_bp.route('/status', methods=['GET'])
@jwt_required()
def get_2fa_status():
    """Get the current 2FA status for the user."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        raise not_found('user')

    setup = TwoFactorSetup(user)

    return jsonify({
        'enabled': user.totp_enabled,
        'confirmed_at': user.totp_confirmed_at.isoformat() if user.totp_confirmed_at else None,
        'backup_codes_remaining': setup.get_remaining_backup_codes_count() if user.totp_enabled else 0
    }), 200


@two_factor_bp.route('/setup', methods=['POST'])
@jwt_required()
def initiate_2fa_setup():
    """
    Initiate 2FA setup. Generates a new secret and returns QR code.
    User must verify with a code to complete setup.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        raise not_found('user')

    if user.totp_enabled:
        return jsonify({'error': '2FA is already enabled'}), 400

    setup = TwoFactorSetup(user)
    setup_data = setup.initiate_setup()

    return jsonify({
        'message': '2FA setup initiated. Scan the QR code and enter a verification code.',
        'secret': setup_data['secret'],
        'qr_code': setup_data['qr_code'],
        'uri': setup_data['uri'],
        'issuer': setup_data['issuer']
    }), 200


@two_factor_bp.route('/setup/confirm', methods=['POST'])
@jwt_required()
def confirm_2fa_setup():
    """
    Confirm 2FA setup by verifying a code.
    Returns backup codes on success (one-time display).
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        raise not_found('user')

    if user.totp_enabled:
        return jsonify({'error': '2FA is already enabled'}), 400

    data = request.get_json()
    if not data or 'code' not in data:
        return jsonify({'error': 'Verification code is required'}), 400

    setup = TwoFactorSetup(user)
    success, result = setup.confirm_setup(data['code'])

    if not success:
        return jsonify({'error': result}), 400

    return jsonify({
        'message': '2FA has been enabled successfully',
        'backup_codes': result,  # One-time display
        'backup_codes_warning': 'Save these backup codes in a secure location. They will not be shown again.'
    }), 200


@two_factor_bp.route('/disable', methods=['POST'])
@jwt_required()
def disable_2fa():
    """
    Disable 2FA. Requires a valid TOTP code or backup code.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        raise not_found('user')

    if not user.totp_enabled:
        return jsonify({'error': '2FA is not enabled'}), 400

    data = request.get_json()
    if not data or 'code' not in data:
        return jsonify({'error': 'Verification code is required'}), 400

    setup = TwoFactorSetup(user)
    success, error = setup.disable(data['code'])

    if not success:
        return jsonify({'error': error}), 400

    logger.info(f"2FA disabled for user {user.id} - existing sessions remain valid (TODO: implement session invalidation)")

    return jsonify({
        'message': '2FA has been disabled successfully'
    }), 200


@two_factor_bp.route('/backup-codes/regenerate', methods=['POST'])
@jwt_required()
def regenerate_backup_codes():
    """
    Regenerate backup codes. Requires a valid TOTP code.
    Old backup codes become invalid.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        raise not_found('user')

    if not user.totp_enabled:
        return jsonify({'error': '2FA is not enabled'}), 400

    data = request.get_json()
    if not data or 'code' not in data:
        return jsonify({'error': 'TOTP code is required'}), 400

    setup = TwoFactorSetup(user)
    success, result = setup.regenerate_backup_codes(data['code'])

    if not success:
        return jsonify({'error': result}), 400

    return jsonify({
        'message': 'Backup codes have been regenerated',
        'backup_codes': result,
        'backup_codes_warning': 'Save these backup codes in a secure location. They will not be shown again.'
    }), 200


@two_factor_bp.route('/verify', methods=['POST'])
@limiter.limit("5 per minute")
def verify_2fa_code():
    """
    Verify a 2FA code during login.
    This endpoint is used when login returns requires_2fa=true.
    Expects a temporary token from the login response.
    """
    from flask_jwt_extended import decode_token
    from app import db

    # Per-IP brute-force throttle — 2FA codes are a small keyspace, so guessing
    # from one IP is throttled up front, before any code check.
    client_ip = get_client_ip()
    blocked, retry_after = auth_throttle_service.is_blocked(client_ip)
    if blocked:
        return jsonify({
            'error': 'Too many failed attempts. Try again later.'
        }), 429, {'Retry-After': str(retry_after)}

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    temp_token = data.get('temp_token')
    code = data.get('code')

    if not temp_token or not code:
        return jsonify({'error': 'Temporary token and code are required'}), 400

    # Decode the temporary token to get user ID
    try:
        token_data = decode_token(temp_token)
        user_id = token_data['sub']

        # Check if this is a 2FA pending token
        if not token_data.get('2fa_pending'):
            return jsonify({'error': 'Invalid token type'}), 400

    except Exception as e:
        return jsonify({'error': 'Invalid or expired token'}), 401

    from app.middleware.session_auth import validate_session_claims
    user = validate_session_claims(token_data, allow_pending=True)
    if not user:
        return jsonify({'error': 'Invalid or expired token'}), 401

    if not user.totp_enabled:
        return jsonify({'error': '2FA is not enabled for this account'}), 400

    # Try TOTP code first
    if TOTPService.verify_code(user.totp_secret, code):
        # Success - issue real tokens
        auth_throttle_service.reset(client_ip)
        user.reset_failed_login()
        db.session.commit()

        access_token, refresh_token = issue_session_tokens(user.id)

        return jsonify({
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 200

    # Try backup code
    backup_codes = user.get_backup_codes()
    matched_hash = TOTPService.verify_backup_code(code, backup_codes)

    if matched_hash:
        # Valid backup code - remove it (one-time use)
        auth_throttle_service.reset(client_ip)
        user.use_backup_code(matched_hash)
        user.reset_failed_login()
        db.session.commit()

        access_token, refresh_token = issue_session_tokens(user.id)

        # Warn about remaining backup codes
        remaining = len(user.get_backup_codes())

        return jsonify({
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token,
            'backup_code_used': True,
            'backup_codes_remaining': remaining,
            'warning': f'Backup code used. {remaining} codes remaining.' if remaining <= 3 else None
        }), 200

    # Invalid code
    auth_throttle_service.register_failure(client_ip)
    user.record_failed_login()
    db.session.commit()

    return jsonify({'error': 'Invalid verification code'}), 401
