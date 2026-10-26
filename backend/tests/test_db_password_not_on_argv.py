"""Database passwords travel in the child's environment, never on its command
line: argv is world-readable (ps, /proc/<pid>/cmdline), so `-p<pw>` or
`docker exec -e MYSQL_PWD=<pw>` handed the root DB password to every local
account — a compromised site's PHP-FPM user included."""
from unittest.mock import patch

import pytest

PW = 's3cr3t-root'


class Spy:
    def __init__(self):
        self.calls = []

    def __call__(self, cmd, *args, **kwargs):
        self.calls.append((cmd, kwargs.get('env') or {}))
        return {'success': True, 'output': '', 'error': '', 'returncode': 0}

    def assert_hidden(self, var):
        # Only the calls that log in; a `<client> --version` probe runs first.
        logins = [(cmd, env) for cmd, env in self.calls if '--version' not in cmd]
        assert logins
        for cmd, env in logins:
            assert not any(PW in str(part) for part in cmd), cmd
            assert env.get(var) == PW


def test_docker_exec_mysql_and_pg():
    from app.services import database_service as mod
    from app.services.database_service import DatabaseService
    spy = Spy()
    with patch.object(mod, 'run_checked', spy):
        DatabaseService.docker_mysql_execute('db1', 'SELECT 1', password=PW)
    spy.assert_hidden('MYSQL_PWD')
    assert 'MYSQL_PWD' in spy.calls[-1][0]  # bare name: docker copies our env

    spy = Spy()
    with patch.object(mod, 'run_checked', spy):
        DatabaseService.docker_pg_execute('pg1', 'SELECT 1', password=PW)
    spy.assert_hidden('PGPASSWORD')


def test_backup_and_restore(tmp_path):
    from app.services import backup_service as mod
    from app.services.backup_service import BackupService
    spy = Spy()
    with patch.object(mod, 'is_command_available', lambda c: True), \
            patch.object(mod, 'run_to_gzip', spy):
        BackupService._backup_database_internal(
            'mysql', 'shop', str(tmp_path), {'user': 'root', 'password': PW})
    spy.assert_hidden('MYSQL_PWD')

    dump = tmp_path / 'shop.sql.gz'
    dump.write_bytes(b'')
    spy = Spy()
    with patch.object(mod, 'is_command_available', lambda c: True), \
            patch.object(mod, 'run_from_gzip', spy), \
            patch.object(BackupService, '_resolve_for_restore', lambda p: (p, None)):
        BackupService.restore_database(str(dump), 'mysql', 'shop', user='root', password=PW)
    spy.assert_hidden('MYSQL_PWD')


@pytest.mark.parametrize('call', [
    lambda S: S._run_mysql('SELECT 1', password=PW),
])
def test_db_sync(call):
    from app.services import db_sync_service as mod
    spy = Spy()
    with patch.object(mod, 'run_checked', spy):
        call(mod.DatabaseSyncService)
    spy.assert_hidden('MYSQL_PWD')
