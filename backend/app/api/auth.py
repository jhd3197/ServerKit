from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity,
    get_jwt
)
from app import db, limiter
from app.models import User, AuditLog
from app.services.settings_service import SettingsService
from app.services.audit_service import AuditService

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/setup-status', methods=['GET'])
def get_setup_status():
    """Check if initial setup is needed and if registration is enabled."""
    needs_setup = SettingsService.needs_setup()
    registration_enabled = SettingsService.is_registration_enabled()

    return jsonify({
        'needs_setup': needs_setup,
        'registration_enabled': registration_enabled
    }), 200


@auth_bp.route('/register', methods=['POST'])
@limiter.limit("3 per minute")
def register():
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Check if registration is allowed
    is_first_user = User.query.count() == 0
    if not is_first_user and not SettingsService.is_registration_enabled():
        return jsonify({'error': 'Registration is disabled'}), 403

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')

    if not all([email, username, password]):
        return jsonify({'error': 'Missing required fields'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409

    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    user = User(
        email=email,
        username=username,
        role=User.ROLE_ADMIN if is_first_user else User.ROLE_DEVELOPER
    )
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    # Mark setup as complete if this is the first user
    if is_first_user:
        SettingsService.complete_setup(user_id=user.id)

    # Log the user creation
    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_CREATE,
        user_id=user.id,
        target_user_id=user.id,
        details={'username': username, 'role': user.role, 'self_registration': True}
    )
    db.session.commit()

    access_token = create_access_token(identity=user.id)
    refresh_token = create_refresh_token(identity=user.id)

    return jsonify({
        'message': 'User registered successfully',
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token,
        'is_first_user': is_first_user
    }), 201


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    login_id = data.get('email')  # Can be email or username
    password = data.get('password')

    if not all([login_id, password]):
        return jsonify({'error': 'Missing email/username or password'}), 400

    # Try to find user by email or username
    user = User.query.filter(
        (User.email == login_id) | (User.username == login_id)
    ).first()

    # Check if account is locked
    if user and user.is_locked:
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60)
        return jsonify({
            'error': f'Account is locked. Try again in {remaining} minute(s).'
        }), 429

    if not user or not user.check_password(password):
        # Record failed login attempt
        if user:
            user.record_failed_login()
            AuditService.log_login(user.id, success=False, details={'reason': 'invalid_password'})
            db.session.commit()
        return jsonify({'error': 'Invalid username/email or password'}), 401

    if not user.is_active:
        AuditService.log_login(user.id, success=False, details={'reason': 'account_deactivated'})
        db.session.commit()
        return jsonify({'error': 'Account is deactivated'}), 403

    # Check if 2FA is enabled
    if user.totp_enabled:
        # Create a short-lived temporary token for 2FA verification
        # This token can only be used to complete 2FA, not to access resources
        temp_token = create_access_token(
            identity=user.id,
            additional_claims={'2fa_pending': True},
            expires_delta=False  # Use default (short) expiry
        )

        return jsonify({
            'requires_2fa': True,
            'temp_token': temp_token,
            'message': 'Two-factor authentication required'
        }), 200

    # No 2FA - proceed with normal login
    user.reset_failed_login()
    user.last_login_at = datetime.utcnow()
    db.session.commit()

    # Log successful login
    AuditService.log_login(user.id, success=True)
    db.session.commit()

    access_token = create_access_token(identity=user.id)
    refresh_token = create_refresh_token(identity=user.id)

    return jsonify({
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token
    }), 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user or not user.is_active:
        return jsonify({'error': 'Invalid user'}), 401

    access_token = create_access_token(identity=current_user_id)

    return jsonify({
        'access_token': access_token
    }), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({'user': user.to_dict()}), 200


@auth_bp.route('/me', methods=['PUT'])
@jwt_required()
def update_current_user():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json()

    if 'username' in data:
        existing = User.query.filter_by(username=data['username']).first()
        if existing and existing.id != user.id:
            return jsonify({'error': 'Username already taken'}), 409
        user.username = data['username']

    if 'email' in data:
        existing = User.query.filter_by(email=data['email']).first()
        if existing and existing.id != user.id:
            return jsonify({'error': 'Email already registered'}), 409
        user.email = data['email']

    if 'password' in data:
        if len(data['password']) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        user.set_password(data['password'])

    db.session.commit()

    return jsonify({'user': user.to_dict()}), 200
