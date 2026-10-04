// Monitors — the synthetic-check list (watch a URL, a service, a WordPress site).
//
// Tab-group page (the Domains/Cron/Jobs pattern): the group's shared PageTopbar
// carries SearchField + FilterDrawer + Refresh + "Add monitor" via
// useTopbarActions, so there is no second header inside the page.
//
// Two filter surfaces live here and they are NOT the same tool: the DS
// FilterDrawer narrows the QUERY sent to /monitors (status + type, so it sees
// rows this client never loaded), while the grid chrome's column rules narrow
// the rows already on screen. A saved view carries both — the server pair under
// `page.serverFilters`, the rules under `columnFilters`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronRight, Globe, Pause, Play, Plus, Radar, RefreshCw,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import {
    DataTable, DataTableFooter, Drawer, FilterButton, FilterDrawer,
    Pill, SearchField, Sparkline, countActiveFilters,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridToolsMenu,
} from '@/components/ds/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import useFocusParam from '@/hooks/useFocusParam';
import { CHECK_TYPES, MONITOR_STATUS, monitorStateOf } from '../components/monitoring/monitorShared';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

const POLL_MS = 15000;

const emptyForm = {
    name: '',
    check_type: 'http',
    check_target: '',
    check_interval: 60,
    check_timeout: 10,
    check_method: 'GET',
    expected_status: '200-299',
    keyword: '',
    follow_redirects: true,
    verify_tls: true,
    retries: 2,
};

const TARGET_PLACEHOLDER = {
    http: 'https://example.com/health',
    keyword: 'https://example.com/',
    tcp: 'db.example.com:5432',
    dns: 'example.com',
    smtp: 'mail.example.com:25',
    ping: 'example.com',
};

