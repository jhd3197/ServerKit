import { isTerminalRunStatus } from '../hooks/runStream.js';
import { t } from '../i18n/t.js';

// A Recipe waiting on a human handoff is still an active run. It belongs in
// the active list and the Needs attention filter, not buried in history.
const ACTIVE_STATUSES = new Set(['pending', 'running', 'waiting']);
const SECURITY_KIND = /^security[.]/;

const stringId = (value) => (value == null ? null : String(value));
const permissionFlag = (source, snakeKey, camelKey) => (
    source?.[snakeKey] == null ? source?.[camelKey] === true : source[snakeKey] === true
);

export function operationKey(operation) {
    return operation ? `${operation.runKind}:${operation.id}` : null;
}

export function isActiveOperation(operation) {
    return ACTIVE_STATUSES.has(operation?.status);
}

export function operationNeedsAttention(operation) {
    return operation?.status === 'failed'
        || operation?.requiresAction === true
        || operation?.needsAttention === true;
}

function normalizeProgress(source) {
    const candidate = source?.progress;
    const total = Number(candidate?.total ?? source?.total_steps ?? 0);
    const completed = Number(candidate?.completed ?? source?.current_step ?? 0);
    const explicitPercent = Number(candidate?.percent ?? source?.progress_percent);
    const percent = Number.isFinite(explicitPercent)
        ? explicitPercent
        : (total > 0 ? Math.round((completed / total) * 100) : 0);
    return {
        completed: Number.isFinite(completed) ? completed : 0,
        total: Number.isFinite(total) ? total : 0,
        percent: Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)),
    };
}

function jobTitle(job) {
    if (job.kind === 'backup.policy.run') return 'Backup policy run';
    if (job.kind === 'doctor.repair') return 'Doctor repair';
    if (job.kind === 'doctor.run' || job.kind === 'doctor.fleet.run') return 'Server doctor';
    if (SECURITY_KIND.test(job.kind || '')) return 'Security scan';
    return (job.kind || 'Background job').replaceAll('.', ' ');
}

function jobResource(job) {
    if (job.resource) return job.resource;
    if (!job.owner_type || job.owner_id == null) return null;
    return {
        type: job.owner_type,
        id: stringId(job.owner_id),
        label: `${String(job.owner_type).replaceAll('_', ' ')} ${job.owner_id}`,
        status: null,
        capabilities: [],
        scope: {},
    };
}

function deploymentResource(job) {
    if (job.resource) return job.resource;
    if (job.app_id != null) {
        return {
            type: 'app',
            id: stringId(job.app_id),
            label: job.app_name || t('app.operations.serviceFallback', 'Service {{id}}', { id: job.app_id }),
            status: null,
            capabilities: [],
            scope: {},
        };
    }
    if (job.target_server_id != null) {
        return {
            type: 'server',
            id: stringId(job.target_server_id),
            label: job.target_server_name || t('app.operations.serverFallback', 'Server {{id}}', { id: job.target_server_id }),
            status: null,
            capabilities: [],
            scope: {},
        };
    }
    return null;
}

function deploymentHandoff(job) {
    const candidates = [job?.handoff, job?.result?.handoff];
    return candidates.find((candidate) => (
        candidate !== null
        && typeof candidate === 'object'
        && !Array.isArray(candidate)
    )) || null;
}

