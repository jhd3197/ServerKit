import { useCallback, useState, useEffect, useMemo  } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layers, Plus, Square, Play, RotateCw, GitBranch, Github, FolderOpen, FileArchive, FolderKanban, ArrowDownToLine } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { getServiceType, getStatusConfig, formatRelativeTime } from '../utils/serviceTypes';
import ResourceListPage from '../components/layouts/ResourceListPage';
import BandwidthSparkline from '../components/BandwidthSparkline';
import { formatBytes } from '../utils/formatBytes';
import { Pill, ServiceTile, EnvTag, SearchField, serviceStatusKind } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import Modal from '@/components/Modal';
import RequiresDocker from '../components/RequiresDocker';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Severity order for status sorting — also the page's default row order.
const STATUS_SORT_ORDER = { running: 0, deploying: 1, building: 2, stopped: 3, failed: 4 };

// Sentinels for the move-to-project Select (Radix forbids empty-string values).
const UNASSIGN = '__unassign__';
const NO_ENV = '__no_env__';

// Preset views: the questions people open this page to answer. Each is a
// snapshot of the same chrome state a personal view saves, so any of them can
// be tweaked and re-saved under a new name.
//
// `status` values are the RAW statuses the column's `value` accessor returns
// (running · deploying · building · stopped · failed) — NOT the pill labels,
// which are prettified by getStatusConfig(). There is no separate status
// segment any more: the Status column's own menu is the one place services are
// narrowed by state, and it carries live per-value counts the segment never had.
const RULES = (...value) => ({ match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value }] });
const NO_RULES = { match: 'all', rules: [] };

const SERVICE_VIEWS = [
    { name: 'Running', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: RULES('running') } },
    {
        // The old segment meant "not running", so it also swallowed failed,
        // deploying and building. Keep that meaning rather than narrowing it.
        name: 'Stopped',
        state: {
            search: '', sorts: [], hiddenKeys: [],
            columnFilters: { match: 'all', rules: [{ id: 'st', field: 'status', op: 'none', value: ['running'] }] },
        },
    },
    {
        name: 'Recently deployed',
        state: {
            search: '', hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'last_deploy', direction: 'desc' }],
        },
    },
    {
        // Anything not cleanly live — the triage list during an incident.
        name: 'Broken or unknown',
        state: {
            search: '', hiddenKeys: ['bandwidth'], groupBy: null,
            sorts: [{ key: 'status', direction: 'desc' }, { key: 'name', direction: 'asc' }],
            columnFilters: {
                match: 'any',
                rules: [{ id: 'bk1', field: 'status', op: 'any', value: ['failed', 'stopped'] }],
            },
        },
    },
    {
        // Live, but nobody has shipped to it in a long time.
        name: 'Stale live services',
        state: {
            search: '', hiddenKeys: ['source', 'bandwidth'], groupBy: null,
            sorts: [{ key: 'last_deploy', direction: 'asc' }],
            columnFilters: RULES('running'),
        },
    },
    {
        // Deployed by hand or by upload — the ones with no git history to roll back to.
        name: 'Not git-deployed',
        state: {
            search: '', hiddenKeys: ['bandwidth'], groupBy: null,
            sorts: [{ key: 'name', direction: 'asc' }],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'sr1', field: 'source', op: 'any', value: ['manual', 'upload'] }],
            },
        },
    },
    {
        name: 'By project',
        state: {
            search: '', hiddenKeys: ['source', 'bandwidth'], groupBy: 'project',
            sorts: [{ key: 'status', direction: 'asc' }, { key: 'name', direction: 'asc' }],
            columnFilters: NO_RULES,
        },
    },
];

