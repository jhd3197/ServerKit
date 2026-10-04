import { CloudCog, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useLabel from '../i18n/labels';
import { MANAGED_CAPABILITY_MAP } from './sidebarItems';

// The managed card (plan 25): what a held capability's page shows instead of
// its content. It names the capability, who holds it and since when, and links
// to the server's page in ServerKit Cloud through the support URL the signed
// policy carried. It never claims the page is gone — hidden is not removed:
// the route still renders, the API still answers, and support, break-glass and
// exports keep working.
//
// `compact` is the card in miniature, for the spot an in-page control used to
// occupy (the self-update section in Settings › About, backup scheduling).
export default function ManagedCard({ capability, profile, compact = false }) {
    const { t } = useTranslation();
    const label_ = useLabel();
    const entry = MANAGED_CAPABILITY_MAP[capability];
    const label = entry ? label_(entry) : capability;
    const heldBy = profile?.held_by || 'ServerKit Cloud';
    const since = profile?.since
        ? new Date(profile.since).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    return (
        <div
            className={`managed-card${compact ? ' managed-card--compact' : ''}`}
            data-testid={compact ? `managed-card-${capability}` : 'managed-card'}
            data-capability={capability}
        >
            <div className="managed-card__icon">
                <CloudCog size={compact ? 24 : 48} />
            </div>
            <h3 className="managed-card__title">
                {t('managed.card.title', '{{label}} is managed by {{heldBy}}', { label, heldBy })}
            </h3>
            <p className="managed-card__body">
                {since
                    ? t('managed.card.bodySince', 'ServerKit Cloud took this over on {{date}} as part of your Managed service. The page is hidden, not removed. Its API still answers and everything returns the moment the Managed scope ends.', { date: since })
                    : t('managed.card.body', 'ServerKit Cloud takes care of this as part of your Managed service. The page is hidden, not removed. Its API still answers and everything returns the moment the Managed scope ends.')}
                {capability === 'updates' && (
                    <> {t('managed.card.updatesNote', 'The panel still updates itself; only the update screens are hidden.')}</>
                )}
            </p>
            {profile?.support_url && (
                <div className="managed-card__action">
                    <a
                        className="btn btn-primary"
                        href={profile.support_url}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="managed-card-open-cloud"
                    >
                        <ExternalLink size={15} />
                        {t('managed.card.openCloud', 'Open in ServerKit Cloud')}
                    </a>
                </div>
            )}
        </div>
    );
}
