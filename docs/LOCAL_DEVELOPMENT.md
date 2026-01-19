# Local Development Setup for Windows

This guide explains how to run ServerKit locally on Windows for development and testing.

## Prerequisites

- **Windows 10/11** with WSL2 enabled
- **Docker Desktop** for Windows (with WSL2 backend)
- **Git** for Windows

## Option 1: Full Local Development (Recommended)

This mimics the production setup where backend runs on host and frontend in Docker.

### Step 1: Install WSL2 + Ubuntu

```powershell
# Run in PowerShell as Administrator
wsl --install -d Ubuntu-24.04
```

Restart your computer, then open Ubuntu from Start menu to complete setup.

### Step 2: Install Dependencies in WSL

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Python
sudo apt install -y python3 python3-pip python3-venv python3-dev

# Install build tools
sudo apt install -y build-essential libffi-dev libssl-dev

# Install iproute2 (for ss command)
sudo apt install -y iproute2

# Install Docker (inside WSL)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in for docker group to take effect
```

### Step 3: Clone and Setup

```bash
# Clone the repo (or navigate to your mounted Windows folder)
cd ~
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
pip install gunicorn gevent gevent-websocket

# Create .env file
cat > .env << 'EOF'
SECRET_KEY=dev-secret-key-change-in-production
JWT_SECRET_KEY=dev-jwt-key-change-in-production
DATABASE_URL=sqlite:///backend/instance/serverkit.db
CORS_ORIGINS=http://localhost,http://localhost:3000,http://localhost:5173
FLASK_ENV=development
EOF

# Create instance directory
mkdir -p backend/instance
```

### Step 4: Run Backend (Terminal 1)

```bash
cd ~/ServerKit
source venv/bin/activate
cd backend
export $(cat ../.env | xargs)
python run.py
```

Backend will be available at: `http://localhost:5000`

### Step 5: Run Frontend (Terminal 2)

```bash
cd ~/ServerKit/frontend
npm install
npm run dev
```

Frontend will be available at: `http://localhost:5173`

---

## Option 2: Docker Compose (Simpler, but no host system access)

Use this for quick UI testing. Note: System management features (PHP install, firewall, etc.) won't work.

### docker-compose.dev.yml

Create this file in the project root:

```yaml
# Development docker-compose - FOR TESTING UI ONLY
# System management features won't work in this mode

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: serverkit-backend-dev
    environment:
      - FLASK_ENV=development
      - SECRET_KEY=dev-secret-key
      - JWT_SECRET_KEY=dev-jwt-key
      - DATABASE_URL=sqlite:////app/instance/serverkit.db
      - CORS_ORIGINS=http://localhost,http://localhost:3000
    ports:
      - "5000:5000"
    volumes:
      - ./backend:/app
      - dev-data:/app/instance
    networks:
      - serverkit-dev

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    container_name: serverkit-frontend-dev
    environment:
      - VITE_API_URL=http://localhost:5000
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    depends_on:
      - backend
    networks:
      - serverkit-dev

networks:
  serverkit-dev:
    driver: bridge

volumes:
  dev-data:
```

### Run with Docker Compose

```bash
docker compose -f docker-compose.dev.yml up --build
```

---

## Option 3: VS Code Dev Container

Add this to `.devcontainer/devcontainer.json`:

```json
{
  "name": "ServerKit Dev",
  "dockerComposeFile": "../docker-compose.dev.yml",
  "service": "backend",
  "workspaceFolder": "/app",
  "customizations": {
    "vscode": {
      "extensions": [
        "ms-python.python",
        "ms-python.vscode-pylance",
        "dbaeumer.vscode-eslint"
      ]
    }
  },
  "forwardPorts": [5000, 3000],
  "postCreateCommand": "pip install -r requirements.txt"
}
```

---

## Quick Reference

| Component | Production (DO Server) | Local Dev (WSL) |
|-----------|----------------------|-----------------|
| Backend | systemd service | `python run.py` |
| Frontend | Docker + nginx | `npm run dev` |
| Database | SQLite in /opt/serverkit | SQLite in ./backend/instance |
| System Access | Full (sudo, systemctl) | Full (in WSL) |

## Testing System Features

To test PHP installation, firewall, etc. locally:

1. Use **Option 1** (WSL) - this gives you a real Linux environment
2. Install the same packages as production:
   ```bash
   sudo apt install -y firewalld vsftpd
   ```
3. The backend will have real system access

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Flask secret key | Required |
| `JWT_SECRET_KEY` | JWT signing key | Required |
| `DATABASE_URL` | SQLite path | `sqlite:///serverkit.db` |
| `CORS_ORIGINS` | Allowed origins | `http://localhost` |
| `FLASK_ENV` | development/production | `production` |

## Troubleshooting

### Port already in use
```bash
# Find what's using the port
sudo lsof -i :5000
# Kill it
sudo kill -9 <PID>
```

### Permission denied for Docker
```bash
sudo usermod -aG docker $USER
# Log out and back in
```

### Database locked
```bash
# Remove the lock file
rm backend/instance/serverkit.db-journal
```
