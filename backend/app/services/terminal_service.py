"""Service for managing remote terminal sessions via agents."""

import uuid
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from app.services.agent_registry import agent_registry

logger = logging.getLogger(__name__)


class TerminalService:
    """Service for managing remote terminal sessions."""

    # Active terminal sessions: session_id -> {server_id, user_id, created_at}
    _sessions: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def create_session(cls, server_id: str, user_id: int,
                       cols: int = 80, rows: int = 24) -> Dict[str, Any]:
        """Create a new terminal session on a remote server.

        Args:
            server_id: Target server ID
            user_id: User ID creating the session
            cols: Terminal width in columns
            rows: Terminal height in rows

        Returns:
            dict: {success, session_id, shell, error}
        """
        if server_id == 'local':
            return {'success': False, 'error': 'Terminal not supported for local server'}

        # Generate unique session ID
        session_id = f"term_{uuid.uuid4().hex[:12]}"

        # Send command to agent to create terminal
        result = agent_registry.send_command(
            server_id=server_id,
            action='terminal:create',
            params={
                'session_id': session_id,
                'cols': cols,
                'rows': rows
            },
            timeout=30.0,
            user_id=user_id
        )

        if not result.get('success'):
            return result

        # Store session info
        cls._sessions[session_id] = {
            'server_id': server_id,
            'user_id': user_id,
            'created_at': datetime.utcnow(),
            'cols': cols,
            'rows': rows,
            'shell': result.get('data', {}).get('shell', 'unknown')
        }

        data = result.get('data', {})
        return {
            'success': True,
            'session_id': session_id,
            'server_id': server_id,
            'shell': data.get('shell'),
            'cols': data.get('cols', cols),
            'rows': data.get('rows', rows)
        }

    @classmethod
    def send_input(cls, session_id: str, data: str, user_id: int) -> Dict[str, Any]:
        """Send input to a terminal session.

        Args:
            session_id: Terminal session ID
            data: Base64-encoded input data
            user_id: User ID (for authorization)

        Returns:
            dict: {success, error}
        """
        session = cls._sessions.get(session_id)
        if not session:
            return {'success': False, 'error': 'Session not found'}

        # Verify user owns this session
        if session['user_id'] != user_id:
            return {'success': False, 'error': 'Unauthorized'}

        result = agent_registry.send_command(
            server_id=session['server_id'],
            action='terminal:input',
            params={
                'session_id': session_id,
                'data': data
            },
            timeout=5.0,
            user_id=user_id
        )

        return result

    @classmethod
    def resize_session(cls, session_id: str, cols: int, rows: int,
                       user_id: int) -> Dict[str, Any]:
        """Resize a terminal session.

        Args:
            session_id: Terminal session ID
            cols: New width in columns
            rows: New height in rows
            user_id: User ID (for authorization)

        Returns:
            dict: {success, error}
        """
        session = cls._sessions.get(session_id)
        if not session:
            return {'success': False, 'error': 'Session not found'}

        # Verify user owns this session
        if session['user_id'] != user_id:
            return {'success': False, 'error': 'Unauthorized'}

        result = agent_registry.send_command(
            server_id=session['server_id'],
            action='terminal:resize',
            params={
                'session_id': session_id,
                'cols': cols,
                'rows': rows
            },
            timeout=5.0,
            user_id=user_id
        )

        if result.get('success'):
            session['cols'] = cols
            session['rows'] = rows

        return result

    @classmethod
    def close_session(cls, session_id: str, user_id: int) -> Dict[str, Any]:
        """Close a terminal session.

        Args:
            session_id: Terminal session ID
            user_id: User ID (for authorization)

        Returns:
            dict: {success, error}
        """
        session = cls._sessions.get(session_id)
        if not session:
            return {'success': False, 'error': 'Session not found'}

        # Verify user owns this session
        if session['user_id'] != user_id:
            return {'success': False, 'error': 'Unauthorized'}

        result = agent_registry.send_command(
            server_id=session['server_id'],
            action='terminal:close',
            params={
                'session_id': session_id
            },
            timeout=5.0,
            user_id=user_id
        )

        # Remove from local tracking
        if session_id in cls._sessions:
            del cls._sessions[session_id]

        return result

    @classmethod
    def get_session(cls, session_id: str) -> Optional[Dict[str, Any]]:
        """Get session info.

        Args:
            session_id: Terminal session ID

        Returns:
            Session info dict or None
        """
        return cls._sessions.get(session_id)

    @classmethod
    def get_user_sessions(cls, user_id: int) -> list:
        """Get all sessions for a user.

        Args:
            user_id: User ID

        Returns:
            List of session info dicts
        """
        return [
            {'session_id': sid, **info}
            for sid, info in cls._sessions.items()
            if info['user_id'] == user_id
        ]

    @classmethod
    def cleanup_session(cls, session_id: str):
        """Remove a session from tracking (called when session closes)."""
        if session_id in cls._sessions:
            del cls._sessions[session_id]
            logger.info(f"Terminal session {session_id} cleaned up")
