"""ServerKit Cloud connect — panel side.

Pairing: enroll with ServerKit Cloud, print the pairing code + fingerprint, poll with an
Ed25519 proof-of-possession until the user approves in the browser, then
write ``connect.json`` next to the panel config. The enrollment_secret is
kept in memory for the pairing session only — never written to disk or
logged.

Transport: once ``connect.json`` exists, a managed background thread (``RelayClient``,
started from app init via ``start_client_if_paired`` — same pattern as
linked_panel_agent) holds an outbound WebSocket to the relay: signed hello
(``device_id|ts|nonce``), a ``{"t":"ping"}`` heartbeat every 20 s, jittered
exponential backoff on drops, flap detection, and a long-poll fallback for
networks that break WebSockets. Runtime state is persisted to
``connect-state.json`` so `serverkit connect status` and the API show it
without the thread running. Stream opens this client does not implement are answered with close +
``unsupported``.

ServerKit Cloud endpoints (no session auth on the panel side):
  POST /api/pair/enroll   -> enrollment_id, enrollment_secret (shown once), code
  POST /api/pair/poll     -> 202 pending / 200 claimed (signed proof-of-possession)
  POST /api/pair/rotate   -> new code + expires_at
"""
import collections
import json
import logging
import os
import random
import secrets
import socket
import threading
import time
import urllib.parse
from datetime import datetime, timezone

import requests

from app import paths
from app.services import connect_keys
from app.services import (
    connect_commands, connect_inventory, connect_logs, connect_policy, connect_storage,
)
from app.services.connect_metrics import MetricsPublisher
from app.services.connect_updates import UpdateCheck, check_and_apply, fetch_jwks

logger = logging.getLogger(__name__)

DEFAULT_CLOUD_URL = 'https://app.serverkit.ai'
CONNECT_FILENAME = 'connect.json'
KEY_PATH_FIELD = 'key_path'

# Connection state enum — the same names ServerKit Cloud uses on the Device row.
STATES = ('unpaired', 'pairing', 'paired_offline', 'online', 'degraded', 'revoked')

HTTP_TIMEOUT_S = 20
DEFAULT_PAIR_TIMEOUT_S = 15 * 60  # generous: the user may walk away to log in
POLL_INTERVAL_S = 3.0
# How often the Storage Hub snapshot goes out unasked.
# Backup destinations change when a backup runs, not every minute; Cloud can
# ask for one immediately with the storage.report command.
STORAGE_INTERVAL_S = 300.0
# How often the policy facts document goes out unasked. Six
# hours is the plan's own number and the abuse control that goes with it;
# "Check now" is the policy.report command, not a shorter interval.
POLICY_INTERVAL_S = 6 * 3600.0
# The inventory: on connect, then every five minutes, which
# is the interval Cloud's own answer asks for. Diagnostics is a live reading
# and goes at most once a minute — and only while Cloud says `collect: true`,
# because process detail is a separate consent held there, not here. A
# refusal backs off to a slow retry so a consent granted later takes effect
# without a restart.
INVENTORY_INTERVAL_S = 300.0
DIAGNOSTICS_INTERVAL_S = 60.0
DIAGNOSTICS_REFUSED_RETRY_S = 15 * 60.0


def _peek_command_id(token) -> str:
    """The cmd_id out of an unverified command, used only to report *why* the
    command was refused. Nothing is run on the strength of it."""
    if not token:
        return ''
    try:
        import jwt
        return str(jwt.decode(token, options={'verify_signature': False}).get('cmd_id') or '')
    except Exception:
        return ''


class ConnectError(Exception):
    """Pairing failed in a way worth showing the operator verbatim."""


# ==================== Paths / config ====================


def resolve_cloud_url(cli_url: str = None) -> str:
    """--cloud flag > SERVERKIT_CLOUD_URL env var > DEFAULT_CLOUD_URL."""
    url = (cli_url or os.environ.get('SERVERKIT_CLOUD_URL') or DEFAULT_CLOUD_URL)
    url = url.strip().rstrip('/')
    if not url.startswith(('http://', 'https://')):
        raise ConnectError(f'ServerKit Cloud URL must start with http:// or https:// (got {url!r})')
    return url


def connect_file_path() -> str:
    return os.path.join(paths.SERVERKIT_CONFIG_DIR, CONNECT_FILENAME)


def _read_connect_file() -> dict:
    path = connect_file_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as exc:
        logger.warning('Could not read %s: %s', path, exc)
        return {}


def _write_connect_file(payload: dict):
    path = connect_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
        f.write('\n')
    if os.name != 'nt':
        os.chmod(path, 0o600)


# ==================== Facts ====================


def _panel_machine_id(fallback: str) -> str:
    """Stable id for this panel host: /etc/machine-id, else the device fingerprint."""
    for candidate in ('/etc/machine-id', '/var/lib/dbus/machine-id'):
        try:
            with open(candidate, 'r', encoding='utf-8') as f:
                value = f.read().strip()
            if value:
                return value
        except OSError:
            continue
    return fallback


def _gather_hosts() -> list:
    """One host entry (kind 'agent') per agent-backed Server this panel manages.

    Each entry carries every identifier we hold for that host: the agent's own
    id, and — from the pairing record the agent enrolled with — its machine id
    and key fingerprint. Cloud counts a host once per organisation however many
    panels report it, and it can only do that if it can recognise the same
    machine twice. Reporting agent_id alone is what let one agent under two
    panels take two slots.

    Without a Flask app context (or with the DB down) the honest answer is an
    empty list.
    """
    try:
        from flask import has_app_context
        if not has_app_context():
            return []
        from app.models.pending_agent import PendingAgent
        from app.models.server import Server
        servers = (
            Server.query
            .filter(Server.agent_id.isnot(None))
            .with_entities(Server.id, Server.agent_id, Server.hostname, Server.name)
            .all()
        )
        if not servers:
            return []
        # The enrolment row is where the agent's own machine id and key
        # fingerprint live; it is keyed by the server it was claimed onto.
        identities = {}
        for row in (PendingAgent.query
                    .filter(PendingAgent.claimed_server_id.in_([s.id for s in servers]))
                    .with_entities(PendingAgent.claimed_server_id,
                                   PendingAgent.machine_id,
                                   PendingAgent.pubkey_fpr)
                    .all()):
            identities[row.claimed_server_id] = (row.machine_id, row.pubkey_fpr)
        out = []
        for s in servers:
            machine_id, fingerprint = identities.get(s.id, (None, None))
            out.append({
                'agent_id': s.agent_id,
                'machine_id': machine_id,
                'fingerprint': (fingerprint or '').lower() or None,
                'hostname': s.hostname or s.name,
                'kind': 'agent',
            })
        return out
    except Exception as exc:  # never block pairing on host enumeration
        logger.warning('Could not enumerate managed agents: %s', exc)
        return []


