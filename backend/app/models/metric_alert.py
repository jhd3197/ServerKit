"""Models for fleet-wide metric monitoring and alerting."""

from datetime import datetime
from app import db
from app.models.mixins import uuid_pk, TimestampMixin


class ServerAlertThreshold(TimestampMixin, db.Model):
    """Per-server or global alert threshold configuration."""
    __tablename__ = 'server_alert_thresholds'

    id = uuid_pk()
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=True, index=True)
    # null = global default

    metric = db.Column(db.String(20), nullable=False)  # cpu, memory, disk
    warning_threshold = db.Column(db.Float, default=80.0)
    critical_threshold = db.Column(db.Float, default=95.0)
    duration_seconds = db.Column(db.Integer, default=300)  # sustained for N seconds
    enabled = db.Column(db.Boolean, default=True)


    server = db.relationship('Server', backref='alert_thresholds')

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'server_name': self.server.name if self.server else None,
            'metric': self.metric,
            'warning_threshold': self.warning_threshold,
            'critical_threshold': self.critical_threshold,
            'duration_seconds': self.duration_seconds,
            'enabled': self.enabled,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class MetricAlert(db.Model):
    """Alert triggered when server metrics exceed thresholds."""
    __tablename__ = 'metric_alerts'

    id = uuid_pk()
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)

    metric = db.Column(db.String(20), nullable=False)  # cpu, memory, disk
    severity = db.Column(db.String(10), nullable=False)  # warning, critical
    value = db.Column(db.Float)  # the value that triggered it
    threshold = db.Column(db.Float)  # the threshold exceeded
    duration_seconds = db.Column(db.Integer)  # how long it was exceeded

    detail = db.Column(db.Text)  # human message for offline / service-check alerts

    status = db.Column(db.String(20), default='active', index=True)  # active, acknowledged, resolved
    acknowledged_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    resolved_at = db.Column(db.DateTime)

    server = db.relationship('Server', backref='metric_alerts')

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'server_name': self.server.name if self.server else None,
            'metric': self.metric,
            'severity': self.severity,
            'value': self.value,
            'threshold': self.threshold,
            'duration_seconds': self.duration_seconds,
            'detail': self.detail,
            'status': self.status,
            'acknowledged_by': self.acknowledged_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
        }
