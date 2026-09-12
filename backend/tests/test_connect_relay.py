"""Unit tests for the relay transport helpers (no network)."""
import base64
import json
import socket
import ssl
import time
import types

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from websockets.exceptions import ConnectionClosedOK
from websockets.frames import Close

from app.services import connect_client, connect_commands, connect_keys


@pytest.fixture
def config_dir(tmp_path, monkeypatch):
    """Point the panel config dir at a temp dir for connect*.json files."""
    monkeypatch.setattr(connect_client.paths, 'SERVERKIT_CONFIG_DIR',
                        str(tmp_path))
    return tmp_path


# ---------- close-code / failure classification ----------


def test_close_reason_for_code_maps_relay_codes():
    assert connect_client.close_reason_for_code(4001) == 'auth_failed_signature'
    assert connect_client.close_reason_for_code(4002) == 'auth_failed_clock_skew'
    assert connect_client.close_reason_for_code(4003) == 'version_unsupported'
    assert connect_client.close_reason_for_code(4004) == 'auth_failed_signature'
    assert connect_client.close_reason_for_code(4009) == 'revoked'


def test_close_reason_for_unknown_code_is_heartbeat_timeout():
    assert connect_client.close_reason_for_code(1006) == 'heartbeat_timeout'
    assert connect_client.close_reason_for_code(None) == 'heartbeat_timeout'


def test_classify_ws_failure():
    closed = ConnectionClosedOK(Close(4002, 'auth_failed_clock_skew'), None)
    assert connect_client._classify_ws_failure(closed) == 'auth_failed_clock_skew'
    assert connect_client._classify_ws_failure(ssl.SSLError('x')) == 'tls_error'
    assert connect_client._classify_ws_failure(
        socket.gaierror('x')) == 'dns_error'
    assert connect_client._classify_ws_failure(
        ValueError('x')) == 'relay_unreachable'


# ---------- backoff / flap detection ----------


def test_backoff_doubles_to_cap():
    no_jitter = lambda a, b: 0.0
    assert connect_client.backoff_delay(0, rand=no_jitter) == 1.0
    assert connect_client.backoff_delay(1, rand=no_jitter) == 2.0
    assert connect_client.backoff_delay(5, rand=no_jitter) == 32.0
    assert connect_client.backoff_delay(10, rand=no_jitter) == 60.0
    assert connect_client.backoff_delay(100, rand=no_jitter) == 60.0


def test_backoff_jitter_stays_within_bounds():
    for attempt in (0, 3, 10):
        for _ in range(50):
            delay = connect_client.backoff_delay(attempt)
            base = min(60.0, 2 ** attempt)
            assert base * 0.75 <= delay <= base * 1.25


def test_is_flapping():
    now = 1000.0
    recent = [now - i for i in range(7)]
    assert connect_client.is_flapping(recent, now=now)
    assert not connect_client.is_flapping(recent[:6], now=now)
    # Attempts outside the window don't count.
    stale = [now - 700 - i for i in range(10)]
    assert not connect_client.is_flapping(stale, now=now)
    assert connect_client.is_flapping(recent + stale, now=now)


# ---------- URL / hello helpers ----------


def test_relay_http_base_and_poll_url():
    assert connect_client.relay_http_base(
        'wss://relay.serverkit.ai/v1/device') == 'https://relay.serverkit.ai'
    assert connect_client.relay_http_base(
        'ws://127.0.0.1:8791/v1/device') == 'http://127.0.0.1:8791'
    assert connect_client.poll_url_for('wss://relay.serverkit.ai/v1/device') == \
        'https://relay.serverkit.ai/v1/device/poll'


def test_build_hello_signature_verifies(config_dir):
    private_key, pubkey_hex, _fpr = connect_keys.load_or_create_keypair()
    hello = connect_client.build_hello(private_key, 'dev_123', '1.9.22')

    assert hello['t'] == 'hello'
    assert hello['device_id'] == 'dev_123'
    assert hello['proto'] == 1
    assert hello['client_version'] == '1.9.22'
    assert isinstance(hello['ts'], int)

    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PublicKey,
    )
    pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pubkey_hex))
    message = f"dev_123|{hello['ts']}|{hello['nonce']}".encode()
    pub.verify(bytes.fromhex(hello['sig']), message)  # raises if invalid


def test_hello_headers_use_relay_names(config_dir):
    private_key, _pub, _fpr = connect_keys.load_or_create_keypair()
    hello = connect_client.build_hello(private_key, 'dev_123', '1.9.22')
    headers = connect_client.hello_headers(hello)
    assert headers['X-ServerKit-Device'] == 'dev_123'
    assert headers['X-ServerKit-Sig'] == hello['sig']
    assert headers['X-ServerKit-Ts'] == str(hello['ts'])
    assert headers['X-ServerKit-Proto'] == '1'
    assert headers['X-ServerKit-Client-Version'] == '1.9.22'


