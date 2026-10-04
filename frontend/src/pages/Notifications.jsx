import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ScrollText, X } from 'lucide-react';
import api from '../services/api';
import PageLayout from '../layouts/PageLayout';
import { Button } from '@/components/ui/button';
import { useAuth } from '../contexts/useAuth.js';
import { useNotifications } from '../contexts/useNotifications.js';
import { timeAgo } from '../utils/time';
import { useTranslation } from 'react-i18next';

const SEVERITY_DOT = {
    critical: '#fb6f6f',
    warning: '#f5b945',
    success: '#3ddc97',
    info: '#6d7cff',
    test: '#9aa1b2',
};

const PAGE_SIZE = 25;

const CATEGORY_CHIPS = [
    { key: '', labelKey: 'app.notifications.allCategories', label: 'All categories' },
    { key: 'system', labelKey: 'common.labels.system', label: 'System' },
    { key: 'security', labelKey: 'common.labels.security', label: 'Security' },
    { key: 'backups', labelKey: 'common.labels.backups', label: 'Backups' },
    { key: 'apps', labelKey: 'app.notifications.apps', label: 'Services' },
];
const SEVERITY_CHIPS = [
    { key: '', labelKey: 'app.notifications.any', label: 'Any' },
    { key: 'critical', labelKey: 'app.notifications.critical', label: 'Critical' },
    { key: 'warning', labelKey: 'common.labels.warning', label: 'Warning' },
    { key: 'success', labelKey: 'app.notifications.success', label: 'Success' },
    { key: 'info', labelKey: 'common.labels.info', label: 'Info' },
];