# ==================== Pairing ====================


def _post(cloud_url: str, endpoint: str, body: dict) -> requests.Response:
    return requests.post(
        f'{cloud_url}/api/pair/{endpoint}',
        json=body,
        timeout=HTTP_TIMEOUT_S,
    )


def _error_detail(resp: requests.Response) -> str:
    try:
        detail = resp.json().get('detail')
    except ValueError:
        detail = None
    if isinstance(detail, dict):
        detail = detail.get('error')
    return detail or resp.text[:200] or f'HTTP {resp.status_code}'


def _print_code(echo, code: str, fingerprint: str, cloud_url: str, expires_at: str):
    echo('')
    echo(f'  Pairing code:  {code}')
    echo(f'  Fingerprint:   {connect_keys.format_fingerprint(fingerprint)}')
    echo('')
    echo(f'  Approve this server at {cloud_url}/pair — enter the code and')
    echo('  confirm the fingerprint matches exactly.')
    echo(f'  Code expires at {expires_at}; a new one is printed automatically.')
    echo('')


def connect(cloud_url: str = None, echo=print, timeout_s: int = DEFAULT_PAIR_TIMEOUT_S,
            poll_interval: float = POLL_INTERVAL_S) -> dict:
    """Pair this panel with ServerKit Cloud. Returns the written connect.json payload.

    Blocks (polling every ~3 s) until the enrollment is claimed, the overall
    timeout elapses, or ServerKit Cloud rejects the enrollment. Ctrl+C is handled by the
    caller (KeyboardInterrupt).
    """
    cloud_url = resolve_cloud_url(cloud_url)

    existing = _read_connect_file()
    if existing.get('device_id'):
        raise ConnectError(
            f'This panel is already connected to {existing.get("org_slug") or "an organization"} '
            f'as "{existing.get("name")}". Run `serverkit connect status` for details or '
            '`serverkit connect disconnect` first.'
        )

    private_key, pubkey_hex, fingerprint = connect_keys.load_or_create_keypair()

    from app.utils.version import get_panel_version
    body = {
        'pubkey': pubkey_hex,
        'fingerprint': fingerprint,
        'hostname': socket.gethostname(),
        'panel_version': get_panel_version(),
        'proto': 1,
        'machine_id': _panel_machine_id(fingerprint),
        'hosts': _gather_hosts(),
    }

    try:
        resp = _post(cloud_url, 'enroll', body)
    except requests.RequestException as exc:
        raise ConnectError(f'Cannot reach ServerKit Cloud at {cloud_url}: {exc}')
    if resp.status_code == 409:
        raise ConnectError(f'ServerKit Cloud refused enrollment: {_error_detail(resp)}')
    if resp.status_code != 201:
        raise ConnectError(f'Enroll failed ({resp.status_code}): {_error_detail(resp)}')

    enrolled = resp.json()
    enrollment_id = enrolled['enrollment_id']
    enrollment_secret = enrolled['enrollment_secret']  # session-only; never stored
    code = enrolled['code']
    expires_at = enrolled.get('expires_at')

    echo(f'Connecting this panel to ServerKit Cloud ({cloud_url}) ...')
    _print_code(echo, code, fingerprint, cloud_url, expires_at)

    deadline = time.monotonic() + timeout_s
    last_warning = 0.0
    while time.monotonic() < deadline:
        if expires_at and _past(expires_at):
            try:
                rot = _post(cloud_url, 'rotate', {
                    'enrollment_id': enrollment_id,
                    'enrollment_secret': enrollment_secret,
                })
                if rot.status_code == 200:
                    data = rot.json()
                    code, expires_at = data['code'], data.get('expires_at')
                    echo('The previous code expired; here is a new one.')
                    _print_code(echo, code, fingerprint, cloud_url, expires_at)
                elif rot.status_code != 423:  # 423 = frozen: someone is typing it — keep it
                    logger.warning('Code rotation failed (%s): %s',
                                   rot.status_code, _error_detail(rot))
                    expires_at = None  # avoid hammering; poll until claimed/timeout
            except requests.RequestException:
                pass

        ts = int(time.time())
        sig = private_key.sign(f'{enrollment_id}|{ts}'.encode()).hex()
        try:
            poll = _post(cloud_url, 'poll', {
                'enrollment_id': enrollment_id,
                'enrollment_secret': enrollment_secret,
                'ts': ts,
                'sig': sig,
            })
        except requests.RequestException as exc:
            now = time.monotonic()
            if now - last_warning > 15:
                last_warning = now
                echo(f'  ... waiting (ServerKit Cloud unreachable: {exc}); will retry')
            time.sleep(poll_interval)
            continue

        if poll.status_code == 200:
            claimed = poll.json()
            payload = {
                'device_id': claimed.get('device_id'),
                'org_slug': claimed.get('org_slug'),
                'name': claimed.get('name'),
                'relay_url': claimed.get('relay_url'),
                'scopes': claimed.get('scopes') or [],
                'fingerprint': fingerprint,
                KEY_PATH_FIELD: connect_keys.default_key_path(),
                'cloud_url': cloud_url,
                'paired_at': datetime.now(timezone.utc).isoformat(),
            }
            _write_connect_file(payload)
            echo('')
            echo(f'Connected to organization "{payload["org_slug"]}" '
                 f'as "{payload["name"]}".')
            echo(f'State saved to {connect_file_path()}')
            return payload

        if poll.status_code == 202:
            time.sleep(poll_interval)
            continue
        if poll.status_code == 423:
            raise ConnectError(f'Enrollment locked by ServerKit Cloud: {_error_detail(poll)}')
        if poll.status_code in (400, 401):
            raise ConnectError(f'ServerKit Cloud rejected this enrollment: {_error_detail(poll)}')
        logger.warning('Unexpected poll response %s: %s',
                       poll.status_code, _error_detail(poll))
        time.sleep(poll_interval)

    raise ConnectError(
        f'Pairing timed out after {timeout_s // 60} minutes. '
        'Run `serverkit connect` again to start a new enrollment.'
    )


def _past(iso_ts: str) -> bool:
    try:
        dt = datetime.fromisoformat(str(iso_ts))
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) >= dt


# ==================== Status / disconnect ====================


def _configured_cloud_url() -> str:
    """The configured control-plane URL, or the default if it is malformed.

    status() is a read: a typo in SERVERKIT_CLOUD_URL should show up when the
    operator tries to pair, not turn `serverkit connect status` and the
    Settings panel into an error.
    """
    try:
        return resolve_cloud_url()
    except ConnectError:
        return DEFAULT_CLOUD_URL


