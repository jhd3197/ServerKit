# ServerKit Documentation

Welcome to the ServerKit documentation. This guide will help you install, configure, and use ServerKit effectively.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Video: template to live app](https://youtu.be/TXfXFz6bVjs) | Watch a 4-minute AgentSite deployment through the template catalog and live Deploy Console |
| [Video: deploy a Git repository](https://youtu.be/Fv28qMERYDU) | Connect a repository, review detected settings and deploy through the three-step New Service wizard |
| [Installation Guide](INSTALLATION.md) | Complete setup instructions for Docker and manual installation |
| [Agent permission levels](AGENT_PERMISSION_LEVELS.md) | Monitor / Protect / Full: what each allows and how to change it |
| [Architecture](ARCHITECTURE.md) | System design, request flow, and diagrams |
| [Deployment Guide](DEPLOYMENT.md) | Production deployment, CLI commands, and configuration |
| [Local Development](LOCAL_DEVELOPMENT.md) | Run the panel locally for development |
| [API Reference](API.md) | Curated REST API examples (see note below about auto-generated docs) |
| [Multi-Environment Guide](MULTI_ENVIRONMENT.md) | Set up prod/dev WordPress pairs with shared database |
| [Multi-Server & Agent](https://github.com/jhd3197/serverkit-agent/blob/main/README.md) | Install the agent and connect remote servers (see also [pairing](pairing.md)) |

---

## Getting Started

### 1. Installation

Choose your preferred installation method:

- **[Docker Installation](INSTALLATION.md#quick-install-docker)** (Recommended) - Get started in minutes
- **[Manual Installation](INSTALLATION.md#manual-installation)** - Full control over the setup
- **[One-Line Install](../README.md#-quick-start)** - One-line installer for Ubuntu, Debian, Fedora, and RHEL/Rocky/AlmaLinux

### 2. Initial Setup

After installation:

1. Access ServerKit at `http://your-server-ip`
2. Create your admin account with the setup code the installer printed
   (`serverkit setup-code` shows it again; the first user becomes admin)
3. [Enable Two-Factor Authentication](INSTALLATION.md#enable-two-factor-authentication)
4. [Configure Notifications](INSTALLATION.md#configure-notification-webhooks)

### 3. Start Managing

- Add your first application from the Applications page
- Configure domains and SSL certificates
- Set up monitoring alerts
- Enable security scanning

---

## Feature Guides

### Application Management

ServerKit supports multiple application types:

| Type | Runtime | Process Manager |
|------|---------|-----------------|
| PHP / WordPress | PHP-FPM 8.x | Nginx |
| Python (Flask/Django) | Python 3.x | Gunicorn |
| Node.js | Node 18+ | PM2 |
| Docker | Containers | Docker Engine |

Each application includes:
- Environment variable management (encrypted)
- Log viewing and streaming
- Start/stop/restart controls
- Domain and SSL configuration

### Multi-Environment Support

ServerKit supports **multi-environment linking** for WordPress and other applications:

- **Production/Development Pairs** - Link apps as prod/dev environments
- **Shared Database** - Both environments can share the same MySQL database with different table prefixes
- **Environment Badges** - Visual indicators (PROD/DEV/STAGING) in the UI
- **Quick Navigation** - One-click switching between linked environments
- **Credential Propagation** - Automatically share database credentials between linked apps

**Common use case:** WordPress theme development
1. Production WordPress serves live traffic
2. Development WordPress shares the database (separate tables)
3. Develop themes in dev without affecting production

See the [Multi-Environment Setup Guide](MULTI_ENVIRONMENT.md) for detailed instructions.

### Domain & SSL

- **Nginx Virtual Hosts** - Automatic configuration generation
- **Let's Encrypt SSL** - Free certificates with auto-renewal
- **Custom Certificates** - Upload your own SSL certificates

### Database Management

Supported databases:
- MySQL / MariaDB
- PostgreSQL

Features:
- Create/delete databases
- User management
- Basic query interface

### Monitoring & Alerts

Real-time monitoring includes:
- CPU, RAM, disk usage
- Network traffic
- Server uptime history
- Process monitoring

Alert channels:
- Discord webhooks
- Slack webhooks
- Telegram bot
- Generic HTTP webhooks

### Security

- **Two-Factor Authentication** - TOTP-based (Google Authenticator, Authy)
- **Malware Scanning** - ClamAV integration
- **File Integrity Monitoring** - Detect unauthorized changes
- **Firewall Management** - UFW rule configuration

### Scheduled Tasks

- Visual cron job editor
- Execution history
- Enable/disable jobs
- Common schedule presets

---

## Configuration

### Environment Variables

ServerKit is configured via environment variables. See [.env.example](../.env.example) for all options.

**Required variables:**
```env
SECRET_KEY=your-secret-key
JWT_SECRET_KEY=your-jwt-secret
```

**Database options:**
```env
# SQLite (default)
DATABASE_URL=sqlite:///serverkit.db

# PostgreSQL (production)
DATABASE_URL=postgresql://user:pass@localhost/serverkit
```

### Notification Setup

Configure webhooks in Settings > Notifications or via environment:

```env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

---

## CLI Reference

ServerKit includes a management CLI:

```bash
# Service Management
serverkit start|stop|restart|status
serverkit logs [backend|frontend]
serverkit update

# User Management
serverkit create-admin
serverkit reset-password
serverkit list-users

# Database
serverkit init-db
serverkit migrate-db          # Apply schema updates
serverkit backup-db
serverkit restore-db <file>

# App Management
serverkit list-apps           # List all installed apps

# Cleanup Commands
serverkit cleanup-apps        # Delete all apps and containers
serverkit cleanup-apps --delete-volumes   # Also delete Docker volumes
serverkit factory-reset       # Complete reset (delete everything)

# Utilities
serverkit generate-keys
serverkit config
```

See [Deployment Guide](DEPLOYMENT.md) for complete CLI documentation.

---

## API Reference

ServerKit provides a REST API for automation and integration.

**Base URL:** `http://localhost:47927/api/v1`

**Authentication:** JWT Bearer tokens

Quick example:
```bash
# Login
curl -X POST http://localhost:47927/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "password"}'

# Use token
curl http://localhost:47927/api/v1/system/stats \
  -H "Authorization: Bearer <token>"
```

See [API Reference](API.md) for curated examples.

> **Auto-generated API docs:** the running panel generates an OpenAPI 3.0 spec from
> the actual routes and serves Swagger UI at **`/api/v1/docs`** (raw spec at
> `/api/v1/docs/openapi.json`). That is always in sync with the code — prefer it
> over `API.md` when the two disagree.

---

## Documentation Map

The `docs/` folder mixes three audiences. Use this map to find what you need:

**User / operator docs** (stable, safe to rely on):
[Installation](INSTALLATION.md) · [Deployment](DEPLOYMENT.md) ·
[Local Development](LOCAL_DEVELOPMENT.md) · [Architecture](ARCHITECTURE.md) ·
[Backup & Protection](BACKUP_PROTECTION.md) ·
[Multi-Environment](MULTI_ENVIRONMENT.md) · [Agent Pairing](pairing.md) ·
[MCP Server Access](MCP_SERVER_ACCESS.md) ·
[Cloudflare Token Scopes](CLOUDFLARE_TOKEN_SCOPES.md) ·
[Coexistence](COEXISTENCE.md) · [Runbooks](runbooks/)

**Extension & platform author docs**:
[Extensions](EXTENSIONS.md) · [Extensions CI](EXTENSIONS_CI.md) ·
[Extensions Registry](EXTENSIONS_REGISTRY.md) · [Registries](REGISTRIES.md) ·
[serverkit.yaml](SERVERKIT_YAML.md) ·
[Template Catalog Schema](TEMPLATE_CATALOG_SCHEMA.md) · [Theming](THEMING.md) ·
[Fleet Contract](FLEET_CONTRACT.md) · [Workspace Scoping](WORKSPACE_SCOPING.md) ·
[Notifications Contract](NOTIFICATIONS_CONTRACT.md) · [ADRs](adr/)

**Internal working docs** (dev plans, specs, audits — may be stale or
aspirational, not user documentation):
[plans/](plans/) · [audits/](audits/) · roadmap and spec files at this level
(`*_ROADMAP.md`, `*_SPEC.md`, `ENHANCEMENTS.md`, `NEW_FEATURES.md`, etc.)

---

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
docker compose logs backend
sudo lsof -i :47927
```

**502 Bad Gateway:**
```bash
sudo systemctl status serverkit
sudo tail -f /var/log/serverkit/error.log
```

**ClamAV not working:**
```bash
sudo freshclam
sudo systemctl restart clamav-daemon
```

See [Installation Guide - Troubleshooting](INSTALLATION.md#troubleshooting) for more solutions.

---

## Additional Resources

- [Main README](../README.md) - Project overview and quick start
- [Roadmap](../ROADMAP.md) - Development plans and upcoming features
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute
- [GitHub Issues](https://github.com/jhd3197/ServerKit/issues) - Report bugs or request features

---

## Support

- **Bug Reports:** [GitHub Issues](https://github.com/jhd3197/ServerKit/issues)
- **Feature Requests:** [GitHub Issues](https://github.com/jhd3197/ServerKit/issues) with `enhancement` label
- **Security Issues:** Please report privately via GitHub Security Advisories

---

<p align="center">
  <strong>ServerKit Documentation</strong><br>
  Version 1.6.7
</p>
