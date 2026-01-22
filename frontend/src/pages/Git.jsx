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
    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

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
                            className={`tab ${activeTab === 'access' ? 'active' : ''}`}
                            onClick={() => setActiveTab('access')}
                        >
                            Access Info
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