def status() -> dict:
    """Connection state as the UI/CLI should show it.

    Reads connect.json (pairing), connect-state.json (runtime transport
    state, written by RelayClient) and checks the device key — no thread
    needs to be running in this process.
    """
    data = _read_connect_file()
    cloud_url = _configured_cloud_url()
    key_path = data.get(KEY_PATH_FIELD) or connect_keys.default_key_path()
    key_present = os.path.exists(key_path)
    if not data.get('device_id'):
        return {
            'state': 'unpaired',
            'state_reason': None,
            'paired': False,
            'cloud_url': cloud_url,
            'key_present': key_present,
            'key_path': key_path,
        }
    saved = _read_state_file()
    if saved.get('state'):
        state = saved['state']
        reason = saved.get('state_reason')
    else:
        state = 'paired_offline' if key_present else 'degraded'
        reason = 'never_connected' if key_present else 'device_key_missing'
    return {
        'state': state,
        'state_reason': reason,
        'paired': True,
        'cloud_url': data.get('cloud_url') or cloud_url,
        'device_id': data.get('device_id'),
        'org_slug': data.get('org_slug'),
        'name': data.get('name'),
        'relay_url': data.get('relay_url'),
        'scopes': data.get('scopes') or [],
        'transport': saved.get('transport'),
        'relay_instance': saved.get('relay_instance'),
        'last_connected_at': saved.get('last_connected_at'),
        'fingerprint': data.get('fingerprint'),
        'fingerprint_grouped': connect_keys.format_fingerprint(data['fingerprint'])
        if data.get('fingerprint') else None,
        'paired_at': data.get('paired_at'),
        'key_present': key_present,
        'key_path': key_path,
    }


def disconnect(remove_key: bool = False) -> dict:
    """Forget the pairing locally. Does NOT revoke anything on ServerKit Cloud."""
    stop_relay_client()  # no-op unless the client runs in this process
    removed = []
    for path in (connect_file_path(), state_file_path()):
        if os.path.exists(path):
            os.unlink(path)
            removed.append(path)
    if remove_key:
        key_path = connect_keys.default_key_path()
        if os.path.exists(key_path):
            os.unlink(key_path)
            removed.append(key_path)
    return {'success': True, 'removed': removed, 'state': 'unpaired'}


# ==================== Relay transport ====================

DEFAULT_RELAY_URL = 'wss://relay.serverkit.ai/v1/device'
STATE_FILENAME = 'connect-state.json'

PROTO_VERSION = 1
HELLO_TIMEOUT_S = 10        # the relay closes devices that take longer to hello
PING_INTERVAL_S = 20        # panel -> relay {"t":"ping"} heartbeat
MAX_FRAME_BYTES = 256 * 1024

BACKOFF_BASE_S = 1.0
BACKOFF_CAP_S = 60.0
BACKOFF_JITTER = 0.25       # ±25%
STABLE_AFTER_S = 120        # a connection stable this long resets the backoff
WS_RETRY_AFTER_S = 15 * 60  # while on the poll fallback, re-probe WS this often
POLL_TIMEOUT_S = 35         # slightly above the relay's 25 s hold
FLAP_WINDOW_S = 600
FLAP_LIMIT = 6              # >6 reconnects in 10 minutes = flapping

# Relay close codes -> state_reason enum (mirrors the relay's protocol).
CLOSE_REASON_BY_CODE = {
    4001: 'auth_failed_signature',
    4002: 'auth_failed_clock_skew',
    4003: 'version_unsupported',
    4004: 'auth_failed_signature',  # nonce replay
    4009: 'revoked',
}


class RelayRevoked(Exception):
    """The relay closed us with 4009 — terminal until re-paired on ServerKit Cloud."""


class _HandshakeRefused(Exception):
    """WS handshake/hello failed with a classified state_reason."""


# ---------- pure helpers (unit-tested) ----------


def close_reason_for_code(code) -> str:
    """Relay close code -> state_reason; unknown codes are a dropped heartbeat."""
    return CLOSE_REASON_BY_CODE.get(code, 'heartbeat_timeout')


def backoff_delay(attempt: int, rand=random.uniform) -> float:
    """Jittered exponential backoff: 1 s doubling to a 60 s cap, ±25% jitter."""
    base = min(BACKOFF_CAP_S, BACKOFF_BASE_S * (2 ** max(0, attempt)))
    return base * (1 + rand(-BACKOFF_JITTER, BACKOFF_JITTER))


def is_flapping(attempts_at, now: float = None,
                window: float = FLAP_WINDOW_S, limit: int = FLAP_LIMIT) -> bool:
    """True when more than `limit` reconnect attempts happened within `window`."""
    now = time.time() if now is None else now
    return sum(1 for t in attempts_at if now - t <= window) > limit


def relay_http_base(relay_url: str) -> str:
    """wss://host:port/v1/device -> https://host:port (ws -> http)."""
    parsed = urllib.parse.urlparse(relay_url)
    scheme = {'wss': 'https', 'ws': 'http'}.get(parsed.scheme, parsed.scheme)
    return urllib.parse.urlunparse((scheme, parsed.netloc, '', '', '', ''))


def poll_url_for(relay_url: str) -> str:
    """The relay's long-poll endpoint for a device WS URL."""
    return relay_http_base(relay_url) + '/v1/device/poll'


def build_hello(private_key, device_id: str, client_version: str) -> dict:
    """The signed first frame. sig covers the exact string `device_id|ts|nonce`."""
    ts = int(time.time())
    nonce = secrets.token_hex(16)
    sig = private_key.sign(f'{device_id}|{ts}|{nonce}'.encode()).hex()
    hello = {
        't': 'hello',
        'device_id': device_id,
        'ts': ts,
        'nonce': nonce,
        'sig': sig,
        'proto': PROTO_VERSION,
        'client_version': client_version,
    }
    try:
        # Publish this panel's end-to-end key, signed with its identity key.
        # Failing here is not fatal: without it commands
        # arrive under TLS as before, and Cloud says so per server.
        hello.update(connect_keys.e2e_hello_fields(private_key, device_id))
    except Exception:
        logger.debug('Connect: could not publish the end-to-end key', exc_info=True)
    return hello


HELLO_HEADERS = {
    'device_id': 'X-ServerKit-Device',
    'ts': 'X-ServerKit-Ts',
    'nonce': 'X-ServerKit-Nonce',
    'sig': 'X-ServerKit-Sig',
    'proto': 'X-ServerKit-Proto',
    'client_version': 'X-ServerKit-Client-Version',
    # The end-to-end key travels on the long-poll fallback too, so a panel in
    # limited mode is not quietly less private than one on a WebSocket.
    'x25519_pubkey': 'X-ServerKit-X25519',
    'x25519_sig': 'X-ServerKit-X25519-Sig',
}


