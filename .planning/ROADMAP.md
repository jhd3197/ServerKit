# ServerKit Roadmap

A modern, self-hosted server management panel - alternative to ServerPilot/CyberPanel.

---

## Phase 1: Foundation & Core Infrastructure

### 1.1 Project Setup
- [x] Initialize React frontend with Vite
- [x] Create admin dashboard mockup/design system
- [ ] Set up Flask backend structure
- [ ] Configure SQLAlchemy with SQLite/PostgreSQL
- [ ] Set up Docker development environment
- [ ] Configure CORS and API routing
- [ ] Implement JWT authentication system

### 1.2 User Management
- [ ] User registration and login
- [ ] Role-based access control (Admin, User)
- [ ] Session management
- [ ] Password reset functionality
- [ ] API token generation for CLI access

### 1.3 Core API Structure
```
/api/v1/
├── auth/          # Authentication endpoints
├── servers/       # Server management
├── apps/          # Application management
├── domains/       # Domain configuration
├── databases/     # Database management
├── ssl/           # SSL certificate management
└── system/        # System metrics and logs
```

---

## Phase 2: Server Agent & System Integration

### 2.1 Server Agent (Python)
- [ ] System metrics collection (CPU, RAM, Disk, Load)
- [ ] Process monitoring and management
- [ ] Service control (start, stop, restart)
- [ ] Log aggregation and streaming
- [ ] WebSocket connection for real-time updates

### 2.2 Nginx Management
- [ ] Nginx configuration generator
- [ ] Virtual host management
- [ ] Reverse proxy configuration
- [ ] Load balancing setup
- [ ] Configuration validation and reload

### 2.3 SSL/TLS Management
- [ ] Let's Encrypt integration (Certbot)
- [ ] Auto-renewal setup
- [ ] Custom certificate upload
- [ ] SSL status monitoring
- [ ] Force HTTPS redirects

---

## Phase 3: PHP & WordPress Support

### 3.1 PHP-FPM Management
- [ ] PHP 8.2 FPM pool configuration
- [ ] Multiple PHP version support (8.0, 8.1, 8.2, 8.3)
- [ ] Per-site PHP configuration
- [ ] PHP extensions management
- [ ] OPcache configuration

### 3.2 WordPress Toolkit
- [ ] One-click WordPress installation
- [ ] WP-CLI integration
- [ ] Automatic updates management
- [ ] Backup and restore
- [ ] Staging environment creation
- [ ] Database optimization tools

### 3.3 WordPress-Specific Features
- [ ] Plugin/theme management
- [ ] wp-config.php editor
- [ ] Security hardening
- [ ] Performance optimization
- [ ] Search & replace tool

---

## Phase 4: Python Application Support

### 4.1 Python Runtime Management
- [ ] Multiple Python version support (3.9, 3.10, 3.11, 3.12)
- [ ] Virtual environment management
- [ ] pip package management
- [ ] Requirements.txt handling

### 4.2 Flask Application Deployment
- [ ] Gunicorn/uWSGI configuration
- [ ] Environment variables management
- [ ] Application process management
- [ ] Log routing and monitoring
- [ ] Static file serving

### 4.3 Django Application Deployment
- [ ] Django-specific configuration
- [ ] Static/media file handling
- [ ] Database migrations support
- [ ] Celery worker management
- [ ] Django admin access

---

## Phase 5: Docker Container Management

### 5.1 Docker Integration
- [ ] Docker daemon connection
- [ ] Container listing and management
- [ ] Image management (pull, remove)
- [ ] Container logs streaming
- [ ] Resource usage monitoring

### 5.2 Docker Compose Support
- [ ] Compose file editor
- [ ] Stack deployment
- [ ] Service scaling
- [ ] Network management
- [ ] Volume management

### 5.3 Container Features
- [ ] Container shell access (WebSocket terminal)
- [ ] Environment variable management
- [ ] Port mapping configuration
- [ ] Container health checks
- [ ] Auto-restart policies

---

## Phase 6: Database Management

