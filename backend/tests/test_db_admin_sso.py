"""One-click DB admin SSO via Adminer — launch descriptor shape with docker
stubbed, shadow-credential scoping, reaping, and the API surface.

Docker and engine SQL are stubbed at their single choke-points
(``DbAdminSsoService._docker`` / ``ManagedDbUserService._exec_sql``).
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models.managed_database_user import ManagedDatabaseUser
from app.services.managed_database_service import ManagedDatabaseService
from app.services.managed_db_user_service import ManagedDbUserService
from app.services.db_admin_sso_service import (
    DbAdminSsoService, ADMINER_LABEL, ADMINER_CONTAINER, REAP_JOB_KIND,
)

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
def docker_managed(app):
    return ManagedDatabaseService.record_provisioned(
        'postgresql', 'reports', host_kind='docker', container_ref='pg-main',
    )


@pytest.fixture
def sql_log(monkeypatch):
    executed = []
    monkeypatch.setattr(ManagedDbUserService, '_exec_sql', classmethod(
        lambda cls, m, sql: (executed.append(sql) or
                             {'success': True, 'output': '', 'error': None})))
    return executed


@pytest.fixture
def docker_stub(monkeypatch):
    """Stub the docker choke-point: no running Adminer, run succeeds."""
    calls = []

    def fake_docker(cls, args, timeout=60):
        calls.append(list(args))
        if args[0] == 'ps':
            return {'success': True, 'output': '', 'error': None}  # none running
        if args[0] == 'run':
            return {'success': True, 'output': 'abc123', 'error': None}
        return {'success': True, 'output': '', 'error': None}

    monkeypatch.setattr(DbAdminSsoService, '_docker', classmethod(fake_docker))
    monkeypatch.setattr(DbAdminSsoService, '_docker_available',
                        classmethod(lambda cls: True))
    DbAdminSsoService._last_used_at = None
    return calls


# ── launch descriptor ────────────────────────────────────────────────────────

def test_launch_descriptor_shape(app, managed, sql_log, docker_stub):
    d = DbAdminSsoService.launch(managed, requested_by=1)
    assert set(d) >= {'port', 'driver', 'server', 'username', 'password',
                      'database', 'expires_at'}
    assert d['driver'] == 'server'                      # Adminer's MySQL driver
    assert d['database'] == 'shop'
    assert d['username'].startswith('sk_sso_')
    assert 20000 <= d['port'] < 40000
    # host engine as seen FROM the adminer container
    assert d['server'] == 'host.docker.internal:3306'
    # a run happened with our label + network + published port
    run = next(c for c in docker_stub if c[0] == 'run')
    assert '--label' in run and ADMINER_LABEL in run
    assert '--network' in run and 'serverkit' in run


def test_launch_mints_scoped_shadow_credential(app, managed, sql_log, docker_stub):
    d = DbAdminSsoService.launch(managed)
    row = ManagedDatabaseUser.query.filter_by(username=d['username']).one()
    assert row.is_shadow is True
    assert row.expires_at is not None
    assert row.expires_at <= datetime.utcnow() + timedelta(minutes=5, seconds=5)
    # grants scoped to THAT one database only
    grant_sql = next(s for s in sql_log if s.startswith('GRANT'))
    assert 'ON `shop`.*' in grant_sql
    assert '*.*' not in grant_sql
    # password crosses once in the descriptor, never persisted
    assert d['password'] not in (row.grants or '')
    assert not hasattr(row, 'password')


def test_launch_docker_engine_server_is_container_name(app, docker_managed,
                                                       sql_log, docker_stub):
    d = DbAdminSsoService.launch(docker_managed)
    assert d['server'] == 'pg-main'                     # same docker network
    assert d['driver'] == 'pgsql'


def test_launch_reuses_running_adminer(app, managed, sql_log, monkeypatch):
    def fake_docker(cls, args, timeout=60):
        if args[0] == 'ps':
            return {'success': True, 'output': 'serverkit-adminer-sso\n', 'error': None}
        if args[0] == 'port':
            return {'success': True, 'output': '0.0.0.0:31245\n', 'error': None}
        raise AssertionError(f'unexpected docker call: {args}')

    monkeypatch.setattr(DbAdminSsoService, '_docker', classmethod(fake_docker))
    monkeypatch.setattr(DbAdminSsoService, '_docker_available',
                        classmethod(lambda cls: True))
    d = DbAdminSsoService.launch(managed)
    assert d['port'] == 31245                           # no new container run


def test_launch_without_docker_is_clean_error(app, managed, monkeypatch):
    monkeypatch.setattr(DbAdminSsoService, '_docker_available',
                        classmethod(lambda cls: False))
    assert DbAdminSsoService.launch(managed) == {'error': 'Docker required', 'code': 'docker_required'}
    assert ManagedDatabaseUser.query.count() == 0       # nothing minted


def test_launch_unsupported_engine(app, docker_stub):
    mongo = ManagedDatabaseService.record_provisioned('mongodb', 'logs')
    assert DbAdminSsoService.launch(mongo) == {'error': 'unsupported engine', 'code': 'unsupported_engine'}


def test_launch_adminer_failure_revokes_credential(app, managed, sql_log, monkeypatch):
    def fake_docker(cls, args, timeout=60):
        if args[0] == 'ps':
            return {'success': True, 'output': '', 'error': None}
        return {'success': False, 'output': '', 'error': 'no docker for you'}

    monkeypatch.setattr(DbAdminSsoService, '_docker', classmethod(fake_docker))
    monkeypatch.setattr(DbAdminSsoService, '_docker_available',
                        classmethod(lambda cls: True))
    result = DbAdminSsoService.launch(managed)
    assert result == {'error': 'no docker for you'}
    assert ManagedDatabaseUser.query.count() == 0       # row revoked
    assert any(s.startswith('DROP USER') for s in sql_log)  # engine-side too


# ── reap ─────────────────────────────────────────────────────────────────────

def test_reap_removes_expired_and_stops_idle_adminer(app, managed, sql_log, monkeypatch):
    ManagedDbUserService.ensure_recorded(
        managed, 'sk_sso_dead', is_shadow=True,
        expires_at=datetime.utcnow() - timedelta(minutes=1))

    calls = []

    def fake_docker(cls, args, timeout=60):
        calls.append(list(args))
        if args[0] == 'ps':
            return {'success': True, 'output': 'serverkit-adminer-sso\n', 'error': None}
        if args[0] == 'port':
            return {'success': True, 'output': '0.0.0.0:31245\n', 'error': None}
        return {'success': True, 'output': '', 'error': None}

    monkeypatch.setattr(DbAdminSsoService, '_docker', classmethod(fake_docker))
    monkeypatch.setattr('app.services.db_admin_sso_service.os.name', 'posix')
    DbAdminSsoService._last_used_at = datetime.utcnow() - timedelta(minutes=20)

    result = DbAdminSsoService.reap()
    assert result['users_removed'] == 1
    assert result['adminer_stopped'] is True
    assert ['rm', '-f', ADMINER_CONTAINER] in calls
    assert ManagedDatabaseUser.query.count() == 0


def test_reap_keeps_recently_used_adminer(app, monkeypatch):
    calls = []
    monkeypatch.setattr(DbAdminSsoService, '_docker', classmethod(
        lambda cls, args, timeout=60: (calls.append(list(args)) or
                                       {'success': True, 'output': '', 'error': None})))
    DbAdminSsoService._last_used_at = datetime.utcnow()
    result = DbAdminSsoService.reap()
    assert result['adminer_stopped'] is False
    assert ['rm', '-f', ADMINER_CONTAINER] not in calls


def test_register_jobs_registers_reap_kind(app):
    from app.jobs import registry
    DbAdminSsoService.register_jobs()
    assert REAP_JOB_KIND in registry.registered_kinds()


# ── API ──────────────────────────────────────────────────────────────────────

def _register_bp(app):
    from app.api.managed_db_users import managed_db_users_bp
    if 'managed_db_users' not in app.blueprints:
        app.register_blueprint(managed_db_users_bp, url_prefix='/api/v1/managed-databases')


def test_api_sso_launch(app, client, auth_headers, managed, sql_log, docker_stub):
    _register_bp(app)
    resp = client.post(f'/api/v1/managed-databases/{managed.id}/sso',
                       headers=auth_headers)
    assert resp.status_code == 200
    d = resp.get_json()
    assert d['url'].startswith('http://') and str(d['port']) in d['url']
    assert d['database'] == 'shop' and d['password']


def test_api_sso_requires_admin(app, client, managed):
    _register_bp(app)
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    from app.models import User

    dev = User(email='ssodev@test.local', username='ssodev',
               password_hash=generate_password_hash('x'),
               role=User.ROLE_DEVELOPER, is_active=True)
    db.session.add(dev)
    db.session.commit()
    headers = {'Authorization': f'Bearer {create_access_token(identity=dev.id)}'}
    resp = client.post(f'/api/v1/managed-databases/{managed.id}/sso', headers=headers)
    assert resp.status_code == 403


def test_api_sso_docker_required_is_503(app, client, auth_headers, managed, monkeypatch):
    _register_bp(app)
    monkeypatch.setattr(DbAdminSsoService, '_docker_available',
                        classmethod(lambda cls: False))
    resp = client.post(f'/api/v1/managed-databases/{managed.id}/sso',
                       headers=auth_headers)
    assert resp.status_code == 503
    assert resp.get_json() == {'error': 'Docker required'}
