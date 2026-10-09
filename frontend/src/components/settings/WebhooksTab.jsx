import { useCallback, useEffect, useMemo, useState  } from 'react';
import api from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import Modal from '@/components/Modal';
import { DataTable } from '@/components/ds';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Plus, MoreVertical, RefreshCw, ArrowRightLeft } from 'lucide-react';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import CopyField from '@/components/CopyField';
import { useTranslation } from 'react-i18next';
import { errorReason } from '@/utils/errorMessage';

const formatDate = (d) => (d ? new Date(d).toLocaleString() : '—');

/**
 * Webhooks — receive, verify, and forward inbound webhooks.
 *
 * Lives as a Settings → Admin tab rather than a top-level page: it's server
 * configuration, not a daily operations surface, and it sits next to the
 * outbound notification subscriptions it complements. /webhooks redirects here.
 * (Secret storage moved to the Organization tab group at /vaults earlier.)
 */
export default function WebhooksTab() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [endpoints, setEndpoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loaded, setLoaded] = useState(false);

    const [endpointForm, setEndpointForm] = useState({ open: false, name: '', forward_url: '', filter_paths: '', retry_count: 3 });
    const [selectedEndpoint, setSelectedEndpoint] = useState(null);
    const [deliveries, setDeliveries] = useState([]);
    const [regeneratedSecret, setRegeneratedSecret] = useState(null);

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const e = await api.listWebhookEndpoints();
            setEndpoints(e.endpoints || []);
            setLoaded(true);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);


    async function createEndpoint(e) {
        e.preventDefault();
        try {
            const paths = endpointForm.filter_paths.split('\n').map(s => s.trim()).filter(Boolean);
            await api.createWebhookEndpoint({
                name: endpointForm.name,
                forward_url: endpointForm.forward_url,
                filter_paths: paths,
                retry_count: parseInt(endpointForm.retry_count, 10) || 3,
            });
            setEndpointForm({ open: false, name: '', forward_url: '', filter_paths: '', retry_count: 3 });
            loadAll();
            toast.success(t('app.webhooksTab.endpointCreated', 'Endpoint created'));
        } catch (err) {
            toast.error(t('app.webhooksTab.failedToCreateEndpoint', "Couldn't create the endpoint. {{message}}", { message: errorReason(err) }));
        }
    }

    async function deleteEndpoint(id) {
        const confirmed = await confirm({
            title: t('app.webhooksTab.deleteWebhookEndpoint', 'Delete webhook endpoint'),
            message: t('app.webhooksTab.deleteThisWebhookEndpointInboundDeliveries', 'Delete this webhook endpoint? Inbound deliveries to its URL will stop being accepted.'),
        });
        if (!confirmed) return;
        try {
            await api.deleteWebhookEndpoint(id);
            if (selectedEndpoint?.id === id) setSelectedEndpoint(null);
            loadAll();
            toast.success(t('app.webhooksTab.endpointDeleted', 'Endpoint deleted'));
        } catch (err) {
            toast.error(t('app.webhooksTab.failedToDeleteEndpoint', "Couldn't delete the endpoint. {{message}}", { message: errorReason(err) }));
        }
    }

    async function regenerateSecret(id) {
        try {
            const data = await api.regenerateWebhookSecret(id);
            setRegeneratedSecret({ name: data.endpoint.name, secret: data.secret });
            loadAll();
            if (selectedEndpoint?.id === id) openEndpoint(data.endpoint.id);
        } catch (err) {
            toast.error(t('app.webhooksTab.regenerateFailed', "Couldn't regenerate the secret. {{message}}", { message: errorReason(err) }));
        }
    }

    async function openEndpoint(id) {
        try {
            const { endpoint } = await api.getWebhookEndpoint(id);
            const { deliveries } = await api.listWebhookDeliveries(id, { limit: 50 });
            setSelectedEndpoint(endpoint);
            setDeliveries(deliveries || []);
        } catch (err) {
            toast.error(t('app.webhooksTab.failedToLoadEndpoint', "Couldn't load the endpoint. {{message}}", { message: errorReason(err) }));
        }
    }

    async function replayDelivery(deliveryId) {
        try {
            // A failed forward answers 200 with success:false — the replay ran,
            // the target refused it. Only transport/authz errors throw.
            const res = await api.replayWebhookDelivery(deliveryId);
            openEndpoint(selectedEndpoint.id);
            if (res && res.success === false) {
                toast.error(t('app.webhooksTab.replayedButTheForwardTargetDid', 'Replayed, but the forward target did not accept it'));
            } else {
                toast.success(t('app.webhooksTab.replayedDelivery', 'Replayed delivery'));
            }
        } catch (err) {
            toast.error(t('app.webhooksTab.replayFailed', "Couldn't replay the delivery. {{message}}", { message: errorReason(err) }));
        }
    }

    const receiverUrl = useMemo(() => {
        if (!selectedEndpoint) return '';
        const base = window.location.origin.replace(/\/$/, '');
        return `${base}/api/v1/webhooks/receive/${selectedEndpoint.slug}`;
    }, [selectedEndpoint]);

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.webhooksTab.loadingWebhooks', 'Loading webhooks…')} />;
    }

    if (loadError && !loaded) {
        return (
            <ErrorState
                title={t('app.webhooksTab.couldntLoadWebhooks', "Couldn't load webhook endpoints.")}
                error={loadError}
                onRetry={loadAll}
            />
        );
    }

    // Both lists sit inside a card, so their tables run flush in it.
    const endpointColumns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            cellClassName: 'settings-webhook-name',
            render: (ep) => ep.name,
        },
        {
            key: 'slug',
            headerKey: 'app.webhooksTab.slug', header: 'Slug',
            cellClassName: 'sk-cell-mono',
            render: (ep) => ep.slug,
        },
        {
            key: 'forward_url',
            headerKey: 'app.webhooksTab.forwardUrl', header: 'Forward URL',
            cellClassName: 'sk-cell-mono',
            render: (ep) => ep.forward_url || '—',
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            render: (ep) => (
                <Badge variant={ep.is_active ? 'default' : 'secondary'}>
                    {ep.is_active ? t('app.webhooksTab.active', 'Active') : t('app.webhooksTab.inactive', 'Inactive')}
                </Badge>
            ),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            cellClassName: 'settings-webhook-actions',
            render: (ep) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon"><MoreVertical size={14} /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEndpoint(ep.id)}>{t('app.webhooksTab.viewDeliveries', 'View deliveries')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => regenerateSecret(ep.id)}><RefreshCw size={12} className="settings-webhook-action-icon" /> {t('app.webhooksTab.regenerateSecret', 'Regenerate secret')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => deleteEndpoint(ep.id)}>{t('common.actions.delete', 'Delete')}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ];

    const deliveryColumns = [
        {
            key: 'event_id',
            headerKey: 'app.webhooksTab.eventId', header: 'Event ID',
            cellClassName: 'sk-cell-mono settings-webhook-event-id',
            render: (d) => d.event_id,
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            render: (d) => <WebhookStatusBadge status={d.status} />,
        },
        {
            key: 'signature_valid',
            headerKey: 'app.webhooksTab.signature', header: 'Signature',
            render: (d) => (d.signature_valid === true
                ? t('app.webhooksTab.valid', 'Valid')
                : d.signature_valid === false ? t('app.webhooksTab.invalid', 'Invalid') : '—'),
        },
        {
            key: 'received_at',
            headerKey: 'app.webhooksTab.received', header: 'Received',
            cellClassName: 'sk-cell-dim',
            render: (d) => formatDate(d.received_at),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            cellClassName: 'settings-webhook-actions',
            render: (d) => (
                <Button variant="ghost" size="icon" onClick={() => replayDelivery(d.id)} title={t('app.webhooksTab.replay', 'Replay')}>
                    <ArrowRightLeft size={14} />
                </Button>
            ),
        },
    ];

    return (
        <div className="settings-webhooks">
            {!selectedEndpoint ? (
                <Card>
                    <CardHeader>
                        <div className="secrets__header">
                            <div>
                                <CardTitle>{t('app.webhooksTab.webhookEndpoints', 'Webhook endpoints')}</CardTitle>
                                <CardDescription>{t('app.webhooksTab.receiveVerifyAndForwardInboundWebhooks', 'Receive, verify, and forward inbound webhooks.')}</CardDescription>
                            </div>
                            <Button onClick={() => setEndpointForm({ open: true, name: '', forward_url: '', filter_paths: '', retry_count: 3 })}>
                                <Plus size={14} /> {t('app.webhooksTab.newEndpoint', 'New endpoint')}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadError && <ErrorState compact error={loadError} onRetry={loadAll} />}
                        {endpoints.length === 0 ? (
                            <EmptyState title={t('app.webhooksTab.noWebhookEndpoints', 'No webhook endpoints')} description={t('app.webhooksTab.createAnEndpointToReceiveWebhooks', 'Create an endpoint to receive webhooks.')} />
                        ) : (
                            <DataTable
                                columns={endpointColumns}
                                data={endpoints}
                                keyField="id"
                                sortable={false}
                                columnMenu={false}
                                onRowClick={(ep) => openEndpoint(ep.id)}
                                className="sk-dtable-wrap--flush"
                            />
                        )}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <div className="secrets__header">
                            <div>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedEndpoint(null)}>{t('app.webhooksTab.back', '← Back')}</Button>
                                <CardTitle>{selectedEndpoint.name}</CardTitle>
                                <CardDescription>
                                    {t('app.webhooksTab.postTo', 'POST to')} <code className="secrets__code">{receiverUrl}</code>
                                </CardDescription>
                            </div>
                            <Button variant="outline" onClick={() => regenerateSecret(selectedEndpoint.id)}>
                                <RefreshCw size={14} /> {t('app.webhooksTab.regenerateSecret', 'Regenerate secret')}
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {deliveries.length === 0 ? (
                            <EmptyState title={t('app.webhooksTab.noDeliveriesYet', 'No deliveries yet')} description={t('app.webhooksTab.sendATestPayloadToSee', 'Send a test payload to see it here.')} />
                        ) : (
                            <DataTable
                                columns={deliveryColumns}
                                data={deliveries}
                                keyField="id"
                                sortable={false}
                                columnMenu={false}
                                className="sk-dtable-wrap--flush"
                            />
                        )}
                    </CardContent>
                </Card>
            )}

            <Modal open={endpointForm.open} onClose={() => setEndpointForm({ ...endpointForm, open: false })} title={t('app.webhooksTab.newWebhookEndpoint', 'New webhook endpoint')}>
                <p className="sk-modal__subtitle">{t('app.webhooksTab.createASlugSecretAndOptional', 'Create a slug, secret, and optional forward URL.')}</p>
                <form onSubmit={createEndpoint} className="settings-webhook-form">
                        <div>
                            <Label htmlFor="epName">{t('common.labels.name', 'Name')}</Label>
                            <Input id="epName" value={endpointForm.name} onChange={(e) => setEndpointForm({ ...endpointForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="epForward">{t('app.webhooksTab.forwardUrlOptional', 'Forward URL (optional)')}</Label>
                            <Input id="epForward" type="url" value={endpointForm.forward_url} onChange={(e) => setEndpointForm({ ...endpointForm, forward_url: e.target.value })} />
                        </div>
                        <div>
                            <Label htmlFor="epFilters">{t('app.webhooksTab.filterPathsOnePerLineOptional', 'Filter paths (one per line, optional)')}</Label>
                            <Textarea id="epFilters" value={endpointForm.filter_paths} onChange={(e) => setEndpointForm({ ...endpointForm, filter_paths: e.target.value })} placeholder={t('app.webhooksTab.repositoryFullNameAction', 'repository.full_name\naction')} />
                        </div>
                        <div>
                            <Label htmlFor="epRetry">{t('app.webhooksTab.retries', 'Retries')}</Label>
                            <Input id="epRetry" type="number" min={0} max={10} value={endpointForm.retry_count} onChange={(e) => setEndpointForm({ ...endpointForm, retry_count: e.target.value })} />
                        </div>
                        <div className="modal-actions">
                            <Button type="submit">{t('app.webhooksTab.createEndpoint', 'Create endpoint')}</Button>
                        </div>
                    </form>
            </Modal>

            <Modal
                open={!!regeneratedSecret}
                onClose={() => setRegeneratedSecret(null)}
                title={t('app.webhooksTab.webhookSecret', 'Webhook secret')}
                footer={(
                    <Button onClick={() => setRegeneratedSecret(null)}>{t('common.actions.done', 'Done')}</Button>
                )}
            >
                <p className="sk-modal__subtitle">{t('app.webhooksTab.copyThisSecretNowItWill', 'Copy this secret now. It will not be shown again.')}</p>
                <div className="settings-webhook-secret-field">
                        <Label>{t('app.webhooksTab.endpoint', 'Endpoint')}</Label>
                        <Input readOnly value={regeneratedSecret?.name || ''} />
                        <CopyField label={t('app.webhooksTab.secret', 'Secret')} value={regeneratedSecret?.secret || ''} secret />
                    </div>
            </Modal>
        </div>
    );
}

function WebhookStatusBadge({ status }) {
    const variant = status === 'forwarded' ? 'default' : status === 'received' ? 'secondary' : status === 'filtered' ? 'outline' : 'destructive';
    return <Badge variant={variant}>{status}</Badge>;
}
