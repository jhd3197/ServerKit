"""Socket authorization must hold both when joining and during delivery."""
import pytest
from flask_jwt_extended import create_refresh_token

from app import sockets as sk
from app.models.deployment_job import DeploymentJob
from factories import make_user, make_application, headers_for, access_token_for


@pytest.fixture
def clients(app):
    opened = []

    def connect(user=None, token=None):
        client = sk.socketio.test_client(app, auth={
            'token': token or access_token_for(user),
        })
        opened.append(client)
        if client.is_connected():
            client.get_received()
        return client

    yield connect
    for client in opened:
        if client.is_connected():
            client.disconnect()


@pytest.mark.parametrize('kind', ['pending', 'refresh', 'no-expiry'])
def test_socket_rejects_non_session_tokens(db_session, clients, kind):
    user = make_user(db_session, role='admin')
    if kind == 'pending':
        token = access_token_for(user, additional_claims={'2fa_pending': True})
    elif kind == 'refresh':
        token = create_refresh_token(identity=user.id)
    else:
        token = access_token_for(user, expires_delta=False)
    assert not clients(token=token).is_connected()


def test_other_user_room_cannot_receive_notifications(db_session, clients):
    user = make_user(db_session, role='viewer')
    other = make_user(db_session)
    sock = clients(user)
    sock.emit('join_room', {'room': sk.rooms.user_room(other.id)})
    assert any(e['name'] == 'error' for e in sock.get_received())
    sk.socketio.emit('private', {'secret': 'foreign'}, room=sk.rooms.user_room(other.id))
    assert sock.get_received() == []
    sk.socketio.emit('private', {'secret': 'own'}, room=sk.rooms.user_room(user.id))
    assert sock.get_received()[0]['name'] == 'private'


def test_app_and_deploy_rooms_follow_resource_access(db_session, clients):
    user = make_user(db_session, role='viewer')
    own = make_application(db_session, user_id=user.id)
    foreign = make_application(db_session)
    for application in (own, foreign):
        db_session.session.add(DeploymentJob(id=f'd-{application.id}', kind='test', app_id=application.id))
    db_session.session.commit()
    sock = clients(user)
    for application, allowed in ((own, True), (foreign, False)):
        job_id = f'd-{application.id}'
        for event, data in [
            ('join_room', {'room': sk.rooms.app_logs_room(application.id)}),
            ('join_room', {'room': sk.rooms.deploy_room(job_id)}),
            ('join_room', {'room': sk.rooms.run_room('deploy', job_id)}),
            ('subscribe_deploy', {'job_id': job_id}),
            ('subscribe_run', {'run_kind': 'deploy', 'run_id': job_id}),
        ]:
            sock.emit(event, data)
            events = sock.get_received()
            assert any(e['name'] in ('joined', 'subscribed') for e in events) is allowed
            assert any(e['name'] == 'error' for e in events) is not allowed
            if event == 'subscribe_deploy':
                room = sk.rooms.deploy_room(job_id)
            elif event == 'subscribe_run':
                room = sk.rooms.run_room('deploy', job_id)
            else:
                room = data['room']
            sk.socketio.emit('delivery-proof', {'ok': True}, room=room)
            assert any(e['name'] == 'delivery-proof' for e in sock.get_received()) is allowed


def test_requester_can_watch_appless_deploy_but_not_missing_or_unknown_runs(db_session, clients):
    user = make_user(db_session, role='developer')
    db_session.session.add(DeploymentJob(id='own', kind='test', requested_by=user.id))
    db_session.session.commit()
    sock = clients(user)
    sock.emit('subscribe_deploy', {'job_id': 'own'})
    assert sock.get_received()[0]['name'] == 'subscribed'
    for kind, rid in [('deploy', 'missing'), ('unknown', 'own'), ('job', 'own')]:
        sock.emit('subscribe_run', {'run_kind': kind, 'run_id': rid})
        assert sock.get_received()[0]['name'] == 'error'


