import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Plus, ExternalLink, RefreshCw, GitBranch, Search, Shield, Activity, Settings } from 'lucide-react';
import wordpressApi from '../services/wordpress';
import { useToast } from '../contexts/ToastContext';
import {
    PipelineView,
    PromoteModal,
    SyncModal,
    ActivityFeed,
    ContainerLogs,
    CompareView,
    SanitizationProfileForm,
    ResourceLimitsModal,
    BasicAuthModal,
    WpCliTerminal,
    HealthStatusPanel,
    AutoSyncScheduleModal,
    BulkActionsBar,
} from '../components/wordpress';
import { ConfirmDialog } from '../components/ConfirmDialog';
import Spinner from '../components/Spinner';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:5000';

const WordPressProject = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();

    const [pipeline, setPipeline] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('pipeline');
    const [showCreateEnvModal, setShowCreateEnvModal] = useState(false);
    const [promoteModal, setPromoteModal] = useState(null);
    const [syncModal, setSyncModal] = useState(null);
    const [logsPanel, setLogsPanel] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [operationInProgress, setOperationInProgress] = useState(null);
    const [operationProgress, setOperationProgress] = useState(null);
    const [compareModal, setCompareModal] = useState(null);
    const [showSanitizationProfiles, setShowSanitizationProfiles] = useState(false);

    // Phase 7 state
    const [resourceLimitsModal, setResourceLimitsModal] = useState(null);
    const [basicAuthModal, setBasicAuthModal] = useState(null);
    const [wpCliModal, setWpCliModal] = useState(null);
    const [autoSyncModal, setAutoSyncModal] = useState(null);
    const [healthData, setHealthData] = useState({});
    const [diskUsageData, setDiskUsageData] = useState({});
    const [bulkSelected, setBulkSelected] = useState([]);

    const socketRef = useRef(null);

    useEffect(() => {
        loadPipeline();
        connectSocket();

        return () => {
            if (socketRef.current) {
                socketRef.current.emit('unsubscribe_pipeline', { project_id: Number(id) });
                socketRef.current.disconnect();
            }
        };
    }, [id]);

    function connectSocket() {
        const token = localStorage.getItem('access_token');
        if (!token) return;

        const socket = io(SOCKET_URL, {
            query: { token },
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            socket.emit('subscribe_pipeline', { project_id: Number(id) });
        });

        socket.on('pipeline_event', (data) => {
            handlePipelineEvent(data);
        });

        socketRef.current = socket;
    }

    function handlePipelineEvent(data) {
        const { event, data: eventData } = data;

        switch (event) {
            case 'environment_created':
            case 'environment_deleted':
            case 'promotion_completed':
            case 'sync_completed':
                loadPipeline();
                if (eventData.success) {
                    toast.success(eventData.message || `${event.replace(/_/g, ' ')} successfully`);
                }
                setOperationInProgress(null);
                break;
            case 'environment_create_failed':
            case 'environment_delete_failed':
            case 'promotion_failed':
            case 'sync_failed':
                loadPipeline();
                toast.error(eventData.message || `${event.replace(/_/g, ' ')}`);
                setOperationInProgress(null);
                break;
            case 'environment_started':
            case 'environment_stopped':
            case 'environment_restarted':
            case 'environment_locked':
            case 'environment_unlocked':
                loadPipeline();
                break;
            case 'promotion_started':
            case 'sync_started':
            case 'environment_creating':
                setOperationInProgress(event);
                setOperationProgress(null);
                break;
            case 'operation_progress':
                setOperationProgress(eventData);
                break;
            case 'bulk_operation_completed':
                loadPipeline();
                toast.success('Bulk operation completed');
                break;
            default:
                break;
        }
    }

    async function loadPipeline() {
        try {
            const data = await wordpressApi.getProjectPipeline(id);
            setPipeline(data);
        } catch (err) {
            console.error('Failed to load pipeline:', err);
            toast.error('Failed to load project pipeline');
        } finally {
            setLoading(false);
        }
    }

    const handlePromote = useCallback((sourceEnv, targetEnv) => {
        setPromoteModal({ sourceEnv, targetEnv });
    }, []);

    const handleDoPromote = useCallback(async (config) => {
        toast.info('Starting promotion...', { duration: 3000 });
        try {
            await wordpressApi.promoteEnvironment(id, config);
            setPromoteModal(null);
        } catch (err) {
            toast.error(err.message || 'Promotion failed');
        }
    }, [id, toast]);

    const handleSync = useCallback((env) => {
        setSyncModal({ environment: env });
    }, []);

    const handleDoSync = useCallback(async (config) => {
        const env = syncModal.environment;
        toast.info('Starting sync...', { duration: 3000 });
        try {
            await wordpressApi.syncProjectEnvironment(id, env.id, config);
            setSyncModal(null);
        } catch (err) {
            toast.error(err.message || 'Sync failed');
        }
    }, [id, syncModal, toast]);

    const handleStart = useCallback(async (env) => {
        try {
            await wordpressApi.startEnvironment(id, env.id);
            toast.success('Environment started');
            loadPipeline();
        } catch (err) {
            toast.error(err.message || 'Failed to start environment');
        }
    }, [id, toast]);

    const handleStop = useCallback(async (env) => {
        setConfirmDialog({
            title: 'Stop Environment',
            message: `Stop the ${env.environment_type || ''} environment "${env.name}"?`,
            confirmText: 'Stop',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await wordpressApi.stopEnvironment(id, env.id);
                    toast.success('Environment stopped');
                    loadPipeline();
                } catch (err) {
                    toast.error(err.message || 'Failed to stop environment');
                } finally {
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    }, [id, toast]);

    const handleRestart = useCallback(async (env) => {
        try {
            await wordpressApi.restartEnvironment(id, env.id);
            toast.success('Environment restarted');
            loadPipeline();
        } catch (err) {
            toast.error(err.message || 'Failed to restart environment');
        }
    }, [id, toast]);

    const handleDelete = useCallback((env) => {
        setConfirmDialog({
            title: 'Delete Environment',
            message: `Are you sure you want to delete "${env.name}"? This will remove all containers, files, and database for this environment.`,
            confirmText: 'Delete Environment',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await wordpressApi.deleteProjectEnvironment(id, env.id);
                    toast.success('Environment deleted');
                    loadPipeline();
                } catch (err) {
                    toast.error(err.message || 'Failed to delete environment');
                } finally {
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    }, [id, toast]);

    const handleLock = useCallback(async (env) => {
        try {
            await wordpressApi.lockEnvironment(id, env.id, {
                reason: 'Manually locked',
                duration_minutes: 60
            });
            toast.success('Environment locked');
            loadPipeline();
        } catch (err) {
            toast.error(err.message || 'Failed to lock environment');
        }
    }, [id, toast]);

    const handleUnlock = useCallback(async (env) => {
        try {
            await wordpressApi.unlockEnvironment(id, env.id);
            toast.success('Environment unlocked');
            loadPipeline();
        } catch (err) {
            toast.error(err.message || 'Failed to unlock environment');
        }
    }, [id, toast]);

    const handleViewLogs = useCallback((env) => {
        setLogsPanel({ envId: env.id });
    }, []);

    const handleCompare = useCallback((envA, envB) => {
        setCompareModal({ envA, envB });
    }, []);

    // Phase 7 handlers
    const handleResourceLimits = useCallback((env) => {
        setResourceLimitsModal({ environment: env, currentLimits: env.resource_limits });
    }, []);

    const handleApplyResourceLimits = useCallback(async (limits) => {
        const env = resourceLimitsModal.environment;
        try {
            await wordpressApi.updateResourceLimits(id, env.id, limits);
            toast.success('Resource limits updated, containers restarting');
            setResourceLimitsModal(null);
            loadPipeline();
        } catch (err) {
            toast.error(err.message || 'Failed to update resource limits');
        }
    }, [id, resourceLimitsModal, toast]);

    const handleBasicAuth = useCallback((env) => {
        setBasicAuthModal({ environment: env });
    }, []);

    const handleWpCli = useCallback((env) => {
        setWpCliModal({ environment: env });
    }, []);

    const handleAutoSync = useCallback((env) => {
        setAutoSyncModal({ environment: env });
    }, []);

    const handleHealthCheck = useCallback(async (env) => {
        try {
            const data = await wordpressApi.getEnvironmentHealth(id, env.id);
            if (data.success) {
                setHealthData(prev => ({ ...prev, [env.id]: data }));
                toast.info(`${env.name}: ${data.overall_status}`);
            }
        } catch (err) {
            toast.error('Health check failed');
        }
    }, [id, toast]);

    const handleBulkToggle = useCallback((envId) => {
        setBulkSelected(prev =>
            prev.includes(envId)
                ? prev.filter(id => id !== envId)
                : [...prev, envId]
        );
    }, []);

    const handleBulkExecute = useCallback(async (action, envIds) => {
        try {
            await wordpressApi.executeBulkOperation(id, [{ action, env_ids: envIds }]);
            toast.success(`Bulk ${action} completed`);
            setBulkSelected([]);
            loadPipeline();
        } catch (err) {
            toast.error(err.message || `Bulk ${action} failed`);
        }
    }, [id, toast]);

    // Load health and disk usage data on pipeline load
    useEffect(() => {
        if (pipeline) {
            loadHealthData();
            loadDiskUsageData();
        }
    }, [pipeline]);

    async function loadHealthData() {
        try {
            const data = await wordpressApi.getProjectHealth(id);
            if (data.success) {
                setHealthData(data.environments || {});
            }
        } catch {
            // Health data is optional
        }
    }

    async function loadDiskUsageData() {
        try {
            const data = await wordpressApi.getProjectDiskUsage(id);
            if (data.success) {
                setDiskUsageData(data.environments || {});
            }
        } catch {
            // Disk usage data is optional
        }
    }

    const handleCreateEnvironment = useCallback(async (data) => {
        toast.info('Creating environment...', { duration: 5000 });
        try {
            await wordpressApi.createProjectEnvironment(id, data);
            setShowCreateEnvModal(false);
        } catch (err) {
            toast.error(err.message || 'Failed to create environment');
        }
    }, [id, toast]);

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    if (!pipeline) {
        return (
            <div className="empty-state">
                <h3>Project not found</h3>
                <button className="btn btn-primary" onClick={() => navigate('/wordpress/projects')}>
                    Back to Projects
                </button>
            </div>
        );
    }

    const production = pipeline.production || pipeline;
    const projectName = production.name || 'WordPress Project';
    const projectDomain = production.application?.domains?.[0] || production.url || '';

    return (
        <div className="app-detail-page wp-project-page">
            {/* Top Bar */}
            <div className="app-detail-topbar">
                <div className="app-detail-breadcrumbs">
                    <Link to="/wordpress/projects">Projects</Link>
                    <span>/</span>
                    <span className="current">{projectName}</span>
                </div>
                <div className="app-detail-actions">
                    {projectDomain && (
                        <a
                            href={projectDomain.startsWith('http') ? projectDomain : `https://${projectDomain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost"
                        >
                            <ExternalLink size={16} />
                            Visit Site
                        </a>
                    )}
                    <button
                        className="btn btn-ghost"
                        onClick={() => setShowSanitizationProfiles(true)}
                        title="Manage sanitization profiles"
                    >
                        <Shield size={16} />
                        Profiles
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowCreateEnvModal(true)}
                    >
                        <Plus size={16} />
                        New Environment
                    </button>
                </div>
            </div>

            {/* Header */}
            <div className="app-detail-header">
                <div className="app-detail-icon wp-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z" />
                    </svg>
                </div>
                <div className="app-detail-title-block">
                    <h1>
                        {projectName}
                        <span className={`app-status-badge ${production.status === 'running' ? 'running' : 'stopped'}`}>
                            <span className="pulse-dot" />
                            {production.status === 'running' ? 'Running' : 'Stopped'}
                        </span>
                    </h1>
                    <div className="app-detail-subtitle">
                        {projectDomain && <span className="mono">{projectDomain}</span>}
                        {production.wp_version && (
                            <>
                                <span className="separator">•</span>
                                <span>WordPress {production.wp_version}</span>
                            </>
                        )}
                        {pipeline.environments && (
                            <>
                                <span className="separator">•</span>
                                <span>{(pipeline.environments?.length || 0) + 1} environments</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="app-detail-tabs">
                <div
                    className={`app-detail-tab ${activeTab === 'pipeline' ? 'active' : ''}`}
                    onClick={() => setActiveTab('pipeline')}
                >
                    Pipeline
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'activity' ? 'active' : ''}`}
                    onClick={() => setActiveTab('activity')}
                >
                    Activity
                </div>
                <div
                    className={`app-detail-tab ${activeTab === 'health' ? 'active' : ''}`}
                    onClick={() => setActiveTab('health')}
                >
                    Health
                </div>
            </div>

            {/* Tab Content */}
            <div className="app-detail-content">
                {activeTab === 'pipeline' && (
                    <div className="pipeline-tab">
                        {operationInProgress && (
                            <div className="pipeline-operation-banner">
                                <Spinner size="sm" />
                                <div className="operation-progress-content">
                                    <span>
                                        {operationInProgress === 'promotion_started' && 'Promotion in progress...'}
                                        {operationInProgress === 'sync_started' && 'Sync in progress...'}
                                        {operationInProgress === 'environment_creating' && 'Creating environment...'}
                                    </span>
                                    {operationProgress && (
                                        <div className="operation-progress">
                                            <div className="operation-progress-bar">
                                                <div
                                                    className="operation-progress-fill"
                                                    style={{ width: `${operationProgress.percent || 0}%` }}
                                                />
                                            </div>
                                            <span className="operation-progress-step">
                                                Step {operationProgress.step}/{operationProgress.total}: {operationProgress.message}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {bulkSelected.length > 0 && (
                            <BulkActionsBar
                                selectedIds={bulkSelected}
                                environments={[
                                    ...(pipeline.environments || []),
                                    pipeline.production
                                ].filter(Boolean)}
                                prodId={id}
                                onClear={() => setBulkSelected([])}
                                onExecute={handleBulkExecute}
                                api={wordpressApi}
                            />
                        )}

                        <PipelineView
                            pipeline={pipeline}
                            onPromote={handlePromote}
                            onSync={handleSync}
                            onStart={handleStart}
                            onStop={handleStop}
                            onRestart={handleRestart}
                            onDelete={handleDelete}
                            onLock={handleLock}
                            onUnlock={handleUnlock}
                            onViewLogs={handleViewLogs}
                            onCompare={handleCompare}
                            onCreateMultidev={() => {
                                setShowCreateEnvModal(true);
                            }}
                            onResourceLimits={handleResourceLimits}
                            onBasicAuth={handleBasicAuth}
                            onWpCli={handleWpCli}
                            onAutoSync={handleAutoSync}
                            onHealthCheck={handleHealthCheck}
                            operationInProgress={operationInProgress}
                            healthData={healthData}
                            diskUsageData={diskUsageData}
                            bulkSelected={bulkSelected}
                            onBulkToggle={handleBulkToggle}
                        />

                        {/* Recent Activity Preview */}
                        <div className="pipeline-activity-preview">
                            <div className="section-header">
                                <h3>Recent Activity</h3>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setActiveTab('activity')}
                                >
                                    View All
                                </button>
                            </div>
                            <ActivityFeed projectId={id} limit={5} compact />
                        </div>
                    </div>
                )}

                {activeTab === 'activity' && (
                    <div className="activity-tab">
                        <div className="section-header">
                            <h3>Activity Log</h3>
                            <button className="btn btn-ghost btn-sm" onClick={loadPipeline}>
                                <RefreshCw size={14} /> Refresh
                            </button>
                        </div>
                        <ActivityFeed projectId={id} limit={50} />
                    </div>
                )}

                {activeTab === 'health' && (
                    <div className="health-tab">
                        <HealthStatusPanel
                            projectId={id}
                            environments={[
                                pipeline.production,
                                ...(pipeline.environments || [])
                            ].filter(Boolean)}
                            api={wordpressApi}
                        />
                    </div>
                )}
            </div>

            {/* Logs Panel */}
            {logsPanel && (
                <div className="pipeline-logs-overlay">
                    <ContainerLogs
                        projectId={id}
                        envId={logsPanel.envId}
                        onClose={() => setLogsPanel(null)}
                    />
                </div>
            )}

            {/* Modals */}
            {promoteModal && (
                <PromoteModal
                    sourceEnv={promoteModal.sourceEnv}
                    targetEnv={promoteModal.targetEnv}
                    onClose={() => setPromoteModal(null)}
                    onPromote={handleDoPromote}
                />
            )}

            {syncModal && (
                <SyncModal
                    environment={syncModal.environment}
                    productionName={projectName}
                    onClose={() => setSyncModal(null)}
                    onSync={handleDoSync}
                />
            )}

            {showCreateEnvModal && (
                <CreatePipelineEnvModal
                    onClose={() => setShowCreateEnvModal(false)}
                    onCreate={handleCreateEnvironment}
                    productionDomain={projectDomain}
                    existingTypes={(pipeline.environments || []).map(e => e.environment_type)}
                    projectId={id}
                />
            )}

            {compareModal && (
                <CompareView
                    projectId={id}
                    envA={compareModal.envA}
                    envB={compareModal.envB}
                    onClose={() => setCompareModal(null)}
                />
            )}

            {showSanitizationProfiles && (
                <SanitizationProfileForm
                    onClose={() => setShowSanitizationProfiles(false)}
                    onProfilesChange={() => {}}
                />
            )}

            {resourceLimitsModal && (
                <ResourceLimitsModal
                    environment={resourceLimitsModal.environment}
                    currentLimits={resourceLimitsModal.currentLimits}
                    onClose={() => setResourceLimitsModal(null)}
                    onApply={handleApplyResourceLimits}
                />
            )}

            {basicAuthModal && (
                <BasicAuthModal
                    environment={basicAuthModal.environment}
                    prodId={id}
                    onClose={() => setBasicAuthModal(null)}
                    api={wordpressApi}
                />
            )}

            {wpCliModal && (
                <WpCliTerminal
                    environment={wpCliModal.environment}
                    prodId={id}
                    onClose={() => setWpCliModal(null)}
                    api={wordpressApi}
                />
            )}

            {autoSyncModal && (
                <AutoSyncScheduleModal
                    environment={autoSyncModal.environment}
                    prodId={id}
                    onClose={() => setAutoSyncModal(null)}
                    api={wordpressApi}
                />
            )}

            <ConfirmDialog
                isOpen={!!confirmDialog}
                title={confirmDialog?.title}
                message={confirmDialog?.message}
                confirmText={confirmDialog?.confirmText}
                variant={confirmDialog?.variant}
                onConfirm={confirmDialog?.onConfirm}
                onCancel={confirmDialog?.onCancel || (() => setConfirmDialog(null))}
            />
        </div>
    );
};

// Create Environment Modal (Pipeline version)
const CreatePipelineEnvModal = ({ onClose, onCreate, productionDomain, existingTypes, projectId }) => {
    const [formData, setFormData] = useState({
        type: existingTypes.includes('development') ? 'staging' : 'development',
        name: '',
        branch: '',
        clone_db: true
    });
    const [loading, setLoading] = useState(false);
    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [branchSearch, setBranchSearch] = useState('');
    const [useCustomBranch, setUseCustomBranch] = useState(false);

    const availableTypes = [
        { value: 'development', label: 'Development', disabled: existingTypes.includes('development') },
        { value: 'staging', label: 'Staging', disabled: existingTypes.includes('staging') },
        { value: 'multidev', label: 'Multidev (branch-based)', disabled: false }
    ];

    useEffect(() => {
        if (formData.type === 'multidev' && branches.length === 0 && !branchesLoading) {
            loadBranches();
        }
    }, [formData.type]);

    async function loadBranches() {
        setBranchesLoading(true);
        try {
            const data = await wordpressApi.getBranches(projectId);
            setBranches(data.branches || []);
        } catch {
            setBranches([]);
        } finally {
            setBranchesLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    function selectBranch(branchName) {
        setFormData(prev => ({ ...prev, branch: branchName }));
        setBranchSearch('');
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

    const filteredBranches = branches.filter(b => {
        if (!branchSearch) return true;
        return b.name.toLowerCase().includes(branchSearch.toLowerCase());
    });

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
                            {availableTypes.map(t => (
                                <option key={t.value} value={t.value} disabled={t.disabled}>
                                    {t.label}{t.disabled ? ' (already exists)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {formData.type === 'multidev' && (
                        <div className="form-group">
                            <label>
                                <GitBranch size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                                Git Branch *
                            </label>

                            {formData.branch && !useCustomBranch && (
                                <div className="branch-selected">
                                    <GitBranch size={14} />
                                    <span className="branch-selected-name">{formData.branch}</span>
                                    <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => setFormData(prev => ({ ...prev, branch: '' }))}
                                    >
                                        Change
                                    </button>
                                </div>
                            )}

                            {!formData.branch && !useCustomBranch && (
                                <>
                                    {branchesLoading ? (
                                        <div className="branch-picker-loading">
                                            <Spinner size="sm" />
                                            <span>Loading branches...</span>
                                        </div>
                                    ) : branches.length > 0 ? (
                                        <div className="branch-picker">
                                            <div className="branch-picker-search">
                                                <Search size={14} />
                                                <input
                                                    type="text"
                                                    value={branchSearch}
                                                    onChange={e => setBranchSearch(e.target.value)}
                                                    placeholder="Search branches..."
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="branch-picker-list">
                                                {filteredBranches.map(b => (
                                                    <button
                                                        key={b.name}
                                                        type="button"
                                                        className={`branch-picker-item ${b.has_multidev ? 'has-env' : ''} ${b.is_current ? 'current' : ''}`}
                                                        onClick={() => selectBranch(b.name)}
                                                        disabled={b.has_multidev}
                                                        title={b.has_multidev ? 'Multidev already exists for this branch' : ''}
                                                    >
                                                        <div className="branch-picker-item-main">
                                                            <GitBranch size={12} />
                                                            <span className="branch-name">{b.name}</span>
                                                            {b.is_current && <span className="branch-tag">default</span>}
                                                            {b.has_multidev && <span className="branch-tag env">has env</span>}
                                                        </div>
                                                        {b.message && (
                                                            <div className="branch-picker-item-meta">
                                                                <span className="branch-sha">{b.short_sha}</span>
                                                                <span className="branch-msg">{b.message}</span>
                                                            </div>
                                                        )}
                                                    </button>
                                                ))}
                                                {filteredBranches.length === 0 && (
                                                    <div className="branch-picker-empty">
                                                        No branches match "{branchSearch}"
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm branch-picker-custom"
                                                onClick={() => setUseCustomBranch(true)}
                                            >
                                                Enter branch name manually
                                            </button>
                                        </div>
                                    ) : (
                                        <div>
                                            <input
                                                type="text"
                                                name="branch"
                                                value={formData.branch}
                                                onChange={handleChange}
                                                placeholder="feature/my-branch"
                                                required
                                            />
                                            <span className="form-hint">No git repo connected or no branches found. Enter branch name manually.</span>
                                        </div>
                                    )}
                                </>
                            )}

                            {useCustomBranch && (
                                <div>
                                    <input
                                        type="text"
                                        name="branch"
                                        value={formData.branch}
                                        onChange={handleChange}
                                        placeholder="feature/my-branch"
                                        required
                                        autoFocus
                                    />
                                    {branches.length > 0 && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => { setUseCustomBranch(false); setFormData(prev => ({ ...prev, branch: '' })); }}
                                            style={{ marginTop: 4 }}
                                        >
                                            Back to branch list
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="form-group">
                        <label>Environment Name</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder={formData.type === 'multidev' ? 'Auto-generated from branch' : `${formData.type} environment`}
                        />
                        <span className="form-hint">Leave empty to auto-generate</span>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                name="clone_db"
                                checked={formData.clone_db}
                                onChange={handleChange}
                            />
                            <span>Clone production database</span>
                        </label>
                        <span className="form-hint">Creates a copy of the production database for this environment</span>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || (formData.type === 'multidev' && !formData.branch)}
                        >
                            {loading ? <><Spinner size="sm" /> Creating...</> : 'Create Environment'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default WordPressProject;
