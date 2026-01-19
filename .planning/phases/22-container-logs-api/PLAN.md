# Phase 22: Container Logs API - Execution Plan

## Goal
Create backend API to fetch and stream Docker container logs for applications, enabling real-time log viewing in the UI (Phase 23).

## Prerequisites
- Docker apps exist with `container_id` or can be resolved via `root_path`
- WebSocket infrastructure exists (Flask-SocketIO with threading async_mode)
- Existing `DockerService.get_container_logs()` method available

## Architecture

### Existing Infrastructure

**DockerService** (`backend/app/services/docker_service.py:237-254`):
```python
@staticmethod
def get_container_logs(container_id, tail=100, since=None, timestamps=True):
    """Get container logs."""
    cmd = ['docker', 'logs']
    if tail:
        cmd.extend(['--tail', str(tail)])
    if since:
        cmd.extend(['--since', since])
    if timestamps:
        cmd.append('-t')
    cmd.append(container_id)
    # Returns {'success': True, 'logs': logs} or {'success': False, 'error': str}
```

**WebSocket Pattern** (`backend/app/sockets.py`):
- Uses room-based streaming: `join_room(f'build_{app_id}')`
- Build logs emit via `emit_build_log(app_id, message, level)`
- Clients subscribe via `subscribe_build` event with `app_id`

**Application Model** (`backend/app/models/application.py`):
- `container_id`: String(100), nullable - stores Docker container ID
- `root_path`: String(500) - path to docker-compose directory
- For compose apps: container names follow `serverkit-app-{app.id}` pattern

### Log Streaming Flow
```
1. Client connects to WebSocket with JWT token
2. Client emits 'subscribe_container_logs' with app_id
3. Server joins room 'logs_{app_id}'
4. Server starts background thread to stream logs via `docker logs -f`
5. Server emits 'container_log' events to room
6. Client emits 'unsubscribe_container_logs' or disconnects
7. Server stops background thread and leaves room
```

## Tasks

### Task 1: Extend DockerService with Streaming Logs
**File**: `backend/app/services/docker_service.py`

Add method for streaming container logs:
```python
@staticmethod
def stream_container_logs(container_id, callback, tail=100, since=None, timestamps=True):
    """Stream container logs in real-time.

    Args:
        container_id: Docker container ID or name
        callback: Function to call with each log line
        tail: Number of existing lines to fetch first
        since: Only logs since this timestamp
        timestamps: Include timestamps in output

    Returns:
        subprocess.Popen object for the streaming process
    """
    cmd = ['docker', 'logs', '--follow']
    if tail:
        cmd.extend(['--tail', str(tail)])
    if since:
        cmd.extend(['--since', since])
    if timestamps:
        cmd.append('-t')
    cmd.append(container_id)

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    return process
```

### Task 2: Create Container Logs REST API Endpoint
**File**: `backend/app/api/apps.py`

Extend existing `/apps/<id>/logs` endpoint to support container logs with more options:
```python
@apps_bp.route('/<int:app_id>/container-logs', methods=['GET'])
@jwt_required()
def get_container_logs(app_id):
    """Get container logs for a Docker application.

    Query params:
        - tail: Number of lines from end (default: 100, max: 10000)
        - since: ISO timestamp or duration (e.g., '10m', '1h', '2024-01-01T00:00:00Z')
        - timestamps: Include timestamps (default: true)
        - format: Output format - 'raw' or 'json' (default: 'raw')

    Returns:
        {
            "success": true,
            "logs": "...",  // Raw format
            "lines": [...]  // JSON format with parsed lines
            "container_id": "...",
            "container_name": "...",
            "app_id": 1
        }
    """
```

### Task 3: Add Container Logs WebSocket Events
**File**: `backend/app/sockets.py`

Add WebSocket handlers for real-time log streaming:
```python
# Store active log streams
container_log_streams = {}  # sid -> {'process': Popen, 'app_id': int, 'thread': Thread}

@socketio.on('subscribe_container_logs')
def handle_subscribe_container_logs(data):
    """Subscribe to real-time container log streaming.

    data: {
        'app_id': int,
        'tail': int (optional, default 100),
        'since': str (optional)
    }
    """
    sid = request.sid
    app_id = data.get('app_id')
    tail = data.get('tail', 100)
    since = data.get('since')

    # Validate token and app access (already done in connect)
    # Get container ID from app
    # Start streaming thread
    # Join room for this app's logs
    join_room(f'logs_{app_id}')

@socketio.on('unsubscribe_container_logs')
def handle_unsubscribe_container_logs():
    """Unsubscribe from container log streaming."""
    sid = request.sid
    # Stop streaming process
    # Leave room
    # Clean up

def emit_container_log(app_id: int, line: str, timestamp: str = None):
    """Emit a container log line to all subscribers."""
    socketio.emit('container_log', {
        'app_id': app_id,
        'line': line,
        'timestamp': timestamp or time.time()
    }, room=f'logs_{app_id}')
```

