"""One-time login links: mint / redeem / expiry / single-use / IP-bound / RBAC."""
from datetime import datetime, timedelta

def _assert_link_invalid(response):
    """The typed-error contract body (plan 76 B), not a bare {'error': ...}.

    `code` is what the frontend maps to a translation key (plan 79 F1), so it
    is asserted rather than tolerated: dropping it would silently make the
    message untranslatable again.
    """
    body = response.get_json()
    assert body['error'] == 'Invalid or expired link'
    assert body['status'] == 401
    assert body['code'] == 'auth.link_invalid'
    assert body['request_id']

import pytest

# Explicit import so the table registers with SQLAlchemy even though
# app/models/__init__.py does not (yet) import it.
from app.models.login_link import LoginLink  # noqa: F401
from app.services import login_link_service


@pytest.fixture
def viewer_headers(app):
    """A non-admin (viewer) user's JWT headers."""
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token

    with app.app_context():
        user = User(email='viewer@test.local', username='vieweruser',
                    role=User.ROLE_VIEWER, is_active=True)
        user.set_password('viewerpass')
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=user.id)
    return {'Authorization': f'Bearer {token}'}


def _mint(client, auth_headers, body=None):
    return client.post('/api/v1/auth/login-links', json=body or {},
                       headers=auth_headers)


def test_mint_requires_admin(client, auth_headers, viewer_headers):
    # No auth
    resp = client.post('/api/v1/auth/login-links', json={})
    assert resp.status_code == 401

    # Non-admin
    resp = client.post('/api/v1/auth/login-links', json={}, headers=viewer_headers)
    assert resp.status_code == 403

    # Admin
    resp = _mint(client, auth_headers)
    assert resp.status_code == 201


def test_mint_returns_token_once_and_list_hides_hashes(client, auth_headers):
    resp = _mint(client, auth_headers, {'ttl_minutes': 30})
    assert resp.status_code == 201
    data = resp.get_json()
    assert data['token']
    assert data['url'] == f"/login?link={data['token']}"
    assert data['expires_at']
    assert 'token_hash' not in data['link']

    listing = client.get('/api/v1/auth/login-links', headers=auth_headers)
    assert listing.status_code == 200
    links = listing.get_json()['links']
    assert len(links) == 1
    assert 'token_hash' not in links[0]
    assert 'token' not in links[0]


def test_ttl_capped_at_60_minutes(client, auth_headers):
    resp = _mint(client, auth_headers, {'ttl_minutes': 500})
    assert resp.status_code == 201
    expires = datetime.fromisoformat(resp.get_json()['expires_at'])
    assert expires <= datetime.utcnow() + timedelta(minutes=61)


def test_redeem_success_and_single_use(client, auth_headers):
    token = _mint(client, auth_headers).get_json()['token']

    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['access_token'] and data['refresh_token']
    assert data['user']['username'] == 'testadmin'

    # The minted access token actually works
    me = client.get('/api/v1/auth/me',
                    headers={'Authorization': f"Bearer {data['access_token']}"})
    assert me.status_code == 200
    assert me.get_json()['user']['username'] == 'testadmin'

    # Second redeem fails with a generic error
    again = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert again.status_code == 401
    _assert_link_invalid(again)


def test_redeem_expired_link_fails(app, client, auth_headers):
    from app import db

    token = _mint(client, auth_headers).get_json()['token']
    with app.app_context():
        link = LoginLink.query.first()
        link.expires_at = datetime.utcnow() - timedelta(minutes=1)
        db.session.commit()

    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 401
    _assert_link_invalid(resp)


def test_redeem_unknown_token_fails(client):
    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': 'bogus'})
    assert resp.status_code == 401
    _assert_link_invalid(resp)


def test_ip_bound_link(client, auth_headers):
    # Bound to a foreign IP → rejected (test client is 127.0.0.1)
    token = _mint(client, auth_headers, {'bound_ip': '10.9.8.7'}).get_json()['token']
    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 401

    # Bound to the caller's IP → accepted
    token = _mint(client, auth_headers, {'bound_ip': '127.0.0.1'}).get_json()['token']
    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 200


def test_revoke_link(client, auth_headers):
    minted = _mint(client, auth_headers).get_json()
    link_id = minted['link']['id']

    resp = client.delete(f'/api/v1/auth/login-links/{link_id}', headers=auth_headers)
    assert resp.status_code == 200

    listing = client.get('/api/v1/auth/login-links', headers=auth_headers)
    assert listing.get_json()['links'] == []

    resp = client.post('/api/v1/auth/login-links/redeem',
                       json={'token': minted['token']})
    assert resp.status_code == 401


def test_mint_for_another_user(app, client, auth_headers):
    from app import db
    from app.models import User

    with app.app_context():
        other = User(email='other@test.local', username='otheruser',
                     role=User.ROLE_DEVELOPER, is_active=True)
        other.set_password('otherpass123')
        db.session.add(other)
        db.session.commit()
        other_id = other.id

    token = _mint(client, auth_headers, {'user_id': other_id}).get_json()['token']
    resp = client.post('/api/v1/auth/login-links/redeem', json={'token': token})
    assert resp.status_code == 200
    assert resp.get_json()['user']['username'] == 'otheruser'


def test_reap_removes_used_and_expired(app, client, auth_headers):
    from app import db

    with app.app_context():
        # used
        used_token, used_link = login_link_service.mint(user_id=1)
        used_link.used_at = datetime.utcnow()
        # expired
        _, expired_link = login_link_service.mint(user_id=1)
        expired_link.expires_at = datetime.utcnow() - timedelta(minutes=5)
        # live
        _, live_link = login_link_service.mint(user_id=1)
        db.session.commit()

        removed = login_link_service.reap()
        assert removed == 2
        remaining = LoginLink.query.all()
        assert [l.id for l in remaining] == [live_link.id]


def test_register_jobs_registers_reap_kind(app):
    with app.app_context():
        from app.jobs import registry
        login_link_service.register_jobs()
        assert login_link_service.REAP_JOB_KIND in registry.registered_kinds()


def test_concurrent_redeems_only_one_wins(client, auth_headers, monkeypatch):
    """Two requests that both read the link before either commits used to
    both get a session. The claim is a conditional UPDATE, so the loser sees
    zero rows even though its earlier is_used check passed."""
    token = _mint(client, auth_headers).get_json()['token']
    user, reason = login_link_service.redeem(token)
    assert user is not None and reason is None
    # Replay the race: the second request's check saw an unused link.
    monkeypatch.setattr(LoginLink, 'is_used', property(lambda self: False))
    user, reason = login_link_service.redeem(token)
    assert user is None and reason == 'used'
