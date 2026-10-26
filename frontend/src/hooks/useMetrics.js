import { useState, useEffect, useCallback, useRef } from 'react';
import socketService from '../services/socket';
import api from '../services/api';
import { usePolling } from './usePolling';
import { subscribeToMetrics } from '../utils/metricsSubscription';

const DEFAULT_POLL_INTERVAL = 10000;

// `enabled` selects the local host; `autoRefresh` also controls the live stream.
// Manual refresh and the initial snapshot remain available with auto-refresh off.
export function useMetrics(useWebSocket = true, pollInterval = DEFAULT_POLL_INTERVAL, options = {}) {
    const { enabled = true, autoRefresh = true } = options;
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [connected, setConnected] = useState(false);
    const inFlight = useRef(null);
    const active = useRef(false);

    const fetchMetrics = useCallback(() => {
        // Mount, manual refresh, and restarted pollers share this guard, even
        // when a slow request spans a socket reconnect.
        if (inFlight.current) return inFlight.current;
        const request = Promise.resolve().then(() => api.getSystemMetrics())
            .then((data) => {
                if (active.current) { setMetrics(data); setError(null); }
            }).catch((err) => {
                if (active.current) setError(err.message);
            }).finally(() => {
                inFlight.current = null;
                if (active.current) setLoading(false);
            });
        inFlight.current = request;
        return request;
    }, []);

    useEffect(() => {
        active.current = enabled;
        if (enabled) fetchMetrics();
        return () => { active.current = false; };
    }, [enabled, fetchMetrics]);

    useEffect(() => {
        setConnected(false);
        if (!enabled || !autoRefresh || !useWebSocket) return undefined;
        return subscribeToMetrics(socketService, {
            onConnected: setConnected,
            onMetrics: (data) => { setMetrics(data); setLoading(false); setError(null); },
            onError: (err) => setError(err?.message || 'WebSocket error'),
        });
    }, [enabled, autoRefresh, useWebSocket]);

    usePolling(fetchMetrics, pollInterval, {
        enabled: enabled && autoRefresh && pollInterval > 0 && !connected,
        immediate: false,
    });

    return { metrics, loading, error, connected, refresh: fetchMetrics };
}

export default useMetrics;
