import React, { useState, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, Clock, TrendingUp } from 'lucide-react';
import api from '../services/api';

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
            if (value > 80) return 'var(--danger)';
            if (value > 60) return 'var(--warning)';
            return 'var(--success)';
        }
        if (value > 90) return 'var(--danger)';
        if (value > 80) return 'var(--warning)';
        return 'var(--accent-primary)';
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
                        <div key={index} className="tooltip-row" style={{ color: entry.color }}>
                            <span>{entry.name}:</span>
                            <span>{entry.value}%</span>
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
                                <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="time" tick={false} axisLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotone"
                                dataKey="cpu"
                                stroke="var(--success)"
                                fill="url(#cpuGradient)"
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
                <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                            axisLine={{ stroke: 'var(--border-subtle)' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={[0, 100]}
                            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                            axisLine={{ stroke: 'var(--border-subtle)' }}
                            tickLine={false}
                            tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Line
                            type="monotone"
                            dataKey="cpu"
                            stroke="var(--success)"
                            strokeWidth={2}
                            dot={false}
                            name="CPU"
                        />
                        <Line
                            type="monotone"
                            dataKey="memory"
                            stroke="var(--accent-primary)"
                            strokeWidth={2}
                            dot={false}
                            name="Memory"
                        />
                        <Line
                            type="monotone"
                            dataKey="disk"
                            stroke="var(--warning)"
                            strokeWidth={2}
                            dot={false}
                            name="Disk"
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div className="metrics-legend">
                <div className="legend-item">
                    <span className="legend-line" style={{ background: 'var(--success)' }} />
                    <span>CPU</span>
                </div>
                <div className="legend-item">
                    <span className="legend-line" style={{ background: 'var(--accent-primary)' }} />
                    <span>Memory</span>
                </div>
                <div className="legend-item">
                    <span className="legend-line" style={{ background: 'var(--warning)' }} />
                    <span>Disk</span>
                </div>
            </div>
        </div>
    );
};

export default MetricsGraph;
