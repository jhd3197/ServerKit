import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Server, Database, Globe } from 'lucide-react';

const iconMap = {
    docker: Server,
    database: Database,
    domain: Globe,
    default: Box
};

const colorMap = {
    docker: '#2496ed',
    database: '#f59e0b',
    domain: '#10b981',
    default: '#6366f1'
};

const BaseNode = ({ data, selected }) => {
    const Icon = iconMap[data.nodeType] || iconMap.default;
    const color = colorMap[data.nodeType] || colorMap.default;

    return (
        <div className={`workflow-node ${selected ? 'selected' : ''}`}>
            <Handle
                type="target"
                position={Position.Left}
                className="workflow-handle workflow-handle-target"
            />

            <div className="workflow-node-header" style={{ borderColor: color }}>
                <div className="workflow-node-icon" style={{ backgroundColor: color }}>
                    <Icon size={16} />
                </div>
                <span className="workflow-node-type">
                    {data.nodeType || 'Node'}
                </span>
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label">
                    {data.label || 'Untitled'}
                </div>
                {data.status && (
                    <div className={`workflow-node-status status-${data.status}`}>
                        {data.status}
                    </div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                className="workflow-handle workflow-handle-source"
            />
        </div>
    );
};

export default memo(BaseNode);