# ---------- state file / status merge ----------


def test_state_file_roundtrip_preserves_last_connected(config_dir):
    connect_client._write_state_file('online', None, transport='ws',
                                     relay_instance='i-1',
                                     last_connected_at='2026-01-01T00:00:00+00:00')
    connect_client._write_state_file('paired_offline', 'heartbeat_timeout',
                                     transport=None)
    saved = connect_client._read_state_file()
    assert saved['state'] == 'paired_offline'
    assert saved['state_reason'] == 'heartbeat_timeout'
    assert saved['transport'] is None
    # Not overwritten by the later, offline transition.
    assert saved['last_connected_at'] == '2026-01-01T00:00:00+00:00'
    assert saved['relay_instance'] == 'i-1'
    assert saved['updated_at']


def test_status_merges_state_file(config_dir):
    connect_client._write_connect_file({
        'device_id': 'dev_1', 'org_slug': 'acme', 'name': 'web-1',
        'relay_url': 'wss://relay.example.com/v1/device', 'scopes': [],
        'fingerprint': 'a1b2c3d4e5f67890',
        'key_path': str(config_dir / 'connect_device_key.pem'),
        'cloud_url': 'https://app.serverkit.ai',
        'paired_at': '2026-01-01T00:00:00+00:00',
    })
    connect_client._write_state_file('online', None, transport='ws',
                                     relay_instance='i-1',
                                     last_connected_at='2026-01-02T00:00:00+00:00')

    state = connect_client.status()
    assert state['state'] == 'online'
    assert state['transport'] == 'ws'
    assert state['relay_instance'] == 'i-1'
    assert state['last_connected_at'] == '2026-01-02T00:00:00+00:00'
    assert state['key_present'] is False  # no key written in this test


def test_status_without_state_file_is_never_connected(config_dir):
    connect_keys.load_or_create_keypair()
    connect_client._write_connect_file({
        'device_id': 'dev_1', 'org_slug': 'acme', 'name': 'web-1',
        'relay_url': 'wss://relay.example.com/v1/device', 'scopes': [],
        'fingerprint': 'a1b2c3d4e5f67890',
        'key_path': connect_keys.default_key_path(),
        'cloud_url': 'https://app.serverkit.ai',
        'paired_at': '2026-01-01T00:00:00+00:00',
    })
    state = connect_client.status()
    assert state['state'] == 'paired_offline'
    assert state['state_reason'] == 'never_connected'


def test_disconnect_removes_state_file(config_dir):
    connect_client._write_connect_file({'device_id': 'dev_1'})
    connect_client._write_state_file('online', None, transport='ws')
    result = connect_client.disconnect()
    assert result['state'] == 'unpaired'
    assert not (config_dir / 'connect.json').exists()
    assert not (config_dir / 'connect-state.json').exists()
    assert connect_client.status()['state'] == 'unpaired'


def test_state_file_is_valid_json_on_disk(config_dir):
    connect_client._write_state_file('degraded', 'relay_unreachable',
                                     transport='poll')
    with open(connect_client.state_file_path()) as f:
        saved = json.load(f)
    assert saved['state'] == 'degraded'


# ---------- client loop state transitions (no network: sessions stubbed) ----------


def _wait_state(want, timeout=5.0):
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        saved = connect_client._read_state_file()
        if saved.get('state') == want:
            return saved
        time.sleep(0.05)
    raise AssertionError(f'timed out waiting for {want}; '
                         f'have {connect_client._read_state_file()}')


def _fake_config(monkeypatch):
    monkeypatch.setattr(connect_client, '_relay_config', lambda: {
        'device_id': 'dev_1', 'relay_url': 'ws://127.0.0.1:9/v1/device',
        'private_key': None, 'key_path': '/nope',
    })
    monkeypatch.setattr(connect_client, 'backoff_delay',
                        lambda attempt, **kw: 0.01)


def test_ws_refused_falls_back_to_poll_degraded(config_dir, monkeypatch):
    """A proxy-smelling WS failure switches to the poll loop as degraded."""
    _fake_config(monkeypatch)
    monkeypatch.setattr(connect_client.RelayClient, '_ws_session',
                        lambda self, cfg: 'refused:relay_unreachable')

    def fake_poll(self, cfg, ws_retry_at):
        # The real _poll_session sets transport='poll' and writes the degraded
        # state; the loop has already written it by the time we're called.
        assert connect_client._read_state_file()['state'] == 'degraded'
        assert connect_client._read_state_file()['transport'] == 'poll'
        return 'stopped'

    monkeypatch.setattr(connect_client.RelayClient, '_poll_session', fake_poll)

    client = connect_client.RelayClient()
    client.start()
    client._thread.join(timeout=5)
    assert not client._thread.is_alive()


