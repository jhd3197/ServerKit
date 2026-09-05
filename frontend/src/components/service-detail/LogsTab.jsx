import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { logsToText } from '@/utils/logText';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useLogsDrawer } from '../../contexts/LogsDrawerContext';
import DeploymentJobProgress from '../DeploymentJobProgress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/downloadBlob';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { parseStructuredLogLine } from '@/utils/structuredLog';

// Log tail refresh cadence while auto-refresh is on.
const LOG_REFRESH_MS = 5000;


const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'debug'];

const LogsTab = ({ app }) => {
    const { t } = useTranslation();
    const { openDrawer } = useLogsDrawer();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [rawLogs, setRawLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [levelFilter, setLevelFilter] = useState('all');
    const [lineCount, setLineCount] = useState(200);
    const [autoScroll, setAutoScroll] = useState(true);
    const logRef = useRef(null);
    // Live deploy tracking: seeded from the ?deploy_job=<id> query param
    // (set by the new-service wizard / template install), or discovered below
    // when a deploy is already pending/running for this app.
    const [deployJobId, setDeployJobId] = useState(() => searchParams.get('deploy_job'));
    const [deployError, setDeployError] = useState(null);

    const isDockerApp = app.app_type === 'docker';
    const isPythonApp = ['flask', 'django'].includes(app.app_type);

    useEffect(() => {
        loadLogs();
    }, [app.id, lineCount]);

    // No explicit ?deploy_job= param — check whether a deployment job is
    // currently pending/running for this app so a mid-deploy visit to the
    // Logs tab still shows live progress.
    useEffect(() => {
        if (deployJobId || !app?.id) return undefined;
        let cancelled = false;
        api.getDeploymentJobs({ appId: app.id, limit: 5 })
            .then((data) => {
                if (cancelled) return;
                const active = (data.jobs || []).find(
                    (j) => j.status === 'pending' || j.status === 'running'
                );
                if (active) setDeployJobId(active.id);
            })
            .catch(() => { /* non-fatal: container logs still work without it */ });
        return () => { cancelled = true; };
    }, [app?.id, deployJobId]);

    usePolling(loadLogs, LOG_REFRESH_MS, { enabled: autoRefresh, immediate: false });

    useEffect(() => {
        if (autoScroll && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [rawLogs, autoScroll]);

    async function loadLogs() {
        try {
            let data;
            if (isDockerApp) {
                data = await api.getDockerAppLogs(app.id, lineCount);
            } else if (isPythonApp) {
                data = await api.getPythonAppLogs(app.id, lineCount);
            } else {
                data = { logs: 'Logs not available for this app type.' };
            }
            setRawLogs(logsToText(data) || 'No logs available');
        } catch (err) {
            console.error('Failed to load logs:', err);
            setRawLogs('Failed to load logs');
        } finally {
            setLoading(false);
        }
    }

    function handleDeploySuccess() {
        setDeployJobId(null);
        setDeployError(null);
        // Drop the one-shot ?deploy_job= param so a refresh doesn't rewatch
        // a finished job.
        if (searchParams.has('deploy_job')) {
            const next = new URLSearchParams(searchParams);
            next.delete('deploy_job');
            setSearchParams(next, { replace: true });
        }
        toast.success(t('app.logsTab.deploymentFinishedSuccessfully', 'Deployment finished successfully'));
        loadLogs();
    }

    function handleDeployFailure(message) {
        const reason = message || 'Deployment failed';
        setDeployJobId(null);
        setDeployError(reason);
        toast.error(reason);
    }

    const filteredLines = useMemo(() => {
        if (!rawLogs) return [];
        let lines = rawLogs.split('\n').map(parseStructuredLogLine);

        if (levelFilter !== 'all') {
            lines = lines.filter(entry => {
                if (entry.level) return entry.level === levelFilter;
                const lower = entry.raw.toLowerCase();
                if (levelFilter === 'error') return lower.includes('error') || lower.includes('critical') || lower.includes('fatal');
                if (levelFilter === 'warn') return lower.includes('warn');
                if (levelFilter === 'info') return lower.includes('info');
                if (levelFilter === 'debug') return lower.includes('debug');
                return true;
            });
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            lines = lines.filter(entry => entry.searchable.toLowerCase().includes(term));
        }

        return lines;
    }, [rawLogs, searchTerm, levelFilter]);

    function getLineClass(entry) {
        if (entry.level) return `logs-viewer__line--${entry.level}`;
        const lower = entry.raw.toLowerCase();
        if (lower.includes('error') || lower.includes('critical') || lower.includes('fatal')) return 'logs-viewer__line--error';
        if (lower.includes('warn')) return 'logs-viewer__line--warn';
        if (lower.includes('debug') || lower.includes('trace')) return 'logs-viewer__line--debug';
        return '';
    }

    function handleDownload() {
        downloadBlob(rawLogs, `${app.name}-logs-${new Date().toISOString().slice(0, 10)}.txt`);
    }

    function handleCopy() {
        copyToClipboard(rawLogs);
    }

    const matchCount = searchTerm ? filteredLines.length : null;

    return (
        <div className="logs-tab-v2">
            {/* Live deploy progress (from repo create / template install) */}
            {deployJobId && (
                <div className="deploy-job-banner">
                    <h4 className="deploy-job-banner__title">{t('app.logsTab.deployingThisService', 'Deploying this service')}</h4>
                    <DeploymentJobProgress
                        jobId={deployJobId}
                        onSuccess={handleDeploySuccess}
                        onFailure={handleDeployFailure}
                    />
                </div>
            )}
            {deployError && (
                <div className="alert alert-danger">
                    <strong>{t('app.logsTab.deploymentFailed', 'Deployment failed:')}</strong> {deployError}
                </div>
            )}

            {/* Toolbar */}
            <div className="logs-toolbar">
                <div className="logs-toolbar__left">
                    <div className="logs-toolbar__search">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <Input
                            type="text"
                            placeholder={t('app.logsTab.searchLogs', 'Search logs…')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {matchCount !== null && (
                            <span className="logs-toolbar__match-count">{matchCount} matches</span>
                        )}
                    </div>
                    <select
                        className="logs-toolbar__select"
                        value={levelFilter}
                        onChange={(e) => setLevelFilter(e.target.value)}
                    >
                        {LOG_LEVELS.map(l => (
                            <option key={l} value={l}>
                                {l === 'all' ? 'All Levels' : l.charAt(0).toUpperCase() + l.slice(1)}
                            </option>
                        ))}
                    </select>
                    <select
                        className="logs-toolbar__select"
                        value={lineCount}
                        onChange={(e) => setLineCount(Number(e.target.value))}
                    >
                        <option value={100}>{t('app.logsTab.100Lines', '100 lines')}</option>
                        <option value={200}>{t('app.logsTab.200Lines', '200 lines')}</option>
                        <option value={500}>{t('app.logsTab.500Lines', '500 lines')}</option>
                        <option value={1000}>{t('app.logsTab.1000Lines', '1000 lines')}</option>
                    </select>
                </div>
                <div className="logs-toolbar__right">
                    <label className="logs-toolbar__toggle">
                        <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
                        <span>{t('app.logsTab.autoScroll', 'Auto-scroll')}</span>
                    </label>
                    <label className="logs-toolbar__toggle">
                        <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                        <span>{t('app.logsTab.live', 'Live')}</span>
                    </label>
                    <div className="logs-toolbar__divider" />
                    <Button variant="ghost" size="icon" onClick={handleCopy} title={t('app.logsTab.copyLogs', 'Copy logs')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={handleDownload} title={t('app.logsTab.downloadLogs', 'Download logs')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </Button>
                    <Button variant="ghost" size="icon" onClick={loadLogs} title={t('common.actions.refresh', 'Refresh')}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                    </Button>
                    <div className="logs-toolbar__divider" />
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDrawer({
                            name: app.name,
                            containerId: app.id,
                            logPath: app.log_path,
                            appType: app.app_type,
                        })}
                        title={t('app.logsTab.pinToDrawer', 'Open in Operations dock')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="17" x2="12" y2="22"/>
                            <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                        </svg>
                    </Button>
                </div>
            </div>

            {/* Log Source Hint */}
            <div className="logs-source-hint">
                {isPythonApp && 'Gunicorn / systemd logs'}
                {isDockerApp && 'Docker Compose logs'}
                {!isPythonApp && !isDockerApp && 'Application logs'}
                {autoRefresh && <span className="logs-source-hint__live">LIVE</span>}
            </div>

            {/* Log Viewer */}
            <div className="logs-viewer" ref={logRef}>
                {loading ? (
                    <div className="logs-viewer__loading">{t('app.logsTab.loadingLogs', 'Loading logs…')}</div>
                ) : filteredLines.length === 0 ? (
                    <div className="logs-viewer__empty">
                        {searchTerm || levelFilter !== 'all'
                            ? 'No log lines match your filters.'
                            : 'No logs available.'}
                    </div>
                ) : (
                    filteredLines.map((entry, i) => (
                        <div
                            key={`${i}-${entry.raw}`}
                            className={`logs-viewer__line ${entry.structured ? 'logs-viewer__line--structured' : ''} ${getLineClass(entry)}`}
                        >
                            <span className="logs-viewer__line-num">{i + 1}</span>
                            <div className="logs-viewer__line-text">
                                {entry.structured ? (
                                    <>
                                        {entry.timestamp && (
                                            <span className="logs-viewer__timestamp">{entry.timestamp}</span>
                                        )}
                                        <pre className="logs-viewer__json">
                                            {searchTerm
                                                ? highlightSearch(entry.formatted, searchTerm)
                                                : entry.formatted}
                                        </pre>
                                    </>
                                ) : (
                                    searchTerm ? highlightSearch(entry.raw, searchTerm) : entry.raw
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

function highlightSearch(text, term) {
    if (!term) return text;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
        regex.test(part)
            ? <mark key={i} className="logs-viewer__highlight">{part}</mark>
            : part
    );
}

export default LogsTab;
