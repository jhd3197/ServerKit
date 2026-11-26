# ServerKit Roadmap

> **Status: core phases complete — actively developed.** All original core phases below have shipped. Development now focuses on three tracks: the **deployment experience** (a live deploy console with streaming logs), the **extension platform** (runtime loading, signed releases, standalone extension repos), and **new capability areas delivered as installable extensions** through the built-in Marketplace — plus stability fixes and UI/UX polish from community reports. See **Active Development** below for what's in flight; the phase list is kept as the historical record of how the core was built out.

This document outlines the development roadmap for ServerKit. Features are organized by phases and priority.

---

## Current Version: v1.7.x (In Development)

### Recently Completed (v1.7.x)

- **See Where an App Is Slow** - Every site nginx serves now logs how long each request took, what the upstream took and whether the cache answered, and the panel rolls that up per app: requests, 4xx/5xx, p50/p95/p99 latency and cache hit ratio on the app's Overview, kept for two days by the minute and a month by the hour. A rule-based check reads those numbers together with the app's and its database's CPU and names the likely bottleneck (a busy app over an idle database, one query dominating a busy database, errors during deploys, a cache that misses), with the fix and that fix's failure mode, and never adds anything on its own. Apps whose containers keep crashing and restarting are flagged with an incident instead of looking "running" between crashes, and each database container gets an Insights tab with its top queries, connections in use and buffer-cache hit ratio.
- **Faster Sites Without New Moving Parts** - Responses are compressed (gzip, and brotli where the nginx build has it) for every site; the snippet only adds what your nginx.conf doesn't already set, because a repeated directive stops nginx from loading. The page cache became a real one: each site sets its own lifetime, visitors get the last good page while the app errors or refreshes, a stampede of misses reaches the app as one request, and clearing it clears that site only. Proxied sites can long-cache fingerprinted assets such as `app.3f9a2c1d.js`, and the Cloudflare extension adds Cache Rules presets and an opt-in purge of an app's hostnames after every deploy.
- **Attach a Cache, a Bucket, a Queue or Tracing** - Installing Redis and having an app use Redis used to be two unrelated things. From an app's Overview you now attach a cache, object storage, a queue or tracing: ServerKit reuses an installed service or installs one, writes the connection settings the app's libraries expect (`REDIS_URL`, the `S3_*` and `AWS_*` set, `AMQP_URL`, the standard OpenTelemetry variables), and puts both on a private service network. Storage gives each app its own bucket with a key that can only reach it; the secret stays in the vault. Object storage is now Garage, because MinIO stopped publishing images, and RabbitMQ and an OpenTelemetry Collector join the catalog. Grafana gets Prometheus and Loki as data sources, plus a dashboard of your servers, by attaching them, and an installed Prometheus scrapes the panel with a token the panel issues itself. PostgreSQL can run PgBouncer beside it for apps that opt into the pooled URL, and build-pack apps run their Procfile `worker:` and `scheduler:` lines next to the web process.

