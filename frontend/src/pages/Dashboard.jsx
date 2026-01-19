import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Cpu, MemoryStick, HardDrive, Activity,
    Plus, RefreshCw, Server, Zap,
    RotateCcw, Database, Layers, Container, Globe, Code
} from 'lucide-react';
import api from '../services/api';
import { useMetrics } from '../hooks/useMetrics';
import MetricsGraph from '../components/MetricsGraph';

const Dashboard = () => {
    const navigate = useNavigate();
    const { metrics, loading: metricsLoading, connected } = useMetrics(true);
    const [apps, setApps] = useState([]);
    const [services, setServices] = useState([]);
    const [dbStatus, setDbStatus] = useState(null);
    const [uptime, setUptime] = useState(null);
    const [serverTime, setServerTime] = useState(null);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (metrics?.time) {
            setServerTime(metrics.time);
        }
    }, [metrics]);

    async function loadData() {
        try {
            const [appsData, servicesData, dbData, uptimeData, sysInfoData] = await Promise.all([
                api.getApps(),
                api.getServicesStatus().catch(() => ({ services: [] })),
                api.getDatabasesStatus().catch(() => null),
                api.getCurrentUptime().catch(() => null),
                api.getSystemInfo().catch(() => null)
            ]);
            setApps(appsData.apps || []);
            setServices(servicesData.services || []);
            setDbStatus(dbData);
            setUptime(uptimeData);
            setSystemInfo(sysInfoData);
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    }

    function getStatusClass(status) {
        switch (status) {
            case 'running': return 'status-active';
            case 'stopped': return 'status-stopped';
            case 'error': return 'status-error';
            default: return 'status-warning';
        }
    }

    function getStackIcon(type) {
        switch (type) {
            case 'docker': return <Container size={16} />;
            case 'wordpress':
            case 'php': return <Code size={16} />;
            case 'flask':
            case 'django': return <Layers size={16} />;
            default: return <Globe size={16} />;
        }
    }

    const uptimeFormatted = uptime?.uptime_formatted || { days: 0, hours: 0, minutes: 0, seconds: 0 };
    const hostname = systemInfo?.hostname || 'server';
    const kernelVersion = systemInfo?.kernel || '-';
    const ipAddress = systemInfo?.ip_address || '-';

    if (loading && metricsLoading) {
        return <div className="loading">Loading dashboard...</div>;
    }

    return (
        <div className="dashboard-page">
            {/* Top Bar */}
            <div className="top-bar">
                <div className="server-identity">
                    <h1>
                        <span className="status-dot-live"></span>
                        {hostname}
                    </h1>
                    <div className="server-details">
                        <span>IP: {ipAddress}</span>
                        <span>KERNEL: {kernelVersion}</span>
                        <span>UPTIME: {uptimeFormatted.days}d {String(uptimeFormatted.hours).padStart(2, '0')}h {String(uptimeFormatted.minutes).padStart(2, '0')}m</span>
                    </div>
                </div>
                <div className="clock-widget">
                    <div className="clock-time">
                        {serverTime?.current_time_formatted?.split(' ')[1] || '--:--:--'}
                    </div>
                    <div className="clock-zone">
                        ZONE: {serverTime?.timezone_id || 'UTC'}
                    </div>
                </div>
            </div>

            {/* Grid Container */}
            <div className="grid-container">
                {/* Metric Tiles */}
                <div className="metric-tile">
                    <div className="tile-head">
                        <span className="tile-title">Processor Load</span>
                        <Zap size={16} className="tile-icon cpu" />
                    </div>
                    <div className="tile-val">{(metrics?.cpu?.percent || 0).toFixed(1)}%</div>
                    <div className="tile-sub">
                        <span>Cores: {metrics?.cpu?.count_logical || 0}</span>
                        <span className={metrics?.cpu?.percent > 50 ? 'trend-up' : 'trend-down'}>
                            {metrics?.cpu?.percent > 50 ? '▲' : '▼'} {Math.abs(metrics?.cpu?.percent - 50).toFixed(0)}%
                        </span>
                    </div>
                </div>

                <div className="metric-tile">
                    <div className="tile-head">
                        <span className="tile-title">Memory Allocation</span>
                        <Database size={16} className="tile-icon memory" />
                    </div>
                    <div className="tile-val">{metrics?.memory?.ram?.used_human || '0 GB'}</div>
                    <div className="tile-sub">
                        <span>Total: {metrics?.memory?.ram?.total_human || '0 GB'}</span>
                        <span>Cached: {metrics?.memory?.ram?.cached_human || '0 GB'}</span>
                    </div>
                </div>

                <div className="metric-tile">
                    <div className="tile-head">
                        <span className="tile-title">Network I/O</span>
                        <Activity size={16} className="tile-icon network" />
                    </div>
                    <div className="tile-val">
                        {metrics?.network?.io?.bytes_sent_human || '0 B'}
                        <span className="tile-val-unit">sent</span>
                    </div>
                    <div className="tile-sub">
                        <span>In: {metrics?.network?.io?.bytes_recv_human || '0 B'}</span>
                        <span>Out: {metrics?.network?.io?.bytes_sent_human || '0 B'}</span>
                    </div>
                </div>

                <div className="metric-tile">
                    <div className="tile-head">
                        <span className="tile-title">Disk Operations</span>
                        <HardDrive size={16} className="tile-icon disk" />
                    </div>
                    <div className="tile-val">
                        {(metrics?.disk?.partitions?.[0]?.percent || 0).toFixed(1)}%
                        <span className="tile-val-unit">used</span>
                    </div>
                    <div className="tile-sub">
                        <span>Used: {metrics?.disk?.partitions?.[0]?.used_human || '0 GB'}</span>
                        <span>Free: {metrics?.disk?.partitions?.[0]?.free_human || '0 GB'}</span>
                    </div>
                </div>

                {/* Chart Panel */}
                <div className="chart-panel">
                    <MetricsGraph />
                </div>

                {/* Spec Panel */}
                <div className="spec-panel">
                    <h3 className="spec-panel-title">Quick Actions</h3>
                    <button className="btn-action" onClick={() => navigate('/docker')}>
                        <span>Restart Services</span>
                        <span>►</span>
                    </button>
                    <button className="btn-action" onClick={() => navigate('/databases')}>
                        <span>Clear Cache</span>
                        <span><Zap size={14} /></span>
                    </button>
                    <button className="btn-action" onClick={() => navigate('/ssl')}>
                        <span>Rotate SSL Certs</span>
                        <span><RotateCcw size={14} /></span>
                    </button>

                    <h3 className="spec-panel-title" style={{ marginTop: '1.5rem' }}>Hardware Specs</h3>
                    <div className="spec-row">
                        <span className="spec-label">Processor</span>
                        <span className="spec-data">{systemInfo?.cpu?.model || 'N/A'}</span>
                    </div>
                    <div className="spec-row">
                        <span className="spec-label">Architecture</span>
                        <span className="spec-data">{systemInfo?.cpu?.architecture || 'N/A'}</span>
                    </div>
                    <div className="spec-row">
                        <span className="spec-label">Swap Memory</span>
                        <span className="spec-data">{metrics?.memory?.swap?.total_human || 'N/A'}</span>
                    </div>
                </div>

                {/* Process Table */}
                <div className="table-panel">
                    <div className="table-header">
                        <span>Active Processes / Containers</span>
                        <button className="btn btn-sm btn-secondary" onClick={loadData}>
                            <RefreshCw size={14} />
                        </button>
                    </div>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Name</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th>Domain</th>
                            </tr>
                        </thead>
                        <tbody>
                            {apps.length === 0 ? (
                                <tr>
                                    <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
                                        No applications found
                                    </td>
                                </tr>
                            ) : (
                                apps.slice(0, 6).map(app => (
                                    <tr key={app.id} onClick={() => navigate(`/apps/${app.id}`)} style={{ cursor: 'pointer' }}>
                                        <td>{app.id}</td>
                                        <td>
                                            <div className="app-name-cell">
                                                <span className="app-icon-mini">{getStackIcon(app.app_type)}</span>
                                                {app.name}
                                            </div>
                                        </td>
                                        <td>{app.app_type}</td>
                                        <td>
                                            <span className={`badge badge-${app.status === 'running' ? 'running' : 'warning'}`}>
                                                {app.status?.toUpperCase()}
                                            </span>
                                        </td>
                                        <td>{app.domains?.[0]?.name || '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
