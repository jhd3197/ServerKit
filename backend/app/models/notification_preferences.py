"""
User Notification Preferences Model

Stores per-user notification preferences for receiving alerts.
"""

from datetime import datetime
from app import db
import json


class NotificationPreferences(db.Model):
    __tablename__ = 'notification_preferences'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)

    # Global toggle - whether to receive any notifications
    enabled = db.Column(db.Boolean, default=True)

    # Which channels this user wants to receive notifications on
    # JSON array of channel names: ['email', 'discord', 'slack', 'telegram']
    channels = db.Column(db.Text, default='["email"]')

    # Severity levels this user wants to be notified about
    # JSON array: ['critical', 'warning', 'info', 'success']
    severities = db.Column(db.Text, default='["critical", "warning"]')

    # Personal email for notifications (overrides global email list if set)
    email = db.Column(db.String(255), nullable=True)

    # Personal Discord webhook (for DMs or personal server)
    discord_webhook = db.Column(db.String(512), nullable=True)

    # Personal Telegram chat ID (for personal notifications)
    telegram_chat_id = db.Column(db.String(64), nullable=True)

    # Notification categories the user wants
    # JSON object with category: boolean
    categories = db.Column(db.Text, default='{"system": true, "security": true, "backups": true, "apps": true}')

    # Quiet hours (don't send non-critical notifications during these hours)
    quiet_hours_enabled = db.Column(db.Boolean, default=False)
    quiet_hours_start = db.Column(db.String(5), default='22:00')  # HH:MM format
    quiet_hours_end = db.Column(db.String(5), default='08:00')

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user = db.relationship('User', backref=db.backref('notification_preferences', uselist=False))

    def get_channels(self):
        """Get the list of enabled channels."""
        try:
            return json.loads(self.channels) if self.channels else ['email']
        except (json.JSONDecodeError, TypeError):
            return ['email']

    def set_channels(self, channels_list):
        """Set the list of enabled channels."""
        self.channels = json.dumps(channels_list)

    def get_severities(self):
        """Get the list of enabled severity levels."""
        try:
            return json.loads(self.severities) if self.severities else ['critical', 'warning']
        except (json.JSONDecodeError, TypeError):
            return ['critical', 'warning']

    def set_severities(self, severities_list):
        """Set the list of enabled severity levels."""
        self.severities = json.dumps(severities_list)

    def get_categories(self):
        """Get notification category preferences."""
        try:
            return json.loads(self.categories) if self.categories else {
                'system': True,
                'security': True,
                'backups': True,
                'apps': True
            }
        except (json.JSONDecodeError, TypeError):
            return {'system': True, 'security': True, 'backups': True, 'apps': True}

    def set_categories(self, categories_dict):
        """Set notification category preferences."""
        self.categories = json.dumps(categories_dict)

    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'enabled': self.enabled,
            'channels': self.get_channels(),
            'severities': self.get_severities(),
            'email': self.email,
            'discord_webhook': self.discord_webhook[:30] + '...' if self.discord_webhook and len(self.discord_webhook) > 30 else self.discord_webhook,
            'telegram_chat_id': self.telegram_chat_id,
            'categories': self.get_categories(),
            'quiet_hours': {
                'enabled': self.quiet_hours_enabled,
                'start': self.quiet_hours_start,
                'end': self.quiet_hours_end
            },
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

    @classmethod
    def get_or_create(cls, user_id):
        """Get existing preferences or create default ones."""
        prefs = cls.query.filter_by(user_id=user_id).first()
        if not prefs:
            prefs = cls(user_id=user_id)
            db.session.add(prefs)
            db.session.commit()
        return prefs

    def __repr__(self):
        return f'<NotificationPreferences user_id={self.user_id}>'
