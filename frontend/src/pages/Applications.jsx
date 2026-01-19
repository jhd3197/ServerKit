import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Plus, Package, Grid, List, Play, Square, RotateCcw, Settings,
    Search, X, ChevronDown, Check, Trash2, AlertTriangle, Link2,
    Globe, Container, Clock, GitBranch
} from 'lucide-react';
import api from '../services/api';

// View mode persistence key
const VIEW_MODE_KEY = 'serverkit-apps-view-mode';

const Applications = () => {
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // View mode from localStorage
    const [viewMode, setViewMode] = useState(() => {
        return localStorage.getItem(VIEW_MODE_KEY) || 'list';
    });

    // Bulk selection state
    const [selectedApps, setSelectedApps] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    // Confirmation modal state
    const [confirmModal, setConfirmModal] = useState(null);

    // Action in progress tracking
    const [actionInProgress, setActionInProgress] = useState({});

    // Get filter values from URL params
    const searchQuery = searchParams.get('search') || '';
    const sortBy = searchParams.get('sort') || 'name-asc';

    useEffect(() => {
        loadApps();
    }, []);

    // Persist view mode
    useEffect(() => {
        localStorage.setItem(VIEW_MODE_KEY, viewMode);
    }, [viewMode]);

    async function loadApps() {
        try {
            const data = await api.getApps();
            setApps(data.apps || []);
        } catch (err) {
            console.error('Failed to load apps:', err);
        } finally {
            setLoading(false);
        }
    }

    function updateFilters(updates) {
        const newParams = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            if (value) {
                newParams.set(key, value);
            } else {
                newParams.delete(key);
            }
        });
        setSearchParams(newParams, { replace: true });
    }

    // Sort and filter apps
    const filteredApps = useMemo(() => {
        let result = [...apps];

        // Filter by search
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(app =>
                app.name.toLowerCase().includes(query) ||
                app.app_type.toLowerCase().includes(query)
            );
        }

        // Sort
        result.sort((a, b) => {
            switch (sortBy) {
                case 'name-asc':
                    return a.name.localeCompare(b.name);
                case 'name-desc':
                    return b.name.localeCompare(a.name);
                case 'status':
                    // Running first, then stopped, then others
                    const statusOrder = { running: 0, stopped: 1, error: 2 };
                    return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
                case 'type':
                    return a.app_type.localeCompare(b.app_type);
                case 'created':
                    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
                default:
                    return 0;
            }
        });

        return result;
    }, [apps, searchQuery, sortBy]);

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

    function getStatusClass(status) {
        switch (status) {
            case 'running': return 'status-active';
            case 'stopped': return 'status-stopped';
            case 'error': return 'status-error';
            default: return 'status-warning';
        }
    }

    async function handleAction(appId, action) {
        setActionInProgress(prev => ({ ...prev, [appId]: action }));
        try {
            if (action === 'start') {
                await api.startApp(appId);
            } else if (action === 'stop') {
                await api.stopApp(appId);
            } else if (action === 'restart') {
                await api.restartApp(appId);
            }
            await loadApps();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
        } finally {
            setActionInProgress(prev => {
                const copy = { ...prev };
                delete copy[appId];
                return copy;
            });
        }
    }

    // Bulk selection handlers
    function toggleSelectApp(appId) {
        setSelectedApps(prev => {
            const next = new Set(prev);
            if (next.has(appId)) {
                next.delete(appId);
            } else {
                next.add(appId);
            }
            return next;
        });
    }

    function toggleSelectAll() {
        if (selectedApps.size === filteredApps.length) {
            setSelectedApps(new Set());
        } else {
            setSelectedApps(new Set(filteredApps.map(app => app.id)));
        }
    }

    async function handleBulkAction(action) {
        if (selectedApps.size === 0) return;

        if (action === 'delete') {
            setConfirmModal({
                title: 'Delete Applications',
                message: `Are you sure you want to delete ${selectedApps.size} application(s)? This action cannot be undone.`,
                confirmText: 'Delete',
                danger: true,
                onConfirm: async () => {
                    setBulkLoading(true);
                    try {
                        for (const appId of selectedApps) {
                            await api.deleteApp(appId);
                        }
                        setSelectedApps(new Set());
                        await loadApps();
                    } catch (err) {
                        console.error('Bulk delete failed:', err);
                    } finally {
                        setBulkLoading(false);
                        setConfirmModal(null);
                    }
                }
            });
            return;
        }

        setBulkLoading(true);
        try {
            for (const appId of selectedApps) {
                if (action === 'start') {
                    await api.startApp(appId);
                } else if (action === 'stop') {
                    await api.stopApp(appId);
                } else if (action === 'restart') {
                    await api.restartApp(appId);
                }
            }
            await loadApps();
        } catch (err) {
            console.error(`Bulk ${action} failed:`, err);
        } finally {
            setBulkLoading(false);
        }
    }

    function clearSelection() {
        setSelectedApps(new Set());
    }

    if (loading) {
        return <div className="loading">Loading applications...</div>;
    }

    const isAllSelected = filteredApps.length > 0 && selectedApps.size === filteredApps.length;
    const isSomeSelected = selectedApps.size > 0;

    return (
        <div className="applications-page">
            <header className="top-bar">
                <div>
                    <h1>Applications</h1>
                    <div className="subtitle">Manage your web applications</div>
                </div>
                <div className="top-bar-actions">
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} />
                        New Application
                    </button>
                </div>
            </header>

            {/* Toolbar with search, sort, and view toggle */}
            <div className="apps-toolbar">
                <div className="apps-toolbar-left">
                    {/* Search */}
                    <div className="apps-search-wrapper">
                        <Search size={16} className="apps-search-icon" />
                        <input
                            type="text"
                            className="apps-search-input"
                            placeholder="Search applications..."
                            value={searchQuery}
                            onChange={(e) => updateFilters({ search: e.target.value })}
                        />
                        {searchQuery && (
                            <button
                                className="apps-search-clear"
                                onClick={() => updateFilters({ search: '' })}
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Results count */}
                    <span className="apps-count">
                        {filteredApps.length} {filteredApps.length === 1 ? 'app' : 'apps'}
                    </span>
                </div>

                <div className="apps-toolbar-right">
                    {/* Sort dropdown */}
                    <div className="apps-sort-wrapper">
                        <select
                            className="apps-sort-select"
                            value={sortBy}
                            onChange={(e) => updateFilters({ sort: e.target.value })}
                        >
                            <option value="name-asc">Name (A-Z)</option>
                            <option value="name-desc">Name (Z-A)</option>
                            <option value="status">Status</option>
                            <option value="type">Type</option>
                            <option value="created">Newest First</option>
                        </select>
                        <ChevronDown size={14} className="apps-sort-icon" />
                    </div>

                    {/* View toggle */}
                    <div className="apps-view-toggle">
                        <button
                            className={`apps-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                            title="List view"
                        >
                            <List size={16} />
                        </button>
                        <button
                            className={`apps-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title="Grid view"
                        >
                            <Grid size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Bulk action bar */}
            {isSomeSelected && (
                <div className="apps-bulk-bar">
                    <div className="apps-bulk-info">
                        <Check size={16} />
                        <span>{selectedApps.size} selected</span>
                        <button className="apps-bulk-clear" onClick={clearSelection}>
                            Clear
                        </button>
                    </div>
                    <div className="apps-bulk-actions">
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleBulkAction('start')}
                            disabled={bulkLoading}
                        >
                            <Play size={14} />
                            Start
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleBulkAction('stop')}
                            disabled={bulkLoading}
                        >
                            <Square size={14} />
                            Stop
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleBulkAction('restart')}
                            disabled={bulkLoading}
                        >
                            <RotateCcw size={14} />
                            Restart
                        </button>
                        <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleBulkAction('delete')}
                            disabled={bulkLoading}
                        >
                            <Trash2 size={14} />
                            Delete
                        </button>
                    </div>
                </div>
            )}

            {apps.length === 0 ? (
                <div className="empty-state">
                    <Package size={48} strokeWidth={1.5} />
                    <h3>No applications yet</h3>
                    <p>Create your first application to get started.</p>
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} />
                        Create Application
                    </button>
                </div>
            ) : filteredApps.length === 0 ? (
                <div className="empty-state">
                    <Search size={48} strokeWidth={1.5} />
                    <h3>No matching applications</h3>
                    <p>Try adjusting your search query.</p>
                    <button className="btn btn-secondary" onClick={() => updateFilters({ search: '' })}>
                        Clear Search
                    </button>
                </div>
            ) : viewMode === 'list' ? (
                <div className="apps-list">
                    {/* List header with select all */}
                    <div className="apps-list-header">
                        <label className="apps-checkbox-label">
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={toggleSelectAll}
                            />
                            <span className="apps-checkbox-custom" />
                        </label>
                        <span className="apps-list-header-text">Application</span>
                    </div>

                    {filteredApps.map(app => (
                        <AppRow
                            key={app.id}
                            app={app}
                            selected={selectedApps.has(app.id)}
                            onSelect={() => toggleSelectApp(app.id)}
                            onAction={handleAction}
                            onManage={() => navigate(`/apps/${app.id}`)}
                            actionInProgress={actionInProgress[app.id]}
                            getStackColor={getStackColor}
                            getStatusClass={getStatusClass}
                        />
                    ))}
                </div>
            ) : (
                <div className="apps-grid">
                    {filteredApps.map(app => (
                        <AppCard
                            key={app.id}
                            app={app}
                            selected={selectedApps.has(app.id)}
                            onSelect={() => toggleSelectApp(app.id)}
                            onAction={handleAction}
                            onManage={() => navigate(`/apps/${app.id}`)}
                            actionInProgress={actionInProgress[app.id]}
                            getStackColor={getStackColor}
                            getStatusClass={getStatusClass}
                        />
                    ))}
                </div>
            )}

            {showCreateModal && (
                <CreateAppModal onClose={() => setShowCreateModal(false)} onCreated={loadApps} />
            )}

            {confirmModal && (
                <ConfirmModal
                    {...confirmModal}
                    onCancel={() => setConfirmModal(null)}
                    loading={bulkLoading}
                />
            )}
        </div>
    );
};

