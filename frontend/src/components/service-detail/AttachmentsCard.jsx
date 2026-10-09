import { useCallback, useEffect, useState } from 'react';
import { Plug, Unplug, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '../../contexts/useToast.js';
import { useAuth } from '../../contexts/useAuth.js';
import { useConfirm } from '@/hooks/useConfirm';
import { toastError } from '@/utils/errorMessage';

// Kind -> the template installed when none exists yet. Must match what the
// backend accepts for that kind (app_attachment_service.CONNECTION_KINDS).
const DEFAULT_TEMPLATES = {
    cache: { id: 'redis', name: 'Redis' },
    storage: { id: 'garage', name: 'Garage' },
    queue: { id: 'rabbitmq', name: 'RabbitMQ' },
    metrics: { id: 'prometheus', name: 'Prometheus' },
    logs: { id: 'loki', name: 'Loki' },
    tracing: { id: 'otel-collector', name: 'OpenTelemetry Collector' },
    traces: { id: 'jaeger', name: 'Jaeger' },
};
// Until the server says otherwise (a Grafana install also takes metrics/logs).
const DEFAULT_KINDS = ['cache', 'storage', 'queue', 'tracing'];

// "Attach → Cache / Storage / Queue" (plan 86 §C4): reuse an installed
// service or install one, write the env references, then offer a redeploy.
export default function AttachmentsCard({ app }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const { isAdmin } = useAuth();
    const [attachments, setAttachments] = useState(null);
    const [kinds, setKinds] = useState(DEFAULT_KINDS);
    const [kind, setKind] = useState(null);
    const [choices, setChoices] = useState(null);
    const [selected, setSelected] = useState('');
    const [busy, setBusy] = useState(false);
    const [needsRedeploy, setNeedsRedeploy] = useState(false);

    // Each component's failure mode, where the operator decides. Mirrors the
    // API's `failure_mode` (app_attachment_service.FAILURE_MODES), translated.
    const failureMode = (k) => ({
        cache: t('app.attachments.failureCache', 'Cached data can be stale; invalidate on write, and never keep the only copy in a cache.'),
        storage: t('app.attachments.failureStorage', 'Objects outlive the service: detaching keeps the bucket and its data.'),
        queue: t('app.attachments.failureQueue', 'A job can be delivered twice; make jobs safe to run again.'),
        metrics: t('app.attachments.failureMetrics', 'Grafana shows what Prometheus kept: past its retention, history is gone.'),
        logs: t('app.attachments.failureLogs', 'Grafana shows what Loki kept: past its retention, logs are gone.'),
        tracing: t('app.attachments.failureTracing', 'Spans are sampled and batched: a trace can be partial, and a crash can lose the last batch.'),
        traces: t('app.attachments.failureTraces', 'Jaeger keeps traces on its own disk; losing that volume loses the history.'),
    }[k]);

    const kindLabel = (k) => ({
        cache: t('app.attachments.kindCache', 'Cache'),
        storage: t('app.attachments.kindStorage', 'Storage'),
        queue: t('app.attachments.kindQueue', 'Queue'),
        metrics: t('app.attachments.kindMetrics', 'Metrics'),
        logs: t('app.attachments.kindLogs', 'Logs'),
        tracing: t('app.attachments.kindTracing', 'Tracing'),
        traces: t('app.attachments.kindTraces', 'Trace store'),
    }[k]);

    const load = useCallback(() => {
        api.getAppAttachments(app.id)
            .then((data) => {
                setAttachments(data.attachments || []);
                if (data.kinds?.length) setKinds(data.kinds);
            })
            .catch(() => setAttachments([]));
    }, [app.id]);

    useEffect(() => { load(); }, [load]);

    async function openKind(next) {
        setKind(next);
        setChoices(null);
        setSelected('');
        try {
            const data = await api.getAttachableServices(next);
            setChoices(data);
            if (data.services?.length) setSelected(String(data.services[0].id));
        } catch (err) {
            toastError(toast, t('app.attachments.couldntLoadAttachable', "Couldn't load the services you can attach."), err);
            setKind(null);
        }
    }

    async function attach(serviceId) {
        setBusy(true);
        try {
            await api.attachService(app.id, kind, serviceId);
            toast.success(t('app.attachments.attached', 'Attached. Redeploy to apply.'));
            setNeedsRedeploy(true);
            setKind(null);
            load();
        } catch (err) {
            toastError(toast, t('app.attachments.couldntAttach', "Couldn't attach the service."), err);
        } finally {
            setBusy(false);
        }
    }

    async function installAndAttach() {
        const templateId = DEFAULT_TEMPLATES[kind].id;
        setBusy(true);
        try {
            const installed = await api.installTemplate(
                templateId, `${app.name}-${kind}`, {}, { wait: true });
            if (installed.job?.status === 'failed') {
                throw new Error(installed.job.error_message || t('app.attachments.installFailed', "Couldn't install it."));
            }
            const serviceId = installed.job?.app_id;
            if (!serviceId) throw new Error(t('app.attachments.installNoId', 'Installed, but the new service could not be found. Attach it from the list.'));
            await attach(serviceId);
        } catch (err) {
            toastError(toast, t('app.attachments.couldntInstallAndAttach', "Couldn't install and attach the service."), err);
            setBusy(false);
        }
    }

    async function detach(row) {
        if (!await confirm({
            title: t('app.attachments.detachTitle', 'Detach {{name}}?', { name: row.service_name }),
            message: row.kind === 'storage'
                ? t('app.attachments.detachStorage', 'The service loses its key and S3 settings. The bucket and its files are kept.')
                : t('app.attachments.detachConnection', 'The service loses the settings that point at the attached one.'),
            confirmText: t('app.attachments.detach', 'Detach'),
        })) return;
        try {
            const res = await api.detachService(app.id, row.id);
            if (res.warning) toast.warning(res.warning);
            setNeedsRedeploy(true);
            load();
        } catch (err) {
            toastError(toast, t('app.attachments.couldntDetach', "Couldn't detach the service."), err);
        }
    }

    async function redeploy() {
        setBusy(true);
        try {
            await api.deployApp(app.id);
            toast.success(t('app.attachments.redeploying', 'Redeploy started'));
            setNeedsRedeploy(false);
        } catch (err) {
            toastError(toast, t('app.attachments.couldntRedeploy', "Couldn't redeploy the service."), err);
        } finally {
            setBusy(false);
        }
    }

    const attachedKinds = new Set((attachments || []).map((a) => a.kind));
    const open = kinds.filter((k) => !attachedKinds.has(k));

    return (
        <div className="overview-tab__card overview-tab__card--full attachments">
            <div className="overview-tab__card-header-row">
                <h3 className="overview-tab__card-title">{t('app.attachments.title', 'Attached services')}</h3>
                {open.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Plug size={14} />
                                {t('app.attachments.attach', 'Attach')}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {open.map((k) => (
                                <DropdownMenuItem key={k} onSelect={() => openKind(k)}>
                                    {kindLabel(k)}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>

            {needsRedeploy && (
                <div className="attachments__redeploy">
                    <span>{t('app.attachments.redeployHint', 'The service picks up the change on its next deploy.')}</span>
                    <Button size="sm" onClick={redeploy} disabled={busy}>
                        <RotateCw size={14} />
                        {t('app.attachments.redeployNow', 'Redeploy now')}
                    </Button>
                </div>
            )}

            {attachments?.length ? (
                <ul className="attachments__list">
                    {attachments.map((row) => (
                        <li key={row.id} className="attachments__row">
                            <span className="attachments__kind">{kindLabel(row.kind)}</span>
                            <span className="attachments__service">{row.service_name}</span>
                            <code className="attachments__env">
                                {row.kind === 'storage' && `S3_BUCKET=${row.bucket}`}
                                {(row.kind === 'metrics' || row.kind === 'logs')
                                    && t('app.attachments.grafanaDataSource', 'Grafana data source')}
                                {row.env_keys.length > 0 && row.kind !== 'storage' && row.env_keys.join(', ')}
                            </code>
                            <Button variant="ghost" size="sm" onClick={() => detach(row)}
                                aria-label={t('app.attachments.detach', 'Detach')}>
                                <Unplug size={14} />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="attachments__empty">
                    {t('app.attachments.empty', 'Nothing attached. Attach a cache, object storage or a queue and the service gets its connection settings as environment variables.')}
                </p>
            )}

            <Modal
                open={kind !== null}
                onClose={() => !busy && setKind(null)}
                title={kind ? t('app.attachments.attachKind', 'Attach {{kind}}', { kind: kindLabel(kind).toLowerCase() }) : ''}
                footer={choices && (choices.services?.length ? (
                    <Button onClick={() => attach(Number(selected))} disabled={busy || !selected}>
                        {t('app.attachments.attach', 'Attach')}
                    </Button>
                ) : isAdmin && (
                    <Button onClick={installAndAttach} disabled={busy}>
                        {busy
                            ? t('app.attachments.installing', 'Installing…')
                            : t('app.attachments.installAndAttach', 'Install {{template}} and attach', { template: DEFAULT_TEMPLATES[kind].name })}
                    </Button>
                ))}
            >
                {choices === null ? (
                    <p>{t('common.loading', 'Loading…')}</p>
                ) : (
                    <div className="attachments__dialog">
                        {choices.services?.length ? (
                            <Select value={selected} onValueChange={setSelected}>
                                <SelectTrigger aria-label={t('app.attachments.service', 'Service')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {choices.services.map((s) => (
                                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <p>
                                {isAdmin
                                    ? t('app.attachments.noneInstalled', 'No {{kind}} service is installed yet. ServerKit can install one now.', { kind: kindLabel(kind).toLowerCase() })
                                    : t('app.attachments.noneInstalledAskAdmin', 'No {{kind}} service is installed yet. Ask an admin to install one.', { kind: kindLabel(kind).toLowerCase() })}
                            </p>
                        )}
                        <p className="attachments__failure-mode">{failureMode(kind)}</p>
                    </div>
                )}
            </Modal>
        </div>
    );
}
