import { serverStatusKind } from './serverDetailData';
import { Pill, MetricCard, Gauge } from '../ds';
import OnboardingWizard from '../server/OnboardingWizard';
import SystemStatusCard from './SystemStatusCard';
import { OverviewBoard, OverviewSection } from '@/components/detail/OverviewBoard';
import ServerHealthCard from './ServerHealthCard';
import { formatBytes } from '@/utils/formatBytes';
import { InfoList, InfoItem } from '../InfoList';
import { useTranslation } from 'react-i18next';
import { Bot, Cpu, HeartPulse, ListChecks, Server as ServerGlyph, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '@/utils/intl';
import {
    PulseIcon,
    ClockIcon,
    CpuIcon,
    MemoryIcon,
    DiskIcon,
    OfflineIcon,
    HostIcon,
    NetworkIcon,
    FolderTinyIcon,
    OsIcon,
    ArchIcon,
    TagIcon,
    HashIcon,
    DockerMiniIcon,
} from './serverDetailShared';

// Dashboard widget types a server overview can carry besides its own blocks.
const SERVER_WIDGET_TYPES = ['stat', 'gauge', 'timeseries', 'specs', 'note'];

// Dashboard widgets that open the default layout. `$server` is the board's
// variable: on this page it is always the server being viewed. Titles come
// from the metric, so nothing here needs translating.
const SERVER_LEADING_WIDGETS = [
    { type: 'stat', w: 3, h: 4, cfg: { metric: 'cpu', agg: 'last', resource: '$server', spark: true, thresholds: [70, 90] } },
    { type: 'stat', w: 3, h: 4, cfg: { metric: 'ram', agg: 'last', resource: '$server', spark: true, thresholds: [80, 92] } },
    { type: 'stat', w: 3, h: 4, cfg: { metric: 'disk', agg: 'last', resource: '$server', spark: true, thresholds: [75, 90] } },
    { type: 'stat', w: 3, h: 4, cfg: { metric: 'net_in', agg: 'last', resource: '$server', spark: true, thresholds: null } },
    {
        type: 'timeseries', w: 8, h: 6,
        cfg: { series: [{ resource: '$server', metric: 'cpu' }, { resource: '$server', metric: 'ram' }], legend: true, fill: true },
    },
];

// Usage thresholds for the CPU / memory / disk tiles.
const USAGE_DANGER_PERCENT = 85;
const USAGE_WARN_PERCENT = 70;
// Board rows a KPI tile takes: value, label, a meter and its sub line.
const KPI_TILE_ROWS = 3;

// A percent tile on the shared MetricCard: the value, a thin meter and the
// capacity line underneath. Same tile the service overview's KPI band uses.
const UsageTile = ({ icon, label, percent, color, sub }) => {
    const has = Number.isFinite(percent);
    const safe = has ? Math.min(Math.max(percent, 0), 100) : 0;
    const danger = safe > USAGE_DANGER_PERCENT;
    const warn = safe > USAGE_WARN_PERCENT && !danger;
    return (
        <MetricCard
            icon={icon}
            tone={danger ? 'red' : warn ? 'amber' : 'accent'}
            value={has ? safe.toFixed(1) : '—'}
            unit={has ? '%' : undefined}
            label={label}
        >
            <Gauge className="sk-kpi__meter" value={safe} color={danger ? 'var(--red)' : warn ? 'var(--amber)' : color} />
            {sub && <div className="sk-kpi__sub">{sub}</div>}
        </MetricCard>
    );
};

const ServerOverviewTab = ({ server, metrics, systemInfo, onRefreshServer }) => {
    const { t } = useTranslation();
    const formatUptime = (seconds) => {
        if (!seconds) return 'N/A';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        if (days > 0) return `${days}d ${hours}h`;
        const mins = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${mins}m`;
    };

    const isOnline = server.status === 'online';
    const statusLabel = server.status || 'pending';
    const cpuCores = systemInfo?.cpu_cores || server.cpu_cores;
    const cpuModel = systemInfo?.cpu_model || server.cpu_model;
    const totalMemory = systemInfo?.total_memory || server.total_memory;
    const totalDisk = systemInfo?.total_disk || server.total_disk;
    const osLabel = `${systemInfo?.os || server.os_type || 'Unknown'}${systemInfo?.os_version || server.os_version ? ` ${systemInfo?.os_version || server.os_version}` : ''}`;

    // Surface the onboarding wizard while a server is still being
    // provisioned. Hidden once onboarding reaches 'ready' (or was never
    // started) so it doesn't clutter a healthy server's overview.
    const showOnboarding =
        server.onboarding_state &&
        !['ready', 'pending'].includes(server.onboarding_state);

    return (
        <div className="overview-tab">
            {showOnboarding && (
                <div className="overview-tab__onboarding">
                    <OnboardingWizard
                        serverId={server.id}
                        initialState={server.onboarding_state}
                        onStateChange={(newState) => {
                            // Refresh the parent server payload when onboarding
                            // reaches a terminal state so the card hides itself.
                            if (newState === 'ready' || newState === 'failed') {
                                onRefreshServer?.();
                            }
                        }}
                    />
                </div>
            )}
            <OverviewBoard
                kind="server"
                shared
                entityId={server.id}
                entityLabel={server.name}
                serverVar={server.id}
                widgetTypes={SERVER_WIDGET_TYPES}
                leading={SERVER_LEADING_WIDGETS}
            >
                {/* Only renders while the agent is unreachable, so it leaves
                    the layout on its own once the server is back. */}
                <OverviewSection id="offline" title={t('app.serverOverviewTab.connection', 'Connection')} w={12} h={4} lead>
                    {!isOnline && (
                        <div className="offline-message">
                            <OfflineIcon />
                            <h4>{t('app.serverOverviewTab.serverOffline', 'Server offline')}</h4>
                            <p>
                                {server.status === 'pending'
                                    ? t('app.serverOverviewTab.waitingForAgentInstall', 'Waiting for the agent to be installed…')
                                    : t('app.serverOverviewTab.cantReachAgent', "Couldn't connect to the server agent.")}
                            </p>
                        </div>
                    )}
                </OverviewSection>

                {/* The agent's live readings (no history needed), one tile
                    each. Offered in the block library; the default layout
                    opens with the dashboard's metric widgets instead. */}
                <OverviewSection id="live-status" title={t('common.labels.status', 'Status')} tile replaces="live" w={3} h={KPI_TILE_ROWS} placed={false}>
                    <MetricCard
                        icon={<PulseIcon />}
                        tone={isOnline ? 'green' : server.status === 'connecting' ? 'amber' : 'red'}
                        value={statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}
                        label={t('common.labels.status', 'Status')}
                    />
                </OverviewSection>
                <OverviewSection id="live-uptime" title={t('common.labels.uptime', 'Uptime')} tile replaces="live" w={3} h={KPI_TILE_ROWS} placed={false}>
                    <MetricCard
                        icon={<ClockIcon />}
                        tone="accent"
                        value={isOnline ? formatUptime(metrics?.uptime) : '—'}
                        label={t('common.labels.uptime', 'Uptime')}
                    >
                        {isOnline && metrics?.uptime ? <div className="sk-kpi__sub">{t('app.serverOverviewTab.sinceLastBoot', 'since last boot')}</div> : null}
                    </MetricCard>
                </OverviewSection>
                <OverviewSection id="live-cpu" title="CPU" tile replaces="live" w={3} h={KPI_TILE_ROWS} placed={false}>
                    <UsageTile
                        icon={<CpuIcon />}
                        label="CPU"
                        percent={isOnline ? metrics?.cpu_percent : null}
                        color="var(--accent-bright)"
                        sub={cpuCores ? `${cpuCores} cores` : null}
                    />
                </OverviewSection>
                <OverviewSection id="live-memory" title={t('common.labels.memory', 'Memory')} tile replaces="live" w={3} h={KPI_TILE_ROWS} placed={false}>
                    <UsageTile
                        icon={<MemoryIcon />}
                        label={t('common.labels.memory', 'Memory')}
                        percent={isOnline ? metrics?.memory_percent : null}
                        color="var(--cyan)"
                        sub={totalMemory ? formatBytes(totalMemory) : null}
                    />
                </OverviewSection>
                <OverviewSection id="live-disk" title={t('common.labels.disk', 'Disk')} tile replaces="live" w={3} h={KPI_TILE_ROWS} placed={false}>
                    <UsageTile
                        icon={<DiskIcon />}
                        label={t('common.labels.disk', 'Disk')}
                        percent={isOnline ? metrics?.disk_percent : null}
                        color="var(--green)"
                        sub={totalDisk ? formatBytes(totalDisk) : null}
                    />
                </OverviewSection>

                <OverviewSection id="info" title={t('app.serverOverviewTab.serverInformation', 'Server information')} icon={ServerGlyph} w={4} h={6}>
                    <InfoList className="server-info-list">
                        <InfoItem label={<><PulseIcon /> {t('common.labels.status', 'Status')}</>}>
                            <Pill kind={serverStatusKind(server.status)}>{server.status}</Pill>
                        </InfoItem>
                        <InfoItem label={<><HostIcon /> {t('app.serverOverviewTab.hostname', 'Hostname')}</>} value={server.hostname || 'N/A'} mono />
                        <InfoItem label={<><NetworkIcon /> {t('common.labels.ipAddress', 'IP address')}</>} value={server.ip_address || 'N/A'} mono />
                        <InfoItem label={<><FolderTinyIcon /> {t('app.serverOverviewTab.group', 'Group')}</>} value={server.group_name || 'Ungrouped'} />
                        <InfoItem
                            label={<><ClockIcon /> {t('app.serverOverviewTab.lastSeen', 'Last seen')}</>}
                            value={server.last_seen ? formatDateTime(server.last_seen) : 'Never'}
                        />
                    </InfoList>
                </OverviewSection>

                <OverviewSection id="system" title={t('app.serverOverviewTab.systemInformation', 'System information')} icon={Cpu} w={6} h={6}>
                    <InfoList className="server-info-list">
                        <InfoItem label={<><OsIcon /> {t('app.serverOverviewTab.operatingSystem', 'Operating system')}</>} value={osLabel} />
                        <InfoItem label={<><ArchIcon /> {t('app.serverOverviewTab.architecture', 'Architecture')}</>} value={systemInfo?.architecture || server.architecture || 'N/A'} />
                        <InfoItem
                            label={<><CpuIcon /> CPU</>}
                            value={
                                (cpuModel || 'N/A') + (cpuCores ? ` (${cpuCores} cores)` : '')
                            }
                        />
                        <InfoItem label={<><MemoryIcon /> {t('app.serverOverviewTab.totalMemory', 'Total memory')}</>} value={formatBytes(totalMemory, { defaultValue: 'N/A' })} />
                        <InfoItem label={<><DiskIcon /> {t('app.serverOverviewTab.totalDisk', 'Total disk')}</>} value={formatBytes(totalDisk, { defaultValue: 'N/A' })} />
                    </InfoList>
                </OverviewSection>

                <OverviewSection id="agent" title={t('app.serverOverviewTab.agentInformation', 'Agent information')} icon={Bot} w={6} h={6}>
                    <InfoList className="server-info-list server-info-list--columns">
                        <InfoItem label={<><TagIcon /> {t('app.serverOverviewTab.agentVersion', 'Agent version')}</>} value={server.agent_version || 'Not installed'} mono />
                        <InfoItem label={<><HashIcon /> {t('app.serverOverviewTab.agentId', 'Agent ID')}</>} value={server.agent_id || 'N/A'} mono />
                        <InfoItem label={<><DockerMiniIcon /> {t('app.serverOverviewTab.dockerVersion', 'Docker version')}</>} value={server.docker_version || systemInfo?.docker_version || 'N/A'} mono />
                        <InfoItem label={<><ClockIcon /> {t('common.labels.uptime', 'Uptime')}</>} value={formatUptime(metrics?.uptime)} />
                    </InfoList>
                </OverviewSection>

                <OverviewSection id="permission" title={t('app.serverHealthCard.permissionLevel', 'Permission level')} icon={ShieldCheck} w={6} h={6}>
                    <ServerHealthCard server={server} part="permission" />
                </OverviewSection>

                <OverviewSection id="health" title={t('app.serverHealthCard.health', 'Health')} icon={HeartPulse} w={6} h={6}>
                    <ServerHealthCard server={server} part="health" />
                </OverviewSection>

                <OverviewSection id="status" title={t('app.systemStatusCard.systemStatus', 'System status')} icon={ListChecks} w={12} h={10}>
                    <SystemStatusCard server={server} onRefresh={onRefreshServer} />
                </OverviewSection>
            </OverviewBoard>
        </div>
    );
};

export default ServerOverviewTab;
