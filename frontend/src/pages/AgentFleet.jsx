import { useCallback, useState, useEffect  } from 'react';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import {
    Shield,
    Activity,
    RefreshCw,
    CheckCircle,
    AlertCircle,
    Clock,
    Zap,
    Search,
    Server,
    Package,
    Play,
    XCircle,
    Wifi,
    WifiOff,
    RotateCcw
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCard, KpiBand, Pill, Gauge, DataTable, DataTableFooter, statusKind } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// The backend sends None for rates it can't compute yet (no commands run).
const formatPercent = (value, digits) => {
    if (!isNumber(value)) return '—';
    return `${digits == null ? value : value.toFixed(digits)}%`;
};
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';
import { toastError } from '@/utils/errorMessage';

const AgentFleet = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState('dashboard');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [health, setHealth] = useState(null);
    const [versions, setVersions] = useState([]);
    const [discoveredAgents, setDiscoveredAgents] = useState([]);
    const [pendingServers, setPendingServers] = useState([]);
    const [rollouts, setRollouts] = useState([]);
    const [queuedCommands, setQueuedCommands] = useState([]);
    const [diagnostics, setDiagnostics] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [rolloutStrategy, setRolloutStrategy] = useState('all');
    const [rolloutBatchSize, setRolloutBatchSize] = useState(5);
    const [rolloutDelay, setRolloutDelay] = useState(10);
    const toast = useToast();


    const fetchData = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            if (activeTab === 'dashboard') {
                const data = await api.getFleetHealth();
                setHealth(data);
            } else if (activeTab === 'versions') {
                const data = await api.getAgentVersions();
                setVersions(data);
            } else if (activeTab === 'rollouts') {
                const [rolloutData, versionData] = await Promise.all([
                    api.getRollouts(),
                    api.getAgentVersions()
                ]);
                setRollouts(rolloutData);
                setVersions(versionData);
                if (versionData.length > 0) {
                    setSelectedVersion(current => current || versionData[0].id);
                }
            } else if (activeTab === 'discovery') {
                const data = await api.getDiscoveredAgents();
                setDiscoveredAgents(data);
            } else if (activeTab === 'approvals') {
                const data = await api.getServers();
                setPendingServers((data.servers || data).filter(s => s.status === 'pending'));
            } else if (activeTab === 'queue') {
                const data = await api.getQueuedCommands();
                setQueuedCommands(data);
            }
        } catch (error) {
            // Rendered in the tab's content area (with Retry), not as a toast
            // that leaves the tab blank once it fades.
            setLoadError(error);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Publish the Refresh button to the shared tab-group top bar; re-registers
    // on `loading` so the spinner/disabled state stays in sync.
    useTopbarActions(() =>
        <Button size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'fleet-refresh-spinner' : ''} />
            {t('common.actions.refresh', 'Refresh')}
        </Button>,
        [loading]
    );


    const startDiscovery = async () => {
        setIsScanning(true);
        try {
            toast.info(t('app.agentFleet.scanningNetworkForAgents', 'Scanning network for agents…'));
            await api.startDiscovery(10);
            const data = await api.getDiscoveredAgents();
            setDiscoveredAgents(data);
            toast.success(t('app.agentFleet.discoveredAgents', 'Discovered {{length}} agents', { length: data.length }));
        } catch (err) {
            toastError(toast, t('app.agentFleet.discoveryScanFailed', "Couldn't run the discovery scan."), err);
        } finally {
            setIsScanning(false);
        }
    };

    const approveAgent = async (serverId) => {
        try {
            await api.approveRegistration(serverId);
            toast.success(t('app.agentFleet.agentRegistrationApproved', 'Agent registration approved'));
            fetchData();
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToApproveAgent', "Couldn't approve the agent."), err);
        }
    };

    const rejectAgent = async (serverId) => {
        try {
            await api.rejectRegistration(serverId);
            toast.success(t('app.agentFleet.agentRegistrationRejected', 'Agent registration rejected'));
            fetchData();
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToRejectAgent', "Couldn't reject the agent."), err);
        }
    };

    const triggerUpgrade = async () => {
        if (!selectedVersion) {
            toast.error(t('app.agentFleet.selectATargetVersion', 'Select a target version'));
            return;
        }

        try {
            if (rolloutStrategy === 'all') {
                await api.upgradeFleet([], selectedVersion);
                toast.success(t('app.agentFleet.upgradeTriggeredForAllOnlineAgents', 'Upgrade triggered for all online agents'));
            } else {
                const data = {
                    version_id: selectedVersion,
                    strategy: rolloutStrategy,
                    batch_size: rolloutStrategy === 'canary' ? 1 : rolloutBatchSize,
                    delay_minutes: rolloutDelay
                };
                await api.startRollout(data);
                toast.success(t('app.agentFleet.stagedRolloutStarted', 'Staged rollout started'));
            }
            fetchData();
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToTriggerUpgrade', "Couldn't start the upgrade."), err);
        }
    };

    const cancelRollout = async (rolloutId) => {
        try {
            await api.cancelRollout(rolloutId);
            toast.success(t('app.agentFleet.rolloutCancelled', 'Rollout cancelled'));
            fetchData();
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToCancelRollout', "Couldn't cancel the rollout."), err);
        }
    };

    const retryCommand = async (commandId) => {
        try {
            await api.retryCommand(commandId);
            toast.success(t('app.agentFleet.commandRetryTriggered', 'Command retry triggered'));
            fetchData();
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToRetryCommand', "Couldn't retry the command."), err);
        }
    };

    const loadDiagnostics = async (serverId) => {
        try {
            const data = await api.getServerDiagnostics(serverId);
            setDiagnostics(data);
        } catch (err) {
            toastError(toast, t('app.agentFleet.failedToLoadDiagnostics', "Couldn't load diagnostics."), err);
        }
    };

    // Columns for the shared DataTable. Cell markup and classNames are
    // identical to the hand-rolled tables they replace. No in-page toolbar
    // rows on this page (Refresh lives in the shared top bar), so each table
    // runs uncontrolled with a storageKey instead of SortMenu/ColumnsMenu.
    const versionColumns = [
        {
            key: 'version',
            headerKey: 'common.labels.version', header: 'Version',
            sortable: true,
            hideable: false,
            sortValue: (v) => v.version || '',
            cellClassName: 'fleet-value',
            render: (v) => `v${v.version}`,
        },
        {
            key: 'channel',
            headerKey: 'app.agentFleet.channel', header: 'Channel',
            sortable: true,
            sortValue: (v) => v.channel || '',
            render: (v) => (
                <Pill kind={v.channel === 'stable' ? 'green' : 'amber'}>{v.channel}</Pill>
            ),
        },
        {
            key: 'published',
            headerKey: 'app.agentFleet.published', header: 'Published',
            sortable: true,
            sortValue: (v) => (v.published_at ? new Date(v.published_at).getTime() : null),
            render: (v) => new Date(v.published_at).toLocaleDateString(),
        },
        {
            key: 'compat',
            headerKey: 'app.agentFleet.panelCompatibility', header: 'Panel compatibility',
            render: (v) => `${v.min_panel_version || 'Any'} - ${v.max_panel_version || 'Latest'}`,
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            sortValue: (v) => (v.is_active ? 'Active' : 'Inactive'),
            render: (v) => (
                <Pill kind={v.is_active ? 'green' : 'gray'}>
                    {v.is_active ? t('app.agentFleet.active', 'Active') : t('app.agentFleet.inactive', 'Inactive')}
                </Pill>
            ),
        },
    ];

    const rolloutColumns = [
        {
            key: 'version',
            headerKey: 'common.labels.version', header: 'Version',
            sortable: true,
            hideable: false,
            sortValue: (r) => r.version || '',
            cellClassName: 'fleet-value',
            render: (r) => `v${r.version}`,
        },
        {
            key: 'strategy',
            headerKey: 'app.agentFleet.strategy', header: 'Strategy',
            sortable: true,
            sortValue: (r) => r.strategy || '',
            render: (r) => r.strategy,
        },
        {
            key: 'progress',
            headerKey: 'app.agentFleet.progress', header: 'Progress',
            sortable: true,
            sortValue: (r) => (r.total_servers > 0 ? (r.processed_servers / r.total_servers * 100) : 0),
            render: (r) => (
                <div className="fleet-rollout-progress">
                    <Gauge
                        className="fleet-rollout-progress__gauge"
                        value={r.total_servers > 0 ? (r.processed_servers / r.total_servers * 100) : 0}
                        color={r.status === 'failed' ? 'var(--red)' : r.status === 'completed' ? 'var(--green)' : 'var(--accent-bright)'}
                    />
                    <span className="fleet-caption">
                        {r.processed_servers}/{r.total_servers}
                        {r.failed_servers > 0 && (
                            <span className="fleet-rollout-failure">({r.failed_servers} failed)</span>
                        )}
                    </span>
                </div>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            sortValue: (r) => r.status || '',
            render: (r) => (
                <Pill kind={statusKind(r.status)}>{r.status}</Pill>
            ),
        },
        {
            key: 'started',
            headerKey: 'app.agentFleet.started', header: 'Started',
            sortable: true,
            sortValue: (r) => (r.started_at ? new Date(r.started_at).getTime() : null),
            cellClassName: 'fleet-queued-description',
            render: (r) => (r.started_at ? new Date(r.started_at).toLocaleString() : '-'),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions',
            render: (r) => (
                <>
                    {r.status === 'running' && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelRollout(r.id)}
                            title={t('app.agentFleet.cancelRollout', 'Cancel rollout')}
                        >
                            <XCircle size={14} /> {t('common.actions.cancel', 'Cancel')}
                        </Button>
                    )}
                    {r.error && (
                        <span className="fleet-command-error" title={r.error}>
                            <AlertCircle size={14} />
                        </span>
                    )}
                </>
            ),
        },
    ];

    const queueColumns = [
        {
            key: 'server',
            headerKey: 'common.labels.server', header: 'Server',
            sortable: true,
            hideable: false,
            sortValue: (cmd) => cmd.server_id || '',
            render: (cmd) => `${cmd.server_id?.slice(0, 8)}...`,
        },
        {
            key: 'command',
            headerKey: 'common.labels.command', header: 'Command',
            sortable: true,
            sortValue: (cmd) => cmd.command_type || '',
            cellClassName: 'fleet-command-type',
            render: (cmd) => cmd.command_type,
        },
        {
            key: 'retries',
            headerKey: 'app.agentFleet.retries', header: 'Retries',
            sortable: true,
            sortValue: (cmd) => cmd.retry_count ?? null,
            render: (cmd) => (
                <span className={cmd.retry_count > 0 ? 'fleet-command-retry' : ''}>
                    {cmd.retry_count}/{cmd.max_retries}
                </span>
            ),
        },
        {
            key: 'queued',
            headerKey: 'app.agentFleet.queuedAt', header: 'Queued At',
            sortable: true,
            sortValue: (cmd) => (cmd.created_at ? new Date(cmd.created_at).getTime() : null),
            cellClassName: 'fleet-queued-description',
            render: (cmd) => new Date(cmd.created_at).toLocaleString(),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions',
            render: (cmd) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => retryCommand(cmd.id)}
                    title={t('app.agentFleet.retryNow', 'Retry now')}
                >
                    <RotateCcw size={14} /> {t('common.actions.retry', 'Retry')}
                </Button>
            ),
        },
    ];

    const approvalColumns = [
        {
            key: 'name',
            headerKey: 'app.agentFleet.serverName', header: 'Server name',
            sortable: true,
            hideable: false,
            sortValue: (server) => server.name || '',
            cellClassName: 'fleet-value',
            render: (server) => server.name,
        },
        {
            key: 'ip',
            headerKey: 'common.labels.ipAddress', header: 'IP address',
            sortable: true,
            sortValue: (server) => server.ip_address || '',
            render: (server) => server.ip_address || 'N/A',
        },
        {
            key: 'requested',
            headerKey: 'app.agentFleet.requested', header: 'Requested',
            sortable: true,
            sortValue: (server) => (server.created_at ? new Date(server.created_at).getTime() : null),
            render: (server) => new Date(server.created_at).toLocaleString(),
        },
        {
            key: 'agent',
            headerKey: 'app.agentFleet.agentVersion', header: 'Agent version',
            sortable: true,
            sortValue: (server) => server.agent_version || '',
            render: (server) => `v${server.agent_version || 'Unknown'}`,
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions',
            render: (server) => (
                <>
                    <Button
                        size="sm"
                        onClick={() => approveAgent(server.id)}
                    >
                        <CheckCircle size={14} /> {t('app.agentFleet.approve', 'Approve')}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => rejectAgent(server.id)}
                    >
                        <XCircle size={14} /> {t('app.agentFleet.reject', 'Reject')}
                    </Button>
                </>
            ),
        },
    ];

    // Whether the open tab has anything to show, so a failed (re)load keeps
    // existing rows and only replaces the tab when there is nothing yet.
    const tabHasData = {
        dashboard: Boolean(health),
        versions: versions.length > 0,
        rollouts: rollouts.length > 0 || versions.length > 0,
        discovery: discoveredAgents.length > 0,
        approvals: pendingServers.length > 0,
        queue: queuedCommands.length > 0,
    }[activeTab] ?? false;

    return (
        <div className="sk-tabgroup__inner">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    {[
                        { key: 'dashboard', icon: Activity, labelKey: 'app.agentFleet.dashboard', label: 'Dashboard' },
                        { key: 'versions', icon: Package, labelKey: 'app.agentFleet.versions', label: 'Versions' },
                        { key: 'rollouts', icon: Zap, labelKey: 'app.agentFleet.rollouts', label: 'Rollouts' },
                        { key: 'queue', icon: Clock, labelKey: 'app.agentFleet.commandQueue', label: 'Command queue' },
                        { key: 'discovery', icon: Search, labelKey: 'app.agentFleet.discovery', label: 'Discovery' },
                        { key: 'approvals', icon: Shield, labelKey: 'app.agentFleet.approvals', label: 'Approvals' },
                    ].map(tab => (
                        <TabsTrigger key={tab.key} value={tab.key}>
                            <tab.icon size={18} />
                            {tab.label}
                            {tab.key === 'approvals' && pendingServers.length > 0 && (
                                <Badge variant="destructive" className="fleet-tab-count">{pendingServers.length}</Badge>
                            )}
                            {tab.key === 'queue' && queuedCommands.length > 0 && (
                                <Badge variant="warning" className="fleet-tab-count">{queuedCommands.length}</Badge>
                            )}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            {loadError && !tabHasData ? (
                <ErrorState
                    title={t('app.agentFleet.couldntLoadFleetData', "Couldn't load fleet data.")}
                    error={loadError}
                    onRetry={fetchData}
                />
            ) : loading && !tabHasData ? (
                <EmptyState loading loadingVariant="panel" title={t('common.loading', 'Loading…')} />
            ) : (
            <div className="tab-content fleet-tab-content">
                {loadError && <ErrorState compact error={loadError} onRetry={fetchData} />}

                {/* ==================== Dashboard ==================== */}
                {activeTab === 'dashboard' && health && (
                    <div className="fleet-section-stack">
                        <KpiBand>
                            <MetricCard icon={<Server size={16} />} tone="accent" label={t('app.agentFleet.totalAgents', 'Total agents')} value={health.total_servers} />
                            <MetricCard icon={<CheckCircle size={16} />} tone="green" label={t('app.agentFleet.online', 'Online')} value={health.online_servers} />
                            <MetricCard icon={<AlertCircle size={16} />} tone="red" label={t('app.agentFleet.offline', 'Offline')} value={health.offline_servers} />
                            <MetricCard icon={<Zap size={16} />} tone="cyan" label={t('app.agentFleet.successRate', 'Success rate')} value={formatPercent(health.command_success_rate)} />
                        </KpiBand>

                        <div className="fleet-health-grid">
                            <SharedCard variant="legacy" className="card">
                                <SharedCardHeader variant="legacy" className="card-header">
                                    <h2>{t('app.agentFleet.fleetHealthSummary', 'Fleet health summary')}</h2>
                                </SharedCardHeader>
                                <SharedCardContent variant="legacy" className="card-body">
                                    <div className="fleet-metric-stack">
                                        <div className="fleet-summary-row">
                                            <span className="fleet-metric-label">{t('app.agentFleet.overallUptime', 'Overall uptime')}</span>
                                            <span className="fleet-uptime-value">{formatPercent(health.uptime_percentage, 2)}</span>
                                        </div>
                                        <Gauge value={health.uptime_percentage} color="var(--green)" />

                                        <div className="fleet-summary-row fleet-summary-row--latency">
                                            <span className="fleet-metric-label">{t('app.agentFleet.avgHeartbeatLatency', 'Avg heartbeat latency')}</span>
                                            <span className="fleet-value">{isNumber(health.avg_heartbeat_latency) ? `${health.avg_heartbeat_latency} ms` : '—'}</span>
                                        </div>
                                        <Gauge value={Math.min(100, (health.avg_heartbeat_latency || 0) / 2)} color="var(--cyan)" />

                                        {health.queued_commands > 0 && (
                                            <div className="fleet-warnrow fleet-warnrow--spaced">
                                                <span className="fleet-inline-label">
                                                    <Clock size={16} /> {t('app.agentFleet.queuedCommands', 'Queued commands')}
                                                </span>
                                                <span className="fleet-value">{health.queued_commands}</span>
                                            </div>
                                        )}
                                    </div>
                                </SharedCardContent>
                            </SharedCard>

                            <SharedCard variant="legacy" className="card">
                                <SharedCardHeader variant="legacy" className="card-header">
                                    <h2>{t('app.agentFleet.versionDistribution', 'Version distribution')}</h2>
                                </SharedCardHeader>
                                <SharedCardContent variant="legacy" className="card-body">
                                    <div className="fleet-metric-stack">
                                        {Object.entries(health.version_distribution || {}).map(([version, count]) => (
                                            <div key={version} className="fleet-version-distribution">
                                                <div className="fleet-version-distribution__label">
                                                    <span>v{version}</span>
                                                    <span className="fleet-note">{count} {t('app.agentFleet.agents', 'agents (')}{(count / health.total_servers * 100).toFixed(0)}%)</span>
                                                </div>
                                                <Gauge value={count / health.total_servers * 100} color="var(--accent-bright)" />
                                            </div>
                                        ))}
                                        {Object.keys(health.version_distribution || {}).length === 0 && (
                                            <p className="fleet-version-empty">{t('app.agentFleet.noAgentsRegisteredYet', 'No agents registered yet.')}</p>
                                        )}
                                    </div>
                                </SharedCardContent>
                            </SharedCard>
                        </div>
                    </div>
                )}

                {/* ==================== Versions ==================== */}
                {activeTab === 'versions' && (
                    <SharedCard variant="legacy" className="card">
                        <SharedCardHeader variant="legacy" className="card-header">
                            <h2>{t('app.agentFleet.agentVersions', 'Agent versions')}</h2>
                        </SharedCardHeader>
                        <DataTable
                            columns={versionColumns}
                            data={versions}
                            keyField="id"
                            storageKey="serverkit-table-fleet-versions"
                            className="fleet-table-scroll"
                            emptyState={(
                                <div className="fleet-table-empty">
                                    {t('app.agentFleet.noAgentVersionsRegisteredInDatabase', 'No agent versions registered in database.')}
                                </div>
                            )}
                            footer={(
                                <DataTableFooter
                                    shown={versions.length}
                                    total={versions.length}
                                    noun="version"
                                />
                            )}
                        />
                        {versions.length > 0 && versions[0].release_notes && (
                            <SharedCardContent variant="legacy" className="card-body fleet-release-notes">
                                <h3 className="fleet-release-notes__title">{t('app.agentFleet.latestReleaseNotesV', 'Latest release notes (v')}{versions[0].version})</h3>
                                <p className="fleet-release-notes__text">{versions[0].release_notes}</p>
                            </SharedCardContent>
                        )}
                    </SharedCard>
                )}

                {/* ==================== Rollouts ==================== */}
                {activeTab === 'rollouts' && (
                    <div className="fleet-section-stack">
                        <SharedCard variant="legacy" className="card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h2>{t('app.agentFleet.triggerFleetUpgrade', 'Trigger fleet upgrade')}</h2>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <p className="fleet-rollout-description">
                                    {t('app.agentFleet.pushASpecificAgentVersionTo', 'Push a specific agent version to multiple servers at once.')}
                                </p>
                                <div className="fleet-rollout-fields">
                                    <div className="form-group">
                                        <label htmlFor="fleet-rollout-version">{t('app.agentFleet.targetVersion', 'Target version')}</label>
                                        <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                                            <SelectTrigger id="fleet-rollout-version" className="fleet-rollout-select">
                                                <SelectValue placeholder={t('app.agentFleet.selectVersion', 'Select version…')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {versions.map(v => (
                                                    <SelectItem key={v.id} value={String(v.id)}>v{v.version} ({v.channel})</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="form-group">
                                        <label htmlFor="fleet-rollout-strategy">{t('app.agentFleet.rolloutStrategy', 'Rollout strategy')}</label>
                                        <Select value={rolloutStrategy} onValueChange={setRolloutStrategy}>
                                            <SelectTrigger id="fleet-rollout-strategy" className="fleet-rollout-select">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">{t('app.agentFleet.allAtOnce', 'All at once')}</SelectItem>
                                                <SelectItem value="staged">{t('app.agentFleet.stagedBatchByBatch', 'Staged (batch by batch)')}</SelectItem>
                                                <SelectItem value="canary">{t('app.agentFleet.canary1ServerFirst', 'Canary (1 server first)')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {rolloutStrategy === 'staged' && (
                                        <>
                                            <div className="form-group">
                                                <label>{t('app.agentFleet.batchSize', 'Batch size')}</label>
                                                <Input
                                                    type="number"
                                                    value={rolloutBatchSize}
                                                    onChange={e => setRolloutBatchSize(parseInt(e.target.value) || 5)}
                                                    min={1}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label>{t('app.agentFleet.delayMinutes', 'Delay (minutes)')}</label>
                                                <Input
                                                    type="number"
                                                    value={rolloutDelay}
                                                    onChange={e => setRolloutDelay(parseInt(e.target.value) || 10)}
                                                    min={1}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                                <div className="fleet-rollout-actions">
                                    <Button onClick={triggerUpgrade} disabled={!selectedVersion}>
                                        <Play size={18} /> {t('app.agentFleet.startRollout', 'Start rollout')}
                                    </Button>
                                </div>
                            </SharedCardContent>
                        </SharedCard>

                        <SharedCard variant="legacy" className="card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h2>{t('app.agentFleet.rolloutHistory', 'Rollout history')}</h2>
                            </SharedCardHeader>
                            {rollouts.length > 0 ? (
                                <DataTable
                                    columns={rolloutColumns}
                                    data={rollouts}
                                    keyField="id"
                                    storageKey="serverkit-table-fleet-rollouts"
                                    className="fleet-table-scroll"
                                    footer={(
                                        <DataTableFooter
                                            shown={rollouts.length}
                                            total={rollouts.length}
                                            noun="rollout"
                                        />
                                    )}
                                />
                            ) : (
                                <SharedCardContent variant="legacy" className="card-body fleet-card-empty">
                                    <Zap size={48} className="fleet-empty-icon" />
                                    <p>{t('app.agentFleet.noRolloutsHaveBeenStartedYet', 'No rollouts have been started yet.')}</p>
                                </SharedCardContent>
                            )}
                        </SharedCard>
                    </div>
                )}

                {/* ==================== Command Queue ==================== */}
                {activeTab === 'queue' && (
                    <SharedCard variant="legacy" className="card">
                        <SharedCardHeader variant="legacy" className="card-header fleet-card-heading">
                            <h2>{t('app.agentFleet.queuedCommands', 'Queued commands')}</h2>
                        </SharedCardHeader>
                        {queuedCommands.length > 0 ? (
                            <DataTable
                                columns={queueColumns}
                                data={queuedCommands}
                                keyField="id"
                                storageKey="serverkit-table-fleet-queue"
                                className="fleet-table-scroll"
                                footer={(
                                    <DataTableFooter
                                        shown={queuedCommands.length}
                                        total={queuedCommands.length}
                                        noun="command"
                                    />
                                )}
                            />
                        ) : (
                            <SharedCardContent variant="legacy" className="card-body fleet-card-empty">
                                <CheckCircle size={48} className="fleet-empty-icon" />
                                <p>{t('app.agentFleet.noQueuedCommandsAllAgentsAre', 'No queued commands. All agents are up to date.')}</p>
                            </SharedCardContent>
                        )}
                    </SharedCard>
                )}

                {/* ==================== Discovery ==================== */}
                {activeTab === 'discovery' && (
                    <div className="fleet-section-stack">
                        <div className="fleet-summary-row">
                            <h2>{t('app.agentFleet.networkDiscovery', 'Network discovery')}</h2>
                            <Button onClick={startDiscovery} disabled={isScanning}>
                                {isScanning ? <RefreshCw size={18} className="fleet-refresh-spinner" /> : <Search size={18} />}
                                {isScanning ? t('app.agentFleet.scanning', 'Scanning…') : t('app.agentFleet.startScan', 'Start scan')}
                            </Button>
                        </div>

                        <div className="fleet-discovery-grid">
                            {discoveredAgents.map(agent => (
                                <SharedCard variant="legacy" key={agent.agent_id} className="card fleet-discovered-agent">
                                    <div>
                                        <div className="fleet-discovered-agent__heading">
                                            <div className="fleet-ico">
                                                <Server size={20} />
                                            </div>
                                            {agent.is_registered ? (
                                                <Pill kind="green">{t('app.agentFleet.registered', 'Registered')}</Pill>
                                            ) : (
                                                <Pill kind="amber">{t('app.agentFleet.new', 'New')}</Pill>
                                            )}
                                        </div>
                                        <h3 className="fleet-agent-name">{agent.hostname}</h3>
                                        <p className="fleet-caption">{agent.ip_address}</p>
                                        <div className="fleet-agent-facts">
                                            <div className="fleet-agent-fact">
                                                <span className="fleet-note">{t('app.agentFleet.os', 'OS:')}</span>
                                                <span>{agent.os} ({agent.arch})</span>
                                            </div>
                                            <div className="fleet-agent-fact">
                                                <span className="fleet-note">{t('app.agentFleet.agentVersion2', 'Agent version:')}</span>
                                                <span>v{agent.agent_version}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="fleet-agent-actions">
                                        {agent.is_registered ? (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="fleet-agent-action"
                                                onClick={() => {
                                                    setActiveTab('dashboard');
                                                    loadDiagnostics(agent.server_id);
                                                }}
                                            >
                                                {t('app.agentFleet.viewDetails', 'View details')}
                                            </Button>
                                        ) : (
                                            <Button size="sm" className="fleet-agent-action">{t('app.agentFleet.addToFleet', 'Add to fleet')}</Button>
                                        )}
                                    </div>
                                </SharedCard>
                            ))}
                            {discoveredAgents.length === 0 && !isScanning && (
                                <SharedCard variant="legacy" className="card fleet-discovery-empty">
                                    <Search size={48} className="fleet-empty-icon" />
                                    <p className="fleet-note">{t('app.agentFleet.noAgentsDiscoveredYetStartA', 'No agents discovered yet. Start a scan to find agents on your local network.')}</p>
                                </SharedCard>
                            )}
                        </div>
                    </div>
                )}

                {/* ==================== Approvals ==================== */}
                {activeTab === 'approvals' && (
                    <SharedCard variant="legacy" className="card">
                        <SharedCardHeader variant="legacy" className="card-header">
                            <h2>{t('app.agentFleet.pendingRegistrations', 'Pending registrations')}</h2>
                        </SharedCardHeader>
                        <DataTable
                            columns={approvalColumns}
                            data={pendingServers}
                            keyField="id"
                            storageKey="serverkit-table-fleet-approvals"
                            className="fleet-table-scroll"
                            emptyState={(
                                <div className="fleet-table-empty">
                                    {t('app.agentFleet.noPendingAgentRegistrations', 'No pending agent registrations.')}
                                </div>
                            )}
                            footer={(
                                <DataTableFooter
                                    shown={pendingServers.length}
                                    total={pendingServers.length}
                                    noun="registration"
                                />
                            )}
                        />
                    </SharedCard>
                )}

                {/* ==================== Diagnostics Modal ==================== */}
                {diagnostics && (
                    <div className="fleet-diagnostics-overlay" onClick={() => setDiagnostics(null)}>
                        <div className="fleet-modal fleet-diagnostics-dialog" onClick={e => e.stopPropagation()}>
                            <div className="fleet-diagnostics-heading">
                                <h2 className="fleet-diagnostics-title">
                                    {t('app.agentFleet.agentDiagnostics', 'Agent diagnostics -')} {diagnostics.server_name}
                                </h2>
                                <Button variant="ghost" size="sm" onClick={() => setDiagnostics(null)}>
                                    <XCircle size={18} />
                                </Button>
                            </div>
                            <div className="fleet-diagnostics-body">
                                <div className="fleet-diagnostics-facts">
                                    <div>
                                        <label className="fleet-caption">{t('common.labels.status', 'Status')}</label>
                                        <p className="fleet-connection-value">
                                            {diagnostics.connection.is_connected ? (
                                                <><Wifi size={16} className="fleet-connected-icon" /> {t('app.agentFleet.connected', 'Connected')}</>
                                            ) : (
                                                <><WifiOff size={16} className="fleet-disconnected-icon" /> {t('app.agentFleet.disconnected', 'Disconnected')}</>
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="fleet-caption">{t('app.agentFleet.agentVersion', 'Agent version')}</label>
                                        <p className="fleet-value">v{diagnostics.agent_version || t('app.agentFleet.unknown', 'Unknown')}</p>
                                    </div>
                                    <div>
                                        <label className="fleet-caption">{t('app.agentFleet.currentLatency', 'Current latency')}</label>
                                        <p className="fleet-value">
                                            {diagnostics.connection.current_latency_ms != null
                                                ? `${diagnostics.connection.current_latency_ms.toFixed(1)} ms`
                                                : t('app.agentFleet.notAvailable', 'N/A')}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="fleet-caption">{t('app.agentFleet.avgLatency', 'Avg latency')}</label>
                                        <p className="fleet-value">
                                            {diagnostics.connection.avg_latency_ms != null
                                                ? `${diagnostics.connection.avg_latency_ms.toFixed(1)} ms`
                                                : t('app.agentFleet.notAvailable', 'N/A')}
                                        </p>
                                    </div>
                                    <div>
                                        <label className="fleet-caption">{t('common.labels.ipAddress', 'IP address')}</label>
                                        <p className="fleet-value">{diagnostics.connection.ip_address || t('app.agentFleet.notAvailable', 'N/A')}</p>
                                    </div>
                                    <div>
                                        <label className="fleet-caption">{t('app.agentFleet.connectedSince', 'Connected since')}</label>
                                        <p className="fleet-value">
                                            {diagnostics.connection.connected_since
                                                ? new Date(diagnostics.connection.connected_since).toLocaleString()
                                                : t('app.agentFleet.notAvailable', 'N/A')}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="fleet-diagnostics-section-title">{t('app.agentFleet.commandStats24h', 'Command stats (24h)')}</h3>
                                    <div className="fleet-command-statistics">
                                        <div className="fleet-statbox">
                                            <div className="fleet-command-total">{diagnostics.commands_24h.total}</div>
                                            <div className="fleet-command-statistic-label">{t('app.agentFleet.total', 'Total')}</div>
                                        </div>
                                        <div className="fleet-statbox is-green">
                                            <div className="fleet-command-success">{diagnostics.commands_24h.success}</div>
                                            <div className="fleet-command-statistic-label">{t('app.agentFleet.success', 'Success')}</div>
                                        </div>
                                        <div className="fleet-statbox is-red">
                                            <div className="fleet-command-failed">{diagnostics.commands_24h.failed}</div>
                                            <div className="fleet-command-statistic-label">{t('common.state.failed', 'Failed')}</div>
                                        </div>
                                        <div className="fleet-statbox is-amber">
                                            <div className="fleet-command-timeout">{diagnostics.commands_24h.timeout}</div>
                                            <div className="fleet-command-statistic-label">{t('app.agentFleet.timeout', 'Timeout')}</div>
                                        </div>
                                    </div>
                                </div>

                                {diagnostics.queued_commands > 0 && (
                                    <div className="fleet-warnrow">
                                        <span className="fleet-inline-label">
                                            <Clock size={16} />
                                            <span className="fleet-queued-description">{diagnostics.queued_commands} {t('app.agentFleet.commandsQueuedForDelivery', 'commands queued for delivery')}</span>
                                        </span>
                                    </div>
                                )}

                                <div>
                                    <h3 className="fleet-diagnostics-section-title">{t('app.agentFleet.recentSessions', 'Recent sessions')}</h3>
                                    <div className="fleet-session-list">
                                        {diagnostics.recent_sessions.map(session => (
                                            <div key={session.id} className="fleet-statrow fleet-session-row">
                                                <div className="fleet-inline-label">
                                                    {session.is_active ? (
                                                        <Wifi size={14} className="fleet-connected-icon" />
                                                    ) : (
                                                        <WifiOff size={14} className="fleet-session-offline" />
                                                    )}
                                                    <span>{session.ip_address}</span>
                                                </div>
                                                <div className="fleet-note">
                                                    {new Date(session.connected_at).toLocaleString()}
                                                    {session.disconnect_reason && (
                                                        <span className="fleet-session-disconnect-reason">({session.disconnect_reason})</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

export default AgentFleet;
