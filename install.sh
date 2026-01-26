#!/bin/bash
#
# ServerKit Quick Install Script for Ubuntu/Debian
#
# Architecture:
#   - Backend: Runs directly on host (for full system access)
#   - Frontend: Runs in Docker (nginx serving static files)
#
# Usage: curl -fsSL https://serverkit.ai/install.sh | bash
#

set -e

# Safety: Move to a valid directory first
# Prevents "getcwd: cannot access parent directories" error
# when running from a deleted directory (e.g., after uninstall)
cd /tmp 2>/dev/null || cd / || true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="/opt/serverkit"
VENV_DIR="$INSTALL_DIR/venv"
LOG_DIR="/var/log/serverkit"
DATA_DIR="/var/lib/serverkit"

print_header() {
    echo -e "${BLUE}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ServerKit Installer"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "${NC}"
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

print_header

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (sudo)"
    exit 1
fi

# Check Ubuntu/Debian
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$ID" != "ubuntu" ] && [ "$ID" != "debian" ]; then
        print_warning "This script is designed for Ubuntu/Debian. Proceed with caution."
    fi
fi

echo ""
print_info "Installing system dependencies..."

# Configure needrestart for non-interactive mode (Ubuntu 22.04+)
# This prevents the "Which services should be restarted?" dialog
# and avoids dpkg lock issues during automated installs
export NEEDRESTART_MODE=a
export DEBIAN_FRONTEND=noninteractive

# Also configure needrestart.conf if it exists for future apt operations
if [ -f /etc/needrestart/needrestart.conf ]; then
    # Set needrestart to auto-restart mode
    sed -i "s/#\$nrconf{restart} = 'i';/\$nrconf{restart} = 'a';/" /etc/needrestart/needrestart.conf 2>/dev/null || true
fi

# Update package list
apt-get update

# Install Python and required packages
apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    git \
    curl \
    build-essential \
    libffi-dev \
    libssl-dev \
    iproute2 \
    procps

print_success "System dependencies installed"

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    print_info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    print_success "Docker installed"
else
    print_success "Docker already installed"
fi

# Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
    print_info "Installing Docker Compose..."
    apt-get install -y docker-compose-plugin
    print_success "Docker Compose installed"
else
    print_success "Docker Compose already installed"
fi

# Install Node.js for frontend build (builds on host to avoid Docker memory issues)
if ! command -v node &> /dev/null; then
    print_info "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    print_success "Node.js $(node --version) installed"
else
    print_success "Node.js $(node --version) already installed"
fi

# Clone or update repository
print_info "Installing ServerKit to $INSTALL_DIR..."

if [ -d "$INSTALL_DIR" ]; then
    print_warning "Directory exists, updating..."
    cd "$INSTALL_DIR"
    git fetch origin
    git reset --hard origin/main
else
    git clone https://github.com/jhd3197/serverkit.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

print_success "Repository cloned"

# Create directories
print_info "Creating directories..."
mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"
mkdir -p "$INSTALL_DIR/backend/instance"
mkdir -p "$INSTALL_DIR/nginx/ssl"
mkdir -p /etc/serverkit/templates
mkdir -p /var/serverkit/apps

# Copy bundled templates to system directory
print_info "Installing app templates..."
if [ -d "$INSTALL_DIR/backend/templates" ]; then
    cp -r "$INSTALL_DIR/backend/templates/"*.yaml /etc/serverkit/templates/ 2>/dev/null || true
    cp -r "$INSTALL_DIR/backend/templates/"*.yml /etc/serverkit/templates/ 2>/dev/null || true
    print_success "Installed $(ls /etc/serverkit/templates/*.yaml 2>/dev/null | wc -l) app templates"
fi

# Set up Python virtual environment
print_info "Setting up Python virtual environment..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install Python dependencies
print_info "Installing Python dependencies..."
pip install --upgrade pip
pip install -r "$INSTALL_DIR/backend/requirements.txt"
pip install gunicorn gevent gevent-websocket

print_success "Python dependencies installed"

# Generate .env if not exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
    print_info "Generating configuration..."
    SECRET_KEY=$(openssl rand -hex 32)
    JWT_SECRET_KEY=$(openssl rand -hex 32)

    cat > "$INSTALL_DIR/.env" << EOF
# ServerKit Configuration
# Generated on $(date)

# Security Keys (auto-generated, keep secret!)
SECRET_KEY=$SECRET_KEY
JWT_SECRET_KEY=$JWT_SECRET_KEY

# Database (SQLite by default)
DATABASE_URL=sqlite:///$INSTALL_DIR/backend/instance/serverkit.db

# CORS Origins (comma-separated, add your domain)
CORS_ORIGINS=http://localhost,https://localhost

# Ports
PORT=80
SSL_PORT=443

# Environment
FLASK_ENV=production
EOF

    print_success "Configuration generated"
else
    print_warning ".env already exists, keeping existing configuration"
fi

# Generate self-signed SSL certificate if not exists
if [ ! -f "$INSTALL_DIR/nginx/ssl/fullchain.pem" ]; then
    print_info "Generating self-signed SSL certificate..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$INSTALL_DIR/nginx/ssl/privkey.pem" \
        -out "$INSTALL_DIR/nginx/ssl/fullchain.pem" \
        -subj "/CN=localhost" 2>/dev/null
    print_warning "Self-signed certificate created. Replace with real cert for production."
fi

# Install systemd service for backend
print_info "Installing systemd service..."
cp "$INSTALL_DIR/serverkit-backend.service" /etc/systemd/system/serverkit.service

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable serverkit

print_success "Systemd service installed"

# Make CLI executable and create symlink
chmod +x "$INSTALL_DIR/serverkit"
ln -sf "$INSTALL_DIR/serverkit" /usr/local/bin/serverkit

print_success "CLI installed"

# Install and configure host nginx as reverse proxy
print_info "Setting up nginx reverse proxy..."
apt-get install -y nginx

# Stop nginx and remove default site
systemctl stop nginx 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/default

# Ensure sites directories exist
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

# Ensure nginx.conf includes sites-enabled
if ! grep -q "sites-enabled" /etc/nginx/nginx.conf; then
    sed -i '/http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
fi

# Install ServerKit site config
cp "$INSTALL_DIR/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/

# Copy site template
cp "$INSTALL_DIR/nginx/sites-available/example.conf.template" /etc/nginx/sites-available/

print_success "Nginx proxy configured"

# Clean up Docker to prevent issues
print_info "Cleaning up Docker..."
docker network prune -f 2>/dev/null || true
docker container prune -f 2>/dev/null || true

# Ensure swap exists for low-RAM VPS servers (Vite build needs ~512MB+)
SWAP_TOTAL=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$SWAP_TOTAL" -lt 512 ]; then
    print_info "Creating swap space for build..."
    if [ ! -f /swapfile ]; then
        fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
        chmod 600 /swapfile
        mkswap /swapfile >/dev/null
    fi
    swapon /swapfile 2>/dev/null || true
fi

# Build frontend on host (avoids Docker memory overhead on low-RAM VPS)
print_info "Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci --prefer-offline 2>&1 | tail -1
NODE_OPTIONS="--max-old-space-size=1024" npm run build
print_success "Frontend built"

# Package frontend into nginx container
print_info "Building frontend container..."
cd "$INSTALL_DIR"
docker compose build

print_info "Starting services..."

# Start backend (systemd)
systemctl start serverkit

# Start frontend (Docker)
docker compose up -d

# Start nginx
systemctl start nginx
systemctl enable nginx

# Wait for services to start
print_info "Waiting for services to start..."
sleep 10

# Health check
echo ""
BACKEND_OK=false
FRONTEND_OK=false

if curl -s http://127.0.0.1:5000/api/v1/system/health > /dev/null 2>&1; then
    BACKEND_OK=true
    print_success "Backend is running"
else
    print_error "Backend health check failed"
fi

if curl -s http://localhost > /dev/null 2>&1; then
    FRONTEND_OK=true
    print_success "Frontend is running"
else
    print_error "Frontend health check failed"
fi

echo ""
if [ "$BACKEND_OK" = true ] && [ "$FRONTEND_OK" = true ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "ServerKit is now running at: http://localhost"
    echo ""
    echo "Quick Start:"
    echo "  1. Create admin user:  serverkit create-admin"
    echo "  2. View status:        serverkit status"
    echo "  3. View logs:          serverkit logs"
    echo ""
    echo "Service Management:"
    echo "  Backend (systemd):     systemctl [start|stop|restart] serverkit"
    echo "  Frontend (Docker):     docker compose -C $INSTALL_DIR [up|down]"
    echo ""
    echo "For all commands:        serverkit help"
    echo ""
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  Installation may have issues${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  Backend logs:   journalctl -u serverkit -f"
    echo "  Frontend logs:  docker compose -C $INSTALL_DIR logs -f"
    echo ""
fi
