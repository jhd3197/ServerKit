from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from app import db


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), default='user')  # 'admin' or 'user'
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Account lockout fields
    failed_login_count = db.Column(db.Integer, default=0)
    locked_until = db.Column(db.DateTime, nullable=True)

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

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'role': self.role,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

    def __repr__(self):
        return f'<User {self.username}>'
