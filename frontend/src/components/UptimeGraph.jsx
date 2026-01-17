import React, { useState, useEffect } from 'react';
import { Server, Activity, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import api from '../services/api';

const UptimeGraph = ({ compact = false }) => {
    const [uptime, setUptime] = useState(null);
    const [graphData, setGraphData] = useState(null);
    const [stats, setStats] = useState(null);
    const [period, setPeriod] = useState('24h');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadData();
    }, [period]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [uptimeRes, graphRes, statsRes] = await Promise.all([
                api.getCurrentUptime(),
                api.getUptimeGraph(period),
                api.getUptimeStats()
            ]);

            setUptime(uptimeRes);
            setGraphData(graphRes);
            setStats(statsRes);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'up': return 'var(--success)';
            case 'degraded': return 'var(--warning)';
            case 'down': return 'var(--danger)';
            default: return 'var(--border-subtle)';
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'up': return <CheckCircle size={16} />;
            case 'degraded': return <AlertTriangle size={16} />;
            case 'down': return <XCircle size={16} />;
            default: return <Activity size={16} />;
        }
    };

    const formatSegmentTime = (isoString) => {
        const date = new Date(isoString);
        if (period === '24h') {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (period === '7d') {
            return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    };

    const getUptimeClass = (percentage) => {
        if (percentage >= 99.9) return 'excellent';
        if (percentage >= 99) return 'good';
        if (percentage >= 95) return 'fair';
        return 'poor';
    };

    if (loading && !uptime) {
        return (
            <div className="uptime-card loading">
                <div className="loading-spinner" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="uptime-card error">
                <AlertTriangle size={24} />
                <span>Failed to load uptime data</span>
            </div>
        );
    }

    const uptimeFormatted = uptime?.uptime_formatted || { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const uptimePercent = graphData?.uptime_percentage || 100;

    if (compact) {
        return (
            <div className="uptime-compact">
                <div className="uptime-compact-status">
                    <Server size={20} style={{ color: 'var(--success)' }} />
                    <span className="uptime-compact-label">Uptime</span>
                    <span className={`uptime-compact-percent ${getUptimeClass(uptimePercent)}`}>
                        {uptimePercent}%
                    </span>
                </div>
                <div className="uptime-compact-time">
                    <span className="value">{uptimeFormatted.days}</span>
                    <span className="unit">d</span>
                    <span className="value">{String(uptimeFormatted.hours).padStart(2, '0')}</span>
                    <span className="unit">h</span>
                    <span className="value">{String(uptimeFormatted.minutes).padStart(2, '0')}</span>
                    <span className="unit">m</span>
                </div>
            </div>
        );
    }

    return (
        <div className="uptime-card">
            <div className="uptime-header">
                <div className="uptime-title">
                    <Server size={24} className="uptime-icon" />
                    <div>
                        <h3>Server Uptime</h3>
                        <span className="uptime-status online">
                            <span className="status-dot" />
                            Operational
                        </span>
                    </div>
                </div>
                <div className="uptime-percentage">
                    <span className={`percentage-value ${getUptimeClass(uptimePercent)}`}>
                        {uptimePercent}%
                    </span>
                    <span className="percentage-label">uptime</span>
                </div>
            </div>

            <div className="uptime-counter">
                <div className="uptime-counter-item">
                    <span className="counter-value">{uptimeFormatted.days}</span>
                    <span className="counter-label">Days</span>
                </div>
                <span className="counter-separator">:</span>
                <div className="uptime-counter-item">
                    <span className="counter-value">{String(uptimeFormatted.hours).padStart(2, '0')}</span>
                    <span className="counter-label">Hours</span>
                </div>
                <span className="counter-separator">:</span>
                <div className="uptime-counter-item">
                    <span className="counter-value">{String(uptimeFormatted.minutes).padStart(2, '0')}</span>
                    <span className="counter-label">Minutes</span>
                </div>
                <span className="counter-separator">:</span>
                <div className="uptime-counter-item">
                    <span className="counter-value">{String(uptimeFormatted.seconds).padStart(2, '0')}</span>
                    <span className="counter-label">Seconds</span>
                </div>
            </div>

            <div className="uptime-graph-section">
                <div className="uptime-graph-header">
                    <span className="graph-title">Uptime History</span>
                    <div className="period-selector">
                        {['24h', '7d', '30d', '90d'].map(p => (
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

                <div className="uptime-graph">
                    {graphData?.segments?.map((segment, index) => (
                        <div
                            key={index}
                            className={`graph-bar ${segment.status}`}
                            style={{ backgroundColor: getStatusColor(segment.status) }}
                            title={`${formatSegmentTime(segment.start)}: ${segment.status}`}
                        />
                    ))}
                </div>

                <div className="uptime-graph-labels">
                    <span>{period === '24h' ? '24 hours ago' : period === '7d' ? '7 days ago' : period === '30d' ? '30 days ago' : '90 days ago'}</span>
                    <span>Now</span>
                </div>
            </div>

            <div className="uptime-legend">
                <div className="legend-item">
                    <span className="legend-dot up" />
                    <span>Operational</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot degraded" />
                    <span>Degraded</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot down" />
                    <span>Down</span>
                </div>
                <div className="legend-item">
                    <span className="legend-dot no-data" />
                    <span>No Data</span>
                </div>
            </div>

            {stats?.periods && (
                <div className="uptime-stats-grid">
                    {Object.entries(stats.periods).map(([periodKey, periodStats]) => (
                        <div key={periodKey} className="uptime-stat">
                            <span className="stat-period">{periodKey}</span>
                            <span className={`stat-value ${getUptimeClass(periodStats.uptime_percentage)}`}>
                                {periodStats.uptime_percentage}%
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default UptimeGraph;
