import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Servers = () => {
    const [servers, setServers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [serversData, groupsData] = await Promise.all([
                api.getServers(),
                api.getServerGroups()
            ]);
            setServers(serversData.servers || []);
            setGroups(groupsData.groups || []);
        } catch (err) {
            console.error('Failed to load servers:', err);
            toast.error('Failed to load servers');
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteServer(serverId) {
        if (!confirm('Are you sure you want to remove this server?')) return;

        try {
            await api.deleteServer(serverId);
            toast.success('Server removed successfully');
            loadData();
        } catch (err) {
            toast.error(err.message || 'Failed to remove server');
        }
    }

    async function handlePingServer(serverId) {
        try {
            const result = await api.pingServer(serverId);
            if (result.success) {
                toast.success(`Server responded in ${result.latency}ms`);
            } else {
                toast.error('Server did not respond');
            }
            loadData();
        } catch (err) {
            toast.error('Failed to ping server');
        }
    }

    const filteredServers = servers.filter(server => {
        const matchesGroup = selectedGroup === 'all' || server.group_id === selectedGroup;
        const matchesSearch = !searchTerm ||
            server.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            server.hostname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            server.ip_address?.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesGroup && matchesSearch;
    });

    const stats = {
        total: servers.length,
        online: servers.filter(s => s.status === 'online').length,
        offline: servers.filter(s => s.status === 'offline').length,
        connecting: servers.filter(s => s.status === 'connecting').length
    };

    if (loading) {
        return <div className="loading">Loading servers...</div>;
    }

    return (
        <div className="servers-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Servers</h1>
                    <p className="page-description">Manage your connected servers and agents</p>
                </div>
                <div className="page-header-actions">
                    <button className="btn btn-secondary" onClick={() => setShowGroupModal(true)}>
                        <FolderIcon />
                        Manage Groups
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        <PlusIcon />
                        Add Server
                    </button>
                </div>
            </div>

            <div className="servers-stats">
                <div className="stat-card">
                    <div className="stat-icon total">
                        <ServerIcon />
                    </div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.total}</div>
                        <div className="stat-label">Total Servers</div>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon online">
                        <CheckCircleIcon />
                    </div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.online}</div>
                        <div className="stat-label">Online</div>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon offline">
                        <XCircleIcon />
                    </div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.offline}</div>
                        <div className="stat-label">Offline</div>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon connecting">
                        <RefreshIcon />
                    </div>
                    <div className="stat-content">
                        <div className="stat-value">{stats.connecting}</div>
                        <div className="stat-label">Connecting</div>
                    </div>
                </div>
            </div>

            <div className="servers-toolbar">
                <div className="search-box">
                    <SearchIcon />
                    <input
                        type="text"
                        placeholder="Search servers..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="group-filter">
                    <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
                        <option value="all">All Groups</option>
                        {groups.map(group => (
                            <option key={group.id} value={group.id}>{group.name}</option>
                        ))}
                        <option value="ungrouped">Ungrouped</option>
                    </select>
                </div>
            </div>

            {filteredServers.length === 0 ? (
                <div className="empty-state">
                    <ServerIcon className="empty-icon" />
                    <h3>No servers found</h3>
                    <p>
                        {servers.length === 0
                            ? 'Add your first server to start managing remote infrastructure.'
                            : 'No servers match your current filters.'}
                    </p>
                    {servers.length === 0 && (
                        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                            <PlusIcon /> Add Server
                        </button>
                    )}
                </div>
            ) : (
                <div className="servers-grid">
                    {filteredServers.map(server => (
                        <ServerCard
                            key={server.id}
                            server={server}
                            onDelete={() => handleDeleteServer(server.id)}
                            onPing={() => handlePingServer(server.id)}
                        />
                    ))}
                </div>
            )}

            {showAddModal && (
                <AddServerModal
                    groups={groups}
                    onClose={() => setShowAddModal(false)}
                    onCreated={() => {
                        setShowAddModal(false);
                        loadData();
                    }}
                />
            )}

            {showGroupModal && (
                <ManageGroupsModal
                    groups={groups}
                    onClose={() => setShowGroupModal(false)}
                    onUpdated={loadData}
                />
            )}
        </div>
    );
};

