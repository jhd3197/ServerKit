import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { GitBranch } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import EnvironmentVariables from '../components/EnvironmentVariables';
import PrivateURLSection from '../components/PrivateURLSection';
import LinkedAppsSection from '../components/LinkedAppsSection';
import LinkAppModal from '../components/LinkAppModal';

const ApplicationDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [app, setApp] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        loadApp();
    }, [id]);

    async function loadApp() {
        try {
            const data = await api.getApp(id);
            setApp(data.app);
        } catch (err) {
            console.error('Failed to load app:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(action) {
        try {
            if (action === 'start') {
                await api.startApp(id);
            } else if (action === 'stop') {
                await api.stopApp(id);
            } else if (action === 'restart') {
                await api.restartApp(id);
            }
            loadApp();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
        }
    }

    function getStackColor(type) {
        const colors = {
            'php': '#777bb4',
            'wordpress': '#21759b',
            'flask': '#fcd34d',
            'django': '#34d399',
            'docker': '#2496ed',
            'static': '#60a5fa',
        };
        return colors[type] || '#a1a1aa';
    }

    function getAppIcon(type) {
        switch (type) {
            case 'wordpress':
                return (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z"/>
                        <path d="M3.019 12c0 3.403 1.977 6.347 4.844 7.746l-4.1-11.237C3.284 9.593 3.019 10.764 3.019 12zm15.109-.274c0-1.063-.382-1.799-.709-2.372-.436-.709-.845-1.309-.845-2.018 0-.791.6-1.527 1.446-1.527.038 0 .074.005.111.007A8.954 8.954 0 0012 3.019c-3.218 0-6.049 1.65-7.699 4.149.216.007.42.011.594.011.964 0 2.458-.117 2.458-.117.497-.029.555.701.059.76 0 0-.499.059-1.055.088l3.356 9.979 2.017-6.042-1.436-3.937c-.497-.029-.968-.088-.968-.088-.497-.029-.439-.789.058-.76 0 0 1.523.117 2.429.117.964 0 2.458-.117 2.458-.117.497-.029.556.701.059.76 0 0-.5.059-1.055.088l3.331 9.905.92-3.072c.398-1.275.702-2.19.702-2.978z"/>
                    </svg>
                );
            case 'docker':
                return (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.186m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288z"/>
                    </svg>
                );
            default:
                return <span style={{ fontSize: '20px', fontWeight: 'bold' }}>{type.charAt(0).toUpperCase()}</span>;
        }
    }

    if (loading) {
        return <div className="loading">Loading application...</div>;
    }

    if (!app) {
        return (
            <div className="empty-state">
                <h3>Application not found</h3>
                <button className="btn btn-primary" onClick={() => navigate('/apps')}>
                    Back to Applications
                </button>
            </div>
        );
    }

    const isPythonApp = ['flask', 'django'].includes(app.app_type);
    const isWordPressApp = app.app_type === 'wordpress';
    const isDockerApp = app.app_type === 'docker';
    const isRunning = app.status === 'running';

    return (
        <div className="app-detail-page">
            {/* Top Bar with Breadcrumbs and Actions */}
            <div className="app-detail-topbar">
                <div className="app-detail-breadcrumbs">
                    <Link to="/apps">Applications</Link>
                    <span>/</span>
                    <span className="current">{app.name}</span>
                </div>
                <div className="app-detail-actions">
                    {app.port && (
                        <a
                            href={`http://localhost:${app.port}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                <polyline points="15 3 21 3 21 9"/>
                                <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                            Open App
                        </a>
                    )}
                    {isRunning && (
                        <>
                            <button className="btn btn-ghost" onClick={() => handleAction('restart')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="23 4 23 10 17 10"/>
                                    <polyline points="1 20 1 14 7 14"/>
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                                </svg>
                                Restart
                            </button>
                            <button className="btn btn-danger-outline" onClick={() => handleAction('stop')}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12"/>
                                </svg>
                                Stop
                            </button>
                        </>
                    )}
                    {!isRunning && (
                        <button className="btn btn-primary" onClick={() => handleAction('start')}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                            </svg>
                            Start
                        </button>
                    )}
                </div>
            </div>

            {/* App Header */}
            <div className="app-detail-header">
                <div className="app-detail-icon" style={{ background: getStackColor(app.app_type) }}>
                    {getAppIcon(app.app_type)}
                </div>
                <div className="app-detail-title-block">
                    <h1>
                        {app.name}
                        <span className={`app-status-badge ${isRunning ? 'running' : 'stopped'}`}>
                            <span className="pulse-dot" />
                            {isRunning ? 'Running' : 'Stopped'}
                        </span>
                        {app.environment_type && app.environment_type !== 'standalone' && (
                            <span className={`env-badge env-${app.environment_type}`}>
                                {app.environment_type === 'production' ? 'PROD' :
                                 app.environment_type === 'development' ? 'DEV' : 'STAGING'}
                                {app.has_linked_app && <GitBranch size={10} />}
                            </span>
                        )}
                    </h1>
                    <div className="app-detail-subtitle">
                        <span>{app.app_type.toUpperCase()}</span>
                        <span className="separator">•</span>
                        {app.port && <><span className="mono">Port {app.port}</span><span className="separator">•</span></>}
                        <span>Created {new Date(app.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="app-detail-tabs">
                <div
                    className={`app-detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    Overview
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'environment' ? 'active' : ''}`}
                    onClick={() => setActiveTab('environment')}
                >
                    Environment
                </div>
                {isPythonApp && (
                    <>
                        <div
                            className={`app-detail-tab ${activeTab === 'packages' ? 'active' : ''}`}
                            onClick={() => setActiveTab('packages')}
                        >
                            Packages
                        </div>
                        <div
                            className={`app-detail-tab ${activeTab === 'gunicorn' ? 'active' : ''}`}
                            onClick={() => setActiveTab('gunicorn')}
                        >
                            Gunicorn
                        </div>
                        <div
                            className={`app-detail-tab ${activeTab === 'commands' ? 'active' : ''}`}
                            onClick={() => setActiveTab('commands')}
                        >
                            Commands
                        </div>
                    </>
                )}
                {isWordPressApp && (
                    <>
                        <div
                            className={`app-detail-tab ${activeTab === 'plugins' ? 'active' : ''}`}
                            onClick={() => setActiveTab('plugins')}
                        >
                            Plugins
                        </div>
                        <div
                            className={`app-detail-tab ${activeTab === 'themes' ? 'active' : ''}`}
                            onClick={() => setActiveTab('themes')}
                        >
                            Themes
                        </div>
                        <div
                            className={`app-detail-tab ${activeTab === 'backups' ? 'active' : ''}`}
                            onClick={() => setActiveTab('backups')}
                        >
                            Backups
                        </div>
                    </>
                )}
                <div
                    className={`app-detail-tab ${activeTab === 'build' ? 'active' : ''}`}
                    onClick={() => setActiveTab('build')}
                >
                    Build
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'deploy' ? 'active' : ''}`}
                    onClick={() => setActiveTab('deploy')}
                >
                    Deploy
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    Logs
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </div>
            </div>

            {/* Tab Content */}
            <div className="app-detail-content">
                {activeTab === 'overview' && <OverviewTab app={app} onUpdate={loadApp} />}
                {activeTab === 'environment' && <EnvironmentVariables appId={app.id} />}
                {activeTab === 'packages' && isPythonApp && <PackagesTab appId={app.id} />}
                {activeTab === 'gunicorn' && isPythonApp && <GunicornTab appId={app.id} />}
                {activeTab === 'commands' && isPythonApp && <CommandsTab appId={app.id} appType={app.app_type} />}
                {activeTab === 'plugins' && isWordPressApp && <PluginsTab appId={app.id} />}
                {activeTab === 'themes' && isWordPressApp && <ThemesTab appId={app.id} />}
                {activeTab === 'backups' && isWordPressApp && <BackupsTab appId={app.id} />}
                {activeTab === 'build' && <BuildTab appId={app.id} appPath={app.path} />}
                {activeTab === 'deploy' && <DeployTab appId={app.id} appPath={app.path} />}
                {activeTab === 'logs' && <LogsTab app={app} />}
                {activeTab === 'settings' && <SettingsTab app={app} onUpdate={loadApp} />}
            </div>
        </div>
    );
};

// Overview Tab with new grid layout
const OverviewTab = ({ app, onUpdate }) => {
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [appStatus, setAppStatus] = useState(null);
    const [linkedApps, setLinkedApps] = useState([]);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linkLoading, setLinkLoading] = useState(false);
    const [containerStats, setContainerStats] = useState(null);

    useEffect(() => {
        if (['flask', 'django'].includes(app.app_type)) {
            loadStatus();
        }
        loadAppStatus();
        loadLinkedApps();
        if (app.app_type === 'docker') {
            loadContainerStats();
        }
    }, [app]);

    async function loadStatus() {
        try {
            const data = await api.getPythonAppStatus(app.id);
            setStatus(data);
        } catch (err) {
            console.error('Failed to load status:', err);
        }
    }

    async function loadAppStatus() {
        try {
            const data = await api.getAppStatus(app.id);
            setAppStatus(data);
        } catch (err) {
            console.error('Failed to load app status:', err);
        }
    }

    async function loadLinkedApps() {
        try {
            const data = await api.getLinkedApps(app.id);
            setLinkedApps(data.linked_apps || []);
        } catch (err) {
            console.error('Failed to load linked apps:', err);
        }
    }

    async function loadContainerStats() {
        try {
            // Try to get container stats for docker apps
            const containers = await api.getContainers(true);
            const appContainer = containers.containers?.find(c =>
                c.name?.includes(app.name) || c.name?.includes(app.slug)
            );
            if (appContainer && appContainer.state === 'running') {
                const stats = await api.getContainerStats(appContainer.id);
                setContainerStats(stats.stats);
            }
        } catch (err) {
            console.error('Failed to load container stats:', err);
        }
    }

    async function handleUnlink() {
        if (!window.confirm('Are you sure you want to unlink these apps? Database credentials will remain unchanged.')) {
            return;
        }
        setLinkLoading(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
            loadLinkedApps();
        } catch (err) {
            console.error('Failed to unlink apps:', err);
        } finally {
            setLinkLoading(false);
        }
    }

    function handleLinked() {
        onUpdate();
        loadLinkedApps();
    }

    function parseResourceValue(value) {
        if (!value) return 0;
        return parseFloat(value.replace('%', '')) || 0;
    }

    return (
        <div className="app-overview-grid">
            {/* Left Column */}
            <div className="app-overview-left">
                {/* Application Info Panel */}
                <div className="app-panel">
                    <div className="app-panel-header">Application Info</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">Type</span>
                                <span className="app-info-value">{app.app_type === 'docker' ? 'Docker Container' : app.app_type.toUpperCase()}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Port</span>
                                <span className="app-info-value">
                                    {app.port || '-'}
                                    {appStatus && app.port && (
                                        <span className={`port-indicator ${appStatus.port_accessible ? 'accessible' : ''}`}>
                                            {appStatus.port_accessible ? ' (accessible)' : ' (not accessible)'}
                                        </span>
                                    )}
                                </span>
                            </div>
                            {app.python_version && (
                                <div className="app-info-item">
                                    <span className="app-info-label">Python Version</span>
                                    <span className="app-info-value">{app.python_version}</span>
                                </div>
                            )}
                            {app.php_version && (
                                <div className="app-info-item">
                                    <span className="app-info-label">PHP Version</span>
                                    <span className="app-info-value">{app.php_version}</span>
                                </div>
                            )}
                            <div className="app-info-item full-width">
                                <span className="app-info-label">Root Path</span>
                                <div><span className="app-path-value">{app.root_path || `/var/serverkit/apps/${app.name}`}</span></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Routing Diagnostics Panel (Docker apps only) */}
                {app.app_type === 'docker' && (
                    <RoutingDiagnosticsPanel appId={app.id} />
                )}

                {/* Environment Linking Panel */}
                <div className="app-panel">
                    <div className="app-panel-header">Environment Linking</div>
                    <div className="app-panel-body">
                        <p className="app-panel-hint">
                            Link this app to another to create a production/development pair. Linked apps can share database credentials.
                        </p>
                        <LinkedAppsSection
                            app={app}
                            linkedApps={linkedApps}
                            onLink={() => setShowLinkModal(true)}
                            onUnlink={handleUnlink}
                            onNavigate={(appId) => navigate(`/apps/${appId}`)}
                            loading={linkLoading}
                            compact
                        />
                    </div>
                </div>

                {/* Process Status (Python apps) */}
                {status && (
                    <div className="app-panel">
                        <div className="app-panel-header">Process Status</div>
                        <div className="app-panel-body">
                            <div className="app-info-grid">
                                <div className="app-info-item">
                                    <span className="app-info-label">Service</span>
                                    <span className="app-info-value mono">{status.service_name}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">State</span>
                                    <span className="app-info-value">{status.active_state} ({status.sub_state})</span>
                                </div>
                                {status.main_pid !== '0' && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">PID</span>
                                        <span className="app-info-value mono">{status.main_pid}</span>
                                    </div>
                                )}
                                {status.memory && status.memory !== '0' && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">Memory</span>
                                        <span className="app-info-value">{formatBytes(parseInt(status.memory))}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Domains Panel */}
                {app.domains && app.domains.length > 0 && (
                    <div className="app-panel">
                        <div className="app-panel-header">Domains</div>
                        <div className="app-panel-body">
                            <div className="domains-list">
                                {app.domains.map(domain => (
                                    <div key={domain.id} className="domain-item">
                                        <a href={`https://${domain.name}`} target="_blank" rel="noopener noreferrer">
                                            {domain.name}
                                        </a>
                                        {domain.ssl_enabled && (
                                            <span className="ssl-badge">SSL</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right Column */}
            <div className="app-overview-right">
                {/* Private URL Panel (Docker apps with port) */}
                {app.app_type === 'docker' && app.port && (
                    <PrivateURLSection app={app} onUpdate={onUpdate} />
                )}

                {/* Live Resources Panel */}
                {app.app_type === 'docker' && (
                    <div className="app-panel">
                        <div className="app-panel-header">Live Resources</div>
                        <div className="app-panel-body">
                            <div className="resource-bar-container">
                                <div className="resource-bar-header">
                                    <span className="resource-bar-label">CPU Load</span>
                                    <span className="resource-bar-value">
                                        {containerStats ? `${parseResourceValue(containerStats.CPUPerc).toFixed(0)}%` : '-'}
                                    </span>
                                </div>
                                <div className="resource-bar-track">
                                    <div
                                        className="resource-bar-fill cpu"
                                        style={{ width: `${containerStats ? parseResourceValue(containerStats.CPUPerc) : 0}%` }}
                                    />
                                </div>
                            </div>
                            <div className="resource-bar-container">
                                <div className="resource-bar-header">
                                    <span className="resource-bar-label">RAM Usage</span>
                                    <span className="resource-bar-value">
                                        {containerStats?.MemUsage || '-'}
                                    </span>
                                </div>
                                <div className="resource-bar-track">
                                    <div
                                        className="resource-bar-fill ram"
                                        style={{ width: `${containerStats ? parseResourceValue(containerStats.MemPerc) : 0}%` }}
                                    />
                                </div>
                            </div>
                            {!containerStats && app.status !== 'running' && (
                                <p className="resource-hint">Start the container to see live resources.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showLinkModal && (
                <LinkAppModal
                    app={app}
                    onClose={() => setShowLinkModal(false)}
                    onLinked={handleLinked}
                />
            )}
        </div>
    );
};

// Routing Diagnostics Panel
const RoutingDiagnosticsPanel = ({ appId }) => {
    const [diagnostics, setDiagnostics] = useState(null);
    const [loading, setLoading] = useState(false);
    const [lastChecked, setLastChecked] = useState(null);

    async function runDiagnostics() {
        setLoading(true);
        try {
            const response = await fetch(`/api/v1/domains/debug/diagnose/${appId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
                }
            });
            const data = await response.json();
            setDiagnostics(data);
            setLastChecked(new Date());
        } catch (err) {
            console.error('Failed to run diagnostics:', err);
        } finally {
            setLoading(false);
        }
    }

    const isHealthy = diagnostics?.health?.overall;

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <span>Routing Diagnostics</span>
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={runDiagnostics}
                    disabled={loading}
                >
                    {loading ? 'Checking...' : 'Run Diagnostics'}
                </button>
            </div>
            <div className="app-panel-body">
                {diagnostics ? (
                    <>
                        <div className={`diag-status ${isHealthy ? 'healthy' : 'unhealthy'}`}>
                            <div className={`diag-icon ${isHealthy ? 'healthy' : 'unhealthy'}`}>
                                {isHealthy ? '✓' : '✗'}
                            </div>
                            <div className="diag-text">
                                <h4>{isHealthy ? 'Configuration Healthy' : 'Issues Detected'}</h4>
                                <p>
                                    {lastChecked && `Last checked: ${Math.round((Date.now() - lastChecked) / 60000)} minutes ago. `}
                                    {isHealthy ? 'No routing issues detected.' : 'Some checks failed.'}
                                </p>
                            </div>
                        </div>
                        {diagnostics.health?.issues?.length > 0 && (
                            <ul className="diag-issues">
                                {diagnostics.health.issues.map((issue, i) => (
                                    <li key={i}>{issue}</li>
                                ))}
                            </ul>
                        )}
                    </>
                ) : (
                    <p className="app-panel-hint">
                        Click "Run Diagnostics" to check routing configuration and identify issues.
                    </p>
                )}
            </div>
        </div>
    );
};

// Helper function
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================
// EXISTING TAB COMPONENTS (preserved)
// ============================================

const PackagesTab = ({ appId }) => {
    const toast = useToast();
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [newPackage, setNewPackage] = useState('');

    useEffect(() => {
        loadPackages();
    }, [appId]);

    async function loadPackages() {
        try {
            const data = await api.getPythonPackages(appId);
            setPackages(data.packages || []);
        } catch (err) {
            console.error('Failed to load packages:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newPackage.trim()) return;

        setInstalling(true);
        try {
            await api.installPythonPackages(appId, [newPackage.trim()]);
            setNewPackage('');
            loadPackages();
        } catch (err) {
            console.error('Failed to install package:', err);
        } finally {
            setInstalling(false);
        }
    }

    async function handleFreeze() {
        try {
            await api.freezePythonRequirements(appId);
            toast.success('requirements.txt updated');
        } catch (err) {
            toast.error('Failed to freeze requirements');
            console.error('Failed to freeze requirements:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading packages...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Installed Packages</h3>
                <button className="btn btn-secondary btn-sm" onClick={handleFreeze}>
                    Freeze to requirements.txt
                </button>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <input
                    type="text"
                    value={newPackage}
                    onChange={(e) => setNewPackage(e.target.value)}
                    placeholder="Package name (e.g., requests, flask==2.0.0)"
                />
                <button type="submit" className="btn btn-primary" disabled={installing}>
                    {installing ? 'Installing...' : 'Install'}
                </button>
            </form>

            <div className="packages-list">
                {packages.map(pkg => (
                    <div key={pkg.name} className="package-item">
                        <span className="package-name">{pkg.name}</span>
                        <span className="package-version">{pkg.version}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const GunicornTab = ({ appId }) => {
    const toast = useToast();
    const [config, setConfig] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        loadConfig();
    }, [appId]);

    async function loadConfig() {
        try {
            const data = await api.getGunicornConfig(appId);
            setConfig(data.content || '');
        } catch (err) {
            console.error('Failed to load config:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api.updateGunicornConfig(appId, config);
            toast.success('Configuration saved. Restart the app to apply changes.');
        } catch (err) {
            toast.error('Failed to save configuration');
            console.error('Failed to save config:', err);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="loading">Loading Gunicorn configuration...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Gunicorn Configuration</h3>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
            <textarea
                className="code-editor"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                spellCheck={false}
            />
        </div>
    );
};

const CommandsTab = ({ appId, appType }) => {
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState(null);
    const [running, setRunning] = useState(false);

    const quickCommands = appType === 'django' ? [
        { label: 'Run Migrations', cmd: 'python manage.py migrate' },
        { label: 'Collect Static', cmd: 'python manage.py collectstatic --noinput' },
        { label: 'Create Superuser', cmd: 'python manage.py createsuperuser' },
        { label: 'Shell', cmd: 'python manage.py shell' },
        { label: 'Check', cmd: 'python manage.py check' },
    ] : [
        { label: 'Flask Routes', cmd: 'flask routes' },
        { label: 'Flask Shell', cmd: 'flask shell' },
        { label: 'DB Upgrade', cmd: 'flask db upgrade' },
        { label: 'DB Migrate', cmd: 'flask db migrate' },
    ];

    async function handleRun(cmd) {
        const commandToRun = cmd || command;
        if (!commandToRun.trim()) return;

        setRunning(true);
        setOutput(null);

        try {
            const result = await api.runPythonCommand(appId, commandToRun);
            setOutput(result);
        } catch (err) {
            setOutput({ success: false, stderr: err.message });
        } finally {
            setRunning(false);
        }
    }

    return (
        <div>
            <h3>Run Commands</h3>
            <p className="hint">Commands run in the app's virtual environment context.</p>

            <div className="quick-commands">
                {quickCommands.map(({ label, cmd }) => (
                    <button
                        key={cmd}
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleRun(cmd)}
                        disabled={running}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="command-input">
                <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="Enter command..."
                    onKeyDown={(e) => e.key === 'Enter' && handleRun()}
                />
                <button
                    className="btn btn-primary"
                    onClick={() => handleRun()}
                    disabled={running}
                >
                    {running ? 'Running...' : 'Run'}
                </button>
            </div>

            {output && (
                <div className={`command-output ${output.success ? '' : 'error'}`}>
                    {output.stdout && <pre>{output.stdout}</pre>}
                    {output.stderr && <pre className="stderr">{output.stderr}</pre>}
                    {!output.stdout && !output.stderr && (
                        <pre>{output.success ? 'Command completed successfully' : 'Command failed'}</pre>
                    )}
                </div>
            )}
        </div>
    );
};

const PluginsTab = ({ appId }) => {
    const [plugins, setPlugins] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadPlugins();
    }, [appId]);

    async function loadPlugins() {
        try {
            const data = await api.getWordPressPlugins(appId);
            setPlugins(data.plugins || []);
        } catch (err) {
            console.error('Failed to load plugins:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleActivate(plugin) {
        try {
            await api.activateWordPressPlugin(appId, plugin);
            loadPlugins();
        } catch (err) {
            console.error('Failed to activate plugin:', err);
        }
    }

    async function handleDeactivate(plugin) {
        try {
            await api.deactivateWordPressPlugin(appId, plugin);
            loadPlugins();
        } catch (err) {
            console.error('Failed to deactivate plugin:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading plugins...</div>;
    }

    return (
        <div>
            <h3>WordPress Plugins</h3>
            <div className="plugins-list">
                {plugins.map(plugin => (
                    <div key={plugin.name} className="plugin-item">
                        <div className="plugin-info">
                            <span className="plugin-name">{plugin.title || plugin.name}</span>
                            <span className="plugin-version">{plugin.version}</span>
                        </div>
                        <div className="plugin-actions">
                            {plugin.status === 'active' ? (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleDeactivate(plugin.name)}
                                >
                                    Deactivate
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleActivate(plugin.name)}
                                >
                                    Activate
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ThemesTab = ({ appId }) => {
    const [themes, setThemes] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadThemes();
    }, [appId]);

    async function loadThemes() {
        try {
            const data = await api.getWordPressThemes(appId);
            setThemes(data.themes || []);
        } catch (err) {
            console.error('Failed to load themes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleActivate(theme) {
        try {
            await api.activateWordPressTheme(appId, theme);
            loadThemes();
        } catch (err) {
            console.error('Failed to activate theme:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading themes...</div>;
    }

    return (
        <div>
            <h3>WordPress Themes</h3>
            <div className="themes-list">
                {themes.map(theme => (
                    <div key={theme.name} className={`theme-item ${theme.status === 'active' ? 'active' : ''}`}>
                        <div className="theme-info">
                            <span className="theme-name">{theme.title || theme.name}</span>
                            <span className="theme-version">{theme.version}</span>
                        </div>
                        {theme.status !== 'active' && (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleActivate(theme.name)}
                            >
                                Activate
                            </button>
                        )}
                        {theme.status === 'active' && (
                            <span className="active-badge">Active</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const BackupsTab = ({ appId }) => {
    const toast = useToast();
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadBackups();
    }, [appId]);

    async function loadBackups() {
        try {
            const data = await api.getWordPressBackups(appId);
            setBackups(data.backups || []);
        } catch (err) {
            console.error('Failed to load backups:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreate() {
        setCreating(true);
        try {
            await api.createWordPressBackup(appId);
            loadBackups();
        } catch (err) {
            console.error('Failed to create backup:', err);
        } finally {
            setCreating(false);
        }
    }

    async function handleRestore(backupName) {
        if (!confirm(`Restore from ${backupName}? This will overwrite current data.`)) return;

        try {
            await api.restoreWordPressBackup(appId, backupName);
            toast.success('Backup restored successfully');
        } catch (err) {
            toast.error('Failed to restore backup');
            console.error('Failed to restore backup:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading backups...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Backups</h3>
                <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
                    {creating ? 'Creating...' : 'Create Backup'}
                </button>
            </div>

            {backups.length === 0 ? (
                <p className="hint">No backups yet. Create your first backup.</p>
            ) : (
                <div className="backups-list">
                    {backups.map(backup => (
                        <div key={backup.name} className="backup-item">
                            <div className="backup-info">
                                <span className="backup-name">{backup.name}</span>
                                <span className="backup-size">{formatBytes(backup.size)}</span>
                                <span className="backup-date">
                                    {new Date(backup.created_at).toLocaleString()}
                                </span>
                            </div>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleRestore(backup.name)}
                            >
                                Restore
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const BuildTab = ({ appId, appPath }) => {
    const toast = useToast();
    const [buildConfig, setBuildConfig] = useState(null);
    const [detection, setDetection] = useState(null);
    const [deployments, setDeployments] = useState([]);
    const [currentDeployment, setCurrentDeployment] = useState(null);
    const [loading, setLoading] = useState(true);
    const [building, setBuilding] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showLogsModal, setShowLogsModal] = useState(false);
    const [selectedLog, setSelectedLog] = useState(null);
    const [buildLogs, setBuildLogs] = useState([]);
    const [error, setError] = useState(null);

    const [configForm, setConfigForm] = useState({
        buildMethod: 'auto',
        dockerfilePath: 'Dockerfile',
        customBuildCmd: '',
        customStartCmd: '',
        cacheEnabled: true,
        timeout: 600,
        keepDeployments: 5
    });

    useEffect(() => {
        loadData();
    }, [appId]);

    async function loadData() {
        try {
            setLoading(true);
            const [configRes, detectRes, deploymentsRes] = await Promise.all([
                api.getBuildConfig(appId),
                api.detectBuildMethod(appId),
                api.getDeployments(appId, 10)
            ]);

            setDetection(detectRes);

            if (configRes.configured) {
                setBuildConfig(configRes.config);
                setConfigForm({
                    buildMethod: configRes.config.build_method || 'auto',
                    dockerfilePath: configRes.config.dockerfile_path || 'Dockerfile',
                    customBuildCmd: configRes.config.custom_build_cmd || '',
                    customStartCmd: configRes.config.custom_start_cmd || '',
                    cacheEnabled: configRes.config.cache_enabled !== false,
                    timeout: configRes.config.timeout || 600,
                    keepDeployments: configRes.config.keep_deployments || 5
                });
            }

            setDeployments(deploymentsRes.deployments || []);
            setCurrentDeployment(deploymentsRes.current);

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleConfigureBuild(e) {
        e.preventDefault();
        try {
            await api.configureBuild(appId, {
                build_method: configForm.buildMethod,
                dockerfile_path: configForm.dockerfilePath,
                custom_build_cmd: configForm.customBuildCmd || null,
                custom_start_cmd: configForm.customStartCmd || null,
                cache_enabled: configForm.cacheEnabled,
                timeout: configForm.timeout,
                keep_deployments: configForm.keepDeployments
            });
            setShowConfigModal(false);
            toast.success('Build configuration saved');
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleBuild(noCache = false) {
        setBuilding(true);
        setError(null);
        try {
            const result = await api.triggerBuild(appId, noCache);
            if (result.success) {
                toast.success('Build completed successfully');
            } else {
                setError(result.error || 'Build failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setBuilding(false);
        }
    }

    async function handleDeploy(noCache = false) {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.deployApp(appId, { no_cache: noCache });
            if (result.success) {
                toast.success(`Deployment v${result.deployment.version} successful!`);
            } else {
                setError(result.error || 'Deployment failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    async function handleRollback(version = null) {
        if (!confirm(version
            ? `Rollback to version ${version}? This will replace the current deployment.`
            : 'Rollback to previous deployment?'
        )) return;

        setDeploying(true);
        setError(null);
        try {
            const result = await api.rollback(appId, version);
            if (result.success) {
                toast.success('Rollback successful');
            } else {
                setError(result.error || 'Rollback failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'live': return 'badge-success';
            case 'building':
            case 'deploying':
            case 'pending': return 'badge-warning';
            case 'failed': return 'badge-danger';
            case 'rolled_back': return 'badge-secondary';
            default: return 'badge-default';
        }
    }

    function formatDuration(seconds) {
        if (!seconds) return '-';
        if (seconds < 60) return `${Math.round(seconds)}s`;
        return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    }

    if (loading) {
        return <div className="loading">Loading build configuration...</div>;
    }

    return (
        <div className="build-tab">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {detection && (
                <div className="card">
                    <h3>Auto-Detection Results</h3>
                    <div className="detection-results">
                        <div className="detection-item">
                            <span className="detection-label">Detected Method:</span>
                            <span className="detection-value">{detection.detected_method || 'None'}</span>
                        </div>
                        {detection.dockerfile_exists && (
                            <div className="detection-item">
                                <span className="detection-label">Dockerfile:</span>
                                <span className="detection-value">Found</span>
                            </div>
                        )}
                        {detection.docker_compose_exists && (
                            <div className="detection-item">
                                <span className="detection-label">Docker Compose:</span>
                                <span className="detection-value">Found</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header-row">
                    <h3>Build Configuration</h3>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigModal(true)}>
                        Configure
                    </button>
                </div>
                {buildConfig ? (
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Method</span>
                            <span className="info-value">{buildConfig.build_method}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Timeout</span>
                            <span className="info-value">{buildConfig.timeout}s</span>
                        </div>
                    </div>
                ) : (
                    <p className="hint">No build configuration. Click Configure to set up.</p>
                )}
                <div className="card-actions">
                    <button
                        className="btn btn-primary"
                        onClick={() => handleDeploy(false)}
                        disabled={deploying || building}
                    >
                        {deploying ? 'Deploying...' : 'Build & Deploy'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleBuild(false)}
                        disabled={building || deploying}
                    >
                        {building ? 'Building...' : 'Build Only'}
                    </button>
                </div>
            </div>

            {deployments.length > 0 && (
                <div className="card">
                    <h3>Deployment History</h3>
                    <div className="deployments-list">
                        {deployments.map(dep => (
                            <div key={dep.version} className={`deployment-item ${dep.status === 'live' ? 'current' : ''}`}>
                                <div className="deployment-info">
                                    <span className="deployment-version">v{dep.version}</span>
                                    <span className={`badge ${getStatusBadgeClass(dep.status)}`}>{dep.status}</span>
                                </div>
                                <div className="deployment-meta">
                                    <span>{new Date(dep.created_at).toLocaleString()}</span>
                                    <span>{formatDuration(dep.build_duration)}</span>
                                </div>
                                {dep.status !== 'live' && (
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleRollback(dep.version)}
                                        disabled={deploying}
                                    >
                                        Rollback
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {showConfigModal && (
                <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Build Configuration</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleConfigureBuild}>
                            <div className="form-group">
                                <label>Build Method</label>
                                <select
                                    value={configForm.buildMethod}
                                    onChange={e => setConfigForm({...configForm, buildMethod: e.target.value})}
                                >
                                    <option value="auto">Auto-detect</option>
                                    <option value="dockerfile">Dockerfile</option>
                                    <option value="docker-compose">Docker Compose</option>
                                    <option value="custom">Custom</option>
                                </select>
                            </div>
                            {configForm.buildMethod === 'dockerfile' && (
                                <div className="form-group">
                                    <label>Dockerfile Path</label>
                                    <input
                                        type="text"
                                        value={configForm.dockerfilePath}
                                        onChange={e => setConfigForm({...configForm, dockerfilePath: e.target.value})}
                                    />
                                </div>
                            )}
                            {configForm.buildMethod === 'custom' && (
                                <>
                                    <div className="form-group">
                                        <label>Build Command</label>
                                        <input
                                            type="text"
                                            value={configForm.customBuildCmd}
                                            onChange={e => setConfigForm({...configForm, customBuildCmd: e.target.value})}
                                            placeholder="npm run build"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Start Command</label>
                                        <input
                                            type="text"
                                            value={configForm.customStartCmd}
                                            onChange={e => setConfigForm({...configForm, customStartCmd: e.target.value})}
                                            placeholder="npm start"
                                        />
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label>Timeout (seconds)</label>
                                <input
                                    type="number"
                                    value={configForm.timeout}
                                    onChange={e => setConfigForm({...configForm, timeout: parseInt(e.target.value)})}
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Configuration
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

const LogsTab = ({ app }) => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const isDockerApp = app.app_type === 'docker';
    const isPythonApp = ['flask', 'django'].includes(app.app_type);

    useEffect(() => {
        loadLogs();
    }, [app.id]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(loadLogs, 5000);
        return () => clearInterval(interval);
    }, [autoRefresh, app.id]);

    async function loadLogs() {
        try {
            let data;
            if (isDockerApp) {
                data = await api.getDockerAppLogs(app.id, 200);
            } else if (isPythonApp) {
                data = await api.getPythonAppLogs(app.id, 200);
            } else {
                data = { logs: 'Logs not available for this app type.' };
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            console.error('Failed to load logs:', err);
            setLogs('Failed to load logs');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="logs-tab">
            <div className="logs-header">
                <h3>Application Logs</h3>
                <div className="logs-controls">
                    {isPythonApp && (
                        <span className="hint">Gunicorn/systemd Logs</span>
                    )}
                    {isDockerApp && (
                        <span className="hint">Docker Compose Logs</span>
                    )}
                    <label className="checkbox-inline">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                        />
                        Auto-refresh
                    </label>
                    <button className="btn btn-secondary btn-sm" onClick={loadLogs}>
                        Refresh
                    </button>
                </div>
            </div>
            <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
        </div>
    );
};

const SettingsTab = ({ app, onUpdate }) => {
    const navigate = useNavigate();
    const [deleting, setDeleting] = useState(false);
    const [environmentType, setEnvironmentType] = useState(app.environment_type || 'standalone');
    const [savingEnvironment, setSavingEnvironment] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const envLabels = {
        standalone: 'Standalone',
        production: 'Production',
        development: 'Development',
        staging: 'Staging'
    };

    async function handleDelete() {
        if (!confirm(`Delete ${app.name}? This action cannot be undone.`)) return;
        if (!confirm('Are you sure? Type "delete" to confirm.')) return;

        setDeleting(true);
        try {
            await api.deleteApp(app.id);
            navigate('/apps');
        } catch (err) {
            console.error('Failed to delete app:', err);
            setDeleting(false);
        }
    }

    async function handleEnvironmentChange(newType) {
        if (newType === app.environment_type) return;

        setSavingEnvironment(true);
        try {
            await api.updateAppEnvironment(app.id, newType);
            setEnvironmentType(newType);
            onUpdate();
        } catch (err) {
            console.error('Failed to update environment:', err);
            setEnvironmentType(app.environment_type || 'standalone');
        } finally {
            setSavingEnvironment(false);
        }
    }

    async function handleUnlink() {
        if (!confirm(`Unlink ${app.name} from its linked application? Both apps will become standalone.`)) return;

        setUnlinking(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
        } catch (err) {
            console.error('Failed to unlink app:', err);
        } finally {
            setUnlinking(false);
        }
    }

    return (
        <div>
            <h3>Application Settings</h3>

            <div className="card settings-section">
                <h4>Environment Configuration</h4>
                <div className="settings-row">
                    <div className="settings-label">
                        <span>Environment Type</span>
                        <span className="settings-hint">
                            {app.has_linked_app
                                ? 'This app is linked. Unlink to change environment type.'
                                : 'Set how this application is used in your workflow.'}
                        </span>
                    </div>
                    <div className="settings-control">
                        {app.has_linked_app ? (
                            <span className={`env-badge env-${app.environment_type}`}>
                                {envLabels[app.environment_type] || app.environment_type}
                            </span>
                        ) : (
                            <select
                                value={environmentType}
                                onChange={(e) => handleEnvironmentChange(e.target.value)}
                                disabled={savingEnvironment}
                                className="settings-select"
                            >
                                <option value="standalone">Standalone</option>
                                <option value="development">Development</option>
                                <option value="staging">Staging</option>
                                <option value="production">Production</option>
                            </select>
                        )}
                        {savingEnvironment && <span className="settings-saving">Saving...</span>}
                    </div>
                </div>

                {app.has_linked_app && (
                    <div className="settings-row settings-linked-warning">
                        <div className="settings-label">
                            <span>Linked Application</span>
                            <span className="settings-hint">
                                This app is linked to another application. Unlinking will reset both apps to standalone mode.
                            </span>
                        </div>
                        <div className="settings-control">
                            <button
                                className="btn btn-secondary"
                                onClick={handleUnlink}
                                disabled={unlinking}
                            >
                                {unlinking ? 'Unlinking...' : 'Unlink Application'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="card danger-zone">
                <h4>Danger Zone</h4>
                <p>Once you delete an application, there is no going back.</p>
                <button
                    className="btn btn-danger"
                    onClick={handleDelete}
                    disabled={deleting}
                >
                    {deleting ? 'Deleting...' : 'Delete Application'}
                </button>
            </div>
        </div>
    );
};

const DeployTab = ({ appId, appPath }) => {
    const toast = useToast();
    const [config, setConfig] = useState(null);
    const [gitStatus, setGitStatus] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [branches, setBranches] = useState([]);
    const [error, setError] = useState(null);

    const [configForm, setConfigForm] = useState({
        repoUrl: '',
        branch: 'main',
        autoDeploy: true,
        preDeployScript: '',
        postDeployScript: ''
    });

    useEffect(() => {
        loadData();
    }, [appId]);

    async function loadData() {
        try {
            setLoading(true);
            const [configRes, historyRes] = await Promise.all([
                api.getDeployConfig(appId),
                api.getDeploymentHistory(appId, 20)
            ]);

            if (configRes.configured) {
                setConfig(configRes.config);
                setConfigForm({
                    repoUrl: configRes.config.repo_url || '',
                    branch: configRes.config.branch || 'main',
                    autoDeploy: configRes.config.auto_deploy !== false,
                    preDeployScript: configRes.config.pre_deploy_script || '',
                    postDeployScript: configRes.config.post_deploy_script || ''
                });
                try {
                    const statusRes = await api.getGitStatus(appId);
                    setGitStatus(statusRes);
                } catch (e) {}
            } else {
                setConfig(null);
            }

            setHistory(historyRes.deployments || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleConfigureDeployment(e) {
        e.preventDefault();
        try {
            await api.configureDeployment(
                appId,
                configForm.repoUrl,
                configForm.branch,
                configForm.autoDeploy,
                configForm.preDeployScript || null,
                configForm.postDeployScript || null
            );
            setShowConfigModal(false);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRemoveDeployment() {
        if (!confirm('Remove deployment configuration? This will not delete the repository files.')) return;
        try {
            await api.removeDeployment(appId);
            setConfig(null);
            setGitStatus(null);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDeploy(force = false) {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.triggerDeploy(appId, force);
            if (result.success) {
                toast.success('Deployment completed successfully!');
            } else {
                setError(result.error || 'Deployment failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    async function handlePull() {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.pullChanges(appId);
            if (result.success) {
                toast.success('Changes pulled successfully!');
            } else {
                setError(result.error || 'Pull failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'success': return 'badge-success';
            case 'failed': return 'badge-danger';
            case 'in_progress': return 'badge-warning';
            default: return 'badge-secondary';
        }
    }

    if (loading) {
        return <div className="loading">Loading deployment configuration...</div>;
    }

    return (
        <div className="deploy-tab">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {!config ? (
                <div className="deploy-setup">
                    <div className="empty-state">
                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="12" cy="12" r="4"/>
                            <line x1="1.05" y1="12" x2="7" y2="12"/>
                            <line x1="17.01" y1="12" x2="22.96" y2="12"/>
                        </svg>
                        <h3>Git Deployment Not Configured</h3>
                        <p>Connect a Git repository to enable automatic deployments via webhooks or manual triggers.</p>
                        <button className="btn btn-primary" onClick={() => setShowConfigModal(true)}>
                            Configure Deployment
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="deploy-header">
                        <div className="deploy-status-card">
                            <div className="deploy-repo-info">
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                                </svg>
                                <div>
                                    <span className="repo-url">{config.repo_url}</span>
                                    <span className="repo-branch">Branch: {config.branch}</span>
                                </div>
                            </div>
                            <div className="deploy-actions">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={handlePull}
                                    disabled={deploying}
                                >
                                    Pull Only
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleDeploy(false)}
                                    disabled={deploying}
                                >
                                    {deploying ? 'Deploying...' : 'Deploy Now'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="deploy-grid">
                        <div className="card">
                            <h3>Configuration</h3>
                            <div className="info-list">
                                <div className="info-item">
                                    <span className="info-label">Repository</span>
                                    <span className="info-value mono">{config.repo_url}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Branch</span>
                                    <span className="info-value">{config.branch}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Auto Deploy</span>
                                    <span className="info-value">{config.auto_deploy ? 'Enabled' : 'Disabled'}</span>
                                </div>
                            </div>
                            <div className="card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigModal(true)}>
                                    Edit
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleRemoveDeployment}>
                                    Remove
                                </button>
                            </div>
                        </div>

                        {history.length > 0 && (
                            <div className="card">
                                <h3>Deployment History</h3>
                                <div className="deployments-list">
                                    {history.slice(0, 5).map((dep, idx) => (
                                        <div key={idx} className="deployment-item">
                                            <span className={`badge ${getStatusBadgeClass(dep.status)}`}>{dep.status}</span>
                                            <span className="deployment-date">{new Date(dep.timestamp).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {showConfigModal && (
                <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Configure Deployment</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleConfigureDeployment}>
                            <div className="form-group">
                                <label>Repository URL</label>
                                <input
                                    type="text"
                                    value={configForm.repoUrl}
                                    onChange={e => setConfigForm({...configForm, repoUrl: e.target.value})}
                                    placeholder="https://github.com/user/repo.git"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Branch</label>
                                <input
                                    type="text"
                                    value={configForm.branch}
                                    onChange={e => setConfigForm({...configForm, branch: e.target.value})}
                                    placeholder="main"
                                />
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={configForm.autoDeploy}
                                        onChange={e => setConfigForm({...configForm, autoDeploy: e.target.checked})}
                                    />
                                    <span>Enable auto-deploy on push</span>
                                </label>
                            </div>
                            <div className="form-group">
                                <label>Pre-deploy Script</label>
                                <textarea
                                    value={configForm.preDeployScript}
                                    onChange={e => setConfigForm({...configForm, preDeployScript: e.target.value})}
                                    placeholder="npm install"
                                    rows={3}
                                />
                            </div>
                            <div className="form-group">
                                <label>Post-deploy Script</label>
                                <textarea
                                    value={configForm.postDeployScript}
                                    onChange={e => setConfigForm({...configForm, postDeployScript: e.target.value})}
                                    placeholder="npm run build"
                                    rows={3}
                                />
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    Save Configuration
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ApplicationDetail;
