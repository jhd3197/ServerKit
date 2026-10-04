import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
import Modal from '@/components/Modal';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Package, Play, Square, RotateCw, FileText, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    useServer,
    unwrapRemoteData,
    normalizeListResponse,
} from './dockerHelpers';

// `docker compose ls --format json` capitalises its keys; the label-scanning
// fallback in docker_service builds the same shape by hand. Read through one
// accessor each so a payload from either path lands in the same column.
// Radix Select items cannot carry an empty value; this stands for "all services".
const ALL_SERVICES = '__all';
const LOG_LINE_OPTIONS = [50, 100, 200, 500, 1000];

const projectName = (project) => project.Name || project.name || '';
const projectStatus = (project) => project.Status || project.status || '';
const projectConfig = (project) => project.ConfigFiles || project.config_files || '';

// Status is a summary string — "running(3)" or "exited(2), running(1)" — so
// both the label and the count have to be parsed out of it. A project with even
// one container up counts as Running, which is what the old pill said too.
const isProjectRunning = (project) => projectStatus(project).includes('running');
const projectStatusLabel = (project) => (isProjectRunning(project) ? 'Running' : 'Stopped');
const projectRunningCount = (project) => {
    const match = projectStatus(project).match(/running\((\d+)\)/);
    return match ? Number.parseInt(match[1], 10) : 0;
};

// Built-in views. Up/down is the only axis a compose listing carries, and it is
// the one the pill already renders — so the two views below are the chip row
// that used to sit above this table, minus the row.
const NO_RULES = { match: 'all', rules: [] };
const PAGE_CLEAR = { search: '' };
const STATUS_IS = (id, value) => ({
    match: 'all',
    rules: [{ id, field: 'status', op: 'any', value: [value] }],
});

