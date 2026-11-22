"""Fleet-wide READ routes obey the same workspace rule as /servers
(GHSA-qcjj-hf95-6rgw).

`test_server_workspace_access.py` sweeps every `<server_id>` route. The
routes here take no id in the path — they list, search or export across the
fleet, or take ids in the query string — so that sweep never reached them and
they answered from unfiltered `Server` / `ServerMetrics` queries.
"""
import re
from datetime import datetime, timedelta

import pytest

from factories import headers_for, make_server, make_user

NAME = 'frw-tenantb-billing-db'
HOST = 'frw-billing.internal'
IP = '10.99.77.5'
CONTAINER = 'frw-ledger-postgres'
TAG = 'frw-pci-scope'


@pytest.fixture
def setup(app):
    from app import db
    from app.models.metric_alert import MetricAlert, ServerAlertThreshold
    from app.models.server import ServerGroup, ServerMetrics
    from app.services.workspace_service import WorkspaceService

    admin = make_user(db, 'frw_admin', 'admin')
    member = make_user(db, 'frw_member', 'developer')
    outsider = make_user(db, 'frw_outsider', 'developer')
    viewer = make_user(db, 'frw_viewer', 'viewer')
    ws = WorkspaceService.create_workspace({'name': 'FRW'}, admin.id)
    WorkspaceService.add_member(ws.id, member.id)
    WorkspaceService.create_workspace({'name': 'FRW-out'}, outsider.id)

    # Groups are fleet-wide labels, so a foreign server can sit in one.
    group = ServerGroup(name='frw-group')
    db.session.add(group)
    db.session.commit()
    server = make_server(db, name=NAME, hostname=HOST, ip_address=IP,
                         status='online', tags=[TAG], workspace_id=ws.id,
                         group_id=group.id)
    # A flat week with a spike at the end: enough samples for the comparison
    # and export routes, and an outlier for the anomaly detector.
    now = datetime.utcnow()
    for i in range(30):
        last = i == 29
        db.session.add(ServerMetrics(
            server_id=server.id,
            timestamp=now - timedelta(minutes=(29 - i) * 20),
            cpu_percent=99.0 if last else 10.0 + (i % 2),
            memory_percent=88.2, disk_percent=91.4,
            extra={'containers': [{'name': CONTAINER, 'image': 'postgres:16',
                                   'status': 'running'}]}))
    db.session.add(MetricAlert(server_id=server.id, metric='cpu',
                               severity='critical', value=99.0, threshold=95.0))
    db.session.add(ServerAlertThreshold(server_id=server.id, metric='cpu'))
    db.session.add(ServerAlertThreshold(server_id=None, metric='disk'))
    db.session.commit()
    return {'server': server.id, 'group': group.id, 'admin': admin.id,
            'member': member.id, 'outsider': outsider.id, 'viewer': viewer.id}


def _leaks(setup, text):
    return [needle for needle in (setup['server'], NAME, HOST, IP, CONTAINER, TAG)
            if needle in text]


def _fleet_reads(sid, gid):
    return [
        f'/api/v1/servers/groups/{gid}',
        '/api/v1/servers/proxy/overview',
        '/api/v1/fleet-monitor/heatmap',
        f'/api/v1/fleet-monitor/comparison?ids={sid}&metric=cpu&period=24h',
        '/api/v1/fleet-monitor/alerts',
        f'/api/v1/fleet-monitor/alerts?server_id={sid}',
        '/api/v1/fleet-monitor/thresholds',
        f'/api/v1/fleet-monitor/thresholds?server_id={sid}',
        '/api/v1/fleet-monitor/anomalies',
        f'/api/v1/fleet-monitor/anomalies?server_id={sid}',
        '/api/v1/fleet-monitor/search?q=frw-',
        '/api/v1/fleet-monitor/search?q=10.99',
        '/api/v1/fleet-monitor/search?q=frw-ledger&type=container',
        '/api/v1/fleet-monitor/search?q=frw-pci&type=tag',
        f'/api/v1/fleet-monitor/export/csv?ids={sid}&metric=memory',
        f'/api/v1/fleet-monitor/export/json?ids={sid}&metric=cpu',
        '/api/v1/mobile/offline-cache',
    ]


# Developer-only reads: a viewer is refused outright, before any scoping.
_DEVELOPER_READS = ['/api/v1/servers/metrics/retention']


