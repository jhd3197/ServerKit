// Connections hub — the Settings → Connections tab. Presents every external
// integration ServerKit can bridge to, grouped by category, over a single
// surface. It composes the backends that already exist instead of inventing new
// ones, keyed by each provider's `kind` (see providerCatalog.js):
//   - source    → /source-connections   (GitHub, GitLab OAuth)
//   - cloud     → /cloud                 (DigitalOcean, Hetzner, Vultr, Linode)
//   - dns       → /email/dns-providers   (Cloudflare, Route 53, DigitalOcean, GoDaddy)
//   - registrar → /registrars            (GoDaddy domain portfolio + expiry)
//   - storage   → /backups/storage       (S3-compatible, Backblaze B2)
// Each connected provider shows its status, access scope, and a cross-link to the
// in-app page it powers (Servers, Domains, Backups, New Service).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import api from '../../../services/api';
import useSettingFocus from '../../../hooks/useSettingFocus';
import { useConfirm } from '../../../hooks/useConfirm';
import { useAuth } from '../../../contexts/useAuth.js';
import { useToast } from '../../../contexts/useToast.js';
import {
    CONNECTION_CATEGORIES, CONNECTION_PROVIDERS, deriveScope, dedupeScopes,
} from './providerCatalog';
import ProviderCard from './ProviderCard';
import ErrorState from '../../ErrorState';
import ConnectProviderModal from './ConnectProviderModal';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// The settings-index deep-link id each category section is landable from. The
// cards are rendered by ProviderCard (presentational, no ref), so the flash
// lands on the section container. The source section carries `connections-github`
// (its headline); `connections-gitlab` still deep-links to the tab correctly.
// The `chat` category has no settings-index entry, so it is left unregistered.
const CATEGORY_FOCUS_ID = {
    source: 'connections-github',
    infra: 'connections-cloud-provider',
    registry: 'connections-container-registry',
    dns: 'connections-dns-provider',
    registrar: 'connections-registrar',
    email: 'connections-email-relay',
    storage: 'connections-storage',
};

