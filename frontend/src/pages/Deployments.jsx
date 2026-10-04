import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2, PlayCircle, FlaskConical } from 'lucide-react';
import api from '../services/api';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableFooter, Pill, SearchField, SegControl, statusKind } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import RequiresDocker from '../components/RequiresDocker';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

// Deploy activity cadence while auto-refresh is on.
const DEPLOY_POLL_MS = 3000;


// How many jobs one fetch pulls. The column rules run over what has been
// fetched, so this is the reach of a filter until the user asks for more.
const PAGE = 100;
import {
    KIND_CHIP,
    stepTicks,
    sourceRef,
    formatDuration,
    relativeTime,
    activityGroup,
} from '../utils/deployActivity';

// Built-in saved views. These replace the segmented All/Running/Succeeded/Failed
// strip: the strip was a status rule wearing a button, could not combine with
// anything (you could not ask for "failed, on that server"), and reported counts
// the footer already reports. Every rule matches the `status` column's `value`,
// which is the raw job status the Pill also prints.
const NO_RULES = { match: 'all', rules: [] };
const NEWEST_FIRST = [{ key: 'started', direction: 'desc' }];
const STATUS_IS = (...value) => ({
    match: 'all',
    rules: [{ id: 'dp-st', field: 'status', op: 'any', value }],
});

const BUILTIN_VIEWS = [
    {
        name: 'All deploys',
        state: {
            sorts: NEWEST_FIRST, hiddenKeys: [], groupBy: null, columnFilters: NO_RULES,
        },
    },
    {
        // Queued rides along with running: both answer "is anything happening
        // right now", and a job sitting in the queue is the one worth chasing.
        name: 'In flight',
        state: {
            sorts: NEWEST_FIRST,
            hiddenKeys: [],
            groupBy: null,
            columnFilters: STATUS_IS('running', 'pending'),
        },
    },
    {
        name: 'Failed',
        state: {
            sorts: NEWEST_FIRST, hiddenKeys: [], groupBy: null, columnFilters: STATUS_IS('failed'),
        },
    },
    {
        name: 'Succeeded',
        state: {
            sorts: NEWEST_FIRST,
            hiddenKeys: [],
            groupBy: null,
            columnFilters: STATUS_IS('succeeded'),
        },
    },
    {
        // The old feed's Queued / Today / Earlier buckets, kept as a grouping
        // rather than a fixed layout — the chronological read is worth having,
        // but it is one way of looking at the runs, not the only one.
        name: 'By day',
        state: {
            sorts: NEWEST_FIRST, hiddenKeys: [], groupBy: 'started', columnFilters: NO_RULES,
        },
    },
];

