"""
Agent Gateway

WebSocket gateway for ServerKit agents.
Handles agent connections, authentication, and message routing.
"""

from flask import request
from flask_socketio import Namespace, emit, disconnect
import json
import time

from app.services.agent_registry import agent_registry
from app.models.server import Server


class AgentNamespace(Namespace):
    """
    SocketIO namespace for agent connections.

    Agents connect to: /agent
    """

    def on_connect(self):
        """Handle agent connection attempt"""
        # Connection is not authenticated yet
        # Agent must send auth message first
        print(f"[AgentGateway] New connection from {request.remote_addr}")

    def on_disconnect(self):
        """Handle agent disconnection"""
        sid = request.sid
        print(f"[AgentGateway] Disconnect: {sid}")
        agent_registry.unregister_agent(sid, reason='disconnect')

    def on_auth(self, data):
        """
        Handle agent authentication.

        Expected data:
        {
            "type": "auth",
            "agent_id": "uuid",
            "api_key_prefix": "sk_xxx",
            "signature": "hmac_signature",
            "timestamp": unix_ms
        }
        """
        sid = request.sid
        agent_id = data.get('agent_id')
        api_key_prefix = data.get('api_key_prefix')
        signature = data.get('signature')
        timestamp = data.get('timestamp', 0)

        print(f"[AgentGateway] Auth attempt from agent {agent_id}")

        if not all([agent_id, api_key_prefix, signature]):
            emit('auth_fail', {
                'type': 'auth_fail',
                'error': 'Missing required fields'
            })
            disconnect()
            return

        # Verify authentication
        server = agent_registry.verify_agent_auth(
            agent_id, api_key_prefix, signature, timestamp
        )

        if not server:
            emit('auth_fail', {
                'type': 'auth_fail',
                'error': 'Authentication failed'
            })
            disconnect()
            return

        # Register agent
        ip_address = request.remote_addr
        agent_version = request.headers.get('User-Agent', '').replace('ServerKit-Agent/', '')

        session_token = agent_registry.register_agent(
            server_id=server.id,
            socket_id=sid,
            ip_address=ip_address,
            agent_version=agent_version
        )

        # Calculate token expiry (1 hour)
        expires = int((time.time() + 3600) * 1000)

        emit('auth_ok', {
            'type': 'auth_ok',
            'session_token': session_token,
            'expires': expires,
            'server_id': server.id
        })

        print(f"[AgentGateway] Agent {agent_id} authenticated successfully")

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
        agent_registry.update_heartbeat(agent.server_id, metrics)

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
        agent_registry.update_system_info(agent.server_id, info)

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

        # Broadcast to subscribers
        # The channel format determines where to broadcast:
        # - "metrics" -> room: f"server_{server_id}_metrics"
        # - "container:xxx:logs" -> room: f"server_{server_id}_container_logs"

        if channel == 'metrics':
            room = f"server_{agent.server_id}_metrics"
        elif channel.startswith('container:') and channel.endswith(':logs'):
            container_id = channel.split(':')[1]
            room = f"server_{agent.server_id}_container_{container_id}_logs"
        else:
            room = f"server_{agent.server_id}_{channel}"

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
            print(f"[AgentGateway] Error from server {agent.server_id}: {data}")


def init_agent_gateway(socketio):
    """Initialize the agent gateway namespace"""
    agent_registry.init_socketio(socketio)
    socketio.on_namespace(AgentNamespace('/agent'))
    print("[AgentGateway] Agent gateway initialized on /agent namespace")
