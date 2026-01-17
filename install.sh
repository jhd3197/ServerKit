#!/bin/bash
#
# ServerKit Quick Install Script for Ubuntu
# Usage: curl -fsSL https://raw.githubusercontent.com/jhd3197/serverkit/main/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ServerKit Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Warning: Running as root is not recommended${NC}"
fi

# Check Ubuntu
if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [ "$ID" != "ubuntu" ] && [ "$ID" != "debian" ]; then
        echo -e "${YELLOW}Warning: This script is designed for Ubuntu/Debian${NC}"
    fi
fi

echo -e "${BLUE}→ Checking prerequisites...${NC}"

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo -e "${BLUE}→ Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✓ Docker installed${NC}"
    echo -e "${YELLOW}! You may need to log out and back in for Docker permissions${NC}"
fi

# Install Docker Compose plugin if not present
if ! docker compose version &> /dev/null; then
    echo -e "${BLUE}→ Installing Docker Compose...${NC}"
    sudo apt-get update
    sudo apt-get install -y docker-compose-plugin
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
fi

# Install git if not present
if ! command -v git &> /dev/null; then
    echo -e "${BLUE}→ Installing git...${NC}"
    sudo apt-get update
    sudo apt-get install -y git
fi

# Clone repository
INSTALL_DIR="/opt/serverkit"
echo -e "${BLUE}→ Installing ServerKit to $INSTALL_DIR...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}! Directory exists, updating...${NC}"
    cd "$INSTALL_DIR"
    sudo git pull
else
    sudo git clone https://github.com/jhd3197/serverkit.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Set permissions
sudo chown -R $USER:$USER "$INSTALL_DIR"

# Make CLI executable
chmod +x serverkit

# Create symlink for global access
sudo ln -sf "$INSTALL_DIR/serverkit" /usr/local/bin/serverkit

# Generate configuration
if [ ! -f ".env" ]; then
    echo -e "${BLUE}→ Generating configuration...${NC}"
    SECRET_KEY=$(openssl rand -hex 32)
    JWT_SECRET_KEY=$(openssl rand -hex 32)

    cat > .env << EOF
# ServerKit Configuration
SECRET_KEY=$SECRET_KEY
JWT_SECRET_KEY=$JWT_SECRET_KEY
DATABASE_URL=sqlite:///serverkit.db
CORS_ORIGINS=http://localhost
PORT=80
SSL_PORT=443
FLASK_ENV=production
EOF
fi

# Create SSL directory
mkdir -p nginx/ssl

# Generate self-signed certificate
if [ ! -f "nginx/ssl/fullchain.pem" ]; then
    echo -e "${BLUE}→ Generating SSL certificate...${NC}"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/ssl/privkey.pem \
        -out nginx/ssl/fullchain.pem \
        -subj "/CN=localhost" 2>/dev/null
fi

# Build and start
echo -e "${BLUE}→ Building containers (this may take a few minutes)...${NC}"
docker compose build

echo -e "${BLUE}→ Starting services...${NC}"
docker compose up -d

# Wait for services
echo -e "${BLUE}→ Waiting for services...${NC}"
sleep 15

# Final check
echo ""
if curl -s http://localhost > /dev/null 2>&1; then
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
    echo "For all commands:        serverkit help"
    echo ""
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  Installation may have issues${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Check logs with: serverkit logs"
    echo ""
fi
