import { useState, useEffect, useCallback, useRef } from 'react';
import socketService from '../services/socket';
import api from '../services/api';

// Default polling interval in ms (10 seconds)
const DEFAULT_POLL_INTERVAL = 10000;

export function useMetrics(useWebSocket = true, pollInterval = DEFAULT_POLL_INTERVAL) {
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);
    const pollIntervalRef = useRef(null);

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

    // Start polling when not connected via WebSocket
    const startPolling = useCallback(() => {
        if (pollIntervalRef.current) return; // Already polling
        if (pollInterval <= 0) return; // Polling disabled

        pollIntervalRef.current = setInterval(fetchMetrics, pollInterval);
    }, [fetchMetrics, pollInterval]);

    // Stop polling
    const stopPolling = useCallback(() => {
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
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
                stopPolling(); // Stop polling when WS connects
                socketService.subscribeMetrics();
            });

            const unsubDisconnect = socketService.on('disconnected', () => {
                setConnected(false);
                startPolling(); // Start polling when WS disconnects
            });

            const unsubMetrics = socketService.on('metrics', (data) => {
                setMetrics(data);
                setLoading(false);
            });

            const unsubError = socketService.on('error', (err) => {
                setError(err.message || 'WebSocket error');
                startPolling(); // Start polling on error
            });

            // Start polling initially (will stop if WS connects)
            // Give WebSocket 3 seconds to connect before starting poll
            const pollTimeout = setTimeout(() => {
                if (!socketService.socket?.connected) {
                    startPolling();
                }
            }, 3000);

            return () => {
                clearTimeout(pollTimeout);
                unsubConnect();
                unsubDisconnect();
                unsubMetrics();
                unsubError();
                socketService.unsubscribeMetrics();
                stopPolling();
            };
        } else {
            // Polling only mode
            startPolling();
            return () => stopPolling();
        }
    }, [useWebSocket, fetchMetrics, startPolling, stopPolling]);

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