@pytest.mark.parametrize('who', ['outsider', 'viewer'])
def test_non_member_reads_nothing_about_a_foreign_server(client, setup, who):
    leaked = {}
    with _connected(setup['server']):
        for url in _fleet_reads(setup['server'], setup['group']) + _DEVELOPER_READS:
            resp = client.get(url, headers=headers_for(setup[who]))
            if who == 'viewer' and url in _DEVELOPER_READS:
                assert resp.status_code == 403, (url, resp.status_code)
            else:
                assert resp.status_code == 200, (url, resp.status_code)
            found = _leaks(setup, resp.get_data(as_text=True))
            if found:
                leaked[url] = found
    assert not leaked, leaked


@pytest.mark.parametrize('who', ['member', 'admin'])
def test_member_and_admin_still_read_their_server(client, setup, who):
    """The fix narrows, it must not blank the page for people who belong."""
    missing = []
    with _connected(setup['server']):
        for url in _fleet_reads(setup['server'], setup['group']) + _DEVELOPER_READS:
            resp = client.get(url, headers=headers_for(setup[who]))
            assert resp.status_code == 200, (url, resp.status_code)
            if not _leaks(setup, resp.get_data(as_text=True)):
                missing.append(url)
    assert not missing, missing


def test_global_thresholds_stay_visible_to_everyone(client, setup):
    """A threshold with no server is fleet policy, not a tenant's data."""
    rows = client.get('/api/v1/fleet-monitor/thresholds',
                      headers=headers_for(setup['outsider'])).get_json()
    assert [r['metric'] for r in rows] == ['disk']
    assert rows[0]['server_id'] is None


def test_mobile_summary_counts_only_accessible_servers(client, setup):
    def count(who):
        return client.get('/api/v1/mobile/summary',
                          headers=headers_for(setup[who])).get_json()['servers']
    assert count('member') == count('outsider') + 1
    assert count('admin') == count('member')


def test_comparison_keeps_accessible_ids_and_drops_foreign_ones(client, setup, app):
    """A mixed id list answers for the caller's own servers only — the foreign
    id is dropped silently, exactly as an unknown id already was."""
    from app import db
    from app.models.server import ServerMetrics
    own = make_server(db, name='frw-shared-box')
    db.session.add(ServerMetrics(server_id=own.id, cpu_percent=5.0))
    db.session.commit()
    body = client.get(
        f"/api/v1/fleet-monitor/comparison?ids={setup['server']},{own.id}",
        headers=headers_for(setup['outsider'])).get_json()
    assert [s['server_id'] for s in body['series']] == [own.id]


def _connected(server_id):
    from unittest.mock import patch
    return patch('app.services.agent_registry.agent_registry.get_connected_servers',
                 return_value=[server_id])


def test_group_member_count_stops_at_accessible_servers(client, setup):
    def count(who):
        rows = client.get('/api/v1/servers/groups',
                          headers=headers_for(setup[who])).get_json()
        return next(r['server_count'] for r in rows if r['id'] == setup['group'])
    assert (count('outsider'), count('member'), count('admin')) == (0, 1, 1)


def _fleet_get_rules(app, setup):
    """Every GET route with no path parameter, plus the ones keyed by a server
    group. `<server_id>` routes have their own sweep in
    test_server_workspace_access.py."""
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith('/api/v1/') or 'GET' not in rule.methods:
            continue
        url = rule.rule.replace('<group_id>', setup['group'])
        if '<' in url:
            continue
        yield url


def test_no_fleet_read_route_leaks_a_foreign_server(app, client, setup):
    """Sweep: whatever list/search/export/summary route exists — including one
    added after this test — a developer outside the workspace never gets the
    foreign server's id, name, hostname, IP, tag or container back. The
    member test above proves those needles are reachable through the same
    routes, so an empty answer here is the filter and not a blank fixture."""
    sid = setup['server']
    # Ask for the foreign server every way a route might accept: an id-taking
    # route answers for it, a search route matches it, the rest ignore it.
    query = f'?ids={sid}&server_id={sid}&q=frw-&query=frw-&search=frw-'
    leaks = []
    with _connected(sid):
        for rule in sorted(set(_fleet_get_rules(app, setup))):
            url = rule + query
            try:
                resp = client.get(url, headers=headers_for(setup['outsider']))
            except Exception as exc:  # a route that crashes is not a leak
                if re.search('frw-', str(exc)):
                    leaks.append(f'GET {url} raised with the server in it')
                continue
            found = _leaks(setup, resp.get_data(as_text=True))
            if found:
                leaks.append(f'GET {url} -> {resp.status_code} {found}')
    assert not leaks, '\n'.join(leaks)
