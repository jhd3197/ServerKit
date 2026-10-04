import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
    SlidersHorizontal,
    GitBranch,
    AlertTriangle,
    Globe,
    Lock,
    Shield,
    ShieldCheck,
    Boxes,
    Hammer,
    Archive,
    HardDrive,
    Gauge,
    CircleCheck,
    CircleX,
    Zap,
    HeartPulse,
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '@/hooks/useConfirm';
import { DangerZone } from '../DangerZone';
import RepoConnectForm from '../git/RepoConnectForm';
import ProtectionPanel from '../backups/ProtectionPanel';
import ContainerOpsPanel from '../apps/ContainerOpsPanel';
import VolumesPanel from '../apps/VolumesPanel';
import ResourceLimitsPanel from '../apps/ResourceLimitsPanel';
import MicroCachePanel from '../apps/MicroCachePanel';
import DeploySafetyPanel from '../apps/DeploySafetyPanel';
import SlotDeploysPanel from '../apps/SlotDeploysPanel';
import AppWafPanel from '../apps/AppWafPanel';
import BuildTab from '../appdetail/BuildTab';
import DeployTab from '../appdetail/DeployTab';
import Modal from '@/components/Modal';
import DomainField from '@/components/DomainField';
import { InfoList, InfoItem } from '@/components/InfoList';
import { attachDomain } from '@/services/attachDomain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard } from '@/components/ui/card';

// Grouped left sub-nav for the service Settings tab — mirrors the WordPress
// detail page's settings layout: a group label per section with
// the existing setting panels on the right. Groups give it structure (and room
// to grow) instead of one long flat stack.
//
// Built per-service so the type-gated sections relocated here from the old top
// tab strip only appear where they apply: Container Ops (Docker only) and WAF
// (Docker + Python, nginx-served). Build + Git & Deploy apply to every type.
function buildSettingsGroups(app) {
    const isDocker = app.isDocker ?? app.app_type === 'docker';
    const isPython = app.isPython ?? ['flask', 'django'].includes(app.app_type);
    // Micro-cache applies to anything nginx fronts with an upstream (proxied
    // or PHP-FPM); static sites already serve files straight off disk.
    const isCacheable = isDocker || isPython || ['php', 'wordpress'].includes(app.app_type);

    return [
        {
            labelKey: 'app.settingsTab.general', label: 'General',
            items: [
                // Renamed from plain "Environment" to avoid clashing with the
                // top-level "Env Vars" tab that edits runtime environment variables.
                { id: 'environment', labelKey: 'app.settingsTab.environmentType', label: 'Environment type', icon: SlidersHorizontal },
                { id: 'domain', labelKey: 'app.settingsTab.domainSsl', label: 'Domain and SSL', icon: Shield },
                ...(isDocker ? [{ id: 'ops', labelKey: 'app.settingsTab.containerOps', label: 'Container ops', icon: Boxes }] : []),
                ...(isDocker ? [{ id: 'resources', labelKey: 'app.settingsTab.resourceLimits', label: 'Resource limits', icon: Gauge }] : []),
                ...(isCacheable ? [{ id: 'cache', labelKey: 'app.settingsTab.cache', label: 'Cache', icon: Zap }] : []),
            ],
        },
        {
            // "Git & Deploy" merges the old Deploy tab into the repo connection,
            // since both edited repo / branch / auto-deploy. Build sits beside it.
            labelKey: 'app.settingsTab.deployment', label: 'Deployment',
            items: [
                { id: 'git', labelKey: 'app.settingsTab.gitDeploy', label: 'Git and deploy', icon: GitBranch },
                { id: 'build', labelKey: 'app.settingsTab.build', label: 'Build', icon: Hammer },
                ...(isDocker ? [{ id: 'health', labelKey: 'app.settingsTab.healthRollout', label: 'Health and rollout', icon: HeartPulse }] : []),
                { id: 'manifest', labelKey: 'app.settingsTab.manifest', label: 'Manifest', icon: Zap },
            ],
        },
        ...((isDocker || isPython) ? [{
            labelKey: 'common.labels.security', label: 'Security',
            items: [{ id: 'waf', label: 'WAF', icon: ShieldCheck }],
        }] : []),
        {
            labelKey: 'app.settingsTab.data', label: 'Data',
            items: [
                ...(isDocker ? [{ id: 'storage', labelKey: 'common.labels.storage', label: 'Storage', icon: HardDrive }] : []),
                { id: 'backups', labelKey: 'common.labels.backups', label: 'Backups', icon: Archive },
            ],
        },
        { labelKey: 'app.settingsTab.advanced', label: 'Advanced', items: [{ id: 'danger', labelKey: 'app.settingsTab.dangerZone', label: 'Delete service', icon: AlertTriangle }] },
    ];
}