const ServerCard = ({ server, onDelete, onPing }) => {
    const statusColors = {
        online: '#10B981',
        offline: '#EF4444',
        connecting: '#F59E0B',
        pending: '#6B7280'
    };

    const formatLastSeen = (timestamp) => {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = (now - date) / 1000;

        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className={`server-card ${server.status}`}>
            <div className="server-card-header">
                <div className="server-status-indicator" style={{ backgroundColor: statusColors[server.status] || '#6B7280' }} />
                <div className="server-info">
                    <h3 className="server-name">{server.name}</h3>
                    <span className="server-hostname">{server.hostname || server.ip_address}</span>
                </div>
                <div className="server-actions-dropdown">
                    <button className="btn-icon" title="Actions">
                        <MoreIcon />
                    </button>
                </div>
            </div>

            <div className="server-card-body">
                <div className="server-meta">
                    <div className="meta-item">
                        <span className="meta-label">OS</span>
                        <span className="meta-value">{server.os_type || 'Unknown'}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Agent</span>
                        <span className="meta-value">{server.agent_version || 'Not installed'}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Docker</span>
                        <span className="meta-value">{server.docker_version || 'N/A'}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">Last Seen</span>
                        <span className="meta-value">{formatLastSeen(server.last_seen)}</span>
                    </div>
                </div>

                {server.metrics && server.status === 'online' && (
                    <div className="server-metrics-mini">
                        <div className="metric-bar">
                            <span className="metric-label">CPU</span>
                            <div className="bar-track">
                                <div
                                    className="bar-fill cpu"
                                    style={{ width: `${server.metrics.cpu_percent || 0}%` }}
                                />
                            </div>
                            <span className="metric-value">{(server.metrics.cpu_percent || 0).toFixed(0)}%</span>
                        </div>
                        <div className="metric-bar">
                            <span className="metric-label">RAM</span>
                            <div className="bar-track">
                                <div
                                    className="bar-fill memory"
                                    style={{ width: `${server.metrics.memory_percent || 0}%` }}
                                />
                            </div>
                            <span className="metric-value">{(server.metrics.memory_percent || 0).toFixed(0)}%</span>
                        </div>
                        <div className="metric-bar">
                            <span className="metric-label">Disk</span>
                            <div className="bar-track">
                                <div
                                    className="bar-fill disk"
                                    style={{ width: `${server.metrics.disk_percent || 0}%` }}
                                />
                            </div>
                            <span className="metric-value">{(server.metrics.disk_percent || 0).toFixed(0)}%</span>
                        </div>
                    </div>
                )}

                {server.group_name && (
                    <div className="server-group-badge">
                        <FolderIcon size={12} />
                        {server.group_name}
                    </div>
                )}
            </div>

            <div className="server-card-footer">
                <Link to={`/servers/${server.id}`} className="btn btn-sm btn-secondary">
                    <EyeIcon /> Details
                </Link>
                <button className="btn btn-sm btn-secondary" onClick={onPing} title="Ping Server">
                    <RefreshIcon />
                </button>
                <Link to={`/servers/${server.id}/docker`} className="btn btn-sm btn-primary">
                    <DockerIcon /> Docker
                </Link>
            </div>
        </div>
    );
};

