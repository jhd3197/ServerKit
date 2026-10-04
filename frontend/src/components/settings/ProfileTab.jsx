import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';

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
                <h2>{t('app.profileTab.profileSettings', 'Profile Settings')}</h2>
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
                    <Label htmlFor="profile-email">{t('app.profileTab.emailAddress', 'Email Address')}</Label>
                    <Input
                        id="profile-email" type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        required
                    />
                </div>

                <div className="form-group">
                    <Label htmlFor="profile-role">{t('app.profileTab.role', 'Role')}</Label>
                    <Input id="profile-role" type="text" value={user?.role || 'user'} readOnly />
                    <span className="form-help">{t('app.profileTab.contactAnAdministratorToChangeYour', 'Contact an administrator to change your role')}</span>
                </div>

                <div className="form-group">
                    <Label htmlFor="profile-member-since">{t('app.profileTab.memberSince', 'Member Since')}</Label>
                    <Input
                        id="profile-member-since" type="text"
                        value={user?.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                        readOnly
                    />
                </div>

                <div className="form-actions">
                    <Button type="submit" variant="default" disabled={loading}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </form>
        </div>
    );
};

export default ProfileTab;
