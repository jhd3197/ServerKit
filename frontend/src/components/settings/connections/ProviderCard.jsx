// One provider tile in the Connections hub. Presentational only — the hub
// computes a `summary` ({ connected, statusLabel, statusTone, subtitle, scopes,
// manageHref, manageLabel }) and the card just renders it. "Coming soon"
// providers render dimmed with no action so the catalog reads as complete
// without overpromising.
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProviderBrandIcon } from '../../icons/ProviderBrands';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

export default function ProviderCard({ provider, summary, onManage }) {
    const { t } = useTranslation();
    const comingSoon = provider.comingSoon;
    const connected = !comingSoon && summary?.connected;

    // A failed status read is not "Not connected": no Connect call to action.
    const loadFailed = !comingSoon && summary?.loadFailed;
    const statusLabel = comingSoon ? 'Soon' : (summary?.statusLabel || 'Not connected');
    const statusTone = comingSoon ? 'soon' : (summary?.statusTone || 'neutral');

    return (
        <div className={`conn-card${comingSoon ? ' conn-card--soon' : ''}${connected ? ' conn-card--connected' : ''}`}>
            <div className="conn-card__top">
                <span className="conn-card__icon">
                    <ProviderBrandIcon provider={provider.id} size={22} />
                </span>
                <div className="conn-card__heading">
                    <h4 className="conn-card__name">{provider.name}</h4>
                    <p className="conn-card__blurb">{provider.blurb}</p>
                </div>
                <span className={`conn-status conn-status--${statusTone}`}>{statusLabel}</span>
            </div>

            {connected && (summary.subtitle || summary.scopes?.length > 0) && (
                <div className="conn-card__meta">
                    {summary.subtitle && <span className="conn-card__subtitle">{summary.subtitle}</span>}
                    {summary.scopes?.length > 0 && (
                        <span className="conn-card__scopes">
                            {summary.scopes.map((s, i) => (
                                <span key={i} className={`conn-pill conn-pill--${s.tone}`} title={s.hint}>{s.label}</span>
                            ))}
                        </span>
                    )}
                </div>
            )}

            <div className="conn-card__actions">
                {connected && summary.manageHref ? (
                    <Link className="conn-card__crosslink" to={summary.manageHref}>
                        {summary.manageLabel || 'Open'} <ArrowUpRight size={14} />
                    </Link>
                ) : <span />}

                {loadFailed ? (
                    <span />
                ) : comingSoon ? (
                    <span className="conn-card__soon-tag">{t('app.providerCard.comingSoon', 'Coming soon')}</span>
                ) : (
                    <Button variant={connected ? 'outline' : 'default'} size="sm" onClick={() => onManage(provider)}>
                        {connected ? 'Manage' : 'Connect'}
                        <ArrowRight size={15} />
                    </Button>
                )}
            </div>
        </div>
    );
}
