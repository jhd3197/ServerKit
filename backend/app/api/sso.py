"""SSO / OAuth API blueprint."""
import logging
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session
from flask_jwt_extended import (
    create_access_token, jwt_required, get_jwt_identity
)
from app import db
from app.models import AuditLog
from app.models.oauth_identity import OAuthIdentity
from app.services import sso_service
from app.services.settings_service import SettingsService
from app.services.audit_service import AuditService
from app.middleware.rbac import admin_required, get_current_user
from app.middleware.session_auth import issue_session_tokens
from app.error_reporting import record_unexpected
from app.exceptions import NotFoundError
from app.api._request import json_object

logger = logging.getLogger(__name__)

sso_bp = Blueprint('sso', __name__)

VALID_PROVIDERS = ('google', 'github', 'oidc', 'saml')


# ------------------------------------------------------------------
# Public endpoints (login flow)
# ------------------------------------------------------------------

@sso_bp.route('/providers', methods=['GET'])
def list_providers():
    """List enabled SSO providers + whether password login is available."""
    return jsonify({
        'providers': sso_service.get_enabled_providers(),
        'password_login_enabled': sso_service.is_password_login_allowed(),
    }), 200


@sso_bp.route('/authorize/<provider>', methods=['GET'])
def authorize(provider):
    """Generate OAuth authorize URL (state + PKCE)."""
    if provider not in VALID_PROVIDERS or provider == 'saml':
        return jsonify({'error': f'Invalid OAuth provider: {provider}'}), 400

    redirect_uri = request.args.get('redirect_uri', '')
    if not redirect_uri:
        return jsonify({'error': 'redirect_uri is required'}), 400

    try:
        auth_url, state = sso_service.generate_auth_url(provider, redirect_uri)
        return jsonify({'auth_url': auth_url, 'state': state}), 200
    except Exception:
        logger.exception('SSO authorize failed for %s', provider)
        return jsonify({'error': 'Could not start single sign-on'}), 400


@sso_bp.route('/callback/<provider>', methods=['POST'])
def callback(provider):
    """Exchange authorization code for tokens, find/create user, return JWT."""
    if provider not in VALID_PROVIDERS or provider == 'saml':
        return jsonify({'error': f'Invalid OAuth provider: {provider}'}), 400

    data = json_object()
    code = data.get('code', '')
    state = data.get('state', '')
    redirect_uri = data.get('redirect_uri', '')

    if not code or not state:
        return jsonify({'error': 'code and state are required'}), 400

    try:
        profile = sso_service.handle_oauth_callback(provider, code, state, redirect_uri)
        user, is_new = sso_service.find_or_create_user(provider, profile)
    except ValueError as e:
        AuditService.log(
            action=AuditLog.ACTION_SSO_LOGIN_FAILED,
            details={'provider': provider, 'error': str(e)},
        )
        return jsonify({'error': str(e)}), 403
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        AuditService.log(
            action=AuditLog.ACTION_SSO_LOGIN_FAILED,
            details={'provider': provider, 'error': str(exc)},
        )
        record_unexpected(exc)
        return jsonify({'error': 'SSO authentication failed'}), 500

    return _complete_sso_login(user, provider, is_new)


@sso_bp.route('/saml/callback', methods=['POST'])
def saml_callback():
    """SAML ACS endpoint (form POST from IdP)."""
    try:
        request_data = {
            'https': request.scheme == 'https',
            'http_host': request.host,
            'script_name': request.path,
            'acs_url': request.url,
            'sp_entity_id': request.host_url.rstrip('/'),
        }
        profile = sso_service.handle_saml_callback(request.form, request_data)
        user, is_new = sso_service.find_or_create_user('saml', profile)
    except ValueError as e:
        return jsonify({'error': str(e)}), 403
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        record_unexpected(exc)
        return jsonify({'error': 'SAML authentication failed'}), 500

    return _complete_sso_login(user, 'saml', is_new)


@sso_bp.route('/saml/metadata', methods=['GET'])
def saml_metadata():
    """Return SP metadata XML."""
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    from onelogin.saml2.errors import OneLogin_Saml2_Error
    cfg = sso_service.get_provider_config('saml')
    request_data = {
        'https': request.scheme == 'https',
        'http_host': request.host,
        'script_name': request.path,
        'acs_url': request.url_root.rstrip('/') + '/api/v1/sso/saml/callback',
        'sp_entity_id': request.host_url.rstrip('/'),
    }
    settings = sso_service.get_saml_settings(cfg, request_data)
    saml_req = {
        'https': 'on' if request_data.get('https') else 'off',
        'http_host': request_data.get('http_host', ''),
        'script_name': request_data.get('script_name', ''),
    }
    try:
        auth = OneLogin_Saml2_Auth(saml_req, settings)
    except OneLogin_Saml2_Error as exc:
        # An unconfigured IdP is not a crash: this route is public and gets
        # probed, and each hit used to land in the error log.
        raise NotFoundError('SAML is not configured',
                            code='sso.saml_not_configured') from exc
    metadata = auth.get_settings().get_sp_metadata()
    from flask import Response
    return Response(metadata, mimetype='application/xml')


# ------------------------------------------------------------------
# Authenticated endpoints (account linking)
# ------------------------------------------------------------------

@sso_bp.route('/identities', methods=['GET'])
@jwt_required()
def list_identities():
    """Current user's linked OAuth identities."""
    user_id = get_jwt_identity()
    identities = OAuthIdentity.query.filter_by(user_id=user_id).all()
    return jsonify({'identities': [i.to_dict() for i in identities]}), 200