def hello_headers(hello: dict) -> dict:
    """The same hello carried in X-ServerKit-* headers for the poll fallback.

    build_hello() drops the end-to-end key rather than fail the connection,
    so a field it did not publish is simply a header we do not send.
    """
    return {header: str(hello[field]) for field, header in HELLO_HEADERS.items()
            if field in hello}


# ---------- runtime state file ----------


def state_file_path() -> str:
    return os.path.join(paths.SERVERKIT_CONFIG_DIR, STATE_FILENAME)


def _read_state_file() -> dict:
    path = state_file_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as exc:
        logger.warning('Could not read %s: %s', path, exc)
        return {}


def _write_state_file(state: str, reason: str = None, transport: str = None,
                      relay_instance: str = None, last_connected_at: str = None):
    """Persist a state transition, preserving fields not being overwritten."""
    saved = _read_state_file()
    saved.update({
        'state': state,
        'state_reason': reason,
        'transport': transport,
        'relay_instance': relay_instance if relay_instance is not None
        else saved.get('relay_instance'),
        'last_connected_at': last_connected_at or saved.get('last_connected_at'),
        'updated_at': datetime.now(timezone.utc).isoformat(),
    })
    path = state_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(saved, f, indent=2)
        f.write('\n')


def _classify_ws_failure(exc) -> str:
    """Map a transport exception to a state_reason (pure; unit-tested)."""
    import ssl

    from websockets.exceptions import ConnectionClosed, InvalidHandshake

    if isinstance(exc, ConnectionClosed):
        code = exc.rcvd.code if exc.rcvd else None
        return close_reason_for_code(code)
    if isinstance(exc, InvalidHandshake):
        # HTTP 4xx/5xx or a non-101 answer on the upgrade: a proxy breaking WS.
        return 'relay_unreachable'
    if isinstance(exc, ssl.SSLError):
        return 'tls_error'
    if isinstance(exc, socket.gaierror):
        return 'dns_error'
    # connect refused/reset, timeouts, anything else network-shaped.
    return 'relay_unreachable'


def _relay_config() -> dict:
    """What the transport needs from connect.json + the device key.

    Returns None when the panel is not paired (anymore) or the key is gone —
    the client loop treats that as "exit", not "retry".
    """
    data = _read_connect_file()
    if not data.get('device_id') or not data.get('relay_url'):
        return None
    key_path = data.get(KEY_PATH_FIELD) or connect_keys.default_key_path()
    try:
        private_key, _pub, _fpr = connect_keys.load_keypair(key_path)
    except Exception as exc:
        logger.warning('Connect relay: cannot load device key %s: %s', key_path, exc)
        return None
    return {
        'device_id': data['device_id'],
        'relay_url': data['relay_url'],
        # Where the release feed lives.
        'cloud_url': data.get('cloud_url') or resolve_cloud_url(),
        'private_key': private_key,
        'key_path': key_path,
    }


# ---------- the client ----------


