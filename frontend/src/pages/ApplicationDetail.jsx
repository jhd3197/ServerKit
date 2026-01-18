import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import EnvironmentVariables from '../components/EnvironmentVariables';

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

    function getStatusClass(status) {
        switch (status) {
            case 'running': return 'status-active';
            case 'stopped': return 'status-stopped';
            case 'error': return 'status-error';
            default: return 'status-warning';
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
    const isPHPApp = app.app_type === 'php';

    return (
        <div>
            <header className="top-bar">
                <div className="app-header-info">
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate('/apps')}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7"/>
                        </svg>
                        Back
                    </button>
                    <div className="app-header-title">
                        <div className="app-icon" style={{ background: getStackColor(app.app_type) }}>
                            {app.app_type.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h1>{app.name}</h1>
                            <div className="subtitle">
                                {app.app_type.toUpperCase()}
                                {app.python_version && ` • Python ${app.python_version}`}
                                {app.php_version && ` • PHP ${app.php_version}`}
                                {app.port && ` • Port ${app.port}`}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="top-bar-actions">
                    <span className={`status-badge ${getStatusClass(app.status)}`}>
                        <span className="status-dot"/>
                        {app.status}
                    </span>
                    {app.status === 'running' ? (
                        <>
                            <button className="btn btn-secondary" onClick={() => handleAction('restart')}>
                                Restart
                            </button>
                            <button className="btn btn-secondary" onClick={() => handleAction('stop')}>
                                Stop
                            </button>
                        </>
                    ) : (
                        <button className="btn btn-primary" onClick={() => handleAction('start')}>
                            Start
                        </button>
                    )}
                </div>
            </header>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    Overview
                </button>
                <button
                    className={`tab ${activeTab === 'environment' ? 'active' : ''}`}
                    onClick={() => setActiveTab('environment')}
                >
                    Environment
                </button>
                {isPythonApp && (
                    <>
                        <button
                            className={`tab ${activeTab === 'packages' ? 'active' : ''}`}
                            onClick={() => setActiveTab('packages')}
                        >
                            Packages
                        </button>
                        <button
                            className={`tab ${activeTab === 'gunicorn' ? 'active' : ''}`}
                            onClick={() => setActiveTab('gunicorn')}
                        >
                            Gunicorn
                        </button>
                        <button
                            className={`tab ${activeTab === 'commands' ? 'active' : ''}`}
                            onClick={() => setActiveTab('commands')}
                        >
                            Commands
                        </button>
                    </>
                )}
                {isWordPressApp && (
                    <>
                        <button
                            className={`tab ${activeTab === 'plugins' ? 'active' : ''}`}
                            onClick={() => setActiveTab('plugins')}
                        >
                            Plugins
                        </button>
                        <button
                            className={`tab ${activeTab === 'themes' ? 'active' : ''}`}
                            onClick={() => setActiveTab('themes')}
                        >
                            Themes
                        </button>
                        <button
                            className={`tab ${activeTab === 'backups' ? 'active' : ''}`}
                            onClick={() => setActiveTab('backups')}
                        >
                            Backups
                        </button>
                    </>
                )}
                <button
                    className={`tab ${activeTab === 'deploy' ? 'active' : ''}`}
                    onClick={() => setActiveTab('deploy')}
                >
                    Deploy
                </button>
                <button
                    className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
                    onClick={() => setActiveTab('logs')}
                >
                    Logs
                </button>
                <button
                    className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'overview' && <OverviewTab app={app} />}
                {activeTab === 'environment' && <EnvironmentVariables appId={app.id} />}
                {activeTab === 'packages' && isPythonApp && <PackagesTab appId={app.id} />}
                {activeTab === 'gunicorn' && isPythonApp && <GunicornTab appId={app.id} />}
                {activeTab === 'commands' && isPythonApp && <CommandsTab appId={app.id} appType={app.app_type} />}
                {activeTab === 'plugins' && isWordPressApp && <PluginsTab appId={app.id} />}
                {activeTab === 'themes' && isWordPressApp && <ThemesTab appId={app.id} />}
                {activeTab === 'backups' && isWordPressApp && <BackupsTab appId={app.id} />}
                {activeTab === 'deploy' && <DeployTab appId={app.id} appPath={app.path} />}
                {activeTab === 'logs' && <LogsTab app={app} />}
                {activeTab === 'settings' && <SettingsTab app={app} onUpdate={loadApp} />}
            </div>
        </div>
    );
};

