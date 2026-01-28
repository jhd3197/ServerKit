"""
WordPress Site Models

Extended models for WordPress-specific functionality including:
- WordPress site metadata
- Database snapshots for point-in-time recovery
- Sync jobs for scheduled database synchronization
"""

from datetime import datetime
from app import db
import json


class WordPressSite(db.Model):
    """Extended WordPress-specific data linked to Application."""

    __tablename__ = 'wordpress_sites'

    id = db.Column(db.Integer, primary_key=True)
    application_id = db.Column(db.Integer, db.ForeignKey('applications.id'), unique=True, nullable=False)

    # WordPress specifics
    wp_version = db.Column(db.String(20))
    multisite = db.Column(db.Boolean, default=False)
    admin_user = db.Column(db.String(100))
    admin_email = db.Column(db.String(200))

    # Database info
    db_name = db.Column(db.String(100))
    db_user = db.Column(db.String(100))
    db_host = db.Column(db.String(200), default='localhost')
    db_prefix = db.Column(db.String(20), default='wp_')

    # Git integration
    git_repo_url = db.Column(db.String(500))
    git_branch = db.Column(db.String(100), default='main')
    git_paths = db.Column(db.Text)  # JSON: paths to sync ['wp-content/themes', 'wp-content/plugins']
    auto_deploy = db.Column(db.Boolean, default=False)
    last_deploy_commit = db.Column(db.String(40))
    last_deploy_at = db.Column(db.DateTime)

    # Environment info
    is_production = db.Column(db.Boolean, default=True)
    production_site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=True)

    # Sync settings (JSON)
    sync_config = db.Column(db.Text)  # schedule, search_replace, anonymize, etc.

    # Environment management
    environment_type = db.Column(db.String(20), default='standalone')  # standalone, production, staging, development, multidev
    multidev_branch = db.Column(db.String(200))
    is_locked = db.Column(db.Boolean, default=False)
    locked_by = db.Column(db.String(100))
    locked_reason = db.Column(db.String(200))
    lock_expires_at = db.Column(db.DateTime)

    # Docker compose tracking
    compose_project_name = db.Column(db.String(100))
    container_prefix = db.Column(db.String(100))

    # Resource limits (stored as JSON for flexibility)
    resource_limits = db.Column(db.Text)  # JSON: {memory, cpus, db_memory, db_cpus}

    # Basic Auth
    basic_auth_enabled = db.Column(db.Boolean, default=False)
    basic_auth_user = db.Column(db.String(100))
    basic_auth_password_hash = db.Column(db.String(200))

    # Health tracking
    health_status = db.Column(db.String(20), default='unknown')  # healthy, degraded, unhealthy, unknown
    last_health_check = db.Column(db.DateTime)

    # Disk usage tracking
    disk_usage_bytes = db.Column(db.BigInteger, default=0)
    disk_usage_updated_at = db.Column(db.DateTime)

    # Auto-sync
    auto_sync_schedule = db.Column(db.String(100))  # cron expression
    auto_sync_enabled = db.Column(db.Boolean, default=False)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    application = db.relationship('Application', backref=db.backref('wp_site', uselist=False))
    environments = db.relationship(
        'WordPressSite',
        backref=db.backref('production_site', remote_side=[id]),
        foreign_keys=[production_site_id]
    )
    snapshots = db.relationship('DatabaseSnapshot', backref='site', lazy='dynamic', cascade='all, delete-orphan')
    sync_jobs_as_source = db.relationship(
        'SyncJob',
        foreign_keys='SyncJob.source_site_id',
        backref='source_site',
        lazy='dynamic'
    )
    sync_jobs_as_target = db.relationship(
        'SyncJob',
        foreign_keys='SyncJob.target_site_id',
        backref='target_site',
        lazy='dynamic'
    )

    def to_dict(self, include_environments=False, include_snapshots=False):
        result = {
            'id': self.id,
            'application_id': self.application_id,
            'wp_version': self.wp_version,
            'multisite': self.multisite,
            'admin_user': self.admin_user,
            'admin_email': self.admin_email,
            'db_name': self.db_name,
            'db_user': self.db_user,
            'db_host': self.db_host,
            'db_prefix': self.db_prefix,
            'git_repo_url': self.git_repo_url,
            'git_branch': self.git_branch,
            'git_paths': json.loads(self.git_paths) if self.git_paths else None,
            'auto_deploy': self.auto_deploy,
            'last_deploy_commit': self.last_deploy_commit,
            'last_deploy_at': self.last_deploy_at.isoformat() if self.last_deploy_at else None,
            'is_production': self.is_production,
            'production_site_id': self.production_site_id,
            'sync_config': json.loads(self.sync_config) if self.sync_config else None,
            'environment_type': self.environment_type,
            'multidev_branch': self.multidev_branch,
            'is_locked': self.is_locked,
            'locked_by': self.locked_by,
            'locked_reason': self.locked_reason,
            'lock_expires_at': self.lock_expires_at.isoformat() if self.lock_expires_at else None,
            'compose_project_name': self.compose_project_name,
            'container_prefix': self.container_prefix,
            'resource_limits': json.loads(self.resource_limits) if self.resource_limits else None,
            'basic_auth_enabled': self.basic_auth_enabled,
            'basic_auth_user': self.basic_auth_user,
            'health_status': self.health_status,
            'last_health_check': self.last_health_check.isoformat() if self.last_health_check else None,
            'disk_usage_bytes': self.disk_usage_bytes,
            'disk_usage_human': DatabaseSnapshot._format_size(self.disk_usage_bytes) if self.disk_usage_bytes else None,
            'disk_usage_updated_at': self.disk_usage_updated_at.isoformat() if self.disk_usage_updated_at else None,
            'auto_sync_schedule': self.auto_sync_schedule,
            'auto_sync_enabled': self.auto_sync_enabled,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

        # Include application data
        if self.application:
            result['application'] = {
                'id': self.application.id,
                'name': self.application.name,
                'status': self.application.status,
                'root_path': self.application.root_path,
                'port': self.application.port,
                'domains': [d.to_dict() for d in self.application.domains]
            }

        if include_environments and self.is_production:
            result['environments'] = [env.to_dict() for env in self.environments]

        if include_snapshots:
            result['snapshots'] = [snap.to_dict() for snap in self.snapshots.order_by(DatabaseSnapshot.created_at.desc()).limit(10)]

        return result

    def __repr__(self):
        return f'<WordPressSite {self.id} app={self.application_id}>'


class DatabaseSnapshot(db.Model):
    """Point-in-time database snapshots for WordPress sites."""

    __tablename__ = 'database_snapshots'

    id = db.Column(db.Integer, primary_key=True)
    site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)

    # Snapshot info
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    tag = db.Column(db.String(100))  # e.g., 'pre-deploy', 'v1.2.0', 'auto-nightly'

    # File info
    file_path = db.Column(db.String(500), nullable=False)
    size_bytes = db.Column(db.BigInteger, default=0)
    compressed = db.Column(db.Boolean, default=True)

    # Git context (optional)
    commit_sha = db.Column(db.String(40))  # Git commit at snapshot time
    commit_message = db.Column(db.Text)

    # Metadata
    tables_included = db.Column(db.Text)  # JSON list of tables
    row_count = db.Column(db.Integer)

    # Status
    status = db.Column(db.String(20), default='completed')  # creating, completed, failed, deleted
    error_message = db.Column(db.Text)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime)  # Auto-cleanup date

    def to_dict(self):
        return {
            'id': self.id,
            'site_id': self.site_id,
            'name': self.name,
            'description': self.description,
            'tag': self.tag,
            'file_path': self.file_path,
            'size_bytes': self.size_bytes,
            'size_human': self._format_size(self.size_bytes),
            'compressed': self.compressed,
            'commit_sha': self.commit_sha,
            'commit_message': self.commit_message,
            'tables_included': json.loads(self.tables_included) if self.tables_included else None,
            'row_count': self.row_count,
            'status': self.status,
            'error_message': self.error_message,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
        }

    @staticmethod
    def _format_size(size_bytes):
        if not size_bytes:
            return '0 B'
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024:
                return f'{size_bytes:.1f} {unit}'
            size_bytes /= 1024
        return f'{size_bytes:.1f} TB'

    def __repr__(self):
        return f'<DatabaseSnapshot {self.id} "{self.name}">'


