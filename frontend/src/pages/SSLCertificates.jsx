import React, { useState, useEffect } from 'react';
import {
    ShieldCheck, ShieldOff, RefreshCw, Plus, Trash2,
    Lock, Clock, Globe, CheckCircle, AlertTriangle,
    Settings, Download
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const SSLCertificates = () => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [renewingDomain, setRenewingDomain] = useState(null);

    // Modal states
    const [showObtainModal, setShowObtainModal] = useState(false);

    // Form states
    const [domains, setDomains] = useState('');
    const [email, setEmail] = useState('');
    const [useNginx, setUseNginx] = useState(true);
    const [webrootPath, setWebrootPath] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const data = await api.getSSLStatus();
            setStatus(data);
        } catch (err) {
            console.error('Failed to load SSL status:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleObtainCertificate(e) {
        e.preventDefault();
        const domainList = domains.split(',').map(d => d.trim()).filter(Boolean);
        if (domainList.length === 0 || !email) return;

        try {
            setActionLoading(true);
            const data = { domains: domainList, email, use_nginx: useNginx };
            if (!useNginx && webrootPath) {
                data.webroot_path = webrootPath;
            }
            const result = await api.obtainCertificate(data);
            if (result.success) {
                toast.success('Certificate obtained successfully');
                setShowObtainModal(false);
                setDomains('');
                setEmail('');
                loadData();
            } else {
                toast.error(result.error || 'Failed to obtain certificate');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to obtain certificate');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRenewCertificate(domain) {
        try {
            setRenewingDomain(domain);
            const result = await api.renewCertificate(domain);
            if (result.success) {
                toast.success(`Certificate for ${domain} renewed`);
                loadData();
            } else {
                toast.error(result.error || 'Renewal failed');
            }
        } catch (err) {
            toast.error(err.message || 'Renewal failed');
        } finally {
            setRenewingDomain(null);
        }
    }

    async function handleRenewAll() {
        try {
            setActionLoading(true);
            const result = await api.renewAllCertificates();
            if (result.success) {
                toast.success('All certificates renewed');
                loadData();
            } else {
                toast.error(result.error || 'Renewal failed');
            }
        } catch (err) {
            toast.error(err.message || 'Renewal failed');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRevokeCertificate(domain) {
        if (!confirm(`Revoke and delete the certificate for ${domain}? This cannot be undone.`)) return;

        try {
            setActionLoading(true);
            const result = await api.revokeCertificate(domain);
            if (result.success) {
                toast.success(`Certificate for ${domain} revoked`);
                loadData();
            } else {
                toast.error(result.error || 'Revocation failed');
            }
        } catch (err) {
            toast.error(err.message || 'Revocation failed');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleSetupAutoRenewal() {
        try {
            setActionLoading(true);
            const result = await api.setupAutoRenewal();
            if (result.success) {
                toast.success(result.message || 'Auto-renewal configured');
            } else {
                toast.error(result.error || 'Failed to setup auto-renewal');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to setup auto-renewal');
        } finally {
            setActionLoading(false);
        }
    }

    async function handleInstallCertbot() {
        try {
            setActionLoading(true);
            toast.info('Installing Certbot... This may take a moment.');
            const result = await api.installCertbot();
            if (result.success) {
                toast.success('Certbot installed successfully');
                loadData();
            } else {
                toast.error(result.error || 'Failed to install Certbot');
            }
        } catch (err) {
            toast.error(err.message || 'Failed to install Certbot');
        } finally {
            setActionLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="ssl-page">
                <header className="top-bar">
                    <div>
                        <h1>SSL Certificates</h1>
                        <p className="subtitle">Manage Let's Encrypt SSL certificates</p>
                    </div>
                </header>
                <div className="ssl-status-bar">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="ssl-status-item">
                            <div className="skeleton-box" style={{ width: 48, height: 48, borderRadius: 12 }} />
                            <div>
                                <div className="skeleton-box" style={{ width: 80, height: 14, marginBottom: 6 }} />
                                <div className="skeleton-box" style={{ width: 50, height: 12 }} />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="ssl-cert-list">
                    {[1, 2].map(i => (
                        <div key={i} className="ssl-cert-item">
                            <div className="skeleton-box" style={{ width: 40, height: 40, borderRadius: 10 }} />
                            <div style={{ flex: 1 }}>
                                <div className="skeleton-box" style={{ width: 200, height: 14, marginBottom: 8 }} />
                                <div className="skeleton-box" style={{ width: 300, height: 12 }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    const certificates = status?.certificates || [];
    const expiringSoon = status?.expiring_soon || [];
    const certbotInstalled = status?.certbot_installed ?? false;

    return (
        <div className="ssl-page">
            <header className="top-bar">
                <div>
                    <h1>SSL Certificates</h1>
                    <p className="subtitle">Manage Let's Encrypt SSL certificates</p>
                </div>
                <div className="top-bar-actions">
                    <button
                        className="btn btn-secondary"
                        onClick={handleSetupAutoRenewal}
                        disabled={actionLoading || !certbotInstalled}
                        title="Configure automatic renewal via systemd or cron"
                    >
                        <Settings size={16} />
                        Auto-Renew
                    </button>
                    {certificates.length > 0 && (
                        <button
                            className="btn btn-secondary"
                            onClick={handleRenewAll}
                            disabled={actionLoading}
                        >
                            <RefreshCw size={16} />
                            Renew All
                        </button>
                    )}
                    <button className="btn btn-secondary" onClick={loadData}>
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowObtainModal(true)}
                        disabled={!certbotInstalled}
                    >
                        <Plus size={16} />
                        New Certificate
                    </button>
                </div>
            </header>

            {/* Status Cards */}
            <div className="ssl-status-bar">
                <div className="ssl-status-item">
                    <div className={`ssl-status-icon ${certbotInstalled ? 'active' : 'inactive'}`}>
                        {certbotInstalled ? <ShieldCheck size={24} /> : <ShieldOff size={24} />}
                    </div>
                    <div className="ssl-status-info">
                        <h4>Certbot</h4>
                        <span>{certbotInstalled ? 'Installed' : 'Not Installed'}</span>
                    </div>
                    {!certbotInstalled && (
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={handleInstallCertbot}
                            disabled={actionLoading}
                            style={{ marginLeft: 'auto' }}
                        >
                            <Download size={14} />
                            Install
                        </button>
                    )}
                </div>
                <div className="ssl-status-item">
                    <div className="ssl-status-icon active">
                        <Lock size={24} />
                    </div>
                    <div className="ssl-status-info">
                        <h4>Certificates</h4>
                        <span>{status?.total_certificates || 0} active</span>
                    </div>
                </div>
                <div className="ssl-status-item">
                    <div className={`ssl-status-icon ${expiringSoon.length > 0 ? 'warning' : 'active'}`}>
                        {expiringSoon.length > 0 ? <AlertTriangle size={24} /> : <CheckCircle size={24} />}
                    </div>
                    <div className="ssl-status-info">
                        <h4>Expiring Soon</h4>
                        <span>
                            {expiringSoon.length > 0
                                ? `${expiringSoon.length} certificate${expiringSoon.length > 1 ? 's' : ''}`
                                : 'All healthy'
                            }
                        </span>
                    </div>
                </div>
            </div>

            {/* Certificates List */}
            {certificates.length === 0 ? (
                <div className="empty-state">
                    <Lock size={48} />
                    <h3>No SSL certificates</h3>
                    <p>Obtain your first Let's Encrypt certificate to secure your domains.</p>
                    {certbotInstalled ? (
                        <button className="btn btn-primary" onClick={() => setShowObtainModal(true)}>
                            <Plus size={16} />
                            New Certificate
                        </button>
                    ) : (
                        <button className="btn btn-primary" onClick={handleInstallCertbot} disabled={actionLoading}>
                            <Download size={16} />
                            Install Certbot First
                        </button>
                    )}
                </div>
            ) : (
                <div className="ssl-cert-list">
                    {certificates.map((cert, index) => (
                        <div key={index} className="ssl-cert-item">
                            <div className="ssl-cert-item-info">
                                <div className={`ssl-cert-item-icon ${cert.expiry_valid ? '' : 'expiring'}`}>
                                    <ShieldCheck size={20} />
                                </div>
                                <div className="ssl-cert-item-details">
                                    <h3>{cert.name}</h3>
                                    <div className="ssl-cert-item-meta">
                                        <span>
                                            <Globe size={12} />
                                            {cert.domains?.join(', ') || cert.name}
                                        </span>
                                        {cert.expiry && (
                                            <span className={cert.expiry_valid ? 'valid' : 'expiring'}>
                                                <Clock size={12} />
                                                Expires: {cert.expiry}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="ssl-cert-item-status">
                                {cert.expiry_valid ? (
                                    <span className="status-badge status-active">
                                        <CheckCircle size={14} />
                                        Valid
                                    </span>
                                ) : (
                                    <span className="status-badge status-warning">
                                        <AlertTriangle size={14} />
                                        Expiring
                                    </span>
                                )}
                            </div>
                            <div className="ssl-cert-item-actions">
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRenewCertificate(cert.name)}
                                    disabled={renewingDomain === cert.name || actionLoading}
                                >
                                    <RefreshCw size={14} className={renewingDomain === cert.name ? 'spin' : ''} />
                                    {renewingDomain === cert.name ? 'Renewing...' : 'Renew'}
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleRevokeCertificate(cert.name)}
                                    disabled={actionLoading}
                                >
                                    <Trash2 size={14} />
                                    Revoke
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Expiring Soon Warning */}
            {expiringSoon.length > 0 && (
                <div className="ssl-warning-banner">
                    <AlertTriangle size={18} />
                    <div>
                        <strong>Certificates expiring soon:</strong>{' '}
                        {expiringSoon.join(', ')}
                    </div>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={handleRenewAll}
                        disabled={actionLoading}
                    >
                        <RefreshCw size={14} />
                        Renew All
                    </button>
                </div>
            )}

            {/* Obtain Certificate Modal */}
            {showObtainModal && (
                <div className="modal-overlay" onClick={() => setShowObtainModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Obtain SSL Certificate</h2>
                            <button className="modal-close" onClick={() => setShowObtainModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleObtainCertificate}>
                            <div className="ssl-info-box">
                                <ShieldCheck size={32} />
                                <div>
                                    <h4>Free SSL from Let's Encrypt</h4>
                                    <p>Obtain a free, automatically-renewed SSL certificate for your domains.</p>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Domains</label>
                                <input
                                    type="text"
                                    placeholder="example.com, www.example.com"
                                    value={domains}
                                    onChange={e => setDomains(e.target.value)}
                                    required
                                />
                                <p className="hint">Comma-separated list of domains</p>
                            </div>
                            <div className="form-group">
                                <label>Email Address</label>
                                <input
                                    type="email"
                                    placeholder="admin@example.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                />
                                <p className="hint">For certificate expiration notifications</p>
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={useNginx}
                                        onChange={e => setUseNginx(e.target.checked)}
                                    />
                                    Use Nginx plugin (recommended)
                                </label>
                            </div>
                            {!useNginx && (
                                <div className="form-group">
                                    <label>Webroot Path</label>
                                    <input
                                        type="text"
                                        placeholder="/var/www/html"
                                        value={webrootPath}
                                        onChange={e => setWebrootPath(e.target.value)}
                                        required={!useNginx}
                                    />
                                    <p className="hint">Document root for HTTP validation</p>
                                </div>
                            )}
                            <div className="modal-actions">
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => setShowObtainModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={actionLoading}
                                >
                                    {actionLoading ? 'Obtaining...' : 'Obtain Certificate'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SSLCertificates;
