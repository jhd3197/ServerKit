import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Server, HardDrive } from 'lucide-react';

const DockerAppNode = ({ data, selected }) => {
    const statusClass = data.status || 'stopped';

    return (
        <div className={`workflow-node workflow-node-docker ${selected ? 'selected' : ''}`}>
            <Handle
                type="target"
                position={Position.Left}
                id="input"
                className="workflow-handle workflow-handle-target"
            />

            <div className="workflow-node-header node-header-docker">
                <div className="workflow-node-icon node-icon-docker">
                    <Server size={16} />
                </div>
                <span className="workflow-node-type">Docker App</span>
                <div className={`node-status-dot status-${statusClass}`} />
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label">{data.name || 'Untitled App'}</div>

                {data.image && (
                    <div className="node-detail node-detail-image">
                        <span className="node-detail-label">Image</span>
                        <span className="node-detail-value">{data.image}</span>
                    </div>
                )}

                {data.ports && data.ports.length > 0 && (
                    <div className="node-ports">
                        {data.ports.map((port, idx) => (
                            <span key={idx} className="node-port-pill">{port}</span>
                        ))}
                    </div>
                )}

                {data.memory && (
                    <div className="node-detail node-detail-memory">
                        <HardDrive size={12} />
                        <span>{data.memory}</span>
                    </div>
                )}
            </div>

            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="workflow-handle workflow-handle-source"
            />

            <Handle
                type="source"
                position={Position.Bottom}
                id="database"
                className="workflow-handle workflow-handle-database"
            />
        </div>
    );
};

export default memo(DockerAppNode);
