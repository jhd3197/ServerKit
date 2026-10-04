import { serverStatusKind } from './serverDetailData';
import { Pill, KpiBand } from '../ds';
import OnboardingWizard from '../server/OnboardingWizard';
import SystemStatusCard from './SystemStatusCard';
import { formatBytes } from '@/utils/formatBytes';
import { InfoList, InfoItem } from '../InfoList';
import { useTranslation } from 'react-i18next';
import {
    KpiTile,
    KpiGauge,
    PulseIcon,
    ClockIcon,
    CpuIcon,
    MemoryIcon,
    DiskIcon,
    OfflineIcon,
    ServerIcon,
    HostIcon,
    NetworkIcon,
    FolderTinyIcon,
    ChipIcon,
    OsIcon,
    ArchIcon,
    AgentIcon,
    TagIcon,
    HashIcon,
    DockerMiniIcon,
} from './serverDetailShared';

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
            <KpiBand max={5}>
                <KpiTile
                    icon={<PulseIcon />}
                    label={t('common.labels.status', 'Status')}
                    value={server.status || 'pending'}
                    tone={isOnline ? 'success' : server.status === 'connecting' ? 'warning' : 'danger'}
                />
                <KpiTile
                    icon={<ClockIcon />}
                    label={t('common.labels.uptime', 'Uptime')}
                    value={isOnline ? formatUptime(metrics?.uptime) : '—'}
                    sub={isOnline && metrics?.uptime ? 'since last boot' : null}
                />
                <KpiGauge
                    icon={<CpuIcon />}
                    label="CPU"
                    percent={isOnline ? metrics?.cpu_percent : null}
                    color="var(--accent-bright)"
                    sub={cpuCores ? `${cpuCores} cores` : null}
                />
                <KpiGauge
                    icon={<MemoryIcon />}
                    label={t('common.labels.memory', 'Memory')}
                    percent={isOnline ? metrics?.memory_percent : null}
                    color="var(--cyan)"
                    sub={totalMemory ? formatBytes(totalMemory) : null}
                />
                <KpiGauge
                    icon={<DiskIcon />}
                    label={t('common.labels.disk', 'Disk')}
                    percent={isOnline ? metrics?.disk_percent : null}
                    color="var(--green)"
                    sub={totalDisk ? formatBytes(totalDisk) : null}
                />
            </KpiBand>

            {!isOnline && (
                <div className="info-card offline-card">
                    <div className="offline-message">
                        <OfflineIcon />
                        <h4>{t('app.serverOverviewTab.serverOffline', 'Server Offline')}</h4>
                        <p>
                            {server.status === 'pending'
                                ? 'Waiting for agent installation...'
                                : 'Unable to connect to the server agent.'}
                        </p>
                    </div>
                </div>
            )}

            <div className="overview-grid">
                <div className="info-card">
                    <h3><ServerIcon /> {t('app.serverOverviewTab.serverInformation', 'Server Information')}</h3>
                    <InfoList className="server-info-list">
                        <InfoItem label={<><PulseIcon /> {t('common.labels.status', 'Status')}</>}>
                            <Pill kind={serverStatusKind(server.status)}>{server.status}</Pill>
                        </InfoItem>
                        <InfoItem label={<><HostIcon /> {t('app.serverOverviewTab.hostname', 'Hostname')}</>} value={server.hostname || 'N/A'} mono />
                        <InfoItem label={<><NetworkIcon /> {t('common.labels.ipAddress', 'IP Address')}</>} value={server.ip_address || 'N/A'} mono />
                        <InfoItem label={<><FolderTinyIcon /> {t('app.serverOverviewTab.group', 'Group')}</>} value={server.group_name || 'Ungrouped'} />
                        <InfoItem
                            label={<><ClockIcon /> {t('app.serverOverviewTab.lastSeen', 'Last Seen')}</>}
                            value={server.last_seen ? new Date(server.last_seen).toLocaleString() : 'Never'}
                        />
                    </InfoList>
                </div>

                <div className="info-card">
                    <h3><ChipIcon /> {t('app.serverOverviewTab.systemInformation', 'System Information')}</h3>
                    <InfoList className="server-info-list">
                        <InfoItem label={<><OsIcon /> {t('app.serverOverviewTab.operatingSystem', 'Operating System')}</>} value={osLabel} />
                        <InfoItem label={<><ArchIcon /> {t('app.serverOverviewTab.architecture', 'Architecture')}</>} value={systemInfo?.architecture || server.architecture || 'N/A'} mono />
                        <InfoItem
                            label={<><CpuIcon /> CPU</>}
                            value={
                                (cpuModel || 'N/A') + (cpuCores ? ` (${cpuCores} cores)` : '')
                            }
                        />
                        <InfoItem label={<><MemoryIcon /> {t('app.serverOverviewTab.totalMemory', 'Total Memory')}</>} value={formatBytes(totalMemory, { defaultValue: 'N/A' })} mono />
                        <InfoItem label={<><DiskIcon /> {t('app.serverOverviewTab.totalDisk', 'Total Disk')}</>} value={formatBytes(totalDisk, { defaultValue: 'N/A' })} mono />
                    </InfoList>
                </div>

                <div className="info-card overview-grid__full">
                    <h3><AgentIcon /> {t('app.serverOverviewTab.agentInformation', 'Agent Information')}</h3>
                    <InfoList className="server-info-list server-info-list--columns">
                        <InfoItem label={<><TagIcon /> {t('app.serverOverviewTab.agentVersion', 'Agent Version')}</>} value={server.agent_version || 'Not installed'} mono />
                        <InfoItem label={<><HashIcon /> {t('app.serverOverviewTab.agentId', 'Agent ID')}</>} value={server.agent_id || 'N/A'} mono />
                        <InfoItem label={<><DockerMiniIcon /> {t('app.serverOverviewTab.dockerVersion', 'Docker Version')}</>} value={server.docker_version || systemInfo?.docker_version || 'N/A'} mono />
                        <InfoItem label={<><ClockIcon /> {t('common.labels.uptime', 'Uptime')}</>} value={formatUptime(metrics?.uptime)} mono />
                    </InfoList>
                </div>

                <div className="overview-grid__full">
                    <SystemStatusCard server={server} onRefresh={onRefreshServer} />
                </div>
            </div>
        </div>
    );
};

export default ServerOverviewTab;