@sso_bp.route('/link/<provider>', methods=['POST'])
@jwt_required()
def link_provider(provider):
    """Link an OAuth identity to the current user."""
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': f'Invalid provider: {provider}'}), 400

    user_id = get_jwt_identity()
    data = json_object()
    code = data.get('code', '')
    state = data.get('state', '')
    redirect_uri = data.get('redirect_uri', '')

    if not code or not state:
        return jsonify({'error': 'code and state are required'}), 400

    try:
        profile = sso_service.handle_oauth_callback(provider, code, state, redirect_uri)
    except Exception:
        logger.exception('SSO link callback failed for %s', provider)
        return jsonify({'error': 'Single sign-on failed'}), 400

    # Check if this identity is already linked to another user
    existing = OAuthIdentity.query.filter_by(
        provider=provider,
        provider_user_id=profile['provider_user_id'],
    ).first()
    if existing:
        if existing.user_id == user_id:
            return jsonify({'error': 'This identity is already linked to your account'}), 409
        return jsonify({'error': 'This identity is already linked to another account'}), 409

    identity = sso_service.link_identity(user_id, provider, profile, profile.get('_tokens', {}))
    return jsonify({'identity': identity.to_dict()}), 201


@sso_bp.route('/link/<provider>', methods=['DELETE'])
@jwt_required()
def unlink_provider(provider):
    """Unlink an OAuth identity."""
    if provider not in VALID_PROVIDERS:
        return jsonify({'error': f'Invalid provider: {provider}'}), 400

    user_id = get_jwt_identity()
    try:
        sso_service.unlink_identity(user_id, provider)
        return jsonify({'message': f'{provider} identity unlinked'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


# ------------------------------------------------------------------
# Admin endpoints (SSO configuration)
# ------------------------------------------------------------------

@sso_bp.route('/admin/config', methods=['GET'])
@admin_required
def get_sso_config():
    """All SSO settings (secrets redacted)."""
    user = get_current_user()

    config = {}
    for key in SettingsService.DEFAULT_SETTINGS:
        if not key.startswith('sso_'):
            continue
        val = SettingsService.get(key, SettingsService.DEFAULT_SETTINGS[key]['value'])
        # Redact secrets
        if 'secret' in key or 'cert' in key:
            if val and isinstance(val, str) and len(val) > 4:
                val = '****' + val[-4:]
        config[key] = val
    return jsonify({'config': config}), 200


@sso_bp.route('/admin/config/<provider>', methods=['PUT'])
@admin_required
def update_provider_config(provider):
    """Update a provider's SSO config."""
    user = get_current_user()

    if provider not in VALID_PROVIDERS:
        return jsonify({'error': f'Invalid provider: {provider}'}), 400

    data = json_object()
    prefix = f'sso_{provider}_'
    updated = []

    for key, value in data.items():
        full_key = f'{prefix}{key}'
        if full_key not in SettingsService.DEFAULT_SETTINGS:
            continue
        # Skip unchanged redacted secrets
        if ('secret' in key or 'cert' in key) and isinstance(value, str) and value.startswith('****'):
            continue
        SettingsService.set(full_key, value, user_id=user.id)
        updated.append(key)

    AuditService.log(
        action=AuditLog.ACTION_SETTINGS_UPDATE,
        user_id=user.id,
        details={'sso_provider': provider, 'updated_fields': updated},
    )
    return jsonify({'message': f'{provider} SSO config updated', 'updated': updated}), 200


@sso_bp.route('/admin/test/<provider>', methods=['POST'])
@admin_required
def test_provider(provider):
    """Test provider connectivity."""
    result = sso_service.test_provider_connectivity(provider)
    return jsonify(result), 200 if result['ok'] else 400


@sso_bp.route('/admin/general', methods=['PUT'])
@admin_required
def update_general_settings():
    """Update general SSO settings (auto_provision, force_sso, etc.)."""
    user = get_current_user()

    data = json_object()
    general_keys = ['sso_auto_provision', 'sso_default_role', 'sso_force_sso', 'sso_allowed_domains']
    updated = []

    for key in general_keys:
        if key in data:
            SettingsService.set(key, data[key], user_id=user.id)
            updated.append(key)

    AuditService.log(
        action=AuditLog.ACTION_SETTINGS_UPDATE,
        user_id=user.id,
        details={'sso_general': updated},
    )
    return jsonify({'message': 'SSO general settings updated', 'updated': updated}), 200


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------

def _complete_sso_login(user, provider, is_new):
    """Issue JWT or trigger 2FA for an SSO-authenticated user."""
    # Check 2FA
    if user.totp_enabled:
        temp_token = create_access_token(
            identity=user.id,
            additional_claims={'2fa_pending': True},
            expires_delta=timedelta(minutes=5),
        )
        return jsonify({
            'requires_2fa': True,
            'temp_token': temp_token,
            'message': 'Two-factor authentication required',
        }), 200

    user.last_login_at = datetime.utcnow()
    user.reset_failed_login()
    db.session.commit()

    AuditService.log_login(user.id, success=True, details={'provider': provider, 'is_new': is_new})
    db.session.commit()

    access_token, refresh_token = issue_session_tokens(user.id)

    return jsonify({
        'user': user.to_dict(),
        'access_token': access_token,
        'refresh_token': refresh_token,
        'is_new_user': is_new,
    }), 200
