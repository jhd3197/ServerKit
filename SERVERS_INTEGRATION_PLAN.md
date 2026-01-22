# ServerKit Multi-Server Management Integration Plan
## "ServerKit Agents" - THE Comprehensive Server Management Solution

> **Vision**: Transform ServerKit from a single-server management tool into a distributed server orchestration platform that manages unlimited servers from a single dashboard.

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Security Model (Critical!)](#security-model)
4. [Agent Design](#agent-design)
5. [Database Schema](#database-schema)
6. [API Design](#api-design)
7. [Frontend Design](#frontend-design)
8. [Installation & Packaging](#installation--packaging)
9. [Communication Protocol](#communication-protocol)
10. [Feature Breakdown](#feature-breakdown)
11. [Phase Implementation Plan](#phase-implementation-plan)
12. [Risk Assessment](#risk-assessment)

---

## 1. Executive Summary

### What We're Building
A lightweight agent system that allows ServerKit to manage multiple remote servers (Windows/Linux) from a single dashboard. Users install a small agent on their servers, connect it to their ServerKit instance, and gain full Docker management, monitoring, and remote execution capabilities.

### Why Security is ABSOLUTELY Required
Even though we're "just managing Docker," this is a critical security concern:

| Risk | Impact | Why It Matters |
|------|--------|----------------|
| **Docker = Root Access** | Critical | Docker can mount host filesystem, access kernel, run privileged containers |
| **Remote Code Execution** | Critical | Agents execute commands on remote servers |
| **Network Exposure** | High | Agents may be on internal networks with sensitive data |
| **Credential Theft** | High | Stolen agent keys = full server access |
| **Man-in-the-Middle** | High | Unencrypted traffic can be intercepted and modified |
| **Supply Chain** | Medium | Malicious agents could be installed |

**Bottom Line**: We need enterprise-grade security from day one. This isn't optional.

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ServerKit Control Plane                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Web UI    │  │  REST API   │  │  SocketIO   │  │    Agent Gateway        │ │
│  │  (React)    │  │   (Flask)   │  │   Server    │  │  (WebSocket Handler)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                │                     │               │
│         └────────────────┴────────────────┴─────────────────────┤               │
│                                                                 │               │
│  ┌──────────────────────────────────────────────────────────────┴─────────────┐ │
│  │                         Agent Registry Service                             │ │
│  │  - Agent authentication    - Health tracking    - Command routing          │ │
│  │  - Connection management   - Load balancing     - Failover handling        │ │
│  └──────────────────────────────────────────────────────────────┬─────────────┘ │
│                                                                 │               │
│  ┌──────────────────────────────────────────────────────────────┴─────────────┐ │
│  │                              PostgreSQL Database                            │ │
│  │  Servers, Agents, Commands, Metrics, Audit Logs, etc.                      │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
           ┌────────┴────────┐ ┌──────┴──────┐ ┌────────┴────────┐
           │   WSS/TLS       │ │  WSS/TLS    │ │   WSS/TLS       │
           │   Connection    │ │  Connection │ │   Connection    │
           └────────┬────────┘ └──────┬──────┘ └────────┬────────┘
                    │                 │                 │
    ┌───────────────┴───────┐  ┌──────┴──────┐  ┌───────┴───────────────┐
    │   Linux Server        │  │ Windows PC  │  │   Linux Server        │
    │  ┌─────────────────┐  │  │ ┌─────────┐ │  │  ┌─────────────────┐  │
    │  │ ServerKit Agent │  │  │ │  Agent  │ │  │  │ ServerKit Agent │  │
    │  │  (Go binary)    │  │  │ │  (Go)   │ │  │  │  (Go binary)    │  │
    │  └────────┬────────┘  │  │ └────┬────┘ │  │  └────────┬────────┘  │
    │           │           │  │      │      │  │           │           │
    │  ┌────────┴────────┐  │  │ ┌────┴────┐ │  │  ┌────────┴────────┐  │
    │  │     Docker      │  │  │ │ Docker  │ │  │  │     Docker      │  │
    │  │     Engine      │  │  │ │ Desktop │ │  │  │     Engine      │  │
    │  └─────────────────┘  │  │ └─────────┘ │  │  └─────────────────┘  │
    └───────────────────────┘  └─────────────┘  └───────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Control Plane** | Central management, UI, API, database |
| **Agent Gateway** | WebSocket server for agent connections |
| **Agent Registry** | Track connected agents, route commands |
| **ServerKit Agent** | Lightweight daemon on remote servers |
| **Local Executor** | Execute Docker/system commands locally |

---

## 3. Security Model

### 3.1 Authentication Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: Transport Security (TLS 1.3)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - All communication over WSS (WebSocket Secure)            ││
│  │  - Certificate validation (reject self-signed in prod)      ││
│  │  - Perfect forward secrecy                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Layer 2: Agent Authentication                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - API Key + Secret pair (generated on registration)        ││
│  │  - HMAC-SHA256 signed handshake                             ││
│  │  - Short-lived session tokens (1 hour, auto-refresh)        ││
│  │  - Optional: mTLS for enterprise deployments                ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Layer 3: Command Authorization                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - Per-server permission scopes                             ││
│  │  - Command whitelist (allowed operations)                   ││
│  │  - Request signing with timestamp (prevent replay)          ││
│  │  - Audit logging of all operations                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Layer 4: Data Protection                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - Secrets encrypted at rest (agent keys, tokens)           ││
│  │  - No plaintext credentials in transit                      ││
│  │  - Secure secret injection to containers                    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Registration Flow

```
┌──────────┐                    ┌──────────────┐                    ┌──────────┐
│  User    │                    │ Control Plane │                    │  Agent   │
└────┬─────┘                    └───────┬──────┘                    └────┬─────┘
     │                                  │                                │
     │ 1. Create Server (UI)            │                                │
     │ ─────────────────────────────────>                                │
     │                                  │                                │
     │ 2. Returns registration token    │                                │
     │ <─────────────────────────────────                                │
     │    (24-hour expiry, single-use)  │                                │
     │                                  │                                │
     │ 3. Install agent with token      │                                │
     │ ─────────────────────────────────────────────────────────────────>
     │                                  │                                │
     │                                  │  4. Agent connects with token  │
     │                                  │ <──────────────────────────────
     │                                  │                                │
     │                                  │  5. Validates token, generates │
     │                                  │     permanent API key pair     │
     │                                  │ ──────────────────────────────>
     │                                  │                                │
     │                                  │  6. Agent stores keys securely │
     │                                  │     (encrypted on disk)        │
     │                                  │                                │
     │ 7. Server shows as "Connected"   │                                │
     │ <─────────────────────────────────                                │
     │                                  │                                │
```

### 3.3 Permission Scopes

```python
# Granular permissions per server
AGENT_SCOPES = {
    # Docker Operations
    'docker:containers:read',      # List, inspect containers
    'docker:containers:write',     # Create, start, stop, remove
    'docker:containers:exec',      # Exec into containers (high risk!)
    'docker:images:read',          # List, inspect images
    'docker:images:write',         # Pull, build, remove images
    'docker:compose:read',         # List compose stacks
    'docker:compose:write',        # Deploy/remove compose stacks
    'docker:volumes:read',
    'docker:volumes:write',
    'docker:networks:read',
    'docker:networks:write',

    # System Operations
    'system:metrics:read',         # CPU, memory, disk metrics
    'system:processes:read',       # Process list
    'system:logs:read',            # Read log files
    'system:exec',                 # Execute arbitrary commands (DANGEROUS!)

    # File Operations
    'files:read',                  # Read files on server
    'files:write',                 # Write files (limited paths)

    # Agent Management
    'agent:update',                # Self-update agent
    'agent:restart',               # Restart agent service
}

# Preset permission profiles
PERMISSION_PROFILES = {
    'docker_readonly': [
        'docker:containers:read',
        'docker:images:read',
        'docker:compose:read',
        'system:metrics:read',
    ],
    'docker_manager': [
        'docker:*',
        'system:metrics:read',
        'system:logs:read',
    ],
    'full_access': ['*'],  # All permissions (admin only)
}
```

### 3.4 Security Features Checklist

- [ ] **TLS everywhere**: WSS for agent connections, HTTPS for API
- [ ] **API key rotation**: Manual and automatic key rotation
- [ ] **IP allowlisting**: Optional restriction of agent IPs
- [ ] **Rate limiting**: Per-agent command rate limits
- [ ] **Audit logging**: Every command logged with user, timestamp, result
- [ ] **Anomaly detection**: Alert on unusual patterns (many failed commands, etc.)
- [ ] **Secrets management**: Encrypted storage, never logged
- [ ] **Session management**: Revoke agent sessions instantly
- [ ] **Command signing**: HMAC-signed commands with timestamp
- [ ] **Replay protection**: Nonce + timestamp validation

---

## 4. Agent Design

### 4.1 Technology Choice: Go

**Why Go?**
| Reason | Benefit |
|--------|---------|
| Single binary | No runtime dependencies, easy distribution |
| Cross-platform | Compile for Windows, Linux, macOS, ARM |
| Low memory | ~10-20MB RAM typical usage |
| Fast startup | Instant service startup |
| Excellent networking | Built-in WebSocket, HTTP, TLS support |
| Docker SDK | Official Docker Go SDK available |

### 4.2 Agent Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     ServerKit Agent                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Connection     │  │    Command      │  │    Metrics      │  │
│  │  Manager        │  │    Executor     │  │    Collector    │  │
│  │                 │  │                 │  │                 │  │
│  │ - WebSocket     │  │ - Docker API    │  │ - CPU/RAM/Disk  │  │
│  │ - Auto-reconnect│  │ - System exec   │  │ - Network I/O   │  │
│  │ - Heartbeat     │  │ - File ops      │  │ - Docker stats  │  │
│  │ - TLS handling  │  │ - Sandboxing    │  │ - Custom metrics│  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                    │                    │           │
│  ┌────────┴────────────────────┴────────────────────┴────────┐  │
│  │                     Core Event Loop                        │  │
│  │  - Message queue      - Command validation                 │  │
│  │  - Priority handling  - Response serialization             │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                  │
│  ┌────────────────────────────┴──────────────────────────────┐  │
│  │                   Security Module                          │  │
│  │  - Key storage (encrypted)  - Request validation           │  │
│  │  - HMAC signing             - Permission checking          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Config Store   │  │  Local Cache    │  │  Update Manager │  │
│  │  (encrypted)    │  │  (metrics/logs) │  │  (self-update)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Agent Features

#### Core Features
- **Persistent WebSocket connection** with auto-reconnect
- **Heartbeat** every 30 seconds (configurable)
- **Graceful shutdown** on SIGTERM/SIGINT
- **Local metric buffering** when disconnected
- **Self-update** capability (secure, signed updates)

#### Docker Integration
- Full Docker Engine API access
- Container lifecycle management
- Image management (pull, build, tag, push)
- Docker Compose stack deployment
- Volume and network management
- Container logs streaming
- Container stats streaming
- Registry authentication

#### System Integration
- CPU, memory, disk metrics via cross-platform libraries
- Process listing
- Network interface stats
- Service status (systemd/Windows services)
- Log file streaming

### 4.4 Agent Configuration

```yaml
# /etc/serverkit-agent/config.yaml (Linux)
# C:\ProgramData\ServerKit\Agent\config.yaml (Windows)

server:
  url: wss://your-serverkit.example.com/agent/ws
  # Alternative: ws://localhost:5000/agent/ws (dev only!)

agent:
  id: "auto-generated-uuid"
  name: "production-server-1"  # Human-friendly name

auth:
  key_file: /etc/serverkit-agent/agent.key  # Encrypted
  # Key is generated during registration

features:
  docker: true
  metrics: true
  metrics_interval: 10s
  logs: true
  file_access: false  # Disabled by default
  exec: false         # Disabled by default (dangerous)

docker:
  socket: /var/run/docker.sock  # Linux
  # socket: npipe:////./pipe/docker_engine  # Windows

security:
  allowed_paths: []           # For file operations
  blocked_commands: []        # Regex patterns to block
  max_exec_timeout: 300s

logging:
  level: info
  file: /var/log/serverkit-agent/agent.log
  max_size: 100MB
  max_backups: 5
```

### 4.5 Resource Usage Targets

| Resource | Target | Maximum |
|----------|--------|---------|
| Memory | 15 MB | 50 MB |
| CPU (idle) | <0.1% | 1% |
| CPU (active) | <2% | 10% |
| Disk | 20 MB | 50 MB |
| Network (idle) | <1 KB/s | 10 KB/s |

---

## 5. Database Schema

### 5.1 New Models

```python
# backend/app/models/server.py

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
    agent_id = db.Column(db.String(36), unique=True)  # Agent's UUID

    # System Info (reported by agent)
    os_type = db.Column(db.String(20))  # linux, windows, darwin
    os_version = db.Column(db.String(100))
    architecture = db.Column(db.String(20))  # amd64, arm64
    cpu_cores = db.Column(db.Integer)
    total_memory = db.Column(db.BigInteger)  # bytes
    total_disk = db.Column(db.BigInteger)  # bytes
    docker_version = db.Column(db.String(50))

    # Security
    api_key_hash = db.Column(db.String(256))  # bcrypt hash
    api_key_prefix = db.Column(db.String(8))  # For identification: "sk_abc123"
    permissions = db.Column(db.JSON, default=list)  # List of scopes
    allowed_ips = db.Column(db.JSON, default=list)  # IP whitelist (empty = all)

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
    metrics = db.relationship('ServerMetrics', back_populates='server', lazy='dynamic')
    commands = db.relationship('ServerCommand', back_populates='server', lazy='dynamic')
    containers = db.relationship('ServerContainer', back_populates='server', lazy='dynamic')


class ServerGroup(db.Model):
    """Group servers for organization"""
    __tablename__ = 'server_groups'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    color = db.Column(db.String(7))  # Hex color for UI
    icon = db.Column(db.String(50))  # Icon name
    parent_id = db.Column(db.String(36), db.ForeignKey('server_groups.id'))  # Nested groups

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    servers = db.relationship('Server', back_populates='group')
    children = db.relationship('ServerGroup', backref=db.backref('parent', remote_side=[id]))


class ServerMetrics(db.Model):
    """Historical metrics from servers"""
    __tablename__ = 'server_metrics'

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False)

    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # System Metrics
    cpu_percent = db.Column(db.Float)
    memory_percent = db.Column(db.Float)
    memory_used = db.Column(db.BigInteger)
    disk_percent = db.Column(db.Float)
    disk_used = db.Column(db.BigInteger)
    network_rx = db.Column(db.BigInteger)  # Bytes received
    network_tx = db.Column(db.BigInteger)  # Bytes transmitted

    # Docker Metrics
    container_count = db.Column(db.Integer)
    container_running = db.Column(db.Integer)
    image_count = db.Column(db.Integer)

    # Additional data as JSON
    extra = db.Column(db.JSON)

    server = db.relationship('Server', back_populates='metrics')

    __table_args__ = (
        db.Index('ix_server_metrics_server_time', 'server_id', 'timestamp'),
    )


class ServerCommand(db.Model):
    """Audit log of commands executed on servers"""
    __tablename__ = 'server_commands'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))

    # Command details
    command_type = db.Column(db.String(50))  # docker:container:start, system:exec, etc.
    command_data = db.Column(db.JSON)  # The actual command/parameters

    # Execution
    status = db.Column(db.String(20))  # pending, running, completed, failed, timeout
    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)

    # Result
    result = db.Column(db.JSON)
    error = db.Column(db.Text)
    exit_code = db.Column(db.Integer)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    server = db.relationship('Server', back_populates='commands')
    user = db.relationship('User')


class ServerContainer(db.Model):
    """Cached container state from remote servers"""
    __tablename__ = 'server_containers'

    id = db.Column(db.String(36), primary_key=True)  # Docker container ID
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False)

    name = db.Column(db.String(255))
    image = db.Column(db.String(255))
    status = db.Column(db.String(50))
    state = db.Column(db.String(20))  # running, paused, exited, etc.

    created = db.Column(db.DateTime)
    started_at = db.Column(db.DateTime)

    ports = db.Column(db.JSON)
    labels = db.Column(db.JSON)

    # Stats snapshot
    cpu_percent = db.Column(db.Float)
    memory_usage = db.Column(db.BigInteger)
    memory_limit = db.Column(db.BigInteger)

    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

    server = db.relationship('Server', back_populates='containers')


class AgentSession(db.Model):
    """Active agent WebSocket sessions"""
    __tablename__ = 'agent_sessions'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=False)

    session_token_hash = db.Column(db.String(256))
    connected_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_heartbeat = db.Column(db.DateTime, default=datetime.utcnow)

    ip_address = db.Column(db.String(45))
    user_agent = db.Column(db.String(255))  # Agent version info

    is_active = db.Column(db.Boolean, default=True)
    disconnected_at = db.Column(db.DateTime)
    disconnect_reason = db.Column(db.String(100))
```

### 5.2 Schema Diagram

```
┌─────────────────────┐       ┌─────────────────────┐
│   server_groups     │       │       users         │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ name                │       │ ...                 │
│ description         │       └──────────┬──────────┘
│ color               │                  │
│ parent_id (FK)──────┼──┐              │
└──────────┬──────────┘  │              │
           │             │              │
           │ 1:N         │              │
           │             │              │
┌──────────┴──────────┐  │              │
│      servers        │◄─┘              │
├─────────────────────┤                 │
│ id (PK)             │                 │
│ name                │                 │
│ group_id (FK)───────┼─────────────────┘
│ registered_by (FK)──┼─────────────────┘
│ status              │
│ agent_id            │
│ os_type             │
│ ...                 │
└──────────┬──────────┘
           │
     ┌─────┼─────┬───────────┐
     │     │     │           │
     │ 1:N │ 1:N │ 1:N       │ 1:N
     │     │     │           │
     ▼     ▼     ▼           ▼
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐
│ metrics │ │commands │ │containers│ │agent_sessions│
└─────────┘ └─────────┘ └──────────┘ └──────────────┘
```

---

## 6. API Design

### 6.1 Server Management Endpoints

```
# Server CRUD
GET    /api/v1/servers                    # List all servers
POST   /api/v1/servers                    # Create new server (generates reg token)
GET    /api/v1/servers/:id                # Get server details
PUT    /api/v1/servers/:id                # Update server (name, group, etc.)
DELETE /api/v1/servers/:id                # Remove server

# Server Status
GET    /api/v1/servers/:id/status         # Get current status & metrics
POST   /api/v1/servers/:id/ping           # Force ping/health check

# Registration
POST   /api/v1/servers/:id/regenerate-token    # Generate new registration token
POST   /api/v1/servers/:id/rotate-key          # Rotate API key

# Permissions
GET    /api/v1/servers/:id/permissions    # Get current permissions
PUT    /api/v1/servers/:id/permissions    # Update permissions

# Groups
GET    /api/v1/server-groups              # List groups
POST   /api/v1/server-groups              # Create group
PUT    /api/v1/server-groups/:id          # Update group
DELETE /api/v1/server-groups/:id          # Delete group
```

### 6.2 Remote Docker Endpoints

```
# Containers
GET    /api/v1/servers/:id/docker/containers           # List containers
GET    /api/v1/servers/:id/docker/containers/:cid      # Inspect container
POST   /api/v1/servers/:id/docker/containers           # Create container
POST   /api/v1/servers/:id/docker/containers/:cid/start
POST   /api/v1/servers/:id/docker/containers/:cid/stop
POST   /api/v1/servers/:id/docker/containers/:cid/restart
DELETE /api/v1/servers/:id/docker/containers/:cid      # Remove container
GET    /api/v1/servers/:id/docker/containers/:cid/logs # Get logs
GET    /api/v1/servers/:id/docker/containers/:cid/stats # Get stats

# Images
GET    /api/v1/servers/:id/docker/images               # List images
POST   /api/v1/servers/:id/docker/images/pull          # Pull image
DELETE /api/v1/servers/:id/docker/images/:iid          # Remove image

# Compose
GET    /api/v1/servers/:id/docker/compose              # List stacks
POST   /api/v1/servers/:id/docker/compose              # Deploy stack
DELETE /api/v1/servers/:id/docker/compose/:name        # Remove stack

# Volumes & Networks
GET    /api/v1/servers/:id/docker/volumes
GET    /api/v1/servers/:id/docker/networks
```

### 6.3 Metrics & Monitoring

```
# Real-time metrics (via WebSocket)
WS     /api/v1/servers/:id/metrics/stream

# Historical metrics
GET    /api/v1/servers/:id/metrics?from=&to=&interval=

# Cross-server comparison
GET    /api/v1/servers/metrics/compare?ids=1,2,3&metric=cpu

# Aggregated dashboard
GET    /api/v1/servers/overview                # All servers health summary
```

### 6.4 Agent Gateway WebSocket Protocol

```
# Agent connects to: wss://serverkit.example.com/agent/ws

# Handshake
→ { "type": "auth", "agent_id": "...", "signature": "hmac(...)", "timestamp": ... }
← { "type": "auth_ok", "session_token": "...", "expires": ... }

# Heartbeat
→ { "type": "heartbeat", "metrics": {...} }
← { "type": "heartbeat_ack" }

# Command from server
← { "type": "command", "id": "uuid", "action": "docker:container:start", "params": {...} }
→ { "type": "command_result", "id": "uuid", "success": true, "data": {...} }

# Streaming (logs, stats)
← { "type": "subscribe", "channel": "container:abc123:logs" }
→ { "type": "stream", "channel": "...", "data": "log line..." }
← { "type": "unsubscribe", "channel": "..." }

# Error
→ { "type": "error", "code": "...", "message": "..." }
```

---

## 7. Frontend Design

### 7.1 Navigation Structure

```
Sidebar (Updated)
├── Dashboard
├── Applications
├── ─────────────
├── Servers (NEW!)          ← New section
│   ├── Overview            ← Multi-server dashboard
│   ├── All Servers         ← List/grid view
│   └── Groups              ← Server groups management
├── ─────────────
├── Docker                  ← Now shows server selector
├── Databases
├── Domains
├── ...
```

### 7.2 Key Pages

#### Servers Overview (`/servers`)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Servers Overview                                            [+ Add Server] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Summary Cards                                                           ││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐  ││
│  │ │  Total    │ │  Online   │ │  Offline  │ │ Containers│ │ Avg CPU   │  ││
│  │ │    12     │ │    10     │ │     2     │ │    47     │ │   34%     │  ││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Server Health Grid                                                      ││
│  │                                                                         ││
│  │  Production (4 servers)                                                 ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   ││
│  │  │ 🟢 web-1 │ │ 🟢 web-2 │ │ 🟢 db-1  │ │ 🔴 cache │                   ││
│  │  │ CPU: 45% │ │ CPU: 32% │ │ CPU: 12% │ │ OFFLINE  │                   ││
│  │  │ RAM: 67% │ │ RAM: 58% │ │ RAM: 89% │ │          │                   ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                   ││
│  │                                                                         ││
│  │  Development (3 servers)                                                ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                                ││
│  │  │ 🟢 dev-1 │ │ 🟡 dev-2 │ │ 🟢 test  │                                ││
│  │  │ CPU: 23% │ │ CPU: 78% │ │ CPU: 5%  │                                ││
│  │  └──────────┘ └──────────┘ └──────────┘                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Cross-Server Metrics Comparison                      [CPU▼] [24h▼]      ││
│  │                                                                         ││
│  │  100% ┤                                                                 ││
│  │       │    ╭─╮                                                          ││
│  │   75% ┤   ╱  ╲    ╭───╮                 ── web-1                        ││
│  │       │  ╱    ╲  ╱     ╲                ── web-2                        ││
│  │   50% ┤─╱──────╲╱───────╲───────        ── db-1                         ││
│  │       │                                                                 ││
│  │   25% ┤                                                                 ││
│  │       └────────────────────────────────────────────────────────────     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Add Server Flow (`/servers/add`)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Add New Server                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Server Details                                                     │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  Server Name: [production-server-1              ]                           │
│  Description: [Main production server           ]                           │
│  Group:       [Production                      ▼]                           │
│  Tags:        [production] [us-east] [+]                                    │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  Step 2: Permissions                                                        │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  Permission Profile: [Docker Manager (Recommended)  ▼]                      │
│                                                                             │
│  ☑ Docker: Containers (read/write)                                          │
│  ☑ Docker: Images (read/write)                                              │
│  ☑ Docker: Compose (read/write)                                             │
│  ☑ System: Metrics (read)                                                   │
│  ☑ System: Logs (read)                                                      │
│  ☐ System: Execute commands (⚠️ High risk)                                  │
│  ☐ Files: Read/Write (⚠️ High risk)                                         │
│                                                                             │
│                                                      [Cancel] [Create Server]│
└─────────────────────────────────────────────────────────────────────────────┘

# After creation:
┌─────────────────────────────────────────────────────────────────────────────┐
│  Install Agent                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Your server has been created! Install the agent using one of these methods:│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Linux (One-liner)                                              [Copy]   ││
│  │                                                                         ││
│  │ curl -fsSL https://serverkit.example.com/install.sh | sudo bash -s -- \ ││
│  │   --token "sk_reg_abc123xyz..."                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Windows (PowerShell - Run as Administrator)                    [Copy]   ││
│  │                                                                         ││
│  │ irm https://serverkit.example.com/install.ps1 | iex; `                  ││
│  │   Install-ServerKitAgent -Token "sk_reg_abc123xyz..."                   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Manual Download                                                         ││
│  │                                                                         ││
│  │ [Download Linux x64] [Download Linux ARM64]                             ││
│  │ [Download Windows]   [Download macOS]                                   ││
│  │                                                                         ││
│  │ Registration Token: sk_reg_abc123xyz... (expires in 24 hours)  [Copy]   ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  Waiting for agent to connect... ⏳                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Server Detail Page (`/servers/:id`)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Back    production-server-1    🟢 Online           [Actions ▼] [Settings]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Overview] [Containers] [Images] [Compose] [Metrics] [Logs] [Terminal]     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ System Information                                                      ││
│  │ ─────────────────────────────────────────────────────────────────────── ││
│  │ OS: Ubuntu 22.04 LTS          Docker: 24.0.5                           ││
│  │ Arch: x86_64                  Agent: 1.0.0                             ││
│  │ CPUs: 8 cores                 Uptime: 45 days                          ││
│  │ Memory: 32 GB                 IP: 10.0.1.50                            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Live Metrics                                                            ││
│  │ ─────────────────────────────────────────────────────────────────────── ││
│  │                                                                         ││
│  │  CPU Usage        Memory Usage       Disk Usage       Network           ││
│  │  ┌────────┐       ┌────────┐        ┌────────┐       ┌────────┐        ││
│  │  │   45%  │       │   67%  │        │   34%  │       │ ↓ 1.2  │        ││
│  │  │  ████  │       │ ██████ │        │ ████   │       │ ↑ 0.8  │        ││
│  │  │  ████  │       │ ██████ │        │ ████   │       │  MB/s  │        ││
│  │  └────────┘       └────────┘        └────────┘       └────────┘        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Containers (12 running)                                    [+ Create]   ││
│  │ ─────────────────────────────────────────────────────────────────────── ││
│  │ Name              Image              Status    CPU    Memory   Actions  ││
│  │ nginx-proxy       nginx:alpine       🟢 Up     2%     45 MB    [···]    ││
│  │ app-backend       myapp:latest       🟢 Up     12%    234 MB   [···]    ││
│  │ postgres-db       postgres:15        🟢 Up     5%     512 MB   [···]    ││
│  │ redis-cache       redis:7            🟢 Up     1%     28 MB    [···]    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Docker Page Integration

The existing Docker page needs to support server selection:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Docker                                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Server: [Local (this server)              ▼]  ← New server selector        │
│          ┌─────────────────────────────────┐                                │
│          │ ⚡ Local (this server)          │                                │
│          │ ─────────────────────────────── │                                │
│          │ 🟢 production-server-1          │                                │
│          │ 🟢 production-server-2          │                                │
│          │ 🔴 staging-server (offline)     │                                │
│          │ 🟢 dev-server                   │                                │
│          └─────────────────────────────────┘                                │
│                                                                             │
│  [Containers] [Images] [Volumes] [Networks] [Compose]                       │
│  ... (existing Docker UI, now server-aware)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Installation & Packaging

### 8.1 Installation Methods

#### Linux - One-liner Install
```bash
curl -fsSL https://your-serverkit.com/install.sh | sudo bash -s -- \
  --token "sk_reg_abc123..."
```

The script will:
1. Detect Linux distribution (Ubuntu, Debian, CentOS, Fedora, Alpine)
2. Download appropriate binary
3. Create service user (`serverkit-agent`)
4. Install systemd service
5. Configure firewall (if needed)
6. Register with ServerKit using token
7. Start the agent

#### Windows - PowerShell Install
```powershell
# Run as Administrator
irm https://your-serverkit.com/install.ps1 | iex
Install-ServerKitAgent -Token "sk_reg_abc123..."
```

The script will:
1. Download Windows binary
2. Install to `C:\Program Files\ServerKit Agent\`
3. Create Windows Service
4. Configure Windows Firewall
5. Register with ServerKit
6. Start the service

#### Docker Install (for containerized servers)
```bash
docker run -d \
  --name serverkit-agent \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e SERVERKIT_TOKEN="sk_reg_abc123..." \
  serverkit/agent:latest
```

### 8.2 Package Formats

| Platform | Formats |
|----------|---------|
| Linux | `.deb`, `.rpm`, `.apk`, static binary |
| Windows | `.msi`, `.exe` installer, portable `.zip` |
| macOS | `.pkg`, `.dmg`, Homebrew formula |
| Container | Docker image (multi-arch) |

### 8.3 Distribution

```
Binary Naming Convention:
serverkit-agent-{version}-{os}-{arch}[.ext]

Examples:
serverkit-agent-1.0.0-linux-amd64
serverkit-agent-1.0.0-linux-arm64
serverkit-agent-1.0.0-windows-amd64.exe
serverkit-agent-1.0.0-darwin-amd64
serverkit-agent-1.0.0-darwin-arm64

Package Naming:
serverkit-agent_1.0.0_amd64.deb
serverkit-agent-1.0.0-1.x86_64.rpm
serverkit-agent-1.0.0-x64.msi
```

---

## 9. Communication Protocol

### 9.1 Message Format

```typescript
// Base message structure
interface AgentMessage {
  type: string;
  id: string;          // Unique message ID
  timestamp: number;   // Unix timestamp
  signature?: string;  // HMAC-SHA256 signature
}

// Authentication
interface AuthMessage extends AgentMessage {
  type: 'auth';
  agent_id: string;
  api_key_prefix: string;  // "sk_abc123"
  signature: string;       // HMAC(agent_id + timestamp, api_secret)
}

interface AuthResponse extends AgentMessage {
  type: 'auth_ok' | 'auth_fail';
  session_token?: string;
  expires?: number;
  error?: string;
}

// Heartbeat
interface HeartbeatMessage extends AgentMessage {
  type: 'heartbeat';
  metrics: {
    cpu_percent: number;
    memory_percent: number;
    disk_percent: number;
    container_count: number;
    container_running: number;
  };
}

// Commands
interface CommandMessage extends AgentMessage {
  type: 'command';
  action: string;      // e.g., "docker:container:start"
  params: object;
  timeout?: number;    // ms
}

interface CommandResult extends AgentMessage {
  type: 'command_result';
  command_id: string;  // References CommandMessage.id
  success: boolean;
  data?: any;
  error?: string;
  duration: number;    // ms
}

// Streaming
interface StreamSubscribe extends AgentMessage {
  type: 'subscribe';
  channel: string;     // e.g., "container:abc123:logs"
}

interface StreamData extends AgentMessage {
  type: 'stream';
  channel: string;
  data: any;
}
```

### 9.2 Command Types

```yaml
# Docker Container Commands
docker:container:list:
  params: { all: boolean, filters: object }
  returns: Container[]

docker:container:inspect:
  params: { id: string }
  returns: ContainerInspect

docker:container:create:
  params: { image: string, name?: string, config: ContainerConfig }
  returns: { id: string }

docker:container:start:
  params: { id: string }
  returns: { success: boolean }

docker:container:stop:
  params: { id: string, timeout?: number }
  returns: { success: boolean }

docker:container:restart:
  params: { id: string, timeout?: number }
  returns: { success: boolean }

docker:container:remove:
  params: { id: string, force?: boolean, volumes?: boolean }
  returns: { success: boolean }

docker:container:logs:
  params: { id: string, tail?: number, since?: string, follow?: boolean }
  returns: Stream<string>

docker:container:stats:
  params: { id: string, stream?: boolean }
  returns: ContainerStats | Stream<ContainerStats>

docker:container:exec:
  params: { id: string, cmd: string[], tty?: boolean }
  returns: { exit_code: number, output: string }

# Docker Image Commands
docker:image:list:
  params: { filters?: object }
  returns: Image[]

docker:image:pull:
  params: { image: string, tag?: string }
  returns: Stream<PullProgress>

docker:image:remove:
  params: { id: string, force?: boolean }
  returns: { success: boolean }

# Docker Compose Commands
docker:compose:list:
  params: { }
  returns: ComposeStack[]

docker:compose:up:
  params: { project_name: string, compose_file: string, services?: string[] }
  returns: Stream<ComposeProgress>

docker:compose:down:
  params: { project_name: string, volumes?: boolean }
  returns: { success: boolean }

# System Commands
system:metrics:
  params: { }
  returns: SystemMetrics

system:info:
  params: { }
  returns: SystemInfo

system:processes:
  params: { }
  returns: Process[]

system:exec:  # Requires explicit permission
  params: { command: string, args?: string[], timeout?: number }
  returns: { exit_code: number, stdout: string, stderr: string }
```

---

## 10. Feature Breakdown

### 10.1 Core Features (MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| Agent Registration | Register agents with tokens | P0 |
| Agent Authentication | Secure API key auth | P0 |
| WebSocket Gateway | Handle agent connections | P0 |
| Server CRUD | Create, list, update, delete servers | P0 |
| Basic Metrics | CPU, RAM, disk from agents | P0 |
| Container List | List containers on remote servers | P0 |
| Container Actions | Start/stop/restart containers | P0 |
| Server Status | Online/offline detection | P0 |

### 10.2 Extended Features (v1.1)

| Feature | Description | Priority |
|---------|-------------|----------|
| Server Groups | Organize servers into groups | P1 |
| Tags & Filtering | Tag-based server filtering | P1 |
| Container Logs | Stream container logs | P1 |
| Image Management | Pull, list, remove images | P1 |
| Docker Compose | Deploy compose stacks | P1 |
| Historical Metrics | Store and view metrics history | P1 |
| Alerts | Server/container alerts | P1 |

### 10.3 Advanced Features (v1.2+)

| Feature | Description | Priority |
|---------|-------------|----------|
| Cross-server Metrics | Compare metrics across servers | P2 |
| Remote Terminal | SSH-like terminal via agent | P2 |
| File Manager | Browse files on remote servers | P2 |
| Deployment Sync | Deploy to multiple servers | P2 |
| Load Balancing | Distribute apps across servers | P2 |
| Auto-scaling | Scale containers based on metrics | P3 |
| Kubernetes Support | Optional K8s cluster management | P3 |

---

## 11. Phase Implementation Plan

### Phase 10.1: Foundation (Agent Core) ✅ COMPLETED
**Duration: ~2-3 weeks**

```
[x] Design and implement Go agent binary
    [x] Project setup with Go modules
    [x] Configuration loading (YAML)
    [x] Logging system (structured logs)
    [x] WebSocket client with reconnection
    [x] HMAC authentication
    [x] Heartbeat mechanism
    [x] Graceful shutdown handling

[x] Docker integration in agent
    [x] Connect to Docker socket
    [x] Container list/inspect
    [x] Container start/stop/restart
    [x] Basic stats collection

[x] Build pipeline
    [x] Cross-compilation for all platforms (GitHub Actions)
    [x] Version embedding
    [ ] Binary signing (optional - future)
```

### Phase 10.2: Backend Gateway ✅ COMPLETED
**Duration: ~2 weeks**

```
[x] Database models
    [x] Server, ServerGroup models
    [x] ServerMetrics, ServerCommand models
    [x] AgentSession model
    [x] Migrations (auto via SQLAlchemy)

[x] Agent Gateway (WebSocket server)
    [x] SocketIO namespace for agents (/agent)
    [x] Authentication handler
    [x] Session management
    [x] Command routing
    [x] Connection tracking

[x] API endpoints
    [x] Server CRUD
    [x] Registration token generation
    [x] Server status endpoint
    [x] Remote Docker endpoints (50+ routes)
```

### Phase 10.3: Security Layer ✅ COMPLETED
**Duration: ~1-2 weeks**

```
[x] Security implementation
    [x] API key generation and hashing (bcrypt)
    [x] HMAC-SHA256 signature validation
    [x] Session token management
    [x] Permission checking (scope-based)
    [ ] Rate limiting per agent (future)
    [x] Audit logging (ServerCommand model)

[x] Agent security
    [x] Encrypted key storage (AES-256-GCM)
    [x] Command validation
    [x] Permission enforcement
```

### Phase 10.4: Frontend - Server Management ✅ COMPLETED
**Duration: ~2 weeks**

```
[x] Servers page
    [x] Server list view (grid with cards)
    [x] Server cards with live metrics
    [x] Add server modal with permissions
    [x] Installation instructions (Linux/Windows)
    [x] Server detail page (tabbed interface)
    [x] Server settings

[x] Server groups
    [x] Group CRUD UI (modal)
    [x] Group filtering
    [ ] Drag-drop organization (future)
```

### Phase 10.5: Remote Docker Integration ✅ COMPLETED
**Duration: ~2 weeks**

```
[x] Backend: Docker command routing
    [x] Route Docker commands to agents (RemoteDockerService)
    [x] Handle async responses (command results)
    [x] Error handling

[x] Frontend: Docker page updates
    [x] Server selector dropdown (top of page)
    [x] Context-aware Docker UI (ServerContext)
    [x] Real-time container updates

[x] Agent: Full Docker support
    [x] All container operations
    [x] Image operations
    [x] Volume/network listing
```

### Phase 10.6: Monitoring & Metrics 🔄 IN PROGRESS
**Duration: ~2 weeks**

```
[x] Real-time metrics
    [x] Agent metrics streaming (heartbeat)
    [x] WebSocket to frontend (SocketIO)
    [x] Live dashboard updates

[ ] Historical metrics
    [x] Metrics storage (ServerMetrics model)
    [ ] Retention policies
    [ ] Aggregation queries

[x] Cross-server dashboard
    [x] Overview page (Servers.jsx)
    [x] Metric comparison (server cards)
    [x] Health grid view
```

### Phase 10.7: Installation & Distribution ✅ MOSTLY COMPLETE
**Duration: ~1-2 weeks**

```
[x] Build automation
    [x] GitHub Actions workflow (agent-release.yml)
    [x] Linux amd64/arm64 builds
    [x] Windows amd64 builds
    [x] Automatic releases on tag

[x] Installation scripts
    [x] Linux install script (bash) - created
    [x] Windows install script (PowerShell) - created
    [x] Installation endpoint in backend
    [ ] Docker image

[ ] Package building
    [ ] .deb packages
    [ ] .rpm packages
    [ ] .msi installer
    [ ] Homebrew formula

[x] Auto-update system
    [x] Version checking endpoint
    [x] Auto-update mechanism in agent
    [x] Manual update command (`serverkit-agent update`)

[x] Distribution
    [x] Download page in UI
```

### Phase 10.8: Advanced Features
**Duration: ~3-4 weeks**

```
[ ] Docker Compose on remote servers
    [ ] Stack deployment
    [ ] Stack management
    [ ] Compose file editor

[x] Container logs streaming
    [x] Real-time log streaming via agent
    [x] Backend endpoint for remote logs
    [x] Frontend integration with server context
    [ ] Log search/filter (future)
    [ ] Download logs (future)

[ ] Remote terminal (optional)
    [ ] PTY support in agent
    [ ] Terminal UI component
    [ ] Session management
```

---

## 12. Risk Assessment

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| WebSocket scalability | High | Medium | Use Redis pub/sub for horizontal scaling |
| Agent memory leaks | Medium | Low | Extensive testing, memory profiling |
| Network latency | Medium | Medium | Async commands, timeouts, retry logic |
| Docker API changes | Low | Low | Pin Docker SDK version, integration tests |

### Security Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Stolen API keys | Critical | Medium | Key rotation, IP whitelist, anomaly detection |
| Man-in-the-middle | Critical | Low | TLS mandatory, certificate pinning option |
| Agent compromise | Critical | Low | Sandboxing, minimal privileges, audit logs |
| Replay attacks | High | Medium | Timestamps, nonces, short-lived tokens |

### Operational Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Mass disconnect | High | Low | Graceful degradation, cached state |
| Database growth | Medium | High | Metrics retention policy, archiving |
| Support burden | Medium | High | Good documentation, self-service tools |

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Agent installation time | < 5 minutes |
| Agent memory usage | < 50 MB |
| Command latency | < 500ms (local network) |
| Max servers per instance | 100+ |
| Uptime | 99.9% |
| User satisfaction | > 4.5/5 rating |

---

## 14. Future Considerations

### Potential Extensions
- **Kubernetes Support**: Manage K8s clusters alongside Docker
- **Multi-tenancy**: Multiple users/teams managing different server sets
- **Terraform Integration**: Infrastructure as Code support
- **Ansible Playbooks**: Configuration management
- **CI/CD Integration**: Deploy from GitHub Actions, GitLab CI
- **Mobile App**: Monitor servers from mobile devices
- **Slack/Teams Bot**: Manage servers via chat commands

### Not In Scope (for now)
- Bare metal provisioning
- Cloud provider integration (AWS, GCP, Azure)
- Network topology management
- DNS management
- Load balancer configuration

---

## Appendix A: Agent Command Reference

```
serverkit-agent [command] [flags]

Commands:
  start           Start the agent service
  stop            Stop the agent service
  status          Show agent status
  register        Register with ServerKit (interactive)
  config          Show/edit configuration
  logs            View agent logs
  version         Show version information
  update          Check for and install updates
  uninstall       Remove agent from system

Flags:
  --config, -c    Path to config file
  --debug, -d     Enable debug logging
  --token, -t     Registration token (for register command)
  --server, -s    ServerKit URL (for register command)

Examples:
  serverkit-agent register --token "sk_reg_abc123" --server "https://serverkit.example.com"
  serverkit-agent status
  serverkit-agent logs --tail 100
```

---

## Appendix B: Configuration Reference

```yaml
# Full agent configuration reference
# Location: /etc/serverkit-agent/config.yaml (Linux)
#           C:\ProgramData\ServerKit\Agent\config.yaml (Windows)

# ServerKit connection
server:
  url: wss://your-serverkit.example.com/agent/ws
  reconnect_interval: 5s
  max_reconnect_interval: 5m
  ping_interval: 30s

# Agent identity
agent:
  id: "auto-generated-uuid"
  name: "server-display-name"

# Authentication (auto-generated)
auth:
  key_file: /etc/serverkit-agent/agent.key

# Feature toggles
features:
  docker: true
  metrics: true
  logs: true
  file_access: false
  exec: false

# Metrics collection
metrics:
  enabled: true
  interval: 10s
  include_per_cpu: true
  include_docker_stats: true

# Docker configuration
docker:
  socket: /var/run/docker.sock  # Linux
  # socket: npipe:////./pipe/docker_engine  # Windows
  timeout: 30s

# Security settings
security:
  allowed_paths: []
  blocked_commands: []
  max_exec_timeout: 300s

# Logging
logging:
  level: info  # debug, info, warn, error
  file: /var/log/serverkit-agent/agent.log
  max_size: 100MB
  max_backups: 5
  max_age: 30  # days
  compress: true
```

---

*This document is a living specification and will be updated as implementation progresses.*

**Document Version**: 1.0.0
**Last Updated**: 2026-01-21
**Author**: ServerKit Team
