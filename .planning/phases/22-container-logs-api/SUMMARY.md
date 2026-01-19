# Phase 22: Container Logs API - Summary

## Overview
Created backend API and WebSocket infrastructure to fetch and stream Docker container logs for applications, enabling real-time log viewing in the UI.

## Completed Tasks

### Task 1: DockerService Streaming Extensions
**Commit**: `f3010d9`

Added methods to DockerService for container log operations:
- `stream_container_logs()` - Start streaming logs via subprocess with `docker logs --follow`
- `get_app_container_id()` - Resolve container ID from Application model (handles both direct container_id and compose apps)
- `get_all_app_containers()` - List all containers for compose apps
- `parse_log_line()` - Parse Docker log line to extract timestamp and detect level (error/warn/info/debug)
- `parse_logs_to_lines()` - Batch parse logs text into structured lines
- `get_container_state()` - Check if container is running, get status info

### Task 2: REST API Endpoints
**Commit**: `744c626`

Added endpoints to `backend/app/api/apps.py`:

**GET /apps/{id}/container-logs**
- Query params: `tail`, `since`, `timestamps`, `format`, `service`
- Returns logs in 'raw' or 'json' format
- Includes container state and available services
- Caps at 10,000 lines for performance

**GET /apps/{id}/containers**
- Lists all containers for a compose application
- Returns container id, name, service, state

### Task 3: WebSocket Real-Time Streaming
**Commit**: `f55e399`

Added WebSocket events to `backend/app/sockets.py`:

**subscribe_container_logs** event
- Input: `{app_id, tail?, since?, service?}`
- Starts background thread streaming via `docker logs --follow`
- Joins room `logs_{app_id}`
- Emits `container_log` events with parsed log lines

**unsubscribe_container_logs** event
- Stops streaming subprocess
- Leaves room
- Cleans up resources

**Events emitted:**
- `container_log` - Log line with parsed timestamp/level
- `container_log_ended` - When container stops
- `container_log_error` - On stream failure

### Edge Cases Handled
- Container not found: Returns helpful error with hint
- Container stopped: REST returns existing logs, WebSocket emits ended event
- Compose apps: Service selection via `service` parameter
- Process cleanup: Terminates subprocess on disconnect/unsubscribe
- Large logs: Capped at 10,000 lines for REST API

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/services/docker_service.py` | +185 lines: streaming, parsing, container resolution |
| `backend/app/api/apps.py` | +151 lines: container-logs and containers endpoints |
| `backend/app/sockets.py` | +227 lines: WebSocket container log streaming |

## API Reference

### REST Endpoints

```
GET /api/v1/apps/{id}/container-logs
  ?tail=100        # Lines from end (max 10000)
  ?since=10m       # Duration or ISO timestamp
  ?timestamps=true # Include timestamps
  ?format=raw      # 'raw' or 'json'
  ?service=web     # Specific service for compose apps

GET /api/v1/apps/{id}/containers
  # List containers for compose apps
```

### WebSocket Events

```javascript
// Subscribe to logs
socket.emit('subscribe_container_logs', {
  app_id: 1,
  tail: 100,
  since: '10m',
  service: 'web'  // optional
});

// Receive logs
socket.on('container_log', (data) => {
  // data: {app_id, line, parsed: {timestamp, message, level}, timestamp}
});

socket.on('container_log_ended', (data) => {
  // Container stopped
});

socket.on('container_log_error', (data) => {
  // Stream error
});

// Unsubscribe
socket.emit('unsubscribe_container_logs');
```

## Testing Notes

- Tested against Docker compose applications
- Log streaming continues until container stops or client disconnects
- ANSI color codes preserved in output (frontend will parse)
- Timestamps parsed from Docker RFC3339 format

## Next Phase

Phase 23: Log Viewer UI
- Create LogViewer component with terminal-style display
- Implement auto-scroll with pause on user scroll
- Add ANSI color code parsing
- Connect to WebSocket for live streaming

## Commits

1. `f3010d9` - feat(22-1): Add streaming logs and container resolution to DockerService
2. `744c626` - feat(22-2): Add container-logs REST API endpoint
3. `f55e399` - feat(22-3): Add WebSocket container log streaming
