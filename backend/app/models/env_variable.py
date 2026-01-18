from datetime import datetime
from app import db
from cryptography.fernet import Fernet
import os
import base64
import hashlib


class EnvironmentVariable(db.Model):
    """
    Stores environment variables for applications with encrypted values.
    Supports versioning for history tracking.
    """
    __tablename__ = 'environment_variables'

    id = db.Column(db.Integer, primary_key=True)
    application_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=False)
    key = db.Column(db.String(255), nullable=False)
    encrypted_value = db.Column(db.Text, nullable=False)
    is_secret = db.Column(db.Boolean, default=False)  # Mark sensitive values
    description = db.Column(db.String(500), nullable=True)  # Optional description

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Unique constraint: one key per application
    __table_args__ = (
        db.UniqueConstraint('application_id', 'key', name='unique_app_env_key'),
    )

    # Class-level encryption key (generated from SECRET_KEY)
    _fernet = None

    @classmethod
    def _get_fernet(cls):
        """Get or create the Fernet encryption instance."""
        if cls._fernet is None:
            # Derive a 32-byte key from SECRET_KEY using SHA256
            secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
            key = hashlib.sha256(secret_key.encode()).digest()
            fernet_key = base64.urlsafe_b64encode(key)
            cls._fernet = Fernet(fernet_key)
        return cls._fernet

    @classmethod
    def encrypt_value(cls, value):
        """Encrypt a value for storage."""
        if value is None:
            value = ''
        fernet = cls._get_fernet()
        return fernet.encrypt(value.encode()).decode()

    @classmethod
    def decrypt_value(cls, encrypted_value):
        """Decrypt a stored value."""
        if not encrypted_value:
            return ''
        fernet = cls._get_fernet()
        try:
            return fernet.decrypt(encrypted_value.encode()).decode()
        except Exception:
            return '[DECRYPTION_ERROR]'

    @property
    def value(self):
        """Get the decrypted value."""
        return self.decrypt_value(self.encrypted_value)

    @value.setter
    def value(self, plaintext):
        """Set the value (encrypts automatically)."""
        self.encrypted_value = self.encrypt_value(plaintext)

    def to_dict(self, include_value=True, mask_secrets=False):
        """Convert to dictionary, optionally masking secret values."""
        result = {
            'id': self.id,
            'application_id': self.application_id,
            'key': self.key,
            'is_secret': self.is_secret,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

        if include_value:
            if mask_secrets and self.is_secret:
                result['value'] = '••••••••'
            else:
                result['value'] = self.value

        return result

    def __repr__(self):
        return f'<EnvironmentVariable {self.key}>'


class EnvironmentVariableHistory(db.Model):
    """
    Tracks history of environment variable changes for auditing.
    """
    __tablename__ = 'environment_variable_history'

    id = db.Column(db.Integer, primary_key=True)
    env_variable_id = db.Column(db.Integer, nullable=False)  # Not FK to allow deleted vars
    application_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=False)
    key = db.Column(db.String(255), nullable=False)
    action = db.Column(db.String(20), nullable=False)  # 'created', 'updated', 'deleted'
    old_value_hash = db.Column(db.String(64), nullable=True)  # SHA256 hash (not the actual value)
    new_value_hash = db.Column(db.String(64), nullable=True)
    changed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    changed_at = db.Column(db.DateTime, default=datetime.utcnow)

    @classmethod
    def hash_value(cls, value):
        """Create a hash of the value for comparison (not for storage of actual value)."""
        if value is None:
            return None
        return hashlib.sha256(value.encode()).hexdigest()

    @classmethod
    def record_change(cls, env_var, action, old_value=None, new_value=None, user_id=None):
        """Record a change to an environment variable."""
        history = cls(
            env_variable_id=env_var.id if env_var.id else 0,
            application_id=env_var.application_id,
            key=env_var.key,
            action=action,
            old_value_hash=cls.hash_value(old_value) if old_value else None,
            new_value_hash=cls.hash_value(new_value) if new_value else None,
            changed_by=user_id
        )
        db.session.add(history)
        return history

    def to_dict(self):
        return {
            'id': self.id,
            'env_variable_id': self.env_variable_id,
            'application_id': self.application_id,
            'key': self.key,
            'action': self.action,
            'changed_by': self.changed_by,
            'changed_at': self.changed_at.isoformat() if self.changed_at else None,
        }
