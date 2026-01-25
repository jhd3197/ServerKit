import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Container, Globe, Package, FileText, RefreshCw, Square, Play, Settings, Trash2, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Applications = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [apps, setApps] = useState([]);
    const [appStats, setAppStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [showStopped, setShowStopped] = useState(true);
    const [selectedApp, setSelectedApp] = useState(null);
    const [stats, setStats] = useState({
        total: 0,
        running: 0,
        stopped: 0,
        docker: 0
    });

    useEffect(() => {
        loadApps();
    }, []);

    async function loadApps() {
        setLoading(true);
        try {
            const data = await api.getApps();
            // Filter out WordPress apps - they have their own dedicated page at /wordpress
            const appList = (data.apps || []).filter(a => a.app_type !== 'wordpress');
            setApps(appList);

            // Calculate stats
            const running = appList.filter(a => a.status === 'running').length;
            const docker = appList.filter(a => a.app_type === 'docker').length;
            setStats({
                total: appList.length,
                running,
                stopped: appList.length - running,
                docker
            });

            // Load resource stats for running Docker apps (via container stats)
            const runningDockerApps = appList.filter(a => a.status === 'running' && a.app_type === 'docker');
            const statsPromises = runningDockerApps.map(async (app) => {
                try {
                    // Try to get container stats using app name as container reference
                    const containersData = await api.getContainers(false).catch(() => ({ containers: [] }));
                    const appContainer = containersData.containers?.find(c =>
                        c.name?.includes(app.name) || c.name?.includes(app.id)
                    );
                    if (appContainer) {
                        const statsData = await api.getContainerStats(appContainer.id).catch(() => null);
                        if (statsData?.stats) {
                            const cpuStr = statsData.stats.CPUPerc || '0%';
                            const memStr = statsData.stats.MemPerc || '0%';
                            return {
                                id: app.id,
                                stats: {
                                    cpu_percent: parseFloat(cpuStr.replace('%', '')) || 0,
                                    memory_percent: parseFloat(memStr.replace('%', '')) || 0
                                }
                            };
                        }
                    }
                    return { id: app.id, stats: null };
                } catch {
                    return { id: app.id, stats: null };
                }
            });

            const statsResults = await Promise.all(statsPromises);
            const statsMap = {};
            statsResults.forEach(({ id, stats }) => {
                if (stats) statsMap[id] = stats;
            });
            setAppStats(statsMap);
        } catch (err) {
            console.error('Failed to load apps:', err);
            toast.error('Failed to load applications');
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(appId, action) {
        try {
            if (action === 'start') {
                await api.startApp(appId);
                toast.success('Application started');
            } else if (action === 'stop') {
                await api.stopApp(appId);
                toast.success('Application stopped');
            } else if (action === 'restart') {
                await api.restartApp(appId);
                toast.success('Application restarted');
            } else if (action === 'delete') {
                if (!confirm('Delete this application? This action cannot be undone.')) return;
                await api.deleteApp(appId);
                toast.success('Application deleted');
            }
            loadApps();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
            toast.error(err.message || `Failed to ${action} application`);
        }
    }

    function getStackColor(type) {
        const colors = {
            'php': '#a78bfa',
            'wordpress': '#21759b',
            'flask': '#fcd34d',
            'django': '#34d399',
            'docker': '#2496ed',
            'static': '#60a5fa',
        };
        return colors[type] || '#a1a1aa';
    }

    const filteredApps = apps.filter(app => {
        if (!showStopped && app.status !== 'running') return false;
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return app.name?.toLowerCase().includes(search) ||
               app.app_type?.toLowerCase().includes(search);
    });

    if (loading) {
        return <div className="docker-loading">Loading applications...</div>;
    }

    return (
        <div className="docker-page-new">
            <div className="docker-page-header">
                <div className="docker-page-title">
                    <h2>Applications</h2>
                    <div className="docker-page-subtitle">Manage your web applications and services</div>
                </div>
                <div className="docker-page-actions">
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} /> New Application
                    </button>
                </div>
            </div>

            <div className="docker-stats-row">
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Applications</div>
                    <div className="docker-stat-value">{stats.total}</div>
                    <div className="docker-stat-meta">
                        <span className="docker-stat-running">{stats.running} Running</span>
                        <span className="docker-stat-stopped">{stats.stopped} Stopped</span>
                    </div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Docker Apps</div>
                    <div className="docker-stat-value">{stats.docker}</div>
                    <div className="docker-stat-meta">Container-based</div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Running</div>
                    <div className="docker-stat-value">{stats.running}</div>
                    <div className="docker-stat-meta">Active services</div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Stopped</div>
                    <div className="docker-stat-value">{stats.stopped}</div>
                    <div className="docker-stat-meta">Inactive</div>
                </div>
            </div>

            <div className="docker-panel">
                <div className="docker-panel-header">
                    <div className="docker-panel-tabs">
                        <div className="docker-panel-tab active">All Applications</div>
                    </div>
                    <div className="docker-panel-actions">
                        <button className="btn btn-secondary btn-sm" onClick={loadApps}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                    </div>
                </div>

                <div className="docker-panel-content">
                    <div className="docker-table-header">
                        <label className="docker-filter-toggle">
                            <input
                                type="checkbox"
                                checked={showStopped}
                                onChange={(e) => setShowStopped(e.target.checked)}
                            />
                            Show stopped
                        </label>
                        <input
                            type="text"
                            className="docker-search"
                            placeholder="Search apps..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {filteredApps.length === 0 ? (
                        <div className="docker-empty">
                            <h3>No applications</h3>
                            <p>Create your first application to get started.</p>
                        </div>
                    ) : (
                        <table className="docker-table">
                            <thead>
                                <tr>
                                    <th>Application</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Domain</th>
                                    <th>Resources</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredApps.map(app => {
                                    const stats = appStats[app.id];
                                    const isRunning = app.status === 'running';
                                    const cpuPercent = stats?.cpu_percent || 0;
                                    const memPercent = stats?.memory_percent || 0;

                                    return (
                                        <tr key={app.id}>
                                            <td>
                                                <span className="docker-container-name">{app.name}</span>
                                                <span className="docker-container-id">ID: {app.id}</span>
                                            </td>
                                            <td>
                                                <span className="docker-image-tag" style={{ borderLeft: `3px solid ${getStackColor(app.app_type)}` }}>
                                                    {app.app_type === 'docker' && <Container size={12} style={{ marginRight: 4 }} />}
                                                    {app.app_type.toUpperCase()}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`docker-status-pill ${isRunning ? 'running' : 'exited'}`}>
                                                    <span className="docker-status-dot" />
                                                    {isRunning ? 'Running' : 'Stopped'}
                                                </span>
                                                {app.port && (
                                                    <div className="docker-status-detail">Port: {app.port}</div>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`docker-ports ${!isRunning ? 'faded' : ''}`}>
                                                    {app.domains && app.domains.length > 0 ? (
                                                        app.domains.map((d, i) => (
                                                            <span key={i}>
                                                                <Globe size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                                                {d.name}
                                                                {i < app.domains.length - 1 && <br />}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span style={{ color: 'var(--text-tertiary)' }}>-</span>
                                                    )}
                                                </span>
                                            </td>
                                            <td>
                                                <div className={!isRunning ? 'faded' : ''}>
                                                    <ResourceBar
                                                        label="CPU"
                                                        value={cpuPercent}
                                                        color={cpuPercent > 50 ? '#F59E0B' : '#6366F1'}
                                                    />
                                                    <ResourceBar
                                                        label="RAM"
                                                        value={memPercent}
                                                        color="#10B981"
                                                    />
                                                </div>
                                            </td>
                                            <td className="docker-actions-cell">
                                                <IconAction title="Logs" onClick={() => setSelectedApp(app)}>
                                                    <LogsIcon />
                                                </IconAction>
                                                {isRunning ? (
                                                    <>
                                                        <IconAction title="Restart" onClick={() => handleAction(app.id, 'restart')}>
                                                            <RestartIcon />
                                                        </IconAction>
                                                        <IconAction title="Stop" onClick={() => handleAction(app.id, 'stop')} color="#EF4444">
                                                            <StopIcon />
                                                        </IconAction>
                                                    </>
                                                ) : (
                                                    <>
                                                        <IconAction title="Start" onClick={() => handleAction(app.id, 'start')} color="#10B981">
                                                            <PlayIcon />
                                                        </IconAction>
                                                        <IconAction title="Delete" onClick={() => handleAction(app.id, 'delete')} color="#EF4444">
                                                            <TrashIcon />
                                                        </IconAction>
                                                    </>
                                                )}
                                                <IconAction title="Manage" onClick={() => navigate(`/apps/${app.id}`)}>
                                                    <SettingsIcon />
                                                </IconAction>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {showCreateModal && (
                <CreateAppModal onClose={() => setShowCreateModal(false)} />
            )}

            {selectedApp && (
                <AppLogsModal
                    app={selectedApp}
                    onClose={() => setSelectedApp(null)}
                />
            )}
        </div>
    );
};

// Resource Bar Component
const ResourceBar = ({ label, value, color }) => {
    const numValue = parseFloat(value) || 0;
    return (
        <div className="docker-res-container">
            <span className="docker-res-label">{label}</span>
            <div className="docker-res-track">
                <div
                    className="docker-res-fill"
                    style={{ width: `${Math.min(numValue, 100)}%`, backgroundColor: color }}
                />
            </div>
            <span className="docker-res-value">{numValue.toFixed(0)}%</span>
        </div>
    );
};

// Icon Actions
const IconAction = ({ title, onClick, color, children, disabled }) => (
    <button
        className="docker-icon-action"
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={color ? { color } : {}}
    >
        {children}
    </button>
);

// Icons
const LogsIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
);

const RestartIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
);

const StopIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12"/>
    </svg>
);

const PlayIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

const SettingsIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
);

// App Logs Modal
const AppLogsModal = ({ app, onClose }) => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [logType, setLogType] = useState('access');

    useEffect(() => {
        loadLogs();
    }, [app, logType]);

    async function loadLogs() {
        setLoading(true);
        try {
            // For Docker apps, try to get container logs
            if (app.app_type === 'docker') {
                const containersData = await api.getContainers(true).catch(() => ({ containers: [] }));
                const appContainer = containersData.containers?.find(c =>
                    c.name?.includes(app.name) || c.name?.includes(app.id)
                );
                if (appContainer) {
                    const data = await api.getContainerLogs(appContainer.id, 200);
                    setLogs(data.logs || 'No logs available');
                    return;
                }
            }
            // For other apps, use app logs endpoint
            const data = await api.getAppLogs(app.name, logType, 200);
            setLogs(data.logs || data.content || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Logs: {app.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {app.app_type !== 'docker' && (
                        <div style={{ marginBottom: '1rem' }}>
                            <select
                                value={logType}
                                onChange={(e) => setLogType(e.target.value)}
                                className="docker-search"
                                style={{ width: 'auto' }}
                            >
                                <option value="access">Access Logs</option>
                                <option value="error">Error Logs</option>
                            </select>
                        </div>
                    )}
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={loadLogs}>Refresh</button>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

// Create App Modal
const CreateAppModal = ({ onClose }) => {
    const navigate = useNavigate();

    const templates = [
        { id: 'wordpress', name: 'WordPress', icon: 'W', color: '#21759b', description: 'Full WordPress installation with database' },
        { id: 'nextcloud', name: 'Nextcloud', icon: 'N', color: '#0082c9', description: 'Self-hosted cloud storage platform' },
        { id: 'grafana', name: 'Grafana', icon: 'G', color: '#f46800', description: 'Monitoring and observability dashboards' },
        { id: 'portainer', name: 'Portainer', icon: 'P', color: '#13bef9', description: 'Docker container management UI' },
        { id: 'uptime-kuma', name: 'Uptime Kuma', icon: 'U', color: '#5cdd8b', description: 'Self-hosted monitoring tool' },
        { id: 'gitea', name: 'Gitea', icon: 'G', color: '#609926', description: 'Lightweight Git hosting service' },
    ];

    function selectTemplate(templateId) {
        onClose();
        // WordPress has its own dedicated management page
        if (templateId === 'wordpress') {
            navigate('/wordpress');
        } else {
            navigate(`/templates?install=${templateId}`);
        }
    }

    function goToAllTemplates() {
        onClose();
        navigate('/templates');
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Select Application Type</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="app-type-grid">
                    {templates.map(template => (
                        <button
                            key={template.id}
                            className="app-type-card"
                            onClick={() => selectTemplate(template.id)}
                        >
                            <div className="app-type-icon" style={{ background: template.color }}>
                                {template.id === 'portainer' ? <Container size={20} /> : template.icon}
                            </div>
                            <h3>{template.name}</h3>
                            <p>{template.description}</p>
                        </button>
                    ))}
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={goToAllTemplates}>
                        Browse All Templates
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Applications;
