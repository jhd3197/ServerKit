"""A developer outside a server's workspace must not operate it over REST —
the same rule the Socket.IO server rooms and terminal already enforce."""
import re
from unittest.mock import patch

import pytest

from factories import headers_for, make_server, make_user


@pytest.fixture
def setup(app):
    from app import db
    from app.services.workspace_service import WorkspaceService
    admin = make_user(db, 'swa_admin', 'admin')
    member = make_user(db, 'swa_member', 'developer')
    outsider = make_user(db, 'swa_outsider', 'developer')
    ws = WorkspaceService.create_workspace({'name': 'SWA'}, admin.id)
    WorkspaceService.add_member(ws.id, member.id)
    mine = WorkspaceService.create_workspace({'name': 'SWA-out'}, outsider.id)
    server = make_server(db, name='swa-box', workspace_id=ws.id)
    return {'server': server.id, 'member': member.id, 'outsider': outsider.id,
            'admin': admin.id, 'own_ws': mine.id}


_ROUTES = [
    ('post', '/api/v1/servers/{sid}/terminal', {}),
    ('post', '/api/v1/servers/{sid}/regenerate-token', {}),
    ('put', '/api/v1/servers/{sid}/workspace', {'workspace_id': '{own_ws}'}),
]


@pytest.mark.parametrize('method,url,body', _ROUTES)
def test_outsider_is_refused(client, setup, method, url, body):
    from app.models.server import Server
    body = {k: setup['own_ws'] if v == '{own_ws}' else v for k, v in body.items()}
    before = Server.query.get(setup['server'])
    token_hash, ws_id = before.registration_token_hash, before.workspace_id
    with patch('app.services.terminal_service.TerminalService.create_session',
               return_value={'success': True}) as create:
        resp = getattr(client, method)(url.format(sid=setup['server']), json=body,
                                       headers=headers_for(setup['outsider']))
    assert resp.status_code == 404
    create.assert_not_called()
    after = Server.query.get(setup['server'])
    assert after.registration_token_hash == token_hash
    assert after.workspace_id == ws_id


@pytest.mark.parametrize('who', ['member', 'admin'])
def test_member_and_admin_can_open_terminal(client, setup, who):
    with patch('app.services.terminal_service.TerminalService.create_session',
               return_value={'success': True, 'session_id': 's1'}) as create:
        resp = client.post(f"/api/v1/servers/{setup['server']}/terminal", json={},
                           headers=headers_for(setup[who]))
    assert resp.status_code == 200
    create.assert_called_once()


def test_member_can_regenerateheaders_for(client, setup):
    resp = client.post(f"/api/v1/servers/{setup['server']}/regenerate-token",
                       json={}, headers=headers_for(setup['member']))
    assert resp.status_code == 200
    assert resp.get_json()['registration_token']


def test_default_workspace_servers_stay_shared(client, setup):
    """Servers created without a context land in the Default workspace, which
    nobody joins — developers keep operating them."""
    from app import db
    from app.services.workspace_service import WorkspaceService
    server = make_server(db, name='swa-default',
                         workspace_id=WorkspaceService.ensure_default_workspace().id)
    with patch('app.services.terminal_service.TerminalService.create_session',
               return_value={'success': True, 'session_id': 's2'}):
        resp = client.post(f'/api/v1/servers/{server.id}/terminal', json={},
                           headers=headers_for(setup['outsider']))
    assert resp.status_code == 200


def _server_id_rules(app):
    """Every route that takes a server id, across all blueprints."""
    for rule in app.url_map.iter_rules():
        if '<server_id>' not in rule.rule or not rule.rule.startswith('/api/v1/'):
            continue
        for method in sorted(rule.methods - {'HEAD', 'OPTIONS'}):
            yield method.lower(), rule.rule


def test_every_server_route_refuses_an_outsider(app, client, setup):
    """Sweep: no `<server_id>` route lets a non-member operate or read a
    foreign workspace's server. A route that 400s/503s before the check
    would show up here as a non-404/403."""
    from app.services.workspace_service import WorkspaceService
    leaks = []
    with patch('app.services.remote_command_dispatcher.dispatch_agent_command',
               side_effect=AssertionError('agent reached')), \
            patch.object(WorkspaceService, 'can_access_server',
                         wraps=WorkspaceService.can_access_server) as gate:
        for method, rule in _server_id_rules(app):
            url = rule.replace('<server_id>', setup['server'])
            url = re.sub(r'<int:[^>]+>', '1', url)
            url = re.sub(r'<[^>]+>', 'x', url)
            gate.reset_mock()
            resp = getattr(client, method)(url, json={},
                                           headers=headers_for(setup['outsider']))
            if resp.status_code not in (401, 403, 404):
                leaks.append(f'{method.upper()} {rule} -> {resp.status_code}')
            elif resp.status_code == 404 and not gate.called:
                leaks.append(f'{method.upper()} {rule} -> 404 without the workspace check')
    assert not leaks, '\n'.join(leaks)


def test_overview_and_list_hide_foreign_servers(client, setup):
    for url in ('/api/v1/servers', '/api/v1/servers/overview'):
        body = client.get(url, headers=headers_for(setup['outsider'])).get_json()
        rows = body if isinstance(body, list) else body['servers']
        assert setup['server'] not in {r['id'] for r in rows}, url
        body = client.get(url, headers=headers_for(setup['member'])).get_json()
        rows = body if isinstance(body, list) else body['servers']
        assert setup['server'] in {r['id'] for r in rows}, url


def test_update_server_validates_allowed_ips(client, setup):
    resp = client.put(f"/api/v1/servers/{setup['server']}",
                      json={'allowed_ips': ['not-an-ip']},
                      headers=headers_for(setup['member']))
    assert resp.status_code == 400


def test_docker_target_picker_hides_foreign_servers(client, setup):
    from app import db
    from app.models.server import Server
    Server.query.get(setup['server']).status = 'online'
    db.session.commit()
    ids = {s['id'] for s in client.get('/api/v1/servers/available',
                                       headers=headers_for(setup['outsider'])).get_json()}
    assert setup['server'] not in ids


def test_timeline_hides_foreign_server(client, setup):
    resp = client.get(f"/api/v1/servers/{setup['server']}/timeline",
                      headers=headers_for(setup['outsider']))
    assert resp.status_code == 404
    assert resp.get_json()['code'] == 'server_timeline_server_not_found'