class SyncJob(db.Model):
    """Scheduled database synchronization jobs between WordPress environments."""

    __tablename__ = 'sync_jobs'

    id = db.Column(db.Integer, primary_key=True)

    # Source and target sites
    source_site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)
    target_site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)

    # Job name
    name = db.Column(db.String(200))

    # Schedule (cron expression)
    schedule = db.Column(db.String(100))  # e.g., "0 3 * * 0" = Sunday 3 AM
    enabled = db.Column(db.Boolean, default=True)

    # Configuration (JSON)
    config = db.Column(db.Text)  # search_replace, anonymize, exclude_tables, truncate_tables

    # Execution tracking
    last_run = db.Column(db.DateTime)
    last_run_status = db.Column(db.String(20))  # success, failed, running
    last_run_duration = db.Column(db.Integer)  # seconds
    last_run_error = db.Column(db.Text)
    next_run = db.Column(db.DateTime)
    run_count = db.Column(db.Integer, default=0)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'source_site_id': self.source_site_id,
            'target_site_id': self.target_site_id,
            'schedule': self.schedule,
            'enabled': self.enabled,
            'config': json.loads(self.config) if self.config else None,
            'last_run': self.last_run.isoformat() if self.last_run else None,
            'last_run_status': self.last_run_status,
            'last_run_duration': self.last_run_duration,
            'last_run_error': self.last_run_error,
            'next_run': self.next_run.isoformat() if self.next_run else None,
            'run_count': self.run_count,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'source_site': self.source_site.to_dict() if self.source_site else None,
            'target_site': self.target_site.to_dict() if self.target_site else None,
        }

    def __repr__(self):
        return f'<SyncJob {self.id} {self.source_site_id}->{self.target_site_id}>'
