import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const Settings = () => {
    const [activeTab, setActiveTab] = useState('profile');

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
    const [settings, setSettings] = useState({
        emailAlerts: true,
        serverAlerts: true,
        securityAlerts: true,
        backupAlerts: false,
        deployAlerts: true
    });

    function handleToggle(key) {
        setSettings({ ...settings, [key]: !settings[key] });
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>Notification Settings</h2>
                <p>Choose what notifications you want to receive</p>
            </div>

            <div className="settings-card">
                <h3>Email Notifications</h3>
                <div className="notification-options">
                    <div className="notification-item">
                        <div className="notification-info">
                            <span className="notification-title">Server Alerts</span>
                            <span className="notification-desc">Get notified when server metrics exceed thresholds</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.serverAlerts}
                                onChange={() => handleToggle('serverAlerts')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    <div className="notification-item">
                        <div className="notification-info">
                            <span className="notification-title">Security Alerts</span>
                            <span className="notification-desc">Get notified about security events and login attempts</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.securityAlerts}
                                onChange={() => handleToggle('securityAlerts')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    <div className="notification-item">
                        <div className="notification-info">
                            <span className="notification-title">Backup Notifications</span>
                            <span className="notification-desc">Get notified when backups complete or fail</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.backupAlerts}
                                onChange={() => handleToggle('backupAlerts')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    <div className="notification-item">
                        <div className="notification-info">
                            <span className="notification-title">Deployment Notifications</span>
                            <span className="notification-desc">Get notified when deployments complete or fail</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.deployAlerts}
                                onChange={() => handleToggle('deployAlerts')}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
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
    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>About ServerKit</h2>
                <p>Server management made simple</p>
            </div>

            <div className="about-card">
                <div className="about-logo">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <h3>ServerKit</h3>
                <p className="version">Version 1.0.0</p>
                <p className="description">
                    A modern, lightweight server management panel for managing web applications,
                    databases, domains, and more. Built with Flask and React.
                </p>
            </div>

            <div className="settings-card">
                <h3>Features</h3>
                <ul className="feature-list">
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Application Management (PHP, Python, Node.js, Docker)
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Domain & SSL Certificate Management
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Database Management (MySQL, PostgreSQL)
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Docker Container Management
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        System Monitoring & Alerts
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Automated Backups
                    </li>
                    <li>
                        <svg viewBox="0 0 24 24" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                        Git Deployment with Webhooks
                    </li>
                </ul>
            </div>

            <div className="settings-card">
                <h3>Links</h3>
                <div className="link-list">
                    <a href="https://github.com/serverkit" target="_blank" rel="noopener noreferrer" className="link-item">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                        </svg>
                        GitHub Repository
                    </a>
                    <a href="#" className="link-item">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        Documentation
                    </a>
                    <a href="#" className="link-item">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Support
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
