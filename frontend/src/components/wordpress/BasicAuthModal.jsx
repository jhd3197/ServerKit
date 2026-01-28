import React, { useState, useEffect } from 'react';
import { Shield, Copy, Check, AlertTriangle } from 'lucide-react';
import Spinner from '../Spinner';

const BasicAuthModal = ({ environment, prodId, onClose, api }) => {
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState({ enabled: false, username: null });
    const [credentials, setCredentials] = useState(null);
    const [toggling, setToggling] = useState(false);
    const [copied, setCopied] = useState(null);

    useEffect(() => {
        loadStatus();
    }, []);

    async function loadStatus() {
        setLoading(true);
        try {
            const data = await api.getBasicAuthStatus(prodId, environment.id);
            setStatus(data);
        } catch {
            setStatus({ enabled: false, username: null });
        } finally {
            setLoading(false);
        }
    }

    async function handleEnable() {
        setToggling(true);
        try {
            const data = await api.enableBasicAuth(prodId, environment.id);
            if (data.success) {
                setStatus({ enabled: true, username: data.username });
                setCredentials({ username: data.username, password: data.password });
            }
        } catch (err) {
            console.error('Failed to enable basic auth:', err);
        } finally {
            setToggling(false);
        }
    }

    async function handleDisable() {
        setToggling(true);
        try {
            const data = await api.disableBasicAuth(prodId, environment.id);
            if (data.success) {
                setStatus({ enabled: false, username: null });
                setCredentials(null);
            }
        } catch (err) {
            console.error('Failed to disable basic auth:', err);
        } finally {
            setToggling(false);
        }
    }

    function copyToClipboard(text, field) {
        navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(null), 2000);
    }

    const envName = environment?.name || 'Environment';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal basic-auth-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Shield size={18} />
                        Basic Auth
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="basic-auth-body">
                    <div className="basic-auth-env-name">{envName}</div>

                    {loading ? (
                        <div className="basic-auth-loading">
                            <Spinner size="sm" />
                            <span>Loading status...</span>
                        </div>
                    ) : (
                        <>
                            <div className="basic-auth-toggle">
                                <label className="basic-auth-toggle-label">
                                    <span>HTTP Basic Authentication</span>
                                    <button
                                        className={`toggle-switch ${status.enabled ? 'active' : ''}`}
                                        onClick={status.enabled ? handleDisable : handleEnable}
                                        disabled={toggling}
                                    >
                                        <span className="toggle-switch-slider" />
                                    </button>
                                </label>
                                <p className="basic-auth-description">
                                    Adds password protection to the site. Visitors must enter credentials to access any page.
                                </p>
                            </div>

                            {status.enabled && status.username && !credentials && (
                                <div className="basic-auth-current">
                                    <div className="basic-auth-field">
                                        <label>Username</label>
                                        <div className="basic-auth-value">
                                            <code>{status.username}</code>
                                        </div>
                                    </div>
                                    <p className="basic-auth-hint">
                                        Password was shown when Basic Auth was first enabled. Disable and re-enable to generate new credentials.
                                    </p>
                                </div>
                            )}

                            {credentials && (
                                <div className="basic-auth-credentials">
                                    <div className="basic-auth-credential-warning">
                                        <AlertTriangle size={14} />
                                        <span>Save these credentials now. The password will not be shown again.</span>
                                    </div>
                                    <div className="basic-auth-field">
                                        <label>Username</label>
                                        <div className="basic-auth-value">
                                            <code>{credentials.username}</code>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => copyToClipboard(credentials.username, 'user')}
                                            >
                                                {copied === 'user' ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="basic-auth-field">
                                        <label>Password</label>
                                        <div className="basic-auth-value">
                                            <code>{credentials.password}</code>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => copyToClipboard(credentials.password, 'pass')}
                                            >
                                                {copied === 'pass' ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BasicAuthModal;
