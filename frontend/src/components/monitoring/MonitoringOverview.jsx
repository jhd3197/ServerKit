import { useState, useEffect, useMemo } from 'react';
import {
    ArrowDown, ArrowUp, Boxes, Cpu, Gauge as GaugeIcon, HardDrive,
    MemoryStick, Server as ServerIcon, Siren, Timer, Zap,
} from 'lucide-react';
import api from '../../services/api';
import { formatBytes } from '@/utils/formatBytes';
import { AreaChart, KpiBand, MetricCard, Pill, Sparkline } from '@/components/ds';
import { Button } from '@/components/ui/button';
import EmptyState from '../EmptyState';
import MonitorsSummary from './MonitorsSummary';
import DiskReclaimModal from './DiskReclaimModal';
import { HOST_SCOPE, useScopeMetrics, trendOf } from './useMonitorScope';
import { useTranslation } from 'react-i18next';

const PERIODS = ['1h', '6h', '24h', '7d'];

// Tint per metric, matching the Servers list convention (CPU accent / RAM cyan
// / disk green) so the same metric is the same color everywhere in the panel.
// Two spellings of one decision: charts take a colour prop, MetricCard takes a
// design-system tone name.
const TONE = {
    cpu: 'var(--accent-bright)',
    memory: 'var(--cyan)',
    disk: 'var(--green)',
    extra: 'var(--violet)',
};

const TILE_TONE = { cpu: 'accent', memory: 'cyan', disk: 'green', extra: 'violet' };

function fmt(value, digits = 1) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toFixed(digits);
}

function last(series) {
    return series?.length ? series[series.length - 1] : null;
}

