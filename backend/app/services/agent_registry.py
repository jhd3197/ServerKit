"""
AgentRegistry Service

Manages connected agent sessions, routes commands to agents,
and handles agent lifecycle events.
"""

import hmac
import hashlib
import secrets
import time
import threading
from datetime import datetime, timedelta
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field
from queue import Queue, Empty

from app import db
from app.models.server import Server, ServerMetrics, ServerCommand, AgentSession


@dataclass
class ConnectedAgent:
    """Represents a connected agent"""
    server_id: str
    socket_id: str
    session_token: str
    connected_at: datetime
    last_heartbeat: datetime
    ip_address: str
    agent_version: str
    # Pending commands waiting for response
    pending_commands: Dict[str, 'PendingCommand'] = field(default_factory=dict)


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
        # Socket ID to server ID mapping
        self._socket_to_server: Dict[str, str] = {}
        # Lock for thread safety
        self._lock = threading.Lock()
        # SocketIO instance (set by init_socketio)
        self._socketio = None
        # Heartbeat check thread
        self._heartbeat_thread = None
        self._stop_heartbeat = threading.Event()

    def init_socketio(self, socketio):
        """Initialize with SocketIO instance"""
        self._socketio = socketio
        # Start heartbeat checker
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
                timeout = timedelta(seconds=90)  # 3 missed heartbeats

                with self._lock:
                    dead_agents = []
                    for server_id, agent in self._agents.items():
                        if now - agent.last_heartbeat > timeout:
                            dead_agents.append(server_id)

                for server_id in dead_agents:
                    self._handle_agent_timeout(server_id)

            except Exception as e:
                print(f"Error in heartbeat checker: {e}")

            self._stop_heartbeat.wait(30)  # Check every 30 seconds

    def _handle_agent_timeout(self, server_id: str):
        """Handle agent that hasn't sent heartbeats"""
        with self._lock:
            agent = self._agents.pop(server_id, None)
            if agent:
                self._socket_to_server.pop(agent.socket_id, None)

        if agent:
            # Update server status in database
            try:
                server = Server.query.get(server_id)
                if server:
                    server.status = 'offline'
                    server.last_error = 'Agent heartbeat timeout'
                    db.session.commit()

                # Mark session as inactive
                session = AgentSession.query.filter_by(
                    server_id=server_id,
                    socket_id=agent.socket_id,
                    is_active=True
                ).first()
                if session:
                    session.is_active = False
                    session.disconnected_at = datetime.utcnow()
                    session.disconnect_reason = 'heartbeat_timeout'
                    db.session.commit()
            except Exception as e:
                print(f"Error updating server status: {e}")

    # ==================== Connection Management ====================

    def register_agent(
        self,
        server_id: str,
        socket_id: str,
        ip_address: str,
        agent_version: str = None
    ) -> str:
        """
        Register a newly connected agent.

        Returns: session_token
        """
        session_token = secrets.token_urlsafe(32)

        agent = ConnectedAgent(
            server_id=server_id,
            socket_id=socket_id,
            session_token=session_token,
            connected_at=datetime.utcnow(),
            last_heartbeat=datetime.utcnow(),
            ip_address=ip_address,
            agent_version=agent_version or 'unknown'
        )

        with self._lock:
            # Remove old connection if exists
            old_agent = self._agents.get(server_id)
            if old_agent:
                self._socket_to_server.pop(old_agent.socket_id, None)

            self._agents[server_id] = agent
            self._socket_to_server[socket_id] = server_id

        # Update database
        try:
            server = Server.query.get(server_id)
            if server:
                server.status = 'online'
                server.last_seen = datetime.utcnow()
                server.last_error = None
                if agent_version:
                    server.agent_version = agent_version
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
        except Exception as e:
            print(f"Error registering agent: {e}")
            db.session.rollback()

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
                print(f"Error unregistering agent: {e}")
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

    # ==================== Heartbeat ====================

    def update_heartbeat(self, server_id: str, metrics: dict = None):
        """Update agent heartbeat and optionally store metrics"""
        with self._lock:
            agent = self._agents.get(server_id)
            if agent:
                agent.last_heartbeat = datetime.utcnow()

        # Update server last_seen
        try:
            server = Server.query.get(server_id)
            if server:
                server.last_seen = datetime.utcnow()
                if server.status != 'online':
                    server.status = 'online'
                db.session.commit()

            # Store metrics if provided
            if metrics:
                self._store_metrics(server_id, metrics)
        except Exception as e:
            print(f"Error updating heartbeat: {e}")
            db.session.rollback()

    def _store_metrics(self, server_id: str, metrics: dict):
        """Store metrics from heartbeat"""
        try:
            metric = ServerMetrics(
                server_id=server_id,
                cpu_percent=metrics.get('cpu_percent'),
                memory_percent=metrics.get('memory_percent'),
                disk_percent=metrics.get('disk_percent'),
                container_count=metrics.get('container_count'),
                container_running=metrics.get('container_running'),
            )
            db.session.add(metric)
            db.session.commit()
        except Exception as e:
            print(f"Error storing metrics: {e}")
            db.session.rollback()

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

        # Send command via WebSocket
        try:
            self._socketio.emit(
                'command',
                {
                    'type': 'command',
                    'id': command_id,
                    'action': action,
                    'params': params or {},
                    'timeout': int(timeout * 1000)
                },
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
        except Exception as e:
            db.session.rollback()

        return result

    def handle_command_result(self, socket_id: str, result: dict):
        """Handle command result from agent"""
        agent = self.get_agent_by_socket(socket_id)
        if not agent:
            return

        command_id = result.get('command_id')
        if not command_id:
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

    def verify_agent_auth(self, agent_id: str, api_key_prefix: str, signature: str, timestamp: int) -> Optional[Server]:
        """
        Verify agent authentication.

        Args:
            agent_id: Agent's unique ID
            api_key_prefix: First 12 chars of API key
            signature: HMAC-SHA256 signature
            timestamp: Unix timestamp in milliseconds

        Returns:
            Server if authenticated, None otherwise
        """
        # Check timestamp (allow 5 minute window)
        now = int(time.time() * 1000)
        if abs(now - timestamp) > 300000:  # 5 minutes
            return None

        # Find server by agent_id
        server = Server.query.filter_by(agent_id=agent_id).first()
        if not server:
            return None

        # Verify API key prefix matches
        if server.api_key_prefix != api_key_prefix:
            return None

        # Note: Full signature verification would require storing the secret
        # For now, we verify the API key prefix matches

        return server

    # ==================== System Info ====================

    def update_system_info(self, server_id: str, info: dict):
        """Update server system information from agent"""
        try:
            server = Server.query.get(server_id)
            if server:
                server.hostname = info.get('hostname', server.hostname)
                server.os_type = info.get('os', server.os_type)
                server.os_version = info.get('os_version', server.os_version)
                server.platform = info.get('platform', server.platform)
                server.architecture = info.get('architecture', server.architecture)
                server.cpu_cores = info.get('cpu_cores', server.cpu_cores)
                server.cpu_model = info.get('cpu_model', server.cpu_model)
                server.total_memory = info.get('total_memory', server.total_memory)
                server.total_disk = info.get('total_disk', server.total_disk)
                server.docker_version = info.get('docker_version', server.docker_version)
                server.agent_version = info.get('agent_version', server.agent_version)
                db.session.commit()
        except Exception as e:
            print(f"Error updating system info: {e}")
            db.session.rollback()


# Global instance
agent_registry = AgentRegistry()
