import os
import sys
from app import create_app, get_socketio

app = create_app()
socketio = get_socketio()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    env = os.environ.get('FLASK_ENV', 'development')
    debug = env == 'development'

    # Prevent running development server in production
    if env == 'production':
        print("ERROR: Do not run the development server in production!", file=sys.stderr)
        print("Use a production WSGI server like gunicorn instead:", file=sys.stderr)
        print("  gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 run:app", file=sys.stderr)
        sys.exit(1)

    # Use SocketIO to run the app (supports WebSocket) - only in development
    socketio.run(app, host='0.0.0.0', port=port, debug=debug)