const Services = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const toast = useToast();
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionLoading, setActionLoading] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);
    const [showMoveDialog, setShowMoveDialog] = useState(false);
    const [bandwidth, setBandwidth] = useState({});

    const loadApps = useCallback(async () => {
        try {
            const data = await api.getApps();
            setApps(data.apps || []);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadApps();
        // Best-effort: one call for every row's sparkline; absence is fine.
        api.getBandwidthApps()
            .then((data) => setBandwidth(data?.apps || {}))
            .catch(() => {});
    }, [loadApps]);


    async function handleAction(e, appId, action) {
        e.stopPropagation();
        setActionLoading(`${appId}-${action}`);
        try {
            if (action === 'start') await api.startApp(appId);
            else if (action === 'stop') await api.stopApp(appId);
            else if (action === 'restart') await api.restartApp(appId);
            await loadApps();
        } catch (err) {
            toastError(toast, t('app.services.failedToService', 'Failed to {{action}} service', { action: action }), err);
        } finally {
            setActionLoading(null);
        }
    }

    async function handleBulkAction(action) {
        if (selectedIds.size === 0) return;
        setBulkLoading(true);
        try {
            const promises = [...selectedIds].map(id => {
                if (action === 'start') return api.startApp(id);
                if (action === 'stop') return api.stopApp(id);
                if (action === 'restart') return api.restartApp(id);
                return Promise.resolve();
            });
            await Promise.allSettled(promises);
            toast.success(t('app.services.sentToServiceS', '{{action}} sent to {{size}} service(s)', { action: action, size: selectedIds.size }));
            setSelectedIds(new Set());
            await loadApps();
        } catch (err) {
            toastError(toast, t('app.services.bulkFailed', 'Bulk {{action}} failed', { action: action }), err);
        } finally {
            setBulkLoading(false);
        }
    }

    const filteredApps = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return apps
            .filter(app => !q || app.name.toLowerCase().includes(q))
            .sort((a, b) => {
                return (STATUS_SORT_ORDER[a.status] ?? 5) - (STATUS_SORT_ORDER[b.status] ?? 5) || a.name.localeCompare(b.name);
            });
    }, [apps, searchTerm]);

    useTopbarActions(() =>
        <>
            <Button variant="outline" size="sm" asChild>
                <Link to="/imports">
                    <ArrowDownToLine size={16} />
                    {t('app.services.importASite', 'Import a site')}
                </Link>
            </Button>
            <Button size="sm" asChild>
                <Link to="/services/new">
                    <Plus size={16} />
                    {t('app.services.newService', 'New service')}
                </Link>
            </Button>
            <SearchField
                value={searchTerm}
                onSearch={setSearchTerm}
                placeholder={t('app.services.searchServices', 'Search services…')}
            />
        </>,
        [searchTerm]
    );

    const toggleOne = (id, checked) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    // DataTable columns. Interactive cells (row actions) stop click
    // propagation so they don't trigger the row's navigate.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.service', header: 'Service',
            sortable: true,
            hideable: false,
            render: (app) => {
                const typeInfo = getServiceType(app.app_type);
                return (
                    <div className="sk-cell-name">
                        <ServiceTile name={app.name} size={30} className="wp-list__tile" aria-hidden="true" />
                        <span>
                            <div>{app.name}</div>
                            <div className="sk-cell-sub">{typeInfo.label}</div>
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'project',
            headerKey: 'common.labels.project', header: 'Project',
            sortable: true,
            // Unassigned services (no project) sort last.
            sortValue: (app) => app.project_name || null,
            groupable: true,
            groupValue: (app) => app.project_name || null,
            groupLabel: (value) => value ?? 'Unassigned',
            render: (app) => (
                app.project_name ? (
                    <span className="services-page__project">
                        <span className="services-page__project-name" title={app.project_name}>
                            <FolderKanban size={12} aria-hidden="true" />
                            {app.project_name}
                        </span>
                        {app.environment_name && (
                            <EnvTag env={app.environment_name}>{app.environment_name}</EnvTag>
                        )}
                    </span>
                ) : (
                    <span className="services-page__unassigned">{t('app.services.unassigned', 'Unassigned')}</span>
                )
            ),
        },
        {
            key: 'source',
            headerKey: 'common.labels.source', header: 'Source',
            render: (app) => {
                const isGithub = (app.deploy_repo_url || '').includes('github.com');
                if (app.deploy_repo_url) {
                    return (
                        <span className="services-page__src-badge" title={app.deploy_repo_url}>
                            {isGithub ? <Github size={12} /> : <GitBranch size={12} />}
                            {extractRepoName(app.deploy_repo_url)}
                        </span>
                    );
                }
                if (app.source === 'manual') {
                    return (
                        <span className="services-page__src-badge services-page__src-badge--manual" title={app.root_path || ''}>
                            <FolderOpen size={12} />
                            {t('app.services.local', 'Local')}
                        </span>
                    );
                }
                if (app.source === 'upload') {
                    return (
                        <span className="services-page__src-badge services-page__src-badge--upload" title={app.upload_path || ''}>
                            <FileArchive size={12} />
                            {t('app.services.uploadV', 'Upload v')}{app.version || 1}
                        </span>
                    );
                }
                return <span className="wp-list__dash">—</span>;
            },
        },
        {
            key: 'domain',
            headerKey: 'common.labels.domain', header: 'Domain',
            sortable: true,
            sortValue: (app) => (app.domains?.find(d => d.is_primary) || app.domains?.[0])?.name || null,
            cellClassName: 'sk-cell-mono',
            render: (app) => {
                const primaryDomain = (app.domains?.find(d => d.is_primary) || app.domains?.[0])?.name || '';
                return primaryDomain || <span className="wp-list__dash">—</span>;
            },
        },
        {
            key: 'bandwidth',
            headerKey: 'app.services.transfer', header: 'Transfer',
            render: (app) => {
                const bw = bandwidth[String(app.id)];
                if (!bw || !bw.series30?.some(v => v > 0)) {
                    return <span className="wp-list__dash">—</span>;
                }
                return (
                    <span className="bw-cell" title={t('app.services.transferLast30Days', 'Transfer (last 30 days)')}>
                        <BandwidthSparkline data={bw.series30} width={72} height={20} />
                        <span className="bw-cell__month">{formatBytes(bw.month_bytes)}/mo</span>
                    </span>
                );
            },
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            // `value` is the FILTER/GROUP value, `sortValue` is the ORDERING key —
            // they differ here, and the column has to say so. Without an explicit
            // `value` the filter engine falls back to sortValue and compares
            // against the severity NUMBER, so a "status is running" rule would
            // silently match nothing.
            value: (app) => app.status,
            // Same severity order as the page's default ordering, not alphabet.
            sortValue: (app) => STATUS_SORT_ORDER[app.status] ?? 5,
            groupable: true,
            groupValue: (app) => app.status,
            groupLabel: (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None'),
            render: (app) => <Pill kind={serviceStatusKind(app.status)}>{getStatusConfig(app.status).label}</Pill>,
        },
        {
            key: 'last_deploy',
            headerKey: 'app.services.lastDeploy', header: 'Last deploy',
            sortable: true,
            // Numeric timestamp sort; never-deployed services sort last.
            sortValue: (app) => (app.last_deploy_at ? new Date(app.last_deploy_at).getTime() : null),
            cellClassName: 'sk-cell-dim',
            render: (app) => (
                app.last_deploy_at ? formatRelativeTime(app.last_deploy_at) : <span className="wp-list__dash">—</span>
            ),
        },
        {
            key: '__actions',
            header: '',
            width: 70,
            sortable: false,
            hideable: false,
            render: (app) => {
                const isRunning = app.status === 'running';
                return (
                    <div className="services-page__actions" onClick={(e) => e.stopPropagation()}>
                        {isRunning ? (
                            <>
                                <Button variant="ghost" size="sm" onClick={(e) => handleAction(e, app.id, 'restart')} disabled={actionLoading === `${app.id}-restart`} title={t('common.actions.restart', 'Restart')}>
                                    <RotateCw size={14} />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={(e) => handleAction(e, app.id, 'stop')} disabled={actionLoading === `${app.id}-stop`} title={t('common.actions.stop', 'Stop')}>
                                    <Square size={14} />
                                </Button>
                            </>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={(e) => handleAction(e, app.id, 'start')} disabled={actionLoading === `${app.id}-start`} title={t('common.actions.start', 'Start')}>
                                <Play size={14} />
                            </Button>
                        )}
                    </div>
                );
            },
        },
    ];

    return (
        <RequiresDocker what="Services">
        <ResourceListPage
            className="services-page"
            loading={loading}
            loadingTitle="Loading services..."
            storageKey="serverkit-list-services"
            viewPageKey="services"
            noun="services"
            builtinViews={SERVICE_VIEWS}
            totalCount={apps.length}
            error={loadError}
            errorTitle={t('app.services.couldntLoadServices', "Couldn't load services")}
            onRetry={loadApps}
            items={filteredApps}
            columns={columns}
            keyField="id"
            onRowClick={(app) => navigate(app.app_type === 'wordpress' ? `/wordpress/${app.id}` : `/services/${app.id}`)}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={toggleOne}
            onSelectAll={(checked) => setSelectedIds(checked ? new Set(filteredApps.map(a => a.id)) : new Set())}
            selectedCount={selectedIds.size}
            onClearSelection={() => setSelectedIds(new Set())}
            bulkActions={
                <>
                    <Button variant="outline" size="sm" onClick={() => setShowMoveDialog(true)} disabled={bulkLoading}>
                        <FolderKanban size={14} />
                        {t('app.services.moveToProject', 'Move to project')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleBulkAction('restart')} disabled={bulkLoading}>{t('app.services.restartAll', 'Restart all')}</Button>
                    <Button variant="outline" size="sm" onClick={() => handleBulkAction('stop')} disabled={bulkLoading}>{t('app.services.stopAll', 'Stop all')}</Button>
                    <Button variant="outline" size="sm" onClick={() => handleBulkAction('start')} disabled={bulkLoading}>{t('app.services.startAll', 'Start all')}</Button>
                </>
            }
            emptyIcon={Layers}
            emptyTitle="No services found"
            emptyDescription="Connect a repository or install a template to get started"
            emptyAction={
                <Button asChild>
                    <Link to="/services/new">{t('app.services.createService', 'New service')}</Link>
                </Button>
            }
            filteredEmptyIcon={Layers}
            filteredEmptyTitle="No services found"
            filteredEmptyDescription="Try adjusting your search or filter"
        >
            <MoveToProjectDialog
                open={showMoveDialog}
                onOpenChange={setShowMoveDialog}
                count={selectedIds.size}
                onMove={async (projectId, environmentId) => {
                    setBulkLoading(true);
                    try {
                        await api.moveAppsToProject([...selectedIds], projectId, environmentId);
                        toast.success(
                            projectId === null
                                ? t('app.services.unassignedServiceS', 'Unassigned {{size}} service(s)', { size: selectedIds.size })
                                : t('app.services.movedServiceS', 'Moved {{size}} service(s)', { size: selectedIds.size })
                        );
                        setShowMoveDialog(false);
                        setSelectedIds(new Set());
                        await loadApps();
                    } catch (err) {
                        toastError(toast, t('app.services.failedToMoveServices', 'Failed to move services'), err);
                    } finally {
                        setBulkLoading(false);
                    }
                }}
            />
        </ResourceListPage>
        </RequiresDocker>
    );
};

