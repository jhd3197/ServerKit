import { serverStatusKind } from '../components/serverdetail/serverDetailData';
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { useRecordVisit } from '@/hooks/useRecordVisit';
import FavoriteStar from '@/components/FavoriteStar';
import { Button } from '@/components/ui/button';
import { Pill } from '../components/ds';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import PackagesTab from '../components/serverdetail/PackagesTab';
import ServicesTab from '../components/serverdetail/ServicesTab';
import ServerOverviewTab from '../components/serverdetail/ServerOverviewTab';
import AlertsTab from '../components/serverdetail/AlertsTab';
import ServerDockerTab from '../components/serverdetail/ServerDockerTab';
import CronTab from '../components/serverdetail/CronTab';
import CloudflaredTab from '../components/serverdetail/CloudflaredTab';
import ServerMetricsTab from '../components/serverdetail/ServerMetricsTab';
import SurveyTab from '../components/serverdetail/SurveyTab';
import ServerSettingsTab, { TokenModal } from '../components/serverdetail/ServerSettingsTab';
import {
    CopyChip,
    FolderTinyIcon,
    RefreshIcon,
} from '../components/serverdetail/serverDetailShared';
import ProxyStackPanel from '../components/proxy/ProxyStackPanel';
import RemoteAccess from '../pages/RemoteAccess';
import EmptyState from '../components/EmptyState';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/useAuth.js';
import ServerRestorePointsTab from '../components/serverdetail/ServerRestorePointsTab';
import { toastError } from '@/utils/errorMessage';

// Live host metrics cadence while the server is online.
const METRICS_POLL_MS = 10000;

