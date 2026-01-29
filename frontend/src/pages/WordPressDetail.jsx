import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink, Settings, RefreshCw, Plus, Database, GitBranch, Package, Palette, Archive } from 'lucide-react';
import wordpressApi from '../services/wordpress';
import { useToast } from '../contexts/ToastContext';
import { EnvironmentCard, SnapshotTable, GitConnectForm, CommitList } from '../components/wordpress';
import { ErrorBoundary, ErrorState } from '../components/ErrorBoundary';

// Detail Page Skeleton for initial loading
const DetailPageSkeleton = () => (
    <div className="app-detail-page wp-detail-page">
        <div className="app-detail-topbar">
            <div className="app-detail-breadcrumbs">
                <span className="skeleton" style={{ width: 80, height: 16 }} />
                <span>/</span>
                <span className="skeleton" style={{ width: 120, height: 16 }} />
            </div>
        </div>
        <div className="app-detail-header">
            <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 8 }} />
            <div className="app-detail-title-block">
                <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 8 }} />
                <div className="skeleton" style={{ width: 300, height: 16 }} />
            </div>
        </div>
        <div className="app-detail-tabs" style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 7].map(i => (
                <div key={i} className="skeleton" style={{ width: 80, height: 32, borderRadius: 4 }} />
            ))}
        </div>
        <div className="app-detail-content">
            <div className="tab-loading">
                <div className="tab-loading-header">
                    <div className="tab-loading-title" />
                    <div className="tab-loading-btn" />
                </div>
                <div className="environments-grid">
                    <div className="wp-env-card-skeleton">
                        <div className="wp-env-card-skeleton-header">
                            <div className="wp-env-card-skeleton-badge" />
                            <div className="wp-env-card-skeleton-status" />
                        </div>
                        <div className="wp-env-card-skeleton-body">
                            <div className="wp-env-card-skeleton-url" />
                        </div>
                    </div>
                    <div className="wp-env-card-skeleton">
                        <div className="wp-env-card-skeleton-header">
                            <div className="wp-env-card-skeleton-badge" />
                            <div className="wp-env-card-skeleton-status" />
                        </div>
                        <div className="wp-env-card-skeleton-body">
                            <div className="wp-env-card-skeleton-url" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const WordPressDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [site, setSite] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        loadSite();
    }, [id]);

    async function loadSite() {
        try {
            const data = await wordpressApi.getSite(id);
            setSite(data.site || data);
        } catch (err) {
            console.error('Failed to load site:', err);
            toast.error('Failed to load WordPress site');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <DetailPageSkeleton />;
    }

    if (!site) {
        return (
            <div className="empty-state">
                <h3>Site not found</h3>
                <button className="btn btn-primary" onClick={() => navigate('/wordpress')}>
                    Back to WordPress Sites
                </button>
            </div>
        );
    }

    const isRunning = site.status === 'running';

    return (
        <div className="app-detail-page wp-detail-page">
            {/* Top Bar */}
            <div className="app-detail-topbar">
                <div className="app-detail-breadcrumbs">
                    <Link to="/wordpress">WordPress</Link>
                    <span>/</span>
                    <span className="current">{site.name}</span>
                </div>
                <div className="app-detail-actions">
                    {site.url && (
                        <>
                            <a
                                href={site.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost"
                            >
                                <ExternalLink size={16} />
                                Visit Site
                            </a>
                            <a
                                href={`${site.url}/wp-admin`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-ghost"
                            >
                                <Settings size={16} />
                                Dashboard
                            </a>
                        </>
                    )}
                </div>
            </div>

            {/* Header */}
            <div className="app-detail-header">
                <div className="app-detail-icon wp-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z"/>
                    </svg>
                </div>
                <div className="app-detail-title-block">
                    <h1>
                        {site.name}
                        <span className={`app-status-badge ${isRunning ? 'running' : 'stopped'}`}>
                            <span className="pulse-dot" />
                            {isRunning ? 'Running' : 'Stopped'}
                        </span>
                        {site.is_production && (
                            <span className="env-badge env-production">PROD</span>
                        )}
                        {!site.is_production && site.production_site_id && (
                            <span className="env-badge env-development">DEV</span>
                        )}
                    </h1>
                    <div className="app-detail-subtitle">
                        <span>WordPress {site.wp_version || ''}</span>
                        {site.url && (
                            <>
                                <span className="separator">•</span>
                                <span className="mono">{site.url}</span>
                            </>
                        )}
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
                    className={`app-detail-tab ${activeTab === 'environments' ? 'active' : ''}`}
                    onClick={() => setActiveTab('environments')}
                >
                    Environments
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'database' ? 'active' : ''}`}
                    onClick={() => setActiveTab('database')}
                >
                    <Database size={14} /> Database
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'plugins' ? 'active' : ''}`}
                    onClick={() => setActiveTab('plugins')}
                >
                    <Package size={14} /> Plugins
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'themes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('themes')}
                >
                    <Palette size={14} /> Themes
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'git' ? 'active' : ''}`}
                    onClick={() => setActiveTab('git')}
                >
                    <GitBranch size={14} /> Git
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'backups' ? 'active' : ''}`}
                    onClick={() => setActiveTab('backups')}
                >
                    <Archive size={14} /> Backups
                </div>
            </div>

            {/* Tab Content */}
            <div className="app-detail-content">
                <ErrorBoundary key={activeTab} onRetry={loadSite}>
                    {activeTab === 'overview' && <OverviewTab site={site} onUpdate={loadSite} />}
                    {activeTab === 'environments' && <EnvironmentsTab siteId={site.id} site={site} onUpdate={loadSite} />}
                    {activeTab === 'database' && <DatabaseTab siteId={site.id} site={site} />}
                    {activeTab === 'plugins' && <PluginsTab siteId={site.id} />}
                    {activeTab === 'themes' && <ThemesTab siteId={site.id} />}
                    {activeTab === 'git' && <GitTab siteId={site.id} site={site} onUpdate={loadSite} />}
                    {activeTab === 'backups' && <BackupsTab siteId={site.id} />}
                </ErrorBoundary>
            </div>
        </div>
    );
};

