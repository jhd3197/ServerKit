// The monitor half of the Monitoring overview: availability KPIs, the live
// check feed and the monitor table.
//
// This is what the page was missing — everything else on Overview describes the
// machines ServerKit runs on, and nothing described the things it is supposed to
// be watching. Host health stays below; this sits above it because "is the site
// up" is the question the page is actually for.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Plus, Radar, ShieldAlert, Timer, Zap } from 'lucide-react';
import api from '../../services/api';
import { AreaChart, KpiBand, MetricCard, Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { monitorStateOf } from './monitorShared';
import { usePolling } from '../../hooks/usePolling';
import { useTranslation } from 'react-i18next';

const POLL_MS = 15000;
const FEED_LIMIT = 9;

function relativeTime(iso) {
    if (!iso) return 'never';
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (Number.isNaN(seconds)) return '—';
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
}

export default function MonitorsSummary({ refreshKey = 0 }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [monitors, setMonitors] = useState([]);
    const [stats, setStats] = useState(null);
    const [feed, setFeed] = useState([]);
    const [loaded, setLoaded] = useState(false);

    const load = useCallback(async () => {
        try {
            const [listRes, statsRes] = await Promise.all([
                api.getMonitors(),
                api.getMonitorStats().catch(() => null),
            ]);
            const list = listRes?.monitors || [];
            setMonitors(list);
            setStats(statsRes?.stats || null);

            // The live feed is the most recently checked monitors, newest first —
            // derived from what we already fetched rather than a second request
            // per monitor.
            setFeed(
                [...list]
                    .filter((m) => m.last_check_at && !m.is_paused)
                    .sort((a, b) => new Date(b.last_check_at) - new Date(a.last_check_at))
                    .slice(0, FEED_LIMIT),
            );
        } catch {
            // Overview must survive a monitors outage; the rest of the page is fine.
        } finally {
            setLoaded(true);
        }
    }, []);

    const refresh = usePolling(load, POLL_MS);

    // The parent bumps refreshKey to force a reload (e.g. after creating a
    // monitor); it is not part of the polling schedule.
    useEffect(() => {
        if (refreshKey) refresh();
    }, [refreshKey, refresh]);

    if (!loaded) return null;

    if (!monitors.length) {
        return (
            <section className="monitoring-panel mon-nomonitors">
                <div className="monitoring-panel__header">
                    <div>
                        <h3>{t('app.monitorsSummary.monitors', 'Monitors')}</h3>
                        <span className="mon-panel-sub">{t('app.monitorsSummary.nothingIsBeingWatchedYet', 'Nothing is being watched yet')}</span>
                    </div>
                    <Button size="sm" onClick={() => navigate('/monitoring/monitors')}>
                        <Plus size={14} /> {t('app.monitorsSummary.addMonitor', 'New monitor')}
                    </Button>
                </div>
                <p className="mon-panel-hint">
                    {t('app.monitorsSummary.everythingBelowDescribesTheMachinesServerkit', 'Everything below describes the servers ServerKit runs on. Add a monitor to watch a website, an API endpoint, a database port or a WordPress site and get an incident when it stops answering.')}
                </p>
            </section>
        );
    }

    const responseTimes = monitors
        .filter((m) => m.last_response_time != null && !m.is_paused)
        .map((m) => m.last_response_time);
    const avgResponse = responseTimes.length
        ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
        : null;
    // The busiest monitor's recent latency stands in for "how are we doing" —
    // averaging series of different lengths across monitors would be a lie.
    const leadSpark = monitors.reduce(
        (best, m) => ((m.spark?.length || 0) > (best?.spark?.length || 0) ? m : best),
        null,
    );

    return (
        <div className="mon-monitors-summary">
            <KpiBand max={4}>
                <MetricCard
                    label={t('app.monitorsSummary.availability30d', 'Availability (30d)')} tone="green" icon={<Activity size={17} />}
                    value={stats?.overall_uptime_30d != null ? `${stats.overall_uptime_30d}%` : '—'}
                    onClick={() => navigate('/monitoring/monitors')}
                />
                <MetricCard
                    label={t('app.monitorsSummary.avgResponse', 'Avg response')} tone="cyan" icon={<Zap size={17} />}
                    value={avgResponse ?? '—'} unit={avgResponse != null ? 'ms' : undefined}
                    spark={leadSpark?.spark?.length > 1 ? (
                        <AreaChart series={[leadSpark.spark]} colors={['var(--cyan)']} height={34} grid={false} />
                    ) : undefined}
                />
                <MetricCard
                    label={t('app.monitorsSummary.monitorsDown', 'Monitors down')} tone={stats?.down ? 'red' : 'green'} icon={<ShieldAlert size={17} />}
                    value={stats?.down ?? 0}
                    onClick={() => navigate('/monitoring/monitors')}
                />
                <MetricCard
                    label={t('app.monitorsSummary.degraded', 'Degraded')} tone="amber" icon={<Timer size={17} />}
                    value={stats?.degraded ?? 0}
                    onClick={() => navigate('/monitoring/monitors')}
                />
            </KpiBand>

            <div className="mon-grid2">
                <section className="monitoring-panel">
                    <div className="monitoring-panel__header">
                        <div>
                            <h3>{t('app.monitorsSummary.monitors', 'Monitors')}</h3>
                            <span className="mon-panel-sub">{monitors.length} watched</span>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                            <Link to="/monitoring/monitors"><Radar size={14} /> {t('app.monitorsSummary.manage', 'Manage')}</Link>
                        </Button>
                    </div>
                    <div className="mon-monitor-list">
                        {monitors.slice(0, 8).map((monitor) => {
                            const state = monitorStateOf(monitor);
                            return (
                                <Link
                                    key={monitor.id}
                                    className="mon-monitor-row"
                                    to={`/monitoring/monitors/${monitor.id}`}
                                >
                                    <span className="mon-monitor-row__body">
                                        <span className="mon-monitor-row__name">{monitor.name}</span>
                                        <span className="mon-monitor-row__sub">
                                            {monitor.check_type} · {monitor.check_target || t('app.monitorsSummary.boundSite', 'bound site')}
                                        </span>
                                    </span>
                                    <span className="mon-monitor-row__ms">
                                        {monitor.last_response_time == null ? '—' : `${monitor.last_response_time} ms`}
                                    </span>
                                    <Pill kind={state.tone}>{state.label}</Pill>
                                </Link>
                            );
                        })}
                    </div>
                </section>

                <section className="monitoring-panel">
                    <div className="monitoring-panel__header">
                        <div>
                            <h3>{t('app.monitorsSummary.liveChecks', 'Live checks')}</h3>
                            <span className="mon-panel-sub">{t('app.monitorsSummary.mostRecentResults', 'Most recent results')}</span>
                        </div>
                    </div>
                    {feed.length === 0 ? (
                        <p className="mon-panel-hint">
                            {t('app.monitorsSummary.noChecksRecordedYetTheScheduler', "No checks recorded yet. The scheduler polls on each monitor's interval.")}
                        </p>
                    ) : (
                        <div className="mon-feed">
                            {feed.map((monitor) => {
                                const state = monitorStateOf(monitor);
                                const ok = state.key === 'up';
                                return (
                                    <Link
                                        key={monitor.id}
                                        className="mon-feed-row"
                                        to={`/monitoring/monitors/${monitor.id}`}
                                    >
                                        <span className={`mon-code mon-code--${ok ? 'ok' : 'bad'}`}>
                                            {ok ? 'ok' : state.label.toLowerCase()}
                                        </span>
                                        <span className="mon-feed-row__body">
                                            <span className="mon-feed-row__name">{monitor.name}</span>
                                            <span className="mon-feed-row__sub">
                                                {relativeTime(monitor.last_check_at)}
                                            </span>
                                        </span>
                                        <span className="mon-feed-row__ms">
                                            {monitor.last_response_time == null ? 'fail' : `${monitor.last_response_time}ms`}
                                        </span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
