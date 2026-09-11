import logging
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, g
from sqlalchemy import func
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity,
    get_jwt
)
from app import db, limiter
from app.models import User, AuditLog, SystemSettings
# Aliased: this module already has a `get_current_user` route handler.
from app.middleware.rbac import admin_required, get_current_user as get_request_user, require_admin_user
from app.middleware.session_auth import session_required, issue_session_tokens
from app.services.settings_service import SettingsService
from app.services.audit_service import AuditService
from app.services import login_link_service
from app.services import auth_throttle_service
from app.utils.client_ip import get_client_ip
from app.utils.i18n import normalize_language
from app.exceptions import AuthenticationError, ConflictError, PermissionDeniedError, ValidationError

logger = logging.getLogger(__name__)

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/setup-status', methods=['GET'])
def get_setup_status():
    """Check if initial setup is needed and if registration is enabled."""
    needs_setup = SettingsService.needs_setup()
    registration_enabled = SettingsService.is_registration_enabled()

    # SSO info for login page
    from app.services import sso_service
    sso_providers = sso_service.get_enabled_providers()
    password_login_enabled = sso_service.is_password_login_allowed()

    # Migration status
    from app.services.migration_service import MigrationService
    migration_status = MigrationService.get_status()

    return jsonify({
        'needs_setup': needs_setup,
        'registration_enabled': registration_enabled,
        'sso_providers': sso_providers,
        'password_login_enabled': password_login_enabled,
        # Pre-auth branding (read by the login page before any authed call).
        'panel_title': SettingsService.get('panel_title', 'ServerKit'),
        'public_title': SettingsService.get('public_title', 'Control Panel'),
        'login_layout': SettingsService.get('login_layout', 'centered'),
        # Panel-default UI language for the sign-in/setup screens, which render
        # before any authenticated call can report the user's own choice.
        'default_language': SettingsService.get('default_language', 'en'),
        'needs_migration': migration_status['needs_migration'],
        'migration_info': {
            'pending_count': migration_status['pending_count'],
            'current_revision': migration_status['current_revision'],
            'head_revision': migration_status['head_revision'],
        },
    }), 200


@auth_bp.route('/register', methods=['POST'])
@limiter.limit("3 per minute")
def register():
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    invite_token = data.get('invite_token')
    invitation = None

    # Validate invitation if provided
    if invite_token:
        from app.services.invitation_service import InvitationService
        invitation = InvitationService.validate_token(invite_token)
        if not invitation:
            raise ValidationError('Invalid or expired invitation', code='auth.invitation_invalid')

    # Check if registration is allowed
    is_first_user = User.query.count() == 0
    if not is_first_user and not invitation:
        if not SettingsService.needs_setup() and not SettingsService.is_registration_enabled():
            logger.warning(f"Registration attempt blocked - setup already completed. IP: {request.remote_addr}")
            raise PermissionDeniedError('Registration is disabled', code='auth.registration_disabled')
        if not SettingsService.is_registration_enabled():
            raise PermissionDeniedError('Registration is disabled', code='auth.registration_disabled')

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')

    if not all([email, username, password]):
        raise ValidationError('Missing required fields', code='auth.missing_fields')

    if User.query.filter(func.lower(User.email) == func.lower(email)).first():
        raise ConflictError('This email or username is unavailable', code='auth.identity_unavailable')

    if User.query.filter_by(username=username).first():
        raise ConflictError('This email or username is unavailable', code='auth.identity_unavailable')

    if len(password) < 8:
        raise ValidationError('Password must be at least 8 characters', code='auth.password_too_short')

    # Determine role and permissions from invitation or defaults
    if is_first_user:
        role = User.ROLE_ADMIN
    elif invitation:
        role = invitation.role
    else:
        role = User.ROLE_DEVELOPER

    user = User(
        email=email,
        username=username,
        role=role
    )
    user.set_password(password)

    # Apply custom permissions from invitation
    if invitation and invitation.get_permissions():
        user.set_permissions(invitation.get_permissions())

    db.session.add(user)
    db.session.commit()

    # Mark invitation accepted
    if invitation:
        from app.services.invitation_service import InvitationService
        InvitationService.accept_invitation(invite_token, user.id)

        AuditService.log(
            action=AuditLog.ACTION_INVITATION_ACCEPT,
            user_id=user.id,
            target_type='invitation',
            target_id=invitation.id,
            details={'role': role}
        )

    # Log the user creation
    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_CREATE,
        user_id=user.id,
        target_user_id=user.id,
        details={
            'username': username,
            'role': user.role,
            'self_registration': True,
            'via_invitation': invitation is not None
        }
    )
    db.session.commit()

    access_token, refresh_token = issue_session_tokens(user.id)

    return jsonify({
        'message': 'User registered successfully',
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token,
        'is_first_user': is_first_user
    }), 201


