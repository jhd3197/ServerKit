"""
Deployment Model - Tracks versioned deployments for applications.

Supports:
- Deployment history with versions
- Rollback to previous versions
- Deployment status tracking
- Build artifacts (image tags, commit hashes)
"""

from datetime import datetime
from app import db
import json


class Deployment(db.Model):
    """Represents a single deployment of an application."""
    __tablename__ = 'deployments'

    id = db.Column(db.Integer, primary_key=True)
    app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=False)

    # Version info
    version = db.Column(db.Integer, nullable=False)  # Sequential version number per app
    version_tag = db.Column(db.String(100), nullable=True)  # Optional semantic version

    # Status: pending, building, deploying, live, failed, rolled_back
    status = db.Column(db.String(20), default='pending')

    # Build info
    build_method = db.Column(db.String(20), nullable=True)  # dockerfile, nixpacks, custom
    image_tag = db.Column(db.String(255), nullable=True)  # Docker image tag
    commit_hash = db.Column(db.String(40), nullable=True)  # Git commit if applicable
    commit_message = db.Column(db.Text, nullable=True)

    # Container info (for running deployment)
    container_id = db.Column(db.String(100), nullable=True)

    # Deployment details
    deployed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    deploy_trigger = db.Column(db.String(20), default='manual')  # manual, webhook, rollback

    # Build/deploy output
    build_log_path = db.Column(db.String(500), nullable=True)

    # Timing
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    build_started_at = db.Column(db.DateTime, nullable=True)
    build_completed_at = db.Column(db.DateTime, nullable=True)
    deploy_started_at = db.Column(db.DateTime, nullable=True)
    deploy_completed_at = db.Column(db.DateTime, nullable=True)

    # Error info
    error_message = db.Column(db.Text, nullable=True)

    # Metadata (JSON for flexibility)
    # Note: 'metadata' is reserved by SQLAlchemy, so we use 'extra_data'
    extra_data = db.Column(db.Text, default='{}')

    # Relationships
    app = db.relationship('Application', backref=db.backref('deployments', lazy='dynamic'))
    deployer = db.relationship('User', backref=db.backref('user_deployments', lazy='dynamic'))

    def get_metadata(self):
        """Get metadata as dict."""
        try:
            return json.loads(self.extra_data) if self.extra_data else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_metadata(self, data):
        """Set metadata from dict."""
        self.extra_data = json.dumps(data)

    def update_metadata(self, key, value):
        """Update a single metadata field."""
        meta = self.get_metadata()
        meta[key] = value
        self.extra_data = json.dumps(meta)

    @property
    def duration(self):
        """Calculate total deployment duration in seconds."""
        if self.deploy_completed_at and self.build_started_at:
            return (self.deploy_completed_at - self.build_started_at).total_seconds()
        return None

    @property
    def build_duration(self):
        """Calculate build duration in seconds."""
        if self.build_completed_at and self.build_started_at:
            return (self.build_completed_at - self.build_started_at).total_seconds()
        return None

    def to_dict(self, include_logs=False):
        """Convert to dictionary for API response."""
        result = {
            'id': self.id,
            'app_id': self.app_id,
            'version': self.version,
            'version_tag': self.version_tag,
            'status': self.status,
            'build_method': self.build_method,
            'image_tag': self.image_tag,
            'commit_hash': self.commit_hash,
            'commit_message': self.commit_message,
            'container_id': self.container_id,
            'deployed_by': self.deployed_by,
            'deploy_trigger': self.deploy_trigger,
            'error_message': self.error_message,
            'metadata': self.get_metadata(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'build_started_at': self.build_started_at.isoformat() if self.build_started_at else None,
            'build_completed_at': self.build_completed_at.isoformat() if self.build_completed_at else None,
            'deploy_started_at': self.deploy_started_at.isoformat() if self.deploy_started_at else None,
            'deploy_completed_at': self.deploy_completed_at.isoformat() if self.deploy_completed_at else None,
            'duration': self.duration,
            'build_duration': self.build_duration
        }

        if include_logs and self.build_log_path:
            try:
                import os
                if os.path.exists(self.build_log_path):
                    with open(self.build_log_path, 'r') as f:
                        log_data = json.load(f)
                        result['build_logs'] = log_data.get('logs', [])
            except Exception:
                pass

        return result

    @classmethod
    def get_next_version(cls, app_id):
        """Get next version number for an app."""
        latest = cls.query.filter_by(app_id=app_id).order_by(cls.version.desc()).first()
        return (latest.version + 1) if latest else 1

    @classmethod
    def get_current(cls, app_id):
        """Get currently live deployment for an app."""
        return cls.query.filter_by(app_id=app_id, status='live').order_by(cls.version.desc()).first()

    @classmethod
    def get_previous(cls, app_id, before_version):
        """Get previous successful deployment before a version."""
        return cls.query.filter(
            cls.app_id == app_id,
            cls.version < before_version,
            cls.status == 'live'
        ).order_by(cls.version.desc()).first()

    @classmethod
    def cleanup_old_deployments(cls, app_id, keep_count=5):
        """Delete old deployments, keeping the last N."""
        # Get all deployments except the latest N
        deployments = cls.query.filter_by(app_id=app_id).order_by(
            cls.version.desc()
        ).offset(keep_count).all()

        deleted = 0
        for deployment in deployments:
            # Don't delete currently live deployments
            if deployment.status != 'live':
                db.session.delete(deployment)
                deleted += 1

        if deleted > 0:
            db.session.commit()

        return deleted

    def __repr__(self):
        return f'<Deployment app={self.app_id} v{self.version} status={self.status}>'


class DeploymentDiff(db.Model):
    """Stores diff information between deployments."""
    __tablename__ = 'deployment_diffs'

    id = db.Column(db.Integer, primary_key=True)
    deployment_id = db.Column(db.Integer, db.ForeignKey('deployments.id'), nullable=False)
    previous_deployment_id = db.Column(db.Integer, db.ForeignKey('deployments.id'), nullable=True)

    # Diff content (JSON)
    files_added = db.Column(db.Text, default='[]')
    files_removed = db.Column(db.Text, default='[]')
    files_modified = db.Column(db.Text, default='[]')

    # Summary
    additions = db.Column(db.Integer, default=0)
    deletions = db.Column(db.Integer, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    deployment = db.relationship('Deployment', foreign_keys=[deployment_id], backref='diff')

    def to_dict(self):
        return {
            'id': self.id,
            'deployment_id': self.deployment_id,
            'previous_deployment_id': self.previous_deployment_id,
            'files_added': json.loads(self.files_added) if self.files_added else [],
            'files_removed': json.loads(self.files_removed) if self.files_removed else [],
            'files_modified': json.loads(self.files_modified) if self.files_modified else [],
            'additions': self.additions,
            'deletions': self.deletions,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
