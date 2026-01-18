# ServerKit Feature Gap Analysis

*Last Updated: January 2026*

This document identifies features that ServerKit currently lacks compared to leading competitors, prioritized by impact and implementation complexity.

---

## Gap Severity Legend

| Icon | Severity | Description |
|:----:|----------|-------------|
| P0 | **Critical** | Must-have for competitive parity |
| P1 | **High** | Expected by users, significant differentiator |
| P2 | **Medium** | Nice-to-have, improves UX |
| P3 | **Low** | Future consideration |

---

## Critical Gaps (P0)

### 1. Git-Based Deployment
**Found in:** Coolify, CapRover, Dokploy

**What's missing:**
- GitHub/GitLab/Bitbucket repository connection
- Webhook-triggered auto-deployment on push
- Branch-based deployment (deploy `main` to production, `dev` to staging)
- Build command configuration
- Deploy previews for pull requests

**Why it matters:**
This is the #1 expected feature in 2025+. Developers expect push-to-deploy workflows. Without this, ServerKit feels dated compared to Coolify/Dokploy.

**Implementation scope:** Medium-High
```
Components needed:
- Git service integration (OAuth apps)
- Webhook receiver endpoint
- Build pipeline execution
- Deployment history tracking
- Rollback mechanism
```

---

### 2. One-Click App Marketplace
**Found in:** Coolify (280+), CapRover (100+), Portainer

**What's missing:**
- Pre-configured application templates
- One-click deployment for popular services
- Auto-configured databases, volumes, networking

**Top 20 apps to prioritize:**
1. WordPress
2. Ghost (blog platform)
3. Nextcloud (file storage)
4. GitLab/Gitea (code hosting)
5. n8n (workflow automation)
6. Uptime Kuma (monitoring)
7. Plausible Analytics
8. Minio (S3-compatible storage)
9. PostgreSQL
10. MySQL/MariaDB
11. Redis
12. MongoDB
13. Nginx Proxy Manager
14. Traefik
15. Portainer
16. Directus (headless CMS)
17. Strapi (headless CMS)
18. Supabase (Firebase alternative)
19. Appwrite (BaaS)
20. Mailcow (email server)

**Implementation scope:** Medium
```
Components needed:
- App template schema (docker-compose based)
- Template repository/registry
- Variable substitution engine
- Post-install hooks
- Update mechanism
```

---

### 3. Two-Factor Authentication (2FA)
**Found in:** CloudPanel, HestiaCP, Coolify

**What's missing:**
- TOTP-based 2FA (Google Authenticator, Authy)
- Backup/recovery codes
- Per-user 2FA enforcement
- Remember device option

**Why it matters:**
Security baseline. Server management panels are high-value targets. No 2FA = deal breaker for security-conscious users.

**Implementation scope:** Low
```
Components needed:
- pyotp library integration
- QR code generation for setup
- Backup codes storage (encrypted)
- 2FA challenge during login flow
- Admin enforcement settings
```

---

### 4. S3-Compatible Backup Storage
**Found in:** Coolify, HestiaCP, Cloudron

**What's missing:**
- Backup to AWS S3
- Backup to MinIO (self-hosted)
- Backup to Backblaze B2
- Backup to any S3-compatible storage
- Encrypted backups
- Scheduled backup jobs
- One-click restore

**Why it matters:**
Local backups on the same server aren't real backups. Off-site backup is expected for production use.

**Implementation scope:** Medium
```
Components needed:
- boto3 integration for S3 API
- Backup job scheduler
- Encryption at rest (AES-256)
- Restore workflow
- Retention policy management
```

---

## High Priority Gaps (P1)

### 5. Multi-Server Management
**Found in:** Coolify, Webmin, Cockpit

**What's missing:**
- Connect and manage multiple VPS from single dashboard
- Server grouping/tagging
- Cross-server application deployment
- Centralized monitoring across servers
- Server provisioning automation

**Why it matters:**
Users scaling beyond one server expect unified management. Currently, they'd need separate ServerKit instances.

**Implementation scope:** High
```
Components needed:
- Server agent protocol (authenticated WebSocket)
- Server registration flow
- Multi-tenant data model
- Aggregated metrics dashboard
- Server selector in all operations
```

---

### 6. Database GUI/Web Interface
**Found in:** CloudPanel, HestiaCP

**What's missing:**
- phpMyAdmin integration for MySQL
- pgAdmin or similar for PostgreSQL
- In-app SQL query runner
- Visual schema browser
- Export/import tools

**Why it matters:**
Database management without a GUI is painful. Competitors bundle this.

**Implementation scope:** Low-Medium
```
Options:
A) Embed phpMyAdmin/Adminer (quick)
B) Build custom query interface (more work, better UX)
C) One-click deploy phpMyAdmin as app (hybrid)
```

---

### 7. Deployment Rollback
**Found in:** Coolify, CapRover, Dokploy

**What's missing:**
- Version history of deployments
- One-click rollback to previous version
- Deployment comparison (diff view)
- Automatic rollback on health check failure

**Why it matters:**
Deployments can break things. Easy rollback = confidence to deploy frequently.

**Implementation scope:** Medium
```
Components needed:
- Deployment versioning (keep previous N images/states)
- Rollback API endpoint
- Health check integration
- Deployment history UI
```

---

### 8. Environment Variable Management
**Found in:** Coolify, Dokploy, CapRover

**What's missing:**
- Centralized .env management per app
- Secret masking in UI
- Environment inheritance (global > app > service)
- Import/export .env files
- Variable versioning