const AddServerModal = ({ groups, onClose, onCreated }) => {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        group_id: '',
        hostname: '',
        ip_address: '',
        permissions: ['docker:read', 'docker:write', 'system:read']
    });
    const [registrationData, setRegistrationData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const toast = useToast();

    async function handleCreateServer(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const result = await api.createServer(formData);
            setRegistrationData(result);
            setStep(2);
        } catch (err) {
            setError(err.message || 'Failed to create server');
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    }

    const linuxInstallScript = registrationData ? `curl -fsSL https://your-server/api/v1/servers/install.sh | sudo bash -s -- \\
  --server-url "${window.location.origin}" \\
  --token "${registrationData.registration_token}"` : '';

    const windowsInstallScript = registrationData ? `irm https://your-server/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -ServerUrl "${window.location.origin}" -Token "${registrationData.registration_token}"` : '';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{step === 1 ? 'Add Server' : 'Install Agent'}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {step === 1 ? (
                    <form onSubmit={handleCreateServer}>
                        {error && <div className="error-message">{error}</div>}

                        <div className="form-group">
                            <label>Server Name *</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="My Production Server"
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
                                rows={2}
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Hostname</label>
                                <input
                                    type="text"
                                    name="hostname"
                                    value={formData.hostname}
                                    onChange={handleChange}
                                    placeholder="server.example.com"
                                />
                            </div>
                            <div className="form-group">
                                <label>IP Address</label>
                                <input
                                    type="text"
                                    name="ip_address"
                                    value={formData.ip_address}
                                    onChange={handleChange}
                                    placeholder="192.168.1.100"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>Group</label>
                            <select name="group_id" value={formData.group_id} onChange={handleChange}>
                                <option value="">No Group</option>
                                {groups.map(group => (
                                    <option key={group.id} value={group.id}>{group.name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>Permissions</label>
                            <div className="permissions-grid">
                                {[
                                    { key: 'docker:read', label: 'Docker (Read)' },
                                    { key: 'docker:write', label: 'Docker (Write)' },
                                    { key: 'system:read', label: 'System Metrics' },
                                    { key: 'system:exec', label: 'Remote Execution' }
                                ].map(perm => (
                                    <label key={perm.key} className="permission-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={formData.permissions.includes(perm.key)}
                                            onChange={(e) => {
                                                const newPerms = e.target.checked
                                                    ? [...formData.permissions, perm.key]
                                                    : formData.permissions.filter(p => p !== perm.key);
                                                setFormData(prev => ({ ...prev, permissions: newPerms }));
                                            }}
                                        />
                                        {perm.label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating...' : 'Create & Get Install Script'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="install-instructions">
                        <div className="success-banner">
                            <CheckCircleIcon />
                            <span>Server created! Install the agent to connect.</span>
                        </div>

                        <div className="install-tabs">
                            <InstallTab
                                title="Linux / macOS"
                                icon={<TerminalIcon />}
                                script={linuxInstallScript}
                                onCopy={() => copyToClipboard(linuxInstallScript)}
                            />
                            <InstallTab
                                title="Windows (PowerShell)"
                                icon={<WindowsIcon />}
                                script={windowsInstallScript}
                                onCopy={() => copyToClipboard(windowsInstallScript)}
                            />
                        </div>

                        <div className="install-info">
                            <h4>What happens next?</h4>
                            <ol>
                                <li>Run the install script on your server</li>
                                <li>The agent will download and configure automatically</li>
                                <li>Once connected, the server will appear as "Online"</li>
                            </ol>
                            <p className="text-muted">
                                The registration token expires in 1 hour. After that, you'll need to generate a new one.
                            </p>
                        </div>

                        <div className="modal-actions">
                            <button className="btn btn-primary" onClick={onCreated}>
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const InstallTab = ({ title, icon, script, onCopy }) => {
    return (
        <div className="install-tab">
            <div className="install-tab-header">
                {icon}
                <span>{title}</span>
                <button className="btn btn-sm btn-secondary" onClick={onCopy}>
                    <CopyIcon /> Copy
                </button>
            </div>
            <pre className="install-script">{script}</pre>
        </div>
    );
};

const ManageGroupsModal = ({ groups, onClose, onUpdated }) => {
    const [groupList, setGroupList] = useState(groups);
    const [newGroupName, setNewGroupName] = useState('');
    const [editingGroup, setEditingGroup] = useState(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    async function handleCreateGroup(e) {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        setLoading(true);
        try {
            await api.createServerGroup({ name: newGroupName.trim() });
            setNewGroupName('');
            toast.success('Group created');
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(data.groups || []);
        } catch (err) {
            toast.error(err.message || 'Failed to create group');
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateGroup(groupId, newName) {
        try {
            await api.updateServerGroup(groupId, { name: newName });
            toast.success('Group updated');
            setEditingGroup(null);
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(data.groups || []);
        } catch (err) {
            toast.error(err.message || 'Failed to update group');
        }
    }

    async function handleDeleteGroup(groupId) {
        if (!confirm('Delete this group? Servers in this group will become ungrouped.')) return;

        try {
            await api.deleteServerGroup(groupId);
            toast.success('Group deleted');
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(data.groups || []);
        } catch (err) {
            toast.error(err.message || 'Failed to delete group');
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Manage Server Groups</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleCreateGroup} className="group-form">
                    <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="New group name..."
                        disabled={loading}
                    />
                    <button type="submit" className="btn btn-primary" disabled={loading || !newGroupName.trim()}>
                        <PlusIcon /> Add
                    </button>
                </form>

                <div className="groups-list">
                    {groupList.length === 0 ? (
                        <div className="empty-groups">No groups created yet</div>
                    ) : (
                        groupList.map(group => (
                            <div key={group.id} className="group-item">
                                {editingGroup === group.id ? (
                                    <input
                                        type="text"
                                        defaultValue={group.name}
                                        onBlur={(e) => handleUpdateGroup(group.id, e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdateGroup(group.id, e.target.value);
                                            if (e.key === 'Escape') setEditingGroup(null);
                                        }}
                                        autoFocus
                                    />
                                ) : (
                                    <>
                                        <span className="group-name">
                                            <FolderIcon size={14} />
                                            {group.name}
                                        </span>
                                        <span className="group-count">{group.server_count || 0} servers</span>
                                        <div className="group-actions">
                                            <button
                                                className="btn-icon"
                                                onClick={() => setEditingGroup(group.id)}
                                                title="Edit"
                                            >
                                                <EditIcon />
                                            </button>
                                            <button
                                                className="btn-icon danger"
                                                onClick={() => handleDeleteGroup(group.id)}
                                                title="Delete"
                                            >
                                                <TrashIcon />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
};

// Icons
const ServerIcon = ({ size = 24, className = '' }) => (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/>
        <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
);

const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
);

const FolderIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
);

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
);

const CheckCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
);

const XCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
);

const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
);

const MoreIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="1"/>
        <circle cx="19" cy="12" r="1"/>
        <circle cx="5" cy="12" r="1"/>
    </svg>
);

const EyeIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
    </svg>
);

const DockerIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="5" height="5" rx="1"/>
        <rect x="9" y="7" width="5" height="5" rx="1"/>
        <rect x="16" y="7" width="5" height="5" rx="1"/>
        <rect x="2" y="14" width="5" height="5" rx="1"/>
        <rect x="9" y="14" width="5" height="5" rx="1"/>
    </svg>
);

const TerminalIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
);

const WindowsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
);

const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

const EditIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

export default Servers;
