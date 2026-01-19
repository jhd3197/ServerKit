import React, { useState } from 'react';
import { Server, Plus, Trash2 } from 'lucide-react';
import ConfigPanel from '../ConfigPanel';

const DockerAppConfigPanel = ({ node, onChange, onClose }) => {
    const data = node?.data || {};

    const [ports, setPorts] = useState(data.ports || []);

    const handleChange = (field, value) => {
        onChange({ ...data, [field]: value });
    };

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
                                <Trash2 size={14} />
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleAddPort}
                    >
                        <Plus size={14} />
                        Add Port
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