export default function Notifications() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const { refresh: refreshBell, items: ctxItems = [], dismissNotice } = useNotifications() || {};
    const [items, setItems] = useState([]);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [category, setCategory] = useState('');
    const [severity, setSeverity] = useState('');
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);

    const fetchPage = useCallback(async (startOffset, replace) => {
        setLoading(true);
        try {
            const data = await api.getInbox({
                limit: PAGE_SIZE, offset: startOffset, unread: unreadOnly,
                category: category || undefined, severity: severity || undefined,
            });
            const fresh = data.items || [];
            setItems((prev) => (replace ? fresh : [...prev, ...fresh]));
            setUnreadCount(data.unread_count || 0);
            setHasMore(fresh.length === PAGE_SIZE);
        } catch {
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [unreadOnly, category, severity]);

    useEffect(() => { fetchPage(0, true); }, [fetchPage]);

    const onItemClick = async (item) => {
        if (!item.read) {
            setItems((prev) => prev.map((it) => (
                it.delivery_id === item.delivery_id ? { ...it, read: true } : it
            )));
            setUnreadCount((c) => Math.max(0, c - 1));
            try { await api.markNotificationRead(item.delivery_id); } catch { /* reconciled on reload */ }
            if (refreshBell) refreshBell();
        }
        // Deep link to the notification's subject (whole-row click).
        if (item.action_path) navigate(item.action_path);
    };

    const onMarkAll = async () => {
        // When a category filter is active, mark just that group read.
        setItems((prev) => prev.map((it) => ({ ...it, read: true })));
        setUnreadCount((c) => (category ? Math.max(0, c - items.filter((it) => !it.read).length) : 0));
        try { await api.markAllNotificationsRead(category || null); } catch { /* reconciled on reload */ }
        if (refreshBell) refreshBell();
        fetchPage(0, true);
    };

    // Live system notices (admin config hints) come from the shared context so they
    // surface here too, above the bus history.
    const noticeItems = (ctxItems || []).filter((it) => it.kind === 'notice');

    return (
        <PageLayout
            icon={<Bell size={18} />}
            title={t('app.notifications.notifications', 'Notifications')}
            meta={unreadCount ? `${unreadCount} unread` : 'All caught up'}
            actions={(
                <>
                    {isAdmin && (
                        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/notifications')}>
                            <ScrollText size={15} /> {t('app.notifications.deliveryLog', 'Delivery log')}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={onMarkAll} disabled={!unreadCount}>
                        <CheckCheck size={15} /> {category ? t('app.notifications.markCategoryRead', 'Mark {{category}} read', { category }) : t('app.notifications.markAllRead', 'Mark all read')}
                    </Button>
                </>
            )}
        >
            <div className="sk-notif-page">
                <div className="sk-notif-page__filters" role="tablist" aria-label={t('app.notifications.filterNotifications', 'Filter notifications')}>
                    <Button variant="unstyled"
                        type="button"
                        role="tab"
                        aria-selected={!unreadOnly}
                        className={!unreadOnly ? 'is-active' : ''}
                        onClick={() => setUnreadOnly(false)}
                    >
                        {t('common.labels.all', 'All')}
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        role="tab"
                        aria-selected={unreadOnly}
                        className={unreadOnly ? 'is-active' : ''}
                        onClick={() => setUnreadOnly(true)}
                    >
                        {t('app.notifications.unread', 'Unread')}
                    </Button>
                </div>

                <div className="sk-notif-page__chips">
                    <div className="sk-notif-chipset" aria-label={t('app.notifications.filterByCategory', 'Filter by category')}>
                        {CATEGORY_CHIPS.map((c) => (
                            <Button variant="unstyled"
                                type="button"
                                key={c.key || 'all'}
                                className={`sk-notif-chip${category === c.key ? ' is-active' : ''}`}
                                onClick={() => setCategory(c.key)}
                            >
                                {c.label}
                            </Button>
                        ))}
                    </div>
                    <div className="sk-notif-chipset" aria-label={t('app.notifications.filterBySeverity', 'Filter by severity')}>
                        {SEVERITY_CHIPS.map((s) => (
                            <Button variant="unstyled"
                                type="button"
                                key={s.key || 'any'}
                                className={`sk-notif-chip sk-notif-chip--sev${severity === s.key ? ' is-active' : ''}`}
                                onClick={() => setSeverity(s.key)}
                            >
                                {s.label}
                            </Button>
                        ))}
                    </div>
                </div>

                {loading && items.length === 0 && noticeItems.length === 0 ? (
                    <div className="sk-notif-page__state">{t('common.loading', 'Loading…')}</div>
                ) : items.length === 0 && noticeItems.length === 0 ? (
                    <div className="sk-notif-page__state">
                        <Bell size={26} aria-hidden="true" />
                        <p>{unreadOnly ? t('app.notifications.noUnreadNotifications', 'No unread notifications.') : t('app.notifications.noNotificationsYet', 'No notifications yet.')}</p>
                    </div>
                ) : (
                    <ul className="sk-notif-page__list">
                        {noticeItems.map((item) => (
                            <li
                                key={item.delivery_id}
                                className="sk-notif-row is-unread is-notice"
                                onClick={() => item.action_path && navigate(item.action_path)}
                            >
                                <span
                                    className="sk-notif-row__dot"
                                    style={{ background: SEVERITY_DOT[item.severity] || SEVERITY_DOT.info }}
                                    aria-hidden="true"
                                />
                                <div className="sk-notif-row__body">
                                    <div className="sk-notif-row__title">{item.title}</div>
                                    {item.body && <div className="sk-notif-row__text">{item.body}</div>}
                                    {item.action_label && (
                                        <div className="sk-notif-row__action">{item.action_label} →</div>
                                    )}
                                </div>
                                <Button variant="unstyled"
                                    type="button"
                                    className="sk-notif-row__dismiss"
                                    onClick={(e) => { e.stopPropagation(); if (dismissNotice) dismissNotice(item.notice_id); }}
                                    aria-label={t('app.notifications.dismiss', 'Dismiss {{title}}', { title: item.title })}
                                >
                                    <X size={15} aria-hidden="true" />
                                </Button>
                            </li>
                        ))}
                        {items.map((item) => (
                            <li
                                key={item.delivery_id}
                                className={`sk-notif-row${item.read ? '' : ' is-unread'}${item.action_path ? ' is-linked' : ''}`}
                                onClick={() => onItemClick(item)}
                            >
                                <span
                                    className="sk-notif-row__dot"
                                    style={{ background: SEVERITY_DOT[item.severity] || SEVERITY_DOT.info }}
                                    aria-hidden="true"
                                />
                                <div className="sk-notif-row__body">
                                    <div className="sk-notif-row__title">{item.title}</div>
                                    {item.body && <div className="sk-notif-row__text">{item.body}</div>}
                                    {item.action_path && (
                                        <div className="sk-notif-row__action">{item.action_label || t('common.actions.open', 'Open')} →</div>
                                    )}
                                </div>
                                <span className="sk-notif-row__time">{timeAgo(item.created_at)}</span>
                            </li>
                        ))}
                    </ul>
                )}

                {hasMore && !loading && (
                    <div className="sk-notif-page__more">
                        <Button variant="outline" size="sm" onClick={() => fetchPage(items.length, false)}>
                            {t('app.notifications.loadMore', 'Load more')}
                        </Button>
                    </div>
                )}
            </div>
        </PageLayout>
    );
}
