"""
Security Alert Model for ServerKit.

Stores security alerts from anomaly detection.
"""

import uuid
from datetime import datetime
from app import db


class SecurityAlert(db.Model):
    """Security alerts from anomaly detection"""
    __tablename__ = 'security_alerts'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=True, index=True)

    # Alert classification
    alert_type = db.Column(db.String(50), nullable=False, index=True)
    # Types: auth_failure, rate_limit, new_ip, suspicious_pattern, ip_blocked, replay_attack

    severity = db.Column(db.String(20), nullable=False, default='info', index=True)
    # Severities: info, warning, critical

    # Source information
    source_ip = db.Column(db.String(45))  # IPv4 or IPv6

    # Alert details (JSON for flexibility)
    details = db.Column(db.JSON)
    # Example: {"attempts": 5, "window": "1m", "threshold": 5}

    # Alert status
    status = db.Column(db.String(20), default='open', index=True)
    # Statuses: open, acknowledged, resolved

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    acknowledged_at = db.Column(db.DateTime)
    acknowledged_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    resolved_at = db.Column(db.DateTime)
    resolved_by = db.Column(db.Integer, db.ForeignKey('users.id'))

    # Relationships
    server = db.relationship('Server', backref=db.backref('security_alerts', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'server_name': self.server.name if self.server else None,
            'alert_type': self.alert_type,
            'severity': self.severity,
            'source_ip': self.source_ip,
            'details': self.details,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'acknowledged_at': self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            'acknowledged_by': self.acknowledged_by,
            'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
            'resolved_by': self.resolved_by,
        }

    @staticmethod
    def create_alert(
        alert_type: str,
        severity: str = 'info',
        server_id: str = None,
        source_ip: str = None,
        details: dict = None
    ) -> 'SecurityAlert':
        """
        Create a new security alert.

        Args:
            alert_type: Type of alert (auth_failure, rate_limit, etc.)
            severity: Alert severity (info, warning, critical)
            server_id: Associated server ID (optional)
            source_ip: Source IP address (optional)
            details: Additional details as dict (optional)

        Returns:
            SecurityAlert: The created alert
        """
        alert = SecurityAlert(
            alert_type=alert_type,
            severity=severity,
            server_id=server_id,
            source_ip=source_ip,
            details=details or {}
        )
        db.session.add(alert)
        db.session.commit()
        return alert

    def acknowledge(self, user_id: int = None):
        """Mark alert as acknowledged."""
        self.status = 'acknowledged'
        self.acknowledged_at = datetime.utcnow()
        self.acknowledged_by = user_id
        db.session.commit()

    def resolve(self, user_id: int = None):
        """Mark alert as resolved."""
        self.status = 'resolved'
        self.resolved_at = datetime.utcnow()
        self.resolved_by = user_id
        db.session.commit()

    def __repr__(self):
        return f'<SecurityAlert {self.alert_type} ({self.severity}) - {self.status}>'
