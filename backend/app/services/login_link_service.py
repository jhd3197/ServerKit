"""One-time login links: mint, redeem, and reap single-use login URLs.

Tokens are 256-bit urlsafe secrets; only their SHA-256 hex digest is stored.
The raw token is returned exactly once at mint time.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timedelta

from app import db
from app.models.login_link import LoginLink  # explicit import registers the table

logger = logging.getLogger(__name__)

DEFAULT_TTL_MINUTES = 15
MAX_TTL_MINUTES = 60

REAP_JOB_KIND = 'auth.login_links.reap'
REAP_SCHEDULE_NAME = 'login-links-reap'


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def mint(user_id, ttl_minutes=DEFAULT_TTL_MINUTES, bound_ip=None, created_by=None):
    """Create a single-use login link for ``user_id``.

    Returns ``(raw_token, LoginLink)``. The raw token is never stored and
    cannot be recovered later.
    """
    import secrets

    try:
        ttl = int(ttl_minutes) if ttl_minutes is not None else DEFAULT_TTL_MINUTES
    except (TypeError, ValueError):
        ttl = DEFAULT_TTL_MINUTES
    ttl = max(1, min(ttl, MAX_TTL_MINUTES))

    token = secrets.token_urlsafe(32)
    link = LoginLink(
        token_hash=_hash_token(token),
        user_id=user_id,
        created_by_id=created_by,
        expires_at=datetime.utcnow() + timedelta(minutes=ttl),
        bound_ip=(bound_ip or None),
    )
    db.session.add(link)
    db.session.commit()
    return token, link


def redeem(token, remote_ip=None):
    """Redeem a raw token. Returns ``(User, None)`` or ``(None, reason)``.

    The reason is for logging only — API callers must return a generic error.
    """
    from app.models import User

    if not token or not isinstance(token, str):
        return None, 'not_found'

    digest = _hash_token(token)
    link = LoginLink.query.filter_by(token_hash=digest).first()
    if link is None or not hmac.compare_digest(link.token_hash, digest):
        return None, 'not_found'
    if link.is_used:
        return None, 'used'
    if link.is_expired:
        return None, 'expired'
    if link.bound_ip and link.bound_ip != (remote_ip or ''):
        return None, 'ip_mismatch'

    user = User.query.get(link.user_id)
    if user is None or not user.is_active:
        return None, 'inactive'

    # Claim it in one conditional UPDATE: two concurrent redeems both pass the
    # is_used check above, but only one can flip used_at from NULL.
    claimed = LoginLink.query.filter_by(id=link.id, used_at=None).update(
        {'used_at': datetime.utcnow()}, synchronize_session=False)
    db.session.commit()
    if claimed != 1:
        return None, 'used'
    return user, None


def reap():
    """Delete expired or already-used links. Returns the number removed."""
    now = datetime.utcnow()
    count = LoginLink.query.filter(
        (LoginLink.used_at.isnot(None)) | (LoginLink.expires_at < now)
    ).delete(synchronize_session=False)
    db.session.commit()
    if count:
        logger.info(f'Reaped {count} login link(s)')
    return count


def list_active():
    """Active (unused, unexpired) links, newest first."""
    now = datetime.utcnow()
    return (
        LoginLink.query
        .filter(LoginLink.used_at.is_(None), LoginLink.expires_at >= now)
        .order_by(LoginLink.created_at.desc())
        .all()
    )


def register_jobs():
    """Register the reap handler with the unified job registry."""
    from app.jobs import registry
    registry.register(REAP_JOB_KIND, lambda job: reap(), replace=True)
