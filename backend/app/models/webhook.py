from datetime import datetime
from app import db


class GitWebhook(db.Model):
    """Webhook configuration for syncing external repos with local Gitea."""
    __tablename__ = 'git_webhooks'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)

    # Source repository (GitHub, GitLab, Bitbucket)
    source = db.Column(db.String(50), nullable=False)  # 'github', 'gitlab', 'bitbucket'
    source_repo_url = db.Column(db.String(500), nullable=False)
    source_branch = db.Column(db.String(100), default='main')

    # Local Gitea repository (optional - for mirroring)
    local_repo_name = db.Column(db.String(200), nullable=True)

    # Webhook security
    secret = db.Column(db.String(100), nullable=False)
    webhook_token = db.Column(db.String(50), nullable=False, unique=True)

    # Sync configuration
    sync_direction = db.Column(db.String(20), default='pull')  # 'pull', 'push', 'bidirectional'
    auto_sync = db.Column(db.Boolean, default=True)

    # Deployment configuration
    app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=True)
    deploy_on_push = db.Column(db.Boolean, default=False)
    pre_deploy_script = db.Column(db.Text, nullable=True)
    post_deploy_script = db.Column(db.Text, nullable=True)
    zero_downtime = db.Column(db.Boolean, default=False)

    # Status tracking
    is_active = db.Column(db.Boolean, default=True)
    last_sync_at = db.Column(db.DateTime, nullable=True)
    last_sync_status = db.Column(db.String(20), nullable=True)  # 'success', 'failed', 'pending'
    last_sync_message = db.Column(db.Text, nullable=True)
    sync_count = db.Column(db.Integer, default=0)

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    app = db.relationship('Application', backref=db.backref('webhooks', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'source': self.source,
            'source_repo_url': self.source_repo_url,
            'source_branch': self.source_branch,
            'local_repo_name': self.local_repo_name,
            'webhook_token': self.webhook_token,
            'sync_direction': self.sync_direction,
            'auto_sync': self.auto_sync,
            'app_id': self.app_id,
            'app_name': self.app.name if self.app else None,
            'deploy_on_push': self.deploy_on_push,
            'pre_deploy_script': self.pre_deploy_script,
            'post_deploy_script': self.post_deploy_script,
            'zero_downtime': self.zero_downtime,
            'is_active': self.is_active,
            'last_sync_at': self.last_sync_at.isoformat() if self.last_sync_at else None,
            'last_sync_status': self.last_sync_status,
            'last_sync_message': self.last_sync_message,
            'sync_count': self.sync_count,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'webhook_url': f'/api/git/webhooks/receive/{self.webhook_token}'
        }

    def __repr__(self):
        return f'<GitWebhook {self.name} ({self.source})>'


class WebhookLog(db.Model):
    """Log of webhook events received."""
    __tablename__ = 'webhook_logs'

    id = db.Column(db.Integer, primary_key=True)
    webhook_id = db.Column(db.Integer, db.ForeignKey('git_webhooks.id'), nullable=True)

    # Event info
    source = db.Column(db.String(50), nullable=False)  # 'github', 'gitlab', 'bitbucket'
    event_type = db.Column(db.String(50), nullable=False)  # 'push', 'pull_request', 'ping', etc.
    delivery_id = db.Column(db.String(100), nullable=True)  # GitHub's X-GitHub-Delivery

    # Payload summary
    ref = db.Column(db.String(200), nullable=True)  # refs/heads/main
    commit_sha = db.Column(db.String(64), nullable=True)
    commit_message = db.Column(db.Text, nullable=True)
    pusher = db.Column(db.String(100), nullable=True)

    # Processing status
    status = db.Column(db.String(20), default='received')  # 'received', 'processed', 'ignored', 'failed'
    status_message = db.Column(db.Text, nullable=True)

    # Raw data (for debugging)
    headers_json = db.Column(db.Text, nullable=True)
    payload_preview = db.Column(db.Text, nullable=True)  # First 1000 chars of payload

    # Timestamps
    received_at = db.Column(db.DateTime, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)

    # Relationship
    webhook = db.relationship('GitWebhook', backref=db.backref('logs', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'webhook_id': self.webhook_id,
            'source': self.source,
            'event_type': self.event_type,
            'delivery_id': self.delivery_id,
            'ref': self.ref,
            'commit_sha': self.commit_sha,
            'commit_message': self.commit_message,
            'pusher': self.pusher,
            'status': self.status,
            'status_message': self.status_message,
            'received_at': self.received_at.isoformat(),
            'processed_at': self.processed_at.isoformat() if self.processed_at else None
        }

    def __repr__(self):
        return f'<WebhookLog {self.source}/{self.event_type} at {self.received_at}>'


class GitDeployment(db.Model):
    """Track deployment history for git-based deployments."""
    __tablename__ = 'git_deployments'

    id = db.Column(db.Integer, primary_key=True)

    # Links
    app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=False)
    webhook_id = db.Column(db.Integer, db.ForeignKey('git_webhooks.id'), nullable=True)

    # Deployment info
    version = db.Column(db.Integer, nullable=False)  # Auto-increment per app
    commit_sha = db.Column(db.String(64), nullable=True)
    commit_message = db.Column(db.Text, nullable=True)
    branch = db.Column(db.String(100), nullable=True)
    triggered_by = db.Column(db.String(100), nullable=True)  # 'webhook', 'manual', 'rollback'

    # Status
    status = db.Column(db.String(20), default='pending')  # 'pending', 'running', 'success', 'failed', 'rolled_back'
    started_at = db.Column(db.DateTime, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)

    # Logs
    pre_script_output = db.Column(db.Text, nullable=True)
    deploy_output = db.Column(db.Text, nullable=True)
    post_script_output = db.Column(db.Text, nullable=True)
    error_message = db.Column(db.Text, nullable=True)

    # Rollback info
    is_rollback = db.Column(db.Boolean, default=False)
    rollback_from_version = db.Column(db.Integer, nullable=True)
    rolled_back_at = db.Column(db.DateTime, nullable=True)
    rolled_back_to_id = db.Column(db.Integer, nullable=True)

    # Snapshot for rollback (stores docker-compose.yml content, env vars, etc.)
    snapshot_data = db.Column(db.Text, nullable=True)  # JSON string

    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    app = db.relationship('Application', backref=db.backref('git_deployments', lazy='dynamic'))
    webhook = db.relationship('GitWebhook', backref=db.backref('deployments', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'app_id': self.app_id,
            'app_name': self.app.name if self.app else None,
            'webhook_id': self.webhook_id,
            'version': self.version,
            'commit_sha': self.commit_sha,
            'short_sha': self.commit_sha[:7] if self.commit_sha else None,
            'commit_message': self.commit_message,
            'branch': self.branch,
            'triggered_by': self.triggered_by,
            'status': self.status,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'duration_seconds': self.duration_seconds,
            'error_message': self.error_message,
            'is_rollback': self.is_rollback,
            'rollback_from_version': self.rollback_from_version,
            'rolled_back_at': self.rolled_back_at.isoformat() if self.rolled_back_at else None,
            'created_at': self.created_at.isoformat()
        }

    def to_dict_full(self):
        """Include logs in output."""
        data = self.to_dict()
        data.update({
            'pre_script_output': self.pre_script_output,
            'deploy_output': self.deploy_output,
            'post_script_output': self.post_script_output
        })
        return data

    def __repr__(self):
        return f'<GitDeployment {self.app.name if self.app else "?"} v{self.version} ({self.status})>'
