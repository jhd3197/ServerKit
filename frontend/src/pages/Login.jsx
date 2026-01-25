import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // 2FA state
    const [requires2FA, setRequires2FA] = useState(false);
    const [tempToken, setTempToken] = useState('');
    const [totpCode, setTotpCode] = useState(['', '', '', '', '', '']);
    const [useBackupCode, setUseBackupCode] = useState(false);
    const [backupCode, setBackupCode] = useState('');

    const { login, setUser, setTokens, registrationEnabled } = useAuth();
    const navigate = useNavigate();

    // Refs for TOTP input fields
    const inputRefs = useRef([]);

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
            navigate('/');
        } catch (err) {
            setError(err.message || 'Failed to login');
        } finally {
            setLoading(false);
        }
    }

    async function handle2FASubmit(e) {
        e.preventDefault();
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

            navigate('/');
        } catch (err) {
            setError(err.message || 'Invalid verification code');
            // Clear the code inputs on error
            if (!useBackupCode) {
                setTotpCode(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            setLoading(false);
        }
    }

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
        if (!useBackupCode && totpCode.every(c => c) && !loading) {
            handle2FASubmit({ preventDefault: () => {} });
        }
    }, [totpCode, useBackupCode]);

    // Render 2FA verification form
    if (requires2FA) {
        return (
            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <div className="brand-logo">
                            <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                        </div>
                        <h1>Two-Factor Authentication</h1>
                        <p>{useBackupCode ? 'Enter a backup code' : 'Enter the 6-digit code from your authenticator app'}</p>
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
                                <label htmlFor="backupCode">Backup Code</label>
                                <input
                                    type="text"
                                    id="backupCode"
                                    value={backupCode}
                                    onChange={(e) => setBackupCode(e.target.value.toLowerCase())}
                                    placeholder="xxxx-xxxx"
                                    autoFocus
                                />
                            </div>
                        )}

                        <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                            {loading ? 'Verifying...' : 'Verify'}
                        </button>
                    </form>

                    <div className="auth-footer-links">
                        <button
                            type="button"
                            className="link-button"
                            onClick={() => setUseBackupCode(!useBackupCode)}
                        >
                            {useBackupCode ? 'Use authenticator app instead' : 'Use a backup code instead'}
                        </button>
                        <button
                            type="button"
                            className="link-button"
                            onClick={handleBack}
                        >
                            Back to login
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Render normal login form
    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="brand-logo">
                        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <h1>ServerKit</h1>
                    <p>Sign in to your account</p>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="email">Username or Email</label>
                        <input
                            type="text"
                            id="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin or you@example.com"
                            required
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            required
                        />
                    </div>

                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                {registrationEnabled && (
                    <p className="auth-footer">
                        Don't have an account? <Link to="/register">Create one</Link>
                    </p>
                )}
            </div>
        </div>
    );
};

export default Login;