**Why it matters:**
Modern apps are configured via environment variables. Managing these well is essential.

**Implementation scope:** Low
```
Components needed:
- Encrypted storage for secrets
- UI for key-value management
- Injection into app containers/processes
- History/audit log
```

---

### 9. Build Pipeline / CI Integration
**Found in:** Coolify, Dokploy

**What's missing:**
- Build logs streaming
- Build status indicators
- Custom build commands
- Dockerfile auto-detection
- Buildpack support (like Heroku)
- GitHub Actions integration

**Why it matters:**
"Deploy" isn't just "run container" - it's build, test, then run. Users need visibility.

**Implementation scope:** High
```
Components needed:
- Build queue system
- Log streaming via WebSocket
- Build configuration per app
- Dockerfile/nixpacks/buildpacks support
- Build cache management
```

---

### 10. Notification System
**Found in:** Coolify (Discord, Telegram, Email)

**What's missing:**
- Multi-channel notifications
- Slack integration
- Discord webhook
- Telegram bot
- PagerDuty/Opsgenie integration
- Customizable alert rules

**Current:** Email only (basic)

**Why it matters:**
Admins need to know when things break - in channels they already use.

**Implementation scope:** Low-Medium
```
Components needed:
- Notification provider abstraction
- Webhook sender for Discord/Slack
- Telegram bot integration
- User notification preferences
```

---

## Medium Priority Gaps (P2)

### 11. Team/Organization Management
**Found in:** Portainer, Cloudron

**What's missing:**
- Multiple users per organization
- Role-based access (Admin, Developer, Viewer)
- Per-app access control
- Audit logging of user actions
- SSO/LDAP integration

**Implementation scope:** High

---

### 12. Resource Quotas/Limits
**Found in:** cPanel, Virtualmin

**What's missing:**
- CPU/RAM limits per app
- Disk quota per user
- Bandwidth limits
- Container resource constraints

**Implementation scope:** Medium

---

### 13. Staging/Preview Environments
**Found in:** Coolify

**What's missing:**
- One-click staging clone
- PR preview deployments
- Environment promotion (staging -> production)
- Isolated databases for staging

**Implementation scope:** High

---

### 14. Custom Domain Management
**Found in:** Coolify, CloudPanel

**What's missing:**
- Wildcard SSL certificates
- Subdomain auto-provisioning
- DNS record management (if DNS hosted)
- Domain verification flow

**Implementation scope:** Medium

---

### 15. Log Aggregation & Search
**Found in:** Portainer, Coolify

**What's missing:**
- Centralized log storage
- Full-text log search
- Log retention policies
- Log export to external systems (Loki, ELK)
- Log-based alerting

**Implementation scope:** Medium-High

---

### 16. API Rate Limiting Dashboard
**Found in:** Various

**What's missing:**
- Visual rate limit configuration
- Per-endpoint limits
- Rate limit monitoring
- IP whitelist for rate limiting

**Implementation scope:** Low

---

### 17. CLI Tool
**Found in:** CapRover, Coolify

**What's missing:**
- `serverkit deploy` command
- `serverkit logs <app>`
- `serverkit ssh <app>`
- API token authentication
- Shell completions

**Implementation scope:** Medium

---

## Low Priority Gaps (P3)

### 18. Kubernetes Support
**Found in:** Portainer

Consider for future if targeting enterprise users.

---

### 19. Mobile App
**Found in:** None of the direct competitors

Opportunity to differentiate with mobile monitoring.

---

### 20. Plugin/Extension System
**Found in:** Webmin

Allow community to extend functionality.

---

### 21. White-Label Support
**Found in:** HestiaCP

For agencies reselling hosting.

---

### 22. Integrated CDN
**Found in:** None

Could partner with Cloudflare/BunnyCDN for one-click setup.

---

## Implementation Priority Matrix

| Gap | Impact | Effort | Priority Score |
|-----|:------:|:------:|:--------------:|
| Git Deployment | 10 | 7 | **P0** |
| One-Click Apps | 9 | 6 | **P0** |
| 2FA | 8 | 2 | **P0** |
| S3 Backups | 8 | 5 | **P0** |
| Multi-Server | 7 | 9 | P1 |
| Database GUI | 7 | 3 | **P1** |
| Rollback | 7 | 5 | P1 |
| Env Variables | 8 | 3 | **P1** |
| Build Pipeline | 8 | 8 | P1 |
| Notifications | 6 | 4 | P1 |
| Team Mgmt | 6 | 8 | P2 |
| Resource Quotas | 5 | 5 | P2 |
| Staging Env | 6 | 7 | P2 |
| CLI Tool | 5 | 5 | P2 |

*Impact: 1-10 (user value), Effort: 1-10 (dev time)*

---

## Quick Wins (High Impact, Low Effort)

1. **2FA** - 2-3 days, massive security improvement
2. **Environment Variables UI** - 2-3 days, developer essential
3. **Database GUI** (embed Adminer) - 1 day
4. **Notification webhooks** - 2-3 days
5. **Basic Git webhook receiver** - 3-5 days

---

## Recommendations

### Immediate Focus (This Month)
1. 2FA implementation
2. Environment variable management
3. Embed Adminer for database GUI
4. Basic Discord/Slack notifications

### Next Quarter
1. Full Git deployment pipeline
2. One-click app marketplace (start with 20)
3. S3 backup integration
4. Deployment rollback

### This Year
1. Multi-server architecture
2. Team/organization support
3. CLI tool
4. 100+ one-click apps
