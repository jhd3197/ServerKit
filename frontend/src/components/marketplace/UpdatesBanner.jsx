import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import InfoTip from '@/components/InfoTip';

// Compact strip shown on every Extensions view while updates are pending.
export default function UpdatesBanner({ count, readyCount, progress, onUpdateAll }) {
    const { t } = useTranslation();
    if (!count) return null;
    const running = Boolean(progress);
    return (
        <div className="marketplace-banner" role="status">
            <ArrowUpCircle size={18} aria-hidden="true" className="marketplace-banner__icon" />
            <span className="marketplace-banner__text">
                {t('app.marketplace.updatesAvailable', { count, defaultValue_one: '1 update available', defaultValue_other: '{{count}} updates available' })}
            </span>
            <InfoTip title={t('app.marketplace.updates', 'Updates')}>
                {t('app.marketplace.updatesInfo', 'Updates come from the registry and bundled sources. Update all skips anything that needs review or fails; update those one by one.')}
            </InfoTip>
            {readyCount > 0 && (
                <Button size="sm" className="marketplace-banner__action" disabled={running} onClick={onUpdateAll}>
                    {running
                        ? <Loader2 className="animate-spin" aria-hidden="true" />
                        : <ArrowUpCircle aria-hidden="true" />}
                    {running
                        ? `${progress.done}/${progress.total}`
                        : t('app.marketplace.updateAll', 'Update all')}
                </Button>
            )}
        </div>
    );
}
