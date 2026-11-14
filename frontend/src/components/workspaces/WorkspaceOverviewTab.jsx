import { MetricCard } from '@/components/ds';
import { Server, Boxes, Globe, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InfoList, InfoItem } from '../InfoList';
import { OverviewBoard, OverviewSection } from '@/components/detail/OverviewBoard';

// Board rows a KPI tile takes: a count and its label.
const KPI_TILE_ROWS = 2;

// The workspace's Overview tab on the overview board: its facts, then one tile
// per resource count. One layout per user, shared by every workspace page.
const WorkspaceOverviewTab = ({ ws, since, members, srvIn, services, sites }) => {
    const { t } = useTranslation();
    return (
        <OverviewBoard kind="workspace" shared entityId={ws.id} entityLabel={ws.name}>
            <OverviewSection id="count-servers" title={t('common.labels.servers', 'Servers')} tile w={3} h={KPI_TILE_ROWS}>
                <MetricCard icon={<Server size={16} />} tone="accent" value={srvIn.length} label={t('common.labels.servers', 'Servers')} />
            </OverviewSection>
            <OverviewSection id="count-services" title={t('common.labels.services', 'Services')} tile w={3} h={KPI_TILE_ROWS}>
                <MetricCard icon={<Boxes size={16} />} tone="accent" value={services.length} label={t('common.labels.services', 'Services')} />
            </OverviewSection>
            <OverviewSection id="count-sites" title={t('app.workspaceOverviewTab.sites', 'Sites')} tile w={3} h={KPI_TILE_ROWS}>
                <MetricCard icon={<Globe size={16} />} tone="accent" value={sites.length} label={t('app.workspaceOverviewTab.sites', 'Sites')} />
            </OverviewSection>
            <OverviewSection id="count-members" title={t('app.workspaceOverviewTab.members', 'Members')} tile w={3} h={KPI_TILE_ROWS}>
                <MetricCard icon={<Users size={16} />} tone="accent" value={members.length} label={t('app.workspaceOverviewTab.members', 'Members')} />
            </OverviewSection>

            <OverviewSection id="info" title={t('common.labels.workspace', 'Workspace')} w={6} h={5}>
                <InfoList>
                    <InfoItem label={t('app.workspaceOverviewTab.slug', 'Slug')} value={`/${ws.slug}`} mono />
                    <InfoItem label={t('common.labels.created', 'Created')} value={since || '—'} />
                    <InfoItem label={t('app.workspaceOverviewTab.maxServers', 'Max servers')} value={ws.max_servers > 0 ? ws.max_servers : t('app.workspaceOverviewTab.unlimited', 'Unlimited')} />
                    <InfoItem label={t('app.workspaceOverviewTab.maxUsers', 'Max users')} value={ws.max_users > 0 ? ws.max_users : t('app.workspaceOverviewTab.unlimited', 'Unlimited')} />
                </InfoList>
            </OverviewSection>
        </OverviewBoard>
    );
};

export default WorkspaceOverviewTab;