const OverviewTab = ({ app }) => {
    const [status, setStatus] = useState(null);

    useEffect(() => {
        if (['flask', 'django'].includes(app.app_type)) {
            loadStatus();
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

    return (
        <div className="overview-grid">
            <div className="card">
                <h3>Application Info</h3>
                <div className="info-list">
                    <div className="info-item">
                        <span className="info-label">Type</span>
                        <span className="info-value">{app.app_type.toUpperCase()}</span>
                    </div>
                    <div className="info-item">
                        <span className="info-label">Root Path</span>
                        <span className="info-value mono">{app.root_path}</span>
                    </div>
                    {app.python_version && (
                        <div className="info-item">
                            <span className="info-label">Python Version</span>
                            <span className="info-value">{app.python_version}</span>
                        </div>
                    )}
                    {app.php_version && (
                        <div className="info-item">
                            <span className="info-label">PHP Version</span>
                            <span className="info-value">{app.php_version}</span>
                        </div>
                    )}
                    {app.port && (
                        <div className="info-item">
                            <span className="info-label">Port</span>
                            <span className="info-value">{app.port}</span>
                        </div>
                    )}
                    <div className="info-item">
                        <span className="info-label">Created</span>
                        <span className="info-value">{new Date(app.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            {status && (
                <div className="card">
                    <h3>Process Status</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Service</span>
                            <span className="info-value mono">{status.service_name}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">State</span>
                            <span className="info-value">{status.active_state} ({status.sub_state})</span>
                        </div>
                        {status.main_pid !== '0' && (
                            <div className="info-item">
                                <span className="info-label">PID</span>
                                <span className="info-value mono">{status.main_pid}</span>
                            </div>
                        )}
                        {status.memory && status.memory !== '0' && (
                            <div className="info-item">
                                <span className="info-label">Memory</span>
                                <span className="info-value">{formatBytes(parseInt(status.memory))}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {app.domains && app.domains.length > 0 && (
                <div className="card">
                    <h3>Domains</h3>
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
            )}
        </div>
    );
};

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

const EnvironmentTab = ({ appId }) => {
    const [envVars, setEnvVars] = useState({});
    const [loading, setLoading] = useState(true);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');

    useEffect(() => {
        loadEnvVars();
    }, [appId]);

    async function loadEnvVars() {
        try {
            const data = await api.getPythonEnvVars(appId);
            setEnvVars(data.env_vars || {});
        } catch (err) {
            console.error('Failed to load env vars:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAdd(e) {
        e.preventDefault();
        if (!newKey.trim()) return;

        try {
            await api.setPythonEnvVars(appId, { [newKey]: newValue });
            setNewKey('');
            setNewValue('');
            loadEnvVars();
        } catch (err) {
            console.error('Failed to add env var:', err);
        }
    }

    async function handleDelete(key) {
        if (!confirm(`Delete ${key}?`)) return;

        try {
            await api.deletePythonEnvVar(appId, key);
            loadEnvVars();
        } catch (err) {
            console.error('Failed to delete env var:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading environment variables...</div>;
    }

    return (
        <div>
            <h3>Environment Variables</h3>
            <p className="hint">Changes require app restart to take effect.</p>

            <form className="env-form" onSubmit={handleAdd}>
                <input
                    type="text"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="KEY"
                />
                <input
                    type="text"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="value"
                />
                <button type="submit" className="btn btn-primary">Add</button>
            </form>

            <div className="env-list">
                {Object.entries(envVars).map(([key, value]) => (
                    <div key={key} className="env-item">
                        <span className="env-key">{key}</span>
                        <span className="env-value">{value}</span>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDelete(key)}
                        >
                            Delete
                        </button>
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

const LogsTab = ({ app }) => {
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [logType, setLogType] = useState('access');

    useEffect(() => {
        loadLogs();
    }, [app, logType]);

    async function loadLogs() {
        setLoading(true);
        try {
            const data = await api.getAppLogs(app.name, logType, 200);
            setLogs(data.content || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <div className="section-header">
                <h3>Application Logs</h3>
                <div className="log-controls">
                    <select value={logType} onChange={(e) => setLogType(e.target.value)}>
                        <option value="access">Access Log</option>
                        <option value="error">Error Log</option>
                    </select>
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

    return (
        <div>
            <h3>Application Settings</h3>

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
    const [webhookLogs, setWebhookLogs] = useState([]);
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showWebhookLogs, setShowWebhookLogs] = useState(false);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [error, setError] = useState(null);

    // Config form state
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
                // Load git status if configured
                try {
                    const statusRes = await api.getGitStatus(appId);
                    setGitStatus(statusRes);
                } catch (e) {
                    // Git status may fail if not a git repo yet
                }
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

    async function loadBranchesFromUrl(repoUrl) {
        if (!repoUrl) return;
        setLoadingBranches(true);
        try {
            const result = await api.getBranchesFromUrl(repoUrl);
            if (result.success) {
                setBranches(result.branches || []);
            }
        } catch (err) {
            console.error('Failed to load branches:', err);
        } finally {
            setLoadingBranches(false);
        }
    }

    async function loadBranchesFromApp() {
        setLoadingBranches(true);
        try {
            const result = await api.getAppBranches(appId);
            if (result.success) {
                setBranches(result.branches || []);
            }
        } catch (err) {
            console.error('Failed to load branches:', err);
        } finally {
            setLoadingBranches(false);
        }
    }

    async function loadWebhookLogs() {
        try {
            const result = await api.getWebhookLogs(appId, 20);
            setWebhookLogs(result.logs || []);
        } catch (err) {
            console.error('Failed to load webhook logs:', err);
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

    function formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleString();
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
                                <div className="info-item">
                                    <span className="info-label">Deploy Count</span>
                                    <span className="info-value">{config.deploy_count || 0}</span>
                                </div>
                                {config.last_deploy && (
                                    <div className="info-item">
                                        <span className="info-label">Last Deploy</span>
                                        <span className="info-value">{formatTimestamp(config.last_deploy)}</span>
                                    </div>
                                )}
                            </div>
                            <div className="card-actions">
                                <button className="btn btn-secondary btn-sm" onClick={() => setShowConfigModal(true)}>
                                    Edit Configuration
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={handleRemoveDeployment}>
                                    Remove
                                </button>
                            </div>
                        </div>

                        {gitStatus && !gitStatus.error && (
                            <div className="card">
                                <h3>Git Status</h3>
                                <div className="info-list">
                                    <div className="info-item">
                                        <span className="info-label">Current Branch</span>
                                        <span className="info-value">{gitStatus.branch}</span>
                                    </div>
                                    {gitStatus.commit && (
                                        <>
                                            <div className="info-item">
                                                <span className="info-label">Commit</span>
                                                <span className="info-value mono">{gitStatus.commit.short_hash}</span>
                                            </div>
                                            <div className="info-item">
                                                <span className="info-label">Message</span>
                                                <span className="info-value">{gitStatus.commit.message}</span>
                                            </div>
                                            <div className="info-item">
                                                <span className="info-label">Author</span>
                                                <span className="info-value">{gitStatus.commit.author}</span>
                                            </div>
                                        </>
                                    )}
                                    <div className="info-item">
                                        <span className="info-label">Uncommitted Changes</span>
                                        <span className="info-value">
                                            {gitStatus.has_uncommitted ? `${gitStatus.changes} file(s)` : 'None'}
                                        </span>
                                    </div>
                                    {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                                        <div className="info-item">
                                            <span className="info-label">Remote Status</span>
                                            <span className="info-value">
                                                {gitStatus.ahead > 0 && `${gitStatus.ahead} ahead`}
                                                {gitStatus.ahead > 0 && gitStatus.behind > 0 && ', '}
                                                {gitStatus.behind > 0 && `${gitStatus.behind} behind`}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="card">
                            <h3>Webhook</h3>
                            <p className="hint">Use this URL in your Git provider to trigger automatic deployments on push.</p>
                            <div className="webhook-url">
                                <code>{window.location.origin}/api/v1/deploy/webhook/{appId}/{config.webhook_token}</code>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        navigator.clipboard.writeText(
                                            `${window.location.origin}/api/v1/deploy/webhook/${appId}/${config.webhook_token}`
                                        );
                                        toast.success('Webhook URL copied to clipboard');
                                    }}
                                >
                                    Copy
                                </button>
                            </div>
                            <div className="webhook-logs-toggle">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setShowWebhookLogs(!showWebhookLogs);
                                        if (!showWebhookLogs) loadWebhookLogs();
                                    }}
                                >
                                    {showWebhookLogs ? 'Hide Webhook Logs' : 'Show Webhook Logs'}
                                </button>
                            </div>
                            {showWebhookLogs && (
                                <div className="webhook-logs">
                                    <div className="webhook-logs-header">
                                        <h4>Recent Webhook Requests</h4>
                                        <button className="btn btn-secondary btn-sm" onClick={loadWebhookLogs}>
                                            Refresh
                                        </button>
                                    </div>
                                    {webhookLogs.length === 0 ? (
                                        <p className="hint">No webhook requests received yet.</p>
                                    ) : (
                                        <div className="webhook-logs-list">
                                            {webhookLogs.map((log, index) => (
                                                <div key={index} className="webhook-log-item">
                                                    <div className="webhook-log-header">
                                                        <span className={`provider-badge ${log.provider}`}>
                                                            {log.provider}
                                                        </span>
                                                        <span className="webhook-log-time">
                                                            {new Date(log.timestamp).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <div className="webhook-log-details">
                                                        <span className="webhook-log-size">
                                                            Payload: {log.payload_size} bytes
                                                        </span>
                                                    </div>
                                                    {log.payload_preview && (
                                                        <pre className="webhook-log-preview">
                                                            {log.payload_preview.substring(0, 200)}
                                                            {log.payload_preview.length > 200 && '...'}
                                                        </pre>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {(config.pre_deploy_script || config.post_deploy_script) && (
                        <div className="card">
                            <h3>Deploy Scripts</h3>
                            <div className="scripts-grid">
                                {config.pre_deploy_script && (
                                    <div className="script-section">
                                        <h4>Pre-Deploy Script</h4>
                                        <pre className="script-code">{config.pre_deploy_script}</pre>
                                    </div>
                                )}
                                {config.post_deploy_script && (
                                    <div className="script-section">
                                        <h4>Post-Deploy Script</h4>
                                        <pre className="script-code">{config.post_deploy_script}</pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="card">
                        <h3>Deployment History</h3>
                        {history.length === 0 ? (
                            <p className="hint">No deployments yet.</p>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Status</th>
                                        <th>Started</th>
                                        <th>Completed</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((deploy, index) => (
                                        <tr key={index}>
                                            <td>
                                                <span className={`badge ${getStatusBadgeClass(deploy.status)}`}>
                                                    {deploy.status}
                                                </span>
                                            </td>
                                            <td>{formatTimestamp(deploy.started_at)}</td>
                                            <td>{deploy.completed_at ? formatTimestamp(deploy.completed_at) : '-'}</td>
                                            <td>
                                                {deploy.error && <span className="text-danger">{deploy.error}</span>}
                                                {deploy.steps && (
                                                    <span className="text-muted">
                                                        {deploy.steps.length} step(s)
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}

            {/* Configure Deployment Modal */}
            {showConfigModal && (
                <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{config ? 'Edit Deployment' : 'Configure Deployment'}</h2>
                            <button className="modal-close" onClick={() => setShowConfigModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleConfigureDeployment}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Repository URL *</label>
                                    <div className="input-with-action">
                                        <input
                                            type="url"
                                            value={configForm.repoUrl}
                                            onChange={(e) => setConfigForm({...configForm, repoUrl: e.target.value})}
                                            placeholder="https://github.com/user/repo.git"
                                            required
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => loadBranchesFromUrl(configForm.repoUrl)}
                                            disabled={!configForm.repoUrl || loadingBranches}
                                        >
                                            {loadingBranches ? 'Loading...' : 'Fetch Branches'}
                                        </button>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Branch</label>
                                    {branches.length > 0 ? (
                                        <select
                                            value={configForm.branch}
                                            onChange={(e) => setConfigForm({...configForm, branch: e.target.value})}
                                        >
                                            {branches.map(branch => (
                                                <option key={branch} value={branch}>{branch}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input
                                            type="text"
                                            value={configForm.branch}
                                            onChange={(e) => setConfigForm({...configForm, branch: e.target.value})}
                                            placeholder="main"
                                        />
                                    )}
                                    <span className="form-help">
                                        {branches.length > 0
                                            ? `${branches.length} branches available`
                                            : 'Click "Fetch Branches" to load available branches'}
                                    </span>
                                </div>

                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={configForm.autoDeploy}
                                            onChange={(e) => setConfigForm({...configForm, autoDeploy: e.target.checked})}
                                        />
                                        <span>Enable Auto Deploy on Webhook</span>
                                    </label>
                                </div>

                                <div className="form-group">
                                    <label>Pre-Deploy Script (optional)</label>
                                    <textarea
                                        value={configForm.preDeployScript}
                                        onChange={(e) => setConfigForm({...configForm, preDeployScript: e.target.value})}
                                        placeholder="npm install&#10;npm run build"
                                        rows={3}
                                    />
                                    <span className="form-help">Commands to run before pulling changes</span>
                                </div>

                                <div className="form-group">
                                    <label>Post-Deploy Script (optional)</label>
                                    <textarea
                                        value={configForm.postDeployScript}
                                        onChange={(e) => setConfigForm({...configForm, postDeployScript: e.target.value})}
                                        placeholder="npm install&#10;npm run build&#10;systemctl restart myapp"
                                        rows={3}
                                    />
                                    <span className="form-help">Commands to run after pulling changes</span>
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowConfigModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {config ? 'Update Configuration' : 'Configure Deployment'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default ApplicationDetail;
