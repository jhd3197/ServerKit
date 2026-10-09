import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { formatNumber, formatPercent } from '@/utils/intl';
import { toastError } from '@/utils/errorMessage';

const QUERY_PREVIEW_LEN = 160;

function formatMs(ms) {
    if (ms == null) return '—';
    return ms >= 1000
        ? `${formatNumber(ms / 1000, { maximumFractionDigits: 1 })} s`
        : `${formatNumber(ms, { maximumFractionDigits: 1 })} ms`;
}

// Top queries + connection / cache-hit gauges for a Docker database container
// (plan 86 §A3). Read-only, except the one switch PostgreSQL needs before it
// records statements: pg_stat_statements, applied through the config tuner
// (restart included, rollback available there).
export default function InsightsPanel({ conn, engine, isAdmin }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [enabling, setEnabling] = useState(false);
    const inFlight = useRef(false);
    const type = conn?.dockerType || engine;

    const load = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
            setData(await api.getDockerDbInsights(conn.container, type, conn.user, conn.password));
            setError('');
        } catch (err) {
            setError(err.message || t('app.dbInsights.failedToLoad', "Couldn't load insights."));
        } finally {
            inFlight.current = false;
        }
    }, [conn, type, t]);

    useEffect(() => { load(); }, [load]);

    async function enableStatements() {
        if (!await confirm({
            title: t('app.dbInsights.enableTitle', 'Enable pg_stat_statements'),
            message: t('app.dbInsights.enableMessage', 'PostgreSQL restarts once to load the extension; open connections drop. The change can be undone from the config tuner.'),
            confirmText: t('app.dbInsights.enableAndRestart', 'Enable and restart'),
        })) return;
        setEnabling(true);
        try {
            await api.enablePgStatStatements(conn.container, conn.user, conn.password);
            toast.success(t('app.dbInsights.enabled', 'pg_stat_statements is on. Queries show up as they run.'));
            await load();
        } catch (err) {
            toastError(toast, t('app.dbInsights.couldntEnableStatements', "Couldn't turn on pg_stat_statements."), err);
        } finally {
            setEnabling(false);
        }
    }

    if (error) return <div className="dbx-insights"><p className="dbx-insights__error">{error}</p></div>;
    if (!data) return <div className="dbx-insights"><p>{t('common.loading', 'Loading…')}</p></div>;

    const { connections, cache_hit_ratio: hitRatio } = data;
    const connShare = connections?.max ? connections.in_use / connections.max : null;

    return (
        <div className="dbx-insights">
            <div className="dbx-insights__head">
                <div className="dbx-insights__gauges">
                    <div className="dbx-insights__gauge">
                        <span className="dbx-insights__label">{t('app.dbInsights.connections', 'Connections')}</span>
                        <span className="dbx-insights__value">
                            {connections?.in_use ?? '—'} / {connections?.max ?? '—'}
                        </span>
                        {connShare != null && (
                            <span className="dbx-insights__sub">{formatPercent(connShare * 100)}</span>
                        )}
                    </div>
                    <div className="dbx-insights__gauge">
                        <span className="dbx-insights__label">
                            {data.engine === 'postgresql'
                                ? t('app.dbInsights.cacheHitPg', 'Buffer cache hit ratio')
                                : t('app.dbInsights.cacheHitMysql', 'InnoDB buffer pool hit ratio')}
                        </span>
                        <span className="dbx-insights__value">
                            {hitRatio == null ? '—' : formatPercent(hitRatio * 100, { decimals: 1 })}
                        </span>
                    </div>
                </div>
                <Button variant="outline" size="sm" onClick={load}>
                    <RefreshCw size={14} />
                    {t('common.actions.refresh', 'Refresh')}
                </Button>
            </div>

            <h3 className="dbx-insights__title">{t('app.dbInsights.topQueries', 'Top queries by total time')}</h3>
            {data.top_queries_available ? (
                data.top_queries.length ? (
                    <table className="dbx-insights__table">
                        <thead>
                            <tr>
                                <th>{t('app.dbInsights.query', 'Query')}</th>
                                <th>{t('app.dbInsights.calls', 'Calls')}</th>
                                <th>{t('app.dbInsights.total', 'Total')}</th>
                                <th>{t('app.dbInsights.mean', 'Mean')}</th>
                                <th>{t('app.dbInsights.rows', 'Rows')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.top_queries.map((q, i) => (
                                <tr key={`${i}-${q.query.slice(0, 32)}`}>
                                    <td className="dbx-insights__query" title={q.query}>
                                        {q.query.length > QUERY_PREVIEW_LEN
                                            ? `${q.query.slice(0, QUERY_PREVIEW_LEN)}…` : q.query}
                                    </td>
                                    <td>{formatNumber(q.calls)}</td>
                                    <td>{formatMs(q.total_ms)}</td>
                                    <td>{formatMs(q.mean_ms)}</td>
                                    <td>{formatNumber(q.rows)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <p className="dbx-insights__note">{t('app.dbInsights.noQueriesYet', 'No statements recorded yet.')}</p>
                )
            ) : (
                <div className="dbx-insights__note">
                    <p>{data.top_queries_reason}</p>
                    {data.can_enable && isAdmin && (
                        <Button size="sm" onClick={enableStatements} disabled={enabling}>
                            {enabling
                                ? t('app.dbInsights.enabling', 'Restarting…')
                                : t('app.dbInsights.enable', 'Enable pg_stat_statements')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
