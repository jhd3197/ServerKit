"""Browser-session policy shared by HTTP, sockets, and long-running work."""
import time
from functools import wraps

from flask import g, jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request


def issue_session_tokens(user_id):
    """Issue one browser's access/refresh pair with an explicit shared id."""
    import secrets
    from flask_jwt_extended import create_access_token, create_refresh_token
    claims = {'session_id': secrets.token_hex(16)}
    return (create_access_token(identity=user_id, additional_claims=claims),
            create_refresh_token(identity=user_id, additional_claims=claims))


def validate_session_claims(claims, *, allow_pending=False, token_type='access',
                            check_expiry=True):
    """Return the live user only for an unexpired, unrevoked session JWT.

    check_expiry=False is for re-checking an already-authenticated live
    connection: its token was unexpired at connect, and revocation, the
    auth_version bump and deactivation still end it."""
    from app.models import User, RevokedSession

    if not isinstance(claims, dict) or claims.get('type') != token_type:
        return None
    if claims.get('2fa_pending') and not allow_pending:
        return None
    session_id = claims.get('session_id')
    if not isinstance(session_id, str) or len(session_id) != 32:
        return None
    if RevokedSession.query.filter_by(session_id=session_id).first() is not None:
        return None
    expiration = claims.get('exp')
    if not isinstance(expiration, (int, float)) or (check_expiry and expiration <= time.time()):
        return None
    try:
        user_id = int(claims['sub'])
    except (KeyError, TypeError, ValueError):
        return None
    user = User.query.populate_existing().filter_by(id=user_id).first()
    if (not user or not user.is_active or not claims.get('auth_version')
            or claims['auth_version'] != user.auth_version):
        return None
    return user


def session_required(fn):
    """Explicit JWT-only policy for actions on the caller's browser sessions.

    Credential/session administration must never turn a scoped API key into
    unrestricted browser credentials, even when its owner is an admin.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if getattr(g, 'api_key_user', None):
            return jsonify({'error': 'Browser authentication required'}), 403
        verify_jwt_in_request()
        g.session_user = validate_session_claims(get_jwt())
        if not g.session_user:
            return jsonify({'error': 'Session is no longer valid'}), 401
        return fn(*args, **kwargs)
    wrapper._sk_authz = ('session_required',)
    return wrapper