### 6.1 MySQL/MariaDB
- [ ] Database creation and management
- [ ] User and privilege management
- [ ] phpMyAdmin integration
- [ ] Backup and restore
- [ ] Query execution interface

### 6.2 PostgreSQL
- [ ] Database creation and management
- [ ] User and privilege management
- [ ] pgAdmin integration (optional)
- [ ] Backup and restore

### 6.3 Redis (Optional)
- [ ] Redis server management
- [ ] Key browser
- [ ] Memory usage monitoring

---

## Phase 7: Frontend Dashboard (React)

### 7.1 Dashboard Components
- [ ] Server overview with real-time metrics
- [ ] Application cards with status indicators
- [ ] Quick actions panel
- [ ] Activity feed
- [ ] Resource usage charts (Recharts)

### 7.2 Application Management UI
- [ ] Application list view
- [ ] Application detail page
- [ ] Deployment wizard
- [ ] Configuration editor
- [ ] Log viewer

### 7.3 Domain Management UI
- [ ] Domain list and management
- [ ] DNS records editor (if applicable)
- [ ] SSL certificate status
- [ ] Domain routing configuration

### 7.4 System Pages
- [ ] Web-based terminal (xterm.js)
- [ ] File manager
- [ ] Cron job manager
- [ ] Firewall configuration
- [ ] Settings and preferences

---

## Phase 8: Advanced Features

### 8.1 Monitoring & Alerts
- [ ] Uptime monitoring
- [ ] Resource threshold alerts
- [ ] Email/webhook notifications
- [ ] Custom alert rules
- [ ] Incident history

### 8.2 Backup System
- [ ] Scheduled backups
- [ ] Multiple backup destinations (local, S3, etc.)
- [ ] One-click restore
- [ ] Backup encryption
- [ ] Retention policies

### 8.3 Git Deployment
- [ ] GitHub/GitLab webhook integration
- [ ] Auto-deploy on push
- [ ] Deploy hooks (pre/post)
- [ ] Rollback functionality
- [ ] Deployment history

---

## Phase 9: Security & Hardening

### 9.1 Security Features
- [ ] Fail2ban integration
- [ ] UFW firewall management
- [ ] SSH key management
- [ ] Two-factor authentication
- [ ] Audit logging

### 9.2 Malware Protection
- [ ] File integrity monitoring
- [ ] Malware scanning (ClamAV)
- [ ] Suspicious activity detection

---

## Phase 10: Polish & Production

### 10.1 Documentation
- [ ] User documentation
- [ ] API documentation
- [ ] Installation guide
- [ ] Troubleshooting guide

### 10.2 Testing
- [ ] Unit tests (pytest)
- [ ] Integration tests
- [ ] E2E tests (Playwright/Cypress)
- [ ] Load testing

### 10.3 Production Readiness
- [ ] Production Docker image
- [ ] One-liner installation script
- [ ] Update mechanism
- [ ] Migration tools
- [ ] CLI tool for management

---

## Tech Stack Summary

| Component | Technology |
|-----------|------------|
| **Backend** | Python 3.11+, Flask, SQLAlchemy |
| **Frontend** | React 18, Vite, TailwindCSS |
| **Database** | SQLite (dev), PostgreSQL (prod) |
| **Web Server** | Nginx |
| **Process Manager** | Supervisor/systemd |
| **Container Runtime** | Docker |
| **Task Queue** | Celery + Redis (optional) |
| **Real-time** | WebSocket (Flask-SocketIO) |

---

## Milestones

| Milestone | Target | Status |
|-----------|--------|--------|
| **v0.1 - Alpha** | Core API + Auth + Basic Dashboard | Not Started |
| **v0.2 - PHP Support** | PHP-FPM + WordPress | Not Started |
| **v0.3 - Python Apps** | Flask/Django deployment | Not Started |
| **v0.4 - Docker** | Container management | Not Started |
| **v0.5 - Databases** | MySQL/PostgreSQL management | Not Started |
| **v1.0 - Stable** | Production ready | Not Started |

---

## Contributing

1. Pick an unchecked item from the roadmap
2. Create a feature branch
3. Implement with tests
4. Submit a PR

---

*Last updated: January 2026*
