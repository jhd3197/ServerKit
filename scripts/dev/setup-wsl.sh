#!/bin/bash
# ServerKit WSL Development Setup
# Run: ./scripts/dev/setup-wsl.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "============================================"
echo "  ServerKit Dev Setup"
echo "============================================"
echo ""

echo -e "${YELLOW}[1/6] Installing base dependencies...${NC}"
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip nginx docker.io docker-compose git curl lsof ca-certificates gnupg
sudo usermod -aG docker $USER 2>/dev/null || true
echo -e "${GREEN}Done!${NC}"

echo -e "${YELLOW}[2/6] Installing Node.js 20...${NC}"
# Install Node.js 20 from NodeSource (Ubuntu default is too old)
if ! node --version 2>/dev/null | grep -q "v20\|v21\|v22"; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js $(node --version)"
echo -e "${GREEN}Done!${NC}"

echo -e "${YELLOW}[3/6] Enabling systemd...${NC}"
if ! grep -q "systemd=true" /etc/wsl.conf 2>/dev/null; then
    echo -e "[boot]\nsystemd=true" | sudo tee /etc/wsl.conf > /dev/null
    echo -e "${YELLOW}Note: Run 'wsl --shutdown' after setup for systemd.${NC}"
fi
echo -e "${GREEN}Done!${NC}"

echo -e "${YELLOW}[4/6] Setting up backend...${NC}"
cd "$PROJECT_ROOT/backend"
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q

# Create instance directory
mkdir -p instance

# Create .env if it doesn't exist (don't overwrite existing config)
if [ ! -f .env ]; then
    cat > .env << EOF
FLASK_ENV=development
FLASK_DEBUG=1
SECRET_KEY=dev-secret-key-change-in-production
JWT_SECRET_KEY=jwt-secret-key-change-in-production
DATABASE_URL=sqlite:///instance/serverkit.db
EOF
fi
echo -e "${GREEN}Done!${NC}"

echo -e "${YELLOW}[5/6] Setting up frontend...${NC}"
cd "$PROJECT_ROOT/frontend"
npm install
[ ! -f .env.development ] && echo "VITE_API_URL=http://localhost:5000/api/v1" > .env.development
echo -e "${GREEN}Done!${NC}"

echo -e "${YELLOW}[6/6] Creating admin user...${NC}"
cd "$PROJECT_ROOT/backend"
source venv/bin/activate
python3 << 'PYTHON'
import sys, os
sys.path.insert(0, os.getcwd())
try:
    from app import create_app, db
    from app.models.user import User
    app = create_app()
    with app.app_context():
        db.create_all()
        admin = User.query.filter_by(username='admin').first()
        if admin:
            admin.set_password('admin')
        else:
            admin = User(username='admin', email='admin@localhost', role='admin', is_active=True)
            admin.set_password('admin')
            db.session.add(admin)
        db.session.commit()
        print("Admin user ready!")
except Exception as e:
    print(f"Could not create admin: {e}")
PYTHON
echo -e "${GREEN}Done!${NC}"

echo ""
echo "============================================"
echo -e "${GREEN}  Ready!${NC}"
echo "============================================"
echo ""
echo "  Login:  admin / admin"
echo "  DB:     ~/.serverkit/serverkit.db"
echo ""
echo "  Start:  ./scripts/dev/start.sh"
echo ""
echo "  Open:   http://localhost:5173"
echo ""
