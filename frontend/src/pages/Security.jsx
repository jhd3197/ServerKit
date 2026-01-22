import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../contexts/ToastContext';

const Security = () => {
    const { isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState('overview');
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStatus();
    }, []);

    async function loadStatus() {
        try {
            const data = await api.getSecurityStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load security status:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="page"><div className="loading">Loading security status...</div></div>;
    }

    return (
        <div className="page security-page">
            <div className="page-header">
                <div>
                    <h1>Security</h1>
                    <p className="page-subtitle">Firewall, malware scanning, file integrity, and security alerts</p>
                </div>
            </div>

            <div className="tabs-nav tabs-nav-scrollable">
                <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
                    Overview
                </button>
                <button className={`tab-btn ${activeTab === 'firewall' ? 'active' : ''}`} onClick={() => setActiveTab('firewall')}>
                    Firewall
                </button>
                <button className={`tab-btn ${activeTab === 'fail2ban' ? 'active' : ''}`} onClick={() => setActiveTab('fail2ban')}>
                    Fail2ban
                </button>
                <button className={`tab-btn ${activeTab === 'ssh-keys' ? 'active' : ''}`} onClick={() => setActiveTab('ssh-keys')}>
                    SSH Keys
                </button>
                <button className={`tab-btn ${activeTab === 'ip-lists' ? 'active' : ''}`} onClick={() => setActiveTab('ip-lists')}>
                    IP Lists
                </button>
                <button className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`} onClick={() => setActiveTab('scanner')}>
                    Malware Scanner
                </button>
                <button className={`tab-btn ${activeTab === 'quarantine' ? 'active' : ''}`} onClick={() => setActiveTab('quarantine')}>
                    Quarantine
                </button>
                <button className={`tab-btn ${activeTab === 'integrity' ? 'active' : ''}`} onClick={() => setActiveTab('integrity')}>
                    File Integrity
                </button>
                <button className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
                    Audit
                </button>
                <button className={`tab-btn ${activeTab === 'vulnerability' ? 'active' : ''}`} onClick={() => setActiveTab('vulnerability')}>
                    Vulnerability Scan
                </button>
                <button className={`tab-btn ${activeTab === 'updates' ? 'active' : ''}`} onClick={() => setActiveTab('updates')}>
                    Auto Updates
                </button>
                <button className={`tab-btn ${activeTab === 'events' ? 'active' : ''}`} onClick={() => setActiveTab('events')}>
                    Events
                </button>
                <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                    Settings
                </button>
            </div>

            <div className="tab-content">
                {activeTab === 'overview' && <OverviewTab status={status} onRefresh={loadStatus} />}
                {activeTab === 'firewall' && <FirewallTab />}
                {activeTab === 'fail2ban' && <Fail2banTab />}
                {activeTab === 'ssh-keys' && <SSHKeysTab />}
                {activeTab === 'ip-lists' && <IPListsTab />}
                {activeTab === 'scanner' && <ScannerTab />}
                {activeTab === 'quarantine' && <QuarantineTab />}
                {activeTab === 'integrity' && <IntegrityTab />}
                {activeTab === 'audit' && <AuditTab />}
                {activeTab === 'vulnerability' && <VulnerabilityTab />}
                {activeTab === 'updates' && <AutoUpdatesTab />}
                {activeTab === 'events' && <EventsTab />}
                {activeTab === 'settings' && <SettingsTab />}
            </div>
        </div>
    );
};

const OverviewTab = ({ status, onRefresh }) => {
    const [clamavStatus, setClamavStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadClamavStatus();
    }, []);

    async function loadClamavStatus() {
        try {
            const data = await api.getClamAVStatus();
            setClamavStatus(data);
        } catch (err) {
            console.error('Failed to load ClamAV status:', err);
        } finally {
            setLoading(false);
        }
    }

    const alerts = status?.recent_alerts || {};

    return (
        <div className="security-overview">
            <div className="stats-grid">
                <div className={`stat-card ${alerts.total > 0 ? 'warning' : 'success'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{alerts.total || 0}</span>
                        <span className="stat-label">Alerts (24h)</span>
                    </div>
                </div>

                <div className={`stat-card ${alerts.malware_detections > 0 ? 'danger' : 'success'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{alerts.malware_detections || 0}</span>
                        <span className="stat-label">Malware Detected</span>
                    </div>
                </div>

                <div className={`stat-card ${clamavStatus?.installed ? 'success' : 'warning'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            {clamavStatus?.installed && <polyline points="9 12 12 15 16 10"/>}
                            {!clamavStatus?.installed && <line x1="15" y1="9" x2="9" y2="15"/>}
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value">{clamavStatus?.installed ? 'Active' : 'Not Installed'}</span>
                        <span className="stat-label">ClamAV Status</span>
                    </div>
                </div>

                <div className={`stat-card ${status?.scan_status === 'running' ? 'info' : 'default'}`}>
                    <div className="stat-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-value" style={{ textTransform: 'capitalize' }}>{status?.scan_status || 'Idle'}</span>
                        <span className="stat-label">Scan Status</span>
                    </div>
                </div>
            </div>

            <div className="security-grid">
                <div className="card">
                    <div className="card-header">
                        <h3>ClamAV Antivirus</h3>
                        <button className="btn btn-sm btn-secondary" onClick={loadClamavStatus}>Refresh</button>
                    </div>
                    <div className="card-body">
                        {loading ? (
                            <div className="loading-sm">Loading...</div>
                        ) : clamavStatus?.installed ? (
                            <div className="info-list">
                                <div className="info-item">
                                    <span className="info-label">Version</span>
                                    <span className="info-value">{clamavStatus.version || 'Unknown'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Service</span>
                                    <span className={`badge ${clamavStatus.service_running ? 'badge-success' : 'badge-warning'}`}>
                                        {clamavStatus.service_running ? 'Running' : 'Stopped'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Last Definition Update</span>
                                    <span className="info-value">
                                        {clamavStatus.last_update ? new Date(clamavStatus.last_update).toLocaleString() : 'Unknown'}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="not-installed">
                                <p>ClamAV is not installed on this server.</p>
                                <InstallClamAVButton onInstalled={loadClamavStatus} />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>File Integrity Monitoring</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-list">
                            <div className="info-item">
                                <span className="info-label">Status</span>
                                <span className={`badge ${status?.file_integrity?.enabled ? 'badge-success' : 'badge-secondary'}`}>
                                    {status?.file_integrity?.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Database</span>
                                <span className={`badge ${status?.file_integrity?.database_exists ? 'badge-success' : 'badge-warning'}`}>
                                    {status?.file_integrity?.database_exists ? 'Initialized' : 'Not Initialized'}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Changes Detected (24h)</span>
                                <span className="info-value">{alerts.integrity_changes || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>Notifications</h3>
                    </div>
                    <div className="card-body">
                        <div className="info-list">
                            <div className="info-item">
                                <span className="info-label">Security Alerts</span>
                                <span className={`badge ${status?.notifications_enabled ? 'badge-success' : 'badge-secondary'}`}>
                                    {status?.notifications_enabled ? 'Enabled' : 'Disabled'}
                                </span>
                            </div>
                        </div>
                        <p className="help-text" style={{ marginTop: '1rem' }}>
                            Configure notification channels in Settings → Notifications to receive security alerts via Discord, Slack, or Telegram.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const InstallClamAVButton = ({ onInstalled }) => {
    const [installing, setInstalling] = useState(false);
    const [error, setError] = useState(null);

    async function handleInstall() {
        setInstalling(true);
        setError(null);
        try {
            await api.installClamAV();
            onInstalled();
        } catch (err) {
            setError(err.message);
        } finally {
            setInstalling(false);
        }
    }

    return (
        <div>
            <button className="btn btn-primary" onClick={handleInstall} disabled={installing}>
                {installing ? 'Installing...' : 'Install ClamAV'}
            </button>
            {error && <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p>}
        </div>
    );
};

const FirewallTab = () => {
    const [status, setStatus] = useState(null);
    const [rules, setRules] = useState([]);
    const [blockedIPs, setBlockedIPs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeSubTab, setActiveSubTab] = useState('status');
    const [showBlockIPModal, setShowBlockIPModal] = useState(false);
    const [showPortModal, setShowPortModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [blockIP, setBlockIP] = useState('');
    const [newPort, setNewPort] = useState({ port: '', protocol: 'tcp' });
    const [selectedFirewall, setSelectedFirewall] = useState('ufw');
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const toast = useToast();

    const commonPorts = [
        { port: 22, name: 'SSH', protocol: 'tcp' },
        { port: 80, name: 'HTTP', protocol: 'tcp' },
        { port: 443, name: 'HTTPS', protocol: 'tcp' },
        { port: 21, name: 'FTP', protocol: 'tcp' },
        { port: 25, name: 'SMTP', protocol: 'tcp' },
        { port: 3306, name: 'MySQL', protocol: 'tcp' },
        { port: 5432, name: 'PostgreSQL', protocol: 'tcp' },
        { port: 6379, name: 'Redis', protocol: 'tcp' },
        { port: 27017, name: 'MongoDB', protocol: 'tcp' },
    ];

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([loadStatus(), loadRules(), loadBlockedIPs()]);
        } catch (error) {
            console.error('Failed to load firewall data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getFirewallStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load status:', error);
        }
    };

    const loadRules = async () => {
        try {
            const data = await api.getFirewallRules();
            setRules(data.rules || []);
        } catch (error) {
            console.error('Failed to load rules:', error);
        }
    };

    const loadBlockedIPs = async () => {
        try {
            const data = await api.getBlockedIPs();
            setBlockedIPs(data.blocked_ips || []);
        } catch (error) {
            console.error('Failed to load blocked IPs:', error);
        }
    };

    const handleEnable = async () => {
        setActionLoading(true);
        try {
            await api.enableFirewall();
            toast.success('Firewall enabled');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to enable firewall: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisable = async () => {
        setConfirmDialog({
            title: 'Disable Firewall',
            message: 'Are you sure you want to disable the firewall? This will leave your server unprotected.',
            confirmText: 'Disable',
            variant: 'danger',
            onConfirm: async () => {
                setActionLoading(true);
                try {
                    await api.disableFirewall();
                    toast.success('Firewall disabled');
                    await loadStatus();
                } catch (error) {
                    toast.error(`Failed to disable firewall: ${error.message}`);
                } finally {
                    setActionLoading(false);
                    setConfirmDialog(null);
                }
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleBlockIP = async () => {
        if (!blockIP.trim()) return;
        setActionLoading(true);
        try {
            await api.blockIP(blockIP);
            toast.success(`IP ${blockIP} blocked`);
            setShowBlockIPModal(false);
            setBlockIP('');
            await loadBlockedIPs();
            await loadRules();
        } catch (error) {
            toast.error(`Failed to block IP: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnblockIP = async (ip) => {
        setConfirmDialog({
            title: 'Unblock IP',
            message: `Are you sure you want to unblock ${ip}?`,
            confirmText: 'Unblock',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await api.unblockIP(ip);
                    toast.success(`IP ${ip} unblocked`);
                    await loadBlockedIPs();
                    await loadRules();
                } catch (error) {
                    toast.error(`Failed to unblock IP: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleAllowPort = async () => {
        if (!newPort.port) return;
        setActionLoading(true);
        try {
            await api.allowPort(parseInt(newPort.port), newPort.protocol);
            toast.success(`Port ${newPort.port}/${newPort.protocol} allowed`);
            setShowPortModal(false);
            setNewPort({ port: '', protocol: 'tcp' });
            await loadRules();
        } catch (error) {
            toast.error(`Failed to allow port: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleQuickAllowPort = async (port, protocol) => {
        setActionLoading(true);
        try {
            await api.allowPort(port, protocol);
            toast.success(`Port ${port}/${protocol} allowed`);
            await loadRules();
        } catch (error) {
            toast.error(`Failed to allow port: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemovePort = async (port, protocol) => {
        setConfirmDialog({
            title: 'Remove Port Rule',
            message: `Are you sure you want to remove the rule for port ${port}/${protocol}?`,
            confirmText: 'Remove',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.denyPort(parseInt(port), protocol);
                    toast.success(`Port ${port}/${protocol} rule removed`);
                    await loadRules();
                } catch (error) {
                    toast.error(`Failed to remove port: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFirewall(selectedFirewall);
            toast.success(`${selectedFirewall.toUpperCase()} installed successfully`);
            setShowInstallModal(false);
            await loadData();
        } catch (error) {
            toast.error(`Failed to install firewall: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const isActive = status?.any_active;
    const activeFirewall = status?.active_firewall;

    if (loading) {
        return <div className="loading-sm">Loading firewall status...</div>;
    }

    return (
        <div className="firewall-tab">
            {!status?.any_installed ? (
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>No Firewall Installed</h3>
                    <p>Install a firewall to protect your server from unauthorized access.</p>
                    <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                        Install Firewall
                    </button>
                </div>
            ) : (
                <>
                    <div className="firewall-header">
                        <div className="firewall-status-row">
                            <div className={`status-indicator ${isActive ? 'active' : 'inactive'}`}>
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                                <span>{isActive ? 'Firewall Active' : 'Firewall Inactive'}</span>
                                <span className="firewall-type">({activeFirewall?.toUpperCase()})</span>
                            </div>
                            <div className="firewall-actions">
                                <button className="btn btn-sm btn-secondary" onClick={() => setShowBlockIPModal(true)}>
                                    Block IP
                                </button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setShowPortModal(true)}>
                                    Allow Port
                                </button>
                                {isActive ? (
                                    <button className="btn btn-sm btn-danger" onClick={handleDisable} disabled={actionLoading}>
                                        Disable
                                    </button>
                                ) : (
                                    <button className="btn btn-sm btn-success" onClick={handleEnable} disabled={actionLoading}>
                                        Enable
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="firewall-stats">
                        <div className="stat-mini">
                            <span className="stat-value">{rules.length}</span>
                            <span className="stat-label">Rules</span>
                        </div>
                        <div className="stat-mini">
                            <span className="stat-value">{blockedIPs.length}</span>
                            <span className="stat-label">Blocked IPs</span>
                        </div>
                        <div className="stat-mini">
                            <span className="stat-value">{rules.filter(r => r.type === 'port' || r.port).length}</span>
                            <span className="stat-label">Ports Open</span>
                        </div>
                    </div>

                    <div className="subtabs">
                        <button className={`subtab ${activeSubTab === 'status' ? 'active' : ''}`} onClick={() => setActiveSubTab('status')}>
                            Status
                        </button>
                        <button className={`subtab ${activeSubTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveSubTab('rules')}>
                            Rules
                        </button>
                        <button className={`subtab ${activeSubTab === 'blocked' ? 'active' : ''}`} onClick={() => setActiveSubTab('blocked')}>
                            Blocked IPs
                        </button>
                        <button className={`subtab ${activeSubTab === 'quick' ? 'active' : ''}`} onClick={() => setActiveSubTab('quick')}>
                            Quick Ports
                        </button>
                    </div>

                    {activeSubTab === 'status' && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Firewall Information</h3>
                                <button className="btn btn-sm btn-secondary" onClick={loadData}>Refresh</button>
                            </div>
                            <div className="card-body">
                                <div className="info-list">
                                    <div className="info-item">
                                        <span className="info-label">Type</span>
                                        <span className="info-value">{activeFirewall?.toUpperCase()}</span>
                                    </div>
                                    <div className="info-item">
                                        <span className="info-label">Status</span>
                                        <span className={`badge ${isActive ? 'badge-success' : 'badge-danger'}`}>
                                            {isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                    {activeFirewall === 'firewalld' && status?.firewalld?.default_zone && (
                                        <div className="info-item">
                                            <span className="info-label">Default Zone</span>
                                            <span className="info-value">{status.firewalld.default_zone}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeSubTab === 'rules' && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Firewall Rules</h3>
                                <button className="btn btn-sm btn-primary" onClick={() => setShowPortModal(true)}>Add Rule</button>
                            </div>
                            <div className="card-body">
                                {rules.length === 0 ? (
                                    <p className="text-muted">No rules configured</p>
                                ) : (
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Type</th>
                                                <th>Target</th>
                                                <th>Protocol</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rules.map((rule, index) => (
                                                <tr key={index}>
                                                    <td><span className="badge badge-info">{rule.type}</span></td>
                                                    <td>
                                                        {rule.type === 'service' && rule.service}
                                                        {rule.type === 'port' && rule.port}
                                                        {rule.type === 'rich' && <code>{rule.rule}</code>}
                                                    </td>
                                                    <td>{rule.protocol || '-'}</td>
                                                    <td>
                                                        {rule.type === 'port' && (
                                                            <button className="btn btn-sm btn-danger" onClick={() => handleRemovePort(rule.port, rule.protocol)}>
                                                                Remove
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {activeSubTab === 'blocked' && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Blocked IP Addresses</h3>
                                <button className="btn btn-sm btn-primary" onClick={() => setShowBlockIPModal(true)}>Block IP</button>
                            </div>
                            <div className="card-body">
                                {blockedIPs.length === 0 ? (
                                    <div className="empty-state-sm">
                                        <p>No blocked IPs</p>
                                    </div>
                                ) : (
                                    <div className="blocked-list">
                                        {blockedIPs.map((item, index) => (
                                            <div key={index} className="blocked-item">
                                                <div className="blocked-info">
                                                    <span className="blocked-ip">{item.ip}</span>
                                                </div>
                                                <button className="btn btn-sm btn-warning" onClick={() => handleUnblockIP(item.ip)}>
                                                    Unblock
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {activeSubTab === 'quick' && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Quick Port Access</h3>
                            </div>
                            <div className="card-body">
                                <p className="text-muted" style={{ marginBottom: '1rem' }}>One-click enable/disable common service ports</p>
                                <div className="quick-ports-grid">
                                    {commonPorts.map(({ port, name, protocol }) => {
                                        const isAllowed = rules.some(r =>
                                            (r.port === String(port) || r.port === port) && r.protocol === protocol
                                        );
                                        return (
                                            <div key={port} className="quick-port-card">
                                                <div className="port-info">
                                                    <span className="port-name">{name}</span>
                                                    <span className="port-number">{port}/{protocol}</span>
                                                </div>
                                                {isAllowed ? (
                                                    <button className="btn btn-sm btn-danger" onClick={() => handleRemovePort(port, protocol)} disabled={actionLoading}>
                                                        Block
                                                    </button>
                                                ) : (
                                                    <button className="btn btn-sm btn-success" onClick={() => handleQuickAllowPort(port, protocol)} disabled={actionLoading}>
                                                        Allow
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Block IP Modal */}
            {showBlockIPModal && (
                <div className="modal-overlay" onClick={() => setShowBlockIPModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Block IP Address</h2>
                            <button className="btn btn-icon" onClick={() => setShowBlockIPModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>IP Address</label>
                                <input
                                    type="text"
                                    value={blockIP}
                                    onChange={(e) => setBlockIP(e.target.value)}
                                    placeholder="192.168.1.100 or 10.0.0.0/24"
                                />
                            </div>
                            <p className="text-muted">You can block a single IP or a range using CIDR notation.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowBlockIPModal(false)}>Cancel</button>
                            <button className="btn btn-danger" onClick={handleBlockIP} disabled={actionLoading || !blockIP.trim()}>
                                {actionLoading ? 'Blocking...' : 'Block IP'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Allow Port Modal */}
            {showPortModal && (
                <div className="modal-overlay" onClick={() => setShowPortModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Allow Port</h2>
                            <button className="btn btn-icon" onClick={() => setShowPortModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Port Number</label>
                                    <input
                                        type="number"
                                        value={newPort.port}
                                        onChange={(e) => setNewPort({ ...newPort, port: e.target.value })}
                                        placeholder="8080"
                                        min="1"
                                        max="65535"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Protocol</label>
                                    <select value={newPort.protocol} onChange={(e) => setNewPort({ ...newPort, protocol: e.target.value })}>
                                        <option value="tcp">TCP</option>
                                        <option value="udp">UDP</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPortModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAllowPort} disabled={actionLoading || !newPort.port}>
                                {actionLoading ? 'Adding...' : 'Allow Port'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Install Firewall Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install Firewall</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Select Firewall</label>
                                <select value={selectedFirewall} onChange={(e) => setSelectedFirewall(e.target.value)}>
                                    <option value="ufw">UFW (Recommended for Ubuntu)</option>
                                    <option value="firewalld">firewalld (CentOS/RHEL)</option>
                                </select>
                            </div>
                            <div className="install-info">
                                {selectedFirewall === 'ufw' ? (
                                    <p><strong>UFW (Uncomplicated Firewall)</strong> is simple and easy to use for Ubuntu/Debian systems.</p>
                                ) : (
                                    <p><strong>firewalld</strong> is a dynamically managed firewall with zone-based configuration for CentOS/RHEL.</p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleInstall} disabled={actionLoading}>
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

const ScannerTab = () => {
    const [scanStatus, setScanStatus] = useState({ status: 'idle' });
    const [scanPath, setScanPath] = useState('/var/www');
    const [scanning, setScanning] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [history, setHistory] = useState([]);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadScanStatus();
        loadHistory();
        const interval = setInterval(loadScanStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    async function loadScanStatus() {
        try {
            const data = await api.getScanStatus();
            setScanStatus(data);
        } catch (err) {
            console.error('Failed to load scan status:', err);
        }
    }

    async function loadHistory() {
        try {
            const data = await api.getScanHistory(20);
            setHistory(data.scans || []);
        } catch (err) {
            console.error('Failed to load scan history:', err);
        }
    }

    async function handleStartScan(type) {
        setScanning(true);
        setMessage(null);
        try {
            let result;
            if (type === 'quick') {
                result = await api.runQuickScan();
            } else if (type === 'full') {
                result = await api.runFullScan();
            } else {
                result = await api.scanDirectory(scanPath);
            }
            setMessage({ type: 'success', text: result.message });
            loadScanStatus();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setScanning(false);
        }
    }

    async function handleUpdateDefinitions() {
        setUpdating(true);
        setMessage(null);
        try {
            const result = await api.updateVirusDefinitions();
            setMessage({ type: result.success ? 'success' : 'error', text: result.message || result.error });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setUpdating(false);
        }
    }

    async function handleCancelScan() {
        try {
            await api.cancelScan();
            loadScanStatus();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    }

    const isScanning = scanStatus.status === 'running';

    return (
        <div className="scanner-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="scanner-actions card">
                <div className="card-header">
                    <h3>Malware Scanner</h3>
                    <button className="btn btn-sm btn-secondary" onClick={handleUpdateDefinitions} disabled={updating}>
                        {updating ? 'Updating...' : 'Update Definitions'}
                    </button>
                </div>
                <div className="card-body">
                    <div className="scan-options">
                        <div className="scan-preset">
                            <button
                                className="btn btn-primary btn-lg"
                                onClick={() => handleStartScan('quick')}
                                disabled={isScanning || scanning}
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
                                Quick Scan
                            </button>
                            <span className="scan-desc">Scan common web directories</span>
                        </div>

                        <div className="scan-preset">
                            <button
                                className="btn btn-secondary btn-lg"
                                onClick={() => handleStartScan('full')}
                                disabled={isScanning || scanning}
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="6"/>
                                    <circle cx="12" cy="12" r="2"/>
                                </svg>
                                Full Scan
                            </button>
                            <span className="scan-desc">Scan entire system (slow)</span>
                        </div>

                        <div className="scan-custom">
                            <label>Custom Path</label>
                            <div className="input-group">
                                <input
                                    type="text"
                                    value={scanPath}
                                    onChange={(e) => setScanPath(e.target.value)}
                                    placeholder="/path/to/scan"
                                    disabled={isScanning}
                                />
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleStartScan('custom')}
                                    disabled={isScanning || scanning || !scanPath}
                                >
                                    Scan
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {isScanning && (
                <div className="card scan-progress">
                    <div className="card-header">
                        <h3>Scan in Progress</h3>
                        <button className="btn btn-sm btn-danger" onClick={handleCancelScan}>
                            Cancel
                        </button>
                    </div>
                    <div className="card-body">
                        <div className="progress-info">
                            <div className="spinner"></div>
                            <div>
                                <p><strong>Scanning:</strong> {scanStatus.directory}</p>
                                <p><strong>Started:</strong> {new Date(scanStatus.started_at).toLocaleString()}</p>
                                {scanStatus.files_scanned > 0 && (
                                    <p><strong>Files scanned:</strong> {scanStatus.files_scanned}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Scan History</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadHistory}>Refresh</button>
                </div>
                <div className="card-body">
                    {history.length === 0 ? (
                        <p className="text-muted">No scan history available.</p>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Directory</th>
                                    <th>Status</th>
                                    <th>Threats</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((scan, index) => (
                                    <tr key={index}>
                                        <td>{new Date(scan.started_at).toLocaleString()}</td>
                                        <td className="path-cell">{scan.directory}</td>
                                        <td>
                                            <span className={`badge badge-${scan.status === 'completed' ? 'success' : scan.status === 'error' ? 'danger' : 'warning'}`}>
                                                {scan.status}
                                            </span>
                                        </td>
                                        <td>
                                            {scan.infected_files?.length > 0 ? (
                                                <span className="badge badge-danger">{scan.infected_files.length} found</span>
                                            ) : (
                                                <span className="badge badge-success">Clean</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const QuarantineTab = () => {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadFiles();
    }, []);

    async function loadFiles() {
        try {
            const data = await api.getQuarantinedFiles();
            setFiles(data.files || []);
        } catch (err) {
            console.error('Failed to load quarantined files:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(filename) {
        if (!confirm(`Permanently delete ${filename}? This cannot be undone.`)) return;

        try {
            await api.deleteQuarantinedFile(filename);
            setMessage({ type: 'success', text: 'File deleted' });
            loadFiles();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        }
    }

    function formatBytes(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    return (
        <div className="quarantine-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Quarantined Files</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadFiles}>Refresh</button>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-sm">Loading...</div>
                    ) : files.length === 0 ? (
                        <div className="empty-state">
                            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                <polyline points="9 12 12 15 16 10"/>
                            </svg>
                            <p>No files in quarantine</p>
                            <span className="text-muted">Infected files will appear here when detected</span>
                        </div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Filename</th>
                                    <th>Size</th>
                                    <th>Quarantined</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.map((file, index) => (
                                    <tr key={index}>
                                        <td className="path-cell">{file.name}</td>
                                        <td>{formatBytes(file.size)}</td>
                                        <td>{new Date(file.quarantined_at).toLocaleString()}</td>
                                        <td>
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() => handleDelete(file.name)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

const IntegrityTab = () => {
    const [checking, setChecking] = useState(false);
    const [initializing, setInitializing] = useState(false);
    const [results, setResults] = useState(null);
    const [message, setMessage] = useState(null);

    async function handleInitialize() {
        if (!confirm('This will create a new baseline for file integrity monitoring. Continue?')) return;

        setInitializing(true);
        setMessage(null);
        try {
            const result = await api.initializeIntegrityDatabase();
            setMessage({ type: 'success', text: result.message });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setInitializing(false);
        }
    }

    async function handleCheck() {
        setChecking(true);
        setMessage(null);
        try {
            const result = await api.checkFileIntegrity();
            setResults(result);
            if (result.total_changes === 0) {
                setMessage({ type: 'success', text: 'No changes detected' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setChecking(false);
        }
    }

    return (
        <div className="integrity-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>File Integrity Monitoring</h3>
                </div>
                <div className="card-body">
                    <p className="description">
                        File integrity monitoring tracks changes to critical system files. Initialize a baseline database,
                        then periodically check for unauthorized modifications.
                    </p>

                    <div className="integrity-actions">
                        <button
                            className="btn btn-secondary"
                            onClick={handleInitialize}
                            disabled={initializing}
                        >
                            {initializing ? 'Initializing...' : 'Initialize Baseline'}
                        </button>
                        <button
                            className="btn btn-primary"
                            onClick={handleCheck}
                            disabled={checking}
                        >
                            {checking ? 'Checking...' : 'Check Integrity'}
                        </button>
                    </div>
                </div>
            </div>

            {results && results.total_changes > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h3>Changes Detected</h3>
                        <span className="badge badge-warning">{results.total_changes} changes</span>
                    </div>
                    <div className="card-body">
                        {results.changes.modified?.length > 0 && (
                            <div className="change-section">
                                <h4>Modified Files ({results.changes.modified.length})</h4>
                                <ul className="file-list">
                                    {results.changes.modified.map((file, i) => (
                                        <li key={i}>{file.path}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.changes.deleted?.length > 0 && (
                            <div className="change-section">
                                <h4>Deleted Files ({results.changes.deleted.length})</h4>
                                <ul className="file-list">
                                    {results.changes.deleted.map((file, i) => (
                                        <li key={i}>{file}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {results.changes.new?.length > 0 && (
                            <div className="change-section">
                                <h4>New Files ({results.changes.new.length})</h4>
                                <ul className="file-list">
                                    {results.changes.new.slice(0, 50).map((file, i) => (
                                        <li key={i}>{file}</li>
                                    ))}
                                    {results.changes.new.length > 50 && (
                                        <li className="text-muted">... and {results.changes.new.length - 50} more</li>
                                    )}
                                </ul>
                            </div>
                        )}

                        {results.changes.permission_changed?.length > 0 && (
                            <div className="change-section">
                                <h4>Permission Changes ({results.changes.permission_changed.length})</h4>
                                <ul className="file-list">
                                    {results.changes.permission_changed.map((file, i) => (
                                        <li key={i}>{file.path} ({file.old_mode} → {file.new_mode})</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const EventsTab = () => {
    const [events, setEvents] = useState([]);
    const [failedLogins, setFailedLogins] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadEvents();
        loadFailedLogins();
    }, []);

    async function loadEvents() {
        try {
            const data = await api.getSecurityEvents(50);
            setEvents(data.events || []);
        } catch (err) {
            console.error('Failed to load security events:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadFailedLogins() {
        try {
            const data = await api.getFailedLogins(24);
            setFailedLogins(data);
        } catch (err) {
            console.error('Failed to load failed logins:', err);
        }
    }

    function getEventIcon(type) {
        if (type.includes('malware')) {
            return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>;
        }
        if (type.includes('integrity')) {
            return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
        }
        return <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    }

    return (
        <div className="events-tab">
            {failedLogins && (
                <div className={`card ${failedLogins.alert_triggered ? 'card-warning' : ''}`}>
                    <div className="card-header">
                        <h3>Failed Login Attempts (24h)</h3>
                        <button className="btn btn-sm btn-secondary" onClick={loadFailedLogins}>Refresh</button>
                    </div>
                    <div className="card-body">
                        <div className="failed-login-summary">
                            <span className={`count ${failedLogins.alert_triggered ? 'danger' : ''}`}>
                                {failedLogins.failed_attempts}
                            </span>
                            <span className="label">failed attempts (threshold: {failedLogins.threshold})</span>
                        </div>
                        {failedLogins.recent_failures?.length > 0 && (
                            <details className="recent-failures">
                                <summary>View recent failures</summary>
                                <pre>{failedLogins.recent_failures.join('\n')}</pre>
                            </details>
                        )}
                    </div>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>Security Events</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadEvents}>Refresh</button>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-sm">Loading...</div>
                    ) : events.length === 0 ? (
                        <p className="text-muted">No security events recorded.</p>
                    ) : (
                        <div className="events-list">
                            {events.map((event, index) => (
                                <div key={index} className={`event-item ${event.type}`}>
                                    <div className="event-icon">{getEventIcon(event.type)}</div>
                                    <div className="event-content">
                                        <span className="event-message">{event.message}</span>
                                        <span className="event-time">{new Date(event.timestamp).toLocaleString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const SettingsTab = () => {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        loadConfig();
    }, []);

    async function loadConfig() {
        try {
            const data = await api.getSecurityConfig();
            setConfig(data);
        } catch (err) {
            console.error('Failed to load security config:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSecurityConfig(config);
            setMessage({ type: 'success', text: 'Settings saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    function updateConfig(section, key, value) {
        setConfig(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    }

    if (loading) {
        return <div className="loading-sm">Loading settings...</div>;
    }

    return (
        <div className="settings-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3>ClamAV Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Enable ClamAV scanning</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.clamav?.enabled || false}
                                    onChange={(e) => updateConfig('clamav', 'enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Scan files on upload</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.clamav?.scan_on_upload || false}
                                    onChange={(e) => updateConfig('clamav', 'scan_on_upload', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label>Quarantine Path</label>
                        <input
                            type="text"
                            value={config?.clamav?.quarantine_path || '/var/quarantine'}
                            onChange={(e) => updateConfig('clamav', 'quarantine_path', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>File Integrity Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Enable file integrity monitoring</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.file_integrity?.enabled || false}
                                    onChange={(e) => updateConfig('file_integrity', 'enabled', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Alert on file changes</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.file_integrity?.alert_on_change || false}
                                    onChange={(e) => updateConfig('file_integrity', 'alert_on_change', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3>Notification Settings</h3>
                </div>
                <div className="card-body">
                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on malware detection</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_malware_found || false}
                                    onChange={(e) => updateConfig('notifications', 'on_malware_found', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on integrity changes</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_integrity_change || false}
                                    onChange={(e) => updateConfig('notifications', 'on_integrity_change', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>

                    <div className="form-group">
                        <label className="toggle-switch-label">
                            <span>Notify on suspicious activity</span>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    checked={config?.notifications?.on_suspicious_activity || false}
                                    onChange={(e) => updateConfig('notifications', 'on_suspicious_activity', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </label>
                    </div>
                </div>
            </div>

            <div className="form-actions">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
};

const Fail2banTab = () => {
    const [status, setStatus] = useState(null);
    const [bans, setBans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [showBanModal, setShowBanModal] = useState(false);
    const [banIP, setBanIP] = useState('');
    const [banJail, setBanJail] = useState('sshd');
    const [confirmDialog, setConfirmDialog] = useState(null);
    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statusData, bansData] = await Promise.all([
                api.getFail2banStatus(),
                api.getAllFail2banBans().catch(() => ({ banned_ips: [] }))
            ]);
            setStatus(statusData);
            setBans(bansData.banned_ips || []);
        } catch (error) {
            console.error('Failed to load Fail2ban data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFail2ban();
            toast.success('Fail2ban installed successfully');
            await loadData();
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleBan = async () => {
        if (!banIP.trim()) return;
        setActionLoading(true);
        try {
            await api.fail2banBan(banIP, banJail);
            toast.success(`IP ${banIP} banned in ${banJail}`);
            setShowBanModal(false);
            setBanIP('');
            await loadData();
        } catch (error) {
            toast.error(`Failed to ban IP: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnban = async (ip, jail) => {
        setConfirmDialog({
            title: 'Unban IP',
            message: `Are you sure you want to unban ${ip} from ${jail}?`,
            confirmText: 'Unban',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await api.fail2banUnban(ip, jail);
                    toast.success(`IP ${ip} unbanned`);
                    await loadData();
                } catch (error) {
                    toast.error(`Failed to unban: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    if (loading) {
        return <div className="loading-sm">Loading Fail2ban status...</div>;
    }

    return (
        <div className="fail2ban-tab">
            {!status?.installed ? (
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <h3>Fail2ban Not Installed</h3>
                    <p>Install Fail2ban to protect against brute force attacks.</p>
                    <button className="btn btn-primary" onClick={handleInstall} disabled={actionLoading}>
                        {actionLoading ? 'Installing...' : 'Install Fail2ban'}
                    </button>
                </div>
            ) : (
                <>
                    <div className="card">
                        <div className="card-header">
                            <h3>Fail2ban Status</h3>
                            <div className="card-actions">
                                <button className="btn btn-sm btn-primary" onClick={() => setShowBanModal(true)}>
                                    Ban IP
                                </button>
                                <button className="btn btn-sm btn-secondary" onClick={loadData}>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <div className="card-body">
                            <div className="info-list">
                                <div className="info-item">
                                    <span className="info-label">Service</span>
                                    <span className={`badge ${status.service_running ? 'badge-success' : 'badge-danger'}`}>
                                        {status.service_running ? 'Running' : 'Stopped'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Version</span>
                                    <span className="info-value">{status.version || 'Unknown'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Active Jails</span>
                                    <span className="info-value">{status.jails?.join(', ') || 'None'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Total Banned IPs</span>
                                    <span className="info-value">{bans.length}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header">
                            <h3>Banned IPs</h3>
                        </div>
                        <div className="card-body">
                            {bans.length === 0 ? (
                                <p className="text-muted">No IPs are currently banned.</p>
                            ) : (
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>IP Address</th>
                                            <th>Jail</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bans.map((ban, index) => (
                                            <tr key={index}>
                                                <td><code>{ban.ip}</code></td>
                                                <td><span className="badge badge-info">{ban.jail}</span></td>
                                                <td>
                                                    <button className="btn btn-sm btn-warning" onClick={() => handleUnban(ban.ip, ban.jail)}>
                                                        Unban
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </>
            )}

            {showBanModal && (
                <div className="modal-overlay" onClick={() => setShowBanModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Ban IP Address</h2>
                            <button className="btn btn-icon" onClick={() => setShowBanModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>IP Address</label>
                                <input
                                    type="text"
                                    value={banIP}
                                    onChange={(e) => setBanIP(e.target.value)}
                                    placeholder="192.168.1.100"
                                />
                            </div>
                            <div className="form-group">
                                <label>Jail</label>
                                <select value={banJail} onChange={(e) => setBanJail(e.target.value)}>
                                    {status?.jails?.map(jail => (
                                        <option key={jail} value={jail}>{jail}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowBanModal(false)}>Cancel</button>
                            <button className="btn btn-danger" onClick={handleBan} disabled={actionLoading || !banIP.trim()}>
                                {actionLoading ? 'Banning...' : 'Ban IP'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

const SSHKeysTab = () => {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newKey, setNewKey] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const toast = useToast();

    useEffect(() => {
        loadKeys();
    }, []);

    const loadKeys = async () => {
        setLoading(true);
        try {
            const data = await api.getSSHKeys();
            setKeys(data.keys || []);
        } catch (error) {
            console.error('Failed to load SSH keys:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddKey = async () => {
        if (!newKey.trim()) return;
        setActionLoading(true);
        try {
            await api.addSSHKey(newKey);
            toast.success('SSH key added successfully');
            setShowAddModal(false);
            setNewKey('');
            await loadKeys();
        } catch (error) {
            toast.error(`Failed to add key: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemoveKey = async (keyId, comment) => {
        setConfirmDialog({
            title: 'Remove SSH Key',
            message: `Are you sure you want to remove the SSH key${comment ? ` "${comment}"` : ''}? This may lock you out if it's your only key.`,
            confirmText: 'Remove',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.removeSSHKey(keyId);
                    toast.success('SSH key removed');
                    await loadKeys();
                } catch (error) {
                    toast.error(`Failed to remove key: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    return (
        <div className="ssh-keys-tab">
            <div className="card">
                <div className="card-header">
                    <h3>SSH Authorized Keys</h3>
                    <div className="card-actions">
                        <button className="btn btn-sm btn-primary" onClick={() => setShowAddModal(true)}>
                            Add Key
                        </button>
                        <button className="btn btn-sm btn-secondary" onClick={loadKeys}>
                            Refresh
                        </button>
                    </div>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div className="loading-sm">Loading...</div>
                    ) : keys.length === 0 ? (
                        <div className="empty-state-sm">
                            <p>No SSH keys configured for root user.</p>
                            <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                                Add SSH Key
                            </button>
                        </div>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Fingerprint</th>
                                    <th>Comment</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {keys.map((key) => (
                                    <tr key={key.id}>
                                        <td><code>{key.type}</code></td>
                                        <td><code className="fingerprint">{key.fingerprint}</code></td>
                                        <td>{key.comment || '-'}</td>
                                        <td>
                                            <button className="btn btn-sm btn-danger" onClick={() => handleRemoveKey(key.id, key.comment)}>
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add SSH Public Key</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Public Key</label>
                                <textarea
                                    value={newKey}
                                    onChange={(e) => setNewKey(e.target.value)}
                                    placeholder="ssh-rsa AAAA... user@host or ssh-ed25519 AAAA... user@host"
                                    rows={4}
                                />
                                <p className="help-text">Paste your SSH public key (typically from ~/.ssh/id_rsa.pub or ~/.ssh/id_ed25519.pub)</p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAddKey} disabled={actionLoading || !newKey.trim()}>
                                {actionLoading ? 'Adding...' : 'Add Key'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

const IPListsTab = () => {
    const [lists, setLists] = useState({ allowlist: [], blocklist: [] });
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(null);
    const [newIP, setNewIP] = useState('');
    const [newComment, setNewComment] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const toast = useToast();

    useEffect(() => {
        loadLists();
    }, []);

    const loadLists = async () => {
        setLoading(true);
        try {
            const data = await api.getIPLists();
            setLists({
                allowlist: data.allowlist || [],
                blocklist: data.blocklist || []
            });
        } catch (error) {
            console.error('Failed to load IP lists:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newIP.trim()) return;
        setActionLoading(true);
        try {
            await api.addToIPList(newIP, showAddModal, newComment);
            toast.success(`IP added to ${showAddModal}`);
            setShowAddModal(null);
            setNewIP('');
            setNewComment('');
            await loadLists();
        } catch (error) {
            toast.error(`Failed to add IP: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemove = async (ip, listType) => {
        setConfirmDialog({
            title: `Remove from ${listType}`,
            message: `Are you sure you want to remove ${ip} from the ${listType}?`,
            confirmText: 'Remove',
            variant: 'warning',
            onConfirm: async () => {
                try {
                    await api.removeFromIPList(ip, listType);
                    toast.success(`IP removed from ${listType}`);
                    await loadLists();
                } catch (error) {
                    toast.error(`Failed to remove IP: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const renderList = (title, listType, items, badgeClass) => (
        <div className="card">
            <div className="card-header">
                <h3>{title}</h3>
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddModal(listType)}>
                    Add IP
                </button>
            </div>
            <div className="card-body">
                {items.length === 0 ? (
                    <p className="text-muted">No IPs in {listType}.</p>
                ) : (
                    <div className="ip-list">
                        {items.map((item, index) => (
                            <div key={index} className="ip-list-item">
                                <div className="ip-info">
                                    <code className={badgeClass}>{item.ip}</code>
                                    {item.comment && <span className="ip-comment">{item.comment}</span>}
                                    <span className="ip-date">{new Date(item.added_at).toLocaleDateString()}</span>
                                </div>
                                <button className="btn btn-sm btn-danger" onClick={() => handleRemove(item.ip, listType)}>
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    if (loading) {
        return <div className="loading-sm">Loading IP lists...</div>;
    }

    return (
        <div className="ip-lists-tab">
            <div className="ip-lists-grid">
                {renderList('Allowlist', 'allowlist', lists.allowlist, 'ip-allowed')}
                {renderList('Blocklist', 'blocklist', lists.blocklist, 'ip-blocked')}
            </div>

            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add to {showAddModal}</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddModal(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>IP Address or CIDR</label>
                                <input
                                    type="text"
                                    value={newIP}
                                    onChange={(e) => setNewIP(e.target.value)}
                                    placeholder="192.168.1.100 or 10.0.0.0/24"
                                />
                            </div>
                            <div className="form-group">
                                <label>Comment (optional)</label>
                                <input
                                    type="text"
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    placeholder="Office IP, VPN, etc."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAdd} disabled={actionLoading || !newIP.trim()}>
                                {actionLoading ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
};

const AuditTab = () => {
    const [audit, setAudit] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const runAudit = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.generateSecurityAudit();
            setAudit(data.audit);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getSeverityClass = (severity) => {
        switch (severity) {
            case 'pass': return 'badge-success';
            case 'critical': return 'badge-danger';
            case 'warning': return 'badge-warning';
            case 'info': return 'badge-info';
            default: return 'badge-secondary';
        }
    };

    const getScoreClass = (score) => {
        if (score >= 80) return 'score-excellent';
        if (score >= 60) return 'score-good';
        if (score >= 40) return 'score-fair';
        return 'score-poor';
    };

    return (
        <div className="audit-tab">
            <div className="card">
                <div className="card-header">
                    <h3>Security Audit</h3>
                    <button className="btn btn-primary" onClick={runAudit} disabled={loading}>
                        {loading ? 'Running Audit...' : 'Run Audit'}
                    </button>
                </div>
                <div className="card-body">
                    {error && <div className="alert alert-danger">{error}</div>}

                    {!audit && !loading && (
                        <div className="empty-state">
                            <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
                            </svg>
                            <p>Run a security audit to check your server's configuration.</p>
                        </div>
                    )}

                    {loading && (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>Running security audit...</p>
                        </div>
                    )}

                    {audit && !loading && (
                        <div className="audit-results">
                            <div className={`audit-score ${getScoreClass(audit.score)}`}>
                                <span className="score-value">{audit.score}</span>
                                <span className="score-label">Security Score</span>
                            </div>

                            <div className="audit-timestamp">
                                Generated: {new Date(audit.generated_at).toLocaleString()}
                            </div>

                            {Object.entries(audit.services || {}).map(([service, data]) => (
                                <div key={service} className="audit-section">
                                    <h4>{service.toUpperCase()}</h4>
                                    <div className="findings-list">
                                        {data.findings?.map((finding, idx) => (
                                            <div key={idx} className="finding-item">
                                                <span className={`badge ${getSeverityClass(finding.severity)}`}>
                                                    {finding.severity}
                                                </span>
                                                <span className="finding-message">{finding.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {audit.recommendations?.length > 0 && (
                                <div className="audit-section recommendations">
                                    <h4>Recommendations</h4>
                                    <ul>
                                        {audit.recommendations.map((rec, idx) => (
                                            <li key={idx}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const VulnerabilityTab = () => {
    const [lynisStatus, setLynisStatus] = useState(null);
    const [scanStatus, setScanStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadStatus();
    }, []);

    useEffect(() => {
        let interval;
        if (scanStatus?.status === 'running') {
            interval = setInterval(loadScanStatus, 5000);
        }
        return () => clearInterval(interval);
    }, [scanStatus?.status]);

    const loadStatus = async () => {
        setLoading(true);
        try {
            const [lynis, scan] = await Promise.all([
                api.getLynisStatus(),
                api.getLynisScanStatus()
            ]);
            setLynisStatus(lynis);
            setScanStatus(scan);
        } catch (error) {
            console.error('Failed to load Lynis status:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadScanStatus = async () => {
        try {
            const scan = await api.getLynisScanStatus();
            setScanStatus(scan);
        } catch (error) {
            console.error('Failed to load scan status:', error);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installLynis();
            toast.success('Lynis installed successfully');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleStartScan = async () => {
        setActionLoading(true);
        try {
            await api.runLynisScan();
            toast.success('Vulnerability scan started');
            await loadScanStatus();
        } catch (error) {
            toast.error(`Failed to start scan: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div className="loading-sm">Loading vulnerability scanner status...</div>;
    }

    return (
        <div className="vulnerability-tab">
            {!lynisStatus?.installed ? (
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="6"/>
                        <circle cx="12" cy="12" r="2"/>
                    </svg>
                    <h3>Lynis Not Installed</h3>
                    <p>Install Lynis to perform security audits and vulnerability scanning.</p>
                    <button className="btn btn-primary" onClick={handleInstall} disabled={actionLoading}>
                        {actionLoading ? 'Installing...' : 'Install Lynis'}
                    </button>
                </div>
            ) : (
                <>
                    <div className="card">
                        <div className="card-header">
                            <h3>Lynis Vulnerability Scanner</h3>
                            <button
                                className="btn btn-primary"
                                onClick={handleStartScan}
                                disabled={actionLoading || scanStatus?.status === 'running'}
                            >
                                {scanStatus?.status === 'running' ? 'Scanning...' : 'Start Scan'}
                            </button>
                        </div>
                        <div className="card-body">
                            <div className="info-list">
                                <div className="info-item">
                                    <span className="info-label">Version</span>
                                    <span className="info-value">{lynisStatus.version || 'Unknown'}</span>
                                </div>
                                <div className="info-item">
                                    <span className="info-label">Scan Status</span>
                                    <span className={`badge badge-${scanStatus?.status === 'completed' ? 'success' : scanStatus?.status === 'running' ? 'info' : 'secondary'}`}>
                                        {scanStatus?.status || 'Idle'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {scanStatus?.status === 'running' && (
                        <div className="card scan-progress">
                            <div className="card-header">
                                <h3>Scan in Progress</h3>
                            </div>
                            <div className="card-body">
                                <div className="progress-info">
                                    <div className="spinner"></div>
                                    <p>Scanning system for vulnerabilities...</p>
                                    <p className="text-muted">Started: {new Date(scanStatus.started_at).toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {scanStatus?.status === 'completed' && (
                        <div className="card">
                            <div className="card-header">
                                <h3>Scan Results</h3>
                                {scanStatus.hardening_index && (
                                    <span className={`badge badge-${scanStatus.hardening_index >= 70 ? 'success' : scanStatus.hardening_index >= 50 ? 'warning' : 'danger'}`}>
                                        Hardening Index: {scanStatus.hardening_index}
                                    </span>
                                )}
                            </div>
                            <div className="card-body">
                                {scanStatus.warnings?.length > 0 && (
                                    <div className="scan-section">
                                        <h4>Warnings ({scanStatus.warnings.length})</h4>
                                        <ul className="findings-list compact">
                                            {scanStatus.warnings.slice(0, 20).map((warning, idx) => (
                                                <li key={idx} className="warning">{warning}</li>
                                            ))}
                                            {scanStatus.warnings.length > 20 && (
                                                <li className="text-muted">...and {scanStatus.warnings.length - 20} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}

                                {scanStatus.suggestions?.length > 0 && (
                                    <div className="scan-section">
                                        <h4>Suggestions ({scanStatus.suggestions.length})</h4>
                                        <ul className="findings-list compact">
                                            {scanStatus.suggestions.slice(0, 20).map((suggestion, idx) => (
                                                <li key={idx} className="suggestion">{suggestion}</li>
                                            ))}
                                            {scanStatus.suggestions.length > 20 && (
                                                <li className="text-muted">...and {scanStatus.suggestions.length - 20} more</li>
                                            )}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const AutoUpdatesTab = () => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        loadStatus();
    }, []);

    const loadStatus = async () => {
        setLoading(true);
        try {
            const data = await api.getAutoUpdatesStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load auto-updates status:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installAutoUpdates();
            toast.success('Auto-updates package installed');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to install: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleEnable = async () => {
        setActionLoading(true);
        try {
            await api.enableAutoUpdates();
            toast.success('Automatic updates enabled');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to enable: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisable = async () => {
        setActionLoading(true);
        try {
            await api.disableAutoUpdates();
            toast.success('Automatic updates disabled');
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to disable: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return <div className="loading-sm">Loading auto-updates status...</div>;
    }

    if (!status?.supported) {
        return (
            <div className="auto-updates-tab">
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    <h3>Not Supported</h3>
                    <p>Automatic security updates are not supported on this system.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="auto-updates-tab">
            <div className="card">
                <div className="card-header">
                    <h3>Automatic Security Updates</h3>
                    <button className="btn btn-sm btn-secondary" onClick={loadStatus}>Refresh</button>
                </div>
                <div className="card-body">
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Package</span>
                            <span className="info-value">{status.package}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Installed</span>
                            <span className={`badge ${status.installed ? 'badge-success' : 'badge-warning'}`}>
                                {status.installed ? 'Yes' : 'No'}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Status</span>
                            <span className={`badge ${status.enabled ? 'badge-success' : 'badge-secondary'}`}>
                                {status.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                    </div>

                    <div className="auto-updates-actions" style={{ marginTop: '1.5rem' }}>
                        {!status.installed ? (
                            <button className="btn btn-primary" onClick={handleInstall} disabled={actionLoading}>
                                {actionLoading ? 'Installing...' : 'Install Auto-Updates'}
                            </button>
                        ) : status.enabled ? (
                            <button className="btn btn-warning" onClick={handleDisable} disabled={actionLoading}>
                                {actionLoading ? 'Disabling...' : 'Disable Auto-Updates'}
                            </button>
                        ) : (
                            <button className="btn btn-success" onClick={handleEnable} disabled={actionLoading}>
                                {actionLoading ? 'Enabling...' : 'Enable Auto-Updates'}
                            </button>
                        )}
                    </div>

                    <div className="help-text" style={{ marginTop: '1.5rem' }}>
                        <p>
                            <strong>What are automatic security updates?</strong><br/>
                            When enabled, your server will automatically download and install security updates,
                            helping protect against known vulnerabilities without manual intervention.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Security;