ALLOWED_USE_CASES = {'wordpress', 'web-apps', 'self-hosted', 'devops'}


@auth_bp.route('/complete-onboarding', methods=['POST'])
@jwt_required()
def complete_onboarding():
    """Complete the onboarding wizard and mark setup as done."""
    user = require_admin_user()

    data = request.get_json() or {}
    use_cases = data.get('use_cases', [])

    # Validate use_cases
    if not isinstance(use_cases, list):
        return jsonify({'error': 'use_cases must be a list'}), 400

    invalid = set(use_cases) - ALLOWED_USE_CASES
    if invalid:
        return jsonify({'error': f'Invalid use cases: {", ".join(invalid)}'}), 400

    # Slugs the wizard installed (recorded for Setup Health / support). The
    # actual installs happen client-side via the plugin install endpoints; this
    # just persists what onboarding did (plan 47).
    installed_extensions = data.get('installed_extensions', [])
    if not isinstance(installed_extensions, list):
        return jsonify({'error': 'installed_extensions must be a list'}), 400
    installed_extensions = [
        s for s in installed_extensions if isinstance(s, str) and s.strip()
    ]

    # Security posture (plan 47 Ph5) — persisted separately from use_cases so
    # posture and purpose stay orthogonal. Absent/invalid falls back to the
    # lean default rather than failing the whole onboarding.
    security_posture = data.get('security_posture', 'minimal')
    from app.services.plugin_service import SECURITY_POSTURE_LEVELS
    if security_posture not in SECURITY_POSTURE_LEVELS:
        security_posture = 'minimal'

    # Save onboarding use cases + what the wizard installed
    SettingsService.set('onboarding_use_cases', use_cases, user_id=user.id)
    SettingsService.set('onboarding_installed_extensions', installed_extensions,
                        user_id=user.id)
    SettingsService.set('onboarding_security_posture', security_posture,
                        user_id=user.id)

    # Keep the panel lean: suppress wizard-optional flagships (WordPress) the
    # user didn't install so the boot seeder won't re-add them (plan 47).
    try:
        from app.services import plugin_service
        plugin_service.finalize_setup_flagships()
    except Exception:
        pass

    # Mark setup as complete
    SettingsService.complete_setup(user_id=user.id)

    return jsonify({'message': 'Onboarding completed successfully'}), 200


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    # Check if password login is disabled (SSO-only mode)
    from app.services import sso_service
    if not sso_service.is_password_login_allowed():
        raise PermissionDeniedError('Password login is disabled. Please use SSO.', code='auth.password_login_disabled')

    # Per-IP brute-force throttle — checked up front, before any password work,
    # so spraying wrong passwords across many usernames from one IP is blocked.
    client_ip = get_client_ip()
    blocked, retry_after = auth_throttle_service.is_blocked(client_ip)
    if blocked:
        return jsonify({
            'error': 'Too many failed login attempts. Try again later.'
        }), 429, {'Retry-After': str(retry_after)}

    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    login_id = data.get('email')  # Can be email or username
    password = data.get('password')

    if not all([login_id, password]):
        raise ValidationError('Missing email/username or password', code='auth.missing_credentials')

    # Try to find user by email (case-insensitive) or username
    user = User.query.filter(
        (func.lower(User.email) == func.lower(login_id)) | (User.username == login_id)
    ).first()

    # Check if account is locked
    if user and user.is_locked:
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds() / 60)
        return jsonify({
            'error': f'Account is locked. Try again in {remaining} minute(s).'
        }), 429

    if not user or not user.check_password(password):
        # Record the failure against BOTH throttles: per-user (targeted guessing)
        # and per-IP (spraying across accounts). Per-IP counts even bad usernames.
        auth_throttle_service.register_failure(client_ip)
        if user:
            user.record_failed_login()
            AuditService.log_login(user.id, success=False, details={'reason': 'invalid_password'})
            db.session.commit()
        raise AuthenticationError('Invalid username/email or password', code='auth.invalid_credentials')

    # Correct password — clear this IP's failure count (covers the 2FA-pending
    # and no-2FA paths below).
    auth_throttle_service.reset(client_ip)

    if not user.is_active:
        AuditService.log_login(user.id, success=False, details={'reason': 'account_deactivated'})
        db.session.commit()
        raise PermissionDeniedError('Account is deactivated', code='auth.account_deactivated')

    # Check if 2FA is enabled
    if user.totp_enabled:
        # Create a short-lived temporary token for 2FA verification
        # This token can only be used to complete 2FA, not to access resources
        temp_token = create_access_token(
            identity=user.id,
            additional_claims={'2fa_pending': True},
            expires_delta=timedelta(minutes=5)
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

    access_token, refresh_token = issue_session_tokens(user.id)

    return jsonify({
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token
    }), 200


# ==========================================
# ONE-TIME LOGIN LINKS
# ==========================================
@auth_bp.route('/login-links', methods=['POST'])
@session_required
def create_login_link():
    """Mint a single-use login URL. The raw token is returned exactly once."""
    current = require_admin_user()
    data = request.get_json() or {}

    target_id = data.get('user_id') or current.id
    target = User.query.get(target_id)
    if not target:
        return jsonify({'error': 'User not found'}), 404

    bound_ip = (data.get('bound_ip') or '').strip() or None
    if bound_ip and len(bound_ip) > 64:
        return jsonify({'error': 'Invalid IP address'}), 400

    token, link = login_link_service.mint(
        user_id=target.id,
        ttl_minutes=data.get('ttl_minutes'),
        bound_ip=bound_ip,
        created_by=current.id,
    )

    AuditService.log(
        action='login_link.create',
        user_id=current.id,
        target_type='user',
        target_id=target.id,
        details={'link_id': link.id, 'expires_at': link.expires_at.isoformat(),
                 'ip_bound': bound_ip is not None},
    )
    db.session.commit()

    return jsonify({
        'url': f'/login?link={token}',
        'token': token,
        'expires_at': link.expires_at.isoformat(),
        'link': link.to_dict(),
    }), 201


@auth_bp.route('/login-links', methods=['GET'])
@admin_required
def list_login_links():
    """List active (unused, unexpired) login links. Hashes are never exposed."""
    links = login_link_service.list_active()
    return jsonify({'links': [l.to_dict() for l in links]}), 200


@auth_bp.route('/login-links/<int:link_id>', methods=['DELETE'])
@admin_required
def revoke_login_link(link_id):
    from app.models.login_link import LoginLink
    link = LoginLink.query.get(link_id)
    if not link:
        return jsonify({'error': 'Link not found'}), 404

    current = get_request_user()
    AuditService.log(
        action='login_link.revoke',
        user_id=current.id,
        target_type='user',
        target_id=link.user_id,
        details={'link_id': link.id},
    )
    db.session.delete(link)
    db.session.commit()
    return jsonify({'message': 'Login link revoked'}), 200


@auth_bp.route('/login-links/redeem', methods=['POST'])
@limiter.limit("30 per minute")
def redeem_login_link():
    """Redeem a one-time login link and issue normal JWT tokens."""
    client_ip = get_client_ip()
    blocked, retry_after = auth_throttle_service.is_blocked(client_ip)
    if blocked:
        return jsonify({
            'error': 'Too many failed attempts. Try again later.'
        }), 429, {'Retry-After': str(retry_after)}

    data = request.get_json() or {}
    token = data.get('token')

    user, reason = login_link_service.redeem(token, client_ip)
    if not user:
        auth_throttle_service.register_failure(client_ip)
        logger.info(f"Login link redeem failed ({reason}) from {client_ip}")
        raise AuthenticationError('Invalid or expired link', code='auth.link_invalid')

    auth_throttle_service.reset(client_ip)
    if user.totp_enabled:
        return jsonify({
            'requires_2fa': True,
            'temp_token': create_access_token(
                identity=user.id, additional_claims={'2fa_pending': True},
                expires_delta=timedelta(minutes=5)),
            'message': 'Two-factor authentication required',
        }), 200
    user.reset_failed_login()
    user.last_login_at = datetime.utcnow()
    db.session.commit()

    AuditService.log_login(user.id, success=True, details={'method': 'login_link'})
    db.session.commit()

    access_token, refresh_token = issue_session_tokens(user.id)

    return jsonify({
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token
    }), 200


# ==========================================
# DEMO MODE
# ==========================================
@auth_bp.route('/demo-info', methods=['GET'])
def demo_info():
    """Public demo-mode info for the login page.

    Only when demo mode is active: ensures the seeded read-only ``demo``
    user exists (stable random password stored in settings) and returns
    its credentials. Otherwise reveals nothing.
    """
    from app.middleware.demo import is_demo_mode_active

    if not is_demo_mode_active():
        return jsonify({'enabled': False}), 200

    import secrets as _secrets

    password = SettingsService.get('demo_password')
    user = User.query.filter_by(username='demo').first()

    if not password:
        password = _secrets.token_urlsafe(12)
        SettingsService.set('demo_password', password)

    if not user:
        user = User(
            email='demo@demo.local',
            username='demo',
            role=User.ROLE_VIEWER,
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
    elif not user.check_password(password):
        # Keep the stored credential authoritative (e.g. rotated setting).
        user.set_password(password)
        db.session.commit()

    return jsonify({'enabled': True, 'username': 'demo', 'password': password}), 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user or not user.is_active:
        return jsonify({'error': 'Invalid user'}), 401

    access_token = create_access_token(
        identity=current_user_id,
        additional_claims={'auth_time': get_jwt().get('auth_time', 0),
                           'session_id': get_jwt()['session_id']})

    return jsonify({
        'access_token': access_token
    }), 200


@auth_bp.route('/logout', methods=['POST'])
@session_required
def logout():
    """Revoke this browser's access and refresh session, across workers."""
    from app.models import RevokedSession
    db.session.add(RevokedSession(session_id=get_jwt()['session_id'],
                                  user_id=g.session_user.id))
    db.session.commit()
    return jsonify({'message': 'Browser session signed out'}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({'user': user.to_dict()}), 200


def _is_preference_only_update():
    """True when PUT /me carries no credential change.

    The 3/minute limit on this route exists for username/email/password edits.
    Cosmetic preferences (sidebar layout, language) go through the same route
    and would otherwise burn that budget: switching language three times in a
    minute returns 429, and since the client applies the change locally either
    way, the preference silently fails to persist and reverts on the next
    sign-in elsewhere. Credential changes stay throttled; the app-wide
    100/minute default still covers everything else.
    """
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or not data:
        return False
    return not ({'username', 'email', 'password'} & set(data.keys()))


@auth_bp.route('/me', methods=['PUT'])
@limiter.limit("3 per minute", exempt_when=_is_preference_only_update)
@jwt_required()
def update_current_user():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if not user:
        return jsonify({'error': 'User not found'}), 404

    data = request.get_json() or {}

    if 'password' in data:
        import time
        if not isinstance(data['password'], str) or len(data['password']) < 8:
            raise ValidationError('Password must be at least 8 characters')
        if user.has_password:
            current_password = data.get('current_password')
            if (not isinstance(current_password, str)
                    or not user.check_password(current_password)):
                raise PermissionDeniedError('Current password is required and must be correct')
        else:
            # SSO/passkey users without a local password must have completed a
            # fresh sign-in. Refresh preserves auth_time and cannot renew it.
            auth_time = get_jwt().get('auth_time', 0)
            if not isinstance(auth_time, (int, float)) or time.time() - auth_time > 300:
                raise PermissionDeniedError('Sign in again before setting a password')

    if 'username' in data:
        existing = User.query.filter_by(username=data['username']).first()
        if existing and existing.id != user.id:
            raise ConflictError('Username already taken', code='auth.username_taken')
        user.username = data['username']

    if 'email' in data:
        existing = User.query.filter(
            func.lower(User.email) == func.lower(data['email'])
        ).first()
        if existing and existing.id != user.id:
            raise ConflictError('Email already registered', code='auth.email_registered')
        user.email = data['email']

    if 'password' in data:
        user.set_password(data['password'])

    if 'sidebar_config' in data:
        config = data['sidebar_config']
        if isinstance(config, dict):
            preset = config.get('preset', 'full')
            valid_presets = ['recommended', 'full', 'web', 'email', 'devops', 'minimal', 'custom']
            if preset not in valid_presets:
                return jsonify({'error': f'Invalid sidebar preset: {preset}'}), 400
            hidden = config.get('hiddenItems', [])
            if not isinstance(hidden, list):
                return jsonify({'error': 'hiddenItems must be a list'}), 400
            user.set_sidebar_config({'preset': preset, 'hiddenItems': hidden})

    if 'language' in data:
        raw = data['language']
        if raw in (None, ''):
            # Explicitly clearing the preference: fall back to the panel default.
            user.language = None
        else:
            language = normalize_language(raw)
            if not language:
                raise ValidationError(f'Unsupported language: {raw}', code='auth.unsupported_language')
            user.language = language

    db.session.commit()

    response = {'user': user.to_dict()}
    if 'password' in data:
        # Keep this freshly authenticated browser signed in; every prior
        # access/refresh token (including its old pair) has been revoked.
        access_token, refresh_token = issue_session_tokens(user.id)
        response.update(access_token=access_token, refresh_token=refresh_token)
    return jsonify(response), 200


# ==========================================
# PASSKEY / WEBAUTHN
# ==========================================
@auth_bp.route('/passkeys/options/register', methods=['POST'])
@jwt_required()
def passkey_register_options():
    """Begin WebAuthn registration for the current user."""
    from app.services.passkey_service import PasskeyService
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    options = PasskeyService.begin_registration(user)
    return jsonify(options), 200


@auth_bp.route('/passkeys/register', methods=['POST'])
@jwt_required()
def passkey_register():
    """Verify and save a new WebAuthn credential."""
    from app.services.passkey_service import PasskeyService
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    data = request.get_json() or {}
    credential = data.get('credential')
    device_name = data.get('device_name', 'Passkey')
    if not credential:
        return jsonify({'error': 'No credential provided'}), 400
    result = PasskeyService.verify_registration(user, credential, device_name)
    return jsonify(result), 200 if result['success'] else 400


@auth_bp.route('/passkeys', methods=['GET'])
@jwt_required()
def passkey_list():
    """List the current user's passkeys."""
    from app.services.passkey_service import PasskeyService
    user_id = get_jwt_identity()
    return jsonify({'passkeys': PasskeyService.get_user_passkeys(user_id)}), 200


@auth_bp.route('/passkeys/<int:passkey_id>', methods=['DELETE'])
@jwt_required()
def passkey_delete(passkey_id):
    """Remove a passkey."""
    from app.services.passkey_service import PasskeyService
    user_id = get_jwt_identity()
    result = PasskeyService.remove_passkey(user_id, passkey_id)
    return jsonify(result), 200 if result['success'] else 404


@auth_bp.route('/passkeys/options/authenticate', methods=['POST'])
def passkey_auth_options():
    """Begin WebAuthn authentication (public, challenge only)."""
    from app.services.passkey_service import PasskeyService
    data = request.get_json() or {}
    user_id = data.get('user_id')
    user = User.query.get(user_id) if user_id else None
    options = PasskeyService.begin_authentication(user)
    return jsonify(options), 200


@auth_bp.route('/passkeys/authenticate', methods=['POST'])
@limiter.limit("5 per minute")
def passkey_authenticate():
    """Verify a WebAuthn assertion and issue JWT tokens."""
    from app.services.passkey_service import PasskeyService
    from app.services import sso_service
    data = request.get_json() or {}
    credential = data.get('credential')
    user_id = data.get('user_id')
    if not credential:
        return jsonify({'error': 'No credential provided'}), 400

    user = User.query.get(user_id) if user_id else None
    result = PasskeyService.verify_authentication(credential, user)
    if not result['success']:
        return jsonify(result), 401

    user = result['user']
    if not user.is_active:
        return jsonify({'error': 'Account is deactivated'}), 403

    user.reset_failed_login()
    user.last_login_at = datetime.utcnow()
    db.session.commit()

    AuditService.log_login(user.id, success=True, details={'method': 'passkey'})
    db.session.commit()

    access_token, refresh_token = issue_session_tokens(user.id)

    return jsonify({
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token
    }), 200
