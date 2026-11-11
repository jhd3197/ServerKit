import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/utils/intl';
import { ShieldCheck, User, CalendarDays } from 'lucide-react';
import { Pill } from '@/components/ds';
import InfoTip from '../InfoTip';

const ProfileTab = () => {
    const { t } = useTranslation();
    const { user, updateUser } = useAuth();
    const register = useSettingFocus();
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

    const dirty = formData.username !== (user?.username || '') || formData.email !== (user?.email || '');
    const role = user?.role || 'user';
    const RoleIcon = role === 'admin' ? ShieldCheck : User;

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);
        setMessage(null);

        try {
            await updateUser(formData);
            setMessage({ type: 'success', text: t('app.profileTab.profileUpdated', 'Profile updated successfully') });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.profileTab.profileSettings', 'Profile settings')}</h2>
            </div>

            <div className="profile-identity">
                <div className="profile-identity__avatar" aria-hidden="true">
                    {(user?.username || '?').charAt(0).toUpperCase()}
                </div>
                <div className="profile-identity__text">
                    <div className="profile-identity__name">{user?.username}</div>
                    <div className="profile-identity__email">{user?.email}</div>
                </div>
                <div className="profile-identity__meta">
                    <Pill dot={false}>
                        <RoleIcon aria-hidden="true" />
                        <span className="profile-identity__role">{role}</span>
                        <InfoTip>{t('app.profileTab.contactAnAdministratorToChangeYour', 'Contact an administrator to change your role')}</InfoTip>
                    </Pill>
                    {user?.created_at && (
                        <Pill dot={false} title={t('app.profileTab.memberSince', 'Member since')}>
                            <CalendarDays aria-hidden="true" />
                            {formatDate(user.created_at)}
                        </Pill>
                    )}
                </div>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit} {...register('profile-username', 'settings-form')}>
                <div className="form-group">
                    <Label htmlFor="profile-username">{t('common.labels.username', 'Username')}</Label>
                    <Input
                        id="profile-username" type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        required
                    />
                </div>

                <div className="form-group">
                    <Label htmlFor="profile-email">{t('app.profileTab.emailAddress', 'Email address')}</Label>
                    <Input
                        id="profile-email" type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                    />
                </div>

                <div className="form-actions">
                    <Button type="submit" variant="default" disabled={loading || !dirty}
                        disabledReason={!loading && !dirty ? t('app.proxyStackPanel.noChangesToSave', 'No changes to save') : undefined}>
                        {loading ? t('common.saving', 'Saving…') : t('app.profileTab.saveChanges', 'Save changes')}
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default ProfileTab;
