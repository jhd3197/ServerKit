from datetime import datetime
from app import db
import json


class AuditLog(db.Model):
    """Audit log for tracking user actions."""
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(100), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    target_type = db.Column(db.String(50), nullable=True)  # user, app, setting, etc.
    target_id = db.Column(db.Integer, nullable=True)
    details = db.Column(db.Text, nullable=True)  # JSON string
    ip_address = db.Column(db.String(45), nullable=True)  # IPv6 compatible
    user_agent = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # Relationship to user
    user = db.relationship('User', foreign_keys=[user_id])

    # Common action types
    ACTION_LOGIN = 'user.login'
    ACTION_LOGIN_FAILED = 'user.login_failed'
    ACTION_LOGOUT = 'user.logout'
    ACTION_USER_CREATE = 'user.create'
    ACTION_USER_UPDATE = 'user.update'
    ACTION_USER_DELETE = 'user.delete'
    ACTION_USER_DISABLE = 'user.disable'
    ACTION_USER_ENABLE = 'user.enable'
    ACTION_SETTINGS_UPDATE = 'settings.update'
    ACTION_APP_CREATE = 'app.create'
    ACTION_APP_UPDATE = 'app.update'
    ACTION_APP_DELETE = 'app.delete'
    ACTION_APP_START = 'app.start'
    ACTION_APP_STOP = 'app.stop'
    ACTION_APP_RESTART = 'app.restart'
    ACTION_DEPLOY = 'app.deploy'
    ACTION_BACKUP_CREATE = 'backup.create'
    ACTION_BACKUP_RESTORE = 'backup.restore'

    def get_details(self):
        """Return parsed details JSON."""
        if self.details:
            try:
                return json.loads(self.details)
            except (json.JSONDecodeError, TypeError):
                return {}
        return {}

    def set_details(self, details_dict):
        """Set details from a dictionary."""
        if details_dict:
            self.details = json.dumps(details_dict)
        else:
            self.details = None

    def to_dict(self):
        return {
            'id': self.id,
            'action': self.action,
            'user_id': self.user_id,
            'username': self.user.username if self.user else None,
            'target_type': self.target_type,
            'target_id': self.target_id,
            'details': self.get_details(),
            'ip_address': self.ip_address,
            'user_agent': self.user_agent,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

    @staticmethod
    def log(action, user_id=None, target_type=None, target_id=None,
            details=None, ip_address=None, user_agent=None):
        """Create an audit log entry."""
        log_entry = AuditLog(
            action=action,
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        log_entry.set_details(details)
        db.session.add(log_entry)
        return log_entry

    def __repr__(self):
        return f'<AuditLog {self.action} by user {self.user_id}>'
