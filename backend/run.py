import os
from app import create_app, get_socketio

app = create_app()
socketio = get_socketio()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_ENV', 'development') == 'development'

    # Use SocketIO to run the app (supports WebSocket)
    socketio.run(app, host='0.0.0.0', port=port, debug=debug, allow_unsafe_werkzeug=True)
