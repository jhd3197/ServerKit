# ServerKit Deployment Guide

Complete guide for deploying ServerKit on Ubuntu servers.

## Deployment model (important)

ServerKit's backend **manages the host it runs on** — it creates app
directories under `/var/serverkit/apps`, drives the host Docker daemon (one
container per managed app), reloads nginx, and runs systemctl/firewall/PHP-FPM.
A backend running *inside a container* cannot do any of that. So the canonical
deployment installed by `./serverkit install` (`install.sh`) runs **fully off
Docker for the panel itself**:

- the **backend on the host** via systemd (`serverkit.service`), and
- the **frontend as static files served directly by host nginx** from
  `frontend/dist` (built by `install.sh`) — no container. Host nginx serves the
  SPA at `location /` and proxies `/api` + `/socket.io` to the host backend on
  `:5000`.

Docker is therefore used **only for the workloads you host** (one container per
managed app). This is deliberate: a ServerKit update never touches those
containers, and host nginx — which reverse-proxies them — is only ever
*reloaded*, never stopped, so updating the panel causes **zero downtime for
hosted apps**.

Do **not** add the backend into Docker — a containerized backend fails
app/WordPress creation with `Permission denied: /var/serverkit/apps/...` and has
no access to the host Docker daemon. A containerized *frontend* is still
available as an opt-in escape hatch (`docker compose --profile legacy-frontend
up -d`, plus repointing nginx `location /` at `127.0.0.1:3847`) but is not used
by the default install. The single-container image in `./Dockerfile` exists only
for throwaway demos and, as its header states, cannot manage the host.

## Quick Install (Ubuntu)

```bash
# One-line install
curl -fsSL https://serverkit.ai/install.sh | bash

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
# Show the setup code the first admin registration needs
serverkit setup-code

# Create admin user
serverkit create-admin
# Prompts for: email, username, password
# (or: serverkit create-admin --email a@b.com --username admin --password '...')

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

## Starting from a framework (Laravel)

**New Service → Start from a framework** scaffolds a brand-new project instead
of importing an existing one. Laravel is the first framework; the picker reads
`backend/app/services/framework_registry.py`, so adding another (Next.js,
Django, ...) is a new registry entry plus a scaffold runner, not a UI rewrite.

You give it a service name, an optional domain, and whether to **Add MySQL**
(on by default for Laravel). ServerKit then runs one job in the Deploy Console:

1. **Scaffold** with `composer create-project laravel/laravel:^11.0` into
   `/var/serverkit/apps/<name>`. Composer runs in the official `composer:2`
   container, so the host needs **Docker but not PHP or Composer**. A host
   `composer` + `php` is used only when Docker is absent.
2. **Image**: writes a `Dockerfile` for PHP 8.3 FPM + nginx with the document
   root at `public/` (never `php -S`), the Laravel extensions (`pdo_mysql`,
   `mbstring`, `tokenizer`, `xml`, `ctype`, `json`, `bcmath`, `openssl`,
   `fileinfo`, `intl`, `zip`, `exif`, `pcntl`, `gd`, `opcache`) and a
   `.dockerignore` that keeps `.env` out of the image.
3. **Environment**: writes `.env` from `.env.example` with a fresh `APP_KEY`
   (same format as `php artisan key:generate`, kept stable across retries),
   `APP_ENV=production` and `APP_URL` from your domain, or the assigned
   `host:port` when there is none. The same values are set as service env vars.
4. **MySQL**: installs the `mysql` engine template as `<name>-db` and wires
   `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` onto the
   app as [`fromService` references](SERVERKIT_YAML.md#environment-variables).
   Nobody types a password and none is written to the project files.
5. **Deploy**, then **`php artisan migrate --force`** inside the app container
   once the database accepts connections (retried while MySQL boots). A failed
   migration fails the job and its output is shown in the console. Retry the
   job after fixing the cause; every step is safe to repeat.

Without MySQL the app uses SQLite inside the container, which is lost on
redeploy. Use it for trying things out.

## PHP images from the build pack

Repositories with a `composer.json` (Laravel included) get a generated image
based on `php:<version>-fpm` with nginx, serving `public/` when it exists. A
failing `composer install` or build command now fails the image build; earlier
versions appended `|| true` to both and shipped a broken image. Plans saved
before this change that still carry `php -S ... -t public` are regenerated as
FPM + nginx with the same document root.

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

Both panel tiers run on the host: the backend under systemd
(`serverkit.service`) and the frontend as static files served by host nginx from
`frontend/dist`. `./serverkit install` builds the bundle and wires nginx for
you. See the **Deployment model** note above.

```bash
# Build the SPA bundle host nginx serves (install.sh does this automatically)
cd frontend && npm ci && npm run build && cd ..

# Start the host backend + nginx
sudo systemctl start serverkit
sudo systemctl reload nginx

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

### Host data locations

The backend runs on the host, so its data lives on the host filesystem (not in
Docker volumes):

| Path | Purpose |
|------|---------|
| `/opt/serverkit/backend/instance/serverkit.db` | SQLite database (default) |
| `/var/serverkit/apps/` | Managed app directories (one per app) |
| `/etc/serverkit/` | Config (templates, ssl-mode, install state) |
| `/var/backups/serverkit/` | Backups |

## Common Tasks

### Auto-renew SSL Certificate

Certbot installs its own renewal timer, and host nginx reads the certificates
straight out of `/etc/letsencrypt/live/`, so there is nothing to copy and no
container to restart. Verify it is armed:

```bash
# The renewal timer certbot installed
systemctl list-timers | grep certbot

# Dry-run a renewal without touching the live certificate
sudo certbot renew --dry-run
```

Only if the timer is missing, add a cron entry that reloads host nginx:

```bash
sudo crontab -e
# Renew at 2:30 AM daily, reload nginx only when something actually renewed
30 2 * * * certbot renew --quiet --deploy-hook "systemctl reload nginx"
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

### Panel won't start

This guide covers the **host install**, where the panel is a systemd service and
not a container — do not reach for `docker compose` here, it would build a second,
separate all-in-one panel beside this one.

```bash
# Check logs
serverkit logs backend

# Restart the service
serverkit restart
serverkit status

# Deeper diagnosis
serverkit doctor
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
# Find what's using port 80 (host nginx) or 5000 (the panel backend)
sudo lsof -i :80
sudo lsof -i :5000
```

### Reset everything

```bash
# Delete all managed apps, containers, folders and orphaned Docker resources
serverkit factory-reset

# Bring the panel back up
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
