from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from app import db
import json


class User(db.Model):
    __tablename__ = 'users'

    # Role constants
    ROLE_ADMIN = 'admin'
    ROLE_DEVELOPER = 'developer'
    ROLE_VIEWER = 'viewer'
    VALID_ROLES = [ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER]

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='developer')  # 'admin', 'developer', 'viewer'
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_login_at = db.Column(db.DateTime, nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Account lockout fields
    failed_login_count = db.Column(db.Integer, default=0)
    locked_until = db.Column(db.DateTime, nullable=True)

    # Two-Factor Authentication fields
    totp_secret = db.Column(db.String(32), nullable=True)  # Base32 encoded secret
    totp_enabled = db.Column(db.Boolean, default=False)
    backup_codes = db.Column(db.Text, nullable=True)  # JSON array of hashed backup codes
    totp_confirmed_at = db.Column(db.DateTime, nullable=True)  # When 2FA was enabled

    # Relationships
    applications = db.relationship('Application', backref='owner', lazy='dynamic')

    # Lockout durations (progressive: 5 min, 15 min, 1 hour)
    LOCKOUT_DURATIONS = [5, 15, 60]
    MAX_FAILED_ATTEMPTS = 5

    @property
    def is_locked(self):
        """Check if account is currently locked."""
        if self.locked_until is None:
            return False
        return datetime.utcnow() < self.locked_until

    def record_failed_login(self):
        """Record a failed login attempt and lock account if threshold reached."""
        self.failed_login_count += 1
        if self.failed_login_count >= self.MAX_FAILED_ATTEMPTS:
            # Calculate lockout duration based on how many times they've been locked
            lockout_index = min(
                (self.failed_login_count - self.MAX_FAILED_ATTEMPTS) // self.MAX_FAILED_ATTEMPTS,
                len(self.LOCKOUT_DURATIONS) - 1
            )
            lockout_minutes = self.LOCKOUT_DURATIONS[lockout_index]
            self.locked_until = datetime.utcnow() + timedelta(minutes=lockout_minutes)

    def reset_failed_login(self):
        """Reset failed login count after successful login."""
        self.failed_login_count = 0
        self.locked_until = None

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_admin(self):
        """Check if user has admin role."""
        return self.role == self.ROLE_ADMIN

    @property
    def is_developer(self):
        """Check if user has developer role or higher."""
        return self.role in [self.ROLE_ADMIN, self.ROLE_DEVELOPER]

    @property
    def is_viewer(self):
        """Check if user has viewer role or higher (all roles)."""
        return self.role in self.VALID_ROLES

    def has_role(self, *roles):
        """Check if user has any of the specified roles."""
        return self.role in roles

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'role': self.role,
            'is_active': self.is_active,
            'totp_enabled': self.totp_enabled,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_login_at': self.last_login_at.isoformat() if self.last_login_at else None,
            'created_by': self.created_by
        }

    def get_backup_codes(self):
        """Get the list of backup code hashes."""
        if not self.backup_codes:
            return []
        try:
            return json.loads(self.backup_codes)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_backup_codes(self, codes_hashes):
        """Store backup code hashes."""
        self.backup_codes = json.dumps(codes_hashes)

    def use_backup_code(self, code_hash):
        """Remove a used backup code."""
        codes = self.get_backup_codes()
        if code_hash in codes:
            codes.remove(code_hash)
            self.set_backup_codes(codes)
            return True
        return False

    def __repr__(self):
        return f'<User {self.username}>'
