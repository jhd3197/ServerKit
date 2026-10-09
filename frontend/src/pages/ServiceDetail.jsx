import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { servicePortUrl } from '@/utils/serviceUrl';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { useService } from '../hooks/useService';
import useTabParam from '../hooks/useTabParam';
import { getTabsForType } from '../utils/serviceTypes';
import EnvironmentVariables from '../components/EnvironmentVariables';
import EventsTab from '../components/service-detail/EventsTab';
import LogsTab from '../components/service-detail/LogsTab';
import ShellTab from '../components/service-detail/ShellTab';
import SettingsTab from '../components/service-detail/SettingsTab';
import MetricsTab from '../components/service-detail/MetricsTab';
import PackagesTab from '../components/service-detail/PackagesTab';
import GunicornTab from '../components/service-detail/GunicornTab';
import CommandsTab from '../components/service-detail/CommandsTab';
import OverviewTab from '../components/service-detail/OverviewTab';
// Container Ops / WAF / Build / Deploy (merged in from the retired
// ApplicationDetail page in §1) now live under the Settings sub-nav, so they're
// imported by SettingsTab rather than rendered as top-level tabs here.
import PreviewList from '../components/previews/PreviewList';
import EmptyState from '../components/EmptyState';
import PluginSlot from '../components/PluginSlot';
import { Layers, FileArchive, RotateCcw, LayoutDashboard, History, ScrollText, Variable, Terminal, Activity, Package, Server, SquareTerminal, Settings, Eye, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pill, ServiceTile, PageTopbar, statusKind } from '@/components/ds';
import FavoriteStar from '@/components/FavoriteStar';
import { useRecordVisit } from '@/hooks/useRecordVisit';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const TAB_LABELS = {
    overview: 'Overview',
    events: 'Events',
    logs: 'Logs',
    // 'Environment Variables' instead of 'Environment' so it isn't confused
    // with Settings → Environment Type (deployment environment).
    environment: 'Environment variables',
    shell: 'Shell',
    metrics: 'Metrics',
    packages: 'Packages',
    gunicorn: 'Gunicorn',
    commands: 'Commands',
    previews: 'Previews',
    settings: 'Settings',
};

// Tab slugs retired when Container Ops / WAF / Build / Deploy moved into the
// Settings sub-nav — old links / bookmarks land on the right settings section
// (Deploy folded into "Git & Deploy", so it redirects to settings/git).
const RETIRED_TAB_REDIRECTS = {
    ops: 'settings/ops',
    waf: 'settings/waf',
    build: 'settings/build',
    deploy: 'settings/git',
};

// Per-tab glyph for the detail tab strip (matches the WordPress detail page).
const TAB_ICONS = {
    overview: LayoutDashboard,
    events: History,
    logs: ScrollText,
    environment: Variable,
    shell: Terminal,
    metrics: Activity,
    packages: Package,
    gunicorn: Server,
    commands: SquareTerminal,
    previews: Eye,
    settings: Settings,
};

