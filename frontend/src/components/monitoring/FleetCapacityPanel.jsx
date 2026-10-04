import { useState, useEffect, useMemo } from 'react';
import { BarChart3, CheckCircle, Download, TrendingUp } from 'lucide-react';
import {
    LineChart, Line, AreaChart, Area, XAxis, YAxis,
    CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableFooter, Pill } from '@/components/ds';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import ServerPicker from '@/components/ServerPicker';
import { CHART_COLORS, METRIC_LABELS } from './fleetMetrics';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// The three fleet-wide questions that only make sense across servers: how do
// these boxes compare, which one is behaving unlike itself, and when does a
// disk run out. Host-scoped gauges live on the Overview tab.
export default function FleetCapacityPanel({ scope, refreshKey = 0 }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [servers, setServers] = useState([]);

    // Comparison
    const [selectedServers, setSelectedServers] = useState([]);
    // The top-bar scope is the page's answer to "which host?", so it seeds both
    // controls here — you land on the server you were already looking at.
    const scopedServer = scope && scope !== 'host' ? scope : '';
    const [compMetric, setCompMetric] = useState('cpu');
    const [compPeriod, setCompPeriod] = useState('24h');
    const [compData, setCompData] = useState(null);
    const [comparing, setComparing] = useState(false);

    // Anomalies
    const [anomalies, setAnomalies] = useState([]);

    // Forecast
    const [forecastServer, setForecastServer] = useState(scopedServer);
    const [forecastMetric, setForecastMetric] = useState('disk');
    const [forecast, setForecast] = useState(null);

    useEffect(() => {
        if (!scopedServer) return;
        setForecastServer(scopedServer);
        setSelectedServers((prev) => (prev.includes(scopedServer) ? prev : [...prev, scopedServer]));
    }, [scopedServer]);

    useEffect(() => {
        let cancelled = false;
        api.getServers()
            .then((data) => {
                if (cancelled) return;
                const list = data?.servers || data;
                setServers(Array.isArray(list) ? list : []);
            })
            .catch(() => { if (!cancelled) setServers([]); });
        api.getFleetAnomalies()
            .then((data) => { if (!cancelled) setAnomalies(Array.isArray(data) ? data : []); })
            .catch(() => { if (!cancelled) setAnomalies([]); });
        return () => { cancelled = true; };
    }, [refreshKey]);

    const loadComparison = async () => {
        if (selectedServers.length === 0) return;
        setComparing(true);
        try {
            setCompData(await api.getFleetComparison(selectedServers, compMetric, compPeriod));
        } catch (err) {
            toastError(toast, t('app.fleetCapacityPanel.failedToLoadComparisonData', 'Failed to load comparison data'), err);
        } finally {
            setComparing(false);
        }
    };

    const loadForecast = async () => {
        if (!forecastServer) return;
        try {
            setForecast(await api.getCapacityForecast(forecastServer, forecastMetric));
        } catch (err) {
            toastError(toast, t('app.fleetCapacityPanel.failedToLoadForecast', 'Failed to load forecast'), err);
        }
    };

    const exportCsv = async () => {
        if (selectedServers.length === 0) return;
        try {
            const blob = await api.exportFleetCsv(selectedServers, compMetric, compPeriod);
            downloadBlob(blob, `fleet_${compMetric}_${compPeriod}.csv`);
        } catch (err) {
            toastError(toast, t('app.fleetCapacityPanel.exportFailed', 'Export failed'), err);
        }
    };

    const toggleServer = (id) => {
        setSelectedServers((prev) => (
            prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
        ));
    };

    // Columns for the shared DataTable; cell markup is identical to the
    // hand-rolled table it replaces (.sk-cell-mono). No toolbar row on this
    // section, so the table runs uncontrolled with a storageKey.
    const anomalyColumns = [
        {
            key: 'server',
            headerKey: 'common.labels.server', header: 'Server',
            sortable: true,
            hideable: false,
            sortValue: (a) => a.server_name || '',
            render: (a) => a.server_name,
        },
        {
            key: 'metric',
            headerKey: 'app.fleetCapacityPanel.metric', header: 'Metric',
            sortable: true,
            sortValue: (a) => METRIC_LABELS[a.metric] || a.metric,
            render: (a) => METRIC_LABELS[a.metric] || a.metric,
        },
        {
            key: 'current',
            headerKey: 'common.labels.current', header: 'Current',
            sortable: true,
            sortValue: (a) => a.current_value ?? null,
            cellClassName: 'sk-cell-dim',
            render: (a) => `${a.current_value}%`,
        },
        {
            key: 'baseline',
            headerKey: 'app.fleetCapacityPanel.baselineMean', header: 'Baseline (mean)',
            sortable: true,
            sortValue: (a) => a.mean ?? null,
            cellClassName: 'sk-cell-dim',
            render: (a) => `${a.mean}%`,
        },
        {
            key: 'stddev',
            headerKey: 'app.fleetCapacityPanel.stdDev', header: 'Std dev',
            sortable: true,
            sortValue: (a) => a.stddev ?? null,
            cellClassName: 'sk-cell-dim',
            render: (a) => a.stddev,
        },
        {
            key: 'zscore',
            headerKey: 'app.fleetCapacityPanel.zScore', header: 'Z-score',
            sortable: true,
            sortValue: (a) => a.z_score ?? null,
            cellClassName: 'sk-cell-dim',
            render: (a) => a.z_score,
        },
        {
            key: 'direction',
            headerKey: 'app.fleetCapacityPanel.direction', header: 'Direction',
            sortable: true,
            sortValue: (a) => a.direction || '',
            render: (a) => (
                <Pill kind={a.direction === 'high' ? 'red' : 'cyan'}>
                    {a.direction === 'high' ? 'Unusually high' : 'Unusually low'}
                </Pill>
            ),
        },
    ];

    // Recharts wants one row per timestamp with a column per series; the API
    // returns one series per server, so pivot before rendering.
    const compChartData = useMemo(() => {
        if (!compData?.series?.length) return [];
        const byTime = {};
        compData.series.forEach((s) => {
            s.data.forEach((point) => {
                if (!byTime[point.timestamp]) byTime[point.timestamp] = { timestamp: point.timestamp };
                byTime[point.timestamp][s.name] = point.value;
            });
        });
        return Object.values(byTime).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }, [compData]);

    return (
        <div className="monitoring-stack">
            <section className="monitoring-panel">
                <div className="monitoring-panel__header">
                    <h3>{t('app.fleetCapacityPanel.serverComparison', 'Server comparison')}</h3>
                    <div>
                        <Button variant="outline" size="sm" onClick={exportCsv} disabled={selectedServers.length === 0}>
                            <Download size={14} /> {t('app.fleetCapacityPanel.exportCsv', 'Export CSV')}
                        </Button>
                        <Button size="sm" onClick={loadComparison} disabled={selectedServers.length === 0 || comparing}>
                            <BarChart3 size={14} /> {comparing ? 'Comparing…' : 'Compare'}
                        </Button>
                    </div>
                </div>

                <div className="mon-compare-controls">
                    <div className="mon-compare-controls__servers">
                        <span className="mon-field-label">{t('common.labels.servers', 'Servers')}</span>
                        <div className="mon-server-picker">
                            {servers.length === 0 ? (
                                <span className="mon-field-hint">{t('app.fleetCapacityPanel.noServersPairedYet', 'No servers paired yet.')}</span>
                            ) : servers.map((s) => (
                                <Button
                                    key={s.id}
                                    size="sm"
                                    variant={selectedServers.includes(s.id) ? 'default' : 'ghost'}
                                    onClick={() => toggleServer(s.id)}
                                >
                                    {s.name}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="form-group">
                        <span className="mon-field-label">{t('app.fleetCapacityPanel.metric', 'Metric')}</span>
                        <Select value={compMetric} onValueChange={setCompMetric}>
                            <SelectTrigger aria-label={t('app.fleetCapacityPanel.metric', 'Metric')}><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.entries(METRIC_LABELS).map(([k, v]) => (
                                    <SelectItem key={k} value={k}>{v}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="form-group">
                        <span className="mon-field-label">{t('app.fleetCapacityPanel.period', 'Period')}</span>
                        <div className="mon-period-switch">
                            {['1h', '6h', '24h', '7d'].map((p) => (
                                <Button
                                    key={p}
                                    size="sm"
                                    variant={compPeriod === p ? 'default' : 'ghost'}
                                    onClick={() => setCompPeriod(p)}
                                >
                                    {p}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>

                {compChartData.length > 0 && compData?.series ? (
                    <ResponsiveContainer width="100%" height={360}>
                        <AreaChart data={compChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                            <XAxis
                                dataKey="timestamp"
                                tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                stroke="var(--text-secondary)"
                                fontSize={12}
                            />
                            <YAxis stroke="var(--text-secondary)" fontSize={12} unit="%" />
                            <Tooltip
                                labelFormatter={(v) => new Date(v).toLocaleString()}
                                contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }}
                            />
                            <Legend />
                            {compData.series.map((s, i) => (
                                <Area
                                    key={s.server_id}
                                    type="monotone"
                                    dataKey={s.name}
                                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                                    fillOpacity={0.1}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="mon-panel-hint">
                        {t('app.fleetCapacityPanel.pickTwoOrMoreServersThen', 'Pick two or more servers, then Compare to plot the same metric across all of them.')}
                    </p>
                )}
            </section>

            <section className="monitoring-panel">
                <div className="monitoring-panel__header">
                    <h3>{t('app.fleetCapacityPanel.anomalyDetection', 'Anomaly detection')}</h3>
                </div>
                {anomalies.length > 0 ? (
                    <DataTable
                        columns={anomalyColumns}
                        data={anomalies}
                        keyField={(a) => `${a.server_name}-${a.metric}-${a.z_score}`}
                        storageKey="serverkit-table-fleet-anomalies"
                        className="mon-table-scroll"
                        footer={(
                            <DataTableFooter
                                shown={anomalies.length}
                                total={anomalies.length}
                                noun="anomaly"
                            />
                        )}
                    />
                ) : (
                    <p className="mon-panel-hint">
                        <CheckCircle size={14} /> {t('app.fleetCapacityPanel.everyMetricIsWithinItsOwn', 'Every metric is within its own recent baseline.')}
                    </p>
                )}
            </section>

            <section className="monitoring-panel">
                <div className="monitoring-panel__header">
                    <h3>{t('app.fleetCapacityPanel.capacityForecast', 'Capacity forecast')}</h3>
                    <Button size="sm" onClick={loadForecast} disabled={!forecastServer}>
                        <TrendingUp size={14} /> {t('app.fleetCapacityPanel.forecast', 'Forecast')}
                    </Button>
                </div>

                <div className="mon-compare-controls">
                    <div className="form-group">
                        <span className="mon-field-label">{t('common.labels.server', 'Server')}</span>
                        <ServerPicker
                            value={forecastServer}
                            onChange={(id) => setForecastServer(id)}
                            includeLocal={false}
                            onlineOnly={false}
                            label={t('app.fleetCapacityPanel.selectAServer', 'Select a server…')}
                        />
                    </div>
                    <div className="form-group">
                        <span className="mon-field-label">{t('app.fleetCapacityPanel.metric', 'Metric')}</span>
                        <Select value={forecastMetric} onValueChange={setForecastMetric}>
                            <SelectTrigger aria-label={t('app.fleetCapacityPanel.metric', 'Metric')}><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="disk">{t('common.labels.disk', 'Disk')}</SelectItem>
                                <SelectItem value="memory">{t('common.labels.memory', 'Memory')}</SelectItem>
                                <SelectItem value="cpu">CPU</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {forecast?.error && <div className="fleet-warnrow">{forecast.error}</div>}

                {forecast && !forecast.error ? (
                    <div className="mon-forecast">
                        <div className="mon-forecast__stats">
                            <div className="fleet-statbox">
                                <span className="mon-field-label">{t('common.labels.current', 'Current')}</span>
                                <strong>{forecast.current_value}%</strong>
                            </div>
                            <div className="fleet-statbox">
                                <span className="mon-field-label">{t('app.fleetCapacityPanel.growthRate', 'Growth rate')}</span>
                                <strong>{forecast.growth_rate_per_day}%/day</strong>
                            </div>
                            <div className="fleet-statbox">
                                <span className="mon-field-label">{t('app.fleetCapacityPanel.trend', 'Trend')}</span>
                                <strong>{forecast.trend}</strong>
                            </div>
                        </div>

                        {forecast.predictions && (
                            <div className="mon-forecast__predictions">
                                <div className={`fleet-predbox ${forecast.predictions.days_to_90pct === 0 ? 'is-red' : 'is-amber'}`}>
                                    <span className="mon-field-label">{t('app.fleetCapacityPanel.reaches90', 'Reaches 90%')}</span>
                                    <strong>
                                        {forecast.predictions.date_90pct || 'N/A'}
                                        {forecast.predictions.days_to_90pct > 0 && (
                                            <em> ({forecast.predictions.days_to_90pct} days)</em>
                                        )}
                                    </strong>
                                </div>
                                <div className="fleet-predbox is-red">
                                    <span className="mon-field-label">{t('app.fleetCapacityPanel.reaches100', 'Reaches 100%')}</span>
                                    <strong>
                                        {forecast.predictions.date_100pct || 'N/A'}
                                        {forecast.predictions.days_to_100pct > 0 && (
                                            <em> ({forecast.predictions.days_to_100pct} days)</em>
                                        )}
                                    </strong>
                                </div>
                            </div>
                        )}

                        {forecast.trend_data && (
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={forecast.trend_data}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                                    <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={11} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={12} unit="%" domain={[0, 100]} />
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)' }} />
                                    <Legend />
                                    <Line type="monotone" dataKey="actual" stroke="var(--accent-bright)" strokeWidth={2} dot={false} name="Actual" />
                                    <Line type="monotone" dataKey="trend" stroke="var(--red)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Trend" />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                ) : !forecast && (
                    <p className="mon-panel-hint">
                        {t('app.fleetCapacityPanel.pickAServerAndAMetric', 'Pick a server and a metric to project when it runs out of headroom.')}
                    </p>
                )}
            </section>
        </div>
    );
}
