// Jobs — admin view over the unified job system (job orchestration, "Phase 9").
//
// A tab in the Monitoring group now, not a top-level page: it is the same class
// of thing as Events, and the two read as rival pages while one sat in the
// sidebar and the other inside the group. The group's shared PageTopbar carries
// SearchField + FilterDrawer (status/kind) + Refresh; Activity/Scheduled is an
// in-page SegControl rather than its own tab strip, because the group's bar
// already owns the tab row and a nav under a nav reads as two headers.
//
// Activity shows a view bar, a DataTable of runs, and server-side pagination
// over a job store that can hold six figures of scheduler-tick rows.
// Wired to the real ApiService job methods (see frontend/src/services/api/jobs.js).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ListChecks, RefreshCw, RotateCcw, XCircle, Play, Clock } from 'lucide-react';
import api from '../services/api';
import {
    Pill, DataTable, DataTableFooter, SegControl,
    SearchField, FilterDrawer, FilterButton, countActiveFilters,
    statusKind,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridToolsMenu,
} from '@/components/ds/grid';
import { Button } from '@/components/ui/button';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useAuth } from '../contexts/useAuth.js';
import { useToast } from '../contexts/useToast.js';
import { timeAgo } from '../utils/time';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const titleCase = (value = '') => value.charAt(0).toUpperCase() + value.slice(1);

const STATUSES = ['all', 'queued', 'running', 'succeeded', 'failed', 'cancelled'];
const PAGE_SIZE = 50;
const POLL_MS = 5000;

// Built-in saved views, in the shared envelope (see ds/grid/viewState.js):
// { sorts, hiddenKeys, columnOrder, groupBy, columnFilters, page }.
//
// Two filter systems live on this page and they are NOT the same tool:
//
//   page.serverFilters — the FilterDrawer's {status, kind} query pair ('' =
//     all), sent to GET /jobs. Narrows the whole TABLE before pagination.
//   columnFilters      — the chrome's client-side {match, rules} column rules.
//     Narrows the PAGE_SIZE rows already on screen.
//
// They shared the name `filters` until plan 69, which is exactly how a preset
// could blank both server filters while filtering nothing. `serverFilters` is
// namespaced inside `page` now; useTableChrome's `rename` keeps views users
// saved under the old top-level `filters` working.
//
// A Scheduled/Activity view is still NOT expressible here: that switch lives in
// the URL-driven SegControl, and the drawer's kind options come from the API.
//
// Every preset spells out BOTH filter sets even when empty. An absent key does
// reset to empty, but capture() always emits both — so a preset that omits one
// reads as permanently "Unsaved" the instant you pick it.
const STATUS_RULE = (...value) => ({ match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value }] });
const NO_RULES = { match: 'all', rules: [] };
const ALL_JOBS = { status: '', kind: '' };

const BUILTIN_VIEWS = [
    {
        name: 'Failed',
        state: {
            sorts: [], hiddenKeys: [], columnFilters: NO_RULES,
            page: { serverFilters: { status: 'failed', kind: '' } },
        },
    },
    {
        name: 'Newest first',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: [], columnFilters: NO_RULES,
            page: { serverFilters: ALL_JOBS },
        },
    },
    {
        // The retired "Running" KPI tile. This one is a COLUMN rule rather than
        // a server filter: it composes with whatever kind is already selected,
        // which is what the tile did on top of the drawer's kind. The cost is
        // that it narrows the loaded page, not the table — see the caveat above
        // the Status column.
        name: 'Running',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: [],
            columnFilters: STATUS_RULE('running'),
            page: { serverFilters: ALL_JOBS },
        },
    },
    {
        // Started and never finished — oldest first, because the one that has
        // been "running" longest is the one that is actually wedged.
        name: 'Stuck in flight',
        state: {
            sorts: [{ key: 'when', direction: 'asc' }], hiddenKeys: [], columnFilters: NO_RULES,
            page: { serverFilters: { status: 'running', kind: '' } },
        },
    },
    {
        // Queued work. The stored value is `pending` (Job.STATUS_PENDING) — the
        // retired KPI tile read `by_status.pending` but its click sent
        // `'queued'`, so the tile counted one bucket and filtered another. This
        // view is the server-side one and it has always been right; nothing
        // client-side is added on top of it.
        name: 'Backlog',
        state: {
            sorts: [{ key: 'when', direction: 'asc' }], hiddenKeys: ['progress'], columnFilters: NO_RULES,
            page: { serverFilters: { status: 'pending', kind: '' } },
        },
    },
    {
        name: 'Failures by kind',
        state: {
            sorts: [{ key: 'kind', direction: 'asc' }, { key: 'when', direction: 'desc' }],
            hiddenKeys: ['owner'], columnFilters: NO_RULES,
            page: { serverFilters: { status: 'failed', kind: '' } },
        },
    },
    {
        name: 'Backup runs',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: ['kind'], columnFilters: NO_RULES,
            page: { serverFilters: { status: '', kind: 'backup.policy.run' } },
        },
    },
    {
        name: 'App deploys',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: ['kind', 'owner'], columnFilters: NO_RULES,
            page: { serverFilters: { status: '', kind: 'deploy.app' } },
        },
    },
];

