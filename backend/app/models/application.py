from datetime import datetime
from app import db


class Application(db.Model):
    __tablename__ = 'applications'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    app_type = db.Column(db.String(50), nullable=False)  # 'php', 'wordpress', 'flask', 'django', 'docker', 'static'
    status = db.Column(db.String(20), default='stopped')  # 'running', 'stopped', 'error', 'deploying'

    # Configuration
    php_version = db.Column(db.String(10), nullable=True)  # '8.0', '8.1', '8.2', '8.3'
    python_version = db.Column(db.String(10), nullable=True)  # '3.9', '3.10', '3.11', '3.12'
    port = db.Column(db.Integer, nullable=True)
    root_path = db.Column(db.String(500), nullable=True)

    # Docker specific
    docker_image = db.Column(db.String(200), nullable=True)
    container_id = db.Column(db.String(100), nullable=True)

    # Private URL feature
    private_slug = db.Column(db.String(50), unique=True, nullable=True, index=True)
    private_url_enabled = db.Column(db.Boolean, default=False)

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_deployed_at = db.Column(db.DateTime, nullable=True)

    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    # Relationships
    domains = db.relationship('Domain', backref='application', lazy='dynamic', cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'app_type': self.app_type,
            'status': self.status,
            'php_version': self.php_version,
            'python_version': self.python_version,
            'port': self.port,
            'root_path': self.root_path,
            'docker_image': self.docker_image,
            'container_id': self.container_id,
            'private_slug': self.private_slug,
            'private_url_enabled': self.private_url_enabled,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_deployed_at': self.last_deployed_at.isoformat() if self.last_deployed_at else None,
            'user_id': self.user_id,
            'domains': [d.to_dict() for d in self.domains]
        }

    def __repr__(self):
        return f'<Application {self.name}>'