// Overview Tab
const OverviewTab = ({ site, onUpdate }) => {
    const toast = useToast();
    const [creatingSnapshot, setCreatingSnapshot] = useState(false);
    const [showEnvModal, setShowEnvModal] = useState(false);
    const [syncingAll, setSyncingAll] = useState(false);

    async function handleQuickSnapshot() {
        setCreatingSnapshot(true);
        toast.info('Creating snapshot...', { duration: 2000 });
        try {
            await wordpressApi.createSnapshot(site.id, {
                name: `Quick Snapshot ${new Date().toLocaleDateString()}`,
                tag: 'quick',
                description: 'Created from Overview quick action'
            });
            toast.success('Snapshot created successfully');
        } catch (err) {
            toast.error(err.message || 'Failed to create snapshot');
        } finally {
            setCreatingSnapshot(false);
        }
    }

    async function handleSyncAll() {
        if (!site.environments?.length) return;
        setSyncingAll(true);
        toast.info(`Syncing ${site.environments.length} environment(s)...`, { duration: 3000 });
        try {
            // Sync each environment sequentially
            for (let i = 0; i < site.environments.length; i++) {
                const env = site.environments[i];
                await wordpressApi.syncEnvironment(site.id, { environment_id: env.id });
            }
            toast.success(`Synced ${site.environments.length} environment(s) from production`);
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to sync environments');
        } finally {
            setSyncingAll(false);
        }
    }

    async function handleCreateEnvironment(data) {
        toast.info('Creating environment... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.createEnvironment(site.id, data);
            toast.success('Environment created successfully');
            setShowEnvModal(false);
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    return (
        <div className="app-overview-grid">
            <div className="app-overview-left">
                <div className="app-panel">
                    <div className="app-panel-header">Site Information</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">WordPress Version</span>
                                <span className="app-info-value">{site.wp_version || 'Unknown'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Multisite</span>
                                <span className="app-info-value">{site.multisite ? 'Yes' : 'No'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Admin User</span>
                                <span className="app-info-value">{site.admin_user || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Admin Email</span>
                                <span className="app-info-value">{site.admin_email || '-'}</span>
                            </div>
                            <div className="app-info-item full-width">
                                <span className="app-info-label">Site URL</span>
                                <span className="app-info-value">
                                    {site.url ? (
                                        <a href={site.url} target="_blank" rel="noopener noreferrer">
                                            {site.url}
                                        </a>
                                    ) : '-'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="app-panel">
                    <div className="app-panel-header">Database Configuration</div>
                    <div className="app-panel-body">
                        <div className="app-info-grid">
                            <div className="app-info-item">
                                <span className="app-info-label">Database Name</span>
                                <span className="app-info-value mono">{site.db_name || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Database User</span>
                                <span className="app-info-value mono">{site.db_user || '-'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Database Host</span>
                                <span className="app-info-value mono">{site.db_host || 'localhost'}</span>
                            </div>
                            <div className="app-info-item">
                                <span className="app-info-label">Table Prefix</span>
                                <span className="app-info-value mono">{site.db_prefix || 'wp_'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {site.git_repo_url && (
                    <div className="app-panel">
                        <div className="app-panel-header">Git Integration</div>
                        <div className="app-panel-body">
                            <div className="app-info-grid">
                                <div className="app-info-item full-width">
                                    <span className="app-info-label">Repository</span>
                                    <span className="app-info-value mono">{site.git_repo_url}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">Branch</span>
                                    <span className="app-info-value">{site.git_branch || 'main'}</span>
                                </div>
                                <div className="app-info-item">
                                    <span className="app-info-label">Auto Deploy</span>
                                    <span className="app-info-value">{site.auto_deploy ? 'Enabled' : 'Disabled'}</span>
                                </div>
                                {site.last_deploy_commit && (
                                    <div className="app-info-item">
                                        <span className="app-info-label">Last Deploy</span>
                                        <span className="app-info-value mono">{site.last_deploy_commit.substring(0, 7)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="app-overview-right">
                <div className="app-panel">
                    <div className="app-panel-header">Quick Actions</div>
                    <div className="app-panel-body">
                        <div className="quick-actions-grid">
                            {site.url && (
                                <>
                                    <a
                                        href={site.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="quick-action-btn"
                                    >
                                        <ExternalLink size={16} />
                                        Visit Site
                                    </a>
                                    <a
                                        href={`${site.url}/wp-admin`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="quick-action-btn"
                                    >
                                        <Settings size={16} />
                                        WP Admin
                                    </a>
                                </>
                            )}
                            {site.is_production && (site.environments || []).length < 2 && (
                                <button
                                    className="quick-action-btn"
                                    onClick={() => setShowEnvModal(true)}
                                >
                                    <Plus size={16} />
                                    Create Environment
                                </button>
                            )}
                            <button
                                className="quick-action-btn"
                                onClick={handleQuickSnapshot}
                                disabled={creatingSnapshot}
                            >
                                <Database size={16} />
                                {creatingSnapshot ? 'Creating...' : 'Create Snapshot'}
                            </button>
                            {site.environments?.length > 0 && (
                                <button
                                    className="quick-action-btn"
                                    onClick={handleSyncAll}
                                    disabled={syncingAll}
                                >
                                    <RefreshCw size={16} className={syncingAll ? 'spinning' : ''} />
                                    {syncingAll ? 'Syncing...' : 'Sync All Envs'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showEnvModal && (() => {
                const envs = site.environments || [];
                const modalHasStaging = envs.some(e => e.environment_type === 'staging');
                const modalHasDev = envs.some(e => e.environment_type === 'development');
                return (
                    <CreateEnvironmentModal
                        onClose={() => setShowEnvModal(false)}
                        onCreate={handleCreateEnvironment}
                        productionDomain={site.url}
                        hasStaging={modalHasStaging}
                        hasDev={modalHasDev}
                    />
                );
            })()}
        </div>
    );
};

// Reusable Skeleton Components for Tabs
const EnvironmentCardSkeleton = () => (
    <div className="wp-env-card-skeleton">
        <div className="wp-env-card-skeleton-header">
            <div className="wp-env-card-skeleton-badge" />
            <div className="wp-env-card-skeleton-status" />
        </div>
        <div className="wp-env-card-skeleton-body">
            <div className="wp-env-card-skeleton-url" />
            <div className="wp-env-card-skeleton-meta">
                <div className="wp-env-card-skeleton-meta-item">
                    <div className="skeleton-label" />
                    <div className="skeleton-value" />
                </div>
                <div className="wp-env-card-skeleton-meta-item">
                    <div className="skeleton-label" />
                    <div className="skeleton-value" />
                </div>
            </div>
        </div>
        <div className="wp-env-card-skeleton-footer">
            <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 4 }} />
            <div className="skeleton" style={{ flex: 1, height: 28, borderRadius: 4 }} />
        </div>
    </div>
);

const TableRowSkeleton = () => (
    <div className="skeleton-table-row">
        <div className="skeleton-cell cell-name" />
        <div className="skeleton-cell cell-tag" />
        <div className="skeleton-cell cell-size" />
        <div className="skeleton-cell cell-date" />
        <div className="skeleton-cell cell-actions" />
    </div>
);

const ListItemSkeleton = () => (
    <div className="skeleton" style={{ height: 48, borderRadius: 6, marginBottom: 8 }} />
);

// Environments Tab
const EnvironmentsTab = ({ siteId, site, onUpdate }) => {
    const toast = useToast();
    const [environments, setEnvironments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadEnvironments();
    }, [siteId]);

    async function loadEnvironments() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getEnvironments(siteId);
            setEnvironments(data.environments || []);
        } catch (err) {
            console.error('Failed to load environments:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateEnvironment(data) {
        toast.info('Creating environment... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.createEnvironment(siteId, data);
            toast.success('Environment created successfully');
            loadEnvironments();
            setShowCreateModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    async function handleSync(envId) {
        toast.info('Syncing from production...', { duration: 3000 });
        try {
            await wordpressApi.syncEnvironment(siteId, { environment_id: envId });
            toast.success('Environment synced from production');
            loadEnvironments();
        } catch (err) {
            toast.error(err.message || 'Failed to sync environment');
        }
    }

    async function handleDelete(envId) {
        toast.info('Deleting environment...', { duration: 2000 });
        try {
            await wordpressApi.deleteEnvironment(siteId, envId);
            toast.success('Environment deleted');
            loadEnvironments();
        } catch (err) {
            toast.error(err.message || 'Failed to delete environment');
        }
    }

    if (loading) {
        return (
            <div className="environments-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 120, height: 24 }} />
                    <div className="skeleton" style={{ width: 160, height: 36, borderRadius: 6 }} />
                </div>
                <div className="environments-grid">
                    <EnvironmentCardSkeleton />
                    <EnvironmentCardSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load environments"
                error={error}
                onRetry={loadEnvironments}
            />
        );
    }

    // Filter out production from the environments list (it's shown separately)
    const childEnvs = environments.filter(e => e.id !== site.id && !e.is_production);
    const hasStaging = childEnvs.some(e => e.environment_type === 'staging');
    const hasDev = childEnvs.some(e => e.environment_type === 'development');
    const canCreateMore = site.is_production && (!hasStaging || !hasDev);

    return (
        <div className="environments-tab">
            <div className="section-header">
                <h3>Environments</h3>
                {canCreateMore && (
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={14} /> Create Environment
                    </button>
                )}
            </div>

            <div className="environments-grid">
                {/* Production environment (the current site) */}
                <EnvironmentCard
                    environment={{
                        id: site.id,
                        name: site.name,
                        url: site.url,
                        status: site.status,
                        db_name: site.db_name,
                        type: 'production'
                    }}
                    isProduction={true}
                />

                {/* Dev/staging environments */}
                {childEnvs.map(env => (
                    <EnvironmentCard
                        key={env.id}
                        environment={env}
                        productionUrl={site.url}
                        onSync={handleSync}
                        onDelete={handleDelete}
                    />
                ))}
            </div>

            {childEnvs.length === 0 && site.is_production && (
                <div className="hint-box">
                    <p>No development or staging environments yet.</p>
                    <p>Create an environment to safely test changes before deploying to production.</p>
                </div>
            )}

            {showCreateModal && (
                <CreateEnvironmentModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateEnvironment}
                    productionDomain={site.url}
                    hasStaging={hasStaging}
                    hasDev={hasDev}
                />
            )}
        </div>
    );
};

// Create Environment Modal
const CreateEnvironmentModal = ({ onClose, onCreate, productionDomain, hasStaging = false, hasDev = false }) => {
    // Default to whichever type is still available
    const defaultType = !hasDev ? 'development' : !hasStaging ? 'staging' : 'development';
    const [formData, setFormData] = useState({
        type: defaultType,
        name: '',
        domain: '',
        cloneDb: true,
        syncSchedule: ''
    });
    const [loading, setLoading] = useState(false);

    // Generate suggested domain based on production domain
    function getSuggestedDomain() {
        if (!productionDomain) return '';
        try {
            const url = new URL(productionDomain);
            const prefix = formData.type === 'staging' ? 'staging' : 'dev';
            return `${prefix}.${url.hostname}`;
        } catch {
            return '';
        }
    }

    const suggestedDomain = getSuggestedDomain();
    const displayDomain = formData.domain || suggestedDomain;

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onCreate({
                type: formData.type,
                name: formData.name,
                domain: formData.domain || suggestedDomain,
                clone_db: formData.cloneDb,
                sync_schedule: formData.syncSchedule || null
            });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Environment</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Environment Type</label>
                        <select name="type" value={formData.type} onChange={handleChange}>
                            {!hasDev && <option value="development">Development</option>}
                            {!hasStaging && <option value="staging">Staging</option>}
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Environment Name *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="My Site Dev"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Domain</label>
                        <input
                            type="text"
                            name="domain"
                            value={formData.domain}
                            onChange={handleChange}
                            placeholder={suggestedDomain || 'dev.example.com'}
                        />
                        {suggestedDomain && !formData.domain && (
                            <span className="form-hint form-hint-domain">
                                Will use: <code>{suggestedDomain}</code>
                            </span>
                        )}
                        {!suggestedDomain && !formData.domain && (
                            <span className="form-hint">Enter a domain or leave empty to auto-generate</span>
                        )}
                    </div>

                    {displayDomain && (
                        <div className="env-preview-url">
                            <span className="preview-label">Environment URL:</span>
                            <span className="preview-url">https://{displayDomain}</span>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                name="cloneDb"
                                checked={formData.cloneDb}
                                onChange={handleChange}
                            />
                            <span>Clone production database</span>
                        </label>
                    </div>

                    <div className="form-group">
                        <label>Sync Schedule (optional)</label>
                        <select name="syncSchedule" value={formData.syncSchedule} onChange={handleChange}>
                            <option value="">No automatic sync</option>
                            <option value="0 3 * * 0">Weekly (Sunday 3am)</option>
                            <option value="0 3 * * *">Daily (3am)</option>
                        </select>
                        <span className="form-hint">Automatically sync database from production</span>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Environment'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Database Tab
const DatabaseTab = ({ siteId, site }) => {
    const toast = useToast();
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadSnapshots();
    }, [siteId]);

    async function loadSnapshots() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getSnapshots(siteId);
            setSnapshots(data.snapshots || []);
        } catch (err) {
            console.error('Failed to load snapshots:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateSnapshot(data) {
        toast.info('Creating snapshot...', { duration: 3000 });
        try {
            await wordpressApi.createSnapshot(siteId, data);
            toast.success('Snapshot created successfully');
            loadSnapshots();
            setShowCreateModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to create snapshot');
        }
    }

    async function handleRestore(snapId) {
        toast.info('Restoring database... This may take a moment.', { duration: 5000 });
        try {
            await wordpressApi.restoreSnapshot(siteId, snapId);
            toast.success('Database restored from snapshot');
        } catch (err) {
            toast.error(err.message || 'Failed to restore snapshot');
        }
    }

    async function handleDelete(snapId) {
        try {
            await wordpressApi.deleteSnapshot(siteId, snapId);
            toast.success('Snapshot deleted');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to delete snapshot');
        }
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load snapshots"
                error={error}
                onRetry={loadSnapshots}
            />
        );
    }

    return (
        <div className="database-tab">
            {/* Database Connection Info */}
            <div className="app-panel">
                <div className="app-panel-header">
                    <Database size={16} />
                    Database Connection
                </div>
                <div className="app-panel-body">
                    <div className="app-info-grid">
                        <div className="app-info-item">
                            <span className="app-info-label">Database Name</span>
                            <span className="app-info-value mono">{site?.db_name || 'wordpress'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Database User</span>
                            <span className="app-info-value mono">{site?.db_user || 'wordpress'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Database Host</span>
                            <span className="app-info-value mono">{site?.db_host || 'db'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Table Prefix</span>
                            <span className="app-info-value mono">{site?.db_prefix || 'wp_'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Container</span>
                            <span className="app-info-value mono">{site?.compose_project_name ? `${site.compose_project_name}-db` : '-'}</span>
                        </div>
                        <div className="app-info-item">
                            <span className="app-info-label">Engine</span>
                            <span className="app-info-value">MySQL 8.0</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Snapshots */}
            <div className="section-header" style={{ marginTop: 24 }}>
                <h3>Database Snapshots</h3>
                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                    <Plus size={14} /> Create Snapshot
                </button>
            </div>

            <SnapshotTable
                snapshots={snapshots}
                loading={loading}
                onRestore={handleRestore}
                onDelete={handleDelete}
            />

            {showCreateModal && (
                <CreateSnapshotModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateSnapshot}
                />
            )}
        </div>
    );
};

// Create Snapshot Modal
const CreateSnapshotModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: `Snapshot ${new Date().toLocaleDateString()}`,
        description: '',
        tag: ''
    });
    const [loading, setLoading] = useState(false);

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onCreate(formData);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Snapshot</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Snapshot Name *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Description</label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            placeholder="Optional description..."
                            rows={3}
                        />
                    </div>

                    <div className="form-group">
                        <label>Tag</label>
                        <input
                            type="text"
                            name="tag"
                            value={formData.tag}
                            onChange={handleChange}
                            placeholder="e.g., v1.0.0, before-update"
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Snapshot'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Plugins Tab
const PluginsTab = ({ siteId }) => {
    const toast = useToast();
    const [plugins, setPlugins] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [newPlugin, setNewPlugin] = useState('');

    useEffect(() => {
        loadPlugins();
    }, [siteId]);

    async function loadPlugins() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getPlugins(siteId);
            setPlugins(data.plugins || []);
        } catch (err) {
            console.error('Failed to load plugins:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newPlugin.trim()) return;

        setInstalling(true);
        try {
            await wordpressApi.installPlugin(siteId, { slug: newPlugin.trim() });
            toast.success('Plugin installed successfully');
            setNewPlugin('');
            loadPlugins();
        } catch (err) {
            toast.error(err.message || 'Failed to install plugin');
        } finally {
            setInstalling(false);
        }
    }

    if (loading) {
        return (
            <div className="plugins-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 80, height: 24 }} />
                </div>
                <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 16 }} />
                <div className="plugins-list">
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load plugins"
                error={error}
                onRetry={loadPlugins}
            />
        );
    }

    return (
        <div className="plugins-tab">
            <div className="section-header">
                <h3>Plugins</h3>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <input
                    type="text"
                    value={newPlugin}
                    onChange={(e) => setNewPlugin(e.target.value)}
                    placeholder="Plugin slug (e.g., akismet, woocommerce)"
                />
                <button type="submit" className="btn btn-primary" disabled={installing}>
                    {installing ? 'Installing...' : 'Install Plugin'}
                </button>
            </form>

            <div className="plugins-list">
                {plugins.length === 0 ? (
                    <p className="hint">No plugins installed.</p>
                ) : (
                    plugins.map(plugin => (
                        <div key={plugin.name} className={`plugin-item ${plugin.status === 'active' ? 'active' : ''}`}>
                            <div className="plugin-info">
                                <span className="plugin-name">{plugin.title || plugin.name}</span>
                                <span className="plugin-version">{plugin.version}</span>
                            </div>
                            <span className={`plugin-status ${plugin.status}`}>
                                {plugin.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

// Themes Tab
const ThemesTab = ({ siteId }) => {
    const toast = useToast();
    const [themes, setThemes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [newTheme, setNewTheme] = useState('');

    useEffect(() => {
        loadThemes();
    }, [siteId]);

    async function loadThemes() {
        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.getThemes(siteId);
            setThemes(data.themes || []);
        } catch (err) {
            console.error('Failed to load themes:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleInstall(e) {
        e.preventDefault();
        if (!newTheme.trim()) return;

        setInstalling(true);
        try {
            await wordpressApi.installTheme(siteId, { slug: newTheme.trim() });
            toast.success('Theme installed successfully');
            setNewTheme('');
            loadThemes();
        } catch (err) {
            toast.error(err.message || 'Failed to install theme');
        } finally {
            setInstalling(false);
        }
    }

    if (loading) {
        return (
            <div className="themes-tab">
                <div className="section-header">
                    <div className="skeleton" style={{ width: 80, height: 24 }} />
                </div>
                <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 16 }} />
                <div className="themes-list">
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                    <ListItemSkeleton />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load themes"
                error={error}
                onRetry={loadThemes}
            />
        );
    }

    return (
        <div className="themes-tab">
            <div className="section-header">
                <h3>Themes</h3>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <input
                    type="text"
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    placeholder="Theme slug (e.g., twentytwentyfour)"
                />
                <button type="submit" className="btn btn-primary" disabled={installing}>
                    {installing ? 'Installing...' : 'Install Theme'}
                </button>
            </form>

            <div className="themes-list">
                {themes.length === 0 ? (
                    <p className="hint">No themes found.</p>
                ) : (
                    themes.map(theme => (
                        <div key={theme.name} className={`theme-item ${theme.status === 'active' ? 'active' : ''}`}>
                            <div className="theme-info">
                                <span className="theme-name">{theme.title || theme.name}</span>
                                <span className="theme-version">{theme.version}</span>
                            </div>
                            {theme.status === 'active' && (
                                <span className="active-badge">Active</span>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

// Git Tab
const GitTab = ({ siteId, site, onUpdate }) => {
    const toast = useToast();
    const [gitStatus, setGitStatus] = useState(null);
    const [commits, setCommits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadGitData();
    }, [siteId]);

    async function loadGitData() {
        setLoading(true);
        setError(null);
        try {
            const statusData = await wordpressApi.getGitStatus(siteId);
            setGitStatus(statusData);

            if (statusData.connected) {
                const commitsData = await wordpressApi.getCommits(siteId);
                setCommits(commitsData.commits || []);
            }
        } catch (err) {
            console.error('Failed to load git data:', err);
            setError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleConnect(data) {
        await wordpressApi.connectRepo(siteId, data);
        toast.success('Repository connected');
        loadGitData();
        onUpdate?.();
    }

    async function handleDisconnect() {
        await wordpressApi.disconnectRepo(siteId);
        toast.success('Repository disconnected');
        loadGitData();
        onUpdate?.();
    }

    async function handleDeploy(data) {
        try {
            await wordpressApi.deployCommit(siteId, data);
            toast.success('Deployment completed');
            loadGitData();
            onUpdate?.();
        } catch (err) {
            toast.error(err.message || 'Deployment failed');
        }
    }

    async function handleCreateDev(data) {
        try {
            await wordpressApi.createDevFromCommit(siteId, data);
            toast.success('Development environment created');
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }

    if (loading) {
        return (
            <div className="git-tab">
                <div className="git-connect-form">
                    <div className="skeleton" style={{ width: 200, height: 24, marginBottom: 16 }} />
                    <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 12 }} />
                    <div className="skeleton" style={{ height: 44, borderRadius: 6, marginBottom: 12 }} />
                    <div className="skeleton" style={{ width: 140, height: 36, borderRadius: 6 }} />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <ErrorState
                title="Failed to load Git information"
                error={error}
                onRetry={loadGitData}
            />
        );
    }

    return (
        <div className="git-tab">
            <GitConnectForm
                gitStatus={gitStatus}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
            />

            {gitStatus?.connected && (
                <div className="git-commits-section">
                    <div className="section-header">
                        <h3>Recent Commits</h3>
                        <button className="btn btn-secondary btn-sm" onClick={loadGitData}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                    </div>

                    <CommitList
                        commits={commits}
                        currentCommit={site.last_deploy_commit}
                        onDeploy={handleDeploy}
                        onCreateDev={handleCreateDev}
                    />
                </div>
            )}
        </div>
    );
};

// Backups Tab
const BackupsTab = ({ siteId }) => {
    const toast = useToast();
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadSnapshots();
    }, [siteId]);

    async function loadSnapshots() {
        try {
            const data = await wordpressApi.getSnapshots(siteId);
            // Filter for backup-tagged snapshots
            setSnapshots((data.snapshots || []).filter(s => s.tag?.includes('backup')));
        } catch (err) {
            console.error('Failed to load backups:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateBackup() {
        try {
            await wordpressApi.createSnapshot(siteId, {
                name: `Backup ${new Date().toISOString().split('T')[0]}`,
                tag: 'backup',
                description: 'Full site backup'
            });
            toast.success('Backup created');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to create backup');
        }
    }

    async function handleRestore(snapId) {
        try {
            await wordpressApi.restoreSnapshot(siteId, snapId);
            toast.success('Backup restored');
        } catch (err) {
            toast.error(err.message || 'Failed to restore backup');
        }
    }

    async function handleDelete(snapId) {
        try {
            await wordpressApi.deleteSnapshot(siteId, snapId);
            toast.success('Backup deleted');
            loadSnapshots();
        } catch (err) {
            toast.error(err.message || 'Failed to delete backup');
        }
    }

    return (
        <div className="backups-tab">
            <div className="section-header">
                <h3>Backups</h3>
                <button className="btn btn-primary" onClick={handleCreateBackup}>
                    <Plus size={14} /> Create Backup
                </button>
            </div>

            <SnapshotTable
                snapshots={snapshots}
                loading={loading}
                onRestore={handleRestore}
                onDelete={handleDelete}
            />

            {snapshots.length === 0 && !loading && (
                <div className="hint-box">
                    <p>No backups yet. Create a backup to protect your site data.</p>
                </div>
            )}
        </div>
    );
};

export default WordPressDetail;
