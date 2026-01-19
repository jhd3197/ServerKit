<div align="center">

# ServerKit

<img width="700" alt="server-kit" src="https://github.com/user-attachments/assets/bfc59e75-8f90-4674-a222-e18213b628b7" />

**Self-hosted infrastructure, made simple**

<br>

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB.svg?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg?style=for-the-badge&logo=react&logoColor=black)](https://reactjs.org)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)

[![Flask](https://img.shields.io/badge/flask-3.0-000000.svg?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Nginx](https://img.shields.io/badge/nginx-reverse_proxy-009639.svg?style=flat-square&logo=nginx&logoColor=white)](https://nginx.org)
[![Let's Encrypt](https://img.shields.io/badge/SSL-Let's_Encrypt-003A70.svg?style=flat-square&logo=letsencrypt&logoColor=white)](https://letsencrypt.org)
[![MySQL](https://img.shields.io/badge/mysql-8.0-4479A1.svg?style=flat-square&logo=mysql&logoColor=white)](https://mysql.com)
[![PostgreSQL](https://img.shields.io/badge/postgresql-15-4169E1.svg?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Ubuntu](https://img.shields.io/badge/ubuntu-22.04+-E95420.svg?style=flat-square&logo=ubuntu&logoColor=white)](https://ubuntu.com)

<br>

[Features](#features) · [Quick Start](#quick-start) · [Documentation](#documentation) · [Architecture](docs/ARCHITECTURE.md) · [Contributing](#contributing)

</div>

---

## What is ServerKit?

ServerKit is a lightweight, modern server control panel for managing web applications, databases, Docker containers, and security on your VPS or dedicated server. Built with Python/Flask backend and React frontend.

**Perfect for:** Developers, freelancers, and small teams who want full control over their infrastructure without the complexity of Kubernetes or the cost of managed platforms.

---

## Architecture

<details>
<summary><strong>View How It Works</strong></summary>

<br>

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
│  │    app1.com ──┐      app2.com ──┐      api.app3.com ──┐            │ │
│  └───────────────┼─────────────────┼─────────────────────┼─────────────┘ │
│                  │ proxy_pass      │ proxy_pass          │ proxy_pass    │
│                  ▼                 ▼                     ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                      DOCKER CONTAINERS                              │ │
│  │                                                                     │ │
│  │    ┌───────────┐    ┌───────────┐    ┌───────────┐                 │ │
│  │    │ WordPress │    │   Flask   │    │  Node.js  │    ...          │ │
│  │    │   :8001   │    │   :8002   │    │   :8003   │                 │ │
│  │    └─────┬─────┘    └───────────┘    └───────────┘                 │ │
│  └──────────┼──────────────────────────────────────────────────────────┘ │
│             │                                                            │
│             ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                        DATABASES                                    │ │
│  │    MySQL :3306    PostgreSQL :5432    Redis :6379                  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

</details>

**[View Full Architecture Documentation →](docs/ARCHITECTURE.md)**

> Includes: Request flow diagrams, template system, port allocation, database linking, and troubleshooting guides.

---

## Features

### Application Management
- **PHP / WordPress** - PHP-FPM 8.x with one-click WordPress installation
- **Python Apps** - Deploy Flask and Django with Gunicorn
- **Node.js** - PM2-managed Node applications
- **Docker** - Full container and Docker Compose management
- **Environment Variables** - Secure, encrypted variable management per app

### Infrastructure
- **Domain Management** - Nginx virtual hosts with easy configuration
- **SSL Certificates** - Automatic Let's Encrypt with auto-renewal
- **Database Management** - MySQL/MariaDB and PostgreSQL support
- **Firewall (UFW)** - Visual firewall rule management
- **Cron Jobs** - Schedule tasks with a visual editor
- **File Manager** - Browse and edit files via web interface
- **FTP Server** - Manage vsftpd users and access

### Security
- **Two-Factor Authentication (2FA)** - TOTP-based with backup codes
- **ClamAV Integration** - Malware scanning with quarantine
- **File Integrity Monitoring** - Detect unauthorized file changes
- **Failed Login Detection** - Monitor suspicious login attempts
- **Security Alerts** - Real-time notifications for threats

### Monitoring & Alerts
- **Real-time Metrics** - CPU, RAM, disk, network monitoring
- **Server Uptime Tracking** - Historical uptime data
- **Alert Thresholds** - Customizable warning/critical levels
- **Notification Webhooks:**
  - Discord
  - Slack
  - Telegram
  - Generic webhooks

### Modern UI
- Dark-themed responsive dashboard
- Real-time WebSocket updates
- Mobile-friendly interface

---

## Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/6407ecf0-7a1a-4c4b-b7e3-8af6619da2f9" alt="Dashboard" width="100%">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/73807009-9538-48e9-bbdf-152aed57bdd8" alt="Applications" width="100%">
</p>

---

## Quick Start

### Option 1: One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/jhd3197/serverkit/main/install.sh | bash
```

> Works on Ubuntu 22.04+ and Debian 12+. Sets up everything automatically.

### Option 2: Docker

```bash
# Clone the repository
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit

# Configure environment
cp .env.example .env
nano .env  # Set SECRET_KEY and JWT_SECRET_KEY

# Start ServerKit
docker compose up -d

# Access at http://localhost
```

### Option 3: Manual Installation

See [Installation Guide](docs/INSTALLATION.md) for detailed instructions.

---

## Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 1 vCPU | 2+ vCPU |
| RAM | 1 GB | 2+ GB |
| Disk | 10 GB | 20+ GB |
| Docker | 24.0+ | Latest |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.11, Flask, SQLAlchemy, Flask-SocketIO |
| Frontend | React 18, Vite, LESS |
| Database | SQLite / PostgreSQL |
| Web Server | Nginx, Gunicorn |
| Containers | Docker, Docker Compose |
| Security | ClamAV, TOTP (pyotp), Cryptography |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, request flow, and diagrams |
| [Installation Guide](docs/INSTALLATION.md) | Complete setup instructions |
| [Deployment Guide](docs/DEPLOYMENT.md) | CLI commands and production deployment |
| [API Reference](docs/API.md) | REST API documentation |
| [Roadmap](ROADMAP.md) | Development roadmap and planned features |
| [Contributing](CONTRIBUTING.md) | How to contribute |

---

## Project Structure

```
ServerKit/
├── backend/                 # Flask API
│   ├── app/
│   │   ├── api/            # API endpoints
│   │   ├── models/         # Database models
│   │   └── services/       # Business logic
│   ├── config.py
│   └── requirements.txt
│
├── frontend/               # React application
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── services/      # API client
│   │   └── styles/        # LESS stylesheets
│   └── package.json
│
├── docs/                   # Documentation
├── docker-compose.yml      # Docker configuration
└── README.md
```

---

## CLI Commands

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

---

## Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Key configuration options:

```env
# Required - Generate unique values!
SECRET_KEY=your-secret-key
JWT_SECRET_KEY=your-jwt-secret

# Database (SQLite default, PostgreSQL for production)
DATABASE_URL=sqlite:///serverkit.db

# Your domain
CORS_ORIGINS=https://panel.yourdomain.com
```

Generate secure keys:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Notification Setup

ServerKit can send alerts to multiple channels:

### Discord
1. Create webhook: Server Settings → Integrations → Webhooks
2. Copy URL to Settings → Notifications → Discord

### Slack
1. Create app: api.slack.com → Incoming Webhooks
2. Copy URL to Settings → Notifications → Slack

### Telegram
1. Create bot via @BotFather
2. Get chat ID from @userinfobot
3. Configure in Settings → Notifications → Telegram

---

## Security Features

### Two-Factor Authentication
- TOTP-based (Google Authenticator, Authy, etc.)
- Backup codes for recovery
- Enable in Settings → Security

### Malware Scanning
- ClamAV integration
- Quick scan / Full scan options
- Automatic quarantine
- Configure in Security → Settings

### File Integrity Monitoring
- Baseline creation
- Change detection
- Alert on modifications

---

## API Overview

Base URL: `http://localhost:5000/api/v1`

```
Authentication:
  POST   /auth/login           # Login
  POST   /auth/register        # Register
  POST   /auth/2fa/verify      # 2FA verification

Applications:
  GET    /apps                 # List apps
  POST   /apps                 # Create app
  GET    /apps/:id             # Get app
  DELETE /apps/:id             # Delete app

Security:
  GET    /security/status      # Security summary
  POST   /security/scan/quick  # Quick malware scan
  GET    /security/events      # Security events

Notifications:
  GET    /notifications/config  # Get config
  PUT    /notifications/config/:channel  # Update channel
  POST   /notifications/test/:channel    # Test channel
```

Full API documentation: [docs/API.md](docs/API.md)

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request


---

<p align="center">
  <strong>ServerKit</strong> — Simple. Modern. Self-hosted.<br>
  <a href="https://github.com/jhd3197/ServerKit/issues">Report Bug</a> ·
  <a href="https://github.com/jhd3197/ServerKit/issues">Request Feature</a>
</p>

<p align="center">
  Made with ❤️ by <a href="https://juandenis.com">Juan Denis</a>
</p>