class RelayClient:
    """Holds one outbound connection to the ServerKit relay.

    WebSocket first (signed hello, 20 s pings); when the upgrade smells like
    a proxy block (non-101 answer, timeout) the client falls back to the
    long-poll loop and reports `degraded`, re-probing WS every
    WS_RETRY_AFTER_S. All state transitions are persisted to
    connect-state.json so the CLI/API read them without this thread.
    """

    def __init__(self, app=None):
        self.app = app
        self.running = False
        self.transport = None
        self.relay_instance = None
        self.last_error = None
        self._thread = None
        self._stop = threading.Event()
        self._ws = None
        self._attempts_at = collections.deque()
        self._flap_logged = False
        self._last_written = None  # (state, reason, transport) transition dedup
        # Metrics publisher: one summary a minute over the
        # relay's `metrics` stream. Buffered while offline, never backfilled
        # further than its own five-minute window.
        self._metrics = MetricsPublisher()
        self._metrics_stream = 0
        self._metrics_inflight = {}   # stream id -> samples awaiting the ack
        self._metrics_next_at = 0.0
        # Release feed check: asked on reconnect, at most
        # once an hour, and acted on only when this install can update itself.
        self._update = UpdateCheck()
        # Signed commands and the Storage Hub's status
        # stream. The JWKS is fetched once per connection and
        # refetched when a command arrives signed with a key it
        # does not know: Cloud mints keys on first use and rotates
        # them on its own schedule, both between reconnects.
        self._jwks = None
        self._storage_stream = 0
        self._storage_next_at = 0.0
        self._policy_stream = 0
        self._policy_next_at = 0.0
        # The inventory and diagnostics streams. The
        # generation is this process's own counter; it starts over on a
        # restart and Cloud names that rather than ignoring it.
        self._inventory_stream = 0
        self._inventory_generation = 0
        self._inventory_next_at = 0.0
        self._inventory_inflight = {}
        self._diagnostics_stream = 0
        self._diagnostics_next_at = 0.0
        self._diagnostics_inflight = {}
        self._diagnostics_collect = False
        # Bounded log collection. The publisher owns the
        # buffer and the bounds; Cloud's answer to each batch owns whether
        # to keep going and which sources are wanted.
        self._logs = connect_logs.LogPublisher(app)
        self._logs_stream = 0
        self._logs_inflight = {}
        self._logs_ack_deadline = 0.0

    # -- lifecycle -----------------------------------------------------

    def start(self):
        if self.running:
            return
        self.running = True
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name='connect-relay')
        self._thread.start()
        logger.info('Connect relay client started')

    def stop(self):
        self.running = False
        self._stop.set()
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        # A terminal 'revoked' survives a stop: re-pairing on ServerKit Cloud, not a
        # local restart, is what clears it.
        if _read_state_file().get('state') != 'revoked':
            self._set_state('paired_offline', 'client_stopped', transport=None)

    # -- state persistence ---------------------------------------------

    def _set_state(self, state, reason, transport=None):
        key = (state, reason, transport)
        if key == self._last_written:
            return
        self._last_written = key
        connected = state in ('online', 'degraded')
        _write_state_file(
            state, reason, transport=transport, relay_instance=self.relay_instance,
            last_connected_at=datetime.now(timezone.utc).isoformat()
            if connected else None)

    def _sleep(self, seconds):
        self._stop.wait(max(0.0, seconds))

    # -- main loop ------------------------------------------------------

    def _run(self):
        attempt = 0
        ws_blocked_until = 0.0
        while self.running:
            cfg = _relay_config()
            if cfg is None:
                logger.info('Connect relay: not paired (connect.json/key gone); exiting')
                return

            if time.monotonic() < ws_blocked_until:
                if self._poll_session(cfg, ws_blocked_until) == 'stopped':
                    return
                ws_blocked_until = 0.0  # time to re-probe WS
                continue

            started = time.monotonic()
            outcome = self._ws_session(cfg)
            if outcome == 'stopped':
                return
            kind, _, reason = outcome.partition(':')

            if kind == 'revoked':
                self._set_state('revoked', 'revoked', transport=None)
                logger.warning('Connect relay: device revoked on ServerKit Cloud; stopping')
                return

            if time.monotonic() - started >= STABLE_AFTER_S:
                attempt = 0
            else:
                attempt += 1
                self._note_attempt()

            if kind == 'refused' and reason == 'relay_unreachable':
                # Proxy-blocked or unanswerable upgrade: limited mode.
                ws_blocked_until = time.monotonic() + WS_RETRY_AFTER_S
                self._set_state('degraded', 'relay_unreachable', transport='poll')
                continue

            self._set_state('paired_offline', reason, transport=None)
            self._sleep(backoff_delay(attempt))

    def _note_attempt(self):
        now = time.time()
        self._attempts_at.append(now)
        while self._attempts_at and now - self._attempts_at[0] > FLAP_WINDOW_S:
            self._attempts_at.popleft()
        flapping = is_flapping(self._attempts_at, now=now)
        if flapping and not self._flap_logged:
            self._flap_logged = True
            logger.warning(
                'Connect relay flapping: %d reconnects in the last %d s',
                len(self._attempts_at), FLAP_WINDOW_S)
        elif not flapping:
            self._flap_logged = False

    # -- websocket ------------------------------------------------------

    def _ws_session(self, cfg) -> str:
        """One WS connection: handshake, hello, heartbeat until drop.

        Returns 'stopped', 'revoked', 'refused:<reason>' (never got ready —
        auth/handshake failure) or 'drop:<reason>' (was ready, then lost).
        """
        try:
            ws = self._ws_connect(cfg)
        except RelayRevoked:
            return 'revoked'
        except _HandshakeRefused as exc:
            return f'refused:{exc}'
        except Exception as exc:
            return f'refused:{_classify_ws_failure(exc)}'

        self._ws = ws
        try:
            # Consent is connection-scoped. Reconnect using empty probes.
            if self._diagnostics_collect:
                self._diagnostics_next_at = 0.0
            self._diagnostics_collect = False
            self._logs.sources = None
            self._logs.next_flush_at = 0.0
            self.transport = 'ws'
            self._set_state('online', None, transport='ws')
            logger.info('Connect relay: online via ws (instance %s)',
                        self.relay_instance)
            self._check_for_update(cfg)
            self._load_jwks(cfg)
            self._publish_storage(ws)
            self._publish_policy(ws)
            # A fresh connection publishes the inventory straight away: the
            # first thing Cloud shows for a server is what runs on it.
            self._inventory_next_at = 0.0
            self._publish_inventory(ws)
            while self.running:
                try:
                    raw = ws.recv(timeout=PING_INTERVAL_S)
                except TimeoutError:
                    ws.send('{"t":"ping"}')
                    self._publish_metrics(ws)
                    self._publish_storage(ws)
                    self._publish_policy(ws)
                    self._publish_inventory(ws)
                    self._publish_diagnostics(ws)
                    self._publish_logs(ws)
                    continue
                self._handle_frame(ws, raw)
                self._publish_metrics(ws)
                self._publish_storage(ws)
                self._publish_policy(ws)
                self._publish_inventory(ws)
                self._publish_diagnostics(ws)
                self._publish_logs(ws)
            return 'stopped'
        except Exception as exc:
            from websockets.exceptions import ConnectionClosed
            if isinstance(exc, ConnectionClosed):
                code = exc.rcvd.code if exc.rcvd else None
                if code == 4009:
                    return 'revoked'
                self.last_error = f'connection closed (code {code})'
                return f'drop:{close_reason_for_code(code)}'
            self.last_error = str(exc)
            return f'drop:{_classify_ws_failure(exc)}'
        finally:
            self._ws = None
            for batch in reversed(list(self._logs_inflight.values())):
                self._logs.requeue(batch)
            self._logs_inflight.clear()
            self._inventory_inflight.clear()
            self._diagnostics_inflight.clear()
            self._diagnostics_collect = False
            self._logs.sources = None
            try:
                ws.close()
            except Exception:
                pass

    def _ws_connect(self, cfg):
        """Handshake + signed hello + wait for `ready` (10 s, relay-enforced)."""
        from app.utils.version import get_panel_version
        from websockets.exceptions import ConnectionClosed
        from websockets.sync.client import connect as ws_connect

        ws = ws_connect(
            cfg['relay_url'],
            open_timeout=HELLO_TIMEOUT_S,
            close_timeout=5,
            ping_interval=None,  # heartbeats are app-level {"t":"ping"} frames
            max_size=MAX_FRAME_BYTES,
        )
        try:
            hello = build_hello(cfg['private_key'], cfg['device_id'],
                                get_panel_version())
            ws.send(json.dumps(hello))
            frame = json.loads(ws.recv(timeout=HELLO_TIMEOUT_S))
            if frame.get('t') != 'ready':
                raise _HandshakeRefused('relay_unreachable')
            self.relay_instance = frame.get('instance')
            return ws
        except ConnectionClosed as exc:
            code = exc.rcvd.code if exc.rcvd else None
            if code == 4009:
                raise RelayRevoked()
            raise _HandshakeRefused(close_reason_for_code(code))
        except Exception:
            try:
                ws.close()
            except Exception:
                pass
            raise

    # -- release feed ------------------------------------

    def _check_for_update(self, cfg):
        """Ask ServerKit Cloud whether this connect client is current.

        Failures here are never fatal to the connection: an old client that
        cannot reach the feed keeps working, which is the whole point of the
        relay staying up.
        """
        try:
            from app.utils.version import get_panel_version
            check_and_apply(cfg['cloud_url'], get_panel_version(), self._update)
        except Exception:
            logger.debug('Connect updates: check failed', exc_info=True)

    @property
    def update_state(self) -> dict:
        return self._update.to_dict()

    # -- metrics ----------------------------------------

    def _publish_metrics(self, ws):
        """Collect on the Cloud-set interval and send whatever is buffered.

        A send that fails leaves the samples in the buffer: they go out on the
        next connection if they are still inside the five-minute window, and
        are dropped rather than sent late if they are not.
        """
        now = time.monotonic()
        if now < self._metrics_next_at:
            return
        self._metrics_next_at = now + self._metrics.interval_s
        try:
            self._metrics.collect(self.app)
        except Exception:
            logger.debug('Connect metrics: collect failed', exc_info=True)
            return
        if not self._metrics.pending():
            return
        samples = self._metrics.take()
        self._metrics_stream += 1
        stream_id = f'met{self._metrics_stream}'
        try:
            ws.send(json.dumps(self._metrics.frame(stream_id, samples)))
            self._metrics_inflight[stream_id] = samples
        except Exception:
            self._metrics.requeue(samples)
            logger.debug('Connect metrics: send failed, samples kept', exc_info=True)

    def _handle_frame(self, ws, raw):
        try:
            frame = json.loads(raw)
        except ValueError:
            return
        if frame.get('t') == 'close':
            # The relay closes an ingest stream with ServerKit Cloud's own answer, which
            # carries the interval Cloud wants us to send at.
            stream_id = frame.get('s')
            if stream_id in self._metrics_inflight:
                payload = frame.get('p') or {}
                if payload.get('ok'):
                    self._metrics_inflight.pop(stream_id, None)
                    self._metrics.apply_ack(payload)
                else:
                    self._metrics.requeue(self._metrics_inflight.pop(stream_id, []))
            elif stream_id in self._inventory_inflight:
                self._inventory_inflight.pop(stream_id, None)
                self._apply_inventory_ack(frame.get('p') or {})
            elif stream_id in self._diagnostics_inflight:
                self._diagnostics_inflight.pop(stream_id, None)
                self._apply_diagnostics_ack(frame.get('p') or {})
            elif stream_id in self._logs_inflight:
                batch = self._logs_inflight.pop(stream_id, None)
                payload = frame.get('p') or {}
                self._logs.apply_ack(payload)
                if not self._logs.collect:
                    self._logs_inflight.clear()
                if not payload.get('ok') and self._logs.collect:
                    # Refused for a reason that is not "stop": the lines are
                    # still wanted and their ids make the resend safe.
                    self._logs.requeue(batch)
            return
        if frame.get('t') == 'open':
            if frame.get('k') == 'command':
                self._run_command(ws, frame)
                return
            # Anything else is a stream this client version does not speak.
            # Refusing honestly is what stops the relay holding it open.
            ws.send(json.dumps({
                's': frame.get('s'),
                't': 'close',
                'reason': 'unsupported',
                'detail': 'this ServerKit version does not speak that stream',
            }))

    # -- signed commands --------------------------------

    def _load_jwks(self, cfg):
        """Cloud's public signing keys, read once per connection. Without them
        no command runs — an unverified command is not a command."""
        try:
            self._jwks = fetch_jwks(cfg['cloud_url'])
        except Exception:
            self._jwks = None
            logger.debug('Connect commands: could not read the JWKS', exc_info=True)

    def _refresh_jwks_for(self, token, cfg):
        """ServerKit Cloud mints each signing key the first time it is used and
        rotates it on its own schedule — both can postdate the JWKS this
        connection fetched at connect time. One refetch when the kid is
        unknown; a key still unknown afterwards is refused like any other bad
        signature.
        """
        try:
            import jwt
            kid = jwt.get_unverified_header(token).get('kid') if token else None
        except Exception:
            return
        if not kid:
            return
        known = {k.get('kid') for k in (self._jwks or {}).get('keys') or []}
        if kid not in known:
            self._load_jwks(cfg)

    def _run_command(self, ws, frame):
        """Verify, acknowledge, run, report.

        Verification is synchronous so a bad command is refused on the socket
        it arrived on. The work itself runs on its own thread: a backup that
        takes four minutes must not stop the heartbeat.
        """
        payload = frame.get('p') or {}
        cfg = _read_connect_file()
        self._refresh_jwks_for(payload.get('jwt'), cfg)
        try:
            claims = connect_commands.verify(
                payload.get('jwt'), self._jwks, cfg.get('device_id'),
                granted_scopes=None)
        except connect_commands.CommandRejected as exc:
            cmd_id = _peek_command_id(payload.get('jwt'))
            logger.warning('Connect command refused: %s', exc)
            if cmd_id:
                self._send(ws, connect_commands.result_frame(
                    cmd_id, 'failed', {'ok': False, 'code': 403, 'summary': str(exc)}))
            else:
                self._send(ws, {'s': frame.get('s'), 't': 'close',
                                'reason': 'unsupported', 'detail': str(exc)})
            return

        cmd_id = claims.get('cmd_id')
        self._send(ws, connect_commands.result_frame(cmd_id, 'running'))
        threading.Thread(
            target=self._command_worker, args=(claims,), daemon=True,
            name=f'connect-cmd-{cmd_id}').start()

    def _command_worker(self, claims):
        result = connect_commands.run(claims, self.app)
        state = 'succeeded' if result.get('ok') else 'failed'
        self._send(self._ws, connect_commands.result_frame(
            claims.get('cmd_id'), state, result))

    def _send(self, ws, frame) -> bool:
        """One frame, best effort. A dropped socket is not an error worth
        raising here: ServerKit Cloud times the command out and says so, and the panel
        reports again on reconnect."""
        if ws is None:
            return False
        try:
            ws.send(json.dumps(frame))
            return True
        except Exception:
            logger.debug('Connect: could not send frame', exc_info=True)
            return False

    # -- the storage stream ------------------------------

    def publish_storage(self, snapshot=None) -> bool:
        """Send one storage snapshot now. Used by the storage.report command."""
        ws = self._ws
        if ws is None:
            return False
        snapshot = snapshot if snapshot is not None else connect_storage.build_status(self.app)
        if snapshot is None:
            return False
        self._storage_stream += 1
        return self._send(ws, connect_storage.status_frame(
            f'sto{self._storage_stream}', snapshot))

    # -- the policy stream --------------------------------

    def publish_policy(self, facts=None) -> bool:
        """Send one facts document now. Used by the policy.report command."""
        ws = self._ws
        if ws is None:
            return False
        facts = facts if facts is not None else connect_policy.build_facts(self.app)
        self._policy_stream += 1
        return self._send(ws, connect_policy.facts_frame(
            f'pol{self._policy_stream}', facts))

    def _publish_policy(self, ws):
        now = time.monotonic()
        if now < self._policy_next_at:
            return
        self._policy_next_at = now + POLICY_INTERVAL_S
        try:
            facts = connect_policy.build_facts(self.app)
        except Exception:
            logger.debug('Connect policy: could not build facts', exc_info=True)
            return
        self._policy_stream += 1
        self._send(ws, connect_policy.facts_frame(f'pol{self._policy_stream}', facts))

    # -- the inventory and diagnostics streams ----------

    def _publish_inventory(self, ws) -> bool:
        now = time.monotonic()
        if now < self._inventory_next_at:
            return False
        self._inventory_next_at = now + INVENTORY_INTERVAL_S
        self._inventory_generation += 1
        try:
            doc = connect_inventory.build_inventory(self.app, self._inventory_generation)
        except Exception:
            logger.debug('Connect inventory: could not build the document', exc_info=True)
            return False
        self._inventory_stream += 1
        stream_id = f'inv{self._inventory_stream}'
        self._inventory_inflight.clear()
        self._inventory_inflight[stream_id] = doc.get('generation')
        sent = self._send(ws, connect_inventory.inventory_frame(stream_id, doc))
        if not sent:
            self._inventory_inflight.pop(stream_id, None)
        return sent

    def _apply_inventory_ack(self, payload: dict):
        """Cloud's answer carries the interval it wants; a refusal is logged
        once and the next attempt waits the normal interval."""
        if not payload.get('ok'):
            logger.info('Connect inventory: refused (%s)', payload.get('reason') or 'unknown')
            return
        interval = payload.get('next_interval_s')
        if isinstance(interval, (int, float)) and 30 <= interval <= 3600:
            self._inventory_next_at = time.monotonic() + float(interval)
        if payload.get('generation_reset'):
            logger.info('Connect inventory: Cloud noted a generation reset after restart')

    def _publish_diagnostics(self, ws) -> bool:
        now = time.monotonic()
        if now < self._diagnostics_next_at:
            return False
        self._diagnostics_next_at = now + DIAGNOSTICS_INTERVAL_S
        try:
            if self._diagnostics_collect:
                doc = connect_inventory.build_diagnostics(int(DIAGNOSTICS_INTERVAL_S))
            else:
                doc = {'schema': connect_inventory.DIAGNOSTICS_SCHEMA,
                       'observed_at': datetime.now(timezone.utc).isoformat(),
                       'interval_s': int(DIAGNOSTICS_INTERVAL_S),
                       'processes': [], 'mounts': [], 'completeness': {}}
        except Exception:
            logger.debug('Connect diagnostics: could not build the document', exc_info=True)
            return False
        self._diagnostics_stream += 1
        stream_id = f'dia{self._diagnostics_stream}'
        self._diagnostics_inflight.clear()
        self._diagnostics_inflight[stream_id] = True
        sent = self._send(ws, connect_inventory.inventory_frame(stream_id, doc))
        if not sent:
            self._diagnostics_inflight.pop(stream_id, None)
        return sent

    def _apply_diagnostics_ack(self, payload: dict):
        """`collect: false` is Cloud saying the consent is not held. Stop, and
        try again slowly so a consent granted later takes effect."""
        if payload.get('ok') and payload.get('collect') is True:
            newly_allowed = not self._diagnostics_collect
            self._diagnostics_collect = True
            interval = payload.get('next_interval_s')
            if isinstance(interval, (int, float)) and 30 <= interval <= 3600:
                self._diagnostics_next_at = time.monotonic() + float(interval)
            if newly_allowed:
                self._diagnostics_next_at = 0.0
            return
        self._diagnostics_collect = False
        self._diagnostics_next_at = time.monotonic() + DIAGNOSTICS_REFUSED_RETRY_S

    # -- the logs stream ---------------------------------

    def _publish_logs(self, ws) -> bool:
        """Collect from the wanted sources and send one bounded batch when
        one is due. Before Cloud has answered once, the first batch is
        empty and its answer is the configuration."""
        self._logs.retry_after_refusal()
        if self._logs_inflight:
            if time.monotonic() < self._logs_ack_deadline:
                return False
            for batch in self._logs_inflight.values():
                self._logs.requeue(batch)
            self._logs_inflight.clear()
            self._logs.sources = None
        if not self._logs.due():
            return False
        try:
            self._logs.collect_now()
        except Exception:
            logger.debug('Connect logs: collection failed', exc_info=True)
        if not self._logs.due():
            return False
        batch = self._logs.take_batch()
        self._logs_stream += 1
        stream_id = f'log{self._logs_stream}'
        self._logs_inflight[stream_id] = batch
        self._logs_ack_deadline = time.monotonic() + 60.0
        sent = self._send(ws, connect_logs.logs_frame(stream_id, batch))
        if not sent:
            self._logs_inflight.pop(stream_id, None)
            self._logs.requeue(batch)
        return sent

    def _publish_storage(self, ws):
        """Where backups go and how they went, on its own slow cadence: this
        changes when a backup runs, not every minute."""
        now = time.monotonic()
        if now < self._storage_next_at:
            return
        self._storage_next_at = now + STORAGE_INTERVAL_S
        try:
            snapshot = connect_storage.build_status(self.app)
        except Exception:
            logger.debug('Connect storage: could not build a snapshot', exc_info=True)
            return
        if snapshot is None:
            return
        self._storage_stream += 1
        self._send(ws, connect_storage.status_frame(f'sto{self._storage_stream}', snapshot))

    # -- long-poll fallback ----------------------------------------------

    def _poll_session(self, cfg, ws_retry_at) -> str:
        """Long-poll loop ('limited mode'): each held GET is the heartbeat.

        Returns 'stopped', 'revoked', or 'retry_ws' when it's time to try the
        WebSocket again.
        """
        self.transport = 'poll'
        self._set_state('degraded', 'relay_unreachable', transport='poll')
        logger.info('Connect relay: using long-poll fallback (degraded)')
        fail_attempt = 0
        while self.running:
            if time.monotonic() >= ws_retry_at:
                return 'retry_ws'
            try:
                self._poll_once(cfg)
                fail_attempt = 0
            except RelayRevoked:
                return 'revoked'
            except Exception as exc:
                fail_attempt += 1
                self.last_error = str(exc)
                logger.warning('Connect relay poll failed: %s', exc)
                self._sleep(min(30.0, backoff_delay(fail_attempt)))
        return 'stopped'

    def _poll_once(self, cfg):
        from app.utils.version import get_panel_version

        hello = build_hello(cfg['private_key'], cfg['device_id'],
                            get_panel_version())
        resp = requests.get(
            poll_url_for(cfg['relay_url']),
            headers=hello_headers(hello),
            timeout=POLL_TIMEOUT_S,
        )
        if resp.status_code == 200:
            return
        detail = _error_detail(resp)
        if resp.status_code == 403 and detail == 'revoked':
            raise RelayRevoked()
        raise ConnectError(f'poll failed ({resp.status_code}): {detail}')


