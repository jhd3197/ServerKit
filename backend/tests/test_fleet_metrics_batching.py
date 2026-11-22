"""Fleet readers share one bounded query without changing latest semantics."""

from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from sqlalchemy import event

from app import db
from app.models.server import Server, ServerMetrics
from factories import make_user
from app.services.fleet_monitor_service import FleetMonitorService
from app.services.server_metrics_service import latest_metrics_by_server


@contextmanager
def metric_queries():
    queries = []

    def before(conn, cursor, statement, params, context, executemany):
        if 'server_metrics' in statement.lower():
            queries.append(statement)

    engine = db.engine
    event.listen(engine, 'before_cursor_execute', before)
    try:
        yield queries
    finally:
        event.remove(engine, 'before_cursor_execute', before)


def seed_server(name):
    server = Server(name=name, hostname=f'{name}.test', status='online')
    db.session.add(server)
    db.session.flush()
    return server


def seed_sample(server, when, value):
    sample = ServerMetrics(
        server_id=server.id, timestamp=when, cpu_percent=value,
        memory_percent=value + 1, disk_percent=value + 2,
        container_running=int(value), container_count=int(value) + 1,
    )
    db.session.add(sample)
    db.session.flush()
    return sample


def test_latest_order_scope_missing_rows_and_ties(app, db_session):
    server = seed_server('ordering')
    missing = seed_server('missing')
    excluded = seed_server('excluded')
    now = datetime(2026, 9, 5, 12)
    seed_sample(server, now, 10)
    tie = seed_sample(server, now, 20)
    late = seed_sample(server, now - timedelta(hours=1), 30)
    seed_sample(excluded, now, 99)
    db.session.commit()
    ids = [server.id, missing.id]

    assert latest_metrics_by_server(ids) == {server.id: tie}
    assert latest_metrics_by_server(ids, order_by='id') == {server.id: late}
    with metric_queries() as queries:
        assert latest_metrics_by_server([]) == {}
    assert not queries
    with pytest.raises(ValueError):
        latest_metrics_by_server(ids, order_by='invalid')


@pytest.mark.parametrize('size', [1, 8, 31])
@pytest.mark.parametrize('reader', ['heatmap', 'prometheus', 'overview', 'list'])
def test_each_fleet_reader_uses_one_metrics_query(
    app, client, auth_headers, db_session, size, reader,
):
    now = datetime(2026, 9, 5, 12)
    for index in range(size):
        server = seed_server(f'fleet-{index}')
        seed_sample(server, now, 10)
        # Arrives later, but describes an older observation.
        seed_sample(server, now - timedelta(hours=1), 20)
    db.session.commit()
    admin = make_user(db, role='admin')

    with metric_queries() as queries:
        if reader == 'heatmap':
            result = FleetMonitorService.get_fleet_heatmap(admin)
            assert len(result) == size
            assert all(row['cpu'] == 10 for row in result)
        elif reader == 'prometheus':
            result = FleetMonitorService.get_prometheus_metrics()
            samples = [line for line in result.splitlines() if line.startswith('serverkit_cpu_percent{')]
            assert len(samples) == size
            assert all(line.endswith(' 10.0') for line in samples)
        elif reader == 'overview':
            response = client.get('/api/v1/servers/overview', headers=auth_headers)
            assert response.status_code == 200
            result = response.get_json()
            assert result['summary']['running_containers'] == size * 10
            assert all(row['cpu_percent'] == 10 for row in result['servers'])
        else:
            response = client.get('/api/v1/servers', headers=auth_headers)
            assert response.status_code == 200
            result = response.get_json()
            assert len(result) == size
            assert all(row['metrics']['cpu_percent'] == 20 for row in result)
    assert len(queries) == 1


def test_heatmap_keeps_group_scope_and_missing_metrics(app, db_session):
    from app.models.server import ServerGroup

    group = ServerGroup(name='selected')
    db.session.add(group)
    db.session.flush()
    included = seed_server('included')
    included.group_id = group.id
    seed_server('excluded')
    db.session.commit()
    result = FleetMonitorService.get_fleet_heatmap(make_user(db, role='admin'), group.id)
    assert len(result) == 1
    assert result[0]['id'] == included.id
    assert result[0]['group_name'] == 'selected'
    assert result[0]['cpu'] is None
    assert result[0]['last_update'] is None
