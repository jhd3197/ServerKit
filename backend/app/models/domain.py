from datetime import datetime
from app import db


class Domain(db.Model):
    __tablename__ = 'domains'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False, index=True)
    is_primary = db.Column(db.Boolean, default=False)

    # SSL
    ssl_enabled = db.Column(db.Boolean, default=False)
    ssl_certificate_path = db.Column(db.String(500), nullable=True)
    ssl_key_path = db.Column(db.String(500), nullable=True)
    ssl_expires_at = db.Column(db.DateTime, nullable=True)
    ssl_auto_renew = db.Column(db.Boolean, default=True)

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Foreign keys
    application_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'is_primary': self.is_primary,
            'ssl_enabled': self.ssl_enabled,
            'ssl_expires_at': self.ssl_expires_at.isoformat() if self.ssl_expires_at else None,
            'ssl_auto_renew': self.ssl_auto_renew,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'application_id': self.application_id
        }

    def __repr__(self):
        return f'<Domain {self.name}>'