// Map a job status to a DS Pill colour.
function ownerLabel(job) {
    if (!job.owner_type) return '—';
    return `${job.owner_type}${job.owner_id ? ` #${job.owner_id}` : ''}`;
}

function progressLabel(job) {
    if (typeof job.progress === 'number') return `${Math.round(job.progress)}%`;
    if (job.completed_units != null && job.total_units != null) {
        return `${job.completed_units}/${job.total_units}`;
    }
    return '—';
}

export default function Jobs() {
    const { t } = useTranslation();
    const { isAdmin } = useAuth();
    const toast = useToast();
    const location = useLocation();
    const navigate = useNavigate();
    // The view still lives in the URL (so a link to the scheduled list keeps
    // working) — only the control that switches it moved into the page.
    const scheduledView = location.pathname.endsWith('/scheduled');
    const [jobs, setJobs] = useState([]);
    const [total, setTotal] = useState(0);
    const [scheduled, setScheduled] = useState([]);
    // Advanced filters live in the shared FilterDrawer (status + kind, single-
    // select; '' = all). Search is a separate debounced term.
    const [filters, setFilters] = useState({ status: '', kind: '' });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [kinds, setKinds] = useState([]);
    const [q, setQ] = useState('');
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadErrors, setLoadErrors] = useState({ jobs: null, scheduled: null });

    // Table sort + column visibility, controlled so saved views can drive
    // them — same localStorage keys the DataTables used when uncontrolled.
    const { sorts: activitySorts, setSorts: setActivitySorts } = useTableSort({
        storageKey: 'serverkit-table-jobs-activity-sort',
    });
    const { hiddenKeys: activityHidden, setHiddenKeys: setActivityHidden } = useColumnVisibility({
        storageKey: 'serverkit-table-jobs-activity-cols',
    });
    const { sorts: schedSorts, setSorts: setSchedSorts } = useTableSort({
        storageKey: 'serverkit-table-jobs-scheduled-sort',
    });
    const { hiddenKeys: schedHidden } = useColumnVisibility({
        storageKey: 'serverkit-table-jobs-scheduled-cols',
    });

    // The page-private half of a saved view. Everything else the chrome
    // captures (sorts, hidden columns, column order, column rules) is common to
    // every list page and lives in the envelope, not here. The server-side
    // page/offset is deliberately NOT captured — a view is a query, not a
    // scroll position.
    const viewPageState = useMemo(() => ({ serverFilters: filters }), [filters]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.serverFilters !== undefined) {
            setFilters({ status: '', kind: '', ...saved.serverFilters });
            // A different query means a different result set; staying on page 4
            // of the old one would land on an empty table.
            setPage(0);
        }
    }, []);

    const load = useCallback(async () => {
        try {
            const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
            if (filters.status) params.status = filters.status;
            if (filters.kind) params.kind = filters.kind;
            if (q) params.q = q;
            // No /jobs/stats call any more: its whole-table group-bys only ever
            // fed the count line above the table, and the footer counts the
            // rows the query actually returned.
            // Each tab's request settles on its own. A failure keeps the last
            // good rows on screen and is recorded for that tab, so it renders
            // as an error instead of "No jobs have run yet".
            const [jobsRes, schedRes] = await Promise.allSettled([
                api.getJobs(params),
                api.getScheduledJobs(),
            ]);
            if (jobsRes.status === 'fulfilled') {
                const data = jobsRes.value;
                setJobs(data?.jobs || []);
                setTotal(data?.total ?? (data?.jobs?.length || 0));
            }
            if (schedRes.status === 'fulfilled') {
                const data = schedRes.value;
                setScheduled(data?.scheduled || data?.jobs || data || []);
            }
            setLoadErrors({
                jobs: jobsRes.status === 'rejected' ? jobsRes.reason : null,
                scheduled: schedRes.status === 'rejected' ? schedRes.reason : null,
            });
        } finally {
            setLoading(false);
        }
    }, [filters, q, page]);

    useEffect(() => {
        if (!isAdmin) return undefined;
        api.getJobKinds()
            .then((res) => setKinds(res?.kinds || res || []))
            .catch(() => { /* filter just won't populate */ });
        return undefined;
    }, [isAdmin]);

    // Reload when the query changes; poll on top of that.
    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin, load]);
    usePolling(load, POLL_MS, { enabled: isAdmin, immediate: false });

    const onFiltersChange = (next) => { setFilters(next); setPage(0); };
    const onSearch = (value) => { setQ(value.trim()); setPage(0); };
    const resetFilters = () => { setFilters({ status: '', kind: '' }); setQ(''); setPage(0); };
    const activeFilterCount = countActiveFilters(filters);

    // Search + advanced-filter trigger + Refresh sit in the shared page top bar
    // (the Marketplace/Domains pattern). Search/filters only apply to the
    // Activity tab; the Scheduled tab just gets Refresh. The view picker is NOT
    // here any more — it is the Activity table's own heading, because it
    // describes that table and nothing else on the page.
    useTopbarActions(() => {
        if (!isAdmin) return null;
        return (
            <>
                {!scheduledView && (
                    <>
                        <SearchField value={q} onSearch={onSearch} placeholder={t('app.jobs.searchByKindOrOwner', 'Search by kind or owner…')} />
                        <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
                    </>
                )}
                <Button variant="outline" size="sm" onClick={load}>
                    <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
                </Button>
            </>
        );
    }, [isAdmin, scheduledView, q, activeFilterCount, load]);

    const onRetry = async (id) => {
        try { await api.retryJob(id); toast.success(t('app.jobs.jobReQueued', 'Job re-queued')); load(); }
        catch (err) { toastError(toast, t('app.jobs.retryFailed', 'Retry failed'), err); }
    };
    const onCancel = async (id) => {
        try { await api.cancelJob(id); toast.success(t('app.jobs.jobCancelled', 'Job cancelled')); load(); }
        catch (err) { toastError(toast, t('app.jobs.cancelFailed', 'Cancel failed'), err); }
    };
    const onRunScheduled = async (id) => {
        try { await api.runScheduledJob(id); toast.success(t('app.jobs.scheduledJobTriggered', 'Scheduled job triggered')); load(); }
        catch (err) { toastError(toast, t('app.jobs.triggerFailed', 'Trigger failed'), err); }
    };
    const onToggleScheduled = async (id, enabled) => {
        try { await api.setScheduledJobEnabled(id, enabled); load(); }
        catch (err) { toastError(toast, t('app.jobs.updateFailed', 'Update failed'), err); }
    };

    // Declared above the admin gate because useTableChrome is a hook and the
    // gate returns early — the column list is what it infers filter types from.
    const jobColumns = [
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Typed explicitly rather than left to inference. There is no
            // `value`/`sortValue` here, so a rule reads `row.status` — the DB
            // string — which is what the presets commit to. Inference would
            // agree on a full page but downgrade a 2-row page to free text,
            // and then the Status column menu would lose its pick-list.
            //
            // ⚠ A column rule filters the PAGE_SIZE rows the grid holds, not
            // the table: the job store is paginated server-side. Where a status
            // is worth a whole-table answer (Failed, Backlog) the built-in view
            // sends it to the API instead — see BUILTIN_VIEWS.
            type: 'enum',
            render: (j) => <Pill kind={statusKind(j.status)}>{j.status}</Pill>,
        },
        { key: 'kind', headerKey: 'common.labels.kind', header: 'Kind', sortable: true, cellClassName: 'sk-jobs__kind', render: (j) => j.kind || '—' },
        { key: 'owner', headerKey: 'app.jobs.owner', header: 'Owner', sortable: true, sortValue: (j) => j.owner_type || null, cellClassName: 'sk-jobs__owner', render: ownerLabel },
        {
            key: 'progress',
            headerKey: 'app.jobs.progress', header: 'Progress',
            render: (j) => (
                <>
                    {progressLabel(j)}
                    {j.error_message && (
                        <div className="sk-jobs__error" title={j.error_message}>{j.error_message}</div>
                    )}
                </>
            ),
        },
        {
            key: 'when',
            headerKey: 'common.labels.when', header: 'When',
            sortable: true,
            sortValue: (j) => {
                const stamp = j.created_at || j.updated_at;
                return stamp ? new Date(stamp).getTime() : null;
            },
            cellClassName: 'sk-jobs__when',
            render: (j) => timeAgo(j.created_at || j.updated_at),
        },
        {
            key: 'actions',
            header: '',
            className: 'sk-jobs__actions-col',
            cellClassName: 'sk-jobs__actions-cell',
            render: (j) => (
                <div className="sk-jobs__actions">
                    {j.can_cancel && (
                        <Button variant="ghost" size="sm" onClick={() => onCancel(j.id)}>
                            <XCircle size={14} /> {t('common.actions.cancel', 'Cancel')}
                        </Button>
                    )}
                    {j.can_retry && (
                        <Button variant="ghost" size="sm" onClick={() => onRetry(j.id)}>
                            <RotateCcw size={14} /> {t('common.actions.retry', 'Retry')}
                        </Button>
                    )}
                </div>
            ),
        },
    ];

    // Shared list chrome for the ACTIVITY table only — the saved views describe
    // its sorts, its columns and this page's server query, none of which the
    // Scheduled table has. `rename` keeps views saved before the envelope, whose
    // server query sat at the top level as `filters`, pointing at the right key.
    const chrome = useTableChrome({
        columns: jobColumns,
        rows: jobs,
        viewPageKey: 'jobs',
        builtinViews: BUILTIN_VIEWS,
        noun: 'jobs',
        sorts: activitySorts,
        setSorts: setActivitySorts,
        hiddenKeys: activityHidden,
        setHiddenKeys: setActivityHidden,
        pageState: viewPageState,
        applyPage: applyViewPageState,
        rename: { filters: 'serverFilters' },
    });

    // Only the "⋮" is hoisted: the top bar's filter button already opens the
    // SERVER query drawer, which sees rows this client never loaded, and a
    // second one would open a weaker drawer over the loaded page only. Gated on
    // the Activity tab because the chrome describes that table, not Scheduled.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />, { enabled: isAdmin && !scheduledView },
    );

    if (!isAdmin) {
        return (
            <div className="sk-tabgroup__inner jobs-page">
                <div className="sk-jobs"><EmptyState title={t('app.jobs.adminsOnly', 'Admins only.')} /></div>
            </div>
        );
    }

    const hasFilters = Boolean(filters.status || filters.kind || q);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const kindOptions = kinds
        .map((k) => (typeof k === 'string' ? k : k.kind || k.name))
        .filter(Boolean);

    const filterGroups = [
        {
            key: 'status',
            labelKey: 'common.labels.status', label: 'Status',
            type: 'single',
            options: STATUSES.filter((s) => s !== 'all').map((s) => ({ value: s, label: titleCase(s) })),
        },
        {
            key: 'kind',
            labelKey: 'common.labels.kind', label: 'Kind',
            type: 'single',
            options: kindOptions.map((k) => ({ value: k, label: k })),
        },
    ];

    const scheduledColumns = [
        { key: 'name', headerKey: 'common.labels.name', header: 'Name', sortable: true, sortValue: (s) => s.name || s.kind || null, render: (s) => s.name || s.kind || `#${s.id}` },
        { key: 'kind', headerKey: 'common.labels.kind', header: 'Kind', sortable: true, cellClassName: 'sk-jobs__kind', render: (s) => s.kind || '—' },
        { key: 'schedule', headerKey: 'common.labels.schedule', header: 'Schedule', sortable: true, sortValue: (s) => s.schedule || s.cron || null, cellClassName: 'sk-jobs__owner', render: (s) => s.schedule || s.cron || (s.interval_seconds ? `every ${s.interval_seconds}s` : '—') },
        { key: 'next', headerKey: 'app.jobs.nextRun', header: 'Next run', cellClassName: 'sk-jobs__when', render: (s) => (s.next_run_at ? timeAgo(s.next_run_at) : '—') },
        { key: 'enabled', headerKey: 'app.jobs.enabled', header: 'Enabled', render: (s) => <Pill kind={s.enabled ? 'green' : 'gray'}>{s.enabled ? 'On' : 'Off'}</Pill> },
        {
            key: 'actions',
            header: '',
            className: 'sk-jobs__actions-col',
            cellClassName: 'sk-jobs__actions-cell',
            render: (s) => (
                <div className="sk-jobs__actions">
                    <Button variant="ghost" size="sm" onClick={() => onRunScheduled(s.id)}>
                        <Play size={14} /> {t('app.jobs.runNow', 'Run now')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onToggleScheduled(s.id, !s.enabled)}>
                        {s.enabled ? 'Disable' : 'Enable'}
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <div className="sk-tabgroup__inner jobs-page">
            {topbarChrome}
            <div className="sk-jobs">
                <div className="sk-jobs__viewswitch">
                    <SegControl
                        value={scheduledView ? 'scheduled' : 'activity'}
                        onChange={(value) => navigate(
                            value === 'scheduled' ? '/monitoring/jobs/scheduled' : '/monitoring/jobs',
                        )}
                        options={[
                            { value: 'activity', labelKey: 'app.jobs.activity', label: 'Activity', icon: <ListChecks size={14} /> },
                            { value: 'scheduled', labelKey: 'app.jobs.scheduled', label: 'Scheduled', icon: <Clock size={14} /> },
                        ]}
                    />
                </div>

                {scheduledView && loadErrors.scheduled && scheduled.length > 0 && (
                    <ErrorState compact error={loadErrors.scheduled} onRetry={load} />
                )}
                {scheduledView && loadErrors.scheduled && scheduled.length === 0 ? (
                    <ErrorState
                        title={t('app.jobs.couldntLoadScheduledJobs', "Couldn't load scheduled jobs")}
                        error={loadErrors.scheduled}
                        onRetry={load}
                    />
                ) : scheduledView ? (
                    <DataTable
                        columns={scheduledColumns}
                        data={scheduled}
                        keyField="id"
                        sorts={schedSorts}
                        onSortsChange={setSchedSorts}
                        hiddenKeys={schedHidden}
                        loading={loading && scheduled.length === 0}
                        emptyTitle="No scheduled jobs yet."
                        emptyMessage=""
                    />
                ) : (
                    <>
                        {/* The KPI band is gone: three of its four tiles were a
                            status filter wearing a number, and those are views
                            now. The rest was whole-table arithmetic that only
                            ever restated what the view picker offers. */}
                        <GridViewPicker
                            views={chrome.views}
                            label="jobs"
                            onCreate={chrome.createView}
                        
                actions={chromeActions}
            />

                        <GridChips {...chrome.chipProps} />

                        {/* Clears the SERVER query (status/kind/search). The
                            column rules have their own Clear on the chip bar —
                            two filter systems, two resets. */}
                        {hasFilters && (
                            <div className="sk-jobs__resultbar">
                                <Button variant="ghost" size="sm" onClick={resetFilters}>
                                    {t('app.jobs.resetFilters', 'Reset filters')}
                                </Button>
                            </div>
                        )}

                        {loadErrors.jobs && jobs.length > 0 && (
                            <ErrorState compact error={loadErrors.jobs} onRetry={load} />
                        )}

                        {loadErrors.jobs && jobs.length === 0 ? (
                            <ErrorState
                                title={t('app.jobs.couldntLoadJobs', "Couldn't load jobs")}
                                error={loadErrors.jobs}
                                onRetry={load}
                            />
                        ) : (
                        <DataTable
                            columns={chrome.columns}
                            data={jobs}
                            keyField="id"
                            sorts={activitySorts}
                            onSortsChange={setActivitySorts}
                            {...chrome.tableProps}
                            loading={loading && jobs.length === 0}
                            footer={(
                                <DataTableFooter
                                    shown={jobs.length}
                                    total={total}
                                    noun="job"
                                    page={page + 1}
                                    totalPages={totalPages}
                                    onPageChange={(next) => setPage(next - 1)}
                                />
                            )}
                            emptyTitle={hasFilters ? 'No jobs match these filters.' : 'No jobs have run yet.'}
                            emptyMessage=""
                        />
                        )}
                    </>
                )}
            </div>

            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filters}
                onChange={onFiltersChange}
                title={t('app.jobs.filterJobs', 'Filter jobs')}
            />

            {/* The column-rule drawer. Distinct from the FilterDrawer above it:
                that one rewrites the API query, this one narrows the rows the
                query already returned. */}
        </div>
    );
}
