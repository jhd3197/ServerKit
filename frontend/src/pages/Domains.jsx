import React, { useState, useEffect } from 'react';
import {
    Globe, Plus, Shield, ShieldCheck, ShieldOff, RefreshCw,
    Trash2, ExternalLink, CheckCircle, XCircle, AlertTriangle,
    Clock, Server, Lock, Unlock, Search
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Domains = () => {
    const toast = useToast();
    const [domains, setDomains] = useState([]);
    const [apps, setApps] = useState([]);
    const [sslStatus, setSslStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal states
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSslModal, setShowSslModal] = useState(false);
    const [selectedDomain, setSelectedDomain] = useState(null);

    // Form states
    const [domainName, setDomainName] = useState('');
    const [selectedAppId, setSelectedAppId] = useState('');
    const [isPrimary, setIsPrimary] = useState(false);
    const [sslEmail, setSslEmail] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [domainsData, appsData, sslData] = await Promise.all([
                api.getDomains(),
                api.getApps(),
                api.getDomainsSslStatus().catch(() => null)
            ]);
            setDomains(domainsData.domains || []);
            setApps(appsData.apps || []);
            setSslStatus(sslData);
        } catch (err) {
            setError('Failed to load data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAddDomain(e) {
        e.preventDefault();
        if (!domainName || !selectedAppId) return;

        try {
            setActionLoading(true);
            await api.createDomain({
                name: domainName,
                application_id: parseInt(selectedAppId),
                is_primary: isPrimary
            });
            setShowAddModal(false);
            setDomainName('');
            setSelectedAppId('');
            setIsPrimary(false);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDeleteDomain(domain) {
        if (!confirm(`Are you sure you want to delete ${domain.name}?`)) return;

        try {
            await api.deleteDomain(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleEnableSsl(e) {
        e.preventDefault();
        if (!selectedDomain || !sslEmail) return;

        try {
            setActionLoading(true);
            await api.enableSsl(selectedDomain.id, sslEmail);
            setShowSslModal(false);
            setSslEmail('');
            setSelectedDomain(null);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDisableSsl(domain) {
        if (!confirm(`Disable SSL for ${domain.name}?`)) return;

        try {
            await api.disableSsl(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRenewSsl(domain) {
        try {
            setActionLoading(true);
            await api.renewDomainSsl(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleVerifyDomain(domain) {
        try {
            const result = await api.verifyDomain(domain.id);
            if (result.verified) {
                toast.success(`Domain verified! IP: ${result.ip_address}`);
            } else {
                toast.error(`Domain verification failed: ${result.error}`);
            }
        } catch (err) {
            setError(err.message);
        }
    }

    function getAppName(appId) {
        const app = apps.find(a => a.id === appId);
        return app ? app.name : 'Unknown';
    }

    if (loading) {
        return <div className="loading">Loading domains...</div>;
    }

    return (
        <div>
            <header className="top-bar">
                <div>
                    <h1>Domains & SSL</h1>
                    <p className="subtitle">Manage your domains and SSL certificates</p>
                </div>
                <div className="top-bar-actions">
                    <button className="btn btn-secondary" onClick={loadData}>
                        <RefreshCw size={16} />
                        Refresh
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        <Plus size={16} />
                        Add Domain
                    </button>
                </div>
            </header>

            {error && (
                <div className="error-banner">
                    {error}
                    <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
                </div>
            )}

            {/* SSL Status */}
            {sslStatus && (
                <div className="ssl-status-bar">
                    <div className="ssl-status-item">
                        <div className={`ssl-status-icon ${sslStatus.certbot_installed ? 'active' : 'inactive'}`}>
                            {sslStatus.certbot_installed ? <ShieldCheck size={24} /> : <ShieldOff size={24} />}
                        </div>
                        <div className="ssl-status-info">
                            <h4>Certbot</h4>
                            <span>{sslStatus.certbot_installed ? 'Installed' : 'Not Installed'}</span>
                        </div>
                    </div>
                    <div className="ssl-status-item">
                        <div className="ssl-status-icon active">
                            <Lock size={24} />
                        </div>
                        <div className="ssl-status-info">
                            <h4>Certificates</h4>
                            <span>{sslStatus.total_certificates} active</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Domains List */}
            <h2 className="section-title">Domains</h2>

            {domains.length === 0 ? (
                <div className="empty-state">
                    <Globe size={48} />
                    <h3>No domains configured</h3>
                    <p>Add a domain to your application to get started.</p>
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        <Plus size={16} />
                        Add Domain
                    </button>
                </div>
            ) : (
                <div className="domain-list">
                    {domains.map(domain => (
                        <div key={domain.id} className="domain-item">
                            <div className="domain-item-info">
                                <div className={`domain-item-icon ${domain.ssl_enabled ? 'ssl' : ''}`}>
                                    {domain.ssl_enabled ? <ShieldCheck size={20} /> : <Globe size={20} />}
                                </div>
                                <div className="domain-item-details">
                                    <h3>
                                        {domain.name}
                                        {domain.is_primary && <span className="primary-badge">Primary</span>}
                                    </h3>
                                    <div className="domain-item-meta">
                                        <span className="app-link">
                                            <Server size={12} />
                                            {getAppName(domain.application_id)}
                                        </span>
                                        {domain.ssl_enabled && (
                                            <span className="ssl-badge">
                                                <Lock size={12} />
                                                SSL Active
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="domain-item-actions">
                                <a
                                    href={`${domain.ssl_enabled ? 'https' : 'http'}://${domain.name}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary btn-sm"
                                >
                                    <ExternalLink size={14} />
                                    Visit
                                </a>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleVerifyDomain(domain)}
                                >
                                    <Search size={14} />
                                    Verify DNS
                                </button>
                                {domain.ssl_enabled ? (
                                    <>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleRenewSsl(domain)}
                                            disabled={actionLoading}
                                        >
                                            <RefreshCw size={14} />
                                            Renew SSL
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => handleDisableSsl(domain)}
                                        >
                                            <Unlock size={14} />
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={() => {
                                            setSelectedDomain(domain);
                                            setShowSslModal(true);
                                        }}
                                    >
                                        <Lock size={14} />
                                        Enable SSL
                                    </button>
                                )}
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleDeleteDomain(domain)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* SSL Certificates */}
            {sslStatus && sslStatus.certificates && sslStatus.certificates.length > 0 && (
                <>
                    <h2 className="section-title" style={{ marginTop: '40px' }}>SSL Certificates</h2>
                    <div className="cert-list">
                        {sslStatus.certificates.map((cert, index) => (
                            <div key={index} className="cert-item">
                                <div className="cert-item-info">
                                    <div className="cert-item-icon">
                                        <ShieldCheck size={20} />
                                    </div>
                                    <div className="cert-item-details">
                                        <h3>{cert.name}</h3>
                                        <div className="cert-item-meta">
                                            <span>
                                                <Globe size={12} />
                                                {cert.domains?.join(', ')}
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
                                <div className="cert-status">
                                    {cert.expiry_valid ? (
                                        <span className="status-badge status-active">
                                            <CheckCircle size={14} />
                                            Valid
                                        </span>
                                    ) : (
                                        <span className="status-badge status-warning">
                                            <AlertTriangle size={14} />
                                            Expiring Soon
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Add Domain Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Domain</h2>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleAddDomain}>
                            <div className="form-group">
                                <label>Domain Name</label>
                                <input
                                    type="text"
                                    placeholder="example.com"
                                    value={domainName}
                                    onChange={e => setDomainName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>Application</label>
                                <select
                                    value={selectedAppId}
                                    onChange={e => setSelectedAppId(e.target.value)}
                                    required
                                >
                                    <option value="">Select an application</option>
                                    {apps.map(app => (
                                        <option key={app.id} value={app.id}>{app.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={isPrimary}
                                        onChange={e => setIsPrimary(e.target.checked)}
                                    />
                                    Set as primary domain
                                </label>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                                    {actionLoading ? 'Adding...' : 'Add Domain'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Enable SSL Modal */}
            {showSslModal && selectedDomain && (
                <div className="modal-overlay" onClick={() => setShowSslModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Enable SSL Certificate</h2>
                            <button className="modal-close" onClick={() => setShowSslModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleEnableSsl}>
                            <div className="ssl-info-box">
                                <ShieldCheck size={32} />
                                <div>
                                    <h4>Free SSL from Let's Encrypt</h4>
                                    <p>A free SSL certificate will be obtained for <strong>{selectedDomain.name}</strong></p>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Email Address</label>
                                <input
                                    type="email"
                                    placeholder="admin@example.com"
                                    value={sslEmail}
                                    onChange={e => setSslEmail(e.target.value)}
                                    required
                                />
                                <p className="hint">Required for certificate expiration notifications</p>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowSslModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                                    {actionLoading ? 'Obtaining Certificate...' : 'Enable SSL'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Domains;
