# ServerKit: Explorations and Future Directions

> A deep dive into where ServerKit stands, where it should go, and practical next steps.
>
> *Written: January 2026*

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [WordPress Dev/Prod Environment Architecture](#wordpress-devprod-environment-architecture)
3. [Testing the Go Agent Locally](#testing-the-go-agent-locally)
4. [Future of ServerKit](#future-of-serverkit)
5. [Recommended Next Steps](#recommended-next-steps)

---

## Current State Assessment

### What ServerKit Has Achieved

ServerKit has matured into a **legitimate self-hosted server control panel** with impressive breadth:

| Area | Maturity | Notes |
|------|----------|-------|
| **Multi-Server Agents** | Production-Ready | Go agent with WSS, HMAC auth, cross-platform builds |
| **Docker Management** | Complete | Full container lifecycle, compose support, logs streaming |
| **WordPress Support** | Good | WP-CLI, one-click install, security hardening |
| **Git Deployment** | Complete | Webhooks, rollback, zero-downtime deploys |
| **Security** | Strong | 2FA, encryption at rest, audit logging, ClamAV |
| **Monitoring** | Good | Real-time metrics, alerts, webhooks |
| **Multi-Environment** | Partial | UI exists, but workflow needs refinement |

### What's Missing for Real-World Usage

1. **Backup & Restore** - Critical gap. No automated backups = risky for production.
2. **Database Sync/Clone** - For dev/prod workflows, you need this.
3. **Team Permissions** - Single-user limits commercial viability.
4. **Agent Stress Testing** - No evidence of load testing at scale.

---

## WordPress Dev/Prod Environment Architecture

### The Vision

You want to explore:
- **Dev and Prod WordPress instances**
- **Synced from GitHub**
- **Sharing the same DB (or a mini version of prod DB)**

This is a real-world workflow that ServerKit should excel at. Let me break down the options:

### Option A: Shared Database (Live Sync)

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Repository                       │
│              (wp-content/themes, wp-content/plugins)         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │   DEV Server    │             │   PROD Server   │
    │   (Agent #1)    │             │   (Agent #2)    │
    │                 │             │                 │
    │  ┌───────────┐  │             │  ┌───────────┐  │
    │  │ WordPress │  │             │  │ WordPress │  │
    │  │   (Dev)   │  │             │  │   (Prod)  │  │
    │  └─────┬─────┘  │             │  └─────┬─────┘  │
    └────────┼────────┘             └────────┼────────┘
             │                               │
             └───────────┬───────────────────┘
                         ▼
              ┌─────────────────┐
              │  Shared MySQL   │
              │  (Prod Server)  │
              │                 │
              │  wp_* tables    │
              └─────────────────┘
```

**Pros:**
- Real-time content sync
- No data drift between environments
- Simple conceptually

**Cons:**
- **Dangerous** - Dev changes affect prod data
- URL serialization issues in WordPress (siteurl, home options)
- Not recommended for real workflows

**Verdict:** Avoid this pattern. WordPress stores serialized URLs in the database, making true DB sharing problematic.

### Option B: Mini Prod Database (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Repository                       │
│              (wp-content/themes, wp-content/plugins)         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │   DEV Server    │             │   PROD Server   │
    │   (Agent #1)    │             │   (Agent #2)    │
    │                 │             │                 │
    │  ┌───────────┐  │             │  ┌───────────┐  │
    │  │ WordPress │  │             │  │ WordPress │  │
    │  │   (Dev)   │  │             │  │   (Prod)  │  │
    │  └─────┬─────┘  │             │  └─────┬─────┘  │
    │        │        │             │        │        │
    │  ┌─────┴─────┐  │             │  ┌─────┴─────┐  │
    │  │  MySQL    │  │◄────────────│  │  MySQL    │  │
    │  │  (Clone)  │  │   Nightly   │  │  (Prod)   │  │
    │  └───────────┘  │    Sync     │  └───────────┘  │
    └─────────────────┘             └─────────────────┘
```

**How It Works:**

1. **Prod runs normally** with live database
2. **Nightly job** creates a mysqldump of prod
3. **Sanitize the dump:**
   - Run search-replace for URLs (`prod.example.com` → `dev.example.com`)
   - Optionally anonymize user data
   - Truncate large tables (logs, analytics)
4. **Import to dev** database
5. **Dev has fresh, realistic data** without affecting prod

**Implementation in ServerKit:**

This requires a new feature: **Database Sync Jobs**

```python
# Proposed: backend/app/services/db_sync_service.py

class DatabaseSyncService:
    def create_sync_job(self, source_app_id, target_app_id, options):
        """
        Create a scheduled database sync from source to target.

        Options:
            - schedule: cron expression
            - search_replace: dict of find/replace patterns
            - anonymize: bool - anonymize user emails/names
            - exclude_tables: list of tables to skip
            - truncate_tables: list of tables to empty
        """
        pass

    def run_sync(self, job_id):
        """Execute a database sync job."""
        # 1. Dump source database
        # 2. Apply transformations
        # 3. Import to target
        # 4. Run wp search-replace if WordPress
        pass
```

### Option C: Read Replica (Advanced)

```
    ┌─────────────────┐             ┌─────────────────┐
    │   DEV Server    │             │   PROD Server   │
    │                 │             │                 │
    │  ┌───────────┐  │             │  ┌───────────┐  │
    │  │ WordPress │  │             │  │ WordPress │  │
    │  └─────┬─────┘  │             │  └─────┬─────┘  │
    │        │        │             │        │        │
    │  ┌─────┴─────┐  │             │  ┌─────┴─────┐  │
    │  │  MySQL    │  │             │  │  MySQL    │  │
    │  │ (Replica) │◄─┼─────────────┼──│ (Primary) │  │
    │  └───────────┘  │  Binlog     │  └───────────┘  │
    └─────────────────┘  Replication └─────────────────┘
```

**Pros:**
- Near real-time sync (seconds)
- Dev sees exactly what prod sees

**Cons:**
- Read-only dev database
- Complex to set up cross-server
- Still has URL serialization issues

**Verdict:** Overkill for WordPress. Better for read-heavy APIs.

### Recommended Architecture: GitHub-Driven Dev/Prod

Here's what I'd actually build:

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Repository                       │
│                                                             │
│  ├── wp-content/                                            │
│  │   ├── themes/my-theme/                                   │
│  │   └── plugins/my-plugin/                                 │
│  ├── .github/workflows/                                     │
│  │   ├── deploy-dev.yml      # On push to develop branch    │
│  │   └── deploy-prod.yml     # On push to main branch       │
│  └── serverkit.yaml          # Environment config           │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         │                                         │
         │ push to develop          push to main   │
         ▼                                         ▼
┌─────────────────┐                     ┌─────────────────┐
│  ServerKit API  │                     │  ServerKit API  │
│   (Webhook)     │                     │   (Webhook)     │
└────────┬────────┘                     └────────┬────────┘
         │                                       │
         ▼                                       ▼
┌─────────────────┐                     ┌─────────────────┐
│   DEV Server    │                     │   PROD Server   │
│                 │                     │                 │
│  WordPress      │                     │  WordPress      │
│  dev.site.com   │                     │  www.site.com   │
│                 │                     │                 │
│  MySQL (local)  │◄────── Weekly ──────│  MySQL (local)  │
│  Sanitized copy │        Sync         │  Live data      │
└─────────────────┘                     └─────────────────┘
```

**The Workflow:**

1. **Developer pushes to `develop` branch**
2. **GitHub Action** calls ServerKit webhook
3. **ServerKit pulls code** on dev server
4. **Runs `wp theme activate`, `wp plugin activate`** as needed
5. **Developer tests on dev.site.com**
6. **When ready, merge PR to `main`**
7. **Same process for production**

**Weekly Database Sync:**

```yaml
# serverkit.yaml in repo root
environments:
  dev:
    server: dev-server-id
    app: wordpress-dev-id
    domain: dev.site.com
    db_sync:
      source: prod
      schedule: "0 3 * * 0"  # Sunday 3 AM
      search_replace:
        - ["https://www.site.com", "https://dev.site.com"]
      anonymize_users: true
      truncate_tables:
        - wp_statistics_*
        - wp_actionscheduler_*

  prod:
    server: prod-server-id
    app: wordpress-prod-id
    domain: www.site.com
```

### What ServerKit Needs to Support This

| Feature | Current Status | Priority |
|---------|---------------|----------|
| Git webhook deployments | ✅ Done | - |
| Multi-environment app linking | ✅ Done | - |
| Database dump/export | ❌ Missing | **High** |
| Database import with transformations | ❌ Missing | **High** |
| WP-CLI search-replace integration | ⚠️ Partial | Medium |
| Scheduled sync jobs | ❌ Missing | Medium |
| Cross-server database operations | ❌ Missing | Medium |

---

## Testing the Go Agent Locally

### Your Goal

Test the ServerKit Go agent on your Windows PC to understand:
- How it connects to the control plane
- How commands flow through
- What happens with Docker operations
- Whether it's stable

### Setting Up the Test Environment

#### Prerequisites

1. **Go 1.21+** installed
2. **Docker Desktop** running (for Docker commands)
3. **ServerKit backend** running (localhost or remote)

#### Step 1: Build the Agent

```powershell
# Navigate to agent directory
cd C:\Users\Juan\Documents\GitHub\ServerKit\agent

# Build for Windows
go build -o serverkit-agent.exe ./cmd/agent

# Or use the Makefile (if you have make installed)
make build-windows
```

#### Step 2: Create Test Configuration

Create `agent-config.yaml` in the agent directory:

```yaml
# agent-config.yaml
server_url: "ws://localhost:5000"  # Your ServerKit backend
# server_url: "wss://serverkit.yourdomain.com"  # For production

# Leave empty - will be populated on first registration
api_key: ""
api_secret: ""

# Logging
log_level: "debug"
log_file: "agent.log"

# Heartbeat interval (seconds)
heartbeat_interval: 30

# Enable Docker integration
docker_enabled: true
docker_socket: "npipe:////./pipe/docker_engine"  # Windows Docker socket
```

#### Step 3: Register the Agent

First, create a server in ServerKit UI to get a registration token, then:

```powershell
# Register with the control plane
.\serverkit-agent.exe register --token YOUR_REGISTRATION_TOKEN

# This will:
# 1. Connect to ServerKit backend
# 2. Exchange token for API credentials
# 3. Save credentials to config file
# 4. Print success message
```

#### Step 4: Run the Agent

```powershell
# Run in foreground (for testing)
.\serverkit-agent.exe run --config agent-config.yaml

# You should see:
# [INFO] Connecting to ws://localhost:5000/agent
# [INFO] Authenticated successfully
# [INFO] Starting heartbeat loop (30s interval)
# [DEBUG] Sending heartbeat with metrics...
```

### Testing Agent Functionality

#### Test 1: Verify Connection

In ServerKit UI:
- Go to Servers page
- Your test server should show as "Online"
- Last seen should update every 30 seconds

#### Test 2: Docker Commands

If Docker Desktop is running:

```powershell
# In ServerKit UI, try:
# - View containers
# - Start/stop a container
# - View container logs

# Agent logs should show:
# [DEBUG] Received command: docker:container:list
# [DEBUG] Executing Docker command...
# [DEBUG] Sending response with 5 containers
```

#### Test 3: System Metrics

Check Monitoring page in ServerKit:
- CPU usage should show Windows Task Manager equivalent
- Memory should match your system
- Disk usage for C: drive

#### Test 4: Terminal Access

Try opening a terminal session to your test server:
- Should spawn PowerShell on Windows
- Commands should execute
- Output should stream back

### Common Issues and Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Connection refused" | Backend not running | Start Flask backend |
| "Docker not available" | Docker Desktop not running | Start Docker Desktop |
| "Authentication failed" | Invalid/expired token | Re-register agent |
| "TLS handshake error" | Self-signed cert | Use `ws://` for local testing |
| Metrics not updating | Heartbeat blocked | Check firewall rules |

### Agent Architecture Deep Dive

```
┌─────────────────────────────────────────────────────────────┐
│                    ServerKit Go Agent                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐              │
│  │  Config   │  │  Logger   │  │   Auth    │              │
│  │  Manager  │  │ (Zerolog) │  │  (HMAC)   │              │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘              │
│        │              │              │                      │
│        └──────────────┼──────────────┘                      │
│                       │                                      │
│  ┌────────────────────┴────────────────────┐               │
│  │           WebSocket Client               │               │
│  │     (gorilla/websocket + reconnect)      │               │
│  └────────────────────┬────────────────────┘               │
│                       │                                      │
│        ┌──────────────┼──────────────┐                      │
│        │              │              │                      │
│        ▼              ▼              ▼                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐              │
│  │  Docker   │  │  Metrics  │  │ Terminal  │              │
│  │  Handler  │  │ Collector │  │   PTY     │              │
│  │           │  │           │  │           │              │
│  │ - List    │  │ - CPU     │  │ - Spawn   │              │
│  │ - Start   │  │ - Memory  │  │ - Resize  │              │
│  │ - Stop    │  │ - Disk    │  │ - Input   │              │
│  │ - Logs    │  │ - Network │  │ - Output  │              │
│  │ - Stats   │  │           │  │           │              │
│  └───────────┘  └───────────┘  └───────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Agent Test Checklist

- [ ] Agent builds without errors
- [ ] Agent connects to backend
- [ ] Heartbeat appears in server list
- [ ] Metrics show in monitoring page
- [ ] Docker containers list correctly
- [ ] Container start/stop works
- [ ] Container logs stream
- [ ] Terminal opens and accepts input
- [ ] Agent survives backend restart (reconnect)
- [ ] Agent handles network interruption gracefully

---

## Future of ServerKit

### My Honest Assessment

ServerKit has grown from a simple control panel into something with real architectural depth. The Go agent is a significant investment that positions it for multi-server, enterprise-like features. But there are strategic decisions ahead.

### Where ServerKit Sits in the Market

```
                    Complexity
                        ▲
                        │
         Kubernetes ────┼──────────────● CloudPanel
           Nomad        │              ● Coolify
                        │         ● ServerKit (today)
                        │    ● Dokku
                        │ ● CapRover
         ────────────────────────────────────────► Features
                        │
              Portainer ●
                        │
          Cockpit ●     │
                        │
```

**Current Position:** ServerKit is between CapRover/Dokku (simple) and CloudPanel/Coolify (feature-rich).

**Opportunity:** The multi-server Go agent puts ServerKit closer to what teams actually need for real production workloads.

### Three Possible Futures

#### Future A: WordPress Hosting Platform

**Focus:** Become the best self-hosted WordPress management platform.

**What to build:**
- Staging/production sync (database cloning)
- WordPress-specific monitoring (slow queries, plugin conflicts)
- One-click backup to S3/Backblaze
- Malware scanning with auto-remediation
- WordPress multisite support
- WP-CLI exposed as API

**Target users:** WordPress agencies, freelancers with multiple client sites

**Competitors:** GridPane, SpinupWP, RunCloud

**My take:** This is a viable niche. WordPress agencies pay well for good tooling. But it limits ServerKit's appeal.

#### Future B: Mini-Kubernetes Alternative

**Focus:** Multi-server orchestration without Kubernetes complexity.

**What to build:**
- Service mesh between agents (internal DNS)
- Load balancing across servers
- Container scheduling (deploy to least-loaded server)
- Cross-server networking
- Secrets management (Vault-like)
- Log aggregation (ship logs to central location)

**Target users:** Small-medium teams who outgrew single servers but don't want Kubernetes

**Competitors:** Nomad, Docker Swarm (dead), Coolify

**My take:** This is the more ambitious path. The Go agent is already 70% of what's needed. The question is whether you want to compete at this level.

#### Future C: Developer-First Homelab Manager

**Focus:** Self-hosting for developers who want to own their infrastructure.

**What to build:**
- One-click apps (like Umbrel, CasaOS)
- Personal cloud features (Nextcloud, Vaultwarden integration)
- Tunnel support (Cloudflare Tunnel, Tailscale)
- Mobile-friendly dashboard
- Simple DNS management
- Local SSL with mkcert/step-ca

**Target users:** Developers, homelabbers, privacy-conscious users

**Competitors:** Umbrel, CasaOS, Tipi

**My take:** Growing market, but harder to monetize. Good for adoption, hard for revenue.

### My Recommendation: Hybrid Approach

Don't pick one future. Build the **foundation** that supports all three:

```
                    ┌─────────────────────────────────┐
                    │     User-Facing Products        │
                    ├─────────┬───────────┬───────────┤
                    │WordPress│ App       │ Homelab   │
                    │Platform │ Platform  │ Suite     │
                    ├─────────┴───────────┴───────────┤
                    │     ServerKit Core Platform     │
                    │                                 │
                    │  ┌─────┐ ┌─────┐ ┌───────────┐ │
                    │  │Agents│ │Apps │ │ Templates │ │
                    │  └─────┘ └─────┘ └───────────┘ │
                    │  ┌─────┐ ┌─────┐ ┌───────────┐ │
                    │  │ DB  │ │ SSL │ │ Webhooks  │ │
                    │  └─────┘ └─────┘ └───────────┘ │
                    └─────────────────────────────────┘
```

**Core investments that pay off in all futures:**

1. **Backup & Restore** - Everyone needs this
2. **Database Sync** - Dev/prod workflows are universal
3. **API Stability** - Third-party integrations
4. **Agent Reliability** - More agents = more value
5. **Plugin/Extension System** - Let community build

### Roadmap Recommendation

#### Q1 2026: Foundation (Now)

| Priority | Feature | Why |
|----------|---------|-----|
| **P0** | Backup & Restore | Can't run production without backups |
| **P0** | Database sync/clone | Enables dev/prod workflows |
| **P1** | Agent stress testing | Prove multi-server works at scale |
| **P1** | WordPress staging sync | Popular request, differentiator |

#### Q2 2026: Scale

| Priority | Feature | Why |
|----------|---------|-----|
| **P0** | Team/user management | Required for teams |
| **P1** | Role-based permissions | Security requirement |
| **P1** | Cross-server log aggregation | Ops visibility |
| **P2** | Agent auto-update (production-grade) | Reduce maintenance burden |

#### Q3 2026: Ecosystem

| Priority | Feature | Why |
|----------|---------|-----|
| **P1** | Plugin/extension system | Community growth |
| **P1** | API v2 (stable, versioned) | Third-party integrations |
| **P2** | Template marketplace | Discoverability |
| **P2** | Tunnel support (Cloudflare/Tailscale) | Homelab market |

#### Q4 2026: Differentiation

Choose a direction based on traction:
- If WordPress is hot → WordPress-specific features
- If multi-server is hot → Orchestration features
- If homelab is hot → Personal cloud features

---

## Recommended Next Steps

### Immediate (This Week)

1. **Build and test the Go agent locally**
   - Follow the steps in Section 3
   - Document any issues you find
   - Test Docker commands specifically

2. **Prototype database sync**
   - Manual mysqldump → transform → import
   - Use WP-CLI for search-replace
   - Prove the workflow works before automating

3. **Set up a real dev/prod WordPress pair**
   - Two Docker instances on same machine
   - Different ports, different databases
   - Test the GitHub webhook flow

### Short-term (This Month)

4. **Design the Database Sync feature**
   - UI mockups
   - API design
   - Agent-side implementation

5. **Backup & Restore MVP**
   - Even if manual (cron + mysqldump + rsync)
   - Restore must actually work

### Medium-term (This Quarter)

6. **Agent reliability improvements**
   - Reconnection logic stress testing
   - Memory leak detection
   - Long-running connection stability

7. **Documentation**
   - Agent installation guide
   - Multi-server setup tutorial
   - WordPress dev/prod workflow guide

---

## Final Thoughts

ServerKit has the bones of something really useful. The Go agent is the right architectural choice for multi-server. The template system is flexible. The security features are more thorough than most open-source panels.

The risk is feature sprawl - trying to be everything to everyone. The WordPress dev/prod workflow you want to explore is exactly the kind of **focused, real-world problem** that differentiates ServerKit from generic panels.

Build for your own use case first. If you need WordPress staging with database sync, build that. You'll end up with something opinionated and useful rather than generic and forgettable.

The market doesn't need another cPanel clone. It needs tools built by people who actually deploy and manage servers.

---

*This document represents my analysis based on exploring the ServerKit codebase. These are recommendations, not requirements. Adjust based on your priorities and user feedback.*
