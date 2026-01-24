import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

// Server context for Docker operations
const ServerContext = createContext({ serverId: 'local', serverName: 'Local' });
const useServer = () => useContext(ServerContext);

const Docker = () => {
    const [activeTab, setActiveTab] = useState('containers');
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [servers, setServers] = useState([]);
    const [selectedServer, setSelectedServer] = useState({ id: 'local', name: 'Local (this server)' });
    const [stats, setStats] = useState({
        containers: { total: 0, running: 0, stopped: 0 },
        images: { total: 0, size: '0 B' },
        volumes: { total: 0 },
        networks: { total: 0 }
    });

    useEffect(() => {
        loadServers();
    }, []);

    useEffect(() => {
        checkDockerStatus();
    }, [selectedServer]);

    async function loadServers() {
        try {
            const data = await api.getAvailableServers();
            setServers(data.servers || []);
        } catch (err) {
            console.error('Failed to load servers:', err);
            // Default to just local
            setServers([{ id: 'local', name: 'Local (this server)', status: 'online' }]);
        }
    }

    async function checkDockerStatus() {
        setLoading(true);
        try {
            if (selectedServer.id === 'local') {
                const status = await api.getDockerStatus();
                setDockerStatus(status);
                if (status.installed) {
                    loadStats();
                } else {
                    setLoading(false);
                }
            } else {
                // For remote servers, check if the agent is online
                const serverData = await api.getServer(selectedServer.id);
                if (serverData.server?.status === 'online') {
                    setDockerStatus({ installed: true, running: true });
                    loadStats();
                } else {
                    setDockerStatus({ installed: false, error: 'Server agent is offline' });
                    setLoading(false);
                }
            }
        } catch (err) {
            setDockerStatus({ installed: false, error: err.message });
            setLoading(false);
        }
    }

    async function loadStats() {
        try {
            let containersData, imagesData, volumesData, networksData;

            if (selectedServer.id === 'local') {
                [containersData, imagesData, volumesData, networksData] = await Promise.all([
                    api.getContainers(true),
                    api.getImages(),
                    api.getVolumes(),
                    api.getNetworks()
                ]);
            } else {
                [containersData, imagesData, volumesData, networksData] = await Promise.all([
                    api.getRemoteContainers(selectedServer.id, true),
                    api.getRemoteImages(selectedServer.id),
                    api.getRemoteVolumes(selectedServer.id),
                    api.getRemoteNetworks(selectedServer.id)
                ]);

                // Transform remote response format
                if (containersData.success) containersData = { containers: containersData.data };
                if (imagesData.success) imagesData = { images: imagesData.data };
                if (volumesData.success) volumesData = { volumes: volumesData.data };
                if (networksData.success) networksData = { networks: networksData.data };
            }

            const containers = containersData.containers || [];
            const images = imagesData.images || [];
            const volumes = volumesData.volumes || [];
            const networks = networksData.networks || [];

            const running = containers.filter(c => c.state === 'running').length;

            setStats({
                containers: {
                    total: containers.length,
                    running,
                    stopped: containers.length - running
                },
                images: {
                    total: images.length,
                    size: formatTotalImageSize(images)
                },
                volumes: { total: volumes.length },
                networks: { total: networks.length }
            });
        } catch (err) {
            console.error('Failed to load stats:', err);
        } finally {
            setLoading(false);
        }
    }

    function formatTotalImageSize(images) {
        const sizes = images.map(img => {
            const size = img.size || '0 B';
            const match = size.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/i);
            if (!match) return 0;
            const [, num, unit = 'B'] = match;
            const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
            return parseFloat(num) * (multipliers[unit.toUpperCase()] || 1);
        });
        const total = sizes.reduce((a, b) => a + b, 0);
        if (total >= 1024**3) return `${(total / 1024**3).toFixed(1)} GB`;
        if (total >= 1024**2) return `${(total / 1024**2).toFixed(1)} MB`;
        if (total >= 1024) return `${(total / 1024).toFixed(1)} KB`;
        return `${total} B`;
    }

    if (loading) {
        return <div className="loading">Checking Docker status...</div>;
    }

    if (!dockerStatus?.installed) {
        return (
            <div className="page docker-page">
                <div className="page-header">
                    <div className="page-header-content">
                        <h1>Docker</h1>
                        <p className="page-description">Container management</p>
                    </div>
                </div>
                <div className="docker-unavailable">
                    <div className="docker-unavailable-icon">
                        <svg viewBox="0 0 24 24" width="64" height="64" stroke="currentColor" fill="none" strokeWidth="1">
                            <rect x="2" y="7" width="5" height="5" rx="1"/>
                            <rect x="9" y="7" width="5" height="5" rx="1"/>
                            <rect x="16" y="7" width="5" height="5" rx="1"/>
                            <rect x="2" y="14" width="5" height="5" rx="1"/>
                            <rect x="9" y="14" width="5" height="5" rx="1"/>
                            <path d="M21 12c0 4-3 7-8 7s-8-3-8-7" strokeDasharray="2 2"/>
                        </svg>
                    </div>
                    <h2>Docker Not Available</h2>
                    <p className="docker-unavailable-message">
                        Docker is not installed or not running on this system.
                    </p>
                    <div className="docker-unavailable-details">
                        <code>{dockerStatus?.error || 'Unable to connect to Docker daemon'}</code>
                    </div>
                    <div className="docker-unavailable-help">
                        <h4>To use Docker management:</h4>
                        <ul>
                            <li>Ensure Docker Desktop is installed and running</li>
                            <li>On Linux, make sure the Docker daemon is started</li>
                            <li>Verify the user has permissions to access Docker</li>
                        </ul>
                    </div>
                    <button className="btn btn-primary" onClick={checkDockerStatus}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M23 4v6h-6M1 20v-6h6"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Retry Connection
                    </button>
                </div>
            </div>
        );
    }

    const tabs = [
        { id: 'containers', label: 'Containers' },
        { id: 'compose', label: 'Compose' },
        { id: 'images', label: 'Images' },
        { id: 'volumes', label: 'Volumes' },
        { id: 'networks', label: 'Networks' }
    ];

    function handleServerChange(e) {
        const serverId = e.target.value;
        const server = servers.find(s => s.id === serverId) || { id: 'local', name: 'Local' };
        setSelectedServer(server);
    }

    const serverContextValue = {
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        isRemote: selectedServer.id !== 'local'
    };

    return (
        <ServerContext.Provider value={serverContextValue}>
        <div className="docker-page-new">
            <div className="docker-page-header">
                <div className="docker-page-title">
                    <h2>Docker Management</h2>
                    <div className="docker-page-subtitle">Manage Containers, Images, and Networks</div>
                </div>
                <div className="docker-page-actions">
                    <div className="server-selector">
                        <ServerSelectorIcon />
                        <select value={selectedServer.id} onChange={handleServerChange}>
                            {servers.map(server => (
                                <option key={server.id} value={server.id} disabled={server.status === 'offline'}>
                                    {server.name} {server.status === 'offline' ? '(Offline)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    {activeTab === 'containers' && <RunContainerButton />}
                    {activeTab === 'images' && <PullImageButton />}
                    {activeTab === 'networks' && <CreateNetworkButton />}
                    {activeTab === 'volumes' && <CreateVolumeButton />}
                </div>
            </div>

            <div className="docker-stats-row">
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Containers</div>
                    <div className="docker-stat-value">{stats.containers.total}</div>
                    <div className="docker-stat-meta">
                        <span className="docker-stat-running">{stats.containers.running} Running</span>
                        <span className="docker-stat-stopped">{stats.containers.stopped} Stopped</span>
                    </div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Images</div>
                    <div className="docker-stat-value">{stats.images.total}</div>
                    <div className="docker-stat-meta">{stats.images.size} Disk Usage</div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Volumes</div>
                    <div className="docker-stat-value">{stats.volumes.total}</div>
                    <div className="docker-stat-meta">Persistent Data</div>
                </div>
                <div className="docker-stat-card">
                    <div className="docker-stat-label">Networks</div>
                    <div className="docker-stat-value">{stats.networks.total}</div>
                    <div className="docker-stat-meta">Bridge / Host / None</div>
                </div>
            </div>

            <div className="docker-panel">
                <div className="docker-panel-header">
                    <div className="docker-panel-tabs">
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                className={`docker-panel-tab ${activeTab === tab.id ? 'active' : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.label}
                            </div>
                        ))}
                    </div>
                    <div className="docker-panel-actions">
                        <PruneButton onPruned={loadStats} />
                    </div>
                </div>

                <div className="docker-panel-content">
                    {activeTab === 'containers' && <ContainersTab onStatsChange={loadStats} />}
                    {activeTab === 'compose' && <ComposeTab onStatsChange={loadStats} />}
                    {activeTab === 'images' && <ImagesTab onStatsChange={loadStats} />}
                    {activeTab === 'networks' && <NetworksTab onStatsChange={loadStats} />}
                    {activeTab === 'volumes' && <VolumesTab onStatsChange={loadStats} />}
                </div>
            </div>
        </div>
        </ServerContext.Provider>
    );
};

// Server Selector Icon
const ServerSelectorIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
        <line x1="6" y1="6" x2="6.01" y2="6"/>
        <line x1="6" y1="18" x2="6.01" y2="18"/>
    </svg>
);

// Action Buttons
const RunContainerButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                <span>+</span> Run Container
            </button>
            {showModal && <RunContainerModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const PullImageButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                <span>+</span> Pull Image
            </button>
            {showModal && <PullImageModal onClose={() => setShowModal(false)} onPulled={() => window.location.reload()} />}
        </>
    );
};

const CreateNetworkButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                <span>+</span> Create Network
            </button>
            {showModal && <CreateNetworkModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const CreateVolumeButton = () => {
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                <span>+</span> Create Volume
            </button>
            {showModal && <CreateVolumeModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const PruneButton = ({ onPruned }) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);

    async function handlePrune() {
        if (!confirm('Remove unused Docker resources? This will remove:\n- Stopped containers\n- Unused images\n- Unused networks')) return;

        setLoading(true);
        try {
            await api.request('/docker/cleanup', { method: 'POST', body: {} });
            toast.success('Docker cleanup completed');
            onPruned?.();
        } catch (err) {
            toast.error('Failed to cleanup Docker resources');
        } finally {
            setLoading(false);
        }
    }

    return (
        <button className="btn btn-secondary btn-sm" onClick={handlePrune} disabled={loading}>
            {loading ? 'Cleaning...' : 'Prune Unused'}
        </button>
    );
};

// Resource Bar Component
const ResourceBar = ({ label, value, color }) => {
    const numValue = parseFloat(value) || 0;
    return (
        <div className="docker-res-container">
            <span className="docker-res-label">{label}</span>
            <div className="docker-res-track">
                <div
                    className="docker-res-fill"
                    style={{ width: `${Math.min(numValue, 100)}%`, backgroundColor: color }}
                />
            </div>
            <span className="docker-res-value">{numValue.toFixed(0)}%</span>
        </div>
    );
};

// Icon Actions
const IconAction = ({ title, onClick, color, children, disabled }) => (
    <button
        className="docker-icon-action"
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={color ? { color } : {}}
    >
        {children}
    </button>
);

// Icons
const LogsIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
);

const TerminalIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
);

const RestartIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
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

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

// Containers Tab
const ContainersTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [containers, setContainers] = useState([]);
    const [containerStats, setContainerStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(true);
    const [selectedContainer, setSelectedContainer] = useState(null);
    const [execContainer, setExecContainer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadContainers();
    }, [showAll, serverId]);

    async function loadContainers() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainers(serverId, showAll);
                data = result.success ? { containers: result.data || [] } : { containers: [] };
            } else {
                data = await api.getContainers(showAll);
            }
            const containerList = data.containers || [];
            setContainers(containerList);

            // Load stats for running containers
            const runningContainers = containerList.filter(c => c.state === 'running');
            const statsPromises = runningContainers.map(async (c) => {
                try {
                    let statsData;
                    if (isRemote) {
                        const result = await api.getRemoteContainerStats(serverId, c.id);
                        statsData = result.success ? { stats: result.data } : { stats: null };
                    } else {
                        statsData = await api.getContainerStats(c.id);
                    }
                    return { id: c.id, stats: statsData.stats };
                } catch {
                    return { id: c.id, stats: null };
                }
            });

            const statsResults = await Promise.all(statsPromises);
            const statsMap = {};
            statsResults.forEach(({ id, stats }) => {
                if (stats) statsMap[id] = stats;
            });
            setContainerStats(statsMap);
        } catch (err) {
            console.error('Failed to load containers:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(containerId, action) {
        try {
            if (action === 'start') {
                if (isRemote) {
                    await api.startRemoteContainer(serverId, containerId);
                } else {
                    await api.startContainer(containerId);
                }
                toast.success('Container started');
            } else if (action === 'stop') {
                if (isRemote) {
                    await api.stopRemoteContainer(serverId, containerId);
                } else {
                    await api.stopContainer(containerId);
                }
                toast.success('Container stopped');
            } else if (action === 'restart') {
                if (isRemote) {
                    await api.restartRemoteContainer(serverId, containerId);
                } else {
                    await api.restartContainer(containerId);
                }
                toast.success('Container restarted');
            } else if (action === 'remove') {
                if (!confirm('Remove this container?')) return;
                if (isRemote) {
                    await api.removeRemoteContainer(serverId, containerId, true);
                } else {
                    await api.removeContainer(containerId, true);
                }
                toast.success('Container removed');
            }
            loadContainers();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} container:`, err);
            toast.error(err.message || `Failed to ${action} container`);
        }
    }

    function parseStats(stats) {
        if (!stats) return { cpu: 0, memory: 0 };

        // CPU comes as "0.12%" format
        const cpuStr = stats.CPUPerc || stats.cpu_percent || '0%';
        const cpu = parseFloat(cpuStr.replace('%', '')) || 0;

        // Memory comes as "0.12%" format
        const memStr = stats.MemPerc || stats.memory_percent || '0%';
        const memory = parseFloat(memStr.replace('%', '')) || 0;

        return { cpu, memory };
    }

    function formatPorts(portsStr) {
        if (!portsStr) return '-';
        // Parse ports like "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp"
        const ports = portsStr.split(',').map(p => p.trim()).filter(Boolean);
        return ports.length > 0 ? ports : ['-'];
    }

    const filteredContainers = containers.filter(c => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return c.name?.toLowerCase().includes(search) ||
               c.id?.toLowerCase().includes(search) ||
               c.image?.toLowerCase().includes(search);
    });

    if (loading) {
        return <div className="docker-loading">Loading containers...</div>;
    }

    return (
        <div>
            <div className="docker-table-header">
                <label className="docker-filter-toggle">
                    <input
                        type="checkbox"
                        checked={showAll}
                        onChange={(e) => setShowAll(e.target.checked)}
                    />
                    Show stopped
                </label>
                <input
                    type="text"
                    className="docker-search"
                    placeholder="Search ID or Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {filteredContainers.length === 0 ? (
                <div className="docker-empty">
                    <h3>No containers</h3>
                    <p>Run your first container to get started.</p>
                </div>
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Container</th>
                            <th>Image</th>
                            <th>Status</th>
                            <th>Bindings</th>
                            <th>Resources</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredContainers.map(container => {
                            const stats = parseStats(containerStats[container.id]);
                            const isRunning = container.state === 'running';
                            const ports = formatPorts(container.ports);

                            return (
                                <tr key={container.id}>
                                    <td>
                                        <span className="docker-container-name">{container.name}</span>
                                        <span className="docker-container-id">{container.id?.substring(0, 9)}</span>
                                    </td>
                                    <td>
                                        <span className="docker-image-tag">{container.image}</span>
                                    </td>
                                    <td>
                                        <span className={`docker-status-pill ${isRunning ? 'running' : 'exited'}`}>
                                            <span className="docker-status-dot" />
                                            {isRunning ? 'Running' : 'Exited'}
                                        </span>
                                        <div className="docker-status-detail">{container.status}</div>
                                    </td>
                                    <td>
                                        <span className={`docker-ports ${!isRunning ? 'faded' : ''}`}>
                                            {Array.isArray(ports) ? ports.map((p, i) => (
                                                <span key={i}>{p}{i < ports.length - 1 && <br />}</span>
                                            )) : ports}
                                        </span>
                                    </td>
                                    <td>
                                        <div className={!isRunning ? 'faded' : ''}>
                                            <ResourceBar
                                                label="CPU"
                                                value={stats.cpu}
                                                color={stats.cpu > 50 ? '#F59E0B' : '#6366F1'}
                                            />
                                            <ResourceBar
                                                label="RAM"
                                                value={stats.memory}
                                                color="#10B981"
                                            />
                                        </div>
                                    </td>
                                    <td className="docker-actions-cell">
                                        <IconAction title="Logs" onClick={() => setSelectedContainer(container)}>
                                            <LogsIcon />
                                        </IconAction>
                                        {isRunning && (
                                            <>
                                                <IconAction title="Terminal" onClick={() => setExecContainer(container)}>
                                                    <TerminalIcon />
                                                </IconAction>
                                                <IconAction title="Restart" onClick={() => handleAction(container.id, 'restart')}>
                                                    <RestartIcon />
                                                </IconAction>
                                                <IconAction title="Stop" onClick={() => handleAction(container.id, 'stop')} color="#EF4444">
                                                    <StopIcon />
                                                </IconAction>
                                            </>
                                        )}
                                        {!isRunning && (
                                            <>
                                                <IconAction title="Start" onClick={() => handleAction(container.id, 'start')} color="#10B981">
                                                    <PlayIcon />
                                                </IconAction>
                                                <IconAction title="Delete" onClick={() => handleAction(container.id, 'remove')} color="#EF4444">
                                                    <TrashIcon />
                                                </IconAction>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {selectedContainer && (
                <ContainerLogsModal
                    container={selectedContainer}
                    onClose={() => setSelectedContainer(null)}
                />
            )}

            {execContainer && (
                <ContainerExecModal
                    container={execContainer}
                    onClose={() => setExecContainer(null)}
                />
            )}
        </div>
    );
};

// Images Tab
const ImagesTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadImages();
    }, [serverId]);

    async function loadImages() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteImages(serverId);
                data = result.success ? { images: result.data || [] } : { images: [] };
            } else {
                data = await api.getImages();
            }
            setImages(data.images || []);
        } catch (err) {
            console.error('Failed to load images:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(imageId) {
        if (!confirm('Remove this image?')) return;

        try {
            if (isRemote) {
                await api.removeRemoteImage(serverId, imageId, true);
            } else {
                await api.removeImage(imageId, true);
            }
            toast.success('Image removed successfully');
            loadImages();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove image:', err);
            toast.error('Failed to remove image. It may be in use by a container.');
        }
    }

    const filteredImages = images.filter(img => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return img.repository?.toLowerCase().includes(search) ||
               img.tag?.toLowerCase().includes(search) ||
               img.id?.toLowerCase().includes(search);
    });

    if (loading) {
        return <div className="docker-loading">Loading images...</div>;
    }

    return (
        <div>
            <div className="docker-table-header">
                <div />
                <input
                    type="text"
                    className="docker-search"
                    placeholder="Search images..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {filteredImages.length === 0 ? (
                <div className="docker-empty">
                    <h3>No images</h3>
                    <p>Pull your first image to get started.</p>
                </div>
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Repository</th>
                            <th>Tag</th>
                            <th>Image ID</th>
                            <th>Size</th>
                            <th>Created</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredImages.map(image => (
                            <tr key={image.id}>
                                <td>
                                    <span className="docker-container-name">{image.repository || '<none>'}</span>
                                </td>
                                <td>
                                    <span className="docker-image-tag">{image.tag || '<none>'}</span>
                                </td>
                                <td>
                                    <span className="docker-container-id">{image.id?.substring(0, 12)}</span>
                                </td>
                                <td>{image.size}</td>
                                <td>{image.created}</td>
                                <td className="docker-actions-cell">
                                    <IconAction title="Delete" onClick={() => handleRemove(image.id)} color="#EF4444">
                                        <TrashIcon />
                                    </IconAction>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

// Networks Tab
const NetworksTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [networks, setNetworks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadNetworks();
    }, [serverId]);

    async function loadNetworks() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteNetworks(serverId);
                data = result.success ? { networks: result.data || [] } : { networks: [] };
            } else {
                data = await api.getNetworks();
            }
            setNetworks(data.networks || []);
        } catch (err) {
            console.error('Failed to load networks:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(networkId) {
        if (!confirm('Remove this network?')) return;

        try {
            await api.removeNetwork(networkId);
            toast.success('Network removed successfully');
            loadNetworks();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove network:', err);
            toast.error('Failed to remove network. It may be in use.');
        }
    }

    const systemNetworks = ['bridge', 'host', 'none'];

    if (loading) {
        return <div className="docker-loading">Loading networks...</div>;
    }

    return (
        <div>
            {networks.length === 0 ? (
                <div className="docker-empty">
                    <h3>No networks</h3>
                    <p>Create a network to connect containers.</p>
                </div>
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Network ID</th>
                            <th>Driver</th>
                            <th>Scope</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {networks.map(network => (
                            <tr key={network.id}>
                                <td>
                                    <span className="docker-container-name">{network.name}</span>
                                </td>
                                <td>
                                    <span className="docker-container-id">{network.id?.substring(0, 12)}</span>
                                </td>
                                <td>{network.driver}</td>
                                <td>{network.scope}</td>
                                <td className="docker-actions-cell">
                                    {!systemNetworks.includes(network.name) && (
                                        <IconAction title="Delete" onClick={() => handleRemove(network.id)} color="#EF4444">
                                            <TrashIcon />
                                        </IconAction>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

// Volumes Tab
const VolumesTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [volumes, setVolumes] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadVolumes();
    }, [serverId]);

    async function loadVolumes() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteVolumes(serverId);
                data = result.success ? { volumes: result.data || [] } : { volumes: [] };
            } else {
                data = await api.getVolumes();
            }
            setVolumes(data.volumes || []);
        } catch (err) {
            console.error('Failed to load volumes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(volumeName) {
        if (!confirm('Remove this volume? All data will be lost.')) return;

        try {
            await api.removeVolume(volumeName, true);
            toast.success('Volume removed successfully');
            loadVolumes();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove volume:', err);
            toast.error('Failed to remove volume. It may be in use.');
        }
    }

    if (loading) {
        return <div className="docker-loading">Loading volumes...</div>;
    }

    return (
        <div>
            {volumes.length === 0 ? (
                <div className="docker-empty">
                    <h3>No volumes</h3>
                    <p>Create a volume for persistent data storage.</p>
                </div>
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Driver</th>
                            <th>Mountpoint</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {volumes.map(volume => (
                            <tr key={volume.name}>
                                <td>
                                    <span className="docker-container-name">{volume.name}</span>
                                </td>
                                <td>{volume.driver}</td>
                                <td>
                                    <span className="docker-container-id" style={{ maxWidth: '300px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {volume.mountpoint || '-'}
                                    </span>
                                </td>
                                <td className="docker-actions-cell">
                                    <IconAction title="Delete" onClick={() => handleRemove(volume.name)} color="#EF4444">
                                        <TrashIcon />
                                    </IconAction>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

// Compose Tab
const ComposeTab = ({ onStatsChange }) => {
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState(null);
    const [logsProject, setLogsProject] = useState(null);
    const [actionLoading, setActionLoading] = useState({});

    useEffect(() => {
        loadProjects();
    }, [serverId]);

    async function loadProjects() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = await api.getRemoteComposeProjects(serverId);
            } else {
                data = await api.request('/docker/compose/list');
            }
            setProjects(Array.isArray(data) ? data : data.projects || []);
        } catch (err) {
            console.error('Failed to load compose projects:', err);
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(project, action) {
        const projectPath = project.ConfigFiles || project.config_files;
        if (!projectPath) {
            toast.error('Project path not found');
            return;
        }

        setActionLoading(prev => ({ ...prev, [project.Name || project.name]: true }));

        try {
            let result;
            if (action === 'up') {
                if (isRemote) {
                    result = await api.remoteComposeUp(serverId, projectPath);
                } else {
                    result = await api.composeUp(projectPath, true, false);
                }
                toast.success('Project started');
            } else if (action === 'down') {
                if (!confirm('Stop this compose project? Containers will be removed.')) {
                    setActionLoading(prev => ({ ...prev, [project.Name || project.name]: false }));
                    return;
                }
                if (isRemote) {
                    result = await api.remoteComposeDown(serverId, projectPath);
                } else {
                    result = await api.composeDown(projectPath, false, true);
                }
                toast.success('Project stopped');
            } else if (action === 'restart') {
                if (isRemote) {
                    result = await api.remoteComposeRestart(serverId, projectPath);
                } else {
                    result = await api.composeRestart(projectPath);
                }
                toast.success('Project restarted');
            } else if (action === 'pull') {
                if (isRemote) {
                    result = await api.remoteComposePull(serverId, projectPath);
                } else {
                    result = await api.composePull(projectPath);
                }
                toast.success('Images pulled');
            }
            loadProjects();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} project:`, err);
            toast.error(err.message || `Failed to ${action} project`);
        } finally {
            setActionLoading(prev => ({ ...prev, [project.Name || project.name]: false }));
        }
    }

    function getProjectStatus(project) {
        const status = project.Status || project.status || '';
        if (status.includes('running')) return 'running';
        if (status.includes('exited') || status.includes('stopped')) return 'exited';
        return 'unknown';
    }

    function parseRunningCount(status) {
        // Parse status like "running(3)" or "exited(2), running(1)"
        const match = status.match(/running\((\d+)\)/);
        return match ? parseInt(match[1], 10) : 0;
    }

    if (loading) {
        return <div className="docker-loading">Loading compose projects...</div>;
    }

    return (
        <div>
            <div className="docker-table-header">
                <div className="docker-table-info">
                    {projects.length} project{projects.length !== 1 ? 's' : ''} found
                </div>
                <button className="btn btn-secondary btn-sm" onClick={loadProjects}>
                    Refresh
                </button>
            </div>

            {projects.length === 0 ? (
                <div className="docker-empty">
                    <h3>No Compose Projects</h3>
                    <p>No Docker Compose projects are running on this server.</p>
                    <p className="text-muted">
                        Start a compose project with <code>docker compose up -d</code>
                    </p>
                </div>
            ) : (
                <table className="docker-table">
                    <thead>
                        <tr>
                            <th>Project</th>
                            <th>Status</th>
                            <th>Config File</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(project => {
                            const name = project.Name || project.name;
                            const status = project.Status || project.status || 'unknown';
                            const configFiles = project.ConfigFiles || project.config_files || '';
                            const isRunning = getProjectStatus(project) === 'running';
                            const runningCount = parseRunningCount(status);
                            const isLoading = actionLoading[name];

                            return (
                                <tr key={name}>
                                    <td>
                                        <span className="docker-container-name">{name}</span>
                                    </td>
                                    <td>
                                        <span className={`docker-status-pill ${isRunning ? 'running' : 'exited'}`}>
                                            <span className="docker-status-dot" />
                                            {isRunning ? `Running (${runningCount})` : 'Stopped'}
                                        </span>
                                        <div className="docker-status-detail">{status}</div>
                                    </td>
                                    <td>
                                        <span className="docker-container-id" style={{ maxWidth: '300px', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {configFiles}
                                        </span>
                                    </td>
                                    <td className="docker-actions-cell">
                                        <IconAction
                                            title="Logs"
                                            onClick={() => setLogsProject(project)}
                                            disabled={isLoading}
                                        >
                                            <LogsIcon />
                                        </IconAction>
                                        {isRunning ? (
                                            <>
                                                <IconAction
                                                    title="Restart"
                                                    onClick={() => handleAction(project, 'restart')}
                                                    disabled={isLoading}
                                                >
                                                    <RestartIcon />
                                                </IconAction>
                                                <IconAction
                                                    title="Stop"
                                                    onClick={() => handleAction(project, 'down')}
                                                    disabled={isLoading}
                                                    color="#EF4444"
                                                >
                                                    <StopIcon />
                                                </IconAction>
                                            </>
                                        ) : (
                                            <IconAction
                                                title="Start"
                                                onClick={() => handleAction(project, 'up')}
                                                disabled={isLoading}
                                                color="#10B981"
                                            >
                                                <PlayIcon />
                                            </IconAction>
                                        )}
                                        <IconAction
                                            title="Pull Images"
                                            onClick={() => handleAction(project, 'pull')}
                                            disabled={isLoading}
                                        >
                                            <DownloadIcon />
                                        </IconAction>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}

            {logsProject && (
                <ComposeLogsModal
                    project={logsProject}
                    onClose={() => setLogsProject(null)}
                />
            )}
        </div>
    );
};

// Download Icon for Compose Pull
const DownloadIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
);

// Compose Logs Modal
const ComposeLogsModal = ({ project, onClose }) => {
    const { serverId, isRemote } = useServer();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);
    const [selectedService, setSelectedService] = useState('');
    const [services, setServices] = useState([]);

    const projectName = project.Name || project.name;
    const projectPath = project.ConfigFiles || project.config_files || '';

    useEffect(() => {
        loadServices();
        loadLogs();
    }, [project, tail, selectedService]);

    async function loadServices() {
        try {
            let containers;
            if (isRemote) {
                containers = await api.getRemoteComposePs(serverId, projectPath);
            } else {
                const result = await api.composePs(projectPath);
                containers = result.containers || result || [];
            }

            // Extract unique service names
            const serviceNames = [...new Set(
                (Array.isArray(containers) ? containers : [])
                    .map(c => c.Service || c.service)
                    .filter(Boolean)
            )];
            setServices(serviceNames);
        } catch (err) {
            console.error('Failed to load services:', err);
        }
    }

    async function loadLogs() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = await api.remoteComposeLogs(serverId, projectPath, selectedService || null, tail);
            } else {
                data = await api.composeLogs(projectPath, selectedService || null, tail);
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Logs: {projectName}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <div className="logs-controls" style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label>Service:</label>
                        <select
                            value={selectedService}
                            onChange={(e) => setSelectedService(e.target.value)}
                            style={{ padding: '4px 8px' }}
                        >
                            <option value="">All Services</option>
                            {services.map(service => (
                                <option key={service} value={service}>{service}</option>
                            ))}
                        </select>
                        <label>Lines:</label>
                        <select value={tail} onChange={(e) => setTail(Number(e.target.value))} style={{ padding: '4px 8px' }}>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000</option>
                        </select>
                    </div>
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={loadLogs} disabled={loading}>
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

// Modals
const RunContainerModal = ({ onClose, onCreated }) => {
    const [formData, setFormData] = useState({
        image: '',
        name: '',
        ports: '',
        volumes: '',
        env: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    function handleChange(e) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const data = {
                image: formData.image,
                name: formData.name || undefined,
                ports: formData.ports ? formData.ports.split(',').map(p => p.trim()) : [],
                volumes: formData.volumes ? formData.volumes.split(',').map(v => v.trim()) : [],
                env: formData.env ? Object.fromEntries(
                    formData.env.split('\n').filter(l => l.includes('=')).map(l => {
                        const [key, ...rest] = l.split('=');
                        return [key.trim(), rest.join('=').trim()];
                    })
                ) : {},
            };

            await api.runContainer(data);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to run container');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Run Container</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Image *</label>
                        <input
                            type="text"
                            name="image"
                            value={formData.image}
                            onChange={handleChange}
                            placeholder="nginx:latest"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Container Name</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="my-container"
                        />
                    </div>

                    <div className="form-group">
                        <label>Ports (comma-separated)</label>
                        <input
                            type="text"
                            name="ports"
                            value={formData.ports}
                            onChange={handleChange}
                            placeholder="8080:80, 443:443"
                        />
                    </div>

                    <div className="form-group">
                        <label>Volumes (comma-separated)</label>
                        <input
                            type="text"
                            name="volumes"
                            value={formData.volumes}
                            onChange={handleChange}
                            placeholder="/host/path:/container/path"
                        />
                    </div>

                    <div className="form-group">
                        <label>Environment Variables (one per line, KEY=value)</label>
                        <textarea
                            name="env"
                            value={formData.env}
                            onChange={handleChange}
                            placeholder="NODE_ENV=production&#10;API_KEY=xxx"
                            rows={4}
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Running...' : 'Run Container'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ContainerLogsModal = ({ container, onClose }) => {
    const { serverId, isRemote } = useServer();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);

    useEffect(() => {
        loadLogs();
    }, [container, tail]);

    async function loadLogs() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainerLogs(serverId, container.id, tail);
                data = result.success ? { logs: result.data?.logs || '' } : { logs: '' };
            } else {
                data = await api.getContainerLogs(container.id, tail);
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Logs: {container.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    <div className="logs-controls" style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <label>Lines:</label>
                        <select value={tail} onChange={(e) => setTail(Number(e.target.value))} style={{ padding: '4px 8px' }}>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000</option>
                        </select>
                    </div>
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={loadLogs} disabled={loading}>
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const ContainerExecModal = ({ container, onClose }) => {
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState([]);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const outputRef = React.useRef(null);
    const inputRef = React.useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    async function executeCommand(e) {
        e.preventDefault();
        if (!command.trim() || loading) return;

        const cmd = command.trim();
        setOutput(prev => [...prev, { type: 'command', text: `$ ${cmd}` }]);
        setHistory(prev => [cmd, ...prev.slice(0, 49)]);
        setHistoryIndex(-1);
        setCommand('');
        setLoading(true);

        try {
            const result = await api.execContainer(container.id, cmd);
            if (result.output) {
                setOutput(prev => [...prev, { type: 'output', text: result.output }]);
            }
            if (result.error) {
                setOutput(prev => [...prev, { type: 'error', text: result.error }]);
            }
            if (result.exit_code !== 0) {
                setOutput(prev => [...prev, { type: 'info', text: `Exit code: ${result.exit_code}` }]);
            }
        } catch (err) {
            setOutput(prev => [...prev, { type: 'error', text: err.message || 'Failed to execute command' }]);
        } finally {
            setLoading(false);
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (history.length > 0 && historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            } else if (historyIndex === 0) {
                setHistoryIndex(-1);
                setCommand('');
            }
        }
    }

    function clearOutput() {
        setOutput([]);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Exec: {container.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body exec-modal-body">
                    <div className="exec-output" ref={outputRef}>
                        {output.length === 0 ? (
                            <div className="exec-welcome">
                                <p>Execute commands in container <code>{container.name}</code></p>
                                <p className="text-muted">Type a command and press Enter</p>
                            </div>
                        ) : (
                            output.map((line, idx) => (
                                <div key={idx} className={`exec-line exec-${line.type}`}>
                                    <pre>{line.text}</pre>
                                </div>
                            ))
                        )}
                        {loading && (
                            <div className="exec-line exec-loading">
                                <span className="spinner-inline"></span> Running...
                            </div>
                        )}
                    </div>
                    <form onSubmit={executeCommand} className="exec-input-form">
                        <span className="exec-prompt">$</span>
                        <input
                            ref={inputRef}
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter command..."
                            className="exec-input"
                            disabled={loading}
                            autoComplete="off"
                            spellCheck="false"
                        />
                        <button type="submit" className="btn btn-primary btn-sm" disabled={loading || !command.trim()}>
                            Run
                        </button>
                    </form>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={clearOutput}>Clear</button>
                    <button className="btn btn-primary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const PullImageModal = ({ onClose, onPulled }) => {
    const [image, setImage] = useState('');
    const [tag, setTag] = useState('latest');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.pullImage(image, tag);
            onPulled();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to pull image');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Pull Image</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Image Name *</label>
                        <input
                            type="text"
                            value={image}
                            onChange={(e) => setImage(e.target.value)}
                            placeholder="nginx, mysql, redis"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Tag</label>
                        <input
                            type="text"
                            value={tag}
                            onChange={(e) => setTag(e.target.value)}
                            placeholder="latest"
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Pulling...' : 'Pull Image'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateNetworkModal = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [driver, setDriver] = useState('bridge');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createNetwork(name, driver);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create network');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Network</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Network Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-network"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Driver</label>
                        <select value={driver} onChange={(e) => setDriver(e.target.value)}>
                            <option value="bridge">bridge</option>
                            <option value="overlay">overlay</option>
                            <option value="macvlan">macvlan</option>
                        </select>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Network'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateVolumeModal = ({ onClose, onCreated }) => {
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createVolume(name);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create volume');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Volume</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Volume Name *</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="my-volume"
                            required
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Volume'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Docker;
