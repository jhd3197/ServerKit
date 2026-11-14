import { statusKind } from '@/components/ds/status';
import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import { Link } from 'react-router-dom';
import {
    Network, Plus, Trash2, Globe, Lock, ShieldCheck, ExternalLink,
    ArrowRight, HardDrive, Cloud, AlertTriangle,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import InfoTip from '../components/InfoTip';
import Modal from '../components/Modal';
import { FormField } from '../components/FormField';
import useFieldErrors from '../hooks/useFieldErrors';
import ServerPicker from '../components/ServerPicker';
import DomainField from '../components/DomainField';
import PortField from '../components/PortField';
import { Pill } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { Button } from '@/components/ui/button';
import PagePrimaryButton from '@/components/PagePrimaryButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';
import { formatDateTime } from '@/utils/intl';

// Tunnel / service status → status-pill tone.
const pillKind = (status) => statusKind(status);

const EMPTY_FORM = {
    privateServerId: '',
    edgeServerId: '',
    hostname: '',
    port: '',
    requireAuth: false,
    authUsername: '',
    authPassword: '',
    ssl: true,
};

const RemoteAccess = ({ serverId }) => {
    const { t } = useTranslation();

    // Literal keys only (extract-i18n can't follow computed ones); unknown values show raw.
    const statusLabel = (status) => {
        switch (status || 'unknown') {
            case 'pending': return t('app.remoteAccess.status.pending', 'pending');
            case 'up': return t('app.remoteAccess.status.up', 'up');
            case 'degraded': return t('app.remoteAccess.status.degraded', 'degraded');
            case 'down': return t('app.remoteAccess.status.down', 'down');
            case 'error': return t('app.remoteAccess.status.error', 'error');
            case 'published': return t('app.remoteAccess.status.published', 'published');
            case 'unknown': return t('app.remoteAccess.status.unknown', 'unknown');
            default: return status;
        }
    };
    const fieldId = useId();
    const toast = useToast();
    const [tunnels, setTunnels] = useState([]);
    const [services, setServices] = useState({}); // tunnelId -> [service]
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);

    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardTunnel, setWizardTunnel] = useState(null); // preset when adding to an existing tunnel
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);

    const [teardown, setTeardown] = useState(null); // tunnel pending teardown

    const currentServer = useMemo(
        () => servers.find((s) => s.id === serverId),
        [servers, serverId]
    );

    // When scoped to a server, only show tunnels that involve it.
    const visibleTunnels = useMemo(() => {
        if (!serverId) return tunnels;
        return tunnels.filter(
            (t) => t.edge_server_id === serverId || t.private_server_id === serverId
        );
    }, [tunnels, serverId]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [tRes, sRes] = await Promise.all([api.getTunnels(), api.getServers()]);
            const list = tRes.tunnels || [];
            setTunnels(list);
            setServers(sRes.servers || sRes || []);
            const entries = await Promise.all(
                list.map((t) =>
                    api
                        .getTunnelServices(t.id)
                        .then((r) => [t.id, r.services || []])
                        .catch(() => [t.id, []])
                )
            );
            setServices(Object.fromEntries(entries));
        } catch (e) {
            toastError(toast, t('app.remoteAccess.failedToLoadTunnels', "Couldn't load tunnels."), e);
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => {
        load();
    }, [load]);

    const openWizard = (tunnel = null) => {
        setWizardTunnel(tunnel);
        setForm({
            ...EMPTY_FORM,
            edgeServerId: tunnel ? tunnel.edge_server_id : (serverId ? '' : ''),
            privateServerId: tunnel ? tunnel.private_server_id : (serverId || ''),
        });
        setWizardOpen(true);
    };

    const closeWizard = () => {
        if (submitting) return;
        wizardErrors.reset();
        setWizardOpen(false);
        setWizardTunnel(null);
        setForm(EMPTY_FORM);
    };

    const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const sameServer = Boolean(form.edgeServerId) && form.edgeServerId === form.privateServerId;
    const needsServers = !wizardTunnel;
    const wizardErrors = useFieldErrors({
        'private-host': needsServers && !form.privateServerId ? t('app.remoteAccess.privateHostRequired', 'Choose the private host.') : null,
        'edge-server': needsServers && !form.edgeServerId ? t('app.remoteAccess.edgeServerRequired', 'Choose the edge server.')
            : (needsServers && sameServer ? t('app.remoteAccess.pickTwoDifferentServers', 'Pick two different servers: the edge fronts the private host.') : null),
        hostname: form.hostname.trim() ? null : t('app.remoteAccess.hostnameRequired', 'Enter a valid public hostname.'),
        port: form.port ? null : t('app.remoteAccess.portRequired', 'Enter the service port.'),
        'auth-username': form.requireAuth && !form.authUsername.trim() ? t('app.remoteAccess.usernameRequired', 'Enter a username.') : null,
        'auth-password': form.requireAuth && !form.authPassword ? t('app.remoteAccess.passwordRequired', 'Enter a password.') : null,
    }, 'ra');

    const submitWizard = async () => {
        if (submitting || !wizardErrors.attempt()) return;
        setSubmitting(true);
        try {
            // Ensure a tunnel between the two servers (reuse an existing one).
            let tunnelId = wizardTunnel?.id;
            if (!tunnelId) {
                const existing = tunnels.find(
                    (t) =>
                        t.edge_server_id === form.edgeServerId &&
                        t.private_server_id === form.privateServerId
                );
                if (existing) {
                    tunnelId = existing.id;
                } else {
                    const created = await api.createTunnel({
                        edge_server_id: form.edgeServerId,
                        private_server_id: form.privateServerId,
                    });
                    tunnelId = created.id;
                }
            }
            const svc = await api.publishTunnelService(tunnelId, {
                hostname: form.hostname.trim(),
                port: Number(form.port),
                require_auth: form.requireAuth,
                auth_username: form.authUsername.trim() || undefined,
                auth_password: form.authPassword || undefined,
                ssl: form.ssl,
            });
            toast.success(t('app.remoteAccess.exposed', 'Exposed {{hostname}}', { hostname: svc.hostname }));
            closeWizard();
            load();
        } catch (e) {
            if (wizardErrors.fromServer(e)) return;
            toastError(toast, t('app.remoteAccess.failedToExposeService', "Couldn't expose the service."), e);
        } finally {
            setSubmitting(false);
        }
    };

    const confirmTeardown = async () => {
        if (!teardown) return;
        try {
            await api.deleteTunnel(teardown.id);
            toast.success(t('app.remoteAccess.tunnelTornDown', 'Tunnel torn down'));
            setTeardown(null);
            load();
        } catch (e) {
            toastError(toast, t('app.remoteAccess.failedToTearDownTunnel', "Couldn't tear down the tunnel."), e);
        }
    };

    const unpublish = async (tunnelId, svc) => {
        try {
            await api.unpublishTunnelService(tunnelId, svc.id);
            toast.success(t('app.remoteAccess.removed', 'Removed {{hostname}}', { hostname: svc.hostname }));
            load();
        } catch (e) {
            toastError(toast, t('app.remoteAccess.failedToRemoveService', "Couldn't remove the service."), e);
        }
    };

    // Plain copy for page-body placements: stays visible on phones, full label.
    const exposeButton = (
        <Button size="sm" onClick={() => openWizard(null)} disabled={loading}>
            <Plus size={15} aria-hidden="true" />
            {t('app.remoteAccess.exposeALocalService', 'Expose a local service')}
        </Button>
    );

    // Header action lives in the shared Servers top bar when this page is used
    // as a tab in the Servers group. When embedded inside a single server's
    // detail page we render the action inline instead.
    useTopbarActions(() => (
        <PagePrimaryButton
            id="remote-access-expose"
            label={t('app.remoteAccess.exposeALocalService', 'Expose a local service')}
            shortLabel={t('app.remoteAccess.exposeShort', 'Expose')}
            onClick={() => openWizard(null)}
            disabled={loading}
        />
    ), [loading]);

    return (
        <div className="sk-tabgroup__inner ra-page">
            <div className="ra-intro">
                {serverId && currentServer ? (
                    <p>
                        {t('app.remoteAccess.exposeServicesOn', 'Expose services on')} <strong>{currentServer.name}</strong>.
                        {' '}<InfoTip>{t('app.remoteAccess.exposeServicesRunningOn', 'Expose services running on')} <strong>{currentServer.name}</strong> {t('app.remoteAccess.toAPublicHostnameOverA', 'to a public hostname over a WireGuard tunnel. ServerKit pairs this host with an edge server that has a public IP.')}</InfoTip>
                    </p>
                ) : (
                    <p>
                        {t('app.remoteAccess.exposeAPrivateServicePublicly', 'Expose a private service publicly.')}
                        {' '}<InfoTip>{t('app.remoteAccess.exposeAServiceRunningOnA', 'Expose a service running on a private server (behind NAT, no port-forwarding) to a public hostname over a WireGuard tunnel between two of your agents.')}</InfoTip>
                    </p>
                )}
                {serverId && (
                    <div className="ra-intro__actions">
                        {exposeButton}
                    </div>
                )}
            </div>

            {loading ? (
                <EmptyState loading loadingVariant="table" title={t('app.remoteAccess.loadingTunnels', 'Loading tunnels')} />
            ) : visibleTunnels.length === 0 ? (
                <EmptyState
                    icon={Network}
                    title={serverId ? t('app.remoteAccess.noTunnelsForThisServer', 'No tunnels for this server') : t('app.remoteAccess.noTunnelsYet', 'No tunnels yet')}
                    description={serverId ? (
                        <>
                            {t('app.remoteAccess.pickAPublicIpEdgeServerShort', 'Pick a public-IP edge server.')}
                            {' '}<InfoTip>{t('app.remoteAccess.pickAPublicIpEdgeServer', 'Pick a public-IP edge server and ServerKit will pair it with {{value}} over WireGuard.', { value: currentServer?.name || t('app.remoteAccess.thisHost', 'this host') })}</InfoTip>
                        </>
                    ) : (
                        <>
                            {t('app.remoteAccess.pickAnEdgeAndAPrivateHost', 'Pick an edge and a private host.')}
                            {' '}<InfoTip>{t('app.remoteAccess.pickAPublicIpEdgeServer2', 'Pick a public-IP edge server and a private host, and ServerKit will pair them over WireGuard and publish your service. No router changes are needed.')}</InfoTip>
                        </>
                    )}
                    action={exposeButton}
                />
            ) : (
                <div className="ra-list">
                    {visibleTunnels.map((tunnel) => {
                        const svcs = services[tunnel.id] || [];
                        const isCurrentPrivate = tunnel.private_server_id === serverId;
                        const isCurrentEdge = tunnel.edge_server_id === serverId;
                        return (
                            <section key={tunnel.id} className="ra-tunnel">
                                <div className="ra-tunnel__head">
                                    <div className="ra-tunnel__info">
                                        <div className="ra-tunnel__route">
                                            <span className="ra-node">
                                                <span className="ra-node__ico"><HardDrive size={14} /></span>
                                                {serverId ? (
                                                    tunnel.private_server_name || tunnel.private_server_id
                                                ) : (
                                                    <Link to={`/servers/${tunnel.private_server_id}/remote-access`}>
                                                        {tunnel.private_server_name || tunnel.private_server_id}
                                                    </Link>
                                                )}
                                                {isCurrentPrivate && <span className="ra-node__tag">{t('app.remoteAccess.thisServer', 'this server')}</span>}
                                            </span>
                                            <ArrowRight className="ra-arrow" size={16} />
                                            <span className="ra-node">
                                                <span className="ra-node__ico"><Cloud size={14} /></span>
                                                {serverId ? (
                                                    tunnel.edge_server_name || tunnel.edge_server_id
                                                ) : (
                                                    <Link to={`/servers/${tunnel.edge_server_id}/remote-access`}>
                                                        {tunnel.edge_server_name || tunnel.edge_server_id}
                                                    </Link>
                                                )}
                                                {isCurrentEdge && <span className="ra-node__tag">{t('app.remoteAccess.thisServer', 'this server')}</span>}
                                            </span>
                                            <Pill kind={pillKind(tunnel.status)}>{statusLabel(tunnel.status)}</Pill>
                                        </div>
                                        <div className="ra-tunnel__meta">
                                            <span>{tunnel.subnet}</span>
                                            <span className="ra-dot">·</span>
                                            <span>{tunnel.interface_name}</span>
                                            <span className="ra-dot">·</span>
                                            <span>UDP {tunnel.listen_port}</span>
                                            <span className="ra-dot">·</span>
                                            <span>
                                                {tunnel.last_handshake_at
                                                    ? t('app.remoteAccess.handshakeAt', 'handshake {{time}}', { time: formatDateTime(tunnel.last_handshake_at) })
                                                    : t('app.remoteAccess.noHandshakeYetShort', 'no handshake yet')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="ra-tunnel__actions">
                                        <Button variant="outline" size="sm" onClick={() => openWizard(t)}>
                                            <Plus size={15} /> {t('app.remoteAccess.exposeService', 'Expose service')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setTeardown(t)}
                                            title={t('app.remoteAccess.tearDownTunnel', 'Tear down tunnel')}
                                        >
                                            <Trash2 size={15} />
                                        </Button>
                                    </div>
                                </div>

                                {!tunnel.last_handshake_at && tunnel.status !== 'up' && (
                                    <div className="ra-tunnel__warn">
                                        <AlertTriangle size={14} />
                                        <span>
                                            {t('app.remoteAccess.noHandshakeYetIfThisPersists', "No handshake yet. If this persists, the private host's outbound UDP to the edge may be blocked (a relay is needed).")}
                                        </span>
                                    </div>
                                )}

                                <div className="ra-svcs">
                                    {svcs.length === 0 ? (
                                        <EmptyState
                                            icon={Globe}
                                            title={t('app.remoteAccess.noServicesExposedOnThisTunnel', 'No services exposed on this tunnel yet.')}
                                        />
                                    ) : (
                                        svcs.map((svc) => (
                                            <div key={svc.id} className="ra-svc">
                                                <div className="ra-svc__main">
                                                    <Globe className="ra-svc__ico" size={15} />
                                                    {svc.url ? (
                                                        <a
                                                            className="ra-svc__host"
                                                            href={svc.url}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                        >
                                                            {svc.hostname}
                                                            <ExternalLink size={12} />
                                                        </a>
                                                    ) : (
                                                        <span className="ra-svc__host">{svc.hostname}</span>
                                                    )}
                                                    <span className="ra-svc__port">→ :{svc.port}</span>
                                                    <span className="ra-svc__flags">
                                                        {svc.require_auth && (
                                                            <Lock size={13} aria-label={t('app.remoteAccess.basicAuth', 'Basic auth')} />
                                                        )}
                                                        {svc.ssl_enabled && (
                                                            <ShieldCheck
                                                                size={13}
                                                                className="ra-flag--ssl"
                                                                aria-label="HTTPS"
                                                            />
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="ra-svc__right">
                                                    <Pill kind={pillKind(svc.status)}>
                                                        {statusLabel(svc.status)}
                                                    </Pill>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => unpublish(tunnel.id, svc)}
                                                    >
                                                        {t('common.actions.remove', 'Remove')}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {/* Expose-a-service wizard */}
            <Modal
                open={wizardOpen}
                onClose={closeWizard}
                title={t('app.remoteAccess.exposeALocalService', 'Expose a local service')}
                size="lg"
                onSubmit={submitWizard}
                footer={
                    <>
                        <Button type="button" variant="outline" onClick={closeWizard} disabled={submitting}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? t('app.remoteAccess.publishing', 'Publishing…') : t('common.actions.publish', 'Publish')}
                        </Button>
                    </>
                }
            >
                <div className="ra-service-form">
                    {!wizardTunnel && (
                        <>
                            <FormField className="ra-service-field" label={t('app.remoteAccess.privateHostWhereTheServiceRuns', 'Private host (where the service runs)')} htmlFor="ra-private-host" required error={wizardErrors.error('private-host')}>
                                {serverId ? (
                                    <Input
                                        id="ra-private-host"
                                        value={currentServer?.name || serverId}
                                        disabled
                                    />
                                ) : (
                                    // Tunnel endpoints are agent servers; the panel host
                                    // has no server row, so "Local" is not offered.
                                    <ServerPicker
                                        id="ra-private-host"
                                        value={form.privateServerId}
                                        onChange={(id) => setField('privateServerId', id)}
                                        capability="wireguard"
                                        includeLocal={false}
                                        label={t('app.remoteAccess.privateHostWhereTheServiceRuns', 'Private host (where the service runs)')}
                                    />
                                )}
                            </FormField>
                            <FormField
                                className="ra-service-field"
                                label={t('app.remoteAccess.edgeServerPublicIpFrontsThe', 'Edge server (public IP, fronts the tunnel)')}
                                htmlFor="ra-edge-server"
                                info={t('app.remoteAccess.aTunnelBetweenTheseTwoIs', 'A tunnel between these two is created (or reused) automatically.')}
                                required
                                error={sameServer ? wizardErrors.error('edge-server') || t('app.remoteAccess.pickTwoDifferentServers', 'Pick two different servers: the edge fronts the private host.') : wizardErrors.error('edge-server')}
                            >
                                <ServerPicker
                                    id="ra-edge-server"
                                    value={form.edgeServerId}
                                    onChange={(id) => setField('edgeServerId', id)}
                                    capability="wireguard"
                                    includeLocal={false}
                                    label={t('app.remoteAccess.edgeServerPublicIpFrontsThe', 'Edge server (public IP, fronts the tunnel)')}
                                />
                            </FormField>
                        </>
                    )}

                    <div className="ra-service-routing">
                        <FormField
                            className="ra-service-field ra-service-field--host"
                            label={t('app.remoteAccess.publicHostname', 'Public hostname')}
                            htmlFor="ra-hostname"
                            info={t('app.remoteAccess.pointAtEdgeGeneric', 'Point the hostname at the edge server; the tunnel carries it from there.')}
                            required
                            error={wizardErrors.error('hostname')}
                        >
                            <div onBlur={() => wizardErrors.touch('hostname')}>
                            <DomainField
                                id="ra-hostname"
                                modes={['custom']}
                                value={form.hostname}
                                onChange={(fqdn) => { wizardErrors.clear('hostname'); setField('hostname', fqdn); }}
                            />
                            </div>
                        </FormField>
                        <FormField className="ra-service-field" label={t('app.remoteAccess.servicePort', 'Service port')} htmlFor="ra-port" required error={wizardErrors.error('port')}>
                            {/* The port lives on the private host, not this panel. */}
                            <PortField
                                id="ra-port"
                                host={false}
                                placeholder="8096"
                                value={form.port}
                                onChange={(port) => { wizardErrors.clear('port'); setField('port', port); }}
                            />
                        </FormField>
                    </div>

                    <div className="ra-service-option">
                        <div>
                            <span className="ra-label-row">
                                <Label htmlFor={`${fieldId}-ssl`}>{t('app.remoteAccess.httpsLetSEncrypt', 'HTTPS (Let\'s Encrypt)')}</Label>
                                <InfoTip>{t('app.remoteAccess.obtainACertificateOnTheEdge', 'Obtain a certificate on the edge.')}</InfoTip>
                            </span>
                        </div>
                        <Switch id={`${fieldId}-ssl`} checked={form.ssl} onCheckedChange={(v) => setField('ssl', v)} />
                    </div>

                    <div className="ra-service-option">
                        <div>
                            <span className="ra-label-row">
                                <Label htmlFor={`${fieldId}-require-auth`}>{t('app.remoteAccess.requireLoginBasicAuth', 'Require login (basic auth)')}</Label>
                                <InfoTip>{t('app.remoteAccess.putAUsernamePasswordInFront', 'Put a username/password in front of the service.')}</InfoTip>
                            </span>
                        </div>
                        <Switch id={`${fieldId}-require-auth`} checked={form.requireAuth} onCheckedChange={(v) => setField('requireAuth', v)} />
                    </div>

                    {form.requireAuth && (
                        <div className="ra-service-credentials">
                            <FormField className="ra-service-field" label={t('common.labels.username', 'Username')} htmlFor="ra-auth-username" required error={wizardErrors.error('auth-username')}>
                                <Input
                                    id="ra-auth-username"
                                    value={form.authUsername}
                                    onChange={(e) => setField('authUsername', e.target.value)}
                                    onBlur={() => wizardErrors.touch('auth-username')}
                                />
                            </FormField>
                            <FormField className="ra-service-field" label={t('common.labels.password', 'Password')} htmlFor="ra-auth-password" required error={wizardErrors.error('auth-password')}>
                                <Input
                                    id="ra-auth-password"
                                    type="password"
                                    value={form.authPassword}
                                    onChange={(e) => setField('authPassword', e.target.value)}
                                    onBlur={() => wizardErrors.touch('auth-password')}
                                />
                            </FormField>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Tear-down confirmation */}
            <Modal
                open={!!teardown}
                onClose={() => setTeardown(null)}
                title={t('app.remoteAccess.tearDownTunnel2', 'Tear down tunnel?')}
                size="sm"
                footer={
                    <>
                        <Button variant="outline" onClick={() => setTeardown(null)}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button variant="destructive" onClick={confirmTeardown}>
                            {t('app.remoteAccess.tearDown', 'Tear down')}
                        </Button>
                    </>
                }
            >
                <p className="ra-service-description">
                    {t('app.remoteAccess.thisRemovesTheWireguardTunnel', 'This removes the WireGuard tunnel')}{teardown ? ` ${t('app.remoteAccess.betweenServers', 'between {{privateServer}} and {{edgeServer}}', { privateServer: teardown.private_server_name || teardown.private_server_id, edgeServer: teardown.edge_server_name || teardown.edge_server_id })}` : ''} {t('app.remoteAccess.andAnyServicesPublishedOverIt', 'and any services published over it. The agents\' interfaces are brought down.')}
                </p>
            </Modal>
        </div>
    );
};

export default RemoteAccess;
