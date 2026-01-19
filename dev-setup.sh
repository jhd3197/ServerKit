#!/bin/bash
#
# ServerKit Local Development Setup for WSL/Linux
# Usage: ./dev-setup.sh
#

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ServerKit Development Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}Installing Python...${NC}"
    sudo apt update
    sudo apt install -y python3 python3-pip python3-venv python3-dev
fi

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Create virtual environment
if [ ! -d "venv" ]; then
    echo -e "${BLUE}→ Creating Python virtual environment...${NC}"
    python3 -m venv venv
fi

# Activate and install dependencies
echo -e "${BLUE}→ Installing Python dependencies...${NC}"
source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r backend/requirements.txt
pip install --quiet gunicorn gevent gevent-websocket

# Install frontend dependencies
echo -e "${BLUE}→ Installing frontend dependencies...${NC}"
cd frontend
npm install --silent
cd ..

# Create .env if not exists
if [ ! -f ".env" ]; then
    echo -e "${BLUE}→ Creating .env file...${NC}"
    cat > .env << 'EOF'
# Development Configuration
SECRET_KEY=dev-secret-key-change-in-production
JWT_SECRET_KEY=dev-jwt-key-change-in-production
DATABASE_URL=sqlite:///backend/instance/serverkit.db
CORS_ORIGINS=http://localhost,http://localhost:3000,http://localhost:5173
FLASK_ENV=development
EOF
fi

# Create instance directory
mkdir -p backend/instance

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "To start development:"
echo ""
echo "  Terminal 1 (Backend):"
echo "    source venv/bin/activate"
echo "    cd backend && python run.py"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd frontend && npm run dev"
echo ""
echo "Access:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:5000"
echo ""
