import { KpiBand, MetricCard } from '@/components/ds';
import { Server, Boxes, Globe, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InfoList, InfoItem } from '../InfoList';

const WorkspaceOverviewTab = ({ ws, since, members, srvIn, services, sites }) => {
    const { t } = useTranslation();
    return (
        <div className="ws-detail__grid">
            <section className="ws-detail__card">
                <h3>{t('common.labels.workspace', 'Workspace')}</h3>
                <InfoList>
                    <InfoItem label={t('app.workspaceOverviewTab.slug', 'Slug')} value={`/${ws.slug}`} mono />
                    <InfoItem label={t('common.labels.created', 'Created')} value={since || '—'} />
                    <InfoItem label={t('app.workspaceOverviewTab.maxServers', 'Max servers')} value={ws.max_servers > 0 ? ws.max_servers : t('app.workspaceOverviewTab.unlimited', 'Unlimited')} />
                    <InfoItem label={t('app.workspaceOverviewTab.maxUsers', 'Max users')} value={ws.max_users > 0 ? ws.max_users : t('app.workspaceOverviewTab.unlimited', 'Unlimited')} />
                </InfoList>
            </section>
            <section className="ws-detail__card">
                <h3>{t('app.workspaceOverviewTab.resources', 'Resources')}</h3>
                <KpiBand>
                    <MetricCard icon={<Server size={16} />} tone="accent" value={srvIn.length} label={t('common.labels.servers', 'Servers')} />
                    <MetricCard icon={<Boxes size={16} />} tone="accent" value={services.length} label={t('common.labels.services', 'Services')} />
                    <MetricCard icon={<Globe size={16} />} tone="accent" value={sites.length} label={t('app.workspaceOverviewTab.sites', 'Sites')} />
                    <MetricCard icon={<Users size={16} />} tone="accent" value={members.length} label={t('app.workspaceOverviewTab.members', 'Members')} />
                </KpiBand>
            </section>
        </div>
    );
};

export default WorkspaceOverviewTab;
