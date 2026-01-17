import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function FTPServer() {
    const [status, setStatus] = useState(null);
    const [users, setUsers] = useState([]);
    const [connections, setConnections] = useState([]);
    const [config, setConfig] = useState(null);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [showUserModal, setShowUserModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '', homeDir: '' });
    const [passwordTarget, setPasswordTarget] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [selectedService, setSelectedService] = useState('vsftpd');
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadStatus(),
                loadUsers(),
                loadConnections()
            ]);
        } catch (error) {
            console.error('Failed to load FTP data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getFTPStatus();
            setStatus(data);
            if (data.active_server) {
                loadConfig(data.active_server);
            }
        } catch (error) {
            console.error('Failed to load FTP status:', error);
        }
    };

    const loadConfig = async (service) => {
        try {
            const data = await api.getFTPConfig(service);
            setConfig(data);
        } catch (error) {
            console.error('Failed to load FTP config:', error);
        }
    };

    const loadUsers = async () => {
        try {
            const data = await api.getFTPUsers();
            setUsers(data.users || []);
        } catch (error) {
            console.error('Failed to load FTP users:', error);
        }
    };

    const loadConnections = async () => {
        try {
            const data = await api.getFTPConnections();
            setConnections(data.connections || []);
        } catch (error) {
            console.error('Failed to load FTP connections:', error);
        }
    };

    const loadLogs = async () => {
        try {
            const data = await api.getFTPLogs(200);
            setLogs(data.content || 'No logs available');
        } catch (error) {
            setLogs('Failed to load logs');
        }
    };

    const handleServiceAction = async (action) => {
        if (!status?.active_server) return;
        setActionLoading(true);
        try {
            await api.controlFTPService(action, status.active_server);
            toast.success(`FTP server ${action}ed successfully`);
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to ${action} FTP server: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFTPServer(selectedService);
            toast.success(`${selectedService} installed successfully`);
            setShowInstallModal(false);
            await loadData();
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreateUser = async () => {
        if (!newUser.username.trim()) return;
        setActionLoading(true);
        try {
            const result = await api.createFTPUser(
                newUser.username,
                newUser.password || null,
                newUser.homeDir || null
            );
            toast.success(`User created. Password: ${result.password}`);
            setShowUserModal(false);
            setNewUser({ username: '', password: '', homeDir: '' });
            await loadUsers();
        } catch (error) {
            toast.error(`Failed to create user: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteUser = async (username) => {
        setConfirmDialog({
            title: 'Delete FTP User',
            message: `Are you sure you want to delete user "${username}"?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteFTPUser(username, false);
                    toast.success('User deleted successfully');
                    await loadUsers();
                } catch (error) {
                    toast.error(`Failed to delete user: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleToggleUser = async (username, currentStatus) => {
        try {
            await api.toggleFTPUser(username, !currentStatus);
            toast.success(`User ${currentStatus ? 'disabled' : 'enabled'} successfully`);
            await loadUsers();
        } catch (error) {
            toast.error(`Failed to toggle user: ${error.message}`);
        }
    };

    const handleChangePassword = async () => {
        if (!passwordTarget) return;
        setActionLoading(true);
        try {
            const result = await api.changeFTPPassword(passwordTarget, newPassword || null);
            toast.success(`Password changed. New password: ${result.password}`);
            setShowPasswordModal(false);
            setPasswordTarget(null);
            setNewPassword('');
        } catch (error) {
            toast.error(`Failed to change password: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisconnect = async (pid) => {
        try {
            await api.disconnectFTPSession(pid);
            toast.success('Session disconnected');
            await loadConnections();
        } catch (error) {
            toast.error(`Failed to disconnect: ${error.message}`);
        }
    };

    const handleTestConnection = async () => {
        setActionLoading(true);
        try {
            const result = await api.testFTPConnection('localhost', 21);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.error);
            }
        } catch (error) {
            toast.error(`Connection test failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const openPasswordModal = (username) => {
        setPasswordTarget(username);
        setNewPassword('');
        setShowPasswordModal(true);
    };

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    const isInstalled = status?.any_installed;
    const isRunning = status?.any_running;
    const activeServer = status?.active_server;

    return (
        <div className="ftp-server">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>FTP Server</h1>
                    <p className="page-description">Manage FTP users and file transfer settings</p>
                </div>
                <div className="page-header-actions">
                    {!isInstalled ? (
                        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                            Install FTP Server
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={handleTestConnection}
                                disabled={actionLoading}
                            >
                                Test Connection
                            </button>
                            {isRunning ? (
                                <>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => handleServiceAction('restart')}
                                        disabled={actionLoading}
                                    >
                                        Restart
                                    </button>
                                    <button
                                        className="btn btn-danger"
                                        onClick={() => handleServiceAction('stop')}
                                        disabled={actionLoading}
                                    >
                                        Stop
                                    </button>
                                </>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleServiceAction('start')}
                                    disabled={actionLoading}
                                >
                                    Start
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {!isInstalled ? (
                <div className="empty-state-large">
                    <span className="icon">cloud_upload</span>
                    <h2>No FTP Server Installed</h2>
                    <p>Install an FTP server to enable file transfers on your server.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => setShowInstallModal(true)}>
                        Install FTP Server
                    </button>
                </div>
            ) : (
                <>
                    <div className="status-cards">
                        <div className={`status-card ${isRunning ? 'success' : 'warning'}`}>
                            <div className="status-icon">
                                <span className="icon">{isRunning ? 'check_circle' : 'pause_circle'}</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Server Status</span>
                                <span className="status-value">{isRunning ? 'Running' : 'Stopped'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">dns</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Active Server</span>
                                <span className="status-value">{activeServer || 'None'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">people</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">FTP Users</span>
                                <span className="status-value">{users.length}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">lan</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Active Connections</span>
                                <span className="status-value">{connections.length}</span>
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
                            className={`tab ${activeTab === 'users' ? 'active' : ''}`}
                            onClick={() => setActiveTab('users')}
                        >
                            Users
                        </button>
                        <button
                            className={`tab ${activeTab === 'connections' ? 'active' : ''}`}
                            onClick={() => { setActiveTab('connections'); loadConnections(); }}
                        >
                            Connections
                        </button>
                        <button
                            className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
                            onClick={() => { setActiveTab('logs'); loadLogs(); }}
                        >
                            Logs
                        </button>
                    </div>

                    <div className="tab-content">
                        {activeTab === 'overview' && (
                            <div className="overview-tab">
                                <div className="config-section">
                                    <h3>Server Configuration</h3>
                                    {config?.settings ? (
                                        <div className="config-grid">
                                            <div className="config-item">
                                                <span className="config-label">Port</span>
                                                <span className="config-value">{config.settings.listen_port || config.settings.port || 21}</span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Anonymous Access</span>
                                                <span className={`config-value ${config.settings.anonymous_enable ? 'warning' : 'success'}`}>
                                                    {config.settings.anonymous_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Local Users</span>
                                                <span className="config-value">
                                                    {config.settings.local_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Write Permission</span>
                                                <span className="config-value">
                                                    {config.settings.write_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">Chroot Users</span>
                                                <span className="config-value">
                                                    {config.settings.chroot_local_user ? 'Yes' : 'No'}
                                                </span>
                                            </div>
                                            <div className="config-item">
                                                <span className="config-label">SSL/TLS</span>
                                                <span className={`config-value ${config.settings.ssl_enable ? 'success' : 'warning'}`}>
                                                    {config.settings.ssl_enable ? 'Enabled' : 'Disabled'}
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-muted">Configuration not available</p>
                                    )}
                                </div>

                                <div className="info-section">
                                    <h3>Connection Information</h3>
                                    <div className="info-grid">
                                        <div className="info-item">
                                            <span className="info-label">Host</span>
                                            <code>Your server IP or domain</code>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Port</span>
                                            <code>21</code>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Protocol</span>
                                            <code>FTP{config?.settings?.ssl_enable ? 'S' : ''}</code>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'users' && (
                            <div className="users-tab">
                                <div className="section-header">
                                    <h3>FTP Users</h3>
                                    <button className="btn btn-primary" onClick={() => setShowUserModal(true)}>
                                        Add User
                                    </button>
                                </div>
                                {users.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">person_add</span>
                                        <p>No FTP users configured</p>
                                        <button className="btn btn-primary" onClick={() => setShowUserModal(true)}>
                                            Create First User
                                        </button>
                                    </div>
                                ) : (
                                    <div className="users-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Username</th>
                                                    <th>Home Directory</th>
                                                    <th>Usage</th>
                                                    <th>Status</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {users.map((user) => (
                                                    <tr key={user.username}>
                                                        <td>
                                                            <span className="user-name">{user.username}</span>
                                                            {user.in_userlist && (
                                                                <span className="badge badge-info">FTP</span>
                                                            )}
                                                        </td>
                                                        <td>
                                                            <code>{user.home}</code>
                                                            {!user.home_exists && (
                                                                <span className="badge badge-warning">Missing</span>
                                                            )}
                                                        </td>
                                                        <td>{user.home_size_human}</td>
                                                        <td>
                                                            <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                                                                {user.is_active ? 'Active' : 'Disabled'}
                                                            </span>
                                                        </td>
                                                        <td className="actions">
                                                            <button
                                                                className="btn btn-sm btn-secondary"
                                                                onClick={() => openPasswordModal(user.username)}
                                                                title="Change Password"
                                                            >
                                                                <span className="icon">key</span>
                                                            </button>
                                                            <button
                                                                className={`btn btn-sm ${user.is_active ? 'btn-warning' : 'btn-success'}`}
                                                                onClick={() => handleToggleUser(user.username, user.is_active)}
                                                                title={user.is_active ? 'Disable' : 'Enable'}
                                                            >
                                                                <span className="icon">{user.is_active ? 'block' : 'check'}</span>
                                                            </button>
                                                            <button
                                                                className="btn btn-sm btn-danger"
                                                                onClick={() => handleDeleteUser(user.username)}
                                                                title="Delete"
                                                            >
                                                                <span className="icon">delete</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'connections' && (
                            <div className="connections-tab">
                                <div className="section-header">
                                    <h3>Active Connections</h3>
                                    <button className="btn btn-secondary" onClick={loadConnections}>
                                        <span className="icon">refresh</span>
                                        Refresh
                                    </button>
                                </div>
                                {connections.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">lan</span>
                                        <p>No active connections</p>
                                    </div>
                                ) : (
                                    <div className="connections-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Local Address</th>
                                                    <th>Remote Address</th>
                                                    <th>State</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {connections.map((conn, index) => (
                                                    <tr key={index}>
                                                        <td><code>{conn.local}</code></td>
                                                        <td><code>{conn.remote}</code></td>
                                                        <td>
                                                            <span className="status-badge active">{conn.state}</span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="btn btn-sm btn-danger"
                                                                onClick={() => handleDisconnect(conn.pid)}
                                                                title="Disconnect"
                                                            >
                                                                <span className="icon">close</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'logs' && (
                            <div className="logs-tab">
                                <div className="section-header">
                                    <h3>Server Logs</h3>
                                    <button className="btn btn-secondary" onClick={loadLogs}>
                                        <span className="icon">refresh</span>
                                        Refresh
                                    </button>
                                </div>
                                <div className="log-viewer">
                                    <pre>{logs}</pre>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Install Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install FTP Server</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Select FTP Server</label>
                                <select
                                    value={selectedService}
                                    onChange={(e) => setSelectedService(e.target.value)}
                                >
                                    <option value="vsftpd">vsftpd (Recommended)</option>
                                    <option value="proftpd">ProFTPD</option>
                                </select>
                            </div>
                            <div className="install-info">
                                {selectedService === 'vsftpd' ? (
                                    <p>
                                        <strong>vsftpd</strong> is a secure, fast, and stable FTP server.
                                        It's the default choice for most Ubuntu/Debian systems.
                                    </p>
                                ) : (
                                    <p>
                                        <strong>ProFTPD</strong> is a highly configurable FTP server with
                                        advanced features and Apache-like configuration syntax.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstall}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create User Modal */}
            {showUserModal && (
                <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create FTP User</h2>
                            <button className="btn btn-icon" onClick={() => setShowUserModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Username *</label>
                                <input
                                    type="text"
                                    value={newUser.username}
                                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                    placeholder="ftpuser"
                                />
                            </div>
                            <div className="form-group">
                                <label>Password (leave empty to auto-generate)</label>
                                <input
                                    type="password"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                    placeholder="Auto-generated if empty"
                                />
                            </div>
                            <div className="form-group">
                                <label>Home Directory (optional)</label>
                                <input
                                    type="text"
                                    value={newUser.homeDir}
                                    onChange={(e) => setNewUser({ ...newUser, homeDir: e.target.value })}
                                    placeholder="/home/ftp/username"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowUserModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateUser}
                                disabled={actionLoading || !newUser.username.trim()}
                            >
                                {actionLoading ? 'Creating...' : 'Create User'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Change Password Modal */}
            {showPasswordModal && (
                <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Change Password</h2>
                            <button className="btn btn-icon" onClick={() => setShowPasswordModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Changing password for user: <strong>{passwordTarget}</strong></p>
                            <div className="form-group">
                                <label>New Password (leave empty to auto-generate)</label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Auto-generated if empty"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleChangePassword}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Changing...' : 'Change Password'}
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

export default FTPServer;