// Environment badge helper
const EnvironmentBadge = ({ app }) => {
    if (!app.environment_type || app.environment_type === 'standalone') {
        return null;
    }

    const envLabels = {
        production: 'PROD',
        development: 'DEV',
        staging: 'STAGING'
    };

    return (
        <span className={`env-badge env-${app.environment_type}`} title={app.has_linked_app ? 'Linked to another app' : ''}>
            {envLabels[app.environment_type] || app.environment_type.toUpperCase()}
            {app.has_linked_app && <GitBranch size={10} className="env-linked-icon" />}
        </span>
    );
};

// App Row component for list view
const AppRow = ({ app, selected, onSelect, onAction, onManage, actionInProgress, getStackColor, getStatusClass }) => {
    const isTransitioning = !!actionInProgress;

    return (
        <div className={`app-row ${selected ? 'selected' : ''}`}>
            <label className="apps-checkbox-label" onClick={e => e.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onSelect}
                />
                <span className="apps-checkbox-custom" />
            </label>

            <div className="app-info">
                <div className="app-icon" style={{ background: getStackColor(app.app_type) }}>
                    {app.app_type === 'docker' ? (
                        <Container size={16} />
                    ) : (
                        app.app_type === 'wordpress' ? 'W' : app.app_type.charAt(0).toUpperCase()
                    )}
                </div>
                <div className="app-details">
                    <h3>{app.name}</h3>
                    <div className="app-meta">
                        <span className="app-type-badge">{app.app_type.toUpperCase()}</span>
                        <EnvironmentBadge app={app} />
                        {app.php_version && <span>PHP {app.php_version}</span>}
                        {app.python_version && <span>Python {app.python_version}</span>}
                        {app.port && (
                            <span className="app-port">:{app.port}</span>
                        )}
                        {app.domains && app.domains.length > 0 && (
                            <span className="app-domains-info">
                                <Globe size={12} />
                                {app.domains.length === 1 ? (
                                    <a href={`https://${app.domains[0].name}`} target="_blank" rel="noopener noreferrer">
                                        {app.domains[0].name}
                                    </a>
                                ) : (
                                    <span>{app.domains.length} domains</span>
                                )}
                            </span>
                        )}
                        {app.private_url_enabled && (
                            <span className="private-url-indicator" title={`Private URL: /p/${app.private_slug}`}>
                                <Link2 size={12} />
                                Private
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="app-status">
                <span className={`status-badge-enhanced ${getStatusClass(app.status)} ${isTransitioning ? 'transitioning' : ''}`}>
                    <span className="status-dot-animated" />
                    {isTransitioning ? (
                        <span className="status-text">{actionInProgress}ing...</span>
                    ) : (
                        <span className="status-text">{app.status}</span>
                    )}
                </span>
            </div>

            <div className="app-actions">
                {app.status === 'running' ? (
                    <>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onAction(app.id, 'restart')}
                            disabled={isTransitioning}
                            title="Restart"
                        >
                            <RotateCcw size={14} />
                            <span className="btn-text">Restart</span>
                        </button>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onAction(app.id, 'stop')}
                            disabled={isTransitioning}
                            title="Stop"
                        >
                            <Square size={14} />
                            <span className="btn-text">Stop</span>
                        </button>
                    </>
                ) : (
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onAction(app.id, 'start')}
                        disabled={isTransitioning}
                        title="Start"
                    >
                        <Play size={14} />
                        <span className="btn-text">Start</span>
                    </button>
                )}
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={onManage}
                    title="Manage"
                >
                    <Settings size={14} />
                    <span className="btn-text">Manage</span>
                </button>
            </div>
        </div>
    );
};

