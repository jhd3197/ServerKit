"""Managed database users — model round-trip, SQL generation through the
stubbed ``_exec_sql`` choke-point, scoped grants, expiry reaping, and API.

The blueprint is not yet wired into ``app/__init__.py`` (WIRING pending), so
API tests register it on the test app manually.
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models.managed_database_user import ManagedDatabaseUser
from app.services.managed_database_service import ManagedDatabaseService
from app.services.managed_db_user_service import ManagedDbUserService

# Registers blueprints / url rules on the app fixture. Flask cannot unregister
# those, so these tests need a private app rather than the session-wide one
# (plan 64 Phase 1).
pytestmark = pytest.mark.fresh_app


@pytest.fixture
def managed(app):
    return ManagedDatabaseService.record_provisioned(
        'mysql', 'shop', host='localhost', port=3306,
        admin_username='root', admin_secret='rootpw',
    )


@pytest.fixture
def pg_managed(app):
    return ManagedDatabaseService.record_provisioned(
        'postgresql', 'reports', admin_username='postgres', admin_secret='pgpw',
    )


@pytest.fixture
def sql_log(monkeypatch):
    """Stub the single SQL choke-point; capture every statement."""
    executed = []

    def fake_exec(managed, sql):
        executed.append(sql)
        return {'success': True, 'output': '', 'error': None}

    monkeypatch.setattr(ManagedDbUserService, '_exec_sql', classmethod(
        lambda cls, managed, sql: fake_exec(managed, sql)))
    return executed


def _register_bp(app):
    from app.api.managed_db_users import managed_db_users_bp
    if 'managed_db_users' not in app.blueprints:
        app.register_blueprint(managed_db_users_bp, url_prefix='/api/v1/managed-databases')
    return app


# ── model round-trip ─────────────────────────────────────────────────────────

def test_model_round_trip(app, managed):
    row = ManagedDatabaseUser(managed_database_id=managed.id, username='app_rw')
    row.set_grants(['SELECT', 'INSERT'])
    db.session.add(row)
    db.session.commit()

    fetched = ManagedDatabaseUser.query.filter_by(username='app_rw').one()
    assert fetched.get_grants() == ['SELECT', 'INSERT']
    assert fetched.is_shadow is False
    assert fetched.is_expired is False
    d = fetched.to_dict()
    assert d['username'] == 'app_rw' and d['managed_database_id'] == managed.id
    assert d['grants'] == ['SELECT', 'INSERT']
    assert 'password' not in d  # never modeled, never serialized


def test_username_unique_per_database(app, managed):
    db.session.add(ManagedDatabaseUser(managed_database_id=managed.id, username='dup'))
    db.session.commit()
    db.session.add(ManagedDatabaseUser(managed_database_id=managed.id, username='dup'))
    with pytest.raises(Exception):
        db.session.commit()
    db.session.rollback()


def test_rows_survive_soft_delete_and_cascade_on_hard_delete(app, managed):
    # Plan 77 B5: a plain delete tombstones the managed DB, so its user rows
    # must SURVIVE (restore needs them). The hard-delete path (?drop=true /
    # purge) is what cascades them away.
    ManagedDbUserService.ensure_recorded(managed, 'orphan_check')
    assert ManagedDatabaseUser.query.count() == 1
    ManagedDatabaseService.delete(managed, drop=False)
    assert ManagedDatabaseUser.query.count() == 1

    managed.restore()
    ManagedDatabaseService.delete(managed, drop=True)
    assert ManagedDatabaseUser.query.count() == 0


# ── create_user SQL generation ───────────────────────────────────────────────

def test_create_user_mysql_sql(app, managed, sql_log):
    result = ManagedDbUserService.create_user(
        managed, username='app_rw', password="p'w\\d", grants=['SELECT', 'INSERT'])
    assert 'error' not in result
    assert result['password'] == "p'w\\d"                       # returned once
    # proper escaping: backslash then quote escaped for MySQL
    assert sql_log[0] == "CREATE USER 'app_rw'@'%' IDENTIFIED BY 'p\\'w\\\\d';"
    assert sql_log[1] == "GRANT SELECT, INSERT ON `shop`.* TO 'app_rw'@'%';"
    assert sql_log[2] == 'FLUSH PRIVILEGES;'
    row = ManagedDatabaseUser.query.filter_by(username='app_rw').one()
    assert row.get_grants() == ['SELECT', 'INSERT']
    # the password is nowhere in the row
    assert "p'w" not in (row.grants or '')


def test_create_user_mysql_all_privileges(app, managed, sql_log):
    ManagedDbUserService.create_user(managed, username='full', password='x')
    assert sql_log[1] == "GRANT ALL PRIVILEGES ON `shop`.* TO 'full'@'%';"


def test_create_user_postgresql_sql(app, pg_managed, sql_log):
    result = ManagedDbUserService.create_user(
        pg_managed, username='rpt_ro', password="o'brien", grants=['SELECT'])
    assert 'error' not in result
    assert sql_log[0] == "CREATE USER \"rpt_ro\" WITH PASSWORD 'o''brien';"  # '' escaping
    assert sql_log[1] == 'GRANT CONNECT ON DATABASE "reports" TO "rpt_ro";'
    assert sql_log[2] == 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO "rpt_ro";'


def test_create_user_generates_strong_password(app, managed, sql_log):
    result = ManagedDbUserService.create_user(managed, username='gen1')
    assert len(result['password']) >= 24


def test_create_user_rejects_bad_username(app, managed, sql_log):
    result = ManagedDbUserService.create_user(managed, username="bad'; DROP TABLE x;--")
    assert result == {'error': 'Invalid username: letters, digits and underscores only (max 32)'}
    assert sql_log == []                                        # nothing reached the engine


def test_create_user_rejects_bad_grants(app, managed, sql_log):
    result = ManagedDbUserService.create_user(managed, username='ok', grants=["SELECT'; DROP"])
    assert result == {'error': 'Invalid grants'}
    assert sql_log == []


def test_create_user_unsupported_engine(app, sql_log):
    mongo = ManagedDatabaseService.record_provisioned('mongodb', 'logs')
    assert ManagedDbUserService.create_user(mongo, username='u1') == {'error': 'unsupported engine'}
    assert sql_log == []


def test_create_user_engine_failure_cleans_up(app, managed, monkeypatch):
    calls = []

    def fake(cls, managed_, sql):
        calls.append(sql)
        if sql.startswith('GRANT'):
            return {'success': False, 'error': 'boom'}
        return {'success': True, 'output': '', 'error': None}

    monkeypatch.setattr(ManagedDbUserService, '_exec_sql', classmethod(fake))
    result = ManagedDbUserService.create_user(managed, username='half')
    assert result == {'error': 'boom'}
    assert ManagedDatabaseUser.query.count() == 0               # no orphan row
    assert any(s.startswith('DROP USER') for s in calls)        # engine cleanup attempted


# ── list / delete / ensure_recorded ──────────────────────────────────────────

def test_list_users_merges_live_engine_users(app, managed, monkeypatch):
    ManagedDbUserService.ensure_recorded(managed, 'tracked_one')
    monkeypatch.setattr(ManagedDbUserService, '_list_engine_usernames',
                        classmethod(lambda cls, m: ['tracked_one', 'wild_user']))
    users = ManagedDbUserService.list_users(managed)
    by_name = {u['username']: u for u in users}
    assert by_name['tracked_one']['present'] is True
    assert by_name['wild_user'] == {'username': 'wild_user', 'tracked': False, 'present': True}


def test_list_users_engine_unreachable(app, managed, monkeypatch):
    ManagedDbUserService.ensure_recorded(managed, 'tracked_one')
    monkeypatch.setattr(ManagedDbUserService, '_list_engine_usernames',
                        classmethod(lambda cls, m: None))
    users = ManagedDbUserService.list_users(managed)
    assert users[0]['present'] is None                          # unknown, not False


def test_list_users_hides_shadow_by_default(app, managed):
    ManagedDbUserService.ensure_recorded(managed, 'sk_sso_abc123', is_shadow=True)
    assert ManagedDbUserService.list_users(managed) == [] or all(
        not u.get('is_shadow') for u in ManagedDbUserService.list_users(managed))


def test_delete_user_drops_and_removes_row(app, managed, sql_log):
    row = ManagedDbUserService.ensure_recorded(managed, 'goner')
    result = ManagedDbUserService.delete_user(managed, row)
    assert result == {'success': True}
    assert sql_log[0] == "DROP USER IF EXISTS 'goner'@'%';"
    assert ManagedDatabaseUser.query.count() == 0


def test_ensure_recorded_is_idempotent(app, managed):
    a = ManagedDbUserService.ensure_recorded(managed, 'same')
    b = ManagedDbUserService.ensure_recorded(managed, 'same', grants=['SELECT'])
    assert a.id == b.id
    assert b.get_grants() == ['SELECT']
    assert ManagedDatabaseUser.query.count() == 1


# ── expiry reap ──────────────────────────────────────────────────────────────

def test_reap_drops_only_expired_shadow_users(app, managed, sql_log):
    ManagedDbUserService.ensure_recorded(
        managed, 'sk_sso_dead', is_shadow=True,
        expires_at=datetime.utcnow() - timedelta(minutes=1))
    ManagedDbUserService.ensure_recorded(
        managed, 'sk_sso_live', is_shadow=True,
        expires_at=datetime.utcnow() + timedelta(minutes=5))
    ManagedDbUserService.ensure_recorded(managed, 'permanent')  # not shadow

    removed = ManagedDbUserService.reap_expired_shadow_users()
    assert removed == 1
    names = {r.username for r in ManagedDatabaseUser.query.all()}
    assert names == {'sk_sso_live', 'permanent'}
    assert "DROP USER IF EXISTS 'sk_sso_dead'@'%';" in sql_log
    assert not any('sk_sso_live' in s for s in sql_log)


# ── API ──────────────────────────────────────────────────────────────────────

def test_api_create_list_delete_user(app, client, auth_headers, managed, sql_log):
    _register_bp(app)

    resp = client.post(f'/api/v1/managed-databases/{managed.id}/users',
                       headers=auth_headers, json={'username': 'api_user'})
    assert resp.status_code == 201
    body = resp.get_json()
    assert body['user']['username'] == 'api_user'
    assert body['password']                                     # returned once
    user_id = body['user']['id']

    resp = client.get(f'/api/v1/managed-databases/{managed.id}/users',
                      headers=auth_headers)
    assert resp.status_code == 200
    users = resp.get_json()['users']
    assert any(u.get('username') == 'api_user' for u in users)
    assert all('password' not in u for u in users)              # never re-exposed

    resp = client.delete(f'/api/v1/managed-databases/{managed.id}/users/{user_id}',
                         headers=auth_headers)
    assert resp.status_code == 200
    assert ManagedDatabaseUser.query.count() == 0


def test_api_create_requires_admin(app, client, managed):
    _register_bp(app)
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    from app.models import User

    dev = User(email='dbudev@test.local', username='dbudev',
               password_hash=generate_password_hash('x'),
               role=User.ROLE_DEVELOPER, is_active=True)
    db.session.add(dev)
    db.session.commit()
    headers = {'Authorization': f'Bearer {create_access_token(identity=dev.id)}'}
    resp = client.post(f'/api/v1/managed-databases/{managed.id}/users',
                       headers=headers, json={'username': 'nope'})
    assert resp.status_code == 403


def test_api_404_on_unknown_database(app, client, auth_headers):
    _register_bp(app)
    resp = client.get('/api/v1/managed-databases/99999/users', headers=auth_headers)
    assert resp.status_code == 404
    body = resp.get_json()
    assert body['error'] == 'Database not found'
    assert body['code'] == 'not_found.database'


def test_api_bad_grants_is_400(app, client, auth_headers, managed, sql_log):
    _register_bp(app)
    resp = client.post(f'/api/v1/managed-databases/{managed.id}/users',
                       headers=auth_headers,
                       json={'username': 'u1', 'grants': ['SELECT; DROP']})
    assert resp.status_code == 400
    assert resp.get_json() == {'error': 'Invalid grants'}
