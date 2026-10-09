// The connect / manage dialog for a single provider. Switches on `provider.kind`:
//   - 'source'    → per-user OAuth connect + (admin) OAuth-app credentials (GitHub, GitLab)
//   - 'dns'       → list API-key connections + add (Cloudflare scoped/global, Route 53,
//                   DigitalOcean token, GoDaddy key+secret)
//   - 'cloud'     → connect a provider API token; servers are managed on the Servers page
//   - 'storage'   → S3-compatible / Backblaze B2 bucket credentials (offsite backups)
//   - 'registrar' → GoDaddy account; reads the domain portfolio + expiry
// Each body owns its own form state and is keyed by provider.id so switching
// providers resets cleanly.
import { useState } from 'react';
import {
    CheckCircle2, ExternalLink, KeyRound, Link2, Mail, PlugZap, Server, Globe,
    HardDrive, ShieldCheck, ShieldAlert, Trash2, Activity, ChevronDown, Boxes, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import PortField from '@/components/PortField';
import { ProviderBrandIcon } from '../../icons/ProviderBrands';
import { deriveScope, REGISTRY_PROVIDERS } from './providerCatalog';
import DnsActivity from './DnsActivity';
import { useTranslation } from 'react-i18next';

export default function ConnectProviderModal({
    provider, open, onOpenChange, isAdmin,
    sourceStatus, sourceConfig, dnsProviders, cloudProviders, storageConfig, registrarConnections, containerRegistries, relayConfig,
    onConnectSource, onDisconnectSource, onSaveSourceConfig, onSetupGithubApp,
    onAddDns, onRemoveDns, onTestDns,
    onAddCloud, onRemoveCloud,
    onSaveStorage, onTestStorage,
    onAddRegistrar, onRemoveRegistrar, onTestRegistrar,
    onAddRegistry, onRemoveRegistry, onTestRegistry,
    onSaveRelay, onTestRelay, onDisableRelay,
}) {
    if (!provider) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="conn-modal">
                <DialogHeader>
                    <div className="conn-modal__title">
                        <span className="conn-modal__icon"><ProviderBrandIcon provider={provider.id} size={22} /></span>
                        <div>
                            <DialogTitle>{provider.name}</DialogTitle>
                            <DialogDescription>{provider.blurb}</DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="conn-modal__body">
                    {provider.kind === 'source' && (
                        <SourceBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            status={sourceStatus?.[provider.provider]} config={sourceConfig?.[provider.provider]}
                            onConnect={() => onConnectSource(provider)}
                            onDisconnect={() => onDisconnectSource(provider)}
                            onSaveConfig={(cfg) => onSaveSourceConfig(provider, cfg)}
                            onSetupApp={onSetupGithubApp}
                        />
                    )}

                    {provider.kind === 'dns' && (
                        <DnsBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            connections={(dnsProviders || []).filter((p) => p.provider === provider.provider)}
                            onAdd={onAddDns} onRemove={onRemoveDns} onTest={onTestDns}
                        />
                    )}

                    {provider.kind === 'cloud' && (
                        <CloudBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            connections={(cloudProviders || []).filter((p) => p.provider_type === provider.providerType)}
                            onAdd={onAddCloud} onRemove={onRemoveCloud}
                        />
                    )}

                    {provider.kind === 'storage' && (
                        <StorageBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            storageConfig={storageConfig} onSave={onSaveStorage} onTest={onTestStorage}
                        />
                    )}

                    {provider.kind === 'registrar' && (
                        <RegistrarBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            connections={(registrarConnections || []).filter((c) => c.provider === provider.provider)}
                            onAdd={onAddRegistrar} onRemove={onRemoveRegistrar} onTest={onTestRegistrar}
                        />
                    )}

                    {provider.kind === 'registry' && (
                        <RegistryBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            registries={containerRegistries || []}
                            onAdd={onAddRegistry} onRemove={onRemoveRegistry} onTest={onTestRegistry}
                        />
                    )}

                    {provider.kind === 'email' && (
                        <EmailBody
                            key={provider.id} provider={provider} isAdmin={isAdmin}
                            relayConfig={relayConfig}
                            onSave={onSaveRelay} onTest={onTestRelay} onDisable={onDisableRelay}
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ── Source: GitHub / GitLab / Bitbucket ──
function SourceBody({ provider, status, config, isAdmin, onConnect, onDisconnect, onSaveConfig, onSetupApp }) {
    const { t } = useTranslation();
    const connection = status?.connection;
    const configured = status?.configured;
    const isGithub = provider.provider === 'github';
    const appSlug = config?.app_slug || '';
    const callbackUrl = `${window.location.origin}/connections/callback/${provider.provider}`;
    const [cfg, setCfg] = useState({ client_id: config?.client_id || '', client_secret: config?.client_secret || '' });
    // GitHub leads with the one-click app; the manual OAuth form is tucked under
    // "Advanced". Other providers keep the manual form open.
    const [advancedOpen, setAdvancedOpen] = useState(!isGithub);
    const [busy, setBusy] = useState(false);

    async function save(e) {
        e.preventDefault();
        setBusy(true);
        try { await onSaveConfig(cfg); } finally { setBusy(false); }
    }

    return (
        <>
            {connection ? (
                <div className="conn-profile">
                    {connection.avatar_url && <img src={connection.avatar_url} alt="" />}
                    <div className="conn-profile__id">
                        <strong>{connection.display_name || connection.provider_username}</strong>
                        <span>@{connection.provider_username}</span>
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDisconnect}>
                        <Trash2 size={15} /> {t('app.connectProviderModal.disconnect', 'Disconnect')}
                    </Button>
                </div>
            ) : (
                <div className="conn-empty">
                    <span className="conn-empty__icon"><Link2 size={18} /></span>
                    <div className="conn-empty__text">
                        <strong>{configured ? t('app.connectProviderModal.connectYourAccount', 'Connect your {{name}} account', { name: provider.name }) : t('app.connectProviderModal.notSetUpYet', '{{name}} is not set up yet', { name: provider.name })}</strong>
                        <span>{configured
                            ? t('app.connectProviderModal.authorizeOnceThenPickRepositories', 'Authorize ServerKit once, then pick repositories on the new service page.')
                            : isGithub
                                ? t('app.connectProviderModal.setUpInOneClickBelow', 'Set it up in one click below, with no secrets to copy, then connect your account.')
                                : t('app.connectProviderModal.anAdminNeedsToAddOauthApp', 'An admin needs to add an OAuth app below before anyone can connect.')}</span>
                    </div>
                    <Button type="button" size="sm" disabled={!configured || busy} onClick={onConnect}>
                        <PlugZap size={15} /> {t('app.connectProviderModal.connect', 'Connect')} {provider.name}
                    </Button>
                </div>
            )}

            {/* One-click GitHub App setup (admin, GitHub only). */}
            {isAdmin && isGithub && (
                <div className="conn-oneclick">
                    <div className="conn-oneclick__head"><Zap size={15} /> {t('app.connectProviderModal.oneClickSetup', 'One-click setup')}</div>
                    <p className="conn-oneclick__blurb">
                        {t('app.connectProviderModal.createADedicatedGithubAppFor', 'Create a dedicated GitHub App for this server. You confirm once on GitHub (no OAuth secrets to copy), and its credentials are stored locally on your server.')}
                    </p>
                    {appSlug && (
                        <div className="conn-oneclick__done">
                            <CheckCircle2 size={14} /> {t('app.connectProviderModal.app', 'App')} <strong>{config.app_name || appSlug}</strong> {t('app.connectProviderModal.isSetUp', 'is set up.')}
                            {config.app_html_url && (
                                <a href={config.app_html_url} target="_blank" rel="noreferrer">
                                    <ExternalLink size={12} /> {t('app.connectProviderModal.manageOnGithub', 'Manage on GitHub')}
                                </a>
                            )}
                        </div>
                    )}
                    <div className="conn-form__actions">
                        <Button type="button" size="sm" onClick={onSetupApp}>
                            <Zap size={15} /> {appSlug ? t('app.connectProviderModal.recreateGithubApp', 'Re-create GitHub App') : t('app.connectProviderModal.setUpInOneClick', 'Set up in one click')}
                        </Button>
                    </div>
                </div>
            )}

            {isAdmin && (
                <div className="conn-advanced">
                    {isGithub && (
                        <Button variant="unstyled"
                            type="button"
                            className="conn-advanced__toggle"
                            onClick={() => setAdvancedOpen((o) => !o)}
                            aria-expanded={advancedOpen}
                        >
                            <span><KeyRound size={14} /> {t('app.connectProviderModal.advancedUseYourOwnOauthApp', 'Advanced: use your own OAuth app')}</span>
                            <ChevronDown size={15} className={advancedOpen ? 'conn-list__chev is-open' : 'conn-list__chev'} />
                        </Button>
                    )}
                    {advancedOpen && (
                        <form className="conn-form" onSubmit={save}>
                            {!isGithub && <div className="conn-form__heading"><KeyRound size={15} /> {t('app.connectProviderModal.oauthAppCredentials', 'OAuth app credentials')}</div>}
                            <div className="conn-form__grid">
                                <div className="form-group">
                                    <Label htmlFor="src-client-id">{t('app.connectProviderModal.clientId', 'Client ID')}</Label>
                                    <Input id="src-client-id" value={cfg.client_id} onChange={(e) => setCfg((c) => ({ ...c, client_id: e.target.value }))} placeholder={t('app.connectProviderModal.oauthClientId', '{{name}} OAuth client ID', { name: provider.name })} autoComplete="off" />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="src-client-secret">{t('app.connectProviderModal.clientSecret', 'Client secret')}</Label>
                                    <Input id="src-client-secret" type="password" value={cfg.client_secret} onChange={(e) => setCfg((c) => ({ ...c, client_secret: e.target.value }))} placeholder={t('app.connectProviderModal.oauthClientSecret', '{{name}} OAuth client secret', { name: provider.name })} autoComplete="off" />
                                </div>
                            </div>
                            <div className="conn-form__callback">
                                <CheckCircle2 size={14} /> {t('app.connectProviderModal.callbackUrl', 'Callback URL:')} <code>{callbackUrl}</code>
                            </div>
                            {provider.docUrl && (
                                <a className="conn-form__doc" href={provider.docUrl} target="_blank" rel="noreferrer">
                                    <ExternalLink size={13} /> {t('app.connectProviderModal.createAnOauthAppOn', 'Create an OAuth app on')} {provider.name}
                                </a>
                            )}
                            <div className="conn-form__actions">
                                <Button type="submit" size="sm" disabled={busy}>{busy ? t('common.saving', 'Saving…') : t('app.connectProviderModal.saveOauthApp', 'Save OAuth app')}</Button>
                            </div>
                        </form>
                    )}
                </div>
            )}
        </>
    );
}

// ── DNS: Cloudflare / Route 53 / DigitalOcean / GoDaddy ──
const EMPTY_DNS = { name: '', api_key: '', api_secret: '', api_email: '' };

function DnsBody({ provider, isAdmin, connections, onAdd, onRemove, onTest }) {
    const { t } = useTranslation();
    const isCloudflare = provider.provider === 'cloudflare';
    const isRoute53 = provider.provider === 'route53';
    const isDigitalOcean = provider.provider === 'digitalocean';
    const isGoDaddy = provider.provider === 'godaddy';
    const [cfMode, setCfMode] = useState('scoped'); // 'scoped' | 'global'
    const [form, setForm] = useState({ ...EMPTY_DNS, name: provider.name });
    const [busy, setBusy] = useState(false);
    const [activityId, setActivityId] = useState(null); // connection id whose change log is open

    const canAdd = (() => {
        if (!form.api_key.trim()) return false;
        if (isCloudflare && cfMode === 'global' && !form.api_email.trim()) return false;
        if ((isRoute53 || isGoDaddy) && !form.api_secret.trim()) return false;
        return true;
    })();

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }

    async function add(e) {
        e.preventDefault();
        const base = { name: form.name.trim() || provider.name, provider: provider.provider, api_key: form.api_key.trim() };
        let payload = base;
        if (isCloudflare && cfMode === 'global') payload = { ...base, api_email: form.api_email.trim() };
        if (isRoute53 || isGoDaddy) payload = { ...base, api_secret: form.api_secret.trim() };
        const ok = await withBusy(() => onAdd(payload));
        if (ok) setForm({ ...EMPTY_DNS, name: provider.name });
    }

    return (
        <>
            {connections.length > 0 && (
                <div className="conn-list">
                    {connections.map((c) => {
                        const scope = deriveScope(c);
                        const showActivity = activityId === c.id;
                        return (
                            <div key={c.id} className="conn-list__item">
                                <div className="conn-list__row">
                                    <div className="conn-list__info">
                                        <strong>{c.name}</strong>
                                        <span className="conn-list__key">{c.api_key}</span>
                                    </div>
                                    {scope && <span className={`conn-pill conn-pill--${scope.tone}`} title={scope.hint}>{scope.label}</span>}
                                    <div className="conn-list__actions">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={showActivity ? 'secondary' : 'ghost'}
                                            onClick={() => setActivityId(showActivity ? null : c.id)}
                                            aria-expanded={showActivity}
                                        >
                                            <Activity size={14} /> {t('app.connectProviderModal.recentChanges', 'Recent changes')}
                                            <ChevronDown size={14} className={`conn-list__chev${showActivity ? ' is-open' : ''}`} />
                                        </Button>
                                        {isAdmin && (
                                            <>
                                                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => withBusy(() => onTest(c.id))}>{t('common.actions.test', 'Test')}</Button>
                                                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => withBusy(() => onRemove(c))} aria-label={t('app.connectProviderModal.remove', 'Remove {{name}}', { name: c.name })}><Trash2 size={15} /></Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {showActivity && <DnsActivity configId={c.id} />}
                            </div>
                        );
                    })}
                </div>
            )}

            {!isAdmin ? (
                <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanAddOrChange', 'Only administrators can add or change connections.')}</p>
            ) : (
                <form className="conn-form" onSubmit={add}>
                    <div className="conn-form__heading">{connections.length > 0 ? t('app.connectProviderModal.addAnotherConnection', 'Add another connection') : t('app.connectProviderModal.connectProvider', 'Connect {{name}}', { name: provider.name })}</div>

                    {isCloudflare && (
                        <div className="conn-scope" role="radiogroup" aria-label={t('app.connectProviderModal.accessLevel', 'Access level')}>
                            <Button variant="unstyled" type="button" className={`conn-scope__opt${cfMode === 'scoped' ? ' is-active' : ''}`} onClick={() => setCfMode('scoped')} role="radio" aria-checked={cfMode === 'scoped'}>
                                <span className="conn-scope__head"><ShieldCheck size={16} /> {t('app.connectProviderModal.scopedToken', 'Scoped token')} <span className="conn-scope__rec">{t('app.connectProviderModal.recommended', 'Recommended')}</span></span>
                                <span className="conn-scope__desc">{t('app.connectProviderModal.aCloudflareTokenLimitedToDns', 'A Cloudflare token limited to DNS:Edit on the zones you choose. ServerKit can only touch DNS.')}</span>
                            </Button>
                            <Button variant="unstyled" type="button" className={`conn-scope__opt${cfMode === 'global' ? ' is-active' : ''}`} onClick={() => setCfMode('global')} role="radio" aria-checked={cfMode === 'global'}>
                                <span className="conn-scope__head"><ShieldAlert size={16} /> {t('app.connectProviderModal.globalApiKey', 'Global API key')}</span>
                                <span className="conn-scope__desc">{t('app.connectProviderModal.yourAccountEmailGlobalKeySimplest', 'Your account email + global key. Simplest to set up, but grants full account access.')}</span>
                            </Button>
                        </div>
                    )}

                    <div className="conn-form__grid">
                        <div className="form-group">
                            <Label htmlFor="dns-name">{t('app.connectProviderModal.connectionName', 'Connection name')}</Label>
                            <Input id="dns-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={provider.name} />
                        </div>

                        {(isDigitalOcean || (isCloudflare && cfMode === 'scoped')) && (
                            <div className="form-group conn-form__wide">
                                <Label htmlFor="dns-token">{t('app.connectProviderModal.apiToken', 'API token')}</Label>
                                <Input id="dns-token" type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={isDigitalOcean ? t('app.connectProviderModal.digitaloceanPersonalAccessToken', 'DigitalOcean personal access token') : t('app.connectProviderModal.cloudflareScopedApiToken', 'Cloudflare scoped API token')} autoComplete="off" />
                            </div>
                        )}

                        {isCloudflare && cfMode === 'global' && (
                            <>
                                <div className="form-group">
                                    <Label htmlFor="dns-email">{t('app.connectProviderModal.accountEmail', 'Account email')}</Label>
                                    <Input id="dns-email" type="email" value={form.api_email} onChange={(e) => setForm((f) => ({ ...f, api_email: e.target.value }))} placeholder="you@example.com" autoComplete="off" />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="dns-key">{t('app.connectProviderModal.globalApiKey', 'Global API key')}</Label>
                                    <Input id="dns-key" type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={t('app.connectProviderModal.cloudflareGlobalApiKey', 'Cloudflare global API key')} autoComplete="off" />
                                </div>
                            </>
                        )}

                        {isRoute53 && (
                            <>
                                <div className="form-group">
                                    <Label htmlFor="dns-akid">{t('app.connectProviderModal.accessKeyId', 'Access key ID')}</Label>
                                    <Input id="dns-akid" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={t('app.connectProviderModal.akia', 'AKIA…')} autoComplete="off" />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="dns-secret">{t('app.connectProviderModal.secretAccessKey', 'Secret access key')}</Label>
                                    <Input id="dns-secret" type="password" value={form.api_secret} onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))} placeholder={t('app.connectProviderModal.secretAccessKey', 'Secret access key')} autoComplete="off" />
                                </div>
                            </>
                        )}

                        {isGoDaddy && (
                            <>
                                <div className="form-group">
                                    <Label htmlFor="dns-gd-key">{t('app.connectProviderModal.apiKey', 'API key')}</Label>
                                    <Input id="dns-gd-key" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={t('app.connectProviderModal.godaddyApiKey', 'GoDaddy API key')} autoComplete="off" />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="dns-gd-secret">{t('app.connectProviderModal.apiSecret', 'API secret')}</Label>
                                    <Input id="dns-gd-secret" type="password" value={form.api_secret} onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))} placeholder={t('app.connectProviderModal.godaddyApiSecret', 'GoDaddy API secret')} autoComplete="off" />
                                </div>
                            </>
                        )}
                    </div>

                    {provider.docUrl && (
                        <a className="conn-form__doc" href={provider.docUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} /> {t('app.connectProviderModal.whereDoIGetThis', 'Where do I get this?')}
                        </a>
                    )}

                    <div className="conn-form__actions">
                        <Button type="submit" size="sm" disabled={busy || !canAdd}>{busy ? t('app.connectProviderModal.connecting', 'Connecting…') : t('app.connectProviderModal.connect', 'Connect')}</Button>
                    </div>
                </form>
            )}
        </>
    );
}

