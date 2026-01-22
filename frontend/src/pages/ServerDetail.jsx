import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const ServerDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [server, setServer] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [systemInfo, setSystemInfo] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const toast = useToast();

    const loadServer = useCallback(async () => {
        try {
            const data = await api.getServer(id);
            setServer(data.server);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const loadMetrics = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemMetrics(id);
            if (data.success) {
                setMetrics(data.data);
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        }
    }, [id, server]);

    const loadSystemInfo = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemInfo(id);
            if (data.success) {
                setSystemInfo(data.data);
            }
        } catch (err) {
            console.error('Failed to load system info:', err);
        }
    }, [id, server]);

    useEffect(() => {
        loadServer();
    }, [loadServer]);

    useEffect(() => {
        if (server?.status === 'online') {
            loadMetrics();
            loadSystemInfo();
            const interval = setInterval(loadMetrics, 10000);
            return () => clearInterval(interval);
        }
    }, [server, loadMetrics, loadSystemInfo]);

    async function handleDeleteServer() {
        if (!confirm('Are you sure you want to remove this server? This action cannot be undone.')) return;

        try {
            await api.deleteServer(id);
            toast.success('Server removed successfully');
            navigate('/servers');
        } catch (err) {
            toast.error(err.message || 'Failed to remove server');
        }
    }

    async function handlePingServer() {
        try {
            const result = await api.pingServer(id);
            if (result.success) {
                toast.success(`Server responded in ${result.latency}ms`);
                loadServer();
            } else {
                toast.error('Server did not respond');
            }
        } catch (err) {
            toast.error('Failed to ping server');
        }
    }

    async function handleRegenerateToken() {
        if (!confirm('Generate a new registration token? The old token will be invalidated.')) return;

        try {
            const result = await api.generateRegistrationToken(id);
            toast.success('New registration token generated');
            setServer(prev => ({ ...prev, registration_token: result.token }));
        } catch (err) {
            toast.error(err.message || 'Failed to generate token');
        }
    }

    if (loading) {
        return <div className="loading">Loading server details...</div>;
    }

    if (error) {
        return (
            <div className="error-page">
                <h2>Error Loading Server</h2>
                <p>{error}</p>
                <Link to="/servers" className="btn btn-primary">Back to Servers</Link>
            </div>
        );
    }

    if (!server) {
        return (
            <div className="error-page">
                <h2>Server Not Found</h2>
                <p>The requested server could not be found.</p>
                <Link to="/servers" className="btn btn-primary">Back to Servers</Link>
            </div>
        );
    }

    const statusColors = {
        online: '#10B981',
        offline: '#EF4444',
        connecting: '#F59E0B',
        pending: '#6B7280'
    };

    const tabs = [
        { id: 'overview', label: 'Overview' },
        { id: 'docker', label: 'Docker' },
        { id: 'metrics', label: 'Metrics' },
        { id: 'settings', label: 'Settings' }
    ];

    return (
        <div className="server-detail-page">
            <div className="page-header">
                <div className="page-breadcrumb">
                    <Link to="/servers">Servers</Link>
                    <span className="breadcrumb-separator">/</span>
                    <span>{server.name}</span>
                </div>
                <div className="page-header-content">
                    <div className="server-title">
                        <div
                            className="status-dot large"
                            style={{ backgroundColor: statusColors[server.status] }}
                            title={server.status}
                        />
                        <h1>{server.name}</h1>
                    </div>
                    <p className="page-description">
                        {server.hostname || server.ip_address}
                        {server.description && ` - ${server.description}`}
                    </p>
                </div>
                <div className="page-header-actions">
                    <button className="btn btn-secondary" onClick={handlePingServer}>
                        <RefreshIcon /> Ping
                    </button>
                    <button className="btn btn-danger" onClick={handleDeleteServer}>
                        <TrashIcon /> Remove
                    </button>
                </div>
            </div>

            <div className="server-detail-tabs">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="server-detail-content">
                {activeTab === 'overview' && (
                    <OverviewTab
                        server={server}
                        metrics={metrics}
                        systemInfo={systemInfo}
                    />
                )}
                {activeTab === 'docker' && (
                    <DockerTab serverId={id} serverStatus={server.status} />
                )}
                {activeTab === 'metrics' && (
                    <MetricsTab serverId={id} metrics={metrics} />
                )}
                {activeTab === 'settings' && (
                    <SettingsTab
                        server={server}
                        onUpdate={loadServer}
                        onRegenerateToken={handleRegenerateToken}
                    />
                )}
            </div>
        </div>
    );
};

