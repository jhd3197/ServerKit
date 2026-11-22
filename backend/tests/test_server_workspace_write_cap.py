"""GHSA-m72h-hc66-5jwx: a member capped to `viewer` in a workspace could still
mutate that workspace's servers (re-pair the agent, rename, edit the IP
allow-list), whatever the cap said.

Each refusal has its control: the viewer still reads, a member still writes.
"""
import re
from unittest.mock import patch

import pytest

from factories import headers_for, make_server, make_user


@pytest.fixture
def capped(app):
    from app import db
    from app.services.workspace_service import WorkspaceService
    admin = make_user(db, 'm72_admin', 'admin')
    read_only = make_user(db, 'm72_ro', 'developer')
    member = make_user(db, 'm72_member', 'developer')
    ws = WorkspaceService.create_workspace({'name': 'M72'}, admin.id)
    WorkspaceService.add_member(ws.id, read_only.id, role='viewer')
    WorkspaceService.add_member(ws.id, member.id)
    server = make_server(db, name='m72-box', workspace_id=ws.id)
    return {'server': server.id, 'read_only': read_only.id, 'member': member.id}


def test_workspace_viewer_cannot_mutate_a_server(client, capped):
    from app.models.server import Server
    sid = capped['server']
    before = Server.query.get(sid)
    token_hash, status = before.registration_token_hash, before.status
    headers = headers_for(capped['read_only'])
    calls = [
        client.post(f'/api/v1/servers/{sid}/regenerate-token', json={}, headers=headers),
        client.put(f'/api/v1/servers/{sid}', json={'name': 'renamed'}, headers=headers),
        client.put(f'/api/v1/servers/{sid}/allowed-ips', json={'allowed_ips': ['10.0.0.1']},
                   headers=headers),
    ]
    assert [resp.status_code for resp in calls] == [403, 403, 403]
    after = Server.query.get(sid)
    assert (after.name, after.registration_token_hash, after.status) == (
        'm72-box', token_hash, status)
    assert not after.allowed_ips


def test_workspace_viewer_still_reads_and_a_member_still_writes(client, capped):
    from app.models.server import Server
    sid = capped['server']
    assert client.get(f'/api/v1/servers/{sid}',
                      headers=headers_for(capped['read_only'])).status_code == 200
    resp = client.put(f'/api/v1/servers/{sid}', json={'name': 'm72-renamed'},
                      headers=headers_for(capped['member']))
    assert resp.status_code == 200 and Server.query.get(sid).name == 'm72-renamed'


def test_no_mutating_server_route_lets_a_workspace_viewer_through(app, client, capped):
    """Sweep: every mutating `<server_id>` route, present or future, refuses a
    member whose workspace role is viewer. Anything other than a refusal means
    the route acted (or validated input) before asking whether it may."""
    sid = capped['server']
    leaks = []
    with patch('app.services.remote_command_dispatcher.dispatch_agent_command',
               side_effect=AssertionError('agent reached')):
        for rule in app.url_map.iter_rules():
            if '<server_id>' not in rule.rule or not rule.rule.startswith('/api/v1/'):
                continue
            url = rule.rule.replace('<server_id>', sid)
            url = re.sub(r'<int:[^>]+>', '1', url)
            url = re.sub(r'<[^>]+>', 'x', url)
            for method in sorted(rule.methods - {'GET', 'HEAD', 'OPTIONS'}):
                resp = getattr(client, method.lower())(
                    url, json={}, headers=headers_for(capped['read_only']))
                if resp.status_code not in (401, 403):
                    leaks.append(f'{method} {rule.rule} -> {resp.status_code}')
    assert not leaks, '\n'.join(leaks)
