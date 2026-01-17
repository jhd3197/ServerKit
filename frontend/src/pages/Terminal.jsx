import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Terminal = () => {
    const [activeTab, setActiveTab] = useState('logs');

    return (
        <div className="page terminal-page">
            <div className="page-header">
                <div>
                    <h1>Terminal & Logs</h1>
                    <p className="page-subtitle">View logs, manage processes and services</p>
                </div>
            </div>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    Log Files
                </button>
                <button
                    className={`tab ${activeTab === 'journal' ? 'active' : ''}`}
                    onClick={() => setActiveTab('journal')}
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="9" y1="9" x2="15" y2="9"/>
                        <line x1="9" y1="13" x2="15" y2="13"/>
                        <line x1="9" y1="17" x2="11" y2="17"/>
                    </svg>
                    System Journal
                </button>
                <button
                    className={`tab ${activeTab === 'processes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('processes')}
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="8" y1="21" x2="16" y2="21"/>
                        <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                    Processes
                </button>
                <button
                    className={`tab ${activeTab === 'services' ? 'active' : ''}`}
                    onClick={() => setActiveTab('services')}
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Services
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'logs' && <LogFilesTab />}
                {activeTab === 'journal' && <JournalTab />}
                {activeTab === 'processes' && <ProcessesTab />}
                {activeTab === 'services' && <ServicesTab />}
            </div>
        </div>
    );
};

const LogFilesTab = () => {
    const [logFiles, setLogFiles] = useState([]);
    const [selectedLog, setSelectedLog] = useState(null);
    const [logContent, setLogContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingContent, setLoadingContent] = useState(false);
    const [error, setError] = useState(null);
    const [lineCount, setLineCount] = useState(100);
    const [searchPattern, setSearchPattern] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const logViewerRef = useRef(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        loadLogFiles();
    }, []);

    useEffect(() => {
        if (autoRefresh && selectedLog) {
            intervalRef.current = setInterval(() => {
                loadLogContent(selectedLog, false);
            }, 3000);
        }
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [autoRefresh, selectedLog]);

    async function loadLogFiles() {
        try {
            const data = await api.getLogFiles();
            setLogFiles(data.logs || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function loadLogContent(logPath, showLoading = true) {
        if (showLoading) setLoadingContent(true);
        try {
            let data;
            if (searchPattern.trim()) {
                data = await api.searchLog(logPath, searchPattern, lineCount);
            } else {
                data = await api.readLog(logPath, lineCount);
            }
            setLogContent(data.content || data.lines?.join('\n') || 'No content');
            setSelectedLog(logPath);

            // Scroll to bottom
            if (logViewerRef.current) {
                logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
            }
        } catch (err) {
            setLogContent(`Error loading log: ${err.message}`);
        } finally {
            setLoadingContent(false);
        }
    }

    async function handleClearLog() {
        if (!selectedLog) return;
        if (!confirm(`Clear ${selectedLog}? This cannot be undone.`)) return;

        try {
            await api.clearLog(selectedLog);
            setLogContent('Log cleared.');
        } catch (err) {
            setError(err.message);
        }
    }

    function handleDownload() {
        if (!logContent) return;
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = selectedLog ? selectedLog.split('/').pop() : 'log.txt';
        a.click();
        URL.revokeObjectURL(url);
    }

    function getLogIcon(path) {
        if (path.includes('error')) return 'error';
        if (path.includes('access')) return 'access';
        if (path.includes('nginx')) return 'nginx';
        if (path.includes('mysql') || path.includes('postgres')) return 'database';
        return 'default';
    }

    function formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) {
            bytes /= 1024;
            i++;
        }
        return `${bytes.toFixed(1)} ${units[i]}`;
    }

    if (loading) {
        return <div className="loading">Loading log files...</div>;
    }

    return (
        <div className="logs-container">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            <div className="logs-layout">
                <div className="logs-sidebar">
                    <div className="sidebar-header">
                        <h3>Log Files</h3>
                        <button className="btn btn-secondary btn-sm" onClick={loadLogFiles}>
                            <svg viewBox="0 0 24 24" width="14" height="14">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </button>
                    </div>
                    <div className="log-files-list">
                        {logFiles.length === 0 ? (
                            <div className="empty-hint">No log files found</div>
                        ) : (
                            logFiles.map((log, index) => (
                                <div
                                    key={index}
                                    className={`log-file-item ${selectedLog === log.path ? 'active' : ''}`}
                                    onClick={() => loadLogContent(log.path)}
                                >
                                    <div className={`log-icon ${getLogIcon(log.path)}`}>
                                        <svg viewBox="0 0 24 24" width="16" height="16">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                            <polyline points="14 2 14 8 20 8"/>
                                        </svg>
                                    </div>
                                    <div className="log-file-info">
                                        <span className="log-file-name">{log.name}</span>
                                        <span className="log-file-path">{log.path}</span>
                                    </div>
                                    <span className="log-file-size">{formatFileSize(log.size)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="logs-viewer">
                    <div className="viewer-toolbar">
                        <div className="toolbar-left">
                            <div className="search-input">
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <circle cx="11" cy="11" r="8"/>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                                </svg>
                                <input
                                    type="text"
                                    value={searchPattern}
                                    onChange={(e) => setSearchPattern(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && selectedLog && loadLogContent(selectedLog)}
                                    placeholder="Search pattern..."
                                />
                            </div>
                            <select
                                value={lineCount}
                                onChange={(e) => setLineCount(parseInt(e.target.value))}
                                className="lines-select"
                            >
                                <option value={50}>50 lines</option>
                                <option value={100}>100 lines</option>
                                <option value={200}>200 lines</option>
                                <option value={500}>500 lines</option>
                                <option value={1000}>1000 lines</option>
                            </select>
                        </div>
                        <div className="toolbar-right">
                            <label className="auto-refresh-toggle">
                                <input
                                    type="checkbox"
                                    checked={autoRefresh}
                                    onChange={(e) => setAutoRefresh(e.target.checked)}
                                />
                                <span>Auto-refresh</span>
                            </label>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => selectedLog && loadLogContent(selectedLog)}
                                disabled={!selectedLog || loadingContent}
                            >
                                Refresh
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleDownload}
                                disabled={!logContent}
                            >
                                Download
                            </button>
                            <button
                                className="btn btn-danger btn-sm"
                                onClick={handleClearLog}
                                disabled={!selectedLog}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    <div className="log-content" ref={logViewerRef}>
                        {!selectedLog ? (
                            <div className="empty-viewer">
                                <svg viewBox="0 0 24 24" width="48" height="48">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                </svg>
                                <p>Select a log file to view its contents</p>
                            </div>
                        ) : loadingContent ? (
                            <div className="loading">Loading log content...</div>
                        ) : (
                            <pre>{logContent}</pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const JournalTab = () => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(false);
    const [unit, setUnit] = useState('');
    const [lineCount, setLineCount] = useState(100);
    const [priority, setPriority] = useState('');
    const [commonUnits] = useState([
        'nginx', 'apache2', 'mysql', 'mariadb', 'postgresql',
        'php-fpm', 'docker', 'sshd', 'cron', 'systemd'
    ]);

    async function loadJournalLogs() {
        setLoading(true);
        try {
            const data = await api.getJournalLogs(unit || null, lineCount);
            setLogs(data.content || data.logs || 'No logs available');
        } catch (err) {
            setLogs(`Error: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadJournalLogs();
    }, []);

    return (
        <div className="journal-container">
            <div className="journal-controls">
                <div className="control-group">
                    <label>Service/Unit</label>
                    <div className="input-with-suggestions">
                        <input
                            type="text"
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                            placeholder="All services"
                        />
                        <div className="quick-units">
                            {commonUnits.map(u => (
                                <button
                                    key={u}
                                    className={`unit-chip ${unit === u ? 'active' : ''}`}
                                    onClick={() => setUnit(unit === u ? '' : u)}
                                >
                                    {u}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="control-group">
                    <label>Lines</label>
                    <select value={lineCount} onChange={(e) => setLineCount(parseInt(e.target.value))}>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                        <option value={500}>500</option>
                    </select>
                </div>

                <div className="control-group">
                    <label>Priority</label>
                    <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                        <option value="">All</option>
                        <option value="0">Emergency</option>
                        <option value="1">Alert</option>
                        <option value="2">Critical</option>
                        <option value="3">Error</option>
                        <option value="4">Warning</option>
                        <option value="5">Notice</option>
                        <option value="6">Info</option>
                        <option value="7">Debug</option>
                    </select>
                </div>

                <button className="btn btn-primary" onClick={loadJournalLogs} disabled={loading}>
                    {loading ? 'Loading...' : 'Load Logs'}
                </button>
            </div>

            <div className="journal-viewer">
                <pre>{loading ? 'Loading journal logs...' : logs}</pre>
            </div>
        </div>
    );
};

const ProcessesTab = () => {
    const toast = useToast();
    const [processes, setProcesses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sortBy, setSortBy] = useState('cpu');
    const [limit, setLimit] = useState(50);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProcess, setSelectedProcess] = useState(null);

    useEffect(() => {
        loadProcesses();
    }, [sortBy, limit]);

    async function loadProcesses() {
        try {
            const data = await api.getProcesses(limit, sortBy);
            setProcesses(data.processes || []);
        } catch (err) {
            console.error('Failed to load processes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleKillProcess(pid, force = false) {
        const confirmMsg = force
            ? `Force kill process ${pid}? This may cause data loss.`
            : `Kill process ${pid}?`;
        if (!confirm(confirmMsg)) return;

        try {
            await api.killProcess(pid, force);
            toast.success(`Process ${pid} killed successfully`);
            loadProcesses();
            setSelectedProcess(null);
        } catch (err) {
            toast.error(`Failed to kill process: ${err.message}`);
        }
    }

    const filteredProcesses = processes.filter(p =>
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.command?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(p.pid).includes(searchTerm)
    );

    if (loading) {
        return <div className="loading">Loading processes...</div>;
    }

    return (
        <div className="processes-container">
            <div className="processes-toolbar">
                <div className="toolbar-left">
                    <div className="search-input">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search processes..."
                        />
                    </div>
                </div>
                <div className="toolbar-right">
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                        <option value="cpu">Sort by CPU</option>
                        <option value="memory">Sort by Memory</option>
                        <option value="pid">Sort by PID</option>
                        <option value="name">Sort by Name</option>
                    </select>
                    <select value={limit} onChange={(e) => setLimit(parseInt(e.target.value))}>
                        <option value={25}>25 processes</option>
                        <option value={50}>50 processes</option>
                        <option value={100}>100 processes</option>
                    </select>
                    <button className="btn btn-secondary btn-sm" onClick={loadProcesses}>
                        Refresh
                    </button>
                </div>
            </div>

            <div className="processes-table-wrapper">
                <table className="table processes-table">
                    <thead>
                        <tr>
                            <th>PID</th>
                            <th>Name</th>
                            <th>User</th>
                            <th>CPU %</th>
                            <th>Memory %</th>
                            <th>Memory</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredProcesses.map(process => (
                            <tr
                                key={process.pid}
                                className={selectedProcess?.pid === process.pid ? 'selected' : ''}
                                onClick={() => setSelectedProcess(process)}
                            >
                                <td className="mono">{process.pid}</td>
                                <td>
                                    <div className="process-name">
                                        <span>{process.name}</span>
                                    </div>
                                </td>
                                <td>{process.user}</td>
                                <td>
                                    <div className="usage-cell">
                                        <div
                                            className="usage-bar cpu"
                                            style={{ width: `${Math.min(process.cpu_percent || 0, 100)}%` }}
                                        />
                                        <span>{(process.cpu_percent || 0).toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td>
                                    <div className="usage-cell">
                                        <div
                                            className="usage-bar memory"
                                            style={{ width: `${Math.min(process.memory_percent || 0, 100)}%` }}
                                        />
                                        <span>{(process.memory_percent || 0).toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td>{formatMemory(process.memory_info?.rss)}</td>
                                <td>
                                    <span className={`badge badge-${getStatusClass(process.status)}`}>
                                        {process.status}
                                    </span>
                                </td>
                                <td>
                                    <div className="action-buttons">
                                        <button
                                            className="btn btn-secondary btn-xs"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleKillProcess(process.pid);
                                            }}
                                            title="Kill"
                                        >
                                            <svg viewBox="0 0 24 24" width="12" height="12">
                                                <line x1="18" y1="6" x2="6" y2="18"/>
                                                <line x1="6" y1="6" x2="18" y2="18"/>
                                            </svg>
                                        </button>
                                        <button
                                            className="btn btn-danger btn-xs"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleKillProcess(process.pid, true);
                                            }}
                                            title="Force Kill"
                                        >
                                            <svg viewBox="0 0 24 24" width="12" height="12">
                                                <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/>
                                                <line x1="15" y1="9" x2="9" y2="15"/>
                                                <line x1="9" y1="9" x2="15" y2="15"/>
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selectedProcess && (
                <div className="process-details-panel">
                    <div className="panel-header">
                        <h3>Process Details</h3>
                        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedProcess(null)}>
                            Close
                        </button>
                    </div>
                    <div className="panel-body">
                        <div className="details-grid">
                            <div className="detail-item">
                                <span className="detail-label">PID</span>
                                <span className="detail-value mono">{selectedProcess.pid}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Name</span>
                                <span className="detail-value">{selectedProcess.name}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">User</span>
                                <span className="detail-value">{selectedProcess.user}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Status</span>
                                <span className="detail-value">{selectedProcess.status}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">CPU</span>
                                <span className="detail-value">{(selectedProcess.cpu_percent || 0).toFixed(2)}%</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Memory</span>
                                <span className="detail-value">{formatMemory(selectedProcess.memory_info?.rss)}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Threads</span>
                                <span className="detail-value">{selectedProcess.num_threads}</span>
                            </div>
                            <div className="detail-item">
                                <span className="detail-label">Created</span>
                                <span className="detail-value">
                                    {selectedProcess.create_time
                                        ? new Date(selectedProcess.create_time * 1000).toLocaleString()
                                        : '-'}
                                </span>
                            </div>
                        </div>
                        {selectedProcess.command && (
                            <div className="command-line">
                                <span className="detail-label">Command</span>
                                <code>{selectedProcess.command}</code>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ServicesTab = () => {
    const toast = useToast();
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedService, setSelectedService] = useState(null);
    const [serviceLogs, setServiceLogs] = useState('');
    const [showLogsModal, setShowLogsModal] = useState(false);

    useEffect(() => {
        loadServices();
    }, []);

    async function loadServices() {
        try {
            const data = await api.getServicesStatus();
            setServices(data.services || []);
        } catch (err) {
            console.error('Failed to load services:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleServiceAction(serviceName, action) {
        setActionLoading(`${serviceName}-${action}`);
        try {
            await api.controlService(serviceName, action);
            toast.success(`Service ${serviceName} ${action}ed successfully`);
            await loadServices();
        } catch (err) {
            toast.error(`Failed to ${action} ${serviceName}: ${err.message}`);
        } finally {
            setActionLoading(null);
        }
    }

    async function viewServiceLogs(serviceName) {
        setSelectedService(serviceName);
        setShowLogsModal(true);
        try {
            const data = await api.getJournalLogs(serviceName, 100);
            setServiceLogs(data.content || data.logs || 'No logs available');
        } catch (err) {
            setServiceLogs(`Error loading logs: ${err.message}`);
        }
    }

    function getServiceStatusClass(status) {
        if (status === 'running' || status === 'active') return 'success';
        if (status === 'stopped' || status === 'inactive') return 'secondary';
        if (status === 'failed') return 'danger';
        return 'warning';
    }

    if (loading) {
        return <div className="loading">Loading services...</div>;
    }

    return (
        <div className="services-container">
            <div className="services-toolbar">
                <button className="btn btn-secondary btn-sm" onClick={loadServices}>
                    <svg viewBox="0 0 24 24" width="14" height="14">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    Refresh
                </button>
            </div>

            <div className="services-grid">
                {services.length === 0 ? (
                    <div className="empty-state">
                        <p>No services found</p>
                    </div>
                ) : (
                    services.map(service => (
                        <div key={service.name} className="service-card">
                            <div className="service-header">
                                <div className="service-info">
                                    <span className={`status-dot ${getServiceStatusClass(service.status)}`} />
                                    <h4>{service.name}</h4>
                                </div>
                                <span className={`badge badge-${getServiceStatusClass(service.status)}`}>
                                    {service.status}
                                </span>
                            </div>

                            {service.description && (
                                <p className="service-description">{service.description}</p>
                            )}

                            <div className="service-meta">
                                {service.pid && (
                                    <span className="meta-item">
                                        <span className="meta-label">PID:</span> {service.pid}
                                    </span>
                                )}
                                {service.memory && (
                                    <span className="meta-item">
                                        <span className="meta-label">Memory:</span> {service.memory}
                                    </span>
                                )}
                            </div>

                            <div className="service-actions">
                                {service.status === 'running' || service.status === 'active' ? (
                                    <>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleServiceAction(service.name, 'restart')}
                                            disabled={actionLoading === `${service.name}-restart`}
                                        >
                                            {actionLoading === `${service.name}-restart` ? '...' : 'Restart'}
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleServiceAction(service.name, 'stop')}
                                            disabled={actionLoading === `${service.name}-stop`}
                                        >
                                            {actionLoading === `${service.name}-stop` ? '...' : 'Stop'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => handleServiceAction(service.name, 'start')}
                                        disabled={actionLoading === `${service.name}-start`}
                                    >
                                        {actionLoading === `${service.name}-start` ? '...' : 'Start'}
                                    </button>
                                )}
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => viewServiceLogs(service.name)}
                                >
                                    Logs
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Service Logs Modal */}
            {showLogsModal && (
                <div className="modal-overlay" onClick={() => setShowLogsModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Logs: {selectedService}</h2>
                            <button className="modal-close" onClick={() => setShowLogsModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="modal-log-viewer">
                                <pre>{serviceLogs}</pre>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowLogsModal(false)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper functions
function formatMemory(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function getStatusClass(status) {
    switch (status?.toLowerCase()) {
        case 'running':
        case 'sleeping':
            return 'success';
        case 'stopped':
        case 'zombie':
            return 'danger';
        case 'idle':
        case 'disk-sleep':
            return 'warning';
        default:
            return 'secondary';
    }
}

export default Terminal;
