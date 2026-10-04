import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useAuth } from '../contexts/useAuth.js';
import { useConfirm } from '../hooks/useConfirm';
import useFocusParam from '@/hooks/useFocusParam';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import {
    Clock, Plus, RefreshCw, Play, Pause, Trash2, Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
    Pill, SearchField, DataTable, Drawer, DataTableFooter,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import SchedulePicker from '../components/SchedulePicker';
import PageLayout from '../layouts/PageLayout';
import { useTranslation } from 'react-i18next';
import { translateLabel } from '@/i18n/labels';
import { toastError } from '@/utils/errorMessage';

// A new job opens on a sane, non-destructive cadence rather than an empty
// expression the picker would have to render as invalid.
const DEFAULT_SCHEDULE = '0 3 * * *';

const EMPTY_JOB_FORM = {
    name: '',
    command: '',
    schedule: DEFAULT_SCHEDULE,
    description: '',
};

// Fallback humanizer for the handful of schedules the backend can't describe.
const SCHEDULE_LABELS = {
    '* * * * *': 'Every minute',
    '0 * * * *': 'Every hour',
    '0 0 * * *': 'Daily at midnight',
    '0 0 * * 0': 'Weekly on Sunday',
    '0 0 1 * *': 'Monthly on the 1st',
    '0 0 * * 1-5': 'Weekdays at midnight',
    '0 */6 * * *': 'Every 6 hours',
    '0 */12 * * *': 'Every 12 hours',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
};

const describeSchedule = (job) => (
    job.schedule_human || SCHEDULE_LABELS[job.schedule] || job.schedule
);

// Built-in saved views.
// `status` values are the labels jobState() produces: Healthy, Failed, Paused,
// No runs yet, Untracked. There is no separate segment filter any more — the
// Status column's own menu is the one place jobs are narrowed by state.
const RULES = (...value) => ({ match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value }] });
const NO_RULES = { match: 'all', rules: [] };

const BUILTIN_VIEWS = [
    { name: 'Paused', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: RULES('Paused') } },
    { name: 'Active', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: RULES('Healthy', 'No runs yet', 'Untracked') } },
    { name: 'Recently run', state: { search: '', sorts: [{ key: 'last_run', direction: 'desc' }], hiddenKeys: [], columnFilters: NO_RULES } },
    {
        // What broke, most recent failure first.
        name: 'Failing now',
        state: {
            search: '', hiddenKeys: ['next_run'], columnFilters: RULES('Failed'),
            sorts: [{ key: 'last_run', direction: 'desc' }],
        },
    },
    {
        // Scheduled and enabled, but the oldest last-run in the list — the jobs
        // that look healthy only because nothing has checked them.
        name: 'Stale schedules',
        state: {
            search: '', hiddenKeys: [], columnFilters: RULES('Healthy'),
            sorts: [{ key: 'last_run', direction: 'asc' }],
        },
    },
    {
        name: 'Health roll-call',
        state: {
            search: '', hiddenKeys: ['schedule'], columnFilters: NO_RULES,
            sorts: [{ key: 'status', direction: 'asc' }, { key: 'name', direction: 'asc' }],
        },
    },
];

// The browser's zone, not the host's — times are ISO strings rendered client
// side, so this is what the reader is actually seeing. Say so rather than
// implying the schedule's own timezone.
const VIEWER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';

function formatWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(Math.abs(diffMs) / 60000);
    const ago = diffMs >= 0;
    let rel;
    if (mins < 1) rel = 'just now';
    else if (mins < 60) rel = `${mins}m`;
    else if (mins < 1440) rel = `${Math.round(mins / 60)}h`;
    else rel = `${Math.round(mins / 1440)}d`;
    if (rel === 'just now') return rel;
    return ago ? `${rel} ago` : `in ${rel}`;
}

// Sort value for an ISO timestamp: epoch ms, or null (sorts last) when the
// job/run has no usable time.
function timeValue(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : t;
}

function formatDuration(seconds) {
    if (seconds == null) return '—';
    if (seconds < 10) return `${Number(seconds).toFixed(1)}s`;
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
}

