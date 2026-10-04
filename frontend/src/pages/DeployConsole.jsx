import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, Clock, WifiOff } from 'lucide-react';
import useDeployJobStream from '../hooks/useDeployJobStream';
import useEngineInstallTarget from '../hooks/useEngineInstallTarget';
import api from '../services/api';
import PipelineStrip from '../components/deploy-console/PipelineStrip';
import ConsoleToolbar from '../components/deploy-console/ConsoleToolbar';
import LogPane from '../components/deploy-console/LogPane';
import ErrorCard from '../components/deploy-console/ErrorCard';
import SuccessBanner from '../components/deploy-console/SuccessBanner';
import { sourceRef } from '../utils/deployActivity';
import { useClipboard } from '@/hooks/useClipboard';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';

const STATUS_META = {
    pending: { labelKey: 'app.deployConsole.queued', label: 'Queued', icon: Clock, cls: 'pending' },
    running: { labelKey: 'app.deployConsole.running', label: 'Running', icon: Loader2, cls: 'running' },
    succeeded: { labelKey: 'app.deployConsole.succeeded', label: 'Succeeded', icon: CheckCircle2, cls: 'succeeded' },
    failed: { labelKey: 'common.state.failed', label: 'Failed', icon: XCircle, cls: 'failed' },
    cancelled: { labelKey: 'app.deployConsole.cancelled', label: 'Cancelled', icon: XCircle, cls: 'failed' },
};

const fmtStarted = (iso) => {
    if (!iso) return 'not started';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
};

const fmtElapsed = (ms) => {
    if (ms == null || ms < 0) return '0:00';
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
};

function humanizeTitle(job) {
    if (!job) return 'Deployment';
    // Kinds contributed by plugins name their own run in the plan, so the
    // console reads properly without a branch per kind here.
    if (job.plan?.title) return job.plan.title;
    if (job.kind === 'demo_deploy') {
        const scenario = job.plan?.scenario || job.result?.scenario;
        return `Test deployment${scenario ? ` — ${scenario}` : ''}`;
    }
    if (job.kind === 'template_install') {
        const name = job.plan?.template_name || job.plan?.app_name || job.app_name || 'app';
        return `Installing ${name}`;
    }
    if (job.kind === 'app_deploy') {
        const target = job.target_server_name && job.target_server_name !== 'Local server'
            ? ` on ${job.target_server_name}` : '';
        return `Deploying ${job.app_name || 'service'}${target}`;
    }
    return `Deployment · ${job.kind}`;
}

