import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Server, Globe, Link, ExternalLink } from 'lucide-react';

const DockerAppNode = ({ data, selected }) => {
    const statusClass = data.status || 'stopped';
    const isReal = data.isReal || data.appId;

    return (
        <div className={`workflow-node workflow-node-docker ${selected ? 'selected' : ''} ${isReal ? 'is-real' : ''}`}>
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
                <span className="workflow-node-type">
                    {data.appType === 'docker' ? 'App' : data.appType || 'App'}
                </span>
                <div className={`node-status-dot status-${statusClass}`} title={statusClass} />
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label">{data.name || 'Untitled App'}</div>

                {data.template && (
                    <div className="node-detail node-detail-template">
                        <span className="node-detail-label">Template</span>
                        <span className="node-detail-value">{data.template}</span>
                    </div>
                )}

                {data.port && (
                    <div className="node-detail node-detail-port">
                        <span className="node-detail-label">Port</span>
                        <span className="node-detail-value node-port-pill">{data.port}</span>
                    </div>
                )}

                {data.privateUrl && (
                    <div className="node-detail node-detail-private-url">
                        <Link size={12} />
                        <span className="node-detail-value">{data.privateUrl}</span>
                    </div>
                )}

                {data.domains && data.domains.length > 0 && (
                    <div className="node-domains">
                        {data.domains.slice(0, 2).map((domain, idx) => (
                            <span key={idx} className="node-domain-pill">
                                <Globe size={10} />
                                {domain.name || domain}
                            </span>
                        ))}
                        {data.domains.length > 2 && (
                            <span className="node-domain-more">+{data.domains.length - 2}</span>
                        )}
                    </div>
                )}

                {/* Legacy support for old image field */}
                {!data.template && data.image && (
                    <div className="node-detail node-detail-image">
                        <span className="node-detail-label">Image</span>
                        <span className="node-detail-value">{data.image}</span>
                    </div>
                )}

                {/* Legacy support for old ports array */}
                {!data.port && data.ports && data.ports.length > 0 && (
                    <div className="node-ports">
                        {data.ports.map((port, idx) => (
                            <span key={idx} className="node-port-pill">{port}</span>
                        ))}
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
