# ServerKit Deployment Guide

This guide covers deploying ServerKit in production using Docker.

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- A server with at least 1GB RAM
- A domain name (for SSL/HTTPS)
- SSL certificate (Let's Encrypt recommended)

## Quick Start (Development)

```bash
# Clone the repository
git clone https://github.com/yourusername/serverkit.git
cd serverkit

# Start with Docker Compose
docker compose up -d

# Access at http://localhost
```

## Production Deployment

### 1. Generate Secure Keys

```bash
# Generate SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"

# Generate JWT_SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"
```

### 2. Create Environment File

Create `.env` in the project root:

```bash
# Required - generate unique keys!
SECRET_KEY=your-generated-secret-key
JWT_SECRET_KEY=your-generated-jwt-secret-key

# Database (SQLite by default, or use PostgreSQL)
DATABASE_URL=sqlite:///serverkit.db
# DATABASE_URL=postgresql://user:pass@host:5432/serverkit

# CORS origins (your domain)
CORS_ORIGINS=https://yourdomain.com
```

### 3. SSL Certificate Setup

#### Using Let's Encrypt (Recommended)

```bash
# Create directories
mkdir -p nginx/ssl

# Install certbot and get certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
```

#### Using Self-Signed (Testing Only)

```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/CN=localhost"
```

### 4. Deploy

```bash
# Build and start production containers
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

### 5. Initial Setup

1. Navigate to `https://yourdomain.com`
2. Register the first admin user
3. Configure server monitoring settings

## Systemd Service (Optional)

Install as a system service for automatic startup:

```bash
# Copy the service file
sudo cp deploy/serverkit.service /etc/systemd/system/

# Copy project to /opt
sudo mkdir -p /opt/serverkit
sudo cp -r . /opt/serverkit/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable serverkit
sudo systemctl start serverkit

# Check status
sudo systemctl status serverkit
```

## Maintenance

### Updating

```bash
cd /opt/serverkit
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

### Backup Database

```bash
# SQLite
docker compose -f docker-compose.prod.yml exec backend \
  cp /app/instance/serverkit.db /app/instance/serverkit.db.backup

# Copy to host
docker cp serverkit-backend:/app/instance/serverkit.db.backup ./backup/
```

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f nginx
```

### Restart Services

```bash
docker compose -f docker-compose.prod.yml restart
# or
sudo systemctl restart serverkit
```

## Security Checklist

- [ ] Generated unique SECRET_KEY and JWT_SECRET_KEY
- [ ] SSL/TLS certificate configured
- [ ] Firewall configured (ports 80, 443 only)
- [ ] Regular backups configured
- [ ] Monitoring/alerting set up
- [ ] Rate limiting verified working
- [ ] Security headers present (check with browser dev tools)

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs backend

# Check if port is in use
sudo lsof -i :5000
sudo lsof -i :80
```

### 502 Bad Gateway

Usually means the backend isn't running:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml restart backend
```

### WebSocket connection failed

Ensure nginx is properly proxying WebSocket connections. Check the `/socket.io` location block in nginx.conf.

### SSL Certificate Issues

```bash
# Test certificate
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com

# Check certificate expiry
openssl x509 -in nginx/ssl/fullchain.pem -noout -dates
```

## Architecture

```
                    ┌─────────────┐
                    │   Client    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Nginx    │
                    │  (SSL/TLS)  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  Frontend   │ │   Backend   │ │  Socket.IO  │
    │   (React)   │ │   (Flask)   │ │ (WebSocket) │
    └─────────────┘ └──────┬──────┘ └─────────────┘
                           │
                    ┌──────▼──────┐
                    │   SQLite/   │
                    │  PostgreSQL │
                    └─────────────┘
```

## Support

For issues and questions, please open an issue on GitHub.
