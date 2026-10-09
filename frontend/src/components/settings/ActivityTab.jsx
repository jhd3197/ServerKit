import { useCallback, useState, useEffect  } from 'react';
import api from '../../services/api';
import ContributionGraph from './ContributionGraph';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { Search, Filter, X, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTableFooter } from '@/components/ds';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';

const ActivityTab = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const [summary, setSummary] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [feedLoading, setFeedLoading] = useState(false);
    const [summaryError, setSummaryError] = useState(null);
    const [logsError, setLogsError] = useState(null);
    const [users, setUsers] = useState([]);
    const [actions, setActions] = useState([]);
    const [pagination, setPagination] = useState({
        page: 1, perPage: 50, total: 0, pages: 1
    });
    const [filters, setFilters] = useState({ action: '', user_id: '' });

    useEffect(() => {
        loadSummary();
        loadUsers();
        loadActions();
    }, []);

    const loadLogs = useCallback(async () => {
        try {
            setFeedLoading(true);
            const params = {
                page: pagination.page,
                per_page: pagination.perPage
            };
            if (filters.action) params.action = filters.action;
            if (filters.user_id) params.user_id = filters.user_id;

            const data = await api.getAuditLogs(params);
            setLogs(data.logs || []);
            setPagination(prev => ({
                ...prev,
                total: data.pagination?.total || 0,
                pages: data.pagination?.pages || 1
            }));
            setLogsError(null);
        } catch (err) {
            setLogsError(err);
        } finally {
            setFeedLoading(false);
        }
    }, [pagination.page, pagination.perPage, filters.action, filters.user_id]);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    async function loadSummary() {
        try {
            const data = await api.getActivitySummary();
            setSummary(data);
            setSummaryError(null);
        } catch (err) {
            setSummaryError(err);
        } finally {
            setLoading(false);
        }
    }


    async function loadUsers() {
        try {
            const data = await api.getUsers();
            setUsers(data.users || []);
        } catch { /* ignore */ }
    }

    async function loadActions() {
        try {
            const data = await api.getAuditLogActions();
            setActions(data.actions || []);
        } catch { /* ignore */ }
    }

    function handleFilterChange(name, value) {
        setFilters(prev => ({ ...prev, [name]: value }));
        setPagination(prev => ({ ...prev, page: 1 }));
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function getActionClass(action) {
        if (action?.includes('failed') || action?.includes('delete') || action?.includes('revoke')) return 'action-danger';
        if (action?.includes('create') || action?.includes('enable') || action?.includes('login') || action?.includes('accept')) return 'action-success';
        if (action?.includes('update') || action?.includes('disable')) return 'action-warning';
        return 'action-info';
    }

    function formatActionName(action) {
        return action.replace(/\./g, ' ').replace(/_/g, ' ');
    }

    function renderDetailsInline(details) {
        if (!details || Object.keys(details).length === 0) return null;
        return Object.entries(details).map(([key, value]) => (
            <span key={key} className="log-row__detail">
                <span className="log-row__detail-key">{key}=</span>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
        ));
    }

    if (loading) {
        return <div className="activity-tab"><div className="loading-state">{t('app.activityTab.loadingActivity', 'Loading activity…')}</div></div>;
    }

    const maxCount = summary?.top_users?.length
        ? Math.max(...summary.top_users.map(u => u.action_count))
        : 1;

    return (
        <div className="activity-tab">
            <div className="tab-header">
                <div className="tab-header-content">
                    <h3>{t('app.activityTab.activityDashboard', 'Activity dashboard')}</h3>
                    <p>{t('app.activityTab.monitorTeamActivityAuditActionsAnd', 'Monitor team activity, audit actions, and system events.')}</p>
                </div>
            </div>

            {summaryError && !summary && (
                <ErrorState
                    title={t('app.activityTab.couldntLoadSummary', "Couldn't load activity summary.")}
                    error={summaryError}
                    onRetry={loadSummary}
                />
            )}

            {summary && (
                <>
                    <div {...register('activity-dashboard', 'activity-stats')}>
                        <span className="activity-stats__item">
                            <span className="activity-stats__value">{summary.active_users_today}</span>
                            {t('app.activityTab.activeToday', 'active today')}
                        </span>
                        <span className="activity-stats__item">
                            <span className="activity-stats__value">{summary.actions_this_week}</span>
                            {t('app.activityTab.actionsThisWeek', 'actions this week')}
                        </span>
                        <span className="activity-stats__item">
                            <span className="activity-stats__value">{summary.total_users}</span>
                            {t('app.activityTab.totalUsers', 'total users')}
                        </span>
                    </div>

                    <div className="graphs-section">
                        <ContributionGraph
                            data={summary.daily_counts}
                            title={t('app.activityTab.overallSystemActivity', 'Overall system activity')}
                        />
                        {summary.top_user_daily && summary.top_user_daily.length > 0 && summary.top_users?.length > 1 && (
                            <ContributionGraph
                                data={summary.top_user_daily}
                                title={t('app.activityTab.mostActiveUserActivity', 'Most active user activity')}
                                username={summary.top_users[0]?.username}
                            />
                        )}
                    </div>

                    {summary.top_users && summary.top_users.length > 0 && (
                        <div className="most-active-users">
                            <h4>{t('app.activityTab.mostActiveUsersThisWeek', 'Most active users (this week)')}</h4>
                            <div className="active-users-list">
                                {summary.top_users.map((u, i) => (
                                    <div key={u.user_id} className="active-user-item">
                                        <span className="active-user-rank">{i + 1}</span>
                                        <div className="active-user-info">
                                            <span className="active-user-name">{u.username}</span>
                                            <div className="active-user-bar-wrapper">
                                                <div
                                                    className="active-user-bar"
                                                    style={{ width: `${(u.action_count / maxCount) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                        <span className="active-user-count">{u.action_count} actions</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <div {...register('activity-audit-log', 'activity-feed-section')}>
                <div className="section-header">
                    <h4>{t('app.activityTab.auditLog', 'Audit log')}</h4>
                </div>

                <div className="filters-bar">
                    <div className="filter-group">
                        <label><Filter size={12} /> {t('app.activityTab.actionType', 'Action type')}</label>
                        <Select
                            value={filters.action || '__all__'}
                            onValueChange={(val) => handleFilterChange('action', val === '__all__' ? '' : val)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('app.activityTab.allActions', 'All actions')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">{t('app.activityTab.allActions', 'All actions')}</SelectItem>
                                {actions.map(action => (
                                    <SelectItem key={action} value={action}>{formatActionName(action)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="filter-group">
                        <label><UserIcon size={12} /> {t('common.labels.user', 'User')}</label>
                        <Select
                            value={filters.user_id || '__all__'}
                            onValueChange={(val) => handleFilterChange('user_id', val === '__all__' ? '' : val)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('app.activityTab.allUsers', 'All users')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all__">{t('app.activityTab.allUsers', 'All users')}</SelectItem>
                                {users.map(u => (
                                    <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {(filters.action || filters.user_id) && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setFilters({ action: '', user_id: '' });
                                setPagination(prev => ({ ...prev, page: 1 }));
                            }}
                        >
                            <X size={14} /> {t('common.actions.clear', 'Clear')}
                        </Button>
                    )}
                </div>

                {feedLoading ? (
                    <div className="loading-state">
                        <div className="spinner" />
                        {t('app.activityTab.loadingLogs', 'Loading logs…')}
                    </div>
                ) : logsError && logs.length === 0 ? (
                    <ErrorState
                        title={t('app.activityTab.couldntLoadAuditLogs', "Couldn't load audit logs.")}
                        error={logsError}
                        onRetry={loadLogs}
                    />
                ) : logs.length === 0 ? (
                    <EmptyState icon={Search} title={t('app.activityTab.noAuditLogsFound', 'No audit logs found')} />
                ) : (
                    <>
                    {logsError && <ErrorState compact error={logsError} onRetry={loadLogs} />}
                    <div className="audit-log-list" role="list">
                        {logs.map(log => (
                            <div key={log.id} className={`log-row ${getActionClass(log.action)}`} role="listitem">
                                <time className="log-row__time" dateTime={log.created_at}>
                                    {formatDate(log.created_at)}
                                </time>
                                <span className="log-row__dot" aria-hidden="true" />
                                <span className="log-row__action">{log.action}</span>
                                <span className="log-row__user">{log.username || 'system'}</span>
                                {log.target_type && (
                                    <span className="log-row__target">
                                        {log.target_type}{log.target_id ? ` #${log.target_id}` : ''}
                                    </span>
                                )}
                                <span className="log-row__meta">
                                    {renderDetailsInline(log.details)}
                                    {log.ip_address && <span className="log-row__ip">{log.ip_address}</span>}
                                </span>
                            </div>
                        ))}
                    </div>
                    </>
                )}

                {/* The audit feed is a flex-wrapped log-row layout, not a
                    table, so it keeps its own markup; only the pager is
                    standardized onto the shared DataTableFooter (paged mode).
                    Fetch logic and pagination state are unchanged. */}
                {!feedLoading && logs.length > 0 && (
                    <DataTableFooter
                        shown={logs.length}
                        total={pagination.total}
                        noun="log"
                        page={pagination.page}
                        totalPages={pagination.pages}
                        onPageChange={(nextPage) => setPagination(prev => ({ ...prev, page: nextPage }))}
                    />
                )}
            </div>
        </div>
    );
};

export default ActivityTab;
