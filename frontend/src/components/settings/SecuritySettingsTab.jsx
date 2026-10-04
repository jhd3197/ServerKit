import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import api from '../../services/api';
import useSettingFocus from '../../hooks/useSettingFocus';
import TwoFactorPolicyCard from './TwoFactorPolicyCard';
import SSOProviderIcon from '../SSOProviderIcon';
import Modal from '../Modal';
import ErrorState from '../ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import CopyField from '../CopyField';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';

const LinkedAccounts = ({ register }) => {
    const { t } = useTranslation();
    const { ssoProviders } = useAuth();
    const [identities, setIdentities] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unlinking, setUnlinking] = useState(null);
    const [linkingProvider, setLinkingProvider] = useState(null);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        loadIdentities();
    }, []);

    async function loadIdentities() {
        try {
            const data = await api.getSSOIdentities();
            setIdentities(data.identities || []);
            setLoadError(null);
        } catch (err) {
            // Only surfaced when SSO providers exist (the card is hidden
            // otherwise), so an unconfigured SSO stays quiet.
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleUnlink(provider) {
        setUnlinking(provider);
        setError('');
        try {
            await api.unlinkSSOProvider(provider);
            await loadIdentities();
        } catch (err) {
            setError(err.message);
        } finally {
            setUnlinking(null);
        }
    }

    async function handleLink(provider) {
        setLinkingProvider(provider);
        setError('');
        try {
            const redirectUri = `${window.location.origin}/login/callback/${provider}`;
            const { auth_url } = await api.startSSOAuth(provider, redirectUri);
            window.location.href = auth_url;
        } catch (err) {
            setError(err.message);
            setLinkingProvider(null);
        }
    }

    if (loading || (!ssoProviders?.length && !identities.length)) {
        return null;
    }

    const linkedProviderIds = identities.map(i => i.provider);
    const availableToLink = (ssoProviders || []).filter(p => !linkedProviderIds.includes(p.id));

    return (
        <div {...register('security-linked-accounts', 'settings-card')}>
            <h3>{t('app.securitySettingsTab.linkedAccounts', 'Linked accounts')}</h3>
            <p className="text-secondary">{t('app.securitySettingsTab.connectExternalIdentityProvidersToYour', 'Connect external identity providers to your account')}</p>

            {error && <div className="alert alert-danger">{error}</div>}
            {loadError && <ErrorState compact error={loadError} onRetry={loadIdentities} />}

            {identities.length > 0 && (
                <div className="linked-accounts-list">
                    {identities.map(identity => (
                        <div key={identity.id} className="linked-account">
                            <div className="linked-account__info">
                                <SSOProviderIcon provider={identity.provider} />
                                <div>
                                    <span className="linked-account__provider">{identity.provider}</span>
                                    <span className="linked-account__email">{identity.provider_email}</span>
                                </div>
                            </div>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => handleUnlink(identity.provider)}
                                disabled={unlinking === identity.provider}
                            >
                                {unlinking === identity.provider ? 'Unlinking...' : 'Unlink'}
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {availableToLink.length > 0 && (
                <div className="linked-accounts-available">
                    {availableToLink.map(p => (
                        <Button
                            key={p.id}
                            variant="outline"
                            size="sm"
                            onClick={() => handleLink(p.id)}
                            disabled={linkingProvider === p.id}
                        >
                            <SSOProviderIcon provider={p.id} />
                            {linkingProvider === p.id ? 'Redirecting...' : `Link ${p.name}`}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
};

const SecuritySettingsTab = () => {
    const { t } = useTranslation();
    const { updateUser, user, isAdmin } = useAuth();
    const register = useSettingFocus();
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
    const [twoFALoadError, setTwoFALoadError] = useState(null);

    useEffect(() => {
        load2FAStatus();
    }, []);

    async function load2FAStatus() {
        setTwoFALoading(true);
        try {
            const status = await api.get2FAStatus();
            setTwoFAStatus(status);
            setTwoFALoadError(null);
        } catch (err) {
            console.error('Failed to load 2FA status:', err);
            setTwoFALoadError(err);
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
            await updateUser({
                password: formData.newPassword,
                current_password: formData.currentPassword,
            });
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
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'two-factor-setup-started' },
            }));
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
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'two-factor-enabled' },
            }));
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

        downloadBlob(content, 'serverkit-backup-codes.txt');
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.securitySettingsTab.securitySettings', 'Security settings')}</h2>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            {/* Two-Factor Authentication Section */}
            <div {...register('security-2fa', 'settings-card two-fa-card')} data-walkthrough="two-factor-card">
                <div className="two-fa-header">
                    <div className="two-fa-icon">
                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </div>
                    <div>
                        <h3>{t('app.securitySettingsTab.twoFactorAuthentication2fa', 'Two-factor authentication (2FA)')}</h3>
                        <p>{t('app.securitySettingsTab.addAnExtraLayerOfSecurity', 'Add an extra layer of security to your account.')}</p>
                    </div>
                </div>

                {twoFALoading && !twoFAStatus ? (
                    <div className="loading-sm">{t('common.loading', 'Loading…')}</div>
                ) : twoFALoadError && !twoFAStatus ? (
                    <ErrorState
                        title={t('app.securitySettingsTab.couldntLoad2fa', "Couldn't load 2FA status")}
                        error={twoFALoadError}
                        onRetry={load2FAStatus}
                    />
                ) : twoFAStatus?.enabled ? (
                    <div className="two-fa-enabled">
                        <div className="two-fa-status">
                            <Badge variant="success">{t('app.securitySettingsTab.enabled', 'Enabled')}</Badge>
                            <span className="two-fa-info">
                                {t('app.securitySettingsTab.enabledOn', 'Enabled on')} {new Date(twoFAStatus.confirmed_at).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="two-fa-backup-info">
                            <span>{t('app.securitySettingsTab.backupCodesRemaining', 'Backup codes remaining:')} <strong>{twoFAStatus.backup_codes_remaining}</strong></span>
                            {twoFAStatus.backup_codes_remaining <= 3 && (
                                <span className="warning-text">{t('app.securitySettingsTab.considerRegeneratingYourBackupCodes', 'Consider regenerating your backup codes')}</span>
                            )}
                        </div>
                        <div className="two-fa-actions">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setVerificationCode('');
                                    setTwoFAError('');
                                    setShowBackupCodesModal(true);
                                }}
                            >
                                {t('app.securitySettingsTab.regenerateBackupCodes', 'Regenerate backup codes')}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    setVerificationCode('');
                                    setTwoFAError('');
                                    setShowDisableModal(true);
                                }}
                            >
                                {t('app.securitySettingsTab.disable2fa', 'Disable 2FA')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="two-fa-disabled">
                        <p className="two-fa-description">
                            {t('app.securitySettingsTab.twoFactorAuthenticationAddsAnAdditional', 'Two-factor authentication adds an additional layer of security to your account by requiring a code from your authenticator app in addition to your password.')}
                        </p>
                        <Button
                            variant="default"
                            onClick={handleInitiate2FA}
                            disabled={twoFALoading}
                        >
                            {t('app.securitySettingsTab.enableTwoFactorAuthentication', 'Enable two-factor authentication')}
                        </Button>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} {...register('security-password', 'settings-form')}>
                <h3>{t('app.securitySettingsTab.changePassword', 'Change password')}</h3>

                <div className="form-group">
                    <Label>{t('app.securitySettingsTab.currentPassword', 'Current password')}</Label>
                    <Input
                        type="password"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                        placeholder={t('app.securitySettingsTab.enterCurrentPassword', 'Enter current password')}
                    />
                </div>

                <div className="form-group">
                    <Label>{t('app.securitySettingsTab.newPassword', 'New password')}</Label>
                    <Input
                        type="password"
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        placeholder={t('app.securitySettingsTab.enterNewPassword', 'Enter new password')}
                        required
                    />
                    <span className="form-help">{t('app.securitySettingsTab.minimum8Characters', 'Minimum 8 characters')}</span>
                </div>

                <div className="form-group">
                    <Label>{t('app.securitySettingsTab.confirmNewPassword', 'Confirm new password')}</Label>
                    <Input
                        type="password"
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        placeholder={t('app.securitySettingsTab.confirmNewPassword2', 'Confirm new password')}
                        required
                    />
                </div>

                <div className="form-actions">
                    <Button type="submit" variant="default" disabled={loading}>
                        {loading ? 'Changing...' : 'Change Password'}
                    </Button>
                </div>
            </form>

            <div {...register('security-sessions', 'settings-card')}>
                <h3>{t('app.securitySettingsTab.sessions', 'Sessions')}</h3>
                <p>{t('app.securitySettingsTab.manageYourActiveSessions', 'Manage your active sessions')}</p>
                <div className="session-item current">
                    <div className="session-info">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                        <div>
                            <span className="session-device">{t('app.securitySettingsTab.currentSession', 'Current session')}</span>
                            <span className="session-details">{t('app.securitySettingsTab.thisDeviceActiveNow', 'This device - active now')}</span>
                        </div>
                    </div>
                    <Badge variant="success">{t('common.labels.current', 'Current')}</Badge>
                </div>
            </div>

            {/* Require-2FA policy (admin only) — a policy, never a default. */}
            {isAdmin && <TwoFactorPolicyCard {...register('security-2fa-policy', 'settings-card')} />}

            {/* Linked Accounts */}
            <LinkedAccounts register={register} />

            {/* 2FA Setup Modal */}
            {showSetupModal && setupData && (
                <Modal open={true} onClose={() => setShowSetupModal(false)} title={t('app.securitySettingsTab.setUpTwoFactorAuthentication', 'Set up two-factor authentication')} size="md">
                            <div className="setup-steps" data-walkthrough="two-factor-verify">
                                <div className="setup-step">
                                    <span className="step-number">1</span>
                                    <div className="step-content">
                                        <h4>{t('app.securitySettingsTab.scanTheQrCode', 'Scan the QR code')}</h4>
                                        <p>{t('app.securitySettingsTab.useYourAuthenticatorAppGoogleAuthenticator', 'Use your authenticator app (Google Authenticator, Authy, 1Password, etc.) to scan this QR code.')}</p>
                                        {setupData.qr_code ? (
                                            <div className="qr-code-container">
                                                <img src={setupData.qr_code} alt={t('app.securitySettingsTab.2faQrCode', '2FA QR code')} className="qr-code" />
                                            </div>
                                        ) : (
                                            <div className="qr-fallback">
                                                <p>{t('app.securitySettingsTab.qrCodeUnavailableEnterThisSecret', 'QR code unavailable. Enter this secret manually:')}</p>
                                                <CopyField value={setupData.secret} secret />
                                            </div>
                                        )}
                                        <details className="manual-entry">
                                            <summary>{t('app.securitySettingsTab.canTScanEnterManually', 'Can\'t scan? Enter manually')}</summary>
                                            <p>{t('app.securitySettingsTab.account', 'Account:')} {user?.email ?? ''}</p>
                                            <CopyField label={t('app.securitySettingsTab.secretLabel', 'Secret')} value={setupData.secret} secret />
                                        </details>
                                    </div>
                                </div>

                                <div className="setup-step">
                                    <span className="step-number">2</span>
                                    <div className="step-content">
                                        <h4>{t('app.securitySettingsTab.enterVerificationCode', 'Enter verification code')}</h4>
                                        <p>{t('app.securitySettingsTab.enterThe6DigitCodeFrom', 'Enter the 6-digit code from your authenticator app to verify setup.')}</p>
                                        <Input
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
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowSetupModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                variant="default"
                                onClick={handleConfirm2FA}
                                disabled={twoFALoading || verificationCode.length !== 6}
                            >
                                {twoFALoading ? 'Verifying...' : 'Enable 2FA'}
                            </Button>
                        </div>
                </Modal>
            )}

            {/* Disable 2FA Modal */}
            {showDisableModal && (
                <Modal open={true} onClose={() => setShowDisableModal(false)} title={t('app.securitySettingsTab.disableTwoFactorAuthentication', 'Disable two-factor authentication')}>
                            <div className="warning-box">
                                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <p>{t('app.securitySettingsTab.disabling2faWillMakeYourAccount', 'Disabling 2FA will make your account less secure. You will only need your password to sign in.')}</p>
                            </div>
                            <div className="form-group">
                                <Label>{t('app.securitySettingsTab.enterAVerificationCodeOrBackup', 'Enter a verification code or backup code to disable 2FA:')}</Label>
                                <Input
                                    type="text"
                                    value={verificationCode}
                                    onChange={(e) => setVerificationCode(e.target.value)}
                                    placeholder={t('app.securitySettingsTab.codeFromAuthenticatorOrBackupCode', 'Code from authenticator or backup code')}
                                    autoFocus
                                />
                                {twoFAError && <p className="error-text">{twoFAError}</p>}
                            </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowDisableModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleDisable2FA}
                                disabled={twoFALoading || !verificationCode}
                            >
                                {twoFALoading ? 'Disabling...' : 'Disable 2FA'}
                            </Button>
                        </div>
                </Modal>
            )}

            {/* Backup Codes Modal */}
            {showBackupCodesModal && (
                <Modal open={true} onClose={() => setShowBackupCodesModal(false)} title={backupCodes.length > 0 ? t('app.securitySettingsTab.yourBackupCodes', 'Your backup codes') : t('app.securitySettingsTab.regenerateBackupCodes', 'Regenerate backup codes')} size="md">
                            {backupCodes.length > 0 ? (
                                <>
                                    <div className="warning-box">
                                        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10"/>
                                            <line x1="12" y1="8" x2="12" y2="12"/>
                                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <p>{t('app.securitySettingsTab.saveTheseBackupCodesInA', 'Save these backup codes in a secure location. They will not be shown again. Each code can only be used once.')}</p>
                                    </div>
                                    <CopyField value={backupCodes.join('\n')} multiline />
                                    <div className="backup-codes-actions">
                                        <Button variant="outline" onClick={downloadBackupCodes}>
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                                            </svg>
                                            {t('common.actions.download', 'Download')}
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p>{t('app.securitySettingsTab.enterACodeFromYourAuthenticator', 'Enter a code from your authenticator app to generate new backup codes. This will invalidate all existing backup codes.')}</p>
                                    <div className="form-group">
                                        <Label>{t('app.securitySettingsTab.verificationCode', 'Verification code')}</Label>
                                        <Input
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
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => {
                                setShowBackupCodesModal(false);
                                setBackupCodes([]);
                                setVerificationCode('');
                            }}>
                                {backupCodes.length > 0 ? 'Done' : 'Cancel'}
                            </Button>
                            {backupCodes.length === 0 && (
                                <Button
                                    variant="default"
                                    onClick={handleRegenerateBackupCodes}
                                    disabled={twoFALoading || verificationCode.length !== 6}
                                >
                                    {twoFALoading ? 'Generating...' : 'Generate New Codes'}
                                </Button>
                            )}
                        </div>
                </Modal>
            )}
        </div>
    );
};

export default SecuritySettingsTab;
