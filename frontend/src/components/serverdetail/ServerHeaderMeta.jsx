import { useTranslation } from 'react-i18next';
import FavoriteStar from '@/components/FavoriteStar';
import CopyButton from '@/components/CopyButton';
import DetailHeaderMeta from '@/components/detail/DetailHeaderMeta';
import { serverStatusKind } from './serverDetailData';

// Header meta: [status dot] [(i) with endpoint + ID] [star]. Everything the
// header used to spell out lives behind the (i).
export default function ServerHeaderMeta({ server }) {
    const { t } = useTranslation();
    const status = server.status || 'pending';
    const endpoint = server.hostname || server.ip_address || t('app.serverDetail.noEndpointConfigured', 'No endpoint configured');
    return (
        <DetailHeaderMeta
            status={{ kind: serverStatusKind(status), label: status.charAt(0).toUpperCase() + status.slice(1) }}
            infoTitle={t('app.serverDetail.details', 'Server details')}
            rows={[
                { label: t('common.labels.status', 'Status'), value: status },
                { label: t('app.serverDetail.endpoint', 'Endpoint'), value: endpoint },
                {
                    label: t('app.serverDetail.serverId', 'ID'),
                    value: (
                        <span className="sk-detail-info__id">
                            <code>{server.id}</code>
                            <CopyButton value={String(server.id)} label={t('app.serverDetail.copyId', 'Copy ID')} />
                        </span>
                    ),
                },
            ]}
            favorite={<FavoriteStar type="server" id={server.id} path={`/servers/${server.id}`} label={server.name} />}
        />
    );
}
