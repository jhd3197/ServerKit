"""
AgentRegistry Service

Manages connected agent sessions, routes commands to agents,
and handles agent lifecycle events.
"""

import hmac
import hashlib
import logging
import secrets
import time
import threading

logger = logging.getLogger(__name__)
from datetime import datetime, timedelta
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field
from queue import Queue, Empty

from collections import defaultdict

from app import db
from app.models.server import Server, ServerCommand, AgentSession
from app.services import permission_levels

# ---------------------------------------------------------------------------
# Per-IP auth rate limiter — transport-neutral state shared by the WS
# namespace and the long-poll /connect endpoint (moved here from
# agent_gateway so the handshake door owns its own throttle).
# Guarded by a lock: async_mode='threading' means both transports can call
# concurrently. Buckets are swept so one-off IPs don't accumulate forever.
# request.remote_addr upstream is the ProxyFix-corrected client IP.
# ---------------------------------------------------------------------------
_auth_attempts = defaultdict(list)
_auth_attempts_lock = threading.Lock()
_last_auth_sweep = 0.0
_AUTH_RATE_LIMIT = 10  # max attempts per window
_AUTH_RATE_WINDOW = 60  # seconds


def _check_auth_rate_limit(ip_address: str) -> bool:
    """Record an auth attempt and report whether the IP is still under the
    limit. Returns True when allowed, False when the per-IP window is
    exhausted. Thread-safe."""
    global _last_auth_sweep
    now = time.time()
    with _auth_attempts_lock:
        if now - _last_auth_sweep > _AUTH_RATE_WINDOW:
            for ip in list(_auth_attempts.keys()):
                fresh = [t for t in _auth_attempts[ip] if now - t < _AUTH_RATE_WINDOW]
                if fresh:
                    _auth_attempts[ip] = fresh
                else:
                    del _auth_attempts[ip]
            _last_auth_sweep = now

        recent = [t for t in _auth_attempts[ip_address] if now - t < _AUTH_RATE_WINDOW]
        if len(recent) >= _AUTH_RATE_LIMIT:
            _auth_attempts[ip_address] = recent
            return False
        recent.append(now)
        _auth_attempts[ip_address] = recent
        return True


@dataclass
class ConnectedAgent:
    """Represents a connected agent.

    transport='ws'   — long-lived Socket.IO connection. socket_id is the sid.
    transport='poll' — REST long-poll fallback. socket_id is a synthesized
                       "poll-<token>" that uniquely identifies the poll
                       session; outbound_queue holds commands waiting to be
                       handed back on the next /poll request.
    """
    server_id: str
    socket_id: str
    session_token: str
    connected_at: datetime
    last_heartbeat: datetime
    ip_address: str
    agent_version: str
    transport: str = 'ws'
    # Polling-mode only: commands queued for the next /poll response.
    outbound_queue: Queue = field(default_factory=Queue)
    # Pending commands waiting for response
    pending_commands: Dict[str, 'PendingCommand'] = field(default_factory=dict)
    # Feature surfaces the agent reported it can drive (cron, docker,
    # systemd, …). Empty until the agent sends a `capabilities` event;
    # older agents that don't speak the protocol leave this empty so
    # they only show up as default-local in target pickers. The dict is
    # forward-compatible: unknown keys are passed through verbatim.
    capabilities: Dict[str, bool] = field(default_factory=dict)
    platform: Optional[str] = None
    distro: Optional[str] = None
    distro_version: Optional[str] = None
    # Runtimes is name → version detected at agent startup
    # ({"python": "3.11.4", "node": "20.10.0"}). Empty for older
    # agents and for hosts where no runtime probes matched.
    runtimes: Dict[str, str] = field(default_factory=dict)
    # File-access roots advertised when capabilities["files"] is true.
    # Used by the file manager to seed the browse picker. Empty for
    # agents that have file access disabled or don't speak the protocol.
    allowed_paths: list = field(default_factory=list)


@dataclass
class PendingCommand:
    """Represents a command waiting for response"""
    command_id: str
    action: str
    params: dict
    callback: Optional[Callable] = None
    timeout: float = 30.0
    created_at: float = field(default_factory=time.time)
    result_queue: Queue = field(default_factory=Queue)


