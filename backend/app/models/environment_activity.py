"""
Environment Activity Model

Audit log for all environment actions (create, deploy, promote, lock, etc.).
Tracks who did what, when, and how long it took.
"""

from datetime import datetime
from app import db
import json


class EnvironmentActivity(db.Model):
    """Audit log for environment actions."""

    __tablename__ = 'environment_activities'

    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Action details
    action = db.Column(db.String(50), nullable=False)  # create, deploy, promote, lock, unlock, destroy
    description = db.Column(db.Text)
    activity_metadata = db.Column('metadata', db.Text)  # JSON

    # Result
    status = db.Column(db.String(20), default='completed')  # pending, running, completed, failed
    error_message = db.Column(db.Text)
    duration_seconds = db.Column(db.Float)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    site = db.relationship('WordPressSite', backref=db.backref('activities', lazy='dynamic'))
    user = db.relationship('User', backref=db.backref('environment_activities', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'site_id': self.site_id,
            'user_id': self.user_id,
            'action': self.action,
            'description': self.description,
            'metadata': json.loads(self.activity_metadata) if self.activity_metadata else None,
            'status': self.status,
            'error_message': self.error_message,
            'duration_seconds': self.duration_seconds,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<EnvironmentActivity {self.id} {self.action} site={self.site_id}>'
