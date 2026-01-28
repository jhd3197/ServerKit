# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ServerKit is a server control panel for managing web applications, databases, Docker containers, and security on VPS/dedicated servers. Flask backend (Python 3.11+), React frontend (Vite + LESS), SQLite/PostgreSQL database, real-time updates via Socket.IO.

## Development Commands

```bash
# Backend (port 5000, hot-reload)
cd backend && python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py

# Frontend (port 5173, Vite HMR)
cd frontend && npm install && npm run dev

# Both at once (Linux/WSL)
./scripts/dev/start.sh

# Frontend lint
cd frontend && npm run lint

# Frontend production build
cd frontend && npm run build

# Backend tests
cd backend && pytest
cd backend && pytest --cov=app

# Docker
docker compose -f docker-compose.dev.yml up --build
```

Default dev credentials: `admin` / `admin`

## Architecture

### Backend (`backend/`)

Flask app factory in `app/__init__.py` using `create_app()`. Three-layer architecture:

- **`app/api/`** — Flask Blueprints, one file per feature (36 files). All routes prefixed `/api/v1/`. JWT-protected via `@jwt_required()`.
- **`app/services/`** — Business logic (48 files). Services are stateless modules called by API routes. Heavy lifting (shell commands, Docker API, file operations) happens here.
- **`app/models/`** — SQLAlchemy ORM models (15 files). Tables auto-created on startup via `db.create_all()`.

Other backend components:
- `app/sockets.py` — Socket.IO event handlers for real-time metrics, logs, terminal
- `app/agent_gateway.py` — Multi-server agent communication
- `app/middleware/security.py` — Security headers middleware
- `config.py` — Environment-based config (development/production/testing)
- `run.py` — Entry point

### Frontend (`frontend/src/`)

React 18 SPA with client-side routing:

- **`pages/`** — Route-level components (~29 files). Each maps to a route in `App.jsx`.
- **`components/`** — Reusable UI components shared across pages.
- **`contexts/`** — React Context providers: `AuthContext` (JWT auth + token refresh), `ThemeContext`, `ToastContext`, `ResourceTierContext` (feature gating).
- **`services/api.js`** — Centralized `ApiService` class handling all HTTP requests, token management, and auto-refresh.
- **`hooks/`** — Custom React hooks for reusable logic.
- **`styles/`** — LESS stylesheets with design system variables. Main entry is `main.less`. Page-specific styles in `styles/pages/`.
- **`layouts/`** — `DashboardLayout` wraps authenticated pages (sidebar + header).

Route guards: `PrivateRoute` (auth check), `PublicRoute` (redirect if logged in), `SetupRoute` (redirect to `/setup` if not configured).

### Request Flow

Browser → Nginx (`:80`/`:443`) → proxy_pass to Docker containers (`:8001-8999`) for managed apps, or to Flask (`:5000`) for the panel API. The 404 handler in Flask serves `index.html` for SPA client-side routing; API routes return JSON errors.

### Production Build

The Dockerfile is multi-stage: Node 20 builds frontend, Python 3.11 serves everything via Gunicorn with GeventWebSocket workers. Built frontend is served from Flask's static folder.

## Code Style

### Python
- PEP 8, type hints where helpful
- Service functions are standalone (no classes unless stateful)
- Consistent JSON error responses: `{'error': 'message'}, status_code`

### React/JavaScript
- Functional components with hooks only
- PascalCase for components (`Sidebar.jsx`), camelCase for everything else
- LESS for styling — use existing design system variables (`@card-bg`, `@primary-color`, `@spacing-md`, etc.) and BEM-like naming (`.block__element--modifier`)
- Context API for global state; props drilling is fine for 2-3 levels
- No inline styles; no Tailwind/CSS-in-JS

### Diffs & Commits
- One logical change per commit
- Minimal, focused diffs — don't silently refactor surrounding code
- Branch naming: `feature/`, `fix/`, `docs/`, `refactor/` prefixes

## Adding a New Feature (Full Stack)

1. **Model**: Add SQLAlchemy model in `backend/app/models/`
2. **Service**: Add business logic in `backend/app/services/`
3. **API**: Create Blueprint in `backend/app/api/`, register it in `app/__init__.py` with `url_prefix='/api/v1/<feature>'`
4. **Frontend API**: Add methods to `ApiService` in `frontend/src/services/api.js`
5. **Page**: Create page component in `frontend/src/pages/`, add route in `App.jsx`
6. **Styles**: Add LESS file in `frontend/src/styles/pages/`, import in `main.less`

## Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY` | Flask session signing |
| `JWT_SECRET_KEY` | JWT token signing |
| `DATABASE_URL` | DB connection string (`sqlite:///...` or PostgreSQL) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `FLASK_ENV` | `development` or `production` |
