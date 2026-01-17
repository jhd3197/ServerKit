# ServerKit

**Modern, self-hosted server management panel** - An open-source alternative to ServerPilot and CyberPanel.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![React](https://img.shields.io/badge/react-18-blue.svg)

---

## Overview

ServerKit is a lightweight, modern server control panel for managing web applications, databases, and services on your VPS or dedicated server. Built with Python/Flask backend and React frontend.

### Key Features

- **PHP / WordPress** - PHP-FPM 8.2 with one-click WordPress installation
- **Python Apps** - Deploy Flask and Django applications with Gunicorn
- **Docker Support** - Manage containers directly from the dashboard
- **SSL Certificates** - Automatic Let's Encrypt with auto-renewal
- **Database Management** - MySQL/MariaDB and PostgreSQL support
- **Real-time Monitoring** - CPU, RAM, disk, and network metrics
- **Modern UI** - Dark-themed dashboard built with React

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.11+, Flask, SQLAlchemy |
| Frontend | React 18, Vite, TailwindCSS |
| Database | PostgreSQL / SQLite |
| Web Server | Nginx |
| Containers | Docker |
| Real-time | WebSocket (Flask-SocketIO) |

---

## Requirements

- Ubuntu 22.04+ / Debian 12+ (recommended)
- Python 3.11+
- Node.js 18+
- Docker (optional, for container management)
- Root or sudo access

---

## Quick Start

### Development Setup

```bash
# Clone the repository
git clone https://github.com/jhd3197/ServerKit.git
cd ServerKit

# Backend setup
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
flask run

# Frontend setup (new terminal)
cd frontend
npm install
npm run dev
```

### Production Installation

Install command:

```bash
curl -fsSL https://raw.githubusercontent.com/jhd3197/serverkit/main/install.sh | bash
```

Update command:

```bash
curl -fsSL https://raw.githubusercontent.com/jhd3197/serverkit/main/install.sh | bash
```

---

## Screenshots
![Screenshot_17-1-2026_13453_localhost](https://github.com/user-attachments/assets/6407ecf0-7a1a-4c4b-b7e3-8af6619da2f9)
<img width="1703" height="887" alt="image" src="https://github.com/user-attachments/assets/73807009-9538-48e9-bbdf-152aed57bdd8" />


---

## Project Structure

```
ServerKit/
├── backend/                 # Flask API
│   ├── app/
│   │   ├── api/            # API routes
│   │   ├── models/         # Database models
│   │   ├── services/       # Business logic
│   │   └── utils/          # Helpers
│   ├── config.py
│   └── requirements.txt
│
├── frontend/               # React application
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── layouts/       # Layout components
│   │   ├── pages/         # Page components
│   │   └── services/      # API clients
│   └── package.json
│
├── agent/                  # Server monitoring agent
│   └── serverkit-agent.py
│
├── docker/                 # Docker configurations
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── docs/                   # Documentation
├── ROADMAP.md             # Development roadmap
└── README.md
```

---

## Supported Applications

### PHP / WordPress
- PHP-FPM 8.0, 8.1, 8.2, 8.3
- One-click WordPress installation
- WP-CLI integration
- Automatic updates and backups

### Python
- Flask applications with Gunicorn
- Django applications with static file handling
- Virtual environment management
- Multiple Python versions

### Docker
- Container management
- Docker Compose support
- Image management
- Log streaming

### Databases
- MySQL / MariaDB
- PostgreSQL
- Redis (optional)

---

## API Documentation

API runs on port `5000` by default.

```
Base URL: http://localhost:5000/api/v1

Authentication:
  POST   /auth/login          # Get JWT token
  POST   /auth/register       # Register new user
  POST   /auth/refresh        # Refresh token

Applications:
  GET    /apps                # List all apps
  POST   /apps                # Create new app
  GET    /apps/:id            # Get app details
  PUT    /apps/:id            # Update app
  DELETE /apps/:id            # Delete app

Domains:
  GET    /domains             # List domains
  POST   /domains             # Add domain
  DELETE /domains/:id         # Remove domain

System:
  GET    /system/metrics      # Server metrics
  GET    /system/logs         # System logs
  POST   /system/services     # Control services
```

---

## Configuration

Create a `.env` file in the backend directory:

```env
# Flask
FLASK_ENV=development
SECRET_KEY=your-secret-key

# Database
DATABASE_URL=sqlite:///serverkit.db

# JWT
JWT_SECRET_KEY=your-jwt-secret

# Server Agent
AGENT_TOKEN=your-agent-token
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the detailed development plan.

**Current Status: Phase 1 - Foundation**

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Foundation & Core | In Progress |
| 2 | Server Agent | Planned |
| 3 | PHP & WordPress | Planned |
| 4 | Python Apps | Planned |
| 5 | Docker Support | Planned |
| 6 | Database Management | Planned |

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Inspired by [ServerPilot](https://serverpilot.io) and [CyberPanel](https://cyberpanel.net)
- UI design inspired by modern admin dashboards

---

**ServerKit** - Simple. Modern. Self-hosted.
