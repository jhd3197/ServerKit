"""
Agent Gateway

WebSocket gateway for ServerKit agents.
Handles agent connections, authentication, and message routing.
"""

import json
import logging
import time

from flask import request
from flask_socketio import Namespace, emit, disconnect

from app import sockets_rooms as rooms

from app.services.agent_registry import agent_registry
from app.models.server import Server

logger = logging.getLogger(__name__)

# The per-IP auth rate limiter is transport-neutral state and lives with the
# shared handshake door in agent_registry. Re-exported here for
# callers/tests that historically reached it via the gateway module.
from app.services.agent_registry import (  # noqa: F401
    _AUTH_RATE_LIMIT,
    _AUTH_RATE_WINDOW,
    _auth_attempts,
    _check_auth_rate_limit,
)


class AgentNamespace(Namespace):
    """
    SocketIO namespace for agent connections.

    Agents connect to: /agent
    """

    def on_connect(self):
        """Handle agent connection attempt"""
        # Connection is not authenticated yet
        # Agent must send auth message first
        logger.info("New connection from %s", request.remote_addr)

    def on_disconnect(self):
        """Handle agent disconnection"""
        sid = request.sid
        logger.info("Disconnect: %s", sid)
        agent_registry.unregister_agent(sid, reason='disconnect')

    def on_auth(self, data):
        """
        Handle agent authentication.

        Thin adapter over agent_registry.authenticate_and_register — the
        handshake sequence itself is transport-neutral and shared
        with the long-poll /connect endpoint; this handler only translates
        the outcome into socket emits/disconnects.

        Expected data:
        {
            "type": "auth",
            "agent_id": "uuid",
            "api_key_prefix": "sk_xxx",
            "signature": "hmac_signature",
            "timestamp": unix_ms,
            "nonce": "unique_nonce" (optional but recommended)
        }
        """
        sid = request.sid
        ip_address = request.remote_addr
        logger.info("Auth attempt from agent %s at %s",
                    (data or {}).get('agent_id'), ip_address)

        session_token, server, error = agent_registry.authenticate_and_register(
            data or {},
            ip_address,
            user_agent=request.headers.get('User-Agent', ''),
            transport='ws',
            socket_id=sid,
        )

        if error == 'rate_limited':
            emit('auth_response', {'success': False, 'error': 'Rate limit exceeded'}, room=request.sid, namespace='/agent')
            return
        if error is not None:
            messages = {
                'missing_fields': 'Missing required fields',
                'auth_failed': 'Authentication failed',
                'ip_not_allowed': 'IP address not allowed',
                'registration_failed': 'Registration failed',
            }
            emit('auth_fail', {
                'type': 'auth_fail',
                'error': messages.get(error, 'Authentication failed')
            })
            disconnect()
            return

        # Calculate token expiry (1 hour)
        expires = int((time.time() + 3600) * 1000)

        emit('auth_ok', {
            'type': 'auth_ok',
            'session_token': session_token,
            'expires': expires,
            'server_id': server.id
        })

    def on_heartbeat(self, data):
        """
        Handle agent heartbeat.

        Expected data:
        {
            "type": "heartbeat",
            "metrics": {
                "cpu_percent": float,
                "memory_percent": float,
                "disk_percent": float,
                "container_count": int,
                "container_running": int
            }
        }
        """
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if not agent:
            emit('error', {
                'type': 'error',
                'code': 'NOT_AUTHENTICATED',
                'message': 'Not authenticated'
            })
            return

        metrics = data.get('metrics', {})
        agent_registry.ingest_agent_state(
            agent, metrics=metrics,
            permission_level=data.get('permission_level'),
            service_checks=data.get('service_checks'))

        emit('heartbeat_ack', {'type': 'heartbeat_ack'})

    def on_command_result(self, data):
        """
        Handle command result from agent.

        Expected data:
        {
            "type": "command_result",
            "command_id": "uuid",
            "success": bool,
            "data": any,
            "error": string,
            "duration": int (ms)
        }
        """
        sid = request.sid
        agent_registry.handle_command_result(sid, data)

    def on_system_info(self, data):
        """
        Handle system info update from agent.

        Expected data:
        {
            "type": "system_info",
            "info": {
                "hostname": string,
                "os": string,
                "os_version": string,
                "platform": string,
                "architecture": string,
                "cpu_cores": int,
                "cpu_model": string,
                "total_memory": int,
                "total_disk": int,
                "docker_version": string,
                "agent_version": string
            }
        }
        """
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if not agent:
            emit('error', {
                'type': 'error',
                'code': 'NOT_AUTHENTICATED',
                'message': 'Not authenticated'
            })
            return

        info = data.get('info', {})
        agent_registry.ingest_agent_state(agent, sysinfo=info)

    def on_capabilities(self, data):
        """
        Handle agent capability advertisement.

        Sent by the agent right after auth succeeds (and on every
        reconnect). The payload tells the panel which feature surfaces
        this agent can drive — cron, docker, systemd, etc. — and is
        used to filter target pickers in the UI.

        Expected data:
        {
            "type": "capabilities",
            "capabilities": {"docker": true, "cron": true, ...},
            "platform": "linux",
            "distro": "ubuntu",
            "distro_version": "22.04"
        }
        """
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if not agent:
            emit('error', {
                'type': 'error',
                'code': 'NOT_AUTHENTICATED',
                'message': 'Not authenticated'
            })
            return

        # Capability side-effects (incl. the WireGuard tunnel reconcile)
        # happen inside the shared ingest so both transports — this WS
        # handler and the long-poll /poll body — behave identically.
        agent_registry.ingest_agent_state(agent, capabilities=data or {})

    def on_stream(self, data):
        """
        Handle streaming data from agent (logs, metrics).

        Expected data:
        {
            "type": "stream",
            "channel": string,
            "data": any
        }
        """
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if not agent:
            return

        channel = data.get('channel')
        stream_data = data.get('data')

        # A malformed/partial stream frame — exactly what the poll fallback
        # exists to tolerate — can omit or null the channel. Calling
        # .startswith on a non-string would raise AttributeError; drop the
        # frame instead of letting the handler crash.
        if not isinstance(channel, str) or not channel:
            return

        # Broadcast to subscribers. The channel format determines the room
        # (grammar owned by app/sockets_rooms.py):
        # - "metrics"              -> server_metrics_room
        # - "container:xxx:logs"   -> server_container_logs_room

        if channel == 'metrics':
            room = rooms.server_metrics_room(agent.server_id)
        elif channel.startswith('container:') and channel.endswith(':logs'):
            parts = channel.split(':')
            if len(parts) < 3:
                return
            container_id = parts[1]
            room = rooms.server_container_logs_room(agent.server_id, container_id)
        else:
            room = rooms.server_channel_room(agent.server_id, channel)

        # Emit to the main namespace for UI clients
        from app import get_socketio
        socketio = get_socketio()
        if socketio:
            socketio.emit(
                'server_stream',
                {
                    'server_id': agent.server_id,
                    'channel': channel,
                    'data': stream_data
                },
                room=room
            )

    def on_error(self, data):
        """Handle error message from agent"""
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if agent:
            logger.warning("Error from server %s: %s", agent.server_id, data)

    def on_credential_update_ack(self, data):
        """
        Handle credential update acknowledgment from agent.

        Expected data:
        {
            "type": "credential_update_ack",
            "rotation_id": "uuid",
            "success": bool,
            "error": string (optional)
        }
        """
        sid = request.sid
        agent = agent_registry.get_agent_by_socket(sid)

        if not agent:
            emit('error', {
                'type': 'error',
                'code': 'NOT_AUTHENTICATED',
                'message': 'Not authenticated'
            })
            return

        rotation_id = data.get('rotation_id')
        success = data.get('success', False)
        error = data.get('error')

        logger.info("Credential update ack from %s: success=%s", agent.server_id, success)

        if not rotation_id:
            emit('error', {
                'type': 'error',
                'code': 'MISSING_ROTATION_ID',
                'message': 'Missing rotation_id'
            })
            return

        try:
            from app import db
            server = Server.query.get(agent.server_id)

            if not server:
                return

            if success:
                # Complete the rotation
                if server.complete_key_rotation(rotation_id):
                    db.session.commit()
                    logger.info("Key rotation completed for server %s", server.id)

                    # Clear nonces for this server since we have new credentials
                    from app.services.nonce_service import nonce_service
                    nonce_service.clear_server_nonces(server.id)
                else:
                    logger.warning("Key rotation completion failed for server %s", server.id)
            else:
                # Agent failed to update credentials, cancel rotation
                server.cancel_key_rotation()
                db.session.commit()
                logger.info("Key rotation cancelled for server %s: %s", server.id, error)

        except Exception:
            # Roll back the poisoned session so the next DB user on this
            # worker doesn't inherit a broken transaction.
            from app import db
            db.session.rollback()
            logger.exception("Error handling credential update ack")


def init_agent_gateway(socketio):
    """Initialize the agent gateway namespace"""
    agent_registry.init_socketio(socketio)
    socketio.on_namespace(AgentNamespace('/agent'))
    logger.info("Agent gateway initialized on /agent namespace")
