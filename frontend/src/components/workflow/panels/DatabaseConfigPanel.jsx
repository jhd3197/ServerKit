import React from 'react';
import { Database } from 'lucide-react';
import ConfigPanel from '../ConfigPanel';

const dbTypeConfig = {
    mysql: { color: '#00758f', defaultPort: 3306 },
    postgresql: { color: '#336791', defaultPort: 5432 },
    mongodb: { color: '#4db33d', defaultPort: 27017 },
    redis: { color: '#dc382d', defaultPort: 6379 }
};

const DatabaseConfigPanel = ({ node, onChange, onClose }) => {
    const data = node?.data || {};
    const dbType = data.type || 'mysql';
    const headerColor = dbTypeConfig[dbType]?.color || '#f59e0b';

    const handleChange = (field, value) => {
        const updates = { ...data, [field]: value };

        // Auto-update port when type changes
        if (field === 'type' && dbTypeConfig[value]) {
            updates.port = dbTypeConfig[value].defaultPort;
        }

        onChange(updates);
    };

    return (
        <ConfigPanel
            isOpen={!!node}
            title="Database"
            icon={Database}
            headerColor={headerColor}
            onClose={onClose}
        >
            <div className="form-group">
                <label>Name</label>
                <input
                    type="text"
                    value={data.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="my-database"
                />
            </div>

            <div className="form-group">
                <label>Type</label>
                <select
                    value={data.type || 'mysql'}
                    onChange={(e) => handleChange('type', e.target.value)}
                >
                    <option value="mysql">MySQL</option>
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mongodb">MongoDB</option>
                    <option value="redis">Redis</option>
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

            <div className="form-row">
                <div className="form-group">
                    <label>Host</label>
                    <input
                        type="text"
                        value={data.host || ''}
                        onChange={(e) => handleChange('host', e.target.value)}
                        placeholder="localhost"
                    />
                </div>

                <div className="form-group">
                    <label>Port</label>
                    <input
                        type="number"
                        value={data.port || dbTypeConfig[dbType]?.defaultPort || 3306}
                        onChange={(e) => handleChange('port', parseInt(e.target.value) || '')}
                    />
                </div>
            </div>

            {data.size && (
                <div className="form-group">
                    <label>Size</label>
                    <input
                        type="text"
                        value={data.size}
                        disabled
                        className="input-readonly"
                    />
                    <span className="form-hint">Database size (read-only)</span>
                </div>
            )}
        </ConfigPanel>
    );
};

export default DatabaseConfigPanel;
