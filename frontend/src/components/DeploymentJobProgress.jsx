import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import useDeployJobStream from '../hooks/useDeployJobStream';
import { useTranslation } from 'react-i18next';

// Shared "watch it come up live" compact panel: streams a DeploymentJob (socket
// with an after_id poll fallback, via useDeployJobStream) and renders its
// status, progress bar, current step and a log tail. Used by the Templates
// install modal and the service Logs tab so every deploy flow behaves the same.
// The full-page Deploy Console (/deployments/:jobId) is the richer view; this
// widget links to it via "Open console →".
//
// Terminal handling (unchanged contract):
// - status 'succeeded'  -> onSuccess(job)
// - status 'failed'     -> onFailure(job.error_message)
// - timeoutMs elapsed   -> onFailure('timed out' message)
export default function DeploymentJobProgress({
    jobId,
    onSuccess,
    onFailure,
    timeoutMs = 600000,
    showConsoleLink = true,
}) {
    const { t } = useTranslation();
    const { job, lines, error } = useDeployJobStream(jobId);

    // Keep callbacks in refs so a re-rendering parent doesn't re-fire them.
    const onSuccessRef = useRef(onSuccess);
    const onFailureRef = useRef(onFailure);
    onSuccessRef.current = onSuccess;
    onFailureRef.current = onFailure;
    const firedRef = useRef(false);

    // Fire the terminal callback exactly once.
    useEffect(() => {
        if (!job || firedRef.current) return;
        if (job.status === 'succeeded') {
            firedRef.current = true;
            onSuccessRef.current?.(job);
        } else if (job.status === 'failed') {
            firedRef.current = true;
            onFailureRef.current?.(job.error_message || 'Deployment failed');
        }
    }, [job]);

    // Hard timeout guard, mirroring the old widget so a job that never reaches a
    // terminal state doesn't spin forever.
    useEffect(() => {
        if (!jobId) return undefined;
        const t = setTimeout(() => {
            if (firedRef.current) return;
            firedRef.current = true;
            const minutes = Math.round(timeoutMs / 60000);
            onFailureRef.current?.(
                `Deployment timed out after ${minutes} minutes without reaching a final state`
            );
        }, timeoutMs);
        return () => clearTimeout(t);
    }, [jobId, timeoutMs]);

    const status = job?.status || 'pending';
    const progress = job?.progress_percent ?? 0;

    return (
        <div className="deployment-job-progress">
            <div className="deployment-progress">
                <div className="deployment-progress-track">
                    <div
                        className="deployment-progress-fill"
                        style={{ width: `${progress}%` }}
                    />
                </div>
                <span>{status} {progress}%</span>
            </div>
            {job?.current_step_name && (
                <p className="deployment-job-progress__step text-muted">
                    {t('app.deploymentJobProgress.currentStep', 'Current step:')} {job.current_step_name}
                </p>
            )}
            {error && (
                <div className="alert alert-warning">
                    {t('app.deploymentJobProgress.troubleReachingJobRetrying', 'Trouble reaching the deployment job: {{error}}. Retrying…', { error })}
                </div>
            )}
            <pre className="log-viewer">
                {lines.map(log => {
                    const prefix = log.step_index ? `[${log.step_index}] ` : '';
                    return `${prefix}${log.message}`;
                }).join('\n') || t('app.deploymentJobProgress.waitingForLogs', 'Waiting for deployment logs…')}
            </pre>
            {showConsoleLink && jobId && (
                <Link to={`/deployments/${jobId}`} className="deployment-job-progress__console-link">
                    {t('app.deploymentJobProgress.openConsole', 'Open console →')}
                </Link>
            )}
        </div>
    );
}