def test_drop_after_ready_reports_heartbeat_timeout(config_dir, monkeypatch):
    """An established connection that drops un cleanly -> paired_offline."""
    _fake_config(monkeypatch)
    calls = []

    def fake_ws(self, cfg):
        calls.append(1)
        return 'drop:heartbeat_timeout' if len(calls) == 1 else 'stopped'

    monkeypatch.setattr(connect_client.RelayClient, '_ws_session', fake_ws)

    client = connect_client.RelayClient()
    client.start()
    saved = _wait_state('paired_offline')
    assert saved['state_reason'] == 'heartbeat_timeout'
    client._thread.join(timeout=5)
    assert not client._thread.is_alive()


def test_revoked_is_terminal(config_dir, monkeypatch):
    """Close 4009 stops the loop for good, and stop() must not overwrite it."""
    _fake_config(monkeypatch)
    monkeypatch.setattr(connect_client.RelayClient, '_ws_session',
                        lambda self, cfg: 'revoked')

    client = connect_client.RelayClient()
    client.start()
    saved = _wait_state('revoked')
    client._thread.join(timeout=5)
    assert not client._thread.is_alive()
    assert saved['state_reason'] == 'revoked'

    client.stop()
    assert connect_client._read_state_file()['state'] == 'revoked'


def test_flap_logging_fires_after_limit(config_dir, monkeypatch, caplog):
    _fake_config(monkeypatch)
    # FLAP_LIMIT is 6: 8 quick drops exceed it inside the window.
    outcomes = iter(['drop:heartbeat_timeout'] * 8 + ['stopped'])
    monkeypatch.setattr(
        connect_client.RelayClient, '_ws_session',
        lambda self, cfg: next(outcomes, 'stopped'))

    client = connect_client.RelayClient()
    with caplog.at_level('WARNING', logger='app.services.connect_client'):
        client.start()
        client._thread.join(timeout=10)
    assert any('flapping' in r.message for r in caplog.records)


# ---------- command JWKS refresh ----------


def _command_signer():
    """(sign(claims) -> token, jwks) for a throwaway command key, kid 'k-new'."""
    key = Ed25519PrivateKey.generate()
    raw = key.public_key().public_bytes_raw()
    jwks = {'keys': [{'kty': 'OKP', 'crv': 'Ed25519', 'kid': 'k-new',
                      'x': base64.urlsafe_b64encode(raw).decode().rstrip('=')}]}
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    def sign(**claims):
        body = {'cmd_id': 'cmd_1', 'device_id': 'dev_abc123',
                'action': 'policy.report', 'args': {}, 'scopes': ['policy.report'],
                'nonce': f'n{time.time_ns()}', 'iat': int(time.time()),
                'exp': int(time.time()) + 600}
        body.update(claims)
        return jwt.encode(body, private_pem, algorithm='EdDSA',
                          headers={'kid': 'k-new'})

    return sign, jwks


def test_an_unknown_command_key_triggers_one_jwks_refetch(monkeypatch):
    """ServerKit Cloud mints each signing key on first use, so a command can
    legitimately arrive signed with a key this connection's JWKS predates."""
    sign, fresh = _command_signer()
    client = connect_client.RelayClient()
    client._jwks = {'keys': [{'kid': 'k-old'}]}
    calls = []
    monkeypatch.setattr(client, '_load_jwks',
                        lambda cfg: calls.append(cfg) or setattr(client, '_jwks', fresh))
    client._refresh_jwks_for(sign(), {'cloud_url': 'https://cloud.test'})
    assert len(calls) == 1
    assert client._jwks is fresh


def test_a_known_command_key_does_not_refetch(monkeypatch):
    sign, fresh = _command_signer()
    client = connect_client.RelayClient()
    client._jwks = fresh
    monkeypatch.setattr(client, '_load_jwks',
                        lambda cfg: pytest.fail('refetched a known key'))
    client._refresh_jwks_for(sign(), {'cloud_url': 'https://cloud.test'})


def test_a_garbage_command_token_is_left_to_verification(monkeypatch):
    client = connect_client.RelayClient()
    client._jwks = None
    monkeypatch.setattr(client, '_load_jwks',
                        lambda cfg: pytest.fail('refetched a garbage token'))
    client._refresh_jwks_for('not-a-jwt', {})
    client._refresh_jwks_for(None, {})


