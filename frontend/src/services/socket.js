import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:5000';

class SocketService {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
    }

    connect() {
        const token = localStorage.getItem('access_token');
        if (!token) {
            console.warn('No token available for WebSocket connection');
            return;
        }

        if (this.socket?.connected) {
            return;
        }

        this.socket = io(SOCKET_URL, {
            query: { token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        this.socket.on('connect', () => {
            console.log('WebSocket connected');
            this.emit('connected');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('WebSocket disconnected:', reason);
            this.emit('disconnected', reason);
        });

        this.socket.on('error', (error) => {
            console.error('WebSocket error:', error);
            this.emit('error', error);
        });

        this.socket.on('metrics', (data) => {
            this.emit('metrics', data);
        });

        this.socket.on('log_line', (data) => {
            this.emit('log_line', data);
        });

        this.socket.on('log_error', (data) => {
            this.emit('log_error', data);
        });
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    subscribeMetrics() {
        if (this.socket?.connected) {
            this.socket.emit('subscribe_metrics');
        }
    }

    unsubscribeMetrics() {
        if (this.socket?.connected) {
            this.socket.emit('unsubscribe_metrics');
        }
    }

    subscribeLogs(filepath) {
        if (this.socket?.connected) {
            this.socket.emit('subscribe_logs', { path: filepath });
        }
    }

    unsubscribeLogs() {
        if (this.socket?.connected) {
            this.socket.emit('unsubscribe_logs');
        }
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        return () => {
            this.listeners.get(event)?.delete(callback);
        };
    }

    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
    }

    emit(event, data) {
        this.listeners.get(event)?.forEach(callback => {
            try {
                callback(data);
            } catch (e) {
                console.error('Socket listener error:', e);
            }
        });
    }
}

export const socketService = new SocketService();
export default socketService;