const COMPOSE_VIEWS = [
    {
        // What is actually serving traffic, busiest project first.
        name: 'Running',
        state: {
            sorts: [{ key: 'running', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: STATUS_IS('dc1', 'Running'),
            page: PAGE_CLEAR,
        },
    },
    {
        // Projects the CLI still knows about but nothing is up for — either
        // deliberately parked or something failed to come back after a reboot.
        name: 'Stopped',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: STATUS_IS('dc2', 'Stopped'),
            page: PAGE_CLEAR,
        },
    },
    {
        // The way back out of either of the above.
        name: 'All projects',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
];

// Compose Tab
const ComposeTab = ({ onStatsChange }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmCompose } = useConfirm();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [logsProject, setLogsProject] = useState(null);
    const [actionLoading, setActionLoading] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'name', direction: 'asc' }],
        storageKey: 'serverkit-table-docker-compose-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-docker-compose-cols',
    });

    useEffect(() => {
        loadProjects();
    }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadProjects() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = await api.getRemoteComposeProjects(serverId);
            } else {
                data = await api.composeList();
            }
            setProjects(normalizeListResponse(data, 'projects'));
        } catch (err) {
            console.error('Failed to load compose projects:', err);
            setProjects([]);
        } finally {
            setLoading(false);
        }
    }

    async function handleAction(project, action) {
        const projectPath = projectConfig(project);
        if (!projectPath) {
            toast.error(t('app.composeTab.projectPathNotFound', 'Project path not found'));
            return;
        }

        const name = projectName(project);
        setActionLoading(prev => ({ ...prev, [name]: true }));

        try {
            if (action === 'up') {
                if (isRemote) {
                    await api.remoteComposeUp(serverId, projectPath);
                } else {
                    await api.composeUp(projectPath, true, false);
                }
                toast.success(t('app.composeTab.projectStarted', 'Project started'));
            } else if (action === 'down') {
                const downConfirmed = await confirmCompose({ titleKey: 'app.composeTab.stopComposeProject', title: 'Stop Compose Project', messageKey: 'app.composeTab.stopThisComposeProjectContainersWill', message: 'Stop this compose project? Containers will be removed.' });
                if (!downConfirmed) {
                    setActionLoading(prev => ({ ...prev, [name]: false }));
                    return;
                }
                if (isRemote) {
                    await api.remoteComposeDown(serverId, projectPath);
                } else {
                    await api.composeDown(projectPath, false, true);
                }
                toast.success(t('app.composeTab.projectStopped', 'Project stopped'));
            } else if (action === 'restart') {
                if (isRemote) {
                    await api.remoteComposeRestart(serverId, projectPath);
                } else {
                    await api.composeRestart(projectPath);
                }
                toast.success(t('app.composeTab.projectRestarted', 'Project restarted'));
            } else if (action === 'pull') {
                if (isRemote) {
                    await api.remoteComposePull(serverId, projectPath);
                } else {
                    await api.composePull(projectPath);
                }
                toast.success(t('app.composeTab.imagesPulled', 'Images pulled'));
            }
            loadProjects();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} project:`, err);
            toast.error(err.message || t('app.composeTab.failedToProject', 'Failed to {{action}} project', { action: action }));
        } finally {
            setActionLoading(prev => ({ ...prev, [name]: false }));
        }
    }

    const filteredProjects = useMemo(() => {
        const search = searchTerm.toLowerCase();
        if (!search) return projects;
        return projects.filter((project) => (
            projectName(project).toLowerCase().includes(search) ||
            projectConfig(project).toLowerCase().includes(search)
        ));
    }, [projects, searchTerm]);

    // Every derived column carries BOTH `value` (rules, export) and `render`
    // (the cell). One without the other renders blank — and `running`, an array
    // of nothing on the row itself, would have thrown outright.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.project', header: 'Project',
            sortable: true,
            hideable: false,
            type: 'text',
            value: projectName,
            sortValue: projectName,
            render: (project) => (
                <span className="dx-name-line" title={projectName(project)}>
                    <span>{projectName(project)}</span>
                </span>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared: two labels across a handful of rows infer as text, which
            // would turn both views above into typed-fragment matches. The
            // pill's own word IS the filterable value.
            type: 'enum',
            enumOrder: ['Running', 'Stopped'],
            width: 170,
            value: projectStatusLabel,
            // Running first on asc, matching the old default ordering.
            sortValue: (project) => (isProjectRunning(project) ? 0 : 1),
            render: (project) => (
                <>
                    <span className={`dx-status-pill ${isProjectRunning(project) ? 'running' : 'stopped'}`}>
                        {projectStatusLabel(project)}
                    </span>
                    <span className="dx-muted-line" title={projectStatus(project)}>
                        {projectStatus(project) || 'unknown'}
                    </span>
                </>
            ),
        },
        {
            key: 'running',
            header: 'Up',
            sortable: true,
            // Declared with the raw container count behind it, so "up is over 0"
            // is a numeric rule rather than a string match on "running(3)".
            type: 'num',
            width: 90,
            value: projectRunningCount,
            sortValue: projectRunningCount,
            render: (project) => {
                const count = projectRunningCount(project);
                if (!count) return <span className="dx-muted-line">-</span>;
                return <span className="dx-muted-line">{count}</span>;
            },
        },
        {
            key: 'config',
            headerKey: 'app.composeTab.configFile', header: 'Config File',
            sortable: true,
            type: 'text',
            value: projectConfig,
            sortValue: projectConfig,
            render: (project) => (
                <span className="dx-muted-line mono" title={projectConfig(project)}>
                    {projectConfig(project) || '-'}
                </span>
            ),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 132,
            className: 'docker-compose-actions-column',
            render: (project) => {
                const busy = !!actionLoading[projectName(project)];
                const running = isProjectRunning(project);
                return (
                    <div className="dx-row-actions">
                        <Button variant="unstyled"
                            type="button"
                            className="dx-row-action"
                            onClick={() => setLogsProject(project)}
                            disabled={busy}
                            title={t('common.labels.logs', 'Logs')}
                        >
                            <FileText size={13} />
                        </Button>
                        {running ? (
                            <>
                                <Button variant="unstyled"
                                    type="button"
                                    className="dx-row-action"
                                    onClick={() => handleAction(project, 'restart')}
                                    disabled={busy}
                                    title={t('common.actions.restart', 'Restart')}
                                >
                                    <RotateCw size={13} />
                                </Button>
                                <Button variant="unstyled"
                                    type="button"
                                    className="dx-row-action is-danger"
                                    onClick={() => handleAction(project, 'down')}
                                    disabled={busy}
                                    title={t('common.actions.stop', 'Stop')}
                                >
                                    <Square size={13} />
                                </Button>
                            </>
                        ) : (
                            <Button variant="unstyled"
                                type="button"
                                className="dx-row-action is-success"
                                onClick={() => handleAction(project, 'up')}
                                disabled={busy}
                                title={t('common.actions.start', 'Start')}
                            >
                                <Play size={13} />
                            </Button>
                        )}
                        <Button variant="unstyled"
                            type="button"
                            className="dx-row-action"
                            onClick={() => handleAction(project, 'pull')}
                            disabled={busy}
                            title={t('app.composeTab.pullImages', 'Pull images')}
                        >
                            <Download size={13} />
                        </Button>
                    </div>
                );
            },
        },
    ];

    const viewPageState = useMemo(() => ({ search: searchTerm }), [searchTerm]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearchTerm(saved.search);
    }, []);

    // Chrome INLINE in the picker's `actions` — the Docker page owns the top bar
    // above this panel. `urlScope` because that one route renders five of these
    // tables, and the link params (`view`, `sort`, `hide`, `f`…) are global
    // names: unscoped, the compose sort would arrive as the containers sort.
    const chrome = useTableChrome({
        columns,
        rows: filteredProjects,
        viewPageKey: 'docker-compose',
        urlScope: 'compose',
        builtinViews: COMPOSE_VIEWS,
        noun: 'projects',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (loading) {
        return (
            <div className="dx-tab-pane">
                <div className="docker-loading">{t('app.composeTab.loadingComposeProjects', 'Loading compose projects…')}</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-list-pane">
            <GridViewPicker
                views={chrome.views}
                label="projects"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder={t('app.composeTab.filterProjectOrConfigPath', 'Filter project or config path…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        {/* Refresh is not repeated as its own icon: it rides the
                            "⋮" with the other table-wide actions. */}
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadProjects} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {filteredProjects.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title={projects.length === 0 ? t('app.composeTab.noComposeProjects', 'No Compose projects') : t('app.composeTab.noMatchingProjects', 'No matching projects')}
                    description={projects.length === 0
                        ? t('app.composeTab.noDockerComposeProjectsAreRunning', 'No Docker Compose projects are running on this server.')
                        : t('app.composeTab.noProjectsMatchTheCurrentSearch', 'No projects match the current search.')}
                    action={projects.length === 0 ? <code>{t('app.composeTab.dockerComposeUpD', 'docker compose up -d')}</code> : null}
                />
            ) : (
                <section className="dx-resource-list">
                    <DataTable
                        {...chrome.tableProps}
                        columns={chrome.columns}
                        data={filteredProjects}
                        keyField={(project) => projectName(project)}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        className="dx-table-wrap"
                        tableClassName="dx-manager-table dx-plain-table"
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={projects.length}
                                noun="project"
                            />
                        )}
                    />
                </section>
            )}

            {logsProject && (
                <ComposeLogsModal
                    project={logsProject}
                    onClose={() => setLogsProject(null)}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

// Compose Logs Modal
const ComposeLogsModal = ({ project, onClose }) => {
    const { t } = useTranslation();
    const { serverId, isRemote } = useServer();
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);
    const [selectedService, setSelectedService] = useState('');
    const [services, setServices] = useState([]);

    const name = projectName(project);
    const projectPath = projectConfig(project);

    useEffect(() => {
        loadServices();
        loadLogs();
    }, [project, tail, selectedService]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadServices() {
        try {
            let containers;
            if (isRemote) {
                containers = normalizeListResponse(
                    await api.getRemoteComposePs(serverId, projectPath),
                    'containers'
                );
            } else {
                const result = await api.composePs(projectPath);
                containers = result.containers || result || [];
            }

            // Extract unique service names
            const serviceNames = [...new Set(
                (Array.isArray(containers) ? containers : [])
                    .map(c => c.Service || c.service)
                    .filter(Boolean)
            )];
            setServices(serviceNames);
        } catch (err) {
            console.error('Failed to load services:', err);
        }
    }

    async function loadLogs() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                data = unwrapRemoteData(await api.remoteComposeLogs(serverId, projectPath, selectedService || null, tail));
            } else {
                data = await api.composeLogs(projectPath, selectedService || null, tail);
            }
            setLogs(data.logs || 'No logs available');
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.composeTab.logs2', 'Logs: {{name}}', { name: name })} size="lg">
            <div className="modal-body">
                <div className="logs-controls docker-compose-log-controls">
                    <label htmlFor="compose-log-service">{t('app.composeTab.service', 'Service:')}</label>
                    <Select
                        value={selectedService === '' ? ALL_SERVICES : selectedService}
                        onValueChange={(value) => setSelectedService(value === ALL_SERVICES ? '' : value)}
                    >
                        <SelectTrigger id="compose-log-service" className="docker-compose-log-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL_SERVICES}>{t('app.composeTab.allServices', 'All Services')}</SelectItem>
                            {services.map(service => (
                                <SelectItem key={service} value={service}>{service}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <label htmlFor="compose-log-lines">{t('app.composeTab.lines', 'Lines:')}</label>
                    <Select value={String(tail)} onValueChange={(value) => setTail(Number(value))}>
                        <SelectTrigger id="compose-log-lines" className="docker-compose-log-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {LOG_LINE_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <pre className="log-viewer">{loading ? 'Loading...' : logs}</pre>
            </div>
            <div className="modal-actions">
                <Button variant="outline" onClick={loadLogs} disabled={loading}>
                    {loading ? 'Loading...' : 'Refresh'}
                </Button>
                <Button onClick={onClose}>{t('common.actions.close', 'Close')}</Button>
            </div>
        </Modal>
    );
};

export default ComposeTab;
