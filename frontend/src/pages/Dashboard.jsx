import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Cpu, MemoryStick, HardDrive, Clock, Server,
    Plus, FileText, RefreshCw, Activity, Layers,
    Database, Globe, Container, Code, CheckCircle,
    AlertCircle, XCircle, ArrowRight
} from 'lucide-react';
import api from '../services/api';
import { useMetrics } from '../hooks/useMetrics';

const Dashboard = () => {
    const navigate = useNavigate();
    const { metrics, loading: metricsLoading, connected } = useMetrics(true);
    const [apps, setApps] = useState([]);
    const [services, setServices] = useState([]);
    const [dbStatus, setDbStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [appsData, servicesData, dbData] = await Promise.all([
                api.getApps(),
                api.getServicesStatus().catch(() => ({ services: [] })),
                api.getDatabasesStatus().catch(() => null)
            ]);
            setApps(appsData.apps || []);
            setServices(servicesData.services || []);
            setDbStatus(dbData);
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

    function parseUptime(uptimeStr) {
        if (!uptimeStr) return { days: 0, hours: 0, minutes: 0 };

        const match = uptimeStr.match(/(\d+)d\s*(\d+)h\s*(\d+)m|(\d+)h\s*(\d+)m|(\d+)m/);
        if (!match) return { days: 0, hours: 0, minutes: 0 };

        if (match[1]) {
            return { days: parseInt(match[1]), hours: parseInt(match[2]), minutes: parseInt(match[3]) };
        } else if (match[4]) {
            return { days: 0, hours: parseInt(match[4]), minutes: parseInt(match[5]) };
        } else {
            return { days: 0, hours: 0, minutes: parseInt(match[6]) };
        }
    }

    const uptime = parseUptime(metrics?.system?.uptime_human);
    const runningApps = apps.filter(a => a.status === 'running').length;
    const runningServices = services.filter(s => s.status === 'running').length;

    if (loading && metricsLoading) {
        return <div className="loading">Loading dashboard...</div>;
    }

    return (
        <div>
            <header className="top-bar">
                <div>
                    <h1>Dashboard</h1>
                    <div className="subtitle">
                        Overview of your server status and applications
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
                        New Application
                    </button>
                </div>
            </header>

            {/* Uptime Display */}
            {metrics?.system && (
                <div className="uptime-display">
                    <Server size={24} style={{ color: 'var(--success)' }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                            Server Uptime
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div className="uptime-item">
                                <span className="uptime-value">{uptime.days}</span>
                                <span className="uptime-label">Days</span>
                            </div>
                            <span className="uptime-separator">:</span>
                            <div className="uptime-item">
                                <span className="uptime-value">{String(uptime.hours).padStart(2, '0')}</span>
                                <span className="uptime-label">Hours</span>
                            </div>
                            <span className="uptime-separator">:</span>
                            <div className="uptime-item">
                                <span className="uptime-value">{String(uptime.minutes).padStart(2, '0')}</span>
                                <span className="uptime-label">Minutes</span>
                            </div>
                        </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            {metrics.system?.hostname}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            {metrics.system?.platform}
                        </div>
                    </div>
                </div>
            )}

            {/* System Metrics */}
            {metrics && (
                <div className="system-metrics">
                    <div className="metric-card">
                        <div className="metric-header">
                            <h4>CPU Usage</h4>
                            <Cpu size={18} className="metric-icon" />
                        </div>
                        <div className="metric-main">
                            <span className="metric-value">{metrics.cpu?.percent || 0}</span>
                            <span className="metric-unit">%</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${metrics.cpu?.percent || 0}%`,
                                    background: (metrics.cpu?.percent || 0) > 80 ? 'var(--danger)' :
                                               (metrics.cpu?.percent || 0) > 60 ? 'var(--warning)' : 'var(--success)'
                                }}
                            />
                        </div>
                        <div className="metric-sub">{metrics.cpu?.cores} cores @ {metrics.cpu?.frequency_mhz} MHz</div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <h4>Memory</h4>
                            <MemoryStick size={18} className="metric-icon" />
                        </div>
                        <div className="metric-main">
                            <span className="metric-value">{metrics.memory?.ram?.percent || 0}</span>
                            <span className="metric-unit">%</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${metrics.memory?.ram?.percent || 0}%`,
                                    background: 'var(--accent-primary)'
                                }}
                            />
                        </div>
                        <div className="metric-sub">
                            {metrics.memory?.ram?.used_human} / {metrics.memory?.ram?.total_human}
                        </div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <h4>Disk Space</h4>
                            <HardDrive size={18} className="metric-icon" />
                        </div>
                        <div className="metric-main">
                            <span className="metric-value">{metrics.disk?.partitions?.[0]?.percent || 0}</span>
                            <span className="metric-unit">%</span>
                        </div>
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{
                                    width: `${metrics.disk?.partitions?.[0]?.percent || 0}%`,
                                    background: (metrics.disk?.partitions?.[0]?.percent || 0) > 90 ? 'var(--danger)' : 'var(--accent-primary)'
                                }}
                            />
                        </div>
                        <div className="metric-sub">
                            {metrics.disk?.partitions?.[0]?.used_human} / {metrics.disk?.partitions?.[0]?.total_human}
                        </div>
                    </div>

                    <div className="metric-card">
                        <div className="metric-header">
                            <h4>Network I/O</h4>
                            <Activity size={18} className="metric-icon" />
                        </div>
                        <div className="metric-main">
                            <span className="metric-value" style={{ fontSize: '18px' }}>
                                {metrics.network?.io?.bytes_sent_human || '0B'}
                            </span>
                            <span className="metric-unit">sent</span>
                        </div>
                        <div className="metric-sub">
                            Received: {metrics.network?.io?.bytes_recv_human || '0B'}
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Actions */}
            <h2 className="section-title">Quick Actions</h2>
            <div className="quick-actions">
                <div className="quick-action-card" onClick={() => navigate('/apps')}>
                    <div className="action-icon">
                        <Layers size={24} />
                    </div>
                    <h4>Applications</h4>
                    <p>{runningApps} of {apps.length} running</p>
                </div>
                <div className="quick-action-card" onClick={() => navigate('/docker')}>
                    <div className="action-icon">
                        <Container size={24} />
                    </div>
                    <h4>Docker</h4>
                    <p>Manage containers</p>
                </div>
                <div className="quick-action-card" onClick={() => navigate('/databases')}>
                    <div className="action-icon">
                        <Database size={24} />
                    </div>
                    <h4>Databases</h4>
                    <p>MySQL & PostgreSQL</p>
                </div>
                <div className="quick-action-card" onClick={() => navigate('/domains')}>
                    <div className="action-icon">
                        <Globe size={24} />
                    </div>
                    <h4>Domains</h4>
                    <p>Manage sites</p>
                </div>
            </div>

            {/* Services Status */}
            {services.length > 0 && (
                <>
                    <h2 className="section-title">Services</h2>
                    <div className="services-grid">
                        {services.map(service => (
                            <div key={service.name} className="service-item">
                                <span className={`service-dot ${service.status === 'running' ? 'running' : 'stopped'}`} />
                                <span className="service-name">{service.name}</span>
                                <span className="service-status">{service.status}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Database Status */}
            {dbStatus && (
                <>
                    <h2 className="section-title" style={{ marginTop: '32px' }}>Database Servers</h2>
                    <div className="db-status">
                        <div className="db-status-item">
                            <div className="status-icon mysql">M</div>
                            <div className="status-info">
                                <h3>MySQL / MariaDB</h3>
                                <span className={dbStatus.mysql?.running ? 'running' : 'stopped'}>
                                    {dbStatus.mysql?.running ? 'Running' : 'Stopped'}
                                    {dbStatus.mysql?.version && ` - ${dbStatus.mysql.version}`}
                                </span>
                            </div>
                        </div>
                        <div className="db-status-item">
                            <div className="status-icon postgresql">P</div>
                            <div className="status-info">
                                <h3>PostgreSQL</h3>
                                <span className={dbStatus.postgresql?.running ? 'running' : 'stopped'}>
                                    {dbStatus.postgresql?.running ? 'Running' : 'Stopped'}
                                    {dbStatus.postgresql?.version && ` - ${dbStatus.postgresql.version}`}
                                </span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Active Projects */}
            <div className="section-header" style={{ marginTop: '32px' }}>
                <h2 className="section-title" style={{ marginBottom: 0 }}>Active Projects</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/apps')}>
                    View All <ArrowRight size={14} />
                </button>
            </div>

            {apps.length === 0 ? (
                <div className="empty-state">
                    <Layers size={48} />
                    <h3>No applications yet</h3>
                    <p>Create your first application to get started.</p>
                    <button className="btn btn-primary" onClick={() => navigate('/apps')}>
                        <Plus size={16} />
                        Create Application
                    </button>
                </div>
            ) : (
                <div className="dashboard-grid">
                    {apps.slice(0, 6).map(app => (
                        <div key={app.id} className="card" onClick={() => navigate(`/apps/${app.id}`)}>
                            <div className="card-header">
                                <div className="app-icon" style={{ background: getStackColor(app.app_type) }}>
                                    {getStackIcon(app.app_type)}
                                </div>
                                <div className={`status-badge ${getStatusClass(app.status)}`}>
                                    <div className="status-dot" />
                                    {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                                </div>
                            </div>
                            <h3>{app.name}</h3>
                            {app.domains && app.domains[0] && (
                                <a
                                    href={`https://${app.domains[0].name}`}
                                    className="card-link"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                >
                                    {app.domains[0].name}
                                </a>
                            )}
                            <div className="metric-row">
                                <div className="metric-item">
                                    <span>Stack</span>
                                    <span className="metric-value" style={{ color: getStackColor(app.app_type) }}>
                                        {app.app_type.toUpperCase()}
                                        {app.php_version && ` / PHP ${app.php_version}`}
                                        {app.python_version && ` / Py ${app.python_version}`}
                                    </span>
                                </div>
                                {app.port && (
                                    <div className="metric-item">
                                        <span>Port</span>
                                        <span className="metric-value">{app.port}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Dashboard;
