import React from 'react';
import { Box } from 'lucide-react';
import ConfigPanel from '../ConfigPanel';

const serviceTypeConfig = {
    redis: { color: '#dc382d', defaultPort: 6379 },
    memcached: { color: '#00a65a', defaultPort: 11211 },
    rabbitmq: { color: '#ff6600', defaultPort: 5672 },
    queue: { color: '#8b5cf6', defaultPort: 5555 }
};

const ServiceConfigPanel = ({ node, onChange, onClose }) => {
    const data = node?.data || {};
    const serviceType = data.serviceType || 'redis';
    const headerColor = serviceTypeConfig[serviceType]?.color || '#6366f1';

    const handleChange = (field, value) => {
        const updates = { ...data, [field]: value };

        // Auto-update port when service type changes
        if (field === 'serviceType' && serviceTypeConfig[value]) {
            updates.port = serviceTypeConfig[value].defaultPort;
        }

        onChange(updates);
    };

    return (
        <ConfigPanel
            isOpen={!!node}
            title="Service"
            icon={Box}
            headerColor={headerColor}
            onClose={onClose}
        >
            <div className="form-group">
                <label>Name</label>
                <input
                    type="text"
                    value={data.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="my-service"
                />
            </div>

            <div className="form-group">
                <label>Service Type</label>
                <select
                    value={data.serviceType || 'redis'}
                    onChange={(e) => handleChange('serviceType', e.target.value)}
                >
                    <option value="redis">Redis</option>
                    <option value="memcached">Memcached</option>
                    <option value="rabbitmq">RabbitMQ</option>
                    <option value="queue">Queue</option>
                </select>
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
                <label>Port</label>
                <input
                    type="number"
                    value={data.port || serviceTypeConfig[serviceType]?.defaultPort || 6379}
                    onChange={(e) => handleChange('port', parseInt(e.target.value) || '')}
                />
            </div>

            <div className="form-group">
                <label>Description</label>
                <textarea
                    value={data.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Service description..."
                    rows={3}
                />
            </div>
        </ConfigPanel>
    );
};

export default ServiceConfigPanel;
