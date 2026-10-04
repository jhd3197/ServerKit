import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SegControl } from '../ds/SegControl';
import EmptyState from '../EmptyState';
import PortField from '../PortField';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';

const NotificationsTab = () => {
    const { t } = useTranslation();
    const { isAdmin, user } = useAuth();
    const register = useSettingFocus();
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
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
        let active = true;
        setLoading(true);
        setLoadError(false);
        Promise.all([api.getUserNotificationPreferences(), isAdmin ? api.getNotificationsConfig() : Promise.resolve(null)])
            .then(([prefs, data]) => {
                if (!active) return;
                setUserPrefs((prev) => ({ ...prev, ...prefs }));
                if (data) setConfig((prev) => Object.fromEntries(
                    Object.entries(prev).map(([channel, defaults]) => [channel, { ...defaults, ...data[channel] }])
                ));
            })
            .catch((error) => {
                if (!active) return;
                setLoadError(true);
                setMessage({ type: 'error', text: error.message || t('notifications.loadFailed', "Couldn't load notification settings. Reload to try again.") });
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [isAdmin, loadAttempt, t]);

    async function handleSaveUserPrefs() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateUserNotificationPreferences({ ...userPrefs, channels: (userPrefs.channels || []).filter((channel) => channel !== 'slack') });
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
        return <EmptyState loading title={t('app.notificationsTab.loadingNotificationSettings', 'Loading notification settings…')} />;
    }

    if (loadError) return <EmptyState title={t('notifications.loadFailed', "Couldn't load notification settings. Reload to try again.")}
        description={message?.text} action={<Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t('common.retry', 'Retry')}</Button>} />;

    const userPrefsUI = (
        <div className="user-notification-prefs">
            <div {...register('notifications-enable', 'settings-card')}>
                <div className="form-group">
                    <div className="settings-notification-option">
                        <Switch id="notifications-enabled" disabled={saving}
                            checked={userPrefs.enabled}
                            onCheckedChange={(checked) => setUserPrefs({...userPrefs, enabled: checked})}
                        />
                        <Label htmlFor="notifications-enabled">{t('app.notificationsTab.enableNotificationsForMyAccount', 'Enable notifications for my account')}</Label>
                    </div>
                </div>
            </div>

            <div {...register('notifications-channels', 'settings-card')}>
                <h3>{t('app.notificationsTab.notificationChannels', 'Notification channels')}</h3>
                <p>{t('notifications.personalChannelsHint', 'Choose destinations for your account. Slack and shared webhooks are managed in Delivery settings.')}</p>
                <div className="channel-toggles">
                    {['email', 'discord', 'telegram'].map(ch => (
                        <label key={ch} className="channel-toggle">
                            <Switch disabled={saving} aria-label={ch.charAt(0).toUpperCase() + ch.slice(1)}
                                checked={userPrefs.channels?.includes(ch)}
                                onCheckedChange={(checked) => {
                                    const channels = checked
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
                <div {...register('notifications-email', 'settings-card')}>
                    <h3>{t('app.notificationsTab.emailSettings', 'Email settings')}</h3>
                    <div className="form-group">
                        <Label>{t('app.notificationsTab.notificationEmailOptional', 'Notification email (optional)')}</Label>
                        <Input
                            type="email"
                            value={userPrefs.email || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, email: e.target.value})}
                            placeholder={user?.email || t('app.notificationsTab.usesYourAccountEmail', 'Uses your account email')}
                        />
                        <span className="form-help">{t('app.notificationsTab.leaveEmptyToUseYourAccount', 'Leave empty to use your account email')}</span>
                    </div>
                </div>
            )}

            {userPrefs.channels?.includes('discord') && (
                <div {...register('notifications-discord-webhook', 'settings-card')}>
                    <h3>{t('app.notificationsTab.personalDiscordWebhook', 'Personal Discord webhook')}</h3>
                    <div className="form-group">
                        <Label>{t('app.notificationsTab.webhookUrl', 'Webhook URL')}</Label>
                        <Input
                            type="text"
                            value={userPrefs.discord_webhook || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, discord_webhook: e.target.value})}
                            placeholder="https://discord.com/api/webhooks/..."
                        />
                        <span className="form-help">{t('app.notificationsTab.createAWebhookInYourPersonal', 'Create a webhook in your personal server or DM channel.')}</span>
                    </div>
                </div>
            )}

            {userPrefs.channels?.includes('telegram') && (
                <div {...register('notifications-telegram', 'settings-card')}>
                    <h3>{t('app.notificationsTab.personalTelegram', 'Personal Telegram')}</h3>
                    <div className="form-group">
                        <Label>{t('app.notificationsTab.yourChatId', 'Your chat ID')}</Label>
                        <Input
                            type="text"
                            value={userPrefs.telegram_chat_id || ''}
                            onChange={(e) => setUserPrefs({...userPrefs, telegram_chat_id: e.target.value})}
                            placeholder={t('app.notificationsTab.yourPersonalChatId', 'Your personal chat ID')}
                        />
                        <span className="form-help">{t('app.notificationsTab.useUserinfobotToGetYourPersonal', 'Use @userinfobot to get your personal chat ID.')}</span>
                    </div>
                </div>
            )}

            <div {...register('notifications-severity', 'settings-card')}>
                <h3>{t('app.notificationsTab.severityLevels', 'Severity levels')}</h3>
                <p>{t('app.notificationsTab.whichAlertTypesDoYouWant', 'Which alert types do you want to receive?')}</p>
                <div className="severity-toggles">
                    {severityOptions.map(severity => (
                        <label key={severity} className="severity-toggle">
                            <Switch disabled={saving} aria-label={severity.charAt(0).toUpperCase() + severity.slice(1)}
                                checked={userPrefs.severities?.includes(severity)}
                                onCheckedChange={(checked) => {
                                    const severities = checked
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

            <div {...register('notifications-categories', 'settings-card')}>
                <h3>{t('app.notificationsTab.notificationCategories', 'Notification categories')}</h3>
                <p>{t('app.notificationsTab.whatTypesOfEventsShouldTrigger', 'What types of events should trigger notifications?')}</p>
                <div className="category-toggles">
                    {Object.entries({
                        system: 'System Alerts (CPU, Memory, Disk)',
                        security: 'Security Events',
                        backups: 'Backup Status',
                        apps: 'Application Events'
                    }).map(([key, label]) => (
                        <label key={key} className="category-toggle">
                            <Switch disabled={saving} aria-label={label}
                                checked={userPrefs.categories?.[key] !== false}
                                onCheckedChange={(checked) => setUserPrefs({
                                    ...userPrefs,
                                    categories: { ...userPrefs.categories, [key]: checked }
                                })}
                            />
                            <span>{label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <div {...register('notifications-quiet-hours', 'settings-card')}>
                <h3>{t('app.notificationsTab.quietHours', 'Quiet hours')}</h3>
                <p>{t('app.notificationsTab.pauseNonCriticalNotificationsDuringThese', 'Pause non-critical notifications during these hours')}</p>
                <div className="form-group">
                    <div className="settings-notification-option">
                        <Switch id="notifications-quiet-hours" disabled={saving}
                            checked={userPrefs.quiet_hours?.enabled}
                            onCheckedChange={(checked) => setUserPrefs({
                                ...userPrefs,
                                quiet_hours: { ...userPrefs.quiet_hours, enabled: checked }
                            })}
                        />
                        <Label htmlFor="notifications-quiet-hours">{t('app.notificationsTab.enableQuietHours', 'Enable quiet hours')}</Label>
                    </div>
                </div>
                {userPrefs.quiet_hours?.enabled && (
                    <div className="form-row">
                        <div className="form-group">
                            <Label>{t('app.notificationsTab.startTime', 'Start time')}</Label>
                            <Input
                                type="time"
                                value={userPrefs.quiet_hours?.start || '22:00'}
                                onChange={(e) => setUserPrefs({
                                    ...userPrefs,
                                    quiet_hours: { ...userPrefs.quiet_hours, start: e.target.value }
                                })}
                            />
                        </div>
                        <div className="form-group">
                            <Label>{t('app.notificationsTab.endTime', 'End time')}</Label>
                            <Input
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

            <div className="settings-actions settings-actions--footer">
                <Button
                    variant="outline"
                    onClick={handleTestUserNotification}
                    disabled={testing === 'user' || !userPrefs.enabled}
                >
                    {testing === 'user' ? t('app.notificationsTab.sending', 'Sending…') : t('app.notificationsTab.sendTestNotification', 'Send test notification')}
                </Button>
                <Button
                    variant="default"
                    onClick={handleSaveUserPrefs}
                    disabled={saving}
                >
                    {saving ? t('common.saving', 'Saving…') : t('app.notificationsTab.savePreferences', 'Save preferences')}
                </Button>
            </div>
        </div>
    );

    const channels = [
        { id: 'discord', name: 'Discord', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
        ), descriptionKey: 'app.notificationsTab.sendRichNotificationsToDiscordChannels', description: 'Send rich notifications to Discord channels via webhooks.' },
        { id: 'slack', name: 'Slack', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
            </svg>
        ), descriptionKey: 'app.notificationsTab.sendNotificationsToSlackChannelsVia', description: 'Send notifications to Slack channels via incoming webhooks.' },
        { id: 'telegram', name: 'Telegram', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
        ), descriptionKey: 'app.notificationsTab.sendNotificationsToTelegramChatsVia', description: 'Send notifications to Telegram chats via bot API.' },
        { id: 'email', name: 'Email', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
            </svg>
        ), descriptionKey: 'app.notificationsTab.sendEmailNotificationsWithHtmlTemplates', description: 'Send email notifications with HTML templates via SMTP.' },
        { id: 'generic_webhook', name: 'Generic Webhook', icon: (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
        ), descriptionKey: 'app.notificationsTab.sendJsonPayloadsToAnyWebhook', description: 'Send JSON payloads to any webhook endpoint.' }
    ];

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.notificationsTab.notificationSettings', 'Notification settings')}</h2>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <SegControl value={activeSection} onChange={(section) => { setActiveSection(section); setMessage(null); }}
                aria-label={t('notifications.scope', 'Notification settings scope')}
                options={[
                    { value: 'personal', label: t('app.notificationsTab.myPreferences', 'My preferences') },
                    ...(isAdmin ? [{ value: 'admin', label: t('notifications.deliverySettings', 'Delivery settings') }] : []),
                ]} />
            <p className="section-description">{activeSection === 'personal'
                ? t('notifications.personalHint', 'Control notifications for your account. Save preferences to apply your changes.')
                : t('notifications.deliveryHint', 'Configure shared destinations for server alerts. These settings affect everyone and are independent of personal preferences. Save a channel before sending a test.')}</p>

            {activeSection === 'personal' && userPrefsUI}

            {activeSection === 'admin' && isAdmin && (
            <div className="notification-channels">
                {channels.map(channel => (
                    <div key={channel.id} className={`notification-channel-card ${config[channel.id]?.enabled ? 'enabled' : ''}`}>
                        <div
                            className="channel-header"
                            role="button" tabIndex={0} aria-expanded={expandedChannel === channel.id}
                            aria-label={channel.name}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    setExpandedChannel(expandedChannel === channel.id ? null : channel.id);
                                }
                            }}
                            onClick={() => setExpandedChannel(expandedChannel === channel.id ? null : channel.id)}
                        >
                            <div className="channel-icon">{channel.icon}</div>
                            <div className="channel-info">
                                <h3>{channel.name}</h3>
                                <p>{channel.description}</p>
                            </div>
                            <div className="channel-status">
                                <Badge variant={config[channel.id]?.enabled ? 'success' : 'secondary'}>
                                    {config[channel.id]?.enabled ? t('app.notificationsTab.enabled', 'Enabled') : t('app.notificationsTab.disabled', 'Disabled')}
                                </Badge>
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
                                    <div className="settings-notification-option">
                                        <Switch id={`notification-${channel.id}-enabled`} disabled={saving}
                                            checked={config[channel.id]?.enabled || false}
                                            onCheckedChange={(checked) => updateChannelConfig(channel.id, 'enabled', checked)}
                                        />
                                        <Label htmlFor={`notification-${channel.id}-enabled`}>{t('common.actions.enable', 'Enable')} {channel.name}</Label>
                                    </div>
                                </div>

                                {channel.id === 'discord' && (
                                    <>
                                        <div className="form-group">
                                            <Label>{t('app.notificationsTab.webhookUrl', 'Webhook URL')}</Label>
                                            <Input
                                                type="text"
                                                value={config.discord.webhook_url || ''}
                                                onChange={(e) => updateChannelConfig('discord', 'webhook_url', e.target.value)}
                                                placeholder="https://discord.com/api/webhooks/..."
                                            />
                                            <span className="form-help">{t('app.notificationsTab.createAWebhookInDiscordServer', 'Create a webhook in Discord: Server Settings → Integrations → Webhooks.')}</span>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.botUsername', 'Bot username')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.discord.username || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('discord', 'username', e.target.value)}
                                                    placeholder={t('common.labels.serverKit', 'ServerKit')}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.avatarUrlOptional', 'Avatar URL (optional)')}</Label>
                                                <Input
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
                                            <Label>{t('app.notificationsTab.webhookUrl', 'Webhook URL')}</Label>
                                            <Input
                                                type="text"
                                                value={config.slack.webhook_url || ''}
                                                onChange={(e) => updateChannelConfig('slack', 'webhook_url', e.target.value)}
                                                placeholder="https://hooks.slack.com/services/..."
                                            />
                                            <span className="form-help">{t('app.notificationsTab.createAnIncomingWebhookInSlack', 'Create an incoming webhook in Slack: Apps → Incoming Webhooks.')}</span>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.channelOptional', 'Channel (optional)')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.slack.channel || ''}
                                                    onChange={(e) => updateChannelConfig('slack', 'channel', e.target.value)}
                                                    placeholder="#alerts"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label>{t('common.labels.username', 'Username')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.slack.username || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('slack', 'username', e.target.value)}
                                                    placeholder={t('common.labels.serverKit', 'ServerKit')}
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'telegram' && (
                                    <>
                                        <div className="form-group">
                                            <Label>{t('app.notificationsTab.botToken', 'Bot token')}</Label>
                                            <Input
                                                type="password"
                                                value={config.telegram.bot_token || ''}
                                                onChange={(e) => updateChannelConfig('telegram', 'bot_token', e.target.value)}
                                                placeholder="123456:ABC-DEF..."
                                            />
                                            <span className="form-help">{t('app.notificationsTab.getABotTokenFromBotfather', 'Get a bot token from @BotFather on Telegram.')}</span>
                                        </div>
                                        <div className="form-group">
                                            <Label>{t('app.notificationsTab.chatId', 'Chat ID')}</Label>
                                            <Input
                                                type="text"
                                                value={config.telegram.chat_id || ''}
                                                onChange={(e) => updateChannelConfig('telegram', 'chat_id', e.target.value)}
                                                placeholder="-1001234567890"
                                            />
                                            <span className="form-help">{t('app.notificationsTab.useUserinfobotOrGetidsbotToFind', 'Use @userinfobot or @getidsbot to find your chat ID.')}</span>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'email' && (
                                    <>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.smtpHost', 'SMTP host')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.email.smtp_host || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_host', e.target.value)}
                                                    placeholder="smtp.example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label htmlFor="notify-smtp-port">{t('app.notificationsTab.smtpPort', 'SMTP port')}</Label>
                                                <PortField
                                                    id="notify-smtp-port"
                                                    host={false}
                                                    allowPrivileged
                                                    value={config.email.smtp_port || ''}
                                                    onChange={(port) => updateChannelConfig('email', 'smtp_port', port === '' ? null : port)}
                                                    placeholder="587"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.smtpUsername', 'SMTP username')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.email.smtp_user || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_user', e.target.value)}
                                                    placeholder="user@example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.smtpPassword', 'SMTP password')}</Label>
                                                <Input
                                                    type="password"
                                                    value={config.email.smtp_password || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'smtp_password', e.target.value)}
                                                    placeholder="••••••••"
                                                />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.fromEmail', 'From email')}</Label>
                                                <Input
                                                    type="email"
                                                    value={config.email.from_email || ''}
                                                    onChange={(e) => updateChannelConfig('email', 'from_email', e.target.value)}
                                                    placeholder="alerts@example.com"
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label>{t('app.notificationsTab.fromName', 'From name')}</Label>
                                                <Input
                                                    type="text"
                                                    value={config.email.from_name || 'ServerKit'}
                                                    onChange={(e) => updateChannelConfig('email', 'from_name', e.target.value)}
                                                    placeholder={t('common.labels.serverKit', 'ServerKit')}
                                                />
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <Label>{t('app.notificationsTab.recipientEmailsCommaSeparated', 'Recipient emails (comma-separated)')}</Label>
                                            <Input
                                                type="text"
                                                value={(config.email.to_emails || []).join(', ')}
                                                onChange={(e) => updateChannelConfig('email', 'to_emails', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                                                placeholder={t('app.notificationsTab.adminExampleComTeamExampleCom', 'admin@example.com, team@example.com')}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <div className="settings-notification-option">
                                                <Switch disabled={saving} aria-label={t('app.notificationsTab.useTls', 'Use TLS')}
                                                    checked={config.email.smtp_tls !== false}
                                                    onCheckedChange={(checked) => updateChannelConfig('email', 'smtp_tls', checked)}
                                                />
                                                <Label>{t('app.notificationsTab.useTls', 'Use TLS')}</Label>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {channel.id === 'generic_webhook' && (
                                    <div className="form-group">
                                        <Label>{t('app.notificationsTab.webhookUrl', 'Webhook URL')}</Label>
                                        <Input
                                            type="text"
                                            value={config.generic_webhook.url || ''}
                                            onChange={(e) => updateChannelConfig('generic_webhook', 'url', e.target.value)}
                                            placeholder="https://your-endpoint.com/webhook"
                                        />
                                        <span className="form-help">{t('app.notificationsTab.receivesJsonPayloadWithAlertData', 'Receives JSON payload with alert data')}</span>
                                    </div>
                                )}

                                <div className="form-group">
                                    <Label>{t('app.notificationsTab.alertSeverities', 'Alert severities')}</Label>
                                    <div className="severity-toggles">
                                        {severityOptions.map(severity => (
                                            <label key={severity} className="severity-toggle">
                                                <Switch disabled={saving} aria-label={severity.charAt(0).toUpperCase() + severity.slice(1)}
                                                    checked={config[channel.id]?.notify_on?.includes(severity) || false}
                                                    onCheckedChange={() => toggleSeverity(channel.id, severity)}
                                                />
                                                <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div className="channel-actions">
                                    <Button
                                        variant="outline"
                                        onClick={() => handleTestChannel(channel.id)}
                                        disabled={testing === channel.id || !config[channel.id]?.enabled}
                                    >
                                        {testing === channel.id ? t('app.notificationsTab.testing', 'Testing…') : t('app.notificationsTab.sendTest', 'Send test')}
                                    </Button>
                                    <Button
                                        variant="default"
                                        onClick={() => handleSaveChannel(channel.id)}
                                        disabled={saving}
                                    >
                                        {saving ? t('common.saving', 'Saving…') : t('common.actions.save', 'Save')}
                                    </Button>
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

export default NotificationsTab;
