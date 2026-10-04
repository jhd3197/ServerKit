import { useState, useEffect } from 'react';
import { Clock, CheckCircle2, AlertCircle, History } from 'lucide-react';
import api from '../services/api';
import { Pill, Drawer } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Read-only summary of an app's scheduled (cron) jobs. Rendered on the service
// detail and WordPress detail Overview tabs. The backend endpoint is
// workspace-scoped, so on any error (including 403 for non-members) we render
// nothing to keep the page clean.
const ScheduledTasksCard = ({ appId }) => {
    const { t } = useTranslation();
    const [jobs, setJobs] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // Run-history drawer (#2): member-visible, read-only subset for one job.
    const [runsJob, setRunsJob] = useState(null);
    const [runsData, setRunsData] = useState(null);
    const [runsLoading, setRunsLoading] = useState(false);

    useEffect(() => {
        if (!appId) return;
        let cancelled = false;
        setLoading(true);
        setError(false);
        api.getCronJobsForApp(appId)
            .then((data) => {
                if (!cancelled) setJobs(data?.jobs || []);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [appId]);

    const openRuns = (job) => {
        setRunsJob(job);
        setRunsData(null);
        setRunsLoading(true);
        api.getCronJobRunsForApp(appId, job.id)
            .then((data) => setRunsData({ runs: data?.runs || [], stats: data?.stats || {} }))
            .catch(() => setRunsData({ runs: [], stats: {} }))
            .finally(() => setRunsLoading(false));
    };

    // Render nothing on error / no access so non-members' pages stay clean.
    if (error) return null;

    return (
        <div className="scheduled-tasks-card">
            <div className="scheduled-tasks-card__header">
                <Clock size={14} />
                <span>{t('app.scheduledTasksCard.scheduledTasks', 'Scheduled tasks')}</span>
            </div>
            {loading ? (
                <div className="scheduled-tasks-card__loading">{t('common.loading', 'Loading…')}</div>
            ) : !jobs || jobs.length === 0 ? (
                <div className="scheduled-tasks-card__empty">{t('app.scheduledTasksCard.noScheduledTasksForThisApp', 'No scheduled tasks for this service.')}</div>
            ) : (
                <ul className="scheduled-tasks-card__list">
                    {jobs.map((job) => (
                        <li key={job.id} className="scheduled-tasks-card__row">
                            <div className="scheduled-tasks-card__main">
                                <span className="scheduled-tasks-card__name">{job.name || 'Unnamed job'}</span>
                                <span className="scheduled-tasks-card__sched">{job.schedule_human || job.schedule}</span>
                                {job.schedule_human && job.schedule && (
                                    <span className="scheduled-tasks-card__cron">{job.schedule}</span>
                                )}
                            </div>
                            <div className="scheduled-tasks-card__meta">
                                <span className="scheduled-tasks-card__next">{formatWhen(job.next_run)}</span>
                                <StatusHint job={job} />
                                <SharedButton variant="unstyled"
                                    type="button"
                                    className="scheduled-tasks-card__runs-btn"
                                    onClick={() => openRuns(job)}
                                    title={t('app.scheduledTasksCard.viewRecentRuns', 'View recent runs')}
                                >
                                    <History size={13} />
                                </SharedButton>
                                <Pill kind={job.enabled ? 'green' : 'gray'}>
                                    {job.enabled ? 'Enabled' : 'Disabled'}
                                </Pill>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <Drawer
                open={!!runsJob}
                onOpenChange={(open) => { if (!open) setRunsJob(null); }}
                title={runsJob?.name || t('app.scheduledTasksCard.scheduledTask', 'Scheduled task')}
                subtitle={t('app.scheduledTasksCard.recentRuns', 'recent runs')}
                icon={<History size={16} />}
                width={520}
            >
                <div className="scheduled-tasks-runs">
                    {runsLoading ? (
                        <div className="scheduled-tasks-runs__empty">{t('common.loading', 'Loading…')}</div>
                    ) : !runsData || runsData.runs.length === 0 ? (
                        <div className="scheduled-tasks-runs__empty">
                            {runsJob && !runsJob.tracked
                                ? 'Run tracking is off for this task — no history to show.'
                                : 'No runs recorded yet.'}
                        </div>
                    ) : (
                        <>
                            {runsData.stats?.success_rate != null && (
                                <div className="scheduled-tasks-runs__rate">
                                    {Math.round(runsData.stats.success_rate * 100)}{t('app.scheduledTasksCard.success', '% success')}
                                    <span className="scheduled-tasks-runs__count"> {t('app.scheduledTasksCard.last', '· last')} {runsData.stats.total} runs</span>
                                </div>
                            )}
                            <ul className="scheduled-tasks-runs__list">
                                {runsData.runs.map((r) => (
                                    <li key={r.id} className="scheduled-tasks-runs__item">
                                        <Pill kind={r.status === 'success' ? 'green' : 'red'}>{r.status}</Pill>
                                        <span className="scheduled-tasks-runs__when">{formatWhen(r.finished_at)}</span>
                                        {r.duration_seconds != null && (
                                            <span className="scheduled-tasks-runs__dur">{Math.round(r.duration_seconds)}s</span>
                                        )}
                                        {r.exit_code != null && (
                                            <span className="scheduled-tasks-runs__exit">exit {r.exit_code}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </Drawer>
        </div>
    );
};

// The status cell: a real icon when a run has been recorded, otherwise an honest
// hint so the field is never a silent blank (the dead-field the review flagged).
function StatusHint({ job }) {
    if (job.last_status) {
        return job.last_status === 'success' ? (
            <CheckCircle2 size={14} className="scheduled-tasks-card__status scheduled-tasks-card__status--ok" />
        ) : (
            <AlertCircle size={14} className="scheduled-tasks-card__status scheduled-tasks-card__status--bad" />
        );
    }
    return (
        <span className="scheduled-tasks-card__status-hint">
            {job.tracked ? 'no runs yet' : 'tracking off'}
        </span>
    );
}

// Format an ISO timestamp; guard invalid / missing → em dash.
function formatWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default ScheduledTasksCard;