# ---------- singleton management (mirrors linked_panel_agent) ----------

_relay_client = None


def get_client():
    return _relay_client


def start_relay_client(app=None):
    global _relay_client
    if _relay_client is not None:
        return _relay_client
    client = RelayClient(app)
    client.start()
    _relay_client = client
    return client


def stop_relay_client():
    global _relay_client
    if _relay_client is not None:
        _relay_client.stop()
        _relay_client = None


def start_client_if_paired(app):
    """App-startup hook: resume the relay connection when this panel is paired."""
    try:
        if app.config.get('ENV') == 'testing' or app.config.get('TESTING'):
            return None
        if not _read_connect_file().get('device_id'):
            return None
        return start_relay_client(app)
    except Exception as exc:  # never block boot on the relay
        logger.warning('Could not start connect relay client: %s', exc)
        return None


# ==================== Doctor ====================

# Hard checks fail the doctor run (exit 1); soft ones are warnings with a
# working fallback. (name, ok, hard, copy-on-failure, note-on-pass)


def _doctor_check(name, ok, hard, fail_copy, note=None):
    return {
        'name': name,
        'ok': bool(ok),
        'hard': bool(hard),
        'error': None if ok else fail_copy,
        'note': note if ok else None,
    }


def _key_file_ok(key_path: str):
    if not os.path.exists(key_path):
        return False
    if os.name != 'nt':
        import stat
        mode = stat.S_IMODE(os.stat(key_path).st_mode)
        return mode & 0o077 == 0
    return True