// ── Cloud: DigitalOcean / Hetzner / Vultr / Linode (server provisioning) ──
function CloudBody({ provider, isAdmin, connections, onAdd, onRemove }) {
    const { t } = useTranslation();
    const [form, setForm] = useState({ name: provider.name, api_key: '' });
    const [busy, setBusy] = useState(false);

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }

    async function add(e) {
        e.preventDefault();
        const ok = await withBusy(() => onAdd({ provider_type: provider.providerType, name: form.name.trim() || provider.name, api_key: form.api_key.trim() }));
        if (ok) setForm({ name: provider.name, api_key: '' });
    }

    return (
        <>
            {connections.length > 0 && (
                <div className="conn-list">
                    {connections.map((c) => (
                        <div key={c.id} className="conn-list__row">
                            <div className="conn-list__info">
                                <strong>{c.name}</strong>
                                <span className="conn-list__key">{t('app.connectProviderModal.connected', 'Connected')}</span>
                            </div>
                            {isAdmin && (
                                <div className="conn-list__actions">
                                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => withBusy(() => onRemove(c.id))} aria-label={t('app.connectProviderModal.disconnect2', 'Disconnect {{name}}', { name: c.name })}><Trash2 size={15} /></Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <p className="conn-modal__note">
                <Server size={15} /> {t('app.connectProviderModal.onceConnectedProvisionAndManageServers', 'Once connected, provision and manage servers from')} <Link className="conn-modal__link" to="/servers">{t('app.connectProviderModal.servers', 'Servers →')}</Link>
            </p>

            {!isAdmin ? (
                <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanConnectCloudAccounts', 'Only administrators can connect cloud accounts.')}</p>
            ) : (
                <form className="conn-form" onSubmit={add}>
                    <div className="conn-form__heading">{connections.length > 0 ? t('app.connectProviderModal.addAnotherAccount', 'Add another account') : t('app.connectProviderModal.connectProvider', 'Connect {{name}}', { name: provider.name })}</div>
                    <div className="conn-form__grid">
                        <div className="form-group">
                            <Label htmlFor="cloud-name">{t('app.connectProviderModal.accountName', 'Account name')}</Label>
                            <Input id="cloud-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={provider.name} />
                        </div>
                        <div className="form-group conn-form__wide">
                            <Label htmlFor="cloud-token">{t('app.connectProviderModal.apiToken', 'API token')}</Label>
                            <Input id="cloud-token" type="password" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={t('app.connectProviderModal.apiToken3', '{{name}} API token', { name: provider.name })} autoComplete="off" />
                        </div>
                    </div>
                    {provider.docUrl && (
                        <a className="conn-form__doc" href={provider.docUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} /> {t('app.connectProviderModal.whereDoIGetThis', 'Where do I get this?')}
                        </a>
                    )}
                    <div className="conn-form__actions">
                        <Button type="submit" size="sm" disabled={busy || !form.api_key.trim()}>{busy ? t('app.connectProviderModal.connecting', 'Connecting…') : t('app.connectProviderModal.connect', 'Connect')}</Button>
                    </div>
                </form>
            )}
        </>
    );
}

// ── Storage: S3-compatible / Backblaze B2 ──
const STORAGE_FIELDS = {
    s3: [
        { k: 'bucket', labelKey: 'app.connectProviderModal.bucket', label: 'Bucket' },
        { k: 'region', labelKey: 'app.connectProviderModal.region', label: 'Region', placeholder: 'us-east-1' },
        { k: 'access_key', labelKey: 'app.connectProviderModal.accessKeyId', label: 'Access key ID', placeholderKey: 'app.connectProviderModal.akia', placeholder: 'AKIA…' },
        { k: 'secret_key', labelKey: 'app.connectProviderModal.secretAccessKey', label: 'Secret access key', secret: true },
        { k: 'endpoint_url', labelKey: 'app.connectProviderModal.endpointUrlOptional', label: 'Endpoint URL (optional)', placeholder: 'https://… for Wasabi / MinIO / Spaces', wide: true },
        { k: 'path_prefix', labelKey: 'app.connectProviderModal.pathPrefix', label: 'Path prefix', placeholder: 'serverkit-backups' },
    ],
    b2: [
        { k: 'bucket', labelKey: 'app.connectProviderModal.bucket', label: 'Bucket' },
        { k: 'key_id', labelKey: 'app.connectProviderModal.keyId', label: 'Key ID' },
        { k: 'application_key', labelKey: 'app.connectProviderModal.applicationKey', label: 'Application key', secret: true },
        { k: 'endpoint_url', labelKey: 'app.connectProviderModal.endpointUrl', label: 'Endpoint URL', placeholder: 'https://s3.us-west-…backblazeb2.com', wide: true },
        { k: 'path_prefix', labelKey: 'app.connectProviderModal.pathPrefix', label: 'Path prefix', placeholder: 'serverkit-backups' },
    ],
};

function StorageBody({ provider, isAdmin, storageConfig, onSave, onTest }) {
    const { t } = useTranslation();
    const sp = provider.storageProvider; // 's3' | 'b2'
    const fields = STORAGE_FIELDS[sp] || [];
    const existing = (storageConfig && storageConfig[sp]) || {};
    const [form, setForm] = useState(() => {
        const init = {};
        for (const f of fields) init[f.k] = existing[f.k] || '';
        return init;
    });
    const [busy, setBusy] = useState(false);
    const isActive = storageConfig?.provider === sp;

    function buildConfig() {
        return { ...(storageConfig || {}), provider: sp, [sp]: { ...existing, ...form } };
    }

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }
    async function save(e) { e.preventDefault(); await withBusy(() => onSave(buildConfig())); }
    async function test() { await withBusy(() => onTest(buildConfig())); }

    if (!isAdmin) {
        return <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanConfigureStorage', 'Only administrators can configure storage.')}</p>;
    }

    return (
        <>
            <p className="conn-modal__note">
                <HardDrive size={15} /> {isActive ? t('app.connectProviderModal.activeBackupDestination', 'This is the active backup destination.') : t('app.connectProviderModal.savingMakesThisActive', 'Saving makes this the active offsite destination.')} {t('app.connectProviderModal.manageBackupsIn', 'Manage backups in')} <Link className="conn-modal__link" to="/backups">{t('app.connectProviderModal.backups', 'Backups →')}</Link>
            </p>
            <form className="conn-form" onSubmit={save}>
                <div className="conn-form__heading"><KeyRound size={15} /> {t('app.connectProviderModal.providerCredentials', '{{name}} credentials', { name: provider.name })}</div>
                <div className="conn-form__grid">
                    {fields.map((f) => (
                        <div key={f.k} className={`form-group${f.wide ? ' conn-form__wide' : ''}`}>
                            <Label htmlFor={`st-${f.k}`}>{f.label}</Label>
                            <Input
                                id={`st-${f.k}`}
                                type={f.secret ? 'password' : 'text'}
                                value={form[f.k]}
                                onChange={(e) => setForm((s) => ({ ...s, [f.k]: e.target.value }))}
                                placeholder={f.placeholder || ''}
                                autoComplete="off"
                            />
                        </div>
                    ))}
                </div>
                {provider.docUrl && (
                    <a className="conn-form__doc" href={provider.docUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={13} /> {t('app.connectProviderModal.whereDoIGetThis', 'Where do I get this?')}
                    </a>
                )}
                <div className="conn-form__actions conn-form__actions--split">
                    <Button type="button" variant="outline" size="sm" disabled={busy || !form.bucket} onClick={test}>{t('common.actions.test', 'Test')}</Button>
                    <Button type="submit" size="sm" disabled={busy || !form.bucket}>{busy ? t('common.saving', 'Saving…') : t('common.actions.save', 'Save')}</Button>
                </div>
            </form>
        </>
    );
}

// ── Registrar: GoDaddy (domain portfolio + expiry) ──
function RegistrarBody({ provider, isAdmin, connections, onAdd, onRemove, onTest }) {
    const { t } = useTranslation();
    const isNamecheap = provider.provider === 'namecheap';
    const [form, setForm] = useState({ name: provider.name, api_key: '', api_secret: '', username: '', client_ip: '' });
    const [busy, setBusy] = useState(false);
    const canAdd = isNamecheap
        ? Boolean(form.api_key.trim() && form.username.trim() && form.client_ip.trim())
        : Boolean(form.api_key.trim() && form.api_secret.trim());

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }
    async function add(e) {
        e.preventDefault();
        const payload = { provider: provider.provider, name: form.name.trim() || provider.name, api_key: form.api_key.trim() };
        if (isNamecheap) {
            payload.username = form.username.trim();
            payload.client_ip = form.client_ip.trim();
        } else {
            payload.api_secret = form.api_secret.trim();
        }
        const ok = await withBusy(() => onAdd(payload));
        if (ok) setForm({ name: provider.name, api_key: '', api_secret: '', username: '', client_ip: '' });
    }

    return (
        <>
            {connections.length > 0 && (
                <div className="conn-list">
                    {connections.map((c) => (
                        <div key={c.id} className="conn-list__row">
                            <div className="conn-list__info">
                                <strong>{c.name}</strong>
                                <span className="conn-list__key">{c.account_label || t('app.connectProviderModal.connected', 'Connected')}</span>
                            </div>
                            {isAdmin && (
                                <div className="conn-list__actions">
                                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => withBusy(() => onTest(c.id))}>{t('common.actions.test', 'Test')}</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => withBusy(() => onRemove(c.id))} aria-label={t('app.connectProviderModal.disconnect2', 'Disconnect {{name}}', { name: c.name })}><Trash2 size={15} /></Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <p className="conn-modal__note">
                <Globe size={15} /> {t('app.connectProviderModal.seeEveryDomainAndItsExpiry', 'See every domain and its expiry on the')} <Link className="conn-modal__link" to="/domains">{t('app.connectProviderModal.domains', 'Domains →')}</Link> page.
            </p>

            {!isAdmin ? (
                <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanConnectARegistrar', 'Only administrators can connect a registrar.')}</p>
            ) : (
                <form className="conn-form" onSubmit={add}>
                    <div className="conn-form__heading">{connections.length > 0 ? t('app.connectProviderModal.addAnotherAccount', 'Add another account') : t('app.connectProviderModal.connectProvider', 'Connect {{name}}', { name: provider.name })}</div>
                    <div className="conn-form__grid">
                        <div className="form-group conn-form__wide">
                            <Label htmlFor="reg-name">{t('app.connectProviderModal.accountName', 'Account name')}</Label>
                            <Input id="reg-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={provider.name} />
                        </div>
                        <div className="form-group">
                            <Label htmlFor="reg-key">{t('app.connectProviderModal.apiKey', 'API key')}</Label>
                            <Input id="reg-key" value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder={isNamecheap ? t('app.connectProviderModal.namecheapApiKey', 'Namecheap API key') : t('app.connectProviderModal.godaddyApiKeyProduction', 'GoDaddy API key (production)')} autoComplete="off" />
                        </div>
                        {isNamecheap ? (
                            <>
                                <div className="form-group">
                                    <Label htmlFor="reg-user">{t('app.connectProviderModal.apiUsername', 'API username')}</Label>
                                    <Input id="reg-user" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder={t('app.connectProviderModal.namecheapAccountUsername', 'Namecheap account username')} autoComplete="off" />
                                </div>
                                <div className="form-group">
                                    <Label htmlFor="reg-ip">{t('app.connectProviderModal.allowListedIp', 'Allow-listed IP')}</Label>
                                    <Input id="reg-ip" value={form.client_ip} onChange={(e) => setForm((f) => ({ ...f, client_ip: e.target.value }))} placeholder={t('app.connectProviderModal.thisServerSPublicIp', 'This server\'s public IP')} autoComplete="off" />
                                </div>
                            </>
                        ) : (
                            <div className="form-group">
                                <Label htmlFor="reg-secret">{t('app.connectProviderModal.apiSecret', 'API secret')}</Label>
                                <Input id="reg-secret" type="password" value={form.api_secret} onChange={(e) => setForm((f) => ({ ...f, api_secret: e.target.value }))} placeholder={t('app.connectProviderModal.godaddyApiSecret', 'GoDaddy API secret')} autoComplete="off" />
                            </div>
                        )}
                    </div>
                    {provider.docUrl && (
                        <a className="conn-form__doc" href={provider.docUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={13} /> {t('app.connectProviderModal.whereDoIGetThis', 'Where do I get this?')}
                        </a>
                    )}
                    <div className="conn-form__actions">
                        <Button type="submit" size="sm" disabled={busy || !canAdd}>{busy ? t('app.connectProviderModal.connecting', 'Connecting…') : t('app.connectProviderModal.connect', 'Connect')}</Button>
                    </div>
                </form>
            )}
        </>
    );
}

// ── Container registries: GHCR / Docker Hub / GitLab / ECR / generic ──
// One card holds every registry; a provider selector presets the login host.
function RegistryBody({ isAdmin, registries, onAdd, onRemove, onTest }) {
    const { t } = useTranslation();
    const [providerId, setProviderId] = useState(REGISTRY_PROVIDERS[0].id);
    const preset = REGISTRY_PROVIDERS.find((p) => p.id === providerId) || REGISTRY_PROVIDERS[0];
    const [form, setForm] = useState({ name: '', registry_url: REGISTRY_PROVIDERS[0].url, username: '', secret: '' });
    const [busy, setBusy] = useState(false);

    function pickProvider(id) {
        const p = REGISTRY_PROVIDERS.find((x) => x.id === id) || REGISTRY_PROVIDERS[0];
        setProviderId(id);
        // Preset (or lock) the host to the provider's default.
        setForm((f) => ({ ...f, registry_url: p.url }));
    }

    // ECR authenticates with AWS keys, no username; every other provider needs one.
    const needsUsername = providerId !== 'ecr';
    const canAdd = Boolean(form.name.trim() && form.secret.trim() && (!needsUsername || form.username.trim()));

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }
    async function add(e) {
        e.preventDefault();
        const payload = {
            name: form.name.trim(),
            provider: providerId,
            registry_url: (form.registry_url || preset.url || '').trim(),
            username: form.username.trim(),
            secret: form.secret,
        };
        const ok = await withBusy(() => onAdd(payload));
        if (ok) setForm({ name: '', registry_url: preset.url, username: '', secret: '' });
    }

    return (
        <>
            {registries.length > 0 && (
                <div className="conn-list">
                    {registries.map((r) => (
                        <div key={r.id} className="conn-list__row">
                            <div className="conn-list__info">
                                <strong>{r.name}</strong>
                                <span className="conn-list__key">{r.login_host}{r.username ? ` · ${r.username}` : ''}</span>
                            </div>
                            <span className="conn-pill conn-pill--neutral" title={t('app.connectProviderModal.registryProvider', 'Registry provider')}>{r.provider}</span>
                            {isAdmin && (
                                <div className="conn-list__actions">
                                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => withBusy(() => onTest(r.id))}>{t('common.actions.test', 'Test')}</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => withBusy(() => onRemove(r.id))} aria-label={t('app.connectProviderModal.remove', 'Remove {{name}}', { name: r.name })}><Trash2 size={15} /></Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <p className="conn-modal__note">
                <Boxes size={15} /> {t('app.connectProviderModal.attachARegistryToAService', 'Attach a registry to a service on the')} <Link className="conn-modal__link" to="/services/new">{t('app.connectProviderModal.newService', 'New Service →')}</Link> {t('app.connectProviderModal.pageToDeployItsPrivateImages', 'page to deploy its private images.')}
            </p>

            {!isAdmin ? (
                <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanAddRegistries', 'Only administrators can add registries.')}</p>
            ) : (
                <form className="conn-form" onSubmit={add}>
                    <div className="conn-form__heading">{registries.length > 0 ? t('app.connectProviderModal.addAnotherRegistry', 'Add another registry') : t('app.connectProviderModal.connectARegistry', 'Connect a registry')}</div>

                    <div className="conn-presets" role="radiogroup" aria-label={t('app.connectProviderModal.registryProvider', 'Registry provider')}>
                        {REGISTRY_PROVIDERS.map((p) => (
                            <Button variant="unstyled"
                                type="button"
                                key={p.id}
                                className={`conn-presets__opt${providerId === p.id ? ' is-active' : ''}`}
                                onClick={() => pickProvider(p.id)}
                                role="radio"
                                aria-checked={providerId === p.id}
                            >
                                {p.name}
                            </Button>
                        ))}
                    </div>

                    <div className="conn-form__grid">
                        <div className="form-group">
                            <Label htmlFor="reg-name">{t('app.connectProviderModal.connectionName', 'Connection name')}</Label>
                            <Input id="reg-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t('app.connectProviderModal.registryTeamPlaceholder', '{{name}} (team)', { name: preset.name })} />
                        </div>
                        <div className="form-group">
                            <Label htmlFor="reg-url">{t('app.connectProviderModal.registryHost', 'Registry host')}</Label>
                            <Input
                                id="reg-url"
                                value={form.registry_url}
                                onChange={(e) => setForm((f) => ({ ...f, registry_url: e.target.value }))}
                                placeholder={preset.id === 'dockerhub' ? t('app.connectProviderModal.indexDockerIoDockerHub', 'index.docker.io (Docker Hub)') : 'registry.example.com'}
                                disabled={preset.urlLocked}
                                autoComplete="off"
                            />
                        </div>
                        {needsUsername && (
                            <div className="form-group">
                                <Label htmlFor="reg-username">{t('common.labels.username', 'Username')}</Label>
                                <Input id="reg-username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder={preset.usernameHint} autoComplete="off" />
                            </div>
                        )}
                        <div className={`form-group${needsUsername ? '' : ' conn-form__wide'}`}>
                            <Label htmlFor="reg-secret">{providerId === 'ecr' ? t('app.connectProviderModal.awsCredentials', 'AWS credentials') : t('app.connectProviderModal.passwordToken', 'Password / token')}</Label>
                            <Input id="reg-secret" type="password" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} placeholder={preset.secretHint} autoComplete="off" />
                        </div>
                    </div>

                    <a className="conn-form__doc" href="https://docs.docker.com/engine/reference/commandline/login/" target="_blank" rel="noreferrer">
                        <ExternalLink size={13} /> {t('app.connectProviderModal.howRegistryLoginWorks', 'How registry login works')}
                    </a>

                    <div className="conn-form__actions">
                        <Button type="submit" size="sm" disabled={busy || !canAdd}>{busy ? t('app.connectProviderModal.connecting', 'Connecting…') : t('app.connectProviderModal.connect', 'Connect')}</Button>
                    </div>
                </form>
            )}
        </>
    );
}

// ── Email: outbound SMTP relay (smarthost) ──
const SMTP_PRESETS = [
    { id: 'postmark', name: 'Postmark', host: 'smtp.postmarkapp.com', port: 587 },
    { id: 'ses', name: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587 },
    { id: 'mailgun', name: 'Mailgun', host: 'smtp.mailgun.org', port: 587 },
    { id: 'sendgrid', name: 'SendGrid', host: 'smtp.sendgrid.net', port: 587 },
    { id: 'custom', name: 'Custom', host: '', port: 587 },
];

function EmailBody({ isAdmin, relayConfig, onSave, onTest, onDisable }) {
    const { t } = useTranslation();
    const cfg = relayConfig || {};
    const [form, setForm] = useState({
        provider_hint: cfg.provider_hint || 'custom',
        host: cfg.host || '',
        port: cfg.port || 587,
        username: cfg.username || '',
        password: '',
        use_tls: cfg.use_tls !== false,
        enabled: cfg.enabled !== false,
    });
    const [busy, setBusy] = useState(false);
    const configured = Boolean(cfg.host);

    function applyPreset(id) {
        const p = SMTP_PRESETS.find((x) => x.id === id);
        setForm((f) => ({ ...f, provider_hint: id, ...(id === 'custom' || !p ? {} : { host: p.host, port: p.port }) }));
    }

    function payload() {
        return {
            provider_hint: form.provider_hint,
            host: form.host.trim(),
            port: Number(form.port) || 587,
            username: form.username.trim(),
            ...(form.password ? { password: form.password } : {}),
            use_tls: form.use_tls,
            enabled: form.enabled,
        };
    }

    async function withBusy(fn) { setBusy(true); try { return await fn(); } finally { setBusy(false); } }
    async function save(e) { e.preventDefault(); await withBusy(() => onSave(payload())); }
    async function test() { await withBusy(() => onTest(payload())); }

    if (!isAdmin) {
        return <p className="conn-modal__note"><ShieldCheck size={15} /> {t('app.connectProviderModal.onlyAdministratorsCanConfigureTheMail', 'Only administrators can configure the mail relay.')}</p>;
    }

    return (
        <form className="conn-form" onSubmit={save}>
            <div className="conn-form__heading"><Mail size={15} /> {t('app.connectProviderModal.outboundRelay', 'Outbound relay')}</div>

            <div className="conn-presets" role="radiogroup" aria-label={t('app.connectProviderModal.providerPreset', 'Provider preset')}>
                {SMTP_PRESETS.map((p) => (
                    <Button variant="unstyled"
                        type="button"
                        key={p.id}
                        className={`conn-presets__opt${form.provider_hint === p.id ? ' is-active' : ''}`}
                        onClick={() => applyPreset(p.id)}
                        role="radio"
                        aria-checked={form.provider_hint === p.id}
                    >
                        {p.name}
                    </Button>
                ))}
            </div>

            <div className="conn-form__grid">
                <div className="form-group conn-form__wide">
                    <Label htmlFor="relay-host">{t('app.connectProviderModal.smtpHost', 'SMTP host')}</Label>
                    <Input id="relay-host" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="smtp.provider.com" autoComplete="off" />
                </div>
                <div className="form-group">
                    <Label htmlFor="relay-port">{t('common.labels.port', 'Port')}</Label>
                    <PortField id="relay-port" host={false} allowPrivileged value={form.port} onChange={(port) => setForm((f) => ({ ...f, port }))} placeholder="587" />
                </div>
                <div className="form-group">
                    <Label htmlFor="relay-user">{t('common.labels.username', 'Username')}</Label>
                    <Input id="relay-user" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder={t('app.connectProviderModal.smtpUsernameApiToken', 'SMTP username / API token')} autoComplete="off" />
                </div>
                <div className="form-group conn-form__wide">
                    <Label htmlFor="relay-pass">{t('common.labels.password', 'Password')}{cfg.password_set ? ` ${t('app.connectProviderModal.leaveBlankToKeep', '(leave blank to keep)')}` : ''}</Label>
                    <Input id="relay-pass" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder={cfg.password_set ? t('app.connectProviderModal.stored', '•••••••• stored') : t('app.connectProviderModal.smtpPasswordApiToken', 'SMTP password / API token')} autoComplete="off" />
                </div>
            </div>

            <label className="conn-check">
                <Checkbox checked={form.use_tls} onCheckedChange={(v) => setForm((f) => ({ ...f, use_tls: Boolean(v) }))} />
                <span>{t('app.connectProviderModal.useStarttlsRecommended', 'Use STARTTLS (recommended)')}</span>
            </label>
            <label className="conn-check">
                <Checkbox checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: Boolean(v) }))} />
                <span>{t('app.connectProviderModal.routeTheMailServerSOutbound', 'Route the mail server\'s outbound mail through this relay')}</span>
            </label>

            <div className="conn-form__actions conn-form__actions--split">
                <span>
                    {configured && (
                        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => withBusy(() => onDisable())}>
                            <Trash2 size={15} /> {t('common.actions.disable', 'Disable')}
                        </Button>
                    )}
                </span>
                <span className="conn-form__actions-group">
                    <Button type="button" variant="outline" size="sm" disabled={busy || !form.host.trim()} onClick={test}>{t('common.actions.test', 'Test')}</Button>
                    <Button type="submit" size="sm" disabled={busy || !form.host.trim()}>{busy ? t('common.saving', 'Saving…') : t('common.actions.save', 'Save')}</Button>
                </span>
            </div>
        </form>
    );
}
