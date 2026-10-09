import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { ShieldAlert, ShieldCheck, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

// Compact "how set-up is this panel" card for the dashboard (admin-only).
// Reads GET /setup-health and shows the score + the top open items, each
// deep-linking to its fix. Collapses to a slim "all set" line when clean —
// no dead card.

const DISMISS_KEY = 'serverkit.setupHealth.dismissed';

const SetupHealthWidget = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(() => {
        try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
    });

    useEffect(() => {
        let cancelled = false;
        api.getSetupHealth()
            .then((res) => { if (!cancelled) setData(res); })
            .catch(() => { /* non-admin or error — widget stays quiet */ })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    if (dismissed) return null;

    if (loading || !data || !data.summary) {
        return (
            <div className="setup-health-widget setup-health-widget--loading" role="status">
                <ShieldCheck size={16} />
                <span>{t('app.setupHealthWidget.setupHealth', 'Setup health')}</span>
                <span className="setup-health-widget__muted">
                    {loading
                        ? t('common.checking', 'Checking…')
                        : t('app.setupHealthWidget.unavailable', 'Unavailable')}
                </span>
            </div>
        );
    }

    const { summary } = data;
    const openCount = Number(summary.critical_open || 0) + Number(summary.recommended_open || 0);

    const dismiss = () => {
        setDismissed(true);
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    };

    // Clean → slim "all set" line, not a big empty card.
    if (openCount === 0) {
        return (
            <Button variant="unstyled"
                type="button"
                className="setup-health-widget setup-health-widget--clean"
                onClick={() => navigate('/monitoring/doctor')}
            >
                <ShieldCheck size={16} />
                <span className="setup-health-widget__cleanlabel">
                    {t('app.setupHealthWidget.allSet', 'Setup complete:')} {summary.score}{t('app.setupHealthWidget.setupHealth2', '% setup health')}
                </span>
                <ChevronRight size={14} />
            </Button>
        );
    }

    return (
        <div className="setup-health-widget">
            <ShieldAlert size={16} className="setup-health-widget__icon" />
            <span className="setup-health-widget__title">{t('app.setupHealthWidget.setupHealth', 'Setup health')}</span>
            <span className="setup-health-widget__score">{summary.score}%</span>
            <progress max="100" value={summary.score} aria-label={t('app.setupHealthWidget.progress', 'Setup health progress')} />
            <span className="setup-health-widget__summary">
                {summary.critical_open > 0 && t(
                    'app.setupHealthWidget.criticalCount',
                    '{{count}} critical',
                    { count: summary.critical_open },
                )}
                {summary.critical_open > 0 && summary.recommended_open > 0 && ' · '}
                {summary.recommended_open > 0 && t(
                    'app.setupHealthWidget.recommendedCount',
                    '{{count}} recommended',
                    { count: summary.recommended_open },
                )}
            </span>
            <span className="setup-health-widget__spacer" />
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate('/monitoring/doctor')}
                title={t('app.setupHealthWidget.moreInDoctor', 'more in Doctor')}
            >
                {t('app.setupHealthWidget.review', 'Review')}
            </Button>
            <Button variant="unstyled"
                type="button"
                className="setup-health-widget__dismiss"
                onClick={dismiss}
                aria-label={t('common.actions.dismiss', 'Dismiss')}
                title={t('app.setupHealthWidget.dismissHint', 'Dismiss (setup health stays in the status bar)')}
            >
                <X size={14} />
            </Button>
        </div>
    );
};

export default SetupHealthWidget;
