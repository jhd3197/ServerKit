import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Globe, Shield, ShieldCheck, ShieldX, Radio } from 'lucide-react';

const sslStatusConfig = {
    valid: { icon: ShieldCheck, color: '#10b981', label: 'SSL Valid' },
    expired: { icon: ShieldX, color: '#ef4444', label: 'SSL Expired' },
    none: { icon: Shield, color: '#6b7280', label: 'No SSL' }
};

const DomainNode = ({ data, selected }) => {
    const sslStatus = data.ssl || 'none';
    const sslConfig = sslStatusConfig[sslStatus] || sslStatusConfig.none;
    const SslIcon = sslConfig.icon;
    const dnsStatus = data.dnsStatus || 'pending';

    return (
        <div className={`workflow-node workflow-node-domain ${selected ? 'selected' : ''}`}>
            <div className="workflow-node-header node-header-domain">
                <div className="workflow-node-icon node-icon-domain">
                    <Globe size={16} />
                </div>
                <span className="workflow-node-type">Domain</span>
            </div>

            <div className="workflow-node-body">
                <div className="workflow-node-label node-label-domain">
                    {data.name || 'example.com'}
                </div>

                <div className="node-badges">
                    <div
                        className="node-ssl-badge"
                        style={{ color: sslConfig.color, borderColor: sslConfig.color }}
                    >
                        <SslIcon size={12} />
                        <span>{sslConfig.label}</span>
                    </div>

                    <div className={`node-dns-badge dns-${dnsStatus}`}>
                        <Radio size={12} />
                        <span>{dnsStatus === 'propagated' ? 'DNS OK' : 'DNS Pending'}</span>
                    </div>
                </div>

                {data.sslExpiry && sslStatus === 'valid' && (
                    <div className="node-detail node-detail-expiry">
                        <span className="node-detail-label">Expires</span>
                        <span className="node-detail-value">{data.sslExpiry}</span>
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

export default memo(DomainNode);
