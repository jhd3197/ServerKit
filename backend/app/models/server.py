import uuid
import secrets
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from app import db


class ServerGroup(db.Model):
    """Group servers for organization"""
    __tablename__ = 'server_groups'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    color = db.Column(db.String(7), default='#6366f1')  # Hex color for UI
    icon = db.Column(db.String(50), default='server')  # Icon name
    parent_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    servers = db.relationship('Server', back_populates='group', lazy='dynamic')
    children = db.relationship('ServerGroup', backref=db.backref('parent', remote_side=[id]))

    def to_dict(self, include_servers=False):
        result = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'color': self.color,
            'icon': self.icon,
            'parent_id': self.parent_id,
            'server_count': self.servers.count(),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_servers:
            result['servers'] = [s.to_dict() for s in self.servers]
        return result

    def __repr__(self):
        return f'<ServerGroup {self.name}>'


class Server(db.Model):
    """Represents a remote server managed by ServerKit"""
    __tablename__ = 'servers'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Basic Info
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    hostname = db.Column(db.String(255))  # Reported by agent
    ip_address = db.Column(db.String(45))  # IPv4 or IPv6

    # Organization
    group_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'), nullable=True)
    tags = db.Column(db.JSON, default=list)  # ["production", "us-east", "docker"]

    # Status
    status = db.Column(db.String(20), default='pending')
    # pending, connecting, online, offline, error, maintenance
    last_seen = db.Column(db.DateTime)
    last_error = db.Column(db.Text)

    # Agent Info
    agent_version = db.Column(db.String(20))
    agent_id = db.Column(db.String(36), unique=True, index=True)  # Agent's UUID

    # System Info (reported by agent)
    os_type = db.Column(db.String(20))  # linux, windows, darwin
    os_version = db.Column(db.String(100))
    platform = db.Column(db.String(100))
    architecture = db.Column(db.String(20))  # amd64, arm64
    cpu_cores = db.Column(db.Integer)
    cpu_model = db.Column(db.String(200))
    total_memory = db.Column(db.BigInteger)  # bytes
    total_disk = db.Column(db.BigInteger)  # bytes
    docker_version = db.Column(db.String(50))

    # Security
    api_key_hash = db.Column(db.String(256))  # bcrypt hash
    api_key_prefix = db.Column(db.String(12))  # For identification: "sk_abc123"
    api_secret_encrypted = db.Column(db.Text)  # Fernet-encrypted api_secret for signature verification
    permissions = db.Column(db.JSON, default=list)  # List of permission scopes
    allowed_ips = db.Column(db.JSON, default=list)  # IP whitelist (empty = all)

    # API Key Rotation
    api_key_pending_hash = db.Column(db.String(256))  # Hash of pending new API key
    api_key_pending_prefix = db.Column(db.String(12))  # Prefix of pending new API key
    api_secret_pending_encrypted = db.Column(db.Text)  # Encrypted pending new API secret
    api_key_rotation_expires = db.Column(db.DateTime)  # When pending key rotation expires
    api_key_rotation_id = db.Column(db.String(36))  # Unique ID for current rotation
    api_key_last_rotated = db.Column(db.DateTime)  # Last successful rotation timestamp

    # Registration
    registration_token_hash = db.Column(db.String(256))
    registration_token_expires = db.Column(db.DateTime)
    registered_at = db.Column(db.DateTime)
    registered_by = db.Column(db.Integer, db.ForeignKey('users.id'))

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    group = db.relationship('ServerGroup', back_populates='servers')
    metrics = db.relationship('ServerMetrics', back_populates='server', lazy='dynamic', cascade='all, delete-orphan')
    commands = db.relationship('ServerCommand', back_populates='server', lazy='dynamic', cascade='all, delete-orphan')
    sessions = db.relationship('AgentSession', back_populates='server', lazy='dynamic', cascade='all, delete-orphan')

    @staticmethod
    def generate_registration_token():
        """Generate a secure registration token"""
        return f"sk_reg_{secrets.token_urlsafe(32)}"

    @staticmethod
    def generate_api_credentials():
        """Generate API key and secret"""
        api_key = f"sk_{secrets.token_urlsafe(16)}"
        api_secret = secrets.token_urlsafe(32)
        return api_key, api_secret

    def set_registration_token(self, token):
        """Hash and store registration token"""
        self.registration_token_hash = generate_password_hash(token)

    def verify_registration_token(self, token):
        """Verify a registration token"""
        if not self.registration_token_hash:
            return False
        if self.registration_token_expires and datetime.utcnow() > self.registration_token_expires:
            return False
        return check_password_hash(self.registration_token_hash, token)

    def set_api_key(self, api_key):
        """Hash and store API key"""
        self.api_key_hash = generate_password_hash(api_key)
        self.api_key_prefix = api_key[:12] if len(api_key) >= 12 else api_key

    def verify_api_key(self, api_key):
        """Verify an API key"""
        if not self.api_key_hash:
            return False
        return check_password_hash(self.api_key_hash, api_key)

    def set_api_secret_encrypted(self, api_secret):
        """Encrypt and store the API secret for signature verification"""
        try:
            from app.utils.crypto import encrypt_secret
            self.api_secret_encrypted = encrypt_secret(api_secret)
        except Exception as e:
            print(f"Error encrypting API secret: {e}")
            # Don't fail - system can work without signature verification

    def get_api_secret(self):
        """Decrypt and return the API secret"""
        if not self.api_secret_encrypted:
            return None
        try:
            from app.utils.crypto import decrypt_secret
            return decrypt_secret(self.api_secret_encrypted)
        except Exception as e:
            print(f"Error decrypting API secret: {e}")
            return None

    def start_key_rotation(self):
        """
        Start API key rotation process.

        Returns tuple: (new_api_key, new_api_secret, rotation_id)
        """
        from datetime import timedelta

        new_api_key, new_api_secret = self.generate_api_credentials()
        rotation_id = str(uuid.uuid4())

        # Store pending credentials
        self.api_key_pending_hash = generate_password_hash(new_api_key)
        self.api_key_pending_prefix = new_api_key[:12] if len(new_api_key) >= 12 else new_api_key

        try:
            from app.utils.crypto import encrypt_secret
            self.api_secret_pending_encrypted = encrypt_secret(new_api_secret)
        except Exception as e:
            print(f"Error encrypting pending API secret: {e}")

        self.api_key_rotation_id = rotation_id
        self.api_key_rotation_expires = datetime.utcnow() + timedelta(minutes=5)

        return new_api_key, new_api_secret, rotation_id

    def complete_key_rotation(self, rotation_id):
        """
        Complete API key rotation by activating pending credentials.

        Returns: True if successful, False otherwise
        """
        if self.api_key_rotation_id != rotation_id:
            return False

        if self.api_key_rotation_expires and datetime.utcnow() > self.api_key_rotation_expires:
            self.cancel_key_rotation()
            return False

        # Move pending to active
        self.api_key_hash = self.api_key_pending_hash
        self.api_key_prefix = self.api_key_pending_prefix
        self.api_secret_encrypted = self.api_secret_pending_encrypted

        # Clear pending and record rotation
        self.api_key_pending_hash = None
        self.api_key_pending_prefix = None
        self.api_secret_pending_encrypted = None
        self.api_key_rotation_id = None
        self.api_key_rotation_expires = None
        self.api_key_last_rotated = datetime.utcnow()

        return True

    def cancel_key_rotation(self):
        """Cancel a pending key rotation"""
        self.api_key_pending_hash = None
        self.api_key_pending_prefix = None
        self.api_secret_pending_encrypted = None
        self.api_key_rotation_id = None
        self.api_key_rotation_expires = None

    def verify_pending_api_key(self, api_key):
        """Verify against pending API key during rotation"""
        if not self.api_key_pending_hash:
            return False
        if self.api_key_rotation_expires and datetime.utcnow() > self.api_key_rotation_expires:
            return False
        return check_password_hash(self.api_key_pending_hash, api_key)

    def has_permission(self, scope):
        """Check if server/agent has a specific permission scope"""
        if not self.permissions:
            return False
        if '*' in self.permissions:
            return True
        # Check exact match or wildcard
        scope_parts = scope.split(':')
        for perm in self.permissions:
            if perm == scope:
                return True
            # Check wildcard patterns like 'docker:*'
            perm_parts = perm.split(':')
            if len(perm_parts) <= len(scope_parts):
                match = True
                for i, part in enumerate(perm_parts):
                    if part == '*':
                        break
                    if i >= len(scope_parts) or part != scope_parts[i]:
                        match = False
                        break
                if match:
                    return True
        return False

    def to_dict(self, include_metrics=False):
        result = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'hostname': self.hostname,
            'ip_address': self.ip_address,
            'group_id': self.group_id,
            'group_name': self.group.name if self.group else None,
            'tags': self.tags or [],
            'status': self.status,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'last_error': self.last_error,
            'agent_version': self.agent_version,
            'agent_id': self.agent_id,
            'os_type': self.os_type,
            'os_version': self.os_version,
            'platform': self.platform,
            'architecture': self.architecture,
            'cpu_cores': self.cpu_cores,
            'cpu_model': self.cpu_model,
            'total_memory': self.total_memory,
            'total_disk': self.total_disk,
            'docker_version': self.docker_version,
            'permissions': self.permissions or [],
            'allowed_ips': self.allowed_ips or [],
            'api_key_last_rotated': self.api_key_last_rotated.isoformat() if self.api_key_last_rotated else None,
            'registered_at': self.registered_at.isoformat() if self.registered_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_metrics:
            # Get latest metrics
            latest = self.metrics.order_by(ServerMetrics.timestamp.desc()).first()
            if latest:
                result['latest_metrics'] = latest.to_dict()
        return result

    def __repr__(self):
        return f'<Server {self.name}>'


