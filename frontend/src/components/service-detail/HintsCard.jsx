import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';

// "Where is it slow?" (plan 86 §A5): rule-based hints from the app's request
// metrics, its container CPU and its database. Each names the component that
// fits the signal and that component's failure mode; nothing is ever added
// for you. Renders nothing when there is no hint.
export default function HintsCard({ app }) {
    const { t } = useTranslation();
    const [hints, setHints] = useState([]);

    useEffect(() => {
        let cancelled = false;
        api.getAppHints(app.id)
            .then((data) => { if (!cancelled) setHints(data.hints || []); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id]);

    if (!hints.length) return null;

    const text = (hint) => {
        const p = hint.params || {};
        switch (hint.id) {
        case 'crash_loop':
            return {
                signal: t('app.hints.crashLoopSignal', '{{count}} restarts in the last 10 minutes.', { count: p.restarts }),
                hint: t('app.hints.crashLoop', 'The service keeps crashing and Docker keeps restarting it. Read its logs from just before a restart; no cache or database change helps until it stays up.'),
                failure: t('app.hints.crashLoopFailure', 'A restart policy hides a crash: the service looks running between crashes.'),
            };
        case 'app_bound':
            return {
                signal: t('app.hints.appBoundSignal', 'p95 {{ms}} ms while the service uses {{cpu}}% CPU and its database is idle.', { ms: p.p95_ms, cpu: p.cpu }),
                hint: t('app.hints.appBound', 'The service itself is the bottleneck. Cache whole pages in front of it, or give it a bigger server.'),
                failure: t('app.hints.appBoundFailure', 'A cached page can be stale for up to its lifetime.'),
            };
        case 'database_bound':
            return {
                signal: p.share
                    ? t('app.hints.dbBoundSignalShare', 'p95 {{ms}} ms while {{db}} uses {{cpu}}% CPU; one query takes {{share}}% of its time.', { ms: p.p95_ms, db: p.database, cpu: p.cpu, share: p.share })
                    : t('app.hints.dbBoundSignal', 'p95 {{ms}} ms while {{db}} uses {{cpu}}% CPU.', { ms: p.p95_ms, db: p.database, cpu: p.cpu }),
                hint: p.share
                    ? t('app.hints.dbBoundRepeated', 'The same query dominates: cache its result, or add an index for it (see the query in the database Insights tab).')
                    : t('app.hints.dbBound', 'The database is the bottleneck. Look at its top queries for a missing index, or cache what is read most.'),
                failure: t('app.hints.dbBoundFailure', 'Cached data can be stale; invalidate on write.'),
            };
        case 'deploy_errors':
            return {
                signal: t('app.hints.deployErrorsSignal', '{{count}} server errors during deploys in the last 24 hours.', { count: p.errors }),
                hint: t('app.hints.deployErrors', 'Visitors hit the gap while the old container stops and the new one starts. Slot deploys will keep the old copy serving until the new one passes its health check.'),
                failure: t('app.hints.deployErrorsFailure', 'Two copies run briefly during the switch; a migration must work with both.'),
            };
        case 'low_hit_ratio':
            return {
                signal: t('app.hints.lowHitSignal', 'Micro-cache hit ratio {{ratio}}%.', { ratio: p.ratio }),
                hint: t('app.hints.lowHit', 'Most cacheable requests miss. The pages may vary per visitor, or the cache lifetime is too short for the traffic.'),
                failure: t('app.hints.lowHitFailure', 'A longer lifetime serves older pages.'),
            };
        default:
            return { signal: hint.signal, hint: hint.hint, failure: hint.failure_mode };
        }
    };

    const actionLink = (action) => {
        if (!action) return null;
        const targets = {
            'settings/cache': { to: `/services/${app.id}/settings/cache`, label: t('app.hints.openMicroCache', 'Open micro-cache settings') },
            logs: { to: `/services/${app.id}/logs`, label: t('app.hints.openLogs', 'Open logs') },
        };
        const { to = null, label = t('app.hints.attachCache', 'Attach a cache') } = targets[action.target] || {};
        return to
            ? <Link to={to} className="hints__action">{label}</Link>
            : <span className="hints__action hints__action--here">{label}</span>;
    };

    return (
        <div className="overview-tab__card overview-tab__card--full hints">
            <div className="overview-tab__card-header-row">
                <h3 className="overview-tab__card-title">
                    <Lightbulb size={14} aria-hidden="true" /> {t('app.hints.title', 'Where it is slow')}
                </h3>
                <span className="hints__window">{t('app.hints.window', 'Last 24 hours')}</span>
            </div>
            <ul className="hints__list">
                {hints.map((hint) => {
                    const copy = text(hint);
                    return (
                        <li key={hint.id} className="hints__item">
                            <p className="hints__signal">{copy.signal}</p>
                            <p className="hints__hint">{copy.hint}</p>
                            <p className="hints__failure">{copy.failure}</p>
                            {actionLink(hint.action)}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
