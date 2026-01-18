import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const Security = () => {
    const { isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState('overview');
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStatus();
    }, []);

    async function loadStatus() {
        try {
            const data = await api.getSecurityStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load security status:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="page"><div className="loading">Loading security status...</div></div>;
    }

    return (
        <div className="page security-page">
            <div className="page-header">
                <div>
                    <h1>Security</h1>
                    <p className="page-subtitle">Malware scanning, file integrity monitoring, and security alerts</p>
                </div>
            </div>

            <div className="tabs-nav">
                <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                    Overview
                </button>
                <button className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`} onClick={() => setActiveTab('scanner')}>
                    Malware Scanner
                </button>
                <button className={`tab-btn ${activeTab === 'quarantine' ? 'active' : ''}`} onClick={() => setActiveTab('quarantine')}>
                    Quarantine
                </button>
                <button className={`tab-btn ${activeTab === 'integrity' ? 'active' : ''}`} onClick={() => setActiveTab('integrity')}>
                    File Integrity
                </button>
                <button className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`} onClick={() => setActiveTab('events')}>
                    Security Events
                </button>
                <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                    Settings
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'overview' && <OverviewTab status={status} onRefresh={loadStatus} />}
                {activeTab === 'scanner' && <ScannerTab />}
                {activeTab === 'quarantine' && <QuarantineTab />}
                {activeTab === 'integrity' && <IntegrityTab />}
                {activeTab === 'events' && <EventsTab />}
                {activeTab === 'settings' && <SettingsTab />}
            </div>
        </div>
    );
};

