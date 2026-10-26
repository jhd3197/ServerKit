"""SSO / OAuth 2.0 / SAML service — handles external identity authentication."""
import hashlib
import logging
import secrets
from datetime import datetime

from authlib.integrations.requests_client import OAuth2Session
from cryptography.fernet import Fernet
from flask import current_app, session
import base64
import requests as http_requests

from sqlalchemy import func
from app import db
from app.models import User, AuditLog
from app.models.oauth_identity import OAuthIdentity
from app.services.settings_service import SettingsService

logger = logging.getLogger(__name__)

# Built-in provider endpoint configs
PROVIDER_ENDPOINTS = {
    'google': {
        'authorize_url': 'https://accounts.google.com/o/oauth2/v2/auth',
        'token_url': 'https://oauth2.googleapis.com/token',
        'userinfo_url': 'https://openidconnect.googleapis.com/v1/userinfo',
        'scopes': ['openid', 'email', 'profile'],
    },
    'github': {
        'authorize_url': 'https://github.com/login/oauth/authorize',
        'token_url': 'https://github.com/login/oauth/access_token',
        'userinfo_url': 'https://api.github.com/user',
        'emails_url': 'https://api.github.com/user/emails',
        'scopes': ['read:user', 'user:email'],
    },
}


def _legacy_fernet():
    """The pre-C2 Fernet (key derived from app SECRET_KEY) — read-only,
    kept so tokens written before the fold-in still decrypt."""
    key_bytes = current_app.config['SECRET_KEY'].encode('utf-8')
    digest = hashlib.sha256(key_bytes).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_token(token):
    """Encrypt via the ONE crypto path (utils/crypto)."""
    if not token:
        return None
    from app.utils.crypto import encrypt_secret
    return encrypt_secret(token)


def decrypt_token(encrypted):
    """Dual-read: the one path first, the legacy SECRET_KEY Fernet second."""
    if not encrypted:
        return None
    from app.utils.crypto import decrypt_secret
    try:
        return decrypt_secret(encrypted)
    except Exception:
        pass
    try:
        return _legacy_fernet().decrypt(encrypted.encode('utf-8')).decode('utf-8')
    except Exception:
        return None


def get_enabled_providers():
    """Return list of enabled SSO providers for the login page."""
    providers = []
    if SettingsService.get('sso_google_enabled', False):
        providers.append({'id': 'google', 'name': 'Google'})
    if SettingsService.get('sso_github_enabled', False):
        providers.append({'id': 'github', 'name': 'GitHub'})
    if SettingsService.get('sso_oidc_enabled', False):
        name = SettingsService.get('sso_oidc_provider_name', '') or 'OIDC'
        providers.append({'id': 'oidc', 'name': name})
    if SettingsService.get('sso_saml_enabled', False):
        providers.append({'id': 'saml', 'name': 'SAML'})
    return providers


def is_password_login_allowed():
    return not SettingsService.get('sso_force_sso', False)


def get_provider_config(provider):
    """Full config for a provider (internal use — includes secrets)."""
    prefix = f'sso_{provider}_'
    keys = [k for k in SettingsService.DEFAULT_SETTINGS if k.startswith(prefix)]
    cfg = {}
    for k in keys:
        short = k[len(prefix):]
        cfg[short] = SettingsService.get(k, SettingsService.DEFAULT_SETTINGS[k]['value'])
    return cfg


# ------------------------------------------------------------------
# OAuth flow helpers
# ------------------------------------------------------------------

