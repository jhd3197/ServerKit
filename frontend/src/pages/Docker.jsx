import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Docker = () => {
    const [activeTab, setActiveTab] = useState('containers');
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        containers: { total: 0, running: 0, stopped: 0 },
        images: { total: 0, size: '0 B' },
        volumes: { total: 0 },
        networks: { total: 0 }
    });

    useEffect(() => {
        checkDockerStatus();
    }, []);

    async function checkDockerStatus() {
        try {
            const status = await api.getDockerStatus();
            setDockerStatus(status);
            if (status.installed) {
                loadStats();
            }
        } catch (err) {
            setDockerStatus({ installed: false, error: err.message });
        } finally {
            setLoading(false);
        }
    }

    async function loadStats() {
        try {
            const [containersData, imagesData, volumesData, networksData, diskUsage] = await Promise.all([
                api.getContainers(true),
                api.getImages(),
                api.getVolumes(),
                api.getNetworks(),
                api.getDockerDiskUsage().catch(() => null)
            ]);

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
                    size: diskUsage?.usage?.Images?.Size || formatTotalImageSize(images)
                },
                volumes: { total: volumes.length },
                networks: { total: networks.length }
            });
        } catch (err) {
            console.error('Failed to load stats:', err);
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
        { id: 'images', label: 'Images' },
        { id: 'volumes', label: 'Volumes' },
        { id: 'networks', label: 'Networks' }
    ];

    return (
        <div className="docker-page-new">
            <div className="docker-page-header">
                <div className="docker-page-title">
                    <h2>Docker Management</h2>
                    <div className="docker-page-subtitle">Manage Containers, Images, and Networks</div>
                </div>
                <div className="docker-page-actions">
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
                    {activeTab === 'images' && <ImagesTab onStatsChange={loadStats} />}
                    {activeTab === 'networks' && <NetworksTab onStatsChange={loadStats} />}
                    {activeTab === 'volumes' && <VolumesTab onStatsChange={loadStats} />}
                </div>
            </div>
        </div>
    );
};

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
    const [containers, setContainers] = useState([]);
    const [containerStats, setContainerStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(true);
    const [selectedContainer, setSelectedContainer] = useState(null);
    const [execContainer, setExecContainer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadContainers();
    }, [showAll]);

    async function loadContainers() {
        setLoading(true);
        try {
            const data = await api.getContainers(showAll);
            const containerList = data.containers || [];
            setContainers(containerList);

            // Load stats for running containers
            const runningContainers = containerList.filter(c => c.state === 'running');
            const statsPromises = runningContainers.map(async (c) => {
                try {
                    const statsData = await api.getContainerStats(c.id);
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
                await api.startContainer(containerId);
                toast.success('Container started');
            } else if (action === 'stop') {
                await api.stopContainer(containerId);
                toast.success('Container stopped');
            } else if (action === 'restart') {
                await api.restartContainer(containerId);
                toast.success('Container restarted');
            } else if (action === 'remove') {
                if (!confirm('Remove this container?')) return;
                await api.removeContainer(containerId, true);
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
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        loadImages();
    }, []);

    async function loadImages() {
        setLoading(true);
        try {
            const data = await api.getImages();
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
            await api.removeImage(imageId, true);
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
    const [networks, setNetworks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadNetworks();
    }, []);

    async function loadNetworks() {
        setLoading(true);
        try {
            const data = await api.getNetworks();
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
    const [volumes, setVolumes] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadVolumes();
    }, []);

    async function loadVolumes() {
        setLoading(true);
        try {
            const data = await api.getVolumes();
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
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadLogs();
    }, [container]);

    async function loadLogs() {
        try {
            const data = await api.getContainerLogs(container.id, 200);
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs');
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
                    <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
                </div>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={loadLogs}>Refresh</button>
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