const OverviewTab = ({ status, onRefresh }) => {
    const [clamavStatus, setClamavStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadClamavStatus();
    }, []);

    async function loadClamavStatus() {
        try {
            const data = await api.getClamAVStatus();
            setClamavStatus(data);
        } catch (err) {
            console.error('Failed to load ClamAV status:', err);
        } finally {
            setLoading(false);
        }
    }

    const alerts = status?.recent_alerts || {};

    return (
        <div className="security-overview">
            <div className="stats-grid">
                <div className={`stat-card ${alerts.total > 0 ? 'warning' : 'success'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{alerts.total || 0}</span>
                        <span className="stat-label">Alerts (24h)</span>
                    </div>
                </div>

                <div className={`stat-card ${alerts.malware_detections > 0 ? 'danger' : 'success'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{alerts.malware_detections || 0}</span>
                        <span className="stat-label">Malware Detected</span>
                    </div>
                </div>

                <div className={`stat-card ${clamavStatus?.installed ? 'success' : 'warning'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            {clamavStatus?.installed && <polyline points="9 12 12 15 16 10"/>}
                            {!clamavStatus?.installed && <line x1="15" y1="9" x2="9" y2="15"/>}
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{clamavStatus?.installed ? 'Active' : 'Not Installed'}</span>
                        <span className="stat-label">ClamAV Status</span>
                    </div>
                </div>

                <div className={`stat-card ${status?.scan_status === 'running' ? 'info' : 'default'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value" style={{ textTransform: 'capitalize' }}>{status?.scan_status || 'Idle'}</span>
                        <span className="stat-label">Scan Status</span>
                    </div>
                </div>
            </div>

            <div className="security-grid">
                <div className="card">
                    <div className="card-header">
                        <h3>ClamAV Antivirus</h3>
                        <button className="btn btn-sm btn-secondary" onClick={loadClamavStatus}>Refresh</button>
                    </div>
                    <div className="card-body">
                        {loading ? (
                            <div className="loading-sm">Loading...</div>
                        ) : clamavStatus?.installed ? (
                            <div className="info-list">
                                <div className="info-item">
                                    <span className="info-label">Version</span>
                                    <span className="info-value">{clamavStatus.version || 'Unknown'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Service</span>
                                    <span className={`badge ${clamavStatus.service_running ? 'badge-success' : 'badge-warning'}`}>
                                        {clamavStatus.service_running ? 'Running' : 'Stopped'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Last Definition Update</span>
                                    <span className="info-value">
                                        {clamavStatus.last_update ? new Date(clamavStatus.last_update).toLocaleString() : 'Unknown'}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="not-installed">
                                <p>ClamAV is not installed on this server.</p>
                                <InstallClamAVButton onInstalled={loadClamavStatus} />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>File Integrity Monitoring</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-list">
                            <div className="info-item">
                                <span className="info-label">Status</span>
                                <span className={`badge ${status?.file_integrity?.enabled ? 'badge-success' : 'badge-secondary'}`}>
                                    {status?.file_integrity?.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Database</span>
                                <span className={`badge ${status?.file_integrity?.database_exists ? 'badge-success' : 'badge-warning'}`}>
                                    {status?.file_integrity?.database_exists ? 'Initialized' : 'Not Initialized'}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Changes Detected (24h)</span>
                                <span className="info-value">{alerts.integrity_changes || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Notifications</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-list">
                            <div className="info-item">
                                <span className="info-label">Security Alerts</span>
                                <span className={`badge ${status?.notifications_enabled ? 'badge-success' : 'badge-secondary'}`}>
                                    {status?.notifications_enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                        </div>
                        <p className="help-text" style={{ marginTop: '1rem' }}>
                            Configure notification channels in Settings → Notifications to receive security alerts via Discord, Slack, or Telegram.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const InstallClamAVButton = ({ onInstalled }) => {
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState(null);

    async function handleInstall() {
        setInstalling(true);
        setError(null);
        try {
            await api.installClamAV();
            onInstalled();
        } catch (err) {
            setError(err.message);
        } finally {
            setInstalling(false);
        }
    }

    return (
        <div>
            <button className="btn btn-primary" onClick={handleInstall} disabled={installing}>
                {installing ? 'Installing...' : 'Install ClamAV'}
            </button>
            {error && <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </div>
    );
};

const ScannerTab = () => {
    const [scanStatus, setScanStatus] = useState({ status: 'idle' });
    const [scanPath, setScanPath] = useState('/var/www');
    const [scanning, setScanning] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [history, setHistory] = useState([]);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadScanStatus();
        loadHistory();
        const interval = setInterval(loadScanStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    async function loadScanStatus() {
        try {
            const data = await api.getScanStatus();
            setScanStatus(data);
        } catch (err) {
            console.error('Failed to load scan status:', err);
        }
    }

    async function loadHistory() {
        try {
            const data = await api.getScanHistory(20);
            setHistory(data.scans || []);
        } catch (err) {
            console.error('Failed to load scan history:', err);
        }
    }

    async function handleStartScan(type) {
        setScanning(true);
        setMessage(null);
        try {
            let result;
            if (type === 'quick') {
                result = await api.runQuickScan();
            } else if (type === 'full') {
                result = await api.runFullScan();
            } else {
                result = await api.scanDirectory(scanPath);
            }
            setMessage({ type: 'success', text: result.message });
            loadScanStatus();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setScanning(false);
        }
    }

    async function handleUpdateDefinitions() {
        setUpdating(true);
        setMessage(null);
        try {
            const result = await api.updateVirusDefinitions();
            setMessage({ type: result.success ? 'success' : 'error', text: result.message || result.error });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setUpdating(false);
        }
    }

    async function handleCancelScan() {
        try {
            await api.cancelScan();
            loadScanStatus();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    }

    const isScanning = scanStatus.status === 'running';

    return (
        <div className="scanner-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="scanner-actions card">
                <div className="card-header">
                    <h3>Malware Scanner</h3>
                    <button className="btn btn-sm btn-secondary" onClick={handleUpdateDefinitions} disabled={updating}>
                        {updating ? 'Updating...' : 'Update Definitions'}
                    </button>
                </div>
                <div className="card-body">
                    <div className="scan-options">
                        <div className="scan-preset">
                            <button
                                className="btn btn-primary btn-lg"
                                onClick={() => handleStartScan('quick')}
                                disabled={isScanning || scanning}
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
                                Quick Scan
                            </button>
                            <span className="scan-desc">Scan common web directories</span>
                        </div>

                        <div className="scan-preset">
                            <button
                                className="btn btn-secondary btn-lg"
                                onClick={() => handleStartScan('full')}
                                disabled={isScanning || scanning}
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="6"/>
                                    <circle cx="12" cy="12" r="2"/>
                                </svg>
                                Full Scan
                            </button>
                            <span className="scan-desc">Scan entire system (slow)</span>
                        </div>

                        <div className="scan-custom">
                            <label>Custom Path</label>
                            <div className="input-group">
                                <input
                                    type="text"
                                    value={scanPath}
                                    onChange={(e) => setScanPath(e.target.value)}
                                    placeholder="/path/to/scan"
                                    disabled={isScanning}
                                />
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleStartScan('custom')}
                                    disabled={isScanning || scanning || !scanPath}
                                >
                                    Scan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {isScanning && (
                <div className="card scan-progress">
                    <div className="card-header">
                        <h3>Scan in Progress</h3>
                        <button className="btn btn-sm btn-danger" onClick={handleCancelScan}>
                            Cancel
                        </button>
                    </div>
                    <div className="card-body">
                        <div className="progress-info">
                            <div className="spinner"></div>
                            <div>
                                <p><strong>Scanning:</strong> {scanStatus.directory}</p>
                                <p><strong>Started:</strong> {new Date(scanStatus.started_at).toLocaleString()}</p>
                                {scanStatus.files_scanned > 0 && (
                                    <p><strong>Files scanned:</strong> {scanStatus.files_scanned}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Scan History</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadHistory}>Refresh</button>
                </div>
                <div className="card-body">
                    {history.length === 0 ? (
                        <p className="text-muted">No scan history available.</p>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Directory</th>
                                    <th>Status</th>
                                    <th>Threats</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((scan, index) => (
                                    <tr key={index}>
                                        <td>{new Date(scan.started_at).toLocaleString()}</td>
                                        <td className="path-cell">{scan.directory}</td>
                                        <td>
                                            <span className={`badge badge-${scan.status === 'completed' ? 'success' : scan.status === 'error' ? 'danger' : 'warning'}`}>
                                                {scan.status}
                                            </span>
                                        </td>
                                        <td>
                                            {scan.infected_files?.length > 0 ? (
                                                <span className="badge badge-danger">{scan.infected_files.length} found</span>
                                            ) : (
                                                <span className="badge badge-success">Clean</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const QuarantineTab = () => {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadFiles();
    }, []);

    async function loadFiles() {
        try {
            const data = await api.getQuarantinedFiles();
            setFiles(data.files || []);
        } catch (err) {
            console.error('Failed to load quarantined files:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(filename) {
        if (!confirm(`Permanently delete ${filename}? This cannot be undone.`)) return;

        try {
            await api.deleteQuarantinedFile(filename);
            setMessage({ type: 'success', text: 'File deleted' });
            loadFiles();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    return (
        <div className="quarantine-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Quarantined Files</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadFiles}>Refresh</button>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-sm">Loading...</div>
                    ) : files.length === 0 ? (
                        <div className="empty-state">
                            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                <polyline points="9 12 12 15 16 10"/>
                            </svg>
                            <p>No files in quarantine</p>
                            <span className="text-muted">Infected files will appear here when detected</span>
                        </div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Filename</th>
                                    <th>Size</th>
                                    <th>Quarantined</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.map((file, index) => (
                                    <tr key={index}>
                                        <td className="path-cell">{file.name}</td>
                                        <td>{formatBytes(file.size)}</td>
                                        <td>{new Date(file.quarantined_at).toLocaleString()}</td>
                                        <td>
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() => handleDelete(file.name)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const IntegrityTab = () => {
    const [checking, setChecking] = useState(false);
    const [initializing, setInitializing] = useState(false);
    const [results, setResults] = useState(null);
    const [message, setMessage] = useState(null);

    async function handleInitialize() {
        if (!confirm('This will create a new baseline for file integrity monitoring. Continue?')) return;

        setInitializing(true);
        setMessage(null);
        try {
            const result = await api.initializeIntegrityDatabase();
            setMessage({ type: 'success', text: result.message });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setInitializing(false);
        }
    }

    async function handleCheck() {
        setChecking(true);
        setMessage(null);
        try {
            const result = await api.checkFileIntegrity();
            setResults(result);
            if (result.total_changes === 0) {
                setMessage({ type: 'success', text: 'No changes detected' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setChecking(false);
        }
    }

    return (
        <div className="integrity-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>File Integrity Monitoring</h3>
                </div>
                <div className="card-body">
                    <p className="description">
                        File integrity monitoring tracks changes to critical system files. Initialize a baseline database,
                        then periodically check for unauthorized modifications.
                    </p>

                    <div className="integrity-actions">
                        <button
                            className="btn btn-secondary"
                            onClick={handleInitialize}
                            disabled={initializing}
                        >
                            {initializing ? 'Initializing...' : 'Initialize Baseline'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleCheck}
                            disabled={checking}
                        >
                            {checking ? 'Checking...' : 'Check Integrity'}
                        </button>
                    </div>
                </div>
            </div>

            {results && results.total_changes > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h3>Changes Detected</h3>
                        <span className="badge badge-warning">{results.total_changes} changes</span>
                    </div>
                    <div className="card-body">
                        {results.changes.modified?.length > 0 && (
                            <div className="change-section">
                                <h4>Modified Files ({results.changes.modified.length})</h4>
                                <ul className="file-list">
                                    {results.changes.modified.map((file, i) => (
                                        <li key={i}>{file.path}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.changes.deleted?.length > 0 && (
                            <div className="change-section">
                                <h4>Deleted Files ({results.changes.deleted.length})</h4>
                                <ul className="file-list">
                                    {results.changes.deleted.map((file, i) => (
                                        <li key={i}>{file}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.changes.new?.length > 0 && (
                            <div className="change-section">
                                <h4>New Files ({results.changes.new.length})</h4>
                                <ul className="file-list">
                                    {results.changes.new.slice(0, 50).map((file, i) => (
                                        <li key={i}>{file}</li>
                                    ))}
                                    {results.changes.new.length > 50 && (
                                        <li className="text-muted">... and {results.changes.new.length - 50} more</li>
                                    )}
                                </ul>
                            </div>
                        )}

                        {results.changes.permission_changed?.length > 0 && (
                            <div className="change-section">
                                <h4>Permission Changes ({results.changes.permission_changed.length})</h4>
                                <ul className="file-list">
                                    {results.changes.permission_changed.map((file, i) => (
                                        <li key={i}>{file.path} ({file.old_mode} → {file.new_mode})</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const EventsTab = () => {
    const [events, setEvents] = useState([]);
    const [failedLogins, setFailedLogins] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadEvents();
        loadFailedLogins();
    }, []);

    async function loadEvents() {
        try {
            const data = await api.getSecurityEvents(50);
            setEvents(data.events || []);
        } catch (err) {
            console.error('Failed to load security events:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadFailedLogins() {
        try {
            const data = await api.getFailedLogins(24);
            setFailedLogins(data);
        } catch (err) {
            console.error('Failed to load failed logins:', err);
        }
    }

    function getEventIcon(type) {
        if (type.includes('malware')) {
            return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>;
        }
        if (type.includes('integrity')) {
            return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
        }
        return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    }

    return (
        <div className="events-tab">
            {failedLogins && (
                <div className={`card ${failedLogins.alert_triggered ? 'card-warning' : ''}`}>
                    <div className="card-header">
                        <h3>Failed Login Attempts (24h)</h3>
                        <button className="btn btn-sm btn-secondary" onClick={loadFailedLogins}>Refresh</button>
                    </div>
                    <div className="card-body">
                        <div className="failed-login-summary">
                            <span className={`count ${failedLogins.alert_triggered ? 'danger' : ''}`}>
                                {failedLogins.failed_attempts}
                            </span>
                            <span className="label">failed attempts (threshold: {failedLogins.threshold})</span>
                        </div>
                        {failedLogins.recent_failures?.length > 0 && (
                            <details className="recent-failures">
                                <summary>View recent failures</summary>
                                <pre>{failedLogins.recent_failures.join('\n')}</pre>
                            </details>
                        )}
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Security Events</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadEvents}>Refresh</button>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-sm">Loading...</div>
                    ) : events.length === 0 ? (
                        <p className="text-muted">No security events recorded.</p>
                    ) : (
                        <div className="events-list">
                            {events.map((event, index) => (
                                <div key={index} className={`event-item ${event.type}`}>
                                    <div className="event-icon">{getEventIcon(event.type)}</div>
                                    <div className="event-content">
                                        <span className="event-message">{event.message}</span>
                                        <span className="event-time">{new Date(event.timestamp).toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const SettingsTab = () => {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadConfig();
    }, []);

    async function loadConfig() {
        try {
            const data = await api.getSecurityConfig();
            setConfig(data);
        } catch (err) {
            console.error('Failed to load security config:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSecurityConfig(config);
            setMessage({ type: 'success', text: 'Settings saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    function updateConfig(section, key, value) {
        setConfig(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    }

    if (loading) {
        return <div className="loading-sm">Loading settings...</div>;
    }

    return (
        <div className="settings-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>ClamAV Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Enable ClamAV scanning</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.clamav?.enabled || false}
                                    onChange={(e) => updateConfig('clamav', 'enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Scan files on upload</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.clamav?.scan_on_upload || false}
                                    onChange={(e) => updateConfig('clamav', 'scan_on_upload', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label>Quarantine Path</label>
                        <input
                            type="text"
                            value={config?.clamav?.quarantine_path || '/var/quarantine'}
                            onChange={(e) => updateConfig('clamav', 'quarantine_path', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>File Integrity Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Enable file integrity monitoring</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.file_integrity?.enabled || false}
                                    onChange={(e) => updateConfig('file_integrity', 'enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Alert on file changes</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.file_integrity?.alert_on_change || false}
                                    onChange={(e) => updateConfig('file_integrity', 'alert_on_change', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>Notification Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on malware detection</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_malware_found || false}
                                    onChange={(e) => updateConfig('notifications', 'on_malware_found', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on integrity changes</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_integrity_change || false}
                                    onChange={(e) => updateConfig('notifications', 'on_integrity_change', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on suspicious activity</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_suspicious_activity || false}
                                    onChange={(e) => updateConfig('notifications', 'on_suspicious_activity', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>
                </div>
            </div>

            <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
};

export default Security;