def generate_auth_url(provider, redirect_uri):
    """Build the OAuth authorize URL with PKCE, return (auth_url, state)."""
    cfg = get_provider_config(provider)

    if provider in ('google', 'github'):
        endpoints = PROVIDER_ENDPOINTS[provider]
        authorize_url = endpoints['authorize_url']
        scopes = endpoints['scopes']
        client_id = cfg.get('client_id', '')
    elif provider == 'oidc':
        discovery = _fetch_oidc_discovery(cfg.get('discovery_url', ''))
        authorize_url = discovery.get('authorization_endpoint', '')
        scopes = ['openid', 'email', 'profile']
        client_id = cfg.get('client_id', '')
    else:
        raise ValueError(f'OAuth authorize not supported for {provider}')

    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode('ascii')).digest()
    ).rstrip(b'=').decode('ascii')

    # Store in server-side session
    session['sso_state'] = state
    session['sso_code_verifier'] = code_verifier
    session['sso_provider'] = provider

    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': ' '.join(scopes),
        'state': state,
        'code_challenge': code_challenge,
        'code_challenge_method': 'S256',
    }

    if provider == 'google':
        params['access_type'] = 'offline'
        params['prompt'] = 'select_account'

    qs = '&'.join(f'{k}={v}' for k, v in params.items())
    return f'{authorize_url}?{qs}', state


def handle_oauth_callback(provider, code, state, redirect_uri):
    """Exchange authorization code for tokens & fetch user profile."""
    # Validate state
    expected_state = session.pop('sso_state', None)
    code_verifier = session.pop('sso_code_verifier', None)
    if not expected_state or state != expected_state:
        raise ValueError('Invalid OAuth state — possible CSRF')

    cfg = get_provider_config(provider)

    if provider in ('google', 'github'):
        endpoints = PROVIDER_ENDPOINTS[provider]
        token_url = endpoints['token_url']
        userinfo_url = endpoints['userinfo_url']
        client_id = cfg.get('client_id', '')
        client_secret = cfg.get('client_secret', '')
    elif provider == 'oidc':
        discovery = _fetch_oidc_discovery(cfg.get('discovery_url', ''))
        token_url = discovery.get('token_endpoint', '')
        userinfo_url = discovery.get('userinfo_endpoint', '')
        client_id = cfg.get('client_id', '')
        client_secret = cfg.get('client_secret', '')
    else:
        raise ValueError(f'OAuth callback not supported for {provider}')

    # Exchange code for tokens
    oauth = OAuth2Session(
        client_id=client_id,
        client_secret=client_secret,
        code_challenge_method='S256',
    )
    token_resp = oauth.fetch_token(
        token_url,
        code=code,
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
    )

    access_token = token_resp.get('access_token', '')
    refresh_tok = token_resp.get('refresh_token')

    # Fetch user info
    headers = {'Authorization': f'Bearer {access_token}'}
    if provider == 'github':
        headers['Accept'] = 'application/vnd.github+json'

    resp = http_requests.get(userinfo_url, headers=headers, timeout=10)
    resp.raise_for_status()
    info = resp.json()

    profile = _normalize_profile(provider, info, headers)
    profile['_tokens'] = {
        'access_token': access_token,
        'refresh_token': refresh_tok,
        'expires_at': token_resp.get('expires_at'),
    }
    return profile


def _normalize_profile(provider, info, headers=None):
    """Convert provider-specific userinfo into a standard dict."""
    if provider == 'google':
        return {
            'provider_user_id': info.get('sub', ''),
            'email': info.get('email', ''),
            'display_name': info.get('name', ''),
        }
    elif provider == 'github':
        email = info.get('email') or ''
        if not email and headers:
            # GitHub may not include email in profile; fetch from /user/emails
            try:
                emails_url = PROVIDER_ENDPOINTS['github']['emails_url']
                r = http_requests.get(emails_url, headers=headers, timeout=10)
                r.raise_for_status()
                for e in r.json():
                    if e.get('primary') and e.get('verified'):
                        email = e['email']
                        break
            except Exception:
                pass
        return {
            'provider_user_id': str(info.get('id', '')),
            'email': email,
            'display_name': info.get('name') or info.get('login', ''),
        }
    else:
        # Generic OIDC
        return {
            'provider_user_id': info.get('sub', ''),
            'email': info.get('email', ''),
            'display_name': info.get('name', ''),
        }


# ------------------------------------------------------------------
# SAML helpers
# ------------------------------------------------------------------

