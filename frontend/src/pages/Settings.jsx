import { useState, useEffect } from 'react';
import useTabParam from '../hooks/useTabParam';
import { refreshDevMode } from '../hooks/useDevMode';
import { useAuth } from '../contexts/useAuth.js';
import api from '../services/api';
import ProfileTab from '../components/settings/ProfileTab';
import SecuritySettingsTab from '../components/settings/SecuritySettingsTab';
import AppearanceTab from '../components/settings/AppearanceTab';
import SidebarSettings from '../components/settings/SidebarSettings';
import WhiteLabelTab from '../components/settings/WhiteLabelTab';
import NotificationsTab from '../components/settings/NotificationsTab';
import SystemTab from '../components/settings/SystemTab';
import UsersTab from '../components/settings/UsersTab';
import RecycleBinTab from '../components/settings/RecycleBinTab';
import ActivityTab from '../components/settings/ActivityTab';
import SiteSettingsTab from '../components/settings/SiteSettingsTab';
import SSOConfigTab from '../components/settings/SSOConfigTab';
import ConnectionsHub from '../components/settings/connections/ConnectionsHub';
import ApiSettingsTab from '../components/settings/ApiSettingsTab';
import MigrationHistoryTab from '../components/settings/MigrationHistoryTab';
import IconReferenceTab from '../components/settings/IconReferenceTab';
import AISettingsTab from '../components/settings/AISettingsTab';
import WebhooksTab from '../components/settings/WebhooksTab';
import AboutTab from '../components/settings/AboutTab';
import CloudTab from '../components/settings/CloudTab';
import StorageTab from '../components/settings/StorageTab';
import PluginSlot from '../components/PluginSlot';
import { Activity, CloudCog, Code, Database, HardDrive, Layers, Link2, PaintBucket, Sparkles, Trash2, Webhook, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegControl } from '@/components/ds';
import PageLayout from '../layouts/PageLayout';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const VALID_TABS = ['profile', 'security', 'connections', 'cloud', 'appearance', 'sidebar', 'whitelabel', 'notifications', 'system', 'users', 'activity', 'site', 'sso', 'api', 'webhooks', 'ai', 'migrations', 'recyclebin', 'storage', 'developer', 'about'];

// Tabs that belong to the server-wide "Administration" group (admin-only); the
// rest are personal "My Account" settings. Drives the two-way section switch so
// personal prefs aren't interleaved with destructive system controls.
const ADMIN_TABS = ['users', 'activity', 'site', 'connections', 'cloud', 'sso', 'api', 'webhooks', 'ai', 'migrations', 'recyclebin', 'storage', 'system', 'developer'];

