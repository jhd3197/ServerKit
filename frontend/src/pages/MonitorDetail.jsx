// MonitorDetail — the drill-down for a single check.
//
// Outside the Monitoring tab group (like /queue/:group/:queue) because it is a
// drill-down, so it carries its own PageTopbar with a breadcrumb back to the
// list. Its sections are a SegControl, not a tab strip: a nav under the page's
// own header would be the same two-competing-headers problem the group layout
// exists to avoid.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    Activity, ArrowLeft, BarChart3, CheckCircle2, Clock, ExternalLink, Lock,
    Pause, Play, RefreshCw, Rows3, ShieldAlert, SlidersHorizontal, Trash2, Zap,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { useRecordVisit } from '@/hooks/useRecordVisit';
import FavoriteStar from '@/components/FavoriteStar';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import UptimeBars from '../components/monitoring/UptimeBars';
import { monitorStateOf } from '../components/monitoring/monitorShared';
import {
    AreaChart, DataTable, DataTableFooter, KpiBand, MetricCard,
    Pill, SegControl,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import PageLayout from '../layouts/PageLayout';
import { Button } from '@/components/ui/button';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const POLL_MS = 15000;

const SECTIONS = [
    { value: 'performance', labelKey: 'app.monitorDetail.performance', label: 'Performance', icon: <Activity size={14} /> },
    { value: 'uptime', labelKey: 'common.labels.uptime', label: 'Uptime', icon: <BarChart3 size={14} /> },
    { value: 'checks', labelKey: 'app.monitorDetail.checkLog', label: 'Check log', icon: <Rows3 size={14} /> },
    { value: 'config', labelKey: 'app.monitorDetail.configuration', label: 'Settings', icon: <SlidersHorizontal size={14} /> },
];

const RANGES = [
    { value: 1, label: '1h' },
    { value: 24, label: '24h' },
    { value: 168, label: '7d' },
    { value: 720, label: '30d' },
];

// Built-in views for the check log. Every rule matches against a column's
// `value` accessor, so 'up' below is the word the Result cell prints and '200'
// is the string the Code cell prints.
//
// Nothing here names a monitor. The route already scopes the log to one, and
// the same view key is shared by every monitor that renders this page — a
// preset that mentioned a host or an id would be dead on all the others.
const NO_RULES = { match: 'all', rules: [] };

const CHECK_VIEWS = [
    {
        // How a log is read by default: the most recent probe on top.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'checked_at', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
        },
    },
    {
        // Everything that did not come back up — a 5xx, a timeout, a TLS
        // failure, a keyword that went missing. `none: ['up']` rather than
        // `any: ['down']` because HealthCheck.status also records 'degraded',
        // and a worklist that silently dropped those would be the wrong list.
        name: 'Failed checks',
        state: {
            sorts: [{ key: 'checked_at', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'mc1', field: 'status', op: 'none', value: ['up'] }],
            },
        },
    },
    {
        // What the p95 tile is made of. Sort-only on purpose: "slow" is
        // relative to the target, so a fixed millisecond threshold would be
        // wrong on a static page and useless on a heavy API.
        name: 'Slowest first',
        state: {
            sorts: [{ key: 'response_time', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
        },
    },
    {
        // Redirects, 4xx, 5xx — and the probes that never answered at all,
        // which read '—' and are exactly what this view is for: a check that
        // timed out did not return 200 either. On a ping or port monitor,
        // where no row carries a code, it shows the whole log; that is the
        // honest answer to "which of these was not a 200".
        name: 'Non-200 responses',
        state: {
            sorts: [{ key: 'checked_at', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'mc2', field: 'status_code', op: 'none', value: ['200'] }],
            },
        },
    },
];

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function formatUptime(value) {
    return value == null ? '—' : `${Number(value).toFixed(2)}%`;
}

function certDaysLeft(iso) {
    if (!iso) return null;
    return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}

