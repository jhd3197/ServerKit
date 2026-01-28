import React, { useState, useEffect } from 'react';
import { ArrowUpRight, ArrowDownLeft, Database, GitBranch, Lock, Unlock, Trash2, Play, Square, RefreshCw, Camera, AlertCircle } from 'lucide-react';
import wordpressApi from '../../services/wordpress';

const ACTION_ICONS = {
    create: Play,
    deploy: GitBranch,
    promote: ArrowUpRight,
    sync: ArrowDownLeft,
    lock: Lock,
    unlock: Unlock,
    destroy: Trash2,
    snapshot_created: Camera,
    snapshot_restored: Database,
    started: Play,
    stopped: Square,
    restarted: RefreshCw
};

const ACTION_COLORS = {
    create: 'success',
    deploy: 'info',
    promote: 'primary',
    sync: 'info',
    lock: 'warning',
    unlock: 'default',
    destroy: 'danger',
    snapshot_created: 'info',
    snapshot_restored: 'warning',
    started: 'success',
    stopped: 'default',
    restarted: 'info'
};

function formatRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

const ActivityFeed = ({ projectId, envId, limit = 20, compact = false }) => {
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        loadActivities();
    }, [projectId, envId]);

    async function loadActivities() {
        setLoading(true);
        try {
            const params = { limit };
            if (envId) params.env_id = envId;
            const data = await wordpressApi.getProjectActivity(projectId, params);
            setActivities(data.activities || []);
            setTotal(data.total || 0);
        } catch (err) {
            console.error('Failed to load activities:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="activity-feed">
                {[1, 2, 3].map(i => (
                    <div key={i} className="activity-item-skeleton">
                        <div className="skeleton" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                        <div style={{ flex: 1 }}>
                            <div className="skeleton" style={{ width: '60%', height: 14, marginBottom: 6 }} />
                            <div className="skeleton" style={{ width: '40%', height: 12 }} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (activities.length === 0) {
        return (
            <div className="activity-feed-empty">
                <p>No activity recorded yet.</p>
            </div>
        );
    }

    return (
        <div className={`activity-feed ${compact ? 'compact' : ''}`}>
            {activities.map(activity => {
                const Icon = ACTION_ICONS[activity.action] || AlertCircle;
                const colorClass = ACTION_COLORS[activity.action] || 'default';

                return (
                    <div key={activity.id} className="activity-item">
                        <div className={`activity-icon ${colorClass}`}>
                            <Icon size={14} />
                        </div>
                        <div className="activity-content">
                            <span className="activity-description">
                                {activity.description || `${activity.action} performed`}
                            </span>
                            {activity.status === 'failed' && activity.error_message && (
                                <span className="activity-error">{activity.error_message}</span>
                            )}
                        </div>
                        <div className="activity-meta">
                            <span className="activity-time">{formatRelativeTime(activity.created_at)}</span>
                            {activity.status === 'failed' && (
                                <span className="activity-status-badge failed">Failed</span>
                            )}
                            {activity.status === 'running' && (
                                <span className="activity-status-badge running">Running</span>
                            )}
                        </div>
                    </div>
                );
            })}
            {total > activities.length && !compact && (
                <button className="btn btn-ghost btn-sm activity-load-more" onClick={loadActivities}>
                    Load more
                </button>
            )}
        </div>
    );
};

export default ActivityFeed;
