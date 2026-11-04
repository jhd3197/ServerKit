"""Agent permission levels: report endpoint, level reporting, dispatch gate,
silence sweep, service-check alerts and install commands."""
import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app import db
from app.models.audit_log import AuditLog
from app.models.metric_alert import MetricAlert
from app.models.server import Server
from app.services import agent_health_service, permission_levels
from app.services.agent_registry import ConnectedAgent, agent_registry

REPORT = '/api/v1/agent/report'
SECRET = 'test-secret'


@pytest.fixture
def server(app, monkeypatch):
    monkeypatch.setattr(Server, 'get_api_secret', lambda self: SECRET)
    key, _ = Server.generate_api_credentials()
    srv = Server(name='web-1', agent_id=secrets.token_hex(8))
    srv.set_api_key(key)
    db.session.add(srv)
    db.session.commit()
    srv.test_key = key
    return srv


def _post(client, srv, body=None, ts=None, nonce=None, secret=SECRET, raw=None):
    body = body if body is not None else {
        'permission_level': 'monitor', 'interval_seconds': 60,
        'metrics': {'cpu_percent': 12.5, 'memory_percent': 40.0, 'disk_percent': 55.0,
                    'uptime_seconds': 99, 'load1': 0.3},
        'service_checks': []}
    raw = raw if raw is not None else json.dumps(body).encode()
    ts = str(int(time.time())) if ts is None else str(ts)
    nonce = nonce or secrets.token_hex(16)
    sig = hmac.new(secret.encode(),
                   f'{ts}.{nonce}.{hashlib.sha256(raw).hexdigest()}'.encode(),
                   hashlib.sha256).hexdigest()
    return client.post(REPORT, data=raw, content_type='application/json', headers={
        'X-Agent-Key': srv.test_key, 'X-Timestamp': ts, 'X-Nonce': nonce,
        'X-Signature': sig})


def test_good_signature_updates_server(client, server):
    resp = _post(client, server)
    assert resp.status_code == 200
    assert resp.get_json() == {'ok': True, 'interval_seconds': 60}
    srv = db.session.get(Server, server.id)
    assert srv.status == 'online' and srv.last_report_at is not None
    assert srv.permission_level == 'monitor'
    assert 'commands' not in resp.get_json()


def test_bad_signature_rejected(client, server):
    assert _post(client, server, secret='wrong').status_code == 401


def test_stale_timestamp_rejected(client, server):
    assert _post(client, server, ts=int(time.time()) - 400).status_code == 401


def test_replayed_nonce_rejected(client, server):
    nonce = secrets.token_hex(16)
    assert _post(client, server, nonce=nonce).status_code == 200
    assert _post(client, server, nonce=nonce).status_code == 401


def test_oversize_body_rejected(client, server):
    assert _post(client, server, raw=b'{"x":"' + b'a' * 70000 + b'"}').status_code == 413


def test_invalid_level_rejected(client, server):
    assert _post(client, server, body={'permission_level': 'root'}).status_code == 400


def test_level_persisted_and_escalation_audited(client, server):
    _post(client, server, body={'permission_level': 'monitor'})
    _post(client, server, body={'permission_level': 'full'})
    rows = AuditLog.query.filter_by(action='server.permission_level_changed').order_by(AuditLog.id).all()
    details = [r.get_details() for r in rows]
    assert [(d['from'], d['to'], d['escalation']) for d in details] == [
        (None, 'monitor', False), ('monitor', 'full', True)]
    assert db.session.get(Server, server.id).permission_level == 'full'


def test_no_api_sets_level(client, server, auth_headers):
    resp = client.put(f'/api/v1/servers/{server.id}', headers=auth_headers,
                      json={'permission_level': 'full', 'name': 'x'})
    assert resp.status_code in (200, 400)
    assert db.session.get(Server, server.id).permission_level is None
    writers = [r.rule for r in client.application.url_map.iter_rules()
               if 'level' in r.rule and r.methods & {'POST', 'PUT', 'PATCH'}]
    assert writers == []


def _connect(server_id):
    agent_registry._agents[server_id] = ConnectedAgent(
        server_id=server_id, socket_id='s', session_token='t',
        connected_at=datetime.utcnow(), last_heartbeat=datetime.utcnow(),
        ip_address='1.1.1.1', agent_version='1', transport='poll')