// One overview for every host: the KPI band, the two trend charts and the
// alerts panel describe whichever server the top-bar scope picker names, and
// the Host health grid below is how you switch between them. That grid is what
// the standalone Fleet Monitor page used to be — a heatmap you had to leave
// this page to read, for numbers that belong next to these ones.
export default function MonitoringOverview({
    scope, isHost, scopeLabel, status, activeAlerts = [],
    speedTest, speedTestRunning, onRunSpeedTest,
    thresholds = {}, onScopeChange, refreshKey = 0,
}) {
    const { t } = useTranslation();
    const [period, setPeriod] = useState('24h');
    const [reclaimOpen, setReclaimOpen] = useState(false);
    const { series, loading } = useScopeMetrics(scope, period, refreshKey);

    // The fleet strip: current values per server in one call, CPU history for
    // all of them in a second — rather than one history request per card.
    const [fleet, setFleet] = useState([]);
    const [fleetSpark, setFleetSpark] = useState({});
    // The panel host isn't in the fleet comparison (it has no agent row), so its
    // card would be the only one in the strip without a line. One extra call
    // buys it the same trend as every other card, whatever the current scope.
    const [hostSpark, setHostSpark] = useState(null);

    useEffect(() => {
        let cancelled = false;
        api.getMetricsHistory(period)
            .then((res) => {
                if (cancelled) return;
                const points = Array.isArray(res?.data) ? res.data : [];
                setHostSpark(points.map((p) => p.cpu?.percent ?? p.cpu_percent ?? 0));
            })
            .catch(() => { if (!cancelled) setHostSpark(null); });
        return () => { cancelled = true; };
    }, [period, refreshKey]);

    useEffect(() => {
        let cancelled = false;
        api.getFleetHeatmap()
            .then((rows) => {
                if (cancelled) return;
                const list = Array.isArray(rows) ? rows : [];
                setFleet(list);
                if (!list.length) return;
                return api.getFleetComparison(list.map((r) => r.id), 'cpu', period)
                    .then((res) => {
                        if (cancelled) return;
                        const byServer = {};
                        (res?.series || []).forEach((s) => {
                            byServer[s.server_id] = (s.data || []).map((p) => p.value ?? 0);
                        });
                        setFleetSpark(byServer);
                    })
                    .catch(() => { if (!cancelled) setFleetSpark({}); });
            })
            .catch(() => { if (!cancelled) setFleet([]); });
        return () => { cancelled = true; };
    }, [period, refreshKey]);

    const hostMetrics = useMemo(() => status?.current_metrics || {}, [status?.current_metrics]);
    const scopeRow = !isHost ? fleet.find((r) => String(r.id) === String(scope)) : null;

    // Current value per metric: the live reading for the panel host, the newest
    // stored sample for a paired server (whose agent reports on its own cadence).
    const current = useMemo(() => {
        if (isHost) {
            return {
                cpu: hostMetrics?.cpu?.percent,
                memory: hostMetrics?.memory?.percent,
                disk: hostMetrics?.disk?.percent,
                load: hostMetrics?.load_average?.['1min'],
                containers: null,
            };
        }
        return {
            cpu: scopeRow?.cpu ?? last(series?.cpu),
            memory: scopeRow?.memory ?? last(series?.memory),
            disk: scopeRow?.disk ?? last(series?.disk),
            load: null,
            containers: scopeRow?.containers ?? null,
        };
    }, [isHost, hostMetrics, scopeRow, series]);

    const tiles = [
        {
            key: 'cpu',
            labelKey: 'app.monitoringOverview.cpuUsage', label: 'CPU usage',
            icon: Cpu,
            value: fmt(current.cpu),
            unit: '%',
            spark: series?.cpu,
            tone: 'cpu',
            sub: isHost && hostMetrics.cpu?.cores ? `${hostMetrics.cpu.cores} cores` : null,
            limit: thresholds.cpu_percent,
        },
        {
            key: 'memory',
            labelKey: 'app.monitoringOverview.memoryUsage', label: 'Memory usage',
            icon: MemoryStick,
            value: fmt(current.memory),
            unit: '%',
            spark: series?.memory,
            tone: 'memory',
            sub: isHost && hostMetrics.memory?.total
                ? `${formatBytes(hostMetrics.memory.used)} / ${formatBytes(hostMetrics.memory.total)}`
                : null,
            limit: thresholds.memory_percent,
        },
        {
            key: 'disk',
            labelKey: 'app.monitoringOverview.diskUsage', label: 'Disk usage',
            icon: HardDrive,
            value: fmt(current.disk),
            unit: '%',
            spark: series?.disk,
            tone: 'disk',
            sub: isHost && hostMetrics.disk?.total
                ? `${formatBytes(hostMetrics.disk.used)} / ${formatBytes(hostMetrics.disk.total)}`
                : null,
            limit: thresholds.disk_percent,
        },
        // The fourth tile is the one thing each scope has that the other
        // doesn't: load average is a local reading, container count comes off
        // the agent. Same slot, different question.
        isHost
            ? {
                key: 'load',
                labelKey: 'app.monitoringOverview.loadAverage', label: 'Load average',
                icon: GaugeIcon,
                value: fmt(current.load, 2),
                unit: '',
                spark: null,
                tone: 'extra',
                sub: `5m ${fmt(hostMetrics.load_average?.['5min'], 2)} · 15m ${fmt(hostMetrics.load_average?.['15min'], 2)}`,
                limit: thresholds.load_average,
            }
            : {
                key: 'containers',
                labelKey: 'app.monitoringOverview.containersRunning', label: 'Containers running',
                icon: Boxes,
                value: current.containers == null ? '—' : String(current.containers),
                unit: '',
                spark: null,
                tone: 'extra',
                sub: scopeRow?.status ? `agent ${scopeRow.status}` : null,
                limit: null,
            },
    ];

    const online = fleet.filter((s) => s.status === 'online').length;

    return (
        <div className="mon-overview">
            {/* Monitors first: "is the site up" is the question this page is
                for, and everything below describes the machines ServerKit runs
                on rather than the things it is watching. */}
            <MonitorsSummary refreshKey={refreshKey} />

            <div className="mon-section-head">
                <h3>{t('app.monitoringOverview.hostHealth', 'Host health')}</h3>
                <span className="mon-section-head__meta">{scopeLabel}</span>
            </div>

            {/* The shared DS tile, not a monitoring-only copy of it — same
                geometry as every other KPI strip in the panel, plus the
                sparkline slot this page needed. */}
            <KpiBand max={4}>
                {tiles.map((tile) => {
                    const numeric = Number(tile.value);
                    const alerting = tile.limit != null && !Number.isNaN(numeric) && numeric > tile.limit;
                    const trend = trendOf(tile.spark);
                    return (
                        <MetricCard
                            key={tile.key}
                            tone={alerting ? 'amber' : TILE_TONE[tile.tone]}
                            className={alerting ? 'is-alerting' : undefined}
                            icon={<tile.icon size={16} />}
                            value={tile.value}
                            unit={tile.unit || undefined}
                            label={tile.label}
                            trend={trend == null ? undefined : (
                                <>
                                    {trend > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                                    {Math.abs(trend).toFixed(1)}
                                </>
                            )}
                            // On a resource gauge, "up" is the bad direction —
                            // rising CPU is not good news the way rising revenue
                            // would be, so the tones are deliberately inverted.
                            trendDir={trend == null ? 'flat' : trend > 0 ? 'down' : 'up'}
                            spark={tile.spark?.length > 1 ? (
                                <AreaChart
                                    series={[tile.spark]}
                                    colors={[alerting ? 'var(--amber)' : TONE[tile.tone]]}
                                    height={34}
                                    grid={false}
                                />
                            ) : undefined}
                        >
                            {tile.sub && <div className="sk-kpi__sub"><span>{tile.sub}</span></div>}
                            {/* A full disk is the one tile alert that comes with
                                its own fix: the curated safe reclaim. Host-only —
                                agents reclaim on their own boxes. */}
                            {isHost && tile.key === 'disk' && alerting && (
                                <Button size="sm" variant="ghost" onClick={() => setReclaimOpen(true)}>
                                    <HardDrive size={12} />
                                    {t('app.diskReclaim.reclaimSpace', 'Reclaim space')}
                                </Button>
                            )}
                        </MetricCard>
                    );
                })}
            </KpiBand>

            <div className="mon-grid2">
                <section className="monitoring-panel">
                    <div className="monitoring-panel__header">
                        <div>
                            <h3>{t('app.monitoringOverview.processor', 'Processor')}</h3>
                            <span className="mon-panel-sub">{scopeLabel} {t('app.monitoringOverview.cpuLast', '· CPU % · last')} {period}</span>
                        </div>
                        <div className="mon-period-switch" role="group" aria-label={t('app.monitoringOverview.chartPeriod', 'Chart period')}>
                            {PERIODS.map((p) => (
                                <Button
                                    key={p}
                                    size="sm"
                                    variant={period === p ? 'default' : 'ghost'}
                                    onClick={() => setPeriod(p)}
                                >
                                    {p}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <ChartBody loading={loading} values={series?.cpu}>
                        <AreaChart series={[series?.cpu || []]} colors={[TONE.cpu]} height={180} />
                    </ChartBody>
                </section>

                <section className="monitoring-panel">
                    <div className="monitoring-panel__header">
                        <div>
                            <h3>{t('app.monitoringOverview.memoryDisk', 'Memory and disk')}</h3>
                            <span className="mon-panel-sub">{scopeLabel} {t('app.monitoringOverview.percentUsedLast', '· percent used · last')} {period}</span>
                        </div>
                        <div className="mon-legend">
                            <span><i className="is-memory" />{t('common.labels.memory', 'Memory')}</span>
                            <span><i className="is-disk" />{t('common.labels.disk', 'Disk')}</span>
                        </div>
                    </div>
                    <ChartBody loading={loading} values={series?.memory}>
                        <AreaChart
                            series={[series?.memory || [], series?.disk || []]}
                            colors={[TONE.memory, TONE.disk]}
                            height={180}
                        />
                    </ChartBody>
                </section>
            </div>

            {/* The fleet, inline. Clicking a card re-scopes everything above it,
                which is the whole reason this replaced a separate page. */}
            {fleet.length > 0 && (
                <>
                    <div className="mon-section-head">
                        <h3>{t('app.monitoringOverview.allHosts', 'All hosts')}</h3>
                        <span className="mon-section-head__meta">
                            {online}/{fleet.length} {t('app.monitoringOverview.onlineClickACardToRe', 'online · click a card to re-scope')}
                        </span>
                    </div>
                    <div className="mon-fleet-grid">
                        {/* Always the panel host's own numbers, never the
                            scoped ones — a card in this strip has to keep
                            describing its own machine while another is
                            selected, or the strip stops being a comparison. */}
                        <HostCard
                            active={isHost}
                            name="This server"
                            sub="Panel host"
                            status={status?.enabled ? 'online' : 'idle'}
                            cpu={hostMetrics.cpu?.percent}
                            memory={hostMetrics.memory?.percent}
                            disk={hostMetrics.disk?.percent}
                            spark={hostSpark}
                            onClick={() => onScopeChange(HOST_SCOPE)}
                        />
                        {fleet.map((s) => (
                            <HostCard
                                key={s.id}
                                active={String(scope) === String(s.id)}
                                name={s.name}
                                sub={s.group_name || 'Ungrouped'}
                                status={s.status}
                                cpu={s.cpu}
                                memory={s.memory}
                                disk={s.disk}
                                spark={fleetSpark[s.id]}
                                onClick={() => onScopeChange(s.id)}
                            />
                        ))}
                    </div>
                </>
            )}

            <div className="mon-grid2">
                <section className={`monitoring-panel${activeAlerts.length ? ' monitoring-panel--warning' : ''}`}>
                    <div className="monitoring-panel__header">
                        <h3>{t('app.monitoringOverview.activeAlerts', 'Active alerts')}</h3>
                        <span className="mon-panel-sub">{activeAlerts.length} firing</span>
                    </div>
                    {activeAlerts.length === 0 ? (
                        <p className="mon-panel-hint"><Siren size={14} /> {t('app.monitoringOverview.nothingIsOverItsLimitRight', 'Nothing is over its limit right now.')}</p>
                    ) : (
                        <div className="mon-alert-list">
                            {activeAlerts.map((alert, i) => (
                                <div key={`${alert.type}-${i}`} className="mon-alert-row">
                                    <span className={`mon-sev mon-sev--${alert.severity}`} />
                                    <div className="mon-alert-row__body">
                                        <div className="mon-alert-row__title">{alert.message}</div>
                                        <div className="mon-alert-row__sub">
                                            {alert.type} · {fmt(alert.value)} / {alert.threshold}
                                        </div>
                                    </div>
                                    <span className="mon-state mon-state--red">firing</span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="monitoring-panel">
                    <div className="monitoring-panel__header">
                        <h3>{t('app.monitoringOverview.speedTest', 'Speed test')}</h3>
                        <Button size="sm" variant="outline" onClick={onRunSpeedTest} disabled={speedTestRunning}>
                            <Zap size={14} />
                            {speedTestRunning ? t('app.monitoringOverview.running', 'Running…') : t('app.monitoringOverview.runTest', 'Run test')}
                        </Button>
                    </div>
                    {speedTest?.last_result ? (
                        <>
                            <div className="mon-speed-row">
                                {[
                                    { icon: ArrowDown, labelKey: 'app.monitoringOverview.down', label: 'Down', value: fmt(speedTest.last_result.download_mbps), unit: 'Mbps', tone: 'cpu' },
                                    { icon: ArrowUp, label: 'Up', value: fmt(speedTest.last_result.upload_mbps), unit: 'Mbps', tone: 'memory' },
                                    { icon: Timer, labelKey: 'app.monitoringOverview.latency', label: 'Latency', value: fmt(speedTest.last_result.latency_ms, 0), unit: 'ms', tone: 'extra' },
                                ].map((s) => {
                                    const Icon = s.icon;
                                    return (
                                        <div key={s.label} className="mon-speed">
                                            <span className={`mon-speed__ico is-${s.tone}`}><Icon size={15} /></span>
                                            <span className="mon-speed__val">{s.value}<small>{s.unit}</small></span>
                                            <span className="mon-speed__label">{s.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mon-speed-meta">
                                <Pill kind={speedTest.last_result.success === false ? 'red' : 'green'}>
                                    {speedTest.last_result.success === false ? 'failed' : 'ok'}
                                </Pill>
                                <span>
                                    {t('app.monitoringOverview.tested', 'Tested')} {speedTest.last_result.tested_at
                                        ? new Date(speedTest.last_result.tested_at).toLocaleString()
                                        : 'never'}
                                </span>
                            </div>
                        </>
                    ) : (
                        <p className="mon-panel-hint">
                            {t('app.monitoringOverview.noSpeedTestYetRunOne', "No speed test yet. Run one to measure this server's connection.")}
                        </p>
                    )}
                </section>
            </div>

            <DiskReclaimModal open={reclaimOpen} onClose={() => setReclaimOpen(false)} />
        </div>
    );
}

// A chart with nothing behind it should say so rather than draw an empty box:
// on a fresh install the collector simply hasn't run yet.
function ChartBody({ loading, values, children }) {
    const { t } = useTranslation();
    if (loading) return <EmptyState loading loadingVariant="chart" title={t('app.monitoringOverview.loadingMetrics', 'Loading metrics')} />;
    if (!values || values.length < 2) {
        return (
            <p className="mon-panel-hint">
                {t('app.monitoringOverview.noHistoryYetForThisHost', 'No history yet for this host. Samples are collected on the monitoring interval.')}
            </p>
        );
    }
    return children;
}

function HostCard({ active, name, sub, status, cpu, memory, disk, spark, onClick }) {
    const { t } = useTranslation();
    const kind = status === 'online' ? 'green' : status === 'offline' ? 'red' : 'gray';
    const hot = typeof cpu === 'number' && cpu > 75;
    return (
        <Button variant="unstyled"
            type="button"
            className={`mon-host${active ? ' is-active' : ''}`}
            onClick={onClick}
            aria-pressed={active}
            title={t('app.monitoringOverview.monitor', 'Monitor {{name}}', { name: name })}
        >
            <span className="mon-host__head">
                <span className="mon-host__ico"><ServerIcon size={14} /></span>
                <span className="mon-host__name">
                    {name}
                    <small>{sub}</small>
                </span>
                <Pill kind={kind}>{status || 'unknown'}</Pill>
            </span>
            {spark?.length > 1 ? (
                <span className="mon-host__spark">
                    <Sparkline
                        data={spark}
                        width={240}
                        height={38}
                        color={status === 'offline' ? 'var(--text-ghost)' : hot ? 'var(--amber)' : 'var(--accent-bright)'}
                    />
                </span>
            ) : (
                <span className="mon-host__spark mon-host__spark--empty" />
            )}
            <span className="mon-host__mini">
                <span>CPU <b>{cpu == null ? '—' : `${fmt(cpu, 0)}%`}</b></span>
                <span>MEM <b>{memory == null ? '—' : `${fmt(memory, 0)}%`}</b></span>
                <span>DSK <b>{disk == null ? '—' : `${fmt(disk, 0)}%`}</b></span>
            </span>
        </Button>
    );
}
