import { statusColor } from '@/components/ds/status';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/utils/time';
/**
 * The 13 core dashboard widget renderers (plan 62).
 *
 * Every renderer is presentational — all fetching lives in ./useWidgetData.
 * Every renderer handles three states: loading, empty and error. Nothing here
 * may throw: `WidgetBody` wraps each one in a boundary so one bad widget can
 * never take the grid down with it.
 */
import { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    Activity,
    Archive,
    ArrowDown,
    ArrowUp,
    Boxes,
    Container,
    Database,
    FolderOpen,
    Globe,
    ListChecks,
    Rocket,
    Server,
    ShieldCheck,
    Terminal,
} from 'lucide-react';
import { Gauge, Pill, serviceStatusKind, statusKind, alertStatusKind } from '@/components/ds';
import { getWidgetType } from './registry';
import { useTranslation } from 'react-i18next';
import { t } from '../../../i18n/t';
import {
    aggregate,
    chartDomain,
    deltaPercent,
    formatValue,
    getMetric,
    sourceOf,
    thresholdColor,
} from './metrics';
import {
    useActivity,
    useDeployJobs,
    useFleetHeatmap,
    useLogTail,
    useMetricSeries,
    useMetricSeriesSet,
    useOpenAlerts,
    useResourceLabel,
    useResourceRows,
    useStatusCells,
    useSystemSpecs,
} from './useWidgetData';

/* ------------------------------------------------------------ shared bits */

// A widget's `cfg.resource` may be the literal '$server' dashboard variable.
function resolveResource(resource, ctx) {
    if (resource === '$server') return ctx?.serverVar || 'local';
    return resource || 'local';
}

function Loading({ label = 'Loading…' }) {
    return <div className="skw-empty skw-empty--loading">{label}</div>;
}

function Empty({ children }) {
    return <div className="skw-empty">{children}</div>;
}

// Muted one-liner. A 403 is phrased as a permission note, not a failure.
function Failed({ error, subject = 'data' }) {
    const { t } = useTranslation();
    if (error?.forbidden) {
        return <div className="skw-empty skw-empty--error">{t('app.renderers.yourRoleCannotRead', 'Your role cannot read')} {subject}.</div>;
    }
    return (
        <div className="skw-empty skw-empty--error">
            {t('app.renderers.couldNotLoad', "Couldn't load")} {subject}
            {error?.message ? ` — ${error.message}` : '.'}
        </div>
    );
}

/**
 * Multi-series area chart. Hand-rolled rather than reusing ds/AreaChart
 * because a widget needs the fill toggle and a height that tracks its cell.
 * Gradient ids are per-instance (useId) so two charts on one board cannot
 * capture each other's fills.
 */