const Settings = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useTabParam('/settings', VALID_TABS);
    const { isAdmin } = useAuth();
    const [devMode, setDevMode] = useState(false);
    // Whether the dev-mode answer is in (success or failure), so a direct
    // link to /settings/developer waits for it before deciding.
    const [devModeKnown, setDevModeKnown] = useState(false);
    const navigate = useNavigate();
    const { tab: requestedTab } = useParams();

    // Which top-level settings group is showing. Derived from the active tab so
    // deep links (e.g. /settings/users) open the right group; non-admins only
    // ever see "My Account", so any admin tab collapses back to it for them.
    useEffect(() => {
        if (requestedTab === 'modules') navigate('/marketplace', { replace: true });
    }, [requestedTab, navigate]);

    const activeGroup = isAdmin && ADMIN_TABS.includes(activeTab) ? 'admin' : 'account';

    useEffect(() => {
        if (isAdmin) {
            api.getSystemSettings().then(data => {
                setDevMode(data.dev_mode || false);
            }).catch(() => {}).finally(() => setDevModeKnown(true));
        }
    }, [isAdmin]);

    // A tab this user can't open rendered an empty content area on a direct
    // link. Send it to Profile instead: admin tabs for non-admins, and the
    // developer tab once dev mode is known to be off.
    const tabUnavailable = (!isAdmin && ADMIN_TABS.includes(activeTab))
        || (activeTab === 'developer' && isAdmin && devModeKnown && !devMode);
    useEffect(() => {
        if (tabUnavailable) navigate('/settings/profile', { replace: true });
    }, [tabUnavailable, navigate]);

    return (
        <PageLayout
            icon={<SettingsIcon size={18} />}
            title={t('common.labels.settings', 'Settings')}
            className="settings-page"
        >
            <div className="settings-layout">
                <nav className="settings-nav">
                    {isAdmin && (
                        <SegControl
                            className="settings-nav-groups"
                            aria-label={t('app.settings.settingsSection', 'Settings section')}
                            options={[
                                { value: 'account', labelKey: 'app.settings.myAccount', label: 'My Account' },
                                { value: 'admin', labelKey: 'app.settings.admin', label: 'Admin' },
                            ]}
                            value={activeGroup}
                            onChange={(group) => setActiveTab(group === 'admin' ? 'users' : 'profile')}
                        />
                    )}
                    {activeGroup === 'account' && (
                        <>
                    <Button
                        variant="ghost"
                        className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
                        onClick={() => setActiveTab('profile')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        {t('app.settings.profile', 'Profile')}
                    </Button>
                    <Button
                        variant="ghost"
                        className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
                        onClick={() => setActiveTab('security')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        {t('common.labels.security', 'Security')}
                    </Button>
                    <Button
                        variant="ghost"
                        className={`settings-nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
                        onClick={() => setActiveTab('notifications')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        {t('app.settings.notifications', 'Notifications')}
                    </Button>
                    <div className="settings-nav-divider">{t('app.settings.preferences', 'Preferences')}</div>
                    <Button
                        variant="ghost"
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
                        {t('app.settings.appearance', 'Appearance')}
                    </Button>
                    <Button
                        variant="ghost"
                        className={`settings-nav-item ${activeTab === 'sidebar' ? 'active' : ''}`}
                        onClick={() => setActiveTab('sidebar')}
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="9" y1="3" x2="9" y2="21"/>
                        </svg>
                        {t('app.settings.sidebar', 'Sidebar')}
                    </Button>
                    <Button
                        variant="ghost"
                        className={`settings-nav-item ${activeTab === 'whitelabel' ? 'active' : ''}`}
                        onClick={() => setActiveTab('whitelabel')}
                    >
                        <Layers size={18} />
                        {t('app.settings.whiteLabel', 'White Label')}
                    </Button>
                            {import.meta.env.DEV && !devMode && !isAdmin && (
                                <>
                                    <div className="settings-nav-divider">{t('app.settings.localDev', 'Local Dev')}</div>
                                    <Button
                                        variant="ghost"
                                        className="settings-nav-item"
                                        onClick={() => navigate('/style-guide')}
                                    >
                                        <PaintBucket size={18} />
                                        {t('app.settings.styleGuide', 'Style Guide')}
                                    </Button>
                                </>
                            )}
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
                                onClick={() => setActiveTab('about')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="16" x2="12" y2="12"/>
                                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                                </svg>
                                {t('app.settings.about', 'About')}
                            </Button>
                        </>
                    )}
                    {activeGroup === 'admin' && isAdmin && (
                        <>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'users' ? 'active' : ''}`}
                                onClick={() => setActiveTab('users')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                                    <circle cx="9" cy="7" r="4"/>
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                                </svg>
                                {t('app.settings.users', 'Users')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'activity' ? 'active' : ''}`}
                                onClick={() => setActiveTab('activity')}
                            >
                                <Activity size={18} />
                                {t('app.settings.activity', 'Activity')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'recyclebin' ? 'active' : ''}`}
                                onClick={() => setActiveTab('recyclebin')}
                            >
                                <Trash2 size={18} />
                                {t('app.settings.recycleBin', 'Recycle bin')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'site' ? 'active' : ''}`}
                                onClick={() => setActiveTab('site')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <circle cx="12" cy="12" r="3"/>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                </svg>
                                {t('app.settings.siteSettings', 'Site Settings')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'connections' ? 'active' : ''}`}
                                onClick={() => setActiveTab('connections')}
                            >
                                <Link2 size={18} />
                                {t('app.settings.connections', 'Connections')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'cloud' ? 'active' : ''}`}
                                onClick={() => setActiveTab('cloud')}
                            >
                                <CloudCog size={18} />
                                {t('app.settings.serverkitCloud', 'ServerKit Cloud')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'sso' ? 'active' : ''}`}
                                onClick={() => setActiveTab('sso')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                                    <polyline points="10 17 15 12 10 7"/>
                                    <line x1="15" y1="12" x2="3" y2="12"/>
                                </svg>
                                SSO
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'api' ? 'active' : ''}`}
                                onClick={() => setActiveTab('api')}
                            >
                                <Code size={18} />
                                API
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'webhooks' ? 'active' : ''}`}
                                onClick={() => setActiveTab('webhooks')}
                            >
                                <Webhook size={18} />
                                {t('app.settings.webhooks', 'Webhooks')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'ai' ? 'active' : ''}`}
                                onClick={() => setActiveTab('ai')}
                            >
                                <Sparkles size={18} />
                                {t('app.settings.aiAssistant', 'AI Assistant')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'migrations' ? 'active' : ''}`}
                                onClick={() => setActiveTab('migrations')}
                            >
                                <Database size={18} />
                                {t('app.settings.migrations', 'Migrations')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'storage' ? 'active' : ''}`}
                                onClick={() => setActiveTab('storage')}
                            >
                                <HardDrive size={18} />
                                {t('app.settings.storage', 'Storage')}
                            </Button>
                            <Button
                                variant="ghost"
                                className={`settings-nav-item ${activeTab === 'system' ? 'active' : ''}`}
                                onClick={() => setActiveTab('system')}
                            >
                                <svg viewBox="0 0 24 24" width="18" height="18">
                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                                    <line x1="8" y1="21" x2="16" y2="21"/>
                                    <line x1="12" y1="17" x2="12" y2="21"/>
                                </svg>
                                {t('app.settings.systemInfo', 'System Info')}
                            </Button>
                            {(devMode || import.meta.env.DEV) && (
                                <>
                                    <div className="settings-nav-divider">{devMode ? 'Developer' : 'Local Dev'}</div>
                                    {devMode && (
                                        <Button
                                            variant="ghost"
                                            className={`settings-nav-item ${activeTab === 'developer' ? 'active' : ''}`}
                                            onClick={() => setActiveTab('developer')}
                                        >
                                            <Code size={18} />
                                            {t('app.settings.iconReference', 'Icon Reference')}
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        className="settings-nav-item"
                                        onClick={() => navigate('/style-guide')}
                                    >
                                        <PaintBucket size={18} />
                                        {t('app.settings.styleGuide', 'Style Guide')}
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                </nav>

                <div className="settings-content">
                    {activeTab === 'profile' && <ProfileTab />}
                    {activeTab === 'security' && <SecuritySettingsTab />}
                    {activeTab === 'connections' && isAdmin && <ConnectionsHub />}
                    {activeTab === 'cloud' && isAdmin && <CloudTab />}
                    {activeTab === 'appearance' && <AppearanceTab />}
                    {activeTab === 'sidebar' && <SidebarSettings />}
                    {activeTab === 'whitelabel' && <WhiteLabelTab />}
                    {activeTab === 'notifications' && <NotificationsTab />}
                    {activeTab === 'users' && isAdmin && <UsersTab />}
                    {activeTab === 'activity' && isAdmin && <ActivityTab />}
                    {activeTab === 'recyclebin' && isAdmin && <RecycleBinTab />}
                    {activeTab === 'site' && isAdmin && (
                        <SiteSettingsTab
                            onDevModeChange={(v) => { setDevMode(v); refreshDevMode(); }}
                        />
                    )}
                    {activeTab === 'sso' && isAdmin && <SSOConfigTab />}
                    {activeTab === 'api' && isAdmin && <ApiSettingsTab />}
                    {activeTab === 'webhooks' && isAdmin && <WebhooksTab />}
                    {activeTab === 'ai' && isAdmin && <AISettingsTab />}
                    {activeTab === 'migrations' && isAdmin && <MigrationHistoryTab />}
                    {activeTab === 'storage' && isAdmin && <StorageTab />}
                    {activeTab === 'system' && isAdmin && <SystemTab />}
                    {activeTab === 'developer' && devMode && isAdmin && <IconReferenceTab />}
                    {activeTab === 'about' && <AboutTab />}
                    {/* Extension-contributed settings sections (#52): widgets
                        targeting the settings.section slot render below the
                        active tab's content; the tab id comes down as context
                        so a widget can scope itself to specific tabs. */}
                    <PluginSlot name="settings.section" context={{ tab: activeTab }} />
                </div>
            </div>
        </PageLayout>
    );
};

export default Settings;