def test_host_and_foreign_container_logs_denied_before_io(db_session, clients, monkeypatch):
    user = make_user(db_session, role='viewer')
    foreign = make_application(db_session)
    monkeypatch.setattr(sk.log_streamer, 'start_stream', lambda *a: pytest.fail('host I/O reached'))
    monkeypatch.setattr(sk.DockerService, 'get_all_app_containers', lambda *a: pytest.fail('Docker reached'))
    sock = clients(user)
    for event, data in [('subscribe_logs', {'path': '/var/log/auth.log'}),
                        ('subscribe_container_logs', {'app_id': foreign.id})]:
        sock.emit(event, data)
        assert sock.get_received()[0]['name'] == 'error'


def test_server_job_and_terminal_require_operator_and_session_owner(db_session, clients, monkeypatch):
    from app.models.server import Server
    from app.services.terminal_service import TerminalService
    server = Server(name='test', id='server-1')
    db_session.session.add(server)
    operator = make_user(db_session, role='developer')
    viewer = make_user(db_session, role='viewer')
    other = make_user(db_session, role='developer')
    monkeypatch.setattr(TerminalService, 'get_session', lambda sid: {
        'server_id': server.id, 'user_id': operator.id,
    } if sid == 'session-1' else None)
    for user in (operator, viewer, other):
        sock = clients(user)
        sock.emit('join_room', {'room': sk.rooms.server_channel_room(server.id, 'job:job-1')})
        assert sock.get_received()[0]['name'] == ('error' if user == viewer else 'joined')
        sk.socketio.emit('server_stream', {'channel': 'job:job-1'},
                         room=sk.rooms.server_channel_room(server.id, 'job:job-1'))
        assert any(e['name'] == 'server_stream' for e in sock.get_received()) is (user != viewer)
        for event, data in [
            ('subscribe_terminal', {'session_id': 'session-1'}),
            ('join_room', {'room': sk.rooms.server_terminal_room(server.id, 'session-1')}),
        ]:
            sock.emit(event, data)
            assert (sock.get_received()[0]['name'] != 'error') is (user == operator)
            sk.socketio.emit('server_stream', {'channel': 'terminal:session-1'},
                             room=sk.rooms.server_terminal_room(server.id, 'session-1'))
            assert any(e['name'] == 'server_stream' for e in sock.get_received()) is (user == operator)
        sock.emit('join_room', {'room': 'server_missing_job:job-1'})
        assert sock.get_received()[0]['name'] == 'error'


@pytest.mark.parametrize('change', ['disabled', 'role', 'revoke'])
def test_open_socket_is_revoked_before_next_delivery(db_session, clients, change):
    user = make_user(db_session, role='developer')
    sock = clients(user)
    if change == 'disabled':
        user.is_active = False
    elif change == 'role':
        user.role = 'viewer'
    else:
        user.revoke_sessions()
    db_session.session.commit()
    sk.socketio.emit('private', {'secret': 'must not arrive'}, room=sk.rooms.user_room(user.id))
    assert not sock.is_connected()


def test_removed_app_grant_stops_already_joined_stream(db_session, clients):
    from app.models.workspace import ResourceGrant
    user = make_user(db_session, role='viewer')
    application = make_application(db_session)
    grant = ResourceGrant(user_id=user.id, resource_type='application', resource_id=application.id, role='viewer')
    db_session.session.add(grant)
    db_session.session.commit()
    sock = clients(user)
    sock.emit('join_room', {'room': sk.rooms.app_logs_room(application.id)})
    assert sock.get_received()[0]['name'] == 'joined'
    db_session.session.delete(grant)
    db_session.session.commit()
    sk.emit_container_log(application.id, 'private')
    assert sock.get_received() == []


