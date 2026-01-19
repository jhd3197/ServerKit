import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, HardDrive } from 'lucide-react';

const dbTypeColors = {
    mysql: '#00758f',
    postgresql: '#336791',
    mongodb: '#4db33d',
    redis: '#dc382d',
    default: '#f59e0b'
};

const dbTypeLabels = {
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    mongodb: 'MongoDB',
    redis: 'Redis'
};

const DatabaseNode = ({ data, selected }) => {
    const statusClass = data.status || 'stopped';
    const dbType = data.type || 'default';
    const typeColor = dbTypeColors[dbType] || dbTypeColors.default;
    const typeLabel = dbTypeLabels[dbType] || dbType.toUpperCase();

    return (
        <div className={`workflow-node workflow-node-database ${selected ? 'selected' : ''}`}>
            <Handle
                type="target"
                position={Position.Left}
                id="input"
                className="workflow-handle workflow-handle-target"
            />

            <div className="workflow-node-header node-header-database">
                <div className="workflow-node-icon node-icon-database">
                    <Database size={16} />
                </div>
                <span className="workflow-node-type">Database</span>
                <div className={`node-status-dot status-${statusClass}`} />
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label">{data.name || 'Untitled Database'}</div>

                <div className="node-type-badge" style={{ backgroundColor: typeColor }}>
                    {typeLabel}
                </div>

                {(data.host || data.port) && (
                    <div className="node-detail node-detail-connection">
                        <span className="node-detail-label">Connection</span>
                        <span className="node-detail-value">
                            {data.host || 'localhost'}:{data.port || '3306'}
                        </span>
                    </div>
                )}

                {data.size && (
                    <div className="node-detail node-detail-size">
                        <HardDrive size={12} />
                        <span>{data.size}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default memo(DatabaseNode);
