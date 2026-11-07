import { ArrowUpCircle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CatalogCard, CatalogGrid } from '@/components/ds';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import PageLoader from '../PageLoader';
import { ExtensionCover } from './ExtensionCover';
import { isUpdatable, minutesSince, versionLabel } from './extensionUpdates';

function CheckedAgo({ checkedAt }) {
    const { t } = useTranslation();
    const min = minutesSince(checkedAt);
    if (min == null) return null;
    return (
        <span className="marketplace-updates__checked">
            {min < 1
                ? t('app.marketplace.checkedJustNow', 'Checked just now')
                : t('app.marketplace.checkedMinAgo', 'Checked {{n}} min ago', { n: min })}
        </span>
    );
}

// Updates tab body: only the cards with a newer version, plus "Check now".
export default function UpdatesView({ store, categories, busyId, onUpdate }) {
    const { t } = useTranslation();
    const { updates, loading, error, loaded, checkedAt, refresh } = store;
    const pending = updates.filter((u) => u.update_available);

    const checkNow = (
        <div className="marketplace-updates__bar">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => refresh({ force: true })}>
                <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
                {t('app.marketplace.checkNow', 'Check now')}
            </Button>
            <CheckedAgo checkedAt={checkedAt} />
        </div>
    );

    if (!loaded) return <PageLoader />;
    if (error && pending.length === 0) {
        return (
            <ErrorState
                title={t('app.marketplace.couldntCheckUpdates', "Couldn't check for updates.")}
                error={error}
                onRetry={() => refresh({ force: true })}
            />
        );
    }
    if (pending.length === 0) {
        return (
            <EmptyState
                icon={CheckCircle2}
                title={t('app.marketplace.allUpToDate', 'All extensions are up to date')}
                action={checkNow}
            />
        );
    }
    return (
        <>
            {checkNow}
            <CatalogGrid>
                {pending.map((u) => {
                    const ok = isUpdatable(u);
                    const reason = !ok
                        ? (u.incompatible_reason || t('app.marketplace.panelVersionIsTooOldFor', 'Panel version is too old for this update'))
                        : u.requires_ack
                            ? t('app.marketplace.needsReview', 'Needs review before updating')
                            : null;
                    return (
                        <CatalogCard
                            key={u.slug}
                            icon={<ExtensionCover base="sk-catalog-card__art" entry={{ installKey: u.slug }} category={categories[u.slug] || 'utility'} brandSize={20} />}
                            title={u.display_name || u.slug}
                            sub={versionLabel(u)}
                            description={reason}
                            facts={reason && (
                                <Badge variant="outline"><Info aria-hidden="true" />{ok ? t('app.marketplace.review', 'Review') : t('app.marketplace.incompatible', 'Incompatible')}</Badge>
                            )}
                            action={ok && (
                                <Button size="sm" disabled={busyId === u.plugin_id} onClick={() => onUpdate(u.plugin_id)}>
                                    <ArrowUpCircle aria-hidden="true" />
                                    {busyId === u.plugin_id ? t('app.marketplace.updating', 'Updating…') : t('app.marketplace.update', 'Update')}
                                </Button>
                            )}
                        />
                    );
                })}
            </CatalogGrid>
        </>
    );
}
