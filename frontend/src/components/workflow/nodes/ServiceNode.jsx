import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Zap, MemoryStick, MessageSquare, Layers } from 'lucide-react';

const serviceTypeConfig = {
    redis: { icon: Zap, color: '#dc382d', label: 'Redis' },
    memcached: { icon: MemoryStick, color: '#00a65a', label: 'Memcached' },
    rabbitmq: { icon: MessageSquare, color: '#ff6600', label: 'RabbitMQ' },
    queue: { icon: Layers, color: '#8b5cf6', label: 'Queue' },
    default: { icon: Box, color: '#6366f1', label: 'Service' }
};

const ServiceNode = ({ data, selected }) => {
    const statusClass = data.status || 'stopped';
    const serviceType = data.serviceType || 'default';
    const config = serviceTypeConfig[serviceType] || serviceTypeConfig.default;
    const ServiceIcon = config.icon;

    return (
        <div className={`workflow-node workflow-node-service ${selected ? 'selected' : ''}`}>
            <Handle
                type="target"
                position={Position.Left}
                id="input"
                className="workflow-handle workflow-handle-target"
            />

            <div
                className="workflow-node-header node-header-service"
                style={{ borderColor: config.color }}
            >
                <div
                    className="workflow-node-icon node-icon-service"
                    style={{ backgroundColor: config.color }}
                >
                    <ServiceIcon size={16} />
                </div>
                <span className="workflow-node-type">{config.label}</span>
                <div className={`node-status-dot status-${statusClass}`} />
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label">{data.name || 'Untitled Service'}</div>

                {data.description && (
                    <div className="node-description">{data.description}</div>
                )}

                {data.port && (
                    <div className="node-detail node-detail-port">
                        <span className="node-detail-label">Port</span>
                        <span className="node-detail-value">{data.port}</span>
                    </div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="workflow-handle workflow-handle-source"
            />
        </div>
    );
};

export default memo(ServiceNode);
