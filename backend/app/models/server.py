import hashlib
import hmac
import uuid
import secrets
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
from app import db
from app.models.mixins import EncryptedSecret, uuid_pk, TimestampMixin, SerializableMixin
from app.models.json_column_mixin import JsonColumnMixin


class ServerGroup(TimestampMixin, db.Model):
    """Group servers for organization"""
    __tablename__ = 'server_groups'

    id = uuid_pk()
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    color = db.Column(db.String(7), default='#6366f1')  # Hex color for UI
    icon = db.Column(db.String(50), default='server')  # Icon name
    parent_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'), nullable=True, index=True)

    # Fleet Management
    auto_upgrade = db.Column(db.Boolean, default=False)
    upgrade_channel = db.Column(db.String(20), default='stable')  # stable, beta


    # Relationships
    # Use 'subquery' to eagerly load servers in a single query, avoiding N+1
    servers = db.relationship('Server', back_populates='group', lazy='subquery')
    children = db.relationship('ServerGroup', backref=db.backref('parent', remote_side=[id]))

    def to_dict(self, include_servers=False):
        result = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'color': self.color,
            'icon': self.icon,
            'parent_id': self.parent_id,
            'auto_upgrade': self.auto_upgrade,
            'upgrade_channel': self.upgrade_channel,
            'server_count': len(self.servers),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_servers:
            result['servers'] = [s.to_dict() for s in self.servers]
        return result

    def __repr__(self):
        return f'<ServerGroup {self.name}>'