def get_saml_settings(provider_config, request_data):
    """Build python3-saml settings dict."""
    sp_entity_id = provider_config.get('entity_id', '') or request_data.get('sp_entity_id', '')
    acs_url = request_data.get('acs_url', '')

    return {
        'strict': True,
        'debug': False,
        'sp': {
            'entityId': sp_entity_id,
            'assertionConsumerService': {
                'url': acs_url,
                'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
            },
            'NameIDFormat': 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        },
        'idp': {
            'entityId': provider_config.get('entity_id', ''),
            'singleSignOnService': {
                'url': provider_config.get('idp_sso_url', ''),
                'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
            },
            'x509cert': provider_config.get('idp_cert', ''),
        },
    }


def handle_saml_callback(saml_response_data, request_data):
    """Validate SAML response and extract user profile."""
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth
    except ImportError:
        raise RuntimeError('python3-saml is not installed')

    cfg = get_provider_config('saml')
    saml_settings = get_saml_settings(cfg, request_data)

    saml_req = {
        'https': 'on' if request_data.get('https') else 'off',
        'http_host': request_data.get('http_host', ''),
        'script_name': request_data.get('script_name', ''),
        'post_data': saml_response_data,
    }

    auth = OneLogin_Saml2_Auth(saml_req, saml_settings)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        raise ValueError(f'SAML validation failed: {", ".join(errors)}')

    if not auth.is_authenticated():
        raise ValueError('SAML authentication failed')

    attrs = auth.get_attributes()
    name_id = auth.get_nameid()

    return {
        'provider_user_id': name_id,
        'email': attrs.get('email', [name_id])[0] if attrs.get('email') else name_id,
        'display_name': attrs.get('displayName', [''])[0] if attrs.get('displayName') else '',
        '_tokens': {},
    }


# ------------------------------------------------------------------
# User linking / provisioning
# ------------------------------------------------------------------

def find_or_create_user(provider, profile):
    """
    1. Check OAuthIdentity by (provider, provider_user_id) → return linked user
    2. Check User by email → auto-link identity
    3. Auto-provision if enabled
    Returns (user, is_new_user).
    """
    email = profile.get('email', '').lower().strip()

    # Enforce allowed domains
    allowed_domains = SettingsService.get('sso_allowed_domains', [])
    if allowed_domains and email:
        domain = email.split('@')[-1] if '@' in email else ''
        if domain not in allowed_domains:
            raise ValueError(f'Email domain @{domain} is not allowed for SSO login')

    # 1. Check existing identity link
    identity = OAuthIdentity.query.filter_by(
        provider=provider,
        provider_user_id=profile['provider_user_id'],
    ).first()

    if identity:
        user = identity.user
        if not user.is_active:
            raise ValueError('Account is deactivated')
        identity.last_login_at = datetime.utcnow()
        _update_identity_tokens(identity, profile.get('_tokens', {}))
        db.session.commit()
        return user, False

    # 2. Check existing user by email (case-insensitive)
    user = User.query.filter(func.lower(User.email) == func.lower(email)).first() if email else None
    if user:
        if not user.is_active:
            raise ValueError('Account is deactivated')
        link_identity(user.id, provider, profile, profile.get('_tokens', {}))
        return user, False

    # 3. Auto-provision
    if not SettingsService.get('sso_auto_provision', False):
        raise ValueError('No matching account found and auto-provisioning is disabled')

    if not email:
        raise ValueError('SSO provider did not return an email address')

    default_role = SettingsService.get('sso_default_role', 'viewer')
    username = _generate_username(email, profile.get('display_name', ''))

    user = User(
        email=email,
        username=username,
        role=default_role,
        auth_provider=provider,
    )
    db.session.add(user)
    db.session.flush()

    link_identity(user.id, provider, profile, profile.get('_tokens', {}))

    AuditLog.log(
        action=AuditLog.ACTION_SSO_PROVISION,
        user_id=user.id,
        target_type='user',
        target_id=user.id,
        details={'provider': provider, 'email': email, 'role': default_role},
    )
    db.session.commit()
    return user, True


