import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

// Which host the Monitoring pages are describing. Kept in the URL (`?server=`)
// rather than component state so it survives a tab change, a refresh, and a
// pasted link — every section under /monitoring reads the same scope.
//
// `host` is the panel's own machine (the one /monitoring/status reports on);
// any other value is a paired server id.
export const HOST_SCOPE = 'host';

export function useMonitorScope() {
    const { t } = useTranslation();
    const [params, setParams] = useSearchParams();
    const [servers, setServers] = useState([]);

    useEffect(() => {
        let cancelled = false;
        api.getServers()
            .then((data) => {
                if (cancelled) return;
                const list = data?.servers || data;
                setServers(Array.isArray(list) ? list : []);
            })
            .catch(() => { if (!cancelled) setServers([]); });
        return () => { cancelled = true; };
    }, []);

    const scope = params.get('server') || HOST_SCOPE;

    const setScope = (next) => {
        const p = new URLSearchParams(params);
        if (!next || next === HOST_SCOPE) p.delete('server');
        else p.set('server', next);
        setParams(p, { replace: true });
    };

    // A scope pointing at a server that has since been unpaired falls back to
    // the panel host rather than rendering an empty page.
    const server = useMemo(
        () => servers.find((s) => String(s.id) === String(scope)) || null,
        [servers, scope],
    );
    const effective = scope === HOST_SCOPE || server ? scope : HOST_SCOPE;

    return {
        scope: effective,
        isHost: effective === HOST_SCOPE,
        server,
        servers,
        setScope,
        label: effective === HOST_SCOPE
            ? t('app.monitorScope.thisServer', 'This server')
            : (server?.name || t('app.monitorScope.unknownServer', 'Unknown server')),
    };
}

// Metric history for whichever host is in scope. The panel host and a paired
// server come from different endpoints with slightly different point shapes,
// so normalize both to plain number[] series here — every caller downstream
// (KPI sparklines, the big charts) then works the same for either scope.
export function useScopeMetrics(scope, period, refreshKey = 0) {
    const [series, setSeries] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const request = scope === HOST_SCOPE
            ? api.getMetricsHistory(period)
            : api.getServerMetricsHistory(scope, period);
        request
            .then((res) => {
                if (cancelled) return;
                const points = Array.isArray(res?.data) ? res.data : [];
                setSeries({
                    cpu: points.map((p) => num(p.cpu?.percent ?? p.cpu_percent)),
                    memory: points.map((p) => num(p.memory?.percent ?? p.memory_percent)),
                    disk: points.map((p) => num(p.disk?.percent ?? p.disk_percent)),
                    timestamps: points.map((p) => p.timestamp),
                    summary: res?.summary || null,
                });
            })
            .catch(() => { if (!cancelled) setSeries(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [scope, period, refreshKey]);

    return { series, loading };
}

function num(value) {
    return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

// Change over the window: mean of the last third against the mean of the
// first third. A first-vs-last-point delta reads as noise on a jittery series;
// comparing block means says whether the metric is actually trending.
export function trendOf(values) {
    // Explicitly null for the tiles that have no series (load average, container
    // count) — a default parameter only covers `undefined`.
    if (!values || values.length < 6) return null;
    const block = Math.floor(values.length / 3);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const delta = mean(values.slice(-block)) - mean(values.slice(0, block));
    if (Math.abs(delta) < 0.5) return null;
    return delta;
}
