import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Info } from 'lucide-react';

const SetupStepAccount = ({ onComplete }) => {
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { register } = useAuth();

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setLoading(true);

        try {
            await register(email, username, password);
            onComplete({ email, username });
        } catch (err) {
            setError(err.message || 'Failed to create admin account');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">Create Admin Account</h2>
            <p className="wizard-step-description">
                Set up the administrator account for your server.
            </p>

            <div className="wizard-info-banner">
                <div className="wizard-info-icon">
                    <Info size={20} />
                </div>
                <p>
                    This is your first time using ServerKit. Create an administrator
                    account to get started. This account will have full access to
                    manage your server.
                </p>
            </div>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="email">Admin Email</label>
                    <input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@example.com"
                        required
                        autoFocus
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="username">Username</label>
                    <input
                        type="text"
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Choose a username"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="confirmPassword">Confirm Password</label>
                    <input
                        type="password"
                        id="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm your password"
                        required
                    />
                </div>

                <button
                    type="submit"
                    className="btn-wizard-next"
                    disabled={loading}
                    style={{ width: '100%', justifyContent: 'center' }}
                >
                    {loading ? 'Creating account...' : 'Continue'}
                </button>
            </form>
        </div>
    );
};

export default SetupStepAccount;
