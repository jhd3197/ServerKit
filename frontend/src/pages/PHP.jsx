import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function PHP() {
    const [versions, setVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [extensions, setExtensions] = useState([]);
    const [pools, setPools] = useState([]);
    const [fpmStatus, setFpmStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('versions');
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [showExtensionModal, setShowExtensionModal] = useState(false);
    const [showPoolModal, setShowPoolModal] = useState(false);
    const [installVersion, setInstallVersion] = useState('8.2');
    const [newExtension, setNewExtension] = useState('');
    const [newPool, setNewPool] = useState({
        name: '',
        user: 'www-data',
        group: 'www-data',
        listen: '',
        pm: 'dynamic',
        pm_max_children: 5,
        pm_start_servers: 2,
        pm_min_spare_servers: 1,
        pm_max_spare_servers: 3
    });
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const toast = useToast();

    const availableVersions = ['8.0', '8.1', '8.2', '8.3'];

    useEffect(() => {
        loadVersions();
    }, []);

    useEffect(() => {
        if (selectedVersion) {
            loadVersionDetails(selectedVersion);
        }
    }, [selectedVersion]);

    const loadVersions = async () => {
        setLoading(true);
        try {
            const data = await api.getPHPVersions();
            setVersions(data.versions || []);
            if (data.versions?.length > 0) {
                const defaultVersion = data.versions.find(v => v.is_default) || data.versions[0];
                setSelectedVersion(defaultVersion.version);
            }
        } catch (error) {
            toast.error(`Failed to load PHP versions: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadVersionDetails = async (version) => {
        try {
            const [extData, poolData, statusData] = await Promise.all([
                api.getPHPExtensions(version).catch(() => ({ extensions: [] })),
                api.getPHPPools(version).catch(() => ({ pools: [] })),
                api.getPHPFPMStatus(version).catch(() => null)
            ]);
            setExtensions(extData.extensions || []);
            setPools(poolData.pools || []);
            setFpmStatus(statusData);
        } catch (error) {
            console.error('Failed to load version details:', error);
        }
    };

    const handleInstallVersion = async () => {
        setActionLoading(true);
        try {
            await api.installPHPVersion(installVersion);
            toast.success(`PHP ${installVersion} installation started`);
            setShowInstallModal(false);
            await loadVersions();
        } catch (error) {
            toast.error(`Failed to install PHP ${installVersion}: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleSetDefault = async (version) => {
        setActionLoading(true);
        try {
            await api.setDefaultPHPVersion(version);
            toast.success(`PHP ${version} is now the default version`);
            await loadVersions();
        } catch (error) {
            toast.error(`Failed to set default version: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInstallExtension = async () => {
        if (!newExtension.trim() || !selectedVersion) return;
        setActionLoading(true);
        try {
            await api.installPHPExtension(selectedVersion, newExtension);
            toast.success(`Extension ${newExtension} installation started`);
            setShowExtensionModal(false);
            setNewExtension('');
            await loadVersionDetails(selectedVersion);
        } catch (error) {
            toast.error(`Failed to install extension: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreatePool = async () => {
        if (!newPool.name.trim() || !selectedVersion) return;
        setActionLoading(true);
        try {
            const poolData = {
                ...newPool,
                listen: newPool.listen || `/run/php/php${selectedVersion}-fpm-${newPool.name}.sock`
            };
            await api.createPHPPool(selectedVersion, poolData);
            toast.success(`Pool ${newPool.name} created successfully`);
            setShowPoolModal(false);
            setNewPool({
                name: '',
                user: 'www-data',
                group: 'www-data',
                listen: '',
                pm: 'dynamic',
                pm_max_children: 5,
                pm_start_servers: 2,
                pm_min_spare_servers: 1,
                pm_max_spare_servers: 3
            });
            await loadVersionDetails(selectedVersion);
        } catch (error) {
            toast.error(`Failed to create pool: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeletePool = async (poolName) => {
        setConfirmDialog({
            title: 'Delete Pool',
            message: `Are you sure you want to delete the pool "${poolName}"?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deletePHPPool(selectedVersion, poolName);
                    toast.success(`Pool ${poolName} deleted`);
                    await loadVersionDetails(selectedVersion);
                } catch (error) {
                    toast.error(`Failed to delete pool: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleRestartFPM = async () => {
        if (!selectedVersion) return;
        setActionLoading(true);
        try {
            await api.restartPHPFPM(selectedVersion);
            toast.success(`PHP-FPM ${selectedVersion} restarted`);
            await loadVersionDetails(selectedVersion);
        } catch (error) {
            toast.error(`Failed to restart PHP-FPM: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const currentVersion = versions.find(v => v.version === selectedVersion);

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="php-management">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>PHP Management</h1>
                    <p className="page-description">Manage PHP versions, extensions, and FPM pools</p>
                </div>
                <div className="page-header-actions">
                    <button
                        className="btn btn-secondary"
                        onClick={handleRestartFPM}
                        disabled={!selectedVersion || actionLoading}
                    >
                        Restart FPM
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowInstallModal(true)}
                    >
                        Install PHP Version
                    </button>
                </div>
            </div>

            {versions.length === 0 ? (
                <div className="empty-state-large">
                    <span className="icon">code</span>
                    <h2>No PHP Versions Installed</h2>
                    <p>Install a PHP version to get started with PHP development.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => setShowInstallModal(true)}>
                        Install PHP
                    </button>
                </div>
            ) : (
                <>
                    <div className="version-selector">
                        <label>Active Version:</label>
                        <select
                            value={selectedVersion || ''}
                            onChange={(e) => setSelectedVersion(e.target.value)}
                        >
                            {versions.map(v => (
                                <option key={v.version} value={v.version}>
                                    PHP {v.version} {v.is_default ? '(Default)' : ''}
                                </option>
                            ))}
                        </select>
                        {currentVersion && !currentVersion.is_default && (
                            <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleSetDefault(selectedVersion)}
                                disabled={actionLoading}
                            >
                                Set as Default
                            </button>
                        )}
                    </div>

                    {fpmStatus && (
                        <div className="status-cards">
                            <div className={`status-card ${fpmStatus.active ? 'success' : 'warning'}`}>
                                <div className="status-icon">
                                    <span className="icon">{fpmStatus.active ? 'check_circle' : 'error'}</span>
                                </div>
                                <div className="status-info">
                                    <span className="status-label">FPM Status</span>
                                    <span className="status-value">{fpmStatus.active ? 'Running' : 'Stopped'}</span>
                                </div>
                            </div>
                            <div className="status-card">
                                <div className="status-icon">
                                    <span className="icon">extension</span>
                                </div>
                                <div className="status-info">
                                    <span className="status-label">Extensions</span>
                                    <span className="status-value">{extensions.length}</span>
                                </div>
                            </div>
                            <div className="status-card">
                                <div className="status-icon">
                                    <span className="icon">layers</span>
                                </div>
                                <div className="status-info">
                                    <span className="status-label">FPM Pools</span>
                                    <span className="status-value">{pools.length}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="tabs">
                        <button
                            className={`tab ${activeTab === 'versions' ? 'active' : ''}`}
                            onClick={() => setActiveTab('versions')}
                        >
                            Installed Versions
                        </button>
                        <button
                            className={`tab ${activeTab === 'extensions' ? 'active' : ''}`}
                            onClick={() => setActiveTab('extensions')}
                        >
                            Extensions
                        </button>
                        <button
                            className={`tab ${activeTab === 'pools' ? 'active' : ''}`}
                            onClick={() => setActiveTab('pools')}
                        >
                            FPM Pools
                        </button>
                    </div>

                    <div className="tab-content">
                        {activeTab === 'versions' && (
                            <div className="versions-tab">
                                <div className="versions-grid">
                                    {versions.map(v => (
                                        <div
                                            key={v.version}
                                            className={`version-card ${v.version === selectedVersion ? 'selected' : ''}`}
                                            onClick={() => setSelectedVersion(v.version)}
                                        >
                                            <div className="version-header">
                                                <span className="version-number">PHP {v.version}</span>
                                                {v.is_default && <span className="badge badge-primary">Default</span>}
                                            </div>
                                            <div className="version-details">
                                                <div className="detail-row">
                                                    <span className="label">Binary:</span>
                                                    <code>{v.binary || `/usr/bin/php${v.version}`}</code>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="label">FPM:</span>
                                                    <span className={`status ${v.fpm_active ? 'active' : 'inactive'}`}>
                                                        {v.fpm_active ? 'Running' : 'Stopped'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="version-actions">
                                                {!v.is_default && (
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSetDefault(v.version);
                                                        }}
                                                    >
                                                        Set Default
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'extensions' && (
                            <div className="extensions-tab">
                                <div className="section-header">
                                    <h3>Installed Extensions (PHP {selectedVersion})</h3>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => setShowExtensionModal(true)}
                                    >
                                        Install Extension
                                    </button>
                                </div>
                                {extensions.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">extension</span>
                                        <p>No extensions found</p>
                                    </div>
                                ) : (
                                    <div className="extensions-grid">
                                        {extensions.map(ext => (
                                            <div key={ext.name || ext} className="extension-card">
                                                <span className="extension-name">{ext.name || ext}</span>
                                                {ext.version && (
                                                    <span className="extension-version">{ext.version}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'pools' && (
                            <div className="pools-tab">
                                <div className="section-header">
                                    <h3>FPM Pools (PHP {selectedVersion})</h3>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => setShowPoolModal(true)}
                                    >
                                        Create Pool
                                    </button>
                                </div>
                                {pools.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">layers</span>
                                        <p>No FPM pools configured</p>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => setShowPoolModal(true)}
                                        >
                                            Create Pool
                                        </button>
                                    </div>
                                ) : (
                                    <div className="pools-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Pool Name</th>
                                                    <th>User</th>
                                                    <th>Listen</th>
                                                    <th>Process Manager</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pools.map(pool => (
                                                    <tr key={pool.name}>
                                                        <td>
                                                            <strong>{pool.name}</strong>
                                                        </td>
                                                        <td>{pool.user}:{pool.group}</td>
                                                        <td><code>{pool.listen}</code></td>
                                                        <td>
                                                            <span className="badge">{pool.pm || 'dynamic'}</span>
                                                        </td>
                                                        <td>
                                                            <button
                                                                className="btn btn-sm btn-danger"
                                                                onClick={() => handleDeletePool(pool.name)}
                                                                disabled={pool.name === 'www'}
                                                                title={pool.name === 'www' ? 'Cannot delete default pool' : 'Delete pool'}
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
                    </div>
                </>
            )}

            {/* Install Version Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install PHP Version</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>PHP Version</label>
                                <select
                                    value={installVersion}
                                    onChange={(e) => setInstallVersion(e.target.value)}
                                >
                                    {availableVersions.map(v => (
                                        <option
                                            key={v}
                                            value={v}
                                            disabled={versions.some(iv => iv.version === v)}
                                        >
                                            PHP {v} {versions.some(iv => iv.version === v) ? '(Installed)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <p className="text-muted">
                                This will install PHP {installVersion} with common extensions including
                                cli, fpm, mysql, pgsql, sqlite3, curl, gd, mbstring, xml, and zip.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstallVersion}
                                disabled={actionLoading || versions.some(v => v.version === installVersion)}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Install Extension Modal */}
            {showExtensionModal && (
                <div className="modal-overlay" onClick={() => setShowExtensionModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install PHP Extension</h2>
                            <button className="btn btn-icon" onClick={() => setShowExtensionModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Extension Name</label>
                                <input
                                    type="text"
                                    value={newExtension}
                                    onChange={(e) => setNewExtension(e.target.value)}
                                    placeholder="e.g., redis, imagick, xdebug"
                                />
                            </div>
                            <div className="common-extensions">
                                <p className="text-muted">Common extensions:</p>
                                <div className="extension-chips">
                                    {['redis', 'imagick', 'xdebug', 'memcached', 'opcache', 'intl', 'soap', 'ldap'].map(ext => (
                                        <button
                                            key={ext}
                                            className="chip"
                                            onClick={() => setNewExtension(ext)}
                                        >
                                            {ext}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowExtensionModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstallExtension}
                                disabled={actionLoading || !newExtension.trim()}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Pool Modal */}
            {showPoolModal && (
                <div className="modal-overlay" onClick={() => setShowPoolModal(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create FPM Pool</h2>
                            <button className="btn btn-icon" onClick={() => setShowPoolModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Pool Name *</label>
                                    <input
                                        type="text"
                                        value={newPool.name}
                                        onChange={(e) => setNewPool({ ...newPool, name: e.target.value })}
                                        placeholder="myapp"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Process Manager</label>
                                    <select
                                        value={newPool.pm}
                                        onChange={(e) => setNewPool({ ...newPool, pm: e.target.value })}
                                    >
                                        <option value="dynamic">Dynamic</option>
                                        <option value="static">Static</option>
                                        <option value="ondemand">On Demand</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>User</label>
                                    <input
                                        type="text"
                                        value={newPool.user}
                                        onChange={(e) => setNewPool({ ...newPool, user: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Group</label>
                                    <input
                                        type="text"
                                        value={newPool.group}
                                        onChange={(e) => setNewPool({ ...newPool, group: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Listen Socket (leave empty for default)</label>
                                <input
                                    type="text"
                                    value={newPool.listen}
                                    onChange={(e) => setNewPool({ ...newPool, listen: e.target.value })}
                                    placeholder={`/run/php/php${selectedVersion}-fpm-${newPool.name || 'poolname'}.sock`}
                                />
                            </div>
                            {newPool.pm === 'dynamic' && (
                                <div className="form-row form-row-4">
                                    <div className="form-group">
                                        <label>Max Children</label>
                                        <input
                                            type="number"
                                            value={newPool.pm_max_children}
                                            onChange={(e) => setNewPool({ ...newPool, pm_max_children: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Start Servers</label>
                                        <input
                                            type="number"
                                            value={newPool.pm_start_servers}
                                            onChange={(e) => setNewPool({ ...newPool, pm_start_servers: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Min Spare</label>
                                        <input
                                            type="number"
                                            value={newPool.pm_min_spare_servers}
                                            onChange={(e) => setNewPool({ ...newPool, pm_min_spare_servers: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Max Spare</label>
                                        <input
                                            type="number"
                                            value={newPool.pm_max_spare_servers}
                                            onChange={(e) => setNewPool({ ...newPool, pm_max_spare_servers: parseInt(e.target.value) })}
                                            min="1"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPoolModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreatePool}
                                disabled={actionLoading || !newPool.name.trim()}
                            >
                                {actionLoading ? 'Creating...' : 'Create Pool'}
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

export default PHP;
