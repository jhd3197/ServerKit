import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Monitoring = () => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [config, setConfig] = useState(null);
    const [thresholds, setThresholds] = useState(null);
    const [alertHistory, setAlertHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    // Config form state
    const [configForm, setConfigForm] = useState({
        enabled: false,
        check_interval: 60,
        alert_email: '',
        alert_webhook: ''
    });

    // Threshold form state
    const [thresholdForm, setThresholdForm] = useState({
        cpu_percent: 90,
        memory_percent: 90,
        disk_percent: 90,
        load_average: 5.0
    });

    const [testEmail, setTestEmail] = useState('');
    const [testWebhook, setTestWebhook] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [statusRes, configRes, thresholdsRes, historyRes] = await Promise.all([
                api.getMonitoringStatus(),
                api.getMonitoringConfig(),
                api.getMonitoringThresholds(),
                api.getAlertHistory(50)
            ]);

            setStatus(statusRes);
            setConfig(configRes);
            setThresholds(thresholdsRes.thresholds);
            setAlertHistory(historyRes.alerts || []);

            if (configRes) {
                setConfigForm({
                    enabled: configRes.enabled || false,
                    check_interval: configRes.check_interval || 60,
                    alert_email: configRes.alert_email || '',
                    alert_webhook: configRes.alert_webhook || ''
                });
            }

            if (thresholdsRes.thresholds) {
                setThresholdForm(thresholdsRes.thresholds);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleToggleMonitoring = async () => {
        try {
            if (status?.monitoring_active) {
                await api.stopMonitoring();
            } else {
                await api.startMonitoring();
            }
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateMonitoringConfig(configForm);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSaveThresholds = async (e) => {
        e.preventDefault();
        try {
            await api.updateMonitoringThresholds(thresholdForm);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    };

    const handleTestEmail = async () => {
        try {
            await api.testEmailAlert(testEmail || configForm.alert_email);
            toast.success('Test email sent successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleTestWebhook = async () => {
        try {
            await api.testWebhookAlert(testWebhook || configForm.alert_webhook);
            toast.success('Test webhook sent successfully');
        } catch (err) {
            toast.error(err.message);
        }
    };

    const getAlertSeverityClass = (severity) => {
        switch (severity) {
            case 'critical': return 'badge-danger';
            case 'warning': return 'badge-warning';
            case 'info': return 'badge-info';
            default: return 'badge-secondary';
        }
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    if (loading) {
        return <div className="page"><div className="loading">Loading monitoring data...</div></div>;
    }

    return (
        <div className="page monitoring-page">
            <div className="page-header">
                <div>
                    <h1>Monitoring & Alerts</h1>
                    <p className="page-subtitle">System monitoring and alert configuration</p>
                </div>
                <div className="page-actions">
                    <button
                        className={`btn ${status?.monitoring_active ? 'btn-danger' : 'btn-primary'}`}
                        onClick={handleToggleMonitoring}
                    >
                        {status?.monitoring_active ? (
                            <>
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <rect x="6" y="4" width="4" height="16"/>
                                    <rect x="14" y="4" width="4" height="16"/>
                                </svg>
                                Stop Monitoring
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
                                Start Monitoring
                            </>
                        )}
                    </button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            <div className="tabs">
                <button
                    className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                >
                    Overview
                </button>
                <button
                    className={`tab ${activeTab === 'alerts' ? 'active' : ''}`}
                    onClick={() => setActiveTab('alerts')}
                >
                    Alert History
                </button>
                <button
                    className={`tab ${activeTab === 'config' ? 'active' : ''}`}
                    onClick={() => setActiveTab('config')}
                >
                    Configuration
                </button>
                <button
                    className={`tab ${activeTab === 'thresholds' ? 'active' : ''}`}
                    onClick={() => setActiveTab('thresholds')}
                >
                    Thresholds
                </button>
            </div>

            {activeTab === 'overview' && (
                <div className="monitoring-overview">
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-icon status">
                                <svg viewBox="0 0 24 24" width="24" height="24">
                                    <circle cx="12" cy="12" r="10"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <span className="stat-label">Monitoring Status</span>
                                <span className={`stat-value ${status?.monitoring_active ? 'text-success' : 'text-muted'}`}>
                                    {status?.monitoring_active ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon alerts">
                                <svg viewBox="0 0 24 24" width="24" height="24">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <span className="stat-label">Recent Alerts</span>
                                <span className="stat-value">{alertHistory.length}</span>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon interval">
                                <svg viewBox="0 0 24 24" width="24" height="24">
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <span className="stat-label">Check Interval</span>
                                <span className="stat-value">{config?.check_interval || 60}s</span>
                            </div>
                        </div>

                        <div className="stat-card">
                            <div className="stat-icon notifications">
                                <svg viewBox="0 0 24 24" width="24" height="24">
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                                    <polyline points="22,6 12,13 2,6"/>
                                </svg>
                            </div>
                            <div className="stat-content">
                                <span className="stat-label">Notifications</span>
                                <span className="stat-value">
                                    {config?.alert_email ? 'Email' : ''}
                                    {config?.alert_email && config?.alert_webhook ? ' + ' : ''}
                                    {config?.alert_webhook ? 'Webhook' : ''}
                                    {!config?.alert_email && !config?.alert_webhook ? 'None' : ''}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <h3>Current Thresholds</h3>
                        </div>
                        <div className="card-body">
                            <div className="threshold-grid">
                                <div className="threshold-item">
                                    <span className="threshold-label">CPU Usage</span>
                                    <span className="threshold-value">{thresholds?.cpu_percent || 90}%</span>
                                </div>
                                <div className="threshold-item">
                                    <span className="threshold-label">Memory Usage</span>
                                    <span className="threshold-value">{thresholds?.memory_percent || 90}%</span>
                                </div>
                                <div className="threshold-item">
                                    <span className="threshold-label">Disk Usage</span>
                                    <span className="threshold-value">{thresholds?.disk_percent || 90}%</span>
                                </div>
                                <div className="threshold-item">
                                    <span className="threshold-label">Load Average</span>
                                    <span className="threshold-value">{thresholds?.load_average || 5.0}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {alertHistory.length > 0 && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Recent Alerts</h3>
                            </div>
                            <div className="card-body">
                                <div className="alert-list">
                                    {alertHistory.slice(0, 5).map((alert, index) => (
                                        <div key={index} className="alert-item">
                                            <span className={`badge ${getAlertSeverityClass(alert.severity)}`}>
                                                {alert.severity}
                                            </span>
                                            <span className="alert-message">{alert.message}</span>
                                            <span className="alert-time">{formatTimestamp(alert.timestamp)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'alerts' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Alert History</h3>
                        <button className="btn btn-secondary btn-sm" onClick={loadData}>
                            Refresh
                        </button>
                    </div>
                    <div className="card-body">
                        {alertHistory.length === 0 ? (
                            <div className="empty-state">
                                <svg viewBox="0 0 24 24" width="48" height="48">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                                </svg>
                                <h3>No Alerts</h3>
                                <p>No alerts have been triggered yet.</p>
                            </div>
                        ) : (
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Severity</th>
                                        <th>Type</th>
                                        <th>Message</th>
                                        <th>Value</th>
                                        <th>Threshold</th>
                                        <th>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {alertHistory.map((alert, index) => (
                                        <tr key={index}>
                                            <td>
                                                <span className={`badge ${getAlertSeverityClass(alert.severity)}`}>
                                                    {alert.severity}
                                                </span>
                                            </td>
                                            <td>{alert.type}</td>
                                            <td>{alert.message}</td>
                                            <td>{alert.value?.toFixed(1)}</td>
                                            <td>{alert.threshold}</td>
                                            <td>{formatTimestamp(alert.timestamp)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'config' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Monitoring Configuration</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleSaveConfig}>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={configForm.enabled}
                                        onChange={(e) => setConfigForm({...configForm, enabled: e.target.checked})}
                                    />
                                    <span>Enable Monitoring</span>
                                </label>
                            </div>

                            <div className="form-group">
                                <label>Check Interval (seconds)</label>
                                <input
                                    type="number"
                                    value={configForm.check_interval}
                                    onChange={(e) => setConfigForm({...configForm, check_interval: parseInt(e.target.value)})}
                                    min="10"
                                    max="3600"
                                />
                            </div>

                            <div className="form-group">
                                <label>Alert Email</label>
                                <div className="input-group">
                                    <input
                                        type="email"
                                        value={configForm.alert_email}
                                        onChange={(e) => setConfigForm({...configForm, alert_email: e.target.value})}
                                        placeholder="alerts@example.com"
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={handleTestEmail}
                                        disabled={!configForm.alert_email}
                                    >
                                        Test
                                    </button>
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Webhook URL</label>
                                <div className="input-group">
                                    <input
                                        type="url"
                                        value={configForm.alert_webhook}
                                        onChange={(e) => setConfigForm({...configForm, alert_webhook: e.target.value})}
                                        placeholder="https://hooks.slack.com/..."
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={handleTestWebhook}
                                        disabled={!configForm.alert_webhook}
                                    >
                                        Test
                                    </button>
                                </div>
                            </div>

                            <div className="form-actions">
                                <button type="submit" className="btn btn-primary">Save Configuration</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {activeTab === 'thresholds' && (
                <div className="card">
                    <div className="card-header">
                        <h3>Alert Thresholds</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleSaveThresholds}>
                            <div className="threshold-form-grid">
                                <div className="form-group">
                                    <label>CPU Usage (%)</label>
                                    <input
                                        type="number"
                                        value={thresholdForm.cpu_percent}
                                        onChange={(e) => setThresholdForm({...thresholdForm, cpu_percent: parseInt(e.target.value)})}
                                        min="1"
                                        max="100"
                                    />
                                    <span className="form-help">Alert when CPU exceeds this percentage</span>
                                </div>

                                <div className="form-group">
                                    <label>Memory Usage (%)</label>
                                    <input
                                        type="number"
                                        value={thresholdForm.memory_percent}
                                        onChange={(e) => setThresholdForm({...thresholdForm, memory_percent: parseInt(e.target.value)})}
                                        min="1"
                                        max="100"
                                    />
                                    <span className="form-help">Alert when memory exceeds this percentage</span>
                                </div>

                                <div className="form-group">
                                    <label>Disk Usage (%)</label>
                                    <input
                                        type="number"
                                        value={thresholdForm.disk_percent}
                                        onChange={(e) => setThresholdForm({...thresholdForm, disk_percent: parseInt(e.target.value)})}
                                        min="1"
                                        max="100"
                                    />
                                    <span className="form-help">Alert when disk exceeds this percentage</span>
                                </div>

                                <div className="form-group">
                                    <label>Load Average</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={thresholdForm.load_average}
                                        onChange={(e) => setThresholdForm({...thresholdForm, load_average: parseFloat(e.target.value)})}
                                        min="0.1"
                                        max="100"
                                    />
                                    <span className="form-help">Alert when load average exceeds this value</span>
                                </div>
                            </div>

                            <div className="form-actions">
                                <button type="submit" className="btn btn-primary">Save Thresholds</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Monitoring;
