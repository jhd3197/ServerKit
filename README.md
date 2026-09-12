<div align="center">

<img width="100%" alt="ServerKit — Deploy, manage, and monitor servers" src="docs/screenshots/poster.png" />

# ServerKit

**Deploy, manage, and monitor servers.**

A lightweight, modern server control panel for managing web apps, databases,
Docker containers, and security — without the complexity of Kubernetes
or the cost of managed platforms.

English | [Español](docs/README.es.md) | [中文版](docs/README.zh-CN.md) | [Português](docs/README.pt.md)

<br>

![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
[![Discord](https://img.shields.io/discord/1470639209059455008?style=for-the-badge&logo=discord&logoColor=white&label=Discord&color=5865F2)](https://discord.gg/ZKk6tkCQfG)
[![Watch the demo](https://img.shields.io/badge/Watch_the_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=TXfXFz6bVjs&list=PLShBdCqh2m8E)

<a href="https://trendshift.io/repositories/21908?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-21908" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/21908/daily?language=JavaScript" alt="jhd3197/ServerKit | Trendshift" height="55" align="middle" /></a>
<a href="https://www.uneed.best/tool/serverkit" target="_blank" rel="noopener noreferrer">
  <img src="https://www.uneed.best/POTD3.png" height="55" align="middle" alt="Uneed POTD3 Badge" />
</a>

[![GitHub Stars](https://img.shields.io/github/stars/jhd3197/ServerKit?style=flat-square&color=f5c542)](https://github.com/jhd3197/ServerKit/stargazers)
[![Downloads](https://img.shields.io/github/downloads/jhd3197/ServerKit/total?style=flat-square)](https://github.com/jhd3197/ServerKit/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/jhd3197/serverkit?style=flat-square&logo=docker&logoColor=white&label=docker%20pulls)](https://hub.docker.com/r/jhd3197/serverkit)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB.svg?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![Flask](https://img.shields.io/badge/flask-3.0-000000.svg?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Nginx](https://img.shields.io/badge/nginx-reverse_proxy-009639.svg?style=flat-square&logo=nginx&logoColor=white)](https://nginx.org)
[![Let's Encrypt](https://img.shields.io/badge/SSL-Let's_Encrypt-003A70.svg?style=flat-square&logo=letsencrypt&logoColor=white)](https://letsencrypt.org)

<br>

[Quick Start](#-quick-start) · [Video walkthrough](#video-walkthrough) · [Screenshots](#-screenshots) · [Features](#-features) · [Architecture](#-architecture) · [Roadmap](#-roadmap) · [Changelog](CHANGELOG.md) · [Docs](#-documentation) · [Contributing](#-contributing) · [Discord](#-community)

</div>

---

## Video walkthrough

Choose a template or bring your own code. Watch both deployment paths on YouTube.

<table>
  <tr>
    <th width="50%">Template to live app</th>
    <th width="50%">Any Git repo in 3 steps</th>
  </tr>
  <tr>
    <td valign="top">
      <a href="https://youtu.be/TXfXFz6bVjs"><img src="docs/videos/template-to-live-app.png" width="100%" alt="Template to live app" /></a>
      <p>Deploy AgentSite from the template catalog, check capacity and follow the live build.</p>
      <p><strong><a href="https://youtu.be/TXfXFz6bVjs">▶ Watch on YouTube · 4:16</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=27s">Template catalog</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=71s">Deploy drawer</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=123s">Capacity check</a> · <a href="https://www.youtube.com/watch?v=TXfXFz6bVjs&amp;t=151s">Live build</a></p>
    </td>
    <td valign="top">
      <a href="https://youtu.be/Fv28qMERYDU"><img src="docs/videos/deploy-git-repo.png" width="100%" alt="Any Git repo in 3 steps" /></a>
      <p>Connect a Git repository, review the detected settings and deploy with the New Service wizard.</p>
      <p><strong><a href="https://youtu.be/Fv28qMERYDU">▶ Watch on YouTube · 3:45</a></strong></p>
      <p><a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=25s">Sources</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=70s">Connect repository</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=117s">Review settings</a> · <a href="https://www.youtube.com/watch?v=Fv28qMERYDU&amp;t=160s">Auto-deploy</a></p>
    </td>
  </tr>
</table>

---

## 📊 By the Numbers

<!-- BEGIN GENERATED MEASUREMENTS -->
Snapshot: **2026-09-05**. [Definitions, raw measurements and reproduction commands](docs/METRICS.md).

| | |
|---|---|
| **1,212** core route declarations | in **104** blueprint declarations under `backend/app/api`; source inventory, excluding extensions |
| **118** bundled app templates | root-level app YAML files; database extension templates counted separately |
| **5,089** backend test cases collected | clean-checkout collection; this is not a claim that every case passed or ran |
| **3.31 MB** total JS/CSS, gzipped | includes lazy chunks, locale bundles and vendor shims; excludes fonts and images |
| **$0** license cost | MIT-licensed, without subscription or seat fees |

The total sums files individually compressed with gzip at level 9; it is not a measured page-load time. RAM usage and image size depend on the build, platform and workload; no universal footprint is claimed.
<!-- END GENERATED MEASUREMENTS -->

---

## 🚀 Quick Start

> Installation time depends on the server, network and required packages.

### Option 1: One-Line Install (Recommended)

```bash
curl -fsSL https://serverkit.ai/install.sh | bash
```

> Works on Ubuntu 22.04+, Debian 12+, Fedora, and RHEL/Rocky/AlmaLinux 9+. Sets up everything automatically.
>
> Optional: `PANEL_DOMAIN=panel.example.com` sets the domain and tries Let's Encrypt; `SERVERKIT_OFFLINE_TARBALL=...` installs from a local tarball.

### Update

```bash
sudo serverkit update
```

Atomic blue/green update with pre-flight checks, DB backup, migration, and
automatic rollback. Use `--dry-run` to preview, `--branch dev` for dev builds,
or `--release [version]` for release tarballs.

### Option 2: Docker

```bash
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit
cp .env.example .env       # then edit .env with your secrets
docker compose up -d       # access at http://localhost:5000
```

Runs the panel as a single container. Note a containerised panel **cannot manage
its own host** — no systemd, no host nginx, no managed site vhosts; use Option 1
for that. It ships without nginx and never redirects to HTTPS, which makes it the
right target to put your own reverse proxy in front of — see
[Running behind your own reverse proxy](docs/INSTALLATION.md#running-behind-your-own-reverse-proxy).

### Option 3: Manual Installation

See the [Installation Guide](docs/INSTALLATION.md) for step-by-step instructions.

### Requirements

| | Minimum | Recommended |
|---|---------|-------------|
| **OS** | Ubuntu 22.04+ · Debian 12+ · Fedora · RHEL/Rocky/AlmaLinux 9+ | Ubuntu 24.04 LTS |
| **Arch** | x86_64 · ARM64 | x86_64 · ARM64 |
| **CPU** | 1 vCPU | 2+ vCPU |
| **RAM** | 1 GB | 2+ GB |
| **Disk** | 10 GB | 20+ GB |
| **Docker** | 24.0+ (optional for the panel itself) | Latest |

> These requirements are sizing guidance, not a capacity benchmark. Allow additional RAM and disk for managed apps, images, databases, logs and backups. Measure your own workload using the [measurement guide](docs/METRICS.md).

---

## 📸 Screenshots

> Captured from a mock-data demo build — every hostname, IP, domain, and metric below is fictional.

|                            Dashboard                             |                            Services                            |
| :--------------------------------------------------------------: | :------------------------------------------------------------: |
|      ![Dashboard](docs/screenshots/dashboard.png)       |      ![Services](docs/screenshots/services.png)       |
|   _Live server metrics, KPI cards, and recent activity_   |   _Static, Node.js, Python, PHP, and Docker apps_   |

|                             Docker                              |                           WordPress                            |
| :-------------------------------------------------------------: | :------------------------------------------------------------: |
|         ![Docker](docs/screenshots/docker.png)         |      ![WordPress](docs/screenshots/wordpress.png)     |
| _Containers, images, volumes, and networks with live CPU/RAM_ | _Per-site status, Quick Actions, and live health checks_ |

|                           Agent Fleet                            |                           Marketplace                           |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Agent Fleet](docs/screenshots/fleet.png)            |      ![Marketplace](docs/screenshots/marketplace.png)      |
|      _Fleet health, version rollouts, and command queue_      |     _One-click app templates and installable extensions_     |

|                           Monitoring                            |                            Security                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|      ![Monitoring](docs/screenshots/monitoring.png)      |         ![Security](docs/screenshots/security.png)         |
|   _Live gauges, alert rules, and notification channels_   | _Posture score, ClamAV, file integrity, firewall, Fail2Ban_ |

<details>
<summary><strong>View all screenshots</strong></summary>

<br>

|                          AI Assistant                           |                          Service Detail                          |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|            ![AI Assistant](docs/screenshots/ai.png)             |   ![Service Detail](docs/screenshots/service-detail.png)   |
|     _Prompture-powered assistant that runs tools on your infra_     | _Deployments, git connection, live usage, logs, and settings_ |

|                            Databases                            |                           SQL Console                            |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|        ![Databases](docs/screenshots/databases.png)        |            ![SQL Console](docs/screenshots/sql.png)            |
|   _MySQL / PostgreSQL / SQLite explorer with a source tree_   |     _Run SQL from the browser with a typed results grid_     |

|                             Domains                             |                            DNS Zones                             |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Domains](docs/screenshots/domains.png)          |              ![DNS Zones](docs/screenshots/dns.png)              |
|      _SSL status, expiry tracking, and auto-renewal_      | _Cloudflare, Route 53, DigitalOcean — full record editing_ |

|                             Backups                             |                               Mail                               |
| :-------------------------------------------------------------: | :--------------------------------------------------------------: |
|          ![Backups](docs/screenshots/backups.png)          |               ![Mail](docs/screenshots/email.png)               |
|     _Scheduled backups with S3/B2 sync and one-click restore_     |   _Postfix, Dovecot, OpenDKIM, SpamAssassin, and Roundcube_   |

|                            Cron Jobs                            |                          File Manager                           |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|            ![Cron Jobs](docs/screenshots/cron.png)            |           ![File Manager](docs/screenshots/files.png)           |
|       _Visual cron editor with human-readable timing_       |    _Browse, edit, and upload files with per-mount disk usage_    |

|                         Logs & Terminal                         |                             Servers                             |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|         ![Logs & Terminal](docs/screenshots/terminal.png)         |           ![Servers](docs/screenshots/servers.png)           |
|      _Log viewer, process list, journald, and SSH sessions_      |   _Every server in one panel with live CPU/RAM/disk telemetry_   |

|                          Remote Access                           |                             Settings                            |
| :--------------------------------------------------------------: | :-------------------------------------------------------------: |
|    ![Remote Access](docs/screenshots/remote-access.png)    |          ![Settings](docs/screenshots/settings.png)          |
| _Expose NAT-ed services publicly via WireGuard-paired agents_ |  _Profile, appearance/branding, users, and connections_  |

|                              Login                              |                                                                 |
| :-------------------------------------------------------------: | :-------------------------------------------------------------: |
|              ![Login](docs/screenshots/login.png)              |                                                                 |
|    _Email/password sign-in with SSO and 2FA support_    |                                                                 |

</details>

## 🎯 Features

> **The core is feature-complete.** New capabilities ship as installable **extensions** through the built-in Marketplace — the core stays lean and stable, with ongoing work focused on UI polish and community-reported fixes.

### 🚀 Apps & Deployment

| | |
|---|---|
| **One-Click WordPress**<br>PHP-FPM 8.x sites published at real subdomains, with URL-swap previews, custom domains, and wildcard HTTPS. | **Any Stack**<br>Flask/Django on Gunicorn, Node.js on PM2, static sites — from Git, Docker, a manual path, or a zip upload. |
| **Docker & Compose**<br>Image-update detection with one-click apply, auto-sleep for idle containers, CPU-driven auto-scaling, live logs, and terminal access. | **Marketplace**<br>100+ one-click app templates on a declarative schema with auto-resolved secrets, hosts, and URLs — nothing hardcoded. |
| **Build Packs**<br>Zero-Dockerfile deploys: inspects a repo and generates a Dockerfile + compose from a build plan. | **Automations**<br>Node-based visual automation for tasks, deployments, and CI/CD — cron, webhook, and event triggers, running in a managed container. Ships as an extension. |
| **Previews & Snapshots**<br>Ephemeral PR preview environments, plus immutable, secret-masked config snapshots with diff and one-click restore. | **Projects & Environments**<br>Workspace → Project → Environment grouping, and a WordPress prod/staging/dev pipeline with code/DB promotion. |

### 🏗️ Infrastructure

| | |
|---|---|
| **Domains & SSL**<br>Nginx virtual hosts, automatic Let's Encrypt with renewal, hardened TLS 1.2+/AEAD, Cloudflare-aware configs, automatic CAA. | **DNS Zones**<br>Full record management across Cloudflare, Route 53, and DigitalOcean — propagation checks and dynamic DNS for changing IPs. |
| **Databases**<br>MySQL/MariaDB and PostgreSQL with user management, a live source tree, and a browser SQL console. | **Cloud Provisioning**<br>Spin up servers on DigitalOcean, Hetzner, Vultr, and Linode with cost tracking. |
| **Connections Hub**<br>Git providers, clouds, DNS, registrars, SMTP relays, and S3/B2 storage — every external account in one place, encrypted at rest. | **Backups**<br>Scheduled app/database/file backups to S3, B2, or local with retention policies, one-click restore, and optional client-side encryption. |
| **Files, FTP & Cron**<br>Web file manager with S3/B2 bucket browsing, vsftpd user management, and a visual cron editor. | **Email Server**<br>Postfix + Dovecot with DKIM/SPF/DMARC, SpamAssassin, Roundcube webmail, and forwarding rules. |

### 🔒 Security

| | |
|---|---|
| **Web Application Firewall**<br>Per-app ModSecurity v3 + OWASP Core Rule Set with detect/block modes and tunable paranoia. | **Passkeys & 2FA**<br>WebAuthn passwordless sign-in (hardware keys, Touch ID, Windows Hello) plus TOTP with backup codes. |
| **Malware & Integrity**<br>ClamAV scanning with quarantine, file-integrity monitoring, and Lynis vulnerability audits. | **SSH & Hardening**<br>Fail2ban, SSH key management, IP allow/block lists, and automatic OS security updates. |
| **Container Scanning**<br>Per-image CVE scanning with grype and SBOM generation with syft. | **Encrypted Secrets**<br>Provider credentials and secrets sealed with Fernet, plus an inbound webhook gateway for external automation. |

### 🖥️ Multi-Server

| | |
|---|---|
| **Cross-Platform Agent**<br>Go agent for Linux, Windows, and macOS — HMAC-SHA256 auth over a real-time WebSocket gateway. Native Windows service + MSI, `.deb`/`.rpm`, ARM64. [More →](https://github.com/jhd3197/serverkit-agent) | **Fleet Management**<br>Inventory, approval queue, staged version rollouts, LAN auto-discovery, and an offline command queue. |
| **Easy Enrollment**<br>Short-code pairing with fingerprint verification or pre-shared tokens; host credentials stored AES-GCM-encrypted. [More →](docs/pairing.md) | **Fleet Monitor**<br>Cross-server heatmaps, metric comparisons, alert thresholds, anomaly detection, and capacity forecasting. |
| **Server Templates**<br>Expected-state templates with drift detection, compliance dashboards, and auto-remediation. | **Remote Access Tunnels**<br>Expose a private/NAT'd service through an edge server over agent-managed WireGuard — no port forwarding. |
| **Guided Onboarding**<br>Validate → prerequisites → Docker → pair agent, with a live progress log. | **Per-Server Proxy**<br>Opt-in Dockerized Traefik or Caddy per server with compose preview; host nginx stays the default. |

### 📊 Monitoring & Alerts

| | |
|---|---|
| **Real-Time Metrics**<br>CPU, RAM, disk, and network over WebSocket, with historical retention and uptime tracking. | **GPU Monitoring**<br>NVIDIA utilization, memory, temperature, and per-process/per-container usage. |
| **Status Pages**<br>Public pages with HTTP/TCP/DNS/Ping checks, component monitoring, and incident management. | **Notifications**<br>Discord, Slack, Telegram, HTML email, and webhooks — per-user channels, severity filters, and quiet hours. |

### 👥 Team & Access

| | |
|---|---|
| **Workspaces**<br>Multi-tenant isolation with quotas and member management. | **RBAC**<br>Admin/developer/viewer roles with granular per-feature read/write permissions. |
| **SSO & OAuth**<br>Google, GitHub, OpenID Connect, and SAML 2.0 with account linking. | **API Keys**<br>Tiered keys with rate limiting, fine-grained scopes, usage analytics, and OpenAPI docs. |
| **Audit Logging**<br>Every user action tracked, with a detailed activity dashboard. | **Webhooks & Shared Config**<br>Outbound subscriptions with HMAC signatures and retries, plus shared tags and variable groups. |

### 🎨 Customization

| | |
|---|---|
| **Lean by Default**<br>The setup wizard installs only the extensions matching your use cases — add more anytime from the Marketplace. | **Sidebar Presets**<br>Full, Web Hosting, Email Admin, DevOps, or Minimal views with collapsible groups and per-user layouts. |
| **Your Brand**<br>8 preset accent colors plus a custom hex picker, and white-label logo, name, or banner. | **Dashboard Widgets**<br>Toggle and reorder widgets to fit your workflow. |

---

## 🏗️ Architecture

<img width="100%" alt="ServerKit architecture: clients and public visitors reach an nginx edge layer that splits panel traffic to the Flask API and public traffic to app containers; the ServerKit panel holds the React SPA, REST API, Socket.IO agent gateway, services, models, jobs, notifications and the extension runtime; a runtime layer on the same server holds Docker app containers, databases and panel state; a remote agent fleet of Go agents connects back over the /agent namespace." src="docs/images/architecture/system-overview.png" />

**Nginx** terminates TLS and splits traffic two ways: panel requests go to the **Flask API**, everything else is proxied to the **Docker container** serving that domain. The panel keeps its own state in SQLite or PostgreSQL, runs background work through a job scheduler and notification bus, and loads optional functionality from the **extension runtime**. Remote servers are managed by a **Go agent** that connects back over a Socket.IO namespace.

<details>
<summary><strong>View as ASCII diagram</strong></summary>

```
                          ┌──────────────────┐
                          │     INTERNET     │
                          └────────┬─────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            YOUR SERVER                                    │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                      NGINX (Reverse Proxy)                          │ │
│  │                         :80 / :443                                  │ │
│  │                                                                     │ │
│  │    app1.com ──┐   app2.com ──┐   api.app3.com ──┐   /api/v1/ ──┐   │ │
│  └───────────────┼──────────────┼──────────────────┼──────────────┼────┘ │
│                  │ proxy_pass   │ proxy_pass       │ proxy_pass   │      │
│                  ▼              ▼                  ▼              │      │
│  ┌────────────────────────────────────────────────────────────┐  │      │
│  │                    DOCKER CONTAINERS                       │  │      │
│  │                                                            │  │      │
│  │    ┌───────────┐    ┌───────────┐    ┌───────────┐        │  │      │
│  │    │ WordPress │    │   Flask   │    │  Node.js  │  ...   │  │      │
│  │    │   :8001   │    │   :8002   │    │   :8003   │        │  │      │
│  │    └─────┬─────┘    └───────────┘    └───────────┘        │  │      │
│  └──────────┼─────────────────────────────────────────────────┘  │      │
│             │                                                     ▼      │
│             │                        ┌─────────────────────────────────┐ │
│             │                        │       SERVERKIT PANEL           │ │
│             │                        │   React SPA · Flask REST API    │ │
│             │                        │   Socket.IO · Jobs · Notify     │ │
│             │                        │   Extension runtime             │ │
│             │                        │   Gunicorn -w 1 (threaded)      │ │
│             │                        └────────────────┬────────────────┘ │
│             ▼                                         │                  │
│  ┌──────────────────────────────────┐   ┌─────────────▼────────────────┐ │
│  │            DATABASES             │   │        PANEL STATE           │ │
│  │  MySQL :3306   PostgreSQL :5432  │   │  SQLite (default) or         │ │
│  │  Redis :6379   MongoDB :27017    │   │  PostgreSQL · Alembic        │ │
│  └──────────────────────────────────┘   └──────────────────────────────┘ │
└───────────────────────────────────────────────────────┼──────────────────┘
                                                        │
                          Socket.IO /agent (HMAC)       │
                          + HTTP long-poll fallback     ▼
                       ┌──────────────────────────────────────┐
                       │   REMOTE SERVERS — Go agent fleet    │
                       │   server A  ·  server B  ·  server C │
                       └──────────────────────────────────────┘
```

</details>

**[View Full Architecture Documentation →](docs/ARCHITECTURE.md)** — Request flow, extension platform, template system, port allocation, jobs, notifications, and the agent fleet.

---

## 🗺️ Roadmap

**ServerKit's core is feature-complete** — every planned core phase has shipped, from the first Flask + React infrastructure to multi-server fleets, SSO, the automation engine, and the extension marketplace.

Development now happens in three places:

- **[🧩 Extensions](https://github.com/jhd3197/serverkit-extensions)** — new functionality ships as installable extensions through the Marketplace (100+ one-click templates and growing). The core stays lean; you install only what you need. [Browse the catalog →](https://github.com/jhd3197/serverkit-extensions)
- **[🎨 Themes](https://github.com/jhd3197/serverkit-themes)** — the panel's look is community-extensible too: 17 built-in themes, one-click installs from the gallery, and a live Theme Studio to build and share your own. [See every theme →](https://github.com/jhd3197/serverkit-themes#gallery)
- **✨ Core polish** — ongoing UI/UX refinements and fixes for issues reported by the community. No new core features are planned.

Full history: [ROADMAP.md](ROADMAP.md)

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, request flow, diagrams |
| [Installation Guide](docs/INSTALLATION.md) | Complete setup instructions |
| [Deployment Guide](docs/DEPLOYMENT.md) | CLI commands and production deployment |
| [Agent](https://github.com/jhd3197/serverkit-agent) | Install & run the multi-server agent (Linux/Windows/macOS) — separate repo |
| [Extensions Registry](https://github.com/jhd3197/serverkit-extensions) | The curated extension marketplace `index.json` — separate repo |
| [Theming](docs/THEMING.md) | Build & share panel themes — token reference, Theme Studio, and the submit flow |
| [Themes Registry](https://github.com/jhd3197/serverkit-themes) | The curated community themes registry — separate repo |
| [Templates Registry](https://github.com/jhd3197/serverkit-templates) | The curated app template catalog `index.json` — separate repo |
| [Registries](docs/REGISTRIES.md) | Which catalogs are published as registries, and the test for whether a new one should be |
| [Agent Pairing](docs/pairing.md) | Secure short-code agent enrollment |
| [API Reference](docs/API.md) | REST API endpoints |
| [New Features](docs/NEW_FEATURES.md) | Endpoint & page reference for the latest `dev` features |
| [Enhancements](docs/ENHANCEMENTS.md) | Guide to the ten developer-experience, team/scale, fleet, and security capabilities |
| [Changelog](CHANGELOG.md) | Release history and notable changes |
| [Roadmap](ROADMAP.md) | Development roadmap and planned features |
| [Contributing](CONTRIBUTING.md) | How to contribute |

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.11, Flask, SQLAlchemy, Flask-SocketIO, Flask-Migrate |
| Frontend | React 18, Vite, SCSS, Recharts |
| Database | SQLite / PostgreSQL |
| Web Server | Nginx, Gunicorn (single threaded worker — `-w 1 --threads N`) |
| Containers | Docker, Docker Compose |
| Security | ClamAV, Lynis, Fail2ban, ModSecurity v3 + OWASP CRS, grype, syft, TOTP (pyotp), Fernet encryption |
| Auth | JWT, OAuth 2.0, OIDC, SAML 2.0, WebAuthn / passkeys |
| Email | Postfix, Dovecot, SpamAssassin, Roundcube |
| Agent | Go (multi-server), HMAC-SHA256, WebSocket |

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

```
fork → feature branch → commit → push → pull request
```

**Priority areas:** Marketplace extensions, UI/UX improvements, documentation, test coverage.

---

## 💛 Support ServerKit

ServerKit is free and open source. If it saves you time, you can help keep it going:

- ⭐ [Star the repo](https://github.com/jhd3197/ServerKit) — it costs nothing and helps a lot
- 💖 [GitHub Sponsors](https://github.com/sponsors/jhd3197)
- ☕ [Buy Me a Coffee](https://buymeacoffee.com/jhd3197)

### 💎 Crypto

| | Asset | Network | Address |
|:---:|---|---|---|
| <img src="docs/images/funding/usdt-trc20.png" width="110" alt="QR code for the USDT TRC-20 donation address" /> | **USDT** | **TRC-20** · Tron | `TTiCtqLauF1iSW2YGB3b78KmRxRqoLCgeL` |
| <img src="docs/images/funding/usdt-erc20.png" width="110" alt="QR code for the USDT and ETH ERC-20 donation address" /> | **USDT / ETH** | **ERC-20** · Ethereum | `0xD13D5355Fa214e8317fea2ff192a065BaeC13527` |
| <img src="docs/images/funding/btc.png" width="110" alt="QR code for the Bitcoin donation address" /> | **BTC** | **Bitcoin** | `bc1qatx67n3qxdvuv3arc9j8aytk34f22g02k9c7vr` |
| <img src="docs/images/funding/sol.png" width="110" alt="QR code for the Solana donation address" /> | **SOL** | **Solana** | `AWXzqtBEgUfteHPQtDegsZ6D5y57M3GGdKPD8rR7h6xu` |

TRC-20 has the lowest fees — usually under a dollar — so it's the friendliest
option for a small donation. ERC-20 gas can cost more than the donation itself.

<sub>QR codes are generated locally by [`scripts/generate-funding-qr.mjs`](scripts/generate-funding-qr.mjs), which checksum-validates every address before encoding.</sub>

---

## 🔭 Related Projects

**[Faro](https://github.com/jhd3197/faro)** — A modern desktop client for SFTP, FTP, SSH, and S3-compatible storage, from the same author. Save a server once, then browse its files in a dual-pane view and open a terminal against the same SSH session — plus drag-and-drop transfers, one-way directory sync, and edit-in-place. It even has an **Agent Bridge** that lets Claude Code (or any MCP agent) run commands on a box through your authenticated session, with per-command approval and no shared credentials.

> ServerKit manages your servers from the browser; Faro is the desktop companion for hands-on file transfer, shells, and ad-hoc work across all your boxes. [Grab a build →](https://github.com/jhd3197/faro/releases/latest)

**[LocalKit](https://github.com/jhd3197/LocalKit)** — Spin up local WordPress sites in one click. Each site runs as its own isolated Docker Compose project, and you can push code or push/pull databases straight to your ServerKit server through the `serverkit-localkit` extension.

**[DeviceKit](https://github.com/jhd3197/DeviceKit)** — A unified Android device fleet & test-automation platform. Control a fleet of devices from one dashboard — run automations, stream screens in real time, catch visual regressions, and debug failures with AI-powered analysis.

---

## 💬 Community

[![Discord](https://img.shields.io/badge/Discord-Join_Us-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/ZKk6tkCQfG)

Join the Discord to ask questions, share feedback, or get help with your setup.

---

<div align="center">

**ServerKit** — Simple. Modern. Self-hosted.

[Report Bug](https://github.com/jhd3197/ServerKit/issues) · [Request Feature](https://github.com/jhd3197/ServerKit/issues)

Made with ❤️ by [Juan Denis](https://juandenis.com)

</div>
