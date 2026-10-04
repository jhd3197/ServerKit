"""Tests for the live processlist + kill feature (DbProcessService + API)."""
import pytest

from app.services.db_process_service import DbProcessService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stub_exec(monkeypatch, output='', success=True, error=None):
    """Replace the single _exec_sql choke-point, recording calls."""
    calls = []

    def fake_exec(target, sql):
        calls.append({'target': target, 'sql': sql})
        return {'success': success, 'output': output, 'error': error}

    monkeypatch.setattr(DbProcessService, '_exec_sql', staticmethod(fake_exec))
    return calls


MYSQL_OUTPUT = (
    "Id\tUser\tHost\tdb\tCommand\tTime\tState\tInfo\n"
    "5\troot\tlocalhost\tNULL\tSleep\t120\t\tNULL\n"
    "12\tapp\t172.17.0.3:5544\tshop\tQuery\t3\texecuting\tSELECT * FROM orders WHERE id > 5\n"
)

PG_OUTPUT = (
    "101|postgres|appdb|active|42|SELECT a || b FROM t WHERE x = 1\n"
    "102|svc|appdb|idle|0|\n"
)


# ---------------------------------------------------------------------------
# list_processes — parsing / normalization
# ---------------------------------------------------------------------------

class TestListProcessesMySQL:
    def test_parses_and_normalizes_rows(self, monkeypatch):
        calls = _stub_exec(monkeypatch, output=MYSQL_OUTPUT)
        result = DbProcessService.list_processes({'engine': 'mysql'})

        assert 'error' not in result
        procs = result['processes']
        assert len(procs) == 2  # header row skipped

        sleep_row = procs[0]
        assert sleep_row == {
            'id': 5, 'user': 'root', 'db': None, 'command': 'Sleep',
            'time_s': 120, 'state': '', 'query': '',
        }

        query_row = procs[1]
        assert query_row['id'] == 12
        assert query_row['db'] == 'shop'
        assert query_row['command'] == 'Query'
        assert query_row['time_s'] == 3
        assert query_row['state'] == 'executing'
        assert query_row['query'] == 'SELECT * FROM orders WHERE id > 5'

        # Sent SHOW FULL PROCESSLIST through the choke-point
        assert calls[0]['sql'] == 'SHOW FULL PROCESSLIST;'

    def test_empty_output(self, monkeypatch):
        _stub_exec(monkeypatch, output='')
        result = DbProcessService.list_processes({'engine': 'mysql'})
        assert result == {'processes': []}


class TestListProcessesPostgres:
    def test_parses_pipe_separated_rows(self, monkeypatch):
        calls = _stub_exec(monkeypatch, output=PG_OUTPUT)
        result = DbProcessService.list_processes({'engine': 'postgresql'})

        procs = result['processes']
        assert len(procs) == 2

        active = procs[0]
        assert active['id'] == 101
        assert active['user'] == 'postgres'
        assert active['db'] == 'appdb'
        assert active['state'] == 'active'
        assert active['time_s'] == 42
        # Query containing '|' survives (bounded split, query column last)
        assert active['query'] == 'SELECT a || b FROM t WHERE x = 1'

        idle = procs[1]
        assert idle['id'] == 102
        assert idle['time_s'] == 0
        assert idle['query'] == ''

        assert 'pg_stat_activity' in calls[0]['sql']
        assert 'pg_backend_pid()' in calls[0]['sql']

    def test_skips_malformed_lines(self, monkeypatch):
        _stub_exec(monkeypatch, output='garbage\nnot|enough|fields\n')
        result = DbProcessService.list_processes({'engine': 'postgresql'})
        assert result == {'processes': []}


class TestListProcessesErrors:
    @pytest.mark.parametrize('engine', ['sqlite', 'mongodb', 'redis', None, ''])
    def test_unsupported_engine(self, engine):
        result = DbProcessService.list_processes({'engine': engine})
        assert result == {'error': 'unsupported engine', 'code': 'unsupported_engine'}

    def test_exec_failure_surfaces_error(self, monkeypatch):
        _stub_exec(monkeypatch, success=False, error='docker: command not found')
        result = DbProcessService.list_processes({'engine': 'mysql', 'container': 'db1'})
        assert result == {'error': 'docker: command not found'}

    def test_exec_failure_without_message(self, monkeypatch):
        _stub_exec(monkeypatch, success=False)
        result = DbProcessService.list_processes({'engine': 'postgresql'})
        assert result == {'error': 'failed to list processes'}


# ---------------------------------------------------------------------------
# kill_process — SQL generation + pid validation
# ---------------------------------------------------------------------------

