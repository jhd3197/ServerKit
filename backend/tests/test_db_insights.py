"""Database insights parsing and the pg_stat_statements switch (plan 86 §A3).

Hermetic: SQL is scripted through the services' exec seams. The real-engine
round trip is test_real_db_insights_docker.py.
"""
import pytest

from app.exceptions import ValidationError
from app.services.db_config_tuner_service import DbConfigTunerService
from app.services.db_insights_service import DbInsightsService

PG = {'engine': 'postgresql', 'container': 'pg'}
MY = {'engine': 'mariadb', 'container': 'db'}


def _script(monkeypatch, answers, cls=DbInsightsService):
    seen = []

    def fake(target, sql):
        seen.append(sql)
        for needle, result in answers:
            if needle in sql:
                return result
        raise AssertionError(f'unscripted SQL: {sql}')
    monkeypatch.setattr(cls, '_exec_sql', staticmethod(fake) if cls is DbInsightsService
                        else classmethod(lambda c, t, s: fake(t, s)))
    return seen


def ok(output=''):
    return {'success': True, 'output': output, 'error': None}


def fail(error='boom'):
    return {'success': False, 'output': '', 'error': error}


def test_postgres_without_the_extension_says_what_turns_it_on(monkeypatch):
    _script(monkeypatch, [('pg_stat_database', ok('100\t7\t990\t10\t0\t0\n'))])
    result = DbInsightsService.insights(PG)
    assert result['connections'] == {'in_use': 7, 'max': 100}
    assert result['cache_hit_ratio'] == pytest.approx(0.99)
    assert result['top_queries_available'] is False
    assert result['top_queries_reason'] == 'pg_stat_statements is not enabled'
    assert result['can_enable'] is True


def test_postgres_top_queries_parse_even_with_tabs_in_sql(monkeypatch):
    _script(monkeypatch, [
        ('pg_stat_database', ok('100\t3\t5\t5\t1\t1\n')),
        ('FROM pg_stat_statements', ok('42\t1234.5\t29.39\t42\tSELECT a\tb FROM t\n')),
    ])
    (q,) = DbInsightsService.insights(PG)['top_queries']
    assert q == {'calls': 42, 'total_ms': 1234.5, 'mean_ms': 29.39, 'rows': 42,
                 'query': 'SELECT a\tb FROM t'}


def test_mysql_hit_ratio_and_a_closed_performance_schema(monkeypatch):
    _script(monkeypatch, [
        ('SHOW GLOBAL STATUS', ok('Innodb_buffer_pool_read_requests\t1000\n'
                                  'Innodb_buffer_pool_reads\t50\nThreads_connected\t4\n')),
        ('@@max_connections', ok('151\n')),
        ('events_statements_summary_by_digest', fail("Table doesn't exist")),
    ])
    result = DbInsightsService.insights(MY)
    assert result['engine'] == 'mysql'
    assert result['connections'] == {'in_use': 4, 'max': 151}
    # 1000 logical reads, 50 of them missed and went to disk.
    assert result['cache_hit_ratio'] == pytest.approx(950 / 1000)
    assert result['top_queries_available'] is False
    assert 'performance_schema' in result['top_queries_reason']


def test_empty_counters_mean_no_ratio_not_zero(monkeypatch):
    _script(monkeypatch, [('pg_stat_database', ok('100\t1\t0\t0\t0\t0\n'))])
    assert DbInsightsService.insights(PG)['cache_hit_ratio'] is None


@pytest.mark.parametrize('target,error', [
    ({'engine': 'sqlite', 'container': 'x'}, 'unsupported engine'),
    ({'engine': 'postgresql'}, 'insights need a Docker database container'),
])
def test_refused_targets(target, error):
    assert DbInsightsService.insights(target)['error'] == error


class TestEnablePgStatStatements:
    @pytest.fixture
    def tuner(self, monkeypatch, tmp_path):
        monkeypatch.setattr(DbConfigTunerService, '_linux_supported', classmethod(lambda cls: True))
        monkeypatch.setattr(DbConfigTunerService, 'STATE_DIR', str(tmp_path))
        monkeypatch.setattr(DbConfigTunerService, '_snapshot_container_file',
                            classmethod(lambda cls, t, p, s: str(tmp_path / 'previous-1.auto.conf')))
        restarts = []
        monkeypatch.setattr(DbConfigTunerService, '_restart_and_verify',
                            classmethod(lambda cls, t, b, p, s: restarts.append(s) or
                                        {'success': True, 'restarted': True}))
        return restarts

    def test_existing_preloads_are_kept(self, monkeypatch, tuner):
        seen = _script(monkeypatch, [
            ('SHOW shared_preload_libraries', ok('auto_explain, timescaledb\n')),
            ('SHOW data_directory', ok('/var/lib/postgresql/data\n')),
            ('ALTER SYSTEM', ok()), ('CREATE EXTENSION', ok()),
        ], cls=DbConfigTunerService)

        DbConfigTunerService.enable_pg_stat_statements(PG)

        alter = next(s for s in seen if s.startswith('ALTER SYSTEM'))
        assert alter == ("ALTER SYSTEM SET shared_preload_libraries = "
                         "'auto_explain, timescaledb, pg_stat_statements';")
        assert tuner == [{'shared_preload_libraries': 'auto_explain, timescaledb, pg_stat_statements'}]
        assert seen[-1] == 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;'

    def test_already_preloaded_only_creates_the_extension(self, monkeypatch, tuner):
        seen = _script(monkeypatch, [
            ('SHOW shared_preload_libraries', ok('pg_stat_statements\n')),
            ('CREATE EXTENSION', ok()),
        ], cls=DbConfigTunerService)
        result = DbConfigTunerService.enable_pg_stat_statements(PG)
        assert result['restarted'] is False and tuner == []
        assert not any(s.startswith('ALTER SYSTEM') for s in seen)

    def test_mysql_is_refused(self, tuner):
        with pytest.raises(ValidationError):
            DbConfigTunerService.enable_pg_stat_statements({'engine': 'mysql', 'container': 'db'})


def test_api(client, auth_headers, monkeypatch):
    _script(monkeypatch, [('pg_stat_database', ok('100\t2\t1\t1\t0\t0\n'))])
    ok_resp = client.get('/api/v1/databases/docker/pg/insights?type=postgresql',
                         headers={**auth_headers, 'X-DB-Password': 'x'})
    assert ok_resp.status_code == 200 and ok_resp.get_json()['connections']['max'] == 100
    bad = client.get('/api/v1/databases/docker/pg/insights?type=oracle', headers=auth_headers)
    assert bad.status_code == 400
