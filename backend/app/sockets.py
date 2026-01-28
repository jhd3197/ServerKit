from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_jwt_extended import decode_token
from flask import request, current_app
import threading
import time
import queue

from app.services.system_service import SystemService
from app.services.log_service import LogService, LogStreamer
from app.services.docker_service import DockerService

socketio = SocketIO()
log_streamer = LogStreamer()

# Store active metric subscriptions
metric_subscribers = set()
metric_thread = None
metric_stop_event = threading.Event()

# Store active build subscriptions
build_subscribers = {}  # sid -> app_id
build_log_queues = {}  # app_id -> queue

# Store active container log streams
container_log_streams = {}  # sid -> {'process': Popen, 'app_id': int, 'thread': Thread, 'stop_event': Event}

# Store active pipeline subscriptions
pipeline_subscribers = {}  # sid -> set of project_ids


def init_socketio(app):
    """Initialize SocketIO with the Flask app."""
    socketio.init_app(
        app,
        cors_allowed_origins=app.config.get('CORS_ORIGINS', '*'),
        async_mode='threading'
    )
    return socketio


@socketio.on('connect')
def handle_connect():
    """Handle client connection."""
    # Verify JWT token from query string
    token = request.args.get('token')
    if token:
        try:
            decode_token(token)
            emit('connected', {'status': 'connected'})
        except Exception as e:
            emit('error', {'message': 'Invalid token'})
            return False
    else:
        emit('error', {'message': 'Token required'})
        return False