// App Card component for grid view
const AppCard = ({ app, selected, onSelect, onAction, onManage, actionInProgress, getStackColor, getStatusClass }) => {
    const isTransitioning = !!actionInProgress;

    return (
        <div className={`app-card ${selected ? 'selected' : ''}`} onClick={onManage}>
            <label className="apps-checkbox-label app-card-checkbox" onClick={e => e.stopPropagation()}>
                <input
                    type="checkbox"
                    checked={selected}
                    onChange={onSelect}
                />
                <span className="apps-checkbox-custom" />
            </label>

            <div className="app-card-header">
                <div className="app-icon" style={{ background: getStackColor(app.app_type) }}>
                    {app.app_type === 'docker' ? (
                        <Container size={18} />
                    ) : (
                        app.app_type === 'wordpress' ? 'W' : app.app_type.charAt(0).toUpperCase()
                    )}
                </div>
                <span className={`status-badge-enhanced ${getStatusClass(app.status)} ${isTransitioning ? 'transitioning' : ''}`}>
                    <span className="status-dot-animated" />
                    {isTransitioning ? `${actionInProgress}ing...` : app.status}
                </span>
            </div>

            <div className="app-card-body">
                <h3>{app.name}</h3>
                <div className="app-card-meta">
                    <span className="app-type-badge">{app.app_type.toUpperCase()}</span>
                    <EnvironmentBadge app={app} />
                    {app.port && <span className="app-port">:{app.port}</span>}
                </div>

                <div className="app-card-info">
                    {app.domains && app.domains.length > 0 && (
                        <div className="app-card-info-row">
                            <Globe size={12} />
                            <span>{app.domains.length} domain{app.domains.length !== 1 ? 's' : ''}</span>
                        </div>
                    )}
                    {app.private_url_enabled && (
                        <div className="app-card-info-row">
                            <Link2 size={12} />
                            <span>Private URL</span>
                        </div>
                    )}
                    {app.has_linked_app && (
                        <div className="app-card-info-row">
                            <GitBranch size={12} />
                            <span>Linked</span>
                        </div>
                    )}
                    {app.container_count && (
                        <div className="app-card-info-row">
                            <Container size={12} />
                            <span>{app.container_count} container{app.container_count !== 1 ? 's' : ''}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="app-card-actions" onClick={e => e.stopPropagation()}>
                {app.status === 'running' ? (
                    <>
                        <button
                            className="btn btn-secondary btn-sm btn-icon"
                            onClick={() => onAction(app.id, 'restart')}
                            disabled={isTransitioning}
                            title="Restart"
                        >
                            <RotateCcw size={14} />
                        </button>
                        <button
                            className="btn btn-secondary btn-sm btn-icon"
                            onClick={() => onAction(app.id, 'stop')}
                            disabled={isTransitioning}
                            title="Stop"
                        >
                            <Square size={14} />
                        </button>
                    </>
                ) : (
                    <button
                        className="btn btn-primary btn-sm btn-icon"
                        onClick={() => onAction(app.id, 'start')}
                        disabled={isTransitioning}
                        title="Start"
                    >
                        <Play size={14} />
                    </button>
                )}
            </div>
        </div>
    );
};

// Confirmation Modal component
const ConfirmModal = ({ title, message, confirmText, danger, onConfirm, onCancel, loading }) => {
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
                <div className="confirm-modal-header">
                    {danger && <AlertTriangle size={24} className="confirm-icon-danger" />}
                    <h2>{title}</h2>
                </div>
                <p className="confirm-modal-message">{message}</p>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
                        Cancel
                    </button>
                    <button
                        className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

const CreateAppModal = ({ onClose, onCreated }) => {
    const [step, setStep] = useState(1);
    const [appType, setAppType] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        app_type: '',
        php_version: '8.2',
        python_version: '3.11',
        port: 8000,
        root_path: '/var/www/',
        // WordPress specific
        site_url: '',
        site_title: '',
        admin_user: 'admin',
        admin_email: '',
        db_name: '',
        db_user: '',
        db_password: '',
        // Docker specific
        docker_image: '',
        docker_ports: '',
        docker_volumes: '',
        docker_env: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const appTypes = [
        { id: 'wordpress', name: 'WordPress', icon: 'W', color: '#21759b', description: 'Full WordPress installation with WP-CLI' },
        { id: 'php', name: 'PHP', icon: 'P', color: '#777bb4', description: 'PHP application with FPM' },
        { id: 'flask', name: 'Flask', icon: 'F', color: '#fcd34d', description: 'Python Flask application' },
        { id: 'django', name: 'Django', icon: 'D', color: '#34d399', description: 'Python Django application' },
        { id: 'docker', name: 'Docker', icon: 'D', color: '#2496ed', description: 'Docker container application' },
        { id: 'static', name: 'Static', icon: 'S', color: '#60a5fa', description: 'Static HTML/CSS/JS site' },
    ];

    function handleChange(e) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    }

    function selectAppType(type) {
        setAppType(type);
        setFormData({ ...formData, app_type: type, root_path: `/var/www/${formData.name || 'mysite'}` });
        setStep(2);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (appType === 'wordpress') {
                await api.installWordPress({
                    path: formData.root_path,
                    site_url: formData.site_url,
                    site_title: formData.site_title || formData.name,
                    admin_user: formData.admin_user,
                    admin_email: formData.admin_email,
                    db_name: formData.db_name,
                    db_user: formData.db_user,
                    db_password: formData.db_password,
                    php_version: formData.php_version,
                });
            } else if (appType === 'flask') {
                await api.createFlaskApp({
                    name: formData.name,
                    path: formData.root_path,
                    python_version: formData.python_version,
                    port: formData.port,
                    workers: formData.workers || 2,
                });
            } else if (appType === 'django') {
                await api.createDjangoApp({
                    name: formData.name,
                    path: formData.root_path,
                    python_version: formData.python_version,
                    port: formData.port,
                    workers: formData.workers || 2,
                });
            } else if (appType === 'docker') {
                const ports = formData.docker_ports ? formData.docker_ports.split(',').map(p => p.trim()) : [];
                const volumes = formData.docker_volumes ? formData.docker_volumes.split(',').map(v => v.trim()) : [];
                const env = formData.docker_env ? Object.fromEntries(
                    formData.docker_env.split('\n').filter(l => l.includes('=')).map(l => {
                        const [key, ...rest] = l.split('=');
                        return [key.trim(), rest.join('=').trim()];
                    })
                ) : {};

                await api.createDockerApp({
                    name: formData.name,
                    path: formData.root_path,
                    image: formData.docker_image,
                    ports,
                    volumes,
                    env,
                });
            } else {
                await api.createApp({
                    name: formData.name,
                    app_type: appType,
                    php_version: appType === 'php' ? formData.php_version : null,
                    root_path: formData.root_path,
                });
            }

            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create application');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{step === 1 ? 'Select Application Type' : `Create ${appTypes.find(t => t.id === appType)?.name} App`}</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {error && <div className="error-message">{error}</div>}

                {step === 1 ? (
                    <div className="app-type-grid">
                        {appTypes.map(type => (
                            <button
                                key={type.id}
                                className="app-type-card"
                                onClick={() => selectAppType(type.id)}
                            >
                                <div className="app-type-icon" style={{ background: type.color }}>
                                    {type.id === 'docker' ? <Container size={20} /> : type.icon}
                                </div>
                                <h3>{type.name}</h3>
                                <p>{type.description}</p>
                            </button>
                        ))}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Site Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="My Awesome Site"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Root Path</label>
                            <input
                                type="text"
                                name="root_path"
                                value={formData.root_path}
                                onChange={handleChange}
                                placeholder="/var/www/mysite"
                                required
                            />
                        </div>

                        {appType === 'wordpress' && (
                            <>
                                <div className="form-group">
                                    <label>Site URL</label>
                                    <input
                                        type="url"
                                        name="site_url"
                                        value={formData.site_url}
                                        onChange={handleChange}
                                        placeholder="https://example.com"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Admin Email</label>
                                    <input
                                        type="email"
                                        name="admin_email"
                                        value={formData.admin_email}
                                        onChange={handleChange}
                                        placeholder="admin@example.com"
                                        required
                                    />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Database Name</label>
                                        <input
                                            type="text"
                                            name="db_name"
                                            value={formData.db_name}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Database User</label>
                                        <input
                                            type="text"
                                            name="db_user"
                                            value={formData.db_user}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Database Password</label>
                                    <input
                                        type="password"
                                        name="db_password"
                                        value={formData.db_password}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </>
                        )}

                        {(appType === 'php' || appType === 'wordpress') && (
                            <div className="form-group">
                                <label>PHP Version</label>
                                <select name="php_version" value={formData.php_version} onChange={handleChange}>
                                    <option value="8.0">PHP 8.0</option>
                                    <option value="8.1">PHP 8.1</option>
                                    <option value="8.2">PHP 8.2</option>
                                    <option value="8.3">PHP 8.3</option>
                                </select>
                            </div>
                        )}

                        {['flask', 'django'].includes(appType) && (
                            <>
                                <div className="form-group">
                                    <label>Python Version</label>
                                    <select name="python_version" value={formData.python_version} onChange={handleChange}>
                                        <option value="3.9">Python 3.9</option>
                                        <option value="3.10">Python 3.10</option>
                                        <option value="3.11">Python 3.11</option>
                                        <option value="3.12">Python 3.12</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Port</label>
                                    <input
                                        type="number"
                                        name="port"
                                        value={formData.port}
                                        onChange={handleChange}
                                        min="1024"
                                        max="65535"
                                    />
                                </div>
                            </>
                        )}

                        {appType === 'docker' && (
                            <>
                                <div className="form-group">
                                    <label>Docker Image *</label>
                                    <input
                                        type="text"
                                        name="docker_image"
                                        value={formData.docker_image}
                                        onChange={handleChange}
                                        placeholder="nginx:latest, mysql:8, redis:alpine"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Ports (comma-separated)</label>
                                    <input
                                        type="text"
                                        name="docker_ports"
                                        value={formData.docker_ports}
                                        onChange={handleChange}
                                        placeholder="8080:80, 3306:3306"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Volumes (comma-separated)</label>
                                    <input
                                        type="text"
                                        name="docker_volumes"
                                        value={formData.docker_volumes}
                                        onChange={handleChange}
                                        placeholder="/host/data:/container/data"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Environment Variables (one per line, KEY=value)</label>
                                    <textarea
                                        name="docker_env"
                                        value={formData.docker_env}
                                        onChange={handleChange}
                                        placeholder="MYSQL_ROOT_PASSWORD=secret&#10;MYSQL_DATABASE=mydb"
                                        rows={4}
                                    />
                                </div>
                            </>
                        )}

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                                Back
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating...' : 'Create Application'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default Applications;
