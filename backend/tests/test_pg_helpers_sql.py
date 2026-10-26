"""The legacy Postgres helpers run as the postgres superuser, so every value
they put in SQL is validated or escaped like the MySQL ones next to them, and
the create-with-user routes never return credentials for a user that failed."""
from unittest.mock import patch

import pytest

from app.services.database_service import DatabaseService


@pytest.fixture
def executed():
    sql = []
    with patch.object(DatabaseService, 'pg_execute',
                      side_effect=lambda q: sql.append(q) or {'success': True, 'output': ''}):
        yield sql


def test_password_quote_is_escaped(executed):
    assert DatabaseService.pg_create_user('shop', "pa'ss")['success']
    assert executed == ["CREATE USER \"shop\" WITH PASSWORD 'pa''ss';"]


@pytest.mark.parametrize('call', [
    lambda: DatabaseService.pg_create_database('x"; DROP DATABASE prod; --'),
    lambda: DatabaseService.pg_create_database('shop', owner='a" SUPERUSER'),
    lambda: DatabaseService.pg_create_database('shop', encoding="UTF8'; DROP"),
    lambda: DatabaseService.pg_create_user('a"b', 'pw'),
    lambda: DatabaseService.pg_drop_user('a"b'),
    lambda: DatabaseService.pg_grant_privileges('u', 'd', 'ALL ON SCHEMA public TO u; --'),
    lambda: DatabaseService.pg_revoke_privileges('u', 'd"x'),
    lambda: DatabaseService.mysql_grant_privileges('u', 'd', 'ALL; DROP USER root'),
])
def test_unsafe_values_never_reach_sql(executed, call):
    with patch.object(DatabaseService, 'mysql_execute') as mysql:
        assert call()['success'] is False
    assert executed == []
    mysql.assert_not_called()


def test_privilege_lists_still_work(executed):
    assert DatabaseService.pg_grant_privileges('u', 'd', 'SELECT, INSERT')['success']
    assert executed == ['GRANT SELECT, INSERT PRIVILEGES ON DATABASE "d" TO "u";']


def test_failed_user_is_not_reported_with_credentials(app, client, auth_headers):
    with patch.object(DatabaseService, 'pg_create_database', return_value={'success': True}), \
            patch.object(DatabaseService, 'pg_create_user',
                         return_value={'success': False, 'error': 'role exists'}), \
            patch.object(DatabaseService, 'pg_grant_privileges') as grant:
        resp = client.post('/api/v1/databases/postgresql', headers=auth_headers,
                           json={'name': 'pgshop', 'create_user': True})
    body = resp.get_json()
    assert 'password' not in body and 'user' not in body
    assert body['user_error'] == 'role exists'
    grant.assert_not_called()
