# ServerKit Documentation

Welcome to the ServerKit documentation. This guide will help you install, configure, and use ServerKit effectively.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Installation Guide](INSTALLATION.md) | Complete setup instructions for Docker and manual installation |
| [Deployment Guide](DEPLOYMENT.md) | Production deployment, CLI commands, and configuration |
| [API Reference](API.md) | REST API documentation with examples |

---

## Getting Started

### 1. Installation

Choose your preferred installation method:

- **[Docker Installation](INSTALLATION.md#quick-install-docker)** (Recommended) - Get started in minutes
- **[Manual Installation](INSTALLATION.md#manual-installation)** - Full control over the setup
- **[One-Line Install](../README.md#option-2-one-line-install-ubuntu)** - Quick Ubuntu script

### 2. Initial Setup

After installation:

1. Access ServerKit at `http://your-server-ip`
2. Create your admin account (first user becomes admin)
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

# User Management
serverkit create-admin
serverkit reset-password

# Database
serverkit backup-db
serverkit restore-db <backup-file>

# Utilities
serverkit generate-keys
serverkit logs [service]
serverkit update
```

See [Deployment Guide](DEPLOYMENT.md) for complete CLI documentation.

---

## API Reference

ServerKit provides a REST API for automation and integration.

**Base URL:** `http://localhost:5000/api/v1`

**Authentication:** JWT Bearer tokens

Quick example:
```bash
# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "password"}'

# Use token
curl http://localhost:5000/api/v1/system/stats \
  -H "Authorization: Bearer <token>"
```

See [API Reference](API.md) for complete documentation.

---

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
docker compose logs backend
sudo lsof -i :5000
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
  Version 0.9.0
</p>