export default function MonitorDetail() {
    const { t } = useTranslation();
    const { monitorId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [monitor, setMonitor] = useState(null);
    useRecordVisit(monitor && {
        type: 'monitor', id: monitor.id, path: `/monitoring/monitors/${monitor.id}`, label: monitor.name,
    });
    const [checks, setChecks] = useState([]);
    const [uptime, setUptime] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [uptimeError, setUptimeError] = useState(null);
    const [section, setSection] = useState('performance');
    const [rangeHours, setRangeHours] = useState(24);
    const [selectedDay, setSelectedDay] = useState(null);
    // Freezing the log is what makes a streaming table readable — without it the
    // row you are reading slides away on the next poll.
    const [frozen, setFrozen] = useState(null);
    const [busy, setBusy] = useState(false);
    // Sort/column state for the check log lives above the early returns so the
    // hook order never changes; storageKey keeps the choices across visits.
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-monitor-checks-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-monitor-checks-cols',
    });

    const load = useCallback(async () => {
        try {
            const [monitorRes, historyRes, uptimeRes] = await Promise.all([
                api.getMonitor(monitorId),
                api.getMonitorHistory(monitorId, { hours: rangeHours, limit: 300 }),
                // The 90-day bars are optional: a failure is recorded so the
                // uptime panel says so, instead of reading as "no history yet".
                api.getMonitorUptime(monitorId, 90).then(
                    (data) => { setUptimeError(null); return data; },
                    (err) => { setUptimeError(err); return undefined; },
                ),
            ]);
            setMonitor(monitorRes);
            setChecks(historyRes?.checks || []);
            if (uptimeRes !== undefined) setUptime(uptimeRes || null);
            setLoadError(null);
            setNotFound(false);
        } catch (err) {
            if (err.status === 404 || String(err.message || '').toLowerCase().includes('not found')) setNotFound(true);
            else setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, [monitorId, rangeHours]);

    // Reload when the range changes; poll on top of that.
    useEffect(() => { load(); }, [load]);
    usePolling(load, POLL_MS, { immediate: false });

    // Oldest-first for the chart; the API returns newest-first for the log.
    const series = useMemo(() => {
        const withTiming = checks.filter((c) => c.response_time != null);
        return [...withTiming].reverse().map((c) => c.response_time);
    }, [checks]);

    const stats = useMemo(() => {
        if (!series.length) return { avg: null, min: null, max: null, p95: null };
        return {
            avg: Math.round(series.reduce((a, b) => a + b, 0) / series.length),
            min: Math.min(...series),
            max: Math.max(...series),
            p95: percentile(series, 0.95),
        };
    }, [series]);

    // The rows the log renders: the held snapshot while frozen, else the live
    // list. It and the columns below sit ABOVE the early returns so the chrome
    // hook runs on every render, including the loading and not-found ones.
    const rows = frozen || checks;

    // Check-log columns. `value` is what the column menu, the filter rules and
    // the export read; `sortValue` is what DataTable's sorter reads — it does
    // NOT fall back to `value`, so a sortable column needs both. Types are
    // declared rather than inferred: a window in which every check passed would
    // type Result from a single distinct value, and the 'Failed checks' preset
    // would then be filtering a column the engine calls plain text.
    const checkColumns = useMemo(() => [
        {
            key: 'checked_at',
            headerKey: 'common.labels.time', header: 'Time',
            sortable: true,
            hideable: false,
            type: 'date',
            value: (c) => c.checked_at || null,
            sortValue: (c) => (c.checked_at ? new Date(c.checked_at).getTime() : null),
            render: (c) => new Date(c.checked_at).toLocaleTimeString(),
        },
        {
            // Split from the HTTP code beside it. This cell used to print the
            // code while sorting on the status, which left "failed" and "500"
            // sharing one column — so one of the two was always filtering on
            // something the row did not show.
            key: 'status',
            headerKey: 'app.monitorDetail.result', header: 'Result',
            sortable: true,
            type: 'enum',
            // No `enumOrder`: the pick-list is built from the statuses this
            // window actually contains, so it never offers 'down' on a log
            // with nothing but successes in it.
            value: (c) => c.status || 'unknown',
            sortValue: (c) => c.status || '',
            render: (c) => (
                <span className={`mon-code mon-code--${c.status === 'up' ? 'ok' : 'bad'}`}>
                    {c.status}
                </span>
            ),
        },
        {
            // Enum, not num: status codes are a short repeating set, so the
            // menu offers the ones this window actually contains as a
            // pick-list. A probe that never answered has no code and reads
            // '—', which is a value you can filter on rather than a blank.
            key: 'status_code',
            headerKey: 'app.monitorDetail.code', header: 'Code',
            sortable: true,
            type: 'enum',
            value: (c) => (c.status_code == null ? '—' : String(c.status_code)),
            sortValue: (c) => c.status_code ?? null,
            cellClassName: 'sk-cell-mono',
            render: (c) => (c.status_code == null ? '—' : c.status_code),
        },
        {
            key: 'response_time',
            headerKey: 'app.monitorDetail.latency', header: 'Latency',
            sortable: true,
            type: 'num',
            unit: ' ms',
            // Null for a check that timed out, never 0 — a zero would sort as
            // the fastest probe in the window and satisfy "is under 200".
            value: (c) => c.response_time ?? null,
            sortValue: (c) => c.response_time ?? null,
            render: (c) => (c.response_time == null ? '—' : `${c.response_time} ms`),
        },
        {
            // The error text only. The cell falls back to the request line,
            // which is identical on every row of one monitor's log, so a rule
            // reading what the cell renders would match all rows or none.
            key: 'error',
            headerKey: 'app.monitorDetail.detail', header: 'Detail',
            type: 'text',
            value: (c) => c.error || '',
            cellClassName: 'mon-checkdetail',
            render: (c) => c.error || `${monitor?.check_method || 'GET'} ${monitor?.check_target}`,
        },
    ], [monitor]);

    // No `pageState`: the two things this page owns are the fetch window (a
    // SegControl in the Performance section, shared with the chart) and the
    // freeze, which is a transient hold on a streaming table. Neither is state
    // a saved view should change under the operator from another section.
    const chrome = useTableChrome({
        columns: checkColumns,
        rows,
        viewPageKey: 'monitor-checks',
        builtinViews: CHECK_VIEWS,
        noun: 'checks',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    // Both pre-load states keep the shell, so the bar is in place from the
    // first paint rather than appearing once the monitor resolves.
    if (loading && !monitor) {
        return (
            <PageLayout className="monitor-detail" icon={<ArrowLeft size={18} />} title={t('app.monitorDetail.monitor', 'Monitor')}>
                <EmptyState loading loadingVariant="detail" title={t('app.monitorDetail.loadingMonitor', 'Loading monitor')} />
            </PageLayout>
        );
    }

    if (loadError && !monitor) {
        return (
            <PageLayout className="monitor-detail" icon={<ArrowLeft size={18} />} title={t('app.monitorDetail.monitor', 'Monitor')}>
                <ErrorState
                    title={t('app.monitorDetail.couldntLoadMonitor', "Couldn't load this monitor.")}
                    error={loadError}
                    onRetry={load}
                />
            </PageLayout>
        );
    }

    if (notFound || !monitor) {
        return (
            <PageLayout className="monitor-detail" icon={<ArrowLeft size={18} />} title={t('app.monitorDetail.monitor', 'Monitor')}>
                <EmptyState
                    icon={ShieldAlert}
                    title={t('app.monitorDetail.monitorNotFound', 'Monitor not found')}
                    description={t('app.monitorDetail.itMayHaveBeenDeleted', 'It may have been deleted.')}
                    action={<Button onClick={() => navigate('/monitoring/monitors')}>{t('app.monitorDetail.backToMonitors', 'Back to monitors')}</Button>}
                />
            </PageLayout>
        );
    }

    const state = monitorStateOf(monitor);
    const certDays = certDaysLeft(monitor.cert_expires_at);
    const isHttpish = ['http', 'keyword'].includes(monitor.check_type);
    const newSinceFreeze = frozen
        ? checks.filter((c) => !frozen.some((f) => f.id === c.id)).length
        : 0;
    const downMinutes = uptime?.days
        ? uptime.days.filter((d) => d.state !== 'none').reduce((total, d) => (
            total + Math.round(((100 - (d.uptime ?? 100)) / 100) * 1440)
        ), 0)
        : null;

    const act = async (fn, successMessage) => {
        setBusy(true);
        try {
            await fn();
            if (successMessage) toast.success(successMessage);
            await load();
        } catch (err) {
            toastError(toast, t('app.monitorDetail.actionFailed', "Couldn't run that action."), err);
        } finally {
            setBusy(false);
        }
    };

    const onCheckNow = () => act(async () => {
        const res = await api.runMonitorCheck(monitor.id);
        const check = res?.check;
        if (check?.status === 'up') toast.success(t('app.monitorDetail.upIn', 'Up in {{duration}} ms', { duration: check.response_time ?? '—' }));
        else toast.warning(`${check?.status || 'failed'}${check?.error ? ` — ${check.error}` : ''}`);
    });

    const onTogglePause = () => act(
        () => api.setMonitorPaused(monitor.id, !monitor.is_paused),
        monitor.is_paused ? 'Monitor resumed' : 'Monitor paused',
    );

    const onDelete = async () => {
        const ok = await confirm({
            title: t('app.monitorDetail.deleteThisMonitor', 'Delete this monitor?'),
            message: t('app.monitorDetail.andItsCheckHistoryWillBe', '"{{name}}" and its check history will be removed. Any open incident is resolved first.', { name: monitor.name }),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.deleteMonitor(monitor.id);
            toast.success(t('app.monitorDetail.monitorDeleted', 'Monitor deleted'));
            navigate('/monitoring/monitors');
        } catch (err) {
            toastError(toast, t('app.monitorDetail.couldNotDeleteTheMonitor', "Couldn't delete the monitor."), err);
        }
    };

    return (
        <PageLayout
            className="monitor-detail"
            icon={<ArrowLeft size={18} />}
            title={monitor.name}
            meta={t('app.monitorDetail.headerMeta', '{{type}} · {{target}} · every {{interval}}s', { type: monitor.check_type, target: monitor.check_target || t('app.monitorDetail.boundService', 'Bound service'), interval: monitor.check_interval })}
            actions={(
                <>
                    <FavoriteStar type="monitor" id={monitor.id} path={`/monitoring/monitors/${monitor.id}`} label={monitor.name} />
                    <Pill kind={state.tone}>{state.label}</Pill>
                    <Button variant="outline" size="sm" onClick={onCheckNow} disabled={busy}>
                        <RefreshCw size={14} /> {t('app.monitorDetail.checkNow', 'Check now')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onTogglePause} disabled={busy}>
                        {monitor.is_paused ? <><Play size={14} /> {t('app.monitorDetail.resume', 'Resume')}</> : <><Pause size={14} /> {t('app.monitorDetail.pause', 'Pause')}</>}
                    </Button>
                    {isHttpish && monitor.check_target && (
                        <Button variant="outline" size="sm" asChild>
                            <a href={monitor.check_target} target="_blank" rel="noreferrer">
                                <ExternalLink size={14} />
                            </a>
                        </Button>
                    )}
                </>
            )}
        >

            <nav className="monitor-detail__crumb">
                <Link to="/monitoring/monitors">{t('app.monitorDetail.monitors', 'Monitors')}</Link>
                <span aria-hidden="true">/</span>
                <span>{monitor.name}</span>
            </nav>

            {loadError && <ErrorState compact error={loadError} onRetry={load} />}

            <KpiBand>
                <MetricCard
                    label={t('app.monitorDetail.responseNow', 'Response now')} tone="cyan" icon={<Zap size={17} />}
                    value={monitor.last_response_time ?? '—'}
                    unit={monitor.last_response_time != null ? 'ms' : undefined}
                >
                    <div className="mon-kpi-sub">
                        avg {stats.avg ?? '—'} {t('app.monitorDetail.msP95', 'ms · p95')} {stats.p95 ?? '—'} ms
                    </div>
                </MetricCard>
                <MetricCard
                    label={t('app.monitorDetail.uptime30d', 'Uptime (30d)')} tone="accent" icon={<CheckCircle2 size={17} />}
                    value={formatUptime(monitor.uptime_30d)}
                >
                    <div className="mon-kpi-sub">
                        24h {formatUptime(monitor.uptime_24h)} {t('app.monitorDetail.7d', '· 7d')} {formatUptime(monitor.uptime_7d)}
                    </div>
                </MetricCard>
                <MetricCard
                    label={t('app.monitorDetail.downtime90d', 'Downtime (90d)')} tone="amber" icon={<Clock size={17} />}
                    value={downMinutes ?? '—'} unit={downMinutes != null ? 'min' : undefined}
                >
                    <div className="mon-kpi-sub">
                        {uptime?.days
                            ? t('app.monitorDetail.badDays', { count: uptime.days.filter((d) => d.state !== 'none' && d.state !== 'up').length, defaultValue_one: '{{count}} bad day', defaultValue_other: '{{count}} bad days' })
                            : uptimeError ? '—' : t('app.monitorDetail.noHistoryYet', 'No history yet')}
                    </div>
                </MetricCard>
                <MetricCard
                    label={t('app.monitorDetail.certificate', 'Certificate')}
                    tone={certDays == null ? 'accent' : certDays < 0 ? 'red' : certDays < 21 ? 'amber' : 'green'}
                    icon={<Lock size={17} />}
                    value={certDays == null ? 'n/a' : certDays < 0 ? t('app.monitorDetail.expired', 'Expired') : certDays}
                    unit={certDays != null && certDays >= 0 ? 'days' : undefined}
                >
                    <div className="mon-kpi-sub">
                        {monitor.cert_issuer || (isHttpish ? t('app.monitorDetail.notReadYet', 'Not read yet') : t('app.monitorDetail.noTlsOnThisCheck', 'No TLS on this check'))}
                    </div>
                </MetricCard>
            </KpiBand>

            <SegControl
                className="monitor-detail__sections"
                value={section}
                onChange={setSection}
                options={SECTIONS}
            />

            {section === 'performance' && (
                <div className="mon-panel">
                    <div className="mon-panel__header">
                        <div>
                            <h3>{t('app.monitorDetail.responseTime', 'Response time')}</h3>
                            <span className="mon-panel-sub">
                                {t('app.monitorDetail.samplesInWindow', { count: series.length, defaultValue_one: '1 sample in this window', defaultValue_other: '{{count}} samples in this window' })}
                            </span>
                        </div>
                        <SegControl
                            value={rangeHours}
                            onChange={setRangeHours}
                            options={RANGES}
                        />
                    </div>
                    {series.length === 0 ? (
                        <p className="mon-panel-hint">
                            {t('app.monitorDetail.noTimedSamplesYetTheFirst', 'No timed samples yet. The first check lands within')} {monitor.check_interval}s.
                        </p>
                    ) : (
                        <>
                            <AreaChart series={[series]} colors={['var(--cyan)']} height={220} />
                            <div className="mon-statstrip">
                                {[
                                    ['Average', stats.avg != null ? `${stats.avg} ms` : '—'],
                                    ['Fastest', stats.min != null ? `${stats.min} ms` : '—'],
                                    ['Slowest', stats.max != null ? `${stats.max} ms` : '—'],
                                    ['p95', stats.p95 != null ? `${stats.p95} ms` : '—'],
                                    ['Samples', series.length],
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <span className="mon-statstrip__label">{label}</span>
                                        <span className="mon-statstrip__value">{value}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}

            {section === 'uptime' && (
                <div className="mon-stack">
                    <div className="mon-panel">
                        <div className="mon-panel__header">
                            <div>
                                <h3>{t('app.monitorDetail.uptimeLast90Days', 'Uptime (last 90 days)')}</h3>
                                <span className="mon-panel-sub">{t('app.monitorDetail.clickADayForItsDetail', 'Click a day for its detail')}</span>
                            </div>
                            <div className="mon-uptime-summary">
                                {[['24h', monitor.uptime_24h], ['7d', monitor.uptime_7d],
                                    ['30d', monitor.uptime_30d], ['90d', monitor.uptime_90d]].map(([label, value]) => (
                                    <div key={label}>
                                        <span className="mon-statstrip__label">{label}</span>
                                        <span className="mon-statstrip__value">{formatUptime(value)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {uptimeError && (
                            <ErrorState compact error={uptimeError} onRetry={load} />
                        )}
                        <UptimeBars
                            days={uptime?.days || []}
                            selected={selectedDay?.date}
                            onSelect={(day) => setSelectedDay(selectedDay?.date === day.date ? null : day)}
                        />
                        <div className="mon-uptime-axis">
                            <span>{t('app.monitorDetail.90DaysAgo', '90 days ago')}</span>
                            <span>today</span>
                        </div>
                    </div>

                    {selectedDay && (
                        <div className="mon-panel">
                            <div className="mon-panel__header">
                                <div>
                                    <h3>{selectedDay.date}</h3>
                                    <span className="mon-panel-sub">
                                        {selectedDay.state === 'none'
                                            ? t('app.monitorDetail.notMonitoredOnThisDay', 'Not monitored on this day')
                                            : t('app.monitorDetail.daySummary', { count: selectedDay.checks, failed: selectedDay.down_checks, uptime: formatUptime(selectedDay.uptime), defaultValue_one: '{{count}} check · {{failed}} failed · {{uptime}} uptime', defaultValue_other: '{{count}} checks · {{failed}} failed · {{uptime}} uptime' })}
                                    </span>
                                </div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedDay(null)}>{t('common.actions.close', 'Close')}</Button>
                            </div>
                        </div>
                    )}

                    <div className="mon-panel">
                        <div className="mon-panel__header">
                            <div>
                                <h3>{t('app.monitorDetail.certificate', 'Certificate')}</h3>
                                <span className="mon-panel-sub">{t('app.monitorDetail.readFromTheLastHttpsProbe', 'Read from the last https probe')}</span>
                            </div>
                            {certDays != null && (
                                <Pill kind={certDays < 0 ? 'red' : certDays < 21 ? 'amber' : 'green'}>
                                    {certDays < 0 ? 'expired' : 'valid'}
                                </Pill>
                            )}
                        </div>
                        {monitor.cert_expires_at ? (
                            <dl className="mon-inforows">
                                <div><dt>{t('app.monitorDetail.issuer', 'Issuer')}</dt><dd>{monitor.cert_issuer || '—'}</dd></div>
                                <div><dt>{t('app.monitorDetail.expires', 'Expires')}</dt><dd>{new Date(monitor.cert_expires_at).toLocaleDateString()}</dd></div>
                                <div>
                                    <dt>{t('app.monitorDetail.remaining', 'Remaining')}</dt>
                                    <dd>{certDays < 0 ? t('app.monitorDetail.daysAgo', { count: -certDays, defaultValue_one: '{{count}} day ago', defaultValue_other: '{{count}} days ago' }) : t('app.monitorDetail.days', { count: certDays, defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days' })}</dd>
                                </div>
                            </dl>
                        ) : (
                            <p className="mon-panel-hint">
                                {isHttpish && monitor.check_target?.startsWith('https://')
                                    ? t('app.monitorDetail.certNotReadYet', 'Not read yet. It is captured on the next probe.')
                                    : t('app.monitorDetail.checkHasNoTls', "This check doesn't negotiate TLS.")}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* The chrome belongs to the log, so it renders only in this
                section — a view picker above the chart or the config panes
                would be naming something they do not show. The old panel
                header is gone with it: its <h3> repeated the segment that is
                already lit above, and its "N results" is what the table footer
                reports, under the rows it is counting. */}
            {section === 'checks' && (
                <>
                    <GridViewPicker
                        views={chrome.views}
                        label="checks"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                {frozen && newSinceFreeze > 0 && (
                                    <Pill kind="cyan">{newSinceFreeze} new</Pill>
                                )}
                                <Button variant="outline" size="sm" onClick={() => setFrozen(frozen ? null : checks)}>
                                    {frozen ? <><Play size={14} /> {t('app.monitorDetail.resume', 'Resume')}</> : <><Pause size={14} /> {t('app.monitorDetail.hold', 'Hold')}</>}
                                </Button>
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
                            </>
                        )}
                    />

                    <GridChips {...chrome.chipProps} />

                    <DataTable
                        {...chrome.tableProps}
                        data={rows}
                        keyField="id"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        rowClassName={(c) => (c.status === 'up' ? undefined : 'is-bad')}
                        emptyState={(
                            <EmptyState
                                icon={Activity}
                                title={t('app.monitorDetail.noChecksInThisWindowYet', 'No checks in this window yet.')}
                            />
                        )}
                        columns={chrome.columns}
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={rows.length}
                                noun="check"
                            />
                        )}
                    />

                    <GridFilterDrawer {...chrome.drawerProps} />
                </>
            )}

            {section === 'config' && (
                <div className="mon-grid-2">
                    <div className="mon-panel">
                        <div className="mon-panel__header"><div><h3>{t('app.monitorDetail.check', 'Check')}</h3></div></div>
                        <dl className="mon-inforows">
                            <div><dt>{t('common.labels.type', 'Type')}</dt><dd>{monitor.check_type}</dd></div>
                            <div><dt>{t('common.labels.target', 'Target')}</dt><dd>{monitor.check_target || t('app.monitorDetail.boundService', 'Bound service')}</dd></div>
                            <div><dt>{t('app.monitorDetail.interval', 'Interval')}</dt><dd>{monitor.check_interval}s</dd></div>
                            <div><dt>{t('app.monitorDetail.timeout', 'Timeout')}</dt><dd>{monitor.check_timeout}s</dd></div>
                            {isHttpish && <div><dt>{t('app.monitorDetail.method', 'Method')}</dt><dd>{monitor.check_method}</dd></div>}
                            {isHttpish && <div><dt>{t('app.monitorDetail.expected', 'Expected')}</dt><dd>{monitor.expected_status}</dd></div>}
                            {monitor.check_type === 'keyword' && (
                                <div><dt>{t('app.monitorDetail.keyword', 'Keyword')}</dt><dd>{monitor.keyword || '—'}</dd></div>
                            )}
                            {isHttpish && (
                                <div><dt>{t('app.monitorDetail.followRedirects', 'Follow redirects')}</dt><dd>{monitor.follow_redirects ? 'yes' : 'no'}</dd></div>
                            )}
                            {isHttpish && <div><dt>{t('app.monitorDetail.verifyTls', 'Verify TLS')}</dt><dd>{monitor.verify_tls ? 'yes' : 'no'}</dd></div>}
                        </dl>
                    </div>

                    <div className="mon-panel">
                        <div className="mon-panel__header">
                            <div>
                                <h3>{t('app.monitorDetail.alerting', 'Alerting')}</h3>
                                <span className="mon-panel-sub">{t('app.monitorDetail.deliveryIsConfiguredInSettingsNotifications', 'Delivery is configured in Settings → Notifications')}</span>
                            </div>
                        </div>
                        <dl className="mon-inforows">
                            <div>
                                <dt>{t('app.monitorDetail.openAnIncidentAfter', 'Open an incident after')}</dt>
                                <dd>{t('app.monitorDetail.failedChecks', { count: (monitor.retries ?? 0) + 1, defaultValue_one: '1 failed check', defaultValue_other: '{{count}} failed checks' })}</dd>
                            </div>
                            <div><dt>{t('app.monitorDetail.currentFailureStreak', 'Current failure streak')}</dt><dd>{monitor.consecutive_failures ?? 0}</dd></div>
                            <div>
                                <dt>{t('app.monitorDetail.publishedOnAStatusPage', 'Published on a status page')}</dt>
                                <dd>{monitor.page_id ? 'yes' : 'no'}</dd>
                            </div>
                        </dl>
                        <div className="mon-panel__footer">
                            <Button variant="ghost" size="sm" className="mon-danger" onClick={onDelete}>
                                <Trash2 size={14} /> {t('app.monitorDetail.deleteMonitor', 'Delete monitor')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </PageLayout>
    );
}