class ServerMetrics(db.Model):
    """Historical metrics from servers"""
    __tablename__ = 'server_metrics'

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)

    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # System Metrics
    cpu_percent = db.Column(db.Float)
    memory_percent = db.Column(db.Float)
    memory_used = db.Column(db.BigInteger)
    disk_percent = db.Column(db.Float)
    disk_used = db.Column(db.BigInteger)
    network_rx = db.Column(db.BigInteger)  # Bytes received (total)
    network_tx = db.Column(db.BigInteger)  # Bytes transmitted (total)
    network_rx_rate = db.Column(db.Float)  # Bytes/sec
    network_tx_rate = db.Column(db.Float)  # Bytes/sec

    # Docker Metrics
    container_count = db.Column(db.Integer)
    container_running = db.Column(db.Integer)

    # Additional data as JSON
    extra = db.Column(db.JSON)

    server = db.relationship('Server', back_populates='metrics')

    __table_args__ = (
        db.Index('ix_server_metrics_server_time', 'server_id', 'timestamp'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'cpu_percent': self.cpu_percent,
            'memory_percent': self.memory_percent,
            'memory_used': self.memory_used,
            'disk_percent': self.disk_percent,
            'disk_used': self.disk_used,
            'network_rx': self.network_rx,
            'network_tx': self.network_tx,
            'network_rx_rate': self.network_rx_rate,
            'network_tx_rate': self.network_tx_rate,
            'container_count': self.container_count,
            'container_running': self.container_running,
            'extra': self.extra,
        }


class ServerCommand(db.Model):
    """Audit log of commands executed on servers"""
    __tablename__ = 'server_commands'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))

    # Command details
    command_type = db.Column(db.String(50))  # docker:container:start, system:exec, etc.
    command_data = db.Column(db.JSON)  # The actual command/parameters

    # Execution
    status = db.Column(db.String(20), default='pending')  # pending, running, completed, failed, timeout
    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)

    # Result
    result = db.Column(db.JSON)
    error = db.Column(db.Text)
    exit_code = db.Column(db.Integer)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    server = db.relationship('Server', back_populates='commands')

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'user_id': self.user_id,
            'command_type': self.command_type,
            'command_data': self.command_data,
            'status': self.status,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'result': self.result,
            'error': self.error,
            'exit_code': self.exit_code,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class AgentSession(db.Model):
    """Active agent WebSocket sessions"""
    __tablename__ = 'agent_sessions'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)

    session_token = db.Column(db.String(256))  # Current session token
    socket_id = db.Column(db.String(100))  # SocketIO session ID
    connected_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_heartbeat = db.Column(db.DateTime, default=datetime.utcnow)

    ip_address = db.Column(db.String(45))
    user_agent = db.Column(db.String(255))  # Agent version info

    is_active = db.Column(db.Boolean, default=True, index=True)
    disconnected_at = db.Column(db.DateTime)
    disconnect_reason = db.Column(db.String(100))

    server = db.relationship('Server', back_populates='sessions')

    def to_dict(self):
        return {
            'id': self.id,
            'server_id': self.server_id,
            'connected_at': self.connected_at.isoformat() if self.connected_at else None,
            'last_heartbeat': self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            'ip_address': self.ip_address,
            'is_active': self.is_active,
            'disconnected_at': self.disconnected_at.isoformat() if self.disconnected_at else None,
            'disconnect_reason': self.disconnect_reason,
        }
