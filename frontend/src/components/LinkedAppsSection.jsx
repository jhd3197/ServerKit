import React from 'react';
import { GitBranch, Link2, Unlink, ExternalLink, Server } from 'lucide-react';

const LinkedAppsSection = ({
    app,
    linkedApps,
    onLink,
    onUnlink,
    onNavigate,
    loading
}) => {
    const envLabels = {
        production: 'Production',
        development: 'Development',
        staging: 'Staging',
        standalone: 'Standalone'
    };

    const envColors = {
        production: 'env-production',
        development: 'env-development',
        staging: 'env-staging'
    };

    const getStatusClass = (status) => {
        switch (status) {
            case 'running': return 'status-active';
            case 'stopped': return 'status-stopped';
            case 'error': return 'status-error';
            default: return 'status-warning';
        }
    };

    return (
        <div className="card linked-apps-section">
            <div className="linked-apps-header">
                <h3>
                    <GitBranch size={18} />
                    Environment Linking
                </h3>
                {!app.has_linked_app && (
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={onLink}
                        disabled={loading}
                    >
                        <Link2 size={14} />
                        Link App
                    </button>
                )}
            </div>

            <div className="linked-apps-content">
                {/* Current app environment */}
                <div className="current-environment">
                    <span className="env-label">This app is:</span>
                    <span className={`env-badge ${envColors[app.environment_type] || ''}`}>
                        {envLabels[app.environment_type] || 'Standalone'}
                    </span>
                </div>

                {/* Linked apps list */}
                {linkedApps && linkedApps.length > 0 ? (
                    <div className="linked-apps-list">
                        <div className="linked-apps-divider">
                            <span>Linked to</span>
                        </div>
                        {linkedApps.map(linkedApp => (
                            <div key={linkedApp.id} className="linked-app-item">
                                <div className="linked-app-info">
                                    <div className="linked-app-icon">
                                        <Server size={16} />
                                    </div>
                                    <div className="linked-app-details">
                                        <span className="linked-app-name">{linkedApp.name}</span>
                                        <div className="linked-app-meta">
                                            <span className={`env-badge ${envColors[linkedApp.environment_type] || ''}`}>
                                                {envLabels[linkedApp.environment_type] || linkedApp.environment_type}
                                            </span>
                                            <span className={`status-badge-sm ${getStatusClass(linkedApp.status)}`}>
                                                <span className="status-dot" />
                                                {linkedApp.status}
                                            </span>
                                            {linkedApp.port && (
                                                <span className="linked-app-port">:{linkedApp.port}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="linked-app-actions">
                                    <button
                                        className="btn btn-secondary btn-sm btn-icon"
                                        onClick={() => onNavigate(linkedApp.id)}
                                        title="View app"
                                    >
                                        <ExternalLink size={14} />
                                    </button>
                                    <button
                                        className="btn btn-secondary btn-sm btn-icon"
                                        onClick={onUnlink}
                                        disabled={loading}
                                        title="Unlink apps"
                                    >
                                        <Unlink size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : app.environment_type !== 'standalone' ? (
                    <div className="linked-apps-empty">
                        <p>No linked apps. Link another app to share database resources.</p>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={onLink}
                            disabled={loading}
                        >
                            <Link2 size={14} />
                            Link App
                        </button>
                    </div>
                ) : (
                    <div className="linked-apps-info">
                        <p>
                            Link this app to another to create a production/development pair.
                            Linked apps can share database credentials with different table prefixes.
                        </p>
                    </div>
                )}

                {/* Shared config info */}
                {app.shared_config && app.shared_config.db_credentials_propagated && (
                    <div className="shared-config-info">
                        <div className="shared-config-badge">
                            <Server size={12} />
                            Shared Database
                        </div>
                        {app.shared_config.shared_db && (
                            <div className="shared-config-details">
                                <span>Host: {app.shared_config.shared_db.db_host}</span>
                                <span>Table prefix: {app.shared_config.shared_db.target_prefix || app.shared_config.shared_db.source_prefix}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default LinkedAppsSection;
