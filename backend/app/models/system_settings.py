from datetime import datetime
from app import db


class SystemSettings(db.Model):
    """Key-value store for system-wide settings."""
    __tablename__ = 'system_settings'

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False, index=True)
    value = db.Column(db.Text, nullable=True)
    value_type = db.Column(db.String(20), default='string')  # string, boolean, integer, json
    description = db.Column(db.String(500), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Relationship to user who last updated
    updated_by_user = db.relationship('User', foreign_keys=[updated_by])

    def get_typed_value(self):
        """Return the value converted to its appropriate type."""
        if self.value is None:
            return None
        if self.value_type == 'boolean':
            return self.value.lower() in ('true', '1', 'yes')
        if self.value_type == 'integer':
            return int(self.value)
        if self.value_type == 'json':
            import json
            return json.loads(self.value)
        return self.value

    def set_typed_value(self, value):
        """Set the value, converting from its type to string storage."""
        if value is None:
            self.value = None
        elif self.value_type == 'boolean':
            self.value = 'true' if value else 'false'
        elif self.value_type == 'integer':
            self.value = str(int(value))
        elif self.value_type == 'json':
            import json
            self.value = json.dumps(value)
        else:
            self.value = str(value)

    def to_dict(self):
        return {
            'id': self.id,
            'key': self.key,
            'value': self.get_typed_value(),
            'value_type': self.value_type,
            'description': self.description,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'updated_by': self.updated_by
        }

    @staticmethod
    def get(key, default=None):
        """Get a setting value by key."""
        setting = SystemSettings.query.filter_by(key=key).first()
        if setting:
            return setting.get_typed_value()
        return default

    @staticmethod
    def set(key, value, value_type='string', description=None, user_id=None):
        """Set a setting value by key."""
        setting = SystemSettings.query.filter_by(key=key).first()
        if not setting:
            setting = SystemSettings(key=key, value_type=value_type, description=description)
            db.session.add(setting)
        setting.set_typed_value(value)
        if description is not None:
            setting.description = description
        if user_id is not None:
            setting.updated_by = user_id
        return setting

    def __repr__(self):
        return f'<SystemSettings {self.key}={self.value}>'
