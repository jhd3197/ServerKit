"""
Anomaly Detection Service for ServerKit.

Monitors for suspicious patterns and creates security alerts.
"""

import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Set
from collections import defaultdict

from app import db
from app.models.security_alert import SecurityAlert


class AnomalyDetectionService:
    """
    Service to detect anomalous behavior and create security alerts.

    Tracks:
    - Authentication failures (per IP and per server)
    - Command rate limiting
    - New IP connections
    - Suspicious patterns
    """

    _instance = None
    _lock = threading.Lock()

    # Thresholds for anomaly detection
    THRESHOLDS = {
        'auth_failures_per_minute': 5,
        'auth_failures_per_hour': 20,
        'commands_per_minute': 100,
        'new_ip_alert': True,  # Alert on first connection from new IP
    }

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

        # Track auth failures: {server_id: [(timestamp, ip_address), ...]}
        self._auth_failures: Dict[str, List[tuple]] = defaultdict(list)

        # Track known IPs per server: {server_id: set(ips)}
        self._known_ips: Dict[str, Set[str]] = defaultdict(set)

        # Track command counts: {server_id: [(timestamp, command_type), ...]}
        self._command_counts: Dict[str, List[tuple]] = defaultdict(list)

        self._lock = threading.Lock()

        # Start cleanup thread
        self._stop_cleanup = threading.Event()
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop,
            daemon=True
        )
        self._cleanup_thread.start()

    def track_auth_attempt(self, server_id: str, success: bool, ip_address: str):
        """
        Track an authentication attempt.

        Args:
            server_id: The server ID (or None for unknown server)
            success: Whether authentication succeeded
            ip_address: Source IP address
        """
        now = time.time()

        if not success:
            with self._lock:
                self._auth_failures[server_id or 'unknown'].append((now, ip_address))

            # Check for threshold violations
            self._check_auth_failure_thresholds(server_id, ip_address)

    def _check_auth_failure_thresholds(self, server_id: str, ip_address: str):
        """Check if auth failure thresholds are exceeded."""
        now = time.time()
        key = server_id or 'unknown'

        with self._lock:
            failures = self._auth_failures.get(key, [])

        # Count failures in the last minute
        minute_ago = now - 60
        minute_failures = [f for f in failures if f[0] > minute_ago]
        minute_failures_from_ip = [f for f in minute_failures if f[1] == ip_address]

        # Count failures in the last hour
        hour_ago = now - 3600
        hour_failures = [f for f in failures if f[0] > hour_ago]
        hour_failures_from_ip = [f for f in hour_failures if f[1] == ip_address]

        # Check per-minute threshold
        if len(minute_failures_from_ip) >= self.THRESHOLDS['auth_failures_per_minute']:
            self._create_alert(
                alert_type='auth_failure',
                severity='warning',
                server_id=server_id if server_id != 'unknown' else None,
                source_ip=ip_address,
                details={
                    'attempts': len(minute_failures_from_ip),
                    'window': '1m',
                    'threshold': self.THRESHOLDS['auth_failures_per_minute']
                }
            )

        # Check per-hour threshold
        if len(hour_failures_from_ip) >= self.THRESHOLDS['auth_failures_per_hour']:
            self._create_alert(
                alert_type='auth_failure',
                severity='critical',
                server_id=server_id if server_id != 'unknown' else None,
                source_ip=ip_address,
                details={
                    'attempts': len(hour_failures_from_ip),
                    'window': '1h',
                    'threshold': self.THRESHOLDS['auth_failures_per_hour']
                }
            )

    def track_command(self, server_id: str, command_type: str):
        """
        Track a command execution.

        Args:
            server_id: The server ID
            command_type: Type of command executed
        """
        now = time.time()

        with self._lock:
            self._command_counts[server_id].append((now, command_type))

        # Check rate limit
        self._check_command_rate(server_id)

    def _check_command_rate(self, server_id: str):
        """Check if command rate exceeds threshold."""
        now = time.time()
        minute_ago = now - 60

        with self._lock:
            commands = self._command_counts.get(server_id, [])
            recent_commands = [c for c in commands if c[0] > minute_ago]

        if len(recent_commands) >= self.THRESHOLDS['commands_per_minute']:
            self._create_alert(
                alert_type='rate_limit',
                severity='warning',
                server_id=server_id,
                details={
                    'commands': len(recent_commands),
                    'window': '1m',
                    'threshold': self.THRESHOLDS['commands_per_minute']
                }
            )

    def check_new_ip(self, server_id: str, ip_address: str) -> bool:
        """
        Check if this is a new IP for the server.

        Creates an info alert if it's a new IP.

        Args:
            server_id: The server ID
            ip_address: The IP address to check

        Returns:
            bool: True if this is a new IP
        """
        with self._lock:
            known = self._known_ips[server_id]
            is_new = ip_address not in known
            known.add(ip_address)

        if is_new and self.THRESHOLDS['new_ip_alert']:
            self._create_alert(
                alert_type='new_ip',
                severity='info',
                server_id=server_id,
                source_ip=ip_address,
                details={
                    'message': 'First connection from this IP address'
                }
            )

        return is_new

    def track_ip_blocked(self, server_id: str, ip_address: str, allowed_ips: List[str]):
        """
        Track when an IP is blocked by allowlist.

        Args:
            server_id: The server ID
            ip_address: The blocked IP
            allowed_ips: The allowlist that blocked it
        """
        self._create_alert(
            alert_type='ip_blocked',
            severity='warning',
            server_id=server_id,
            source_ip=ip_address,
            details={
                'message': 'Connection attempt from non-allowed IP',
                'allowed_ips_count': len(allowed_ips)
            }
        )

    def track_replay_attack(self, server_id: str, ip_address: str, nonce: str):
        """
        Track a detected replay attack.

        Args:
            server_id: The server ID
            ip_address: Source IP
            nonce: The replayed nonce
        """
        self._create_alert(
            alert_type='replay_attack',
            severity='critical',
            server_id=server_id,
            source_ip=ip_address,
            details={
                'message': 'Replay attack detected - nonce already used',
                'nonce_prefix': nonce[:8] if nonce else None
            }
        )

    def _create_alert(
        self,
        alert_type: str,
        severity: str,
        server_id: str = None,
        source_ip: str = None,
        details: dict = None
    ):
        """
        Create a security alert if a similar one doesn't already exist.

        Prevents duplicate alerts within a short time window.
        """
        try:
            # Check for recent similar alert (within 5 minutes)
            five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
            existing = SecurityAlert.query.filter(
                SecurityAlert.alert_type == alert_type,
                SecurityAlert.server_id == server_id,
                SecurityAlert.source_ip == source_ip,
                SecurityAlert.status == 'open',
                SecurityAlert.created_at > five_minutes_ago
            ).first()

            if existing:
                # Update existing alert details instead of creating new one
                if existing.details and details:
                    existing.details['attempts'] = details.get('attempts', existing.details.get('attempts'))
                    existing.details['last_seen'] = datetime.utcnow().isoformat()
                    db.session.commit()
                return

            # Create new alert
            SecurityAlert.create_alert(
                alert_type=alert_type,
                severity=severity,
                server_id=server_id,
                source_ip=source_ip,
                details=details
            )
            print(f"[AnomalyDetection] Created {severity} alert: {alert_type} for server {server_id}")

        except Exception as e:
            print(f"[AnomalyDetection] Error creating alert: {e}")

    def get_alerts(
        self,
        server_id: str = None,
        status: str = None,
        severity: str = None,
        alert_type: str = None,
        limit: int = 100
    ) -> List[SecurityAlert]:
        """
        Get security alerts with optional filters.

        Args:
            server_id: Filter by server ID
            status: Filter by status (open, acknowledged, resolved)
            severity: Filter by severity (info, warning, critical)
            alert_type: Filter by alert type
            limit: Maximum number of alerts to return

        Returns:
            List of SecurityAlert objects
        """
        query = SecurityAlert.query

        if server_id:
            query = query.filter(SecurityAlert.server_id == server_id)
        if status:
            query = query.filter(SecurityAlert.status == status)
        if severity:
            query = query.filter(SecurityAlert.severity == severity)
        if alert_type:
            query = query.filter(SecurityAlert.alert_type == alert_type)

        return query.order_by(SecurityAlert.created_at.desc()).limit(limit).all()

    def get_alert_counts(self, server_id: str = None) -> dict:
        """
        Get counts of alerts by status and severity.

        Args:
            server_id: Filter by server ID (optional)

        Returns:
            dict with counts
        """
        from sqlalchemy import func

        query = db.session.query(
            SecurityAlert.status,
            SecurityAlert.severity,
            func.count(SecurityAlert.id)
        ).group_by(SecurityAlert.status, SecurityAlert.severity)

        if server_id:
            query = query.filter(SecurityAlert.server_id == server_id)

        results = query.all()

        counts = {
            'by_status': defaultdict(int),
            'by_severity': defaultdict(int),
            'total': 0
        }

        for status, severity, count in results:
            counts['by_status'][status] += count
            counts['by_severity'][severity] += count
            counts['total'] += count

        return dict(counts)

    def _cleanup_loop(self):
        """Background thread to clean up old tracking data."""
        while not self._stop_cleanup.is_set():
            try:
                self._cleanup_old_data()
            except Exception as e:
                print(f"Error in anomaly detection cleanup: {e}")

            # Run cleanup every 5 minutes
            self._stop_cleanup.wait(300)

    def _cleanup_old_data(self):
        """Remove old tracking data to prevent memory growth."""
        now = time.time()
        hour_ago = now - 3600

        with self._lock:
            # Clean up auth failures older than 1 hour
            for server_id in list(self._auth_failures.keys()):
                self._auth_failures[server_id] = [
                    f for f in self._auth_failures[server_id]
                    if f[0] > hour_ago
                ]
                if not self._auth_failures[server_id]:
                    del self._auth_failures[server_id]

            # Clean up command counts older than 1 hour
            for server_id in list(self._command_counts.keys()):
                self._command_counts[server_id] = [
                    c for c in self._command_counts[server_id]
                    if c[0] > hour_ago
                ]
                if not self._command_counts[server_id]:
                    del self._command_counts[server_id]

    def load_known_ips(self):
        """
        Load known IPs from database.

        Should be called on startup to populate the known IPs cache.
        """
        try:
            from app.models.server import AgentSession

            sessions = AgentSession.query.filter(
                AgentSession.ip_address.isnot(None)
            ).all()

            with self._lock:
                for session in sessions:
                    if session.server_id and session.ip_address:
                        self._known_ips[session.server_id].add(session.ip_address)

            print(f"[AnomalyDetection] Loaded known IPs for {len(self._known_ips)} servers")

        except Exception as e:
            print(f"[AnomalyDetection] Error loading known IPs: {e}")


# Global instance
anomaly_detection_service = AnomalyDetectionService()
