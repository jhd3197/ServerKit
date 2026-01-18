import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Cpu, MemoryStick, HardDrive, Server,
    Plus, RefreshCw, Activity, Layers,
    Database, Globe, Container, Code,
    ArrowRight, Clock, CheckCircle
} from 'lucide-react';
import api from '../services/api';
import { useMetrics } from '../hooks/useMetrics';

const Dashboard = () => {
    const navigate = useNavigate();
    const { metrics, loading: metricsLoading, connected } = useMetrics(true);
    const [apps, setApps] = useState([]);
    const [services, setServices] = useState([]);
    const [dbStatus, setDbStatus] = useState(null);
    const [uptime, setUptime] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [appsData, servicesData, dbData, uptimeData] = await Promise.all([
                api.getApps(),
                api.getServicesStatus().catch(() => ({ services: [] })),
                api.getDatabasesStatus().catch(() => null),
                api.getCurrentUptime().catch(() => null)
            ]);
            setApps(appsData.apps || []);
            setServices(servicesData.services || []);
            setDbStatus(dbData);
            setUptime(uptimeData);
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
            case 'docker': return <Container size={20} />;
            case 'wordpress':
            case 'php': return <Code size={20} />;
            case 'flask':
            case 'django': return <Layers size={20} />;
            default: return <Globe size={20} />;
        }
    }

    function getStackColor(type) {
        const colors = {
            'php': '#777bb4',
            'wordpress': '#21759b',
            'flask': '#000000',
            'django': '#092e20',
            'docker': '#2496ed',
            'static': '#60a5fa',
        };
        return colors[type] || '#6366f1';
    }

    const runningApps = apps.filter(a => a.status === 'running').length;
    const runningServices = services.filter(s => s.status === 'running').length;

    const uptimeFormatted = uptime?.uptime_formatted || { days: 0, hours: 0, minutes: 0, seconds: 0 };

    if (loading && metricsLoading) {
        return <div className="loading">Loading dashboard...</div>;
    }

    return (
        <div className="dashboard-page">
            <header className="top-bar">
                <div>
                    <h1>Dashboard</h1>
                    <div className="subtitle">
                        Server overview
                        {connected && <span className="live-indicator"> Live</span>}
                    </div>
                </div>
                <div className="top-bar-actions">
                    <button className="btn btn-secondary" onClick={loadData}>
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                    <button className="btn btn-primary" onClick={() => navigate('/apps')}>
                        <Plus size={16} />
                        New App
                    </button>
                </div>
            </header>

            {/* Server Status Bar */}
            <div className="server-status-bar">
                <div className="status-bar-left">
                    <div className="server-status-indicator">
                        <CheckCircle size={18} className="status-icon-ok" />
                        <span className="status-text">Operational</span>
                    </div>
                    {uptime && (
                        <div className="uptime-inline">
                            <Clock size={14} />
                            <span>
                                {uptimeFormatted.days}d {String(uptimeFormatted.hours).padStart(2, '0')}h {String(uptimeFormatted.minutes).padStart(2, '0')}m
                            </span>
                        </div>
                    )}
                </div>
                <div className="status-bar-right">
                    <div className="status-bar-stat">
                        <span className="stat-label">Apps</span>
                        <span className="stat-value">{runningApps}/{apps.length}</span>
                    </div>
                    <div className="status-bar-stat">
                        <span className="stat-label">Services</span>
                        <span className="stat-value">{runningServices}/{services.length}</span>
                    </div>
                </div>
            </div>

            {/* System Metrics */}
            {metrics && (
                <div className="metrics-grid">
                    <div className="metric-card">
                        <div className="metric-header">
                            <Cpu size={16} className="metric-icon" />
                            <span>CPU</span>
                        </div>
                        <div className="metric-value-row">
                            <span className="metric-value">{metrics.cpu?.percent || 0}%</span>
                            <span className="metric-detail">{metrics.cpu?.cores} cores</span>
                        </div>
                        <div className="metric-bar">
                            <div
                                className="metric-bar-fill"
                                style={{
                                    width: `${metrics.cpu?.percent || 0}%`,
                                    background: (metrics.cpu?.percent || 0) > 80 ? 'var(--danger)' :
                                               (metrics.cpu?.percent || 0) > 60 ? 'var(--warning)' : 'var(--success)'
                                }}
                            />
                        </div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <MemoryStick size={16} className="metric-icon" />
                            <span>Memory</span>
                        </div>
                        <div className="metric-value-row">
                            <span className="metric-value">{metrics.memory?.ram?.percent || 0}%</span>
                            <span className="metric-detail">{metrics.memory?.ram?.used_human} / {metrics.memory?.ram?.total_human}</span>
                        </div>
                        <div className="metric-bar">
                            <div
                                className="metric-bar-fill"
                                style={{
                                    width: `${metrics.memory?.ram?.percent || 0}%`,
                                    background: (metrics.memory?.ram?.percent || 0) > 90 ? 'var(--danger)' : 'var(--accent-primary)'
                                }}
                            />
                        </div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <HardDrive size={16} className="metric-icon" />
                            <span>Disk</span>
                        </div>
                        <div className="metric-value-row">
                            <span className="metric-value">{metrics.disk?.partitions?.[0]?.percent || 0}%</span>
                            <span className="metric-detail">{metrics.disk?.partitions?.[0]?.used_human} / {metrics.disk?.partitions?.[0]?.total_human}</span>
                        </div>
                        <div className="metric-bar">
                            <div
                                className="metric-bar-fill"
                                style={{
                                    width: `${metrics.disk?.partitions?.[0]?.percent || 0}%`,
                                    background: (metrics.disk?.partitions?.[0]?.percent || 0) > 90 ? 'var(--danger)' : 'var(--accent-primary)'
                                }}
                            />
                        </div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <Activity size={16} className="metric-icon" />
                            <span>Network</span>
                        </div>
                        <div className="metric-value-row">
                            <span className="metric-value">{metrics.network?.io?.bytes_sent_human || '0B'}</span>
                            <span className="metric-detail">sent</span>
                        </div>
                        <div className="metric-sub-value">
                            Recv: {metrics.network?.io?.bytes_recv_human || '0B'}
                        </div>
                    </div>
                </div>
            )}

            {/* Two Column Layout */}
            <div className="dashboard-columns">
                {/* Left Column - Services & Databases */}
                <div className="dashboard-column">
                    {/* Services */}
                    {services.length > 0 && (
                        <div className="dashboard-card">
                            <div className="card-title">
                                <Server size={16} />
                                Services
                            </div>
                            <div className="services-list">
                                {services.map(service => (
                                    <div key={service.name} className="service-row">
                                        <span className={`status-dot ${service.status === 'running' ? 'running' : 'stopped'}`} />
                                        <span className="service-name">{service.name}</span>
                                        <span className={`service-status ${service.status}`}>{service.status}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Database Status */}
                    {dbStatus && (
                        <div className="dashboard-card">
                            <div className="card-title">
                                <Database size={16} />
                                Databases
                            </div>
                            <div className="db-list">
                                <div className="db-row">
                                    <div className="db-icon mysql">M</div>
                                    <span className="db-name">MySQL</span>
                                    <span className={`db-status ${dbStatus.mysql?.running ? 'running' : 'stopped'}`}>
                                        {dbStatus.mysql?.running ? 'Running' : 'Stopped'}
                                    </span>
                                </div>
                                <div className="db-row">
                                    <div className="db-icon postgres">P</div>
                                    <span className="db-name">PostgreSQL</span>
                                    <span className={`db-status ${dbStatus.postgresql?.running ? 'running' : 'stopped'}`}>
                                        {dbStatus.postgresql?.running ? 'Running' : 'Stopped'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Quick Actions */}
                    <div className="dashboard-card">
                        <div className="card-title">Quick Actions</div>
                        <div className="quick-links">
                            <button className="quick-link" onClick={() => navigate('/apps')}>
                                <Layers size={16} />
                                Applications
                            </button>
                            <button className="quick-link" onClick={() => navigate('/docker')}>
                                <Container size={16} />
                                Docker
                            </button>
                            <button className="quick-link" onClick={() => navigate('/databases')}>
                                <Database size={16} />
                                Databases
                            </button>
                            <button className="quick-link" onClick={() => navigate('/domains')}>
                                <Globe size={16} />
                                Domains
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Column - Applications */}
                <div className="dashboard-column dashboard-column-wide">
                    <div className="dashboard-card">
                        <div className="card-title-row">
                            <div className="card-title">
                                <Layers size={16} />
                                Applications
                            </div>
                            <button className="btn btn-sm btn-link" onClick={() => navigate('/apps')}>
                                View All <ArrowRight size={14} />
                            </button>
                        </div>

                        {apps.length === 0 ? (
                            <div className="empty-apps">
                                <Layers size={32} className="empty-icon" />
                                <p>No applications yet</p>
                                <button className="btn btn-primary btn-sm" onClick={() => navigate('/apps')}>
                                    <Plus size={14} />
                                    Create App
                                </button>
                            </div>
                        ) : (
                            <div className="apps-table">
                                <div className="apps-table-header">
                                    <span>Name</span>
                                    <span>Type</span>
                                    <span>Status</span>
                                    <span>Domain</span>
                                </div>
                                {apps.slice(0, 8).map(app => (
                                    <div
                                        key={app.id}
                                        className="apps-table-row"
                                        onClick={() => navigate(`/apps/${app.id}`)}
                                    >
                                        <span className="app-name">
                                            <div className="app-icon-small" style={{ background: getStackColor(app.app_type) }}>
                                                {getStackIcon(app.app_type)}
                                            </div>
                                            {app.name}
                                        </span>
                                        <span className="app-type">{app.app_type}</span>
                                        <span className={`app-status ${getStatusClass(app.status)}`}>
                                            <span className="status-dot" />
                                            {app.status}
                                        </span>
                                        <span className="app-domain">
                                            {app.domains?.[0]?.name || '-'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
