import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    ArrowUpRight,
    Clock3,
    KeyRound,
    ListRestart,
    RotateCcw,
    Square,
    SquareTerminal,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOperations } from '../contexts/OperationsContext';
import { useShellDock } from '../contexts/useShellDock.js';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { usePolling } from '../hooks/usePolling';
import { useShortcut } from '../hooks/useShortcut';
import api from '../services/api';
import { operationKey } from '../services/operations';
import { formatDuration } from '../utils/time';
import IconButton from './IconButton';
import FormField from './FormField';
import ShellDockTabs from './ShellDockTabs';
import Pill from './ds/Pill';
import { statusKind, statusLabel } from './ds/status';

const VIEWS = ['active', 'attention', 'history'];

function resourcePath(resource) {
    if (!resource) return null;
    if (resource.type === 'app' || resource.type === 'application') return `/services/${resource.id}`;
    if (resource.type === 'server') return `/servers/${resource.id}`;
    if (resource.type === 'backup_policy') return `/backups?focus=policy:${resource.id}`;
    return null;
}

function lineText(line) {
    if (typeof line === 'string') return line;
    return line?.message || line?.line || JSON.stringify(line);
}

function OperationProgress({ operation, t }) {
    const progress = operation.progress || {};
    const total = Math.max(0, Number(progress.total) || 0);
    const completed = Math.max(0, Number(progress.completed) || 0);
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const railSize = Math.min(total, 8);
    if (!total && !percent) return null;

    return (
        <div className="operations-dock__progress">
            <div className="operations-dock__progress-copy">
                <span>{operation.currentStepName || t('app.operationsDock.progress', 'Progress')}</span>
                <span>{total ? `${completed}/${total}` : `${percent}%`}</span>
            </div>
            <progress value={percent} max="100" aria-label={t('app.operationsDock.progress', 'Progress')} />
            {railSize > 1 && (
                <div className="operations-dock__step-rail" aria-hidden="true">
                    {Array.from({ length: railSize }, (_, index) => (
                        <span
                            key={index}
                            className={index < completed ? 'is-complete' : index === completed ? 'is-current' : ''}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function RecipeHandoffCard({ operation, onSubmitted, t }) {
    const handoff = operation.handoff;
    const input = handoff?.input || {};
    const [value, setValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const fieldId = `recipe-handoff-${operation.id}-${handoff?.step_id || 'input'}`;

    useEffect(() => {
        setValue('');
        setError(null);
        setSubmitting(false);
    }, [operation.id, handoff?.step_id]);

    if (!handoff || !operation.requiresAction) return null;

    const submit = async (event) => {
        event.preventDefault();
        if (!value.trim() || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            await api.submitRecipeHandoff(operation.id, handoff.step_id, value);
            setValue('');
            await onSubmitted();
        } catch (submitError) {
            setError(submitError?.message || t(
                'app.operationsDock.handoffFailed',
                'Could not submit this handoff',
            ));
        } finally {
            setSubmitting(false);
        }
    };

    const ttlMinutes = handoff.ttl_seconds
        ? Math.max(1, Math.ceil(handoff.ttl_seconds / 60))
        : null;

    return (
        <form className="operations-dock__handoff" onSubmit={submit}>
            <div className="operations-dock__handoff-head">
                <span className="operations-dock__handoff-icon"><KeyRound size={15} /></span>
                <div>
                    <span>{t('app.operationsDock.operatorHandoff', 'Operator handoff')}</span>
                    <strong>{handoff.title}</strong>
                </div>
            </div>
            {handoff.description && <p>{handoff.description}</p>}
            <FormField
                label={input.label || t('app.operationsDock.handoffValue', 'Required value')}
                htmlFor={fieldId}
                hint={input.help || (ttlMinutes
                    ? t(
                        'app.operationsDock.handoffExpiry',
                        'The {{count}}-minute clock starts when you submit.',
                        { count: ttlMinutes },
                    )
                    : null)}
                error={error}
                required
            >
                <Input
                    id={fieldId}
                    type={input.secret === false ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                />
            </FormField>
            <div className="operations-dock__handoff-actions">
                {input.url && (
                    <Button asChild type="button" variant="ghost" size="sm">
                        <a href={input.url} target="_blank" rel="noreferrer">
                            {t('app.operationsDock.openHandoffLink', 'Open required link')}
                            <ArrowUpRight size={13} />
                        </a>
                    </Button>
                )}
                <Button type="submit" size="sm" disabled={!value.trim() || submitting}>
                    {submitting
                        ? t('app.operationsDock.resumingRecipe', 'Resuming…')
                        : t('app.operationsDock.continueRecipe', 'Continue recipe')}
                </Button>
            </div>
        </form>
    );
}

function ServiceLogDetail({ session, lines, error, onClear, onClose, logRef, t }) {
    const source = session.logPath
        || (session.containerId != null ? `docker · ${String(session.containerId).slice(0, 12)}` : null)
        || session.appType;
    return (
        <div className="operations-dock__detail">
            <div className="operations-dock__detail-head">
                <div>
                    <span className="operations-dock__eyebrow">{t('app.operationsDock.serviceLogs', 'Service log session')}</span>
                    <h3>{session.name}</h3>
                </div>
                <Pill kind="green">{t('app.operationsDock.live', 'Live')}</Pill>
            </div>
            <div className="operations-dock__meta">
                <span><SquareTerminal size={13} /> {source}</span>
                <span>{t('app.operationsDock.lineCount', '{{count}} lines', { count: lines.length })}</span>
            </div>
            {error && (
                <div className="operations-dock__error">
                    <AlertTriangle size={15} /><span>{error}</span>
                </div>
            )}
            <div className="operations-dock__logs" ref={logRef}>
                {lines.length === 0 ? (
                    <span className="operations-dock__logs-empty">{t('app.logsDrawer.waitingForLogs', 'Waiting for logs…')}</span>
                ) : lines.slice(-250).map((line, index) => (
                    <div key={index} className="operations-dock__log-line">{line}</div>
                ))}
            </div>
            <footer className="operations-dock__footer operations-dock__footer--end">
                <Button type="button" variant="ghost" size="sm" onClick={onClear}>
                    {t('common.actions.clear', 'Clear')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                    {t('common.actions.close', 'Close')}
                </Button>
            </footer>
        </div>
    );
}

export default function OperationsDock({ hideLauncher = false, statusbarMode = false }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const {
        activeOperations,
        history,
        attentionOperations,
        selectedOperation,
        selectedLines,
        selectedTransport,
        selectedStreamError,
        logSession,
        serviceLines,
        serviceStreamError,
        clearServiceLines,
        closeLogSession,
        unreadKeys,
        unreadCount,
        collapsed,
        loading,
        refresh,
        openOperation,
        setCollapsed,
    } = useOperations();
    const { activeTab, expanded } = useShellDock();
    const [view, setView] = useState('active');
    const [now, setNow] = useState(Date.now());
    const logRef = useRef(null);

    usePolling(() => setNow(Date.now()), 1000, { enabled: !collapsed, immediate: false });

    const toggle = useCallback(() => {
        if (!collapsed) {
            setCollapsed(true);
            return;
        }
        if (logSession) setCollapsed(false);
        else if (!selectedOperation && activeOperations[0]) openOperation(activeOperations[0]);
        else setCollapsed(false);
    }, [collapsed, logSession, selectedOperation, activeOperations, openOperation, setCollapsed]);

    useShortcut({
        id: 'operations-dock-toggle',
        label: t('app.operationsDock.shortcutLabel', 'Toggle operations dock'),
        group: 'shell',
        keys: [{ key: 'o', ctrlOrMeta: true, shift: true }],
        handler: toggle,
    });
    useShortcut({
        id: 'operations-dock-close',
        label: t('app.operationsDock.collapse', 'Collapse operations dock'),
        group: 'overlays',
        keys: [{ key: 'Escape' }],
        enabled: !collapsed,
        priority: 50,
        allowInInput: true,
        handler: () => setCollapsed(true),
    });

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [selectedLines, serviceLines]);

    const rows = useMemo(() => {
        if (view === 'attention') return attentionOperations;
        if (view === 'history') return history;
        return activeOperations;
    }, [view, activeOperations, attentionOperations, history]);

    const elapsed = useMemo(() => {
        if (!selectedOperation?.startedAt) return null;
        const start = new Date(selectedOperation.startedAt).getTime();
        const finish = selectedOperation.finishedAt
            ? new Date(selectedOperation.finishedAt).getTime()
            : now;
        if (!Number.isFinite(start) || !Number.isFinite(finish)) return null;
        return formatDuration(Math.max(0, (finish - start) / 1000));
    }, [selectedOperation, now]);

    const cancelSelected = async () => {
        if (!selectedOperation?.canCancel) return;
        const accepted = await confirm({
            title: t('app.operationsDock.cancelTitle', 'Cancel operation?'),
            message: t('app.operationsDock.cancelMessage', 'The current step may finish before cancellation takes effect.'),
            confirmText: t('app.operationsDock.cancelOperation', 'Cancel operation'),
            variant: 'danger',
        });
        if (!accepted) return;
        try {
            if (selectedOperation.runKind === 'job') await api.cancelJob(selectedOperation.id);
            await refresh();
            toast.success(t('app.operationsDock.cancelQueued', 'Cancellation requested'));
        } catch (error) {
            toast.error(error?.message || t('app.operationsDock.actionFailed', 'Operation action failed'));
        }
    };

    const retrySelected = async () => {
        if (!selectedOperation?.canRetry) return;
        try {
            if (selectedOperation.runKind === 'deploy') await api.retryDeploymentJob(selectedOperation.id);
            else await api.retryJob(selectedOperation.id);
            await refresh();
            toast.success(t('app.operationsDock.retryQueued', 'Retry queued'));
        } catch (error) {
            toast.error(error?.message || t('app.operationsDock.actionFailed', 'Operation action failed'));
        }
    };

    const activeLabel = t('app.operationsDock.activeCount', '{{count}} active', {
        count: activeOperations.length,
    });

    // In statusbar mode the shell dock decides which console tab is visible;
    // outside it the legacy collapsed/launcher behaviour is untouched.
    const visible = statusbarMode ? activeTab === 'ops' : !collapsed;
    if (statusbarMode && !visible) return null;

    return (
        <div className={`operations-dock${statusbarMode ? ' operations-dock--statusbar' : ''}${visible ? ' is-open' : ' is-collapsed'}`}>
            {!visible ? (
                hideLauncher ? null : <Button
                    type="button"
                    className="operations-dock__launcher"
                    onClick={toggle}
                    aria-expanded="false"
                    aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
                    title={t('app.operationsDock.open', 'Open operations dock')}
                >
                    <Activity size={17} className={activeOperations.length ? 'is-active' : ''} />
                    <span>{t('app.operationsDock.title', 'Operations')}</span>
                    {activeOperations.length > 0 && <span className="operations-dock__launcher-count">{activeOperations.length}</span>}
                    {unreadCount > 0 && <span className="operations-dock__unread" aria-label={t('app.operationsDock.unreadCount', '{{count}} unread', { count: unreadCount })}>{unreadCount}</span>}
                </Button>
            ) : (
                <section
                    className={`operations-dock__panel${statusbarMode && expanded ? ' is-expanded' : ''}`}
                    aria-label={t('app.operationsDock.title', 'Operations')}
                >
                    <header className="operations-dock__header">
                        {statusbarMode ? (
                            <ShellDockTabs
                                controls={(
                                    <IconButton
                                        icon={<RotateCcw size={15} />}
                                        label={t('common.actions.refresh', 'Refresh')}
                                        onClick={refresh}
                                    />
                                )}
                            />
                        ) : (
                            <>
                                <div className="operations-dock__heading">
                                    <span className="operations-dock__icon"><Activity size={16} /></span>
                                    <div>
                                        <h2>{t('app.operationsDock.title', 'Operations')}</h2>
                                        <span>{activeLabel}</span>
                                    </div>
                                </div>
                                <div className="operations-dock__header-actions">
                                    <IconButton
                                        icon={<RotateCcw size={15} />}
                                        label={t('common.actions.refresh', 'Refresh')}
                                        onClick={refresh}
                                    />
                                    <IconButton
                                        icon={<X size={16} />}
                                        label={t('app.operationsDock.collapse', 'Collapse operations dock')}
                                        onClick={() => setCollapsed(true)}
                                    />
                                </div>
                            </>
                        )}
                    </header>

                    <div className="operations-dock__tabs" role="tablist">
                        {VIEWS.map((item) => {
                            const count = item === 'active'
                                ? activeOperations.length
                                : item === 'attention' ? attentionOperations.length : history.length;
                            const label = item === 'active'
                                ? t('app.operationsDock.active', 'Active')
                                : item === 'attention'
                                    ? t('app.operationsDock.needsAttention', 'Needs attention')
                                    : t('app.operationsDock.history', 'History');
                            return (
                                <Button
                                    key={item}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={view === item ? 'is-active' : ''}
                                    onClick={() => setView(item)}
                                    role="tab"
                                    aria-selected={view === item}
                                >
                                    {label}<span>{count}</span>
                                </Button>
                            );
                        })}
                    </div>

                    <div className="operations-dock__list" role="tabpanel">
                        {loading && rows.length === 0 ? (
                            <div className="operations-dock__empty">{t('common.state.loading', 'Loading')}</div>
                        ) : rows.length === 0 ? (
                            <div className="operations-dock__empty">
                                {view === 'active'
                                    ? t('app.operationsDock.noActive', 'No operations are running')
                                    : view === 'attention'
                                        ? t('app.operationsDock.noAttention', 'Nothing needs attention')
                                        : t('app.operationsDock.noHistory', 'No recent operations')}
                            </div>
                        ) : rows.map((operation) => {
                            const key = operationKey(operation);
                            const unread = unreadKeys.has(key);
                            return (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    key={key}
                                    className={`operations-dock__row${selectedOperation && operationKey(selectedOperation) === key ? ' is-selected' : ''}`}
                                    onClick={() => openOperation(operation)}
                                >
                                    <span className={`operations-dock__row-state operations-dock__row-state--${statusKind(operation.status)}`} />
                                    <span className="operations-dock__row-copy">
                                        <strong>{operation.title}</strong>
                                        <small>{operation.resource?.label || operation.kind}</small>
                                    </span>
                                    <Pill kind={statusKind(operation.status)}>{statusLabel(operation.status)}</Pill>
                                    {unread && <span className="operations-dock__row-unread" aria-hidden="true" />}
                                </Button>
                            );
                        })}
                    </div>

                    {logSession ? (
                        <ServiceLogDetail
                            session={logSession}
                            lines={serviceLines}
                            error={serviceStreamError}
                            onClear={clearServiceLines}
                            onClose={closeLogSession}
                            logRef={logRef}
                            t={t}
                        />
                    ) : selectedOperation ? (
                        <div className="operations-dock__detail">
                            <div className="operations-dock__detail-head">
                                <div>
                                    <span className="operations-dock__eyebrow">{selectedOperation.kind}</span>
                                    <h3>{selectedOperation.title}</h3>
                                </div>
                                <Pill kind={statusKind(selectedOperation.status)}>{statusLabel(selectedOperation.status)}</Pill>
                            </div>

                            <div className="operations-dock__meta">
                                {elapsed && <span><Clock3 size={13} /> {elapsed}</span>}
                                <span><SquareTerminal size={13} /> {selectedTransport === 'socket' ? t('app.operationsDock.live', 'Live') : t('app.operationsDock.polling', 'Polling')}</span>
                            </div>

                            <OperationProgress operation={selectedOperation} t={t} />

                            <RecipeHandoffCard
                                operation={selectedOperation}
                                onSubmitted={async () => {
                                    await refresh();
                                    toast.success(t(
                                        'app.operationsDock.recipeResumed',
                                        'Recipe resumed',
                                    ));
                                }}
                                t={t}
                            />

                            {(selectedOperation.error || selectedStreamError) && (
                                <div className="operations-dock__error">
                                    <AlertTriangle size={15} />
                                    <span>{selectedOperation.error || selectedStreamError}</span>
                                </div>
                            )}

                            <div className="operations-dock__logs" ref={logRef}>
                                {selectedLines.length === 0 ? (
                                    <span className="operations-dock__logs-empty">{t('app.operationsDock.waitingForLogs', 'Waiting for run logs…')}</span>
                                ) : selectedLines.slice(-250).map((line, index) => (
                                    <div key={line?.id ?? index} className={`operations-dock__log-line${line?.level ? ` is-${line.level}` : ''}`}>
                                        {lineText(line)}
                                    </div>
                                ))}
                            </div>

                            <footer className="operations-dock__footer">
                                <div className="operations-dock__footer-links">
                                    {resourcePath(selectedOperation.resource) && (
                                        <Button asChild variant="ghost" size="sm">
                                            <Link to={resourcePath(selectedOperation.resource)}>
                                                {selectedOperation.resource.label}<ArrowUpRight size={13} />
                                            </Link>
                                        </Button>
                                    )}
                                    <Button asChild variant="ghost" size="sm">
                                        <Link to={selectedOperation.detailPath}>
                                            {selectedOperation.runKind === 'deploy'
                                                ? t('app.deployPill.openTheDeployConsole', 'Open the deploy console')
                                                : t('app.operationsDock.openDetails', 'Open details')}<ArrowUpRight size={13} />
                                        </Link>
                                    </Button>
                                </div>
                                <div className="operations-dock__footer-actions">
                                    {selectedOperation.canRetry && (
                                        <Button type="button" variant="outline" size="sm" onClick={retrySelected}>
                                            <ListRestart size={14} /> {t('common.actions.retry', 'Retry')}
                                        </Button>
                                    )}
                                    {selectedOperation.canCancel && (
                                        <Button type="button" variant="destructive" size="sm" onClick={cancelSelected}>
                                            <Square size={13} /> {t('common.actions.cancel', 'Cancel')}
                                        </Button>
                                    )}
                                </div>
                            </footer>
                        </div>
                    ) : (
                        <div className="operations-dock__detail operations-dock__detail--empty">
                            <Activity size={22} />
                            <span>{t('app.operationsDock.selectOperation', 'Select an operation to inspect progress and logs')}</span>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
