import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const AuditLogTab = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [pagination, setPagination] = useState({
        page: 1,
        perPage: 50,
        total: 0,
        pages: 1
    });
    const [filters, setFilters] = useState({
        action: '',
        user_id: ''
    });
    const [actions, setActions] = useState([]);

    useEffect(() => {
        loadLogs();
        loadActions();
    }, [pagination.page, filters]);

    async function loadLogs() {
        try {
            setLoading(true);
            const params = {
                page: pagination.page,
                per_page: pagination.perPage
            };
            if (filters.action) params.action = filters.action;
            if (filters.user_id) params.user_id = filters.user_id;

            const data = await api.getAuditLogs(params);
            setLogs(data.logs);
            setPagination(prev => ({
                ...prev,
                total: data.pagination.total,
                pages: data.pagination.pages
            }));
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load audit logs');
        } finally {
            setLoading(false);
        }
    }

    async function loadActions() {
        try {
            const data = await api.getAuditLogActions();
            setActions(data.actions);
        } catch (err) {
            console.error('Failed to load action types:', err);
        }
    }

    function handleFilterChange(e) {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    }

    function handlePageChange(newPage) {
        setPagination(prev => ({ ...prev, page: newPage }));
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function getActionIcon(action) {
        if (action.includes('login')) {
            return (
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
            );
        }
        if (action.includes('user')) {
            return (
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
            );
        }
        if (action.includes('app') || action.includes('deploy')) {
            return (
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <line x1="3" y1="9" x2="21" y2="9"/>
                    <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
            );
        }
        if (action.includes('setting')) {
            return (
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
            );
        }
        return (
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
        );
    }

    function getActionClass(action) {
        if (action.includes('failed') || action.includes('delete')) return 'action-danger';
        if (action.includes('create') || action.includes('enable')) return 'action-success';
        if (action.includes('update') || action.includes('disable')) return 'action-warning';
        return 'action-info';
    }

    function formatActionName(action) {
        return action.replace(/\./g, ' ').replace(/_/g, ' ');
    }

    function renderDetails(details) {
        if (!details || Object.keys(details).length === 0) return null;

        return (
            <div className="log-details">
                {Object.entries(details).map(([key, value]) => (
                    <span key={key} className="detail-item">
                        <span className="detail-key">{key}:</span>
                        <span className="detail-value">
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                    </span>
                ))}
            </div>
        );
    }

    return (
        <div className="audit-log-tab">
            <div className="tab-header">
                <div className="tab-header-content">
                    <h3>Audit Log</h3>
                    <p>Track user actions and system events</p>
                </div>
            </div>

            <div className="filters-bar">
                <div className="filter-group">
                    <label>Action Type</label>
                    <select name="action" value={filters.action} onChange={handleFilterChange}>
                        <option value="">All Actions</option>
                        {actions.map(action => (
                            <option key={action} value={action}>{formatActionName(action)}</option>
                        ))}
                    </select>
                </div>
                <button className="btn btn-ghost" onClick={() => {
                    setFilters({ action: '', user_id: '' });
                    setPagination(prev => ({ ...prev, page: 1 }));
                }}>
                    Clear Filters
                </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            {loading ? (
                <div className="loading-state">Loading audit logs...</div>
            ) : (
                <>
                    <div className="audit-log-list">
                        {logs.length === 0 ? (
                            <div className="empty-state">No audit logs found</div>
                        ) : (
                            logs.map(log => (
                                <div key={log.id} className={`log-entry ${getActionClass(log.action)}`}>
                                    <div className="log-icon">
                                        {getActionIcon(log.action)}
                                    </div>
                                    <div className="log-content">
                                        <div className="log-header">
                                            <span className="log-action">{formatActionName(log.action)}</span>
                                            <span className="log-user">
                                                by {log.username || 'System'}
                                            </span>
                                            {log.target_type && (
                                                <span className="log-target">
                                                    on {log.target_type} {log.target_id ? `#${log.target_id}` : ''}
                                                </span>
                                            )}
                                        </div>
                                        {renderDetails(log.details)}
                                        <div className="log-meta">
                                            <span className="log-time">{formatDate(log.created_at)}</span>
                                            {log.ip_address && (
                                                <span className="log-ip">IP: {log.ip_address}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {pagination.pages > 1 && (
                        <div className="pagination">
                            <button
                                className="btn btn-sm btn-ghost"
                                disabled={pagination.page <= 1}
                                onClick={() => handlePageChange(pagination.page - 1)}
                            >
                                Previous
                            </button>
                            <span className="pagination-info">
                                Page {pagination.page} of {pagination.pages}
                                ({pagination.total} total)
                            </span>
                            <button
                                className="btn btn-sm btn-ghost"
                                disabled={pagination.page >= pagination.pages}
                                onClick={() => handlePageChange(pagination.page + 1)}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default AuditLogTab;