class Server(TimestampMixin, JsonColumnMixin, db.Model):
    """Represents a remote server managed by ServerKit"""
    __tablename__ = 'servers'

    DOCKER_READ_ACTIONS = {
        'container': {'list', 'inspect', 'logs', 'stats'},
        'image': {'list'},
        'volume': {'list'},
        'network': {'list'},
        'compose': {'list', 'ps', 'logs'},
    }
    SYSTEM_READ_ACTIONS = {'metrics', 'info', 'processes'}

    # Control-plane actions that aren't gated by per-server permissions:
    # the panel issues these to discover state or refresh metadata, not
    # to mutate the host. Without this list, an agent with the
    # 'docker_manager' profile (no 'agent:*' grant) would 403 on the
    # Refresh button in the System Status card. Authentication still
    # happens at the JWT layer; this only short-circuits the per-server
    # ACL.
    CONTROL_PLANE_ACTIONS = {
        'agent:recapabilities',
        'agent:update',
    }

    id = uuid_pk()

    # Basic Info
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    hostname = db.Column(db.String(255))  # Reported by agent
    ip_address = db.Column(db.String(45))  # IPv4 or IPv6

    # Organization
    group_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'), nullable=True, index=True)
    # Workspace scoping (#33). Nullable: existing rows are backfilled to a default
    # workspace by migration 015; new rows are stamped on create.
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id'), nullable=True, index=True)
    tags = db.Column(db.JSON, default=list)  # ["production", "us-east", "docker"]

    # Status
    status = db.Column(db.String(20), default='pending', index=True)
    # pending, connecting, online, offline, error, maintenance
    last_seen = db.Column(db.DateTime)
    last_error = db.Column(db.Text)

    # Onboarding lifecycle (separate from the flat `status` above). Tracks the
    # provisioning state machine: pending -> validating ->
    # installing_prerequisites -> installing_docker -> pairing_agent -> ready
    # (or failed). `onboarding_progress` mirrors the latest log rows as JSON for
    # cheap reads; the authoritative history is in server_onboarding_logs.
    onboarding_state = db.Column(db.String(40), nullable=True, default='pending')
    onboarding_progress = db.Column(db.Text, nullable=True)  # JSON snapshot of recent steps
    onboarding_updated_at = db.Column(db.DateTime, nullable=True)

    # Agent Info
    agent_version = db.Column(db.String(20))
    agent_id = db.Column(db.String(36), unique=True, index=True)  # Agent's UUID
    auto_upgrade = db.Column(db.Boolean, default=False)
    upgrade_channel = db.Column(db.String(20), default='stable')  # stable, beta

    # Managed vs observed. Migrations 065/068 have
    # always carried these columns; the model fields and MANAGEMENT_MODES were
    # lost in the 2026-07 data loss, which left the survey management-mode
    # routes raising AttributeError (restored via the migration↔model
    # drift gate). Observed boxes refuse mutating agent commands;
    # allow_agent_update_observed is the explicit break-glass that still
    # permits agent:update on an observed box.
    MANAGEMENT_MODES = ('managed', 'observed')
    management_mode = db.Column(db.String(16), nullable=False,
                                default='managed', server_default='managed')
    allow_agent_update_observed = db.Column(db.Boolean, nullable=False,
                                            default=False, server_default='0')

    @property
    def is_managed(self):
        """False only for observed boxes."""
        return (self.management_mode or 'managed') != 'observed'

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
    # Agent's self-reported footprint (binary dir / config dir) — preferred
    # over installer-default conventions by target-aware UIs (File Manager).
    agent_install_dir = db.Column(db.String(255))
    agent_config_dir = db.Column(db.String(255))

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

    # One crypto path: descriptor-backed accessors over the
    # *_encrypted columns. Encrypt failures RAISE (the old accessors printed
    # and silently stored nothing — a data-loss path).
    api_secret = EncryptedSecret('api_secret_encrypted')
    api_secret_pending = EncryptedSecret('api_secret_pending_encrypted')
    api_key_rotation_expires = db.Column(db.DateTime)  # When pending key rotation expires
    api_key_rotation_id = db.Column(db.String(36))  # Unique ID for current rotation
    api_key_last_rotated = db.Column(db.DateTime)  # Last successful rotation timestamp

    # Registration
    registration_token_hash = db.Column(db.String(256))
    registration_token_expires = db.Column(db.DateTime)
    registered_at = db.Column(db.DateTime)
    registered_by = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)

    # Cached capability snapshot — written every time the agent reports
    # a Capabilities message, so the panel can render the full Overview
    # tab even when the agent is offline. Old agents that pre-date these
    # fields just have NULL here; the UI falls back gracefully.
    cached_capabilities = db.Column(db.JSON)            # {docker:bool, files:bool, ...}
    cached_runtimes = db.Column(db.JSON)                # {python:"3.11.4", node:"20.10.0", ...}
    cached_runtime_managers = db.Column(db.JSON)        # {python:"pyenv-win"|"pyenv"|""}
    cached_allowed_paths = db.Column(db.JSON)           # ["/var/www", ...]
    cached_sudo = db.Column(db.String(20))              # "root"|"passwordless"|"unavailable"
    cached_systemd_json = db.Column(db.Boolean)         # systemctl --output=json supported?
    capabilities_at = db.Column(db.DateTime)            # when the snapshot was last refreshed

    # Timestamps

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

    @staticmethod
    def registration_token_digest(token):
        """SHA-256 of a registration token. The token is 256 random bits, so a
        slow password hash buys nothing, and a fast exact digest lets the
        public /register route look one row up instead of running a
        deliberately slow check against every pending server."""
        return 'sha256$' + hashlib.sha256(token.encode()).hexdigest()

    def set_registration_token(self, token):
        """Hash and store registration token"""
        self.registration_token_hash = Server.registration_token_digest(token)

    def verify_registration_token(self, token):
        """Verify a registration token"""
        if not self.registration_token_hash:
            return False
        if self.registration_token_expires and datetime.utcnow() > self.registration_token_expires:
            return False
        if self.registration_token_hash.startswith('sha256$'):
            return hmac.compare_digest(self.registration_token_hash,
                                       Server.registration_token_digest(token))
        # Tokens issued before the digest switch; they expire on their own.
        return check_password_hash(self.registration_token_hash, token)

    @staticmethod
    def find_by_registration_token(token):
        """The pending server this token pairs, or None."""
        server = Server.query.filter_by(
            registration_token_hash=Server.registration_token_digest(token)).first()
        if server is not None:
            return server if server.verify_registration_token(token) else None
        now = datetime.utcnow()
        legacy = Server.query.filter(
            Server.registration_token_hash.isnot(None),
            ~Server.registration_token_hash.startswith('sha256$'),
            db.or_(Server.registration_token_expires.is_(None),
                   Server.registration_token_expires > now),
        ).all()
        return next((s for s in legacy if s.verify_registration_token(token)), None)

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
        """Encrypt and store the API secret for signature verification.

        Raises if encryption fails — silently storing nothing would leave an
        agent "paired" but unable to ever verify a signature.
        """
        self.api_secret = api_secret

    def get_api_secret(self):
        """Decrypt and return the API secret (None if unset/undecryptable)."""
        return self.api_secret

    def get_pending_api_secret(self):
        """Decrypt and return the pending API secret used during key rotation.

        Mirrors get_api_secret() for the api_secret_pending_encrypted column so
        an agent that authenticates with the pending key during a rotation
        window can have its signature verified against the right secret.
        Returns None when there is no pending secret or it can't be decrypted.
        """
        return self.api_secret_pending

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

        self.api_secret_pending = new_api_secret

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
        # Control-plane actions (agent:recapabilities, agent:update) are
        # not gated — they're issued by the panel to discover state and
        # refresh metadata. Authentication is enforced at the JWT layer.
        if scope in self.CONTROL_PLANE_ACTIONS:
            return True
        if not self.permissions:
            return False
        if '*' in self.permissions:
            return True

        candidate_scopes = self._expand_permission_scope(scope)
        for perm in self.permissions:
            for candidate in candidate_scopes:
                if self._permission_matches(perm, candidate):
                    return True
        return False

    # Verb tokens that mean "read this thing, don't change it." When the
    # last component of an action matches one of these, the expander
    # adds a `<namespace>:read` candidate so a permissions list with
    # only generic read grants doesn't 403 on a specific list/inspect
    # call.
    READ_ACTION_VERBS = {
        'list', 'list_installed', 'list_units',
        'read', 'get', 'inspect', 'status', 'info',
        'search', 'logs', 'stats', 'available',
        'installed', 'current', 'show',
        # Fleet doctor / survey probes are Observed-safe reads:
        # they only discover host state, so they classify as reads and expand
        # to `<ns>:read` rather than `<ns>:write`.
        'probe', 'survey',
    }

    @classmethod
    def is_read_action(cls, action):
        """Return True when an agent action is a non-mutating read.

        Classified purely by the leaf verb: ``doctor:probe`` / ``systemd:status``
        are reads (Observed-safe), while ``cron:update`` / ``systemd:restart``
        are mutating. Used by the fleet doctor to decide whether a command may
        run under the Observed (read-only) trust level.
        """
        parts = action.split(':')
        return bool(parts) and parts[-1] in cls.READ_ACTION_VERBS

    @classmethod
    def _expand_permission_scope(cls, scope):
        """Add profile and legacy aliases for an agent command scope."""
        candidate_scopes = {scope}
        scope_parts = scope.split(':')

        if len(scope_parts) >= 3 and scope_parts[0] == 'docker':
            resource = scope_parts[1]
            action = scope_parts[2]
            read_actions = cls.DOCKER_READ_ACTIONS.get(resource, set())

            if action in read_actions:
                candidate_scopes.add(f'docker:{resource}:read')
                candidate_scopes.add('docker:read')
            else:
                candidate_scopes.add(f'docker:{resource}:write')
                candidate_scopes.add('docker:write')

        if len(scope_parts) >= 2 and scope_parts[0] == 'system':
            action = scope_parts[1]
            if action in cls.SYSTEM_READ_ACTIONS:
                candidate_scopes.add(f'system:{action}:read')
                candidate_scopes.add('system:metrics:read')
                candidate_scopes.add('system:read')

        # Generic read-action expansion for the namespaces we added in
        # later phases (packages, systemd, runtimes, cloudflared, file,
        # cron). When the leaf verb is a read (list/info/status/etc.),
        # accept either an exact match, a `<ns>:read`, a `<ns>:*`, or
        # any of the legacy `<ns>:<sub>:read` variants. Mutating verbs
        # fall through to require explicit grants.
        if scope_parts:
            namespace = scope_parts[0]
            tail = scope_parts[-1]
            if tail in cls.READ_ACTION_VERBS:
                candidate_scopes.add(f'{namespace}:read')
                if len(scope_parts) >= 2:
                    candidate_scopes.add(f'{namespace}:{scope_parts[1]}:read')
            else:
                candidate_scopes.add(f'{namespace}:write')

        return candidate_scopes

    @staticmethod
    def _permission_matches(permission, scope):
        """Check exact and wildcard patterns like docker:* or docker:container:*."""
        if permission == scope:
            return True

        scope_parts = scope.split(':')
        perm_parts = permission.split(':')

        if len(perm_parts) > len(scope_parts):
            return False

        for i, part in enumerate(perm_parts):
            if part == '*':
                return True
            if i >= len(scope_parts) or part != scope_parts[i]:
                return False

        return True

    def _onboarding_progress_list(self):
        """Decode the cached onboarding_progress JSON snapshot to a list.

        Returns an empty list when unset or malformed so the API/UI never
        crash on legacy/partial data.
        """
        return self._json_read('onboarding_progress', [], expect=list)

    # Emitted by to_dict but not mapped columns: each costs a relationship load
    # or a JSON walk, so `$select` has to know they exist in order to decline
    # them. Kept next to to_dict so the two cannot drift.
    DERIVED_FIELDS = ('group_name', 'onboarding_progress', 'latest_metrics')

    def to_dict(self, include_metrics=False, fields=None):
        """Serialize the server.

        `fields` (normally from ``$select``) narrows the payload AND skips the
        derived work. `onboarding_progress` alone is ~29% of a row and is read
        by exactly one screen; `group_name` is a relationship load. A list that
        only needs {id, name} should pay for neither.
        """
        want = fields.__contains__ if fields is not None else (lambda _key: True)
        result = {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'hostname': self.hostname,
            'ip_address': self.ip_address,
            'group_id': self.group_id,
            'workspace_id': self.workspace_id,
            'tags': self.tags or [],
            'status': self.status,
            'last_seen': self.last_seen.isoformat() if self.last_seen else None,
            'last_error': self.last_error,
            'management_mode': self.management_mode or 'managed',
            'allow_agent_update_observed': bool(self.allow_agent_update_observed),
            'onboarding_state': self.onboarding_state,
            'onboarding_updated_at': self.onboarding_updated_at.isoformat() if self.onboarding_updated_at else None,
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
            'agent_install_dir': self.agent_install_dir,
            'agent_config_dir': self.agent_config_dir,
            'permissions': self.permissions or [],
            'allowed_ips': self.allowed_ips or [],
            'api_key_last_rotated': self.api_key_last_rotated.isoformat() if self.api_key_last_rotated else None,
            'registered_at': self.registered_at.isoformat() if self.registered_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if fields is not None:
            result = {key: value for key, value in result.items() if key in fields}

        # The derived three, each skippable.
        if want('group_name'):
            result['group_name'] = self.group.name if self.group else None
        if want('onboarding_progress'):
            result['onboarding_progress'] = self._onboarding_progress_list()
        if include_metrics and want('latest_metrics'):
            # `metrics` is lazy='dynamic', so this is a query per server — the
            # list route batches it instead and never passes include_metrics.
            latest = self.metrics.order_by(ServerMetrics.timestamp.desc()).first()
            if latest:
                result['latest_metrics'] = latest.to_dict()
        return result

    def __repr__(self):
        return f'<Server {self.name}>'


class ServerMetrics(SerializableMixin, db.Model):
    """Historical metrics from servers"""
    __tablename__ = 'server_metrics'

    # SQLite only autoincrements when the column type is exactly INTEGER
    # PRIMARY KEY (rowid alias). With BigInteger every insert failed with
    # "NOT NULL constraint failed: server_metrics.id" and no metrics ever
    # got stored — exactly the silent dashboard-zeroes symptom we just
    # tracked down. Integer caps at ~2.1B rows which at 1 sample/sec is
    # ~68 years per server, plenty.
    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
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



class ServerCommand(SerializableMixin, db.Model):
    """Audit log of commands executed on servers"""
    __tablename__ = 'server_commands'

    id = uuid_pk()
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)

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

    # Retry / offline queue
    retry_count = db.Column(db.Integer, default=0)
    max_retries = db.Column(db.Integer, default=3)
    next_retry_at = db.Column(db.DateTime)
    backoff_seconds = db.Column(db.Integer, default=30)  # initial backoff, doubles each retry
    queued = db.Column(db.Boolean, default=False)  # True when agent was offline at send time

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    server = db.relationship('Server', back_populates='commands')

    # Serialization comes from SerializableMixin; these columns stay out
    # of API payloads (parity with the deleted hand-written to_dict).
    __serialize_exclude__ = ('backoff_seconds', 'next_retry_at')