- **Managed Databases Join the Recycle Bin** - Deleting a managed database no longer destroys it on the spot. Like applications before it, a deleted database now lands in the Recycle Bin with its content and backup policy intact and restorable; only an explicit purge (or asking for the data to be dropped at delete time) is destructive. The distinction that matters: delete keeps your data, purge is the irreversible step, and the UI says which one you are about to do.
- **One Error Shape, With a Request ID You Can Quote** - Every API error now comes back in one consistent JSON envelope carrying a request correlation id, so "it failed" in a bug report can be matched to the exact request in the panel's error monitor. Behind that, crashes a route used to catch and quietly convert into a vague 200 or a bare 500 — the PR-webhook receiver, the job queue bus, and several others — are now recorded in the error monitor every time, with tests pinning that a swallowed crash is a bug, not a behavior.
- **Live Streams and Polling That Behave** - Panel pages pause their background polling when the tab is hidden and catch up the moment you return, so an idle dashboard tab stops costing server load and laptop battery. Live output (deploys today, more run kinds on the same rails next) streams through one event scheme with a shared room grammar, and the deploy console keeps working unchanged through the transition.
- **Remote-Access Tunnels Reconcile on Every Transport** - Tunnel reconciliation used to fire only for agents connected over WebSocket; an agent on the HTTP long-poll fallback missed it. Both transports now go through the same door, so a NAT'd box behind a strict proxy gets the same tunnel repair behavior as everyone else.
- **Credential Encryption Failures Are No Longer Silent** - A failure to encrypt stored server credentials used to keep the old value without telling anyone. It now surfaces as an error, so a misconfigured encryption key is something you find out about at save time, not at the next incident.
- **Run It Behind Your Own Reverse Proxy** - Already running Caddy, Traefik or Nginx Proxy Manager, with Let's Encrypt or a private CA of your own? That is now a supported, documented and tested way to run the panel rather than something you reverse-engineer from the install script. Two topologies are written up — keep ServerKit's nginx (full features, host install) or point your proxy straight at the panel (panel only, the Docker shape) — with proxy config snippets, the two environment variables that matter, and a symptom-to-cause table for the redirect loop, the rejected websocket and the wrong client IPs. A new installer switch sets a box up this way in one line, and an install-config file makes the whole thing re-runnable. Tests now pin the properties an external proxy depends on: the panel emits no redirect to HTTPS from any of its 352 routes, the public URL is honoured as a websocket origin while strangers are rejected, and HSTS stays off when TLS is somebody else's job.
- **Rate Limits and Audit Logs See the Real Visitor** - The panel is always served through its own nginx, so every request arrived carrying nginx's address rather than the visitor's — and the installer never turned on the setting that recovers the real one. Per-IP rate limiting, the login brute-force block and every audit-log entry were therefore keyed on a single local address, which quietly weakened all three: one abusive client shared a bucket with everyone else. New installs now enable it, and re-running the installer backfills it on existing ones without touching a value you set yourself. It deliberately stays off when the backend port is exposed directly, because a visitor who can reach it without passing through nginx can simply claim any address they like.
- **Installing With a Domain No Longer Breaks nginx** - Setting a panel domain at install time wrote a bare-IP redirect that declared itself a second default server on port 80 — something nginx refuses outright, in both HTTP and HTTPS modes, so nginx would not start and the installer had no `nginx -t` to say why. The redirect now matches a bare IP by name pattern instead of competing for the default, verified against real nginx, with a regression guard.
- **Docker Actually Runs the Panel** - `docker compose up -d` started nothing at all: every service had ended up behind an opt-in profile while the README and install guide still gave that command as the way to install with Docker. It now runs the real all-in-one panel on port 5000 with a persistent volume for the database. The image itself could not boot either — it wrote its database to a directory it never created — and the developer docs pointed at a compose file that has never existed. All corrected, with a guard so a profile change cannot silently empty the default command again.
- **Uptime Monitors** - Monitoring is no longer only about the machine the panel runs on. A monitor watches anything you point it at — a website, an API endpoint, a database port, a mail server or a managed WordPress site — with HTTP, keyword, port, ping, DNS and SMTP checks, per-monitor intervals, expected status ranges, redirect and TLS-verification switches, and a retry threshold before anything is declared down. A scheduler polls them continuously (previously checks only ran when someone pressed a button), outages open and close an incident on their own, and each monitor gets a detail page with a response-time chart, a 90-day uptime strip, a live check log and TLS certificate expiry. Host CPU/memory/disk alerting is unchanged and now shares one Incidents timeline with monitor outages, so "something is wrong" is a single place. Status pages publish monitors you already have rather than defining their own duplicate probes.
- **Monitoring Navigation** - Monitors, Incidents, Events and Jobs are tabs of one Monitoring group instead of scattered top-level pages, and the events stream was rebuilt on the same search-and-filter layout as the rest of the panel.
- **Themes & Theme Studio** - A gallery of color themes in Settings → Appearance (Paper, Nord Deep, Gruvbox, Phosphor, High Contrast, and the stock look), applied instantly and previewed live, kept as each user's personal choice on top of the dark/light toggle. Themes are data, not code — a small map of color tokens — so a built-in Theme Studio lets anyone edit colors over the live panel and export a shareable file, admins can set a panel-wide default or import a theme, and a public community registry installs themes with one click.
- **Deploy Console & Live Run Logs** - Every install and deploy lands on one full-page live console: streaming build output, a step timeline with per-step durations and a live elapsed timer, and failure cards showing the real error tail with plain-language hints and one-click retry. Backed by a unified batched run-log layer (database persistence + WebSocket push with a polling fallback).
- **New Service Wizard & Template Catalog** - Three-step service creation (Source / Connect / Review) backed by a server-side template catalog with one-click compose templates and Git-repo templates.
- **Extensions Platform Maturation** - Marketplace registry backed by standalone extension repos (Kubernetes, Automations, Analytics, Mail, GPU, CrowdSec, DNS server, and more), with built-in features progressively extracted to keep the default panel lean. Installed extensions that ship a prebuilt bundle now render their UI on a production panel with no rebuild.
- **Privacy-First Web Analytics** - Cookieless, self-hosted analytics extension with WordPress and nginx integration and optional geo lookup.
- **Agent Fleet & Peering** - ServerKit-to-ServerKit peering (embedded agent mode), fleet doctor tooling, and agent capability upgrades.
- **Honest Extension Trust** - Installed extensions get a Permissions view showing what their manifest declared against what the panel has actually observed them do — including calls it refused. It is deliberately candid about its own limits: for capabilities the panel cannot mediate it says so outright rather than showing a reassuring zero, because an extension runs inside the panel process and no permission string changes that. The Python packages an extension shipped that the panel declined to install (they are opt-in, since pip runs with the backend's privileges) are now listed with the file itself and the exact setting to change, instead of being mentioned only in an install log nobody reads.
- **A Failed Deploy No Longer Takes the Site Down** - Redeploys used to stop the running version first and only then discover that the new one could not start: a broken compose file, an image that no longer pulls, or a port something else had taken left the site down until someone intervened. Every deploy path now proves the new version can run *before* anything live is stopped — the compose file is validated, images are built and pulled to completion, and host port conflicts are checked — and a failure aborts with the running deployment untouched and a log line saying so. On single-container apps the registry pull in particular used to happen *after* the old container was already removed, so a registry hiccup left the app with nothing running at all.
- **Fleet Health & Working Repair Buttons** - The health doctor now sweeps connected servers as well as the panel's own host, with per-server findings that offer the same one-click repairs, an offline server reported as offline rather than missing, and a daily fleet-wide sweep. The backup checks' repair buttons now actually work: a restore drill can be started from the doctor and tracked as a job, and an unverified backup can be verified in place or against its offsite copy, whichever it has.
- **Secure by Default on a Fresh Install** - A stock Debian/Ubuntu install now ends with a firewall instead of a warning: UFW is installed and enabled with default-deny inbound, allowing only the ports sshd actually answers on plus 80/443 and the panel's own port. The SSH port is discovered from the effective sshd config rather than assumed to be 22, and if it cannot be determined the installer refuses to enable anything rather than risk locking you out. fail2ban with an SSH jail moved from the "full" profile into the standard one, watching the same port. Setup Health gained firewall and brute-force-protection checks, surfaced on the dashboard, so a box that skipped either says so instead of looking fine.
- **Auth & Proxy Hardening** - Trusted reverse-proxy client-IP handling and per-IP login brute-force throttling.
- **Certificate & DNS Reliability** - Certificates stop failing for reasons the panel could see and didn't say. certbot is found wherever it is installed, including the snap location its own docs recommend, and requesting a certificate checks the nginx plugin first and names the missing package instead of passing certbot's internal confusion through. A stray AAAA record — the classic case where the IPv4 record is perfect and issuance still fails, because Let's Encrypt prefers IPv6 — is now detected and explained by both domain verification and the doctor. One Let's Encrypt contact address is remembered panel-wide rather than re-typed for every certificate, and the doctor catches an nginx that is running but serving a config it can no longer parse.
- **UI Polish** - Skeleton loading states, unified tab groups and segmented bars, drawer-based flows, modal-based env var management.

### Earlier (v1.5.0)

- **New UI & Services Page** - Integrated full Services page with detail views, metrics, logs, and shell.
- **Environment Pipeline** - Multi-environment management for WordPress (Prod/Staging/Dev) with promotion/sync.
- **Visual Infrastructure Designer** - Node-based visual canvas for stack deployment and server overview.
- **Advanced Monitoring UI** - Real-time log streaming and terminal integration in the dashboard.
- **Template Library Expansion** - Over 60+ one-click deployment templates (Immich, Authelia, Ghost, etc.).
- **Team & Permissions** - RBAC with admin/developer/viewer roles, invitations, audit logging
- **SSO & OAuth Login** - Google, GitHub, OIDC, SAML with account linking

---

## Phase 1: Core Infrastructure (Completed)

- [x] Flask backend with SQLAlchemy ORM
- [x] React frontend with Vite
- [x] JWT-based authentication
- [x] Real-time WebSocket updates
- [x] System metrics (CPU, RAM, disk, network)
- [x] Docker and Docker Compose support
- [x] SQLite/PostgreSQL database support

---

## Phase 2: Application Management (Completed)

- [x] PHP/WordPress application deployment
- [x] Python (Flask/Django) application support
- [x] Node.js application management with PM2
- [x] Docker container management
- [x] Environment variable management
- [x] Application start/stop/restart controls
- [x] Log viewing per application

---

## Phase 3: Domain & SSL Management (Completed)

- [x] Nginx virtual host management
- [x] Domain configuration interface
- [x] Let's Encrypt SSL integration
- [x] SSL certificate auto-renewal
- [x] Redirect management (HTTP → HTTPS)

---

## Phase 4: Database Management (Completed)

- [x] MySQL/MariaDB database support
- [x] PostgreSQL database support
- [x] Database creation/deletion
- [x] User management per database
- [x] Basic query interface

---

## Phase 5: File & FTP Management (Completed)

- [x] Web-based file manager
- [x] File upload/download
- [x] File editing with syntax highlighting
- [x] vsftpd FTP server integration
- [x] FTP user management

---

## Phase 6: Monitoring & Alerts (Completed)

- [x] Real-time system metrics
- [x] Server uptime tracking
- [x] Customizable alert thresholds
- [x] Discord webhook notifications
- [x] Slack webhook notifications
- [x] Telegram bot notifications
- [x] Generic webhook support
- [x] Alert history and logging

---

## Phase 7: Security Features (Completed)

- [x] Two-factor authentication (TOTP)
- [x] Backup codes for 2FA recovery
- [x] ClamAV malware scanning
- [x] Quick scan / Full scan options
- [x] File quarantine management
- [x] File integrity monitoring
- [x] Failed login detection
- [x] Security event logging

---

## Phase 8: Scheduled Tasks (Completed)

- [x] Cron job management
- [x] Visual cron expression builder
- [x] Job execution history
- [x] Enable/disable jobs

---

## Phase 9: Firewall Management (Completed - Merged into Security)

- [x] UFW firewall integration
- [x] Visual rule management
- [x] Common port presets
- [x] Rule enable/disable
- [x] Consolidated into Security page for unified security management

---

## Phase 10: Multi-Server Management (Completed)

**Priority: High**

- [x] Agent-based remote server monitoring (Go agent)
- [x] Centralized dashboard for multiple servers
- [x] Server grouping and tagging
- [x] Cross-server metrics comparison
- [x] Remote Docker management via agents
- [x] Server health overview
- [x] Agent WebSocket gateway
- [x] HMAC-SHA256 authentication
- [x] GitHub Actions for agent releases (Linux/Windows)
- [x] Installation scripts endpoint
- [x] Agent auto-update mechanism
- [x] Agent download page in UI
- [x] Container logs streaming for remote servers

---

## Phase 11: Git Deployment (Completed)

**Priority: High**

- [x] GitHub/GitLab webhook integration
- [x] Automatic deployment on push
- [x] Branch selection for deployment
- [x] Rollback to previous deployments
- [x] Deployment history and logs
- [x] Pre/post deployment scripts
- [x] Zero-downtime deployments: opt-in A/B slots boot the new release beside the live one, gate it on its health check, switch nginx over, and switch back on their own if it fails
- [x] Release commands and pre-deploy database snapshots run once, before the switch
- [x] Immutable image per deployment, so a rollback runs the image that actually ran

---

## Phase 12: Backup & Restore (Completed)

**Priority: High**

- [x] Automated database backups
- [x] File/directory backups
- [x] S3-compatible storage support
- [x] Backblaze B2 integration
- [x] Backup scheduling
- [x] One-click restore
- [x] Backup retention policies
- [x] Offsite backup verification

---

## Phase 13: Email Server Management (Completed)

**Priority: Medium**

- [x] Postfix mail server setup
- [x] Dovecot IMAP/POP3 configuration
- [x] Email account management
- [x] Spam filtering (SpamAssassin)
- [x] DKIM/SPF/DMARC configuration
- [x] Webmail interface integration
- [x] Email forwarding rules

---

## Phase 14: Visual Infrastructure Designer (Completed)

**Priority: High**

The visual canvas for designing and deploying entire infrastructure stacks.

- [x] Node-based Visual Canvas (`WorkflowBuilder.jsx`) using React Flow
- [x] Infrastructure component nodes (Docker, Database, Domain, Service)
- [x] Smart connection rules (link apps to DBs, domains to apps)
- [x] One-click stack deployment from the canvas
- [x] Template-based stack generation
- [x] Server overview mode (visualize existing infrastructure)

---

## Phase 15: Team & Permissions (Completed)

**Priority: Medium**

- [x] Multi-user support
- [x] Role-based access control (RBAC)
- [x] Custom permission sets
- [x] Audit logging per user
- [x] Team invitations
- [x] Activity dashboard

---

## Phase 16: API Enhancements (Completed)

**Priority: Medium**

- [x] API key management
- [x] Rate limiting
- [x] Webhook event subscriptions
- [x] OpenAPI/Swagger documentation
- [x] API usage analytics

---

## Phase 17: Advanced Security (Completed)

**Priority: High**

- [x] Unified Security page with all security features
- [x] Firewall tab with UFW/firewalld management
- [x] Fail2ban integration
- [x] SSH key management
- [x] IP allowlist/blocklist
- [x] Brute force protection
- [x] Security audit reports
- [x] Vulnerability scanning (Lynis)
- [x] Automatic security updates (unattended-upgrades/dnf-automatic)

---

## Phase 18: SSO & OAuth Login (Completed)

**Priority: High**

- [x] Google OAuth 2.0 login
- [x] GitHub OAuth login
- [x] Generic OpenID Connect (OIDC) provider support
- [x] SAML 2.0 support for enterprise environments
- [x] Social login UI (provider buttons on login page)
- [x] Account linking (connect OAuth identity to existing local account)
- [x] Auto-provisioning of new users on first SSO login
- [x] Configurable SSO settings (enable/disable providers, client ID/secret management)
- [x] Enforce SSO-only login (disable password auth for team members)
- [x] SSO session management and token refresh

---

## Phase 19: Database Migrations & Schema Versioning (Completed)

**Priority: High**

- [x] Flask-Migrate (Alembic) integration
- [x] Migration wizard UI (Completed)
- [x] CLI fallback support

---

## Phase 20: New UI & Services Page (Completed)

**Priority: Critical**

Integrated full Services page with detail views, metrics, logs, shell, settings, and package management.

- [x] Services list page with status indicators and quick actions
- [x] Service detail page with tabbed interface (Metrics, Logs, Shell, Settings, Commands, Events, Packages)
- [x] Git connect modal for linking services to repositories
- [x] Gunicorn management tab for Python services
- [x] Service type detection and type-specific UI (Node, Python, PHP, Docker, etc.)

---

## Phase 21: Environment Pipeline (Completed)

**Priority: High**

- [x] WordPress multi-environment pipeline (Prod/Staging/Dev)
- [x] Code and Database promotion between environments
- [x] Production syncing and environment locking

---

## Phase 22: Container Logs & Monitoring UI (Completed)

**Priority: High**

- [x] Real-time log streaming via WebSocket with ANSI color support
- [x] Web-based terminal (`Terminal.jsx`) with shell access
- [x] Per-app resource usage charts (CPU, RAM)
- [x] Log search and filtering

---

# Later Phases (Completed)

The phases below were the second wave of core development, ordered by priority at the time.
All have since shipped.

---

## Phase 23: Workflow & Automation Engine — Core (Completed)

**Priority: Critical**

Moving beyond static design to dynamic, event-driven automation. This turns ServerKit into a powerful automation hub.

- [x] **Visual Workflow Builder:** Node-based canvas with drag-and-drop nodes, connection validation, and config panels
- [x] **Cron Integration:** Schedule workflows to run on recurring intervals (e.g., "Every Sunday at 2 AM, backup all DBs and rotate logs")
- [x] **Manual Execution:** Trigger workflows on demand with optional context data
- [x] **Execution History:** Track workflow execution status, per-node results, and timestamped logs
- [x] **Script Nodes:** Custom Shell script execution nodes with output capture
- [x] **Notification Nodes:** Send alerts via configured notification channels
- [x] **One-Click Stack Deployment:** Deploy full infrastructure (databases, apps, domains) from a workflow diagram

---

## Phase 24: Customizable Sidebar & Dashboard Views (Completed)

**Priority: High**

Let users personalize what they see. Not everyone runs email servers or manages Docker — the sidebar should adapt to each user's needs.

- [x] Sidebar configuration page in Settings
- [x] Preset view profiles (Full, Web Hosting, Email Admin, Docker/DevOps, Minimal)
- [x] Custom view builder — toggle individual sidebar items on/off
- [x] Per-user preference storage (saved to user profile)

---

## Phase 25: Workflow Engine — Triggers & Completion (Completed)

**Priority: High**

Complete the workflow engine with proper execution logic, missing triggers, and production-grade reliability.

- [x] **DAG Execution:** Full directed acyclic graph traversal with parallel branch support (replace current linear BFS)
- [x] **Logic Node Evaluation:** If/Else condition evaluation with true/false branching
- [x] **Variable Interpolation:** Pass data between steps using `${node_id.field}` and `{{placeholder}}` syntax in node configs
- [x] **Webhook Triggers:** Register `/hooks/<webhook_id>` endpoint to fire workflows on incoming HTTP requests
- [x] **Event Triggers:** Run workflows on system events (health check failure, high CPU/memory, git push, app stopped)
- [x] **Notification Templating:** Message placeholder substitution (`${node_id.stdout}`, `{{workflow_name}}`) in notification nodes
- [x] **Execution Timeouts:** Configurable timeout per node (1–3600s) to prevent hung workflows
- [x] **Retry on Failure:** Configurable retry count (0–5) and delay per node
- [x] **Circular Dependency Detection:** Kahn's algorithm validates graph on save and before execution
- [x] **Script Sandboxing:** Timeout enforcement, output size limits, explicit `bash -c`/`python3 -c` execution

---

## Phase 26: Agent Fleet Management (Completed)

**Priority: High**

Level up agent management from "connect and monitor" to full fleet control.

- [x] Agent version tracking and compatibility matrix (panel version ↔ agent version)
- [x] Push agent upgrades from the panel (single server or fleet-wide rollout)
- [x] Staged rollout support — upgrade agents in batches with health checks between waves
- [x] Agent health dashboard — connection uptime, heartbeat latency, command success rate per agent
- [x] Auto-discovery of new servers on the local network (mDNS/broadcast scan)
- [x] Agent registration approval workflow (admin must approve before agent joins fleet)
- [x] Bulk agent operations — restart, upgrade, rotate keys across selected servers
- [x] Agent changelog and release notes visible in UI
- [x] Offline agent command queue — persist commands and deliver when agent reconnects
- [x] Command retry with configurable backoff for failed/timed-out operations
- [x] Agent connection diagnostics — test connectivity, latency, firewall check from panel

---

## Phase 27: Cross-Server Monitoring Dashboard (Completed)

**Priority: High**

Fleet-wide visibility — see everything at a glance and catch problems early.

- [x] Fleet overview dashboard — heatmap of all servers by CPU/memory/disk usage
- [x] Server comparison charts — overlay metrics from multiple servers on one graph
- [x] Per-server alert thresholds (CPU > 80% for 5 min → warning, > 95% → critical)
- [x] Anomaly detection — automatic baseline learning, alert on deviations
- [x] Custom metric dashboards — drag-and-drop widgets, save layouts per user
- [x] Metric correlation view — spot relationships between metrics across servers
- [x] Capacity forecasting — trend-based predictions (disk full in X days, memory growth rate)
- [x] Metrics export — Prometheus endpoint (`/metrics`), CSV download, JSON API
- [x] Grafana integration guide and pre-built dashboard templates
- [x] Fleet-wide search — find which server is running a specific container, service, or port

---

## Phase 28: Agent Plugin System (Completed)

**Priority: High**

Make the agent extensible — let users add custom capabilities without modifying agent core. This is the foundation for future integrations (Android device farms, IoT fleets, custom hardware monitoring, etc.).

### Plugin Architecture
- [x] Plugin specification — standard interface (init, healthcheck, metrics, commands)
- [x] Plugin manifest format (YAML/JSON) — name, version, dependencies, capabilities, permissions
- [x] Plugin lifecycle management — install, enable, disable, uninstall, upgrade
- [x] Plugin isolation — each plugin runs in its own process/sandbox with resource limits
- [x] Plugin communication — standardized IPC between plugin and agent core

### Plugin Capabilities
- [x] Custom metrics reporters — plugins can push arbitrary metrics to the panel
- [x] Custom health checks — plugins define checks that feed into the status system
- [x] Custom commands — plugins register new command types the panel can invoke
- [x] Scheduled tasks — plugins can register periodic jobs (cron-like)
- [x] Event hooks — plugins can react to agent events (connect, disconnect, command, alert)

---

## Phase 29: Server Templates & Config Sync (Completed)

**Priority: Medium**

Define what a server should look like, apply it, and detect when it drifts.

- [x] Server template builder — define expected state (packages, services, firewall rules, users, files)
- [x] Template library — save and reuse templates (e.g., "Web Server", "Database Server", "Mail Server")
- [x] Apply template to server — install packages, configure services, set firewall rules via agent
- [x] Config drift detection — periodic comparison of actual vs. expected state
- [x] Drift report UI — visual diff showing what changed and when
- [x] Auto-remediation option — automatically fix drift back to template (with approval toggle)
- [x] Template versioning — track changes to templates over time
- [x] Template inheritance — base template + role-specific overrides
- [x] Bulk apply — roll out template changes across server groups
- [x] Compliance dashboard — percentage of fleet in compliance per template

---

## Phase 30: Multi-Tenancy & Workspaces (Completed)

**Priority: Medium**

Isolate servers by team, client, or project. Essential for agencies, MSPs, and larger teams.

- [x] Workspace model — isolated container for servers, users, and settings
- [x] Workspace CRUD — create, rename, archive workspaces
- [x] Server assignment — each server belongs to exactly one workspace
- [x] User workspace membership — users can belong to multiple workspaces with different roles
- [x] Workspace switching — quick-switch dropdown in the header
- [x] Per-workspace settings — notification preferences, default templates, branding
- [x] Workspace-scoped API keys — API keys restricted to a single workspace
- [x] Cross-workspace admin view — super-admin can see all workspaces and usage
- [x] Workspace usage quotas — limit servers, users, or API calls per workspace
- [x] Workspace billing integration — track resource usage per workspace for invoicing

---

## Phase 31: Advanced SSL Features (Completed)

**Priority: Medium**

- [x] Certificate expiry monitoring
- [x] Wildcard SSL certificates via DNS-01 challenge
- [x] Multi-domain certificates (SAN)
- [x] Custom certificate upload (key + cert + chain)
- [x] Certificate expiry notifications (email/webhook alerts before expiration)
- [x] SSL configuration templates (modern, intermediate, legacy compatibility)
- [x] SSL health check dashboard (grade, cipher suites, protocol versions)

---

## Phase 32: DNS Zone Management (Completed)

**Priority: Medium**

Full DNS record management with provider API integration.

- [x] DNS zone editor UI (A, AAAA, CNAME, MX, TXT, SRV, CAA records)
- [x] Cloudflare API integration (list/create/update/delete records)
- [x] Route53 API integration
- [x] DigitalOcean DNS integration
- [x] DNS propagation checker (query multiple nameservers)
- [x] Auto-generate recommended records for hosted services (SPF, DKIM, DMARC, MX)
- [x] DNS template presets (e.g., "standard web hosting", "email hosting")
- [x] Bulk record import/export (BIND zone file format)

---

## Phase 33: Nginx Advanced Configuration (Completed)

**Priority: Medium**

Go beyond basic virtual hosts — full reverse proxy and performance configuration.

- [x] Caching rules editor (proxy cache zones, TTLs, cache bypass rules)
- [x] Rate limiting at proxy level (per-IP, per-route)
- [x] Custom location block editor with syntax validation
- [x] Header manipulation (add/remove/modify request/response headers)
- [x] Nginx config syntax check before applying changes
- [x] Config diff preview before saving
- [x] Access/error log viewer per virtual host

---

## Phase 34: Status Page & Health Checks (Completed)

**Priority: Medium**

Public-facing status page and automated health monitoring.

- [x] Automated health checks (HTTP, TCP, DNS, SMTP) with configurable intervals
- [x] Public status page (standalone URL, no auth required)
- [x] Status page customization (logo, colors, custom domain)
- [x] Service grouping on status page (e.g., "Web Services", "Email", "APIs")
- [x] Incident management — create, update, resolve incidents with timeline
- [x] Uptime percentage display (24h, 7d, 30d, 90d)
- [x] Scheduled maintenance windows with advance notifications
- [x] Status page subscribers (email/webhook notifications on incidents)
- [x] Historical uptime graphs
- [x] Status badge embeds (SVG/PNG for README files)

---

## Phase 35: Server Provisioning APIs (Completed)

**Priority: Medium**

Spin up and manage cloud servers directly from the panel.

- [x] DigitalOcean API integration (create/destroy/resize droplets)
- [x] Hetzner Cloud API integration
- [x] Vultr API integration
- [x] Linode/Akamai API integration
- [x] Server creation wizard (region, size, OS, SSH keys)
- [x] Auto-install ServerKit agent on provisioned servers
- [x] Server cost tracking and billing overview
- [x] Snapshot management (create/restore/delete)
- [x] One-click server cloning
- [x] Destroy server with confirmation safeguards

---

## Phase 36: Performance Optimization (Completed)

**Priority: Low**

- [x] Redis caching for frequently accessed data (metrics, server status)
- [x] Database query optimization and slow query logging
- [x] Background job queue (Celery or RQ) for long-running tasks
- [x] Lazy loading for large datasets (paginated API responses)
- [x] WebSocket connection pooling and reconnection improvements
- [x] Frontend bundle optimization and code splitting

---

## Phase 37: Mobile App (Completed)

**Priority: Low — v3.0+**

- [x] React Native or PWA mobile application
- [x] Push notifications for alerts and incidents
- [x] Quick actions (restart services, view stats, acknowledge alerts)
- [x] Biometric authentication (fingerprint/Face ID)
- [x] Offline mode with cached server status

---

## Phase 38: Marketplace & Extensions (Completed)

**Priority: Low — v3.0+**

- [x] Plugin/extension system with API hooks
- [x] Community marketplace for plugins
- [x] Custom dashboard widgets
- [x] Theme customization (colors, layout, branding)
- [x] Extension SDK and developer documentation

---

# Active Development (H2 2026)

Current focus areas on the `dev` branch. Core work centers on the deploy experience and
platform infrastructure; new capability areas ship as Marketplace extensions.

## Adopting Existing Sites (implemented)

Issue #269 — a site already running on the host was invisible to the panel.

- [x] Discover the sites host nginx serves: vhost, document root, PHP-FPM pool and version, WordPress database, certificate.
- [x] Adopt a site in place (`serverkit adopt-site`, the Services page, `POST /apps/host-sites/adopt`), dry run by default, writing rows and never config.
- [x] `managed_by = host`: the vhost writer, drift repair, lifecycle and delete paths leave a host-managed site's running config alone.
- [x] Report unmanaged sites in the doctor and on Services.
- [x] Document the hand-migration path that ends in adoption (`docs/COEXISTENCE.md`).
- [ ] Adopt a proxied process together with its vhost.
- [ ] Report PHP-FPM pools and databases that no service uses.

## AI Assistant: Prompture Provider Connections (implemented)

Community request: D3M4L, September 1, 2026 — connect the assistant to OmniRoute.

- [x] Discover native chat providers from Prompture metadata instead of an eight-entry dropdown, deduplicate aliases, and label missing optional dependencies.
- [x] Provide provider-specific fields, compatible-endpoint presets, and named encrypted connections with a panel default.
- [x] Support OmniRoute and other compatible gateways with exact model IDs, including slashes and routing aliases, plus discovery and manual entry.
- [x] Select a connection/model for new chats; retain it on resume and allow credential rotation without rerouting old chats.
- [x] Test compatible endpoints with a real bounded chat request; verify native model discovery and surface failures rather than treating driver construction as success.
- [x] Migrate existing settings and matching conversations, preserve write confirmations and RBAC, and test secret isolation, streaming, tool protocol, and fresh/resumed conversations.

See [AI provider connections](docs/AI_PROVIDERS.md) for setup and compatibility details. ServerKit uses Prompture 1.11.0's existing drivers, including native streaming and tool calls through its OpenAI-compatible driver. Automatic cross-connection fallback remains a separate feature. OmniRoute-compatible protocol behavior is covered by HTTP transport tests; a live OmniRoute instance is still needed for deployment-specific verification.

## Deploy Console & Live Run Logs

The publish pipeline is becoming ServerKit's signature experience: deploy anything, watch it
happen live, and debug failures entirely from the UI.

- [x] Full-page live deploy console for every install and deploy (templates, Git repos, uploads, redeploys)
- [x] Streaming build output with a step timeline, per-step durations, and live elapsed time
- [x] Failure cards showing the real error tail with plain-language hints and one-click retry
- [x] Unified batched run-log layer (database persistence + WebSocket push, polling fallback)
- [x] Extensions can put their own long-running work on the same console — WordPress environment promotions are the first, with live steps, logs and retry

## Extension Platform

- [x] Runtime frontend loading — installed extensions render without rebuilding the panel
- [x] Extensions plug into the panel's own surfaces — their work shows up in the deploy console, their data in backups and restore, their health on the doctor page, their objects in search, and they can run commands across the fleet
- [x] Explicit install consent for unsigned, unreviewed or third-party extension code
- [x] Signed extension releases — all downloadable first-party artifacts publish detached ed25519 signatures, the canonical and bundled indexes carry them, and registry CI re-downloads and verifies the exact bytes against the pinned publisher key
- [x] The WordPress flagship extracted to its own repo and installed from the Marketplace like any other extension
- [x] Security suite (Fail2ban, ClamAV, Lynis, auto-updates, image scanning) as installable extensions for a leaner default panel — the security omnibus is split, a fresh panel's Security page is a lean zero-host-package baseline, each tool is its own extension repo mounting the same routes and tabs when installed, upgraded panels with the host tool present get the extension back automatically, and the setup wizard asks how much security tooling to install
- [x] The remaining built-ins extracted to standalone repos — localkit, email, cloudflare-ops and git (Gitea half; the deploy pipeline stays core) each have a standalone repo with the proven build/release pipeline; the in-tree copies stay bundled until each repo's first signed release lands in the registry, then the final cutover removes them

## Game Server Hosting (new extension family)

- [x] Minecraft server extension: guided setup, live console, player management, world backups, scheduled restarts with in-game warnings
- [x] Reusable game-server framework (console, players, saves, schedules) enabling future titles
- [x] "Share with friends" connect card
- [ ] Optional domain support for the connect card (SRV records)

## Fleet & Agents

- [ ] Live command-output streaming from remote agents into the deploy console

## Release Engineering

- [ ] End-to-end verification sweep and publishing round for pending releases and extension repos

---

## Version Milestones

| Version | Target Features | Status |
|---------|-----------------|--------|
| v0.9.0 | Core features, 2FA, Notifications, Security | Completed |
| v1.0.0 | Production-ready stable release, DB migrations | Completed |
| v1.1.0 | Multi-server, Git deployment | Completed |
| v1.2.0 | Backups, Advanced SSL, Advanced Security | Completed |
| v1.3.0 | Email server, API enhancements | Completed |
| v1.4.0 | Team & permissions, SSO & OAuth login | Completed |
| v1.5.0 | New UI, Visual Designer, Services Page | Completed |
| v1.6.0 | Workflow triggers & completion, fleet management | Completed |
| v1.7.0 | Cross-server monitoring, agent plugin system | Completed |
| v1.8.0 | Server templates, multi-tenancy | Completed |
| v1.9.0 | Advanced SSL, DNS management, Nginx config | Completed |
| v2.0.0 | Status pages, server provisioning, performance | Completed |
| v3.0.0 | Mobile app, Marketplace | Completed |

Current released line: **v1.7.x** — see **Active Development** above for what's in flight.

---

## Contributing

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Priority areas for contributions:**
- New extensions and Marketplace templates
- Extension SDK improvements and example plugins
- UI/UX polish and fixes for reported issues
- Documentation
- Test coverage

---

## Feature Requests

The core is no longer taking on new features. The best way to propose new functionality is as an **extension** — open an issue on GitHub with the `extension-idea` label, or build it yourself with the extension SDK. Core issues (bugs, UI polish) are always welcome with the `bug` label.

---

<p align="center">
  <strong>ServerKit Roadmap</strong><br>
  Last updated: August 2026
</p>