def test_run_command_refreshes_a_stale_jwks_and_acks(config_dir, monkeypatch):
    """The full path: stale JWKS at connect, command signed with the key
    ServerKit Cloud minted afterwards — refetch, verify, ack, run."""
    sign, fresh = _command_signer()
    connect_commands.NONCES._seen.clear()
    monkeypatch.setattr(connect_client, '_read_connect_file',
                        lambda: {'device_id': 'dev_abc123',
                                 'cloud_url': 'https://cloud.test'})
    client = connect_client.RelayClient()
    client._jwks = {'keys': [{'kid': 'k-old'}]}
    monkeypatch.setattr(client, '_load_jwks',
                        lambda cfg: setattr(client, '_jwks', fresh))
    sent = []
    ws = types.SimpleNamespace(send=lambda raw: sent.append(json.loads(raw)))
    client._run_command(ws, {'p': {'jwt': sign()}})
    assert sent and sent[0]['p']['state'] == 'running'


# ---------- close-reason frames (the edge strips numeric close codes) ----------


def test_a_session_close_frame_with_revoked_reason_raises():
    """Production edge proxies answer 1005 for the relay's 4009, so revocation
    arrives as a frame. Stream closes still route by stream id."""
    client = connect_client.RelayClient()
    with pytest.raises(connect_client.RelayRevoked):
        client._handle_frame(types.SimpleNamespace(),
                             json.dumps({'t': 'close', 'reason': 'revoked'}))
    # Other session-level reasons and ordinary stream closes do not raise.
    client._handle_frame(types.SimpleNamespace(),
                         json.dumps({'t': 'close', 'reason': 'version_unsupported'}))
    client._handle_frame(types.SimpleNamespace(),
                         json.dumps({'s': 'met1', 't': 'close', 'p': {'ok': True}}))


def test_a_close_frame_during_hello_is_the_refusal_reason(monkeypatch):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    class FakeWs:
        def __init__(self, frame):
            self.frame = frame

        def send(self, raw):
            pass

        def recv(self, timeout=None):
            return json.dumps(self.frame)

        def close(self):
            pass

    cfg = {'private_key': Ed25519PrivateKey.generate(), 'device_id': 'dev_abc123',
           'relay_url': 'wss://relay.test/v1/device'}
    import websockets.sync.client as ws_client
    monkeypatch.setattr(ws_client, 'connect', lambda *a, **k: FakeWs(
        {'t': 'close', 'reason': 'revoked'}))
    with pytest.raises(connect_client.RelayRevoked):
        connect_client.RelayClient()._ws_connect(cfg)
    monkeypatch.setattr(ws_client, 'connect', lambda *a, **k: FakeWs(
        {'t': 'close', 'reason': 'version_unsupported'}))
    with pytest.raises(connect_client._HandshakeRefused) as exc:
        connect_client.RelayClient()._ws_connect(cfg)
    assert 'version_unsupported' in str(exc.value)


def test_a_revoked_frame_mid_session_ends_it_as_revoked(monkeypatch):
    calls = []

    class FakeWs:
        def recv(self, timeout=None):
            if not calls:
                calls.append(1)
                return json.dumps({'t': 'close', 'reason': 'revoked'})
            raise TimeoutError()

        def send(self, raw):
            pass

        def close(self):
            pass

    client = connect_client.RelayClient()
    client.running = True
    monkeypatch.setattr(client, '_ws_connect', lambda cfg: FakeWs())
    monkeypatch.setattr(client, '_set_state', lambda *args, **kwargs: None)
    for name in ('_check_for_update', '_load_jwks', '_publish_storage',
                 '_publish_policy', '_publish_inventory'):
        monkeypatch.setattr(client, name, lambda *args: None)
    assert client._ws_session({}) == 'revoked'


def test_revocation_seen_in_poll_mode_stops_the_loop(config_dir, monkeypatch):
    """_poll_session reports 'revoked'; the loop must write the state and stop,
    not fall through and re-probe the websocket forever (the 2026-09-12 lab
    run: a panel behind the code-stripping edge never observed revocation)."""
    _fake_config(monkeypatch)
    monkeypatch.setattr(connect_client.RelayClient, '_ws_session',
                        lambda self, cfg: 'refused:relay_unreachable')
    monkeypatch.setattr(connect_client.RelayClient, '_poll_session',
                        lambda self, cfg, retry_at: 'revoked')
    client = connect_client.RelayClient()
    client.start()
    client._thread.join(timeout=5)
    assert not client._thread.is_alive()
    assert connect_client._read_state_file()['state'] == 'revoked'
