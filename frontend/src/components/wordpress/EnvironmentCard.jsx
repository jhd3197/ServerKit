import React, { useState } from 'react';
import { ExternalLink, RefreshCw, Trash2, GitBranch, Clock, AlertTriangle, Calendar, FileText } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';

const EnvironmentCard = ({ environment, productionUrl, onSync, onDelete, onViewLogs, isProduction = false }) => {
    const [syncing, setSyncing] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showSyncConfirm, setShowSyncConfirm] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const isRunning = environment.status === 'running';
    const envType = environment.type || (isProduction ? 'production' : 'development');

    // Helper functions
    function formatDate(dateString) {
        if (!dateString) return null;
        return new Date(dateString).toLocaleDateString();
    }

    function formatRelativeTime(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} week(s) ago`;
        return `${Math.floor(diffDays / 30)} month(s) ago`;
    }

    function isStale() {
        if (!environment.last_sync || isProduction) return false;
        const lastSync = new Date(environment.last_sync);
        const now = new Date();
        const diffDays = Math.floor((now - lastSync) / (1000 * 60 * 60 * 24));
        return diffDays > 7; // Consider stale if not synced in 7 days
    }

    function formatSchedule(schedule) {
        if (!schedule) return null;
        const scheduleMap = {
            '0 3 * * 0': 'Weekly (Sunday 3am)',
            '0 3 * * *': 'Daily (3am)',
            '0 0 * * 0': 'Weekly (Sunday midnight)',
            '0 0 * * *': 'Daily (midnight)'
        };
        return scheduleMap[schedule] || schedule;
    }

    const stale = isStale();

    async function handleSync() {
        setShowSyncConfirm(false);
        setSyncing(true);
        try {
            await onSync?.(environment.id);
        } finally {
            setSyncing(false);
        }
    }

    async function handleDelete() {
        setShowDeleteConfirm(false);
        setDeleting(true);
        try {
            await onDelete?.(environment.id);
        } finally {
            setDeleting(false);
        }
    }

    function handleVisit() {
        if (environment.url) {
            window.open(environment.url, '_blank');
        }
    }

    function getEnvBadgeClass() {
        switch (envType) {
            case 'production': return 'env-production';
            case 'staging': return 'env-staging';
            default: return 'env-development';
        }
    }

    return (
        <div className={`wp-env-card ${isProduction ? 'production' : ''} ${stale ? 'stale' : ''}`}>
            <div className="wp-env-header">
                <div className="wp-env-info">
                    <span className={`wp-env-badge ${getEnvBadgeClass()}`}>
                        {envType.toUpperCase()}
                    </span>
                    <h4 className="wp-env-name">{environment.name}</h4>
                </div>
                <div className="wp-env-status-group">
                    {stale && (
                        <span className="wp-env-stale-badge" title="Environment hasn't been synced in over 7 days">
                            <AlertTriangle size={12} />
                            Stale
                        </span>
                    )}
                    <span className={`wp-env-status ${isRunning ? 'running' : 'stopped'}`}>
                        <span className="status-dot" />
                        {isRunning ? 'Running' : 'Stopped'}
                    </span>
                </div>
            </div>

            <div className="wp-env-body">
                {environment.url && (
                    <div className="wp-env-url">
                        <a href={environment.url} target="_blank" rel="noopener noreferrer">
                            {environment.url}
                        </a>
                    </div>
                )}

                <div className="wp-env-meta">
                    {environment.db_name && (
                        <div className="wp-env-meta-item">
                            <span className="meta-label">Database</span>
                            <span className="meta-value mono">{environment.db_name}</span>
                        </div>
                    )}
                    {environment.commit_sha && (
                        <div className="wp-env-meta-item">
                            <span className="meta-label">
                                <GitBranch size={12} /> Commit
                            </span>
                            <span className="meta-value mono">{environment.commit_sha.substring(0, 7)}</span>
                        </div>
                    )}
                    {!isProduction && environment.last_sync && (
                        <div className="wp-env-meta-item">
                            <span className="meta-label">
                                <Clock size={12} /> Last Sync
                            </span>
                            <span className={`meta-value ${stale ? 'text-warning' : ''}`}>
                                {formatRelativeTime(environment.last_sync)}
                            </span>
                        </div>
                    )}
                    {!isProduction && environment.sync_schedule && (
                        <div className="wp-env-meta-item">
                            <span className="meta-label">
                                <Calendar size={12} /> Schedule
                            </span>
                            <span className="meta-value">
                                {formatSchedule(environment.sync_schedule)}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="wp-env-footer">
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleVisit}
                    disabled={!environment.url}
                >
                    <ExternalLink size={14} />
                    Visit
                </button>

                {!isProduction && (
                    <>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setShowSyncConfirm(true)}
                            disabled={syncing || !productionUrl}
                            title="Sync from production"
                        >
                            <RefreshCw size={14} className={syncing ? 'spinning' : ''} />
                            {syncing ? 'Syncing...' : 'Sync'}
                        </button>
                        {onViewLogs && (
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => onViewLogs?.(environment.id)}
                                title="View sync logs"
                            >
                                <FileText size={14} />
                                Logs
                            </button>
                        )}
                        <button
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={() => setShowDeleteConfirm(true)}
                            disabled={deleting}
                        >
                            <Trash2 size={14} />
                            {deleting ? 'Deleting...' : 'Delete'}
                        </button>
                    </>
                )}
            </div>

            <ConfirmDialog
                isOpen={showSyncConfirm}
                title="Sync from Production"
                message={`Sync "${environment.name}" from production?`}
                details={
                    <ul>
                        <li><strong>Warning:</strong> This will overwrite the current database</li>
                        <li>All data in this environment will be replaced with production data</li>
                        <li>URLs will be automatically updated for this environment</li>
                    </ul>
                }
                confirmText="Sync Now"
                variant="warning"
                onConfirm={handleSync}
                onCancel={() => setShowSyncConfirm(false)}
            />

            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title={`Delete ${envType.charAt(0).toUpperCase() + envType.slice(1)} Environment`}
                message={`Are you sure you want to delete "${environment.name}"?`}
                details={
                    <ul>
                        <li>All environment files will be permanently deleted</li>
                        <li>Database <code>{environment.db_name || 'associated database'}</code> will be removed</li>
                        <li>This action cannot be undone</li>
                    </ul>
                }
                confirmText="Delete Environment"
                variant="danger"
                onConfirm={handleDelete}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </div>
    );
};

export default EnvironmentCard;
