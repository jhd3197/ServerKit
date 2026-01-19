# ServerKit Enhancement Project

## Overview
ServerKit is a modern, self-hosted server management panel (Flask backend + React frontend) at v1.2.9. This project focuses on fixing critical infrastructure issues, adding new features, and polishing the UI for production readiness.

## Current State
- **Backend**: Flask 3.0 with 30+ services, JWT auth, WebSocket support
- **Frontend**: React 18 with Vite, Recharts, Lucide icons, LESS styling
- **Infrastructure**: Docker-first deployment, Nginx reverse proxy, multi-database support

## Critical Issues Identified
1. **Docker port/domain mapping not working** - Nginx proxies to `127.0.0.1:{port}` but containers may not be exposed correctly
2. **Template icons URLs broken** - Some icon references not loading
3. **No historical metrics** - Dashboard shows real-time only, no graphs over time

## Project Goals

### Priority 1: Fix Critical Infrastructure
- Debug and fix Docker container port exposure to host
- Fix domain-to-application routing via Nginx
- Ensure WordPress, PHP, Flask templates deploy and route correctly

### Priority 2: Add Private URL Feature
- Generate unique private URLs for apps (e.g., `/p/abc123`)
- Allow custom private slugs
- Apps accessible without public indexing

### Priority 3: UI/UX Polish
- Improve Applications list and management pages
- Fix Templates page icons and update filtering
- Enhance FileManager disk usage visualization
- Add historical metrics graphs to Dashboard (CPU, Memory, Disk over time)

## Tech Stack
- **Backend**: Python 3.11+, Flask, SQLAlchemy, Flask-SocketIO, psutil
- **Frontend**: React 18, Vite, Recharts, Lucide React, LESS
- **Infrastructure**: Docker, Nginx, Let's Encrypt

## Key Files
- Docker Service: `backend/app/services/docker_service.py`
- Nginx Service: `backend/app/services/nginx_service.py`
- Template Service: `backend/app/services/template_service.py`
- Domain API: `backend/app/api/domains.py`
- Dashboard: `frontend/src/pages/Dashboard.jsx`
- Templates Page: `frontend/src/pages/Templates.jsx`
- FileManager: `frontend/src/pages/FileManager.jsx`

## Success Criteria
- [ ] Docker apps accessible via connected domains
- [ ] WordPress, PHP, Flask templates deploy and work end-to-end
- [ ] Private URLs functional for all app types
- [ ] Dashboard shows historical CPU/Memory/Disk graphs
- [ ] Template icons load correctly
- [ ] FileManager shows improved disk usage UI
