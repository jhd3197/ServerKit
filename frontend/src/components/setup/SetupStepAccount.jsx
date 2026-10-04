import { useState } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import { Info } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { FormField } from '../FormField';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const SetupStepAccount = ({ onComplete }) => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [setupCode, setSetupCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { register, login, registrationEnabled, setupCodeRequired } = useAuth();

    // If users already exist (e.g. admin created via CLI), show login form instead
    const showLogin = !registrationEnabled;

    async function handleRegister(e) {
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
            await register(email, username, password, undefined, setupCodeRequired ? setupCode : undefined);
            onComplete({ email, username });
        } catch (err) {
            setError(err.message || 'Failed to create admin account');
        } finally {
            setLoading(false);
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(email, password);
            onComplete({ email, username: email });
        } catch (err) {
            setError(err.message || 'Failed to sign in');
        } finally {
            setLoading(false);
        }
    }

    if (showLogin) {
        return (
            <div className="wizard-step">
                <h2 className="wizard-step-title">{t('app.setupStepAccount.signIn', 'Sign In')}</h2>
                <p className="wizard-step-description">
                    {t('app.setupStepAccount.anAdminAccountAlreadyExistsSign', 'An admin account already exists. Sign in to continue setup.')}
                </p>

                <div className="alert alert-info">
                    <Info size={20} />
                    <p>
                        {t('app.setupStepAccount.itLooksLikeAnAdminAccount', 'It looks like an admin account was created via the CLI. Sign in with those credentials to finish setting up your server.')}
                    </p>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <Label htmlFor="email">{t('app.setupStepAccount.email', 'Email')}</Label>
                        <Input
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
                        <Label htmlFor="password">{t('common.labels.password', 'Password')}</Label>
                        <Input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={t('app.setupStepAccount.enterYourPassword', 'Enter your password')}
                            required
                        />
                    </div>

                    <SharedButton variant="unstyled"
                        type="submit"
                        className="btn-wizard-next btn-wizard-next--block"
                        disabled={loading}
                    >
                        {loading ? t('app.setupStepAccount.signingIn', 'Signing in…') : t('app.setupStepAccount.signInAndContinue', 'Sign in and continue')}
                    </SharedButton>
                </form>
            </div>
        );
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">{t('app.setupStepAccount.createAdminAccount', 'Create admin account')}</h2>
            <p className="wizard-step-description">
                {t('app.setupStepAccount.setUpTheAdministratorAccountFor', 'Set up the administrator account for your server.')}
            </p>

            <div className="alert alert-info">
                <Info size={20} />
                <p>
                    {t('app.setupStepAccount.thisIsYourFirstTimeUsing', 'This is your first time using ServerKit. Create an administrator account. This account will have full access to manage your server.')}
                </p>
            </div>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleRegister}>
                {setupCodeRequired && (
                    <FormField
                        htmlFor="setupCode"
                        label={t('app.setupStepAccount.setupCode', 'Setup code')}
                        hint={t('app.setupStepAccount.setupCodeHint', 'Shown at the end of the install. On the server, run: serverkit setup-code')}
                    >
                        <Input
                            type="text"
                            id="setupCode"
                            value={setupCode}
                            onChange={(e) => setSetupCode(e.target.value)}
                            placeholder={t('app.setupStepAccount.setupCodePlaceholder', 'XXXX-XXXX-XXXX')}
                            autoComplete="off"
                            spellCheck={false}
                            required
                            autoFocus
                        />
                    </FormField>
                )}

                <div className="form-group">
                    <Label htmlFor="email">{t('app.setupStepAccount.adminEmail', 'Admin email')}</Label>
                    <Input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="admin@example.com"
                        required
                        autoFocus={!setupCodeRequired}
                    />
                </div>

                <div className="form-group">
                    <Label htmlFor="username">{t('common.labels.username', 'Username')}</Label>
                    <Input
                        type="text"
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t('app.setupStepAccount.chooseAUsername', 'Choose a username')}
                        required
                    />
                </div>

                <div className="form-group">
                    <Label htmlFor="password">{t('common.labels.password', 'Password')}</Label>
                    <Input
                        type="password"
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t('app.setupStepAccount.atLeast8Characters', 'At least 8 characters')}
                        required
                    />
                </div>

                <div className="form-group">
                    <Label htmlFor="confirmPassword">{t('app.setupStepAccount.confirmPassword', 'Confirm password')}</Label>
                    <Input
                        type="password"
                        id="confirmPassword"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t('app.setupStepAccount.confirmYourPassword', 'Confirm your password')}
                        required
                    />
                </div>

                <SharedButton variant="unstyled"
                    type="submit"
                    className="btn-wizard-next btn-wizard-next--block"
                    disabled={loading}
                >
                    {loading ? t('app.setupStepAccount.creatingAccount', 'Creating account…') : t('common.actions.continue', 'Continue')}
                </SharedButton>
            </form>
        </div>
    );
};

export default SetupStepAccount;