// One status per job, folding "is it on?" and "did it last succeed?" together —
// the two questions the list exists to answer.
function jobState(job) {
    if (!job.enabled) return { key: 'paused', kind: 'gray', labelKey: 'app.cronJobs.paused', label: 'Paused' };
    if (job.last_status === 'failure') return { key: 'failed', kind: 'red', labelKey: 'common.state.failed', label: 'Failed' };
    if (job.last_status === 'success') return { key: 'active', kind: 'green', labelKey: 'app.cronJobs.healthy', label: 'Healthy' };
    // Enabled but nothing recorded: either never fired yet, or not tracked.
    if (job.tracked) return { key: 'active', kind: 'cyan', labelKey: 'app.cronJobs.noRunsYet', label: 'No runs yet' };
    return { key: 'active', kind: 'cyan', labelKey: 'app.cronJobs.untracked', label: 'Untracked' };
}

const CronJobs = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { isAdmin } = useAuth();
    const { confirm } = useConfirm();
    const [status, setStatus] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // List filters (client-side, over already-loaded jobs)
    const [search, setSearch] = useState('');

    // Table sort + column visibility (persisted, mirrored by the toolbar menus)
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-cronjobs-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-cronjobs-cols',
    });

    // Shared list chrome: view picker + filter chips + filter drawer + tools,
    // driven off this page's existing sorts/hiddenKeys state. Same hook every
    // other list page uses, so /cron looks and behaves like /domains.
    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Drawer + modal states
    const [drawerJob, setDrawerJob] = useState(null);
    const [showJobDrawer, setShowJobDrawer] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [runningJobId, setRunningJobId] = useState(null);
    const [runOutput, setRunOutput] = useState(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [statusRes, jobsRes] = await Promise.all([
                api.getCronStatus(),
                api.getCronJobs(),
            ]);
            setStatus(statusRes);
            setJobs(jobsRes.jobs || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const openCreateDrawer = () => {
        setEditingJob(null);
        setShowJobDrawer(true);
    };
    // Quick-create deep link: /cron?focus=create:cron opens the job drawer.
    useFocusParam('create', openCreateDrawer);

    const openEditDrawer = (job) => {
        setEditingJob(job);
        setShowJobDrawer(true);
    };

    const closeJobDrawer = () => {
        setShowJobDrawer(false);
        setEditingJob(null);
    };

    const handleDeleteJob = async (job) => {
        const confirmed = await confirm({
            title: t('app.cronJobs.deleteCronJob', 'Delete cron job'),
            message: t('app.cronJobs.areYouSureYouWantTo', "Delete this cron job? This can't be undone."),
        });
        if (!confirmed) return;
        try {
            await api.deleteCronJob(job.id);
            toast.success(t('app.cronJobs.cronJobDeleted', 'Cron job "{{name}}" deleted', { name: job.name }), {
                duration: 8000,
                action: {
                    label: t('app.cronJobs.undo', 'Undo'),
                    onClick: async () => {
                        try {
                            await api.createCronJob({
                                name: job.name,
                                command: job.command,
                                schedule: job.schedule,
                                description: job.description,
                            });
                            toast.success(t('app.cronJobs.cronJobRestored', 'Cron job "{{name}}" restored', { name: job.name }));
                            loadData();
                        } catch (err) {
                            toastError(toast, t('app.cronJobs.couldNotRestoreTheCronJob', "Couldn't restore the cron job."), err);
                        }
                    },
                },
            });
            setDrawerJob(null);
            loadData();
        } catch (err) {
            toastError(toast, t('app.cronJobs.couldntDeleteJob', "Couldn't delete the cron job."), err);
        }
    };

    const handleToggleJob = async (jobId, currentEnabled) => {
        try {
            await api.toggleCronJob(jobId, !currentEnabled);
            toast.success(!currentEnabled
                ? t('app.cronJobs.cronJobOn', 'Cron job turned on')
                : t('app.cronJobs.cronJobOff', 'Cron job turned off'));
            loadData();
        } catch (err) {
            toastError(toast, t('app.cronJobs.couldntToggleJob', "Couldn't turn the cron job on or off."), err);
        }
    };

    const handleRunJob = async (jobId) => {
        try {
            setRunningJobId(jobId);
            const result = await api.runCronJob(jobId);
            if (result.success) {
                setRunOutput({
                    jobId,
                    jobName: jobs.find(j => j.id === jobId)?.name || jobId,
                    exitCode: result.exit_code,
                    stdout: result.stdout,
                    stderr: result.stderr,
                });
                loadData();
            } else {
                toastError(toast, t('app.cronJobs.jobExecutionFailed', "Couldn't run the job."), result.error);
            }
        } catch (err) {
            toastError(toast, t('app.cronJobs.couldntRunJob', "Couldn't run the cron job."), err);
        } finally {
            setRunningJobId(null);
        }
    };


    const q = search.trim().toLowerCase();
    const shown = jobs.filter((job) => !q
        || (job.name || '').toLowerCase().includes(q)
        || (job.command || '').toLowerCase().includes(q));


    const serviceNote = status?.available === false
        ? 'Cron service unavailable'
        : status?.type === 'cron'
            ? (status?.running ? null : 'cron daemon stopped')
            : (status?.type === 'serverkit_scheduler' ? 'internal scheduler' : null);

    const jobColumns = [
        {
            key: 'name',
            headerKey: 'app.cronJobs.job', header: 'Job',
            sortable: true,
            hideable: false,
            sortValue: (job) => (job.name || 'Unnamed job').toLowerCase(),
            render: (job) => (
                <div className="sk-cell-name">
                    <span className="cron-ico"><Clock size={15} /></span>
                    <div className="cron-jobcell">
                        <div className="cron-jobcell__name">
                            {job.name || t('app.cronJobs.unnamedJob', 'Unnamed job')}
                        </div>
                        <div className="sk-cell-sub cron-jobcell__cmd" title={job.command}>
                            {job.command}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            key: 'schedule',
            headerKey: 'common.labels.schedule', header: 'Schedule',
            sortable: true,
            sortValue: (job) => describeSchedule(job),
            render: (job) => (
                <>
                    <span className="cron-sched">
                        <Clock size={11} />{job.schedule}
                    </span>
                    <div className="cron-sched-readable">
                        {describeSchedule(job)}
                    </div>
                </>
            ),
        },
        {
            key: 'last_run',
            headerKey: 'app.cronJobs.lastRun', header: 'Last run',
            sortable: true,
            sortValue: (job) => timeValue(job.last_run),
            cellClassName: 'cron-cell-mono',
            render: (job) => formatWhen(job.last_run),
        },
        {
            key: 'next_run',
            headerKey: 'app.cronJobs.nextRun', header: 'Next run',
            cellClassName: 'cron-cell-mono',
            render: (job) => (
                job.enabled ? formatWhen(job.next_run) : 'paused'
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            groupable: true,
            // The header menu filters and groups on the LABEL, which is what the
            // pill shows — so a preset reads the same way the row does.
            value: (job) => jobState(job).label,
            sortValue: (job) => jobState(job).label,
            render: (job) => {
                const state = jobState(job);
                return <Pill kind={state.kind}>{translateLabel(t, state)}</Pill>;
            },
        },
        {
            key: 'enabled',
            header: 'On',
            hideable: false,
            render: (job) => (
                <span
                    className="cron-switch"
                    onClick={(e) => e.stopPropagation()}
                    role="presentation"
                >
                    <Switch
                        checked={!!job.enabled}
                        onCheckedChange={() => handleToggleJob(job.id, job.enabled)}
                        aria-label={job.enabled ? t('app.cronJobs.disableJob', 'Disable job') : t('app.cronJobs.enableJob', 'Enable job')}
                    />
                </span>
            ),
        },
        {
            key: 'run',
            header: '',
            hideable: false,
            cellClassName: 'cron-cell-actions',
            render: (job) => (
                <span onClick={(e) => e.stopPropagation()} role="presentation">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRunJob(job.id)}
                        disabled={runningJobId === job.id}
                        title={t('app.cronJobs.runNow', 'Run now')}
                    >
                        {runningJobId === job.id
                            ? <span className="spinner-inline" />
                            : <Play size={14} />}
                    </Button>
                </span>
            ),
        },
    ];

    const chrome = useTableChrome({
        columns: jobColumns,
        rows: shown,
        viewPageKey: 'cronjobs',
        builtinViews: BUILTIN_VIEWS,
        noun: 'jobs',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    return (
        <PageLayout
            className="cron-page"
            icon={<Clock size={18} />}
            title={t('app.cronJobs.cronJobs', 'Cron jobs')}
            actions={(
                <>
                    <Button variant="outline" size="sm" onClick={loadData}>
                        <RefreshCw size={15} /> {t('common.actions.refresh', 'Refresh')}
                    </Button>
                    <Button size="sm" onClick={openCreateDrawer}>
                        <Plus size={15} /> {t('app.cronJobs.newCronJob', 'New cron job')}
                    </Button>
                    <SearchField
                        value={search}
                        onSearch={setSearch}
                        placeholder={t('app.cronJobs.searchJobsOrCommands', 'Search jobs or commands…')}
                    />
                </>
            )}
        >
            {error && (
                <div className="error-banner">
                    {error}
                    <Button variant="unstyled"
                        type="button"
                        className="error-banner__close"
                        onClick={() => setError(null)}
                        aria-label={t('app.cronJobs.dismissError', 'Dismiss error')}
                    >
                        ×
                    </Button>
                </div>
            )}

            {loading ? (
                <EmptyState loading loadingVariant="table" title={t('app.cronJobs.loadingCronJobs', 'Loading cron jobs…')} />
            ) : jobs.length === 0 ? (
                <EmptyState
                    icon={Clock}
                    title={t('app.cronJobs.noCronJobs', 'No cron jobs')}
                    description={t('app.cronJobs.noScheduledJobsFoundCreateYour', 'No scheduled jobs found. Create your first cron job to automate tasks.')}
                    action={<Button onClick={openCreateDrawer}><Plus size={16} /> {t('app.cronJobs.newCronJob', 'New cron job')}</Button>}
                />
            ) : (
                <div className="cron-body">
                    {/* No KPI strip: every number it carried is already on the
                        segment you'd click to act on it (mirrors /domains). */}
                    <GridViewPicker
                        views={chrome.views}
                        label="jobs"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                {/* The daemon's health rides with the chrome
                                    rather than in a bar of its own: it is the
                                    reason a "next run" may never happen, so it
                                    belongs beside the table it invalidates. */}
                                {serviceNote && <span className="cron-servicenote">{serviceNote}</span>}
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu {...chrome.toolsProps} onRefresh={loadData} />
                            </>
                        )}
                    />

                    <GridChips {...chrome.chipProps} />

                    {shown.length === 0 ? (
                        <div className="cron-empty">
                            {q ? t('app.cronJobs.noJobsMatchSearch', 'No jobs match “{{search}}”.', { search: search.trim() }) : t('app.cronJobs.noJobsMatchFilter', 'No jobs match this filter.')}
                        </div>
                    ) : (
                        <div className="cron-card">
                            <DataTable
                                tableClassName="sk-dtable cron-table"
                                data={shown}
                                keyField="id"
                                columns={chrome.columns}
                                sorts={sorts}
                                onSortsChange={setSorts}
                                {...chrome.tableProps}
                                onRowClick={setDrawerJob}
                                rowClassName={(job) => (job.enabled ? undefined : 'is-disabled')}
                                footer={(
                                    <DataTableFooter
                                        shown={chrome.shownCount}
                                        total={jobs.length}
                                        noun="job"
                                    />
                                )}
                            />
                        </div>
                    )}

                    <div className="cron-tznote">
                        <Clock size={13} /> {t('app.cronJobs.timesShownInYourLocalTimezone', 'Times shown in your local time zone ·')} {VIEWER_TZ}
                    </div>
                </div>
            )}

            <CronDrawer
                job={drawerJob}
                isAdmin={isAdmin}
                running={drawerJob ? runningJobId === drawerJob.id : false}
                onClose={() => setDrawerJob(null)}
                onRefresh={loadData}
                onRun={handleRunJob}
                onEdit={(j) => { setDrawerJob(null); openEditDrawer(j); }}
                onDelete={handleDeleteJob}
                onToggle={handleToggleJob}
            />

            <CronFormDrawer
                open={showJobDrawer}
                job={editingJob}
                onClose={closeJobDrawer}
                onSaved={() => { closeJobDrawer(); loadData(); }}
            />

            {/* Run Output Modal */}
            <Modal open={!!runOutput} onClose={() => setRunOutput(null)} title={runOutput ? t('app.cronJobs.runOutput', 'Run output: {{jobName}}', { jobName: runOutput.jobName }) : ''}>
                {runOutput && (
                    <div className="run-output">
                        <div className="run-output-exit">
                            <span className="run-output-label">{t('app.cronJobs.exitCode', 'Exit code')}</span>
                            <Pill kind={runOutput.exitCode === 0 ? 'green' : 'red'}>
                                {runOutput.exitCode}
                            </Pill>
                        </div>
                        {runOutput.stdout && (
                            <div className="run-output-section">
                                <span className="run-output-label">stdout</span>
                                <pre className="run-output-pre">{runOutput.stdout}</pre>
                            </div>
                        )}
                        {runOutput.stderr && (
                            <div className="run-output-section">
                                <span className="run-output-label">stderr</span>
                                <pre className="run-output-pre run-output-pre--error">{runOutput.stderr}</pre>
                            </div>
                        )}
                        {!runOutput.stdout && !runOutput.stderr && (
                            <p className="text-muted">{t('app.cronJobs.noOutputProduced', 'No output produced.')}</p>
                        )}
                    </div>
                )}
                <div className="modal-actions">
                    <Button variant="outline" onClick={() => setRunOutput(null)}>{t('common.actions.close', 'Close')}</Button>
                </div>
            </Modal>
            <GridFilterDrawer {...chrome.drawerProps} />
        </PageLayout>
    );
};

// Row-click drawer: the job's configuration plus its recorded run history.
// History comes from GET /cron/jobs/<id>/runs, which is admin-only and only
// returns anything for jobs whose crontab line carries the tracking shim — both
// of which are surfaced rather than silently rendering an empty table.
function CronDrawer({ job, isAdmin, running, onClose, onRefresh, onRun, onEdit, onDelete, onToggle }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [history, setHistory] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [trackingBusy, setTrackingBusy] = useState(false);

    const loadHistory = useCallback(async (jobId) => {
        setHistoryLoading(true);
        try {
            const res = await api.getCronJobRuns(jobId);
            setHistory({ runs: res.runs || [], stats: res.stats || {} });
        } catch {
            // Non-admin (403) or a transient failure: fall back to the
            // config-only drawer rather than blocking it behind an error.
            setHistory(null);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!job || !isAdmin) {
            setHistory(null);
            return;
        }
        loadHistory(job.id);
    }, [job, isAdmin, loadHistory]);

    // The Drawer stays mounted with open={!!job} (same as /domains) so closing
    // it plays the slide-out instead of vanishing; the body is what unmounts.
    const state = job ? jobState(job) : { kind: 'gray', label: '' };
    const stats = history?.stats || {};
    const runs = history?.runs || [];
    const lastOutput = runs.find(r => r.output_tail)?.output_tail;
    const successRate = stats.success_rate == null ? null : Math.round(stats.success_rate * 1000) / 10;
    const rateTone = successRate == null ? 'none'
        : successRate > 99 ? 'good'
            : successRate > 95 ? 'warn' : 'bad';

    const handleTracking = async () => {
        setTrackingBusy(true);
        try {
            await api.setCronTracking(job.id, { enabled: !job.tracked });
            toast.success(job.tracked ? t('app.cronJobs.runTrackingDisabled', 'Run tracking disabled') : t('app.cronJobs.runTrackingEnabled', 'Run tracking enabled'));
            onClose();
            onRefresh?.();
        } catch (err) {
            toastError(toast, t('app.cronJobs.couldntChangeTracking', "Couldn't change run tracking."), err);
        } finally {
            setTrackingBusy(false);
        }
    };

    return (
        <Drawer
            open={!!job}
            onOpenChange={(open) => { if (!open) onClose(); }}
            title={job?.name || t('app.cronJobs.unnamedJob', 'Unnamed job')}
            subtitle={job ? `${job.schedule} · ${describeSchedule(job)}` : ''}
            icon={<Clock size={18} />}
            width={640}
            headerExtra={job && (
                <div className="cron-drawer__headeractions">
                    <Button
                        size="sm"
                        onClick={() => onRun(job.id)}
                        disabled={running}
                    >
                        {running ? <span className="spinner-inline" /> : <Play size={14} />} {t('app.cronJobs.runNow', 'Run now')}
                    </Button>
                </div>
            )}
        >
            {job && (
            <div className="cron-drawer">
                <section className="cron-drawer__section">
                    <h3 className="cron-drawer__sectiontitle">{t('app.cronJobs.configuration', 'Settings')}</h3>
                    <div className="cron-drawer__info">
                        <div className="cron-inforow">
                            <span className="k">{t('common.labels.schedule', 'Schedule')}</span>
                            <span className="v">{job.schedule}</span>
                        </div>
                        <div className="cron-inforow">
                            <span className="k">{t('common.labels.command', 'Command')}</span>
                            <span className="v cron-inforow__cmd">{job.command}</span>
                        </div>
                        {job.description && (
                            <div className="cron-inforow">
                                <span className="k">{t('common.labels.description', 'Description')}</span>
                                <span className="v">{job.description}</span>
                            </div>
                        )}
                        <div className="cron-inforow">
                            <span className="k">{t('app.cronJobs.nextRun', 'Next run')}</span>
                            <span className="v">{job.enabled ? formatWhen(job.next_run) : 'paused'}</span>
                        </div>
                        <div className="cron-inforow">
                            <span className="k">{t('common.labels.status', 'Status')}</span>
                            <span className="v"><Pill kind={state.kind}>{translateLabel(t, state)}</Pill></span>
                        </div>
                    </div>
                </section>

                <section className="cron-drawer__section">
                    <h3 className="cron-drawer__sectiontitle">{t('app.cronJobs.runHistory', 'Run history')}</h3>

                    {!isAdmin ? (
                        <p className="cron-drawer__hint">
                            {t('app.cronJobs.runHistoryIsAnAdminOnly', 'Run history is an admin-only surface.')}
                        </p>
                    ) : !job.tracked ? (
                        <div className="cron-drawer__tracking">
                            <p className="cron-drawer__hint">
                                {t('app.cronJobs.runTrackingIsOffForThis', 'Run tracking is off for this job, so nothing is recorded. Turning it on rewrites the crontab line to report each run\'s exit code, duration, and output tail.')}
                            </p>
                            <Button variant="outline" size="sm" onClick={handleTracking} disabled={trackingBusy}>
                                {trackingBusy ? t('app.cronJobs.enabling', 'Enabling…') : t('app.cronJobs.enableRunTracking', 'Enable run tracking')}
                            </Button>
                        </div>
                    ) : historyLoading ? (
                        <EmptyState loading loadingVariant="table" title={t('app.cronJobs.loadingRunHistory', 'Loading run history…')} />
                    ) : runs.length === 0 ? (
                        <p className="cron-drawer__hint">{t('app.cronJobs.noRunsRecordedYet', 'No runs recorded yet.')}</p>
                    ) : (
                        <>
                            <div className="cron-specs">
                                <div className="cron-spec">
                                    <div className="l">{t('app.cronJobs.successRate', 'Success rate')}</div>
                                    <div className={`v v--${rateTone}`}>
                                        {successRate == null ? '—' : `${successRate}%`}
                                    </div>
                                    <div className="s">
                                        {stats.failure || 0} {t('app.cronJobs.failedOfLast', 'failed of last')} {stats.total || 0}
                                    </div>
                                </div>
                                <div className="cron-spec">
                                    <div className="l">{t('app.cronJobs.lastRun', 'Last run')}</div>
                                    <div className="v">{formatWhen(stats.last_run)}</div>
                                    <div className="s">{stats.last_status || 'unknown'}</div>
                                </div>
                                <div className="cron-spec">
                                    <div className="l">{t('app.cronJobs.cadence', 'Cadence')}</div>
                                    <div className="v">{describeSchedule(job)}</div>
                                    <div className="s">next {job.enabled ? formatWhen(job.next_run) : 'paused'}</div>
                                </div>
                            </div>

                            <div className="cron-drawer__table">
                                <DataTable
                                    tableClassName="sk-dtable"
                                    storageKey="serverkit-table-cron-runs"
                                    data={runs}
                                    keyField="id"
                                    columns={[
                                        {
                                            key: 'when',
                                            headerKey: 'common.labels.when', header: 'When',
                                            sortable: true,
                                            sortValue: (r) => timeValue(r.finished_at || r.started_at),
                                            render: (r) => formatWhen(r.finished_at || r.started_at),
                                        },
                                        {
                                            key: 'duration',
                                            headerKey: 'common.labels.duration', header: 'Duration',
                                            sortable: true,
                                            sortValue: (r) => r.duration_seconds,
                                            render: (r) => formatDuration(r.duration_seconds),
                                        },
                                        {
                                            key: 'exit',
                                            headerKey: 'app.cronJobs.exit', header: 'Exit',
                                            render: (r) => (
                                                <span className={r.exit_code ? 'cron-exit--bad' : undefined}>
                                                    {r.exit_code ?? '—'}
                                                </span>
                                            ),
                                        },
                                        {
                                            key: 'status',
                                            headerKey: 'common.labels.status', header: 'Status',
                                            sortable: true,
                                            sortValue: (r) => r.status,
                                            render: (r) => (
                                                <Pill kind={r.status === 'success' ? 'green' : 'red'}>
                                                    {r.status}
                                                </Pill>
                                            ),
                                        },
                                    ]}
                                    footer={(
                                        <DataTableFooter
                                            shown={runs.length}
                                            total={runs.length}
                                            noun="run"
                                        />
                                    )}
                                />
                            </div>
                        </>
                    )}
                </section>

                {lastOutput && (
                    <section className="cron-drawer__section">
                        <h3 className="cron-drawer__sectiontitle">{t('app.cronJobs.lastOutput', 'Last output')}</h3>
                        <pre className="run-output-pre">{lastOutput}</pre>
                    </section>
                )}

                <section className="cron-drawer__section cron-drawer__danger">
                    <div className="cron-drawer__actions">
                        <Button variant="outline" size="sm" onClick={() => onEdit(job)}>
                            <Pencil size={14} /> {t('common.actions.edit', 'Edit')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onToggle(job.id, job.enabled)}>
                            {job.enabled ? <><Pause size={14} /> {t('common.actions.disable', 'Disable')}</> : <><Play size={14} /> {t('common.actions.enable', 'Enable')}</>}
                        </Button>
                        {job.tracked && (
                            <Button variant="outline" size="sm" onClick={handleTracking} disabled={trackingBusy}>
                                {trackingBusy ? t('app.cronJobs.disabling', 'Disabling…') : t('app.cronJobs.disableRunTracking', 'Disable run tracking')}
                            </Button>
                        )}
                        <Button variant="destructive" size="sm" onClick={() => onDelete(job)}>
                            <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                        </Button>
                    </div>
                </section>
            </div>
            )}
        </Drawer>
    );
}

// Create / edit drawer. The schedule half is the shared <SchedulePicker/> —
// presets, a builder, a raw cron field with per-position hints, the humanized
// description and the next fire times — the same control Backups schedules use.
// This page contributes the two fields cron actually needs on top of it.
function CronFormDrawer({ open, job, onClose, onSaved }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [form, setForm] = useState(EMPTY_JOB_FORM);
    const [saving, setSaving] = useState(false);

    // Seed on open rather than on mount: the drawer stays mounted (so closing
    // plays the slide-out) and is reused for both create and edit.
    useEffect(() => {
        if (!open) return;
        setForm(job
            ? {
                name: job.name || '',
                command: job.command || '',
                schedule: job.schedule || DEFAULT_SCHEDULE,
                description: job.description || '',
            }
            : { ...EMPTY_JOB_FORM });
    }, [open, job]);

    const patch = (p) => setForm((f) => ({ ...f, ...p }));
    const schedule = form.schedule.trim().replace(/\s+/g, ' ');
    const canSave = !!(form.name.trim() && form.command.trim() && schedule);

    const submit = async (e) => {
        e.preventDefault();
        if (!canSave || saving) return;
        setSaving(true);
        try {
            const payload = {
                name: form.name.trim(),
                command: form.command.trim(),
                schedule,
                description: form.description.trim(),
            };
            if (job) {
                await api.updateCronJob(job.id, payload);
                toast.success(t('app.cronJobs.cronJobUpdated', 'Cron job updated'));
            } else {
                await api.createCronJob(payload);
                toast.success(t('app.cronJobs.cronJobCreated', 'Cron job created'));
            }
            onSaved();
        } catch (err) {
            toastError(toast, t('app.cronJobs.couldntCreateJob', "Couldn't create the cron job."), err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            open={open}
            onOpenChange={(o) => { if (!o) onClose(); }}
            title={job ? t('app.cronJobs.editCronJob', 'Edit cron job') : t('app.cronJobs.newCronJob', 'New cron job')}
            subtitle={job ? job.name : t('app.cronJobs.scheduleACommandOnThisServer', 'Schedule a command on this server')}
            icon={<Clock size={18} />}
            width={640}
            className="cron-form-drawer"
        >
            <form className="cron-form" onSubmit={submit}>
                <div className="cron-form__field">
                    <label htmlFor="cron-name">{t('app.cronJobs.jobName', 'Job name')}</label>
                    <input
                        id="cron-name"
                        className="cron-form__input"
                        value={form.name}
                        onChange={(e) => patch({ name: e.target.value })}
                        placeholder={t('app.cronJobs.eGNightlySiteBackups', 'e.g. Nightly site backups')}
                    />
                </div>

                <div className="cron-form__field">
                    <label htmlFor="cron-command">{t('common.labels.command', 'Command')}</label>
                    <input
                        id="cron-command"
                        className="cron-form__input cron-form__input--mono"
                        value={form.command}
                        onChange={(e) => patch({ command: e.target.value })}
                        placeholder="/usr/bin/backup.sh --all"
                        spellCheck={false}
                    />
                    <span className="cron-form__hint">
                        {t('app.cronJobs.runsAsThePanelSSystem', 'Runs as the panel\'s system user, from its home directory.')}
                    </span>
                </div>

                <div className="cron-form__field">
                    <label htmlFor="cron-schedule-picker">{t('common.labels.schedule', 'Schedule')}</label>
                    <div id="cron-schedule-picker">
                        <SchedulePicker
                            value={form.schedule}
                            onChange={(cron) => patch({ schedule: cron })}
                        />
                    </div>
                </div>

                <div className="cron-form__field">
                    <label htmlFor="cron-description">{t('app.cronJobs.descriptionOptional', 'Description (optional)')}</label>
                    <textarea
                        id="cron-description"
                        className="cron-form__input cron-form__textarea"
                        value={form.description}
                        onChange={(e) => patch({ description: e.target.value })}
                        placeholder={t('app.cronJobs.whatDoesThisJobDo', 'What does this job do?')}
                        rows={2}
                    />
                </div>

                {/* The line this form will actually write to the crontab —
                    what you would have typed by hand, shown before you commit. */}
                <div className="cron-form__field">
                    <label htmlFor="cron-entry">{t('app.cronJobs.crontabEntry', 'Crontab entry')}</label>
                    <pre id="cron-entry" className="cron-form__entry">
                        {`${schedule || '* * * * *'} ${form.command.trim() || '<command>'}`}
                    </pre>
                </div>

                <div className="cron-form__actions">
                    <Button type="button" variant="outline" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button type="submit" disabled={!canSave || saving}>
                        {saving
                            ? t('common.saving', 'Saving…')
                            : job
                                ? t('app.cronJobs.saveChanges', 'Save changes')
                                : <><Plus size={15} /> {t('app.cronJobs.createJob', 'Create cron job')}</>}
                    </Button>
                </div>
            </form>
        </Drawer>
    );
}

export default CronJobs;
