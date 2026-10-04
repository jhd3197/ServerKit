import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/useAuth.js';
import api from '../services/api';
import SSOProviderIcon from '../components/SSOProviderIcon';
import ServerKitLogo from '../components/ServerKitLogo';
import AuthLayout from './auth/AuthLayout';
import { consumeRedirect } from '../utils/redirectAfterLogin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Login = () => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // One-time login link + demo mode state
    const [redeemingLink, setRedeemingLink] = useState(false);
    const [demoInfo, setDemoInfo] = useState(null);
    const linkAttempted = useRef(false);

    // 2FA state
    const [requires2FA, setRequires2FA] = useState(false);
    const [tempToken, setTempToken] = useState('');
    const [totpCode, setTotpCode] = useState(['', '', '', '', '', '']);
    const [useBackupCode, setUseBackupCode] = useState(false);
    const [backupCode, setBackupCode] = useState('');
    const twoFactorInFlight = useRef(false);
    const submittedTotp = useRef(null);

    const {  setUser, registrationEnabled, ssoProviders, passwordLoginEnabled, publicTitle } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [ssoLoading, setSsoLoading] = useState(null);

    // Refs for TOTP input fields
    const inputRefs = useRef([]);

    // Handle incoming 2FA state from SSO callback
    useEffect(() => {
        if (location.state?.requires2FA) {
            setRequires2FA(true);
            setTempToken(location.state.tempToken);
        }
    }, [location.state]);

    // One-time login link redemption (?link=<token>). Single-use, so guard
    // against double-invocation (React StrictMode re-runs effects).
    useEffect(() => {
        const token = new URLSearchParams(location.search).get('link');
        if (!token || linkAttempted.current) return;
        linkAttempted.current = true;

        setRedeemingLink(true);
        api.redeemLoginLink(token)
            .then((response) => {
                if (response.requires_2fa) {
                    setRequires2FA(true);
                    setTempToken(response.temp_token);
                    setRedeemingLink(false);
                    navigate('/login', { replace: true });
                    return;
                }
                setUser(response.user);
                navigate(consumeRedirect(), { replace: true });
            })
            .catch((err) => {
                setError(err.message || 'Invalid or expired login link');
                setRedeemingLink(false);
                navigate('/login', { replace: true });
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    // Demo mode: surface read-only credentials when the panel runs as a demo.
    useEffect(() => {
        api.getDemoInfo()
            .then((info) => {
                if (info?.enabled) setDemoInfo(info);
            })
            .catch(() => { /* demo info is a nicety — never block login */ });
    }, []);

    function fillDemoCredentials() {
        if (!demoInfo) return;
        setEmail(demoInfo.username);
        setPassword(demoInfo.password);
    }

    async function handleSSOLogin(provider) {
        setSsoLoading(provider);
        setError('');
        try {
            const redirectUri = `${window.location.origin}/login/callback/${provider}`;
            const { auth_url } = await api.startSSOAuth(provider, redirectUri);
            window.location.href = auth_url;
        } catch (err) {
            setError(err.message || `Failed to start ${provider} login`);
            setSsoLoading(null);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await api.login(email, password);

            // Check if 2FA is required
            if (response.requires_2fa) {
                setRequires2FA(true);
                setTempToken(response.temp_token);
                setLoading(false);
                return;
            }

            // No 2FA - complete login
            setUser(response.user);
            navigate(consumeRedirect());
        } catch (err) {
            setError(err.message || 'Failed to login');
        } finally {
            setLoading(false);
        }
    }

    const handle2FASubmit = useCallback(async (e) => {
        e.preventDefault();
        if (twoFactorInFlight.current) return;
        twoFactorInFlight.current = true;
        setError('');
        setLoading(true);

        const code = useBackupCode ? backupCode : totpCode.join('');

        try {
            const response = await api.verify2FA(tempToken, code);

            // Store tokens
            api.setTokens(response.access_token, response.refresh_token);
            setUser(response.user);

            // Show warning if backup code used and running low
            if (response.warning) {
                // Could show a toast here
                console.warn(response.warning);
            }

            navigate(consumeRedirect());
        } catch (err) {
            setError(err.message || 'Invalid verification code');
            // Clear the code inputs on error
            if (!useBackupCode) {
                setTotpCode(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            twoFactorInFlight.current = false;
            setLoading(false);
        }
    }, [useBackupCode, backupCode, totpCode, tempToken, setUser, navigate]);

    function handleTotpChange(index, value) {
        // Only allow digits
        if (value && !/^\d$/.test(value)) return;

        const newCode = [...totpCode];
        newCode[index] = value;
        setTotpCode(newCode);

        // Auto-focus next input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    }

    function handleTotpKeyDown(index, e) {
        // Handle backspace
        if (e.key === 'Backspace' && !totpCode[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    }

    function handleTotpPaste(e) {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);

        if (pastedData) {
            const newCode = [...totpCode];
            for (let i = 0; i < pastedData.length && i < 6; i++) {
                newCode[i] = pastedData[i];
            }
            setTotpCode(newCode);

            // Focus the next empty input or the last one
            const nextEmptyIndex = newCode.findIndex(c => !c);
            if (nextEmptyIndex !== -1) {
                inputRefs.current[nextEmptyIndex]?.focus();
            } else {
                inputRefs.current[5]?.focus();
            }
        }
    }

    function handleBack() {
        setRequires2FA(false);
        setTempToken('');
        setTotpCode(['', '', '', '', '', '']);
        setBackupCode('');
        setUseBackupCode(false);
        setError('');
    }

    // Auto-submit when all 6 digits are entered
    useEffect(() => {
        if (!requires2FA || useBackupCode || !totpCode.every(c => c)) {
            submittedTotp.current = null;
            return;
        }
        if (loading || !tempToken) return;
        // Loading and auth-context updates must not resubmit a completed code.
        // Editing/clearing the digits re-arms the next attempt after a failure.
        const attempt = `${tempToken}:${totpCode.join('')}`;
        if (submittedTotp.current === attempt) return;
        submittedTotp.current = attempt;
        handle2FASubmit({ preventDefault: () => {} });
    }, [totpCode, useBackupCode, requires2FA, tempToken, loading, handle2FASubmit]);

    // Render 2FA verification form
    if (requires2FA) {
        return (
            <AuthLayout>
                    <div className="auth-header">
                        <div className="brand-logo">
                            <ServerKitLogo width={40} height={40} />
                        </div>
                        <h1>{t('auth.twoFactor.title', 'Two-factor authentication')}</h1>
                        <p>{useBackupCode
                            ? t('auth.twoFactor.backupHint', 'Enter a backup code.')
                            : t('auth.twoFactor.codeHint', 'Enter the 6-digit code from your authenticator app.')}</p>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <form onSubmit={handle2FASubmit}>
                        {!useBackupCode ? (
                            <div className="totp-inputs">
                                {totpCode.map((digit, index) => (
                                    <input
                                        key={index}
                                        ref={el => inputRefs.current[index] = el}
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={1}
                                        value={digit}
                                        onChange={(e) => handleTotpChange(index, e.target.value)}
                                        onKeyDown={(e) => handleTotpKeyDown(index, e)}
                                        onPaste={index === 0 ? handleTotpPaste : undefined}
                                        autoFocus={index === 0}
                                        className="totp-input"
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="form-group">
                                <Label htmlFor="backupCode">{t('auth.twoFactor.backupCode', 'Backup code')}</Label>
                                <Input
                                    type="text"
                                    id="backupCode"
                                    value={backupCode}
                                    onChange={(e) => setBackupCode(e.target.value.toLowerCase())}
                                    placeholder="xxxx-xxxx"
                                    autoFocus
                                />
                            </div>
                        )}

                        <Button type="submit" className="btn-full" disabled={loading}>
                            {loading ? 'Verifying...' : 'Verify'}
                        </Button>
                    </form>

                    <div className="auth-footer-links">
                        <Button
                            type="button"
                            variant="link"
                            onClick={() => setUseBackupCode(!useBackupCode)}
                        >
                            {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code instead'}
                        </Button>
                        <Button
                            type="button"
                            variant="link"
                            onClick={handleBack}
                        >
                            {t('auth.backToLogin', 'Back to sign in')}
                        </Button>
                    </div>
            </AuthLayout>
        );
    }

    // A one-time login link is being redeemed — show a minimal waiting card
    if (redeemingLink) {
        return (
            <AuthLayout>
                    <div className="auth-header">
                        <div className="brand-logo">
                            <ServerKitLogo width={40} height={40} />
                        </div>
                        <h1>{publicTitle}</h1>
                        <p>{t('auth.signingYouIn', 'Signing you in…')}</p>
                    </div>
            </AuthLayout>
        );
    }

    // Render normal login form
    return (
        <AuthLayout>
                <div className="auth-header">
                    <div className="brand-logo">
                        <ServerKitLogo width={40} height={40} />
                    </div>
                    <h1>{publicTitle}</h1>
                    <p>{t('auth.signInSubtitle', 'Sign in to your account')}</p>
                </div>

                {error && <div className="error-message">{error}</div>}

                {demoInfo && (
                    <div className="demo-hint">
                        <div className="demo-hint__title">{t('auth.demoMode', 'Demo mode: sign in read-only')}</div>
                        <div className="demo-hint__creds">
                            <code>{demoInfo.username}</code> / <code>{demoInfo.password}</code>
                        </div>
                        <Button type="button" variant="link" className="demo-hint__fill" onClick={fillDemoCredentials}>
                            {t('auth.useDemoCredentials', 'Use demo credentials')}
                        </Button>
                    </div>
                )}

                {ssoProviders && ssoProviders.length > 0 && (
                    <div className="sso-providers">
                        {ssoProviders.map(p => (
                            <Button variant="unstyled" type="button"
                                key={p.id}
                                className={`btn-sso btn-sso--${p.id}`}
                                onClick={() => handleSSOLogin(p.id)}
                                disabled={ssoLoading !== null}
                            >
                                <SSOProviderIcon provider={p.id} />
                                {ssoLoading === p.id ? 'Redirecting...' : `Continue with ${p.name}`}
                            </Button>
                        ))}
                    </div>
                )}

                {ssoProviders && ssoProviders.length > 0 && passwordLoginEnabled && (
                    <div className="sso-divider">
                        <span>or</span>
                    </div>
                )}

                {passwordLoginEnabled && (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <Label htmlFor="email">{t('auth.usernameOrEmail', 'Username or email')}</Label>
                            <Input
                                type="text"
                                id="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder={t('auth.usernamePlaceholder', 'admin or you@example.com')}
                                required
                                autoComplete="username"
                            />
                        </div>

                        <div className="form-group">
                            <Label htmlFor="password">{t('auth.password', 'Password')}</Label>
                            <Input
                                type="password"
                                id="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={t('auth.passwordPlaceholder', 'Enter your password')}
                                required
                            />
                        </div>

                        <Button type="submit" className="btn-full" disabled={loading}>
                            {loading ? t('auth.signingIn', 'Signing in…') : t('auth.signIn', 'Sign In')}
                        </Button>
                    </form>
                )}

                {registrationEnabled && passwordLoginEnabled && (
                    <p className="auth-footer">
                        <Trans
                            i18nKey="auth.noAccount"
                            defaults="Don't have an account? <0>Create one</0>"
                            components={[<Link key="register" to="/register" />]}
                        />
                    </p>
                )}
        </AuthLayout>
    );
};

export default Login;