export function normalizeDeploymentOperation(job) {
    if (!job?.id) return null;
    const target = job.app_name || job.target_server_name;
    const handoff = deploymentHandoff(job);
    return {
        id: stringId(job.id),
        runKind: 'deploy',
        kind: job.kind || 'deploy',
        status: job.status || 'pending',
        title: job.title || (target
            ? t('app.operations.deployTarget', 'Deploy {{target}}', { target })
            : t('app.operations.serviceDeployment', 'Service deployment')),
        resource: deploymentResource(job),
        progress: normalizeProgress(job),
        currentStepName: job.current_step_name || job.currentStepName || null,
        startedAt: job.started_at || job.startedAt || job.created_at || null,
        finishedAt: job.completed_at || job.finishedAt || null,
        updatedAt: job.updated_at || job.updatedAt || job.completed_at || job.started_at || job.created_at || null,
        error: job.error_message || job.error || null,
        // Deployment jobs currently expose retry but no cancel endpoint.
        canCancel: false,
        canRetry: permissionFlag(job, 'can_retry', 'canRetry'),
        requiresAction: permissionFlag(job, 'requires_action', 'requiresAction') || job.handoff === true,
        needsAttention: permissionFlag(job, 'needs_attention', 'needsAttention'),
        handoff,
        detailPath: job.detailPath || `/deployments/${encodeURIComponent(String(job.id))}`,
    };
}

export function normalizeJobOperation(job) {
    if (!job?.id) return null;
    return {
        id: stringId(job.id),
        runKind: 'job',
        kind: job.kind || 'job',
        status: job.status || 'pending',
        title: job.title || jobTitle(job),
        resource: jobResource(job),
        progress: normalizeProgress(job.result || job),
        currentStepName: job.current_step_name || job.currentStepName || null,
        startedAt: job.started_at || job.startedAt || job.created_at || null,
        finishedAt: job.completed_at || job.finishedAt || null,
        updatedAt: job.updated_at || job.updatedAt || job.completed_at || job.started_at || job.created_at || null,
        error: job.error_message || job.error || null,
        canCancel: permissionFlag(job, 'can_cancel', 'canCancel'),
        canRetry: permissionFlag(job, 'can_retry', 'canRetry'),
        requiresAction: permissionFlag(job, 'requires_action', 'requiresAction') || job.handoff === true,
        needsAttention: permissionFlag(job, 'needs_attention', 'needsAttention'),
        detailPath: job.detailPath || `/monitoring/jobs?focus=${encodeURIComponent(String(job.id))}`,
    };
}

export function normalizeOperations({ deployments = [], jobs = [] } = {}) {
    const normalized = [
        ...deployments.map(normalizeDeploymentOperation),
        ...jobs
            .filter((job) => !String(job?.kind || '').startsWith('deploy.'))
            .map(normalizeJobOperation),
    ].filter(Boolean);

    return normalized.sort((left, right) => (
        new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    ));
}

export function boundOperationHistory(operations, historyLimit = 25, retainedKey = null) {
    const active = operations.filter(isActiveOperation);
    const history = operations.filter((operation) => !isActiveOperation(operation)).slice(0, historyLimit);
    const retained = retainedKey
        ? operations.find((operation) => operationKey(operation) === retainedKey)
        : null;
    const combined = [...active, ...history, ...(retained ? [retained] : [])];
    return [...new Map(combined.map((operation) => [operationKey(operation), operation])).values()];
}

export function reconcileOperationStatus(operations, payload) {
    const runKind = payload?.run_kind;
    const runId = payload?.run_id;
    const status = payload?.status;
    if (!runKind || runId == null || !status) return { operations, attentionKey: null, matched: false };

    let attentionKey = null;
    let matched = false;
    const next = operations.map((operation) => {
        if (operation.runKind !== runKind || String(operation.id) !== String(runId)) return operation;
        matched = true;
        const merged = runKind === 'deploy'
            ? { ...operation, ...normalizeDeploymentOperation({ ...operation, ...status, id: runId }) }
            : { ...operation, ...normalizeJobOperation({ ...operation, ...status, id: runId }) };
        const becameFailure = operation.status !== 'failed' && merged.status === 'failed';
        const becameHandoff = !operationNeedsAttention(operation) && operationNeedsAttention(merged);
        if ((becameFailure && isTerminalRunStatus(merged.status)) || becameHandoff) {
            attentionKey = operationKey(merged);
        }
        return merged;
    });
    return { operations: next, attentionKey, matched };
}
