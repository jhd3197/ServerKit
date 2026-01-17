import { useState, useEffect, useCallback } from 'react';
import socketService from '../services/socket';
import api from '../services/api';

export function useMetrics(useWebSocket = true) {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);

    const fetchMetrics = useCallback(async () => {
        try {
            const data = await api.getSystemMetrics();
            setMetrics(data);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Initial fetch
        fetchMetrics();

        if (useWebSocket) {
            // Connect WebSocket
            socketService.connect();

            // Set up listeners
            const unsubConnect = socketService.on('connected', () => {
                setConnected(true);
                socketService.subscribeMetrics();
            });

            const unsubDisconnect = socketService.on('disconnected', () => {
                setConnected(false);
            });

            const unsubMetrics = socketService.on('metrics', (data) => {
                setMetrics(data);
                setLoading(false);
            });

            const unsubError = socketService.on('error', (err) => {
                setError(err.message || 'WebSocket error');
            });

            return () => {
                unsubConnect();
                unsubDisconnect();
                unsubMetrics();
                unsubError();
                socketService.unsubscribeMetrics();
            };
        } else {
            // Polling fallback
            const interval = setInterval(fetchMetrics, 5000);
            return () => clearInterval(interval);
        }
    }, [useWebSocket, fetchMetrics]);

    return { metrics, loading, error, connected, refresh: fetchMetrics };
}

export function useLogs(filepath) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!filepath) return;

        // Fetch initial logs
        api.readLog(filepath, 100).then(result => {
            if (result.success) {
                setLogs(result.lines);
            }
            setLoading(false);
        });

        // Connect WebSocket for real-time updates
        socketService.connect();

        const unsubLine = socketService.on('log_line', (data) => {
            if (data.filepath === filepath) {
                setLogs(prev => [...prev.slice(-499), data.line]);
            }
        });

        // Subscribe to log stream
        socketService.subscribeLogs(filepath);

        return () => {
            unsubLine();
            socketService.unsubscribeLogs();
        };
    }, [filepath]);

    const clearLogs = useCallback(() => {
        setLogs([]);
    }, []);

    return { logs, loading, clearLogs };
}

export default useMetrics;
