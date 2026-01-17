import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function Firewall() {
    const [status, setStatus] = useState(null);
    const [rules, setRules] = useState([]);
    const [blockedIPs, setBlockedIPs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
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
            await Promise.all([
                loadStatus(),
                loadRules(),
                loadBlockedIPs()
            ]);
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
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="firewall-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Firewall</h1>
                    <p className="page-description">Manage firewall rules and IP blocking</p>
                </div>
                <div className="page-header-actions">
                    {!status?.any_installed ? (
                        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                            Install Firewall
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowBlockIPModal(true)}
                            >
                                Block IP
                            </button>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowPortModal(true)}
                            >
                                Allow Port
                            </button>
                            {isActive ? (
                                <button
                                    className="btn btn-danger"
                                    onClick={handleDisable}
                                    disabled={actionLoading}
                                >
                                    Disable Firewall
                                </button>
                            ) : (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleEnable}
                                    disabled={actionLoading}
                                >
                                    Enable Firewall
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {!status?.any_installed ? (
                <div className="empty-state-large">
                    <span className="icon">security</span>
                    <h2>No Firewall Installed</h2>
                    <p>Install a firewall to protect your server from unauthorized access.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => setShowInstallModal(true)}>
                        Install Firewall
                    </button>
                </div>
            ) : (
                <>
                    <div className="status-cards">
                        <div className={`status-card ${isActive ? 'success' : 'danger'}`}>
                            <div className="status-icon">
                                <span className="icon">{isActive ? 'shield' : 'shield_outlined'}</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Firewall Status</span>
                                <span className="status-value">{isActive ? 'Active' : 'Inactive'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">dns</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Firewall Type</span>
                                <span className="status-value">{activeFirewall?.toUpperCase() || 'None'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">rule</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Active Rules</span>
                                <span className="status-value">{rules.length}</span>
                            </div>
                        </div>
                        <div className="status-card warning">
                            <div className="status-icon">
                                <span className="icon">block</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Blocked IPs</span>
                                <span className="status-value">{blockedIPs.length}</span>
                            </div>
                        </div>
                    </div>

                    <div className="tabs">
                        <button
                            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
                            onClick={() => setActiveTab('overview')}
                        >
                            Overview
                        </button>
                        <button
                            className={`tab ${activeTab === 'rules' ? 'active' : ''}`}
                            onClick={() => setActiveTab('rules')}
                        >
                            Rules
                        </button>
                        <button
                            className={`tab ${activeTab === 'blocked' ? 'active' : ''}`}
                            onClick={() => setActiveTab('blocked')}
                        >
                            Blocked IPs
                        </button>
                        <button
                            className={`tab ${activeTab === 'quick' ? 'active' : ''}`}
                            onClick={() => setActiveTab('quick')}
                        >
                            Quick Actions
                        </button>
                    </div>

                    <div className="tab-content">
                        {activeTab === 'overview' && (
                            <div className="overview-tab">
                                <div className="info-card">
                                    <h3>Firewall Information</h3>
                                    <div className="info-grid">
                                        <div className="info-item">
                                            <span className="info-label">Type</span>
                                            <span className="info-value">{activeFirewall?.toUpperCase()}</span>
                                        </div>
                                        <div className="info-item">
                                            <span className="info-label">Status</span>
                                            <span className={`info-value ${isActive ? 'text-success' : 'text-danger'}`}>
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
                                <div className="protection-summary">
                                    <h3>Protection Summary</h3>
                                    <div className="summary-grid">
                                        <div className="summary-item">
                                            <span className="summary-icon text-success">
                                                <span className="icon">check_circle</span>
                                            </span>
                                            <span className="summary-text">
                                                {rules.filter(r => r.type === 'port' || r.port).length} ports allowed
                                            </span>
                                        </div>
                                        <div className="summary-item">
                                            <span className="summary-icon text-success">
                                                <span className="icon">check_circle</span>
                                            </span>
                                            <span className="summary-text">
                                                {rules.filter(r => r.type === 'service' || r.service).length} services allowed
                                            </span>
                                        </div>
                                        <div className="summary-item">
                                            <span className="summary-icon text-danger">
                                                <span className="icon">block</span>
                                            </span>
                                            <span className="summary-text">
                                                {blockedIPs.length} IPs blocked
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'rules' && (
                            <div className="rules-tab">
                                <div className="section-header">
                                    <h3>Firewall Rules</h3>
                                    <button className="btn btn-primary" onClick={() => setShowPortModal(true)}>
                                        Add Rule
                                    </button>
                                </div>
                                {rules.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">rule</span>
                                        <p>No rules configured</p>
                                    </div>
                                ) : (
                                    <div className="rules-table">
                                        <table>
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
                                                        <td>
                                                            <span className="badge badge-info">{rule.type}</span>
                                                        </td>
                                                        <td>
                                                            {rule.type === 'service' && rule.service}
                                                            {rule.type === 'port' && rule.port}
                                                            {rule.type === 'rich' && (
                                                                <code className="rule-code">{rule.rule}</code>
                                                            )}
                                                        </td>
                                                        <td>{rule.protocol || '-'}</td>
                                                        <td>
                                                            {rule.type === 'port' && (
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={() => handleRemovePort(rule.port, rule.protocol)}
                                                                >
                                                                    <span className="icon">delete</span>
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'blocked' && (
                            <div className="blocked-tab">
                                <div className="section-header">
                                    <h3>Blocked IP Addresses</h3>
                                    <button className="btn btn-primary" onClick={() => setShowBlockIPModal(true)}>
                                        Block IP
                                    </button>
                                </div>
                                {blockedIPs.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">verified_user</span>
                                        <p>No blocked IPs</p>
                                    </div>
                                ) : (
                                    <div className="blocked-list">
                                        {blockedIPs.map((item, index) => (
                                            <div key={index} className="blocked-item">
                                                <div className="blocked-info">
                                                    <span className="blocked-ip">{item.ip}</span>
                                                    <code className="blocked-rule">{item.rule}</code>
                                                </div>
                                                <button
                                                    className="btn btn-sm btn-warning"
                                                    onClick={() => handleUnblockIP(item.ip)}
                                                >
                                                    Unblock
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'quick' && (
                            <div className="quick-tab">
                                <h3>Quick Port Access</h3>
                                <p className="text-muted">One-click enable/disable common service ports</p>
                                <div className="quick-ports">
                                    {commonPorts.map(({ port, name, protocol }) => {
                                        const isAllowed = rules.some(r =>
                                            (r.port === String(port) || r.port === port) && r.protocol === protocol
                                        );
                                        return (
                                            <div key={port} className="quick-port-item">
                                                <div className="port-info">
                                                    <span className="port-name">{name}</span>
                                                    <span className="port-number">{port}/{protocol}</span>
                                                </div>
                                                <div className="port-status">
                                                    {isAllowed ? (
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleRemovePort(port, protocol)}
                                                            disabled={actionLoading}
                                                        >
                                                            Block
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="btn btn-sm btn-success"
                                                            onClick={() => handleQuickAllowPort(port, protocol)}
                                                            disabled={actionLoading}
                                                        >
                                                            Allow
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Block IP Modal */}
            {showBlockIPModal && (
                <div className="modal-overlay" onClick={() => setShowBlockIPModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Block IP Address</h2>
                            <button className="btn btn-icon" onClick={() => setShowBlockIPModal(false)}>
                                <span className="icon">close</span>
                            </button>
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
                            <p className="text-muted">
                                You can block a single IP (192.168.1.100) or a range using CIDR notation (10.0.0.0/24).
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowBlockIPModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={handleBlockIP}
                                disabled={actionLoading || !blockIP.trim()}
                            >
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
                            <button className="btn btn-icon" onClick={() => setShowPortModal(false)}>
                                <span className="icon">close</span>
                            </button>
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
                                    <select
                                        value={newPort.protocol}
                                        onChange={(e) => setNewPort({ ...newPort, protocol: e.target.value })}
                                    >
                                        <option value="tcp">TCP</option>
                                        <option value="udp">UDP</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPortModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAllowPort}
                                disabled={actionLoading || !newPort.port}
                            >
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
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Select Firewall</label>
                                <select
                                    value={selectedFirewall}
                                    onChange={(e) => setSelectedFirewall(e.target.value)}
                                >
                                    <option value="ufw">UFW (Recommended for Ubuntu)</option>
                                    <option value="firewalld">firewalld (CentOS/RHEL)</option>
                                </select>
                            </div>
                            <div className="install-info">
                                {selectedFirewall === 'ufw' ? (
                                    <p>
                                        <strong>UFW (Uncomplicated Firewall)</strong> is a simple and easy-to-use
                                        firewall for Ubuntu and Debian systems. It provides a user-friendly interface
                                        for iptables.
                                    </p>
                                ) : (
                                    <p>
                                        <strong>firewalld</strong> is a dynamically managed firewall with zone-based
                                        configuration. It's the default firewall on CentOS and RHEL systems.
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstall}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
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
}

export default Firewall;
