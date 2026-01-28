import React, { useState, useEffect } from 'react';
import { ArrowDownLeft, Shield } from 'lucide-react';
import wordpressApi from '../../services/wordpress';
import Spinner from '../Spinner';

const SyncModal = ({ environment, productionName, onClose, onSync }) => {
    const [syncType, setSyncType] = useState('database');
    const [config, setConfig] = useState({
        sanitize: false,
        truncate_tables: '',
        exclude_tables: '',
        sanitization_profile_id: ''
    });
    const [loading, setLoading] = useState(false);
    const [profiles, setProfiles] = useState([]);

    useEffect(() => {
        loadProfiles();
    }, []);

    async function loadProfiles() {
        try {
            const data = await wordpressApi.getSanitizationProfiles();
            setProfiles(data.profiles || []);
            // Auto-select default profile
            const defaultProfile = (data.profiles || []).find(p => p.is_default);
            if (defaultProfile) {
                setConfig(prev => ({
                    ...prev,
                    sanitization_profile_id: String(defaultProfile.id),
                    sanitize: true
                }));
            }
        } catch {
            setProfiles([]);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        try {
            await onSync({
                type: syncType,
                sanitize: config.sanitize,
                sanitization_profile_id: config.sanitization_profile_id
                    ? Number(config.sanitization_profile_id) : null,
                truncate_tables: config.truncate_tables
                    ? config.truncate_tables.split(',').map(s => s.trim()).filter(Boolean)
                    : [],
                exclude_tables: config.exclude_tables
                    ? config.exclude_tables.split(',').map(s => s.trim()).filter(Boolean)
                    : []
            });
        } finally {
            setLoading(false);
        }
    }

    function handleConfigChange(key, value) {
        setConfig(prev => ({ ...prev, [key]: value }));
    }

    const envType = environment.environment_type || 'development';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Sync from Production</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="sync-direction">
                        <div className="promote-env-pill production">
                            <span className="promote-env-type">Production</span>
                            <span className="promote-env-name">{productionName}</span>
                        </div>
                        <ArrowDownLeft size={20} className="promote-arrow" />
                        <div className={`promote-env-pill ${envType}`}>
                            <span className="promote-env-type">{envType}</span>
                            <span className="promote-env-name">{environment.name}</span>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Sync Type</label>
                        <div className="radio-group">
                            <label className="radio-label">
                                <input
                                    type="radio"
                                    name="syncType"
                                    value="database"
                                    checked={syncType === 'database'}
                                    onChange={e => setSyncType(e.target.value)}
                                />
                                <div className="radio-content">
                                    <strong>Database Only</strong>
                                    <span>Pull production database into this environment</span>
                                </div>
                            </label>
                            <label className="radio-label">
                                <input
                                    type="radio"
                                    name="syncType"
                                    value="files"
                                    checked={syncType === 'files'}
                                    onChange={e => setSyncType(e.target.value)}
                                />
                                <div className="radio-content">
                                    <strong>Files Only</strong>
                                    <span>Pull production files (wp-content) into this environment</span>
                                </div>
                            </label>
                            <label className="radio-label">
                                <input
                                    type="radio"
                                    name="syncType"
                                    value="full"
                                    checked={syncType === 'full'}
                                    onChange={e => setSyncType(e.target.value)}
                                />
                                <div className="radio-content">
                                    <strong>Full Sync</strong>
                                    <span>Pull both database and files from production</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    {(syncType === 'database' || syncType === 'full') && (
                        <>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={config.sanitize}
                                        onChange={e => handleConfigChange('sanitize', e.target.checked)}
                                    />
                                    <span>Sanitize data (anonymize emails, reset passwords)</span>
                                </label>
                            </div>

                            {config.sanitize && profiles.length > 0 && (
                                <div className="form-group">
                                    <label>
                                        <Shield size={14} style={{ marginRight: 4, verticalAlign: -2 }} />
                                        Sanitization Profile
                                    </label>
                                    <select
                                        value={config.sanitization_profile_id}
                                        onChange={e => handleConfigChange('sanitization_profile_id', e.target.value)}
                                    >
                                        <option value="">Manual configuration</option>
                                        {profiles.map(p => (
                                            <option key={p.id} value={p.id}>
                                                {p.name}{p.is_default ? ' (default)' : ''}{p.is_builtin ? '' : ' (custom)'}
                                            </option>
                                        ))}
                                    </select>
                                    {config.sanitization_profile_id && (
                                        <span className="form-hint">
                                            {profiles.find(p => String(p.id) === config.sanitization_profile_id)?.description || ''}
                                        </span>
                                    )}
                                </div>
                            )}

                            <div className="form-group">
                                <label>Exclude Tables (comma-separated, optional)</label>
                                <input
                                    type="text"
                                    value={config.exclude_tables}
                                    onChange={e => handleConfigChange('exclude_tables', e.target.value)}
                                    placeholder="wp_users, wp_usermeta"
                                />
                                <span className="form-hint">Tables to skip during sync</span>
                            </div>

                            <div className="form-group">
                                <label>Truncate Tables (comma-separated, optional)</label>
                                <input
                                    type="text"
                                    value={config.truncate_tables}
                                    onChange={e => handleConfigChange('truncate_tables', e.target.value)}
                                    placeholder="wp_actionscheduler_actions, wp_actionscheduler_logs"
                                />
                                <span className="form-hint">Tables to empty (structure kept, data removed)</span>
                            </div>
                        </>
                    )}

                    <div className="sync-warning">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4M12 16h.01" />
                        </svg>
                        <div>
                            <strong>This will overwrite data</strong>
                            <p>The current {syncType === 'files' ? 'files' : syncType === 'database' ? 'database' : 'database and files'} in this environment will be replaced with production data. A snapshot will be created before syncing.</p>
                        </div>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? <><Spinner size="sm" /> Syncing...</> : 'Sync Now'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SyncModal;
