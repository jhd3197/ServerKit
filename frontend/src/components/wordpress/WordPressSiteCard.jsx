import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Settings, Copy, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';

const WordPressSiteCard = ({ site, onDelete }) => {
    const navigate = useNavigate();
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const isRunning = site.status === 'running';

    function getEnvironmentCount() {
        return site.environments?.length || 0;
    }

    function handleVisitSite(e) {
        e.stopPropagation();
        if (site.url) {
            window.open(site.url, '_blank');
        }
    }

    function handleOpenDashboard(e) {
        e.stopPropagation();
        if (site.url) {
            window.open(`${site.url}/wp-admin`, '_blank');
        }
    }

    function handleManage() {
        navigate(`/wordpress/${site.id}`);
    }

    function handleDelete(e) {
        e.stopPropagation();
        setShowDeleteConfirm(true);
    }

    function confirmDelete() {
        setShowDeleteConfirm(false);
        onDelete?.(site.id);
    }

    return (
        <div className="wp-site-card" onClick={handleManage}>
            <div className="wp-site-card-header">
                <div className="wp-site-icon">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z"/>
                    </svg>
                </div>
                <div className="wp-site-info">
                    <h3 className="wp-site-name">{site.name}</h3>
                    {site.url && (
                        <span className="wp-site-url">{site.url}</span>
                    )}
                </div>
                <span className={`wp-site-status ${isRunning ? 'running' : 'stopped'}`}>
                    <span className="status-dot" />
                    {isRunning ? 'Running' : 'Stopped'}
                </span>
            </div>

            <div className="wp-site-card-body">
                <div className="wp-site-meta">
                    <div className="wp-site-meta-item">
                        <span className="meta-label">Version</span>
                        <span className="meta-value">{site.wp_version || 'Unknown'}</span>
                    </div>
                    <div className="wp-site-meta-item">
                        <span className="meta-label">Environments</span>
                        <span className="meta-value">{getEnvironmentCount() + 1}</span>
                    </div>
                    {site.git_repo_url && (
                        <div className="wp-site-meta-item">
                            <span className="meta-label">Git</span>
                            <span className="meta-value git-connected">Connected</span>
                        </div>
                    )}
                </div>

                {site.is_production && (
                    <span className="wp-site-badge production">Production</span>
                )}
                {!site.is_production && site.production_site_id && (
                    <span className="wp-site-badge development">Development</span>
                )}
            </div>

            <div className="wp-site-card-footer">
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleVisitSite}
                    disabled={!site.url}
                    title="Visit Site"
                >
                    <ExternalLink size={14} />
                    Visit
                </button>
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleOpenDashboard}
                    disabled={!site.url}
                    title="Open Dashboard"
                >
                    <Settings size={14} />
                    Dashboard
                </button>
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleManage}
                    title="Manage Site"
                >
                    <Copy size={14} />
                    Manage
                </button>
                <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={handleDelete}
                    title="Delete Site"
                >
                    <Trash2 size={14} />
                </button>
            </div>

            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title="Delete WordPress Site"
                message={`Are you sure you want to delete "${site.name}"? This action cannot be undone.`}
                details={
                    <ul>
                        <li>All site files will be permanently deleted</li>
                        <li>Database <code>{site.db_name || 'associated database'}</code> will be removed</li>
                        {site.environments?.length > 0 && (
                            <li>{site.environments.length} linked environment(s) will also be deleted</li>
                        )}
                    </ul>
                }
                confirmText="Delete Site"
                variant="danger"
                requireConfirmation={site.name}
                onConfirm={confirmDelete}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </div>
    );
};

export default WordPressSiteCard;
