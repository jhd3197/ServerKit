"""A live socket outlives its 15-minute access token. Re-checks on emit end it
for revocation, deactivation or a role change — never for plain expiry, which
froze every live view a quarter-hour after connecting."""
import time

import app.sockets as sk
from app import db
from factories import access_token_for, make_user


def _connect(user, sid, **claim_overrides):
    from flask_jwt_extended import decode_token
    claims = {**decode_token(access_token_for(user)), **claim_overrides}
    with sk._connected_clients_lock:
        sk.connected_clients[sid] = {'user_id': user.id, 'role': user.role, 'claims': claims}


def test_expired_token_keeps_a_live_socket(app, monkeypatch):
    monkeypatch.setattr(sk, '_disconnect_client', lambda sid: None)
    user = make_user(db, role='developer')
    _connect(user, 'live-1', exp=int(time.time()) - 60)
    try:
        assert sk._client_user('live-1').id == user.id
    finally:
        sk.connected_clients.pop('live-1', None)


def test_revoked_session_still_ends_it(app, monkeypatch):
    from app.models import RevokedSession
    dropped = []
    monkeypatch.setattr(sk, '_disconnect_client', dropped.append)
    user = make_user(db, role='developer')
    _connect(user, 'live-2', exp=int(time.time()) - 60)
    session_id = sk.connected_clients['live-2']['claims']['session_id']
    db.session.add(RevokedSession(session_id=session_id, user_id=user.id))
    db.session.commit()
    try:
        assert sk._client_user('live-2') is None
        assert dropped == ['live-2']
    finally:
        sk.connected_clients.pop('live-2', None)


def test_connect_still_requires_an_unexpired_token(app):
    from flask_jwt_extended import decode_token
    from app.middleware.session_auth import validate_session_claims
    user = make_user(db, role='developer')
    claims = {**decode_token(access_token_for(user)), 'exp': int(time.time()) - 60}
    assert validate_session_claims(claims) is None
