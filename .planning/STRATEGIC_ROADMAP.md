# ServerKit Strategic Roadmap

*Last Updated: January 2026*

This roadmap outlines the strategic development path for ServerKit to achieve competitive parity and differentiation in the self-hosted server management market.

---

## Vision Statement

**ServerKit: The modern server panel that bridges traditional hosting and cloud-native deployment.**

ServerKit will be the go-to choice for developers and small teams who want:
- The simplicity of traditional hosting panels (like cPanel)
- The power of modern PaaS platforms (like Coolify/Heroku)
- Without the complexity of Kubernetes
- Without vendor lock-in

---

## Current State Assessment

### What We Have (January 2026)

| Category | Features |
|----------|----------|
| **Authentication** | JWT auth, role-based access, account lockout |
| **Applications** | PHP, WordPress, Flask, Django, Docker support |
| **Infrastructure** | Nginx config, SSL/Let's Encrypt, firewall (ufw/firewalld) |
| **Monitoring** | Real-time metrics, uptime tracking, alerts |
| **Operations** | File manager, web terminal, cron jobs, FTP |
| **UI** | Modern React dashboard with dark theme |

### What's Missing for Competitive Parity
1. Git-based deployment
2. One-click app marketplace
3. Two-factor authentication
4. S3 backup integration
5. Multi-server support

---

## Phased Roadmap

## Phase 1: Security & Developer Essentials
**Timeline: Q1 2026 (Jan-Mar)**
**Theme: "Trust & Productivity"**

### 1.1 Two-Factor Authentication [P0]
- [ ] TOTP implementation (Google Authenticator compatible)
- [ ] QR code setup flow
- [ ] Backup codes generation
- [ ] Recovery flow for lost 2FA
- [ ] Admin enforcement option

**Deliverable:** Users can secure accounts with 2FA

### 1.2 Environment Variable Management [P1]
- [ ] Per-application .env storage
- [ ] Secret masking in UI (show/hide toggle)
- [ ] Import from .env file
- [ ] Export to .env file
- [ ] Variable history/versioning
- [ ] Encrypted storage in database

**Deliverable:** Developers can manage app config without SSH

### 1.3 Database Web Interface [P1]
- [ ] Embed Adminer (single PHP file, lightweight)
- [ ] Single sign-on from ServerKit dashboard
- [ ] Support MySQL, PostgreSQL, SQLite
- [ ] Alternative: custom query runner for simple tasks

**Deliverable:** Database management without external tools

### 1.4 Notification System [P1]
- [ ] Discord webhook integration
- [ ] Slack webhook integration
- [ ] Telegram bot notifications
- [ ] Email improvements (templates, reliability)
- [ ] Notification preferences per user
- [ ] Test notification button

**Deliverable:** Get alerted on your preferred channel

---

## Phase 2: Git Deployment Pipeline
**Timeline: Q2 2026 (Apr-Jun)**
**Theme: "Push to Deploy"**

### 2.1 Git Repository Integration [P0]
- [ ] GitHub OAuth app connection
- [ ] GitLab integration
- [ ] Bitbucket integration
- [ ] Generic Git URL support (any repo)
- [ ] Repository browser in UI
- [ ] Branch selection

**Deliverable:** Connect any Git repository

### 2.2 Webhook Deployment [P0]
- [ ] Auto-generated webhook URLs per app
- [ ] Signature verification (GitHub, GitLab)
- [ ] Branch-specific triggers
- [ ] Deploy on push to `main`
- [ ] Webhook logs and debugging

**Deliverable:** Auto-deploy when you push code

### 2.3 Build System [P0]
- [ ] Dockerfile detection and building
- [ ] Nixpacks support (Heroku-style detection)
- [ ] Custom build commands
- [ ] Build log streaming (WebSocket)
- [ ] Build caching for speed
- [ ] Build timeout handling

**Deliverable:** Build and deploy any language/framework

### 2.4 Deployment Management [P1]
- [ ] Deployment history per app
- [ ] Deployment status (building, deploying, live, failed)
- [ ] One-click rollback to previous version
- [ ] Keep last N deployments (configurable)
- [ ] Deployment diff view