class TestKillProcess:
    def test_mysql_kill_sql(self, monkeypatch):
        calls = _stub_exec(monkeypatch)
        result = DbProcessService.kill_process({'engine': 'mysql'}, 42)
        assert result == {'success': True, 'pid': 42}
        assert calls[0]['sql'] == 'KILL 42;'

    def test_pg_terminate_sql(self, monkeypatch):
        calls = _stub_exec(monkeypatch, output='t\n')
        result = DbProcessService.kill_process({'engine': 'postgresql'}, '77')
        assert result == {'success': True, 'pid': 77}
        assert calls[0]['sql'] == 'SELECT pg_terminate_backend(77);'

    def test_pg_terminate_false_result(self, monkeypatch):
        _stub_exec(monkeypatch, output='f\n')
        result = DbProcessService.kill_process({'engine': 'postgresql'}, 77)
        assert 'error' in result

    @pytest.mark.parametrize('bad_pid', ['abc', '42; DROP TABLE x', None, '1 OR 1=1', ''])
    def test_pid_must_be_integer(self, monkeypatch, bad_pid):
        calls = _stub_exec(monkeypatch)
        result = DbProcessService.kill_process({'engine': 'mysql'}, bad_pid)
        assert result == {'error': 'pid must be an integer'}
        assert calls == []  # never reached the exec pathway

    def test_unsupported_engine(self, monkeypatch):
        calls = _stub_exec(monkeypatch)
        result = DbProcessService.kill_process({'engine': 'sqlite'}, 1)
        assert result == {'error': 'unsupported engine', 'code': 'unsupported_engine'}
        assert calls == []

    def test_exec_failure(self, monkeypatch):
        _stub_exec(monkeypatch, success=False, error='access denied')
        result = DbProcessService.kill_process({'engine': 'mysql'}, 5)
        assert result == {'error': 'access denied'}


# ---------------------------------------------------------------------------
# _exec_sql routing (host vs docker) — stub the DatabaseService pathways
# ---------------------------------------------------------------------------

class TestExecSqlRouting:
    # The engine x host dispatch itself now lives in db_exec (plan 75 §G5), so
    # these patch the executors where db_exec reaches them. _exec_sql stays the
    # seam this service's own tests stub.
    def test_host_mysql_routes_to_mysql_execute(self, monkeypatch):
        seen = {}

        def fake(query, database=None, root_password=None):
            seen.update({'query': query, 'root_password': root_password})
            return {'success': True, 'output': '', 'error': None}

        from app.services import db_exec
        monkeypatch.setattr(db_exec.DatabaseService, 'mysql_execute', staticmethod(fake))
        result = DbProcessService._exec_sql({'engine': 'mysql', 'password': 's3c'}, 'SELECT 1;')
        assert result['success'] is True
        assert seen == {'query': 'SELECT 1;', 'root_password': 's3c'}

    def test_host_pg_routes_to_pg_execute(self, monkeypatch):
        seen = {}

        def fake(query, database='postgres', user='postgres'):
            seen['query'] = query
            return {'success': True, 'output': '', 'error': None}

        from app.services import db_exec
        monkeypatch.setattr(db_exec.DatabaseService, 'pg_execute', staticmethod(fake))
        result = DbProcessService._exec_sql({'engine': 'postgresql'}, 'SELECT 2;')
        assert result['success'] is True
        assert seen['query'] == 'SELECT 2;'

    def test_docker_mysql_routes_to_docker_execute(self, monkeypatch):
        seen = {}

        def fake(container_name, query, **kwargs):
            seen.update({'container': container_name, 'query': query,
                         'user': kwargs.get('user'), 'password': kwargs.get('password')})
            return {'success': True, 'output': '', 'error': None}

        from app.services import db_exec
        monkeypatch.setattr(db_exec.DatabaseService, 'docker_mysql_execute', staticmethod(fake))
        result = DbProcessService._exec_sql(
            {'engine': 'mysql', 'container': 'wp-db', 'user': 'wp', 'password': 'pw'}, 'SHOW FULL PROCESSLIST;')
        assert result['success'] is True
        assert seen == {'container': 'wp-db', 'query': 'SHOW FULL PROCESSLIST;', 'user': 'wp', 'password': 'pw'}

    def test_docker_pg_clean_error_when_docker_missing(self, fake_subprocess):
        fake_subprocess.script(['docker'], raises=FileNotFoundError('docker not found'))
        result = DbProcessService._exec_sql({'engine': 'postgresql', 'container': 'pg1'}, 'SELECT 1;')
        assert result['success'] is False
        assert 'docker not found' in result['error']

    def test_docker_pg_sets_on_error_stop(self, fake_subprocess):
        """The drift that made three dispatchers worth collapsing into one.

        This service's private docker-postgres branch built its own psql argv
        and never passed ``-v ON_ERROR_STOP=1``, so psql exited 0 for a
        statement the server had rejected and the caller was told it worked.
        """
        fake_subprocess.script(['docker'])
        DbProcessService._exec_sql({'engine': 'postgresql', 'container': 'pg1'}, 'SELECT 1;')
        argv = fake_subprocess.argv_for(['docker'])
        assert 'ON_ERROR_STOP=1' in argv

    def test_an_unknown_engine_is_reported_not_guessed(self, fake_subprocess):
        result = DbProcessService._exec_sql({'engine': 'oracle'}, 'SELECT 1;')
        assert result['success'] is False
        assert 'oracle' in result['error']
        assert fake_subprocess.commands() == []   # nothing was run on a guess