const SettingsTab = ({ app, deployConfig, domains, primaryDomain, onUpdate }) => {
    const { t } = useTranslation();
    const settingsGroups = buildSettingsGroups(app);
    const settingsItems = settingsGroups.flatMap((g) => g.items);
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm } = useConfirm();
    // Section lives in the URL (/services/:id/settings/:section) so it's
    // shareable and survives a refresh — same as the WordPress detail page.
    const { section: sectionParam } = useParams();
    const section = settingsItems.some((s) => s.id === sectionParam) ? sectionParam : 'environment';
    const setSection = (s) => navigate(`/services/${app.id}/settings/${s}`, { replace: true });
    const [deleting, setDeleting] = useState(false);
    const [environmentType, setEnvironmentType] = useState(app.environment_type || 'standalone');
    const [savingEnvironment, setSavingEnvironment] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const envLabels = {
        standalone: 'Standalone',
        production: 'Production',
        development: 'Development',
        staging: 'Staging',
    };

    async function handleEnvironmentChange(newType) {
        if (newType === app.environment_type) return;

        setSavingEnvironment(true);
        try {
            await api.updateAppEnvironment(app.id, newType);
            setEnvironmentType(newType);
            onUpdate();
        } catch {
            toast.error(t('app.settingsTab.failedToUpdateEnvironmentType', 'Failed to update environment type'));
            setEnvironmentType(app.environment_type || 'standalone');
        } finally {
            setSavingEnvironment(false);
        }
    }

    async function handleUnlink() {
        if (!await confirm({
            title: t('app.settingsTab.unlinkApplication', 'Unlink application'),
            message: t('app.settingsTab.unlinkFromItsLinkedApplication', 'Unlink {{name}} from its linked application?', { name: app.name }),
            confirmText: t('app.settingsTab.unlink', 'Unlink'),
            variant: 'danger',
        })) return;

        setUnlinking(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
        } catch {
            toast.error(t('app.settingsTab.failedToUnlinkApp', 'Failed to unlink app'));
        } finally {
            setUnlinking(false);
        }
    }

    async function handleDelete() {
        if (!await confirm({
            title: t('app.settingsTab.deleteService', 'Delete service'),
            message: t('app.settingsTab.deleteItStopsServingAndMoves', 'Delete {{name}}? It stops serving and moves to the recycle bin, where you can restore it for 30 days.', { name: app.name }),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        })) return;
        if (!await confirm({
            title: t('app.settingsTab.deleteService', 'Delete service'),
            message: t('app.settingsTab.areYouSureItsContainersStop', 'Delete this service? Its containers stop and it stops being served. Files and data volumes are kept until you purge it from the recycle bin.'),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        })) return;

        setDeleting(true);
        try {
            await api.deleteApp(app.id);
            toast.success(t('app.settingsTab.movedToTheRecycleBin', '"{{name}}" moved to the recycle bin', { name: app.name }));
            navigate('/services');
        } catch {
            toast.error(t('app.settingsTab.failedToDeleteService', 'Failed to delete service'));
            setDeleting(false);
        }
    }

    // Repo state shaped for the shared RepoConnectForm (the same component the
    // WordPress Git settings use). A connected deploy config == connected repo.
    const gitStatus = {
        connected: Boolean(deployConfig),
        repo_url: deployConfig?.repo_url,
        branch: deployConfig?.branch,
        auto_deploy: deployConfig?.auto_deploy,
        last_deploy_commit: deployConfig?.last_deploy_commit,
        last_deploy_at: deployConfig?.last_deploy_at,
    };

    async function handleConnectRepo(data) {
        const repoUrl = (data.repo_url || '').trim();
        await api.configureDeployment(
            app.id,
            repoUrl,
            data.branch || 'main',
            data.auto_deploy,
            // Preserve any existing deploy scripts (not editable in this form).
            deployConfig?.pre_deploy_script || null,
            deployConfig?.post_deploy_script || null
        );
        if (data.auto_deploy && !deployConfig) {
            try {
                await api.createWebhook({
                    deploy_on_push: true,
                    app_id: app.id,
                    repo_url: repoUrl,
                    branch: data.branch || 'main',
                });
            } catch {
                // Webhook creation is best-effort.
            }
        }
        toast.success(t('app.settingsTab.repositoryConnected', 'Repository connected'));
        onUpdate();
    }

    async function handleDisconnectRepo() {
        await api.removeDeployment(app.id);
        toast.success(t('app.settingsTab.repositoryDisconnected', 'Repository disconnected'));
        onUpdate();
    }

    return (
        <div className="svc-settings">
            <nav className="svc-settings__nav" aria-label={t('app.settingsTab.serviceSettingsSections', 'Service settings sections')}>
                {settingsGroups.map(g => (
                    <div className="svc-settings__group" key={g.label}>
                        <div className="svc-settings__grouplabel">{g.label}</div>
                        {g.items.map(s => (
                            <Button variant="unstyled"
                                type="button"
                                key={s.id}
                                className={`svc-settings__navitem ${section === s.id ? 'is-active' : ''}`}
                                onClick={() => setSection(s.id)}
                            >
                                <s.icon size={15} />
                                {s.label}
                            </Button>
                        ))}
                    </div>
                ))}
            </nav>

            <div className="svc-settings__content">
                {/* Environment Configuration */}
                {section === 'environment' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.environmentType', 'Environment type')}</h3>
                        <SharedCard variant="legacy" className="card settings-section">
                            <div className="settings-row">
                                <div className="settings-label">
                                    <span>{t('app.settingsTab.environmentType', 'Environment type')}</span>
                                    <span className="settings-hint">
                                        {app.has_linked_app
                                            ? 'This app is linked. Unlink to change environment type.'
                                            : 'Set how this application is used in your workflow (production, staging, development, or standalone).'}
                                    </span>
                                </div>
                                <div className="settings-control">
                                    {app.has_linked_app ? (
                                        <span className={`env-badge env-${app.environment_type}`}>
                                            {envLabels[app.environment_type] || app.environment_type}
                                        </span>
                                    ) : (
                                        <Select
                                            value={environmentType}
                                            onValueChange={handleEnvironmentChange}
                                            disabled={savingEnvironment}
                                        >
                                            <SelectTrigger className="settings-select">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="standalone">{t('app.settingsTab.standalone', 'Standalone')}</SelectItem>
                                                <SelectItem value="development">{t('app.settingsTab.development', 'Development')}</SelectItem>
                                                <SelectItem value="staging">{t('app.settingsTab.staging', 'Staging')}</SelectItem>
                                                <SelectItem value="production">{t('app.settingsTab.production', 'Production')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {savingEnvironment && <span className="settings-saving">{t('common.editing.saving', 'Saving…')}</span>}
                                </div>
                            </div>

                            {app.has_linked_app && (
                                <div className="settings-row">
                                    <div className="settings-label">
                                        <span>{t('app.settingsTab.linkedApplication', 'Linked application')}</span>
                                        <span className="settings-hint">
                                            {t('app.settingsTab.unlinkingWillResetBothAppsTo', 'Unlinking will reset both apps to standalone mode.')}
                                        </span>
                                    </div>
                                    <div className="settings-control">
                                        <Button
                                            variant="outline"
                                            onClick={handleUnlink}
                                            disabled={unlinking}
                                        >
                                            {unlinking ? 'Unlinking...' : 'Unlink'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </SharedCard>
                    </div>
                )}

                {/* Domain & SSL — same information architecture as WordPress Settings → SSL. */}
                {section === 'domain' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.domainSsl', 'Domain and SSL')}</h3>
                        <DomainSslPanel
                            app={app}
                            domains={domains}
                            primaryDomain={primaryDomain}
                            onUpdate={onUpdate}
                        />
                    </div>
                )}

                {/* Container Ops (Docker only) — image updates, restart policy,
                    resource limits, auto-sleep. Relocated from the old top tab. */}
                {section === 'ops' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.containerOps', 'Container ops')}</h3>
                        <ContainerOpsPanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Resource Limits (Docker only) — first-class CPU/memory caps
                    with live usage, instead of compose-file-only limits. */}
                {section === 'resources' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.resourceLimits', 'Resource limits')}</h3>
                        <ResourceLimitsPanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Cache — opt-in nginx micro-cache (task #21, plan 86 §B3):
                    short-TTL page cache with auth/admin/cart bypasses, stale
                    serving, and a per-site purge. */}
                {section === 'cache' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.cache', 'Cache')}</h3>
                        <MicroCachePanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Health & Rollout (Docker only) — the deploy health gate
                    (plan 87): where a new release is asked, and for how long. */}
                {section === 'health' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.healthRollout', 'Health and rollout')}</h3>
                        <DeploySafetyPanel app={app} onChanged={onUpdate} />
                        <SlotDeploysPanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Storage (Docker only) — first-class managed volumes that
                    survive redeploys, replacing fragile relative bind mounts. */}
                {section === 'storage' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('common.labels.storage', 'Storage')}</h3>
                        <VolumesPanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Git & Deploy — the shared RepoConnectForm (provider picker + URL
                    fallback, connected summary with Disconnect) owns the repo
                    connection. Once a repo is linked, the embedded DeployTab adds
                    the deploy pipeline (run actions, deploy scripts, history,
                    config checkpoints) as a separated subsection — no second repo
                    form, and nothing deploy-related shows before connecting. */}
                {section === 'git' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.gitDeploy', 'Git and deploy')}</h3>
                        <RepoConnectForm
                            gitStatus={gitStatus}
                            onConnect={handleConnectRepo}
                            onDisconnect={handleDisconnectRepo}
                            intro={{
                                titleKey: 'app.settingsTab.connectAGitRepository', title: 'Connect a Git repository',
                                subtitleKey: 'app.settingsTab.linkARepoSoServerkitCan', subtitle: 'Link a repo so ServerKit can pull your code and redeploy on every push.',
                            }}
                            submitLabel="Connect Repository"
                            idPrefix="svc"
                        />
                        {deployConfig && (
                            <div className="svc-settings__subsection">
                                <h4 className="svc-settings__subsection-title">{t('app.settingsTab.deployment', 'Deployment')}</h4>
                                <DeployTab embedded appId={app.id} appPath={app.path} />
                            </div>
                        )}
                    </div>
                )}

                {/* Build — build method, Dockerfile / build pack, cache, timeouts,
                    build logs. Relocated from the old top tab, beside Git & Deploy. */}
                {section === 'build' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.build', 'Build')}</h3>
                        <BuildTab appId={app.id} appPath={app.path} app={app} />
                    </div>
                )}

                {/* Manifest — declarative serverkit.yaml: shows manifest status
                    when the app's project is manifest-managed, plus scaffold /
                    plan / apply actions. */}
                {section === 'manifest' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.manifest', 'Manifest')}</h3>
                        <ManifestSection app={app} />
                    </div>
                )}

                {/* WAF (Docker + Python) — per-app ModSecurity policy + matches. */}
                {section === 'waf' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">WAF</h3>
                        <AppWafPanel app={app} onChanged={onUpdate} />
                    </div>
                )}

                {/* Backups — the shared Protection panel (scheduled backups,
                    cost, one-click restore), same component the WordPress
                    detail page renders. */}
                {section === 'backups' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('common.labels.backups', 'Backups')}</h3>
                        <ProtectionPanel
                            targetType="application"
                            targetId={app.id}
                            targetName={app.name}
                        />
                    </div>
                )}

                {/* Danger Zone */}
                {section === 'danger' && (
                    <div className="svc-settings__section">
                        <h3 className="svc-settings__section-title">{t('app.settingsTab.dangerZone', 'Delete service')}</h3>
                        <DangerZone
                            description={t('app.settingsTab.onceYouDeleteAServiceThere', "Deleting a service removes all its data. You can't undo this.")}
                            action={
                                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                                    {deleting ? 'Deleting...' : 'Delete Service'}
                                </Button>
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

// Domain + SSL panel for services. Mirrors the WordPress SiteSSLPanel UX:
// show current primary domain, SSL health, attach a new domain, and request a
// certificate from Let&apos;s Encrypt.
const DomainSslPanel = ({ app, domains, primaryDomain, onUpdate }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [health, setHealth] = useState(null);
    const [checking, setChecking] = useState(false);
    const [issuing, setIssuing] = useState(false);
    // What DomainField last reported: the hostname ('' until valid) and
    // whether it is a managed subdomain or the user's own domain.
    const [newDomain, setNewDomain] = useState({ name: '', info: null });
    const [attaching, setAttaching] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    // localStorage seeds the field instantly (no flash on a page the user has
    // used before); the panel-wide contact fills it in when this browser has
    // no copy — which is the case the Domains modal shares.
    const [email, setEmail] = useState(() => localStorage.getItem('serverkit_ssl_email') || '');

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
            detail: { type: 'service-domain-settings-opened' },
        }));
    }, []);

    useEffect(() => {
        if (email) return undefined;
        let cancelled = false;
        api.getAcmeContact()
            .then(({ email: stored }) => { if (!cancelled && stored) setEmail(stored); })
            .catch(() => {});
        return () => { cancelled = true; };
        // Runs once: this only ever seeds an empty field, never overwrites typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const isPublicDomain = !!primaryDomain
        && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(primaryDomain)
        && primaryDomain.includes('.');

    useEffect(() => {
        if (!primaryDomain) { setChecking(false); setHealth(null); return; }
        let cancelled = false;
        (async () => {
            setChecking(true);
            try {
                const res = await api.getSSLHealth(primaryDomain);
                if (!cancelled) setHealth(res);
            } catch (err) {
                if (!cancelled) setHealth({ valid: false, error: err.message });
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => { cancelled = true; };
    }, [primaryDomain]);

    async function handleAddDomain(e) {
        e?.preventDefault();
        const { name, info } = newDomain;
        if (!name) return;
        setAttaching(true);
        try {
            const res = await attachDomain(app.id, name, info, { isPrimary: domains.length === 0 });
            if (res.warning) toast.warning(res.warning);
            toast.success(res.url
                ? t('app.settingsTab.publishedAt', 'Published at {{url}}', { url: res.url })
                : res.message || t('app.settingsTab.domainAttached', 'Domain attached'));
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'service-domain-attached' },
            }));
            setAddOpen(false);
            onUpdate();
        } catch (err) {
            toast.error(err.message || t('app.settingsTab.failedToAttachDomain', 'Failed to attach domain'));
        } finally {
            setAttaching(false);
        }
    }

    async function handleEnableSSL() {
        if (!primaryDomain) { toast.error(t('app.settingsTab.noPrimaryDomainConfigured', 'No primary domain configured')); return; }
        if (!email.trim() || !email.includes('@')) { toast.error(t('app.settingsTab.enterAValidEmailForCertificate', 'Enter a valid email for certificate expiry notices')); return; }
        localStorage.setItem('serverkit_ssl_email', email.trim());
        setIssuing(true);
        toast.info(t('app.settingsTab.requestingCertificateFor', 'Requesting certificate for {{primaryDomain}}…', { primaryDomain: primaryDomain }), { duration: 4000 });
        try {
            const res = await api.obtainCertificate({
                domains: [primaryDomain],
                email,
                use_nginx: true,
            });
            if (res.success) {
                toast.success(res.message || t('app.settingsTab.certificateIssued', 'Certificate issued'));
                // Mark the domain as SSL-enabled in ServerKit.
                const primary = domains.find(d => d.is_primary) || domains[0];
                if (primary?.id) {
                    await api.updateDomain(primary.id, { ssl_enabled: true, ssl_auto_renew: true }).catch(() => {});
                }
                const updated = await api.getSSLHealth(primaryDomain);
                setHealth(updated);
                window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                    detail: { type: 'service-ssl-enabled' },
                }));
                onUpdate();
            } else {
                toast.error(res.error || t('app.settingsTab.certificateRequestFailed', 'Certificate request failed'));
            }
        } catch (err) {
            toast.error(err.message || t('app.settingsTab.certificateRequestFailed', 'Certificate request failed'));
        } finally {
            setIssuing(false);
        }
    }

    const issued = health?.valid;

    const CheckItem = ({ ok, label }) => (
        <div className="ssl-check-item">
            {ok ? <CircleCheck size={14} className="ssl-check-icon ssl-check-icon--ok" /> : <CircleX size={14} className="ssl-check-icon ssl-check-icon--missing" />}
            <span className={ok ? 'ssl-check-label ssl-check-label--ok' : 'ssl-check-label'}>{label}</span>
        </div>
    );

    return (
        <SharedCard variant="legacy" className="card settings-section svc-domain-panel" data-walkthrough="service-domain-panel">
            <InfoList>
                <InfoItem label={t('app.settingsTab.primaryDomain', 'Primary domain')} value={primaryDomain || 'None configured'} mono />
                <InfoItem
                    label={t('app.settingsTab.sslStatus', 'SSL status')}
                    value={!primaryDomain ? '—' : checking ? 'Checking…' : issued ? 'Active' : 'Not Secured'}
                />
                {issued && health.expires_at && (
                    <InfoItem
                        label={t('app.settingsTab.expires', 'Expires')}
                        value={`${new Date(health.expires_at).toLocaleDateString()}${typeof health.days_remaining === 'number' ? ` (${health.days_remaining}d)` : ''}`}
                    />
                )}
                {issued && health.issuer && (
                    <InfoItem label={t('app.settingsTab.issuer', 'Issuer')} value={health.issuer} />
                )}
            </InfoList>

            {primaryDomain && (
                <div className="svc-give-subdomain">
                    <Button variant="outline" onClick={() => setAddOpen(true)}>
                        <Globe size={14} />
                        {t('app.settingsTab.addADomain', 'Add a domain')}
                    </Button>
                </div>
            )}

            {!primaryDomain ? (
                <div className="ssl-guide">
                    <p className="hint">{t('app.settingsTab.noDomainIsAttachedToThis', 'No domain is attached to this service yet. Add one to expose it on a public URL and enable HTTPS.')}</p>
                    <form className="ssl-inline-attach" onSubmit={handleAddDomain} data-walkthrough="service-domain-attach">
                        <DomainField
                            defaultLabel={app.name}
                            exclude={domains.map((d) => d.name)}
                            onChange={(name, info) => setNewDomain({ name, info })}
                            disabled={attaching}
                        />
                        <div className="app-detail-actions">
                            <Button type="submit" disabled={!newDomain.name || attaching}>
                                <Globe size={14} />
                                {attaching ? t('app.settingsTab.attaching', 'Attaching…') : t('app.settingsTab.attachDomain', 'Attach domain')}
                            </Button>
                        </div>
                    </form>
                </div>
            ) : !isPublicDomain ? (
                <div className="ssl-guide">
                    <p className="hint">{t('app.settingsTab.sslRequiresAPublicDomainPointed', 'SSL requires a public domain pointed at this server. This site is on')} <code>{primaryDomain}</code>{t('app.settingsTab.soACertificateCannotBeIssued', ', so a certificate cannot be issued here.')}</p>
                    <div className="ssl-checklist">
                        <CheckItem ok={false} label={t('app.settingsTab.publicDomainMappedToThisService', 'Public domain mapped to this service')} />
                    </div>
                </div>
            ) : (
                <div className="ssl-guide">
                    {issued ? (
                        <p className="hint">{t('app.settingsTab.thisServiceIsSecuredWithA', 'This service is secured with a valid SSL certificate. You can re-issue it if needed.')}</p>
                    ) : (
                        <>
                            <p className="hint">{t('app.settingsTab.enterTheEmailLetSEncrypt', 'Enter the email Let\'s Encrypt should use for expiry notices, then request a free certificate.')}</p>
                            <div className="ssl-checklist">
                                <CheckItem ok label={t('app.settingsTab.domainConfigured', 'Domain {{primaryDomain}} configured', { primaryDomain: primaryDomain })} />
                            </div>
                            <div className="form-group">
                                <Label>{t('app.settingsTab.adminEmail', 'Admin email')}</Label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@example.com"
                                    disabled={issuing}
                                />
                                <span className="form-hint">{t('app.settingsTab.usedForCertificateExpiryRemindersFrom', 'Used for certificate expiry reminders from Let\'s Encrypt.')}</span>
                            </div>
                        </>
                    )}
                    <div className="app-detail-actions">
                        <Button
                            onClick={handleEnableSSL}
                            disabled={issuing || (!issued && (!email.trim() || !email.includes('@')))}
                            data-walkthrough="service-enable-ssl"
                        >
                            {issued ? <Shield size={14} /> : <Lock size={14} />}
                            {issuing ? 'Requesting...' : issued ? 'Re-issue Certificate' : 'Enable SSL'}
                        </Button>
                    </div>
                </div>
            )}

            <Modal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                title={t('app.settingsTab.addADomain', 'Add a domain')}
            >
                {addOpen && (
                    <form onSubmit={handleAddDomain}>
                        <div className="modal-body">
                            <DomainField
                                defaultLabel={app.name}
                                exclude={domains.map((d) => d.name)}
                                onChange={(name, info) => setNewDomain({ name, info })}
                                disabled={attaching}
                                autoFocus
                            />
                        </div>
                        <div className="modal-footer">
                            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={attaching}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button type="submit" disabled={!newDomain.name || attaching}>
                                {attaching ? t('app.settingsTab.attaching', 'Attaching…') : t('app.settingsTab.attachDomain', 'Attach domain')}
                            </Button>
                        </div>
                    </form>
                )}
            </Modal>
        </SharedCard>
    );
};

