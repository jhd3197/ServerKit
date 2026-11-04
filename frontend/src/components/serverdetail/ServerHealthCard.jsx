import { useEffect, useState } from 'react';
import api from '../../services/api';
import { DataTable, Pill } from '@/components/ds';
import { InfoList, InfoItem } from '../InfoList';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/utils/intl';
import { levelKind, serverHealth } from '@/utils/agentPermissionLevel';

const SET_HINT = 'serverkit-agent permissions set <monitor|protect|full>';

const checkKind = (status) => {
    if (status === 'up') return 'green';
    if (status === 'down') return 'red';
    if (status === 'degraded') return 'amber';
    return 'gray';
};

// Read-only by design: the permission level is enforced by the agent and can
// only be changed on the server itself, so there is deliberately no control.
const ServerHealthCard = ({ server }) => {
    const { t } = useTranslation();
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        let alive = true;
        api.getFleetAlerts({ server_id: server.id, status: 'active', limit: 20 })
            .then((res) => { if (alive) setAlerts((Array.isArray(res) ? res : []).filter((a) => a.detail)); })
            .catch(() => { if (alive) setAlerts([]); });
        return () => { alive = false; };
    }, [server.id, server.status, server.last_report_at]);

    const level = server.permission_level_effective || 'full';
    const health = serverHealth(server);
    const mismatch = server.requested_permission_level
        && server.permission_level
        && server.requested_permission_level !== server.permission_level;
    const levelName = {
        monitor: t('app.serverHealthCard.monitor', 'Monitor'),
        protect: t('app.serverHealthCard.protect', 'Protect'),
        full: t('app.serverHealthCard.full', 'Full'),
    }[level];

    const columns = [
        { key: 'name', headerKey: 'app.serverHealthCard.service', header: 'Service', sortable: false, hideable: false, render: (c) => c.name },
        { key: 'kind', headerKey: 'app.serverHealthCard.kind', header: 'Kind', sortable: false, cellClassName: 'sk-cell-dim', render: (c) => c.kind || '—' },
        { key: 'status', headerKey: 'common.labels.status', header: 'Status', sortable: false, render: (c) => <Pill kind={checkKind(c.status)}>{c.status}</Pill> },
        { key: 'detail', headerKey: 'app.serverHealthCard.detail', header: 'Detail', sortable: false, cellClassName: 'sk-cell-dim', render: (c) => c.detail || '—' },
        { key: 'checked', headerKey: 'app.serverHealthCard.lastChecked', header: 'Last checked', sortable: false, cellClassName: 'sk-cell-dim', render: (c) => (c.checked_at ? formatDateTime(c.checked_at) : '—') },
    ];

    return (
        <>
            <div className="info-card">
                <h3>{t('app.serverHealthCard.permissionLevel', 'Permission level')}</h3>
                <InfoList className="server-info-list">
                    <InfoItem label={t('app.serverHealthCard.level', 'Level')}>
                        <Pill kind={levelKind(level)} dot={false}>{levelName}</Pill>
                        {!server.permission_level && (
                            <span className="text-muted"> {t('app.serverHealthCard.legacyAgent', 'Not reported (legacy agent, treated as Full)')}</span>
                        )}
                    </InfoItem>
                    <InfoItem
                        label={t('app.serverHealthCard.changedAt', 'Last change')}
                        value={server.permission_level_updated_at ? formatDateTime(server.permission_level_updated_at) : '—'}
                    />
                </InfoList>
                {mismatch && (
                    <p className="form-hint">
                        {t('app.serverHealthCard.mismatch', 'The install command requested a different level than the agent reports. The agent\'s level is the one in effect.')}
                    </p>
                )}
                <p className="text-muted">
                    {t('app.serverHealthCard.howToChange', 'This level is enforced by the agent and cannot be changed from the panel. To change it, run this on the server as root:')}
                </p>
                <code>{SET_HINT}</code>
            </div>

            <div className="info-card">
                <h3>{t('app.serverHealthCard.health', 'Health')} <Pill kind={health.kind}>{health.code}</Pill></h3>
                {server.last_report_at && (
                    <p className="text-muted">
                        {t('app.serverHealthCard.lastReport', 'Last report')}: {formatDateTime(server.last_report_at)}
                    </p>
                )}
                {alerts.length > 0 && (
                    <ul className="notifications-list">
                        {alerts.map((a) => <li key={a.id}>{a.detail}</li>)}
                    </ul>
                )}
                <DataTable
                    columns={columns}
                    data={server.service_checks || []}
                    keyField="name"
                    emptyTitle={t('app.serverHealthCard.noChecks', 'No service checks reported yet.')}
                    emptyMessage=""
                />
            </div>
        </>
    );
};

export default ServerHealthCard;
