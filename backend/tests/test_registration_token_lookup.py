"""The public /servers/register route ran a deliberately slow PBKDF2 check
against EVERY pending server for each request, so one bad token cost one slow
hash per pending server — unauthenticated CPU burn on the single worker.
Tokens are 256 random bits, so a SHA-256 digest is enough and is looked up
directly; pre-switch hashes still verify until they expire."""
from datetime import datetime, timedelta
from unittest.mock import patch

from werkzeug.security import generate_password_hash

from app import db
from app.models.server import Server
from factories import make_server


def _pending(token, legacy=False):
    server = make_server(db, name=f'reg-{token[-6:]}')
    if legacy:
        server.registration_token_hash = generate_password_hash(token)
    else:
        server.set_registration_token(token)
    server.registration_token_expires = datetime.utcnow() + timedelta(hours=1)
    db.session.commit()
    return server


def test_bad_token_runs_no_slow_hash(app):
    for n in range(5):
        _pending(Server.generate_registration_token())
    with patch('app.models.server.check_password_hash') as slow:
        assert Server.find_by_registration_token('sk_reg_nope') is None
    slow.assert_not_called()


def test_good_and_legacy_tokens_pair(app):
    token = Server.generate_registration_token()
    server = _pending(token)
    assert Server.find_by_registration_token(token).id == server.id

    old = Server.generate_registration_token()
    legacy = _pending(old, legacy=True)
    assert Server.find_by_registration_token(old).id == legacy.id


def test_expired_digest_token_is_refused(app):
    token = Server.generate_registration_token()
    server = _pending(token)
    server.registration_token_expires = datetime.utcnow() - timedelta(minutes=1)
    db.session.commit()
    assert Server.find_by_registration_token(token) is None


def test_register_route_rejects_non_string_token(client):
    assert client.post('/api/v1/servers/register', json={'token': 12345}).status_code == 400