def run_doctor() -> list:
    """The connect check table: pairing, key, DNS, TCP, TLS, clock, panel, WS."""
    data = _read_connect_file()
    relay_url = data.get('relay_url') or DEFAULT_RELAY_URL
    parsed = urllib.parse.urlparse(relay_url)
    host = parsed.hostname or ''
    port = parsed.port or (443 if parsed.scheme == 'wss' else 80)
    use_tls = parsed.scheme == 'wss'

    checks = []

    # Pairing state (informational: doctor is also useful pre-pair).
    paired = bool(data.get('device_id'))
    checks.append(_doctor_check(
        'Paired with ServerKit Cloud', paired, hard=False,
        fail_copy='Not paired yet. Run `serverkit connect` first.',
        note=f'device {data.get("device_id")}' if paired else None))

    # Device key present and mode 0600.
    key_path = data.get(KEY_PATH_FIELD) or connect_keys.default_key_path()
    checks.append(_doctor_check(
        'Device key', _key_file_ok(key_path), hard=True,
        fail_copy=f'Device key missing or readable by others: {key_path}.',
        note=key_path))

    # DNS resolution of the relay host.
    try:
        socket.getaddrinfo(host, port)
        dns_ok = True
        checks.append(_doctor_check(f'DNS {host}', True, hard=True,
                                    fail_copy=None, note=host))
    except socket.gaierror:
        dns_ok = False
        checks.append(_doctor_check(
            f'DNS {host}', False, hard=True,
            fail_copy=f'Cannot resolve {host}. Check DNS or outbound filtering.'))

    # TCP egress to the relay port (443 for wss).
    if dns_ok:
        try:
            with socket.create_connection((host, port), timeout=5):
                pass
            checks.append(_doctor_check(f'TCP {host}:{port}', True, hard=True,
                                        fail_copy=None))
        except OSError:
            checks.append(_doctor_check(
                f'TCP {host}:{port}', False, hard=True,
                fail_copy='Outbound HTTPS to the relay is blocked.'))
    else:
        checks.append(_doctor_check(f'TCP {host}:{port}', False, hard=True,
                                    fail_copy='Skipped: DNS failed.'))

    # TLS chain (plain ws:// relays have none to check).
    if not use_tls:
        checks.append(_doctor_check(f'TLS {host}', True, hard=True,
                                    fail_copy=None,
                                    note='not applicable (plain ws:// relay)'))
    elif dns_ok:
        import ssl
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((host, port), timeout=5) as sock:
                with ctx.wrap_socket(sock, server_hostname=host):
                    pass
            checks.append(_doctor_check(f'TLS {host}', True, hard=True,
                                        fail_copy=None))
        except Exception as exc:
            checks.append(_doctor_check(
                f'TLS {host}', False, hard=True,
                fail_copy=f'TLS to the relay failed: {exc}. '
                          'Corporate proxies that inspect TLS are not supported.'))
    else:
        checks.append(_doctor_check(f'TLS {host}', False, hard=True,
                                    fail_copy='Skipped: DNS failed.'))

    # Clock skew: the relay/ServerKit Cloud Date header vs local time (limit 60 s).
    if dns_ok:
        import email.utils
        try:
            resp = requests.get(relay_http_base(relay_url) + '/', timeout=10)
            remote = email.utils.parsedate_to_datetime(resp.headers['Date'])
            skew = abs(time.time() - remote.timestamp())
            checks.append(_doctor_check(
                'Clock skew', skew <= 60, hard=True,
                fail_copy=f'System clock is {int(skew)}s off. Enable NTP; the '
                          'relay rejects signatures more than 60 s off.',
                note=f'{skew:.1f}s off UTC'))
        except Exception as exc:
            checks.append(_doctor_check(
                'Clock skew', False, hard=True,
                fail_copy=f'Could not read the relay clock: {exc}.'))
    else:
        checks.append(_doctor_check('Clock skew', False, hard=True,
                                    fail_copy='Skipped: DNS failed.'))

    # Loopback panel reachable (the relay will proxy browser traffic to it).
    from app.services.cli_api_client import resolve_port
    panel_port = resolve_port()
    try:
        with socket.create_connection(('127.0.0.1', panel_port), timeout=3):
            pass
        checks.append(_doctor_check('Panel loopback', True, hard=True,
                                    fail_copy=None,
                                    note=f'127.0.0.1:{panel_port}'))
    except OSError:
        checks.append(_doctor_check(
            'Panel loopback', False, hard=True,
            fail_copy=f'Panel not reachable at 127.0.0.1:{panel_port}.'))

    # WS upgrade attempt (soft: the long-poll fallback keeps limited mode).
    if dns_ok:
        try:
            from websockets.sync.client import connect as ws_connect
            ws = ws_connect(relay_url, open_timeout=10, close_timeout=2,
                            ping_interval=None)
            try:
                ws.close()
            finally:
                pass
            checks.append(_doctor_check('WebSocket upgrade', True, hard=False,
                                        fail_copy=None))
        except Exception:
            checks.append(_doctor_check(
                'WebSocket upgrade', False, hard=False,
                fail_copy='WebSocket upgrade refused; will use limited mode.'))
    else:
        checks.append(_doctor_check('WebSocket upgrade', False, hard=False,
                                    fail_copy='Skipped: DNS failed.'))

    return checks


def doctor_ok(checks) -> bool:
    """True when no HARD check failed (soft checks are warnings)."""
    return not any(c['hard'] and not c['ok'] for c in checks)
