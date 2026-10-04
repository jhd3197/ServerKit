import { useCallback, useState, useEffect  } from 'react';
import api from '../../services/api';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import DomainField from '../DomainField';
import ErrorState from '../ErrorState';
import { Pill } from '@/components/ds';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useAuth } from '../../contexts/useAuth.js';
import { useTranslation } from 'react-i18next';

const SiteSettingsTab = ({ onDevModeChange }) => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const { refreshSetupStatus } = useAuth();
    const [panelTitle, setPanelTitle] = useState('ServerKit');
    const [publicTitle, setPublicTitle] = useState('Control Panel');
    const [loginLayout, setLoginLayout] = useState('centered');
    const [savingBrand, setSavingBrand] = useState(false);
    const [settings, setSettings] = useState({
        registration_enabled: false,
        dev_mode: false
    });
    const [basePort, setBasePort] = useState('0');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [httpsError, setHttpsError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [savingPort, setSavingPort] = useState(false);
    const [message, setMessage] = useState(null);
    const [https, setHttps] = useState({ base_domain: '', server_ip: '', https_enabled: false, dns_mode: 'wildcard', providers: [], bases: [] });
    const [baseDomain, setBaseDomain] = useState('');
    const [serverIp, setServerIp] = useState('');
    const [providerId, setProviderId] = useState('');
    const [savingDomain, setSavingDomain] = useState(false);
    const [savingDnsMode, setSavingDnsMode] = useState(false);
    // Base-domain registry: add a new base + track which row an action is running on.
    const [newDomain, setNewDomain] = useState('');
    const [newDnsMode, setNewDnsMode] = useState('wildcard');
    const [newDomainKey, setNewDomainKey] = useState(0);
    const [addingDomain, setAddingDomain] = useState(false);
    const [rowBusy, setRowBusy] = useState('');   // domain currently being mutated

    const loadHttps = useCallback(async () => {
        try {
            const h = await api.getSitesHttpsStatus();
            setHttps(h);
            setBaseDomain(h.base_domain || '');
            setServerIp(h.server_ip || '');
            if (h.providers?.length) setProviderId(current => current || String(h.providers[0].id));
            setHttpsError(null);
        } catch (err) {
            setHttpsError(err);
        }
    }, []);

    const loadSettings = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getSystemSettings();
            setSettings({
                registration_enabled: data.registration_enabled || false,
                dev_mode: data.dev_mode || false
            });
            setBasePort(String(data.managed_app_base_port ?? 0));
            setPanelTitle(data.panel_title ?? 'ServerKit');
            setPublicTitle(data.public_title ?? 'Control Panel');
            setLoginLayout(data.login_layout ?? 'centered');
            setLoadError(null);
            await loadHttps();
        } catch (err) {
            console.error('Failed to load settings:', err);
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, [loadHttps]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);


    // The bases to show: the registry when populated, else a synthetic row for
    // the single legacy base (editable in place) so single-domain installs and
    // fresh installs both work through the same UI.
    const displayBases = (https.bases && https.bases.length)
        ? https.bases
        : (baseDomain
            ? [{ domain: baseDomain, is_default: true, https_enabled: https.https_enabled, dns_mode: https.dns_mode, _legacy: true }]
            : []);
    const hasRegistry = !!(https.bases && https.bases.length);

    async function handleAddDomain() {
        const domain = newDomain.trim();
        if (!domain) return;
        setAddingDomain(true);
        setMessage(null);
        try {
            const res = await api.addSiteBaseDomain(domain, { dnsMode: newDnsMode });
            if (res.success) {
                setNewDomain('');
                // DomainField keeps its own draft; remount it to clear the input.
                setNewDomainKey((k) => k + 1);
                setMessage({ type: 'success', text: `Added base domain ${domain}` });
                await loadHttps();
            } else {
                setMessage({ type: 'error', text: res.error || 'Could not add base domain' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Could not add base domain' });
        } finally {
            setAddingDomain(false);
        }
    }

    async function handleRemoveDomain(domain) {
        setRowBusy(domain);
        setMessage(null);
        try {
            const res = await api.removeSiteBaseDomain(domain);
            if (res.success) {
                setMessage({ type: 'success', text: `Removed ${domain}` });
                await loadHttps();
            } else {
                setMessage({ type: 'error', text: res.error || 'Could not remove base domain' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Could not remove base domain' });
        } finally {
            setRowBusy('');
        }
    }

    async function handleMakeDefault(domain) {
        setRowBusy(domain);
        setMessage(null);
        try {
            const res = await api.setDefaultSiteBaseDomain(domain);
            if (res.success) {
                setMessage({ type: 'success', text: `${domain} is now the default base domain` });
                await loadHttps();
            } else {
                setMessage({ type: 'error', text: res.error || 'Could not set default' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Could not set default' });
        } finally {
            setRowBusy('');
        }
    }

    async function handleRowDnsMode(base, mode) {
        if (base._legacy) return handleSaveDnsMode(mode);   // legacy setting path
        setRowBusy(base.domain);
        setMessage(null);
        try {
            const res = await api.updateSiteBaseDomain(base.domain, { dnsMode: mode });
            if (res.success) await loadHttps();
            else setMessage({ type: 'error', text: res.error || 'Could not update DNS mode' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Could not update DNS mode' });
        } finally {
            setRowBusy('');
        }
    }

    async function handleSetupHttpsFor(base) {
        if (!providerId) {
            setMessage({ type: 'error', text: 'Connect and select a DNS provider first' });
            return;
        }
        setRowBusy(base.domain);
        setMessage(null);
        try {
            if (serverIp.trim()) await api.updateSystemSetting('server_public_ip', serverIp.trim());
            // A legacy synthetic row has no registry entry yet — omit base so the
            // backend targets the default (and persists to settings).
            const res = await api.setupSitesHttps(Number(providerId), undefined, base._legacy ? undefined : base.domain);
            if (res.success) {
                setMessage({ type: 'success', text: `Wildcard HTTPS set up for *.${res.base_domain}` + (res.warning ? ` — ${res.warning}` : '') });
                await loadHttps();
            } else {
                setMessage({ type: 'error', text: res.error || 'HTTPS setup failed' });
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'HTTPS setup failed' });
        } finally {
            setRowBusy('');
        }
    }

    async function handleSaveServerIp() {
        setSavingDomain(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('server_public_ip', serverIp.trim());
            setMessage({ type: 'success', text: 'Server public IP saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save server IP' });
        } finally {
            setSavingDomain(false);
        }
    }

    // Legacy single-base edit: persists the sites_base_domain setting in place
    // (only used for the synthetic row on installs with no registry entries yet).
    async function handleSaveDomain() {
        setSavingDomain(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('sites_base_domain', baseDomain.trim());
            setMessage({ type: 'success', text: 'Base domain saved' });
            await loadHttps();
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save base domain' });
        } finally {
            setSavingDomain(false);
        }
    }

    async function handleSaveDnsMode(mode) {
        setSavingDnsMode(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('sites_dns_mode', mode);
            setHttps((h) => ({ ...h, dns_mode: mode }));
            setMessage({
                type: 'success',
                text: mode === 'per-site'
                    ? 'Per-site DNS — new sites get their own A record'
                    : 'Wildcard DNS — new sites ride the *.base record',
            });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update DNS mode' });
        } finally {
            setSavingDnsMode(false);
        }
    }

    async function handleSaveBasePort() {
        const value = parseInt(basePort, 10);
        if (Number.isNaN(value) || value < 0 || value > 65535) {
            setMessage({ type: 'error', text: 'Base port must be between 0 and 65535 (0 = template default)' });
            return;
        }
        setSavingPort(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('managed_app_base_port', value);
            setBasePort(String(value));
            setMessage({
                type: 'success',
                text: value === 0
                    ? 'Base port reset — new services use each template\'s default'
                    : `New services will be assigned ports starting from ${value}`
            });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update base port' });
        } finally {
            setSavingPort(false);
        }
    }

    async function handleSaveBrand() {
        setSavingBrand(true);
        setMessage(null);
        try {
            await api.updateSystemSetting('panel_title', panelTitle.trim() || 'ServerKit');
            await api.updateSystemSetting('public_title', publicTitle.trim() || 'Control Panel');
            await api.updateSystemSetting('login_layout', loginLayout);
            await refreshSetupStatus();   // running SPA picks up the new title live
            setMessage({ type: 'success', text: 'Panel appearance saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save appearance' });
        } finally {
            setSavingBrand(false);
        }
    }

    async function handleToggleSetting(key, label) {
        setSaving(true);
        setMessage(null);

        try {
            const newValue = !settings[key];
            await api.updateSystemSetting(key, newValue);
            setSettings({ ...settings, [key]: newValue });
            setMessage({ type: 'success', text: `${label} ${newValue ? 'enabled' : 'disabled'}` });
            if (key === 'dev_mode' && onDevModeChange) {
                onDevModeChange(newValue);
            }
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update setting' });
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="settings-section"><p>{t('common.loading', 'Loading…')}</p></div>;
    }

    // The form is seeded with defaults, so rendering it after a failed load
    // would invite saving those defaults over the real settings.
    if (loadError) {
        return (
            <div className="settings-section">
                <ErrorState
                    title={t('app.siteSettingsTab.couldntLoadSiteSettings', "Couldn't load site settings")}
                    error={loadError}
                    onRetry={loadSettings}
                />
            </div>
        );
    }

    return (
        <div className="settings-section">
            <h2>{t('app.siteSettingsTab.siteSettings', 'Site settings')}</h2>
            <p className="section-description">{t('app.siteSettingsTab.configureGlobalSiteSettings', 'Configure global site settings')}</p>

            {message && (
                <div className={`message ${message.type}`}>{message.text}</div>
            )}

            <div {...register('site-appearance', 'settings-card')}>
                <h3>{t('app.siteSettingsTab.panelAppearance', 'Panel appearance')}</h3>
                <p>{t('app.siteSettingsTab.namesShownInTheBrowserTab', 'Names shown in the browser tab and on the sign-in page, plus the sign-in page layout.')}</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="public-title">{t('app.siteSettingsTab.publicSignInTitle', 'Public sign-in title')}</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="public-title"
                                type="text"
                                value={publicTitle}
                                onChange={(e) => setPublicTitle(e.target.value)}
                                placeholder={t('app.siteSettingsTab.controlPanel', 'Control panel')}
                            />
                        </div>
                    </div>
                    <span className="form-help">{t('app.siteSettingsTab.shownOnThePublicSignIn', "Shown on the public sign-in / register pages and the browser tab before sign-in. Kept brand-neutral by default so the panel isn't trivially identifiable.")}</span>
                </div>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="panel-title">{t('app.siteSettingsTab.panelTitleSignedIn', 'Panel title (signed in)')}</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="panel-title"
                                type="text"
                                value={panelTitle}
                                onChange={(e) => setPanelTitle(e.target.value)}
                                placeholder={t('common.labels.serverKit', 'ServerKit')}
                            />
                        </div>
                    </div>
                    <span className="form-help">{t('app.siteSettingsTab.shownInTheBrowserTabOnce', 'Shown in the browser tab once signed in (inside the panel).')}</span>
                </div>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="login-layout">{t('app.siteSettingsTab.loginLayout', 'Sign-in layout')}</Label>
                        </div>
                        <div className="settings-control">
                            <Select value={loginLayout} onValueChange={setLoginLayout}>
                                <SelectTrigger id="login-layout" className="settings-select">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="centered">{t('app.siteSettingsTab.centeredCard', 'Centered card')}</SelectItem>
                                    <SelectItem value="split">{t('app.siteSettingsTab.splitHero', 'Split hero')}</SelectItem>
                                    <SelectItem value="minimal">{t('app.siteSettingsTab.minimal', 'Minimal')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button onClick={handleSaveBrand} disabled={savingBrand}>
                                {savingBrand ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">{t('app.siteSettingsTab.rearrangesTheSignInPageApplies', 'Rearranges the sign-in page. Applies on the next load of the sign-in page.')}</span>
                </div>
            </div>

            <div {...register('site-registration', 'settings-card')}>
                <h3>{t('app.siteSettingsTab.userRegistration', 'User registration')}</h3>
                <p>{t('app.siteSettingsTab.allowNewUsersToCreateAccounts', 'Allow new users to create accounts on the sign-in page.')}</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>{t('app.siteSettingsTab.enablePublicRegistration', 'Enable public registration')}</Label>
                        </div>
                        <Switch
                            checked={settings.registration_enabled}
                            onCheckedChange={() => handleToggleSetting('registration_enabled', 'User registration')}
                            disabled={saving}
                        />
                    </div>
                    <span className="form-help">
                        {t('app.siteSettingsTab.whenDisabledOnlyAdministratorsCanCreate', 'When disabled, only administrators can create new user accounts.')}
                    </span>
                </div>
            </div>

            <div {...register('site-app-ports', 'settings-card')}>
                <h3>{t('app.siteSettingsTab.managedAppPorts', 'Managed service ports')}</h3>
                <p>{t('app.siteSettingsTab.controlTheHostPortAssignedTo', 'Control the host port assigned to new WordPress sites and other managed services.')}</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="managed-app-base-port">{t('app.siteSettingsTab.basePort', 'Base port')}</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="managed-app-base-port"
                                type="number"
                                min={0}
                                max={65535}
                                value={basePort}
                                onChange={(e) => setBasePort(e.target.value)}
                                disabled={savingPort}
                            />
                            <Button onClick={handleSaveBasePort} disabled={savingPort}>
                                {savingPort ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">
                        {t('app.siteSettingsTab.newAppsGetTheFirstFree', 'New services get the first free port at or above this number. Set to')} <strong>0</strong> {t('app.siteSettingsTab.toUseEachTemplateSOwn', 'to use each template\'s own default (WordPress starts at 8300). Ports already in use are always skipped, so collisions can\'t happen.')}
                    </span>
                </div>
            </div>

            <div {...register('site-base-domains', 'settings-card')}>
                <h3>{t('app.siteSettingsTab.managedSitesBaseDomains', 'Managed services: base domains')}</h3>
                <p>{t('app.siteSettingsTab.publishManagedSitesAt', 'Publish managed services at')} <code>&lt;name&gt;.&lt;base-domain&gt;</code>. Register one or more base domains; a new site can be created under any of them, defaulting to the one marked <strong>{t('common.labels.default', 'Default')}</strong>. Point a wildcard record <code>*.&lt;base&gt;</code> {t('app.siteSettingsTab.orPerSiteARecordsAt', '(or per-service A records) at this server.')}</p>

                {httpsError ? (
                    <ErrorState
                        title={t('app.siteSettingsTab.couldntLoadBaseDomains', "Couldn't load base domains")}
                        error={httpsError}
                        onRetry={loadHttps}
                    />
                ) : (
                <>
                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="sites-server-ip">{t('app.siteSettingsTab.serverPublicIp', 'Server public IP')}</Label>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="sites-server-ip"
                                type="text"
                                placeholder="203.0.113.10"
                                value={serverIp}
                                onChange={(e) => setServerIp(e.target.value)}
                            />
                            <Button onClick={handleSaveServerIp} disabled={savingDomain}>
                                {savingDomain ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">{t('app.siteSettingsTab.sharedByEveryBaseDomainUsed', 'Shared by every base domain. Used to auto-create their DNS A records.')}</span>
                </div>

                {https.providers?.length > 0 ? (
                    <div className="form-group">
                        <div className="settings-row">
                            <div className="settings-label"><Label htmlFor="sites-https-provider">{t('app.siteSettingsTab.dnsProviderForHttps', 'DNS provider for HTTPS')}</Label></div>
                            <div className="settings-control">
                                <Select value={providerId ? String(providerId) : undefined} onValueChange={setProviderId}>
                                    <SelectTrigger id="sites-https-provider" className="settings-select">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {https.providers.map((p) => (
                                            <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.provider})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <span className="form-help">{t('app.siteSettingsTab.usedToIssueEachBaseS', 'Used to issue each base\'s wildcard certificate (DNS-01). Each base can use a different connected provider.')}</span>
                    </div>
                ) : (
                    <span className="form-help">{t('app.siteSettingsTab.connectADnsProviderUnderEmail', 'Connect a DNS provider under Email → DNS providers to enable per-domain wildcard HTTPS.')}</span>
                )}

                {displayBases.length === 0 ? (
                    <p className="form-help">{t('app.siteSettingsTab.noBaseDomainYetAddOne', 'No base domain yet. Add one below to start publishing services at real subdomains.')}</p>
                ) : displayBases.map((b) => (
                    <div key={b.domain} className="form-group">
                        <div className="settings-row">
                            <div className="settings-label">
                                {b._legacy ? (
                                    <div className="settings-control">
                                        <Input type="text" placeholder="apps.example.com" value={baseDomain}
                                            onChange={(e) => setBaseDomain(e.target.value)} />
                                        <Button onClick={handleSaveDomain} disabled={savingDomain}>
                                            {savingDomain ? 'Saving…' : 'Save'}
                                        </Button>
                                    </div>
                                ) : (
                                    <span className="settings-site-action-label">
                                        <code>{b.domain}</code>
                                        {b.is_default && <Pill kind="blue" dot={false}>{t('common.labels.default', 'Default')}</Pill>}
                                        <Pill kind={b.https_enabled ? 'green' : 'gray'} dot={false}>
                                            {b.https_enabled ? 'HTTPS' : 'HTTP only'}
                                        </Pill>
                                    </span>
                                )}
                            </div>
                            <div className="settings-control">
                                <Select value={b.dns_mode || 'wildcard'}
                                    onValueChange={(mode) => handleRowDnsMode(b, mode)}
                                    disabled={rowBusy === b.domain || savingDnsMode}>
                                    <SelectTrigger className="settings-select" aria-label={t('app.siteSettingsTab.dnsModeFor', 'DNS mode for {{domain}}', { domain: b.domain })}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="wildcard">{t('app.siteSettingsTab.wildcardDns', 'Wildcard DNS')}</SelectItem>
                                        <SelectItem value="per-site">{t('app.siteSettingsTab.perSiteDns', 'Per-service DNS')}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" onClick={() => handleSetupHttpsFor(b)}
                                    disabled={rowBusy === b.domain || !https.providers?.length}>
                                    {rowBusy === b.domain ? 'Working…' : (b.https_enabled ? 'Renew HTTPS' : 'Set up HTTPS')}
                                </Button>
                                {hasRegistry && !b.is_default && (
                                    <Button variant="ghost" onClick={() => handleMakeDefault(b.domain)} disabled={rowBusy === b.domain}>
                                        {t('app.siteSettingsTab.makeDefault', 'Make default')}
                                    </Button>
                                )}
                                {hasRegistry && displayBases.length > 1 && (
                                    <Button variant="ghost" onClick={() => handleRemoveDomain(b.domain)} disabled={rowBusy === b.domain}>
                                        {t('common.actions.remove', 'Remove')}
                                    </Button>
                                )}
                            </div>
                        </div>
                        <span className="form-help">
                            {t('app.siteSettingsTab.sitesPublishAt', 'Services publish at')} <code>&lt;name&gt;.{b.domain || 'base-domain'}</code>.{' '}
                            {(b.dns_mode || 'wildcard') === 'wildcard'
                                ? <>{t('app.siteSettingsTab.point', 'Point')} <code>*.{b.domain || 'base-domain'}</code> {t('app.siteSettingsTab.atThisServer', 'at this server.')}</>
                                : <>{t('app.siteSettingsTab.eachNewSiteGetsItsOwn', 'Each new service gets its own A record, auto-created via the provider.')}</>}
                        </span>
                    </div>
                ))}

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label"><Label htmlFor="new-base-domain">{t('app.siteSettingsTab.addBaseDomain', 'Add base domain')}</Label></div>
                        <div className="settings-control">
                            <DomainField
                                key={newDomainKey}
                                id="new-base-domain"
                                modes={['custom']}
                                exclude={displayBases.map((b) => b.domain)}
                                onChange={setNewDomain}
                            />
                            <Select value={newDnsMode} onValueChange={setNewDnsMode}>
                                <SelectTrigger className="settings-select" aria-label={t('app.siteSettingsTab.newBaseDnsMode', 'DNS mode for the new base domain')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="wildcard">{t('app.siteSettingsTab.wildcardDns', 'Wildcard DNS')}</SelectItem>
                                    <SelectItem value="per-site">{t('app.siteSettingsTab.perSiteDns', 'Per-service DNS')}</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button onClick={handleAddDomain} disabled={addingDomain || !newDomain.trim()}>
                                {addingDomain ? 'Adding…' : 'Add'}
                            </Button>
                        </div>
                    </div>
                    <span className="form-help">{t('app.siteSettingsTab.registerAnotherDomainSitesCanBe', 'Register another domain services can be published under. Set up its wildcard HTTPS from its row above.')}</span>
                </div>
                </>
                )}
            </div>

            <div {...register('site-dev-mode', 'settings-card')}>
                <h3>{t('app.siteSettingsTab.developerMode', 'Developer mode')}</h3>
                <p>{t('app.siteSettingsTab.enableDeveloperToolsAndDiagnostics', 'Enable developer tools and diagnostics.')}</p>

                <div className="form-group">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>{t('app.siteSettingsTab.enableDeveloperMode', 'Enable developer mode')}</Label>
                        </div>
                        <Switch
                            checked={settings.dev_mode}
                            onCheckedChange={() => handleToggleSetting('dev_mode', 'Developer mode')}
                            disabled={saving}
                        />
                    </div>
                    <span className="form-help">
                        {t('app.siteSettingsTab.enablesTheDeveloperTabWithIcon', 'Enables the Developer tab with icon reference and diagnostic tools.')}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default SiteSettingsTab;
