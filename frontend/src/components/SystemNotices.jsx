import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Info, X, Settings, ExternalLink } from 'lucide-react';
import api from '../services/api';
import { Button } from '@/components/ui/button';
import { getDismissedNotices, addDismissedNotice, isUrgentNotice } from '../utils/dismissedNotices';
import { useTranslation } from 'react-i18next';

const ICONS = {
    warning: AlertTriangle,
    info: Info,
    error: AlertTriangle,
    critical: AlertTriangle,
};

// The top banner is reserved for genuinely urgent notices, and only one at a time —
// everything else lives in the notification center (see NotificationsContext). This
// keeps the dashboard clear instead of stacking every setup hint at the top.
export default function SystemNotices() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissedState] = useState(getDismissedNotices);

    const load = useCallback(async () => {
        try {
            const data = await api.getSystemNotices();
            setNotices(data?.notices || []);
        } catch {
            // Non-admin or endpoint error — hide silently.
            setNotices([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleDismiss = (id) => {
        setDismissedState(addDismissedNotice(id).slice());
    };

    const handleAction = (notice) => {
        if (notice.action_path?.startsWith('http')) {
            window.open(notice.action_path, '_blank', 'noopener,noreferrer');
        } else if (notice.action_path) {
            navigate(notice.action_path);
        }
    };

    if (loading) return null;

    // Urgent only, and at most one — the rest are surfaced in the notification bell.
    const notice = notices.find((n) => isUrgentNotice(n) && !dismissed.includes(n.id));
    if (!notice) return null;

    const Icon = ICONS[notice.level] || AlertTriangle;
    return (
        <div className="system-notices" role="region" aria-label={t('app.systemNotices.systemNotices', 'System notices')}>
            <div className={`system-notice system-notice--${notice.level}`} role="alert">
                <span className="system-notice__icon" aria-hidden="true">
                    <Icon size={18} />
                </span>
                <div className="system-notice__body">
                    <div className="system-notice__title">{notice.title}</div>
                    <div className="system-notice__message">{notice.message}</div>
                </div>
                <div className="system-notice__actions">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="system-notice__action"
                        onClick={() => handleAction(notice)}
                    >
                        {notice.action_label || t('app.systemNotices.fix', 'Fix')}
                        {notice.action_path?.startsWith('http') ? (
                            <ExternalLink size={13} />
                        ) : (
                            <Settings size={13} />
                        )}
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="system-notice__dismiss"
                        onClick={() => handleDismiss(notice.id)}
                        aria-label={t('app.systemNotices.dismiss', 'Dismiss {{title}}', { title: notice.title })}
                    >
                        <X size={16} />
                    </Button>
                </div>
            </div>
        </div>
    );
}
