#!/bin/bash
#
# Setup Host Nginx as Reverse Proxy
# This allows multiple domains/apps on one server
#
# Usage: sudo ./scripts/setup-nginx-proxy.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (sudo)"
    exit 1
fi

echo -e "${BLUE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setting up Host Nginx as Reverse Proxy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    print_info "Installing nginx..."
    apt-get update
    apt-get install -y nginx
    print_success "Nginx installed"
else
    print_success "Nginx already installed"
fi

# Stop nginx temporarily
systemctl stop nginx 2>/dev/null || true

# Backup default config
if [ -f /etc/nginx/sites-enabled/default ]; then
    print_info "Removing default nginx site..."
    rm -f /etc/nginx/sites-enabled/default
fi

# Create sites directories if they don't exist
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

# Check if nginx.conf includes sites-enabled
if ! grep -q "sites-enabled" /etc/nginx/nginx.conf; then
    print_info "Updating nginx.conf to include sites-enabled..."
    # Add include directive before the last closing brace
    sed -i '/^http {/a \    include /etc/nginx/sites-enabled/*;' /etc/nginx/nginx.conf
fi

# Copy ServerKit site config
SERVERKIT_DIR="/opt/serverkit"
if [ -f "$SERVERKIT_DIR/nginx/sites-available/serverkit.conf" ]; then
    print_info "Installing ServerKit nginx config..."
    cp "$SERVERKIT_DIR/nginx/sites-available/serverkit.conf" /etc/nginx/sites-available/
    ln -sf /etc/nginx/sites-available/serverkit.conf /etc/nginx/sites-enabled/
    print_success "ServerKit config installed"
fi

# Copy template
if [ -f "$SERVERKIT_DIR/nginx/sites-available/example.conf.template" ]; then
    cp "$SERVERKIT_DIR/nginx/sites-available/example.conf.template" /etc/nginx/sites-available/
    print_success "Template copied to /etc/nginx/sites-available/"
fi

# Update ServerKit docker-compose to use port 8080
cd "$SERVERKIT_DIR"
if docker compose ps | grep -q "serverkit-frontend"; then
    print_info "Updating ServerKit frontend to use port 8080..."
    docker compose down
    docker compose up -d
fi

# Test nginx config
print_info "Testing nginx configuration..."
if nginx -t; then
    print_success "Nginx configuration is valid"
else
    print_error "Nginx configuration has errors"
    exit 1
fi

# Start nginx
systemctl start nginx
systemctl enable nginx

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Architecture:"
echo "  • Host nginx (ports 80/443) - routes domains to apps"
echo "  • ServerKit frontend (port 8080) - UI"
echo "  • ServerKit backend (port 5000) - API"
echo ""
echo "To add a new site:"
echo "  1. Create DNS record in Cloudflare (A record → your server IP)"
echo "  2. Run: sudo serverkit add-site example.builditdesign.com"
echo "     Or manually:"
echo "       sudo cp /etc/nginx/sites-available/example.conf.template \\"
echo "              /etc/nginx/sites-available/mysite.conf"
echo "       sudo nano /etc/nginx/sites-available/mysite.conf"
echo "       sudo ln -s /etc/nginx/sites-available/mysite.conf /etc/nginx/sites-enabled/"
echo "       sudo nginx -t && sudo systemctl reload nginx"
echo ""
