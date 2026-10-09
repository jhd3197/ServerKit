/**
 * Data hooks shared by the dashboard widget renderers (plan 62).
 *
 * Renderers stay presentational: everything that talks to the API lives here.
 *
 * De-duplication: a board can easily hold ten stat widgets pointed at the same
 * server and range. Each one asks for the SAME history payload, so requests are
 * collapsed through the shared query client, with workspace-scoped keys for
 * `<kind>|<resource>|<metric>|<range>|<tick>`. Ten widgets on one tick produce
 * one HTTP request; the next tick makes a new key and refetches.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import api from '@/services/api';
import { t } from '@/i18n/t';
import { queryClient } from '@/services/queryClient';
import { fetchShared, widgetQueryKey, pruneWidgetQueries } from '@/services/widgetQueries';
import { useWorkspace } from '@/contexts/useWorkspace.js';
import {
    RANGE_IDS,
    getMetric,
    metricSupports,
    readAt,
    seriesFrom,
    sourceOf,
    stampsFrom,
} from './metrics';

/**
 * Normalise a thrown API error into what a widget needs to render.
 * ApiClient attaches `status`, so a permission problem (403 from
 * @admin_required / @viewer_required routes) can be shown as a calm
 * "not permitted" note rather than a red error tile.
 */
function toWidgetError(err) {
    const status = err?.status ?? null;
    return {
        message: err?.message || (err ? String(err) : t('app.useWidgetData.requestFailed', "Couldn't load this widget.")),
        status,
        forbidden: status === 403,
    };
}

/**
 * Generic "load this key once, share it, report loading/error" hook.
 * `loader` is read through a ref so an inline arrow does not re-trigger the
 * effect — the key is the identity.
 */
