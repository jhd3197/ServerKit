import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pill, SegControl, serviceStatusKind } from '../ds';
import EmptyState from '../EmptyState';
import { AlertTriangle, CheckCircle2, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Human label for an ingress plane, used in the mismatch banner copy.
const PLANE_LABEL = {
    nginx: 'host Nginx',
    proxy_stack: 'the proxy stack',
};

// Managed reverse-proxy stack panel for a server.
//
// Host nginx is the default (and the better choice for PHP/WordPress). This
// panel lets an operator opt into a Dockerized proxy — Traefik or Caddy —
// deployed as a Compose stack, preview the generated compose, edit a custom
// config snippet, and (best-effort) regenerate / restart the stack.

const PROXY_OPTIONS = [
    { value: 'nginx', labelKey: 'app.proxyStackPanel.nginx', label: 'Nginx', sub: 'Host default' },
    { value: 'traefik', labelKey: 'app.proxyStackPanel.traefik', label: 'Traefik', sub: 'Docker stack' },
    { value: 'caddy', labelKey: 'app.proxyStackPanel.caddy', label: 'Caddy', sub: 'Docker stack' },
];

const ProxyStackPanel = ({ serverId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [stack, setStack] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Local working state — the selected type may differ from the saved one
    // until the user clicks "Switch".
    const [selectedType, setSelectedType] = useState('nginx');
    const [snippet, setSnippet] = useState('');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    // Ingress-plane audit: which apps expect a plane that disagrees with the
    // server's active proxy. Refreshed on mount and after any proxy mutation.
    const [audit, setAudit] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getServerProxy(serverId);
            setStack(data);
            setSelectedType(data.proxy_type || 'nginx');
            setSnippet(data.custom_snippet || '');
            setError(null);
        } catch (err) {
            setError(err.message || 'Failed to load proxy configuration');
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => {
        load();
    }, [load]);

    // Best-effort ingress-plane audit. Never blocks the panel; on failure the
    // banner simply stays hidden.
    const loadAudit = useCallback(async () => {
        try {
            const data = await api.getServerIngressAudit(serverId);
            setAudit(data);
        } catch (err) {
            console.error('Failed to load ingress audit:', err);
            setAudit(null);
        }
    }, [serverId]);

    useEffect(() => {
        loadAudit();
    }, [loadAudit]);

    // Refresh the compose preview whenever the selected type changes.
    const loadPreview = useCallback(async (proxyType) => {
        try {
            const data = await api.getServerProxyComposePreview(serverId, { proxyType });
            setPreview(data);
        } catch (err) {
            console.error('Failed to load compose preview:', err);
            setPreview(null);
        }
    }, [serverId]);

    useEffect(() => {
        loadPreview(selectedType);
    }, [selectedType, loadPreview]);

    const isDirtyType = stack && selectedType !== stack.proxy_type;
    const isDirtySnippet = stack && snippet !== (stack.custom_snippet || '');

    async function handleSwitch() {
        setBusy(true);
        try {
            await api.switchServerProxy(serverId, selectedType);
            toast.success(t('app.proxyStackPanel.switchedTo', 'Switched to {{selectedType}}', { selectedType: selectedType }));
            await load();
            await loadAudit();
        } catch (err) {
            toastError(toast, t('app.proxyStackPanel.failedToSwitchProxy', "Couldn't switch the proxy."), err);
        } finally {
            setBusy(false);
        }
    }

    async function handleSaveSnippet() {
        setBusy(true);
        try {
            await api.configureServerProxy(serverId, { custom_snippet: snippet });
            toast.success(t('app.proxyStackPanel.customSnippetSaved', 'Custom snippet saved'));
            await load();
        } catch (err) {
            toastError(toast, t('app.proxyStackPanel.failedToSaveSnippet', "Couldn't save the snippet."), err);
        } finally {
            setBusy(false);
        }
    }

    async function handleRegenerate() {
        setBusy(true);
        try {
            const res = await api.regenerateServerProxy(serverId);
            if (res.success) {
                toast.success(res.reloaded ? t('app.proxyStackPanel.configRegeneratedAndReloaded', 'Config regenerated and reloaded') : t('app.proxyStackPanel.configRegenerated', 'Config regenerated'));
            } else {
                toastError(toast, t('app.proxyStackPanel.regenerateFailed', "Couldn't regenerate the config."), res.error);
            }
            await load();
            await loadAudit();
        } catch (err) {
            toastError(toast, t('app.proxyStackPanel.failedToRegenerateConfig', "Couldn't regenerate the config."), err);
        } finally {
            setBusy(false);
        }
    }

    async function handleDeploy() {
        setBusy(true);
        try {
            const res = await api.configureServerProxy(serverId, {
                proxy_type: selectedType,
                deploy: true,
            });
            const deploy = res.deploy;
            if (deploy && deploy.success === false) {
                toastError(toast, t('app.proxyStackPanel.deployFailedBestEffort', "Couldn't deploy the stack (best effort)."), deploy.error);
            } else {
                toast.success(t('app.proxyStackPanel.stackDeployed', 'Stack deployed'));
            }
            await load();
            await loadAudit();
        } catch (err) {
            toastError(toast, t('app.proxyStackPanel.failedToDeployStack', "Couldn't deploy the stack."), err);
        } finally {
            setBusy(false);
        }
    }

    if (loading) {
        return <EmptyState loading loadingVariant="form" title={t('app.proxyStackPanel.loadingProxyConfiguration', 'Loading proxy configuration')} />;
    }

    if (error) {
        return (
            <div className="proxy-panel">
                <div className="proxy-panel__error">{error}</div>
                <Button variant="outline" onClick={load}>{t('common.actions.retry', 'Retry')}</Button>
            </div>
        );
    }

    const isNginx = selectedType === 'nginx';
    const savedIsNginx = stack?.proxy_type === 'nginx';

    return (
        <div className="proxy-panel">
            <header className="proxy-panel__header">
                <div className="proxy-panel__title">
                    <Network size={18} />
                    <h3>{t('app.proxyStackPanel.reverseProxy', 'Reverse proxy')}</h3>
                </div>
                <div className="proxy-panel__status">
                    <span className="proxy-panel__status-label">{t('common.labels.status', 'Status')}</span>
                    <Pill kind={serviceStatusKind(stack?.status)}>
                        {savedIsNginx ? 'host nginx' : (stack?.status || 'unknown')}
                    </Pill>
                </div>
            </header>

            <p className="proxy-panel__hint">
                {t('app.proxyStackPanel.hostNginxIsTheDefaultAnd', 'Host Nginx is the default and is recommended for PHP/WordPress. You can opt into a Dockerized Traefik or Caddy proxy deployed as a Compose stack.')}
            </p>

            {audit && audit.mismatch_count > 0 && (
                <div className="proxy-panel__ingress-warning" role="alert">
                    <div className="proxy-panel__ingress-warning-head">
                        <AlertTriangle size={16} />
                        <strong>
                            {t('app.proxyStackPanel.servicesOnWrongPlane', { count: audit.mismatch_count, defaultValue_one: '1 service on the wrong ingress plane', defaultValue_other: '{{count}} services on the wrong ingress plane' })}
                        </strong>
                    </div>
                    <p className="proxy-panel__ingress-warning-text">
                        {t('app.proxyStackPanel.thisServerSActiveProxyIs', 'This server\'s active proxy is')} <strong>{audit.proxy_type}</strong>{t('app.proxyStackPanel.whichExpects', ', which expects')} <strong>{PLANE_LABEL[audit.expected_plane] || audit.expected_plane}</strong>.
                        The apps below expect the other plane:
                    </p>
                    <ul className="proxy-panel__ingress-list">
                        {(audit.apps || []).filter(a => a.mismatch).map(a => (
                            <li key={a.id} className="proxy-panel__ingress-item">
                                <Link to={`/apps/${a.id}`} className="proxy-panel__ingress-link">
                                    {a.name}
                                </Link>
                                {a.reason && <span className="proxy-panel__ingress-reason">{a.reason}</span>}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {audit && audit.mismatch_count === 0 && audit.app_count > 0 && (
                <div className="proxy-panel__ingress-ok">
                    <CheckCircle2 size={14} />
                    {t('app.proxyStackPanel.allServicesAligned', { count: audit.app_count, defaultValue_one: "The 1 service is aligned with this server's ingress plane.", defaultValue_other: "All {{count}} services are aligned with this server's ingress plane." })}
                </div>
            )}

            <section className="proxy-panel__section">
                <label className="proxy-panel__label">{t('app.proxyStackPanel.proxyType', 'Proxy type')}</label>
                <SegControl
                    options={PROXY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                    value={selectedType}
                    onChange={setSelectedType}
                />
                <div className="proxy-panel__actions">
                    <Button onClick={handleSwitch} disabled={!isDirtyType || busy}>
                        {isDirtyType ? `Switch to ${selectedType}` : 'No change'}
                    </Button>
                    {!isNginx && (
                        <Button variant="outline" onClick={handleDeploy} disabled={busy}>
                            {t('app.proxyStackPanel.deployRestart', 'Deploy / restart')}
                        </Button>
                    )}
                    {!savedIsNginx && (
                        <Button variant="outline" onClick={handleRegenerate} disabled={busy}>
                            {t('app.proxyStackPanel.regenerateConfig', 'Regenerate config')}
                        </Button>
                    )}
                </div>
            </section>

            {!isNginx && (
                <section className="proxy-panel__section">
                    <label className="proxy-panel__label">{t('app.proxyStackPanel.composePreview', 'Compose preview')}</label>
                    {preview?.compose ? (
                        <pre className="proxy-panel__code" aria-label={t('app.proxyStackPanel.dockerComposePreview', 'docker-compose preview')}>
                            {preview.compose}
                        </pre>
                    ) : (
                        <div className="proxy-panel__empty">{t('app.proxyStackPanel.noComposeGeneratedForThisType', 'No compose generated for this type.')}</div>
                    )}
                </section>
            )}

            {!isNginx && (
                <section className="proxy-panel__section">
                    <label className="proxy-panel__label">{t('app.proxyStackPanel.customConfigSnippet', 'Custom config snippet')}</label>
                    <Textarea
                        rows={6}
                        value={snippet}
                        onChange={(e) => setSnippet(e.target.value)}
                        placeholder={t('app.proxyStackPanel.appendedToTheGeneratedProxyConfig', 'Appended to the generated proxy config (Caddyfile / Traefik dynamic).')}
                        className="font-mono"
                    />
                    <div className="proxy-panel__actions">
                        <Button
                            variant="outline"
                            onClick={handleSaveSnippet}
                            disabled={!isDirtySnippet || busy}
                        >
                            {t('app.proxyStackPanel.saveSnippet', 'Save snippet')}
                        </Button>
                    </div>
                </section>
            )}

            {isNginx && (
                <EmptyState
                    icon={Network}
                    title={t('app.proxyStackPanel.hostNginxIsActive', 'Host Nginx is active')}
                    description={t('app.proxyStackPanel.theHostSNginxIsHandling', 'The host\'s Nginx is handling reverse proxying. Switch to Traefik or Caddy above to run a managed Docker proxy stack instead.')}
                />
            )}
        </div>
    );
};

export default ProxyStackPanel;