// Manifest panel for a service. When the app belongs to a manifest-managed
// project it shows the current manifest status; either way it exposes the
// scaffold / plan / apply actions for the declarative serverkit.yaml workflow.
const ManifestSection = ({ app }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const projectId = app.project_id;
    const [manifest, setManifest] = useState(null);
    const [loading, setLoading] = useState(Boolean(projectId));
    const [scaffold, setScaffold] = useState(null);
    const [scaffolding, setScaffolding] = useState(false);
    const [plan, setPlan] = useState(null);
    const [planning, setPlanning] = useState(false);
    const [applyResult, setApplyResult] = useState(null);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        if (!projectId) { setLoading(false); return; }
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const res = await api.getManifest(projectId);
                if (!cancelled) setManifest(res?.manifest || null);
            } catch {
                if (!cancelled) setManifest(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [projectId]);

    const statusLabels = {
        applied: 'Applied',
        pending: 'Pending',
        drifted: 'Drifted',
        error: 'Error',
    };

    async function handleScaffold() {
        setScaffolding(true);
        try {
            const res = await api.scaffoldManifest(app.id);
            const yaml = res?.yaml || res?.manifest || '';
            setScaffold(yaml);
        } catch (err) {
            toast.error(err.message || t('app.settingsTab.failedToGenerateScaffold', 'Failed to generate scaffold'));
        } finally {
            setScaffolding(false);
        }
    }

    function handleDownloadScaffold() {
        if (!scaffold) return;
        downloadBlob(scaffold, 'serverkit.yaml', { type: 'text/yaml' });
    }

    async function handlePlan() {
        if (!projectId) return;
        setPlanning(true);
        setApplyResult(null);
        try {
            const res = await api.planManifest(projectId, {});
            setPlan(res?.plan || null);
        } catch (err) {
            toast.error(err.message || t('app.settingsTab.failedToPlanManifest', 'Failed to plan manifest'));
        } finally {
            setPlanning(false);
        }
    }

    async function handleApply() {
        if (!projectId) return;
        if (!await confirm({
            title: t('app.settingsTab.applyManifest', 'Apply manifest'),
            message: t('app.settingsTab.applyTheManifestToThisProject', 'Apply the manifest to this project? This will create or update services to match serverkit.yaml.'),
            confirmText: t('app.settingsTab.apply', 'Apply'),
            variant: 'warning',
        })) return;
        setApplying(true);
        try {
            const res = await api.applyManifest(projectId, {});
            setApplyResult(res || null);
            if (res?.success) {
                toast.success(t('app.settingsTab.appliedChangeS', 'Applied {{value}} change(s)', { value: res.applied ?? 0 }));
                const refreshed = await api.getManifest(projectId).catch(() => null);
                setManifest(refreshed?.manifest || manifest);
            } else {
                toast.error(t('app.settingsTab.applyFinishedWithErrors', 'Apply finished with errors'));
            }
        } catch (err) {
            toast.error(err.message || t('app.settingsTab.failedToApplyManifest', 'Failed to apply manifest'));
        } finally {
            setApplying(false);
        }
    }

    if (loading) {
        return <SharedCard variant="legacy" className="card settings-section"><p className="hint">{t('app.settingsTab.loadingManifest', 'Loading manifest…')}</p></SharedCard>;
    }

    const source = manifest?.source || {};
    const shortCommit = source.commit ? String(source.commit).slice(0, 7) : null;

    return (
        <SharedCard variant="legacy" className="card settings-section svc-manifest">
            {manifest ? (
                <div className="svc-manifest__status">
                    <span className="svc-manifest__badge">
                        <Zap size={13} />
                        {t('app.settingsTab.managedByManifest', 'Managed by manifest')}
                    </span>
                    <span className={`svc-manifest__pill svc-manifest__pill--${manifest.status || 'pending'}`}>
                        {statusLabels[manifest.status] || manifest.status || 'Pending'}
                    </span>
                    {(source.repo || shortCommit) && (
                        <span className="svc-manifest__source mono">
                            {source.repo || ''}{source.repo && shortCommit ? '@' : ''}{shortCommit || ''}
                        </span>
                    )}
                </div>
            ) : (
                <div className="svc-manifest__empty">
                    <p className="hint">
                        {t('app.settingsTab.thisProjectIsNotManagedBy', 'This project is not managed by a')} <code>serverkit.yaml</code> {t('app.settingsTab.manifestAManifestLetsYouDeclare', 'manifest. A manifest lets you declare services, domains, databases and environment requirements in one file so ServerKit can create and reconcile them for you.')}
                    </p>
                    <p className="hint">
                        <Link to="/docs/SERVERKIT_YAML.md">{t('app.settingsTab.learnAboutServerkitYaml', 'Learn about serverkit.yaml')}</Link>
                    </p>
                </div>
            )}

            <div className="svc-manifest__actions">
                <Button variant="outline" onClick={handleScaffold} disabled={scaffolding}>
                    {scaffolding ? 'Generating…' : 'Download scaffold'}
                </Button>
                {projectId && (
                    <>
                        <Button variant="outline" onClick={handlePlan} disabled={planning}>
                            {planning ? 'Planning…' : 'Plan'}
                        </Button>
                        <Button onClick={handleApply} disabled={applying}>
                            {applying ? 'Applying…' : 'Apply'}
                        </Button>
                    </>
                )}
            </div>

            {scaffold && (
                <div className="svc-manifest__block">
                    <div className="svc-manifest__block-head">
                        <h4 className="svc-manifest__block-title">{t('app.settingsTab.scaffoldedServerkitYaml', 'Scaffolded serverkit.yaml')}</h4>
                        <Button variant="outline" className="btn-icon" onClick={handleDownloadScaffold}>{t('common.actions.download', 'Download')}</Button>
                    </div>
                    <pre className="svc-manifest__pre">{scaffold}</pre>
                </div>
            )}

            {plan && (
                <div className="svc-manifest__block">
                    <h4 className="svc-manifest__block-title">{t('app.settingsTab.plan', 'Plan (')}{plan.step_count ?? (plan.steps || []).length} step(s))</h4>
                    {plan.summary && <p className="hint">{plan.summary}</p>}
                    {(plan.steps || []).length > 0 && (
                        <ul className="svc-manifest__steps">
                            {plan.steps.map((step, i) => (
                                <li key={`${step.type}-${step.service}-${i}`}>
                                    <span className="svc-manifest__step-type">{step.type}</span>
                                    {step.service && <span className="svc-manifest__step-service mono">{step.service}</span>}
                                    <span className="svc-manifest__step-desc">{step.description}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {(plan.issues || []).length > 0 && (
                        <ul className="svc-manifest__issues">
                            {plan.issues.map((issue, i) => (
                                <li key={`${issue.service}-${issue.key}-${i}`}>
                                    {issue.service ? `${issue.service}.` : ''}{issue.key} — {issue.kind}
                                    {issue.secret ? ' (secret)' : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {applyResult && (
                <div className="svc-manifest__block">
                    <h4 className="svc-manifest__block-title">
                        {t('app.settingsTab.applyResult', 'Apply result:')} {applyResult.applied ?? 0} applied
                    </h4>
                    {(applyResult.results || []).length > 0 && (
                        <ul className="svc-manifest__steps">
                            {applyResult.results.map((res, i) => (
                                <li key={`${res.type}-${res.service}-${i}`}>
                                    <span className={`svc-manifest__step-type ${res.status === 'error' ? 'is-error' : ''}`}>{res.status}</span>
                                    {res.service && <span className="svc-manifest__step-service mono">{res.service}</span>}
                                    {res.error && <span className="svc-manifest__step-desc">{res.error}</span>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </SharedCard>
    );
};

export default SettingsTab;