# ---------------------------------------------------------------------------
# API endpoints — auth + wiring (service stubbed)
# ---------------------------------------------------------------------------

@pytest.fixture
def user_headers(app):
    """Headers for a non-admin user (kill must be forbidden)."""
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash

    with app.app_context():
        user = User(
            email='plainuser@test.local',
            username='plainuser',
            password_hash=generate_password_hash('testpass'),
            role='user',
            is_active=True,
        )
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=user.id)
    return {'Authorization': f'Bearer {token}'}


class TestProcessAPI:
    def test_list_requires_auth(self, client):
        resp = client.get('/api/v1/databases/mysql/processes')
        assert resp.status_code == 401

    def test_list_host_processes(self, client, auth_headers, monkeypatch):
        seen = {}

        def fake(target):
            seen.update(target)
            return {'processes': [{'id': 1, 'user': 'root', 'db': None, 'state': '',
                                   'command': 'Sleep', 'time_s': 9, 'query': ''}]}

        monkeypatch.setattr(DbProcessService, 'list_processes', staticmethod(fake))
        resp = client.get('/api/v1/databases/postgresql/processes', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()['processes'][0]['id'] == 1
        assert seen['engine'] == 'postgresql'
        assert seen.get('container') is None

    def test_list_docker_processes_builds_target(self, client, auth_headers, monkeypatch):
        seen = {}

        def fake(target):
            seen.update(target)
            return {'processes': []}

        monkeypatch.setattr(DbProcessService, 'list_processes', staticmethod(fake))
        resp = client.get(
            '/api/v1/databases/docker/wp-db/processes?type=mysql&user=wp',
            headers={**auth_headers, 'X-DB-Password': 'pw'})
        assert resp.status_code == 200
        assert seen['engine'] == 'mysql'
        assert seen['container'] == 'wp-db'
        assert seen['user'] == 'wp'
        assert seen['password'] == 'pw'

    def test_list_unsupported_engine_is_400(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(
            DbProcessService, 'list_processes',
            staticmethod(lambda target: {'error': 'unsupported engine', 'code': 'unsupported_engine'}))
        resp = client.get('/api/v1/databases/docker/c1/processes?type=redis', headers=auth_headers)
        assert resp.status_code == 400
        assert resp.get_json() == {'error': 'unsupported engine'}

    def test_list_exec_failure_is_502(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(
            DbProcessService, 'list_processes',
            staticmethod(lambda target: {'error': 'connection refused'}))
        resp = client.get('/api/v1/databases/mysql/processes', headers=auth_headers)
        assert resp.status_code == 502
        assert resp.get_json() == {'error': 'connection refused'}

    def test_kill_requires_auth(self, client):
        resp = client.post('/api/v1/databases/mysql/processes/5/kill')
        assert resp.status_code == 401

    def test_kill_requires_admin(self, client, user_headers, monkeypatch):
        called = []
        monkeypatch.setattr(
            DbProcessService, 'kill_process',
            staticmethod(lambda target, pid: called.append(pid) or {'success': True, 'pid': pid}))
        resp = client.post('/api/v1/databases/mysql/processes/5/kill', headers=user_headers)
        assert resp.status_code == 403
        assert called == []

    def test_kill_host_process_as_admin(self, client, auth_headers, monkeypatch):
        seen = {}

        def fake(target, pid):
            seen.update({'target': target, 'pid': pid})
            return {'success': True, 'pid': pid}

        monkeypatch.setattr(DbProcessService, 'kill_process', staticmethod(fake))
        resp = client.post('/api/v1/databases/mysql/processes/42/kill', headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json() == {'success': True, 'pid': 42}
        assert seen['target']['engine'] == 'mysql'
        assert seen['pid'] == 42

    def test_kill_docker_process_as_admin(self, client, auth_headers, monkeypatch):
        seen = {}

        def fake(target, pid):
            seen.update({'target': target, 'pid': pid})
            return {'success': True, 'pid': pid}

        monkeypatch.setattr(DbProcessService, 'kill_process', staticmethod(fake))
        resp = client.post(
            '/api/v1/databases/docker/pg-db/processes/101/kill',
            headers=auth_headers, json={'type': 'postgresql', 'user': 'svc'})
        assert resp.status_code == 200
        assert seen['target']['engine'] == 'postgresql'
        assert seen['target']['container'] == 'pg-db'
        assert seen['target']['user'] == 'svc'
        assert seen['pid'] == 101

    def test_kill_pid_must_be_int_in_url(self, client, auth_headers):
        # <int:pid> converter rejects non-numeric pids at the routing layer
        resp = client.post('/api/v1/databases/mysql/processes/abc/kill', headers=auth_headers)
        assert resp.status_code in (404, 405)