@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection."""
    sid = request.sid

    # Remove from metric subscribers
    if sid in metric_subscribers:
        metric_subscribers.remove(sid)

    # Stop any log streams for this client
    log_streamer.stop_stream(sid)

    # Stop any container log streams for this client
    stop_container_log_stream(sid)

    # Remove from pipeline subscribers
    pipeline_subscribers.pop(sid, None)


@socketio.on('subscribe_metrics')
def handle_subscribe_metrics():
    """Subscribe to real-time system metrics."""
    global metric_thread, metric_stop_event

    sid = request.sid
    metric_subscribers.add(sid)

    # Start metric broadcast thread if not running
    if metric_thread is None or not metric_thread.is_alive():
        metric_stop_event.clear()
        metric_thread = threading.Thread(target=broadcast_metrics, daemon=True)
        metric_thread.start()

    emit('subscribed', {'channel': 'metrics'})


@socketio.on('unsubscribe_metrics')
def handle_unsubscribe_metrics():
    """Unsubscribe from system metrics."""
    sid = request.sid
    if sid in metric_subscribers:
        metric_subscribers.remove(sid)
    emit('unsubscribed', {'channel': 'metrics'})


def broadcast_metrics():
    """Broadcast system metrics to all subscribers."""
    global metric_stop_event

    while not metric_stop_event.is_set() and metric_subscribers:
        try:
            metrics = SystemService.get_all_metrics()
            socketio.emit('metrics', metrics, room=None)  # Broadcast to all
        except Exception as e:
            print(f"Error broadcasting metrics: {e}")

        time.sleep(2)  # Update every 2 seconds


@socketio.on('subscribe_logs')
def handle_subscribe_logs(data):
    """Subscribe to real-time log streaming."""
    sid = request.sid
    filepath = data.get('path')

    if not filepath:
        emit('error', {'message': 'Log path required'})
        return

    # Start log stream
    log_queue = log_streamer.start_stream(sid, filepath)

    # Create thread to emit log updates
    def emit_logs():
        while True:
            try:
                log_data = log_queue.get(timeout=30)
                if 'error' in log_data:
                    socketio.emit('log_error', log_data, room=sid)
                    break
                socketio.emit('log_line', log_data, room=sid)
            except:
                break

    thread = threading.Thread(target=emit_logs, daemon=True)
    thread.start()

    emit('subscribed', {'channel': 'logs', 'path': filepath})


@socketio.on('unsubscribe_logs')
def handle_unsubscribe_logs():
    """Unsubscribe from log streaming."""
    sid = request.sid
    log_streamer.stop_stream(sid)
    emit('unsubscribed', {'channel': 'logs'})


@socketio.on('join_room')
def handle_join_room(data):
    """Join a specific room for targeted broadcasts."""
    room = data.get('room')
    if room:
        join_room(room)
        emit('joined', {'room': room})


@socketio.on('leave_room')
def handle_leave_room(data):
    """Leave a specific room."""
    room = data.get('room')
    if room:
        leave_room(room)
        emit('left', {'room': room})


# ==================== BUILD LOG STREAMING ====================

@socketio.on('subscribe_build')
def handle_subscribe_build(data):
    """Subscribe to build log streaming for an app."""
    sid = request.sid
    app_id = data.get('app_id')

    if not app_id:
        emit('error', {'message': 'app_id required'})
        return

    # Store subscription
    build_subscribers[sid] = app_id

    # Join a room for this app's builds
    join_room(f'build_{app_id}')

    emit('subscribed', {'channel': 'build', 'app_id': app_id})


@socketio.on('unsubscribe_build')
def handle_unsubscribe_build():
    """Unsubscribe from build log streaming."""
    sid = request.sid

    if sid in build_subscribers:
        app_id = build_subscribers[sid]
        leave_room(f'build_{app_id}')
        del build_subscribers[sid]

    emit('unsubscribed', {'channel': 'build'})


def emit_build_log(app_id: int, message: str, level: str = 'info'):
    """Emit a build log message to all subscribers.

    This function is called from the build service to stream logs.
    """
    socketio.emit('build_log', {
        'app_id': app_id,
        'message': message,
        'level': level,
        'timestamp': time.time()
    }, room=f'build_{app_id}')


def emit_build_status(app_id: int, status: str, details: dict = None):
    """Emit a build status update to all subscribers."""
    socketio.emit('build_status', {
        'app_id': app_id,
        'status': status,
        'details': details or {},
        'timestamp': time.time()
    }, room=f'build_{app_id}')


def create_build_log_callback(app_id: int):
    """Create a log callback function for the build service.

    Returns a function that can be passed to BuildService.build()
    to stream logs in real-time via WebSocket.
    """
    def log_callback(message: str):
        emit_build_log(app_id, message)
    return log_callback


# ==================== CONTAINER LOG STREAMING ====================

@socketio.on('subscribe_container_logs')
def handle_subscribe_container_logs(data):
    """Subscribe to real-time container log streaming.

    data: {
        'app_id': int,
        'tail': int (optional, default 100),
        'since': str (optional),
        'service': str (optional, for compose apps)
    }

    Emits:
        - 'subscribed': Confirmation with app_id and container info
        - 'container_log': Log lines as they arrive
        - 'container_log_error': If streaming fails
        - 'container_log_ended': When stream ends (container stopped)
    """
    from app.models import Application, User
    from app import db

    sid = request.sid
    app_id = data.get('app_id')
    tail = data.get('tail', 100)
    since = data.get('since')
    service = data.get('service')

    if not app_id:
        emit('error', {'message': 'app_id required'})
        return

    # Stop any existing stream for this client
    stop_container_log_stream(sid)

    # Get app and verify access
    try:
        app = Application.query.get(app_id)
        if not app:
            emit('container_log_error', {'message': 'Application not found', 'app_id': app_id})
            return
    except Exception as e:
        emit('container_log_error', {'message': f'Database error: {str(e)}', 'app_id': app_id})
        return

    # Get container ID
    all_containers = DockerService.get_all_app_containers(app)

    container_id = None
    container_name = None

    if service:
        for c in all_containers:
            if c.get('service') == service or c.get('name') == service:
                container_id = c.get('id') or c.get('name')
                container_name = c.get('name')
                break
    else:
        container_id = DockerService.get_app_container_id(app)
        if all_containers:
            container_name = all_containers[0].get('name')

    if not container_id:
        emit('container_log_error', {
            'message': 'No container found for this application',
            'app_id': app_id,
            'hint': 'The application may not have been started yet'
        })
        return

    # Check container state
    container_state = DockerService.get_container_state(container_id)
    if not container_state:
        emit('container_log_error', {
            'message': 'Container not found or no longer exists',
            'app_id': app_id
        })
        return

    # Join room for this app's logs
    join_room(f'logs_{app_id}')

    # Start streaming process
    process = DockerService.stream_container_logs(
        container_id,
        tail=tail,
        since=since,
        timestamps=True
    )

    if not process:
        emit('container_log_error', {
            'message': 'Failed to start log stream',
            'app_id': app_id
        })
        return

    # Create stop event for this stream
    stop_event = threading.Event()

    # Create thread to read and emit logs
    def stream_logs():
        try:
            while not stop_event.is_set():
                line = process.stdout.readline()
                if not line:
                    # Process ended (container stopped or exited)
                    if not stop_event.is_set():
                        socketio.emit('container_log_ended', {
                            'app_id': app_id,
                            'message': 'Container log stream ended'
                        }, room=f'logs_{app_id}')
                    break

                # Parse the log line
                parsed = DockerService.parse_log_line(line.rstrip('\n'))

                socketio.emit('container_log', {
                    'app_id': app_id,
                    'line': line.rstrip('\n'),
                    'parsed': parsed,
                    'timestamp': time.time()
                }, room=f'logs_{app_id}')
        except Exception as e:
            if not stop_event.is_set():
                socketio.emit('container_log_error', {
                    'app_id': app_id,
                    'message': f'Stream error: {str(e)}'
                }, room=f'logs_{app_id}')
        finally:
            # Clean up
            try:
                process.terminate()
                process.wait(timeout=2)
            except:
                try:
                    process.kill()
                except:
                    pass

    thread = threading.Thread(target=stream_logs, daemon=True)
    thread.start()

    # Store stream info for cleanup
    container_log_streams[sid] = {
        'process': process,
        'app_id': app_id,
        'thread': thread,
        'stop_event': stop_event,
        'container_id': container_id
    }

    emit('subscribed', {
        'channel': 'container_logs',
        'app_id': app_id,
        'container_id': container_id,
        'container_name': container_name,
        'container_state': container_state,
        'containers': all_containers
    })


@socketio.on('unsubscribe_container_logs')
def handle_unsubscribe_container_logs():
    """Unsubscribe from container log streaming."""
    sid = request.sid
    stream_info = container_log_streams.get(sid)

    if stream_info:
        app_id = stream_info.get('app_id')
        leave_room(f'logs_{app_id}')
        stop_container_log_stream(sid)

    emit('unsubscribed', {'channel': 'container_logs'})


def stop_container_log_stream(sid: str):
    """Stop a container log stream for a specific session.

    Args:
        sid: Socket session ID
    """
    stream_info = container_log_streams.pop(sid, None)
    if stream_info:
        # Signal thread to stop
        stop_event = stream_info.get('stop_event')
        if stop_event:
            stop_event.set()

        # Terminate the process
        process = stream_info.get('process')
        if process:
            try:
                process.terminate()
                process.wait(timeout=2)
            except:
                try:
                    process.kill()
                except:
                    pass


def emit_container_log(app_id: int, line: str, level: str = 'info'):
    """Emit a container log line to all subscribers.

    This function can be called externally to inject log messages.
    """
    socketio.emit('container_log', {
        'app_id': app_id,
        'line': line,
        'parsed': {
            'timestamp': None,
            'message': line,
            'level': level
        },
        'timestamp': time.time()
    }, room=f'logs_{app_id}')


# ==================== PIPELINE EVENT STREAMING ====================

@socketio.on('subscribe_pipeline')
def handle_subscribe_pipeline(data):
    """Subscribe to real-time pipeline events for a WordPress project.

    data: {
        'project_id': int  (production site ID)
    }

    Emits 'pipeline_event' with:
        - project_id: int
        - event: string (e.g. 'promotion_started', 'sync_completed')
        - data: dict with event-specific details
        - timestamp: float
    """
    sid = request.sid
    project_id = data.get('project_id')

    if not project_id:
        emit('error', {'message': 'project_id required'})
        return

    room = f'pipeline_{project_id}'
    join_room(room)

    if sid not in pipeline_subscribers:
        pipeline_subscribers[sid] = set()
    pipeline_subscribers[sid].add(project_id)

    emit('subscribed', {'channel': 'pipeline', 'project_id': project_id})


@socketio.on('unsubscribe_pipeline')
def handle_unsubscribe_pipeline(data):
    """Unsubscribe from pipeline events for a project."""
    sid = request.sid
    project_id = data.get('project_id')

    if project_id:
        leave_room(f'pipeline_{project_id}')
        if sid in pipeline_subscribers:
            pipeline_subscribers[sid].discard(project_id)
            if not pipeline_subscribers[sid]:
                del pipeline_subscribers[sid]

    emit('unsubscribed', {'channel': 'pipeline', 'project_id': project_id})


def emit_pipeline_event(project_id: int, event: str, data: dict = None):
    """Emit a pipeline event to all subscribers of a project.

    Called from EnvironmentPipelineService or API endpoints to notify
    the frontend about long-running operations (promote, sync, create).

    Args:
        project_id: Production site ID
        event: Event type (e.g. 'promotion_started', 'sync_completed',
               'environment_created', 'environment_deleted')
        data: Event-specific payload
    """
    socketio.emit('pipeline_event', {
        'project_id': project_id,
        'event': event,
        'data': data or {},
        'timestamp': time.time()
    }, room=f'pipeline_{project_id}')
