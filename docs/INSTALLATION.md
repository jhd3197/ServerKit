# ServerKit Installation Guide

This guide covers installing ServerKit on Ubuntu 22.04/24.04 LTS. ServerKit is a modern server management panel for managing web applications, databases, Docker containers, and more.

## Table of Contents

- [Requirements](#requirements)
- [Quick Install (Docker)](#quick-install-docker)
- [Manual Installation](#manual-installation)
- [Post-Installation Setup](#post-installation-setup)
- [Security Configuration](#security-configuration)
- [Notification Setup](#notification-setup)
- [Troubleshooting](#troubleshooting)

---

## Requirements

### Minimum System Requirements

- **OS**: Ubuntu 22.04 LTS or 24.04 LTS (64-bit)
- **CPU**: 1 vCPU (2+ recommended)
- **RAM**: 1 GB minimum (2+ GB recommended)
- **Disk**: 10 GB free space
- **Network**: Public IP with ports 80, 443, and 5000 accessible

### Software Requirements

For Docker installation:
- Docker Engine 24.0+
- Docker Compose v2.0+

For manual installation:
- Python 3.11+
- Node.js 20+
- Nginx (optional, for reverse proxy)

---

## Quick Install (Docker)

This is the recommended installation method.

### Step 1: Install Docker

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install prerequisites
sudo apt install -y ca-certificates curl gnupg

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to docker group (logout/login required)
sudo usermod -aG docker $USER

# Verify installation
docker --version
docker compose version
```

### Step 2: Clone ServerKit

```bash
# Clone the repository
git clone https://github.com/yourusername/ServerKit.git
cd ServerKit
```

### Step 3: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate secure keys
echo "SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >> .env
echo "JWT_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >> .env

# Edit configuration
nano .env
```

**Important**: Update these values in `.env`:
- `SECRET_KEY` - Unique random string for Flask sessions
- `JWT_SECRET_KEY` - Unique random string for JWT tokens
- `CORS_ORIGINS` - Your domain (e.g., `https://panel.yourdomain.com`)

### Step 4: Start ServerKit

```bash
# Build and start containers
docker compose up -d

# View logs
docker compose logs -f

# Check status
docker compose ps
```

### Step 5: Access ServerKit

Open your browser and navigate to:
- **HTTP**: `http://your-server-ip`
- **HTTPS**: `https://your-server-ip` (if SSL configured)

Create your admin account on first visit.

---

## Manual Installation

For installations without Docker.

### Step 1: Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python 3.11
sudo apt install -y python3.11 python3.11-venv python3.11-dev python3-pip

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools and libraries
sudo apt install -y build-essential libffi-dev libssl-dev libpq-dev

# Install Nginx (for reverse proxy)
sudo apt install -y nginx

# Install ClamAV (for malware scanning)
sudo apt install -y clamav clamav-daemon clamav-freshclam

# Install other useful tools
sudo apt install -y git curl wget
```

### Step 2: Clone and Setup Backend

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/yourusername/ServerKit.git
sudo chown -R $USER:$USER ServerKit
cd ServerKit

# Create Python virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install Python dependencies
cd backend
pip install -r requirements.txt
pip install gunicorn gevent gevent-websocket
```

### Step 3: Build Frontend

```bash
# Navigate to frontend directory
cd /opt/ServerKit/frontend

# Install Node dependencies
npm ci

# Build production bundle
npm run build
```

### Step 4: Configure Environment

```bash
# Create environment file
cd /opt/ServerKit/backend
cp ../.env.example .env

# Generate and set secure keys
SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')

sed -i "s/SECRET_KEY=.*/SECRET_KEY=$SECRET/" .env
sed -i "s/JWT_SECRET_KEY=.*/JWT_SECRET_KEY=$JWT_SECRET/" .env

# Edit other settings
nano .env
```

### Step 5: Create ServerKit Directories

```bash
# Create required directories
sudo mkdir -p /etc/serverkit
sudo mkdir -p /var/log/serverkit
sudo mkdir -p /var/quarantine

# Set permissions
sudo chown -R $USER:$USER /etc/serverkit
sudo chown -R $USER:$USER /var/log/serverkit
sudo chown -R $USER:$USER /var/quarantine
```

### Step 6: Create Systemd Service

```bash
sudo nano /etc/systemd/system/serverkit.service
```

Add the following content:

```ini
[Unit]
Description=ServerKit Server Management Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ServerKit/backend
Environment="PATH=/opt/ServerKit/venv/bin"
Environment="FLASK_ENV=production"
ExecStart=/opt/ServerKit/venv/bin/gunicorn \
    --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker \
    --workers 1 \
    --bind 127.0.0.1:5000 \
    --timeout 120 \
    --access-logfile /var/log/serverkit/access.log \
    --error-logfile /var/log/serverkit/error.log \
    run:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable serverkit
sudo systemctl start serverkit
sudo systemctl status serverkit
```

### Step 7: Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/serverkit
```

Add the following configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # Change to your domain or IP

    # Frontend (static files)
    location / {
        root /opt/ServerKit/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/serverkit /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 8: Setup SSL with Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
sudo systemctl status certbot.timer
```

---

## Post-Installation Setup

### 1. Create Admin Account

1. Open ServerKit in your browser
2. Click "Register" to create your admin account
3. The first registered user automatically becomes admin

### 2. Update ClamAV Definitions

```bash
# Update virus definitions
sudo freshclam

# Restart ClamAV daemon
sudo systemctl restart clamav-daemon
```

### 3. Configure Firewall (UFW)

```bash
# Enable UFW
sudo ufw enable

# Allow SSH (important!)
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check status
sudo ufw status
```

---

## Security Configuration

### Enable Two-Factor Authentication

1. Go to **Settings > Security**
2. Click "Enable Two-Factor Authentication"
3. Scan the QR code with your authenticator app
4. Enter the verification code
5. **Save your backup codes securely!**

### Configure Notification Webhooks

Get alerts for security events, server issues, and more:

1. Go to **Settings > Notifications**
2. Configure your preferred channels:
   - **Discord**: Create a webhook in your server settings
   - **Slack**: Create an incoming webhook app
   - **Telegram**: Create a bot via @BotFather

### Enable File Integrity Monitoring

1. Go to **Security > File Integrity**
2. Click "Initialize Baseline" to create a snapshot
3. Periodically run "Check Integrity" to detect changes

---

## Notification Setup

### Discord Webhook

1. Open Discord and go to your server
2. Right-click a channel → Edit Channel → Integrations → Webhooks
3. Create a new webhook and copy the URL
4. In ServerKit: Settings → Notifications → Discord
5. Paste the webhook URL and enable

### Slack Webhook

1. Go to [Slack API](https://api.slack.com/apps)
2. Create a new app → Incoming Webhooks
3. Add a new webhook to your workspace
4. Copy the webhook URL
5. In ServerKit: Settings → Notifications → Slack

### Telegram Bot

1. Message @BotFather on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token
4. Get your chat ID from @userinfobot
5. In ServerKit: Settings → Notifications → Telegram

---

## Troubleshooting

### Docker Issues

**Container won't start:**
```bash
# Check logs
docker compose logs backend

# Check if port is in use
sudo lsof -i :5000
sudo lsof -i :80
```

**Permission denied errors:**
```bash
# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock
```

### Manual Installation Issues

**Python module not found:**
```bash
# Ensure virtual environment is activated
source /opt/ServerKit/venv/bin/activate
pip install -r requirements.txt
```

**Nginx 502 Bad Gateway:**
```bash
# Check if backend is running
sudo systemctl status serverkit

# Check backend logs
sudo tail -f /var/log/serverkit/error.log
```

**Database errors:**
```bash
# Reset database (WARNING: deletes all data)
cd /opt/ServerKit/backend
rm -f instance/serverkit.db
python -c "from app import create_app, db; app = create_app(); app.app_context().push(); db.create_all()"
```

### ClamAV Issues

**ClamAV not starting:**
```bash
# Check status
sudo systemctl status clamav-daemon

# Update definitions first
sudo systemctl stop clamav-freshclam
sudo freshclam
sudo systemctl start clamav-freshclam
sudo systemctl start clamav-daemon
```

### Getting Help

- Check logs in `/var/log/serverkit/`
- Docker logs: `docker compose logs -f`
- Open an issue on GitHub

---

## Updating ServerKit

### Docker Update

```bash
cd /path/to/ServerKit
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Manual Update

```bash
cd /opt/ServerKit
git pull

# Update backend
source venv/bin/activate
pip install -r backend/requirements.txt

# Update frontend
cd frontend
npm ci
npm run build

# Restart service
sudo systemctl restart serverkit
```

---

## Uninstalling

### Docker

```bash
cd /path/to/ServerKit
docker compose down -v  # -v removes volumes (data)
cd ..
rm -rf ServerKit
```

### Manual

```bash
sudo systemctl stop serverkit
sudo systemctl disable serverkit
sudo rm /etc/systemd/system/serverkit.service
sudo rm /etc/nginx/sites-enabled/serverkit
sudo rm /etc/nginx/sites-available/serverkit
sudo rm -rf /opt/ServerKit
sudo rm -rf /etc/serverkit
sudo rm -rf /var/log/serverkit
sudo systemctl daemon-reload
sudo systemctl reload nginx
```
