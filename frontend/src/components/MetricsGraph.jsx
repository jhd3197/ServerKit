import React, { useState, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Area, AreaChart, Legend
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, Clock, TrendingUp } from 'lucide-react';
import api from '../services/api';

// Chart colors - using actual hex values for SVG compatibility
const CHART_COLORS = {
    cpu: '#10b981',      // Green
    memory: '#6366f1',   // Purple/Indigo
    disk: '#f59e0b'      // Amber/Orange
};

const MetricsGraph = ({ compact = false }) => {
    const [data, setData] = useState(null);
    const [period, setPeriod] = useState('1h');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const periods = ['1h', '6h', '24h', '7d', '30d'];

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

    function getColor(value, type) {
        if (type === 'cpu') {
            if (value > 80) return '#ef4444';  // danger
            if (value > 60) return '#f59e0b';  // warning
            return '#10b981';  // success
        }
        if (value > 90) return '#ef4444';  // danger
        if (value > 80) return '#f59e0b';  // warning
        return '#6366f1';  // accent
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
        disk: point.disk.percent
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
                    <TrendingUp size={18} />
                    <span>System Metrics History</span>
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

            <div className="metrics-summary-row">
                <div className="summary-stat">
                    <Cpu size={16} />
                    <div>
                        <span className="stat-label">CPU Avg</span>
                        <span className="stat-value" style={{ color: getColor(data.summary.cpu_avg, 'cpu') }}>
                            {data.summary.cpu_avg}%
                        </span>
                    </div>
                </div>
                <div className="summary-stat">
                    <MemoryStick size={16} />
                    <div>
                        <span className="stat-label">Memory Avg</span>
                        <span className="stat-value" style={{ color: getColor(data.summary.memory_avg, 'memory') }}>
                            {data.summary.memory_avg}%
                        </span>
                    </div>
                </div>
                <div className="summary-stat">
                    <HardDrive size={16} />
                    <div>
                        <span className="stat-label">Disk Avg</span>
                        <span className="stat-value" style={{ color: getColor(data.summary.disk_avg, 'disk') }}>
                            {data.summary.disk_avg}%
                        </span>
                    </div>
                </div>
                <div className="summary-stat">
                    <Clock size={16} />
                    <div>
                        <span className="stat-label">Data Points</span>
                        <span className="stat-value">{data.points}</span>
                    </div>
                </div>
            </div>

            <div className="metrics-chart-container">
                <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <defs>
                            {/* CPU Gradient - Green */}
                            <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.cpu} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={CHART_COLORS.cpu} stopOpacity={0} />
                            </linearGradient>
                            {/* Memory Gradient - Purple */}
                            <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.memory} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={CHART_COLORS.memory} stopOpacity={0} />
                            </linearGradient>
                            {/* Disk Gradient - Amber */}
                            <linearGradient id="diskGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.disk} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={CHART_COLORS.disk} stopOpacity={0} />
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
                        <Area
                            type="monotone"
                            dataKey="cpu"
                            stroke={CHART_COLORS.cpu}
                            fill="url(#cpuGradient)"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.cpu, fill: '#18181b' }}
                            name="CPU"
                            filter="url(#glow)"
                        />
                        <Area
                            type="monotone"
                            dataKey="memory"
                            stroke={CHART_COLORS.memory}
                            fill="url(#memoryGradient)"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.memory, fill: '#18181b' }}
                            name="Memory"
                            filter="url(#glow)"
                        />
                        <Area
                            type="monotone"
                            dataKey="disk"
                            stroke={CHART_COLORS.disk}
                            fill="url(#diskGradient)"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 6, strokeWidth: 2, stroke: CHART_COLORS.disk, fill: '#18181b' }}
                            name="Disk"
                            filter="url(#glow)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="metrics-legend">
                <div className="legend-item">
                    <span className="legend-line cpu" />
                    <span>CPU</span>
                </div>
                <div className="legend-item">
                    <span className="legend-line memory" />
                    <span>Memory</span>
                </div>
                <div className="legend-item">
                    <span className="legend-line disk" />
                    <span>Disk</span>
                </div>
            </div>
        </div>
    );
};

export default MetricsGraph;
