# ServerKit Enhancement Project

## Current State

**Version**: v1.1 (Milestone 2 Complete)
**Active**: Milestone 3 - Visual Workflow Builder (v1.2)
**Last Updated**: 2026-01-19

ServerKit is a modern, self-hosted server management panel (Flask backend + React frontend) with multi-environment WordPress support and community features.

### What's Shipped

**v1.1 (Milestone 2)**:
- **Multi-Environment App Linking** - Link prod/dev WordPress instances with shared databases
- **WordPress External DB Template** - Connect WordPress to external MySQL with custom table prefixes
- **Environment Switching UI** - Badges, filters, linked apps navigation
- **GitHub Integration** - Repository links, version update checks, star prompt

**v1.0 (Milestone 1)**:
- Docker/Domain Infrastructure, Private URLs, Historical Metrics
- Templates & Applications UI polish, FileManager disk usage

### Tech Stack
- **Backend**: Python 3.11+, Flask 3.0, SQLAlchemy, Flask-SocketIO, psutil
- **Frontend**: React 18, Vite, Recharts, Lucide React, LESS
- **Infrastructure**: Docker, Nginx, Let's Encrypt

## Next Milestone Goals

**Milestone 3: Visual Workflow Builder (v1.2)**

Create a visual, flow-based interface for orchestrating infrastructure:
- **Canvas Foundation** - React Flow with pan/zoom, node rendering
- **Resource Nodes** - Visual blocks for Docker apps, databases, domains
- **Configuration Panels** - Side panels adapting existing forms
- **Connection Logic** - Validate and visualize relationships
- **Save/Load** - Persist workflows, import existing infrastructure
- **Deploy** - Execute workflows to create/update resources

---

<details>
<summary>Original Project Goals (v1.0)</summary>

### Priority 1: Fix Critical Infrastructure
- [x] Debug and fix Docker container port exposure to host
- [x] Fix domain-to-application routing via Nginx
- [x] Ensure WordPress, PHP, Flask templates deploy and route correctly

### Priority 2: Add Private URL Feature
- [x] Generate unique private URLs for apps (e.g., `/p/abc123`)
- [x] Allow custom private slugs
- [x] Apps accessible without public indexing

### Priority 3: UI/UX Polish
- [x] Improve Applications list and management pages
- [x] Fix Templates page icons and update filtering
- [x] Enhance FileManager disk usage visualization
- [x] Add historical metrics graphs to Dashboard (CPU, Memory, Disk over time)

### Critical Issues Identified (Resolved)
1. ~~Docker port/domain mapping not working~~ Fixed with debug infrastructure
2. ~~Template icons URLs broken~~ Fixed with Lucide fallbacks
3. ~~No historical metrics~~ Added with MetricsHistoryService

</details>

---

## Key Files

- Docker Service: `backend/app/services/docker_service.py`
- Nginx Service: `backend/app/services/nginx_service.py`
- Template Service: `backend/app/services/template_service.py`
- Private URL Service: `backend/app/services/private_url_service.py`
- Metrics History Service: `backend/app/services/metrics_history_service.py`
- File Service: `backend/app/services/file_service.py`
- Dashboard: `frontend/src/pages/Dashboard.jsx`
- Templates Page: `frontend/src/pages/Templates.jsx`
- Applications Page: `frontend/src/pages/Applications.jsx`
- FileManager: `frontend/src/pages/FileManager.jsx`

## Quick Links

- [Milestone 1 Archive](./milestones/v1.0-ROADMAP.md)
- [Current Roadmap](./ROADMAP.md)
- [Project State](./STATE.md)
