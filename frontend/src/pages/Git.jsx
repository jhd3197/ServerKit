import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function Git() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [installForm, setInstallForm] = useState({
        adminUser: 'admin',
        adminEmail: '',
        adminPassword: ''
    });
    // Webhook state
    const [webhooks, setWebhooks] = useState([]);
    const [webhooksLoading, setWebhooksLoading] = useState(false);
    const [showWebhookModal, setShowWebhookModal] = useState(false);
    const [selectedWebhook, setSelectedWebhook] = useState(null);
    const [webhookForm, setWebhookForm] = useState({
        name: '',
        source: 'github',
        sourceRepoUrl: '',
        sourceBranch: 'main',
        localRepoName: '',
        syncDirection: 'pull',
        autoSync: true,
        // Deployment settings
        appId: '',
        deployOnPush: false,
        preDeployScript: '',
        postDeployScript: '',
        zeroDowntime: false
    });
    const [webhookSecret, setWebhookSecret] = useState(null);

    // Repository state
    const [repositories, setRepositories] = useState([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [repoView, setRepoView] = useState('list'); // 'list', 'detail'
    const [branches, setBranches] = useState([]);
    const [commits, setCommits] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState(null);
    const [files, setFiles] = useState([]);
    const [currentPath, setCurrentPath] = useState('');
    const [repoDetailTab, setRepoDetailTab] = useState('files'); // 'files', 'commits', 'branches'

    // Deployment state
    const [applications, setApplications] = useState([]);
    const [deployments, setDeployments] = useState([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(false);
    const [selectedDeployment, setSelectedDeployment] = useState(null);
    const [showDeploymentLogs, setShowDeploymentLogs] = useState(false);
    const [deployingAppId, setDeployingAppId] = useState(null);

    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (activeTab === 'webhooks' && status?.installed) {
            loadWebhooks();
            loadApplications();
        }
        if (activeTab === 'repositories' && status?.installed && status?.running) {
            loadRepositories();
        }
        if (activeTab === 'deployments' && status?.installed) {
            loadWebhooks();
            loadAllDeployments();
        }
    }, [activeTab, status?.installed, status?.running]);

    const loadData = async () => {
        setLoading(true);
        try {
            await loadStatus();
        } catch (error) {
            console.error('Failed to load git data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getGitStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load status:', error);
            setStatus({ installed: false });
        }
    };

    const loadWebhooks = async () => {
        setWebhooksLoading(true);
        try {
            const data = await api.getWebhooks();
            setWebhooks(data.webhooks || []);
        } catch (error) {
            console.error('Failed to load webhooks:', error);
        } finally {
            setWebhooksLoading(false);
        }
    };

    const handleCreateWebhook = async () => {
        if (!webhookForm.name || !webhookForm.sourceRepoUrl) {
            toast.error('Name and repository URL are required');
            return;
        }

        setActionLoading(true);
        try {
            const result = await api.createWebhook(webhookForm);
            if (result.success) {
                toast.success('Webhook created successfully');
                setWebhookSecret(result.secret);
                setShowWebhookModal(false);
                setWebhookForm({
                    name: '',
                    source: 'github',
                    sourceRepoUrl: '',
                    sourceBranch: 'main',
                    localRepoName: '',
                    syncDirection: 'pull',
                    autoSync: true,
                    appId: '',
                    deployOnPush: false,
                    preDeployScript: '',
                    postDeployScript: '',
                    zeroDowntime: false
                });
                await loadWebhooks();
            } else {
                toast.error(result.error || 'Failed to create webhook');
            }
        } catch (error) {
            toast.error(`Failed to create webhook: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteWebhook = async (webhookId) => {
        setConfirmDialog({
            title: 'Delete Webhook',
            message: 'Are you sure you want to delete this webhook? This cannot be undone.',
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteWebhook(webhookId);
                    toast.success('Webhook deleted');
                    await loadWebhooks();
                } catch (error) {
                    toast.error(`Failed to delete: ${error.message}`);
                } finally {
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleToggleWebhook = async (webhookId) => {
        try {
            const result = await api.toggleWebhook(webhookId);
            if (result.success) {
                toast.success(result.message);
                await loadWebhooks();
            }
        } catch (error) {
            toast.error(`Failed to toggle webhook: ${error.message}`);
        }
    };

    const handleTestWebhook = async (webhookId) => {
        try {
            const result = await api.testWebhook(webhookId);
            if (result.success) {
                toast.success('Test event logged');
            } else {
                toast.error(result.error || 'Test failed');
            }
        } catch (error) {
            toast.error(`Test failed: ${error.message}`);
        }
    };

    const copyWebhookUrl = (webhook) => {
        const baseUrl = window.location.origin;
        const url = `${baseUrl}/api${webhook.webhook_url}`;
        navigator.clipboard.writeText(url);
        toast.success('Webhook URL copied');
    };

    // Repository functions
    const loadRepositories = async () => {
        setReposLoading(true);
        try {
            const data = await api.getRepositories();
            setRepositories(data.repositories || []);
        } catch (error) {
            console.error('Failed to load repositories:', error);
            if (error.message?.includes('not running')) {
                toast.error('Gitea server is not running');
            }
        } finally {
            setReposLoading(false);
        }
    };

    const selectRepository = async (repo) => {
        setSelectedRepo(repo);
        setRepoView('detail');
        setCurrentPath('');
        setSelectedBranch(repo.default_branch);
        setRepoDetailTab('files');

        // Load branches, commits, and files
        try {
            const [branchesData, commitsData, filesData] = await Promise.all([
                api.getBranches(repo.owner.login, repo.name),
                api.getCommits(repo.owner.login, repo.name, repo.default_branch),
                api.getRepoFiles(repo.owner.login, repo.name, repo.default_branch)
            ]);

            setBranches(branchesData.branches || []);
            setCommits(commitsData.commits || []);
            setFiles(filesData.files || []);
        } catch (error) {
            console.error('Failed to load repo details:', error);
            toast.error('Failed to load repository details');
        }
    };

    const navigateToPath = async (path) => {
        if (!selectedRepo) return;

        try {
            const data = await api.getRepoFiles(
                selectedRepo.owner.login,
                selectedRepo.name,
                selectedBranch,
                path
            );
            setFiles(data.files || []);
            setCurrentPath(path);
        } catch (error) {
            toast.error('Failed to load directory');
        }
    };

    const navigateUp = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/');
        parts.pop();
        navigateToPath(parts.join('/'));
    };

    const changeBranch = async (branchName) => {
        if (!selectedRepo) return;

        setSelectedBranch(branchName);
        setCurrentPath('');

        try {
            const [commitsData, filesData] = await Promise.all([
                api.getCommits(selectedRepo.owner.login, selectedRepo.name, branchName),
                api.getRepoFiles(selectedRepo.owner.login, selectedRepo.name, branchName)
            ]);

            setCommits(commitsData.commits || []);
            setFiles(filesData.files || []);
        } catch (error) {
            toast.error('Failed to switch branch');
        }
    };

    const loadMoreCommits = async () => {
        if (!selectedRepo) return;

        const currentPage = Math.ceil(commits.length / 30) + 1;
        try {
            const data = await api.getCommits(
                selectedRepo.owner.login,
                selectedRepo.name,
                selectedBranch,
                currentPage
            );
            if (data.commits?.length) {
                setCommits([...commits, ...data.commits]);
            }
        } catch (error) {
            toast.error('Failed to load more commits');
        }
    };

    const backToRepoList = () => {
        setSelectedRepo(null);
        setRepoView('list');
        setBranches([]);
        setCommits([]);
        setFiles([]);
        setCurrentPath('');
    };

    // Deployment functions
    const loadApplications = async () => {
        try {
            const data = await api.getApps();
            setApplications(data.apps || []);
        } catch (error) {
            console.error('Failed to load applications:', error);
        }
    };

    const loadAllDeployments = async () => {
        setDeploymentsLoading(true);
        try {
            // Load deployments for all webhooks that have deploy_on_push enabled
            const webhooksData = await api.getWebhooks();
            const webhooksWithDeploy = (webhooksData.webhooks || []).filter(w => w.deploy_on_push && w.app_id);

            let allDeployments = [];
            for (const webhook of webhooksWithDeploy) {
                const data = await api.getWebhookDeployments(webhook.id, 10);
                if (data.deployments) {
                    allDeployments = [...allDeployments, ...data.deployments.map(d => ({
                        ...d,
                        webhook_name: webhook.name
                    }))];
                }
            }

            // Sort by created_at descending
            allDeployments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            setDeployments(allDeployments);
        } catch (error) {
            console.error('Failed to load deployments:', error);
        } finally {
            setDeploymentsLoading(false);
        }
    };

    const loadWebhookDeployments = async (webhookId) => {
        try {
            const data = await api.getWebhookDeployments(webhookId, 20);
            return data.deployments || [];
        } catch (error) {
            console.error('Failed to load webhook deployments:', error);
            return [];
        }
    };

    const handleTriggerDeploy = async (appId) => {
        setDeployingAppId(appId);
        try {
            const result = await api.triggerDeploy(appId);
            if (result.success) {
                toast.success(`Deployment started: v${result.version}`);
                await loadAllDeployments();
            } else {
                toast.error(result.error || 'Failed to trigger deployment');
            }
        } catch (error) {
            toast.error(`Failed to deploy: ${error.message}`);
        } finally {
            setDeployingAppId(null);
        }
    };

    const handleRollback = async (appId, targetVersion) => {
        setConfirmDialog({
            title: 'Rollback Deployment',
            message: `Are you sure you want to rollback to version ${targetVersion}? This will restart the application with the previous code.`,
            confirmText: 'Rollback',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    const result = await api.rollbackDeployment(appId, targetVersion);
                    if (result.success) {
                        toast.success(result.message || 'Rollback completed');
                        await loadAllDeployments();
                    } else {
                        toast.error(result.error || 'Rollback failed');
                    }
                } catch (error) {
                    toast.error(`Rollback failed: ${error.message}`);
                } finally {
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const viewDeploymentLogs = async (deploymentId) => {
        try {
            const data = await api.getDeployment(deploymentId, true);
            if (data.success) {
                setSelectedDeployment(data.deployment);
                setShowDeploymentLogs(true);
            } else {
                toast.error('Failed to load deployment details');
            }
        } catch (error) {
            toast.error(`Failed to load logs: ${error.message}`);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'success': return 'success';
            case 'failed': return 'danger';
            case 'running': return 'warning';
            default: return '';
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatDate = (dateString) => {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return date.toLocaleDateString();
    };

    const handleInstall = async () => {
        if (!installForm.adminEmail) {
            toast.error('Admin email is required');
            return;
        }

        setActionLoading(true);
        try {
            const result = await api.installGit(installForm);
            if (result.success) {
                toast.success('Git server installed successfully');
                setShowInstallModal(false);
                if (result.admin_password) {
                    toast.info(`Admin password: ${result.admin_password} (save this!)`);
                }
                await loadData();
            } else {
                toast.error(result.error || 'Installation failed');
            }
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUninstall = async () => {
        setConfirmDialog({
            title: 'Uninstall Git Server',
            message: 'Are you sure you want to uninstall the Git server? This will stop the Gitea container but preserve your data.',
            confirmText: 'Uninstall',
            variant: 'danger',
            onConfirm: async () => {
                setActionLoading(true);
                try {
                    await api.uninstallGit(false);
                    toast.success('Git server uninstalled');
                    await loadData();
                } catch (error) {
                    toast.error(`Failed to uninstall: ${error.message}`);
                } finally {
                    setActionLoading(false);
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleStart = async () => {
        setActionLoading(true);
        try {
            await api.startGit();
            toast.success('Git server started');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to start: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleStop = async () => {
        setConfirmDialog({
            title: 'Stop Git Server',
            message: 'Are you sure you want to stop the Git server?',
            confirmText: 'Stop',
            variant: 'warning',
            onConfirm: async () => {
                setActionLoading(true);
                try {
                    await api.stopGit();
                    toast.success('Git server stopped');
                    await loadStatus();
                } catch (error) {
                    toast.error(`Failed to stop: ${error.message}`);
                } finally {
                    setActionLoading(false);
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const openGitea = () => {
        // Use slug-based URL (/gitea) if available, fallback to port
        if (status?.url_path) {
            window.open(`${window.location.origin}${status.url_path}`, '_blank');
        } else if (status?.http_port) {
            window.open(`http://${window.location.hostname}:${status.http_port}`, '_blank');
        }
    };

    const getGiteaUrl = () => {
        if (status?.url_path) {
            return `${window.location.origin}${status.url_path}`;
        }
        return `http://${window.location.hostname}:${status?.http_port}`;
    };

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="git-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Git Server</h1>
                    <p className="page-description">Self-hosted Git repository management with Gitea</p>
                </div>
                <div className="page-header-actions">
                    {!status?.installed ? (
                        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                            Install Git Server
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={openGitea}
                                disabled={!status?.running}
                            >
                                Open Gitea
                            </button>
                            {status?.running ? (
                                <button
                                    className="btn btn-warning"
                                    onClick={handleStop}
                                    disabled={actionLoading}
                                >
                                    Stop Server
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleStart}
                                    disabled={actionLoading}
                                >
                                    Start Server
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {!status?.installed ? (
                <div className="empty-state-large">
                    <div className="empty-icon">
                        <svg viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" fill="none" strokeWidth="1.5">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                    </div>
                    <h2>No Git Server Installed</h2>
                    <p>Install Gitea to host and manage your Git repositories locally.</p>

                    <div className="resource-warning">
                        <div className="warning-header">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                            <strong>Resource Requirements</strong>
                        </div>
                        <ul>
                            <li><strong>Memory:</strong> ~512MB minimum (1GB recommended)</li>
                            <li><strong>Storage:</strong> ~5GB for database + repositories</li>
                            <li><strong>Components:</strong> Gitea + PostgreSQL database</li>
                        </ul>
                    </div>

                    <button className="btn btn-primary btn-lg" onClick={() => setShowInstallModal(true)}>
                        Install Git Server
                    </button>
                </div>
            ) : (
                <>
                    <div className="status-cards">
                        <div className={`status-card ${status?.running ? 'success' : 'danger'}`}>
                            <div className="status-icon">
                                <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="18" cy="18" r="3"/>
                                    <circle cx="6" cy="6" r="3"/>
                                    <path d="M6 21V9a9 9 0 0 0 9 9"/>
                                </svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Server Status</span>
                                <span className="status-value">{status?.running ? 'Running' : 'Stopped'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="2" y1="12" x2="22" y2="12"/>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                                </svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">URL Path</span>
                                <span className="status-value">{status?.url_path || `/gitea`}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                </svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">SSH Port</span>
                                <span className="status-value">{status?.ssh_port || 'N/A'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                    <circle cx="12" cy="7" r="4"/>
                                </svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Version</span>
                                <span className="status-value">{status?.version || 'Unknown'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="tabs">
                        <button
                            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                            onClick={() => setActiveTab('overview')}
                        >
                            Overview
                        </button>
                        <button
                            className={`tab ${activeTab === 'repositories' ? 'active' : ''}`}
                            onClick={() => setActiveTab('repositories')}
                        >
                            Repositories
                        </button>
                        <button
                            className={`tab ${activeTab === 'access' ? 'active' : ''}`}
                            onClick={() => setActiveTab('access')}
                        >
                            Access Info
                        </button>
                        <button
                            className={`tab ${activeTab === 'webhooks' ? 'active' : ''}`}
                            onClick={() => setActiveTab('webhooks')}
                        >
                            Webhooks
                        </button>
                        <button
                            className={`tab ${activeTab === 'deployments' ? 'active' : ''}`}
                            onClick={() => setActiveTab('deployments')}
                        >
                            Deployments
                        </button>
                        <button
                            className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            Settings
                        </button>
                    </div>

                    <div className="tab-content">
                        {activeTab === 'overview' && (
                            <div className="overview-tab">
                                <div className="info-card">
                                    <h3>Server Information</h3>
                                    <div className="info-grid">
                                        <div className="info-item">
                                            <span className="info-label">Status</span>
                                            <span className={`info-value ${status?.running ? 'text-success' : 'text-danger'}`}>
                                                {status?.running ? 'Running' : 'Stopped'}
                                            </span>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">HTTP URL</span>
                                            <span className="info-value">
                                                {status?.running ? (
                                                    <a href={getGiteaUrl()} target="_blank" rel="noopener noreferrer">
                                                        {getGiteaUrl()}
                                                    </a>
                                                ) : 'Server not running'}
                                            </span>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">SSH Clone URL</span>
                                            <span className="info-value code">
                                                ssh://git@{window.location.hostname}:{status?.ssh_port}/user/repo.git
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="info-card">
                                    <h3>Quick Actions</h3>
                                    <div className="quick-actions">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={openGitea}
                                            disabled={!status?.running}
                                        >
                                            Open Web Interface
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => {
                                                navigator.clipboard.writeText(`git clone ssh://git@${window.location.hostname}:${status?.ssh_port}/user/repo.git`);
                                                toast.success('SSH URL copied to clipboard');
                                            }}
                                        >
                                            Copy SSH URL
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'repositories' && (
                            <div className="repositories-tab">
                                {!status?.running ? (
                                    <div className="empty-state">
                                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <h4>Server Not Running</h4>
                                        <p>Start the Git server to browse repositories</p>
                                        <button className="btn btn-primary" onClick={handleStart}>
                                            Start Server
                                        </button>
                                    </div>
                                ) : repoView === 'list' ? (
                                    <>
                                        <div className="repos-header">
                                            <h3>Repositories</h3>
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={loadRepositories}
                                                disabled={reposLoading}
                                            >
                                                Refresh
                                            </button>
                                        </div>

                                        {reposLoading ? (
                                            <div className="loading-state">
                                                <Spinner />
                                            </div>
                                        ) : repositories.length === 0 ? (
                                            <div className="empty-state">
                                                <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                                </svg>
                                                <h4>No Repositories Yet</h4>
                                                <p>Create your first repository in Gitea</p>
                                                <button className="btn btn-primary" onClick={openGitea}>
                                                    Open Gitea
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="repos-list">
                                                {repositories.map((repo) => (
                                                    <div
                                                        key={repo.id}
                                                        className="repo-card"
                                                        onClick={() => selectRepository(repo)}
                                                    >
                                                        <div className="repo-info">
                                                            <div className="repo-name">
                                                                <span className="owner">{repo.owner.login}/</span>
                                                                <span className="name">{repo.name}</span>
                                                                {repo.private && <span className="badge private">Private</span>}
                                                                {repo.fork && <span className="badge fork">Fork</span>}
                                                            </div>
                                                            {repo.description && (
                                                                <p className="repo-description">{repo.description}</p>
                                                            )}
                                                            <div className="repo-meta">
                                                                <span className="meta-item">
                                                                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                                                        <circle cx="18" cy="18" r="3"/>
                                                                        <circle cx="6" cy="6" r="3"/>
                                                                        <path d="M6 21V9a9 9 0 0 0 9 9"/>
                                                                    </svg>
                                                                    {repo.default_branch}
                                                                </span>
                                                                <span className="meta-item">
                                                                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                                                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                                                                    </svg>
                                                                    {repo.stars}
                                                                </span>
                                                                <span className="meta-item">
                                                                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                                                        <circle cx="12" cy="18" r="3"/>
                                                                        <circle cx="6" cy="6" r="3"/>
                                                                        <circle cx="18" cy="6" r="3"/>
                                                                        <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"/>
                                                                        <path d="M12 12v3"/>
                                                                    </svg>
                                                                    {repo.forks}
                                                                </span>
                                                                <span className="meta-item updated">
                                                                    Updated {formatDate(repo.updated_at)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="repo-arrow">
                                                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                                                <polyline points="9 18 15 12 9 6"/>
                                                            </svg>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="repo-detail">
                                        <div className="repo-detail-header">
                                            <button className="btn btn-ghost btn-sm" onClick={backToRepoList}>
                                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                    <polyline points="15 18 9 12 15 6"/>
                                                </svg>
                                                Back
                                            </button>
                                            <div className="repo-title">
                                                <h3>{selectedRepo?.owner.login}/{selectedRepo?.name}</h3>
                                                {selectedRepo?.description && (
                                                    <p>{selectedRepo.description}</p>
                                                )}
                                            </div>
                                            <div className="branch-selector">
                                                <select
                                                    value={selectedBranch || ''}
                                                    onChange={(e) => changeBranch(e.target.value)}
                                                >
                                                    {branches.map((b) => (
                                                        <option key={b.name} value={b.name}>{b.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="repo-detail-tabs">
                                            <button
                                                className={`tab ${repoDetailTab === 'files' ? 'active' : ''}`}
                                                onClick={() => setRepoDetailTab('files')}
                                            >
                                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                                </svg>
                                                Files
                                            </button>
                                            <button
                                                className={`tab ${repoDetailTab === 'commits' ? 'active' : ''}`}
                                                onClick={() => setRepoDetailTab('commits')}
                                            >
                                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="4"/>
                                                    <line x1="1.05" y1="12" x2="7" y2="12"/>
                                                    <line x1="17.01" y1="12" x2="22.96" y2="12"/>
                                                </svg>
                                                Commits ({commits.length})
                                            </button>
                                            <button
                                                className={`tab ${repoDetailTab === 'branches' ? 'active' : ''}`}
                                                onClick={() => setRepoDetailTab('branches')}
                                            >
                                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                    <line x1="6" y1="3" x2="6" y2="15"/>
                                                    <circle cx="18" cy="6" r="3"/>
                                                    <circle cx="6" cy="18" r="3"/>
                                                    <path d="M18 9a9 9 0 0 1-9 9"/>
                                                </svg>
                                                Branches ({branches.length})
                                            </button>
                                        </div>

                                        <div className="repo-detail-content">
                                            {repoDetailTab === 'files' && (
                                                <div className="files-browser">
                                                    {currentPath && (
                                                        <div className="breadcrumb">
                                                            <button onClick={() => navigateToPath('')}>
                                                                {selectedRepo?.name}
                                                            </button>
                                                            {currentPath.split('/').map((part, i, arr) => (
                                                                <span key={i}>
                                                                    <span className="separator">/</span>
                                                                    <button
                                                                        onClick={() => navigateToPath(arr.slice(0, i + 1).join('/'))}
                                                                    >
                                                                        {part}
                                                                    </button>
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    <div className="files-list">
                                                        {currentPath && (
                                                            <div className="file-item dir" onClick={navigateUp}>
                                                                <div className="file-icon">
                                                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                                        <polyline points="15 18 9 12 15 6"/>
                                                                    </svg>
                                                                </div>
                                                                <span className="file-name">..</span>
                                                            </div>
                                                        )}
                                                        {files
                                                            .sort((a, b) => {
                                                                if (a.type === 'dir' && b.type !== 'dir') return -1;
                                                                if (a.type !== 'dir' && b.type === 'dir') return 1;
                                                                return a.name.localeCompare(b.name);
                                                            })
                                                            .map((file) => (
                                                                <div
                                                                    key={file.path}
                                                                    className={`file-item ${file.type}`}
                                                                    onClick={() => file.type === 'dir' && navigateToPath(file.path)}
                                                                >
                                                                    <div className="file-icon">
                                                                        {file.type === 'dir' ? (
                                                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                                                                            </svg>
                                                                        ) : (
                                                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                                                <polyline points="14 2 14 8 20 8"/>
                                                                            </svg>
                                                                        )}
                                                                    </div>
                                                                    <span className="file-name">{file.name}</span>
                                                                    {file.type === 'file' && (
                                                                        <span className="file-size">{formatFileSize(file.size)}</span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                    </div>
                                                </div>
                                            )}

                                            {repoDetailTab === 'commits' && (
                                                <div className="commits-list">
                                                    {commits.map((commit) => (
                                                        <div key={commit.sha} className="commit-item">
                                                            <div className="commit-info">
                                                                <div className="commit-message">
                                                                    {commit.message?.split('\n')[0]}
                                                                </div>
                                                                <div className="commit-meta">
                                                                    <span className="author">{commit.author?.name}</span>
                                                                    <span className="date">{formatDate(commit.author?.date)}</span>
                                                                </div>
                                                            </div>
                                                            <div className="commit-sha">
                                                                <code>{commit.short_sha}</code>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {commits.length >= 30 && (
                                                        <button
                                                            className="btn btn-secondary btn-block"
                                                            onClick={loadMoreCommits}
                                                        >
                                                            Load More
                                                        </button>
                                                    )}
                                                </div>
                                            )}

                                            {repoDetailTab === 'branches' && (
                                                <div className="branches-list">
                                                    {branches.map((branch) => (
                                                        <div
                                                            key={branch.name}
                                                            className={`branch-item ${branch.name === selectedBranch ? 'active' : ''}`}
                                                        >
                                                            <div className="branch-info">
                                                                <div className="branch-name">
                                                                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                                        <line x1="6" y1="3" x2="6" y2="15"/>
                                                                        <circle cx="18" cy="6" r="3"/>
                                                                        <circle cx="6" cy="18" r="3"/>
                                                                        <path d="M18 9a9 9 0 0 1-9 9"/>
                                                                    </svg>
                                                                    {branch.name}
                                                                    {branch.name === selectedRepo?.default_branch && (
                                                                        <span className="badge default">default</span>
                                                                    )}
                                                                    {branch.protected && (
                                                                        <span className="badge protected">protected</span>
                                                                    )}
                                                                </div>
                                                                {branch.commit && (
                                                                    <div className="branch-commit">
                                                                        <code>{branch.commit.sha?.slice(0, 7)}</code>
                                                                        <span className="commit-date">
                                                                            {formatDate(branch.commit.date)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <button
                                                                className="btn btn-sm btn-ghost"
                                                                onClick={() => changeBranch(branch.name)}
                                                            >
                                                                Switch
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'access' && (
                            <div className="access-tab">
                                <div className="info-card">
                                    <h3>HTTP Access</h3>
                                    <p className="text-muted">Access Gitea through your web browser</p>
                                    <div className="access-url">
                                        <code>{getGiteaUrl()}</code>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => {
                                                navigator.clipboard.writeText(getGiteaUrl());
                                                toast.success('URL copied');
                                            }}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                </div>
                                <div className="info-card">
                                    <h3>SSH Access</h3>
                                    <p className="text-muted">Clone repositories via SSH</p>
                                    <div className="access-url">
                                        <code>ssh://git@{window.location.hostname}:{status?.ssh_port}/username/repo.git</code>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => {
                                                navigator.clipboard.writeText(`ssh://git@${window.location.hostname}:${status?.ssh_port}/username/repo.git`);
                                                toast.success('URL copied');
                                            }}
                                        >
                                            Copy
                                        </button>
                                    </div>
                                    <div className="ssh-note">
                                        <strong>Note:</strong> Add your SSH public key in Gitea settings to use SSH access.
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'webhooks' && (
                            <div className="webhooks-tab">
                                <div className="webhooks-header">
                                    <div>
                                        <h3>External Repository Webhooks</h3>
                                        <p className="text-muted">Sync repositories from GitHub, GitLab, or Bitbucket</p>
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => setShowWebhookModal(true)}
                                    >
                                        Add Webhook
                                    </button>
                                </div>

                                {webhooksLoading ? (
                                    <div className="loading-state">
                                        <Spinner />
                                    </div>
                                ) : webhooks.length === 0 ? (
                                    <div className="empty-state">
                                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                        </svg>
                                        <h4>No Webhooks Configured</h4>
                                        <p>Add a webhook to sync repositories from external sources</p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => setShowWebhookModal(true)}
                                        >
                                            Add Your First Webhook
                                        </button>
                                    </div>
                                ) : (
                                    <div className="webhooks-list">
                                        {webhooks.map((webhook) => (
                                            <div key={webhook.id} className={`webhook-card ${!webhook.is_active ? 'inactive' : ''}`}>
                                                <div className="webhook-header">
                                                    <div className="webhook-info">
                                                        <span className={`source-badge ${webhook.source}`}>
                                                            {webhook.source}
                                                        </span>
                                                        <h4>{webhook.name}</h4>
                                                    </div>
                                                    <div className="webhook-status">
                                                        <span className={`status-dot ${webhook.is_active ? 'active' : 'inactive'}`}></span>
                                                        {webhook.is_active ? 'Active' : 'Inactive'}
                                                    </div>
                                                </div>

                                                <div className="webhook-details">
                                                    <div className="detail-item">
                                                        <span className="label">Repository:</span>
                                                        <span className="value">{webhook.source_repo_url}</span>
                                                    </div>
                                                    <div className="detail-item">
                                                        <span className="label">Branch:</span>
                                                        <span className="value">{webhook.source_branch}</span>
                                                    </div>
                                                    <div className="detail-item">
                                                        <span className="label">Last Sync:</span>
                                                        <span className="value">
                                                            {webhook.last_sync_at
                                                                ? new Date(webhook.last_sync_at).toLocaleString()
                                                                : 'Never'}
                                                        </span>
                                                    </div>
                                                    <div className="detail-item">
                                                        <span className="label">Sync Count:</span>
                                                        <span className="value">{webhook.sync_count}</span>
                                                    </div>
                                                </div>

                                                <div className="webhook-actions">
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => copyWebhookUrl(webhook)}
                                                        title="Copy webhook URL"
                                                    >
                                                        Copy URL
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => handleTestWebhook(webhook.id)}
                                                        title="Test webhook"
                                                    >
                                                        Test
                                                    </button>
                                                    <button
                                                        className={`btn btn-sm ${webhook.is_active ? 'btn-warning' : 'btn-primary'}`}
                                                        onClick={() => handleToggleWebhook(webhook.id)}
                                                    >
                                                        {webhook.is_active ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => handleDeleteWebhook(webhook.id)}
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'deployments' && (
                            <div className="deployments-tab">
                                <div className="deployments-header">
                                    <div>
                                        <h3>Deployment History</h3>
                                        <p className="text-muted">Track automatic and manual deployments</p>
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={loadAllDeployments}
                                        disabled={deploymentsLoading}
                                    >
                                        Refresh
                                    </button>
                                </div>

                                {deploymentsLoading ? (
                                    <div className="loading-state">
                                        <Spinner />
                                    </div>
                                ) : deployments.length === 0 ? (
                                    <div className="empty-state">
                                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                            <path d="M2 17l10 5 10-5"/>
                                            <path d="M2 12l10 5 10-5"/>
                                        </svg>
                                        <h4>No Deployments Yet</h4>
                                        <p>Configure a webhook with "Deploy on Push" enabled to see deployments here</p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => setActiveTab('webhooks')}
                                        >
                                            Configure Webhooks
                                        </button>
                                    </div>
                                ) : (
                                    <div className="deployments-list">
                                        {deployments.map((deployment) => (
                                            <div key={deployment.id} className={`deployment-card ${deployment.status}`}>
                                                <div className="deployment-header">
                                                    <div className="deployment-version">
                                                        <span className="version">v{deployment.version}</span>
                                                        {deployment.is_rollback && (
                                                            <span className="badge rollback">Rollback</span>
                                                        )}
                                                        <span className={`status-badge ${deployment.status}`}>
                                                            {deployment.status}
                                                        </span>
                                                    </div>
                                                    <div className="deployment-time">
                                                        {formatDate(deployment.created_at)}
                                                    </div>
                                                </div>

                                                <div className="deployment-details">
                                                    {deployment.commit_sha && (
                                                        <div className="detail-item">
                                                            <span className="label">Commit:</span>
                                                            <code>{deployment.commit_sha.slice(0, 7)}</code>
                                                        </div>
                                                    )}
                                                    {deployment.commit_message && (
                                                        <div className="detail-item commit-message">
                                                            <span className="message">{deployment.commit_message.split('\n')[0]}</span>
                                                        </div>
                                                    )}
                                                    <div className="detail-item">
                                                        <span className="label">Branch:</span>
                                                        <span className="value">{deployment.branch}</span>
                                                    </div>
                                                    <div className="detail-item">
                                                        <span className="label">Triggered by:</span>
                                                        <span className="value">{deployment.triggered_by}</span>
                                                    </div>
                                                    {deployment.webhook_name && (
                                                        <div className="detail-item">
                                                            <span className="label">Webhook:</span>
                                                            <span className="value">{deployment.webhook_name}</span>
                                                        </div>
                                                    )}
                                                    {deployment.duration_seconds != null && (
                                                        <div className="detail-item">
                                                            <span className="label">Duration:</span>
                                                            <span className="value">{deployment.duration_seconds}s</span>
                                                        </div>
                                                    )}
                                                    {deployment.error_message && (
                                                        <div className="detail-item error">
                                                            <span className="label">Error:</span>
                                                            <span className="value">{deployment.error_message}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="deployment-actions">
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => viewDeploymentLogs(deployment.id)}
                                                    >
                                                        View Logs
                                                    </button>
                                                    {deployment.status === 'success' && !deployment.is_rollback && (
                                                        <button
                                                            className="btn btn-sm btn-warning"
                                                            onClick={() => handleRollback(deployment.app_id, deployment.version)}
                                                        >
                                                            Rollback to This
                                                        </button>
                                                    )}
                                                    {deployment.status === 'success' && (
                                                        <button
                                                            className="btn btn-sm btn-primary"
                                                            onClick={() => handleTriggerDeploy(deployment.app_id)}
                                                            disabled={deployingAppId === deployment.app_id}
                                                        >
                                                            {deployingAppId === deployment.app_id ? 'Deploying...' : 'Redeploy'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'settings' && (
                            <div className="settings-tab">
                                <div className="info-card">
                                    <h3>Server Management</h3>
                                    <div className="settings-actions">
                                        {status?.running ? (
                                            <button
                                                className="btn btn-warning"
                                                onClick={handleStop}
                                                disabled={actionLoading}
                                            >
                                                Stop Server
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleStart}
                                                disabled={actionLoading}
                                            >
                                                Start Server
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-danger"
                                            onClick={handleUninstall}
                                            disabled={actionLoading}
                                        >
                                            Uninstall
                                        </button>
                                    </div>
                                </div>
                                <div className="info-card danger-zone">
                                    <h3>Danger Zone</h3>
                                    <p className="text-muted">
                                        Uninstalling will stop the Gitea container. Your data will be preserved unless you choose to remove it.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Install Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install Git Server</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="install-warning">
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                <div>
                                    <strong>This will install:</strong>
                                    <ul>
                                        <li>Gitea (Git server) - ~300MB RAM</li>
                                        <li>PostgreSQL database - ~200MB RAM</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Admin Username</label>
                                <input
                                    type="text"
                                    value={installForm.adminUser}
                                    onChange={(e) => setInstallForm({ ...installForm, adminUser: e.target.value })}
                                    placeholder="admin"
                                />
                            </div>
                            <div className="form-group">
                                <label>Admin Email <span className="required">*</span></label>
                                <input
                                    type="email"
                                    value={installForm.adminEmail}
                                    onChange={(e) => setInstallForm({ ...installForm, adminEmail: e.target.value })}
                                    placeholder="admin@example.com"
                                />
                            </div>
                            <div className="form-group">
                                <label>Admin Password (leave empty to auto-generate)</label>
                                <input
                                    type="password"
                                    value={installForm.adminPassword}
                                    onChange={(e) => setInstallForm({ ...installForm, adminPassword: e.target.value })}
                                    placeholder="Auto-generate secure password"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstall}
                                disabled={actionLoading || !installForm.adminEmail}
                            >
                                {actionLoading ? 'Installing...' : 'Install Git Server'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Webhook Modal */}
            {showWebhookModal && (
                <div className="modal-overlay" onClick={() => setShowWebhookModal(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Webhook</h2>
                            <button className="btn btn-icon" onClick={() => setShowWebhookModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Name <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={webhookForm.name}
                                    onChange={(e) => setWebhookForm({ ...webhookForm, name: e.target.value })}
                                    placeholder="My GitHub Repo"
                                />
                            </div>

                            <div className="form-group">
                                <label>Source</label>
                                <select
                                    value={webhookForm.source}
                                    onChange={(e) => setWebhookForm({ ...webhookForm, source: e.target.value })}
                                >
                                    <option value="github">GitHub</option>
                                    <option value="gitlab">GitLab</option>
                                    <option value="bitbucket">Bitbucket</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label>Repository URL <span className="required">*</span></label>
                                <input
                                    type="text"
                                    value={webhookForm.sourceRepoUrl}
                                    onChange={(e) => setWebhookForm({ ...webhookForm, sourceRepoUrl: e.target.value })}
                                    placeholder="https://github.com/user/repo.git"
                                />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Branch</label>
                                    <input
                                        type="text"
                                        value={webhookForm.sourceBranch}
                                        onChange={(e) => setWebhookForm({ ...webhookForm, sourceBranch: e.target.value })}
                                        placeholder="main"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Sync Direction</label>
                                    <select
                                        value={webhookForm.syncDirection}
                                        onChange={(e) => setWebhookForm({ ...webhookForm, syncDirection: e.target.value })}
                                    >
                                        <option value="pull">Pull (External → Local)</option>
                                        <option value="push">Push (Local → External)</option>
                                        <option value="bidirectional">Bidirectional</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Local Repository Name (optional)</label>
                                <input
                                    type="text"
                                    value={webhookForm.localRepoName}
                                    onChange={(e) => setWebhookForm({ ...webhookForm, localRepoName: e.target.value })}
                                    placeholder="Leave empty to use same name"
                                />
                            </div>

                            <div className="form-group checkbox">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={webhookForm.autoSync}
                                        onChange={(e) => setWebhookForm({ ...webhookForm, autoSync: e.target.checked })}
                                    />
                                    Auto-sync on push events
                                </label>
                            </div>

                            <div className="form-section">
                                <h4>Deployment Settings</h4>
                                <p className="text-muted">Optionally deploy an application when code is pushed</p>

                                <div className="form-group">
                                    <label>Deploy to Application</label>
                                    <select
                                        value={webhookForm.appId}
                                        onChange={(e) => setWebhookForm({
                                            ...webhookForm,
                                            appId: e.target.value,
                                            deployOnPush: e.target.value ? webhookForm.deployOnPush : false
                                        })}
                                    >
                                        <option value="">None (sync only)</option>
                                        {applications.map((app) => (
                                            <option key={app.id} value={app.id}>
                                                {app.name} ({app.status})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {webhookForm.appId && (
                                    <>
                                        <div className="form-group checkbox">
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={webhookForm.deployOnPush}
                                                    onChange={(e) => setWebhookForm({ ...webhookForm, deployOnPush: e.target.checked })}
                                                />
                                                Deploy on push
                                            </label>
                                            <span className="form-hint">Automatically deploy when code is pushed to the branch</span>
                                        </div>

                                        <div className="form-group checkbox">
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={webhookForm.zeroDowntime}
                                                    onChange={(e) => setWebhookForm({ ...webhookForm, zeroDowntime: e.target.checked })}
                                                />
                                                Zero-downtime deployment
                                            </label>
                                            <span className="form-hint">Use rolling update to minimize downtime</span>
                                        </div>

                                        <div className="form-group">
                                            <label>Pre-deploy Script (optional)</label>
                                            <textarea
                                                value={webhookForm.preDeployScript}
                                                onChange={(e) => setWebhookForm({ ...webhookForm, preDeployScript: e.target.value })}
                                                placeholder="#!/bin/bash&#10;npm install"
                                                rows={3}
                                            />
                                            <span className="form-hint">Runs before pulling code (e.g., npm install, migrations)</span>
                                        </div>

                                        <div className="form-group">
                                            <label>Post-deploy Script (optional)</label>
                                            <textarea
                                                value={webhookForm.postDeployScript}
                                                onChange={(e) => setWebhookForm({ ...webhookForm, postDeployScript: e.target.value })}
                                                placeholder="#!/bin/bash&#10;npm run cache:clear"
                                                rows={3}
                                            />
                                            <span className="form-hint">Runs after deployment completes (e.g., cache clear)</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowWebhookModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateWebhook}
                                disabled={actionLoading || !webhookForm.name || !webhookForm.sourceRepoUrl}
                            >
                                {actionLoading ? 'Creating...' : 'Create Webhook'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Webhook Secret Modal */}
            {webhookSecret && (
                <div className="modal-overlay" onClick={() => setWebhookSecret(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Webhook Secret</h2>
                            <button className="btn btn-icon" onClick={() => setWebhookSecret(null)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="secret-warning">
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span>Save this secret! It will not be shown again.</span>
                            </div>
                            <div className="secret-display">
                                <code>{webhookSecret}</code>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => {
                                        navigator.clipboard.writeText(webhookSecret);
                                        toast.success('Secret copied to clipboard');
                                    }}
                                >
                                    Copy
                                </button>
                            </div>
                            <p className="text-muted">
                                Use this secret when configuring the webhook in your repository settings.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={() => setWebhookSecret(null)}>
                                I've Saved It
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Deployment Logs Modal */}
            {showDeploymentLogs && selectedDeployment && (
                <div className="modal-overlay" onClick={() => setShowDeploymentLogs(false)}>
                    <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Deployment v{selectedDeployment.version} Logs</h2>
                            <button className="btn btn-icon" onClick={() => setShowDeploymentLogs(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="deployment-summary">
                                <div className="summary-item">
                                    <span className="label">Status:</span>
                                    <span className={`status-badge ${selectedDeployment.status}`}>
                                        {selectedDeployment.status}
                                    </span>
                                </div>
                                {selectedDeployment.commit_sha && (
                                    <div className="summary-item">
                                        <span className="label">Commit:</span>
                                        <code>{selectedDeployment.commit_sha.slice(0, 7)}</code>
                                    </div>
                                )}
                                <div className="summary-item">
                                    <span className="label">Branch:</span>
                                    <span>{selectedDeployment.branch}</span>
                                </div>
                                <div className="summary-item">
                                    <span className="label">Triggered by:</span>
                                    <span>{selectedDeployment.triggered_by}</span>
                                </div>
                                {selectedDeployment.duration_seconds != null && (
                                    <div className="summary-item">
                                        <span className="label">Duration:</span>
                                        <span>{selectedDeployment.duration_seconds}s</span>
                                    </div>
                                )}
                            </div>

                            {selectedDeployment.error_message && (
                                <div className="deployment-error">
                                    <strong>Error:</strong> {selectedDeployment.error_message}
                                </div>
                            )}

                            {selectedDeployment.pre_script_output && (
                                <div className="log-section">
                                    <h4>Pre-deployment Script Output</h4>
                                    <pre className="log-output">{selectedDeployment.pre_script_output}</pre>
                                </div>
                            )}

                            {selectedDeployment.deploy_output && (
                                <div className="log-section">
                                    <h4>Deployment Output</h4>
                                    <pre className="log-output">{selectedDeployment.deploy_output}</pre>
                                </div>
                            )}

                            {selectedDeployment.post_script_output && (
                                <div className="log-section">
                                    <h4>Post-deployment Script Output</h4>
                                    <pre className="log-output">{selectedDeployment.post_script_output}</pre>
                                </div>
                            )}

                            {!selectedDeployment.pre_script_output && !selectedDeployment.deploy_output && !selectedDeployment.post_script_output && (
                                <div className="no-logs">
                                    <p>No deployment logs available.</p>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowDeploymentLogs(false)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
}

export default Git;
