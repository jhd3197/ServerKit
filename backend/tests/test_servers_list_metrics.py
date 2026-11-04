"""GET /servers must carry each server's latest metrics.

The servers list renders CPU/Memory/Disk gauges from `server.metrics`, the same
key the per-server status endpoint uses. The list endpoint never populated it —
`to_dict()` defaults to `include_metrics=False`, and even when asked it emits
`latest_metrics`, not `metrics` — so on a live panel every gauge cell fell back
to the "no data" dash. The mock fixtures used for screenshots *did* supply
`metrics`, which is exactly why the gap survived: the UI looked right in every
capture and was empty in production.
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models.server import Server, ServerMetrics


def _mk_server(name, status='online'):
    server = Server(name=name, hostname=f'{name}.test.local', status=status)
    db.session.add(server)
    db.session.flush()
    return server


def _mk_metrics(server, *, cpu, memory, disk, minutes_ago=0):
    row = ServerMetrics(
        server_id=server.id,
        timestamp=datetime.utcnow() - timedelta(minutes=minutes_ago),
        cpu_percent=cpu,
        memory_percent=memory,
        disk_percent=disk,
    )
    db.session.add(row)
    db.session.flush()
    return row


@pytest.fixture
def servers_with_metrics(app):
    with app.app_context():
        a = _mk_server('alpha')
        b = _mk_server('bravo')
        bare = _mk_server('charlie')          # never reported: must not get a key

        # Two samples for alpha — only the newest may be returned.
        _mk_metrics(a, cpu=10, memory=11, disk=12, minutes_ago=30)
        _mk_metrics(a, cpu=42, memory=64, disk=71, minutes_ago=0)
        _mk_metrics(b, cpu=5, memory=6, disk=7)
        db.session.commit()
        yield {'a': a.id, 'b': b.id, 'bare': bare.id}


def _by_name(payload):
    return {row['name']: row for row in payload}


def test_list_servers_includes_latest_metrics(client, auth_headers, servers_with_metrics):
    resp = client.get('/api/v1/servers', headers=auth_headers)
    assert resp.status_code == 200
    rows = _by_name(resp.get_json())

    # The exact key and field names the servers table reads.
    assert rows['alpha']['metrics']['cpu_percent'] == 42
    assert rows['alpha']['metrics']['memory_percent'] == 64
    assert rows['alpha']['metrics']['disk_percent'] == 71
    assert rows['bravo']['metrics']['cpu_percent'] == 5


def test_list_servers_omits_metrics_for_servers_that_never_reported(client, auth_headers, servers_with_metrics):
    rows = _by_name(client.get('/api/v1/servers', headers=auth_headers).get_json())
    # Absent, not a null/empty dict: the UI gates the gauge on truthiness and a
    # {} would render a 0% bar, which is a claim rather than "no data".
    assert 'metrics' not in rows['charlie']


def test_list_servers_metrics_are_batched_not_per_row(client, auth_headers, servers_with_metrics, app):
    """The lookup must not scale with the number of servers.

    `Server.metrics` is lazy='dynamic', so the obvious implementation costs one
    extra SELECT per row. Count statements against server_metrics and assert it
    stays flat as servers are added.
    """
    from sqlalchemy import event

    def count_metric_queries():
        seen = []

        def before(conn, cursor, statement, params, context, executemany):
            if 'server_metrics' in statement.lower():
                seen.append(statement)

        event.listen(db.engine, 'before_cursor_execute', before)
        try:
            client.get('/api/v1/servers', headers=auth_headers)
        finally:
            event.remove(db.engine, 'before_cursor_execute', before)
        return len(seen)

    baseline = count_metric_queries()

    with app.app_context():
        for i in range(6):
            extra = _mk_server(f'extra-{i}')
            _mk_metrics(extra, cpu=1, memory=2, disk=3)
        db.session.commit()

    assert count_metric_queries() == baseline, (
        'metrics lookup grew with the server count — it must stay batched'
    )


@pytest.mark.parametrize('param', ['from', 'to'])
def test_metrics_rejects_a_malformed_timestamp_with_400(app, client, auth_headers, param):
    with app.app_context():
        server = _mk_server('delta')
        db.session.commit()
        server_id = server.id

    resp = client.get(f'/api/v1/servers/{server_id}/metrics?{param}=not-a-date',
                      headers=auth_headers)

    assert resp.status_code == 400
    assert resp.get_json()['error']