**Deliverable:** Safe deployments with easy rollback

---

## Phase 3: One-Click App Marketplace
**Timeline: Q3 2026 (Jul-Sep)**
**Theme: "Deploy Anything in Seconds"**

### 3.1 Template System [P0]
- [ ] App template schema (YAML-based)
- [ ] Docker Compose compatibility
- [ ] Variable substitution (ports, passwords, etc.)
- [ ] Post-install scripts
- [ ] Update mechanism for apps

**Template schema example:**
```yaml
name: uptime-kuma
version: "1.21"
description: Self-hosted monitoring tool
icon: /icons/uptime-kuma.png
categories: [monitoring, devops]
compose:
  services:
    uptime-kuma:
      image: louislam/uptime-kuma:1
      ports:
        - "${PORT}:3001"
      volumes:
        - data:/app/data
variables:
  PORT:
    default: 3001
    description: "Port to expose"
```

### 3.2 Initial App Catalog (50 Apps) [P0]

**Development & DevOps:**
- [ ] Gitea / GitLab
- [ ] Drone CI / Woodpecker CI
- [ ] SonarQube
- [ ] Vault (secrets)
- [ ] Uptime Kuma

**Databases:**
- [ ] PostgreSQL
- [ ] MySQL / MariaDB
- [ ] MongoDB
- [ ] Redis
- [ ] InfluxDB

**CMS & Content:**
- [ ] WordPress
- [ ] Ghost
- [ ] Strapi
- [ ] Directus
- [ ] Payload CMS

**Productivity:**
- [ ] Nextcloud
- [ ] Minio (S3)
- [ ] Vaultwarden (passwords)
- [ ] n8n (automation)
- [ ] Appwrite

**Communication:**
- [ ] Mattermost
- [ ] Rocket.Chat
- [ ] Mailcow (email)
- [ ] Listmonk (newsletters)

**Analytics & Monitoring:**
- [ ] Plausible Analytics
- [ ] Umami
- [ ] Grafana
- [ ] Prometheus

### 3.3 App Marketplace UI [P1]
- [ ] Browse by category
- [ ] Search functionality
- [ ] App detail pages with screenshots
- [ ] One-click deploy button
- [ ] Configuration wizard
- [ ] Installed apps management

**Deliverable:** 50+ apps deployable in one click

---

## Phase 4: Backup & Recovery
**Timeline: Q4 2026 (Oct-Dec)**
**Theme: "Never Lose Data"**

### 4.1 S3-Compatible Backup [P0]
- [ ] AWS S3 support
- [ ] MinIO support (self-hosted)
- [ ] Backblaze B2 support
- [ ] DigitalOcean Spaces
- [ ] Any S3-compatible endpoint

### 4.2 Backup Features [P0]
- [ ] Scheduled backups (cron-based)
- [ ] On-demand backups
- [ ] Backup encryption (AES-256)
- [ ] Compression (gzip/zstd)
- [ ] Backup verification
- [ ] Retention policies (keep last N)

### 4.3 Restore Capabilities [P1]
- [ ] One-click restore from backup
- [ ] Selective restore (files/database)
- [ ] Point-in-time recovery
- [ ] Download backup locally
- [ ] Restore to different server

### 4.4 What Gets Backed Up
- [ ] Application files
- [ ] Database dumps
- [ ] SSL certificates
- [ ] Nginx configurations
- [ ] Environment variables
- [ ] Cron jobs

**Deliverable:** Complete disaster recovery solution

---

## Phase 5: Multi-Server Architecture
**Timeline: Q1 2027**
**Theme: "Scale Without Limits"**

### 5.1 Server Agent [P0]
- [ ] Standalone agent binary (Python/Go)
- [ ] Authenticated connection to control panel
- [ ] Auto-registration flow
- [ ] Health reporting
- [ ] Secure communication (TLS + JWT)

### 5.2 Multi-Server Management [P0]
- [ ] Add/remove servers from dashboard
- [ ] Server grouping and tagging
- [ ] Per-server resource monitoring
- [ ] Server status overview