@pytest.mark.parametrize('level,action,refused', [
    ('monitor', 'firewall:status', True),
    ('monitor', 'docker:container:list', True),
    ('protect', 'docker:container:list', True),
    ('protect', 'system:exec', True),
    ('protect', 'firewall:status', False),
    ('protect', 'cloudflare:origin_lock:apply', False),
    ('protect', 'credential_update', False),
    ('full', 'system:exec', False),
    (None, 'system:exec', False),
])
def test_refusal_table(level, action, refused):
    assert bool(permission_levels.refusal(level, action)) is refused


@pytest.mark.parametrize('level', ['monitor', 'protect'])
def test_send_command_gate(server, level):
    server.permission_level = level
    db.session.commit()
    _connect(server.id)
    try:
        result = agent_registry.send_command(server.id, 'system:exec', {})
    finally:
        agent_registry._agents.pop(server.id, None)
    assert result['code'] == 'LEVEL_DENIED'
    assert result['error'].startswith(f'server is in {level.title()} mode')


def test_protect_allowlist_matches_documented_contract():
    doc = Path(__file__).parents[2] / 'docs/AGENT_PERMISSION_LEVELS.md'
    block = re.search(r'```text allowlist\n(.*?)```', doc.read_text(), re.S).group(1)
    assert set(block.split()) == set(permission_levels.PROTECT_ACTIONS)


def test_silent_monitor_goes_offline_with_one_alert(server):
    server.permission_level = 'monitor'
    server.status = 'online'
    server.last_report_at = datetime.utcnow() - timedelta(minutes=20)
    db.session.commit()
    assert agent_health_service.sweep_silent_reporters() == [server.id]
    assert agent_health_service.sweep_silent_reporters() == []
    assert db.session.get(Server, server.id).status == 'offline'
    assert MetricAlert.query.filter_by(metric='offline', status='active').count() == 1


def test_recent_monitor_stays_online(server):
    server.permission_level, server.status = 'monitor', 'online'
    server.last_report_at = datetime.utcnow() - timedelta(minutes=2)
    db.session.commit()
    assert agent_health_service.sweep_silent_reporters() == []


def _checks(status):
    return {'permission_level': 'monitor', 'service_checks': [
        {'name': 'mysql', 'kind': 'database', 'status': status, 'detail': 'refused',
         'checked_at': '2026-01-01T00:00:00Z'}]}


def test_service_down_alert_dedupes_and_resolves(client, server):
    _post(client, server, body=_checks('up'))
    assert MetricAlert.query.count() == 0
    _post(client, server, body=_checks('down'))
    _post(client, server, body=_checks('down'))
    alert = MetricAlert.query.one()
    assert alert.status == 'active' and 'mysql' in alert.detail and 'web-1' in alert.detail
    _post(client, server, body=_checks('up'))
    assert MetricAlert.query.one().status == 'resolved'


def test_degraded_to_down_alerts_and_report_recovers_offline(client, server):
    _post(client, server, body=_checks('degraded'))
    assert MetricAlert.query.count() == 0
    _post(client, server, body=_checks('down'))
    assert MetricAlert.query.filter_by(status='active').count() == 1
    agent_health_service.mark_offline(server, 'test')
    db.session.commit()
    server.status = 'offline'
    db.session.commit()
    _post(client, server, body=_checks('down'))
    assert MetricAlert.query.filter_by(metric='offline', status='resolved').count() == 1


def test_install_instructions_include_level(client, server, auth_headers):
    server.set_registration_token('sk_reg_x')
    db.session.commit()
    data = client.get(f'/api/v1/servers/install-instructions/{server.id}?level=protect',
                      headers=auth_headers).get_json()
    assert data['permission_level'] == 'protect'
    assert '--level protect' in data['linux']['one_liner']
    assert '-Level protect' in data['windows']['one_liner']


def test_token_records_requested_level(client, server, auth_headers):
    client.post(f'/api/v1/servers/{server.id}/regenerate-token', headers=auth_headers,
                json={'requested_level': 'protect'})
    assert db.session.get(Server, server.id).requested_permission_level == 'protect'
