import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import UsersTab from '../components/settings/UsersTab';
import AuditLogTab from '../components/settings/AuditLogTab';
import { Github, FileText, HelpCircle, MessageSquare, Bug, Check, Layers, Download, CheckCircle, RefreshCw, ExternalLink } from 'lucide-react';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('profile');
    const { isAdmin } = useAuth();

    return (
        <div className="page settings-page">
            <div className="page-header">
                <div>
                    <h1>Settings</h1>
                    <p className="page-subtitle">Manage your account and system preferences</p>
                </div>
            </div>

            <div className="settings-layout">
                <nav className="settings-nav">
                    <button
                        className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
                        onClick={() => setActiveTab('profile')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        Profile
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
                        onClick={() => setActiveTab('security')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        Security
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
                        onClick={() => setActiveTab('appearance')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <circle cx="12" cy="12" r="5"/>
                            <line x1="12" y1="1" x2="12" y2="3"/>
                            <line x1="12" y1="21" x2="12" y2="23"/>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                            <line x1="1" y1="12" x2="3" y2="12"/>
                            <line x1="21" y1="12" x2="23" y2="12"/>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                        </svg>
                        Appearance
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
                        onClick={() => setActiveTab('notifications')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        Notifications
                    </button>
                    <button
                        className={`settings-nav-item ${activeTab === 'system' ? 'active' : ''}`}
                        onClick={() => setActiveTab('system')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                        System Info
                    </button>
                    {isAdmin && (
                        <>
                            <div className="settings-nav-divider">Admin</div>
                            <button
                                className={`settings-nav-item ${activeTab === 'users' ? 'active' : ''}`}
                                onClick={() => setActiveTab('users')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                    <circle cx="9" cy="7" r="4"/>
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                </svg>
                                Users
                            </button>
                            <button
                                className={`settings-nav-item ${activeTab === 'audit' ? 'active' : ''}`}
                                onClick={() => setActiveTab('audit')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                    <polyline points="14 2 14 8 20 8"/>
                                    <line x1="16" y1="13" x2="8" y2="13"/>
                                    <line x1="16" y1="17" x2="8" y2="17"/>
                                    <polyline points="10 9 9 9 8 9"/>
                                </svg>
                                Audit Log
                            </button>
                        </>
                    )}
                    <button
                        className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
                        onClick={() => setActiveTab('about')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="16" x2="12" y2="12"/>
                            <line x1="12" y1="8" x2="12.01" y2="8"/>
                        </svg>
                        About
                    </button>
                </nav>

                <div className="settings-content">
                    {activeTab === 'profile' && <ProfileSettings />}
                    {activeTab === 'security' && <SecuritySettings />}
                    {activeTab === 'appearance' && <AppearanceSettings />}
                    {activeTab === 'notifications' && <NotificationSettings />}
                    {activeTab === 'system' && <SystemInfo />}
                    {activeTab === 'users' && isAdmin && <UsersTab />}
                    {activeTab === 'audit' && isAdmin && <AuditLogTab />}
                    {activeTab === 'about' && <AboutSection />}
                </div>
            </div>
        </div>
    );
};

const ProfileSettings = () => {
    const { user, updateUser } = useAuth();
    const [formData, setFormData] = useState({
        username: '',
        email: ''
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        if (user) {
            setFormData({
                username: user.username || '',
                email: user.email || ''
            });
        }
    }, [user]);

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            await updateUser(formData);
            setMessage({ type: 'success', text: 'Profile updated successfully' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>Profile Settings</h2>
                <p>Update your personal information</p>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit} className="settings-form">
                <div className="form-group">
                    <label>Username</label>
                    <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Email Address</label>
                    <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Role</label>
                    <input type="text" value={user?.role || 'user'} disabled className="input-disabled" />
                    <span className="form-help">Contact an administrator to change your role</span>
                </div>

                <div className="form-group">
                    <label>Member Since</label>
                    <input
                        type="text"
                        value={user?.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                        disabled
                        className="input-disabled"
                    />
                </div>

                <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </form>
        </div>
    );
};

const SecuritySettings = () => {
    const { updateUser, user } = useAuth();
    const [formData, setFormData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    // 2FA state
    const [twoFAStatus, setTwoFAStatus] = useState(null);
    const [twoFALoading, setTwoFALoading] = useState(true);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showDisableModal, setShowDisableModal] = useState(false);
    const [showBackupCodesModal, setShowBackupCodesModal] = useState(false);
    const [setupData, setSetupData] = useState(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [backupCodes, setBackupCodes] = useState([]);
    const [twoFAError, setTwoFAError] = useState('');

    useEffect(() => {
        load2FAStatus();
    }, []);

    async function load2FAStatus() {
        try {
            const status = await api.get2FAStatus();
            setTwoFAStatus(status);
        } catch (err) {
            console.error('Failed to load 2FA status:', err);
        } finally {
            setTwoFALoading(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setMessage(null);

        if (formData.newPassword !== formData.confirmPassword) {
            setMessage({ type: 'error', text: 'Passwords do not match' });
            return;
        }

        if (formData.newPassword.length < 8) {
            setMessage({ type: 'error', text: 'Password must be at least 8 characters' });
            return;
        }

        setLoading(true);

        try {
            await updateUser({ password: formData.newPassword });
            setMessage({ type: 'success', text: 'Password changed successfully' });
            setFormData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }

    async function handleInitiate2FA() {
        setTwoFAError('');
        setTwoFALoading(true);
        try {
            const data = await api.initiate2FASetup();
            setSetupData(data);
            setShowSetupModal(true);
        } catch (err) {
            setTwoFAError(err.message);
        } finally {
            setTwoFALoading(false);
        }
    }

    async function handleConfirm2FA() {
        if (!verificationCode || verificationCode.length !== 6) {
            setTwoFAError('Please enter a 6-digit code');
            return;
        }

        setTwoFALoading(true);
        setTwoFAError('');
        try {
            const result = await api.confirm2FASetup(verificationCode);
            setBackupCodes(result.backup_codes);
            setShowSetupModal(false);
            setShowBackupCodesModal(true);
            setVerificationCode('');
            load2FAStatus();
        } catch (err) {
            setTwoFAError(err.message || 'Invalid verification code');
        } finally {
            setTwoFALoading(false);
        }
    }

    async function handleDisable2FA() {
        if (!verificationCode) {
            setTwoFAError('Please enter a verification code');
            return;
        }

        setTwoFALoading(true);
        setTwoFAError('');
        try {
            await api.disable2FA(verificationCode);
            setShowDisableModal(false);
            setVerificationCode('');
            load2FAStatus();
        } catch (err) {
            setTwoFAError(err.message || 'Invalid verification code');
        } finally {
            setTwoFALoading(false);
        }
    }

    async function handleRegenerateBackupCodes() {
        if (!verificationCode || verificationCode.length !== 6) {
            setTwoFAError('Please enter a 6-digit code');
            return;
        }

        setTwoFALoading(true);
        setTwoFAError('');
        try {
            const result = await api.regenerateBackupCodes(verificationCode);
            setBackupCodes(result.backup_codes);
            setShowBackupCodesModal(true);
            setVerificationCode('');
            load2FAStatus();
        } catch (err) {
            setTwoFAError(err.message || 'Invalid verification code');
        } finally {
            setTwoFALoading(false);
        }
    }

    function downloadBackupCodes() {
        const content = `ServerKit Backup Codes
Generated: ${new Date().toLocaleString()}

These codes can be used to access your account if you lose your authenticator device.
Each code can only be used once.

${backupCodes.join('\n')}

Keep these codes in a safe place.`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'serverkit-backup-codes.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function copyBackupCodes() {
        navigator.clipboard.writeText(backupCodes.join('\n'));
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>Security Settings</h2>
                <p>Manage your password and security preferences</p>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            {/* Two-Factor Authentication Section */}
            <div className="settings-card two-fa-card">
                <div className="two-fa-header">
                    <div className="two-fa-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </div>
                    <div>
                        <h3>Two-Factor Authentication (2FA)</h3>
                        <p>Add an extra layer of security to your account</p>
                    </div>
                </div>

                {twoFALoading && !twoFAStatus ? (
                    <div className="loading-sm">Loading...</div>
                ) : twoFAStatus?.enabled ? (
                    <div className="two-fa-enabled">
                        <div className="two-fa-status">
                            <span className="badge badge-success">Enabled</span>
                            <span className="two-fa-info">
                                Enabled on {new Date(twoFAStatus.confirmed_at).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="two-fa-backup-info">
                            <span>Backup codes remaining: <strong>{twoFAStatus.backup_codes_remaining}</strong></span>
                            {twoFAStatus.backup_codes_remaining <= 3 && (
                                <span className="warning-text">Consider regenerating your backup codes</span>
                            )}
                        </div>
                        <div className="two-fa-actions">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setVerificationCode('');
                                    setTwoFAError('');
                                    setShowBackupCodesModal(true);
                                }}
                            >
                                Regenerate Backup Codes
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={() => {
                                    setVerificationCode('');
                                    setTwoFAError('');
                                    setShowDisableModal(true);
                                }}
                            >
                                Disable 2FA
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="two-fa-disabled">
                        <p className="two-fa-description">
                            Two-factor authentication adds an additional layer of security to your account
                            by requiring a code from your authenticator app in addition to your password.
                        </p>
                        <button
                            className="btn btn-primary"
                            onClick={handleInitiate2FA}
                            disabled={twoFALoading}
                        >
                            Enable Two-Factor Authentication
                        </button>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} className="settings-form">
                <h3>Change Password</h3>

                <div className="form-group">
                    <label>Current Password</label>
                    <input
                        type="password"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                        placeholder="Enter current password"
                    />
                </div>

                <div className="form-group">
                    <label>New Password</label>
                    <input
                        type="password"
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        placeholder="Enter new password"
                        required
                    />
                    <span className="form-help">Minimum 8 characters</span>
                </div>

                <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        placeholder="Confirm new password"
                        required
                    />
                </div>

                <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Changing...' : 'Change Password'}
                    </button>
                </div>
            </form>

            <div className="settings-card">
                <h3>Sessions</h3>
                <p>Manage your active sessions</p>
                <div className="session-item current">
                    <div className="session-info">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                        <div>
                            <span className="session-device">Current Session</span>
                            <span className="session-details">This device - Active now</span>
                        </div>
                    </div>
                    <span className="badge badge-success">Current</span>
                </div>
            </div>

            {/* 2FA Setup Modal */}
            {showSetupModal && setupData && (
                <div className="modal-overlay" onClick={() => setShowSetupModal(false)}>
                    <div className="modal modal-md" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Set Up Two-Factor Authentication</h2>
                            <button className="modal-close" onClick={() => setShowSetupModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="setup-steps">
                                <div className="setup-step">
                                    <span className="step-number">1</span>
                                    <div className="step-content">
                                        <h4>Scan the QR Code</h4>
                                        <p>Use your authenticator app (Google Authenticator, Authy, 1Password, etc.) to scan this QR code.</p>
                                        {setupData.qr_code ? (
                                            <div className="qr-code-container">
                                                <img src={setupData.qr_code} alt="2FA QR Code" className="qr-code" />
                                            </div>
                                        ) : (
                                            <div className="qr-fallback">
                                                <p>QR code unavailable. Enter this secret manually:</p>
                                                <code className="secret-key">{setupData.secret}</code>
                                            </div>
                                        )}
                                        <details className="manual-entry">
                                            <summary>Can't scan? Enter manually</summary>
                                            <p>Account: {user?.email}</p>
                                            <p>Secret: <code>{setupData.secret}</code></p>
                                        </details>
                                    </div>
                                </div>

                                <div className="setup-step">
                                    <span className="step-number">2</span>
                                    <div className="step-content">
                                        <h4>Enter Verification Code</h4>
                                        <p>Enter the 6-digit code from your authenticator app to verify setup.</p>
                                        <input
                                            type="text"
                                            value={verificationCode}
                                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="000000"
                                            className="verification-input"
                                            autoFocus
                                        />
                                        {twoFAError && <p className="error-text">{twoFAError}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowSetupModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleConfirm2FA}
                                disabled={twoFALoading || verificationCode.length !== 6}
                            >
                                {twoFALoading ? 'Verifying...' : 'Enable 2FA'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Disable 2FA Modal */}
            {showDisableModal && (
                <div className="modal-overlay" onClick={() => setShowDisableModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Disable Two-Factor Authentication</h2>
                            <button className="modal-close" onClick={() => setShowDisableModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="warning-box">
                                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <p>Disabling 2FA will make your account less secure. You will only need your password to log in.</p>
                            </div>
                            <div className="form-group">
                                <label>Enter a verification code or backup code to disable 2FA:</label>
                                <input
                                    type="text"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value)}
                                    placeholder="Code from authenticator or backup code"
                                    autoFocus
                                />
                                {twoFAError && <p className="error-text">{twoFAError}</p>}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowDisableModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={handleDisable2FA}
                                disabled={twoFALoading || !verificationCode}
                            >
                                {twoFALoading ? 'Disabling...' : 'Disable 2FA'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Backup Codes Modal */}
            {showBackupCodesModal && (
                <div className="modal-overlay" onClick={() => setShowBackupCodesModal(false)}>
                    <div className="modal modal-md" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>{backupCodes.length > 0 ? 'Your Backup Codes' : 'Regenerate Backup Codes'}</h2>
                            <button className="modal-close" onClick={() => setShowBackupCodesModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {backupCodes.length > 0 ? (
                                <>
                                    <div className="warning-box">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <p>Save these backup codes in a secure location. They will not be shown again. Each code can only be used once.</p>
                                    </div>
                                    <div className="backup-codes-grid">
                                        {backupCodes.map((code, index) => (
                                            <code key={index} className="backup-code">{code}</code>
                                        ))}
                                    </div>
                                    <div className="backup-codes-actions">
                                        <button className="btn btn-secondary" onClick={downloadBackupCodes}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                            </svg>
                                            Download
                                        </button>
                                        <button className="btn btn-secondary" onClick={copyBackupCodes}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                            </svg>
                                            Copy
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p>Enter a code from your authenticator app to generate new backup codes. This will invalidate all existing backup codes.</p>
                                    <div className="form-group">
                                        <label>Verification Code</label>
                                        <input
                                            type="text"
                                            value={verificationCode}
                                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            placeholder="000000"
                                            autoFocus
                                        />
                                        {twoFAError && <p className="error-text">{twoFAError}</p>}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => {
                                setShowBackupCodesModal(false);
                                setBackupCodes([]);
                                setVerificationCode('');
                            }}>
                                {backupCodes.length > 0 ? 'Done' : 'Cancel'}
                            </button>
                            {backupCodes.length === 0 && (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleRegenerateBackupCodes}
                                    disabled={twoFALoading || verificationCode.length !== 6}
                                >
                                    {twoFALoading ? 'Generating...' : 'Generate New Codes'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AppearanceSettings = () => {
    const [theme, setTheme] = useState(() => {
        return localStorage.getItem('theme') || 'dark';
    });

    function handleThemeChange(newTheme) {
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>Appearance</h2>
                <p>Customize the look and feel of your dashboard</p>
            </div>

            <div className="settings-card">
                <h3>Theme</h3>
                <p>Select your preferred color scheme</p>
                <div className="theme-options">
                    <button
                        className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('dark')}
                    >
                        <div className="theme-preview dark">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>Dark</span>
                    </button>
                    <button
                        className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('light')}
                    >
                        <div className="theme-preview light">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>Light</span>
                    </button>
                    <button
                        className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                        onClick={() => handleThemeChange('system')}
                    >
                        <div className="theme-preview system">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>System</span>
                    </button>
                </div>
            </div>

            <div className="settings-card">
                <h3>Density</h3>
                <p>Adjust the spacing and size of elements</p>
                <div className="density-options">
                    <label className="radio-option">
                        <input type="radio" name="density" value="comfortable" defaultChecked />
                        <span>Comfortable</span>
                    </label>
                    <label className="radio-option">
                        <input type="radio" name="density" value="compact" />
                        <span>Compact</span>
                    </label>
                </div>
            </div>
        </div>
    );
};

const NotificationSettings = () => {
    const { isAdmin, user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(null);
    const [message, setMessage] = useState(null);
    const [activeSection, setActiveSection] = useState('personal');
    const [config, setConfig] = useState({
        discord: { enabled: false, webhook_url: '', username: 'ServerKit', avatar_url: '', notify_on: ['critical', 'warning'] },
        slack: { enabled: false, webhook_url: '', channel: '', username: 'ServerKit', icon_emoji: ':robot_face:', notify_on: ['critical', 'warning'] },
        telegram: { enabled: false, bot_token: '', chat_id: '', notify_on: ['critical', 'warning'] },
        email: { enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', smtp_tls: true, from_email: '', from_name: 'ServerKit', to_emails: [], notify_on: ['critical', 'warning'] },
        generic_webhook: { enabled: false, url: '', headers: {}, notify_on: ['critical', 'warning'] }
    });
    const [expandedChannel, setExpandedChannel] = useState(null);
    const [userPrefs, setUserPrefs] = useState({
        enabled: true,
        channels: ['email'],
        severities: ['critical', 'warning'],
        email: '',
        discord_webhook: '',
        telegram_chat_id: '',
        categories: { system: true, security: true, backups: true, apps: true },
        quiet_hours: { enabled: false, start: '22:00', end: '08:00' }
    });

    const severityOptions = ['critical', 'warning', 'info', 'success'];

    useEffect(() => {
        loadUserPrefs();
        if (isAdmin) loadConfig();
    }, [isAdmin]);

    async function loadConfig() {
        try {
            const data = await api.getNotificationsConfig();
            setConfig(prev => ({
                discord: { ...prev.discord, ...data.discord },
                slack: { ...prev.slack, ...data.slack },
                telegram: { ...prev.telegram, ...data.telegram },
                email: { ...prev.email, ...data.email },
                generic_webhook: { ...prev.generic_webhook, ...data.generic_webhook }
            }));
        } catch (err) {
            console.error('Failed to load notification config:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadUserPrefs() {
        try {
            const data = await api.getUserNotificationPreferences();
            setUserPrefs(prev => ({ ...prev, ...data }));
        } catch (err) {
            console.error('Failed to load user notification preferences:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSaveUserPrefs() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateUserNotificationPreferences(userPrefs);
            setMessage({ type: 'success', text: 'Your notification preferences have been saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    async function handleTestUserNotification() {
        setTesting('user');
        setMessage(null);
        try {
            const result = await api.testUserNotification();
            setMessage({ type: result.success ? 'success' : 'error', text: result.success ? 'Test notification sent!' : (result.error || 'Test failed') });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setTesting(null);
        }
    }

    async function handleSaveChannel(channel) {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateNotificationChannel(channel, config[channel]);
            setMessage({ type: 'success', text: `${channel.charAt(0).toUpperCase() + channel.slice(1).replace('_', ' ')} settings saved` });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    async function handleTestChannel(channel) {
        setTesting(channel);
        setMessage(null);
        try {
            const result = await api.testNotificationChannel(channel);
            setMessage({ type: result.success ? 'success' : 'error', text: result.message || result.error || 'Test completed' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setTesting(null);
        }
    }

    function updateChannelConfig(channel, key, value) {
        setConfig(prev => ({
            ...prev,
            [channel]: { ...prev[channel], [key]: value }
        }));
    }

    function toggleSeverity(channel, severity) {
        const current = config[channel].notify_on || [];
        const updated = current.includes(severity)
            ? current.filter(s => s !== severity)
            : [...current, severity];
        updateChannelConfig(channel, 'notify_on', updated);
    }

    if (loading) {
        return <div className="loading">Loading notification settings...</div>;
    }

    const userPrefsUI = (
        <div className="user-notification-prefs">
            <div className="settings-card">
                <div className="form-group">
                    <label className="toggle-switch-label">
                        <span>Enable notifications for my account</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={userPrefs.enabled}
                                onChange={(e) => setUserPrefs({...userPrefs, enabled: e.target.checked})}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </label>
                </div>
            </div>

            <div className="settings-card">
                <h3>Notification Channels</h3>
                <p>Choose how you want to receive notifications</p>
                <div className="channel-toggles">
                    {['email', 'discord', 'slack', 'telegram'].map(ch => (
                        <label key={ch} className="channel-toggle">
                            <input
                                type="checkbox"
                                checked={userPrefs.channels?.includes(ch)}
                                onChange={(e) => {
                                    const channels = e.target.checked
                                        ? [...(userPrefs.channels || []), ch]
                                        : (userPrefs.channels || []).filter(c => c !== ch);
                                    setUserPrefs({...userPrefs, channels});
                                }}
                            />
                            <span>{ch.charAt(0).toUpperCase() + ch.slice(1)}</span>
                        </label>
                    ))}
                </div>
            </div>

            {userPrefs.channels?.includes('email') && (
                <div className="settings-card">
                    <h3>Email Settings</h3>
                    <div className="form-group">
                        <label>Notification Email (optional)</label>
                        <input
                            type="email"
                            value={userPrefs.email || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, email: e.target.value})}
                            placeholder={user?.email || 'Uses your account email'}
                        />
                        <span className="form-help">Leave empty to use your account email</span>
                    </div>
                </div>
            )}

            {userPrefs.channels?.includes('discord') && (
                <div className="settings-card">
                    <h3>Personal Discord Webhook</h3>
                    <div className="form-group">
                        <label>Webhook URL</label>
                        <input
                            type="text"
                            value={userPrefs.discord_webhook || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, discord_webhook: e.target.value})}
                            placeholder="https://discord.com/api/webhooks/..."
                        />
                        <span className="form-help">Create a webhook in your personal server or DM channel</span>
                    </div>
                </div>
            )}

            {userPrefs.channels?.includes('telegram') && (
                <div className="settings-card">
                    <h3>Personal Telegram</h3>
                    <div className="form-group">
                        <label>Your Chat ID</label>
                        <input
                            type="text"
                            value={userPrefs.telegram_chat_id || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, telegram_chat_id: e.target.value})}
                            placeholder="Your personal chat ID"
                        />
                        <span className="form-help">Use @userinfobot to get your personal chat ID</span>
                    </div>
                </div>
            )}

            <div className="settings-card">
                <h3>Severity Levels</h3>
                <p>Which alert types do you want to receive?</p>
                <div className="severity-toggles">
                    {severityOptions.map(severity => (
                        <label key={severity} className={`severity-toggle ${severity}`}>
                            <input
                                type="checkbox"
                                checked={userPrefs.severities?.includes(severity)}
                                onChange={(e) => {
                                    const severities = e.target.checked
                                        ? [...(userPrefs.severities || []), severity]
                                        : (userPrefs.severities || []).filter(s => s !== severity);
                                    setUserPrefs({...userPrefs, severities});
                                }}
                            />
                            <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="settings-card">
                <h3>Notification Categories</h3>
                <p>What types of events should trigger notifications?</p>
                <div className="category-toggles">
                    {Object.entries({
                        system: 'System Alerts (CPU, Memory, Disk)',
                        security: 'Security Events',
                        backups: 'Backup Status',
                        apps: 'Application Events'
                    }).map(([key, label]) => (
                        <label key={key} className="category-toggle">
                            <input
                                type="checkbox"
                                checked={userPrefs.categories?.[key] !== false}
                                onChange={(e) => setUserPrefs({
                                    ...userPrefs,
                                    categories: { ...userPrefs.categories, [key]: e.target.checked }
                                })}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div className="settings-card">
                <h3>Quiet Hours</h3>
                <p>Pause non-critical notifications during these hours</p>
                <div className="form-group">
                    <label className="toggle-switch-label">
                        <span>Enable quiet hours</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={userPrefs.quiet_hours?.enabled}
                                onChange={(e) => setUserPrefs({
                                    ...userPrefs,
                                    quiet_hours: { ...userPrefs.quiet_hours, enabled: e.target.checked }
                                })}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </label>
                </div>
                {userPrefs.quiet_hours?.enabled && (
                    <div className="form-row">
                        <div className="form-group">
                            <label>Start Time</label>
                            <input
                                type="time"
                                value={userPrefs.quiet_hours?.start || '22:00'}
                                onChange={(e) => setUserPrefs({
                                    ...userPrefs,
                                    quiet_hours: { ...userPrefs.quiet_hours, start: e.target.value }
                                })}
                            />
                        </div>
                        <div className="form-group">
                            <label>End Time</label>
                            <input
                                type="time"
                                value={userPrefs.quiet_hours?.end || '08:00'}
                                onChange={(e) => setUserPrefs({
                                    ...userPrefs,
                                    quiet_hours: { ...userPrefs.quiet_hours, end: e.target.value }
                                })}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="form-actions">
                <button
                    className="btn btn-secondary"
                    onClick={handleTestUserNotification}
                    disabled={testing === 'user' || !userPrefs.enabled}
                >
                    {testing === 'user' ? 'Sending...' : 'Send Test Notification'}
                </button>
                <button
                    className="btn btn-primary"
                    onClick={handleSaveUserPrefs}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : 'Save Preferences'}
                </button>
            </div>
        </div>
    );

    const channels = [
        { id: 'discord', name: 'Discord', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
        ), description: 'Send rich notifications to Discord channels via webhooks' },
        { id: 'slack', name: 'Slack', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
        ), description: 'Send notifications to Slack channels via incoming webhooks' },
        { id: 'telegram', name: 'Telegram', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
        ), description: 'Send notifications to Telegram chats via bot API' },
        { id: 'email', name: 'Email', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
            </svg>
        ), description: 'Send email notifications with HTML templates via SMTP' },
        { id: 'generic_webhook', name: 'Generic Webhook', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
        ), description: 'Send JSON payloads to any webhook endpoint' }
    ];

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>Notification Settings</h2>
                <p>Configure how you receive alerts and notifications</p>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <div className="notification-tabs">
                <button
                    className={`notification-tab ${activeSection === 'personal' ? 'active' : ''}`}
                    onClick={() => setActiveSection('personal')}
                >
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                    </svg>
                    My Preferences
                </button>
                {isAdmin && (
                    <button
                        className={`notification-tab ${activeSection === 'admin' ? 'active' : ''}`}
                        onClick={() => setActiveSection('admin')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                        System Webhooks
                    </button>
                )}
            </div>

            {activeSection === 'personal' && userPrefsUI}

            {activeSection === 'admin' && isAdmin && (
            <div className="notification-channels">
                {channels.map(channel => (
                    <div key={channel.id} className={`notification-channel-card ${config[channel.id]?.enabled ? 'enabled' : ''}`}>
                        <div
                            className="channel-header"
                            onClick={() => setExpandedChannel(expandedChannel === channel.id ? null : channel.id)}
                        >
                            <div className="channel-icon">{channel.icon}</div>
                            <div className="channel-info">
                                <h3>{channel.name}</h3>
                                <p>{channel.description}</p>
                            </div>
                            <div className="channel-status">
                                <span className={`badge ${config[channel.id]?.enabled ? 'badge-success' : 'badge-secondary'}`}>
                                    {config[channel.id]?.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                                <svg
                                    viewBox="0 0 24 24"
                                    width="20"
                                    height="20"
                                    className={`expand-icon ${expandedChannel === channel.id ? 'expanded' : ''}`}
                                >
                                    <polyline points="6 9 12 15 18 9" stroke="currentColor" fill="none" strokeWidth="2"/>
                                </svg>
                            </div>
                        </div>

                        {expandedChannel === channel.id && (
                            <div className="channel-config">
                                <div className="form-group">
                                    <label className="toggle-switch-label">
                                        <span>Enable {channel.name}</span>
                                        <label className="toggle-switch">
                                            <input
                                                type="checkbox"
                                                checked={config[channel.id]?.enabled || false}
                                                onChange={(e) => updateChannelConfig(channel.id, 'enabled', e.target.checked)}
                                            />
                                            <span className="toggle-slider"></span>
                                        </label>
                                    </label>
                                </div>

                                {channel.id === 'discord' && (
                                    <>
                                        <div className="form-group">
                                            <label>Webhook URL</label>
                                            <input
                                                type="text"
                                                value={config.discord.webhook_url || ''}
                                                onChange={(e) => updateChannelConfig('discord', 'webhook_url', e.target.value)}
                                                placeholder="https://discord.com/api/webhooks/..."
                                            />
                                            <span className="form-help">Create a webhook in Discord: Server Settings → Integrations → Webhooks</span>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Bot Username</label>
                                                <input
                                                    type="text"
                                                    value={config.discord.username || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('discord', 'username', e.target.value)}
                                                    placeholder="ServerKit"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Avatar URL (optional)</label>
                                                <input
                                                    type="text"
                                                    value={config.discord.avatar_url || ''}
                                                    onChange={(e) => updateChannelConfig('discord', 'avatar_url', e.target.value)}
                                                    placeholder="https://example.com/avatar.png"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'slack' && (
                                    <>
                                        <div className="form-group">
                                            <label>Webhook URL</label>
                                            <input
                                                type="text"
                                                value={config.slack.webhook_url || ''}
                                                onChange={(e) => updateChannelConfig('slack', 'webhook_url', e.target.value)}
                                                placeholder="https://hooks.slack.com/services/..."
                                            />
                                            <span className="form-help">Create an incoming webhook in Slack: Apps → Incoming Webhooks</span>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>Channel (optional)</label>
                                                <input
                                                    type="text"
                                                    value={config.slack.channel || ''}
                                                    onChange={(e) => updateChannelConfig('slack', 'channel', e.target.value)}
                                                    placeholder="#alerts"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>Username</label>
                                                <input
                                                    type="text"
                                                    value={config.slack.username || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('slack', 'username', e.target.value)}
                                                    placeholder="ServerKit"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'telegram' && (
                                    <>
                                        <div className="form-group">
                                            <label>Bot Token</label>
                                            <input
                                                type="password"
                                                value={config.telegram.bot_token || ''}
                                                onChange={(e) => updateChannelConfig('telegram', 'bot_token', e.target.value)}
                                                placeholder="123456:ABC-DEF..."
                                            />
                                            <span className="form-help">Get a bot token from @BotFather on Telegram</span>
                                        </div>
                                        <div className="form-group">
                                            <label>Chat ID</label>
                                            <input
                                                type="text"
                                                value={config.telegram.chat_id || ''}
                                                onChange={(e) => updateChannelConfig('telegram', 'chat_id', e.target.value)}
                                                placeholder="-1001234567890"
                                            />
                                            <span className="form-help">Use @userinfobot or @getidsbot to find your chat ID</span>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'email' && (
                                    <>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>SMTP Host</label>
                                                <input
                                                    type="text"
                                                    value={config.email.smtp_host || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_host', e.target.value)}
                                                    placeholder="smtp.example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>SMTP Port</label>
                                                <input
                                                    type="number"
                                                    value={config.email.smtp_port || 587}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_port', parseInt(e.target.value))}
                                                    placeholder="587"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>SMTP Username</label>
                                                <input
                                                    type="text"
                                                    value={config.email.smtp_user || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_user', e.target.value)}
                                                    placeholder="user@example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>SMTP Password</label>
                                                <input
                                                    type="password"
                                                    value={config.email.smtp_password || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_password', e.target.value)}
                                                    placeholder="••••••••"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>From Email</label>
                                                <input
                                                    type="email"
                                                    value={config.email.from_email || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'from_email', e.target.value)}
                                                    placeholder="alerts@example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>From Name</label>
                                                <input
                                                    type="text"
                                                    value={config.email.from_name || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('email', 'from_name', e.target.value)}
                                                    placeholder="ServerKit"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label>Recipient Emails (comma-separated)</label>
                                            <input
                                                type="text"
                                                value={(config.email.to_emails || []).join(', ')}
                                                onChange={(e) => updateChannelConfig('email', 'to_emails', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                                placeholder="admin@example.com, team@example.com"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="toggle-switch-label">
                                                <span>Use TLS</span>
                                                <label className="toggle-switch">
                                                    <input
                                                        type="checkbox"
                                                        checked={config.email.smtp_tls !== false}
                                                        onChange={(e) => updateChannelConfig('email', 'smtp_tls', e.target.checked)}
                                                    />
                                                    <span className="toggle-slider"></span>
                                                </label>
                                            </label>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'generic_webhook' && (
                                    <div className="form-group">
                                        <label>Webhook URL</label>
                                        <input
                                            type="text"
                                            value={config.generic_webhook.url || ''}
                                            onChange={(e) => updateChannelConfig('generic_webhook', 'url', e.target.value)}
                                            placeholder="https://your-endpoint.com/webhook"
                                        />
                                        <span className="form-help">Receives JSON payload with alert data</span>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Alert Severities</label>
                                    <div className="severity-toggles">
                                        {severityOptions.map(severity => (
                                            <label key={severity} className={`severity-toggle ${severity}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={config[channel.id]?.notify_on?.includes(severity) || false}
                                                    onChange={() => toggleSeverity(channel.id, severity)}
                                                />
                                                <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="channel-actions">
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => handleTestChannel(channel.id)}
                                        disabled={testing === channel.id || !config[channel.id]?.enabled}
                                    >
                                        {testing === channel.id ? 'Testing...' : 'Send Test'}
                                    </button>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleSaveChannel(channel.id)}
                                        disabled={saving}
                                    >
                                        {saving ? 'Saving...' : 'Save'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            )}
        </div>
    );
};

const SystemInfo = () => {
    const { isAdmin } = useAuth();
    const [metrics, setMetrics] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (isAdmin) {
            loadMetrics();
        }
    }, [isAdmin]);

    async function loadMetrics() {
        try {
            const data = await api.getSystemMetrics();
            setMetrics(data);
        } catch (err) {
            console.error('Failed to load metrics:', err);
        } finally {
            setLoading(false);
        }
    }

    if (!isAdmin) {
        return (
            <div className="settings-section">
                <div className="section-header">
                    <h2>System Information</h2>
                    <p>View system details and server information</p>
                </div>
                <div className="alert alert-warning">
                    Admin access required to view system information.
                </div>
            </div>
        );
    }

    if (loading) {
        return <div className="loading">Loading system information...</div>;
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>System Information</h2>
                <p>View system details and server information</p>
            </div>

            <div className="system-info-grid">
                <div className="settings-card">
                    <h3>CPU</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Usage</span>
                            <span className="info-value">{metrics?.cpu?.percent?.toFixed(1) || 0}%</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Cores</span>
                            <span className="info-value">{metrics?.cpu?.count || '-'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Load Average</span>
                            <span className="info-value">
                                {metrics?.cpu?.load_avg ? metrics.cpu.load_avg.map(l => l.toFixed(2)).join(', ') : '-'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="settings-card">
                    <h3>Memory</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Usage</span>
                            <span className="info-value">{metrics?.memory?.percent?.toFixed(1) || 0}%</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Used</span>
                            <span className="info-value">{formatBytes(metrics?.memory?.used)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Total</span>
                            <span className="info-value">{formatBytes(metrics?.memory?.total)}</span>
                        </div>
                    </div>
                </div>

                <div className="settings-card">
                    <h3>Disk</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Usage</span>
                            <span className="info-value">{metrics?.disk?.percent?.toFixed(1) || 0}%</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Used</span>
                            <span className="info-value">{formatBytes(metrics?.disk?.used)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Total</span>
                            <span className="info-value">{formatBytes(metrics?.disk?.total)}</span>
                        </div>
                    </div>
                </div>

                <div className="settings-card">
                    <h3>Network</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Bytes Sent</span>
                            <span className="info-value">{formatBytes(metrics?.network?.bytes_sent)}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Bytes Received</span>
                            <span className="info-value">{formatBytes(metrics?.network?.bytes_recv)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {metrics?.system && (
                <div className="settings-card">
                    <h3>System Details</h3>
                    <div className="info-list">
                        <div className="info-item">
                            <span className="info-label">Hostname</span>
                            <span className="info-value">{metrics.system.hostname || '-'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Platform</span>
                            <span className="info-value">{metrics.system.platform || '-'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">OS Version</span>
                            <span className="info-value">{metrics.system.version || '-'}</span>
                        </div>
                        <div className="info-item">
                            <span className="info-label">Uptime</span>
                            <span className="info-value">{formatUptime(metrics.system.uptime)}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AboutSection = () => {
    const [version, setVersion] = useState('...');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    useEffect(() => {
        const fetchVersion = async () => {
            try {
                const data = await api.getVersion();
                setVersion(data.version || '1.0.0');
            } catch (error) {
                setVersion('1.0.0');
            }
        };
        fetchVersion();
    }, []);

    const checkForUpdate = async () => {
        setCheckingUpdate(true);
        try {
            const data = await api.checkUpdate();
            setUpdateInfo(data);
        } catch (error) {
            setUpdateInfo({ error: 'Failed to check for updates' });
        }
        setCheckingUpdate(false);
    };

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>About ServerKit</h2>
                <p>Server management made simple</p>
            </div>

            <div className="about-card">
                <div className="about-logo">
                    <Layers size={48} strokeWidth={1.5} />
                </div>
                <h3>ServerKit</h3>
                <p className="version">Version {version}</p>
                <p className="description">
                    A modern, lightweight server management panel for managing web applications,
                    databases, domains, and more. Built with Flask and React.
                </p>

                <div className="update-check">
                    {!updateInfo ? (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={checkForUpdate}
                            disabled={checkingUpdate}
                        >
                            {checkingUpdate ? (
                                <><RefreshCw size={14} className="spinning" /> Checking...</>
                            ) : (
                                <><Download size={14} /> Check for Updates</>
                            )}
                        </button>
                    ) : updateInfo.error ? (
                        <div className="update-status error">
                            <span>{updateInfo.error}</span>
                            <button className="btn-link" onClick={checkForUpdate}>Retry</button>
                        </div>
                    ) : updateInfo.update_available ? (
                        <div className="update-status available">
                            <Download size={16} />
                            <span>Update available: <strong>v{updateInfo.latest_version}</strong></span>
                            <a
                                href={updateInfo.release_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-accent btn-sm"
                            >
                                View Release <ExternalLink size={12} />
                            </a>
                        </div>
                    ) : (
                        <div className="update-status current">
                            <CheckCircle size={16} />
                            <span>You're up to date!</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="settings-card">
                <h3>Features</h3>
                <ul className="feature-list">
                    <li>
                        <Check size={16} />
                        Application Management (PHP, Python, Node.js, Docker)
                    </li>
                    <li>
                        <Check size={16} />
                        Domain & SSL Certificate Management
                    </li>
                    <li>
                        <Check size={16} />
                        Database Management (MySQL, PostgreSQL)
                    </li>
                    <li>
                        <Check size={16} />
                        Docker Container Management
                    </li>
                    <li>
                        <Check size={16} />
                        System Monitoring & Alerts
                    </li>
                    <li>
                        <Check size={16} />
                        Automated Backups
                    </li>
                    <li>
                        <Check size={16} />
                        Git Deployment with Webhooks
                    </li>
                </ul>
            </div>

            <div className="settings-card">
                <h3>Links</h3>
                <div className="link-list">
                    <a href="https://github.com/jhd3197/ServerKit" target="_blank" rel="noopener noreferrer" className="link-item">
                        <Github size={18} />
                        GitHub Repository
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit#readme" target="_blank" rel="noopener noreferrer" className="link-item">
                        <FileText size={18} />
                        Documentation
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/issues" target="_blank" rel="noopener noreferrer" className="link-item">
                        <HelpCircle size={18} />
                        Support & Issues
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/discussions" target="_blank" rel="noopener noreferrer" className="link-item">
                        <MessageSquare size={18} />
                        Discussions
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/issues/new" target="_blank" rel="noopener noreferrer" className="link-item">
                        <Bug size={18} />
                        Report a Bug
                    </a>
                </div>
            </div>

            <div className="settings-card">
                <h3>License</h3>
                <p className="license-text">
                    ServerKit is open source software licensed under the MIT License.
                </p>
            </div>
        </div>
    );
};

// Helper functions
function formatBytes(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds) {
    if (!seconds) return '-';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '< 1m';
}

export default Settings;
