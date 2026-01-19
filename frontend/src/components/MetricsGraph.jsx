import React, { useState, useEffect } from 'react';
import {
    XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, TrendingUp, Wifi } from 'lucide-react';
import api from '../services/api';

// Chart colors - matching new_dashboard_3 style
const CHART_COLORS = {
    cpu: '#6366f1',      // Purple/Indigo (CPU Core)
    memory: '#10b981',   // Green (Memory)
    network: '#f59e0b'   // Amber/Orange (Network)
};

const MetricsGraph = ({ compact = false }) => {
    const [data, setData] = useState(null);
    const [period, setPeriod] = useState('1h');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [visibleMetrics, setVisibleMetrics] = useState({
        cpu: true,
        memory: true,
        network: true
    });

    const periods = ['1h', '6h', '24h', '7d', '30d'];

    const toggleMetric = (metric) => {
        setVisibleMetrics(prev => ({
            ...prev,
            [metric]: !prev[metric]
        }));
    };

    useEffect(() => {
        loadHistory();
    }, [period]);

    async function loadHistory() {
        try {
            setLoading(true);
            const response = await api.getMetricsHistory(period);
            setData(response);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function formatTimestamp(isoString) {
        const date = new Date(isoString);
        if (period === '1h' || period === '6h') {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (period === '24h') {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (period === '7d') {
            return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

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
                <span>Failed to load metrics history</span>
            </div>
        );
    }

    if (!data || data.points === 0) {
        return (
            <div className="metrics-graph-card empty">
                <TrendingUp size={24} />
                <span>No historical data yet</span>
                <span className="muted">Metrics are collected every minute</span>
            </div>
        );
    }

    const chartData = data.data.map(point => ({
        time: formatTimestamp(point.timestamp),
        cpu: point.cpu.percent,
        memory: point.memory.percent,
        network: point.disk.percent  // Using disk data for network display
    }));

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
                        <span>System Metrics</span>
                    </div>
                    <div className="period-selector">
                        {periods.map(p => (
                            <button
                                key={p}
                                className={`period-btn ${period === p ? 'active' : ''}`}
                                onClick={() => setPeriod(p)}
                            >
                                {p}
                            </button>
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
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
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
                        <Wifi size={14} />
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
                    <span>Real-time Performance</span>
                </div>
                <div className="metrics-filter-legend">
                    <button
                        className={`filter-btn cpu ${visibleMetrics.cpu ? 'active' : ''}`}
                        onClick={() => toggleMetric('cpu')}
                    >
                        CPU Core
                    </button>
                    <button
                        className={`filter-btn memory ${visibleMetrics.memory ? 'active' : ''}`}
                        onClick={() => toggleMetric('memory')}
                    >
                        Memory
                    </button>
                    <button
                        className={`filter-btn network ${visibleMetrics.network ? 'active' : ''}`}
                        onClick={() => toggleMetric('network')}
                    >
                        Network
                    </button>
                </div>
                <div className="period-selector">
                    {periods.map(p => (
                        <button
                            key={p}
                            className={`period-btn ${period === p ? 'active' : ''}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            <div className="metrics-chart-container">
                <ResponsiveContainer width="100%" height={280}>
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
                            {/* Network Gradient - Orange */}
                            <linearGradient id="networkGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.network} stopOpacity={0.5} />
                                <stop offset="95%" stopColor={CHART_COLORS.network} stopOpacity={0} />
                            </linearGradient>
                            {/* Glow filters for lines */}
                            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                                <feMerge>
                                    <feMergeNode in="coloredBlur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.5} />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 11, fill: '#a1a1aa' }}
                            axisLine={{ stroke: '#27272a' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: '#a1a1aa' }}
                            axisLine={{ stroke: '#27272a' }}
                            tickLine={false}
                            tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        {visibleMetrics.cpu && (
                            <Area
                                type="monotone"
                                dataKey="cpu"
                                stroke={CHART_COLORS.cpu}
                                fill="url(#cpuGradient)"
                                strokeWidth={2}
                                tension={0.4}
                                dot={false}
                                activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.cpu, fill: '#18181b' }}
                                name="CPU"
                            />
                        )}
                        {visibleMetrics.memory && (
                            <Area
                                type="monotone"
                                dataKey="memory"
                                stroke={CHART_COLORS.memory}
                                fill="url(#memoryGradient)"
                                strokeWidth={2}
                                tension={0.4}
                                dot={false}
                                activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.memory, fill: '#18181b' }}
                                name="Memory"
                            />
                        )}
                        {visibleMetrics.network && (
                            <Area
                                type="monotone"
                                dataKey="network"
                                stroke={CHART_COLORS.network}
                                fill="url(#networkGradient)"
                                strokeWidth={2}
                                tension={0.1}
                                dot={false}
                                activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.network, fill: '#18181b' }}
                                name="Network"
                            />
                        )}
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default MetricsGraph;