class AgentRegistry:
    """
    Singleton service that manages all connected agents.

    Responsibilities:
    - Track connected agents by server_id and socket_id
    - Route commands to the correct agent
    - Handle command responses
    - Manage heartbeats and detect disconnections
    - Store metrics received from agents
    """

    _instance = None
    _lock = threading.Lock()

    # How long an agent can go without a heartbeat before the reaper
    # considers it dead (3 missed 30s heartbeats). Shared between the scan
    # and the re-validation done just before eviction so the two can't drift.
    HEARTBEAT_TIMEOUT = timedelta(seconds=90)

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        # Connected agents by server_id
        self._agents: Dict[str, ConnectedAgent] = {}
        # Commands refused by the Observe guard per server (the
        # "blocked N commands" counter). In-memory like all registry state —
        # single-worker by architecture. The dispatch-level guard itself is
        # still hollow post-loss; until it is restored the
        # counter only grows where callers record blocks explicitly.
        self._observed_blocks: Dict[str, int] = {}
        # Socket ID to server ID mapping
        self._socket_to_server: Dict[str, str] = {}
        # Lock for thread safety
        self._lock = threading.Lock()
        # SocketIO instance (set by init_socketio)
        self._socketio = None
        # Flask app, captured so background threads can re-enter the
        # app context. Without this, _handle_agent_timeout (and any
        # other DB-touching code in _check_heartbeats) raises
        # "Working outside of application context" the moment it tries
        # to query — which is why timed-out agents stayed stuck at
        # status=connecting in the DB instead of flipping to offline.
        self._app = None
        # Heartbeat check thread
        self._heartbeat_thread = None
        self._stop_heartbeat = threading.Event()

    def init_socketio(self, socketio):
        """Initialize with SocketIO instance"""
        self._socketio = socketio
        # Capture the current Flask app reference for the background
        # heartbeat thread. current_app is a context-local proxy and
        # only works inside a request/app context, but flask.current_app._get_current_object()
        # gives us the underlying object we can stash.
        from flask import current_app
        try:
            self._app = current_app._get_current_object()
        except RuntimeError:
            # Called outside an app context (e.g. during testing) —
            # heartbeat checker will skip DB operations gracefully.
            self._app = None

    def start(self, app):
        """Start liveness checks after application persistence is ready."""
        self._app = app
        self._start_heartbeat_checker()

    def _start_heartbeat_checker(self):
        """Start background thread to check for dead connections"""
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return

        self._stop_heartbeat.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._check_heartbeats,
            daemon=True
        )
        self._heartbeat_thread.start()

    def _check_heartbeats(self):
        """Check for agents that haven't sent heartbeats"""
        while not self._stop_heartbeat.is_set():
            try:
                now = datetime.utcnow()
                timeout = self.HEARTBEAT_TIMEOUT

                # Snapshot (server_id, socket_id) for stale agents. The
                # socket_id is part of the snapshot so the eviction step can
                # tell whether the agent it's about to drop is still the same
                # connection we flagged, or a fresh reconnect that landed
                # after we released the lock.
                with self._lock:
                    dead_agents = [
                        (server_id, agent.socket_id)
                        for server_id, agent in self._agents.items()
                        if now - agent.last_heartbeat > timeout
                    ]

                # Wrap DB access in an app context — the timeout
                # handler queries Server / AgentSession and commits.
                # In a thread there's no implicit context.
                if dead_agents and self._app is not None:
                    with self._app.app_context():
                        for server_id, socket_id in dead_agents:
                            self._handle_agent_timeout(server_id, socket_id)
                elif dead_agents:
                    # No app captured (test environment); just remove from the
                    # in-memory registry without touching DB — but still
                    # re-validate so a reconnect isn't clobbered.
                    now2 = datetime.utcnow()
                    for server_id, socket_id in dead_agents:
                        with self._lock:
                            agent = self._agents.get(server_id)
                            if (agent and agent.socket_id == socket_id
                                    and now2 - agent.last_heartbeat > timeout):
                                self._agents.pop(server_id, None)
                                self._socket_to_server.pop(socket_id, None)

                # Report-only (monitor) agents hold no socket; sweep them too.
                if self._app is not None:
                    with self._app.app_context():
                        from app.services import agent_health_service
                        agent_health_service.sweep_silent_reporters()

            except Exception as e:
                logger.error("Error in heartbeat checker: %s", e)

            self._stop_heartbeat.wait(30)  # Check every 30 seconds

    def _handle_agent_timeout(self, server_id: str, socket_id: str):
        """Handle agent that hasn't sent heartbeats.

        Re-validates under the lock before evicting. The reaper snapshots
        stale agents in _check_heartbeats and releases the lock before calling
        this, so an agent can reconnect in between — register_agent installs a
        fresh ConnectedAgent (new socket_id) and marks the server online.
        Without re-checking, we'd pop that healthy new connection and flip the
        server offline right after it reconnected — the reconnection-stability
        bug. Only evict when the entry still refers to the same socket we
        flagged AND it is still stale.
        """
        with self._lock:
            agent = self._agents.get(server_id)
            if not agent or agent.socket_id != socket_id:
                # Already gone, or replaced by a reconnect — leave it alone.
                return
            if datetime.utcnow() - agent.last_heartbeat <= self.HEARTBEAT_TIMEOUT:
                # A heartbeat landed after the snapshot — no longer stale.
                return
            self._agents.pop(server_id, None)
            self._socket_to_server.pop(socket_id, None)

        # Update server status in database
        try:
            server = Server.query.get(server_id)
            if server:
                server.status = 'offline'
                server.last_error = 'Agent heartbeat timeout'
                from app.services import agent_health_service
                agent_health_service.mark_offline(server, 'heartbeat timeout')
                db.session.commit()

            # Mark session as inactive
            session = AgentSession.query.filter_by(
                server_id=server_id,
                socket_id=socket_id,
                is_active=True
            ).first()
            if session:
                session.is_active = False
                session.disconnected_at = datetime.utcnow()
                session.disconnect_reason = 'heartbeat_timeout'
                db.session.commit()
        except Exception as e:
            logger.exception("Error updating server status")
            db.session.rollback()

    # ==================== Connection Management ====================

    def register_agent(
        self,
        server_id: str,
        socket_id: str,
        ip_address: str,
        agent_version: str = None,
        transport: str = 'ws'
    ) -> Optional[str]:
        """
        Register a newly connected agent.

        transport='ws' is the existing Socket.IO path; 'poll' is the REST
        long-poll fallback used when WS-incompatible tunnels (free-tier
        ngrok, cf quick tunnels) corrupt frames. The two share storage
        and the command-routing path differs only in send_command.

        Returns: session_token on success, or None if the DB write failed
        (in which case the in-memory registration is rolled back and the
        caller must NOT treat the agent as connected).
        """
        session_token = secrets.token_urlsafe(32)

        agent = ConnectedAgent(
            server_id=server_id,
            socket_id=socket_id,
            session_token=session_token,
            connected_at=datetime.utcnow(),
            last_heartbeat=datetime.utcnow(),
            ip_address=ip_address,
            agent_version=agent_version or 'unknown',
            transport=transport,
        )

        with self._lock:
            # Replace any existing connection for this server. Capture the old
            # agent's in-flight commands and socket so we can clean them up
            # AFTER releasing the lock — doing socket I/O under the lock risks
            # deadlocking with the disconnect handler, which also takes it.
            old_agent = self._agents.get(server_id)
            if old_agent:
                self._socket_to_server.pop(old_agent.socket_id, None)
                old_pending = list(old_agent.pending_commands.values())
                old_agent.pending_commands.clear()
                old_socket_id = old_agent.socket_id
                old_transport = old_agent.transport
            else:
                old_pending = []
                old_socket_id = None
                old_transport = None

            self._agents[server_id] = agent
            self._socket_to_server[socket_id] = server_id

        # The previous connection for this server (if any) is now orphaned by
        # this reconnect. Fail its in-flight commands so callers blocked in
        # send_command() return immediately with AGENT_RECONNECTED instead of
        # waiting out the full timeout — the late result would resolve against
        # the new agent and be unreachable anyway. Then drop the stale WS
        # socket so the agent isn't left holding two live connections.
        # (unregister_agent keys off socket_id and we already removed the old
        # one from _socket_to_server, so the resulting disconnect handler is a
        # no-op for the freshly-registered agent.)
        for pending in old_pending:
            try:
                pending.result_queue.put({
                    'success': False,
                    'error': 'Agent reconnected',
                    'code': 'AGENT_RECONNECTED',
                })
            except Exception:
                logger.exception("Error failing pending command on reconnect")
        if (old_socket_id and old_socket_id != socket_id
                and old_transport == 'ws' and self._socketio is not None):
            try:
                self._socketio.server.disconnect(old_socket_id, namespace='/agent')
            except Exception:
                logger.debug("Old socket %s already disconnected on reconnect",
                             old_socket_id, exc_info=True)

        # Update database
        try:
            server = Server.query.get(server_id)
            if server:
                server.status = 'online'
                server.last_seen = datetime.utcnow()
                server.last_error = None
                if agent_version:
                    server.agent_version = agent_version
                # Persist the source IP we observed at auth time. Without
                # this the Server.ip_address column stayed NULL forever,
                # which is why the Overview tab showed "IP Address: N/A"
                # even for healthy connected agents.
                if ip_address and ip_address != 'unknown':
                    server.ip_address = ip_address
                from app.services import agent_health_service
                agent_health_service.mark_online(server)
                db.session.commit()

            # Create session record
            session = AgentSession(
                server_id=server_id,
                session_token=session_token,
                socket_id=socket_id,
                ip_address=ip_address,
                user_agent=f"ServerKit-Agent/{agent_version or 'unknown'}",
                is_active=True
            )
            db.session.add(session)
            db.session.commit()

            # Deliver any queued commands for this server
            try:
                from app.services.agent_fleet_service import fleet_service
                fleet_service.deliver_queued_commands(server_id)
            except Exception as e:
                logger.error("Error delivering queued commands: %s", e)

        except Exception:
            logger.exception("Error registering agent")
            db.session.rollback()
            # The DB row/session didn't persist, so don't leave this agent in
            # the in-memory registry advertising itself as connected. That
            # desync would make the gateway emit auth_ok and have command
            # routing target an agent with no backing session row. Remove our
            # entry (guarded on identity, in case a concurrent reconnect has
            # already replaced it) and signal failure so the caller emits
            # auth_fail instead of auth_ok. A stale 'online' server row with no
            # in-memory agent is self-corrected by the heartbeat reaper.
            with self._lock:
                if self._agents.get(server_id) is agent:
                    self._agents.pop(server_id, None)
                    self._socket_to_server.pop(socket_id, None)
            return None

        return session_token

    def unregister_agent(self, socket_id: str, reason: str = 'disconnect'):
        """Unregister a disconnected agent"""
        with self._lock:
            server_id = self._socket_to_server.pop(socket_id, None)
            if server_id:
                agent = self._agents.pop(server_id, None)

        if server_id:
            # Update database
            try:
                server = Server.query.get(server_id)
                if server:
                    server.status = 'offline'
                    db.session.commit()

                # Mark session as inactive
                session = AgentSession.query.filter_by(
                    server_id=server_id,
                    socket_id=socket_id,
                    is_active=True
                ).first()
                if session:
                    session.is_active = False
                    session.disconnected_at = datetime.utcnow()
                    session.disconnect_reason = reason
                    db.session.commit()
            except Exception as e:
                logger.exception("Error unregistering agent")
                db.session.rollback()

    def get_agent(self, server_id: str) -> Optional[ConnectedAgent]:
        """Get a connected agent by server ID"""
        with self._lock:
            return self._agents.get(server_id)

    def get_agent_by_socket(self, socket_id: str) -> Optional[ConnectedAgent]:
        """Get a connected agent by socket ID"""
        with self._lock:
            server_id = self._socket_to_server.get(socket_id)
            if server_id:
                return self._agents.get(server_id)
        return None

    def is_agent_connected(self, server_id: str) -> bool:
        """Check if an agent is connected"""
        with self._lock:
            return server_id in self._agents

    def get_connected_servers(self) -> list:
        """Get list of connected server IDs"""
        with self._lock:
            return list(self._agents.keys())

    def record_observed_block(self, server_id: str) -> None:
        """Count one command refused because the server is observed."""
        with self._lock:
            self._observed_blocks[server_id] = (
                self._observed_blocks.get(server_id, 0) + 1)

    def observed_blocked_count(self, server_id: str) -> int:
        """Commands the Observe guard refused for this server."""
        with self._lock:
            return self._observed_blocks.get(server_id, 0)

    # ==================== Heartbeat ====================

    def update_heartbeat(self, server_id: str, metrics: dict = None, client_timestamp: int = None):
        """Update agent heartbeat and optionally store metrics"""
        now = datetime.utcnow()
        with self._lock:
            agent = self._agents.get(server_id)
            if agent:
                agent.last_heartbeat = now

        # Calculate heartbeat latency if client sent a timestamp
        latency_ms = None
        if client_timestamp:
            now_ms = int(time.time() * 1000)
            latency_ms = max(0, now_ms - client_timestamp)

        # Update server last_seen
        try:
            server = Server.query.get(server_id)
            if server:
                server.last_seen = now
                if server.status != 'online':
                    server.status = 'online'
                    from app.services import agent_health_service
                    agent_health_service.mark_online(server)
                db.session.commit()

            # Update session latency
            if latency_ms is not None:
                session = AgentSession.query.filter_by(
                    server_id=server_id, is_active=True
                ).first()
                if session:
                    session.last_heartbeat = now
                    session.update_latency(latency_ms)
                    db.session.commit()

            # Store metrics if provided
            if metrics:
                self._store_metrics(server_id, metrics)
        except Exception as e:
            logger.exception("Error updating heartbeat")
            db.session.rollback()

    def _store_metrics(self, server_id: str, metrics: dict):
        """Store metrics from a heartbeat, through the one writer.

        This used to build its own ``ServerMetrics`` and set five of the
        thirteen columns the model has, silently dropping ``memory_used``,
        ``disk_used``, the network totals, both network *rates* and ``extra``.
        The two rates are exactly what ``fleet_monitor_service.METRIC_COLUMNS``
        reads, so a network threshold could never fire for a server whose
        metrics arrive by agent heartbeat — the data to evaluate it was thrown
        away on the way in.

        One producer, one storage contract: ``ServerMetricsService`` already
        persists every supported field and distinguishes a real ``0`` from
        "no reading", so the heartbeat goes through it rather than beside it.
        """
        from app.services.server_metrics_service import ServerMetricsService
        ServerMetricsService.record_metrics(server_id, metrics)

    # ==================== Command Routing ====================

    def send_command(
        self,
        server_id: str,
        action: str,
        params: dict = None,
        timeout: float = 30.0,
        user_id: int = None
    ) -> dict:
        """
        Send a command to an agent and wait for response.

        Args:
            server_id: Target server ID
            action: Command action (e.g., 'docker:container:list')
            params: Command parameters
            timeout: Timeout in seconds
            user_id: User ID for audit logging

        Returns:
            dict: Command result with 'success', 'data', 'error'
        """
        agent = self.get_agent(server_id)
        if not agent:
            return {
                'success': False,
                'error': 'Agent not connected',
                'code': 'AGENT_OFFLINE'
            }

        # Check permissions
        server = Server.query.get(server_id)
        # Defence in depth: never send what the agent's reported level refuses.
        refused = permission_levels.refusal(
            server.permission_level if server else None, action)
        if refused:
            return {'success': False, 'error': refused, 'code': 'LEVEL_DENIED'}

        if server and not server.has_permission(action):
            return {
                'success': False,
                'error': f'Permission denied for action: {action}',
                'code': 'PERMISSION_DENIED'
            }

        # Create command record
        command_id = secrets.token_urlsafe(16)
        command_record = ServerCommand(
            id=command_id,
            server_id=server_id,
            user_id=user_id,
            command_type=action,
            command_data=params,
            status='pending'
        )

        try:
            db.session.add(command_record)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            return {
                'success': False,
                'error': f'Failed to create command record: {e}',
                'code': 'DB_ERROR'
            }

        # Create pending command
        pending = PendingCommand(
            command_id=command_id,
            action=action,
            params=params or {},
            timeout=timeout
        )

        with self._lock:
            agent.pending_commands[command_id] = pending

        # Hand the command to the agent. WS agents get an immediate emit;
        # polling agents get the command pushed onto their outbound queue
        # where it sits until the next /api/v1/agent/poll request drains
        # it. Both paths block below on pending.result_queue.get(timeout).
        command_payload = {
            'type': 'command',
            'id': command_id,
            'action': action,
            'params': params or {},
            'timeout': int(timeout * 1000)
        }
        try:
            if agent.transport == 'poll':
                agent.outbound_queue.put(command_payload)
            else:
                self._socketio.emit(
                    'command',
                    command_payload,
                    room=agent.socket_id,
                    namespace='/agent'
                )

            # Update command status
            command_record.status = 'running'
            command_record.started_at = datetime.utcnow()
            db.session.commit()

        except Exception as e:
            with self._lock:
                agent.pending_commands.pop(command_id, None)
            command_record.status = 'failed'
            command_record.error = str(e)
            db.session.commit()
            return {
                'success': False,
                'error': f'Failed to send command: {e}',
                'code': 'SEND_ERROR'
            }

        # Wait for response
        try:
            result = pending.result_queue.get(timeout=timeout)
        except Empty:
            result = {
                'success': False,
                'error': 'Command timeout',
                'code': 'TIMEOUT'
            }

        # Clean up
        with self._lock:
            agent.pending_commands.pop(command_id, None)

        # Update command record
        try:
            command_record.status = 'completed' if result.get('success') else 'failed'
            command_record.completed_at = datetime.utcnow()
            command_record.result = result.get('data')
            command_record.error = result.get('error')
            db.session.commit()
        except Exception:
            db.session.rollback()
            # Don't swallow silently: if this final write fails the command
            # row is left stuck in 'running', which is invisible without a log.
            logger.exception(
                "Failed to finalize command record %s (left in 'running')",
                command_id,
            )

        return result

    # ==================== Polling Transport Support ====================

    def get_agent_by_token(self, session_token: str) -> Optional[ConnectedAgent]:
        """Look up an agent by its session token. Used by polling endpoints
        which don't have a socket id and authenticate every request via
        the token instead."""
        if not session_token:
            return None
        with self._lock:
            for agent in self._agents.values():
                if agent.session_token == session_token:
                    return agent
        return None

    def drain_outbound(self, agent: 'ConnectedAgent', max_wait_s: float, max_items: int = 16):
        """Pull queued commands for a polling-mode agent. Long-polls up to
        max_wait_s for the FIRST command, then drains anything else
        already queued without further blocking. Returns a list (possibly
        empty if max_wait_s elapsed with no work)."""
        items = []
        try:
            first = agent.outbound_queue.get(timeout=max_wait_s)
            items.append(first)
        except Empty:
            return items
        # Drain anything else already queued, no blocking
        for _ in range(max_items - 1):
            try:
                items.append(agent.outbound_queue.get_nowait())
            except Empty:
                break
        return items

    def deliver_result_by_token(self, session_token: str, result: dict) -> bool:
        """Polling-side equivalent of handle_command_result. Returns True
        when the result was matched to a pending command and delivered."""
        agent = self.get_agent_by_token(session_token)
        if not agent:
            return False
        command_id = result.get('command_id')
        if not command_id or not isinstance(command_id, str) or len(command_id) > 64:
            return False
        with self._lock:
            pending = agent.pending_commands.get(command_id)
        if not pending:
            return False
        pending.result_queue.put({
            'success': result.get('success', False),
            'data': result.get('data'),
            'error': result.get('error'),
            'duration': result.get('duration')
        })
        return True

    def unregister_by_token(self, session_token: str, reason: str = 'disconnect'):
        """Polling-side equivalent of unregister_agent — used when the
        agent posts /disconnect or when the polling session times out."""
        agent = self.get_agent_by_token(session_token)
        if not agent:
            return
        self.unregister_agent(agent.socket_id, reason=reason)

    # ==================== Command Result Handling (WS) ====================

    def handle_command_result(self, socket_id: str, result: dict):
        """Handle command result from agent"""
        agent = self.get_agent_by_socket(socket_id)
        if not agent:
            logger.warning(f"Command result from unknown socket: {socket_id}")
            return

        command_id = result.get('command_id')
        if not command_id:
            logger.warning(f"Command result missing command_id from agent: {agent.server_id}")
            return

        # Validate command_id format to prevent injection
        if not isinstance(command_id, str) or len(command_id) > 64:
            logger.warning(f"Invalid command_id format from agent: {agent.server_id}")
            return

        with self._lock:
            pending = agent.pending_commands.get(command_id)

        if pending:
            pending.result_queue.put({
                'success': result.get('success', False),
                'data': result.get('data'),
                'error': result.get('error'),
                'duration': result.get('duration')
            })

    # ==================== Authentication ====================

    # ------------------------------------------------------------------
    # Transport-neutral handshake + state ingest. The WS
    # namespace (agent_gateway) and the long-poll endpoints (api/agent_poll)
    # are thin adapters over these two doors; neither may re-implement the
    # sequence (ratcheted by tests/test_agent_handshake_matrix.py).
    # ------------------------------------------------------------------

    def authenticate_and_register(self, payload: dict, ip_address: str,
                                  user_agent: str = '', transport: str = 'ws',
                                  socket_id: str = None):
        """The ONE agent handshake: rate-limit -> HMAC verify -> allowed-IPs
        + anomaly tracking -> new-IP check -> version parse -> register.

        Returns ``(session_token, server, error)`` where ``error`` is None on
        success or one of: 'rate_limited', 'missing_fields', 'auth_failed',
        'ip_not_allowed', 'registration_failed'. The transport adapter
        translates the code into its own wire shape (emit/disconnect vs
        jsonify/status) and MUST fail closed on any non-None error.
        """
        from app.services.anomaly_detection_service import anomaly_detection_service
        from app.utils.ip_utils import is_ip_allowed

        payload = payload or {}
        if not _check_auth_rate_limit(ip_address):
            logger.warning("Auth rate limit exceeded for IP: %s (%s)", ip_address, transport)
            return None, None, 'rate_limited'

        agent_id = payload.get('agent_id')
        api_key_prefix = payload.get('api_key_prefix')
        signature = payload.get('signature')
        timestamp = payload.get('timestamp', 0)
        nonce = payload.get('nonce')

        if not all([agent_id, api_key_prefix, signature]):
            return None, None, 'missing_fields'

        server = self.verify_agent_auth(
            agent_id, api_key_prefix, signature, timestamp,
            nonce=nonce, ip_address=ip_address,
        )
        if not server:
            return None, None, 'auth_failed'

        if server.allowed_ips and len(server.allowed_ips) > 0:
            if not is_ip_allowed(ip_address, server.allowed_ips):
                anomaly_detection_service.track_ip_blocked(
                    server.id, ip_address, server.allowed_ips)
                logger.warning("IP %s blocked for server %s", ip_address, server.id)
                return None, server, 'ip_not_allowed'

        anomaly_detection_service.check_new_ip(server.id, ip_address)

        agent_version = (user_agent or '').replace('ServerKit-Agent/', '')
        if socket_id is None:
            # Synthesized id for non-socket transports; the "poll-" prefix
            # tells WS-only code paths to skip these agents.
            socket_id = f'poll-{secrets.token_urlsafe(12)}'

        session_token = self.register_agent(
            server_id=server.id,
            socket_id=socket_id,
            ip_address=ip_address,
            agent_version=agent_version,
            transport=transport,
        )
        # None means the DB write failed and register_agent rolled back the
        # in-memory state — the adapter must not report success.
        if not session_token:
            return None, server, 'registration_failed'
        self.record_agent_health(server.id, payload.get('permission_level'))

        logger.info("Agent %s authenticated successfully from %s (%s)",
                    agent_id, ip_address, transport)
        return session_token, server, None

    def ingest_agent_state(self, agent, metrics=None, sysinfo=None,
                           capabilities=None, permission_level=None,
                           service_checks=None):
        """One ingest path for agent-reported state on BOTH transports.

        Owns the capability side-effects (the WireGuard tunnel reconcile
        fires from update_capabilities) so a payload arriving via long-poll
        behaves exactly like one arriving via WebSocket.
        """
        if metrics is not None:
            self.update_heartbeat(agent.server_id, metrics)
        if sysinfo:
            self.update_system_info(agent.server_id, sysinfo)
        if capabilities:
            self.update_capabilities(agent.server_id, capabilities)
        if permission_level is not None or service_checks is not None:
            self.record_agent_health(agent.server_id, permission_level, service_checks)

    def record_agent_health(self, server_id, permission_level=None, service_checks=None):
        from app.services import agent_health_service
        try:
            server = Server.query.get(server_id)
            if server:
                agent_health_service.record_level(server, permission_level)
                agent_health_service.record_service_checks(server, service_checks)
                db.session.commit()
        except Exception:
            logger.exception("Error recording agent health")
            db.session.rollback()

    def verify_agent_auth(
        self,
        agent_id: str,
        api_key_prefix: str,
        signature: str,
        timestamp: int,
        nonce: str = None,
        ip_address: str = None
    ) -> Optional[Server]:
        """
        Verify agent authentication with full signature and replay protection.

        Args:
            agent_id: Agent's unique ID
            api_key_prefix: First 12 chars of API key
            signature: HMAC-SHA256 signature
            timestamp: Unix timestamp in milliseconds
            nonce: Unique nonce for replay protection (optional but recommended)
            ip_address: Source IP address for anomaly tracking

        Returns:
            Server if authenticated, None otherwise
        """
        from app.services.nonce_service import nonce_service
        from app.services.anomaly_detection_service import anomaly_detection_service

        # Reject stale/future requests outside a 60s window. This is a
        # clock-skew-tolerant replay guard, and the ONLY replay protection for
        # the nonce-less HTTP-poll transport (see the nonce note below).
        now = int(time.time() * 1000)
        if abs(now - timestamp) > 60000:  # 60 seconds
            if ip_address:
                anomaly_detection_service.track_auth_attempt(None, False, ip_address)
            return None

        # Find server by agent_id
        server = Server.query.filter_by(agent_id=agent_id).first()
        if not server:
            if ip_address:
                anomaly_detection_service.track_auth_attempt(None, False, ip_address)
            return None

        # Verify API key prefix matches (support both active and pending during rotation)
        prefix_matches = server.api_key_prefix == api_key_prefix
        pending_prefix_matches = (
            server.api_key_pending_prefix == api_key_prefix and
            server.api_key_rotation_expires and
            datetime.utcnow() <= server.api_key_rotation_expires
        )

        if not prefix_matches and not pending_prefix_matches:
            anomaly_detection_service.track_auth_attempt(server.id, False, ip_address)
            return None

        # Verify the HMAC signature BEFORE consuming the nonce (replay check is
        # done afterwards, below). Signature verification is MANDATORY — a
        # server whose shared secret is missing or no longer decryptable must
        # FAIL authentication, never fall through to "authenticated". Skipping
        # it would reduce agent auth to agent_id + api_key_prefix, both of which
        # are non-secret, observable values (an attacker who has seen one
        # connect could forge auth). Select the secret matching whichever prefix
        # matched: the pending secret during a key-rotation window, otherwise
        # the active one. get_*_api_secret() returns None on missing/
        # undecryptable ciphertext, which fails closed below.
        if pending_prefix_matches and not prefix_matches:
            api_secret = server.get_pending_api_secret()
        else:
            api_secret = server.get_api_secret()

        if not api_secret:
            logger.error(
                "Agent auth rejected for server %s: no decryptable API secret "
                "on file (re-registration or re-pairing required)", server.id
            )
            anomaly_detection_service.track_auth_attempt(server.id, False, ip_address)
            return None

        # Construct the message that was signed.
        # Format: agent_id:timestamp:nonce. The nonce is omitted only by legacy
        # agents and by the HTTP-poll transport, which signs agent_id:timestamp
        # and relies on the 60s timestamp window above for replay protection.
        if nonce:
            message = f"{agent_id}:{timestamp}:{nonce}"
        else:
            message = f"{agent_id}:{timestamp}"

        # Calculate expected signature
        expected_signature = hmac.new(
            api_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(signature, expected_signature):
            anomaly_detection_service.track_auth_attempt(server.id, False, ip_address)
            return None

        # Replay protection: consume the nonce ONLY now that the signature is
        # proven valid. Recording it before signature verification let an
        # attacker spend a captured nonce with a bogus signature, which would
        # then lock the real agent out when it next presented that nonce.
        if nonce:
            if not nonce_service.check_and_record(server.id, nonce):
                # Replay attack detected!
                anomaly_detection_service.track_replay_attack(server.id, ip_address, nonce)
                return None

        # Authentication successful
        if ip_address:
            anomaly_detection_service.track_auth_attempt(server.id, True, ip_address)

        # NOTE (accepted limitation, not a bug): the session token is issued at
        # auth time but not re-verified on every subsequent message. This is
        # acceptable under the current model — a WS connection is authenticated
        # by HMAC+nonce at connect and then rides an authenticated TLS channel,
        # and the poll transport re-presents the token on each call. Per-message
        # token validation would add defence in depth but needs protocol changes
        # on both the agent (Go) and panel sides; tracked as a future hardening.

        return server

    # ==================== Capabilities ====================

    def update_capabilities(self, server_id: str, payload: dict):
        """Stash the capability map an agent reported on connect.

        payload shape mirrors protocol.CapabilitiesMessage minus the
        envelope:

            {
              "capabilities": {"docker": true, "cron": true, ...},
              "platform": "linux",
              "distro": "ubuntu",
              "distro_version": "22.04"
            }

        Stored only on the in-memory ConnectedAgent — capabilities are
        re-shipped on every reconnect, so persisting across panel
        restarts isn't necessary. An older agent that never sends this
        message simply has an empty capabilities dict and never shows
        up in feature-gated target pickers.
        """
        if not isinstance(payload, dict):
            logger.warning("update_capabilities ignored non-dict payload for %s: %r", server_id, type(payload))
            return
        # Diagnostic trace — the panel showing "none reported" while
        # the agent insists it's pushing means one of these layers is
        # dropping the message. Log the top-level keys + inner caps
        # count once per call so we can see which it is.
        logger.info(
            "update_capabilities for %s: top_keys=%s inner_caps=%s sudo=%r",
            server_id,
            sorted(payload.keys()),
            len(payload.get('capabilities') or {}),
            payload.get('sudo'),
        )
        caps = payload.get('capabilities') or {}
        # Coerce values to bool — agents are trusted but defensive
        # casting protects the API consumer (UI) from malformed types.
        clean_caps = {str(k): bool(v) for k, v in caps.items() if isinstance(k, str)}

        # Coerce runtimes the same way — agents are trusted but we
        # don't want a malformed payload to crash the consumer.
        raw_runtimes = payload.get('runtimes') or {}
        clean_runtimes: Dict[str, str] = {}
        if isinstance(raw_runtimes, dict):
            for k, v in raw_runtimes.items():
                if isinstance(k, str) and isinstance(v, (str, type(None))):
                    clean_runtimes[k] = v or ''

        # Allowed paths — only meaningful when capabilities["files"] is
        # true; coerce to list of strings either way for safety.
        raw_paths = payload.get('allowed_paths') or []
        clean_paths = [str(p) for p in raw_paths if isinstance(p, str) and p.strip()] \
            if isinstance(raw_paths, list) else []

        # Newer payloads carry sudo mode + runtime managers + systemd_json.
        # Coerce defensively — older agents won't include these keys.
        sudo_mode = payload.get('sudo')
        if not isinstance(sudo_mode, str):
            sudo_mode = ''
        raw_managers = payload.get('runtime_managers') or {}
        clean_managers: Dict[str, str] = {}
        if isinstance(raw_managers, dict):
            for k, v in raw_managers.items():
                if isinstance(k, str) and isinstance(v, (str, type(None))):
                    clean_managers[k] = v or ''
        systemd_json = bool(payload.get('systemd_json'))

        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return
            agent.capabilities = clean_caps
            agent.platform = payload.get('platform') or None
            agent.distro = payload.get('distro') or None
            agent.distro_version = payload.get('distro_version') or None
            agent.runtimes = clean_runtimes
            agent.allowed_paths = clean_paths

        # Persist a snapshot to the Server row so the Overview tab can
        # render even when the agent is offline. Wrapped in a try/except
        # so a transient DB hiccup doesn't drop the in-memory update —
        # the cache is best-effort, the live value above is the source
        # of truth while the agent is connected.
        try:
            from app import db
            from app.models.server import Server
            server = Server.query.get(server_id)
            if server is not None:
                server.cached_capabilities = clean_caps
                server.cached_runtimes = clean_runtimes
                server.cached_runtime_managers = clean_managers
                server.cached_allowed_paths = clean_paths
                server.cached_sudo = sudo_mode
                server.cached_systemd_json = systemd_json
                server.capabilities_at = datetime.utcnow()
                if payload.get('platform'):
                    server.platform = payload.get('platform')
                if payload.get('distro'):
                    server.os_version = payload.get('distro_version') or server.os_version
                db.session.commit()
        except Exception as exc:
            # Don't let cache persistence failures break live updates.
            logger.warning("Failed to persist capability snapshot for %s: %s", server_id, exc)

        logger.info(
            "Capabilities updated for server %s: %s",
            server_id,
            sorted(k for k, v in clean_caps.items() if v),
        )

        self._schedule_tunnel_reconcile(server_id, clean_caps)

    def _schedule_tunnel_reconcile(self, server_id: str, caps: Dict[str, bool]):
        """Panel-authoritative tunnel reconcile (#19): if this agent can
        drive WireGuard, re-apply (in the background) any tunnel config it
        participates in, so tunnels self-heal after an agent or panel
        restart. Lives here — on the shared capability-ingest path — so it
        fires for BOTH transports (WS on_capabilities and the long-poll
        /poll body), not just WebSocket. See docs/REMOTE_ACCESS_ROADMAP.md.
        """
        if not caps.get('wireguard'):
            return
        try:
            # TunnelBrokerService lives in the serverkit-remote-access
            # extension; reach it only when installed, no-op
            # otherwise.
            from app.services.plugin_service import get_installed_extension_attr
            TunnelBrokerService = get_installed_extension_attr(
                'serverkit-remote-access', 'tunnel_broker_service',
                'TunnelBrokerService')
            if TunnelBrokerService is not None:
                TunnelBrokerService.schedule_reconcile(server_id)
        except Exception:
            logger.debug("tunnel reconcile scheduling skipped", exc_info=True)

    def get_capabilities(self, server_id: str) -> Optional[Dict[str, bool]]:
        """Return the capability map for a connected agent, or None if
        the agent is not connected. Returns an empty dict if the agent
        is connected but hasn't (yet) reported capabilities — that's a
        valid state for older agents."""
        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return None
            return dict(agent.capabilities)

    def has_capability(self, server_id: str, feature: str) -> bool:
        """Convenience: is the given feature reported as available?"""
        caps = self.get_capabilities(server_id)
        if not caps:
            return False
        return bool(caps.get(feature))

    def get_allowed_paths(self, server_id: str) -> list:
        """File roots the agent advertised on connect, empty if not advertised."""
        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return []
            return list(agent.allowed_paths)

    # ==================== System Info ====================

    def update_system_info(self, server_id: str, info: dict):
        """Update server system information from agent.

        The agent now pushes system_info every 5–60 seconds, so any
        single transient probe failure (e.g. Docker briefly
        unreachable, gopsutil WMI hiccup) shouldn't wipe a previously
        good value out of the row. We only overwrite when the new
        payload carries a truthy value.
        """
        def _coalesce(current, new):
            # Treat 0 / "" / None as "the agent didn't probe this" — keep
            # the existing column rather than overwriting with junk.
            if new in (None, "", 0):
                return current
            return new

        try:
            server = Server.query.get(server_id)
            if not server:
                return
            server.hostname = _coalesce(server.hostname, info.get('hostname'))
            server.os_type = _coalesce(server.os_type, info.get('os'))
            server.os_version = _coalesce(server.os_version, info.get('os_version'))
            server.platform = _coalesce(server.platform, info.get('platform'))
            server.architecture = _coalesce(server.architecture, info.get('architecture'))
            server.cpu_cores = _coalesce(server.cpu_cores, info.get('cpu_cores'))
            server.cpu_model = _coalesce(server.cpu_model, info.get('cpu_model'))
            server.total_memory = _coalesce(server.total_memory, info.get('total_memory'))
            server.total_disk = _coalesce(server.total_disk, info.get('total_disk'))
            server.docker_version = _coalesce(server.docker_version, info.get('docker_version'))
            server.agent_version = _coalesce(server.agent_version, info.get('agent_version'))
            server.agent_install_dir = _coalesce(server.agent_install_dir, info.get('install_dir'))
            server.agent_config_dir = _coalesce(server.agent_config_dir, info.get('config_dir'))
            db.session.commit()
        except Exception:
            logger.exception("Error updating system info")
            db.session.rollback()


# Global instance
agent_registry = AgentRegistry()