function useShared(key, loader, enabled = true) {
    const { activeWorkspaceId } = useWorkspace();
    const queryKey = useMemo(() => widgetQueryKey(key, activeWorkspaceId), [key, activeWorkspaceId]);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;
    const subscribe = useCallback((listener) => {
        // Fullscreen can remount while a request is pending. Keep that request
        // shared until it settles, then bound the unobserved retained results.
        const unsubscribe = queryClient.subscribe(queryKey, listener, { cancelOnUnsubscribe: false });
        return () => { unsubscribe(); pruneWidgetQueries(); };
    }, [queryKey]);
    const getSnapshot = useCallback(() => queryClient.getSnapshot(queryKey), [queryKey]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const previous = useRef(null);
    // Tick is the trailing numeric segment of refreshable widget keys. Keep
    // the last successful payload during a board refresh, but never carry it
    // across a changed resource, range, or workspace.
    const resourceKey = key.replace(/\|\d+$/, '');
    if (state.status === 'success') {
        previous.current = { resourceKey, workspaceId: activeWorkspaceId, data: state.data };
    } else if (state.status === 'error') {
        previous.current = null;
    }
    const previousData = previous.current?.resourceKey === resourceKey
        && previous.current?.workspaceId === activeWorkspaceId
        ? previous.current.data : null;

    useEffect(() => {
        if (!enabled) return;
        fetchShared(key, () => loaderRef.current(), activeWorkspaceId).catch(() => {
            // The shared snapshot owns errors; keep permission failures visible.
        });
    }, [key, activeWorkspaceId, enabled, state.revision]);

    if (!enabled) return { data: null, loading: false, error: null };
    return {
        data: state.status === 'error' ? null : state.data ?? previousData,
        loading: state.status === 'idle' || state.status === 'loading' || state.isFetching,
        error: state.error ? toWidgetError(state.error) : null,
    };
}

function safeRange(range) {
    return RANGE_IDS.includes(range) ? range : '1h';
}

/* ------------------------------------------------------------------ metrics */

/**
 * Raw history payload for one resource + range.
 *   local        -> GET /api/v1/system/performance-history?period=…
 *   agent server -> GET /api/v1/servers/<id>/metrics/history?period=…
 * Both answer `{ period, points, data: [...], summary }`.
 */
export function useMetricHistory(resource, range, tick) {
    const target = resource || 'local';
    const period = safeRange(range);
    const key = `history|${target}|${period}|${tick ?? 0}`;

    return useShared(key, () => (
        sourceOf(target) === 'local'
            ? api.getMetricsHistory(period)
            : api.getServerMetricsHistory(target, period)
    ));
}

/**
 * One metric's series for one resource.
 * `supported` is false when the metric has no backing column on that source
 * (e.g. load average on an agent server, network rate on the local host) —
 * renderers use it to say so instead of drawing a flat zero line.
 */
export function useMetricSeries(resource, metric, range, tick) {
    const metricId = typeof metric === 'string' ? metric : metric?.id;
    const { data, loading, error } = useMetricHistory(resource, range, tick);
    const meta = getMetric(metricId);
    const supported = metricSupports(meta, sourceOf(resource || 'local'));

    const series = useMemo(
        () => (supported ? seriesFrom(data, metricId) : []),
        [data, metricId, supported],
    );
    const stamps = useMemo(
        () => (supported ? stampsFrom(data, metricId) : []),
        [data, metricId, supported],
    );

    return { series, stamps, loading, error, supported, metric: meta };
}

/**
 * Several (resource, metric) pairs at once — what the time-series widget needs.
 *
 * One effect, not one per line: the histories are fetched through the SAME
 * `history|…` cache keys `useMetricHistory` uses, so a chart and the stat tiles
 * beside it pointed at one server share a single request.
 *
 * `entries` is [{ resource, metric }] with `$server` already resolved.
 */
export function useMetricSeriesSet(entries, range, tick) {
    const period = safeRange(range);
    const list = Array.isArray(entries) ? entries : [];
    const signature = list.map((e) => `${e?.resource || 'local'}:${e?.metric || ''}`).join(',');
    const key = `multi|${signature}|${period}|${tick ?? 0}`;

    const listRef = useRef(list);
    listRef.current = list;

    const { data, loading, error } = useShared(key, async () => {
        const current = listRef.current || [];
        const resources = [...new Set(current.map((e) => e?.resource || 'local'))];

        const payloads = new Map();
        await Promise.all(resources.map(async (resource) => {
            const payload = await fetchShared(
                `history|${resource}|${period}|${tick ?? 0}`,
                () => (sourceOf(resource) === 'local'
                    ? api.getMetricsHistory(period)
                    : api.getServerMetricsHistory(resource, period)),
            );
            payloads.set(resource, payload);
        }));

        return current.map((entry) => {
            const resource = entry?.resource || 'local';
            const meta = getMetric(entry?.metric);
            const supported = metricSupports(meta, sourceOf(resource));
            return {
                resource,
                metric: meta,
                supported,
                color: entry?.color || '',
                series: supported ? seriesFrom(payloads.get(resource), meta.id) : [],
                // Carried so the chart can label a hovered point with when it
                // was actually sampled rather than its index.
                stamps: supported ? stampsFrom(payloads.get(resource), meta.id) : [],
            };
        });
    });

    return {
        rows: useMemo(() => (Array.isArray(data) ? data : []), [data]),
        loading,
        error,
    };
}

/* -------------------------------------------------------------- inventories */

const ROW_LOADERS = {
    services: (limit) => api.getApps().then((d) => (Array.isArray(d?.apps) ? d.apps : [])).then((r) => r.slice(0, limit)),
    servers: () => api.getAvailableServers().then((d) => (Array.isArray(d) ? d : [])),
    containers: (limit) => api.getContainers(true).then((d) => (Array.isArray(d?.containers) ? d.containers : [])).then((r) => r.slice(0, limit)),
    deploys: (limit) => api.getDeploymentJobs({ limit }).then((d) => (Array.isArray(d?.jobs) ? d.jobs : [])),
};

/** Rows for the resource table. `source` is services | servers | containers | deploys. */
export function useResourceRows(source, limit = 6, tick) {
    const kind = ROW_LOADERS[source] ? source : 'services';
    const size = Math.max(1, Math.min(Number(limit) || 6, 50));
    const key = `rows|${kind}|${size}|${tick ?? 0}`;

    const { data, loading, error } = useShared(key, () => ROW_LOADERS[kind](size));
    const rows = useMemo(() => (Array.isArray(data) ? data.slice(0, size) : []), [data, size]);
    return { rows, loading, error, source: kind };
}

/** The servers the panel can address, used for display names and status. */
export function useServerDirectory() {
    // Deliberately tick-free: names change far more slowly than metrics, and
    // every stat/gauge/legend wants this list.
    const { data, loading, error } = useShared('servers|available', () => (
        api.getAvailableServers().then((d) => (Array.isArray(d) ? d : []))
    ));
    const servers = useMemo(() => (Array.isArray(data) ? data : []), [data]);
    const byId = useMemo(() => {
        const map = new Map();
        for (const s of servers) if (s && s.id) map.set(s.id, s);
        return map;
    }, [servers]);
    return { servers, byId, loading, error };
}

/** Display name for a resource id ('local', a server id, or the '$server' var). */
export function useResourceLabel(resource) {
    const { byId } = useServerDirectory();
    // Kept short on purpose: this sits in a stat widget's one-line meta row,
    // where "Local (this server)" wrapped onto a second line in a 3-column tile.
    if (!resource || resource === 'local') return 'This server';
    if (resource === '$server') return 'dashboard variable';
    return byId.get(resource)?.name || resource;
}

/* -------------------------------------------------------------- fleet views */

/** Latest metric snapshot per fleet server — the ranking + status source. */
export function useFleetHeatmap(tick) {
    const { data, loading, error } = useShared(`fleet|heatmap|${tick ?? 0}`, () => (
        api.getFleetHeatmap().then((d) => (Array.isArray(d) ? d : []))
    ));
    return { servers: useMemo(() => (Array.isArray(data) ? data : []), [data]), loading, error };
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

function normalizeFleetAlert(alert) {
    const metric = alert.metric || 'metric';
    const value = Number.isFinite(alert.value) ? Math.round(alert.value * 10) / 10 : null;
    const threshold = Number.isFinite(alert.threshold) ? alert.threshold : null;
    return {
        id: `fleet:${alert.id}`,
        title: value !== null && threshold !== null
            ? t('app.useWidgetData.metricAtThreshold', '{{metric}} at {{value}} (threshold {{threshold}})', { metric, value, threshold })
            : t('app.useWidgetData.metricThresholdExceeded', '{{metric}} threshold exceeded', { metric }),
        target: alert.server_name || alert.server_id || 'unknown server',
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        state: alert.status === 'acknowledged' ? 'acknowledged' : 'firing',
        time: alert.created_at || null,
    };
}

function normalizeLocalAlert(alert, index) {
    return {
        id: `local:${alert.type || index}`,
        title: alert.message || t('app.useWidgetData.typeExceeded', '{{type}} exceeded', { type: alert.type || 'threshold' }),
        target: t('app.useWidgetData.localThisServer', 'Local (this server)'),
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        state: 'firing',
        time: null,
    };
}

/**
 * Open alerts, merged from the two real sources:
 *   - GET /api/v1/fleet-monitor/alerts?status=active   (MetricAlert rows)
 *   - GET /api/v1/monitoring/alerts/check              (live host thresholds)
 * One source being unavailable is tolerated; both failing is a real error.
 */
export function useOpenAlerts(limit = 8, tick) {
    const size = Math.max(1, Math.min(Number(limit) || 8, 50));
    const key = `alerts|open|${size}|${tick ?? 0}`;

    const { data, loading, error } = useShared(key, async () => {
        const [fleet, local] = await Promise.all([
            api.getFleetAlerts({ status: 'active', limit: size })
                .then((r) => (Array.isArray(r) ? r : []))
                .catch(() => null),
            api.checkAlerts()
                .then((r) => (Array.isArray(r?.alerts) ? r.alerts : []))
                .catch(() => null),
        ]);
        if (fleet === null && local === null) throw new Error('Alert sources unavailable');
        return [
            ...(fleet || []).map(normalizeFleetAlert),
            ...(local || []).map(normalizeLocalAlert),
        ].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
    });

    return { alerts: useMemo(() => (Array.isArray(data) ? data : []), [data]), loading, error };
}

/** Up/down cells for the status grid. `source` is servers | services. */
export function useStatusCells(source, limit = 12, tick) {
    const kind = source === 'services' ? 'services' : 'servers';
    const size = Math.max(1, Math.min(Number(limit) || 12, 60));
    const key = `status|${kind}|${size}|${tick ?? 0}`;

    const { data, loading, error } = useShared(key, async () => {
        if (kind === 'services') {
            const apps = await api.getApps().then((d) => (Array.isArray(d?.apps) ? d.apps : []));
            return apps.map((app) => ({
                id: `app:${app.id}`,
                name: app.name,
                state: app.status === 'running' ? 'up' : app.status === 'stopped' ? 'down' : 'unknown',
                meta: app.app_type || '',
            }));
        }
        const servers = await api.getAvailableServers().then((d) => (Array.isArray(d) ? d : []));
        return servers.map((server) => ({
            id: server.id,
            name: server.name,
            state: server.status === 'online' ? 'up' : server.status === 'connecting' ? 'unknown' : 'down',
            meta: server.group_name || (server.is_local ? 'local' : server.os_type || ''),
        }));
    });

    const cells = useMemo(() => (Array.isArray(data) ? data.slice(0, size) : []), [data, size]);
    return { cells, loading, error, source: kind };
}

/* -------------------------------------------------------------- operations */

/** Recent deployment jobs (DeploymentJob.to_dict()). */
export function useDeployJobs(limit = 5, tick) {
    const size = Math.max(1, Math.min(Number(limit) || 5, 25));
    const key = `deploys|${size}|${tick ?? 0}`;
    const { data, loading, error } = useShared(key, () => (
        api.getDeploymentJobs({ limit: size }).then((d) => (Array.isArray(d?.jobs) ? d.jobs : []))
    ));
    return { jobs: useMemo(() => (Array.isArray(data) ? data : []), [data]), loading, error };
}

/** Audit trail. Admin-only endpoint — pass `enabled: false` for everyone else. */
export function useActivity(limit = 6, enabled = true, tick) {
    const size = Math.max(1, Math.min(Number(limit) || 6, 50));
    const key = `activity|${size}|${tick ?? 0}`;
    const { data, loading, error } = useShared(key, () => (
        api.getActivityFeed({ per_page: size }).then((d) => (Array.isArray(d?.logs) ? d.logs : []))
    ), enabled);
    return { items: useMemo(() => (Array.isArray(data) ? data : []), [data]), loading, error };
}

const LEVEL_ERROR = /\b(error|errors|err|fatal|critical|panic|exception|traceback|failed|failure)\b/i;
const LEVEL_WARN = /\b(warn|warning|deprecated|retry|retrying|slow)\b/i;
// Docker's `logs -t` prefixes an RFC3339 stamp; syslog-style files start HH:MM:SS.
const LEADING_STAMP = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+/;

function classify(text) {
    if (LEVEL_ERROR.test(text)) return 'err';
    if (LEVEL_WARN.test(text)) return 'warn';
    return 'out';
}

function toLogLine(raw) {
    const text = String(raw ?? '');
    const match = text.match(LEADING_STAMP);
    let time = null;
    let body = text;
    if (match) {
        const parsed = new Date(match[1]);
        if (!Number.isNaN(parsed.getTime())) time = parsed.toISOString().slice(11, 19);
        body = text.slice(match[0].length);
    }
    return { lvl: classify(body), txt: body, t: time };
}

/**
 * Tail of a log source.
 *   cfg.source === 'container' + cfg.containerId -> GET /docker/containers/<id>/logs
 *   otherwise                                    -> GET /logs/read?path=…
 * With no path configured the first entry from GET /logs is used, so the
 * widget shows something real out of the box. Both endpoints are admin-only.
 */
export function useLogTail(cfg = {}, tick) {
    const mode = cfg.source === 'container' && cfg.containerId ? 'container' : 'file';
    const lineCount = Math.max(10, Math.min(Number(cfg.lines) || 60, 500));
    const target = mode === 'container' ? cfg.containerId : (cfg.path || '');
    const key = `logs|${mode}|${target}|${lineCount}|${tick ?? 0}`;

    const { data, loading, error } = useShared(key, async () => {
        if (mode === 'container') {
            const result = await api.getContainerLogs(target, lineCount);
            if (result && result.success === false) throw new Error(result.error || 'Could not read container logs');
            const text = typeof result?.logs === 'string' ? result.logs : '';
            return { label: target, lines: text.split('\n') };
        }

        // Nothing configured: say so rather than guessing. This used to grab
        // whatever `getLogFiles()` listed first, which is typically a system
        // log the panel can't read without a password — so a freshly seeded
        // dashboard greeted people with "sudo: a password is required".
        if (!target) return { unconfigured: true, label: '', lines: [] };

        const result = await api.readLog(target, lineCount);
        if (result && result.success === false) throw new Error(result.error || 'Could not read log file');
        return { label: target, lines: Array.isArray(result?.lines) ? result.lines : [] };
    });

    const lines = useMemo(() => (
        (data?.lines || [])
            .filter((l) => String(l ?? '').trim().length > 0)
            .map(toLogLine)
    ), [data]);

    // A permission failure is a setup fact, not a crash — phrase it that way
    // instead of leaking the shell's own words at the operator.
    const friendly = useMemo(() => {
        if (!error) return null;
        const text = String(error.message || '');
        if (/sudo|permission denied|not permitted/i.test(text)) {
            return { ...error, messageKey: 'app.useWidgetData.thisLogNeedsElevatedAccess', message: 'this log needs elevated access', elevated: true };
        }
        return error;
    }, [error]);

    return {
        lines,
        label: data?.label || '',
        unconfigured: !!data?.unconfigured,
        loading,
        error: friendly,
    };
}

/* ------------------------------------------------------------------- specs */

const SPEC_FIELDS = [
    ['Hostname', ['hostname', 'host', 'name']],
    ['Processor', ['cpu.model', 'processor', 'cpu_model']],
    ['Architecture', ['architecture', 'cpu.architecture', 'arch']],
    ['Platform', ['platform', 'os', 'os_name', 'distro']],
    ['Kernel', ['kernel', 'platform_release', 'kernel_version']],
    ['IP address', ['ip_address', 'ip']],
    ['Uptime', ['uptime_human', 'uptime']],
];

/**
 * Key/value host facts.
 *   local        -> GET /api/v1/system/info      (SystemService.get_system_info)
 *   agent server -> GET /api/v1/servers/<id>/system/info
 * The agent payload is not shaped by a model in this repo, so each row tries a
 * few candidate keys and drops out when none of them resolve.
 */
export function useSystemSpecs(resource, tick) {
    const target = resource || 'local';
    const key = `specs|${target}|${tick ?? 0}`;

    const { data, loading, error } = useShared(key, () => (
        sourceOf(target) === 'local' ? api.getSystemInfo() : api.getRemoteSystemInfo(target)
    ));

    const rows = useMemo(() => {
        if (!data || typeof data !== 'object') return [];
        const out = [];
        for (const [label, paths] of SPEC_FIELDS) {
            for (const path of paths) {
                const value = readAt(data, path);
                if (value !== undefined && value !== null && value !== '') {
                    out.push([label, String(value)]);
                    break;
                }
            }
        }
        return out;
    }, [data]);

    return { rows, loading, error };
}
