import { AlertTriangle } from 'lucide-react';
import { useResourceTier } from '../contexts/useResourceTier.js';
import { useTranslation } from 'react-i18next';

// Approximate steady-state RSS per workload, mirroring WORKLOAD_FOOTPRINTS_MB
// in backend/app/services/resource_tier_service.py. Only used for the copy —
// the fit decision itself comes from the backend's headroom.fits map.
const WORKLOAD_LABELS = {
    wordpress: { name: 'A WordPress site', needsMb: 512 },
    database: { name: 'A database', needsMb: 384 },
    node: { name: 'A Node app', needsMb: 192 },
    python: { name: 'A Python app', needsMb: 192 },
};

/**
 * Inline capacity warning shown at the point of action.
 *
 * This deliberately does not block anything. The panel's job is to tell the
 * operator what their server can carry, not to overrule them on their own
 * hardware — a hard gate reads like a paywall and is wrong the moment the VPS
 * is resized. Renders nothing when the workload comfortably fits.
 */
const ResourceAdvisory = ({ workload = 'wordpress' }) => {
    const { t } = useTranslation();
    const { headroom, loading } = useResourceTier();

    if (loading || !headroom) return null;

    const fits = headroom.fits?.[workload];
    if (fits !== false) return null;

    const meta = WORKLOAD_LABELS[workload] || {
        name: 'This workload',
        needsMb: null,
    };
    const free = headroom.ram_for_apps_mb;

    return (
        <div className="resource-advisory">
            <AlertTriangle size={18} className="resource-advisory__icon" />
            <div className="resource-advisory__body">
                <div className="resource-advisory__title">
                    {t('app.resourceAdvisory.tightOnMemory', 'Tight on memory:')} {headroom.summary}
                </div>
                <p className="resource-advisory__text">
                    {meta.name} {t('app.resourceAdvisory.typicallyNeedsAbout', 'typically needs about')} {meta.needsMb} {t('app.resourceAdvisory.mbAndThisServerHas', 'MB and this server has')} {free} {t('app.resourceAdvisory.mbFreeForWorkloadsYouCan', 'MB free for workloads. You can still create one; expect it to be slow or to get OOM-killed under load. Adding RAM or swap fixes it.')}
                </p>
                {headroom.warnings?.length > 0 && (
                    <ul className="resource-advisory__list">
                        {headroom.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default ResourceAdvisory;