class AgentSession(SerializableMixin, db.Model):
    """Active agent WebSocket sessions"""
    __tablename__ = 'agent_sessions'

    id = uuid_pk()
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False, index=True)

    session_token = db.Column(db.String(256))  # Current session token
    socket_id = db.Column(db.String(100))  # SocketIO session ID
    connected_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_heartbeat = db.Column(db.DateTime, default=datetime.utcnow)

    ip_address = db.Column(db.String(45))
    user_agent = db.Column(db.String(255))  # Agent version info

    # Latency tracking
    heartbeat_latency_ms = db.Column(db.Float)  # Latest heartbeat round-trip latency
    avg_latency_ms = db.Column(db.Float)  # Running average latency
    latency_samples = db.Column(db.Integer, default=0)  # Number of samples in average

    is_active = db.Column(db.Boolean, default=True, index=True)
    disconnected_at = db.Column(db.DateTime)
    disconnect_reason = db.Column(db.String(100))

    server = db.relationship('Server', back_populates='sessions')

    def update_latency(self, latency_ms):
        """Update latency with exponential moving average"""
        self.heartbeat_latency_ms = latency_ms
        if self.avg_latency_ms is None or self.latency_samples == 0:
            self.avg_latency_ms = latency_ms
            self.latency_samples = 1
        else:
            # EMA with alpha = 0.2 for smoothing
            alpha = 0.2
            self.avg_latency_ms = alpha * latency_ms + (1 - alpha) * self.avg_latency_ms
            self.latency_samples += 1

    # Serialization comes from SerializableMixin; these columns stay out
    # of API payloads (parity with the deleted hand-written to_dict).
    __serialize_exclude__ = ('latency_samples', 'session_token', 'socket_id', 'user_agent')