export default function ConnectionsHub() {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const { isAdmin } = useAuth();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [sourceStatus, setSourceStatus] = useState({ github: null, gitlab: null, bitbucket: null });
    const [sourceConfig, setSourceConfig] = useState({ github: null, gitlab: null, bitbucket: null });
    const [dnsProviders, setDnsProviders] = useState([]);
    const [cloudProviders, setCloudProviders] = useState([]);
    const [storageConfig, setStorageConfig] = useState(null);
    const [relayConfig, setRelayConfig] = useState(null);
    const [registrarConnections, setRegistrarConnections] = useState([]);
    const [registrarDomains, setRegistrarDomains] = useState([]);
    const [containerRegistries, setContainerRegistries] = useState([]);
    const [allConnections, setAllConnections] = useState([]);
    const [loading, setLoading] = useState(true);
    // Which status reads failed on the last load. A failed read must render as
    // "couldn't load", never as "Not connected" with a Connect button.
    const [failed, setFailed] = useState({});
    const [firstError, setFirstError] = useState(null);
    const [modalProvider, setModalProvider] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    const loadData = useCallback(async () => {
        const failures = {};
        let firstErr = null;
        // Keep partial results, but remember which reads failed.
        const soft = (key, promise, fallback) => promise.catch((err) => {
            failures[key] = true;
            if (!firstErr) firstErr = err;
            return fallback;
        });
        try {
            const [ghStatus, glStatus, bbStatus, dns, cloudP, storage, relay, regConns, regDomains, registries, allConns] = await Promise.all([
                soft('github', api.getGithubSourceStatus(), null),
                soft('gitlab', api.getGitlabSourceStatus(), null),
                soft('bitbucket', api.getBitbucketSourceStatus(), null),
                soft('dns', api.getEmailDNSProviders().then((d) => d.providers || []), []),
                soft('cloud', api.getCloudProviders().then((d) => d.providers || []), []),
                soft('storage', api.getStorageConfig(), null),
                soft('email', api.getEmailRelay(), null),
                soft('registrar', api.getRegistrarConnections().then((d) => d.connections || []), []),
                soft('registrarDomains', api.getRegistrarDomains().then((d) => d.domains || []), []),
                soft('registry', api.getContainerRegistries().then((d) => d.registries || []), []),
                soft('all', api.getAllConnections().then((d) => d.connections || []), []),
            ]);
            setFailed(failures);
            setFirstError(firstErr);
            setSourceStatus({ github: ghStatus, gitlab: glStatus, bitbucket: bbStatus });
            setDnsProviders(dns);
            setCloudProviders(cloudP);
            setStorageConfig(storage);
            setRelayConfig(relay);
            setRegistrarConnections(regConns);
            setRegistrarDomains(regDomains);
            setContainerRegistries(registries);
            setAllConnections(allConns);
            if (isAdmin) {
                const [ghCfg, glCfg, bbCfg] = await Promise.all([
                    api.getGithubSourceConfig().catch(() => null),
                    api.getGitlabSourceConfig().catch(() => null),
                    api.getBitbucketSourceConfig().catch(() => null),
                ]);
                setSourceConfig({
                    github: ghCfg?.config || { client_id: '', client_secret: '' },
                    gitlab: glCfg?.config || { client_id: '', client_secret: '' },
                    bitbucket: bbCfg?.config || { client_id: '', client_secret: '' },
                });
            }
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => { loadData(); }, [loadData]);

    // ── Source (GitHub / GitLab) ──
    const onConnectSource = useCallback(async (provider) => {
        try {
            const redirectUri = `${window.location.origin}/connections/callback/${provider.provider}`;
            sessionStorage.setItem('sourceConnectionReturnTo', '/settings/connections');
            const { auth_url } = await api.startSourceConnection(provider.provider, redirectUri);
            window.location.href = auth_url;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToStartConnection', "Couldn't start the {{name}} connection.", { name: provider.name }), err);
        }
    }, [t, toast]);

    const onDisconnectSource = useCallback(async (provider) => {
        try {
            await api.disconnectSourceConnection(provider.provider);
            toast.success(t('app.connectionsHub.providerDisconnected', '{{name}} disconnected', { name: provider.name }));
            await loadData();
            setModalOpen(false);
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToDisconnect', "Couldn't disconnect."), err);
        }
    }, [toast, loadData, t]);

    // One-click GitHub App setup: fetch the manifest, then POST it to github.com
    // via an auto-submitted form (GitHub only accepts the manifest as a form
    // field). GitHub redirects back to the callback which finishes the setup.
    const onSetupGithubApp = useCallback(async () => {
        try {
            const baseUrl = window.location.origin;
            const redirectUri = `${baseUrl}/connections/github-app/callback`;
            const { manifest, state, post_url } = await api.getGithubAppManifest(baseUrl, redirectUri);
            sessionStorage.setItem('sourceConnectionReturnTo', '/settings/connections');
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = `${post_url}?state=${encodeURIComponent(state)}`;
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'manifest';
            input.value = JSON.stringify(manifest);
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToStartGithubAppSetup', "Couldn't start the GitHub App setup."), err);
        }
    }, [t, toast]);

    const onSaveSourceConfig = useCallback(async (provider, config) => {
        try {
            if (provider.provider === 'gitlab') await api.updateGitlabSourceConfig(config);
            else if (provider.provider === 'bitbucket') await api.updateBitbucketSourceConfig(config);
            else await api.updateGithubSourceConfig(config);
            toast.success(t('app.connectionsHub.oauthAppSaved', '{{name}} OAuth app saved', { name: provider.name }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToSaveOauthApp', "Couldn't save the OAuth app."), err);
            return false;
        }
    }, [toast, t, loadData]);

    // ── DNS ──
    const onAddDns = useCallback(async (payload) => {
        try {
            const res = await api.addEmailDNSProvider(payload);
            if (res && res.success === false) throw new Error(res.error || 'Failed to add connection');
            toast.success(t('app.connectionsHub.providerConnected', '{{name}} connected', { name: payload.name }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToAddConnection', "Couldn't add the connection."), err);
            return false;
        }
    }, [toast, loadData, t]);

    const onRemoveDns = useCallback(async (record) => {
        const confirmed = await confirm({
            title: t('app.connectionsHub.removeConnection', 'Delete connection'),
            message: t('app.connectionsHub.removeTheConnection', 'Delete the connection "{{name}}"?', { name: record.name }),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!confirmed) return false;
        try {
            await api.deleteEmailDNSProvider(record.id);
            toast.success(t('app.connectionsHub.connectionDeleted', '{{name}} deleted', { name: record.name }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToRemoveConnection', "Couldn't delete the connection."), err);
            return false;
        }
    }, [confirm, t, toast, loadData]);

    const onTestDns = useCallback(async (id) => {
        try {
            const res = await api.testEmailDNSProvider(id);
            if (res && res.success) toast.success(res.message || t('app.connectionsHub.connectionWorks', 'Connection works'));
            else toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), res && res.error);
            return res;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), err);
            return null;
        }
    }, [t, toast]);

    // ── Cloud (server provisioning) ──
    const onAddCloud = useCallback(async (payload) => {
        try {
            await api.createCloudProvider(payload); // { provider_type, name, api_key }
            toast.success(t('app.connectionsHub.providerConnected', '{{name}} connected', { name: payload.name || t('app.connectionsHub.provider', 'Provider') }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToConnectProvider', "Couldn't connect the provider."), err);
            return false;
        }
    }, [toast, t, loadData]);

    const onRemoveCloud = useCallback(async (id) => {
        const confirmed = await confirm({
            title: t('app.connectionsHub.disconnectCloudAccount', 'Disconnect cloud account'),
            message: t('app.connectionsHub.disconnectThisCloudAccountExistingServers', 'Disconnect this cloud account? Existing servers are not affected.'),
            confirmText: t('app.connectionsHub.disconnect', 'Disconnect'),
            variant: 'danger',
        });
        if (!confirmed) return false;
        try {
            await api.deleteCloudProvider(id);
            toast.success(t('app.connectionsHub.disconnected2', 'Disconnected'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToDisconnect', "Couldn't disconnect."), err);
            return false;
        }
    }, [confirm, t, toast, loadData]);

    // ── Storage ──
    const onSaveStorage = useCallback(async (config) => {
        try {
            const res = await api.updateStorageConfig(config);
            if (res && res.success === false) throw new Error(res.error || 'Failed to save storage');
            toast.success(t('app.connectionsHub.storageSaved', 'Storage saved'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToSaveStorage', "Couldn't save the storage settings."), err);
            return false;
        }
    }, [toast, t, loadData]);

    const onTestStorage = useCallback(async (config) => {
        try {
            const res = await api.testStorageConnection(config);
            if (res && res.success) toast.success(res.message || t('app.connectionsHub.connectionWorks', 'Connection works'));
            else toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), res && res.error);
            return res;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), err);
            return null;
        }
    }, [t, toast]);

    // ── Email relay ──
    const onSaveRelay = useCallback(async (payload) => {
        try {
            const res = await api.updateEmailRelay(payload);
            toast.success(res?.apply?.note || t('app.connectionsHub.relaySaved', 'Relay saved'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToSaveRelay', "Couldn't save the relay."), err);
            return false;
        }
    }, [toast, t, loadData]);

    const onTestRelay = useCallback(async (payload) => {
        try {
            const res = await api.testEmailRelay(payload);
            if (res && res.success) toast.success(res.message || t('app.connectionsHub.connectionWorks', 'Connection works'));
            else toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), res && res.error);
            return res;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), err);
            return null;
        }
    }, [t, toast]);

    const onDisableRelay = useCallback(async () => {
        try {
            await api.disableEmailRelay();
            toast.success(t('app.connectionsHub.relayDisabled', 'Relay disabled'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToDisableRelay', "Couldn't turn off the relay."), err);
            return false;
        }
    }, [toast, t, loadData]);

    // ── Registrar ──
    const onAddRegistrar = useCallback(async (payload) => {
        try {
            await api.addRegistrarConnection(payload);
            toast.success(t('app.connectionsHub.providerConnected', '{{name}} connected', { name: payload.name || t('app.connectionsHub.registrar', 'Registrar') }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToConnectRegistrar', "Couldn't connect the registrar."), err);
            return false;
        }
    }, [toast, t, loadData]);

    const onRemoveRegistrar = useCallback(async (id) => {
        const confirmed = await confirm({
            title: t('app.connectionsHub.disconnectRegistrar', 'Disconnect registrar'),
            message: t('app.connectionsHub.disconnectThisRegistrar', 'Disconnect this registrar?'),
            confirmText: t('app.connectionsHub.disconnect', 'Disconnect'),
            variant: 'danger',
        });
        if (!confirmed) return false;
        try {
            await api.deleteRegistrarConnection(id);
            toast.success(t('app.connectionsHub.registrarDisconnected', 'Registrar disconnected'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToDisconnect', "Couldn't disconnect."), err);
            return false;
        }
    }, [confirm, t, toast, loadData]);

    const onTestRegistrar = useCallback(async (id) => {
        try {
            const res = await api.testRegistrarConnection(id);
            if (res && res.success) toast.success(res.message || t('app.connectionsHub.connectionWorks', 'Connection works'));
            else toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), res && res.error);
            return res;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.connectionTestFailed', "Couldn't connect."), err);
            return null;
        }
    }, [t, toast]);

    // ── Container registries ──
    const onAddRegistry = useCallback(async (payload) => {
        try {
            await api.addContainerRegistry(payload);
            toast.success(t('app.connectionsHub.providerConnected', '{{name}} connected', { name: payload.name || t('app.connectionsHub.registry', 'Registry') }));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToAddRegistry', "Couldn't add the registry."), err);
            return false;
        }
    }, [toast, t, loadData]);

    const onRemoveRegistry = useCallback(async (id) => {
        const confirmed = await confirm({
            title: t('app.connectionsHub.removeContainerRegistry', 'Delete container registry'),
            message: t('app.connectionsHub.removeThisContainerRegistryAppsThat', 'Delete this container registry? Services that pull from it will lose access.'),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!confirmed) return false;
        try {
            await api.deleteContainerRegistry(id);
            toast.success(t('app.connectionsHub.registryRemoved', 'Registry deleted'));
            await loadData();
            return true;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.failedToRemoveRegistry', "Couldn't delete the registry."), err);
            return false;
        }
    }, [confirm, t, toast, loadData]);

    const onTestRegistry = useCallback(async (id) => {
        try {
            const res = await api.testContainerRegistry(id);
            if (res && res.success) toast.success(res.message || t('app.connectionsHub.loginWorks', 'Login works'));
            else toastError(toast, t('app.connectionsHub.loginFailed', "Couldn't sign in."), res && res.error);
            return res;
        } catch (err) {
            toastError(toast, t('app.connectionsHub.loginFailed', "Couldn't sign in."), err);
            return null;
        }
    }, [t, toast]);

    // ── Per-provider card summaries ──
    const summaries = useMemo(() => {
        const out = {};
        const cloudByType = (type) => cloudProviders.filter((p) => p.provider_type === type);

        for (const provider of CONNECTION_PROVIDERS) {
            if (provider.comingSoon) { out[provider.id] = { connected: false }; continue; }
            const failedKey = provider.kind === 'source' ? provider.provider : provider.kind;
            if (failed[failedKey]) {
                out[provider.id] = { connected: false, loadFailed: true, statusLabel: t('app.connectionsHub.couldntLoad', "Couldn't load."), statusTone: 'danger', scopes: [] };
                continue;
            }
            const manageHref = provider.manageHref;

            if (provider.kind === 'source') {
                const status = sourceStatus[provider.provider];
                const conn = status?.connection;
                out[provider.id] = conn
                    ? {
                        connected: true, statusLabel: t('app.connectionsHub.statusConnected', 'Connected'), statusTone: 'ok',
                        subtitle: conn.provider_username ? `@${conn.provider_username}` : (conn.display_name || null),
                        scopes: [{ labelKey: 'app.connectionsHub.oauth', label: 'OAuth', tone: 'neutral', hint: conn.scope || t('app.connectionsHub.authorizedViaOauth', 'Authorized via OAuth') }],
                        manageHref, manageLabel: t('app.connectionsHub.manageNewService', 'New service'),
                    }
                    : { connected: false, statusLabel: status?.configured ? t('app.connectionsHub.statusNotConnected', 'Not connected') : t('app.connectionsHub.statusSetupNeeded', 'Setup needed'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'cloud') {
                const matches = cloudByType(provider.providerType);
                const count = matches.reduce((n, p) => n + (p.server_count || 0), 0);
                out[provider.id] = matches.length
                    ? {
                        connected: true, statusLabel: t('app.connectionsHub.statusConnected', 'Connected'), statusTone: 'ok',
                        subtitle: count ? t('app.connectionsHub.serverCount', { count, defaultValue_one: '1 server', defaultValue_other: '{{count}} servers' }) : t('app.connectionsHub.noServersYet', 'No servers yet'),
                        scopes: [], manageHref, manageLabel: t('app.connectionsHub.manageServers', 'Servers'),
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'dns') {
                const list = dnsProviders.filter((p) => p.provider === provider.provider);
                out[provider.id] = list.length
                    ? {
                        connected: true, statusLabel: list.length === 1 ? t('app.connectionsHub.statusConnected', 'Connected') : t('app.connectionsHub.countConnected', '{{count}} connected', { count: list.length }), statusTone: 'ok',
                        subtitle: list.map((p) => p.name).join(', '),
                        scopes: dedupeScopes(list.map(deriveScope).filter(Boolean)),
                        manageHref: '/domains', manageLabel: t('app.connectionsHub.manageDomains', 'Domains'),
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'registrar') {
                const list = registrarConnections.filter((c) => c.provider === provider.provider);
                const mine = registrarDomains.filter((d) => d.registrar === provider.provider);
                const expiring = mine.filter((d) => d.days_until_expiry != null && d.days_until_expiry <= 30).length;
                out[provider.id] = list.length
                    ? {
                        connected: true, statusLabel: t('app.connectionsHub.statusConnected', 'Connected'), statusTone: 'ok',
                        subtitle: `${t('app.connectionsHub.domainCount', { count: mine.length, defaultValue_one: '1 domain', defaultValue_other: '{{count}} domains' })}${expiring ? ` · ${t('app.connectionsHub.expiringWithin30d', '{{count}} expiring ≤30d', { count: expiring })}` : ''}`,
                        scopes: expiring ? [{ label: t('app.connectionsHub.expiringCount', '{{count}} expiring', { count: expiring }), tone: 'warn', hintKey: 'app.connectionsHub.registrationExpiresWithin30Days', hint: 'Registration expires within 30 days' }] : [],
                        manageHref, manageLabel: t('app.connectionsHub.manageDomains', 'Domains'),
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'registry') {
                const list = containerRegistries;
                out[provider.id] = list.length
                    ? {
                        connected: true, statusLabel: list.length === 1 ? t('app.connectionsHub.statusConnected', 'Connected') : t('app.connectionsHub.countConnected', '{{count}} connected', { count: list.length }), statusTone: 'ok',
                        subtitle: list.map((r) => r.name).join(', '),
                        scopes: [], manageHref, manageLabel: t('app.connectionsHub.manageNewService', 'New service'),
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'storage') {
                const active = storageConfig?.provider === provider.storageProvider;
                const sub = storageConfig?.[provider.storageProvider];
                out[provider.id] = active && sub?.bucket
                    ? {
                        connected: true, statusLabel: t('app.connectionsHub.statusActive', 'Active'), statusTone: 'ok',
                        subtitle: t('app.connectionsHub.bucket', 'Bucket: {{bucket}}', { bucket: sub.bucket }),
                        scopes: [{ labelKey: 'common.labels.backups', label: 'Backups', tone: 'neutral', hintKey: 'app.connectionsHub.usedAsTheOffsiteBackupDestination', hint: 'Used as the offsite backup destination' }],
                        manageHref, manageLabel: t('app.connectionsHub.manageBackups', 'Backups'),
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else if (provider.kind === 'email') {
                out[provider.id] = (relayConfig?.enabled && relayConfig?.host)
                    ? {
                        connected: true, statusLabel: t('app.connectionsHub.statusActive', 'Active'), statusTone: 'ok',
                        subtitle: `${relayConfig.host}:${relayConfig.port || 587}`,
                        scopes: relayConfig.use_tls ? [{ label: 'TLS', tone: 'ok', hintKey: 'app.connectionsHub.starttlsEnabled', hint: 'STARTTLS enabled' }] : [],
                    }
                    : { connected: false, statusLabel: t('app.connectionsHub.statusNotConnected', 'Not connected'), statusTone: 'neutral', scopes: [] };
            } else {
                out[provider.id] = { connected: false };
            }
        }
        return out;
    }, [sourceStatus, cloudProviders, dnsProviders, registrarConnections, registrarDomains, containerRegistries, storageConfig, relayConfig, failed, t]);

    function handleManage(provider) {
        setModalProvider(provider);
        setModalOpen(true);
    }

    const unencryptedCount = allConnections.filter((c) => c && c.encrypted === false).length;

    // Defense in depth: Settings only mounts this for admins and the registry API is
    // admin-gated, but guard here too so the hub never half-renders for a non-admin.
    if (!isAdmin) {
        return (
            <div className="connections-hub">
                <div className="connections-hub__warning">
                    <ShieldAlert size={16} />
                    <span>{t('app.connectionsHub.connectionsAreManagedByAdministrators', 'Connections are managed by administrators.')}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="connections-hub">
            {!loading && unencryptedCount > 0 && (
                <div className="connections-hub__warning">
                    <ShieldAlert size={16} />
                    <span>
                        {t('app.connectionsHub.unencryptedAccounts', { count: unencryptedCount, defaultValue_one: '1 connected account has credentials not encrypted at rest. Restart the panel to migrate them, or check that', defaultValue_other: '{{count}} connected accounts have credentials not encrypted at rest. Restart the panel to migrate them, or check that' })} <code>SERVERKIT_ENCRYPTION_KEY</code> {t('app.connectionsHub.isSet', 'is set.')}
                    </span>
                </div>
            )}
            {!loading && firstError && (
                <ErrorState
                    compact
                    error={firstError}
                    onRetry={loadData}
                />
            )}
            {loading ? (
                <div className="connections-hub__loading">{t('app.connectionsHub.loadingConnections', 'Loading connections…')}</div>
            ) : (
                CONNECTION_CATEGORIES.map((cat) => {
                    const providers = CONNECTION_PROVIDERS.filter((p) => p.category === cat.key);
                    if (!providers.length) return null;
                    const focusId = CATEGORY_FOCUS_ID[cat.key];
                    return (
                        <section
                            key={cat.key}
                            {...(focusId
                                ? register(focusId, 'connections-hub__category')
                                : { className: 'connections-hub__category' })}
                        >
                            <header className="connections-hub__category-head">
                                <h3>{cat.label}</h3>
                                <p>{cat.blurb}</p>
                            </header>
                            <div className="connections-hub__grid">
                                {providers.map((provider) => (
                                    <ProviderCard
                                        key={provider.id}
                                        provider={provider}
                                        summary={summaries[provider.id]}
                                        onManage={handleManage}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })
            )}

            <ConnectProviderModal
                provider={modalProvider}
                open={modalOpen}
                onOpenChange={setModalOpen}
                isAdmin={isAdmin}
                sourceStatus={sourceStatus}
                sourceConfig={sourceConfig}
                dnsProviders={dnsProviders}
                cloudProviders={cloudProviders}
                storageConfig={storageConfig}
                registrarConnections={registrarConnections}
                containerRegistries={containerRegistries}
                onConnectSource={onConnectSource}
                onDisconnectSource={onDisconnectSource}
                onSaveSourceConfig={onSaveSourceConfig}
                onSetupGithubApp={onSetupGithubApp}
                onAddDns={onAddDns}
                onRemoveDns={onRemoveDns}
                onTestDns={onTestDns}
                onAddCloud={onAddCloud}
                onRemoveCloud={onRemoveCloud}
                onSaveStorage={onSaveStorage}
                onTestStorage={onTestStorage}
                onAddRegistrar={onAddRegistrar}
                onRemoveRegistrar={onRemoveRegistrar}
                onTestRegistrar={onTestRegistrar}
                onAddRegistry={onAddRegistry}
                onRemoveRegistry={onRemoveRegistry}
                onTestRegistry={onTestRegistry}
                relayConfig={relayConfig}
                onSaveRelay={onSaveRelay}
                onTestRelay={onTestRelay}
                onDisableRelay={onDisableRelay}
            />
        </div>
    );
}
