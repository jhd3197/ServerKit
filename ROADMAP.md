# ServerKit Roadmap

This document outlines the development roadmap for ServerKit. Features are organized by phases and priority.

---

## Current Version: v0.9.0

### Recently Completed

- **Two-Factor Authentication (2FA)** - TOTP-based with backup codes
- **Notification Webhooks** - Discord, Slack, Telegram, generic webhooks
- **ClamAV Integration** - Malware scanning with quarantine
- **File Integrity Monitoring** - Baseline creation and change detection
- **Environment Variable Management** - Secure, encrypted per-app variables
- **Cron Job Management** - Visual cron editor
- **Server Uptime Tracking** - Historical uptime data and visualization

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

## Phase 9: Firewall Management (Completed)

- [x] UFW firewall integration
- [x] Visual rule management
- [x] Common port presets
- [x] Rule enable/disable

---

## Phase 10: Multi-Server Management (Planned)

**Priority: High**

- [ ] Agent-based remote server monitoring
- [ ] Centralized dashboard for multiple servers
- [ ] Server grouping and tagging
- [ ] Cross-server metrics comparison
- [ ] Remote command execution
- [ ] Server health overview

---

## Phase 11: Git Deployment (Planned)

**Priority: High**

- [ ] GitHub/GitLab webhook integration
- [ ] Automatic deployment on push
- [ ] Branch selection for deployment
- [ ] Rollback to previous deployments
- [ ] Deployment history and logs
- [ ] Pre/post deployment scripts
- [ ] Zero-downtime deployments

---

## Phase 12: Backup & Restore (Planned)

**Priority: High**

- [ ] Automated database backups
- [ ] File/directory backups
- [ ] S3-compatible storage support
- [ ] Backblaze B2 integration
- [ ] Backup scheduling
- [ ] One-click restore
- [ ] Backup retention policies
- [ ] Offsite backup verification

---

## Phase 13: Email Server Management (Planned)

**Priority: Medium**

- [ ] Postfix mail server setup
- [ ] Dovecot IMAP/POP3 configuration
- [ ] Email account management
- [ ] Spam filtering (SpamAssassin)
- [ ] DKIM/SPF/DMARC configuration
- [ ] Webmail interface integration
- [ ] Email forwarding rules

---

## Phase 14: Advanced SSL Features (Planned)

**Priority: Medium**

- [ ] Wildcard SSL certificates
- [ ] Multi-domain certificates (SAN)
- [ ] Custom certificate upload
- [ ] Certificate expiry monitoring
- [ ] Automatic renewal notifications

---

## Phase 15: Team & Permissions (Planned)

**Priority: Medium**

- [ ] Multi-user support
- [ ] Role-based access control (RBAC)
- [ ] Custom permission sets
- [ ] Audit logging per user
- [ ] Team invitations
- [ ] Activity dashboard

---

## Phase 16: API Enhancements (Planned)

**Priority: Medium**

- [ ] API key management
- [ ] Rate limiting
- [ ] Webhook event subscriptions
- [ ] OpenAPI/Swagger documentation
- [ ] API usage analytics

---

## Phase 17: Advanced Security (Planned)

**Priority: High**

- [ ] Fail2ban integration
- [ ] SSH key management
- [ ] IP allowlist/blocklist
- [ ] Brute force protection
- [ ] Security audit reports
- [ ] Vulnerability scanning
- [ ] Automatic security updates

---

## Phase 18: Performance Optimization (Planned)

**Priority: Low**

- [ ] Redis caching integration
- [ ] Database query optimization
- [ ] Static asset CDN support
- [ ] Lazy loading for large datasets
- [ ] Background job queue (Celery)

---

## Phase 19: Mobile App (Planned)

**Priority: Low**

- [ ] React Native mobile application
- [ ] Push notifications
- [ ] Quick actions (restart, view stats)
- [ ] Biometric authentication

---

## Phase 20: Marketplace & Extensions (Planned)

**Priority: Low**

- [ ] Plugin/extension system
- [ ] Community marketplace
- [ ] Custom dashboard widgets
- [ ] Theme customization

---

## Version Milestones

| Version | Target Features | Status |
|---------|-----------------|--------|
| v0.9.0 | Core features, 2FA, Notifications, Security | Current |
| v1.0.0 | Production-ready stable release | Planned |
| v1.1.0 | Multi-server, Git deployment | Planned |
| v1.2.0 | Backups, Advanced SSL, Advanced Security | Planned |
| v1.3.0 | Email server, API enhancements | Planned |
| v1.4.0 | Team & permissions | Planned |
| v1.5.0 | Performance optimizations | Planned |
| v2.0.0 | Mobile app, Marketplace | Future |

---

## Contributing

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Priority areas for contributions:**
- Multi-server agent development
- Git webhook integration
- S3/B2 backup implementations
- Additional notification channels
- UI/UX improvements
- Documentation

---

## Feature Requests

Have a feature idea? Open an issue on GitHub with the `enhancement` label.

---

<p align="center">
  <strong>ServerKit Roadmap</strong><br>
  Last updated: January 2026
</p>
