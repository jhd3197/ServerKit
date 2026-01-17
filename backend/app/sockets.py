from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_jwt_extended import decode_token
from flask import request
import threading
import time

from app.services.system_service import SystemService
from app.services.log_service import LogService, LogStreamer

socketio = SocketIO()
log_streamer = LogStreamer()

# Store active metric subscriptions
metric_subscribers = set()
metric_thread = None
metric_stop_event = threading.Event()


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
