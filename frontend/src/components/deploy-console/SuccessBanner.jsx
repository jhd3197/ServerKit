import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Database, ExternalLink, LayoutGrid, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const fmtSeconds = (s) => {
    if (s == null) return '—';
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
};

// Long enough to read the outcome, short enough that you don't sit waiting.
const AUTO_RETURN_SECONDS = 10;

// Completion banner (plan 51 §1.1): total duration, per-step timings, and the
// payoff actions — Open app (when a live URL exists), View service, View
// runtime logs.
//
// `engineTarget` adds one more when the run installed a database engine: the
// thing it created. That is a link first and a timed return second, because the
// log is often the reason you are still on this page — the countdown only arms
// when the console actually watched the run finish, and "Stay here" ends it for
// good.
export default function SuccessBanner({ job, appUrl, engineTarget = null, armAutoReturn = false }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const timings = job?.result?.step_timings || [];
    const appId = job?.app_id;

    const returnTo = engineTarget ? `/databases?engine=${engineTarget.appId}` : null;
    const returnLabel = engineTarget?.database || engineTarget?.name || null;

    const [stayed, setStayed] = useState(false);
    const [countdown, setCountdown] = useState(null);

    useEffect(() => {
        if (!returnTo || !armAutoReturn || stayed) return undefined;
        setCountdown(AUTO_RETURN_SECONDS);
        const timer = setInterval(() => {
            setCountdown((n) => (n == null || n <= 0 ? 0 : n - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [returnTo, armAutoReturn, stayed]);

    useEffect(() => {
        if (countdown === 0 && returnTo && !stayed) navigate(returnTo, { replace: true });
    }, [countdown, returnTo, stayed, navigate]);

    const counting = countdown != null && countdown > 0 && !stayed;

    return (
        <div className="deploy-console__success">
            <div className="deploy-console__success-head">
                <CheckCircle2 size={20} />
                <div>
                    <strong>{t('app.successBanner.deployedSuccessfully', 'Deployed')}</strong>
                    <span className="deploy-console__success-dur">
                        {t('app.successBanner.completedIn', 'Completed in')} {fmtSeconds(job?.duration)}
                    </span>
                </div>
            </div>

            {timings.length > 0 && (
                <ul className="deploy-console__success-timings">
                    {timings.map((t) => (
                        <li key={t.index}>
                            <span>{t.name || `Step ${t.index}`}</span>
                            <span>{fmtSeconds(t.seconds)}</span>
                        </li>
                    ))}
                </ul>
            )}

            {returnTo && (
                <div className="deploy-console__success-return">
                    <span>
                        {counting
                            ? `Opening ${returnLabel} in Databases in ${countdown}s…`
                            : `${returnLabel} is waiting in Databases.`}
                    </span>
                    {counting && (
                        <SharedButton variant="unstyled"
                            type="button"
                            className="deploy-console__btn"
                            onClick={() => { setStayed(true); setCountdown(null); }}
                        >
                            {t('app.successBanner.stayHere', 'Stay here')}
                        </SharedButton>
                    )}
                </div>
            )}

            <div className="deploy-console__success-actions">
                {returnTo && (
                    <Link
                        className="deploy-console__btn deploy-console__btn--primary"
                        to={returnTo}
                        title={t('app.successBanner.openInTheDatabaseExplorer', 'Open {{returnLabel}} in the database explorer', { returnLabel: returnLabel })}
                    >
                        <Database size={14} /> {t('common.actions.open', 'Open')} {returnLabel} {t('app.successBanner.inDatabases', 'in Databases')}
                    </Link>
                )}
                {appUrl && (
                    <a
                        className={`deploy-console__btn${returnTo ? '' : ' deploy-console__btn--primary'}`}
                        href={appUrl}
                        target="_blank"
                        rel="noreferrer"
                    >
                        <ExternalLink size={14} /> {t('app.successBanner.openApp', 'Open service')}
                    </a>
                )}
                {appId && (
                    <Link className="deploy-console__btn" to={`/services/${appId}`}>
                        <LayoutGrid size={14} /> {t('app.successBanner.viewService', 'View service')}
                    </Link>
                )}
                {appId && (
                    <Link className="deploy-console__btn" to={`/services/${appId}/logs`}>
                        <ScrollText size={14} /> {t('app.successBanner.viewRuntimeLogs', 'View runtime logs')}
                    </Link>
                )}
            </div>
        </div>
    );
}