def test_status_broadcast_is_scoped_to_subscribers_and_visible_apps(db_session, clients, monkeypatch):
    from app.services import container_status_service as css
    user = make_user(db_session, role='viewer')
    own = make_application(db_session, user_id=user.id)
    foreign = make_application(db_session)
    sock, idle = clients(user), clients(user)
    monkeypatch.setattr(sk.container_status_loop, 'start', lambda **kwargs: None)
    monkeypatch.setattr(css, 'get_changed_app_statuses', lambda: [
        {'app_id': own.id, 'status': 'running'},
        {'app_id': foreign.id, 'status': 'running'},
    ])
    sock.emit('subscribe_container_status')
    sock.get_received()
    sk._container_status_tick()
    statuses = sock.get_received()[0]['args'][0]['statuses']
    assert [row['app_id'] for row in statuses] == [own.id]
    assert idle.get_received() == []


def test_metrics_only_reach_subscribers(db_session, clients, monkeypatch):
    user = make_user(db_session)
    sock, idle = clients(user), clients(user)
    monkeypatch.setattr(sk.metrics_loop, 'start', lambda **kwargs: None)
    monkeypatch.setattr(sk.SystemService, 'get_all_metrics', lambda: {'cpu': 1})
    sock.emit('subscribe_metrics')
    sock.get_received()
    sk._metrics_tick()
    assert sock.get_received()[0]['name'] == 'metrics'
    assert idle.get_received() == []


def test_run_polling_cannot_bypass_socket_gate(client, db_session):
    user = make_user(db_session, role='viewer')
    foreign = make_application(db_session)
    db_session.session.add(DeploymentJob(id='foreign', kind='test', app_id=foreign.id))
    db_session.session.commit()
    assert client.get('/api/v1/runs/deploy/foreign/logs', headers=headers_for(user)).status_code == 403


def test_logout_revokes_existing_socket(client, db_session, clients):
    user = make_user(db_session)
    token = access_token_for(user)
    sock = clients(token=token)
    response = client.post('/api/v1/auth/logout', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 200
    sk.socketio.emit('private', {'secret': 'must not arrive'}, room=sk.rooms.user_room(user.id))
    assert not sock.is_connected()


def test_operator_cannot_join_other_workspace_server(db_session, clients):
    from app.models.server import Server
    from app.models.workspace import Workspace
    workspace = Workspace(name='Private', slug='private')
    db_session.session.add(workspace)
    db_session.session.flush()
    server = Server(id='private-server', name='Private', workspace_id=workspace.id)
    db_session.session.add(server)
    user = make_user(db_session, role='developer')
    sock = clients(user)
    sock.emit('join_room', {'room': sk.rooms.server_channel_room(server.id, 'job:job-1')})
    assert sock.get_received()[0]['name'] == 'error'


def test_container_log_lines_reach_each_viewer_once(db_session, clients, monkeypatch):
    """Each subscriber runs its own `docker logs` process; its lines used to be
    sent to the shared app room, so two open viewers each saw every line twice
    and got the other's 200-line tail replayed into theirs."""
    import io
    user = make_user(db_session, role='viewer')
    application = make_application(db_session, user_id=user.id)
    procs = []

    class FakeProcess:
        def __init__(self, tag):
            self.stdout = io.StringIO(f'{tag}-1\n{tag}-2\n')
            procs.append(self)

        def terminate(self):
            pass

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(sk.DockerService, 'get_all_app_containers', lambda app: [{'name': 'c1'}])
    monkeypatch.setattr(sk.DockerService, 'get_app_container_id', lambda app: 'c1')
    monkeypatch.setattr(sk.DockerService, 'get_container_state', lambda cid: 'running')
    monkeypatch.setattr(sk.DockerService, 'parse_log_line', lambda line: {'message': line})
    first, second = clients(user), clients(user)
    for sock, tag in ((first, 'A'), (second, 'B')):
        monkeypatch.setattr(sk.DockerService, 'stream_container_logs',
                            lambda *a, _tag=tag, **k: FakeProcess(_tag))
        sock.emit('subscribe_container_logs', {'app_id': application.id})
    for info in list(sk.container_log_streams.values()):
        info['thread'].join(timeout=5)

    def lines(sock):
        return [e['args'][0]['line'] for e in sock.get_received() if e['name'] == 'container_log']

    assert lines(first) == ['A-1', 'A-2']
    assert lines(second) == ['B-1', 'B-2']
