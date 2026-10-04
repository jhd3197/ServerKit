import { useCallback, useState, useEffect, useMemo  } from 'react';
import {
    XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, TrendingUp } from 'lucide-react';
import api from '../services/api';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Chart series colors — redesign "infra console" palette (see
// docs/REDESIGN_MAP.md). Kept as hex (not CSS var()) on purpose: var() does not
// reliably resolve inside SVG presentation attributes, so hardcoding keeps the
// series from rendering blank. Grid/axis/ticks ARE themed via CSS overrides in
// _metrics-graph.scss.
const CHART_COLORS = {
    cpu: '#8b93ff',      // accent-bright (periwinkle)
    memory: '#3ddc97',   // green (RAM)
    disk: '#f5b945'      // amber (Disk)
};

// Intl only accepts IANA zone names (e.g. "America/New_York"). A server on
// Windows can report a display name like "Eastern Daylight Time", which makes
// toLocale*String throw a RangeError and crash the chart. Validate once and
// fall back to the browser's local zone rather than blowing up the render.
function safeTimeZone(tz) {
    if (!tz) return undefined;
    try {
        new Intl.DateTimeFormat([], { timeZone: tz });
        return tz;
    } catch {
        return undefined;
    }
}

const MetricsGraph = ({ compact = false, timezone, serverId }) => {
    const { t } = useTranslation();
    const [data, setData] = useState(null);
    const [period, setPeriod] = useState('1h');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [visibleMetrics, setVisibleMetrics] = useState({
        cpu: true,
        memory: true,
        disk: true
    });

    const periods = ['1h', '6h', '24h', '7d', '30d'];

    const toggleMetric = (metric) => {
        setVisibleMetrics(prev => ({
            ...prev,
            [metric]: !prev[metric]
        }));
    };

    const loadHistory = useCallback(async () => {
        try {
            setLoading(true);
            const response = serverId
                ? await api.getServerMetricsHistory(serverId, period)
                : await api.getMetricsHistory(period);
            setData(response);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [period, serverId]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);


    const chartData = useMemo(() => {
        function formatTimestamp(isoString) {
            const date = new Date(isoString);
            const tz = safeTimeZone(timezone);
            if (period === '1h' || period === '6h' || period === '24h') {
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
            } else if (period === '7d') {
                return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', timeZone: tz });
            } else {
                return date.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: tz });
            }
        }

        return data?.data?.map(point => ({
            time: formatTimestamp(point.timestamp),
            cpu: point.cpu?.percent ?? point.cpu_percent ?? 0,
            memory: point.memory?.percent ?? point.memory_percent ?? 0,
            disk: point.disk?.percent ?? point.disk_percent ?? 0
        })) || [];
    }, [data, timezone, period]);

    // Auto-zoom: compute Y-axis ceiling from visible metrics
    const yDomain = useMemo(() => {
        if (chartData.length === 0) return [0, 100];

        const activeKeys = Object.entries(visibleMetrics)
            .filter(([, visible]) => visible)
            .map(([key]) => key);

        if (activeKeys.length === 0) return [0, 100];

        let maxVal = 0;
        chartData.forEach(point => {
            activeKeys.forEach(key => {
                if (point[key] > maxVal) maxVal = point[key];
            });
        });

        // Add 20% headroom, floor at 10%
        const ceiling = Math.max(10, maxVal * 1.2);
        // Snap to nearest nice tick value
        const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100];
        const niceMax = steps.find(s => s >= ceiling) || 100;

        return [0, niceMax];
    }, [chartData, visibleMetrics]);

    if (loading && !data) {
        return (
            <div className="metrics-graph-card loading">
                <div className="loading-spinner" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="metrics-graph-card error">
                <span>{t('app.metricsGraph.failedToLoadMetricsHistory', 'Failed to load metrics history')}</span>
            </div>
        );
    }

    if (!data || data.points === 0) {
        return (
            <div className="metrics-graph-card empty">
                <TrendingUp size={24} />
                <span>{t('app.metricsGraph.noHistoricalDataYet', 'No historical data yet')}</span>
                <span className="muted">{t('app.metricsGraph.metricsAreCollectedEveryMinute', 'Metrics are collected every minute')}</span>
            </div>
        );
    }

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="metrics-tooltip">
                    <div className="tooltip-time">{label}</div>
                    {payload.map((entry, index) => (
                        <div key={index} className="tooltip-row">
                            <span className="tooltip-dot" style={{ backgroundColor: entry.stroke || entry.color }} />
                            <span className="tooltip-label">{entry.name}:</span>
                            <span className="tooltip-value" style={{ color: entry.stroke || entry.color }}>{entry.value?.toFixed(1)}%</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    if (compact) {
        return (
            <div className="metrics-graph-compact">
                <div className="metrics-graph-header">
                    <div className="graph-title">
                        <TrendingUp size={16} />
                        <span>{t('app.metricsGraph.systemMetrics', 'System Metrics')}</span>
                    </div>
                    <div className="period-selector">
                        {periods.map(p => (
                            <SharedButton variant="unstyled" type="button"
                                key={p}
                                className={`period-btn ${period === p ? 'active' : ''}`}
                                onClick={() => setPeriod(p)}
                            >
                                {p}
                            </SharedButton>
                        ))}
                    </div>
                </div>
                <div className="metrics-chart-container compact">
                    <ResponsiveContainer width="100%" height={120}>
                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="cpuGradientCompact" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={CHART_COLORS.cpu} stopOpacity={0.4} />
                                    <stop offset="95%" stopColor={CHART_COLORS.cpu} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="time" tick={false} axisLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="cpu"
                                stroke={CHART_COLORS.cpu}
                                fill="url(#cpuGradientCompact)"
                                strokeWidth={2}
                                name="CPU"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="metrics-summary-compact">
                    <div className="summary-item">
                        <Cpu size={14} />
                        <span>{data.summary.cpu_avg}%</span>
                    </div>
                    <div className="summary-item">
                        <MemoryStick size={14} />
                        <span>{data.summary.memory_avg}%</span>
                    </div>
                    <div className="summary-item">
                        <HardDrive size={14} />
                        <span>{data.summary.disk_avg}%</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="metrics-graph-card">
            <div className="metrics-graph-header">
                <div className="graph-title">
                    <span>{t('app.metricsGraph.realTimePerformance', 'Real-time Performance')}</span>
                </div>
                <div className="metrics-filter-legend">
                    <SharedButton variant="unstyled" type="button"
                        className={`filter-btn cpu ${visibleMetrics.cpu ? 'active' : ''}`}
                        onClick={() => toggleMetric('cpu')}
                    >
                        CPU
                    </SharedButton>
                    <SharedButton variant="unstyled" type="button"
                        className={`filter-btn memory ${visibleMetrics.memory ? 'active' : ''}`}
                        onClick={() => toggleMetric('memory')}
                    >
                        RAM
                    </SharedButton>
                    <SharedButton variant="unstyled" type="button"
                        className={`filter-btn disk ${visibleMetrics.disk ? 'active' : ''}`}
                        onClick={() => toggleMetric('disk')}
                    >
                        {t('common.labels.disk', 'Disk')}
                    </SharedButton>
                </div>
                <div className="period-selector">
                    {periods.map(p => (
                        <SharedButton variant="unstyled" type="button"
                            key={p}
                            className={`period-btn ${period === p ? 'active' : ''}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p}
                        </SharedButton>
                    ))}
                </div>
            </div>

            <div className="metrics-chart-container">
                <ResponsiveContainer width="100%" height={420}>
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                            {/* CPU Gradient - Purple/Indigo */}
                            <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.cpu} stopOpacity={0.5} />
                                <stop offset="95%" stopColor={CHART_COLORS.cpu} stopOpacity={0} />
                            </linearGradient>
                            {/* Memory Gradient - Green */}
                            <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.memory} stopOpacity={0.5} />
                                <stop offset="95%" stopColor={CHART_COLORS.memory} stopOpacity={0} />
                            </linearGradient>
                            {/* Disk Gradient - Orange */}
                            <linearGradient id="diskGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.disk} stopOpacity={0.5} />
                                <stop offset="95%" stopColor={CHART_COLORS.disk} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.5} />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 12, fill: '#a1a1aa' }}
                            axisLine={{ stroke: '#27272a' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={yDomain}
                            tick={{ fontSize: 12, fill: '#a1a1aa' }}
                            axisLine={{ stroke: '#27272a' }}
                            tickLine={false}
                            tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        {visibleMetrics.cpu && (
                            <Area
                                type="stepAfter"
                                dataKey="cpu"
                                stroke={CHART_COLORS.cpu}
                                fill="url(#cpuGradient)"
                                strokeWidth={1.5}
                                dot={false}
                                name="CPU"
                            />
                        )}
                        {visibleMetrics.memory && (
                            <Area
                                type="stepAfter"
                                dataKey="memory"
                                stroke={CHART_COLORS.memory}
                                fill="url(#memoryGradient)"
                                strokeWidth={1.5}
                                dot={false}
                                name="RAM"
                            />
                        )}
                        {visibleMetrics.disk && (
                            <Area
                                type="stepAfter"
                                dataKey="disk"
                                stroke={CHART_COLORS.disk}
                                fill="url(#diskGradient)"
                                strokeWidth={1.5}
                                dot={false}
                                name="Disk"
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default MetricsGraph;
