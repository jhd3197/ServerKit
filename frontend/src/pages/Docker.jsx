import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Docker = () => {
    const [activeTab, setActiveTab] = useState('containers');
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkDockerStatus();
    }, []);

    async function checkDockerStatus() {
        try {
            const status = await api.getDockerStatus();
            setDockerStatus(status);
        } catch (err) {
            setDockerStatus({ installed: false, error: err.message });
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="loading">Checking Docker status...</div>;
    }

    if (!dockerStatus?.installed) {
        return (
            <div>
                <header className="top-bar">
                    <div>
                        <h1>Docker</h1>
                        <div className="subtitle">Container management</div>
                    </div>
                </header>
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    </svg>
                    <h3>Docker not available</h3>
                    <p>{dockerStatus?.error || 'Docker is not installed or running on this server.'}</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            <header className="top-bar">
                <div>
                    <h1>Docker</h1>
                    <div className="subtitle">Container management</div>
                </div>
            </header>

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'containers' ? 'active' : ''}`}
                    onClick={() => setActiveTab('containers')}
                >
                    Containers
                </button>
                <button
                    className={`tab ${activeTab === 'images' ? 'active' : ''}`}
                    onClick={() => setActiveTab('images')}
                >
                    Images
                </button>
                <button
                    className={`tab ${activeTab === 'networks' ? 'active' : ''}`}
                    onClick={() => setActiveTab('networks')}
                >
                    Networks
                </button>
                <button
                    className={`tab ${activeTab === 'volumes' ? 'active' : ''}`}
                    onClick={() => setActiveTab('volumes')}
                >
                    Volumes
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'containers' && <ContainersTab />}
                {activeTab === 'images' && <ImagesTab />}
                {activeTab === 'networks' && <NetworksTab />}
                {activeTab === 'volumes' && <VolumesTab />}
            </div>
        </div>
    );
};

const ContainersTab = () => {
    const [containers, setContainers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(true);
    const [showRunModal, setShowRunModal] = useState(false);
    const [selectedContainer, setSelectedContainer] = useState(null);

    useEffect(() => {
        loadContainers();
    }, [showAll]);

    async function loadContainers() {
        setLoading(true);
        try {
            const data = await api.getContainers(showAll);
            setContainers(data.containers || []);
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
            } else if (action === 'stop') {
                await api.stopContainer(containerId);
            } else if (action === 'restart') {
                await api.restartContainer(containerId);
            } else if (action === 'remove') {
                if (!confirm('Remove this container?')) return;
                await api.removeContainer(containerId, true);
            }
            loadContainers();
        } catch (err) {
            console.error(`Failed to ${action} container:`, err);
        }
    }

    function getStateColor(state) {
        switch (state) {
            case 'running': return 'status-active';
            case 'exited': return 'status-stopped';
            case 'paused': return 'status-warning';
            default: return 'status-stopped';
        }
    }

    if (loading) {
        return <div className="loading">Loading containers...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <div className="filter-toggle">
                    <label>
                        <input
                            type="checkbox"
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                        />
                        Show stopped containers
                    </label>
                </div>
                <button className="btn btn-primary" onClick={() => setShowRunModal(true)}>
                    Run Container
                </button>
            </div>

            {containers.length === 0 ? (
                <div className="empty-state">
                    <h3>No containers</h3>
                    <p>Run your first container to get started.</p>
                </div>
            ) : (
                <div className="docker-list">
                    {containers.map(container => (
                        <div key={container.id} className="docker-item">
                            <div className="docker-item-info">
                                <div className="docker-item-icon">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    </svg>
                                </div>
                                <div className="docker-item-details">
                                    <h3>{container.name}</h3>
                                    <div className="docker-item-meta">
                                        <span className="mono">{container.id.substring(0, 12)}</span>
                                        <span>{container.image}</span>
                                        {container.ports && <span>{container.ports}</span>}
                                    </div>
                                </div>
                            </div>
                            <div className="docker-item-status">
                                <span className={`status-badge ${getStateColor(container.state)}`}>
                                    <span className="status-dot"/>
                                    {container.state}
                                </span>
                            </div>
                            <div className="docker-item-actions">
                                {container.state === 'running' ? (
                                    <>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setSelectedContainer(container)}
                                        >
                                            Logs
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleAction(container.id, 'restart')}
                                        >
                                            Restart
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleAction(container.id, 'stop')}
                                        >
                                            Stop
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={() => handleAction(container.id, 'start')}
                                        >
                                            Start
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleAction(container.id, 'remove')}
                                        >
                                            Remove
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showRunModal && (
                <RunContainerModal
                    onClose={() => setShowRunModal(false)}
                    onCreated={loadContainers}
                />
            )}

            {selectedContainer && (
                <ContainerLogsModal
                    container={selectedContainer}
                    onClose={() => setSelectedContainer(null)}
                />
            )}
        </div>
    );
};

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

const ImagesTab = () => {
    const toast = useToast();
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showPullModal, setShowPullModal] = useState(false);

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
        } catch (err) {
            console.error('Failed to remove image:', err);
            toast.error('Failed to remove image. It may be in use by a container.');
        }
    }

    if (loading) {
        return <div className="loading">Loading images...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Docker Images</h3>
                <button className="btn btn-primary" onClick={() => setShowPullModal(true)}>
                    Pull Image
                </button>
            </div>

            {images.length === 0 ? (
                <div className="empty-state">
                    <h3>No images</h3>
                    <p>Pull your first image to get started.</p>
                </div>
            ) : (
                <div className="docker-list">
                    {images.map(image => (
                        <div key={image.id} className="docker-item">
                            <div className="docker-item-info">
                                <div className="docker-item-icon image-icon">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                        <circle cx="8.5" cy="8.5" r="1.5"/>
                                        <path d="M21 15l-5-5L5 21"/>
                                    </svg>
                                </div>
                                <div className="docker-item-details">
                                    <h3>{image.repository}:{image.tag}</h3>
                                    <div className="docker-item-meta">
                                        <span className="mono">{image.id.substring(0, 12)}</span>
                                        <span>{image.size}</span>
                                        <span>{image.created}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="docker-item-actions">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRemove(image.id)}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showPullModal && (
                <PullImageModal
                    onClose={() => setShowPullModal(false)}
                    onPulled={loadImages}
                />
            )}
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

const NetworksTab = () => {
    const toast = useToast();
    const [networks, setNetworks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);

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
        } catch (err) {
            console.error('Failed to remove network:', err);
            toast.error('Failed to remove network. It may be in use.');
        }
    }

    if (loading) {
        return <div className="loading">Loading networks...</div>;
    }

    const systemNetworks = ['bridge', 'host', 'none'];

    return (
        <div>
            <div className="section-header">
                <h3>Docker Networks</h3>
                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                    Create Network
                </button>
            </div>

            <div className="docker-list">
                {networks.map(network => (
                    <div key={network.id} className="docker-item">
                        <div className="docker-item-info">
                            <div className="docker-item-icon network-icon">
                                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                    <path d="M2 17l10 5 10-5"/>
                                    <path d="M2 12l10 5 10-5"/>
                                </svg>
                            </div>
                            <div className="docker-item-details">
                                <h3>{network.name}</h3>
                                <div className="docker-item-meta">
                                    <span className="mono">{network.id.substring(0, 12)}</span>
                                    <span>Driver: {network.driver}</span>
                                    <span>Scope: {network.scope}</span>
                                </div>
                            </div>
                        </div>
                        <div className="docker-item-actions">
                            {!systemNetworks.includes(network.name) && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRemove(network.id)}
                                >
                                    Remove
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {showCreateModal && (
                <CreateNetworkModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={loadNetworks}
                />
            )}
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

const VolumesTab = () => {
    const toast = useToast();
    const [volumes, setVolumes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);

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
        } catch (err) {
            console.error('Failed to remove volume:', err);
            toast.error('Failed to remove volume. It may be in use.');
        }
    }

    if (loading) {
        return <div className="loading">Loading volumes...</div>;
    }

    return (
        <div>
            <div className="section-header">
                <h3>Docker Volumes</h3>
                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                    Create Volume
                </button>
            </div>

            {volumes.length === 0 ? (
                <div className="empty-state">
                    <h3>No volumes</h3>
                    <p>Create a volume for persistent data storage.</p>
                </div>
            ) : (
                <div className="docker-list">
                    {volumes.map(volume => (
                        <div key={volume.name} className="docker-item">
                            <div className="docker-item-info">
                                <div className="docker-item-icon volume-icon">
                                    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                                    </svg>
                                </div>
                                <div className="docker-item-details">
                                    <h3>{volume.name}</h3>
                                    <div className="docker-item-meta">
                                        <span>Driver: {volume.driver}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="docker-item-actions">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRemove(volume.name)}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showCreateModal && (
                <CreateVolumeModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={loadVolumes}
                />
            )}
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