### Task 4: Handle Container Resolution for Compose Apps
**File**: `backend/app/services/docker_service.py`

Add method to get container name/ID for an app:
```python
@staticmethod
def get_app_container_id(app):
    """Get the main container ID for an application.

    For apps with container_id set, use that directly.
    For compose apps, query docker compose ps to find container.

    Args:
        app: Application model instance

    Returns:
        str: Container ID or name, or None if not found
    """
    if app.container_id:
        return app.container_id

    if app.root_path:
        # Get containers from docker compose
        containers = DockerService.compose_ps(app.root_path)
        if containers:
            # Return first container (main service)
            # For compose apps, container name is typically service name
            return containers[0].get('ID') or containers[0].get('Name')

    return None

@staticmethod
def get_app_container_name(app_id):
    """Get container name by convention: serverkit-app-{app_id}"""
    return f"serverkit-app-{app_id}"
```

### Task 5: Add Log Line Parsing Utility
**File**: `backend/app/services/docker_service.py`

Add utility to parse Docker log lines:
```python
@staticmethod
def parse_log_line(line):
    """Parse a Docker log line into structured format.

    Docker logs with timestamps look like:
    2024-01-15T10:30:45.123456789Z Log message here

    Returns:
        {
            'timestamp': '2024-01-15T10:30:45.123456789Z',
            'message': 'Log message here',
            'level': 'info'  # Detected from content
        }
    """
    # Parse timestamp if present
    # Detect log level from message content (ERROR, WARN, INFO, DEBUG)
    # Return structured object
```

### Task 6: Handle Non-Running Container Edge Cases
**File**: `backend/app/api/apps.py` and `backend/app/sockets.py`

Handle edge cases gracefully:
- Container doesn't exist: Return appropriate error message
- Container is stopped: Return existing logs (no streaming)
- Container is restarting: Handle reconnection
- Multiple containers (compose): Allow selecting specific service

```python
# In REST endpoint
if not container_id:
    return jsonify({
        'success': False,
        'error': 'No container found for this application',
        'hint': 'The application may not have been started yet'
    }), 404

# Check if container is running for streaming
container_info = DockerService.get_container(container_id)
if not container_info:
    return jsonify({
        'success': False,
        'error': 'Container not found'
    }), 404

state = container_info.get('State', {}).get('Status', 'unknown')
```

### Task 7: Add API Documentation
**File**: Update API with docstrings and OpenAPI-style docs

Document the new endpoints:
- `GET /apps/{id}/container-logs` - Fetch historical logs
- WebSocket `subscribe_container_logs` - Stream real-time logs
- WebSocket `unsubscribe_container_logs` - Stop streaming
- WebSocket `container_log` event - Log line event

## Success Criteria
- [ ] Can fetch last N lines of container logs via REST API
- [ ] Can stream logs in real-time via WebSocket
- [ ] Logs include timestamps
- [ ] Handles containers that aren't running (returns stored logs or error)
- [ ] Handles compose apps (multiple containers)
- [ ] JSON format option for structured log data
- [ ] Proper cleanup when client disconnects

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/services/docker_service.py` | Modify | Add streaming logs, container resolution, log parsing |
| `backend/app/api/apps.py` | Modify | Add `/container-logs` endpoint |
| `backend/app/sockets.py` | Modify | Add container log streaming WebSocket events |

## Technical Notes

### Docker Logs Command Reference
```bash
# Basic logs
docker logs <container>

# With options
docker logs --tail 100 --since "10m" -t --follow <container>

# Options:
#   --tail N       Show last N lines
#   --since TIME   Show logs since timestamp (RFC3339) or duration (10m, 1h)
#   -t, --timestamps   Show timestamps
#   -f, --follow      Stream new logs
```

### WebSocket Room Naming Convention
- Build logs: `build_{app_id}`
- Container logs: `logs_{app_id}`
- Metrics: broadcast to all subscribers

### Log Buffer Limits
- REST API: Max 10,000 lines per request
- WebSocket: No buffer limit (streaming)
- Frontend (Phase 23): Should implement virtual scrolling for large log volumes

### ANSI Color Codes
Docker logs may contain ANSI color codes. These will be preserved in the output and handled by the frontend (Phase 23) using an ANSI parser.

## Estimated Commits
- feat(22-1): Add streaming logs method to DockerService
- feat(22-2): Add container-logs REST endpoint
- feat(22-3): Add WebSocket container log streaming
- feat(22-4): Add container resolution for compose apps
- feat(22-5): Add log parsing utility
- feat(22-6): Handle edge cases for non-running containers
