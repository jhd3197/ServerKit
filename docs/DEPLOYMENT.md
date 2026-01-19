# ServerKit Deployment Guide

Complete guide for deploying ServerKit on Ubuntu servers.

## Quick Install (Ubuntu)

```bash
# One-line install
curl -fsSL https://raw.githubusercontent.com/jhd3197/serverkit/main/install.sh | bash

# Or clone and install manually
git clone https://github.com/jhd3197/serverkit.git
cd serverkit
chmod +x serverkit
./serverkit install
```

## Prerequisites

- Ubuntu 20.04+ (or Debian 11+)
- Docker 20.10+ and Docker Compose 2.0+
- At least 1GB RAM
- Domain name (for SSL/HTTPS)

## CLI Commands

ServerKit includes a management CLI for common administrative tasks.

### Service Management

```bash
# Start/Stop/Restart
serverkit start
serverkit stop
serverkit restart

# View status
serverkit status

# View logs
serverkit logs              # All services
serverkit logs backend      # Backend only
serverkit logs frontend     # Frontend only

# Update to latest version
serverkit update

# Uninstall
serverkit uninstall
```

### User Management

```bash
# Create admin user
serverkit create-admin
# Prompts for: email, username, password

# Reset a user's password
serverkit reset-password
# Prompts for: email, new password

# Unlock a locked account (after failed login attempts)
serverkit unlock-user
# Prompts for: email

# List all users
serverkit list-users

# Promote user to admin
serverkit make-admin
# Prompts for: email

# Deactivate/Activate user
serverkit deactivate-user
serverkit activate-user
```

### Database Management

```bash
# Initialize database
serverkit init-db

# Apply database migrations (after updates)
serverkit migrate-db

# Backup database
serverkit backup-db
# Creates: backup/serverkit-YYYYMMDD-HHMMSS.db

# Restore from backup
serverkit restore-db backup/serverkit-20240115-120000.db
```

### App & Cleanup Commands

```bash
# List all installed applications (from database)
serverkit list-apps

# Also show all Docker containers (including infrastructure)
serverkit list-apps --all

# Delete all apps, containers, folders, and orphaned Docker resources
serverkit cleanup-apps

# Also delete Docker volumes
serverkit cleanup-apps --delete-volumes

# Keep database records (only delete containers/folders)
serverkit cleanup-apps --keep-db

# Complete factory reset (delete everything and start fresh)
# Preserves only serverkit-frontend infrastructure
serverkit factory-reset
```

**Note:** Cleanup commands will:
- Stop and remove all app containers
- Remove orphaned Docker containers (not tracked in database)
- Prune unused Docker networks
- Delete all folders in `/var/serverkit/apps/`
- Never touch ServerKit infrastructure (serverkit-frontend, serverkit-network)

### Utility Commands

```bash
# Generate secure keys for .env
serverkit generate-keys

# Edit configuration
serverkit config

# Open shell in backend container
serverkit shell

# Show help
serverkit help
```

## Manual Installation

### 1. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, then verify
docker --version
```

### 2. Clone Repository

```bash
git clone https://github.com/jhd3197/serverkit.git /opt/serverkit
cd /opt/serverkit
```

### 3. Configure Environment

```bash
# Generate secure keys
serverkit generate-keys

# Create .env file
cat > .env << 'EOF'
SECRET_KEY=<paste-generated-key>
JWT_SECRET_KEY=<paste-generated-key>
DATABASE_URL=sqlite:///serverkit.db
CORS_ORIGINS=https://yourdomain.com
PORT=80
SSL_PORT=443
FLASK_ENV=production
EOF
```

### 4. SSL Certificate Setup

#### Option A: Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt install certbot

# Get certificate (stop any service on port 80 first)
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
sudo chown -R $USER:$USER nginx/ssl/
```

#### Option B: Self-Signed (Development Only)

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

### 5. Build and Start

```bash
# Build containers
docker compose build

# Start services
docker compose up -d

# Verify
serverkit status
```

### 6. Create Admin User

```bash
serverkit create-admin
```

## Systemd Service

Run ServerKit as a system service:

```bash
# Copy service file
sudo cp deploy/serverkit.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable serverkit
sudo systemctl start serverkit

# Check status
sudo systemctl status serverkit
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Flask secret key | Required |
| `JWT_SECRET_KEY` | JWT signing key | Required |
| `DATABASE_URL` | Database connection string | `sqlite:///serverkit.db` |
| `CORS_ORIGINS` | Allowed CORS origins | `http://localhost` |
| `PORT` | HTTP port | `80` |
| `SSL_PORT` | HTTPS port | `443` |
| `FLASK_ENV` | Environment mode | `production` |

### Docker Volumes

| Volume | Purpose |
|--------|---------|
| `serverkit-data` | Database and application data |
| `nginx/ssl` | SSL certificates |

## Common Tasks

### Auto-renew SSL Certificate

```bash
# Add to crontab
sudo crontab -e

# Add this line (renews at 2:30 AM daily)
30 2 * * * certbot renew --quiet && cp /etc/letsencrypt/live/yourdomain.com/*.pem /opt/serverkit/nginx/ssl/ && docker compose -f /opt/serverkit/docker-compose.yml restart frontend
```

### Change Domain

1. Update `.env` file: `CORS_ORIGINS=https://newdomain.com`
2. Get new SSL certificate
3. Restart: `serverkit restart`

### Scale for Production

For high-traffic deployments, consider:

```bash
# Use PostgreSQL instead of SQLite
DATABASE_URL=postgresql://user:pass@localhost:5432/serverkit

# Add Redis for session storage
# Edit docker-compose.yml to add redis service
```

## Troubleshooting

### Container won't start

```bash
# Check logs
serverkit logs backend

# Rebuild
docker compose build --no-cache
docker compose up -d
```

### Permission denied errors

```bash
# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock

# Or add user to docker group
sudo usermod -aG docker $USER
# Then log out and back in
```

### Port already in use

```bash
# Find what's using port 80
sudo lsof -i :80

# Stop the service or change PORT in .env
```

### Reset everything

```bash
# Stop and remove all containers and volumes
serverkit stop
docker compose down -v

# Rebuild from scratch
docker compose build --no-cache
serverkit start
serverkit init-db
serverkit create-admin
```

### Locked out / Forgot password

```bash
# Reset password via CLI
serverkit reset-password
# Enter email and new password

# Or unlock account if locked
serverkit unlock-user
```

## Security Checklist

- [ ] Generated unique SECRET_KEY and JWT_SECRET_KEY
- [ ] Using HTTPS with valid SSL certificate
- [ ] Firewall configured (allow only ports 80, 443, 22)
- [ ] Regular backups configured
- [ ] Admin password is strong
- [ ] Updated to latest version

## Support

- GitHub Issues: https://github.com/jhd3197/serverkit/issues
- Documentation: https://github.com/jhd3197/serverkit/wiki