const Deployments = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [search, setSearch] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);

    // Simulated deployments (dev-only): null until the backend confirms the
    // gate is on — a 404 (production) simply keeps the trigger hidden.
    const [simInfo, setSimInfo] = useState(null);
    const [simOpen, setSimOpen] = useState(false);
    const [simSpeed, setSimSpeed] = useState('fast');
    const [simBusy, setSimBusy] = useState(null);

    const { sorts, setSorts } = useTableSort({
        defaultSorts: NEWEST_FIRST,
        storageKey: 'serverkit-table-deployments-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-deployments-cols',
    });
    // Not persisted separately: a grouping worth keeping is a saved view.
    const [groupBy, setGroupBy] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loaded, setLoaded] = useState(PAGE);
    const [loadingMore, setLoadingMore] = useState(false);

    // One unfiltered query. The target server used to narrow it server-side
    // through a <select>; it is the Target column now, so its pick-list is built
    // from the servers that actually deployed something and combines with every
    // other rule instead of replacing them.
    //
    // That trade has a catch worth being honest about: the rules run over the
    // rows FETCHED, where `?server_id=` searched the whole history. So the
    // window is explicit — when a page comes back full there is certainly more
    // behind it, and the footer offers to go get it rather than quietly
    // filtering a truncated list.
    const loadJobs = useCallback(async (limit = PAGE) => {
        try {
            const data = await api.getDeploymentJobs({ limit });
            const rows = data.jobs || [];
            setJobs(rows);
            setHasMore(rows.length >= limit);
            setLoaded(limit);
            setLoadError(null);
        } catch (err) {
            // Keep whatever is on screen; the error renders above it (or in
            // place of the table when nothing has loaded yet).
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        api.getDeploySimulateInfo()
            .then((data) => setSimInfo(data?.enabled ? data : null))
            .catch(() => setSimInfo(null));
    }, []);

    const runScenario = async (scenarioId) => {
        setSimBusy(scenarioId);
        try {
            const res = await api.simulateDeployment(scenarioId, simSpeed);
            if (res?.job_id) navigate(`/deployments/${res.job_id}`);
        } catch (err) {
            console.error('Failed to start test deployment', err);
            setSimBusy(null);
        }
    };

    useEffect(() => { loadJobs(); }, [loadJobs]);

    usePolling(loadJobs, DEPLOY_POLL_MS, { enabled: autoRefresh, immediate: false });

    const searched = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return jobs;
        return jobs.filter((j) =>
            (j.app_name || '').toLowerCase().includes(q)
            || (sourceRef(j) || '').toLowerCase().includes(q)
            || (j.target_server_name || '').toLowerCase().includes(q)
        );
    }, [jobs, search]);

    // Two accessors where they differ: `value` is what the column menu, the
    // filter rules and the export read; `sortValue` is what the sorter reads.
    // Every derived column carries a `render` — without one DataTable falls back
    // to row[key], and none of these keys exist on a deployment job payload.
    const columns = useMemo(() => [
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            hideable: false,
            // Declared, not inferred: a panel with three deploys in it fails the
            // enum cardinality test, and the views above would silently become
            // free-text rules that match nothing.
            type: 'enum',
            enumOrder: ['running', 'pending', 'succeeded', 'failed'],
            value: (job) => job.status,
            sortValue: (job) => job.status,
            // `animate-spin` rather than the `spin` the retired feed rows used:
            // only the former is a real global rule, so `spin` never rotated
            // anything it was put on.
            render: (job) => (
                <Pill kind={statusKind(job.status)} dot={job.status !== 'running'}>
                    {job.status === 'running' && <Loader2 size={11} className="animate-spin" />}
                    {job.status}
                </Pill>
            ),
        },
        {
            key: 'deploy',
            headerKey: 'app.deployments.deploy', header: 'Deploy',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (job) => job.app_name || 'deployment',
            sortValue: (job) => job.app_name || 'deployment',
            render: (job) => (
                <div className="sk-cell-name">
                    <span>
                        <div>{job.app_name || 'deployment'}</div>
                        <div className="sk-cell-sub">
                            {sourceRef(job) || job.id.slice(0, 8)} · {job.trigger || 'manual'}
                            {job.status === 'failed' && job.error_message && (
                                <span className="deployments-page__error"> · {job.error_message}</span>
                            )}
                        </div>
                    </span>
                </div>
            ),
        },
        {
            key: 'kind',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            type: 'enum',
            // Filter and sort on the word the chip prints, so a rule reads the
            // way the row does rather than exposing the backend enum.
            value: (job) => KIND_CHIP[job.kind] || job.kind,
            sortValue: (job) => KIND_CHIP[job.kind] || job.kind,
            render: (job) => (
                <span className="deployments-page__kind">{KIND_CHIP[job.kind] || job.kind}</span>
            ),
        },
        {
            key: 'pipeline',
            headerKey: 'app.deployments.pipeline', header: 'Pipeline',
            sortable: true,
            type: 'num',
            unit: '%',
            value: (job) => job.progress_percent ?? 0,
            sortValue: (job) => job.progress_percent ?? 0,
            render: (job) => (
                <span className="deployments-page__pipe">
                    <span className="deployments-page__ticks">
                        {stepTicks(job).map((state, i) => (
                            <i key={i} className={`is-${state}`} />
                        ))}
                    </span>
                    <span className="deployments-page__pipe-count">
                        {job.current_step || 0}/{job.total_steps || 0}
                    </span>
                </span>
            ),
        },
        {
            key: 'target',
            headerKey: 'common.labels.target', header: 'Target',
            sortable: true,
            type: 'enum',
            groupable: true,
            // A job with no target server ran on the panel's own box; spelling
            // that out keeps the pick-list honest instead of offering a blank.
            value: (job) => job.target_server_name || 'Local server',
            sortValue: (job) => job.target_server_name || 'Local server',
            groupValue: (job) => job.target_server_name || 'Local server',
            cellClassName: 'sk-cell-dim',
            render: (job) => job.target_server_name || 'Local server',
        },
        {
            key: 'took',
            headerKey: 'app.deployments.took', header: 'Took',
            sortable: true,
            type: 'num',
            unit: 's',
            value: (job) => job.duration ?? null,
            sortValue: (job) => job.duration ?? null,
            cellClassName: 'sk-cell-dim',
            render: (job) => formatDuration(job.duration),
        },
        {
            key: 'started',
            headerKey: 'app.deployments.started', header: 'Started',
            sortable: true,
            type: 'date',
            groupable: true,
            value: (job) => job.started_at || job.created_at || null,
            sortValue: (job) => {
                const time = Date.parse(job.started_at || job.created_at);
                return Number.isNaN(time) ? null : time;
            },
            groupValue: (job) => activityGroup(job),
            cellClassName: 'sk-cell-dim',
            render: (job) => (job.status === 'pending'
                ? 'queued'
                : relativeTime(job.started_at || job.created_at)),
        },
    ], []);

    // No `pageState`: search is the only page-private control left, and a saved
    // view carrying somebody's half-typed search term is not a view of the data.
    const chrome = useTableChrome({
        columns,
        rows: searched,
        viewPageKey: 'deployments',
        builtinViews: BUILTIN_VIEWS,
        noun: 'deploys',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
    });

    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <SearchField
                value={search}
                onSearch={setSearch}
                placeholder={t('app.deployments.searchDeploys', 'Search deploys…')}
            />
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={loadJobs} />
        </>,
    );

    useTopbarActions(() =>
        <>
            {/* No "New service" button here: unlike the design mock, this tab
                group already carries a New Service tab, and a second entry
                point crowded the strip into overflow. No Refresh button
                either — the chrome's "⋮" owns "Refresh data" on every page. */}
            {simInfo?.enabled && (
                <Button variant="outline" size="sm" onClick={() => setSimOpen(true)}>
                    <FlaskConical size={16} />
                    {t('app.deployments.testDeployment', 'Test deployment')}
                </Button>
            )}
            <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh((v) => !v)}
                title={t('app.deployments.autoRefreshEvery3s', 'Auto-refresh every 3s')}
            >
                <RefreshCw size={16} className={autoRefresh ? 'spin' : ''} />
                {autoRefresh ? 'Live' : 'Paused'}
            </Button>
        </>,
        [autoRefresh, simInfo?.enabled]
    );

    return (
        <RequiresDocker what="Deployments">
        <div className="sk-tabgroup__inner deployments-page">
            {topbarChrome}

            <GridViewPicker
                views={chrome.views}
                label="deploys"
                onCreate={chrome.createView}
                actions={chromeActions}
            />

            <GridChips {...chrome.chipProps} />

            {loadError && jobs.length > 0 && (
                <ErrorState compact error={loadError} onRetry={() => loadJobs(loaded)} />
            )}

            {loadError && jobs.length === 0 ? (
                <ErrorState
                    title={t('app.deployments.couldntLoadDeployments', "Couldn't load deployments.")}
                    error={loadError}
                    onRetry={() => loadJobs(loaded)}
                />
            ) : (
            <DataTable
                columns={chrome.columns}
                data={searched}
                keyField="id"
                sorts={sorts}
                onSortsChange={setSorts}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                {...chrome.tableProps}
                loading={loading && jobs.length === 0}
                onRowClick={(job) => navigate(`/deployments/${job.id}`)}
                emptyState={(
                    <EmptyState
                        icon={PlayCircle}
                        title={jobs.length === 0 ? t('app.deployments.noDeploymentJobsYet', 'No deployment jobs yet') : t('app.deployments.noDeploysMatchThisSearch', 'No deploys match this search')}
                        description={jobs.length === 0
                            ? t('app.deployments.createAServiceFromARepository', 'Create a service from a repository or install a template to see activity here.')
                            : t('app.deployments.tryADifferentSearchTermOr', 'Try a different search term, or pick another view.')}
                    />
                )}
                footer={(
                    <DataTableFooter
                        // DataTable applies the column rules itself, so the shown
                        // count comes from the chrome; `jobs` is the whole query.
                        shown={chrome.shownCount}
                        total={jobs.length}
                        noun="deploy"
                        hasMore={hasMore}
                        loading={loadingMore}
                        onLoadMore={() => {
                            setLoadingMore(true);
                            loadJobs(loaded + PAGE).finally(() => setLoadingMore(false));
                        }}
                    />
                )}
            />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            <Modal
                open={simOpen}
                onClose={() => setSimOpen(false)}
                title={t('app.deployments.runATestDeployment', 'Run a test deployment')}
                size="md"
            >
                <p className="deployments-page__sim-intro">
                    {t('app.deployments.streamsScriptedOutputThroughTheReal', 'Streams scripted output through the real deploy pipeline. No containers, files, or servers are touched. Development only.')}
                </p>
                <div className="deployments-page__sim-speed">
                    <span>{t('app.deployments.speed', 'Speed')}</span>
                    <SegControl
                        options={[
                            { value: 'fast', label: t('app.deployments.fast', 'Fast') },
                            { value: 'realtime', label: t('app.deployments.realtime', 'Realtime') },
                        ]}
                        value={simSpeed}
                        onChange={setSimSpeed}
                        aria-label={t('app.deployments.speed', 'Speed')}
                    />
                </div>
                <div className="deployments-page__sim-list">
                    {(simInfo?.scenarios || []).map((s) => (
                        <Button variant="unstyled"
                            key={s.id}
                            type="button"
                            className="deployments-page__sim-scenario"
                            onClick={() => runScenario(s.id)}
                            disabled={simBusy !== null}
                        >
                            <span className="deployments-page__sim-scenario-text">
                                <strong>{s.name}</strong>
                                <span>{s.description}</span>
                            </span>
                            {simBusy === s.id && (
                                <Loader2 size={15} className="spin" />
                            )}
                        </Button>
                    ))}
                </div>
            </Modal>
        </div>
        </RequiresDocker>
    );
};

export default Deployments;
