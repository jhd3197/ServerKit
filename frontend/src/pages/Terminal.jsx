import { useState, useEffect, useRef, useMemo } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import ServerPicker from '../components/ServerPicker';
import { serverTarget, targetServerId } from '../utils/serverTarget';
import RemoteTerminal from '../components/RemoteTerminal';
import LogFileList from '../components/log-viewer/LogFileList';
import LogToolbar from '../components/log-viewer/LogToolbar';
import LogContent from '../components/log-viewer/LogContent';
import { formatBytes, logKindFromPath } from '../components/log-viewer/logHelpers';
import { formatBytes as formatMemory } from '@/utils/formatBytes';
import { Drawer } from '../components/ds';
import ProcessTable from '../components/ProcessTable';
import { procUser } from '../components/processData';
import SystemdServicesTab from '../components/serverdetail/ServicesTab';
import { useTableSort } from '@/hooks/useTableSort';
import PageLayout from '../layouts/PageLayout';
import { downloadBlob } from '@/utils/downloadBlob';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

// Log/journal tail cadence while auto-refresh is on.
const LOG_TAIL_MS = 3000;
// Process table cadence while auto-refresh is on.
const PROCESS_REFRESH_MS = 4000;

import {
    FileText, Clock, AlertCircle, Search, X, AlertTriangle, Activity,
    Terminal as TerminalIcon, Server as ServerIcon,
    ScrollText, Cpu, Settings,
} from 'lucide-react';
import { Button as SharedButton } from '@/components/ui/button';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { errorReason } from '@/utils/errorMessage';

// 'logs' stays first so the default landing keeps working on installs with no
// paired agents (the interactive shell needs a connected agent).
const VALID_TABS = ['logs', 'journal', 'processes', 'services', 'shell'];

// Section tabs rendered inline in the PageTopbar (Servers-style), routed via
// /terminal/<tab>. Log Files is the default landing (/terminal) — it needs no
// paired agent — so it's listed first, keeping the highlighted tab and the
// landing view in sync. The interactive Terminal sits next.
const TERMINAL_TABS = [
    { to: '/terminal', labelKey: 'app.terminal.logFiles', label: 'Log files', end: true, icon: <FileText size={15} /> },
    { to: '/terminal/shell', labelKey: 'app.terminal.terminal', label: 'Terminal', icon: <TerminalIcon size={15} /> },
    { to: '/terminal/journal', labelKey: 'app.terminal.systemJournal', label: 'System journal', icon: <ScrollText size={15} /> },
    { to: '/terminal/processes', labelKey: 'app.terminal.processes', label: 'Processes', icon: <Cpu size={15} /> },
    { to: '/terminal/services', labelKey: 'common.labels.services', label: 'Services', icon: <Settings size={15} /> },
];

const Terminal = () => {
    const [activeTab] = useTabParam('/terminal', VALID_TABS);

    return (
        // A full-bleed workspace, like the File Manager: the console panes fill
        // the content region edge-to-edge rather than floating as a rounded card
        // inside a padded well.
        <PageLayout
            fill
            className="terminal-page"
            contentClassName="tab-content"
            navLabel="Logs"
            tabs={TERMINAL_TABS}
        >
            {activeTab === 'shell' && <TerminalShellTab />}
            {activeTab === 'logs' && <LogFilesTab />}
            {activeTab === 'journal' && <JournalTab />}
            {activeTab === 'processes' && <ProcessesTab />}
            {activeTab === 'services' && <ServicesTab />}
        </PageLayout>
    );
};