export default function DeployConsole() {
    const { t } = useTranslation();
    const { jobId } = useParams();
    const navigate = useNavigate();
    const { job, lines, isLive, transport, error, loading } = useDeployJobStream(jobId, { includePlan: true });
    const { copy } = useClipboard({ successMessage: t('app.deployConsole.logsCopied', 'Logs copied') });

    const [follow, setFollow] = useState(true);
    const [wrap, setWrap] = useState(true);
    const [timestamps, setTimestamps] = useState(false);
    const [level, setLevel] = useState('all');
    const [search, setSearch] = useState('');
    const [scrollToStep, setScrollToStep] = useState(null);
    const [selectedStep, setSelectedStep] = useState(null);
    const [retrying, setRetrying] = useState(false);
    const [now, setNow] = useState(Date.now());
    const [navPos, setNavPos] = useState(0);
    // {index, nonce} — the nonce re-fires the scroll when the same line is
    // targeted twice (one error, pressing next repeatedly).
    const [scrollTarget, setScrollTarget] = useState(null);
    const nonceRef = useRef(0);
    const autoJumpedRef = useRef(null);
    // Log-focus: the failure card, pipeline strip and run identity step aside
    // so the transcript gets the whole page. Not a browser fullscreen — the
    // nav stays put, because you are usually reading a log on the way to doing
    // something else.
    const [logFocus, setLogFocus] = useState(false);

    const status = job?.status || 'pending';

    // Where to go back to when this run created something with a home of its
    // own — today, a database engine. Null for every other kind of deploy.
    const engineTarget = useEngineInstallTarget(job);

    // Did this page watch the run finish, or did we arrive at one that was
    // already over? Opening a week-old install from Deploy Activity is reading
    // history, and history must never navigate away under the reader — so the
    // timed return only arms for a run we actually saw in flight.
    const [watchedRun, setWatchedRun] = useState(false);
    useEffect(() => { setWatchedRun(false); }, [jobId]);
    useEffect(() => {
        if (job?.status === 'running' || job?.status === 'pending') setWatchedRun(true);
    }, [job?.status]);

    // Live elapsed timer while running.
    useEffect(() => {
        if (status !== 'running' && status !== 'pending') return undefined;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [status]);

    const steps = useMemo(() => {
        const planSteps = job?.plan?.steps || [];
        const timingByIndex = {};
        (job?.result?.step_timings || []).forEach((t) => { timingByIndex[t.index] = t; });
        const current = job?.current_step || 0;
        return planSteps.map((s, i) => {
            const index = i + 1;
            const name = s.name || s.type || `Step ${index}`;
            let state;
            if (status === 'failed' && index === current) state = 'failed';
            else if (status === 'succeeded' || timingByIndex[index] || index < current) state = 'done';
            else if (index === current && status === 'running') state = 'running';
            else state = 'pending';
            return { index, name, state, seconds: timingByIndex[index]?.seconds };
        });
    }, [job, status]);

    const visibleLines = useMemo(() => {
        const q = search.trim().toLowerCase();
        return lines.filter((l) =>
            (level === 'all' || (l.level || 'info') === level)
            && (!q || (l.message || '').toLowerCase().includes(q))
        );
    }, [lines, level, search]);

    // Counts come from the unfiltered log: the point of "3 errors" is to be
    // true no matter which filter happens to be on.
    const { errorCount, warnCount } = useMemo(() => {
        let errors = 0;
        let warns = 0;
        lines.forEach((l) => {
            const lv = l.level || 'info';
            if (lv === 'error') errors += 1;
            else if (lv === 'warn' || lv === 'warning') warns += 1;
        });
        return { errorCount: errors, warnCount: warns };
    }, [lines]);

    // What prev/next steps through: search results when searching, otherwise
    // the errors. Searching already filters the pane, so every visible line is
    // a hit — the buttons walk them in order.
    const navTargets = useMemo(() => {
        const out = [];
        visibleLines.forEach((l, i) => {
            if (search.trim() || (l.level || 'info') === 'error') out.push(i);
        });
        return out;
    }, [visibleLines, search]);

    const navLabel = search.trim() ? 'matches' : (navTargets.length ? 'errors' : '');

    const goToNav = useCallback((delta) => {
        if (!navTargets.length) return;
        setNavPos((prev) => {
            const next = (prev + delta + navTargets.length) % navTargets.length;
            setScrollTarget({ index: navTargets[next], nonce: nonceRef.current++ });
            return next;
        });
        setFollow(false);
    }, [navTargets]);

    // A failed deploy opens on its first error rather than on the tail, which
    // is where the answer is and where a person would scroll to anyway. Once
    // per job, and never while the user is following a live run.
    useEffect(() => {
        if (status !== 'failed' || !visibleLines.length) return;
        if (autoJumpedRef.current === jobId) return;
        const firstError = visibleLines.findIndex((l) => (l.level || 'info') === 'error');
        if (firstError < 0) return;
        autoJumpedRef.current = jobId;
        setFollow(false);
        setNavPos(0);
        setScrollTarget({ index: firstError, nonce: nonceRef.current++ });
    }, [status, visibleLines, jobId]);

    const elapsedMs = useMemo(() => {
        if (!job?.started_at) return job?.created_at ? now - new Date(job.created_at).getTime() : 0;
        const end = job.completed_at ? new Date(job.completed_at).getTime() : now;
        return end - new Date(job.started_at).getTime();
    }, [job, now]);

    const copyLogs = useCallback(() => {
        const text = lines.map((l) => l.message).join('\n');
        copy(text);
    }, [lines, copy]);

    const downloadLogs = useCallback(() => {
        const text = lines.map((l) => {
            const ts = l.ts || l.created_at || '';
            return `${ts ? `[${ts}] ` : ''}${(l.level || 'info').toUpperCase()} ${l.message}`;
        }).join('\n');
        downloadBlob(text, `deploy-${jobId}.txt`);
    }, [lines, jobId]);

    const onStepClick = useCallback((index) => {
        setFollow(false);
        setSelectedStep(index);
        setScrollToStep(index);
        // reset so a repeat click on the same step re-triggers the effect
        setTimeout(() => setScrollToStep(null), 100);
    }, []);

    const onRetry = useCallback(async () => {
        setRetrying(true);
        try {
            const res = await api.retryDeploymentJob(jobId);
            if (res?.job_id) navigate(`/deployments/${res.job_id}`);
        } catch {
            setRetrying(false);
        }
    }, [jobId, navigate]);

    const meta = STATUS_META[status] || STATUS_META.pending;
    const StatusIcon = meta.icon;
    const failedStepName = status === 'failed'
        ? (job?.current_step_name || steps.find((s) => s.state === 'failed')?.name)
        : null;
    const appUrl = job?.result?.auto_domain?.url || null;
    const degraded = (status === 'running' || status === 'pending') && transport === 'poll';
    const sourceLabel = job ? sourceRef(job) : null;

    if (loading && !job) {
        return (
            <div className="sk-tabgroup__inner deploy-console deploy-console--loading">
                <Loader2 size={22} className="deploy-console__spin" />
                <span>{t('app.deployConsole.loadingDeployment', 'Loading deployment…')}</span>
            </div>
        );
    }

    if (error && !job) {
        return (
            <div className="sk-tabgroup__inner deploy-console deploy-console--error-page">
                <XCircle size={22} />
                <strong>{t('app.deployConsole.deploymentNotFound', 'Deployment not found')}</strong>
                <p>{error}</p>
                <Link to="/deployments" className="deploy-console__btn">
                    <ArrowLeft size={14} /> {t('app.deployConsole.backToDeployments', 'Back to deployments')}
                </Link>
            </div>
        );
    }

    return (
        // sk-tabgroup__inner: this page lives inside the Services tab group,
        // whose content region is full-bleed by design — the wrapper is what
        // supplies the max-width and padding every sibling tab already has.
        // Without it the console ran edge-to-edge with no gutters at all.
        <div className={`sk-tabgroup__inner deploy-console${logFocus ? ' deploy-console--focus' : ''}`}>
            <header className="deploy-console__header">
                <Link to="/deployments" className="deploy-console__back" title={t('app.deployConsole.backToDeployments', 'Back to deployments')}>
                    <ArrowLeft size={18} />
                </Link>
                <h1 className="deploy-console__title">{humanizeTitle(job)}</h1>
                <div className="deploy-console__meta">
                    {job?.kind === 'demo_deploy' && (
                        <span className="deploy-console__pill deploy-console__pill--demo" title={t('app.deployConsole.scriptedTestDeploymentNoRealResources', 'Scripted test deployment: no real resources were touched')}>
                            {t('app.deployConsole.simulated', 'Simulated')}
                        </span>
                    )}
                    <span className={`deploy-console__pill deploy-console__pill--${meta.cls}`}>
                        <StatusIcon size={14} className={status === 'running' ? 'deploy-console__spin' : ''} />
                        {meta.label}
                    </span>
                    {job?.total_steps > 0 && (
                        <span className="deploy-console__step-count">
                            step {Math.min(job.current_step || 0, job.total_steps)}/{job.total_steps}
                        </span>
                    )}
                    <span className="deploy-console__elapsed">{fmtElapsed(elapsedMs)}</span>
                </div>
            </header>

            {degraded && (
                <div className="deploy-console__degraded">
                    <WifiOff size={14} /> {t('app.deployConsole.liveUpdatesUnavailableRefreshingEvery2s', 'Live updates unavailable. Refreshing every 2s.')}
                </div>
            )}

            {status === 'pending' && (
                <div className="deploy-console__queued">
                    <Loader2 size={16} className="deploy-console__spin" /> {t('app.deployConsole.waitingForAWorkerToPick', 'Waiting for a worker to pick up this deployment…')}
                </div>
            )}

            {status === 'failed' && !logFocus && (
                <ErrorCard
                    failedStepName={failedStepName}
                    failureTail={job?.result?.failure_tail}
                    hint={job?.result?.hint}
                    errorMessage={job?.error_message}
                    onRetry={onRetry}
                    retrying={retrying}
                />
            )}

            {status === 'succeeded' && !logFocus && (
                <SuccessBanner
                    job={job}
                    appUrl={appUrl}
                    engineTarget={engineTarget}
                    armAutoReturn={watchedRun}
                />
            )}

            {!logFocus && (
                <PipelineStrip steps={steps} selected={selectedStep} onStepClick={onStepClick} />
            )}

            {!logFocus && (
                <div className="deploy-console__runmeta">
                    <span><b>{jobId}</b></span>
                    <span>trigger <b>{job?.trigger || 'manual'}</b></span>
                    {sourceLabel && <span>source <b>{sourceLabel}</b></span>}
                    <span>target <b>{job?.target_server_name || t('app.deployConsole.localServer', 'Local server')}</b></span>
                    <span>started <b>{fmtStarted(job?.started_at || job?.created_at)}</b></span>
                </div>
            )}

            <div className="deploy-console__body">
                <div className="deploy-console__main">
                    <ConsoleToolbar
                        follow={follow} onToggleFollow={() => setFollow((v) => !v)}
                        wrap={wrap} onToggleWrap={() => setWrap((v) => !v)}
                        timestamps={timestamps} onToggleTimestamps={() => setTimestamps((v) => !v)}
                        level={level} onLevelChange={setLevel}
                        search={search} onSearchChange={setSearch}
                        onCopy={copyLogs} onDownload={downloadLogs}
                        errorCount={errorCount} warnCount={warnCount}
                        navCount={navTargets.length} navPos={navPos} navLabel={navLabel}
                        onNavPrev={() => goToNav(-1)} onNavNext={() => goToNav(1)}
                        focused={logFocus} onToggleFocus={() => setLogFocus((v) => !v)}
                    />
                    <LogPane
                        lines={visibleLines}
                        wrap={wrap}
                        timestamps={timestamps}
                        follow={follow && isLive}
                        onFollowChange={setFollow}
                        scrollToStep={scrollToStep}
                        scrollTarget={scrollTarget}
                        stepNames={steps}
                    />
                </div>
            </div>
        </div>
    );
}