function WidgetChart({
    series, colors, fill = true, grid = true, height = '100%', domain = null,
    lineStyle = 'smooth', interactive = false, stamps = [], labels = [], units = [],
}) {
    const uid = useId().replace(/:/g, '');
    // Index of the sample under the pointer, or null. Kept as an index rather
    // than a pixel so it survives a resize.
    const [hover, setHover] = useState(null);
    const data = (series || []).filter((s) => Array.isArray(s) && s.length > 0);
    const all = data.flat();
    if (!all.length) return null;

    const w = 100;
    const h = 100;
    // A fixed domain (percentages: [0, 100]) beats scaling to the data, which
    // both flattens a series under one spike and inflates a flat one into
    // meaningless mountains. Values outside the domain are clamped rather than
    // allowed to draw outside the box.
    const [dMin, dMax] = domain || [];
    const max = domain ? dMax : Math.max(...all) * 1.12;
    const min = domain ? dMin : Math.min(...all) * 0.7;
    const span = max - min || 1;
    const toX = (i, len) => (i / (len - 1 || 1)) * w;
    const toY = (v) => h - ((Math.max(min, Math.min(max, v)) - min) / span) * h;
    const line = (s) => {
        if (lineStyle !== 'step') {
            return s.map((v, i) => `${i ? 'L' : 'M'}${toX(i, s.length).toFixed(2)} ${toY(v).toFixed(2)}`).join(' ');
        }
        // Hold each reading until the next one, then jump — the squared-off
        // look. A sampled metric genuinely is a series of discrete readings,
        // and this draws that instead of inventing a slope between them.
        return s.map((v, i) => {
            const x = toX(i, s.length).toFixed(2);
            const y = toY(v).toFixed(2);
            if (!i) return `M${x} ${y}`;
            const prevY = toY(s[i - 1]).toFixed(2);
            return `L${x} ${prevY} L${x} ${y}`;
        }).join(' ');
    };

    const longest = data.reduce((n, sx) => Math.max(n, sx.length), 0);

    // Nearest sample to the pointer. The chart is `preserveAspectRatio="none"`,
    // so viewBox x maps linearly onto the container width — a ratio is enough.
    const onMove = (event) => {
        if (!interactive || longest < 2) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (!box.width) return;
        const ratio = (event.clientX - box.left) / box.width;
        const index = Math.round(Math.max(0, Math.min(1, ratio)) * (longest - 1));
        setHover(index);
    };

    const hovered = hover === null ? null : data.map((sx, i) => {
        // Series can differ in length; clamp rather than read past the end.
        const idx = Math.min(hover, sx.length - 1);
        const value = sx[idx];
        return {
            value,
            color: colors[i % colors.length],
            label: labels[i] || '',
            unit: units[i] || '',
            left: toX(hover, longest),
            top: toY(value),
        };
    });
    const stampAt = hover === null ? null : (stamps[Math.min(hover, stamps.length - 1)] || null);
    const hoverPct = hover === null ? 0 : toX(hover, longest);
    // Flip the tooltip to the left of the crosshair once it would overflow.
    const flip = hoverPct > 60;

    const chart = (
        <svg
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            className="skw-chart__svg"
            style={{ height }}
            aria-hidden="true"
        >
            <defs>
                {colors.map((color, i) => (
                    <linearGradient key={i} id={`skw-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.26" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                ))}
            </defs>
            {grid && [0, 25, 50, 75, 100].map((y) => (
                <line
                    key={y}
                    x1="0"
                    y1={y}
                    x2={w}
                    y2={y}
                    stroke="var(--border-soft)"
                    strokeWidth="0.4"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
            {fill && data.map((s, i) => (
                <path key={`a${i}`} d={`${line(s)} L ${w} ${h} L 0 ${h} Z`} fill={`url(#skw-${uid}-${i % colors.length})`} />
            ))}
            {data.map((s, i) => (
                <path
                    key={`l${i}`}
                    d={line(s)}
                    fill="none"
                    stroke={colors[i % colors.length]}
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
            ))}
        </svg>
    );

    if (!interactive) return chart;

    return (
        <div
            className="skw-chart"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
        >
            {chart}
            {hovered && (
                <>
                    <span className="skw-chart__cross" style={{ left: `${hoverPct}%` }} />
                    {hovered.map((point, i) => (
                        <span
                            key={i}
                            className="skw-chart__dot"
                            style={{ left: `${point.left}%`, top: `${point.top}%`, background: point.color }}
                        />
                    ))}
                    <div className={`skw-chart__tip${flip ? ' skw-chart__tip--flip' : ''}`} style={{ left: `${hoverPct}%` }}>
                        {stampAt && (
                            <div className="skw-chart__tip-when">
                                {new Date(stampAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        )}
                        {hovered.map((point, i) => (
                            <div className="skw-chart__tip-row" key={i}>
                                <span className="skw-chart__tip-dot" style={{ background: point.color }} />
                                <span className="skw-chart__tip-label">{point.label}</span>
                                <span className="skw-chart__tip-value" style={{ color: point.color }}>
                                    {formatValue(point.value, point.unit)}
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// Phrase why a metric has no series on this resource, using real reasons.
function unsupportedNote(metric, resource) {
    const where = sourceOf(resource) === 'local' ? 'the local host' : 'agent servers';
    return `${metric.label} is not collected for ${where}.`;
}

/* -------------------------------------------------------------------- stat */

function WStat({ cfg, ctx }) {
    const { t } = useTranslation();
    const resource = resolveResource(cfg.resource, ctx);
    const label = useResourceLabel(resource);
    const agg = cfg.agg || 'last';
    const { series, loading, error, supported, metric } = useMetricSeries(resource, cfg.metric, ctx.range, ctx.tick);

    if (loading && !series.length) return <Loading />;
    if (error) return <Failed error={error} subject="metrics" />;
    if (!supported) return <Empty>{unsupportedNote(metric, resource)}</Empty>;
    if (!series.length) return <Empty>{t('app.renderers.noSamplesRecordedInThisRange', 'No samples recorded in this range yet.')}</Empty>;

    const value = aggregate(series, agg);
    const delta = deltaPercent(series, agg);
    const color = cfg.color || thresholdColor(value, cfg.thresholds) || metric.color;

    return (
        <div className="skw-stat">
            <div className="skw-stat__value" style={{ color }}>{formatValue(value, metric.unit)}</div>
            <div className="skw-stat__meta">
                {delta === null ? (
                    <span className="faint">{t('app.renderers.noTrendYet', 'no trend yet')}</span>
                ) : (
                    // Written out rather than interpolated so the modifier is a
                    // literal a stylesheet audit can find.
                    <span className={delta >= 0 ? 'skw-stat__delta skw-stat__delta--up' : 'skw-stat__delta skw-stat__delta--down'}>
                        {delta >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                        {Math.abs(delta).toFixed(1)}%
                    </span>
                )}
                <span className="faint">{agg} · {label}</span>
            </div>
            {cfg.spark !== false && (
                <div className="skw-stat__spark">
                    {/* WidgetChart, not ds/Sparkline: the latter renders a
                        fixed-width SVG (width={220}), so in a tile of any other
                        size the trend line stopped short and left dead space to
                        its right. This one is viewBox-based and fills. */}
                    <WidgetChart
                        series={[series]}
                        colors={[color]}
                        fill
                        grid={false}
                        height="100%"
                        domain={chartDomain([metric.id])}
                        lineStyle={cfg.lineStyle || 'smooth'}
                    />
                </div>
            )}
        </div>
    );
}

/* -------------------------------------------------------------- timeseries */

// A board should not be able to ask for an unreadable number of lines.
const MAX_SERIES = 6;

function WTimeseries({ cfg, ctx }) {
    const serverVar = ctx.serverVar;
    const entries = useMemo(() => {
        const configured = Array.isArray(cfg.series) && cfg.series.length
            ? cfg.series
            : [{ resource: '$server', metric: 'cpu' }];
        return configured.slice(0, MAX_SERIES).map((entry) => ({
            resource: entry?.resource === '$server' ? (serverVar || 'local') : (entry?.resource || 'local'),
            metric: entry?.metric,
            color: entry?.color || '',
        }));
    }, [cfg.series, serverVar]);

    const { rows, loading, error } = useMetricSeriesSet(entries, ctx.range, ctx.tick);
    const withData = rows.filter((r) => r.supported && r.series.length > 0);

    if (error) return <Failed error={error} subject="metrics" />;
    if (loading && !withData.length) return <Loading />;
    if (!withData.length) {
        const blocked = rows.find((r) => !r.supported);
        return (
            <Empty>
                {blocked
                    ? unsupportedNote(blocked.metric, blocked.resource)
                    : t('app.renderers.noSamplesInRange', 'No samples recorded in this range yet.')}
            </Empty>
        );
    }

    const colors = withData.map((row) => row.color || row.metric.color);

    return (
        <div className="skw-ts">
            <div className="skw-ts__chart">
                <WidgetChart
                    series={withData.map((r) => r.series)}
                    colors={colors}
                    fill={cfg.fill !== false}
                    domain={chartDomain(withData.map((r) => r.metric.id))}
                    lineStyle={cfg.lineStyle || 'smooth'}
                    interactive
                    stamps={withData[0]?.stamps || []}
                    labels={withData.map((r) => r.metric.label)}
                    units={withData.map((r) => r.metric.unit)}
                />
            </div>
            {cfg.legend !== false && (
                <div className="skw-legend">
                    {withData.map((row, i) => {
                        const last = row.series[row.series.length - 1];
                        return (
                            <span className="skw-legend__item" key={`${row.resource}-${row.metric.id}-${i}`}>
                                <span className="skw-legend__swatch" style={{ background: colors[i] }} />
                                {row.metric.label}
                                <b>{formatValue(last, row.metric.unit)}</b>
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------- gauge */

// Half-circle radial. No ds primitive covers this shape (ds/Gauge is a linear
// meter), so the arc is hand-rolled.
const GAUGE_RADIUS = 54;
const GAUGE_ARC = Math.PI * GAUGE_RADIUS;
const GAUGE_PATH = 'M16 72 A54 54 0 0 1 124 72';

function WGauge({ cfg, ctx }) {
    const { t } = useTranslation();
    const resource = resolveResource(cfg.resource, ctx);
    const label = useResourceLabel(resource);
    const { series, loading, error, supported, metric } = useMetricSeries(resource, cfg.metric, ctx.range, ctx.tick);

    if (loading && !series.length) return <Loading />;
    if (error) return <Failed error={error} subject="metrics" />;
    if (!supported) return <Empty>{unsupportedNote(metric, resource)}</Empty>;
    if (!series.length) return <Empty>{t('app.renderers.noSamplesRecordedInThisRange', 'No samples recorded in this range yet.')}</Empty>;

    const value = aggregate(series, cfg.agg || 'last');
    // Percentage metrics have a real ceiling; rates do not, so scale to the
    // observed peak rather than inventing a maximum.
    const ceiling = metric.max || Math.max(...series) * 1.15 || 1;
    const ratio = Math.max(0, Math.min(1, (value ?? 0) / ceiling));
    const color = thresholdColor(value, cfg.thresholds) || metric.color;

    return (
        <div className="skw-gauge">
            <svg viewBox="0 0 140 82" className="skw-gauge__svg" role="img" aria-label={`${metric.label} ${formatValue(value, metric.unit)}`}>
                <path d={GAUGE_PATH} fill="none" stroke="var(--surface-3)" strokeWidth="12" strokeLinecap="round" />
                <path
                    d={GAUGE_PATH}
                    fill="none"
                    stroke={color}
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeDasharray={`${(GAUGE_ARC * ratio).toFixed(1)} ${GAUGE_ARC.toFixed(1)}`}
                />
                <text x="70" y="63" textAnchor="middle" fill={color}>
                    {formatValue(value, metric.unit)}
                </text>
            </svg>
            <div className="skw-gauge__sub">
                {label}{metric.max ? ` · ${t('app.renderers.gaugeMax', 'max {{value}}', { value: `${metric.max}${metric.unit}` })}` : ''}
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------- topn */

// The fleet heatmap exposes exactly these three per-server metrics.
const HEATMAP_KEY = { cpu: 'cpu', ram: 'memory', disk: 'disk' };

function WTopN({ cfg, ctx }) {
    const { t } = useTranslation();
    const { servers, loading, error } = useFleetHeatmap(ctx.tick);
    const metric = getMetric(cfg.metric);
    const key = HEATMAP_KEY[metric.id];

    if (loading && !servers.length) return <Loading />;
    if (error) return <Failed error={error} subject="fleet metrics" />;
    if (!key) {
        return <Empty>{metric.label} {t('app.renderers.cannotBeRankedAcrossServersPick', 'cannot be ranked across servers. Pick CPU, memory or disk.')}</Empty>;
    }

    const rows = servers
        .map((s) => ({ id: s.id, label: s.name, value: s[key] }))
        .filter((r) => typeof r.value === 'number' && Number.isFinite(r.value))
        .sort((a, b) => b.value - a.value)
        .slice(0, Math.max(1, Number(cfg.limit) || 5));

    if (!rows.length) return <Empty>{t('app.renderers.noFleetServersAreReportingMetrics', 'No fleet servers are reporting metrics yet.')}</Empty>;

    const peak = Math.max(...rows.map((r) => r.value), 1);

    return (
        <div className="skw-topn">
            {rows.map((row) => (
                <div className="skw-topn__row" key={row.id}>
                    <span className="skw-topn__label">{row.label}</span>
                    <Gauge
                        className="skw-topn__track"
                        value={(row.value / peak) * 100}
                        color={metric.color}
                    />
                    <span className="skw-topn__value">{formatValue(row.value, metric.unit)}</span>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------- table */

// Image names and port maps are machine values; the other columns (type,
// server, group, OS, trigger, time) are words or dates and read as text.
const MACHINE_COLS = new Set(['image', 'ports']);

const TABLE_DEFS = {
    services: {
        empty: 'No services yet.',
        cols: [['Name', 'name'], ['Type', 'app_type'], ['Status', 'status'], ['Server', 'server_name']],
        href: (row) => `/services/${row.id}`,
    },
    servers: {
        empty: 'No servers connected.',
        cols: [['Name', 'name'], ['Status', 'status'], ['Group', 'group_name'], ['OS', 'os_type']],
        href: (row) => (row.is_local ? '/servers' : `/servers/${row.id}`),
    },
    containers: {
        empty: 'No containers on this host.',
        cols: [['Name', 'name'], ['Image', 'image'], ['Status', 'state'], ['Ports', 'ports']],
        href: () => '/docker',
    },
    deploys: {
        empty: 'No deployments recorded.',
        cols: [['App', 'app_name'], ['Trigger', 'trigger'], ['Status', 'status'], ['When', 'created_at']],
        href: (row) => `/deployments/${row.id}`,
    },
};

function WTable({ cfg, ctx }) {
    const limit = Math.max(1, Number(cfg.limit) || 6);
    const { rows, loading, error, source } = useResourceRows(cfg.source, limit, ctx.tick);
    const def = TABLE_DEFS[source] || TABLE_DEFS.services;

    if (loading && !rows.length) return <Loading />;
    if (error) return <Failed error={error} subject={source} />;
    if (!rows.length) return <Empty>{def.empty}</Empty>;

    return (
        <div className="skw-table-wrap">
            <table className="skw-table">
                <thead>
                    <tr>{def.cols.map(([label]) => <th key={label}>{label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={row.id ?? i} onClick={() => ctx.navigate?.(def.href(row))}>
                            {def.cols.map(([label, key]) => {
                                const value = row[key];
                                if (key === 'status' || key === 'state') {
                                    return (
                                        <td key={label}>
                                            <Pill kind={(cfg.source === 'deploys' ? statusKind(value) : serviceStatusKind(value))}>{value || 'unknown'}</Pill>
                                        </td>
                                    );
                                }
                                const isName = key === 'name' || key === 'app_name';
                                const text = key === 'created_at' ? formatRelativeTime(value) : value;
                                return (
                                    <td key={label} className={isName ? 'nm' : (MACHINE_COLS.has(key) ? 'mono' : undefined)}>
                                        {text === null || text === undefined || text === '' ? '—' : String(text)}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* -------------------------------------------------------------------- logs */

function WLogs({ cfg, ctx }) {
    const { t } = useTranslation();
    const bodyRef = useRef(null);
    const { lines, label, unconfigured, loading, error } = useLogTail(cfg, ctx.tick);

    const shown = cfg.level && cfg.level !== 'all'
        ? lines.filter((l) => l.lvl === cfg.level)
        : lines;

    useEffect(() => {
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [shown.length]);

    if (unconfigured) {
        return <Empty>{t('app.renderers.pickALogFileOrContainer', "Pick a log file or container in this widget's settings.")}</Empty>;
    }
    if (loading && !lines.length) return <Loading />;
    if (error?.elevated) {
        return <Empty>{label || t('app.renderers.thisLog', 'This log')} {t('app.renderers.needsElevatedAccessChooseAnotherSource', 'needs elevated access. Choose another source in settings.')}</Empty>;
    }
    if (error) return <Failed error={error} subject="logs" />;
    if (!lines.length) return <Empty>{t('app.renderers.noLogLinesAvailable', 'No log lines available.')}</Empty>;

    const counts = lines.reduce((acc, l) => ({ ...acc, [l.lvl]: (acc[l.lvl] || 0) + 1 }), {});

    return (
        <div className="skw-logs">
            <div className="skw-logs__bar">
                <span>{label || 'log'}</span>
                <span className="faint">{lines.length} lines</span>
                {counts.err ? <span className="lv-err">{counts.err} errors</span> : null}
                {counts.warn ? <span className="lv-warn">{counts.warn} warnings</span> : null}
            </div>
            <div className="skw-logs__body" ref={bodyRef}>
                {shown.length === 0 ? (
                    <Empty>{t('app.renderers.noLinesAtThisLevel', 'No lines at this level.')}</Empty>
                ) : shown.map((l, i) => (
                    <div className={`skw-logs__line lv-${l.lvl}`} key={i}>
                        {l.t ? <span className="t">{l.t}</span> : null}
                        {l.txt}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ----------------------------------------------------------------- deploys */

// A job reports total_steps + current_step; derive each dot's state from those
// rather than inventing per-step records the API does not return.
function stepState(index, job) {
    if (index < job.current_step) return 'done';
    if (index > job.current_step) return '';
    if (job.status === 'failed') return 'failed';
    if (job.status === 'running') return 'running';
    return job.status === 'succeeded' || job.status === 'completed' ? 'done' : '';
}

function WDeploys({ cfg, ctx }) {
    const { t } = useTranslation();
    const { jobs, loading, error } = useDeployJobs(cfg.limit, ctx.tick);

    if (loading && !jobs.length) return <Loading />;
    if (error) return <Failed error={error} subject="deployments" />;
    if (!jobs.length) return <Empty>{t('app.renderers.noDeploymentsYet', 'No deployments yet.')}</Empty>;

    return (
        <div className="skw-list">
            {jobs.map((job) => (
                <div
                    className="skw-dep"
                    key={job.id}
                    onClick={() => ctx.navigate?.(`/deployments/${job.id}`)}
                >
                    <div className="skw-dep__top">
                        <span className="skw-dep__name">{job.app_name || job.kind || 'deployment'}</span>
                        <span className="skw-dep__state" style={{ color: statusColor(job.status) }}>
                            {job.status}
                        </span>
                    </div>
                    {job.total_steps > 0 && (
                        <div className="skw-dep__steps">
                            {Array.from({ length: job.total_steps }, (_, i) => (
                                <i key={i} className={`st ${stepState(i, job)}`} />
                            ))}
                        </div>
                    )}
                    <div className="skw-dep__meta">
                        {job.trigger || 'manual'} · {job.target_server_name || 'local'} · {formatRelativeTime(job.created_at) || '—'}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ alerts */

function WAlerts({ cfg, ctx }) {
    const { t } = useTranslation();
    const { alerts, loading, error } = useOpenAlerts(cfg.limit, ctx.tick);

    if (loading && !alerts.length) return <Loading />;
    if (error) return <Failed error={error} subject="alerts" />;

    const shown = cfg.severity && cfg.severity !== 'all'
        ? alerts.filter((a) => a.severity === cfg.severity)
        : alerts;

    if (!shown.length) return <Empty>{t('app.renderers.noAlertsFiring', 'No alerts firing.')}</Empty>;

    return (
        <div className="skw-list">
            {shown.map((alert) => {
                const color = statusColor(alert.severity);
                return (
                    <div className="skw-alert" key={alert.id} onClick={() => ctx.navigate?.('/monitoring')}>
                        <span className="skw-alert__sev" style={{ background: color, boxShadow: `0 0 7px ${color}` }} />
                        <div className="skw-alert__body">
                            <div className="skw-alert__title">{alert.title}</div>
                            <div className="skw-alert__meta">
                                {alert.target}{alert.time ? ` · ${formatRelativeTime(alert.time)}` : ''}
                            </div>
                        </div>
                        <Pill kind={alertStatusKind(alert.state)}>{alert.state}</Pill>
                    </div>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------ status */

function WStatus({ cfg, ctx }) {
    const { t } = useTranslation();
    const { cells, loading, error, source } = useStatusCells(cfg.source, cfg.limit, ctx.tick);

    if (loading && !cells.length) return <Loading />;
    if (error) return <Failed error={error} subject={source} />;
    if (!cells.length) return <Empty>{t('app.renderers.nothingToMonitorYet', 'Nothing to monitor yet.')}</Empty>;

    const target = source === 'services' ? '/services' : '/servers';

    return (
        <div className="skw-status">
            {cells.map((cell) => {
                const color = statusColor(cell.state);
                return (
                    <div
                        className="skw-status__cell"
                        key={cell.id}
                        onClick={() => ctx.navigate?.(target)}
                        title={`${cell.name} · ${cell.state}`}
                    >
                        <span className="skw-status__dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                        <div className="skw-status__name">{cell.name}</div>
                        <div className="skw-status__meta">{cell.meta || cell.state}</div>
                    </div>
                );
            })}
        </div>
    );
}

/* -------------------------------------------------------------------- feed */

// Turn an audit action ('app.deploy', 'user.login') into something readable
// without pretending we know more than the row carries.
function describeLog(entry) {
    const action = String(entry.action || 'change').replace(/[._]/g, ' ');
    const who = entry.username || 'system';
    const what = entry.target_type
        ? `${entry.target_type}${entry.target_id ? ` #${entry.target_id}` : ''}`
        : '';
    return what ? `${who} · ${action} · ${what}` : `${who} · ${action}`;
}

function WFeed({ cfg, ctx }) {
    const { t } = useTranslation();
    const isAdmin = Boolean(ctx.isAdmin);
    const { items, loading, error } = useActivity(cfg.limit, isAdmin, ctx.tick);

    // The audit trail lives behind /admin/activity/feed. Say so instead of
    // firing a request that can only come back 403.
    if (!isAdmin) return <Empty>{t('app.renderers.requiresAdmin', 'Requires admin.')}</Empty>;
    if (loading && !items.length) return <Loading />;
    if (error) return <Failed error={error} subject="the activity feed" />;
    if (!items.length) return <Empty>{t('app.renderers.noRecordedActivityYet', 'No recorded activity yet.')}</Empty>;

    return (
        <div className="skw-list">
            {items.map((entry) => (
                <div className="skw-feed__item" key={entry.id} onClick={() => ctx.navigate?.('/security')}>
                    <span className="skw-feed__dot" />
                    <div className="skw-feed__body">
                        <div className="skw-feed__text">{describeLog(entry)}</div>
                        <div className="skw-feed__time">{formatRelativeTime(entry.created_at)}</div>
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ----------------------------------------------------------------- actions */

// Every destination is a real route registered in App.jsx.
const ACTIONS = {
    servers: ['Manage servers', Server, '/servers'],
    services: ['Services', Boxes, '/services'],
    docker: ['Docker containers', Container, '/docker'],
    terminal: ['Open terminal', Terminal, '/terminal'],
    deploys: ['Deploy activity', Rocket, '/deployments'],
    databases: ['Databases', Database, '/databases'],
    backups: ['Backups', Archive, '/backups'],
    monitoring: ['Monitoring', Activity, '/monitoring'],
    domains: ['Domains', Globe, '/domains'],
    files: ['File manager', FolderOpen, '/files'],
    security: ['Security', ShieldCheck, '/security'],
    jobs: ['Jobs', ListChecks, '/monitoring/jobs'],
};

export const QUICK_ACTION_KEYS = Object.keys(ACTIONS);

// [key, label] pairs for the inspector's shortcut picker. Derived from ACTIONS
// so the list of shortcuts a user can *choose* can never drift from the list
// this widget can actually *render* — they did drift once already.
export const QUICK_ACTION_OPTIONS = Object.entries(ACTIONS).map(([key, [label]]) => [key, label]);

function WActions({ cfg, ctx }) {
    const { t } = useTranslation();
    const items = (Array.isArray(cfg.items) ? cfg.items : []).filter((key) => ACTIONS[key]);
    if (!items.length) return <Empty>{t('app.renderers.noActionsSelected', 'No actions selected.')}</Empty>;

    return (
        <div className="skw-actions">
            {items.map((key) => {
                const [label, Icon, href] = ACTIONS[key];
                return (
                    <Button variant="unstyled" type="button" className="skw-actions__row" key={key} onClick={() => ctx.navigate?.(href)}>
                        <span className="skw-actions__label">{label}</span>
                        <span className="skw-actions__icon"><Icon size={15} /></span>
                    </Button>
                );
            })}
        </div>
    );
}

/* ------------------------------------------------------------------- specs */

// Hostname, kernel and IP are machine values; the other spec rows are prose.
const SPEC_MACHINE_ROWS = new Set(['Hostname', 'Kernel', 'IP address']);

function WSpecs({ cfg, ctx }) {
    const { t } = useTranslation();
    const resource = resolveResource(cfg.resource, ctx);
    const { rows, loading, error } = useSystemSpecs(resource, ctx.tick);

    if (loading && !rows.length) return <Loading />;
    if (error) return <Failed error={error} subject="host details" />;
    if (!rows.length) return <Empty>{t('app.renderers.thisHostReportedNoDetails', 'This host reported no details.')}</Empty>;

    return (
        <div className="skw-kv">
            {rows.map(([key, value]) => (
                <div className="skw-kv__row" key={key}>
                    <span className="skw-kv__k">{key}</span>
                    <span className={`skw-kv__v${SPEC_MACHINE_ROWS.has(key) ? ' mono' : ''}`}>{value}</span>
                </div>
            ))}
        </div>
    );
}

/* -------------------------------------------------------------------- note */

// Minimal inline markdown rendered as React nodes. Deliberately NOT an HTML
// string: no dangerouslySetInnerHTML means no sink to sanitize.
function renderInline(text, keyPrefix) {
    const nodes = [];
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let cursor = 0;
    let match = pattern.exec(text);
    let n = 0;

    while (match) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        if (match[1] !== undefined) {
            nodes.push(<b key={`${keyPrefix}-b${n}`}>{match[1]}</b>);
        } else {
            nodes.push(<code className="mono" key={`${keyPrefix}-c${n}`}>{match[2]}</code>);
        }
        cursor = match.index + match[0].length;
        n += 1;
        match = pattern.exec(text);
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
}

function WNote({ cfg }) {
    const { t } = useTranslation();
    const text = typeof cfg.text === 'string' ? cfg.text : '';
    if (!text.trim()) return <Empty>{t('app.renderers.emptyNoteAddTextInThe', 'Empty note. Add text in the widget settings.')}</Empty>;

    return (
        <div className="skw-note">
            {text.split('\n').map((line, i) => (
                <p key={i}>{line ? renderInline(line, `l${i}`) : ' '}</p>
            ))}
        </div>
    );
}

/* --------------------------------------------------------------- dispatch */

/* ------------------------------------------------------------------- clock */

/**
 * Wall clock. Ticks locally rather than polling: the time between two server
 * samples is not interesting, and a widget that re-fetches every second to
 * print a number the browser already knows would be silly.
 *
 * `cfg.timezone` is an IANA name; empty means this browser's zone.
 */
function WClock({ cfg }) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    const zone = cfg.timezone || undefined;
    let time;
    let date;
    let label;
    try {
        time = new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            ...(cfg.showSeconds === false ? {} : { second: '2-digit' }),
            hour12: false,
            timeZone: zone,
        }).format(now);
        date = new Intl.DateTimeFormat('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', timeZone: zone,
        }).format(now);
        label = zone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        // An invalid IANA name should not blank the widget.
        return <Empty>{t('app.renderers.unknownTimezone', 'Unknown time zone “{{zone}}”.', { zone: cfg.timezone })}</Empty>;
    }

    return (
        <div className="skw-clock">
            <div className="skw-clock__time">{time}</div>
            {cfg.showDate !== false && <div className="skw-clock__date">{date}</div>}
            <div className="skw-clock__zone">{label.replace(/_/g, ' ')}</div>
        </div>
    );
}

const CORE_RENDERERS = {
    stat: WStat,
    timeseries: WTimeseries,
    gauge: WGauge,
    topn: WTopN,
    table: WTable,
    logs: WLogs,
    deploys: WDeploys,
    alerts: WAlerts,
    status: WStatus,
    feed: WFeed,
    actions: WActions,
    specs: WSpecs,
    clock: WClock,
    note: WNote,
};

/**
 * Last line of defence. A renderer that throws (a plugin widget, or a core one
 * fed a malformed saved cfg) degrades to a muted note instead of unmounting
 * the whole grid.
 */
class WidgetBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { failed: false };
    }

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error) {
        console.error(`Dashboard widget "${this.props.widgetType}" crashed:`, error);
    }

    render() {
        if (this.state.failed) {
            return <div className="skw-empty skw-empty--error">{t('app.renderers.thisWidgetFailedToRender', "This widget couldn't render.")}</div>;
        }
        return this.props.children;
    }
}

/**
 * Render one widget's body.
 *
 * `ctx` carries { range, tick, serverVar, isAdmin, navigate } and may also
 * carry `types` (the merged registry from useWidgetTypes) — when present,
 * plugin-contributed widget types render through their own component.
 * An unknown type renders a `.skw-empty` notice and never throws.
 */
export function WidgetBody({ widget, ctx }) {
    const { t } = useTranslation();
    const safeCtx = ctx || {};
    const type = widget?.type;

    const Core = type ? CORE_RENDERERS[type] : null;
    const contributed = !Core && type
        ? getWidgetType(safeCtx.types, type)?.component || null
        : null;
    const Renderer = Core || contributed;

    if (!Renderer) {
        return <div className="skw-empty">{t('app.renderers.unknownWidgetType', 'Unknown widget type "')}{String(type ?? '')}{'".'}</div>;
    }

    return (
        <WidgetBoundary key={`${widget?.i ?? ''}:${type}`} widgetType={type}>
            <Renderer cfg={widget?.cfg || {}} ctx={safeCtx} widget={widget} />
        </WidgetBoundary>
    );
}

export default WidgetBody;
