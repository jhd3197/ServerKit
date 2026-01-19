import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import QueryRunner from '../components/QueryRunner';

const Databases = () => {
    const [activeTab, setActiveTab] = useState('mysql');
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkStatus();
    }, []);

    async function checkStatus() {
        try {
            const data = await api.getDatabaseStatus();
            setStatus(data);

            // Default to available server
            if (!data.mysql.running && data.postgresql.running) {
                setActiveTab('postgresql');
            }
        } catch (err) {
            console.error('Failed to get database status:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="loading">Checking database servers...</div>;
    }

    return (
        <div>
            <header className="top-bar">
                <div>
                    <h1>Databases</h1>
                    <div className="subtitle">Manage MySQL and PostgreSQL databases</div>
                </div>
                <div className="top-bar-actions">
                    <div className="db-status-indicators">
                        <span className={`db-status-indicator ${status?.mysql?.running ? 'active' : 'inactive'}`}>
                            <span className="status-dot" />
                            MySQL
                        </span>
                        <span className={`db-status-indicator ${status?.postgresql?.running ? 'active' : 'inactive'}`}>
                            <span className="status-dot" />
                            PostgreSQL
                        </span>
                    </div>
                </div>
            </header>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'mysql' ? 'active' : ''}`}
                    onClick={() => setActiveTab('mysql')}
                >
                    MySQL / MariaDB
                </button>
                <button
                    className={`tab ${activeTab === 'postgresql' ? 'active' : ''}`}
                    onClick={() => setActiveTab('postgresql')}
                >
                    PostgreSQL
                </button>
                <button
                    className={`tab ${activeTab === 'docker' ? 'active' : ''}`}
                    onClick={() => setActiveTab('docker')}
                >
                    Docker Apps
                </button>
                <button
                    className={`tab ${activeTab === 'backups' ? 'active' : ''}`}
                    onClick={() => setActiveTab('backups')}
                >
                    Backups
                </button>
                <button
                    className={`tab ${activeTab === 'sqlite' ? 'active' : ''}`}
                    onClick={() => setActiveTab('sqlite')}
                >
                    SQLite
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'mysql' && <MySQLTab status={status?.mysql} />}
                {activeTab === 'postgresql' && <PostgreSQLTab status={status?.postgresql} />}
                {activeTab === 'docker' && <DockerDatabasesTab />}
                {activeTab === 'backups' && <BackupsTab />}
                {activeTab === 'sqlite' && <SQLiteTab />}
            </div>
        </div>
    );
};

const MySQLTab = ({ status }) => {
    const toast = useToast();
    const [databases, setDatabases] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('databases');
    const [showCreateDbModal, setShowCreateDbModal] = useState(false);
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [selectedDb, setSelectedDb] = useState(null);
    const [queryDb, setQueryDb] = useState(null);

    useEffect(() => {
        if (status?.running) {
            loadData();
        } else {
            setLoading(false);
        }
    }, [status]);

    async function loadData() {
        setLoading(true);
        try {
            const [dbData, userData] = await Promise.all([
                api.getMySQLDatabases(),
                api.getMySQLUsers()
            ]);
            setDatabases(dbData.databases || []);
            setUsers(userData.users || []);
        } catch (err) {
            console.error('Failed to load MySQL data:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleDropDatabase(name) {
        if (!confirm(`Drop database "${name}"? This cannot be undone!`)) return;

        try {
            await api.dropMySQLDatabase(name);
            toast.success(`Database "${name}" dropped successfully`);
            loadData();
        } catch (err) {
            console.error('Failed to drop database:', err);
            toast.error('Failed to drop database');
        }
    }

    async function handleBackupDatabase(name) {
        try {
            const result = await api.backupMySQLDatabase(name);
            if (result.success) {
                toast.success(`Backup created: ${result.backup_path}`);
            }
        } catch (err) {
            console.error('Failed to backup database:', err);
            toast.error('Failed to create backup');
        }
    }

    async function handleDropUser(username, host) {
        if (!confirm(`Drop user "${username}"@"${host}"?`)) return;

        try {
            await api.dropMySQLUser(username, host);
            toast.success(`User "${username}" dropped successfully`);
            loadData();
        } catch (err) {
            console.error('Failed to drop user:', err);
            toast.error('Failed to drop user');
        }
    }

    if (!status?.installed) {
        return (
            <div className="empty-state">
                <h3>MySQL is not installed</h3>
                <p>Install MySQL or MariaDB on your server to manage databases.</p>
            </div>
        );
    }

    if (!status?.running) {
        return (
            <div className="empty-state">
                <h3>MySQL is not running</h3>
                <p>Start the MySQL server to manage databases.</p>
            </div>
        );
    }

    if (loading) {
        return <div className="loading">Loading MySQL data...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="view-toggle">
                    <button
                        className={`btn btn-sm ${view === 'databases' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setView('databases')}
                    >
                        Databases ({databases.length})
                    </button>
                    <button
                        className={`btn btn-sm ${view === 'users' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setView('users')}
                    >
                        Users ({users.length})
                    </button>
                </div>
                {view === 'databases' ? (
                    <button className="btn btn-primary" onClick={() => setShowCreateDbModal(true)}>
                        Create Database
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={() => setShowCreateUserModal(true)}>
                        Create User
                    </button>
                )}
            </div>

            {view === 'databases' ? (
                databases.length === 0 ? (
                    <div className="empty-state">
                        <h3>No databases</h3>
                        <p>Create your first MySQL database.</p>
                    </div>
                ) : (
                    <div className="db-list">
                        {databases.map(db => (
                            <div key={db.name} className="db-item">
                                <div className="db-item-info">
                                    <div className="db-item-icon mysql">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                        </svg>
                                    </div>
                                    <div className="db-item-details">
                                        <h3>{db.name}</h3>
                                        <div className="db-item-meta">
                                            <span>{formatBytes(db.size)}</span>
                                            <span>MySQL</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="db-item-actions">
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => setQueryDb(db)}
                                    >
                                        Query
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setSelectedDb(db)}
                                    >
                                        Tables
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleBackupDatabase(db.name)}
                                    >
                                        Backup
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleDropDatabase(db.name)}
                                    >
                                        Drop
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            ) : (
                users.length === 0 ? (
                    <div className="empty-state">
                        <h3>No users</h3>
                        <p>Create your first MySQL user.</p>
                    </div>
                ) : (
                    <div className="db-list">
                        {users.map(user => (
                            <div key={`${user.user}@${user.host}`} className="db-item">
                                <div className="db-item-info">
                                    <div className="db-item-icon user">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                    </div>
                                    <div className="db-item-details">
                                        <h3>{user.user}</h3>
                                        <div className="db-item-meta">
                                            <span>Host: {user.host}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="db-item-actions">
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleDropUser(user.user, user.host)}
                                    >
                                        Drop
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {showCreateDbModal && (
                <CreateMySQLDatabaseModal
                    onClose={() => setShowCreateDbModal(false)}
                    onCreated={loadData}
                />
            )}

            {showCreateUserModal && (
                <CreateMySQLUserModal
                    databases={databases}
                    onClose={() => setShowCreateUserModal(false)}
                    onCreated={loadData}
                />
            )}

            {selectedDb && (
                <TablesModal
                    database={selectedDb}
                    dbType="mysql"
                    onClose={() => setSelectedDb(null)}
                />
            )}

            {queryDb && (
                <QueryRunner
                    database={queryDb}
                    dbType="mysql"
                    onClose={() => setQueryDb(null)}
                />
            )}
        </div>
    );
};

const PostgreSQLTab = ({ status }) => {
    const toast = useToast();
    const [databases, setDatabases] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState('databases');
    const [showCreateDbModal, setShowCreateDbModal] = useState(false);
    const [showCreateUserModal, setShowCreateUserModal] = useState(false);
    const [selectedDb, setSelectedDb] = useState(null);
    const [queryDb, setQueryDb] = useState(null);

    useEffect(() => {
        if (status?.running) {
            loadData();
        } else {
            setLoading(false);
        }
    }, [status]);

    async function loadData() {
        setLoading(true);
        try {
            const [dbData, userData] = await Promise.all([
                api.getPostgreSQLDatabases(),
                api.getPostgreSQLUsers()
            ]);
            setDatabases(dbData.databases || []);
            setUsers(userData.users || []);
        } catch (err) {
            console.error('Failed to load PostgreSQL data:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleDropDatabase(name) {
        if (!confirm(`Drop database "${name}"? This cannot be undone!`)) return;

        try {
            await api.dropPostgreSQLDatabase(name);
            toast.success(`Database "${name}" dropped successfully`);
            loadData();
        } catch (err) {
            console.error('Failed to drop database:', err);
            toast.error('Failed to drop database');
        }
    }

    async function handleBackupDatabase(name) {
        try {
            const result = await api.backupPostgreSQLDatabase(name);
            if (result.success) {
                toast.success(`Backup created: ${result.backup_path}`);
            }
        } catch (err) {
            console.error('Failed to backup database:', err);
            toast.error('Failed to create backup');
        }
    }

    async function handleDropUser(username) {
        if (!confirm(`Drop user "${username}"?`)) return;

        try {
            await api.dropPostgreSQLUser(username);
            toast.success(`User "${username}" dropped successfully`);
            loadData();
        } catch (err) {
            console.error('Failed to drop user:', err);
            toast.error('Failed to drop user');
        }
    }

    if (!status?.installed) {
        return (
            <div className="empty-state">
                <h3>PostgreSQL is not installed</h3>
                <p>Install PostgreSQL on your server to manage databases.</p>
            </div>
        );
    }

    if (!status?.running) {
        return (
            <div className="empty-state">
                <h3>PostgreSQL is not running</h3>
                <p>Start the PostgreSQL server to manage databases.</p>
            </div>
        );
    }

    if (loading) {
        return <div className="loading">Loading PostgreSQL data...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="view-toggle">
                    <button
                        className={`btn btn-sm ${view === 'databases' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setView('databases')}
                    >
                        Databases ({databases.length})
                    </button>
                    <button
                        className={`btn btn-sm ${view === 'users' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setView('users')}
                    >
                        Users ({users.length})
                    </button>
                </div>
                {view === 'databases' ? (
                    <button className="btn btn-primary" onClick={() => setShowCreateDbModal(true)}>
                        Create Database
                    </button>
                ) : (
                    <button className="btn btn-primary" onClick={() => setShowCreateUserModal(true)}>
                        Create User
                    </button>
                )}
            </div>

            {view === 'databases' ? (
                databases.length === 0 ? (
                    <div className="empty-state">
                        <h3>No databases</h3>
                        <p>Create your first PostgreSQL database.</p>
                    </div>
                ) : (
                    <div className="db-list">
                        {databases.map(db => (
                            <div key={db.name} className="db-item">
                                <div className="db-item-info">
                                    <div className="db-item-icon postgresql">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                        </svg>
                                    </div>
                                    <div className="db-item-details">
                                        <h3>{db.name}</h3>
                                        <div className="db-item-meta">
                                            <span>{formatBytes(db.size)}</span>
                                            <span>PostgreSQL</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="db-item-actions">
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => setQueryDb(db)}
                                    >
                                        Query
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setSelectedDb(db)}
                                    >
                                        Tables
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleBackupDatabase(db.name)}
                                    >
                                        Backup
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleDropDatabase(db.name)}
                                    >
                                        Drop
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            ) : (
                users.length === 0 ? (
                    <div className="empty-state">
                        <h3>No users</h3>
                        <p>Create your first PostgreSQL user.</p>
                    </div>
                ) : (
                    <div className="db-list">
                        {users.map(user => (
                            <div key={user.user} className="db-item">
                                <div className="db-item-info">
                                    <div className="db-item-icon user">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                            <circle cx="12" cy="7" r="4"/>
                                        </svg>
                                    </div>
                                    <div className="db-item-details">
                                        <h3>{user.user}</h3>
                                        <div className="db-item-meta">
                                            <span>PostgreSQL User</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="db-item-actions">
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleDropUser(user.user)}
                                    >
                                        Drop
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}

            {showCreateDbModal && (
                <CreatePostgreSQLDatabaseModal
                    onClose={() => setShowCreateDbModal(false)}
                    onCreated={loadData}
                />
            )}

            {showCreateUserModal && (
                <CreatePostgreSQLUserModal
                    databases={databases}
                    onClose={() => setShowCreateUserModal(false)}
                    onCreated={loadData}
                />
            )}

            {selectedDb && (
                <TablesModal
                    database={selectedDb}
                    dbType="postgresql"
                    onClose={() => setSelectedDb(null)}
                />
            )}

            {queryDb && (
                <QueryRunner
                    database={queryDb}
                    dbType="postgresql"
                    onClose={() => setQueryDb(null)}
                />
            )}
        </div>
    );
};

const BackupsTab = () => {
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        loadBackups();
    }, [filter]);

    async function loadBackups() {
        setLoading(true);
        try {
            const type = filter === 'all' ? null : filter;
            const data = await api.getDatabaseBackups(type);
            setBackups(data.backups || []);
        } catch (err) {
            console.error('Failed to load backups:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(filename) {
        if (!confirm('Delete this backup?')) return;

        try {
            await api.deleteDatabaseBackup(filename);
            loadBackups();
        } catch (err) {
            console.error('Failed to delete backup:', err);
        }
    }

    if (loading) {
        return <div className="loading">Loading backups...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="view-toggle">
                    <button
                        className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter('all')}
                    >
                        All
                    </button>
                    <button
                        className={`btn btn-sm ${filter === 'mysql' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter('mysql')}
                    >
                        MySQL
                    </button>
                    <button
                        className={`btn btn-sm ${filter === 'postgresql' ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setFilter('postgresql')}
                    >
                        PostgreSQL
                    </button>
                </div>
            </div>

            {backups.length === 0 ? (
                <div className="empty-state">
                    <h3>No backups</h3>
                    <p>Database backups will appear here.</p>
                </div>
            ) : (
                <div className="db-list">
                    {backups.map(backup => (
                        <div key={backup.filename} className="db-item">
                            <div className="db-item-info">
                                <div className={`db-item-icon ${backup.type}`}>
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </div>
                                <div className="db-item-details">
                                    <h3>{backup.database}</h3>
                                    <div className="db-item-meta">
                                        <span className="mono">{backup.filename}</span>
                                        <span>{formatBytes(backup.size)}</span>
                                        <span>{new Date(backup.created_at).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-item-actions">
                                <span className={`db-type-badge ${backup.type}`}>
                                    {backup.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}
                                </span>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleDelete(backup.filename)}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const CreateMySQLDatabaseModal = ({ onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        name: '',
        charset: 'utf8mb4',
        collation: 'utf8mb4_unicode_ci',
        create_user: true,
        user_password: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdInfo, setCreatedInfo] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createMySQLDatabase(formData);
            if (result.success) {
                if (result.password) {
                    setCreatedInfo({
                        database: formData.name,
                        user: result.user,
                        password: result.password
                    });
                } else {
                    onCreated();
                    onClose();
                }
            }
        } catch (err) {
            setError(err.message || 'Failed to create database');
        } finally {
            setLoading(false);
        }
    }

    if (createdInfo) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Database Created</h2>
                        <button className="modal-close" onClick={() => { onCreated(); onClose(); }}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <div className="credentials-box">
                            <p>Save these credentials - the password won't be shown again!</p>
                            <div className="credential-item">
                                <label>Database:</label>
                                <code>{createdInfo.database}</code>
                            </div>
                            <div className="credential-item">
                                <label>Username:</label>
                                <code>{createdInfo.user}</code>
                            </div>
                            <div className="credential-item">
                                <label>Password:</label>
                                <code>{createdInfo.password}</code>
                            </div>
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button className="btn btn-primary" onClick={() => { onCreated(); onClose(); }}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create MySQL Database</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Database Name *</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="my_database"
                            required
                            pattern="[a-zA-Z0-9_]+"
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Character Set</label>
                            <select
                                value={formData.charset}
                                onChange={(e) => setFormData({ ...formData, charset: e.target.value })}
                            >
                                <option value="utf8mb4">utf8mb4</option>
                                <option value="utf8">utf8</option>
                                <option value="latin1">latin1</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Collation</label>
                            <select
                                value={formData.collation}
                                onChange={(e) => setFormData({ ...formData, collation: e.target.value })}
                            >
                                <option value="utf8mb4_unicode_ci">utf8mb4_unicode_ci</option>
                                <option value="utf8mb4_general_ci">utf8mb4_general_ci</option>
                                <option value="utf8_general_ci">utf8_general_ci</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={formData.create_user}
                                onChange={(e) => setFormData({ ...formData, create_user: e.target.checked })}
                            />
                            Create user with same name and full privileges
                        </label>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Database'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateMySQLUserModal = ({ databases, onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        host: 'localhost',
        database: '',
        privileges: 'ALL',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdInfo, setCreatedInfo] = useState(null);

    async function generatePassword() {
        try {
            const result = await api.generateDatabasePassword();
            setFormData({ ...formData, password: result.password });
        } catch (err) {
            console.error('Failed to generate password:', err);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createMySQLUser(formData);
            if (result.success) {
                setCreatedInfo({
                    username: formData.username,
                    password: result.password,
                    host: formData.host
                });
            }
        } catch (err) {
            setError(err.message || 'Failed to create user');
        } finally {
            setLoading(false);
        }
    }

    if (createdInfo) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>User Created</h2>
                        <button className="modal-close" onClick={() => { onCreated(); onClose(); }}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <div className="credentials-box">
                            <p>Save these credentials!</p>
                            <div className="credential-item">
                                <label>Username:</label>
                                <code>{createdInfo.username}</code>
                            </div>
                            <div className="credential-item">
                                <label>Password:</label>
                                <code>{createdInfo.password}</code>
                            </div>
                            <div className="credential-item">
                                <label>Host:</label>
                                <code>{createdInfo.host}</code>
                            </div>
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button className="btn btn-primary" onClick={() => { onCreated(); onClose(); }}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create MySQL User</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            placeholder="db_user"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <div className="input-with-button">
                            <input
                                type="text"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="Leave empty to auto-generate"
                            />
                            <button type="button" className="btn btn-secondary btn-sm" onClick={generatePassword}>
                                Generate
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Host</label>
                        <select
                            value={formData.host}
                            onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                        >
                            <option value="localhost">localhost</option>
                            <option value="%">% (any host)</option>
                            <option value="127.0.0.1">127.0.0.1</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Grant privileges on database</label>
                        <select
                            value={formData.database}
                            onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                        >
                            <option value="">-- None --</option>
                            {databases.map(db => (
                                <option key={db.name} value={db.name}>{db.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create User'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreatePostgreSQLDatabaseModal = ({ onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        name: '',
        encoding: 'UTF8',
        create_user: true,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdInfo, setCreatedInfo] = useState(null);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createPostgreSQLDatabase(formData);
            if (result.success) {
                if (result.password) {
                    setCreatedInfo({
                        database: formData.name,
                        user: result.user,
                        password: result.password
                    });
                } else {
                    onCreated();
                    onClose();
                }
            }
        } catch (err) {
            setError(err.message || 'Failed to create database');
        } finally {
            setLoading(false);
        }
    }

    if (createdInfo) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Database Created</h2>
                        <button className="modal-close" onClick={() => { onCreated(); onClose(); }}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <div className="credentials-box">
                            <p>Save these credentials!</p>
                            <div className="credential-item">
                                <label>Database:</label>
                                <code>{createdInfo.database}</code>
                            </div>
                            <div className="credential-item">
                                <label>Username:</label>
                                <code>{createdInfo.user}</code>
                            </div>
                            <div className="credential-item">
                                <label>Password:</label>
                                <code>{createdInfo.password}</code>
                            </div>
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button className="btn btn-primary" onClick={() => { onCreated(); onClose(); }}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create PostgreSQL Database</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Database Name *</label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="my_database"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Encoding</label>
                        <select
                            value={formData.encoding}
                            onChange={(e) => setFormData({ ...formData, encoding: e.target.value })}
                        >
                            <option value="UTF8">UTF8</option>
                            <option value="LATIN1">LATIN1</option>
                            <option value="SQL_ASCII">SQL_ASCII</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                checked={formData.create_user}
                                onChange={(e) => setFormData({ ...formData, create_user: e.target.checked })}
                            />
                            Create user with same name and full privileges
                        </label>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Database'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreatePostgreSQLUserModal = ({ databases, onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        database: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [createdInfo, setCreatedInfo] = useState(null);

    async function generatePassword() {
        try {
            const result = await api.generateDatabasePassword();
            setFormData({ ...formData, password: result.password });
        } catch (err) {
            console.error('Failed to generate password:', err);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createPostgreSQLUser(formData);
            if (result.success) {
                setCreatedInfo({
                    username: formData.username,
                    password: result.password
                });
            }
        } catch (err) {
            setError(err.message || 'Failed to create user');
        } finally {
            setLoading(false);
        }
    }

    if (createdInfo) {
        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>User Created</h2>
                        <button className="modal-close" onClick={() => { onCreated(); onClose(); }}>&times;</button>
                    </div>
                    <div className="modal-body">
                        <div className="credentials-box">
                            <p>Save these credentials!</p>
                            <div className="credential-item">
                                <label>Username:</label>
                                <code>{createdInfo.username}</code>
                            </div>
                            <div className="credential-item">
                                <label>Password:</label>
                                <code>{createdInfo.password}</code>
                            </div>
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button className="btn btn-primary" onClick={() => { onCreated(); onClose(); }}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create PostgreSQL User</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Username *</label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            placeholder="db_user"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <div className="input-with-button">
                            <input
                                type="text"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="Leave empty to auto-generate"
                            />
                            <button type="button" className="btn btn-secondary btn-sm" onClick={generatePassword}>
                                Generate
                            </button>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Grant privileges on database</label>
                        <select
                            value={formData.database}
                            onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                        >
                            <option value="">-- None --</option>
                            {databases.map(db => (
                                <option key={db.name} value={db.name}>{db.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create User'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const TablesModal = ({ database, dbType, onClose }) => {
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadTables();
    }, [database, dbType]);

    async function loadTables() {
        try {
            let data;
            if (dbType === 'mysql') {
                data = await api.getMySQLTables(database.name);
            } else {
                data = await api.getPostgreSQLTables(database.name);
            }
            setTables(data.tables || []);
        } catch (err) {
            console.error('Failed to load tables:', err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Tables in {database.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {loading ? (
                        <div className="loading">Loading tables...</div>
                    ) : tables.length === 0 ? (
                        <p className="hint">No tables in this database.</p>
                    ) : (
                        <div className="tables-list">
                            {tables.map(table => (
                                <div key={table.name} className="table-item">
                                    <span className="table-name">{table.name}</span>
                                    <span className="table-rows">{table.rows.toLocaleString()} rows</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const SQLiteTab = () => {
    const [databases, setDatabases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [queryDb, setQueryDb] = useState(null);
    const [selectedDb, setSelectedDb] = useState(null);

    useEffect(() => {
        loadDatabases();
    }, []);

    async function loadDatabases() {
        setLoading(true);
        try {
            const data = await api.getSQLiteDatabases();
            setDatabases(data.databases || []);
        } catch (err) {
            console.error('Failed to load SQLite databases:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="loading">Scanning for SQLite databases...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="hint">
                    Showing .db, .sqlite, and .sqlite3 files found in /var/www, /home, and /opt
                </div>
                <button className="btn btn-secondary" onClick={loadDatabases}>
                    Refresh
                </button>
            </div>

            {databases.length === 0 ? (
                <div className="empty-state">
                    <h3>No SQLite databases found</h3>
                    <p>No .db, .sqlite, or .sqlite3 files were found in the scanned directories.</p>
                </div>
            ) : (
                <div className="db-list">
                    {databases.map(db => (
                        <div key={db.path} className="db-item">
                            <div className="db-item-info">
                                <div className="db-item-icon sqlite">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                    </svg>
                                </div>
                                <div className="db-item-details">
                                    <h3>{db.name}</h3>
                                    <div className="db-item-meta">
                                        <span className="mono">{db.path}</span>
                                        <span>{formatBytes(db.size)}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-item-actions">
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setQueryDb(db)}
                                >
                                    Query
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setSelectedDb(db)}
                                >
                                    Tables
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedDb && (
                <SQLiteTablesModal
                    database={selectedDb}
                    onClose={() => setSelectedDb(null)}
                />
            )}

            {queryDb && (
                <QueryRunner
                    database={queryDb}
                    dbType="sqlite"
                    onClose={() => setQueryDb(null)}
                />
            )}
        </div>
    );
};

const SQLiteTablesModal = ({ database, onClose }) => {
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadTables();
    }, [database]);

    async function loadTables() {
        try {
            const data = await api.getSQLiteTables(database.path);
            setTables(data.tables || []);
        } catch (err) {
            console.error('Failed to load tables:', err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Tables in {database.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {loading ? (
                        <div className="loading">Loading tables...</div>
                    ) : tables.length === 0 ? (
                        <p className="hint">No tables in this database.</p>
                    ) : (
                        <div className="tables-list">
                            {tables.map(table => (
                                <div key={table.name} className="table-item">
                                    <span className="table-name">{table.name}</span>
                                    <span className="table-rows">{table.rows.toLocaleString()} rows</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const DockerDatabasesTab = () => {
    const toast = useToast();
    const [containers, setContainers] = useState([]);
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedApp, setSelectedApp] = useState(null);
    const [appDbInfo, setAppDbInfo] = useState(null);
    const [queryDb, setQueryDb] = useState(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [containerData, appsData] = await Promise.all([
                api.getDockerDatabases(),
                api.get('/apps')
            ]);
            setContainers(containerData.containers || []);
            // Filter to only Docker apps
            const dockerApps = (appsData.data?.apps || []).filter(app => app.app_type === 'docker');
            setApps(dockerApps);
        } catch (err) {
            console.error('Failed to load Docker databases:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadAppDbInfo(app) {
        try {
            const data = await api.getAppDatabases(app.id);
            setAppDbInfo(data.databases || []);
            setSelectedApp(app);
        } catch (err) {
            console.error('Failed to load app database info:', err);
            toast.error('Failed to load database info');
        }
    }

    if (loading) {
        return <div className="loading">Loading Docker databases...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="hint">
                    Databases running inside Docker containers from your deployed apps
                </div>
                <button className="btn btn-secondary" onClick={loadData}>
                    Refresh
                </button>
            </div>

            {apps.length === 0 ? (
                <div className="empty-state">
                    <h3>No Docker apps</h3>
                    <p>Deploy an app from a template to see its databases here.</p>
                </div>
            ) : (
                <div className="db-list">
                    {apps.map(app => (
                        <div key={app.id} className="db-item">
                            <div className="db-item-info">
                                <div className="db-item-icon docker">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <path d="M21 10c0-3-2-6-7-6s-7 3-7 6"/>
                                        <rect x="3" y="10" width="18" height="10" rx="2"/>
                                        <circle cx="8" cy="15" r="1"/>
                                        <circle cx="12" cy="15" r="1"/>
                                        <circle cx="16" cy="15" r="1"/>
                                    </svg>
                                </div>
                                <div className="db-item-details">
                                    <h3>{app.name}</h3>
                                    <div className="db-item-meta">
                                        <span className={`status-badge ${app.status}`}>{app.status}</span>
                                        <span>Port {app.port}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="db-item-actions">
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => loadAppDbInfo(app)}
                                >
                                    View Databases
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedApp && appDbInfo && (
                <DockerAppDbModal
                    app={selectedApp}
                    databases={appDbInfo}
                    onClose={() => { setSelectedApp(null); setAppDbInfo(null); }}
                    onQuery={(db) => setQueryDb(db)}
                />
            )}

            {queryDb && (
                <QueryRunner
                    database={queryDb}
                    dbType="docker"
                    onClose={() => setQueryDb(null)}
                />
            )}
        </div>
    );
};

const DockerAppDbModal = ({ app, databases, onClose, onQuery }) => {
    const [tables, setTables] = useState({});
    const [loadingTables, setLoadingTables] = useState({});

    async function loadTables(db) {
        if (tables[db.container + db.database]) return;

        setLoadingTables(prev => ({ ...prev, [db.container + db.database]: true }));
        try {
            const data = await api.getDockerDatabaseTables(db.container, db.database, db.password);
            setTables(prev => ({ ...prev, [db.container + db.database]: data.tables || [] }));
        } catch (err) {
            console.error('Failed to load tables:', err);
        } finally {
            setLoadingTables(prev => ({ ...prev, [db.container + db.database]: false }));
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Databases in {app.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {databases.length === 0 ? (
                        <p className="hint">No databases found in this app's containers.</p>
                    ) : (
                        <div className="db-list">
                            {databases.map((db, idx) => (
                                <div key={idx} className="db-item">
                                    <div className="db-item-info">
                                        <div className={`db-item-icon ${db.type}`}>
                                            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                            </svg>
                                        </div>
                                        <div className="db-item-details">
                                            <h3>{db.database || 'Default'}</h3>
                                            <div className="db-item-meta">
                                                <span>Container: {db.container}</span>
                                                <span>{db.type === 'mysql' ? 'MySQL' : 'PostgreSQL'}</span>
                                                {db.user && <span>User: {db.user}</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="db-item-actions">
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => onQuery({
                                                name: db.database,
                                                container: db.container,
                                                password: db.password || db.root_password,
                                                user: db.user
                                            })}
                                        >
                                            Query
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => loadTables(db)}
                                        >
                                            Tables
                                        </button>
                                    </div>
                                    {tables[db.container + db.database] && (
                                        <div className="tables-inline">
                                            {tables[db.container + db.database].length === 0 ? (
                                                <p className="hint">No tables</p>
                                            ) : (
                                                <div className="tables-list compact">
                                                    {tables[db.container + db.database].map(table => (
                                                        <div key={table.name} className="table-item">
                                                            <span className="table-name">{table.name}</span>
                                                            <span className="table-rows">{table.rows} rows</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="credentials-info">
                        <h4>Connection Info</h4>
                        <p className="hint">These databases run inside Docker containers. Use these credentials to connect:</p>
                        {databases.map((db, idx) => (
                            <div key={idx} className="credentials-box">
                                <div className="credential-item">
                                    <label>Container:</label>
                                    <code>{db.container}</code>
                                </div>
                                {db.database && (
                                    <div className="credential-item">
                                        <label>Database:</label>
                                        <code>{db.database}</code>
                                    </div>
                                )}
                                <div className="credential-item">
                                    <label>User:</label>
                                    <code>{db.user || 'root'}</code>
                                </div>
                                {db.password && (
                                    <div className="credential-item">
                                        <label>Password:</label>
                                        <code>{db.password}</code>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default Databases;
