import { useState, useEffect } from 'react';
import api from '../services/api';
import { useTranslation } from 'react-i18next';

/**
 * STAGING banner — a full-width amber strip shown only on the plan-37 staging
 * testbed. Driven by the public /system/health endpoint echoing `staging:true`
 * (set via the SERVERKIT_STAGING env var on the staging instance). Renders
 * nothing on a normal instance and never throws on fetch errors.
 */
const StagingBanner = () => {
    const { t } = useTranslation();
    const [isStaging, setIsStaging] = useState(false);

    useEffect(() => {
        let active = true;
        api.healthCheck()
            .then((health) => {
                if (active && health && health.staging === true) {
                    setIsStaging(true);
                }
            })
            .catch(() => {
                // Health probe failed — treat as a normal (non-staging) instance.
            });
        return () => {
            active = false;
        };
    }, []);

    if (!isStaging) return null;

    return (
        <div className="staging-banner" role="status">
            <span className="staging-banner__label">{t('app.stagingBanner.staging', 'Staging')}</span>
            <span className="staging-banner__text">
                {t('app.stagingBanner.stagingInstanceNotTheLivePanel', 'Staging instance, not the live panel')}
            </span>
        </div>
    );
};

export default StagingBanner;
