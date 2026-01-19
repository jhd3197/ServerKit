# ServerKit Enhancement Roadmap

---

## Completed Milestones

### [Milestone 1: Infrastructure Fixes, Private URLs & UI Polish](./milestones/v1.0-ROADMAP.md) (v1.0)
Completed 2026-01-19 | 9 phases | 109 commits | +14,667/-2,836 lines

### [Milestone 2: Multi-Environment WordPress & Community Features](./milestones/v1.1-ROADMAP.md) (v1.1)
Completed 2026-01-19 | 5 phases | Multi-environment app linking, shared DB support, GitHub integration

### [Milestone 3: Visual Workflow Builder](./milestones/v1.2-ROADMAP.md) (v1.2)
Completed 2026-01-19 | 6 phases | React Flow canvas, node types, deploy from workflow

---

## Current Milestone

> **Milestone 4**: Container Logs & Monitoring
> **Version**: v1.3
> **Started**: 2026-01-19
> **Status**: In Progress

**Goal**: Add comprehensive container logging and monitoring capabilities - real-time log streaming, search/filtering, per-app resource graphs, and configurable alert rules with notifications.

---

## Phase Overview

| Phase | Name | Status | Goal |
|-------|------|--------|------|
| 22 | Container Logs API | **completed** | Backend API to fetch/stream Docker container logs |
| 23 | Log Viewer UI | pending | Real-time log display with auto-scroll, ANSI color support |
| 24 | Log Search & Filtering | pending | Search within logs, filter by level/time, export |
| 25 | Per-App Resource Collection | pending | Collect per-container CPU/memory/network stats via Docker API |
| 26 | App Resource Graphs | pending | Per-app resource usage charts in application detail view |
| 27 | Alert Rules Engine | pending | Define thresholds, evaluate metrics, trigger alerts |
| 28 | Alert Notifications | pending | Send alerts via email, Discord, Telegram webhooks |

---

## Phase 22: Container Logs API (Completed)
**Goal**: Create backend API to fetch and stream Docker container logs

**Key Tasks**:
- Add Docker logs service to fetch container logs
- Create GET /apps/{id}/logs endpoint with tail/since parameters
- Add WebSocket endpoint for real-time log streaming
- Handle log rotation and buffer limits
- Support multiple output formats (raw, JSON)

**Success Criteria**:
- [x] Can fetch last N lines of container logs
- [x] Can stream logs in real-time via WebSocket
- [x] Logs include timestamps
- [x] Handles containers that aren't running

---

## Phase 23: Log Viewer UI
**Goal**: Create real-time log viewer component in application detail page

**Key Tasks**:
- Create LogViewer component with terminal-style display
- Implement auto-scroll with pause on user scroll
- Add ANSI color code parsing for colored output
- Connect to WebSocket for live streaming
- Add play/pause, clear, and download buttons

**Success Criteria**:
- [ ] Logs display in real-time
- [ ] Colors render correctly (ANSI codes)
- [ ] Auto-scroll works with manual override
- [ ] Can pause/resume streaming

---

## Phase 24: Log Search & Filtering
**Goal**: Add search and filtering capabilities to log viewer

**Key Tasks**:
- Add search input with highlight matches
- Filter by log level (INFO, WARN, ERROR, DEBUG)
- Filter by time range (last hour, today, custom)
- Add regex search option
- Export filtered logs to file

**Success Criteria**:
- [ ] Can search within logs
- [ ] Search matches highlighted
- [ ] Level filtering works
- [ ] Can export logs

---

## Phase 25: Per-App Resource Collection
**Goal**: Collect and store per-container resource metrics

**Key Tasks**:
- Use Docker stats API to get container metrics
- Create ContainerMetrics model for storage
- Add background collection job (every 30s)
- Store CPU %, memory usage, network I/O per container
- Create API endpoint GET /apps/{id}/metrics/history

**Success Criteria**:
- [ ] Per-container metrics collected
- [ ] Historical data stored (7 days retention)
- [ ] API returns time-series data
- [ ] Collection doesn't impact performance

---

## Phase 26: App Resource Graphs
**Goal**: Display per-app resource usage charts in application detail

**Key Tasks**:
- Create AppMetricsGraph component using Recharts
- Add to application detail page (new Metrics tab or Overview)
- Show CPU, memory, network charts
- Add time range selector (1h, 6h, 24h, 7d)
- Show current vs average stats

**Success Criteria**:
- [ ] CPU/memory graphs display correctly
- [ ] Time range selection works
- [ ] Charts update with new data
- [ ] Mobile responsive

---

## Phase 27: Alert Rules Engine
**Goal**: Create system for defining and evaluating alert rules

**Key Tasks**:
- Create AlertRule model (metric, operator, threshold, duration)
- Create AlertHistory model for triggered alerts
- Add alert evaluation service (runs with metrics collection)
- Create CRUD API for alert rules
- Support app-specific and system-wide rules

**Success Criteria**:
- [ ] Can create/edit/delete alert rules
- [ ] Rules evaluate against metrics
- [ ] Alerts trigger when thresholds exceeded
- [ ] Alert history tracked

---

## Phase 28: Alert Notifications
**Goal**: Send alert notifications through multiple channels

**Key Tasks**:
- Integrate with existing notification preferences
- Send email alerts (if configured)
- Send Discord webhook alerts
- Send Telegram bot alerts
- Add alert cooldown to prevent spam
- Create notification templates

**Success Criteria**:
- [ ] Email notifications work
- [ ] Discord webhooks work
- [ ] Telegram notifications work
- [ ] Cooldown prevents duplicate alerts

---

## Dependencies

```
Phase 22 (Logs API) ──────► Phase 23 (Log Viewer)
                                   │
                                   ▼
Phase 23 ─────────────────► Phase 24 (Search/Filter)

Phase 25 (Metrics Collection) ──► Phase 26 (Graphs)
                                        │
                                        ▼
Phase 26 ─────────────────────► Phase 27 (Alert Rules)
                                        │
                                        ▼
Phase 27 ─────────────────────► Phase 28 (Notifications)
```

---

## Technical Notes

- Docker SDK for Python: `docker.containers.get(id).logs()`
- Docker stats API: `docker.containers.get(id).stats(stream=True)`
- WebSocket: Use existing Flask-SocketIO setup
- Charts: Recharts (already installed)
- Notifications: Extend existing NotificationService

---

## Estimated Complexity

| Phase | Complexity | Files Changed |
|-------|------------|---------------|
| 22 | Medium | 4-6 (service, API, socket) |
| 23 | Medium | 3-5 (component, styles) |
| 24 | Medium | 2-4 (component updates) |
| 25 | High | 5-7 (model, service, API, job) |
| 26 | Medium | 3-5 (component, styles) |
| 27 | High | 5-7 (models, service, API) |
| 28 | Medium | 3-5 (service updates) |
