import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, X } from 'lucide-react';
import { useNotifications } from '../contexts/useNotifications.js';
import { timeAgo } from '../utils/time';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Severity → dot color, mirroring the email/brand palette.
const SEVERITY_DOT = {
    critical: '#fb6f6f',
    warning: '#f5b945',
    success: '#3ddc97',
    info: '#6d7cff',
    test: '#9aa1b2',
};

export default function NotificationBell() {
    const { t } = useTranslation();
    const ctx = useNotifications();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const navigate = useNavigate();

    // The provider is only mounted for authenticated users; render nothing otherwise.
    const { items = [], unreadCount = 0, markRead, markAllRead, refresh, dismissNotice } = ctx || {};

    useEffect(() => {
        if (!open) return undefined;
        const onDocClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    if (!ctx) return null;

    const toggle = () => {
        const next = !open;
        setOpen(next);
        if (next && refresh) refresh();
    };

    const onItemClick = (item) => {
        // System notices route to their fix; bus notifications mark read and
        // then deep-link to their subject when they carry an action_path.
        if (item.kind === 'notice') {
            setOpen(false);
            if (item.action_path) navigate(item.action_path);
            return;
        }
        if (!item.read && markRead) markRead(item.delivery_id);
        if (item.action_path) {
            setOpen(false);
            navigate(item.action_path);
        }
    };

    const badge = unreadCount > 99 ? '99+' : unreadCount;

    return (
        <div className="sk-notif" ref={ref}>
            <SharedButton variant="unstyled"
                type="button"
                className="sk-notif__bell"
                onClick={toggle}
                aria-label={unreadCount
                    ? t('notifications.bellUnread', 'Notifications, {{count}} unread', { count: unreadCount })
                    : t('notifications.bell', 'Notifications')}
                aria-haspopup="true"
                aria-expanded={open}
            >
                <Bell size={16} aria-hidden="true" />
                {unreadCount > 0 && <span className="sk-notif__badge">{badge}</span>}
            </SharedButton>

            {open && (
                <div className="sk-notif__panel" role="menu" aria-label={t('notifications.bell', 'Notifications')}>
                    <div className="sk-notif__head">
                        <span className="sk-notif__heading">{t('notifications.heading', 'Notifications')}</span>
                        {unreadCount > 0 && (
                            <SharedButton variant="unstyled" type="button" className="sk-notif__markall" onClick={markAllRead}>
                                <Check size={13} aria-hidden="true" /> {t('notifications.markAllRead', 'Mark all read')}
                            </SharedButton>
                        )}
                    </div>

                    <div className="sk-notif__list">
                        {items.length === 0 ? (
                            <div className="sk-notif__empty">{t('notifications.empty', "You're all caught up.")}</div>
                        ) : (
                            items.map((item) => (
                                item.kind === 'notice' ? (
                                    <div key={item.delivery_id} className="sk-notif__item is-notice">
                                        <SharedButton variant="unstyled"
                                            type="button"
                                            className="sk-notif__hit"
                                            onClick={() => onItemClick(item)}
                                        >
                                            <span
                                                className="sk-notif__dot"
                                                style={{ background: SEVERITY_DOT[item.severity] || SEVERITY_DOT.info }}
                                                aria-hidden="true"
                                            />
                                            <span className="sk-notif__content">
                                                <span className="sk-notif__title">{item.title}</span>
                                                {item.body && <span className="sk-notif__text">{item.body}</span>}
                                                {item.action_label && (
                                                    <span className="sk-notif__time">{item.action_label} →</span>
                                                )}
                                            </span>
                                        </SharedButton>
                                        <SharedButton variant="unstyled"
                                            type="button"
                                            className="sk-notif__dismiss"
                                            onClick={() => dismissNotice && dismissNotice(item.notice_id)}
                                            aria-label={t('notifications.dismissItem', 'Dismiss {{title}}', { title: item.title })}
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </SharedButton>
                                    </div>
                                ) : (
                                    <SharedButton variant="unstyled"
                                        key={item.delivery_id}
                                        type="button"
                                        className={`sk-notif__item${item.read ? '' : ' is-unread'}`}
                                        onClick={() => onItemClick(item)}
                                    >
                                        <span
                                            className="sk-notif__dot"
                                            style={{ background: SEVERITY_DOT[item.severity] || SEVERITY_DOT.info }}
                                            aria-hidden="true"
                                        />
                                        <span className="sk-notif__content">
                                            <span className="sk-notif__title">{item.title}</span>
                                            {item.body && <span className="sk-notif__text">{item.body}</span>}
                                            <span className="sk-notif__time">
                                                {timeAgo(item.created_at)}
                                                {item.action_path && <span className="sk-notif__cta"> · {item.action_label || t('common.actions.open', 'Open')} →</span>}
                                            </span>
                                        </span>
                                    </SharedButton>
                                )
                            ))
                        )}
                    </div>

                    <SharedButton variant="unstyled"
                        type="button"
                        className="sk-notif__seeall"
                        onClick={() => { setOpen(false); navigate('/notifications'); }}
                    >
                        {t('notifications.seeAll', 'See all notifications')}
                    </SharedButton>
                </div>
            )}
        </div>
    );
}
