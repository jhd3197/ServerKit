import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useResourceTier } from '../contexts/ResourceTierContext';
import ResourceGate from '../components/ResourceGate';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function WordPress() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [installForm, setInstallForm] = useState({
        adminEmail: ''
    });

    const toast = useToast();
    const { isLiteTier } = useResourceTier();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            await loadStatus();
        } catch (error) {
            console.error('Failed to load WordPress data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getWordPressStatus();
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
            const result = await api.installWordPress(installForm);
            if (result.success) {
                toast.success('WordPress installed successfully');
                setShowInstallModal(false);
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

    const handleUninstall = () => {
        setConfirmDialog({
            title: 'Uninstall WordPress',
            message: 'Are you sure you want to uninstall WordPress? This will stop the containers but preserve your data.',
            confirmText: 'Uninstall',
            variant: 'danger',
            onConfirm: async () => {
                setActionLoading(true);
                try {
                    await api.uninstallWordPress(false);
                    toast.success('WordPress uninstalled');
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
            await api.startWordPress();
            toast.success('WordPress started');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to start: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleStop = () => {
        setConfirmDialog({
            title: 'Stop WordPress',
            message: 'Are you sure you want to stop WordPress?',
            confirmText: 'Stop',
            variant: 'warning',
            onConfirm: async () => {
                setActionLoading(true);
                try {
                    await api.stopWordPress();
                    toast.success('WordPress stopped');
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

    const handleRestart = async () => {
        setActionLoading(true);
        try {
            await api.restartWordPress();
            toast.success('WordPress restarted');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to restart: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const openWordPress = () => {
        if (status?.url_path) {
            window.open(`${window.location.origin}${status.url_path}`, '_blank');
        } else if (status?.http_port) {
            window.open(`http://${window.location.hostname}:${status.http_port}`, '_blank');
        }
    };

    const openWpAdmin = () => {
        if (status?.url_path) {
            window.open(`${window.location.origin}${status.url_path}/wp-admin`, '_blank');
        } else if (status?.http_port) {
            window.open(`http://${window.location.hostname}:${status.http_port}/wp-admin`, '_blank');
        }
    };

    const getWordPressUrl = () => {
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

    // Not installed + lite tier -> resource gate
    if (!status?.installed && isLiteTier) {
        return (
            <div className="docker-page-new wordpress-page">
                <ResourceGate feature="wordpress_create">
                    <div />
                </ResourceGate>
            </div>
        );
    }

    return (
        <div className="git-page wordpress-standalone-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>WordPress</h1>
                    <p className="page-description">Self-hosted WordPress powered by Docker</p>
                </div>
                <div className="page-header-actions">
                    {!status?.installed ? (
                        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                            Install WordPress
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={openWordPress}
                                disabled={!status?.running}
                            >
                                Open WordPress
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={openWpAdmin}
                                disabled={!status?.running}
                            >
                                Open wp-admin
                            </button>
                            {status?.running ? (
                                <button
                                    className="btn btn-warning"
                                    onClick={handleStop}
                                    disabled={actionLoading}
                                >
                                    Stop
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleStart}
                                    disabled={actionLoading}
                                >
                                    Start
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Not installed - show install screen */}
            {!status?.installed && (
                <div className="empty-state-large">
                    <div className="empty-icon">
                        <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                            <path d="M2 12h20"/>
                        </svg>
                    </div>
                    <h2>WordPress Not Installed</h2>
                    <p>Deploy WordPress with MySQL using Docker Compose. One-click setup with automatic configuration.</p>
                    <div className="resource-warning">
                        <div className="warning-header">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                            <strong>Resource Requirements</strong>
                        </div>
                        <ul>
                            <li><strong>Memory:</strong> 512MB minimum, 1GB recommended</li>
                            <li><strong>Storage:</strong> 2GB minimum, 10GB recommended</li>
                            <li>Deploys WordPress + MySQL 8.0 containers</li>
                        </ul>
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                        Install WordPress
                    </button>
                </div>
            )}

            {/* Installed - show status */}
            {status?.installed && (
                <>
                    <div className="status-cards">
                        <div className={`status-card ${status?.running ? 'success' : 'danger'}`}>
                            <div className="status-icon">
                                {status?.running ? (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                ) : (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                                )}
                            </div>
                            <div className="status-info">
                                <span className="status-label">Status</span>
                                <span className="status-value">{status?.running ? 'Running' : 'Stopped'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Version</span>
                                <span className="status-value">{status?.version || '6.4'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Port</span>
                                <span className="status-value">{status?.http_port || '—'}</span>
                            </div>
                        </div>
                    </div>

                    <div className="overview-tab">
                        <div className="info-card">
                            <h3>Access</h3>
                            <div className="info-grid">
                                <div className="info-item">
                                    <span className="info-label">URL</span>
                                    <span className="info-value">
                                        {status?.running ? (
                                            <a href={getWordPressUrl()} target="_blank" rel="noopener noreferrer">
                                                {getWordPressUrl()}
                                            </a>
                                        ) : '—'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Admin Panel</span>
                                    <span className="info-value">
                                        {status?.running ? (
                                            <a href={`${getWordPressUrl()}/wp-admin`} target="_blank" rel="noopener noreferrer">
                                                {getWordPressUrl()}/wp-admin
                                            </a>
                                        ) : '—'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">HTTP Port</span>
                                    <span className="info-value code">{status?.http_port || '—'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="info-card">
                            <h3>Actions</h3>
                            <div className="info-grid">
                                <div className="quick-actions">
                                    {status?.running ? (
                                        <>
                                            <button className="btn btn-secondary" onClick={handleRestart} disabled={actionLoading}>
                                                Restart
                                            </button>
                                            <button className="btn btn-warning" onClick={handleStop} disabled={actionLoading}>
                                                Stop
                                            </button>
                                        </>
                                    ) : (
                                        <button className="btn btn-primary" onClick={handleStart} disabled={actionLoading}>
                                            Start
                                        </button>
                                    )}
                                    <button className="btn btn-danger" onClick={handleUninstall} disabled={actionLoading}>
                                        Uninstall
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Install Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => !actionLoading && setShowInstallModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Install WordPress</h3>
                            <button className="modal-close" onClick={() => !actionLoading && setShowInstallModal(false)}>
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="install-warning">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                                <div>
                                    <strong>This will install:</strong>
                                    <ul>
                                        <li>WordPress 6.4 (Apache)</li>
                                        <li>MySQL 8.0 database</li>
                                        <li>Nginx reverse proxy at /wordpress</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>
                                    Admin Email <span className="required">*</span>
                                </label>
                                <input
                                    type="email"
                                    value={installForm.adminEmail}
                                    onChange={e => setInstallForm({ ...installForm, adminEmail: e.target.value })}
                                    placeholder="admin@example.com"
                                    disabled={actionLoading}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowInstallModal(false)}
                                disabled={actionLoading}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstall}
                                disabled={actionLoading || !installForm.adminEmail}
                            >
                                {actionLoading ? <><Spinner size="sm" /> Installing...</> : 'Install WordPress'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

export default WordPress;