// ─── Interactive shell tab (demo console: target rail + terminal pane) ───
// Sessions run over the ServerKit agent (terminal:create); the panel host has
// no PTY endpoint (§5 gap), so the rail lists paired agent servers only.
const TerminalShellTab = () => {
    const { t } = useTranslation();
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const list = await api.getAvailableServers();
                const eligible = Array.isArray(list)
                    ? list.filter(s => s.capabilities && s.capabilities.terminal)
                    : [];
                setServers(eligible);
                const firstOnline = eligible.find(s => s.status === 'online');
                if (firstOnline) setSelectedId(firstOnline.id);
            } catch (err) {
                console.error('Failed to load servers:', err);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const selected = servers.find(s => s.id === selectedId) || null;
    const anyOnline = servers.some(s => s.status === 'online');

    return (
        <div className="term-shell">
            <aside className="term-shell__rail" aria-label={t('app.terminal.terminalTargets', 'Terminal targets')}>
                <div className="term-shell__grp">{t('app.terminal.agentServers', 'Agent servers')}</div>
                {loading && <div className="term-shell__hint">{t('app.terminal.loadingServers', 'Loading servers…')}</div>}
                {!loading && servers.length === 0 && (
                    <div className="term-shell__hint">{t('app.terminal.noAgentServersWithShellAccess', 'No agent servers with shell access are paired yet.')}</div>
                )}
                {servers.map(s => {
                    const online = s.status === 'online';
                    return (
                        <SharedButton variant="unstyled"
                            key={s.id}
                            type="button"
                            className={`term-shell__row ${s.id === selectedId ? 'is-active' : ''}`}
                            onClick={() => setSelectedId(s.id)}
                            disabled={!online}
                            title={online ? t('app.terminal.openAShellOn', 'Open a shell on {{name}}', { name: s.name }) : `${s.name || s.id} is ${s.status || 'offline'}`}
                        >
                            <ServerIcon size={14} className="term-shell__ico" />
                            <span className="term-shell__name">{s.name || s.hostname || s.id}</span>
                            {s.ip_address && <span className="term-shell__sub">{s.ip_address}</span>}
                            <span className={`term-shell__dot ${online ? 'is-on' : ''}`} />
                        </SharedButton>
                    );
                })}
            </aside>
            <div className="term-shell__main">
                {selected ? (
                    <RemoteTerminal key={selected.id} serverId={selected.id} onClose={() => setSelectedId(null)} />
                ) : (
                    <div className="term-shell__empty">
                        <TerminalIcon size={26} />
                        <p>
                            {anyOnline
                                ? 'Pick a server on the left to open a shell.'
                                : 'Interactive shells run over the ServerKit agent. Pair a server (Servers → Add Server) with shell access and it will show up here.'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

const LOG_PREFS = {
    showLineNumbers: 'serverkit-logs-line-numbers',
    wrapLines: 'serverkit-logs-wrap',
    lineCount: 'serverkit-logs-line-count',
};

// Operations supported by the agent for remote targets. Only `read` is
// likely available today; everything else is panel-host-only until the
// matching agent verbs land. Mirrors the FileManager pattern.
const REMOTE_LOG_SUPPORTED = new Set(['list', 'read']);

const LogFilesTab = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';

    const [logFiles, setLogFiles] = useState([]);
    const [selectedLog, setSelectedLog] = useState(null);
    const [logContent, setLogContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);
    const [error, setError] = useState(null);
    // The file list's own failure, kept apart from `error` (which any action
    // can set) so the viewer never says "no log files" when it couldn't look.
    const [listError, setListError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const [lineCount, setLineCount] = useState(() => {
        const v = parseInt(localStorage.getItem(LOG_PREFS.lineCount), 10);
        return Number.isFinite(v) ? v : 200;
    });
    const [searchPattern, setSearchPattern] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem(LOG_PREFS.showLineNumbers) !== 'false');
    const [wrapLines, setWrapLines] = useState(() => localStorage.getItem(LOG_PREFS.wrapLines) !== 'false');
    const [isFullscreen, setIsFullscreen] = useState(false);

    const contentRef = useRef(null);
    const selectedLogObj = useMemo(
        () => logFiles.find((l) => l.path === selectedLog) || null,
        [logFiles, selectedLog]
    );

    useEffect(() => { localStorage.setItem(LOG_PREFS.showLineNumbers, showLineNumbers); }, [showLineNumbers]);
    useEffect(() => { localStorage.setItem(LOG_PREFS.wrapLines, wrapLines); }, [wrapLines]);
    useEffect(() => { localStorage.setItem(LOG_PREFS.lineCount, lineCount); }, [lineCount]);

    // Reset when the target changes (clears previous server's selection)
    useEffect(() => {
        setSelectedLog(null);
        setLogContent('');
        setAutoRefresh(false);
        loadLogFiles();
    }, [target.kind, target.server_id]); // eslint-disable-line react-hooks/exhaustive-deps

    usePolling(
        () => loadLogContent(selectedLog, false),
        LOG_TAIL_MS,
        { enabled: autoRefresh && Boolean(selectedLog), immediate: false },
    );

    function ensureSupported(op) {
        if (isRemote && !REMOTE_LOG_SUPPORTED.has(op)) {
            toast.error(t('app.terminal.thisActionIsnTAvailableOn', 'This action isn\'t available on remote targets yet.', {  }));
            return false;
        }
        return true;
    }

    async function loadLogFiles() {
        if (isRemote) {
            // No remote log-file listing yet — gracefully empty out so the
            // panel doesn't get confused with stale local entries.
            setLogFiles([]);
            setLoading(false);
            setError(`Remote log listing isn't available yet for ${target.name}.`);
            return;
        }
        setLoading(true);
        setError(null);
        setListError(null);
        try {
            const data = await api.getLogFiles();
            setLogFiles(data.logs || []);
        } catch (err) {
            setListError(err);
        } finally {
            setLoading(false);
        }
    }

    async function loadLogContent(logPath, showLoading = true) {
        if (showLoading) setLoadingContent(true);
        try {
            let data;
            if (appliedSearch.trim()) {
                data = await api.searchLog(logPath, appliedSearch, lineCount);
            } else {
                data = await api.readLog(logPath, lineCount);
            }
            setLogContent(data.content || data.lines?.join('\n') || '');
            setSelectedLog(logPath);
            setLastUpdated(new Date());

            if (autoRefresh && contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
        } catch (err) {
            setLogContent(`Error loading log: ${err.message}`);
        } finally {
            setLoadingContent(false);
        }
    }

    function handleSelectFile(log) {
        loadLogContent(log.path);
    }

    function handleSearchSubmit() {
        setAppliedSearch(searchPattern);
        if (selectedLog) {
            // Re-fetch with new search.
            (async () => {
                setLoadingContent(true);
                try {
                    const data = searchPattern.trim()
                        ? await api.searchLog(selectedLog, searchPattern, lineCount)
                        : await api.readLog(selectedLog, lineCount);
                    setLogContent(data.content || data.lines?.join('\n') || '');
                    setLastUpdated(new Date());
                } catch (err) {
                    setLogContent(`Error: ${err.message}`);
                } finally {
                    setLoadingContent(false);
                }
            })();
        }
    }

    function handleSearchClear() {
        setSearchPattern('');
        setAppliedSearch('');
        if (selectedLog) loadLogContent(selectedLog);
    }

    function scrollToBottom() {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }

    async function handleClearLog() {
        if (!ensureSupported('clear')) return;
        if (!selectedLog) return;
        const confirmed = await confirm({
            title: t('app.terminal.truncateLogFile', 'Truncate log file'),
            message: t('app.terminal.thisWillPermanentlyEmptyContinue', 'This will permanently empty {{selectedLog}}. Continue?', { selectedLog: selectedLog }),
            variant: 'danger',
            confirmText: t('app.terminal.truncate', 'Truncate'),
        });
        if (!confirmed) return;
        try {
            await api.clearLog(selectedLog);
            setLogContent('');
            toast.success(t('app.terminal.logFileTruncated', 'Log file truncated'));
            loadLogFiles();
        } catch (err) {
            toast.error(t('app.terminal.failed', 'Failed: {{message}}', { message: errorReason(err) }));
        }
    }

    function handleDownload() {
        if (!logContent) return;
        downloadBlob(logContent, selectedLog ? selectedLog.split('/').pop() : 'log.txt');
    }

    const visibleLineCount = useMemo(() => {
        if (!logContent) return 0;
        return logContent.split('\n').filter(Boolean).length;
    }, [logContent]);

    return (
        <div className={`lv-page ${isFullscreen ? 'fullscreen' : ''}`}>
            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">{t('common.labels.source', 'Source')}</span>
                    <ServerPicker
                        capability="logs"
                        value={targetServerId(target)}
                        onChange={(id, server) => setTarget(serverTarget(id, server))}
                    />
                    {isRemote && (
                        <span className="lv-header-hint">
                            <AlertCircle size={12} />
                            {t('app.terminal.readOnlyMostActionsRequirePanel', 'Read-only. Most actions require panel-host access.')}
                        </span>
                    )}
                </div>
                <div className="lv-header-stats">
                    {selectedLogObj && (
                        <>
                            <span className="lv-stat">
                                <FileText size={12} />
                                {selectedLogObj.name}
                            </span>
                            <span className="lv-stat-divider" />
                            <span className="lv-stat">
                                <span className="lv-stat-label">{t('common.labels.size', 'Size')}</span>
                                <span className="lv-stat-value">{formatBytes(selectedLogObj.size)}</span>
                            </span>
                            <span className="lv-stat">
                                <span className="lv-stat-label">{t('app.terminal.showing', 'Showing')}</span>
                                <span className="lv-stat-value">{visibleLineCount.toLocaleString()} lines</span>
                            </span>
                            {lastUpdated && (
                                <span className="lv-stat">
                                    <Clock size={12} />
                                    {lastUpdated.toLocaleTimeString()}
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="lv-error">
                    <AlertCircle size={14} />
                    <span>{error}</span>
                    <SharedButton variant="unstyled" type="button" onClick={() => setError(null)}>&times;</SharedButton>
                </div>
            )}

            <div className="lv-layout">
                <LogFileList
                    files={logFiles}
                    selectedPath={selectedLog}
                    onSelect={handleSelectFile}
                    onRefresh={loadLogFiles}
                    loading={loading}
                    error={listError}
                />

                <div className="lv-viewer">
                    {selectedLog && (
                        <div className="lv-viewer-path">
                            <span className={`lv-viewer-path-dot kind-${logKindFromPath(selectedLog)}`} />
                            <code>{selectedLog}</code>
                        </div>
                    )}

                    <LogToolbar
                        searchPattern={searchPattern}
                        onSearchChange={setSearchPattern}
                        onSearchSubmit={handleSearchSubmit}
                        onSearchClear={handleSearchClear}
                        lineCount={lineCount}
                        onLineCountChange={(n) => { setLineCount(n); if (selectedLog) setTimeout(() => loadLogContent(selectedLog), 0); }}
                        autoRefresh={autoRefresh}
                        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
                        showLineNumbers={showLineNumbers}
                        onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
                        wrapLines={wrapLines}
                        onToggleWrap={() => setWrapLines(!wrapLines)}
                        isFullscreen={isFullscreen}
                        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                        onRefresh={() => selectedLog && loadLogContent(selectedLog)}
                        onDownload={handleDownload}
                        onClear={handleClearLog}
                        onScrollToBottom={scrollToBottom}
                        canAct={!!selectedLog && !loadingContent}
                    />

                    <LogContent
                        ref={contentRef}
                        live={autoRefresh}
                        scrollKey={selectedLog}
                        content={selectedLog ? logContent : ''}
                        loading={loadingContent}
                        emptyMessage={
                            loading && logFiles.length === 0
                                ? t('app.terminal.loadingLogFiles', 'Loading log files…')
                            : listError && logFiles.length === 0
                                ? t('app.terminal.couldntLoadLogFiles', "Couldn't load the log files. Use Refresh in the list to try again.")
                            : isRemote && logFiles.length === 0
                                ? t('app.terminal.remoteLogBrowsingIsnTSupported', 'Remote log browsing isn\'t supported yet for {{name}}.', { name: target.name })
                                : logFiles.length === 0
                                    ? t('app.terminal.noLogFilesWereFoundOn', 'No log files were found on this server.')
                                    : t('app.terminal.selectALogFileFromThe', 'Select a log file from the list to view its contents.')
                        }
                        showLineNumbers={showLineNumbers}
                        wrapLines={wrapLines}
                        searchPattern={appliedSearch}
                    />
                </div>
            </div>
        </div>
    );
};

const COMMON_JOURNAL_UNITS = [
    { id: 'nginx', labelKey: 'app.terminal.nginx', label: 'Nginx', kind: 'nginx' },
    { id: 'apache2', labelKey: 'app.terminal.apache', label: 'Apache', kind: 'apache' },
    { id: 'mysql', labelKey: 'app.terminal.mysql', label: 'MySQL', kind: 'database' },
    { id: 'mariadb', labelKey: 'app.terminal.mariadb', label: 'MariaDB', kind: 'database' },
    { id: 'postgresql', labelKey: 'app.terminal.postgresql', label: 'PostgreSQL', kind: 'database' },
    { id: 'php-fpm', labelKey: 'app.terminal.phpFpm', label: 'PHP-FPM', kind: 'php' },
    { id: 'docker', labelKey: 'common.labels.docker', label: 'Docker', kind: 'default' },
    { id: 'sshd', label: 'SSH', kind: 'security' },
    { id: 'cron', labelKey: 'app.terminal.cron', label: 'Cron', kind: 'system' },
    { id: 'systemd', label: 'systemd', kind: 'system' },
    { id: 'fail2ban', label: 'fail2ban', kind: 'security' },
    { id: 'ufw', label: 'UFW', kind: 'security' },
];

const PRIORITY_OPTIONS = [
    { value: '', labelKey: 'common.labels.all', label: 'All' },
    { value: '0', labelKey: 'app.terminal.emergency', label: 'Emergency' },
    { value: '1', labelKey: 'app.terminal.alert', label: 'Alert' },
    { value: '2', labelKey: 'app.terminal.critical', label: 'Critical' },
    { value: '3', labelKey: 'app.terminal.error', label: 'Error' },
    { value: '4', labelKey: 'common.labels.warning', label: 'Warning' },
    { value: '5', labelKey: 'app.terminal.notice', label: 'Notice' },
    { value: '6', labelKey: 'common.labels.info', label: 'Info' },
    { value: '7', labelKey: 'app.terminal.debug', label: 'Debug' },
];

const JOURNAL_PREFS = {
    showLineNumbers: 'serverkit-journal-line-numbers',
    wrapLines: 'serverkit-journal-wrap',
    lineCount: 'serverkit-journal-line-count',
};

const REMOTE_JOURNAL_SUPPORTED = new Set([]);

const JournalTab = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';

    const [logContent, setLogContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [unavailable, setUnavailable] = useState(false);
    const [unit, setUnit] = useState('');
    const [unitInput, setUnitInput] = useState('');
    const [lineCount, setLineCount] = useState(() => {
        const v = parseInt(localStorage.getItem(JOURNAL_PREFS.lineCount), 10);
        return Number.isFinite(v) ? v : 200;
    });
    const [priority, setPriority] = useState('');
    const [source, setSource] = useState('');
    const [sourceLabel, setSourceLabel] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [searchPattern, setSearchPattern] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [showLineNumbers, setShowLineNumbers] = useState(() => localStorage.getItem(JOURNAL_PREFS.showLineNumbers) !== 'false');
    const [wrapLines, setWrapLines] = useState(() => localStorage.getItem(JOURNAL_PREFS.wrapLines) !== 'false');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [unitFilter] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);

    const contentRef = useRef(null);
    const isJournalctl = source === 'journalctl' || source === '';

    useEffect(() => { localStorage.setItem(JOURNAL_PREFS.showLineNumbers, showLineNumbers); }, [showLineNumbers]);
    useEffect(() => { localStorage.setItem(JOURNAL_PREFS.wrapLines, wrapLines); }, [wrapLines]);
    useEffect(() => { localStorage.setItem(JOURNAL_PREFS.lineCount, lineCount); }, [lineCount]);

    useEffect(() => {
        loadJournalLogs();
    }, [target.kind, target.server_id]); // eslint-disable-line react-hooks/exhaustive-deps

    usePolling(() => loadJournalLogs(false), LOG_TAIL_MS, {
        enabled: autoRefresh,
        immediate: false,
    });

    async function loadJournalLogs(showSpinner = true) {
        if (isRemote && !REMOTE_JOURNAL_SUPPORTED.has('read')) {
            setLogContent('');
            setSource('');
            setUnavailable(false);
            setLoading(false);
            return;
        }
        if (showSpinner) setLoading(true);
        setUnavailable(false);
        try {
            const data = await api.getJournalLogs(unit || null, lineCount);
            setLogContent(data.lines?.join('\n') || '');
            setSource(data.source || '');
            setSourceLabel(data.source_label || '');
            setLastUpdated(new Date());
            if (autoRefresh && contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
        } catch (err) {
            const msg = err.message || '';
            if (msg.includes('No system log source available') || msg.includes('unavailable')) {
                setUnavailable(true);
            } else {
                setLogContent(`Error: ${msg}`);
            }
        } finally {
            setLoading(false);
        }
    }

    function pickUnit(u) {
        setUnit(u);
        setUnitInput(u);
        setTimeout(() => loadJournalLogs(), 0);
    }

    function clearUnit() {
        setUnit('');
        setUnitInput('');
        setTimeout(() => loadJournalLogs(), 0);
    }

    function applyUnitInput() {
        setUnit(unitInput);
        setTimeout(() => loadJournalLogs(), 0);
    }

    function handleDownload() {
        if (!logContent) return;
        downloadBlob(logContent, `journal-${unit || 'all'}-${Date.now()}.log`);
    }

    function scrollToBottom() {
        if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }

    const filteredUnits = useMemo(() => {
        if (!unitFilter.trim()) return COMMON_JOURNAL_UNITS;
        const q = unitFilter.toLowerCase();
        return COMMON_JOURNAL_UNITS.filter(u => u.id.includes(q) || u.label.toLowerCase().includes(q));
    }, [unitFilter]);

    const visibleLineCount = useMemo(() => {
        if (!logContent) return 0;
        return logContent.split('\n').filter(Boolean).length;
    }, [logContent]);

    if (unavailable) {
        return (
            <div className="lv-page">
                <div className="lv-empty-hint is-tall">
                    <AlertCircle size={48} />
                    <h3 className="lv-empty-hint__title">{t('app.terminal.systemLogsUnavailable', 'System logs unavailable')}</h3>
                    <p>
                        {t('app.terminal.noSystemLogSourceWasFound', 'No system log source was found. Neither')} <code>journalctl</code>,
                        <code> /var/log/syslog</code>{t('app.terminal.norTheWindowsEventLogAre', ', nor the Windows Event Log are available.')}
                    </p>
                    <p>{t('app.terminal.useThe', 'Use the')} <strong>{t('app.terminal.logFiles', 'Log files')}</strong> {t('app.terminal.tabToBrowseAvailableLogFiles', 'tab to browse available log files instead.')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`lv-page ${isFullscreen ? 'fullscreen' : ''}`}>
            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">{t('common.labels.source', 'Source')}</span>
                    <ServerPicker
                        capability="logs"
                        value={targetServerId(target)}
                        onChange={(id, server) => setTarget(serverTarget(id, server))}
                    />
                    {isRemote && (
                        <span className="lv-header-hint">
                            <AlertCircle size={12} />
                            {t('app.terminal.remoteJournalIsnTAvailableYet', 'Remote journal isn\'t available yet for')} {target.name}.
                        </span>
                    )}
                    {!isJournalctl && source && (
                        <span className="lv-header-hint lv-header-hint--info">
                            <AlertCircle size={12} />
                            {t('app.terminal.readingFrom', 'Reading from')} <strong>&nbsp;{sourceLabel}</strong>
                        </span>
                    )}
                </div>
                <div className="lv-header-stats">
                    {unit && (
                        <span className="lv-stat">
                            <span className="lv-stat-label">{t('app.terminal.unit', 'Unit')}</span>
                            <span className="lv-stat-value">{unit}</span>
                        </span>
                    )}
                    <span className="lv-stat">
                        <span className="lv-stat-label">{t('app.terminal.showing', 'Showing')}</span>
                        <span className="lv-stat-value">{visibleLineCount.toLocaleString()} lines</span>
                    </span>
                    {lastUpdated && (
                        <span className="lv-stat">
                            <Clock size={12} />
                            {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            <div className="lv-layout">
                <div className="lv-sidebar">
                    <div className="lv-sidebar-header">
                        <div className="lv-search has-no-icon">
                            <input
                                type="text"
                                value={unitInput}
                                onChange={(e) => setUnitInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && applyUnitInput()}
                                placeholder={t('app.terminal.typeUnitName', 'Type unit name…')}
                            />
                        </div>
                        <SharedButton variant="unstyled" type="button" className="lv-icon-btn" onClick={applyUnitInput} title={t('app.terminal.applyUnitFilter', 'Apply unit filter')}>
                            <Search size={13} />
                        </SharedButton>
                    </div>

                    <div className="lv-sidebar-body">
                        <div className="lv-group">
                            <SharedButton variant="unstyled" type="button"
                                    className={`lv-file lv-file--compact ${!unit ? 'active' : ''}`}
                                    onClick={clearUnit}
                                >
                                <span className="lv-file-dot" />
                                <span className="lv-file-name">{t('app.terminal.allServices', 'All services')}</span>
                            </SharedButton>
                        </div>

                        <div className="lv-group">
                            <div className="lv-group-header is-static">
                                <span className="lv-group-header__spacer" />
                                <span>{t('app.terminal.commonUnits', 'Common units')}</span>
                                <span className="lv-group-count">{filteredUnits.length}</span>
                            </div>
                            <div className="lv-group-files">
                                {filteredUnits.map(u => (
                                    <SharedButton variant="unstyled" type="button"
                                        key={u.id}
                                        className={`lv-file lv-file--compact ${unit === u.id ? 'active' : ''}}`}
                                        onClick={() => pickUnit(u.id)}
                                    >
                                        <span className={`lv-file-dot kind-${u.kind}`} />
                                        <span className="lv-file-name">{u.label}</span>
                                    </SharedButton>
                                ))}
                                {filteredUnits.length === 0 && (
                                    <div className="lv-empty-hint is-compact">
                                        <p>{t('app.terminal.noMatchingUnits', 'No matching units.')}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {isJournalctl && (
                            <div className="lv-group">
                                <div className="lv-group-header is-static">
                                    <span className="lv-group-header__spacer" />
                                    <span>{t('app.terminal.priority', 'Priority')}</span>
                                </div>
                                <div className="lv-group-files">
                                    {PRIORITY_OPTIONS.map(opt => (
                                        <SharedButton variant="unstyled" type="button"
                                            key={opt.value}
                                            className={`lv-file lv-file--compact ${priority === opt.value ? 'active' : ''}`}
                                            onClick={() => { setPriority(opt.value); setTimeout(loadJournalLogs, 0); }}
                                        >
                                            <span className="lv-file-dot" style={{ background: priorityColor(opt.value) }} />
                                            <span className="lv-file-name">{opt.label}</span>
                                        </SharedButton>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="lv-viewer">
                    {unit && (
                        <div className="lv-viewer-path">
                            <span className="lv-viewer-path-dot kind-system" />
                            <code>{t('app.terminal.journalctlU', 'journalctl -u')} {unit}</code>
                        </div>
                    )}

                    <LogToolbar
                        searchPattern={searchPattern}
                        onSearchChange={setSearchPattern}
                        onSearchSubmit={() => setAppliedSearch(searchPattern)}
                        onSearchClear={() => { setSearchPattern(''); setAppliedSearch(''); }}
                        lineCount={lineCount}
                        onLineCountChange={(n) => { setLineCount(n); setTimeout(loadJournalLogs, 0); }}
                        autoRefresh={autoRefresh}
                        onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
                        showLineNumbers={showLineNumbers}
                        onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
                        wrapLines={wrapLines}
                        onToggleWrap={() => setWrapLines(!wrapLines)}
                        isFullscreen={isFullscreen}
                        onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                        onRefresh={() => loadJournalLogs()}
                        onDownload={handleDownload}
                        onClear={() => toast.error(t('app.terminal.journalLogsCannotBeTruncatedFrom', 'Journal logs cannot be truncated from the panel.'))}
                        onScrollToBottom={scrollToBottom}
                        canAct={!loading && !isRemote}
                    />

                    <LogContent
                        ref={contentRef}
                        live={autoRefresh}
                        scrollKey={unit || source}
                        content={logContent}
                        loading={loading}
                        emptyMessage={
                            isRemote
                                ? t('app.terminal.remoteJournalIsnTSupportedYet', 'Remote journal isn\'t supported yet for {{name}}.', { name: target.name })
                                : t('app.terminal.loadingJournal', 'Loading journal…')
                        }
                        showLineNumbers={showLineNumbers}
                        wrapLines={wrapLines}
                        searchPattern={appliedSearch}
                    />
                </div>
            </div>
        </div>
    );
};

// Journal priority dot tints — categorical, aligned to the redesign palette.
function priorityColor(value) {
    if (value === '0' || value === '1' || value === '2') return '#fb6f6f';
    if (value === '3') return '#fc8d8d';
    if (value === '4') return '#f5b945';
    if (value === '5' || value === '6') return '#49c7f0';
    if (value === '7') return '#9aa1af';
    return '#646b7a';
}

// Server-side page sizes for /processes. Not a table concern — the endpoint
// returns a top-N slice, so this decides what is fetched, not what is shown.
const PROCESS_LIMITS = [25, 50, 100, 250];

const ProcessesTab = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';

    const [processes, setProcesses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [limit, setLimit] = useState(100);
    const [selectedProcess, setSelectedProcess] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    // The table sorts client-side, but /processes answers with a TOP-N slice:
    // the top 100 by CPU re-sorted by memory is NOT the top 100 by memory. So
    // the sort lives here and the fetch follows whatever the table is showing.
    const { sorts, setSorts } = useTableSort({
        storageKey: 'serverkit-table-processes-sort',
        defaultSorts: [{ key: 'cpu', direction: 'desc' }],
    });
    const fetchSort = sorts[0]?.key === 'memory' ? 'memory' : 'cpu';


    useEffect(() => {
        loadProcesses();
    }, [fetchSort, limit, target.kind, target.server_id]); // eslint-disable-line

    usePolling(() => loadProcesses(false), PROCESS_REFRESH_MS, {
        enabled: autoRefresh,
        immediate: false,
    });

    async function loadProcesses(showSpinner = true) {
        if (isRemote) {
            setProcesses([]);
            setLoading(false);
            return;
        }
        if (showSpinner) setLoading(true);
        try {
            const data = await api.getProcesses(limit, fetchSort);
            setProcesses(data.processes || []);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Failed to load processes:', err);
            toast.error(t('app.terminal.failed', 'Failed: {{message}}', { message: errorReason(err) }));
        } finally {
            setLoading(false);
        }
    }

    // The list payload is a summary — no thread count, no resident bytes, no
    // command line. Ask for the full record when a row is opened so the drawer
    // shows answers instead of dashes.
    async function openProcess(p) {
        setSelectedProcess(p);
        try {
            const data = await api.getProcess(p.pid);
            const detail = data?.process;
            if (!detail) return;
            setSelectedProcess((prev) => (prev?.pid === p.pid ? {
                ...prev,
                ...detail,
                // psutil hands back an argv ARRAY; rendered raw React would
                // concatenate it without spaces.
                command: Array.isArray(detail.cmdline) ? detail.cmdline.join(' ') : prev.command,
            } : prev));
        } catch {
            /* the summary row is still worth showing */
        }
    }

    async function handleKillProcess(pid, force = false) {
        const confirmMsg = force
            ? `Force-kill PID ${pid}? Unsaved data may be lost.`
            : `Kill PID ${pid}?`;
        const confirmed = await confirm({
            title: force ? t('app.terminal.forceKillProcess', 'Force-kill process') : t('app.terminal.killProcess', 'Kill process'),
            message: confirmMsg,
            variant: force ? 'danger' : 'warning',
            confirmText: force ? t('app.terminal.forceKill', 'Force kill') : t('app.terminal.kill', 'Kill'),
        });
        if (!confirmed) return;
        try {
            await api.killProcess(pid, force);
            toast.success(t('app.terminal.pidKilled', 'PID {{pid}} killed', { pid: pid }));
            loadProcesses();
            setSelectedProcess(null);
        } catch (err) {
            toast.error(t('app.terminal.failed', 'Failed: {{message}}', { message: errorReason(err) }));
        }
    }

    const totalCpu = useMemo(() => processes.reduce((s, p) => s + (p.cpu_percent || 0), 0), [processes]);
    // Percent, not bytes: the list endpoint reports memory_percent and leaves
    // memory_info to the per-PID call, so a byte total here was always "0 B".
    const totalMem = useMemo(() => processes.reduce((s, p) => s + (p.memory_percent || 0), 0), [processes]);

    return (
        <div className="proc-page">
            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">{t('common.labels.source', 'Source')}</span>
                    <ServerPicker
                        capability="processes"
                        value={targetServerId(target)}
                        onChange={(id, server) => setTarget(serverTarget(id, server))}
                    />
                    {isRemote && (
                        <span className="lv-header-hint">
                            <AlertCircle size={12} />
                            {t('app.terminal.remoteProcessControlIsnTAvailable', 'Remote process control isn\'t available yet for')} {target.name}.
                        </span>
                    )}
                </div>
                {/* No process count here — DataTableFooter reports it, under
                    the rows it is counting. */}
                <div className="lv-header-stats">
                    <span className="lv-stat">
                        <span className="lv-stat-label">CPU</span>
                        <span className="lv-stat-value">{totalCpu.toFixed(1)}%</span>
                    </span>
                    <span className="lv-stat">
                        <span className="lv-stat-label">{t('common.labels.memory', 'Memory')}</span>
                        <span className="lv-stat-value">{totalMem.toFixed(1)}%</span>
                    </span>
                    {lastUpdated && (
                        <span className="lv-stat">
                            <Clock size={12} />
                            {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            {/* Only the FIRST load swaps the table out. This list auto-refreshes
                on a timer, and swapping on every `loading` tick unmounted the
                whole table — chrome, active view, column rules, sort and scroll
                position with it — then remounted a second later. */}
            {loading && processes.length === 0 ? (
                <div className="lv-content-loading">{t('app.terminal.loadingProcesses', 'Loading processes…')}</div>
            ) : (
                <ProcessTable
                    processes={processes}
                    selectedPid={selectedProcess?.pid ?? null}
                    onSelect={openProcess}
                    onKill={(p) => handleKillProcess(p.pid)}
                    onForceKill={(p) => handleKillProcess(p.pid, true)}
                    onRefresh={() => loadProcesses()}
                    formatMemory={formatMemory}
                    viewPageKey="terminal-processes"
                    sorts={sorts}
                    onSortsChange={setSorts}
                    actions={(
                        <>
                            <Select value={String(limit)} onValueChange={(v) => setLimit(parseInt(v, 10))}>
                                <SelectTrigger
                                    className="lv-select"
                                    title={t('app.terminal.processesToFetch', 'Processes to fetch')}
                                    aria-label={t('app.terminal.processesToFetch', 'Processes to fetch')}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROCESS_LIMITS.map((n) => (
                                        <SelectItem key={n} value={String(n)}>{t('app.terminal.top', 'Top')} {n}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <SharedButton variant="unstyled" type="button"
                                className={`lv-chip ${autoRefresh ? 'active' : ''}`}
                                onClick={() => setAutoRefresh(!autoRefresh)}
                                disabled={isRemote}
                            >
                                <span className={`lv-pulse ${autoRefresh ? 'on' : ''}`} />
                                <span>{t('app.terminal.live', 'Live')}</span>
                            </SharedButton>
                        </>
                    )}
                />
            )}

            {/* The shared DS drawer, not a hand-rolled slide-over: focus trap,
                escape-to-close and the same chrome as every other drawer. */}
            <Drawer
                open={!!selectedProcess}
                onOpenChange={(open) => { if (!open) setSelectedProcess(null); }}
                title={selectedProcess?.name || ''}
                subtitle={selectedProcess ? t('app.terminal.pid', 'PID {{pid}} · {{value}}', { pid: selectedProcess.pid, value: procUser(selectedProcess) }) : ''}
                icon={<Activity size={18} />}
                width={520}
                flush
            >
                {selectedProcess && (
                    <>
                        <div className="preview-drawer-meta">
                            <div className="meta-item">
                                <span className="meta-label">PID</span>
                                <span className="meta-value mono">{selectedProcess.pid}</span>
                            </div>
                            <div className="meta-item">
                                <span className="meta-label">{t('common.labels.user', 'User')}</span>
                                <span className="meta-value">{procUser(selectedProcess)}</span>
                            </div>
                            <div className="meta-item">
                                <span className="meta-label">{t('common.labels.status', 'Status')}</span>
                                <span className="meta-value">{selectedProcess.status}</span>
                            </div>
                            <div className="meta-item">
                                <span className="meta-label">{t('app.terminal.threads', 'Threads')}</span>
                                <span className="meta-value">{selectedProcess.num_threads ?? '—'}</span>
                            </div>
                            <div className="meta-item">
                                <span className="meta-label">CPU</span>
                                <span className="meta-value">{(selectedProcess.cpu_percent || 0).toFixed(2)}%</span>
                            </div>
                            <div className="meta-item">
                                <span className="meta-label">{t('common.labels.memory', 'Memory')}</span>
                                <span className="meta-value">{formatMemory(selectedProcess.memory_info?.rss)}</span>
                            </div>
                            <div className="meta-item meta-item-wide">
                                <span className="meta-label">{t('app.terminal.started', 'Started')}</span>
                                <span className="meta-value">
                                    {selectedProcess.create_time
                                        ? new Date(selectedProcess.create_time * 1000).toLocaleString()
                                        : '—'}
                                </span>
                            </div>
                        </div>
                        <div className="preview-drawer-actions">
                            <SharedButton variant="unstyled" type="button" className="drawer-action-btn" onClick={() => handleKillProcess(selectedProcess.pid)}>
                                <X size={14} /> {t('app.terminal.killSigterm', 'Kill (SIGTERM)')}
                            </SharedButton>
                            <SharedButton variant="unstyled" type="button" className="drawer-action-btn danger" onClick={() => handleKillProcess(selectedProcess.pid, true)}>
                                <AlertTriangle size={14} /> {t('app.terminal.forceKillSigkill', 'Force kill (SIGKILL)')}
                            </SharedButton>
                        </div>
                        <div className="preview-drawer-body is-padded">
                            {selectedProcess.command && (
                                <>
                                    <div className="meta-label is-spaced">{t('common.labels.command', 'Command')}</div>
                                    <pre className="proc-command">{selectedProcess.command}</pre>
                                </>
                            )}
                        </div>
                    </>
                )}
            </Drawer>
        </div>
    );
};

// Services renders the SAME converged systemd table Server Detail does — the
// only thing this tab adds is the choice of which host answers, and that choice
// is what the component's `serverId` already meant. Remounting on it keeps one
// host's unit list, search and view state from bleeding into the other's.
const ServicesTab = () => {
    const { t } = useTranslation();
    const [target, setTarget] = useState({ kind: 'local' });

    return (
        <div className="svc-page">
            <div className="lv-header">
                <div className="lv-header-target">
                    <span className="lv-header-label">{t('common.labels.source', 'Source')}</span>
                    <ServerPicker
                        capability="services"
                        value={targetServerId(target)}
                        onChange={(id, server) => setTarget(serverTarget(id, server))}
                    />
                </div>
            </div>
            <SystemdServicesTab
                key={target.server_id || 'local'}
                serverId={target.kind === 'agent' ? target.server_id : null}
            />
        </div>
    );
};

export default Terminal;