class AgentRollout(TimestampMixin, db.Model):
    """Tracks staged rollout progress"""
    __tablename__ = 'agent_rollouts'

    id = uuid_pk()
    version_id = db.Column(db.String(36), db.ForeignKey('agent_versions.id'), nullable=False, index=True)
    group_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'), nullable=True, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), index=True)

    # Configuration
    batch_size = db.Column(db.Integer, default=5)
    delay_minutes = db.Column(db.Integer, default=10)
    strategy = db.Column(db.String(20), default='staged')  # staged, all, canary

    # Progress
    status = db.Column(db.String(20), default='pending')  # pending, running, paused, completed, failed, cancelled
    total_servers = db.Column(db.Integer, default=0)
    processed_servers = db.Column(db.Integer, default=0)
    failed_servers = db.Column(db.Integer, default=0)
    current_wave = db.Column(db.Integer, default=0)

    # Results per server
    server_results = db.Column(db.JSON, default=list)  # [{server_id, status, error, wave}]

    error = db.Column(db.Text)

    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)

    # Parent-side backref so the delete-cascade policy covers the NOT NULL FK.
    version = db.relationship('AgentVersion',
                              backref=db.backref('rollouts', lazy='dynamic'))

    def to_dict(self):
        return {
            'id': self.id,
            'version_id': self.version_id,
            'version': self.version.version if self.version else None,
            'group_id': self.group_id,
            'user_id': self.user_id,
            'batch_size': self.batch_size,
            'delay_minutes': self.delay_minutes,
            'strategy': self.strategy,
            'status': self.status,
            'total_servers': self.total_servers,
            'processed_servers': self.processed_servers,
            'failed_servers': self.failed_servers,
            'current_wave': self.current_wave,
            'server_results': self.server_results or [],
            'error': self.error,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class AgentVersion(TimestampMixin, db.Model):
    """Available agent versions and compatibility matrix"""
    __tablename__ = 'agent_versions'

    id = uuid_pk()
    version = db.Column(db.String(20), nullable=False, unique=True)
    channel = db.Column(db.String(20), default='stable')  # stable, beta
    
    # Compatibility
    min_panel_version = db.Column(db.String(20))
    max_panel_version = db.Column(db.String(20))
    
    # Metadata
    release_notes = db.Column(db.Text)
    is_active = db.Column(db.Boolean, default=True)
    published_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Assets (mapped by platform: linux-amd64, windows-amd64, etc.)
    assets = db.Column(db.JSON)  # {"linux-amd64": "url", "checksums": "url"}
    

    def to_dict(self):
        return {
            'id': self.id,
            'version': self.version,
            'channel': self.channel,
            'min_panel_version': self.min_panel_version,
            'max_panel_version': self.max_panel_version,
            'release_notes': self.release_notes,
            'is_active': self.is_active,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'assets': self.assets or {},
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f'<AgentVersion {self.version}>'
