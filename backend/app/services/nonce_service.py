"""
Nonce Service for ServerKit.

Tracks used nonces to prevent replay attacks.
Nonces are stored with a TTL and automatically cleaned up.
"""

import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Tuple


class NonceService:
    """
    Service to track used nonces and prevent replay attacks.

    Nonces are stored in memory with a 5-minute TTL.
    In production, consider using Redis for distributed deployments.
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

        # Store nonces with expiry time: {(server_id, nonce): expiry_timestamp}
        self._nonces: Dict[Tuple[str, str], float] = {}
        self._lock = threading.Lock()

        # TTL for nonces (5 minutes)
        self._ttl = 300

        # Start cleanup thread
        self._stop_cleanup = threading.Event()
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            daemon=True
        )
        self._cleanup_thread.start()

    def check_and_record(self, server_id: str, nonce: str) -> bool:
        """
        Check if a nonce is valid (not previously used) and record it.

        Args:
            server_id: The server ID associated with the nonce
            nonce: The nonce value to check

        Returns:
            bool: True if the nonce is valid (not a replay), False if replay detected
        """
        if not nonce:
            return False

        key = (server_id, nonce)
        now = time.time()
        expiry = now + self._ttl

        with self._lock:
            # Check if nonce already exists and hasn't expired
            if key in self._nonces:
                if self._nonces[key] > now:
                    # Nonce already used and not expired - replay attack!
                    return False
                # Nonce expired, can be reused (though unlikely in practice)

            # Record the nonce
            self._nonces[key] = expiry
            return True

    def is_replay(self, server_id: str, nonce: str) -> bool:
        """
        Check if a nonce would be considered a replay (without recording).

        Args:
            server_id: The server ID associated with the nonce
            nonce: The nonce value to check

        Returns:
            bool: True if this would be a replay, False otherwise
        """
        if not nonce:
            return True

        key = (server_id, nonce)
        now = time.time()

        with self._lock:
            if key in self._nonces:
                return self._nonces[key] > now
            return False

    def _cleanup_loop(self):
        """Background thread to clean up expired nonces."""
        while not self._stop_cleanup.is_set():
            try:
                self._cleanup_expired()
            except Exception as e:
                print(f"Error in nonce cleanup: {e}")

            # Run cleanup every minute
            self._stop_cleanup.wait(60)

    def _cleanup_expired(self):
        """Remove expired nonces from storage."""
        now = time.time()
        expired_keys = []

        with self._lock:
            for key, expiry in self._nonces.items():
                if expiry <= now:
                    expired_keys.append(key)

            for key in expired_keys:
                del self._nonces[key]

        if expired_keys:
            print(f"[NonceService] Cleaned up {len(expired_keys)} expired nonces")

    def get_stats(self) -> dict:
        """Get statistics about nonce tracking."""
        with self._lock:
            now = time.time()
            active_count = sum(1 for exp in self._nonces.values() if exp > now)
            return {
                'total_tracked': len(self._nonces),
                'active_nonces': active_count,
                'ttl_seconds': self._ttl
            }

    def clear_server_nonces(self, server_id: str):
        """
        Clear all nonces for a specific server.

        Useful when rotating API keys.

        Args:
            server_id: The server ID to clear nonces for
        """
        with self._lock:
            keys_to_remove = [key for key in self._nonces if key[0] == server_id]
            for key in keys_to_remove:
                del self._nonces[key]


# Global instance
nonce_service = NonceService()
