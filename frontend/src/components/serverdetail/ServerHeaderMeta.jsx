import { useTranslation } from 'react-i18next';
import FavoriteStar from '@/components/FavoriteStar';
import InfoTip from '@/components/InfoTip';
import CopyButton from '@/components/CopyButton';
import { StatusDot } from '../ds';
import { serverStatusKind } from './serverDetailData';

// Header meta: [status dot] [(i) with endpoint + ID] [star]. Everything the
// header used to spell out lives behind the (i).
export default function ServerHeaderMeta({ server }) {
    const { t } = useTranslation();
    const status = server.status || 'pending';
    const endpoint = server.hostname || server.ip_address || t('app.serverDetail.noEndpointConfigured', 'No endpoint configured');
    return (
        <>
            <StatusDot kind={serverStatusKind(status)} label={status.charAt(0).toUpperCase() + status.slice(1)} />
            <InfoTip size="md" title={t('app.serverDetail.details', 'Server details')}>
                <dl className="server-detail-info">
                    <dt>{t('common.labels.status', 'Status')}</dt>
                    <dd>{status}</dd>
                    <dt>{t('app.serverDetail.endpoint', 'Endpoint')}</dt>
                    <dd>{endpoint}</dd>
                    <dt>{t('app.serverDetail.serverId', 'ID')}</dt>
                    <dd className="server-detail-info__id">
                        <code>{server.id}</code>
                        <CopyButton value={String(server.id)} label={t('app.serverDetail.copyId', 'Copy ID')} />
                    </dd>
                </dl>
            </InfoTip>
            <FavoriteStar type="server" id={server.id} path={`/servers/${server.id}`} label={server.name} />
        </>
    );
}
