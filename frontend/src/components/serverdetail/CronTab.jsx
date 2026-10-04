import { PRESET_LABELS } from './serverDetailData';
import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, DataTableFooter, Pill } from '../ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import EmptyState from '../EmptyState';
import { Clock3 } from 'lucide-react';
import Modal from '@/components/Modal';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    OfflineIcon,
    StopIcon,
    PlayIcon,
    TrashIcon,
} from './serverDetailShared';

// Built-in saved views. A remote cron entry is only
// { id, schedule, command, enabled, name?, description? } — the agent parses
// the host crontab and there is no run history behind it — so enabled/disabled
// is the one axis worth slicing, and it is exactly the axis the row already
// renders as a pill. Every rule below matches the `status` column's `value`,
// which is the same lowercase string the Pill shows.
const NO_RULES = { match: 'all', rules: [] };
const ENABLED_IS = (value) => ({
    match: 'all',
    rules: [{ id: 'cr1', field: 'status', op: 'any', value: [value] }],
});

const CRON_VIEWS = [
    {
        // The whole crontab in the order cron itself would read it — the
        // landing view, and the one that says "nothing is filtered".
        name: 'All jobs',
        state: {
            sorts: [{ key: 'schedule', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
        },
    },
    {
        // What will actually fire. A disabled entry is still a line in the
        // crontab (commented out), so "what runs on this box" is a question
        // the unfiltered table cannot answer at a glance.
        name: 'Enabled',
        state: {
            sorts: [{ key: 'schedule', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: ENABLED_IS('enabled'),
        },
    },
    {
        // The other half: entries someone parked rather than removed. Usually
        // short, and worth reading before adding a job that duplicates one.
        name: 'Disabled',
        state: {
            sorts: [{ key: 'schedule', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: ENABLED_IS('disabled'),
        },
    },
];

const CronTab = ({ serverId, serverStatus }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm: confirmCron } = useConfirm();
    const [status, setStatus] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showAddModal, setShowAddModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        name: '',
        schedule: '0 * * * *',
        command: '',
    });
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-sd-cron-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-sd-cron-cols' });

    const loadJobs = useCallback(async () => {
        try {
            const data = await api.getRemoteCronJobs(serverId);
            setJobs(data?.jobs || []);
            setError(null);
        } catch (err) {
            setError(err.message || 'Failed to load cron jobs');
        }
    }, [serverId]);

    const loadStatus = useCallback(async () => {
        try {
            const s = await api.getRemoteCronStatus(serverId);
            setStatus(s);
        } catch (err) {
            // Non-critical — log but don't block the table.
            console.error('Failed to load cron status:', err);
        }
    }, [serverId]);

    useEffect(() => {
        if (serverStatus !== 'online') {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            await Promise.all([loadJobs(), loadStatus()]);
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [serverStatus, loadJobs, loadStatus]);

    async function handleToggle(job) {
        try {
            await api.toggleRemoteCronJob(serverId, job.id, !job.enabled);
            toast.success(t('app.cronTab.job', 'Job {{value}}', { value: !job.enabled ? 'enabled' : 'disabled' }));
            loadJobs();
        } catch (err) {
            toast.error(err.message || t('app.cronTab.failedToToggleJob', 'Failed to toggle job'));
        }
    }

    async function handleRemove(job) {
        const ok = await confirmCron({
            titleKey: 'app.cronTab.removeCronJob', title: 'Delete cron job',
            message: `${t('app.cronTab.deleteThisEntryFromThe', 'Delete this entry from the host crontab?')}\n\n${job.schedule} ${job.command}`,
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.removeRemoteCronJob(serverId, job.id);
            toast.success(t('app.cronTab.cronJobRemoved', 'Cron job deleted'));
            loadJobs();
        } catch (err) {
            toast.error(err.message || t('app.cronTab.failedToRemoveJob', 'Failed to delete job'));
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!form.command.trim()) {
            toast.error(t('app.cronTab.commandIsRequired', 'Command is required'));
            return;
        }
        if (!form.schedule.trim()) {
            toast.error(t('app.cronTab.scheduleIsRequired', 'Schedule is required'));
            return;
        }
        setSubmitting(true);
        try {
            await api.addRemoteCronJob(serverId, {
                name: form.name.trim(),
                schedule: form.schedule.trim(),
                command: form.command.trim(),
            });
            toast.success(t('app.cronTab.cronJobAdded', 'Cron job added'));
            setShowAddModal(false);
            setForm({ name: '', schedule: '0 * * * *', command: '' });
            loadJobs();
        } catch (err) {
            toast.error(err.message || t('app.cronTab.failedToAddCronJob', 'Failed to add cron job'));
        } finally {
            setSubmitting(false);
        }
    }

    // Jobs table columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace so the .cron-tab / .data-table SCSS
    // keeps applying (.cron-tab__name, .cron-tab__command, .mono).
    //
    // Declared above the offline/loading guards: the chrome below is a hook, so
    // it cannot sit behind an early return.
    const cronColumns = [
        {
            key: 'schedule',
            headerKey: 'common.labels.schedule', header: 'Schedule',
            sortable: true,
            hideable: false,
            // A cron expression is a fragment you type ('0 3'), not a value you
            // pick from a list — five fields make almost every row distinct.
            type: 'text',
            value: (job) => job.schedule || '',
            sortValue: (job) => job.schedule || '',
            render: (job) => (
                <>
                    <span className="mono" title={job.schedule}>{job.schedule}</span>
                    {job.description && job.description !== job.schedule && (
                        <div className="cron-tab__description">{job.description}</div>
                    )}
                </>
            ),
        },
        {
            key: 'command',
            headerKey: 'common.labels.command', header: 'Command',
            sortable: true,
            // Paths and flags: high cardinality, so contains/starts-with is the
            // useful control here too.
            type: 'text',
            value: (job) => job.command || '',
            sortValue: (job) => job.command || '',
            render: (job) => (
                <>
                    {job.name && <div className="cron-tab__name">{job.name}</div>}
                    <code className="cron-tab__command">{job.command}</code>
                </>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared, not inferred: a crontab with two entries fails the enum
            // cardinality test and would fall back to text, which turns the
            // pick-list into a typed fragment and both views above into no-ops.
            // `value` is what the rules read — the same word the Pill renders.
            type: 'enum',
            enumOrder: ['enabled', 'disabled'],
            value: (job) => (job.enabled ? 'enabled' : 'disabled'),
            sortValue: (job) => (job.enabled ? 'enabled' : 'disabled'),
            render: (job) => (
                <Pill kind={job.enabled ? 'green' : 'gray'}>
                    {job.enabled ? 'enabled' : 'disabled'}
                </Pill>
            ),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            className: 'actions-cell',
            cellClassName: 'actions-cell',
            render: (job) => (
                <>
                    <Button variant="unstyled" type="button"
                        className="btn-icon"
                        onClick={() => handleToggle(job)}
                        title={job.enabled ? t('common.actions.disable', 'Disable') : t('common.actions.enable', 'Enable')}
                    >
                        {job.enabled ? <StopIcon /> : <PlayIcon />}
                    </Button>
                    <Button variant="unstyled" type="button"
                        className="btn-icon danger"
                        onClick={() => handleRemove(job)}
                        title={t('common.actions.delete', 'Delete')}
                    >
                        <TrashIcon />
                    </Button>
                </>
            ),
        },
    ];

    // Scoped to this tab, not to the server as a page: one tab is mounted at a
    // time, so a picker at the page heading would sit above whichever tab
    // happened to be open. No `urlScope` — the jobs table is the only one on
    // this tab, so its links keep the plain ?view= names.
    const chrome = useTableChrome({
        columns: cronColumns,
        rows: jobs,
        viewPageKey: 'serverdetail-cron',
        builtinViews: CRON_VIEWS,
        noun: 'jobs',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>{t('app.cronTab.serverOffline', 'Server offline')}</h4>
                <p>{t('app.cronTab.cronManagementRequiresTheServerTo', 'Cron management requires the server to be online.')}</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title={t('app.cronTab.loadingCronJobs', 'Loading cron jobs')} />;
    }

    return (
        <div className="cron-tab">
            <div className="cron-tab__header">
                <div className="cron-tab__status">
                    {status?.available === false ? (
                        <Pill kind="amber">{t('app.cronTab.cronNotAvailable', 'cron not available:')} {status.reason || 'unknown'}</Pill>
                    ) : status?.running === false ? (
                        <Pill kind="amber">{t('app.cronTab.cronDaemonNotRunning', 'cron daemon not running')}</Pill>
                    ) : (
                        <Pill kind="green">{t('app.cronTab.cronDaemonActive', 'cron daemon active')}{status?.daemon ? ` (${status.daemon})` : ''}</Pill>
                    )}
                    {/* No job count here — the table footer reports it, under
                        the rows it is counting. */}
                </div>
                <div className="cron-tab__actions">
                    <Button variant="outline" onClick={loadJobs}>{t('common.actions.refresh', 'Refresh')}</Button>
                    <Button onClick={() => setShowAddModal(true)} disabled={status?.available === false}>
                        {t('app.cronTab.addJob', 'New cron job')}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">{error}</div>
            )}

            {jobs.length === 0 ? (
                <EmptyState
                    icon={Clock3}
                    title={t('app.cronTab.noCronJobs', 'No cron jobs')}
                    description={t('app.cronTab.noScheduledJobsOnThisServer', 'No scheduled jobs on this server. Use Add job to schedule one.')}
                />
            ) : (
                <>
                    {/* One row of chrome: the view name is the heading, and the
                        filter button and "⋮" ride it rather than a second bar
                        that would hold nothing else. */}
                    <GridViewPicker
                        views={chrome.views}
                        label="jobs"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu {...chrome.toolsProps} onRefresh={loadJobs} />
                            </>
                        )}
                    />

                    <GridChips {...chrome.chipProps} />

                    <DataTable
                        columns={chrome.columns}
                        data={jobs}
                        keyField="id"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        rowClassName={(job) => (!job.enabled ? 'row-disabled' : '')}
                        tableClassName="data-table"
                        emptyTitle="No jobs match this view."
                        emptyMessage=""
                        footer={(
                            <DataTableFooter
                                // DataTable applies the column rules itself, so
                                // the shown count comes from the chrome — `jobs`
                                // is only ever the whole crontab.
                                shown={chrome.shownCount}
                                total={jobs.length}
                                noun="job"
                            />
                        )}
                    />
                </>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            <Modal
                open={showAddModal}
                onClose={() => { if (!submitting) setShowAddModal(false); }}
                title={t('app.cronTab.addCronJob', 'New cron job')}
            >
                <p className="sk-modal__subtitle">
                    {t('app.cronTab.scheduleACommandOnTheHost', 'Schedule a command on the host crontab. Runs as the agent user.')}
                </p>
                <form onSubmit={handleSubmit} className="sk-form-stack">
                        <div className="sk-form-field">
                            <Label htmlFor="cron-name">{t('app.cronTab.nameOptional', 'Name (optional)')}</Label>
                            <Input
                                id="cron-name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={t('app.cronTab.backupDatabase', 'Backup database')}
                            />
                        </div>
                        <div className="sk-form-field">
                            <Label htmlFor="cron-schedule">{t('common.labels.schedule', 'Schedule')}</Label>
                            <Select
                                value={Object.keys(PRESET_LABELS).includes(form.schedule) ? form.schedule : 'custom'}
                                onValueChange={(value) => {
                                    if (value === 'custom') return;
                                    setForm({ ...form, schedule: value });
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Object.entries(PRESET_LABELS).map(([cron, label]) => (
                                        <SelectItem key={cron} value={cron}>{label} — {cron}</SelectItem>
                                    ))}
                                    <SelectItem value="custom">{t('app.cronTab.custom', 'Custom…')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input
                                id="cron-schedule"
                                value={form.schedule}
                                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                                placeholder="* * * * *"
                            />
                            <p className="sk-form-hint">{t('app.cronTab.5FieldsMinuteHourDayMonth', '5 fields: minute, hour, day, month, weekday.')}</p>
                        </div>
                        <div className="sk-form-field">
                            <Label htmlFor="cron-command">{t('common.labels.command', 'Command')}</Label>
                            <Textarea
                                id="cron-command"
                                rows={3}
                                value={form.command}
                                onChange={(e) => setForm({ ...form, command: e.target.value })}
                                placeholder="/usr/local/bin/my-script.sh"
                                required
                            />
                            <p className="sk-form-hint">{t('app.cronTab.absolutePathShellOperatorsAreNot', 'Absolute path. Shell operators (;, &&, |, $(), >, <) are not allowed.')}</p>
                        </div>
                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={() => setShowAddModal(false)} disabled={submitting}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button type="submit" disabled={submitting}>{submitting ? t('app.cronTab.creating', 'Creating…') : t('app.cronTab.createCronJob', 'Create cron job')}</Button>
                        </div>
                    </form>
            </Modal>
        </div>
    );
};

export default CronTab;