### 5.3 Cross-Server Features [P1]
- [ ] Deploy app to any connected server
- [ ] Centralized logging
- [ ] Aggregated metrics dashboard
- [ ] Server-to-server migration

**Deliverable:** Manage entire infrastructure from one panel

---

## Phase 6: Team & Enterprise Features
**Timeline: Q2 2027**
**Theme: "Collaborate Securely"**

### 6.1 Team Management [P1]
- [ ] Create organizations
- [ ] Invite team members
- [ ] Role-based access (Admin, Developer, Viewer)
- [ ] Per-app permissions
- [ ] Audit logging

### 6.2 Advanced Security [P1]
- [ ] SSO/SAML integration
- [ ] LDAP/Active Directory
- [ ] IP whitelist for dashboard
- [ ] Session management
- [ ] Security event alerts

### 6.3 Developer Experience [P2]
- [ ] CLI tool (`serverkit` command)
- [ ] API tokens for CI/CD
- [ ] Terraform provider
- [ ] Public API documentation

**Deliverable:** Enterprise-ready team features

---

## Phase 7: Advanced Features
**Timeline: Q3-Q4 2027**
**Theme: "Power User Tools"**

### 7.1 Staging & Previews
- [ ] Create staging environments
- [ ] PR preview deployments
- [ ] Environment promotion workflow
- [ ] Isolated staging databases

### 7.2 Advanced Monitoring
- [ ] Custom metrics collection
- [ ] Log search and filtering
- [ ] Performance profiling
- [ ] Error tracking integration (Sentry)

### 7.3 Networking
- [ ] Internal networking between apps
- [ ] Load balancer configuration
- [ ] TCP/UDP proxy support
- [ ] WebSocket support improvements

---

## Milestone Summary

| Version | Milestone | Target | Key Features |
|---------|-----------|--------|--------------|
| **v0.5** | Security Ready | Mar 2026 | 2FA, env vars, notifications |
| **v0.6** | Git Deploy | Jun 2026 | Push-to-deploy, rollback |
| **v0.7** | App Store | Sep 2026 | 50+ one-click apps |
| **v0.8** | Backup Pro | Dec 2026 | S3 backups, restore |
| **v0.9** | Multi-Server | Mar 2027 | Server agents, fleet management |
| **v1.0** | Production Ready | Jun 2027 | Teams, enterprise features |

---

## Success Metrics

### User Adoption
- 1,000 GitHub stars by v1.0
- 500 active installations
- 10+ community contributors

### Feature Parity
- Match Coolify core features by v0.8
- Exceed CloudPanel features by v0.6
- Complete WordPress toolkit by v0.7

### Performance
- Dashboard load < 1 second
- Deploy completion < 2 minutes
- Support 100 apps per server

### Reliability
- 99.9% panel uptime
- Zero data loss in backups
- Automated disaster recovery

---

## Competitive Positioning by Version

| Version | vs Coolify | vs CloudPanel | vs HestiaCP |
|---------|------------|---------------|-------------|
| v0.5 | -80% | -20% | +10% |
| v0.6 | -50% | +30% | +40% |
| v0.7 | -20% | +60% | +60% |
| v0.8 | Match | +70% | +70% |
| v1.0 | +10% | +100% | +80% |

*Percentage represents feature coverage comparison*

---

## Resource Allocation

### Recommended Team
- 1-2 Backend developers (Flask, system integration)
- 1 Frontend developer (React)
- 0.5 DevOps (testing, CI/CD)
- Community contributors

### Technical Priorities
1. Backend stability and security
2. API completeness
3. Frontend polish
4. Documentation
5. Testing coverage

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Scope creep | Strict phase boundaries, MVP first |
| Security vulnerabilities | Security audit before v1.0 |
| Performance at scale | Load testing each phase |
| Community adoption | Open roadmap, contributor docs |
| Maintenance burden | Automated testing, CI/CD |

---

## Next Steps

1. **This Week:** Begin 2FA implementation
2. **This Month:** Complete Phase 1.1 and 1.2
3. **This Quarter:** Ship v0.5 with all Phase 1 features
4. **Review:** Quarterly roadmap review and adjustment

---

*This roadmap is a living document. Review and update quarterly based on user feedback and market changes.*
