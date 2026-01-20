import React, { useState } from 'react';
import { Server, Globe, Link, ExternalLink, Play, Square, RotateCw } from 'lucide-react';
import ConfigPanel from '../ConfigPanel';
import api from '../../../services/api';

const DockerAppConfigPanel = ({ node, onChange, onClose }) => {
    const data = node?.data || {};
    const isReal = data.isReal || data.appId;

    const [isActioning, setIsActioning] = useState(false);
    const [actionMessage, setActionMessage] = useState(null);

    const handleChange = (field, value) => {
        onChange({ ...data, [field]: value });
    };

    // Actions for real apps
    const handleAction = async (action) => {
        if (!data.appId) return;

        setIsActioning(true);
        setActionMessage(null);

        try {
            let result;
            switch (action) {
                case 'start':
                    result = await api.startApp(data.appId);
                    handleChange('status', 'running');
                    break;
                case 'stop':
                    result = await api.stopApp(data.appId);
                    handleChange('status', 'stopped');
                    break;
                case 'restart':
                    result = await api.restartApp(data.appId);
                    handleChange('status', 'running');
                    break;
                default:
                    return;
            }
            setActionMessage(`${action} successful`);
        } catch (error) {
            setActionMessage(`Failed to ${action}`);
        } finally {
            setIsActioning(false);
            setTimeout(() => setActionMessage(null), 3000);
        }
    };

    const openPrivateUrl = () => {
        if (data.privateUrl) {
            window.open(data.privateUrl, '_blank');
        }
    };

    const openAppDetails = () => {
        if (data.appId) {
            window.location.href = `/applications/${data.appId}`;
        }
    };

    // Real app panel - shows info and actions
    if (isReal) {
        return (
            <ConfigPanel
                isOpen={!!node}
                title="Application"
                icon={Server}
                headerColor="#2496ed"
                onClose={onClose}
            >
                <div className="form-group">
                    <label>Name</label>
                    <div className="form-value">{data.name || 'Unknown'}</div>
                </div>

                <div className="form-group">
                    <label>Status</label>
                    <div className={`form-value status-badge status-${data.status}`}>
                        {data.status || 'unknown'}
                    </div>
                </div>

                {data.template && (
                    <div className="form-group">
                        <label>Template</label>
                        <div className="form-value">{data.template}</div>
                    </div>
                )}

                {data.port && (
                    <div className="form-group">
                        <label>Port</label>
                        <div className="form-value">{data.port}</div>
                    </div>
                )}

                {data.privateUrl && (
                    <div className="form-group">
                        <label>Private URL</label>
                        <div className="form-value form-value-link" onClick={openPrivateUrl}>
                            <Link size={14} />
                            {data.privateUrl}
                            <ExternalLink size={12} />
                        </div>
                    </div>
                )}

                {data.domains && data.domains.length > 0 && (
                    <div className="form-group">
                        <label>Connected Domains</label>
                        <div className="form-domains">
                            {data.domains.map((domain, idx) => (
                                <div key={idx} className="form-domain-item">
                                    <Globe size={14} />
                                    <span>{domain.name || domain}</span>
                                    {domain.ssl_enabled && (
                                        <span className="ssl-badge">SSL</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="form-group">
                    <label>Actions</label>
                    <div className="action-buttons">
                        <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleAction('start')}
                            disabled={isActioning || data.status === 'running'}
                        >
                            <Play size={14} />
                            Start
                        </button>
                        <button
                            className="btn btn-sm btn-warning"
                            onClick={() => handleAction('stop')}
                            disabled={isActioning || data.status === 'stopped'}
                        >
                            <Square size={14} />
                            Stop
                        </button>
                        <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleAction('restart')}
                            disabled={isActioning}
                        >
                            <RotateCw size={14} />
                            Restart
                        </button>
                    </div>
                    {actionMessage && (
                        <div className="action-message">{actionMessage}</div>
                    )}
                </div>

                <div className="form-group">
                    <button
                        className="btn btn-primary btn-block"
                        onClick={openAppDetails}
                    >
                        <ExternalLink size={14} />
                        Open App Details
                    </button>
                </div>
            </ConfigPanel>
        );
    }

    // Legacy panel for non-real apps (manual creation)
    const [ports, setPorts] = useState(data.ports || []);

    const handleAddPort = () => {
        const newPorts = [...ports, ''];
        setPorts(newPorts);
        handleChange('ports', newPorts);
    };

    const handlePortChange = (index, value) => {
        const newPorts = [...ports];
        newPorts[index] = value;
        setPorts(newPorts);
        handleChange('ports', newPorts);
    };

    const handleRemovePort = (index) => {
        const newPorts = ports.filter((_, i) => i !== index);
        setPorts(newPorts);
        handleChange('ports', newPorts);
    };

    return (
        <ConfigPanel
            isOpen={!!node}
            title="Docker App"
            icon={Server}
            headerColor="#2496ed"
            onClose={onClose}
        >
            <div className="form-group">
                <label>Name</label>
                <input
                    type="text"
                    value={data.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="my-app"
                />
            </div>

            <div className="form-group">
                <label>Image</label>
                <input
                    type="text"
                    value={data.image || ''}
                    onChange={(e) => handleChange('image', e.target.value)}
                    placeholder="nginx:latest"
                />
                <span className="form-hint">Docker image name and tag</span>
            </div>

            <div className="form-group">
                <label>Status</label>
                <select
                    value={data.status || 'stopped'}
                    onChange={(e) => handleChange('status', e.target.value)}
                >
                    <option value="stopped">Stopped</option>
                    <option value="running">Running</option>
                    <option value="error">Error</option>
                </select>
            </div>

            <div className="form-group">
                <label>Port Mappings</label>
                <div className="port-list">
                    {ports.map((port, index) => (
                        <div key={index} className="port-item">
                            <input
                                type="text"
                                value={port}
                                onChange={(e) => handlePortChange(index, e.target.value)}
                                placeholder="8080:80"
                            />
                            <button
                                type="button"
                                className="btn btn-icon btn-danger-ghost"
                                onClick={() => handleRemovePort(index)}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleAddPort}
                    >
                        + Add Port
                    </button>
                </div>
                <span className="form-hint">Format: host_port:container_port</span>
            </div>

            <div className="form-group">
                <label>Memory Limit</label>
                <input
                    type="text"
                    value={data.memory || ''}
                    onChange={(e) => handleChange('memory', e.target.value)}
                    placeholder="512MB"
                />
                <span className="form-hint">e.g., 256MB, 1GB</span>
            </div>
        </ConfigPanel>
    );
};

export default DockerAppConfigPanel;
