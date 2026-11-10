import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { usePolling } from '../../hooks/usePolling';

const POLL_MS = 15000;
const FEED_LIMIT = 9;

// Lives in the page, not in the component: started at page mount it runs in
// parallel with the page's own first load, so the overview can appear in one step.
export function useMonitorsSummary(refreshKey = 0, enabled = true) {
    const [monitors, setMonitors] = useState([]);
    const [stats, setStats] = useState(null);
    const [feed, setFeed] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState(null);

    const load = useCallback(async () => {
        try {
            const [listRes, statsRes] = await Promise.all([
                api.getMonitors(),
                api.getMonitorStats().catch(() => null),
            ]);
            const list = listRes?.monitors || [];
            setMonitors(list);
            setStats(statsRes?.stats || null);
            setLoadError(null);

            // The live feed is the most recently checked monitors, newest first —
            // derived from what we already fetched rather than a second request
            // per monitor.
            setFeed(
                [...list]
                    .filter((m) => m.last_check_at && !m.is_paused)
                    .sort((a, b) => new Date(b.last_check_at) - new Date(a.last_check_at))
                    .slice(0, FEED_LIMIT),
            );
        } catch (err) {
            // Overview must survive a monitors outage; the rest of the page is fine.
            setLoadError(err);
        } finally {
            setLoaded(true);
        }
    }, []);

    const refresh = usePolling(load, POLL_MS, { enabled });

    // The parent bumps refreshKey to force a reload (e.g. after creating a
    // monitor); it is not part of the polling schedule.
    useEffect(() => {
        if (refreshKey) refresh();
    }, [refreshKey, refresh]);

    return { monitors, stats, feed, loaded, loadError, load };
}