def link_identity(user_id, provider, profile, tokens=None):
    """Create an OAuthIdentity record."""
    tokens = tokens or {}
    identity = OAuthIdentity(
        user_id=user_id,
        provider=provider,
        provider_user_id=profile['provider_user_id'],
        provider_email=profile.get('email'),
        provider_display_name=profile.get('display_name'),
        last_login_at=datetime.utcnow(),
    )
    _update_identity_tokens(identity, tokens)
    db.session.add(identity)

    AuditLog.log(
        action=AuditLog.ACTION_SSO_LINK,
        user_id=user_id,
        target_type='user',
        target_id=user_id,
        details={'provider': provider},
    )
    db.session.commit()
    return identity


def unlink_identity(user_id, provider):
    """Remove an OAuth identity link (prevent if it's the only auth method)."""
    user = User.query.get(user_id)
    if not user:
        raise ValueError('User not found')

    identity = OAuthIdentity.query.filter_by(user_id=user_id, provider=provider).first()
    if not identity:
        raise ValueError(f'No {provider} identity linked')

    # Prevent unlinking if it's the only auth method
    identity_count = OAuthIdentity.query.filter_by(user_id=user_id).count()
    if not user.has_password and identity_count <= 1:
        raise ValueError('Cannot unlink the only authentication method. Set a password first.')

    db.session.delete(identity)
    AuditLog.log(
        action=AuditLog.ACTION_SSO_UNLINK,
        user_id=user_id,
        target_type='user',
        target_id=user_id,
        details={'provider': provider},
    )
    db.session.commit()


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _update_identity_tokens(identity, tokens):
    if tokens.get('access_token'):
        identity.access_token_encrypted = encrypt_token(tokens['access_token'])
    if tokens.get('refresh_token'):
        identity.refresh_token_encrypted = encrypt_token(tokens['refresh_token'])
    if tokens.get('expires_at'):
        try:
            identity.token_expires_at = datetime.utcfromtimestamp(float(tokens['expires_at']))
        except (ValueError, TypeError):
            pass


def _generate_username(email, display_name):
    """Generate a unique username from email or display name."""
    base = display_name.strip().lower().replace(' ', '_') if display_name else email.split('@')[0]
    # Remove non-alphanumeric except underscores
    base = ''.join(c for c in base if c.isalnum() or c == '_')[:60]
    if not base:
        base = 'user'

    username = base
    suffix = 1
    while User.query.filter_by(username=username).first():
        username = f'{base}_{suffix}'
        suffix += 1
    return username


def _fetch_oidc_discovery(discovery_url):
    """Fetch and cache OIDC discovery document."""
    if not discovery_url:
        raise ValueError('OIDC discovery URL not configured')
    resp = http_requests.get(discovery_url, timeout=10)
    resp.raise_for_status()
    return resp.json()


def test_provider_connectivity(provider):
    """Test that a provider's endpoints are reachable."""
    cfg = get_provider_config(provider)

    if provider == 'google':
        client_id = cfg.get('client_id', '')
        if not client_id:
            return {'ok': False, 'error': 'Client ID not configured'}
        # Google discovery is always available
        return {'ok': True, 'message': 'Google OAuth endpoints reachable'}
    elif provider == 'github':
        client_id = cfg.get('client_id', '')
        if not client_id:
            return {'ok': False, 'error': 'Client ID not configured'}
        return {'ok': True, 'message': 'GitHub OAuth endpoints reachable'}
    elif provider == 'oidc':
        try:
            discovery = _fetch_oidc_discovery(cfg.get('discovery_url', ''))
            if 'authorization_endpoint' in discovery:
                return {'ok': True, 'message': 'OIDC discovery successful'}
            return {'ok': False, 'error': 'Discovery document missing authorization_endpoint'}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
    elif provider == 'saml':
        idp_sso_url = cfg.get('idp_sso_url', '')
        if not idp_sso_url:
            return {'ok': False, 'error': 'IdP SSO URL not configured'}
        idp_cert = cfg.get('idp_cert', '')
        if not idp_cert:
            return {'ok': False, 'error': 'IdP certificate not configured'}
        return {'ok': True, 'message': 'SAML configuration looks valid'}
    else:
        return {'ok': False, 'error': f'Unknown provider: {provider}'}
