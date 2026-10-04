import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { Switch } from '@/components/ui/switch';
import { useToast } from '../../contexts/useToast.js';

// Opt-in PgBouncer beside an installed PostgreSQL (plan 86 §D1). Renders only
// for PostgreSQL installs. Apps keep the direct connection unless they switch
// their reference to `pooledUrl`, because transaction pooling breaks session
// features, and that tradeoff is stated where the choice is made.
export default function PoolerCard({ app }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [state, setState] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getAppPooler(app.id)
            .then((data) => { if (!cancelled) setState(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id]);

    if (!state?.available) return null;

    async function toggle(next) {
        setSaving(true);
        try {
            const data = await api.setAppPooler(app.id, next);
            setState((prev) => ({ ...prev, enabled: data.enabled }));
            if (data.applied === false) {
                toast.warning(t('app.pooler.savedNotApplied', 'Saved, but the pooler could not be started. Check the containers.'));
            } else {
                toast.success(next
                    ? t('app.pooler.on', 'Pooler running at {{host}}:5432', { host: data.host })
                    : t('app.pooler.off', 'Pooler removed'));
            }
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="overview-tab__card overview-tab__card--full pooler">
            <div className="overview-tab__card-header-row">
                <h3 className="overview-tab__card-title">{t('app.pooler.title', 'Connection pooling')}</h3>
                <Switch
                    checked={Boolean(state.enabled)}
                    onCheckedChange={toggle}
                    disabled={saving}
                    aria-label={t('app.pooler.title', 'Connection pooling')}
                />
            </div>
            <p className="pooler__hint">
                {t('app.pooler.hint', 'Runs PgBouncer in transaction mode beside this database, so many app connections share a few server connections. Apps opt in by referencing pooledUrl instead of connectionString.')}
            </p>
            <p className="pooler__tradeoff">
                {t('app.pooler.tradeoff', 'Transaction pooling breaks session features: prepared statements in some drivers, LISTEN/NOTIFY, advisory locks and session SET. Apps keep the direct connection unless they switch.')}
            </p>
        </div>
    );
}