const OverviewTab = ({ server, metrics, systemInfo }) => {
    const formatBytes = (bytes) => {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    };

    const formatUptime = (seconds) => {
        if (!seconds) return 'N/A';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        if (days > 0) return `${days}d ${hours}h`;
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    return (
        <div className="overview-tab">
            <div className="overview-grid">
                <div className="info-card">
                    <h3>Server Information</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Status</span>
                            <span className={`status-badge ${server.status}`}>{server.status}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Hostname</span>
                            <span className="info-value">{server.hostname || 'N/A'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">IP Address</span>
                            <span className="info-value">{server.ip_address || 'N/A'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Group</span>
                            <span className="info-value">{server.group_name || 'Ungrouped'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Last Seen</span>
                            <span className="info-value">
                                {server.last_seen ? new Date(server.last_seen).toLocaleString() : 'Never'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="info-card">
                    <h3>System Information</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Operating System</span>
                            <span className="info-value">
                                {systemInfo?.os || server.os_type || 'Unknown'}
                                {systemInfo?.os_version && ` ${systemInfo.os_version}`}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Architecture</span>
                            <span className="info-value">{systemInfo?.architecture || server.architecture || 'N/A'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">CPU</span>
                            <span className="info-value">
                                {systemInfo?.cpu_model || 'N/A'}
                                {systemInfo?.cpu_cores && ` (${systemInfo.cpu_cores} cores)`}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Total Memory</span>
                            <span className="info-value">{formatBytes(systemInfo?.total_memory)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Total Disk</span>
                            <span className="info-value">{formatBytes(systemInfo?.total_disk)}</span>
                        </div>
                    </div>
                </div>

                <div className="info-card">
                    <h3>Agent Information</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Agent Version</span>
                            <span className="info-value">{server.agent_version || 'Not installed'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Agent ID</span>
                            <span className="info-value mono">{server.agent_id || 'N/A'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Docker Version</span>
                            <span className="info-value">{server.docker_version || systemInfo?.docker_version || 'N/A'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Uptime</span>
                            <span className="info-value">{formatUptime(metrics?.uptime)}</span>
                        </div>
                    </div>
                </div>

                {server.status === 'online' && metrics && (
                    <div className="info-card metrics-card">
                        <h3>Current Resources</h3>
                        <div className="resource-meters">
                            <ResourceMeter label="CPU" value={metrics.cpu_percent} color="#6366F1" />
                            <ResourceMeter label="Memory" value={metrics.memory_percent} color="#10B981" />
                            <ResourceMeter label="Disk" value={metrics.disk_percent} color="#F59E0B" />
                        </div>
                    </div>
                )}

                {server.status !== 'online' && (
                    <div className="info-card offline-card">
                        <div className="offline-message">
                            <OfflineIcon />
                            <h4>Server Offline</h4>
                            <p>
                                {server.status === 'pending'
                                    ? 'Waiting for agent installation...'
                                    : 'Unable to connect to the server agent.'}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const ResourceMeter = ({ label, value, color }) => {
    const safeValue = Math.min(Math.max(value || 0, 0), 100);
    return (
        <div className="resource-meter">
            <div className="resource-header">
                <span className="resource-label">{label}</span>
                <span className="resource-value">{safeValue.toFixed(1)}%</span>
            </div>
            <div className="resource-bar">
                <div
                    className="resource-fill"
                    style={{
                        width: `${safeValue}%`,
                        backgroundColor: safeValue > 80 ? '#EF4444' : color
                    }}
                />
            </div>
        </div>
    );
};

const DockerTab = ({ serverId, serverStatus }) => {
    const [containers, setContainers] = useState([]);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [subTab, setSubTab] = useState('containers');
    const toast = useToast();

    useEffect(() => {
        if (serverStatus === 'online') {
            loadDockerData();
        } else {
            setLoading(false);
        }
    }, [serverId, serverStatus]);

    async function loadDockerData() {
        setLoading(true);
        try {
            const [containersRes, imagesRes] = await Promise.all([
                api.getRemoteContainers(serverId, true),
                api.getRemoteImages(serverId)
            ]);

            if (containersRes.success) setContainers(containersRes.data || []);
            if (imagesRes.success) setImages(imagesRes.data || []);
        } catch (err) {
            console.error('Failed to load Docker data:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleContainerAction(containerId, action) {
        try {
            let result;
            if (action === 'start') {
                result = await api.startRemoteContainer(serverId, containerId);
                toast.success('Container started');
            } else if (action === 'stop') {
                result = await api.stopRemoteContainer(serverId, containerId);
                toast.success('Container stopped');
            } else if (action === 'restart') {
                result = await api.restartRemoteContainer(serverId, containerId);
                toast.success('Container restarted');
            } else if (action === 'remove') {
                if (!confirm('Remove this container?')) return;
                result = await api.removeRemoteContainer(serverId, containerId, true);
                toast.success('Container removed');
            }
            loadDockerData();
        } catch (err) {
            toast.error(err.message || `Failed to ${action} container`);
        }
    }

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>Server Offline</h4>
                <p>Docker management requires the server to be online.</p>
            </div>
        );
    }

    if (loading) {
        return <div className="loading">Loading Docker data...</div>;
    }

    return (
        <div className="docker-tab">
            <div className="docker-sub-tabs">
                <button
                    className={`sub-tab ${subTab === 'containers' ? 'active' : ''}`}
                    onClick={() => setSubTab('containers')}
                >
                    Containers ({containers.length})
                </button>
                <button
                    className={`sub-tab ${subTab === 'images' ? 'active' : ''}`}
                    onClick={() => setSubTab('images')}
                >
                    Images ({images.length})
                </button>
            </div>

            {subTab === 'containers' && (
                <div className="containers-list">
                    {containers.length === 0 ? (
                        <div className="empty-list">No containers found on this server.</div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Image</th>
                                    <th>Status</th>
                                    <th>Ports</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {containers.map(container => {
                                    const isRunning = container.state === 'running';
                                    return (
                                        <tr key={container.id}>
                                            <td>
                                                <span className="container-name">{container.name}</span>
                                                <span className="container-id">{container.id?.substring(0, 12)}</span>
                                            </td>
                                            <td>{container.image}</td>
                                            <td>
                                                <span className={`status-pill ${isRunning ? 'running' : 'stopped'}`}>
                                                    {container.state}
                                                </span>
                                            </td>
                                            <td>{container.ports || '-'}</td>
                                            <td className="actions-cell">
                                                {isRunning ? (
                                                    <>
                                                        <button
                                                            className="btn-icon"
                                                            onClick={() => handleContainerAction(container.id, 'restart')}
                                                            title="Restart"
                                                        >
                                                            <RefreshIcon />
                                                        </button>
                                                        <button
                                                            className="btn-icon danger"
                                                            onClick={() => handleContainerAction(container.id, 'stop')}
                                                            title="Stop"
                                                        >
                                                            <StopIcon />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            className="btn-icon success"
                                                            onClick={() => handleContainerAction(container.id, 'start')}
                                                            title="Start"
                                                        >
                                                            <PlayIcon />
                                                        </button>
                                                        <button
                                                            className="btn-icon danger"
                                                            onClick={() => handleContainerAction(container.id, 'remove')}
                                                            title="Remove"
                                                        >
                                                            <TrashIcon />
                                                        </button>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {subTab === 'images' && (
                <div className="images-list">
                    {images.length === 0 ? (
                        <div className="empty-list">No images found on this server.</div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Repository</th>
                                    <th>Tag</th>
                                    <th>Image ID</th>
                                    <th>Size</th>
                                    <th>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {images.map(image => (
                                    <tr key={image.id}>
                                        <td>{image.repository || '<none>'}</td>
                                        <td>{image.tag || '<none>'}</td>
                                        <td className="mono">{image.id?.substring(0, 12)}</td>
                                        <td>{image.size}</td>
                                        <td>{image.created}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

const MetricsTab = ({ serverId, metrics }) => {
    if (!metrics) {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>No Metrics Available</h4>
                <p>Metrics are only available when the server is online.</p>
            </div>
        );
    }

    return (
        <div className="metrics-tab">
            <div className="metrics-grid">
                <div className="metric-card large">
                    <h3>CPU Usage</h3>
                    <div className="metric-gauge">
                        <CircularGauge value={metrics.cpu_percent || 0} color="#6366F1" />
                    </div>
                    <div className="metric-details">
                        <div className="detail-item">
                            <span>Load Average</span>
                            <span>{metrics.load_avg?.join(', ') || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card large">
                    <h3>Memory Usage</h3>
                    <div className="metric-gauge">
                        <CircularGauge value={metrics.memory_percent || 0} color="#10B981" />
                    </div>
                    <div className="metric-details">
                        <div className="detail-item">
                            <span>Used</span>
                            <span>{formatBytes(metrics.memory_used)}</span>
                        </div>
                        <div className="detail-item">
                            <span>Total</span>
                            <span>{formatBytes(metrics.memory_total)}</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card large">
                    <h3>Disk Usage</h3>
                    <div className="metric-gauge">
                        <CircularGauge value={metrics.disk_percent || 0} color="#F59E0B" />
                    </div>
                    <div className="metric-details">
                        <div className="detail-item">
                            <span>Used</span>
                            <span>{formatBytes(metrics.disk_used)}</span>
                        </div>
                        <div className="detail-item">
                            <span>Total</span>
                            <span>{formatBytes(metrics.disk_total)}</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card">
                    <h3>Network I/O</h3>
                    <div className="network-stats">
                        <div className="net-stat">
                            <UploadIcon />
                            <span>Upload</span>
                            <span className="value">{formatBytes(metrics.network_sent)}/s</span>
                        </div>
                        <div className="net-stat">
                            <DownloadIcon />
                            <span>Download</span>
                            <span className="value">{formatBytes(metrics.network_recv)}/s</span>
                        </div>
                    </div>
                </div>

                <div className="metric-card">
                    <h3>Docker</h3>
                    <div className="docker-stats">
                        <div className="docker-stat">
                            <span>Containers</span>
                            <span className="value">{metrics.container_count || 0}</span>
                        </div>
                        <div className="docker-stat">
                            <span>Running</span>
                            <span className="value">{metrics.container_running || 0}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CircularGauge = ({ value, color }) => {
    const safeValue = Math.min(Math.max(value || 0, 0), 100);
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (safeValue / 100) * circumference;

    return (
        <svg className="circular-gauge" viewBox="0 0 100 100">
            <circle className="gauge-bg" cx="50" cy="50" r="45" />
            <circle
                className="gauge-fill"
                cx="50"
                cy="50"
                r="45"
                style={{
                    strokeDasharray: circumference,
                    strokeDashoffset: offset,
                    stroke: safeValue > 80 ? '#EF4444' : color
                }}
            />
            <text x="50" y="50" className="gauge-text">
                {safeValue.toFixed(0)}%
            </text>
        </svg>
    );
};

const SettingsTab = ({ server, onUpdate, onRegenerateToken }) => {
    const [formData, setFormData] = useState({
        name: server.name || '',
        description: server.description || '',
        hostname: server.hostname || '',
        ip_address: server.ip_address || '',
        group_id: server.group_id || ''
    });
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [allowedIPs, setAllowedIPs] = useState([]);
    const [newIP, setNewIP] = useState('');
    const [connectionInfo, setConnectionInfo] = useState(null);
    const [securityAlerts, setSecurityAlerts] = useState([]);
    const [rotatingKey, setRotatingKey] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadGroups();
        loadSecurityData();
    }, []);

    async function loadGroups() {
        try {
            const data = await api.getServerGroups();
            setGroups(data.groups || []);
        } catch (err) {
            console.error('Failed to load groups:', err);
        }
    }

    async function loadSecurityData() {
        try {
            const [ipsData, connData, alertsData] = await Promise.all([
                api.getAllowedIPs(server.id),
                api.getConnectionInfo(server.id),
                api.getServerSecurityAlerts(server.id, { status: 'open', limit: 10 })
            ]);
            setAllowedIPs(ipsData.allowed_ips || []);
            setConnectionInfo(connData);
            setSecurityAlerts(alertsData || []);
        } catch (err) {
            console.error('Failed to load security data:', err);
        }
    }

    async function handleAddIP() {
        if (!newIP.trim()) return;
        const updated = [...allowedIPs, newIP.trim()];
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            setNewIP('');
            toast.success('IP allowlist updated');
        } catch (err) {
            toast.error(err.details?.[0] || err.message || 'Invalid IP pattern');
        }
    }

    async function handleRemoveIP(ip) {
        const updated = allowedIPs.filter(i => i !== ip);
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            toast.success('IP removed from allowlist');
        } catch (err) {
            toast.error(err.message || 'Failed to update allowlist');
        }
    }

    async function handleRotateKey() {
        if (!confirm('Rotate API credentials? The agent must be online to receive new credentials.')) return;
        setRotatingKey(true);
        try {
            const result = await api.rotateAPIKey(server.id);
            if (result.success) {
                toast.success('Credential rotation initiated. Agent will update shortly.');
            } else {
                toast.error(result.error || 'Failed to rotate credentials');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to rotate credentials');
        } finally {
            setRotatingKey(false);
        }
    }

    async function handleAcknowledgeAlert(alertId) {
        try {
            await api.acknowledgeAlert(alertId);
            setSecurityAlerts(prev => prev.map(a =>
                a.id === alertId ? { ...a, status: 'acknowledged' } : a
            ));
        } catch (err) {
            toast.error('Failed to acknowledge alert');
        }
    }

    async function handleResolveAlert(alertId) {
        try {
            await api.resolveAlert(alertId);
            setSecurityAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch (err) {
            toast.error('Failed to resolve alert');
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);

        try {
            await api.updateServer(server.id, formData);
            toast.success('Server updated successfully');
            onUpdate();
        } catch (err) {
            toast.error(err.message || 'Failed to update server');
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    return (
        <div className="settings-tab">
            <form onSubmit={handleSubmit} className="settings-form">
                <div className="form-section">
                    <h3>Basic Information</h3>

                    <div className="form-group">
                        <label>Server Name</label>
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
                            rows={3}
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
                            />
                        </div>
                        <div className="form-group">
                            <label>IP Address</label>
                            <input
                                type="text"
                                name="ip_address"
                                value={formData.ip_address}
                                onChange={handleChange}
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

                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>

            <div className="form-section">
                <h3>Agent Registration</h3>
                <p className="section-description">
                    If you need to reinstall the agent or connect from a different machine,
                    generate a new registration token.
                </p>
                <button className="btn btn-secondary" onClick={onRegenerateToken}>
                    <RefreshIcon /> Generate New Token
                </button>
            </div>

            <div className="form-section">
                <h3>Security</h3>

                {/* Connection Info */}
                {connectionInfo && (
                    <div className="security-info">
                        <div className="info-item">
                            <span className="label">Current Connection IP:</span>
                            <span className="value">{connectionInfo.ip_address || 'Not connected'}</span>
                        </div>
                        {connectionInfo.connected_since && (
                            <div className="info-item">
                                <span className="label">Connected Since:</span>
                                <span className="value">{new Date(connectionInfo.connected_since).toLocaleString()}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* IP Allowlist */}
                <div className="subsection">
                    <h4>IP Allowlist</h4>
                    <p className="section-description">
                        Restrict which IP addresses can connect to this server. Leave empty to allow all IPs.
                        Supports single IPs, CIDR notation (192.168.1.0/24), and wildcards (192.168.1.*).
                    </p>

                    <div className="ip-list">
                        {allowedIPs.length === 0 ? (
                            <p className="empty-state">No IP restrictions (all IPs allowed)</p>
                        ) : (
                            allowedIPs.map((ip, idx) => (
                                <div key={idx} className="ip-item">
                                    <code>{ip}</code>
                                    {connectionInfo?.ip_address === ip && (
                                        <span className="badge badge-success">Current</span>
                                    )}
                                    <button
                                        className="btn btn-icon btn-danger-subtle"
                                        onClick={() => handleRemoveIP(ip)}
                                        title="Remove"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="ip-add-form">
                        <input
                            type="text"
                            placeholder="Add IP address or CIDR (e.g., 192.168.1.0/24)"
                            value={newIP}
                            onChange={(e) => setNewIP(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIP())}
                        />
                        <button className="btn btn-secondary" onClick={handleAddIP}>
                            Add IP
                        </button>
                    </div>

                    {connectionInfo?.ip_address && allowedIPs.length > 0 && !allowedIPs.some(ip => {
                        // Simple check - full validation is server-side
                        return ip === connectionInfo.ip_address || ip.includes('*') || ip.includes('/');
                    }) && (
                        <p className="warning">
                            Warning: Current connection IP ({connectionInfo.ip_address}) may be blocked!
                        </p>
                    )}
                </div>

                {/* API Key Rotation */}
                <div className="subsection">
                    <h4>API Key Rotation</h4>
                    <p className="section-description">
                        Rotate the API credentials used by the agent. The agent must be online to receive new credentials.
                    </p>
                    <button
                        className="btn btn-secondary"
                        onClick={handleRotateKey}
                        disabled={rotatingKey || server.status !== 'online'}
                    >
                        <KeyIcon /> {rotatingKey ? 'Rotating...' : 'Rotate API Key'}
                    </button>
                    {server.api_key_last_rotated && (
                        <p className="hint">Last rotated: {new Date(server.api_key_last_rotated).toLocaleString()}</p>
                    )}
                </div>

                {/* Security Alerts */}
                {securityAlerts.length > 0 && (
                    <div className="subsection">
                        <h4>Security Alerts</h4>
                        <div className="alerts-list">
                            {securityAlerts.map(alert => (
                                <div key={alert.id} className={`alert-item severity-${alert.severity}`}>
                                    <div className="alert-header">
                                        <span className={`severity-badge ${alert.severity}`}>{alert.severity}</span>
                                        <span className="alert-type">{alert.alert_type.replace('_', ' ')}</span>
                                        <span className="alert-time">{new Date(alert.created_at).toLocaleString()}</span>
                                    </div>
                                    <div className="alert-details">
                                        {alert.source_ip && <span>IP: {alert.source_ip}</span>}
                                        {alert.details?.message && <span>{alert.details.message}</span>}
                                        {alert.details?.attempts && <span>Attempts: {alert.details.attempts}</span>}
                                    </div>
                                    <div className="alert-actions">
                                        {alert.status === 'open' && (
                                            <button
                                                className="btn btn-sm btn-secondary"
                                                onClick={() => handleAcknowledgeAlert(alert.id)}
                                            >
                                                Acknowledge
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-sm btn-success"
                                            onClick={() => handleResolveAlert(alert.id)}
                                        >
                                            Resolve
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="form-section danger-zone">
                <h3>Danger Zone</h3>
                <p className="section-description">
                    Removing this server will disconnect the agent and delete all associated data.
                </p>
                <button className="btn btn-danger">
                    <TrashIcon /> Remove Server
                </button>
            </div>
        </div>
    );
};

// Helper function
function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// Icons
const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

const KeyIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
);

const OfflineIcon = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
);

const StopIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12"/>
    </svg>
);

const PlayIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
);

const UploadIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="17 11 12 6 7 11"/>
        <line x1="12" y1="6" x2="12" y2="18"/>
    </svg>
);

const DownloadIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="7 13 12 18 17 13"/>
        <line x1="12" y1="18" x2="12" y2="6"/>
    </svg>
);

export default ServerDetail;
