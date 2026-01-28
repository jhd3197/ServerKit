import React, { useState } from 'react';
import { Cpu, HardDrive, AlertTriangle } from 'lucide-react';
import Spinner from '../Spinner';

const PRESETS = {
    low: { memory: '256M', cpus: '0.25', db_memory: '256M', db_cpus: '0.25' },
    standard: { memory: '512M', cpus: '1.0', db_memory: '384M', db_cpus: '0.5' },
    high: { memory: '2G', cpus: '2.0', db_memory: '1G', db_cpus: '1.0' },
};

const MEMORY_OPTIONS = ['256M', '384M', '512M', '768M', '1G', '1.5G', '2G'];
const CPU_OPTIONS = ['0.25', '0.5', '1.0', '1.5', '2.0'];

const ResourceLimitsModal = ({ environment, currentLimits, onClose, onApply }) => {
    const [limits, setLimits] = useState({
        memory: currentLimits?.memory || '512M',
        cpus: currentLimits?.cpus || '1.0',
        db_memory: currentLimits?.db_memory || '384M',
        db_cpus: currentLimits?.db_cpus || '0.5',
    });
    const [loading, setLoading] = useState(false);

    function applyPreset(preset) {
        setLimits({ ...PRESETS[preset] });
    }

    function handleChange(key, value) {
        setLimits(prev => ({ ...prev, [key]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onApply(limits);
        } finally {
            setLoading(false);
        }
    }

    const envName = environment?.name || 'Environment';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal resource-limits-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Cpu size={18} />
                        Resource Limits
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="resource-limits-env-name">{envName}</div>

                    <div className="resource-limits-presets">
                        <span className="resource-limits-presets-label">Presets:</span>
                        {Object.entries(PRESETS).map(([key]) => (
                            <button
                                key={key}
                                type="button"
                                className="btn btn-ghost btn-sm resource-preset-btn"
                                onClick={() => applyPreset(key)}
                            >
                                {key.charAt(0).toUpperCase() + key.slice(1)}
                            </button>
                        ))}
                    </div>

                    <div className="resource-limits-section">
                        <h4>
                            <HardDrive size={14} />
                            WordPress Container
                        </h4>
                        <div className="resource-limits-row">
                            <label>Memory</label>
                            <select
                                value={limits.memory}
                                onChange={e => handleChange('memory', e.target.value)}
                            >
                                {MEMORY_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                        <div className="resource-limits-row">
                            <label>CPU Cores</label>
                            <select
                                value={limits.cpus}
                                onChange={e => handleChange('cpus', e.target.value)}
                            >
                                {CPU_OPTIONS.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="resource-limits-section">
                        <h4>
                            <HardDrive size={14} />
                            Database Container
                        </h4>
                        <div className="resource-limits-row">
                            <label>Memory</label>
                            <select
                                value={limits.db_memory}
                                onChange={e => handleChange('db_memory', e.target.value)}
                            >
                                {MEMORY_OPTIONS.filter((_, i) => i < 5).map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                        <div className="resource-limits-row">
                            <label>CPU Cores</label>
                            <select
                                value={limits.db_cpus}
                                onChange={e => handleChange('db_cpus', e.target.value)}
                            >
                                {CPU_OPTIONS.filter((_, i) => i < 4).map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="resource-limits-warning">
                        <AlertTriangle size={14} />
                        <span>Applying resource limits will restart the environment containers.</span>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? <><Spinner size="sm" /> Applying...</> : 'Apply Limits'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ResourceLimitsModal;
