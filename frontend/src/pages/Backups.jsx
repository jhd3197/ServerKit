import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Backups = () => {
    const toast = useToast();
    const [backups, setBackups] = useState([]);
    const [stats, setStats] = useState(null);
    const [schedules, setSchedules] = useState([]);
    const [config, setConfig] = useState(null);
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('backups');
    const [filterType, setFilterType] = useState('all');

    // Modal states
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState(null);

    // Backup form state
    const [backupForm, setBackupForm] = useState({
        type: 'application',
        applicationId: '',
        includeDb: false,
        dbType: 'mysql',
        dbName: '',
        dbUser: '',
        dbPassword: '',
        dbHost: 'localhost'
    });

    // Schedule form state
    const [scheduleForm, setScheduleForm] = useState({
        name: '',
        backupType: 'application',
        target: '',
        scheduleTime: '02:00',
        days: ['daily']
    });

    // Config form state
    const [configForm, setConfigForm] = useState({
        enabled: false,
        retention_days: 30
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [backupsRes, statsRes, schedulesRes, configRes, appsRes] = await Promise.all([
                api.getBackups(),
                api.getBackupStats(),
                api.getBackupSchedules(),
                api.getBackupConfig(),
                api.getApps()
            ]);

            setBackups(backupsRes.backups || []);
            setStats(statsRes);
            setSchedules(schedulesRes.schedules || []);
            setConfig(configRes);
            setApps(appsRes.applications || []);

            if (configRes) {
                setConfigForm({
                    enabled: configRes.enabled || false,
                    retention_days: configRes.retention_days || 30
                });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        try {
            if (backupForm.type === 'application') {
                const dbConfig = backupForm.includeDb ? {
                    type: backupForm.dbType,
                    name: backupForm.dbName,
                    user: backupForm.dbUser,
                    password: backupForm.dbPassword,
                    host: backupForm.dbHost
                } : null;
                await api.backupApplication(parseInt(backupForm.applicationId), backupForm.includeDb, dbConfig);
            } else {
                await api.backupDatabase(
                    backupForm.dbType,
                    backupForm.dbName,
                    backupForm.dbUser,
                    backupForm.dbPassword,
                    backupForm.dbHost
                );
            }
            setShowBackupModal(false);
            resetBackupForm();
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleDeleteBackup = async (backupPath) => {
        if (!window.confirm('Are you sure you want to delete this backup?')) return;
        try {
            await api.deleteBackup(backupPath);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleRestore = async () => {
        if (!selectedBackup) return;
        if (!window.confirm('Are you sure you want to restore this backup? This may overwrite existing data.')) return;

        try {
            if (selectedBackup.type === 'application') {
                await api.restoreApplication(selectedBackup.path);
            } else {
                await api.restoreDatabase(
                    selectedBackup.path,
                    selectedBackup.database_type,
                    selectedBackup.database_name
                );
            }
            setShowRestoreModal(false);
            setSelectedBackup(null);
            toast.success('Backup restored successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleAddSchedule = async (e) => {
        e.preventDefault();
        try {
            await api.addBackupSchedule(
                scheduleForm.name,
                scheduleForm.backupType,
                scheduleForm.target,
                scheduleForm.scheduleTime,
                scheduleForm.days
            );
            setShowScheduleModal(false);
            resetScheduleForm();
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleRemoveSchedule = async (scheduleId) => {
        if (!window.confirm('Are you sure you want to remove this schedule?')) return;
        try {
            await api.removeBackupSchedule(scheduleId);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateBackupConfig(configForm);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleCleanup = async () => {
        if (!window.confirm(`This will delete backups older than ${configForm.retention_days} days. Continue?`)) return;
        try {
            const result = await api.cleanupBackups(configForm.retention_days);
            toast.success(result.message);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const resetBackupForm = () => {
        setBackupForm({
            type: 'application',
            applicationId: '',
            includeDb: false,
            dbType: 'mysql',
            dbName: '',
            dbUser: '',
            dbPassword: '',
            dbHost: 'localhost'
        });
    };

    const resetScheduleForm = () => {
        setScheduleForm({
            name: '',
            backupType: 'application',
            target: '',
            scheduleTime: '02:00',
            days: ['daily']
        });
    };

    const formatSize = (bytes) => {
        if (!bytes) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let size = bytes;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    const filteredBackups = filterType === 'all'
        ? backups
        : backups.filter(b => b.type === filterType);

    if (loading) {
        return <div className="page"><div className="loading">Loading backup data...</div></div>;
    }

    return (
        <div className="page backups-page">
            <div className="page-header">
                <div>
                    <h1>Backups</h1>
                    <p className="page-subtitle">Manage application and database backups</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary" onClick={() => setShowScheduleModal(true)}>
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Add Schedule
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowBackupModal(true)}>
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Create Backup
                    </button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon backups">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Total Backups</span>
                        <span className="stat-value">{stats?.total_backups || 0}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon apps">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Application Backups</span>
                        <span className="stat-value">{stats?.application_backups || 0}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon databases">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Database Backups</span>
                        <span className="stat-value">{stats?.database_backups || 0}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon size">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                            <line x1="6" y1="6" x2="6.01" y2="6"/>
                            <line x1="6" y1="18" x2="6.01" y2="18"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Total Size</span>
                        <span className="stat-value">{stats?.total_size_human || '0 B'}</span>
                    </div>
                </div>
            </div>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'backups' ? 'active' : ''}`}
                    onClick={() => setActiveTab('backups')}
                >
                    Backups
                </button>
                <button
                    className={`tab ${activeTab === 'schedules' ? 'active' : ''}`}
                    onClick={() => setActiveTab('schedules')}
                >
                    Schedules
                </button>
                <button
                    className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            {activeTab === 'backups' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Backup List</h3>
                        <div className="card-actions">
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="filter-select"
                            >
                                <option value="all">All Types</option>
                                <option value="application">Applications</option>
                                <option value="database">Databases</option>
                            </select>
                            <button className="btn btn-secondary btn-sm" onClick={loadData}>
                                Refresh
                            </button>
                        </div>
                    </div>
                    <div className="card-body">
                        {filteredBackups.length === 0 ? (
                            <div className="empty-state">
                                <svg viewBox="0 0 24 24" width="48" height="48">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                <h3>No Backups</h3>
                                <p>No backups found. Create your first backup to get started.</p>
                                <button className="btn btn-primary" onClick={() => setShowBackupModal(true)}>
                                    Create Backup
                                </button>
                            </div>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>Size</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredBackups.map((backup, index) => (
                                        <tr key={index}>
                                            <td>
                                                <div className="backup-name">
                                                    {backup.type === 'application' ? (
                                                        <svg viewBox="0 0 24 24" width="16" height="16" className="icon-app">
                                                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                                        </svg>
                                                    ) : (
                                                        <svg viewBox="0 0 24 24" width="16" height="16" className="icon-db">
                                                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                                        </svg>
                                                    )}
                                                    <span>{backup.name || backup.app_name}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`badge badge-${backup.type === 'application' ? 'primary' : 'info'}`}>
                                                    {backup.type}
                                                </span>
                                            </td>
                                            <td>{formatSize(backup.size)}</td>
                                            <td>{formatTimestamp(backup.timestamp)}</td>
                                            <td>
                                                <div className="action-buttons">
                                                    <button
                                                        className="btn btn-sm btn-secondary"
                                                        onClick={() => {
                                                            setSelectedBackup(backup);
                                                            setShowRestoreModal(true);
                                                        }}
                                                        title="Restore"
                                                    >
                                                        <svg viewBox="0 0 24 24" width="14" height="14">
                                                            <polyline points="1 4 1 10 7 10"/>
                                                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                                                        </svg>
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => handleDeleteBackup(backup.path)}
                                                        title="Delete"
                                                    >
                                                        <svg viewBox="0 0 24 24" width="14" height="14">
                                                            <polyline points="3 6 5 6 21 6"/>
                                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                        </svg>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'schedules' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Backup Schedules</h3>
                        <button className="btn btn-primary btn-sm" onClick={() => setShowScheduleModal(true)}>
                            Add Schedule
                        </button>
                    </div>
                    <div className="card-body">
                        {schedules.length === 0 ? (
                            <div className="empty-state">
                                <svg viewBox="0 0 24 24" width="48" height="48">
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </svg>
                                <h3>No Schedules</h3>
                                <p>No backup schedules configured. Add a schedule for automated backups.</p>
                                <button className="btn btn-primary" onClick={() => setShowScheduleModal(true)}>
                                    Add Schedule
                                </button>
                            </div>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>Target</th>
                                        <th>Time</th>
                                        <th>Days</th>
                                        <th>Status</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {schedules.map((schedule) => (
                                        <tr key={schedule.id}>
                                            <td>{schedule.name}</td>
                                            <td>
                                                <span className={`badge badge-${schedule.backup_type === 'application' ? 'primary' : 'info'}`}>
                                                    {schedule.backup_type}
                                                </span>
                                            </td>
                                            <td>{schedule.target}</td>
                                            <td>{schedule.schedule_time}</td>
                                            <td>{schedule.days?.join(', ') || 'daily'}</td>
                                            <td>
                                                <span className={`badge badge-${schedule.enabled ? 'success' : 'secondary'}`}>
                                                    {schedule.enabled ? 'Active' : 'Disabled'}
                                                </span>
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-sm btn-danger"
                                                    onClick={() => handleRemoveSchedule(schedule.id)}
                                                    title="Remove"
                                                >
                                                    <svg viewBox="0 0 24 24" width="14" height="14">
                                                        <polyline points="3 6 5 6 21 6"/>
                                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Backup Settings</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleSaveConfig}>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={configForm.enabled}
                                        onChange={(e) => setConfigForm({...configForm, enabled: e.target.checked})}
                                    />
                                    <span>Enable Scheduled Backups</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label>Retention Period (days)</label>
                                <input
                                    type="number"
                                    value={configForm.retention_days}
                                    onChange={(e) => setConfigForm({...configForm, retention_days: parseInt(e.target.value)})}
                                    min="1"
                                    max="365"
                                />
                                <span className="form-help">Backups older than this will be deleted during cleanup</span>
                            </div>

                            <div className="form-actions">
                                <button type="submit" className="btn btn-primary">Save Settings</button>
                                <button type="button" className="btn btn-secondary" onClick={handleCleanup}>
                                    Run Cleanup Now
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Backup Modal */}
            {showBackupModal && (
                <div className="modal-overlay" onClick={() => setShowBackupModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Backup</h2>
                            <button className="modal-close" onClick={() => setShowBackupModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateBackup}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Backup Type</label>
                                    <select
                                        value={backupForm.type}
                                        onChange={(e) => setBackupForm({...backupForm, type: e.target.value})}
                                    >
                                        <option value="application">Application</option>
                                        <option value="database">Database Only</option>
                                    </select>
                                </div>

                                {backupForm.type === 'application' && (
                                    <>
                                        <div className="form-group">
                                            <label>Application</label>
                                            <select
                                                value={backupForm.applicationId}
                                                onChange={(e) => setBackupForm({...backupForm, applicationId: e.target.value})}
                                                required
                                            >
                                                <option value="">Select Application</option>
                                                {apps.map(app => (
                                                    <option key={app.id} value={app.id}>{app.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={backupForm.includeDb}
                                                    onChange={(e) => setBackupForm({...backupForm, includeDb: e.target.checked})}
                                                />
                                                <span>Include Database</span>
                                            </label>
                                        </div>
                                    </>
                                )}

                                {(backupForm.type === 'database' || backupForm.includeDb) && (
                                    <>
                                        <div className="form-group">
                                            <label>Database Type</label>
                                            <select
                                                value={backupForm.dbType}
                                                onChange={(e) => setBackupForm({...backupForm, dbType: e.target.value})}
                                            >
                                                <option value="mysql">MySQL</option>
                                                <option value="postgresql">PostgreSQL</option>
                                            </select>
                                        </div>

                                        <div className="form-group">
                                            <label>Database Name</label>
                                            <input
                                                type="text"
                                                value={backupForm.dbName}
                                                onChange={(e) => setBackupForm({...backupForm, dbName: e.target.value})}
                                                required
                                            />
                                        </div>

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Username</label>
                                                <input
                                                    type="text"
                                                    value={backupForm.dbUser}
                                                    onChange={(e) => setBackupForm({...backupForm, dbUser: e.target.value})}
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label>Password</label>
                                                <input
                                                    type="password"
                                                    value={backupForm.dbPassword}
                                                    onChange={(e) => setBackupForm({...backupForm, dbPassword: e.target.value})}
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label>Host</label>
                                            <input
                                                type="text"
                                                value={backupForm.dbHost}
                                                onChange={(e) => setBackupForm({...backupForm, dbHost: e.target.value})}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowBackupModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">Create Backup</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Add Schedule Modal */}
            {showScheduleModal && (
                <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Backup Schedule</h2>
                            <button className="modal-close" onClick={() => setShowScheduleModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleAddSchedule}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Schedule Name</label>
                                    <input
                                        type="text"
                                        value={scheduleForm.name}
                                        onChange={(e) => setScheduleForm({...scheduleForm, name: e.target.value})}
                                        placeholder="Daily App Backup"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Backup Type</label>
                                    <select
                                        value={scheduleForm.backupType}
                                        onChange={(e) => setScheduleForm({...scheduleForm, backupType: e.target.value})}
                                    >
                                        <option value="application">Application</option>
                                        <option value="database">Database</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Target</label>
                                    <input
                                        type="text"
                                        value={scheduleForm.target}
                                        onChange={(e) => setScheduleForm({...scheduleForm, target: e.target.value})}
                                        placeholder="App name or database name"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Time</label>
                                    <input
                                        type="time"
                                        value={scheduleForm.scheduleTime}
                                        onChange={(e) => setScheduleForm({...scheduleForm, scheduleTime: e.target.value})}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">Add Schedule</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Restore Modal */}
            {showRestoreModal && selectedBackup && (
                <div className="modal-overlay" onClick={() => setShowRestoreModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Restore Backup</h2>
                            <button className="modal-close" onClick={() => setShowRestoreModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="restore-warning">
                                <svg viewBox="0 0 24 24" width="48" height="48">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <h3>Warning</h3>
                                <p>Restoring this backup will overwrite existing data. This action cannot be undone.</p>
                            </div>
                            <div className="restore-details">
                                <div className="detail-row">
                                    <span className="detail-label">Backup Name:</span>
                                    <span className="detail-value">{selectedBackup.name || selectedBackup.app_name}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Type:</span>
                                    <span className="detail-value">{selectedBackup.type}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Created:</span>
                                    <span className="detail-value">{formatTimestamp(selectedBackup.timestamp)}</span>
                                </div>
                                <div className="detail-row">
                                    <span className="detail-label">Size:</span>
                                    <span className="detail-value">{formatSize(selectedBackup.size)}</span>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRestoreModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={handleRestore}>
                                Restore Backup
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Backups;
