"""GET /api/v1/servers accepts a scoped API key (deliberate conversion).

A Vela host holds one ServerKit API key as a host-side secret and polls the
fleet list, so this read route takes a JWT *or* an ``X-API-Key`` carrying the
``servers:read`` scope. That is a recorded jwt_only_census exception — JWT-only
stays the default elsewhere (see tests/jwt_only_census.py); these tests pin
the behavior of the exception itself.
"""
from factories import make_user, headers_for
from app.services.api_key_service import ApiKeyService


def _api_key_headers(db, scopes):
    user = make_user(db)
    _, raw_key = ApiKeyService.create_key(user.id, name='servers-poll', scopes=scopes)
    return {'X-API-Key': raw_key}


def test_api_key_with_servers_read_scope_lists_servers(client, db_session):
    resp = client.get('/api/v1/servers',
                      headers=_api_key_headers(db_session, ['servers:read']))
    assert resp.status_code == 200
    assert isinstance(resp.json, list)


def test_api_key_without_the_scope_is_denied(client, db_session):
    resp = client.get('/api/v1/servers',
                      headers=_api_key_headers(db_session, ['databases:read']))
    assert resp.status_code == 403


def test_jwt_caller_still_lists_servers(client, db_session):
    resp = client.get('/api/v1/servers',
                      headers=headers_for(make_user(db_session)))
    assert resp.status_code == 200
    assert isinstance(resp.json, list)


def test_unauthenticated_gets_401(client):
    assert client.get('/api/v1/servers').status_code == 401