function relativeTime(iso) {
    if (!iso) return 'never';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';
    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 0) return 'in a moment';
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function countdown(iso) {
    if (!iso) return '—';
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    if (Number.isNaN(seconds)) return '—';
    if (seconds <= 0) return 'due';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m`;
}

function formatUptime(value) {
    if (value == null) return '—';
    return `${Number(value).toFixed(2)}%`;
}

// Built-in saved views, in the shared envelope (see ds/grid/viewState.js).
//
// `columnFilters` are CLIENT-side rules over the rows on screen; the page's own
// SERVER-side query pair lives in `page.serverFilters`. Both used to be called
// `filters`, which is precisely why they cross-wired — a preset that meant
// "ask the API for major_outage" was read as a column rule and matched nothing.
//
// A status rule filters on the Status column's `value`, which is the LABEL
// monitorStateOf() renders ('Operational'), never the API code ('operational').
const STATE = (...value) => ({ match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value }] });
const NO_RULES = { match: 'all', rules: [] };
// The FilterDrawer's query pair at rest — a view that sets no server filter has
// to say so, or it inherits whatever the previous view asked the API for.
const NO_QUERY = { status: '', type: '' };

const BUILTIN_VIEWS = [
    {
        // Was the "Operational" KPI tile: everything answering normally, i.e.
        // the "nothing to do here" check rather than a worklist.
        name: 'Operational',
        state: {
            sorts: [], hiddenKeys: [], columnFilters: STATE('Operational'),
            page: { search: '', serverFilters: NO_QUERY },
        },
    },
    {
        // Was the "Degraded" KPI tile. That tile counted degraded +
        // partial_outage and monitorStateOf() labels BOTH 'Degraded', so this
        // one label rule reproduces the tile's union exactly — which the
        // previous server-side `status: 'degraded'` preset did not, it silently
        // dropped every partial_outage.
        name: 'Degraded',
        state: {
            sorts: [], hiddenKeys: [], columnFilters: STATE('Degraded'),
            page: { search: '', serverFilters: NO_QUERY },
        },
    },
    {
        // Stays SERVER-side: major_outage is asked of the API, so this view is
        // not limited to the rows the current query happened to return. It is
        // also what the "Down" tile pointed at — there is exactly one of these.
        name: 'Down',
        state: {
            sorts: [], hiddenKeys: [], columnFilters: NO_RULES,
            page: { search: '', serverFilters: { status: 'major_outage', type: '' } },
        },
    },
    {
        name: 'Slowest',
        state: {
            sorts: [{ key: 'response', direction: 'desc' }], hiddenKeys: [], columnFilters: NO_RULES,
            page: { search: '', serverFilters: NO_QUERY },
        },
    },
    {
        // Least reliable over the month, slowest first among ties — the review
        // list, as opposed to "what is broken right now".
        name: 'Worst uptime (30d)',
        state: {
            hiddenKeys: ['next_check_at'], columnFilters: NO_RULES,
            sorts: [{ key: 'uptime_30d', direction: 'asc' }, { key: 'response', direction: 'desc' }],
            page: { search: '', serverFilters: NO_QUERY },
        },
    },
    {
        // Paused checks are silent by design; this is how you notice one has
        // been silent for longer than anybody intended.
        name: 'Paused — still silenced',
        state: {
            hiddenKeys: ['last_check_at', 'next_check_at'], columnFilters: NO_RULES,
            sorts: [{ key: 'name', direction: 'asc' }],
            page: { search: '', serverFilters: { status: 'paused', type: '' } },
        },
    },
    {
        name: 'Slow web checks',
        state: {
            hiddenKeys: ['check_type'], columnFilters: NO_RULES,
            sorts: [{ key: 'response', direction: 'desc' }],
            page: { search: '', serverFilters: { status: '', type: 'http' } },
        },
    },
    {
        name: 'In maintenance',
        state: {
            hiddenKeys: ['next_check_at'], columnFilters: NO_RULES,
            sorts: [{ key: 'name', direction: 'asc' }],
            page: { search: '', serverFilters: { status: 'maintenance', type: '' } },
        },
    },
];

export default function Monitors() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const toast = useToast();

    const [monitors, setMonitors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [q, setQ] = useState('');
    const [filters, setFilters] = useState({ status: '', type: '' });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    // Bumps once a second so "next check in 42s" actually counts down between
    // polls instead of sitting still for 15 seconds at a time.
    const [, setTick] = useState(0);

    const load = useCallback(async () => {
        try {
            const listRes = await api.getMonitors({
                q: q || undefined, status: filters.status || undefined, type: filters.type || undefined,
            });
            setMonitors(listRes?.monitors || []);
            setLoadError(null);
        } catch (err) {
            // Keep the last good list on screen rather than blanking the page;
            // the error shows above it, or in its place on a first load.
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, [q, filters.status, filters.type]);

    // Reload when the search/filters change; poll on top of that.
    useEffect(() => { load(); }, [load]);
    usePolling(load, POLL_MS, { immediate: false });

    useEffect(() => {
        const timer = setInterval(() => setTick((n) => n + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    const activeFilterCount = countActiveFilters(filters);

    // Table sort + column visibility, controlled so saved views can drive them.
    // Same storage keys DataTable used internally, so existing choices survive.
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-monitors-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({ storageKey: 'serverkit-table-monitors-cols' });

    // The page-private half of a saved view. `serverFilters` is deliberately
    // not called `filters`: in the envelope that name always means the column
    // rules, and this pair is the query the API is asked for instead.
    const viewPageState = useMemo(() => ({ search: q, serverFilters: filters }), [q, filters]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setQ(saved.search);
        if (saved.serverFilters !== undefined) setFilters((f) => ({ ...f, ...saved.serverFilters }));
    }, []);

    const openCreate = () => { setForm(emptyForm); setFormOpen(true); };
    // Quick-create deep link: /monitoring/monitors?focus=create:monitor opens the form.
    useFocusParam('create', openCreate);

    useTopbarActions(() => (
        <>
            <SearchField value={q} onSearch={(value) => setQ(value.trim())} placeholder={t('app.monitors.searchMonitorsOrTargets', 'Search monitors or targets…')} />
            <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
            <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
            </Button>
            <Button size="sm" onClick={openCreate}>
                <Plus size={14} /> {t('app.monitors.addMonitor', 'Add monitor')}
            </Button>
        </>
    ), [q, activeFilterCount, load]);

    const onSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = { ...form };
            if (payload.check_type !== 'keyword') delete payload.keyword;
            if (!['http', 'keyword'].includes(payload.check_type)) {
                delete payload.check_method;
                delete payload.expected_status;
                delete payload.follow_redirects;
            }
            await api.createMonitor(payload);
            toast.success(t('app.monitors.monitoring', 'Monitoring {{name}}', { name: form.name }));
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'monitor-created' },
            }));
            setFormOpen(false);
            load();
        } catch (err) {
            toast.error(err.message || t('app.monitors.couldNotCreateTheMonitor', 'Could not create the monitor'));
        } finally {
            setSaving(false);
        }
    };

    const onTogglePause = async (monitor) => {
        try {
            await api.setMonitorPaused(monitor.id, !monitor.is_paused);
            toast.success(monitor.is_paused ? t('app.monitors.resumed', 'Resumed {{name}}', { name: monitor.name }) : t('app.monitors.paused', 'Paused {{name}}', { name: monitor.name }));
            load();
        } catch (err) {
            toast.error(err.message || t('app.monitors.couldNotChangeTheMonitor', 'Could not change the monitor'));
        }
    };

    const onCheckNow = async (monitor) => {
        try {
            const res = await api.runMonitorCheck(monitor.id);
            const check = res?.check;
            if (check?.status === 'up') toast.success(t('app.monitors.upIn', '{{name}}: up in {{duration}} ms', { name: monitor.name, duration: check.response_time ?? '—' }));
            else toast.warning(`${monitor.name}: ${check?.status || 'failed'}${check?.error ? ` — ${check.error}` : ''}`);
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'monitor-check-completed' },
            }));
            load();
        } catch (err) {
            toast.error(err.message || t('app.monitors.checkFailed', 'Check failed'));
        }
    };

    const filterGroups = useMemo(() => ([
        {
            key: 'status',
            labelKey: 'common.labels.status', label: 'Status',
            type: 'single',
            options: MONITOR_STATUS.map((s) => ({ value: s.value, label: s.label })),
        },
        {
            key: 'type',
            labelKey: 'app.monitors.checkType', label: 'Check type',
            type: 'single',
            options: CHECK_TYPES.map((t) => ({ value: t.value, label: t.label })),
        },
    ]), []);

    const columns = [
        {
            key: 'name',
            headerKey: 'app.monitors.monitor', header: 'Monitor',
            sortable: true,
            hideable: false,
            sortValue: (m) => m.name,
            render: (m) => (
                <div className="sk-cell-name">
                    <span className="mon-ico"><Globe size={15} /></span>
                    <div className="mon-namecell">
                        <div className="mon-namecell__name">{m.name}</div>
                        <div className="mon-namecell__target">{m.check_target || 'bound site'}</div>
                    </div>
                </div>
            ),
        },
        {
            key: 'check_type',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            render: (m) => <span className="mon-type">{m.check_type}</span>,
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            // Pinned rather than left to the sortValue fallback: the column
            // menu, the presets and the chips all read `value`, and it has to
            // be the LABEL the pill shows — a rule written against the API code
            // ('operational') would quietly match nothing. The label also folds
            // degraded + partial_outage into one bucket, which is what the
            // reader sees and therefore what a filter should mean.
            value: (m) => monitorStateOf(m).label,
            sortValue: (m) => monitorStateOf(m).label,
            render: (m) => {
                const state = monitorStateOf(m);
                return <Pill kind={state.tone}>{state.label}</Pill>;
            },
        },
        {
            key: 'response',
            headerKey: 'app.monitors.response', header: 'Response',
            sortable: true,
            sortValue: (m) => m.last_response_time,
            render: (m) => {
                if (m.last_response_time == null) return <span className="mon-muted">—</span>;
                const slow = m.last_response_time > 300;
                return (
                    <div className="mon-response">
                        {m.spark?.length > 1 && (
                            <Sparkline
                                data={m.spark}
                                width={44}
                                height={18}
                                color={slow ? 'var(--amber)' : 'var(--green)'}
                            />
                        )}
                        <span className={slow ? 'mon-response__ms is-slow' : 'mon-response__ms'}>
                            {m.last_response_time} ms
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'uptime_30d',
            headerKey: 'app.monitors.uptime30d', header: 'Uptime (30d)',
            sortable: true,
            render: (m) => <span className="mon-uptime">{formatUptime(m.uptime_30d)}</span>,
        },
        {
            key: 'last_check_at',
            headerKey: 'app.monitors.lastCheck', header: 'Last check',
            sortable: true,
            render: (m) => (
                <span className="mon-muted">{m.is_paused ? 'paused' : relativeTime(m.last_check_at)}</span>
            ),
        },
        {
            key: 'next_check_at',
            headerKey: 'app.monitors.nextCheck', header: 'Next check',
            render: (m) => <span className="mon-muted">{m.is_paused ? '—' : countdown(m.next_check_at)}</span>,
        },
        {
            key: 'actions',
            header: '',
            className: 'mon-actions-col',
            cellClassName: 'mon-actions-cell',
            hideable: false,
            render: (m) => (
                <div className="mon-actions" onClick={(e) => e.stopPropagation()}>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onCheckNow(m)}
                        title={t('app.monitors.checkNow', 'Check now')}
                        data-walkthrough="monitor-check-now"
                    >
                        <RefreshCw size={14} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onTogglePause(m)}
                        title={m.is_paused ? t('app.monitors.resume', 'Resume') : t('app.monitors.pause', 'Pause')}
                    >
                        {m.is_paused ? <Play size={14} /> : <Pause size={14} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/monitoring/monitors/${m.id}`)} title={t('common.actions.open', 'Open')}>
                        <ChevronRight size={14} />
                    </Button>
                </div>
            ),
        },
    ];

    // Shared list chrome: view picker + filter chips + column-rule drawer +
    // tools, driven off this page's own sorts/hiddenKeys state.
    const chrome = useTableChrome({
        columns,
        rows: monitors,
        viewPageKey: 'monitors',
        builtinViews: BUILTIN_VIEWS,
        noun: 'monitors',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
        // Views saved before the envelope existed kept the server-side query at
        // the top level under `filters`; that name now belongs to the column
        // rules, so those views are read into the page bag instead of being
        // mistaken for rules and dropped.
        rename: { filters: 'serverFilters' },
    });

    // The "⋮" rides the top bar with the page's own controls, so the view row
    // is the view name and nothing else. No grid filter button joins it: this
    // page has exactly ONE filter button and it is the top bar's, which opens
    // the SERVER query drawer. Column rules come from each column's own header
    // menu and show up in the chips.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />,
    );

    const hasFilters = Boolean(q || filters.status || filters.type);
    const isHttpish = ['http', 'keyword'].includes(form.check_type);

    return (
        <div className="sk-tabgroup__inner monitors-page">
            {topbarChrome}
            {/* No KPI band: Operational / Degraded / Down are each a saved view
                you can act from, so the band was three numbers you had to
                re-filter by hand. The fleet's 30-day mean went with the view
                row's meta line — an aggregate no row on this grid can restate,
                and now with nowhere to sit — so /monitors/stats is not fetched
                any more either. */}
            <GridViewPicker
                views={chrome.views}
                label="monitors"
                onCreate={chrome.createView}
            
                actions={chromeActions}
            />

            <GridChips {...chrome.chipProps} />

            {loadError && monitors.length > 0 && (
                <ErrorState compact error={loadError} onRetry={load} />
            )}

            {loading && monitors.length === 0 ? (
                <EmptyState loading loadingVariant="table" title={t('app.monitors.loadingMonitors', 'Loading monitors')} />
            ) : loadError && monitors.length === 0 ? (
                <ErrorState
                    title={t('app.monitors.couldntLoadMonitors', "Couldn't load monitors")}
                    error={loadError}
                    onRetry={load}
                />
            ) : monitors.length === 0 ? (
                <EmptyState
                    icon={Radar}
                    title={hasFilters ? t('app.monitors.noMonitorsMatch', 'No monitors match') : t('app.monitors.nothingIsBeingWatchedYet', 'Nothing is being watched yet')}
                    description={hasFilters
                        ? t('app.monitors.tryADifferentSearchOrClear', 'Try a different search or clear the filters.')
                        : t('app.monitors.addAMonitorToWatchA', 'Add a monitor to watch a website, an API endpoint, a database port or a WordPress site — and get an incident when it stops answering.')}
                    action={hasFilters
                        ? <Button variant="outline" onClick={() => { setQ(''); setFilters({ status: '', type: '' }); }}>{t('common.actions.clearFilters', 'Clear filters')}</Button>
                        : <Button onClick={openCreate}><Plus size={16} /> {t('app.monitors.addMonitor', 'Add monitor')}</Button>}
                />
            ) : (
                <div className="mon-card">
                    <DataTable
                        tableClassName="sk-dtable monitors-table"
                        storageKey="serverkit-table-monitors"
                        data={monitors}
                        keyField="id"
                        columns={chrome.columns}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        onRowClick={(m) => navigate(`/monitoring/monitors/${m.id}`)}
                        rowClassName={(m) => (m.is_paused ? 'is-disabled' : undefined)}
                        footer={<DataTableFooter shown={monitors.length} total={monitors.length} noun="monitor" />}
                    />
                </div>
            )}

            {/* The SERVER-side pair: this one changes what /monitors is asked
                for, so it reaches monitors the client never loaded. Kept
                alongside the column-rule drawer below, not replaced by it. */}
            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filters}
                onChange={setFilters}
                title={t('app.monitors.filterMonitors', 'Filter monitors')}
            />


            <Drawer
                open={formOpen}
                onOpenChange={setFormOpen}
                title={t('app.monitors.addMonitor', 'Add monitor')}
                subtitle={t('app.monitors.probeAUrlHostOrPort', 'Probe a URL, host or port on a schedule')}
                icon={<Radar size={18} />}
            >
                <form className="mon-form" onSubmit={onSave} data-walkthrough="monitor-form">
                    <div className="form-group">
                        <Label htmlFor="mon-name">{t('common.labels.name', 'Name')}</Label>
                        <Input
                            id="mon-name" required value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder={t('app.monitors.marketingSite', 'Marketing site')}
                        />
                    </div>

                    <div className="form-group">
                        <Label htmlFor="mon-type">{t('app.monitors.checkType', 'Check type')}</Label>
                        <Select
                            value={form.check_type}
                            onValueChange={(v) => setForm({ ...form, check_type: v })}
                        >
                            <SelectTrigger id="mon-type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {CHECK_TYPES.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>{t.label} — {t.hint}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="form-group">
                        <Label htmlFor="mon-target">{t('common.labels.target', 'Target')}</Label>
                        <Input
                            id="mon-target" required value={form.check_target}
                            onChange={(e) => setForm({ ...form, check_target: e.target.value })}
                            placeholder={TARGET_PLACEHOLDER[form.check_type]}
                        />
                    </div>

                    {form.check_type === 'keyword' && (
                        <div className="form-group">
                            <Label htmlFor="mon-keyword">{t('app.monitors.keyword', 'Keyword')}</Label>
                            <Input
                                id="mon-keyword" required value={form.keyword}
                                onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                                placeholder={t('app.monitors.proceedToCheckout', 'Proceed to checkout')}
                            />
                            <span className="form-help">
                                {t('app.monitors.a200ResponseWithoutThisText', 'A 200 response without this text counts as an outage.')}
                            </span>
                        </div>
                    )}

                    <div className="mon-form__row">
                        <div className="form-group">
                            <Label htmlFor="mon-interval">{t('app.monitors.intervalS', 'Interval (s)')}</Label>
                            <Input
                                id="mon-interval" type="number" min="30" max="86400" value={form.check_interval}
                                onChange={(e) => setForm({ ...form, check_interval: Number(e.target.value) })}
                            />
                        </div>
                        <div className="form-group">
                            <Label htmlFor="mon-timeout">{t('app.monitors.timeoutS', 'Timeout (s)')}</Label>
                            <Input
                                id="mon-timeout" type="number" min="1" max="120" value={form.check_timeout}
                                onChange={(e) => setForm({ ...form, check_timeout: Number(e.target.value) })}
                            />
                        </div>
                        <div className="form-group">
                            <Label htmlFor="mon-retries">{t('app.monitors.retries', 'Retries')}</Label>
                            <Input
                                id="mon-retries" type="number" min="0" max="10" value={form.retries}
                                onChange={(e) => setForm({ ...form, retries: Number(e.target.value) })}
                            />
                            <span className="form-help">{t('app.monitors.failedChecksToleratedBeforeAnIncident', 'Failed checks tolerated before an incident opens.')}</span>
                        </div>
                    </div>

                    {isHttpish && (
                        <>
                            <div className="mon-form__row">
                                <div className="form-group">
                                    <Label htmlFor="mon-method">{t('app.monitors.method', 'Method')}</Label>
                                    <Select
                                        value={form.check_method}
                                        onValueChange={(v) => setForm({ ...form, check_method: v })}
                                    >
                                        <SelectTrigger id="mon-method"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'].map((m) => (
                                                <SelectItem key={m} value={m}>{m}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="mon-expected">{t('app.monitors.expectedStatus', 'Expected status')}</Label>
                                    <Input
                                        id="mon-expected" value={form.expected_status}
                                        onChange={(e) => setForm({ ...form, expected_status: e.target.value })}
                                        placeholder="200-299"
                                    />
                                </div>
                            </div>

                            <div className="mon-switch-row">
                                <div>
                                    <strong>{t('app.monitors.followRedirects', 'Follow redirects')}</strong>
                                    <span>{t('app.monitors.a30xLandsOnItsDestination', 'A 30x lands on its destination before grading.')}</span>
                                </div>
                                <Switch
                                    checked={form.follow_redirects}
                                    onCheckedChange={(v) => setForm({ ...form, follow_redirects: v })}
                                />
                            </div>
                            <div className="mon-switch-row">
                                <div>
                                    <strong>{t('app.monitors.verifyTls', 'Verify TLS')}</strong>
                                    <span>{t('app.monitors.offForSelfSignedCertificatesOn', 'Off for self-signed certificates on internal hosts.')}</span>
                                </div>
                                <Switch
                                    checked={form.verify_tls}
                                    onCheckedChange={(v) => setForm({ ...form, verify_tls: v })}
                                />
                            </div>
                        </>
                    )}

                    <div className="mon-form__actions">
                        <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button type="submit" disabled={saving} data-walkthrough="monitor-submit">
                            {saving ? 'Adding…' : 'Add monitor'}
                        </Button>
                    </div>
                </form>
            </Drawer>
        </div>
    );
}
