// The domain portfolio — every domain owned at a connected registrar (GoDaddy,
// …) with its registration expiry. Sourced live from /registrars/domains so it
// works even for domains not yet attached to an app. Renders nothing until a
// registrar is connected (and thus at least one domain comes back), so it stays
// invisible on installs that don't use the feature.
import { useEffect, useState, useCallback } from 'react';
import { Globe, RefreshCw, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

function expiryTone(days) {
    if (days == null) return 'neutral';
    if (days < 0) return 'expired';
    if (days <= 14) return 'danger';
    if (days <= 30) return 'warn';
    return 'ok';
}

export default function RegistrarPortfolio() {
    const { t } = useTranslation();
    const [domains, setDomains] = useState(null); // null = loading
    const [syncing, setSyncing] = useState(false);

    const load = useCallback(async (force) => {
        try {
            const data = force ? await api.syncRegistrarDomains() : await api.getRegistrarDomains();
            setDomains(data.domains || []);
        } catch {
            setDomains([]);
        }
    }, []);

    useEffect(() => { load(false); }, [load]);

    async function refresh() {
        setSyncing(true);
        try { await load(true); } finally { setSyncing(false); }
    }

    // Invisible until at least one registrar domain exists.
    if (!domains || domains.length === 0) return null;

    const expiringSoon = domains.filter((d) => d.days_until_expiry != null && d.days_until_expiry <= 30).length;

    return (
        <section className="reg-portfolio">
            <header className="reg-portfolio__head">
                <div className="reg-portfolio__title">
                    <Globe size={16} />
                    <h2>{t('app.registrarPortfolio.registeredDomains', 'Registered domains')}</h2>
                    <span className="reg-portfolio__count">{domains.length}</span>
                    {expiringSoon > 0 && (
                        <span className="reg-portfolio__warn"><AlertTriangle size={13} /> {expiringSoon} {t('app.registrarPortfolio.expiring30d', 'expiring ≤30d')}</span>
                    )}
                </div>
                <SharedButton variant="unstyled" type="button" className="reg-portfolio__refresh" onClick={refresh} disabled={syncing}>
                    <RefreshCw size={14} className={syncing ? 'is-spinning' : ''} /> {syncing ? t('app.registrarPortfolio.syncing', 'Syncing…') : t('app.registrarPortfolio.sync', 'Sync')}
                </SharedButton>
            </header>

            <div className="reg-portfolio__list">
                {domains.map((d) => {
                    const tone = expiryTone(d.days_until_expiry);
                    const daysLabel = d.days_until_expiry == null ? '—'
                        : d.days_until_expiry < 0 ? 'Expired'
                            : `${d.days_until_expiry}d left`;
                    return (
                        <div key={`${d.registrar}:${d.domain}`} className="reg-portfolio__row">
                            <span className="reg-portfolio__domain">{d.domain}</span>
                            <span className="reg-portfolio__via">{d.registrar_name || d.registrar}</span>
                            <span className={`reg-portfolio__expiry reg-portfolio__expiry--${tone}`}>{daysLabel}</span>
                            <span className="reg-portfolio__date">
                                {d.expires_at ? new Date(d.expires_at).toLocaleDateString() : ''}
                            </span>
                            {d.auto_renew != null && (
                                <span className={`reg-portfolio__renew${d.auto_renew ? ' is-on' : ''}`}>
                                    {d.auto_renew ? t('app.registrarPortfolio.autoRenew', 'Auto-renew') : t('app.registrarPortfolio.manual', 'Manual')}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
