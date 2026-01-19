import React from 'react';
import { Globe } from 'lucide-react';
import ConfigPanel from '../ConfigPanel';

const DomainConfigPanel = ({ node, onChange, onClose }) => {
    const data = node?.data || {};

    const handleChange = (field, value) => {
        const updates = { ...data, [field]: value };

        // Clear expiry date if SSL is not valid
        if (field === 'ssl' && value !== 'valid') {
            updates.sslExpiry = '';
        }

        onChange(updates);
    };

    return (
        <ConfigPanel
            isOpen={!!node}
            title="Domain"
            icon={Globe}
            headerColor="#10b981"
            onClose={onClose}
        >
            <div className="form-group">
                <label>Domain Name</label>
                <input
                    type="text"
                    value={data.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="example.com"
                />
                <span className="form-hint">Enter domain without http:// or https://</span>
            </div>

            <div className="form-group">
                <label>SSL Status</label>
                <select
                    value={data.ssl || 'none'}
                    onChange={(e) => handleChange('ssl', e.target.value)}
                >
                    <option value="none">No SSL</option>
                    <option value="valid">Valid Certificate</option>
                    <option value="expired">Expired Certificate</option>
                </select>
            </div>

            {data.ssl === 'valid' && (
                <div className="form-group">
                    <label>SSL Expiry Date</label>
                    <input
                        type="date"
                        value={data.sslExpiry || ''}
                        onChange={(e) => handleChange('sslExpiry', e.target.value)}
                    />
                    <span className="form-hint">Certificate expiration date</span>
                </div>
            )}

            <div className="form-group">
                <label>DNS Status</label>
                <select
                    value={data.dnsStatus || 'pending'}
                    onChange={(e) => handleChange('dnsStatus', e.target.value)}
                >
                    <option value="pending">Pending Propagation</option>
                    <option value="propagated">Propagated</option>
                </select>
                <span className="form-hint">DNS record propagation status</span>
            </div>
        </ConfigPanel>
    );
};

export default DomainConfigPanel;
