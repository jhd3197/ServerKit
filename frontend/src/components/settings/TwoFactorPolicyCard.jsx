import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import ErrorState from '../ErrorState';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

// Admin control for the require-2FA policy (plan 22 #14). A policy, never a
// default: 'off' (nobody forced), 'admins', or 'all'. Within the grace window a
// user still logs in with a password + a nudge; past it, login yields an
// enrollment-scoped token until they add a passkey or authenticator app.
// SSO-authenticated users are always exempt (the IdP owns their second factor).

const POLICY_LABELS = {
    off: 'Off — nobody is forced to enrol',
    admins: 'Admins — admin accounts must enrol',
    all: 'Everyone — all accounts must enrol',
};

// `props` are spread onto the card root so a parent can attach a ref /
// focus-highlight class (see useSettingFocus / command-palette deep links).
const TwoFactorPolicyCard = (props) => {
    const { t } = useTranslation();
    const [policy, setPolicy] = useState('off');
    const [graceDays, setGraceDays] = useState(7);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [loadError, setLoadError] = useState(null);

    const loadPolicy = () => {
        setLoading(true);
        setLoadError(null);
        api.getSystemSettings()
            .then((data) => {
                setPolicy(data.security_require_2fa || 'off');
                if (data.security_require_2fa_grace_days != null) {
                    setGraceDays(data.security_require_2fa_grace_days);
                }
            })
            // Never fall back to the 'off' default: saving it would silently
            // lift a stricter policy the server actually holds.
            .catch((err) => setLoadError(err))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        loadPolicy();
    }, []);

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSystemSettings({
                security_require_2fa: policy,
                security_require_2fa_grace_days: Number(graceDays) || 0,
            });
            setMessage({ type: 'success', text: 'Two-factor policy saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save policy' });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 6000);
        }
    }

    if (loading) return null;

    if (loadError) {
        return (
            <div className="settings-card" {...props}>
                <h3>{t('app.twoFactorPolicyCard.twoFactorAuthenticationPolicy', 'Two-factor authentication policy')}</h3>
                <ErrorState
                    title={t('app.twoFactorPolicyCard.couldntLoadPolicy', "Couldn't load the two-factor policy")}
                    error={loadError}
                    onRetry={loadPolicy}
                />
            </div>
        );
    }

    return (
        <div className="settings-card" {...props}>
            <h3>{t('app.twoFactorPolicyCard.twoFactorAuthenticationPolicy', 'Two-factor authentication policy')}</h3>
            <p className="form-help form-help--flush">
                {t('app.twoFactorPolicyCard.requireAccountsToProtectThemselvesWith', 'Require accounts to protect themselves with a passkey or authenticator app. Passwords keep working until the grace window ends; after that, sign-in only lets the user reach the enrolment screen until they add a second factor. Single sign-on users are always exempt.')}
            </p>

            <div className="form-group">
                <label>{t('app.twoFactorPolicyCard.whoMustEnrol', 'Who must enrol')}</label>
                <Select value={policy} onValueChange={setPolicy}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(POLICY_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {policy !== 'off' && (
                <div className="form-group">
                    <label>{t('app.twoFactorPolicyCard.gracePeriodDays', 'Grace period (days)')}</label>
                    <Input
                        type="number"
                        className="policy-grace-input"
                        min="0"
                        value={graceDays}
                        onChange={(e) => setGraceDays(e.target.value)}
                    />
                    <span className="form-help">
                        {t('app.twoFactorPolicyCard.daysANewlyCoveredAccountMay', 'Days a newly-covered account may keep signing in with just a password before enrolment is enforced.')}
                    </span>
                </div>
            )}

            <div className="form-actions">
                <Button variant="default" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save policy'}
                </Button>
                {message && (
                    <span className={`timezone-message timezone-message--inline ${message.type}`}>
                        {message.text}
                    </span>
                )}
            </div>
        </div>
    );
};

export default TwoFactorPolicyCard;