const ServerDetail = () => {
    const { t } = useTranslation();
    const { id, tab } = useParams();
    const navigate = useNavigate();
    const { isDeveloper } = useAuth();
    const { confirm } = useConfirm();
    const [server, setServer] = useState(null);
    useRecordVisit(server && {
        type: 'server', id: server.id, path: `/servers/${server.id}`, label: server.name,
    });
    const [metrics, setMetrics] = useState(null);
    const [systemInfo, setSystemInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showTokenModal, setShowTokenModal] = useState(false);
    const [securityAlerts, setSecurityAlerts] = useState([]);
    const toast = useToast();

    const validTabs = [
        'overview',
        ...(isDeveloper ? ['restore-points'] : []),
        'docker',
        'proxy',
        'cron',
        'cloudflared',
        'packages',
        'services',
        'survey',
        'metrics',
        'alerts',
        'remote-access',
        'settings',
    ];
    const activeTab = validTabs.includes(tab) ? tab : 'overview';

    const loadServer = useCallback(async () => {
        try {
            const data = await api.getServer(id);
            setServer(data);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    const loadMetrics = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemMetrics(id);
            // Endpoint returns the metrics payload directly, not a {success,data} envelope.
            if (data) setMetrics(data);
        } catch (err) {
            console.error('Failed to load metrics:', err);
        }
    }, [id, server]);

    const loadSystemInfo = useCallback(async () => {
        if (!server || server.status !== 'online') return;
        try {
            const data = await api.getRemoteSystemInfo(id);
            if (data) setSystemInfo(data);
        } catch (err) {
            console.error('Failed to load system info:', err);
        }
    }, [id, server]);

    useEffect(() => {
        loadServer();
    }, [loadServer]);

    useEffect(() => {
        if (tab === 'restore-points' && !isDeveloper) {
            navigate(`/servers/${id}`, { replace: true });
        }
    }, [id, isDeveloper, navigate, tab]);

    const loadSecurityAlerts = useCallback(async () => {
        try {
            const data = await api.getServerSecurityAlerts(id, { status: 'open', limit: 25 });
            setSecurityAlerts(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load security alerts:', err);
        }
    }, [id]);

    useEffect(() => {
        loadSecurityAlerts();
    }, [loadSecurityAlerts]);

    async function handleAcknowledgeAlert(alertId) {
        try {
            await api.acknowledgeAlert(alertId);
            setSecurityAlerts(prev => prev.map(a =>
                a.id === alertId ? { ...a, status: 'acknowledged' } : a
            ));
        } catch (err) {
            toastError(toast, t('app.serverDetail.failedToAcknowledgeAlert', "Couldn't acknowledge the alert."), err);
        }
    }

    async function handleResolveAlert(alertId) {
        try {
            await api.resolveAlert(alertId);
            setSecurityAlerts(prev => prev.filter(a => a.id !== alertId));
        } catch (err) {
            toastError(toast, t('app.serverDetail.failedToResolveAlert', "Couldn't resolve the alert."), err);
        }
    }

    useEffect(() => {
        if (server?.status !== 'online') return;
        loadMetrics();
        loadSystemInfo();
    }, [server, loadMetrics, loadSystemInfo]);

    usePolling(loadMetrics, METRICS_POLL_MS, {
        enabled: server?.status === 'online',
        immediate: false,
    });

    async function handleDeleteServer() {
        const confirmed = await confirm({ title: t('app.serverDetail.removeServer', 'Remove server'), message: t('app.serverDetail.areYouSureYouWantTo', "Remove this server? This can't be undone.") });
        if (!confirmed) return;

        try {
            await api.deleteServer(id);
            toast.success(t('app.serverDetail.serverRemovedSuccessfully', 'Server removed'));
            navigate('/servers');
        } catch (err) {
            toastError(toast, t('app.serverDetail.failedToRemoveServer', "Couldn't remove the server."), err);
        }
    }

    async function handlePingServer() {
        try {
            const result = await api.pingServer(id);
            if (result.success) {
                toast.success(t('app.serverDetail.serverRespondedInMs', 'Server responded in {{latency}}ms', { latency: result.latency }));
                loadServer();
            } else {
                toast.error(t('app.serverDetail.serverDidNotRespond', 'Server did not respond'));
            }
        } catch (err) {
            toastError(toast, t('app.serverDetail.failedToPingServer', "Couldn't ping the server."), err);
        }
    }

    // Both the inline "Generate Token" header button and the SettingsTab
    // regenerate button funnel through the same modal — the modal owns the
    // expiry picker and the connection-string display, so the header path
    // doesn't need its own confirm dialog. Reaching the modal effectively
    // *is* the confirmation: the actual token mint happens when the user
    // clicks "Generate" inside it.
    async function handleOpenTokenModal() {
        setShowTokenModal(true);
    }

    function handleTokenGenerated(result) {
        // Mirror the new token onto the in-memory server so the existing
        // AgentRegistrationSection (rendered in SettingsTab) reflects it
        // without a full reload.
        setServer(prev => ({
            ...prev,
            registration_token: result.registration_token,
            registration_expires: result.registration_expires,
            connection_string: result.connection_string,
        }));
    }

    if (loading) {
        return <EmptyState loading loadingVariant="detail" title={t('app.serverDetail.loadingServerDetails', 'Loading server details')} />;
    }

    if (error) {
        return (
            <div className="error-page">
                <h2>{t('app.serverDetail.errorLoadingServer', "Couldn't load the server.")}</h2>
                <p>{error}</p>
                <Button asChild><Link to="/servers">{t('app.serverDetail.backToServers', 'Back to servers')}</Link></Button>
            </div>
        );
    }

    if (!server) {
        return (
            <div className="error-page">
                <h2>{t('app.serverDetail.serverNotFound', 'Server not found')}</h2>
                <p>{t('app.serverDetail.theRequestedServerCouldNotBe', 'The requested server could not be found.')}</p>
                <Button asChild><Link to="/servers">{t('app.serverDetail.backToServers', 'Back to servers')}</Link></Button>
            </div>
        );
    }

    // Aggregate any "you should know about this" alerts into a single
    // Alerts tab. Today only the polling-transport fallback shows up as
    // a system notification, but this is the place to add future
    // advisories (stale agent, missing capabilities, expiring tokens,
    // etc.). Security alerts (raised by the security service) are
    // surfaced alongside them so there's only one place to look.
    const systemNotifications = [];
    if (server.transport === 'poll') {
        systemNotifications.push({
            id: 'limited-mode',
            severity: 'warning',
            titleKey: 'app.serverDetail.limitedMode', title: 'Limited mode',
            messageKey: 'app.serverDetail.thisAgentConnectedViaTheRest', message: 'This agent connected via the REST polling fallback because the WebSocket link could not be established cleanly. Heartbeats and one-shot commands work; live logs, real-time metrics, and terminal sessions are unavailable until the WS link is restored.',
        });
    }
    const openSecurityAlerts = securityAlerts.filter(a => a.status === 'open');
    const totalAlertCount = systemNotifications.length + openSecurityAlerts.length;

    // Show the cron tab only when the agent reported the capability.
    // Older agents (pre-1.6.16) and Windows hosts won't have it set —
    // hiding the tab matches the rest of the panel's "don't expose what
    // the host can't do" behaviour.
    const tabs = [
        { id: 'overview', label: t('common.labels.overview', 'Overview') },
        ...(isDeveloper ? [{ id: 'restore-points', label: t('app.serverDetail.restorePoints', 'Restore points') }] : []),
        { id: 'docker', label: t('common.labels.docker', 'Docker') },
        { id: 'proxy', label: t('app.serverDetail.proxy', 'Proxy') },
        ...(server.capabilities?.cron ? [{ id: 'cron', label: t('app.serverDetail.cron', 'Cron') }] : []),
        ...(server.capabilities?.cloudflared ? [{ id: 'cloudflared', label: t('app.serverDetail.tunnels', 'Tunnels') }] : []),
        ...(server.capabilities?.packages ? [{ id: 'packages', label: t('app.serverDetail.packages', 'Packages') }] : []),
        ...(server.capabilities?.systemd ? [{ id: 'services', label: t('common.labels.services', 'Services') }] : []),
        ...(server.capabilities?.survey ? [{ id: 'survey', label: t('app.serverDetail.survey', 'Survey') }] : []),
        { id: 'metrics', label: t('app.serverDetail.metrics', 'Metrics') },
        ...(totalAlertCount > 0
            ? [{ id: 'alerts', label: t('app.serverDetail.alerts', 'Alerts'), badge: totalAlertCount }]
            : [{ id: 'alerts', label: t('app.serverDetail.alerts', 'Alerts') }]),
        ...(server.capabilities?.wireguard ? [{ id: 'remote-access', label: t('app.serverDetail.remoteAccess', 'Remote access') }] : []),
        { id: 'settings', label: t('common.labels.settings', 'Settings') }
    ];

    return (
        <div className="page-container server-detail-page">
            <div className="page-breadcrumb">
                <Link to="/servers">{t('common.labels.servers', 'Servers')}</Link>
                <span className="breadcrumb-separator">/</span>
                <span>{server.name}</span>
            </div>

            <header className="server-detail-header">
                <div className="server-detail-header__main">
                    <div className={`server-detail-header__avatar server-detail-header__avatar--${server.status || 'pending'}`}>
                        {(server.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="server-detail-header__identity">
                        <div className="server-detail-header__title-row">
                            <h1>{server.name}</h1>
                            <FavoriteStar type="server" id={server.id} path={`/servers/${server.id}`} label={server.name} />
                            <Pill kind={serverStatusKind(server.status)}>
                                {server.status || 'pending'}
                            </Pill>
                            <CopyChip
                                label="id"
                                value={server.id}
                                title={t('app.serverDetail.copyServerId', 'Copy server ID')}
                                mono
                            />
                        </div>
                        <div className="server-detail-header__meta">
                            <span className="server-detail-header__meta-item">
                                {server.hostname || server.ip_address || 'No endpoint configured'}
                            </span>
                            {server.group_name && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item"><FolderTinyIcon /> {server.group_name}</span>
                                </>
                            )}
                            {server.os_type && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">{server.os_type}</span>
                                </>
                            )}
                            {server.agent_version && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">agent {server.agent_version}</span>
                                </>
                            )}
                            {server.last_seen && (
                                <>
                                    <span className="dotsep">·</span>
                                    <span className="server-detail-header__meta-item">
                                        {t('app.serverDetail.lastSeen', 'last seen')} {new Date(server.last_seen).toLocaleString()}
                                    </span>
                                </>
                            )}
                        </div>
                        {server.description && (
                            <p className="server-detail-header__description">{server.description}</p>
                        )}
                    </div>
                </div>
                <div className="server-detail-header__actions">
                    <Button variant="outline" size="sm" onClick={handlePingServer}>
                        <RefreshIcon /> {t('app.serverDetail.ping', 'Ping')}
                    </Button>
                </div>
            </header>

            <Tabs
                value={activeTab}
                onValueChange={(value) =>
                    navigate(value === 'overview' ? `/servers/${id}` : `/servers/${id}/${value}`, { replace: true })
                }
            >
                <TabsList>
                    {tabs.map((item) => (
                        <TabsTrigger key={item.id} value={item.id}>
                            {item.label}
                            {item.badge ? <span className="tab-badge">{item.badge}</span> : null}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <div className="server-detail-content">
                    <TabsContent value="overview">
                        <ServerOverviewTab
                            server={server}
                            metrics={metrics}
                            systemInfo={systemInfo}
                            onRefreshServer={loadServer}
                        />
                    </TabsContent>
                    {isDeveloper && (
                        <TabsContent value="restore-points">
                            <ServerRestorePointsTab serverId={id} />
                        </TabsContent>
                    )}
                    <TabsContent value="docker">
                        <ServerDockerTab serverId={id} serverStatus={server.status} server={server} />
                    </TabsContent>
                    <TabsContent value="proxy">
                        <ProxyStackPanel serverId={id} />
                    </TabsContent>
                    {server.capabilities?.cron && (
                        <TabsContent value="cron">
                            <CronTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.cloudflared && (
                        <TabsContent value="cloudflared">
                            <CloudflaredTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.packages && (
                        <TabsContent value="packages">
                            <PackagesTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.systemd && (
                        <TabsContent value="services">
                            <ServicesTab serverId={id} serverStatus={server.status} />
                        </TabsContent>
                    )}
                    {server.capabilities?.survey && (
                        <TabsContent value="survey">
                            <SurveyTab serverId={id} serverStatus={server.status} server={server} />
                        </TabsContent>
                    )}
                    <TabsContent value="metrics">
                        <ServerMetricsTab serverId={id} metrics={metrics} />
                    </TabsContent>
                    <TabsContent value="alerts">
                        <AlertsTab
                            notifications={systemNotifications}
                            securityAlerts={securityAlerts}
                            onAcknowledge={handleAcknowledgeAlert}
                            onResolve={handleResolveAlert}
                        />
                    </TabsContent>
                    <TabsContent value="remote-access">
                        <RemoteAccess serverId={id} />
                    </TabsContent>
                    <TabsContent value="settings">
                        <ServerSettingsTab
                            server={server}
                            onUpdate={loadServer}
                            onRegenerateToken={handleOpenTokenModal}
                            onDelete={handleDeleteServer}
                        />
                    </TabsContent>
                </div>
            </Tabs>

            {showTokenModal && server && (
                <TokenModal
                    server={server}
                    onClose={() => setShowTokenModal(false)}
                    onGenerated={handleTokenGenerated}
                />
            )}
        </div>
    );
};

export default ServerDetail;