const ServiceDetail = () => {
    const { t } = useTranslation();
    const { id, tab: rawTab } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const showError = toast.error;
    const { confirm } = useConfirm();
    const { service, deployConfig, loading, error, reload, performAction, deleteService } = useService(id);
    // Active tab lives in the URL (/services/:id/:tab) so it's shareable and
    // survives a refresh — same pattern as the WordPress detail page.
    const [activeTab, setActiveTab] = useTabParam(`/services/${id}`, Object.keys(TAB_LABELS));
    const [showDeployMenu, setShowDeployMenu] = useState(false);
    const [showMoreMenu, setShowMoreMenu] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);
    const [versions, setVersions] = useState([]);
    const [currentVersion, setCurrentVersion] = useState(null);
    const [versionsLoading, setVersionsLoading] = useState(false);
    const deployMenuRef = useRef(null);
    const moreMenuRef = useRef(null);

    // Redirect WordPress apps
    useEffect(() => {
        if (service && service.app_type === 'wordpress') {
            navigate(`/wordpress/${id}`, { replace: true });
        }
    }, [service, id, navigate]);

    // Forward retired top tabs (ops/waf/build/deploy) to their new Settings home.
    useEffect(() => {
        const target = RETIRED_TAB_REDIRECTS[rawTab];
        if (target) navigate(`/services/${id}/${target}`, { replace: true });
    }, [rawTab, id, navigate]);

    // Load upload versions
    useEffect(() => {
        // Derive locally — the `isUpload` const below is declared after the
        // early-return guard, so referencing it here would hit its temporal
        // dead zone and crash the page on every render.
        const isUpload = service?.source === 'upload';
        if (!isUpload || !id) return;
        setVersionsLoading(true);
        api.getAppVersions(id)
            .then(data => {
                setVersions(data.versions || []);
                setCurrentVersion(data.current);
            })
            .catch((err) => toastError(showError, t('app.serviceDetail.failedToLoadVersions', "Couldn't load versions."), err))
            .finally(() => setVersionsLoading(false));
    }, [service?.source, id, showError, t]);

    // Close menus on outside click
    useEffect(() => {
        const handleClick = (e) => {
            if (deployMenuRef.current && !deployMenuRef.current.contains(e.target)) {
                setShowDeployMenu(false);
            }
            if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
                setShowMoreMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    async function handleAction(action) {
        setActionLoading(action);
        try {
            await performAction(action);
            // One string per action: interpolating the verb produced
            // "stoped" and could not be translated.
            const done = {
                start: t('app.serviceDetail.serviceStarted', 'Service started'),
                stop: t('app.serviceDetail.serviceStopped', 'Service stopped'),
                restart: t('app.serviceDetail.serviceRestarted', 'Service restarted'),
            };
            toast.success(done[action] || t('app.serviceDetail.serviceUpdated', 'Service updated'));
        } catch (err) {
            const failed = {
                start: t('app.serviceDetail.couldntStartService', "Couldn't start the service."),
                stop: t('app.serviceDetail.couldntStopService', "Couldn't stop the service."),
                restart: t('app.serviceDetail.couldntRestartService', "Couldn't restart the service."),
            };
            toastError(toast, failed[action] || t('app.serviceDetail.couldntUpdateService', "Couldn't update the service."), err);
        } finally {
            setActionLoading(null);
            setShowDeployMenu(false);
            setShowMoreMenu(false);
        }
    }

    async function handleDeployLatest() {
        setActionLoading('deploy-latest');
        try {
            let hasBuildConfig = false;
            try {
                const buildConfig = await api.getBuildConfig(service.id);
                hasBuildConfig = Boolean(buildConfig.configured);
            } catch {
                hasBuildConfig = false;
            }

            if (hasBuildConfig) {
                const res = await api.deployApp(service.id);
                if (res?.deploy_job_id) {
                    // Async deploy → watch it live on the Deploy Console.
                    navigate(`/deployments/${res.deploy_job_id}`);
                    return;
                }
            } else {
                await api.triggerAppDeploy(service.id, true);
            }
            toast.success(t('app.serviceDetail.deploymentStarted', 'Deployment started'));
            await reload();
        } catch (err) {
            toastError(toast, t('app.serviceDetail.failedToDeployLatestCommit', "Couldn't deploy the latest commit."), err);
        } finally {
            setActionLoading(null);
            setShowDeployMenu(false);
        }
    }

    async function handleRollback(version) {
        setActionLoading(`rollback-${version}`);
        try {
            await api.rollbackAppVersion(service.id, version);
            toast.success(t('app.serviceDetail.rolledBackToVersion', 'Rolled back to version {{version}}', { version: version }));
            await reload();
            const data = await api.getAppVersions(service.id);
            setVersions(data.versions || []);
            setCurrentVersion(data.current);
        } catch (err) {
            toastError(toast, t('app.serviceDetail.failedToRollback', "Couldn't roll back."), err);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleUploadNewVersion(e) {
        const file = e.target.files[0];
        if (!file) return;
        setActionLoading('upload-version');
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('name', service.name);
            formData.append('app_type', 'auto');
            formData.append('auto_deploy', 'true');
            await api.uploadAppZip(formData);
            toast.success(t('app.serviceDetail.newVersionUploaded', 'New version uploaded'));
            await reload();
            const data = await api.getAppVersions(service.id);
            setVersions(data.versions || []);
            setCurrentVersion(data.current);
        } catch (err) {
            toastError(toast, t('app.serviceDetail.failedToUploadNewVersion', "Couldn't upload the new version."), err);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleDelete() {
        const firstConfirm = await confirm({ title: t('app.serviceDetail.deleteService', 'Delete service'), message: t('app.serviceDetail.deleteThisActionCannotBeUndone', 'Delete {{name}}? This action cannot be undone.', { name: service.name }) });
        if (!firstConfirm) return;
        const secondConfirm = await confirm({ title: t('app.serviceDetail.confirmDeletion', 'Confirm deletion'), message: t('app.serviceDetail.areYouSureThisWillPermanently', 'Delete this service? This permanently removes it and all its data.') });
        if (!secondConfirm) return;

        setActionLoading('delete');
        try {
            await deleteService();
            navigate('/services');
        } catch (err) {
            toastError(toast, t('app.serviceDetail.failedToDeleteService', "Couldn't delete the service."), err);
            setActionLoading(null);
        }
    }

    useRecordVisit(service && {
        type: 'service', id: service.id, path: `/services/${service.id}`, label: service.name,
    });

    if (loading) {
        return <EmptyState loading loadingVariant="detail" title={t('app.serviceDetail.loadingService', 'Loading service')} />;
    }

    if (error || !service) {
        return (
            <EmptyState
                icon={Layers}
                title={t('app.serviceDetail.serviceNotFound', 'Service not found')}
                description={error || t('app.serviceDetail.theServiceYouAreLookingFor', 'The service you are looking for does not exist.')}
                action={<Button onClick={() => navigate('/services')}>{t('app.serviceDetail.backToServices', 'Back to services')}</Button>}
            />
        );
    }

    const availableTabs = getTabsForType(service.app_type);
    const isGitBased = service.source !== 'manual' && service.source !== 'upload';
    const isUpload = service.source === 'upload';
    const isManual = service.source === 'manual';
    const domains = service.domains || [];
    const primaryDomain = (domains.find(d => d.is_primary) || domains[0])?.name || '';
    // Only when there is no domain in front of it — otherwise the domain
    // link above is the one to follow.
    const openUrl = primaryDomain ? null : servicePortUrl(service);

    return (
        <div className="app-detail-page app-detail-page--wide svc-detail">
            {/* Full-bleed top bar — the canonical PageTopbar (.sk-topbar): the SAME
                chrome as the Services LIST page and the WordPress detail page, so the
                top menu stays consistent. Breadcrumb in the title slot, all service
                actions on the right. */}
            <PageTopbar
                className="svc-detail-topbar"
                icon={<Layers size={18} />}
                title={(
                    <>
                        <span className="svc-crumbs">
                            <Link to="/services">{t('common.labels.services', 'Services')}</Link>
                            <span className="svc-crumbs__sep">/</span>
                            <span className="svc-crumbs__cur">{service.name}</span>
                        </span>
                        <FavoriteStar type="service" id={service.id} path={`/services/${service.id}`} label={service.name} />
                    </>
                )}
                actions={(
                    <>
                    {/* Deploy dropdown */}
                    <div className="svc-detail__dropdown" ref={deployMenuRef}>
                        <Button onClick={() => setShowDeployMenu(!showDeployMenu)}>
                            {t('app.serviceDetail.deploy', 'Deploy')}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="svc-title-link-icon">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </Button>
                        {showDeployMenu && (
                            <div className="svc-detail__dropdown-menu">
                                <Button variant="unstyled" type="button" onClick={() => handleAction('restart')} disabled={actionLoading === 'restart'}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="23 4 23 10 17 10"/>
                                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                                    </svg>
                                    {t('app.serviceDetail.manualDeployRestart', 'Manual deploy (restart)')}
                                </Button>
                                {isGitBased && deployConfig && (
                                    <Button variant="unstyled" type="button" onClick={handleDeployLatest} disabled={actionLoading === 'deploy-latest'}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="18" cy="18" r="3"/>
                                            <circle cx="6" cy="6" r="3"/>
                                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                                        </svg>
                                        {actionLoading === 'deploy-latest' ? t('app.serviceDetail.deploying', 'Deploying…') : t('app.serviceDetail.deployLatestCommit', 'Deploy latest commit')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Restart button */}
                    {service.isRunning && (
                        <Button
                            variant="outline"
                            onClick={() => handleAction('restart')}
                            disabled={actionLoading === 'restart'}
                        >
                            {actionLoading === 'restart' ? t('app.serviceDetail.restarting', 'Restarting…') : t('common.actions.restart', 'Restart')}
                        </Button>
                    )}

                    {/* Start/Stop */}
                    {!service.isRunning && (
                        <Button
                            variant="outline"
                            onClick={() => handleAction('start')}
                            disabled={actionLoading === 'start'}
                        >
                            {actionLoading === 'start' ? t('app.serviceDetail.starting', 'Starting…') : t('common.actions.start', 'Start')}
                        </Button>
                    )}

                    {/* Three-dot menu */}
                    <div className="svc-detail__dropdown" ref={moreMenuRef}>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowMoreMenu(!showMoreMenu)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="5" r="2"/>
                                <circle cx="12" cy="12" r="2"/>
                                <circle cx="12" cy="19" r="2"/>
                            </svg>
                        </Button>
                        {showMoreMenu && (
                            <div className="svc-detail__dropdown-menu svc-detail__dropdown-menu--right">
                                {service.isRunning && (
                                    <Button variant="unstyled" type="button" onClick={() => handleAction('stop')} disabled={actionLoading === 'stop'}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12"/>
                                        </svg>
                                        {t('app.serviceDetail.suspendService', 'Suspend service')}
                                    </Button>
                                )}
                                {openUrl && (
                                    <a
                                        href={openUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={() => setShowMoreMenu(false)}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                            <polyline points="15 3 21 3 21 9"/>
                                            <line x1="10" y1="14" x2="21" y2="3"/>
                                        </svg>
                                        {t('app.serviceDetail.openInBrowser', 'Open in browser')}
                                    </a>
                                )}
                                <div className="svc-detail__dropdown-divider" />
                                <Button variant="unstyled" type="button"
                                    className="svc-detail__dropdown-danger"
                                    onClick={handleDelete}
                                    disabled={actionLoading === 'delete'}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                    {t('app.serviceDetail.deleteService', 'Delete service')}
                                </Button>
                            </div>
                        )}
                    </div>
                    </>
                )}
            />

            {/* Everything below the full-bleed top bar lives in a centered, padded
                column (.app-detail-body), matching the WordPress detail page. */}
            <div className="app-detail-body">
            {/* Identity — tile + name + status + type (no actions). */}
            <div className="app-detail-header">
                <ServiceTile name={service.name} size={52} className="svc-detail__tile" />
                <div className="app-detail-title-block">
                    <h1>
                        {service.name}
                        {/* Before the status pill: the first thing you want
                            after seeing a service is live is to go look at it. */}
                        {openUrl && (
                            <a
                                href={openUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="svc-detail__open"
                                title={t('app.serviceDetail.open', 'Open {{openUrl}}', { openUrl: openUrl })}
                                aria-label={t('app.serviceDetail.openInANewTab', 'Open {{name}} in a new tab', { name: service.name })}
                            >
                                <ExternalLink size={15} />
                            </a>
                        )}
                        <Pill kind={statusKind(service.statusInfo.dotClass)}>
                            {service.statusInfo.label}
                        </Pill>
                        <span
                            className="svc-detail__type-badge"
                            style={{ backgroundColor: service.typeInfo.bgColor, color: service.typeInfo.color, borderColor: service.typeInfo.borderColor }}
                        >
                            {service.typeInfo.label}
                        </span>
                    </h1>
                    <div className="app-detail-subtitle">
                        {service.port && (
                            openUrl ? (
                                <a
                                    href={openUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="svc-detail__portlink"
                                    title={t('app.serviceDetail.open', 'Open {{openUrl}}', { openUrl: openUrl })}
                                >
                                    {t('common.labels.port', 'Port')} {service.port}
                                    <ExternalLink size={12} />
                                </a>
                            ) : (
                                <span>{t('common.labels.port', 'Port')} {service.port}</span>
                            )
                        )}
                        {service.port && <span className="separator">&middot;</span>}
                        <span>{t('common.labels.created', 'Created')} {new Date(service.created_at).toLocaleDateString()}</span>
                        {primaryDomain && (
                            <>
                                <span className="separator">&middot;</span>
                                <a
                                    href={`https://${primaryDomain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {primaryDomain}
                                </a>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Repo Connection Pill */}
            <div className="svc-detail__repo-bar">
                {isUpload ? (
                    <span className="svc-detail__repo-pill svc-detail__repo-pill--static">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span className="svc-detail__repo-url">{t('app.serviceDetail.upload', 'Upload')}</span>
                        <span className="svc-detail__repo-arrow">&rarr;</span>
                        <span className="svc-detail__repo-branch">{t('common.labels.version', 'Version')} {service.version || 1}</span>
                    </span>
                ) : isManual ? (
                    <span className="svc-detail__repo-pill svc-detail__repo-pill--static">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span className="svc-detail__repo-url">{service.root_path || t('app.serviceDetail.localService', 'Local service')}</span>
                        {service.managed_by && (
                            <>
                                <span className="svc-detail__repo-arrow">&rarr;</span>
                                <span className="svc-detail__repo-branch">{service.managed_by === 'docker_compose' ? t('app.serviceDetail.dockerCompose', 'Docker Compose') : 'systemd'}</span>
                            </>
                        )}
                    </span>
                ) : deployConfig ? (
                    <div className="svc-detail__repo-pill" onClick={() => navigate(`/services/${id}/settings/git`)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                        <span className="svc-detail__repo-url">{extractRepoDisplay(deployConfig.repo_url)}</span>
                        <span className="svc-detail__repo-arrow">&rarr;</span>
                        <span className="svc-detail__repo-branch">{deployConfig.branch || 'main'}</span>
                        {deployConfig.auto_deploy && (
                            <span className="svc-detail__auto-deploy-badge">{t('app.serviceDetail.auto', 'Auto')}</span>
                        )}
                    </div>
                ) : (
                    <Button variant="unstyled" type="button" className="svc-detail__connect-repo" onClick={() => navigate(`/services/${id}/settings/git`)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                        {t('app.serviceDetail.connectARepository', 'Connect a repository')}
                    </Button>
                )}
            </div>

            {/* Upload versions panel */}
            {isUpload && (
                <div className="svc-detail__versions">
                    <div className="svc-detail__versions-header">
                        <h3>{t('app.serviceDetail.versions', 'Versions')}</h3>
                        <label className="svc-detail__upload-label">
                            <input
                                type="file"
                                accept=".zip,application/zip,application/x-zip-compressed"
                                onChange={handleUploadNewVersion}
                                disabled={actionLoading === 'upload-version'}
                            />
                            <FileArchive size={14} />
                            {actionLoading === 'upload-version' ? t('app.serviceDetail.uploading', 'Uploading…') : t('app.serviceDetail.uploadNewVersion', 'Upload new version')}
                        </label>
                    </div>
                    {versionsLoading ? (
                        <div className="svc-detail__versions-loading">{t('app.serviceDetail.loadingVersions', 'Loading versions…')}</div>
                    ) : (
                        <ul className="svc-detail__versions-list">
                            {versions.slice().reverse().map(v => (
                                <li key={v.version} className={v.version === currentVersion ? 'is-current' : ''}>
                                    <span className="svc-detail__version-name">v{v.version}</span>
                                    <span className="svc-detail__version-date">{new Date(v.created_at).toLocaleString()}</span>
                                    {v.version === currentVersion ? (
                                        <span className="svc-detail__version-current">{t('common.labels.current', 'Current')}</span>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleRollback(v.version)}
                                            disabled={actionLoading === `rollback-${v.version}`}
                                        >
                                            <RotateCcw size={14} />
                                            {t('app.serviceDetail.rollback', 'Rollback')}
                                        </Button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {/* Tab Bar — shared underline-style strip (app-detail-tabs) with a
                glyph per tab; Settings is pinned to the far right (--end), exactly
                like the WordPress detail page. */}
            <div className="app-detail-tabs">
                {availableTabs.map(tab => {
                    const Icon = TAB_ICONS[tab];
                    return (
                        <Button variant="unstyled" type="button"
                            key={tab}
                            className={`app-detail-tab ${activeTab === tab ? 'active' : ''} ${tab === 'settings' ? 'app-detail-tab--end' : ''}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {Icon && <Icon size={14} />}
                            {TAB_LABELS[tab] || tab}
                        </Button>
                    );
                })}
            </div>

            {/* Tab Content */}
            <div className="app-detail-content">
                {activeTab === 'overview' && <OverviewTab app={service} deployConfig={deployConfig} />}
                {activeTab === 'events' && <EventsTab appId={service.id} />}
                {activeTab === 'logs' && <LogsTab app={service} />}
                {activeTab === 'environment' && <EnvironmentVariables appId={service.id} />}
                {activeTab === 'shell' && service.isDocker && <ShellTab appId={service.id} appName={service.name} />}
                {activeTab === 'metrics' && <MetricsTab app={service} />}
                {activeTab === 'packages' && service.isPython && <PackagesTab appId={service.id} />}
                {activeTab === 'gunicorn' && service.isPython && <GunicornTab appId={service.id} />}
                {activeTab === 'commands' && service.isPython && <CommandsTab appId={service.id} appType={service.app_type} />}
                {activeTab === 'previews' && <PreviewList appId={service.id} />}
                {activeTab === 'settings' && (
                    <SettingsTab
                        app={service}
                        deployConfig={deployConfig}
                        domains={domains}
                        primaryDomain={primaryDomain}
                        onUpdate={reload}
                    />
                )}
            </div>

            {/* Extension slot: widgets contributed to the service detail page */}
            <PluginSlot name="service.detail.tab" context={{ serviceId: service.id }} />
            </div>
        </div>
    );
};

function extractRepoDisplay(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '').replace(/^https?:\/\/[^@]+@/, 'https://');
        const parts = cleaned.split(/[/:]/).filter(Boolean);
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default ServiceDetail;
