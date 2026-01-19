import React, { useState, useEffect } from 'react';
import { X, Link2, GitBranch, AlertCircle, Check } from 'lucide-react';
import api from '../services/api';

const LinkAppModal = ({ app, onClose, onLinked }) => {
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [linking, setLinking] = useState(false);
    const [error, setError] = useState('');

    const [selectedAppId, setSelectedAppId] = useState('');
    const [asEnvironment, setAsEnvironment] = useState('development');
    const [tablePrefix, setTablePrefix] = useState('');
    const [propagateCredentials, setPropagateCredentials] = useState(true);

    useEffect(() => {
        loadCompatibleApps();
    }, [app]);

    async function loadCompatibleApps() {
        try {
            const data = await api.getApps();
            // Filter to same type, not already linked, not self
            const compatible = (data.apps || []).filter(a =>
                a.id !== app.id &&
                a.app_type === app.app_type &&
                !a.has_linked_app &&
                a.environment_type === 'standalone'
            );
            setApps(compatible);
        } catch (err) {
            setError('Failed to load applications');
        } finally {
            setLoading(false);
        }
    }

    async function handleLink(e) {
        e.preventDefault();
        if (!selectedAppId) {
            setError('Please select an application to link');
            return;
        }

        setLinking(true);
        setError('');

        try {
            await api.linkApp(app.id, parseInt(selectedAppId), asEnvironment, {
                propagateCredentials,
                tablePrefix: tablePrefix || undefined
            });
            onLinked();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to link applications');
        } finally {
            setLinking(false);
        }
    }

    const selectedApp = apps.find(a => a.id === parseInt(selectedAppId));

    const envDescriptions = {
        development: 'This app will be the DEVELOPMENT environment',
        production: 'This app will be the PRODUCTION environment',
        staging: 'This app will be the STAGING environment'
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal link-app-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Link2 size={20} />
                        Link Application
                    </h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {error && (
                    <div className="error-message">
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className="modal-loading">Loading compatible apps...</div>
                ) : apps.length === 0 ? (
                    <div className="link-app-empty">
                        <GitBranch size={32} />
                        <h3>No Compatible Apps</h3>
                        <p>
                            There are no other {app.app_type} applications available to link.
                            Create another {app.app_type} app first, or ensure existing apps
                            are not already linked.
                        </p>
                        <button className="btn btn-secondary" onClick={onClose}>
                            Close
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleLink}>
                        <div className="link-app-current">
                            <span className="link-app-label">Current app:</span>
                            <span className="link-app-name">{app.name}</span>
                            <span className="app-type-badge">{app.app_type.toUpperCase()}</span>
                        </div>

                        <div className="form-group">
                            <label>Link to Application</label>
                            <select
                                value={selectedAppId}
                                onChange={(e) => setSelectedAppId(e.target.value)}
                                required
                            >
                                <option value="">Select an application...</option>
                                {apps.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.name} (Port: {a.port || 'N/A'})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <label>This app will be</label>
                            <div className="env-radio-group">
                                {['development', 'production', 'staging'].map(env => (
                                    <label key={env} className={`env-radio-option ${asEnvironment === env ? 'selected' : ''}`}>
                                        <input
                                            type="radio"
                                            name="environment"
                                            value={env}
                                            checked={asEnvironment === env}
                                            onChange={(e) => setAsEnvironment(e.target.value)}
                                        />
                                        <span className={`env-badge env-${env}`}>
                                            {env === 'development' ? 'DEV' : env === 'production' ? 'PROD' : 'STAGING'}
                                        </span>
                                        <span className="env-radio-label">{env.charAt(0).toUpperCase() + env.slice(1)}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {selectedApp && (
                            <div className="link-preview">
                                <div className="link-preview-title">Preview</div>
                                <div className="link-preview-diagram">
                                    <div className="link-preview-app">
                                        <span className="link-preview-name">{app.name}</span>
                                        <span className={`env-badge env-${asEnvironment}`}>
                                            {asEnvironment === 'development' ? 'DEV' : asEnvironment === 'production' ? 'PROD' : 'STAGING'}
                                        </span>
                                    </div>
                                    <div className="link-preview-connector">
                                        <GitBranch size={16} />
                                    </div>
                                    <div className="link-preview-app">
                                        <span className="link-preview-name">{selectedApp.name}</span>
                                        <span className={`env-badge env-${asEnvironment === 'development' ? 'production' : 'development'}`}>
                                            {asEnvironment === 'development' ? 'PROD' : 'DEV'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {app.app_type === 'docker' && (
                            <>
                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={propagateCredentials}
                                            onChange={(e) => setPropagateCredentials(e.target.checked)}
                                        />
                                        <span className="checkbox-custom" />
                                        <span>Propagate database credentials</span>
                                    </label>
                                    <span className="form-hint">
                                        Copy database connection settings from production to development app
                                    </span>
                                </div>

                                {propagateCredentials && (
                                    <div className="form-group">
                                        <label>Table Prefix (optional)</label>
                                        <input
                                            type="text"
                                            value={tablePrefix}
                                            onChange={(e) => setTablePrefix(e.target.value)}
                                            placeholder="wp_dev_ (auto-generated if empty)"
                                        />
                                        <span className="form-hint">
                                            Different prefix allows both apps to share the same database
                                        </span>
                                    </div>
                                )}
                            </>
                        )}

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={linking || !selectedAppId}>
                                {linking ? (
                                    <>Linking...</>
                                ) : (
                                    <>
                                        <Check size={16} />
                                        Link Apps
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default LinkAppModal;