// Bulk "Move to project" modal: pick a project, then one of its environments
// (or leave unassigned). Loads the project list lazily on open; fetches the
// chosen project's environments on selection.
const MoveToProjectDialog = ({ open, onOpenChange, count, onMove }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const showError = toast.error;
    const [projects, setProjects] = useState([]);
    const [environments, setEnvironments] = useState([]);
    const [projectValue, setProjectValue] = useState(UNASSIGN);
    const [envValue, setEnvValue] = useState(NO_ENV);
    const [loadingProjects, setLoadingProjects] = useState(false);
    const [loadingEnvs, setLoadingEnvs] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Reset selection each time the dialog opens.
        setProjectValue(UNASSIGN);
        setEnvValue(NO_ENV);
        setEnvironments([]);
        setLoadingProjects(true);
        api.getProjects()
            .then((data) => setProjects(Array.isArray(data?.projects) ? data.projects : []))
            .catch((err) => toastError(showError, t('app.services.failedToLoadProjects', 'Failed to load projects'), err))
            .finally(() => setLoadingProjects(false));
    }, [open, showError, t]);

    async function handleProjectChange(value) {
        setProjectValue(value);
        setEnvValue(NO_ENV);
        setEnvironments([]);
        if (value === UNASSIGN) return;
        setLoadingEnvs(true);
        try {
            const data = await api.getProject(value);
            const envs = Array.isArray(data?.project?.environments) ? data.project.environments : [];
            setEnvironments(envs);
        } catch (err) {
            toastError(toast, t('app.services.failedToLoadEnvironments', 'Failed to load environments'), err);
        } finally {
            setLoadingEnvs(false);
        }
    }

    async function handleSubmit() {
        const projectId = projectValue === UNASSIGN ? null : Number(projectValue);
        const environmentId = envValue === NO_ENV ? null : Number(envValue);
        setSubmitting(true);
        try {
            await onMove(projectId, environmentId);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={() => onOpenChange(false)}
            title={t('app.services.moveToProject', 'Move to project')}
            footer={(
                <>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={submitting || loadingProjects}>
                        {submitting ? 'Moving…' : (projectValue === UNASSIGN ? 'Unassign' : 'Move')}
                    </Button>
                </>
            )}
        >
            <p className="sk-modal__subtitle">
                {t('app.services.assign', 'Assign')} {count} {t('app.services.selectedService', 'selected service')}{count === 1 ? '' : 's'} {t('app.services.toAProjectAndEnvironmentOr', 'to a project and environment, or leave them unassigned.')}
            </p>

            <div className="services-move">
                    <div className="services-move__field">
                        <Label htmlFor="move-project">{t('common.labels.project', 'Project')}</Label>
                        <Select value={projectValue} onValueChange={handleProjectChange} disabled={loadingProjects}>
                            <SelectTrigger id="move-project">
                                <SelectValue placeholder={loadingProjects ? t('common.loading', 'Loading…') : t('app.services.selectAProject', 'Select a project')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={UNASSIGN}>{t('app.services.unassigned', 'Unassigned')}</SelectItem>
                                {projects.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {projectValue !== UNASSIGN && (
                        <div className="services-move__field">
                            <Label htmlFor="move-env">{t('app.services.environment', 'Environment')}</Label>
                            <Select value={envValue} onValueChange={setEnvValue} disabled={loadingEnvs}>
                                <SelectTrigger id="move-env">
                                    <SelectValue placeholder={loadingEnvs ? t('common.loading', 'Loading…') : t('app.services.noSpecificEnvironment', 'No specific environment')} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_ENV}>{t('app.services.noSpecificEnvironment', 'No specific environment')}</SelectItem>
                                    {environments.map((e) => (
                                        <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
        </Modal>
    );
};

function extractRepoName(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '').replace(/^https?:\/\/[^@]+@/, 'https://');
        const parts = cleaned.split(/[/:]/).filter(Boolean);
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default Services;
