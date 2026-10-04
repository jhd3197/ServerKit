import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useAuth } from '../contexts/useAuth.js';
import PageLoader from '../components/PageLoader';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Pill } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import CopyField from '../components/CopyField';
import { useTranslation } from 'react-i18next';
import {
    Activity,
    CheckCircle2,
    ExternalLink,
    Globe2,
    Link2,
    PlayCircle,
    Plus,
    RefreshCw,
    Trash2,
    Unlink,
} from 'lucide-react';

// pill → ds Pill kind · tone → .status-dot modifier · dot → .comp-dots square
const STATUS_META = {
    operational: { labelKey: 'app.statusPages.operational', label: 'Operational', pill: 'green', tone: 'success', dot: '' },
    degraded: { labelKey: 'app.statusPages.degraded', label: 'Degraded', pill: 'amber', tone: 'warning', dot: 'degraded' },
    partial_outage: { labelKey: 'app.statusPages.partialOutage', label: 'Partial outage', pill: 'amber', tone: 'warning', dot: 'degraded' },
    major_outage: { labelKey: 'app.statusPages.majorOutage', label: 'Major outage', pill: 'red', tone: 'danger', dot: 'down' },
    maintenance: { labelKey: 'app.statusPages.maintenance', label: 'Maintenance', pill: 'cyan', tone: 'info', dot: 'maintenance' },
};

const INCIDENT_STATUS = [
    { value: 'investigating', labelKey: 'app.statusPages.investigating', label: 'Investigating' },
    { value: 'identified', labelKey: 'app.statusPages.identified', label: 'Identified' },
    { value: 'monitoring', labelKey: 'common.labels.monitoring', label: 'Monitoring' },
    { value: 'resolved', labelKey: 'app.statusPages.resolved', label: 'Resolved' },
];

const IMPACT_OPTIONS = [
    { value: 'none', labelKey: 'app.statusPages.none', label: 'None' },
    { value: 'minor', labelKey: 'app.statusPages.minor', label: 'Minor' },
    { value: 'major', labelKey: 'app.statusPages.major', label: 'Major' },
    { value: 'critical', labelKey: 'app.statusPages.critical', label: 'Critical' },
];

const CHECK_TARGET_PLACEHOLDERS = {
    http: 'https://example.com/health',
    tcp: 'example.com:443',
    dns: 'example.com',
    ping: 'example.com',
};

const defaultPageForm = { name: '', slug: '', description: '', primary_color: '#6d7cff' };
const defaultCompForm = {
    name: '',
    group: 'Services',
    check_type: 'http',
    check_target: '',
    check_interval: 60,
    check_timeout: 10,
};
const defaultIncidentForm = { title: '', status: 'investigating', impact: 'minor', body: '' };

function normalizeSlug(value) {
    return (value || '')
        .toLowerCase()
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function formatDate(value) {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
}

function formatUptime(value) {
    if (typeof value !== 'number') return '100.00%';
    return `${value.toFixed(2)}%`;
}

function getPublicStatusUrl(page) {
    if (!page) return '';
    return `${window.location.origin}/status/${page.slug}`;
}

function getOverallStatus(components) {
    const statuses = components.map((component) => component.status);
    if (statuses.some((status) => status === 'major_outage')) return 'major_outage';
    if (statuses.some((status) => status === 'partial_outage' || status === 'degraded')) return 'degraded';
    if (statuses.some((status) => status === 'maintenance')) return 'maintenance';
    return 'operational';
}

const StatusPages = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { user } = useAuth();
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPage, setSelectedPage] = useState(null);
    const [components, setComponents] = useState([]);
    const [incidents, setIncidents] = useState([]);
    const [showCreatePage, setShowCreatePage] = useState(false);
    const [showCreateComponent, setShowCreateComponent] = useState(false);
    // Monitors are first-class now (core /api/v1/monitors) — a status page
    // publishes a subset of them rather than owning its own private probes. This
    // is the list of monitors not yet on any page.
    const [unattached, setUnattached] = useState([]);
    const [showAttach, setShowAttach] = useState(false);
    const [showCreateIncident, setShowCreateIncident] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    const [pageForm, setPageForm] = useState(defaultPageForm);
    const [compForm, setCompForm] = useState(defaultCompForm);
    const [incidentForm, setIncidentForm] = useState(defaultIncidentForm);

    const isAdmin = Boolean(user?.is_admin);

    const groupedComponents = useMemo(() => {
        return components.reduce((groups, component) => {
            const groupName = component.group || 'Services';
            groups[groupName] = groups[groupName] || [];
            groups[groupName].push(component);
            return groups;
        }, {});
    }, [components]);

    const activeIncidents = useMemo(
        () => incidents.filter((incident) => incident.status !== 'resolved'),
        [incidents]
    );

    const overallStatus = useMemo(() => getOverallStatus(components), [components]);
    const overallMeta = STATUS_META[overallStatus] || STATUS_META.operational;
    const selectedUrl = getPublicStatusUrl(selectedPage);

    const loadPageDetails = async (page) => {
        if (!page) return;
        try {
            const [cData, iData, mData] = await Promise.all([
                api.getStatusPageComponents(page.id),
                api.getStatusPageIncidents(page.id),
                api.getMonitors().catch(() => null),
            ]);
            setSelectedPage(page);
            setComponents(cData.components || []);
            setIncidents(iData.incidents || []);
            setUnattached((mData?.monitors || []).filter((m) => m.page_id == null));
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToLoadPageDetails', 'Failed to load page details'));
        }
    };

    // Publishing an existing monitor is just setting its page — no second probe,
    // no duplicated config, and the monitor keeps the history it already has.
    const handleAttachMonitor = async (monitor) => {
        try {
            await api.updateMonitor(monitor.id, { page_id: selectedPage.id });
            toast.success(t('app.statusPages.addedTo', '{{name}} added to {{name2}}', { name: monitor.name, name2: selectedPage.name }));
            setShowAttach(false);
            await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.couldNotAddTheMonitor', 'Could not add the monitor'));
        }
    };

    // Unpublish without destroying: deleting a component now deletes a real
    // monitor and its history, so removing it from a page needs its own action.
    const handleDetachMonitor = async (component) => {
        try {
            await api.updateMonitor(component.id, { page_id: null });
            toast.success(t('app.statusPages.removedFromThisPage', '{{name}} removed from this page', { name: component.name }));
            await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.couldNotRemoveTheMonitor', 'Could not remove the monitor'));
        }
    };

    const loadPages = async () => {
        try {
            setLoading(true);
            const data = await api.getStatusPages();
            const nextPages = data.pages || [];
            setPages(nextPages);

            const nextSelected = selectedPage
                ? nextPages.find((page) => page.id === selectedPage.id) || nextPages[0]
                : nextPages[0];

            if (nextSelected) {
                await loadPageDetails(nextSelected);
            } else {
                setSelectedPage(null);
                setComponents([]);
                setIncidents([]);
            }
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToLoadStatusPages', 'Failed to load status pages'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPages();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePageNameChange = (name) => {
        setPageForm((prev) => {
            const previousAutoSlug = normalizeSlug(prev.name);
            const shouldSyncSlug = !prev.slug || prev.slug === previousAutoSlug;
            return {
                ...prev,
                name,
                slug: shouldSyncSlug ? normalizeSlug(name) : prev.slug,
            };
        });
    };

    const handleCreatePage = async () => {
        try {
            const page = await api.createStatusPage({
                ...pageForm,
                slug: normalizeSlug(pageForm.slug),
            });
            toast.success(t('app.statusPages.statusPageCreated', 'Status page created'));
            setShowCreatePage(false);
            setPageForm(defaultPageForm);
            setPages((current) => [...current, page].sort((a, b) => a.name.localeCompare(b.name)));
            await loadPageDetails(page);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToCreateStatusPage', 'Failed to create status page'));
        }
    };

    const handleCreateComponent = async () => {
        if (!selectedPage) return;
        try {
            await api.createStatusComponent(selectedPage.id, compForm);
            toast.success(t('app.statusPages.componentAdded', 'Component added'));
            setShowCreateComponent(false);
            setCompForm(defaultCompForm);
            await loadPageDetails(selectedPage);
            await loadPages();
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToAddComponent', 'Failed to add component'));
        }
    };

    const handleRunCheck = async (component) => {
        try {
            const result = await api.runStatusCheck(component.id);
            toast.success(t('app.statusPages.check', 'Check {{status}}{{value}}', { status: result.status, value: result.response_time ? ` in ${result.response_time}ms` : '' }));
            if (selectedPage) await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.checkFailed', 'Check failed'));
        }
    };

    const handleCreateIncident = async () => {
        if (!selectedPage) return;
        try {
            await api.createStatusIncident(selectedPage.id, incidentForm);
            toast.success(t('app.statusPages.incidentCreated', 'Incident created'));
            setShowCreateIncident(false);
            setIncidentForm(defaultIncidentForm);
            await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToCreateIncident', 'Failed to create incident'));
        }
    };

    const handleUpdateIncidentStatus = async (incident, status) => {
        try {
            const statusLabel = INCIDENT_STATUS.find((item) => item.value === status)?.label || status;
            await api.updateStatusIncident(incident.id, {
                status,
                update_body: status === 'resolved' ? 'Issue has been resolved.' : `Status changed to ${statusLabel}.`,
            });
            toast.success(t('app.statusPages.incidentSetTo', 'Incident set to {{statusLabel}}', { statusLabel: statusLabel }));
            if (selectedPage) await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.failedToUpdateIncident', 'Failed to update incident'));
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteConfirm) return;
        try {
            if (deleteConfirm.type === 'page') {
                await api.deleteStatusPage(deleteConfirm.item.id);
                toast.success(t('app.statusPages.statusPageDeleted', 'Status page deleted'));
                setDeleteConfirm(null);
                setSelectedPage(null);
                setComponents([]);
                setIncidents([]);
                await loadPages();
                return;
            }

            if (deleteConfirm.type === 'component') {
                await api.deleteStatusComponent(deleteConfirm.item.id);
                toast.success(t('app.statusPages.componentDeleted', 'Component deleted'));
            }

            if (deleteConfirm.type === 'incident') {
                await api.deleteStatusIncident(deleteConfirm.item.id);
                toast.success(t('app.statusPages.incidentDeleted', 'Incident deleted'));
            }

            setDeleteConfirm(null);
            if (selectedPage) await loadPageDetails(selectedPage);
        } catch (err) {
            toast.error(err.message || t('app.statusPages.deleteFailed', 'Delete failed'));
        }
    };

    useTopbarActions(() =>
        (
            <>
                <Button size="sm" variant="outline" onClick={loadPages}>
                    <RefreshCw size={16} />
                    {t('common.actions.refresh', 'Refresh')}
                </Button>
                {isAdmin && (
                    <Button size="sm" onClick={() => setShowCreatePage(true)}>
                        <Plus size={16} />
                        {t('app.statusPages.createPage', 'Create page')}
                    </Button>
                )}
            </>
        ),
        [isAdmin]
    );

    if (loading) return <PageLoader />;

    return (
        <div className="sk-tabgroup__inner status-pages-page">
            <div className="status-layout">
                <aside className="status-pages-list" aria-label={t('app.statusPages.statusPages', 'Status pages')}>
                    {pages.map((page) => (
                        <Button variant="unstyled"
                            key={page.id}
                            type="button"
                            className={`status-page-item ${selectedPage?.id === page.id ? 'active' : ''}`}
                            onClick={() => loadPageDetails(page)}
                        >
                            <span className="status-page-item__top">
                                <span className="status-page-item__name">{page.name}</span>
                                <Pill kind={page.is_public ? 'green' : 'gray'} dot={false}>
                                    {page.is_public ? 'Public' : 'Private'}
                                </Pill>
                            </span>
                            <span className="status-page-item__slug">/status/{page.slug}</span>
                            <span className="status-page-item__meta">
                                <Globe2 size={13} />
                                {page.component_count} component{page.component_count !== 1 ? 's' : ''}
                            </span>
                        </Button>
                    ))}
                    {pages.length === 0 && (
                        <EmptyState icon={Activity} title={t('app.statusPages.noStatusPagesYet', 'No status pages yet')} />
                    )}
                </aside>

                {selectedPage ? (
                    <section className="status-detail-panel">
                        <div className="status-detail-panel__hero">
                            <div>
                                <Pill kind={overallMeta.pill} className="status-overall-pill">
                                    {overallMeta.label}
                                </Pill>
                                <h2>{selectedPage.name}</h2>
                                {selectedPage.description && <p>{selectedPage.description}</p>}
                                {components.length > 0 && (
                                    <div className="comp-dots" aria-hidden="true">
                                        {components.map((component) => {
                                            const meta = STATUS_META[component.status] || STATUS_META.operational;
                                            return <i key={component.id} className={meta.dot} title={component.name} />;
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="status-url-card">
                                <CopyField label={t('app.statusPages.publicUrl', 'Public URL')} value={selectedUrl} />
                                <div>
                                    <Button size="sm" asChild>
                                        <a href={selectedUrl} target="_blank" rel="noreferrer">
                                            <ExternalLink size={14} />
                                            {t('common.actions.open', 'Open')}
                                        </a>
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="status-detail-metrics">
                            <div className="sk-spec-card">
                                <div className="sk-spec-card__label">{t('app.statusPages.components', 'Components')}</div>
                                <div className="sk-spec-card__value">{components.length}</div>
                            </div>
                            <div className="sk-spec-card">
                                <div className="sk-spec-card__label">{t('app.statusPages.activeIncidents', 'Active incidents')}</div>
                                <div className="sk-spec-card__value">{activeIncidents.length}</div>
                            </div>
                            <div className="sk-spec-card">
                                <div className="sk-spec-card__label">{t('app.statusPages.30DayUptime', '30 day uptime')}</div>
                                <div className="sk-spec-card__value">{formatUptime(
                                    components.length
                                        ? components.reduce((total, component) => total + (component.uptime_30d || 100), 0) / components.length
                                        : 100
                                )}</div>
                            </div>
                        </div>

                        <Tabs defaultValue="components">
                            <TabsList>
                                <TabsTrigger value="components">{t('app.statusPages.components', 'Components')}</TabsTrigger>
                                <TabsTrigger value="incidents">{t('app.statusPages.incidents', 'Incidents')}</TabsTrigger>
                                <TabsTrigger value="settings">{t('app.statusPages.page', 'Page')}</TabsTrigger>
                            </TabsList>

                            <TabsContent value="components">
                                <div className="status-actions-bar">
                                    {isAdmin && (
                                        <>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setShowAttach(true)}
                                                disabled={unattached.length === 0}
                                                title={unattached.length === 0
                                                    ? t('app.statusPages.everyMonitorIsAlreadyOnA', 'Every monitor is already on a page')
                                                    : undefined}
                                            >
                                                <Link2 size={14} />
                                                {t('app.statusPages.addExistingMonitor', 'Add existing monitor')}
                                            </Button>
                                            <Button size="sm" onClick={() => setShowCreateComponent(true)}>
                                                <Plus size={14} />
                                                {t('app.statusPages.newComponent', 'New component')}
                                            </Button>
                                        </>
                                    )}
                                </div>

                                <div className="components-list">
                                    {Object.entries(groupedComponents).map(([groupName, groupComponents]) => (
                                        <div key={groupName} className="component-group">
                                            <h3>{groupName}</h3>
                                            {groupComponents.map((component) => {
                                                const meta = STATUS_META[component.status] || STATUS_META.operational;
                                                return (
                                                    <div key={component.id} className="component-row">
                                                        <div className="component-row__info">
                                                            <span className={`status-dot status-dot--${meta.tone}`} />
                                                            <div>
                                                                <strong>{component.name}</strong>
                                                                <span>{component.check_type.toUpperCase()} · {component.check_target || 'No target'}</span>
                                                            </div>
                                                        </div>
                                                        <div className="component-row__stats">
                                                            <Pill kind={meta.pill}>{meta.label}</Pill>
                                                            <span>{formatUptime(component.uptime_30d)} uptime</span>
                                                            <span>{component.last_response_time ? `${component.last_response_time}ms` : 'No response'}</span>
                                                            <span>{formatDate(component.last_check_at)}</span>
                                                        </div>
                                                        {isAdmin && (
                                                            <div className="component-row__actions">
                                                                <Button size="sm" variant="outline" onClick={() => handleRunCheck(component)}>
                                                                    <PlayCircle size={14} />
                                                                    {t('app.statusPages.check2', 'Check')}
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => handleDetachMonitor(component)}
                                                                    title={t('app.statusPages.removeFromThisPageTheMonitor', 'Remove from this page (the monitor keeps running)')}
                                                                >
                                                                    <Unlink size={14} />
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    onClick={() => setDeleteConfirm({ type: 'component', item: component })}
                                                                    title={t('app.statusPages.deleteTheMonitorAndItsHistory', 'Delete the monitor and its history')}
                                                                >
                                                                    <Trash2 size={14} />
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                    {components.length === 0 && (
                                        <EmptyState icon={Activity} title={t('app.statusPages.noComponentsYet', 'No components yet')} />
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="incidents">
                                <div className="status-actions-bar">
                                    {isAdmin && (
                                        <Button size="sm" onClick={() => setShowCreateIncident(true)}>
                                            <Plus size={14} />
                                            {t('app.statusPages.createIncident', 'Create incident')}
                                        </Button>
                                    )}
                                </div>
                                <div className="incidents-list">
                                    {incidents.map((incident) => (
                                        <article key={incident.id} className={`incident-row incident-row--${incident.status}`}>
                                            <div className="incident-row__header">
                                                <div>
                                                    <strong>{incident.title}</strong>
                                                    <span>{formatDate(incident.created_at)}</span>
                                                </div>
                                                <div className="incident-row__badges">
                                                    <span className={`inc-state inc-state--${incident.status}`}>
                                                        {incident.status}
                                                    </span>
                                                    <span className={`inc-impact inc-impact--${incident.impact}`}>
                                                        {incident.impact}
                                                    </span>
                                                </div>
                                            </div>
                                            {incident.body && <p>{incident.body}</p>}
                                            {incident.updates?.length > 0 && (
                                                <div className="incident-timeline">
                                                    {incident.updates.map((update) => (
                                                        <div key={update.id}>
                                                            <span>{formatDate(update.created_at)}</span>
                                                            <strong>{update.status}</strong>
                                                            <p>{update.body}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {isAdmin && (
                                                <div className="incident-row__actions">
                                                    {incident.status !== 'resolved' && (
                                                        <>
                                                            {INCIDENT_STATUS.filter((status) => status.value !== incident.status).map((status) => (
                                                                <Button
                                                                    key={status.value}
                                                                    size="sm"
                                                                    variant={status.value === 'resolved' ? 'secondary' : 'outline'}
                                                                    onClick={() => handleUpdateIncidentStatus(incident, status.value)}
                                                                >
                                                                    {status.label}
                                                                </Button>
                                                            ))}
                                                        </>
                                                    )}
                                                    <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm({ type: 'incident', item: incident })}>
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </div>
                                            )}
                                        </article>
                                    ))}
                                    {incidents.length === 0 && (
                                        <EmptyState icon={CheckCircle2} title={t('app.statusPages.noIncidents', 'No incidents')} />
                                    )}
                                </div>
                            </TabsContent>

                            <TabsContent value="settings">
                                <div className="status-page-settings">
                                    <div>
                                        <span>{t('app.statusPages.slug', 'Slug')}</span>
                                        <strong>/{selectedPage.slug}</strong>
                                    </div>
                                    <div>
                                        <span>{t('app.statusPages.visibility', 'Visibility')}</span>
                                        <Pill kind={selectedPage.is_public ? 'green' : 'gray'}>
                                            {selectedPage.is_public ? 'Public' : 'Private'}
                                        </Pill>
                                    </div>
                                    <div>
                                        <span>{t('common.labels.created', 'Created')}</span>
                                        <strong>{formatDate(selectedPage.created_at)}</strong>
                                    </div>
                                    {isAdmin && (
                                        <Button variant="destructive" onClick={() => setDeleteConfirm({ type: 'page', item: selectedPage })}>
                                            <Trash2 size={16} />
                                            {t('app.statusPages.deletePage', 'Delete page')}
                                        </Button>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>
                    </section>
                ) : (
                    <section className="status-detail-panel status-detail-panel--empty">
                        <EmptyState icon={Globe2} title={t('app.statusPages.selectAStatusPage', 'Select a status page')} />
                    </section>
                )}
            </div>

            <Modal
                open={showCreatePage}
                onClose={() => setShowCreatePage(false)}
                title={t('app.statusPages.createStatusPage', 'Create status page')}
                size="lg"
                className="status-modal"
                footer={(
                    <>
                        <Button variant="outline" onClick={() => setShowCreatePage(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button onClick={handleCreatePage} disabled={!pageForm.name.trim() || !pageForm.slug.trim()}>
                            {t('common.actions.create', 'Create')}
                        </Button>
                    </>
                )}
            >
                <div className="form-group">
                    <label>{t('common.labels.name', 'Name')}</label>
                    <Input value={pageForm.name} onChange={(e) => handlePageNameChange(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                    <label>{t('app.statusPages.slug', 'Slug')}</label>
                    <Input
                        value={pageForm.slug}
                        onChange={(e) => setPageForm({ ...pageForm, slug: normalizeSlug(e.target.value) })}
                        placeholder="my-services"
                    />
                    <span className="form-help">/status/{pageForm.slug || 'my-services'}</span>
                </div>
                <div className="form-group">
                    <label>{t('common.labels.description', 'Description')}</label>
                    <Textarea
                        value={pageForm.description}
                        onChange={(e) => setPageForm({ ...pageForm, description: e.target.value })}
                        rows={3}
                    />
                </div>
            </Modal>

            <Modal
                open={showAttach}
                onClose={() => setShowAttach(false)}
                title={t('app.statusPages.addAnExistingMonitor', 'Add an existing monitor')}
                size="md"
                className="status-modal"
                footer={<Button variant="outline" onClick={() => setShowAttach(false)}>{t('common.actions.close', 'Close')}</Button>}
            >
                <p className="form-help">
                    {t('app.statusPages.theseMonitorsAreAlreadyRunningAnd', 'These monitors are already running and are not on any status page yet. Adding one publishes it here, and it keeps the history it has already collected.')}
                </p>
                <div className="status-attach-list">
                    {unattached.map((monitor) => (
                        <Button variant="unstyled"
                            key={monitor.id}
                            type="button"
                            className="status-attach-row"
                            onClick={() => handleAttachMonitor(monitor)}
                        >
                            <span className="status-attach-row__body">
                                <strong>{monitor.name}</strong>
                                <span>{monitor.check_type.toUpperCase()} · {monitor.check_target || 'bound site'}</span>
                            </span>
                            <Pill kind={(STATUS_META[monitor.status] || STATUS_META.operational).pill}>
                                {(STATUS_META[monitor.status] || STATUS_META.operational).label}
                            </Pill>
                        </Button>
                    ))}
                    {unattached.length === 0 && (
                        <p className="form-help">{t('app.statusPages.everyMonitorIsAlreadyOnA2', 'Every monitor is already on a page.')}</p>
                    )}
                </div>
            </Modal>

            <Modal
                open={showCreateComponent}
                onClose={() => setShowCreateComponent(false)}
                title={t('app.statusPages.addComponent', 'New component')}
                size="lg"
                className="status-modal"
                footer={(
                    <>
                        <Button variant="outline" onClick={() => setShowCreateComponent(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button onClick={handleCreateComponent} disabled={!compForm.name.trim() || !compForm.check_target.trim()}>
                            {t('app.statusPages.createComponent', 'Create component')}
                        </Button>
                    </>
                )}
            >
                <div className="status-modal-grid">
                    <div className="form-group">
                        <label>{t('common.labels.name', 'Name')}</label>
                        <Input value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} autoFocus />
                    </div>
                    <div className="form-group">
                        <label>{t('app.statusPages.group', 'Group')}</label>
                        <Input value={compForm.group} onChange={(e) => setCompForm({ ...compForm, group: e.target.value })} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="status-comp-check-type">{t('app.statusPages.checkType', 'Check type')}</label>
                        <Select
                            value={compForm.check_type}
                            onValueChange={(v) => setCompForm({ ...compForm, check_type: v })}
                        >
                            <SelectTrigger id="status-comp-check-type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="http">HTTP</SelectItem>
                                <SelectItem value="tcp">TCP</SelectItem>
                                <SelectItem value="dns">DNS</SelectItem>
                                <SelectItem value="ping">{t('app.statusPages.ping', 'Ping')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="form-group">
                        <label>{t('common.labels.target', 'Target')}</label>
                        <Input
                            value={compForm.check_target}
                            onChange={(e) => setCompForm({ ...compForm, check_target: e.target.value })}
                            placeholder={CHECK_TARGET_PLACEHOLDERS[compForm.check_type]}
                        />
                    </div>
                    <div className="form-group">
                        <label>{t('app.statusPages.interval', 'Interval')}</label>
                        <Input
                            type="number"
                            min="30"
                            value={compForm.check_interval}
                            onChange={(e) => setCompForm({ ...compForm, check_interval: parseInt(e.target.value, 10) || 60 })}
                        />
                    </div>
                    <div className="form-group">
                        <label>{t('app.statusPages.timeout', 'Timeout')}</label>
                        <Input
                            type="number"
                            min="1"
                            value={compForm.check_timeout}
                            onChange={(e) => setCompForm({ ...compForm, check_timeout: parseInt(e.target.value, 10) || 10 })}
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                open={showCreateIncident}
                onClose={() => setShowCreateIncident(false)}
                title={t('app.statusPages.createIncident', 'Create incident')}
                size="lg"
                className="status-modal"
                footer={(
                    <>
                        <Button variant="outline" onClick={() => setShowCreateIncident(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button onClick={handleCreateIncident} disabled={!incidentForm.title.trim()}>
                            {t('app.statusPages.createIncident', 'Create incident')}
                        </Button>
                    </>
                )}
            >
                <div className="form-group">
                    <label>{t('common.labels.title', 'Title')}</label>
                    <Input value={incidentForm.title} onChange={(e) => setIncidentForm({ ...incidentForm, title: e.target.value })} autoFocus />
                </div>
                <div className="status-modal-grid">
                    <div className="form-group">
                        <label htmlFor="status-incident-status">{t('common.labels.status', 'Status')}</label>
                        <Select
                            value={incidentForm.status}
                            onValueChange={(v) => setIncidentForm({ ...incidentForm, status: v })}
                        >
                            <SelectTrigger id="status-incident-status"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {INCIDENT_STATUS.filter((status) => status.value !== 'resolved').map((status) => (
                                    <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="status-incident-impact">{t('app.statusPages.impact', 'Impact')}</label>
                        <Select
                            value={incidentForm.impact}
                            onValueChange={(v) => setIncidentForm({ ...incidentForm, impact: v })}
                        >
                            <SelectTrigger id="status-incident-impact"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {IMPACT_OPTIONS.map((impact) => (
                                    <SelectItem key={impact.value} value={impact.value}>{impact.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="form-group">
                    <label>{t('common.labels.description', 'Description')}</label>
                    <Textarea
                        value={incidentForm.body}
                        onChange={(e) => setIncidentForm({ ...incidentForm, body: e.target.value })}
                        rows={4}
                    />
                </div>
            </Modal>

            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                title={t('app.statusPages.delete', 'Delete {{value}}?', { value: deleteConfirm?.type || 'item' })}
                message={t('app.statusPages.thisRemovesTheSelectedRecordAnd', 'This removes the selected record and related status data.')}
                confirmText={t('common.actions.delete', 'Delete')}
                requireConfirmation={deleteConfirm?.item?.name || deleteConfirm?.item?.title}
                onConfirm={handleConfirmDelete}
                onCancel={() => setDeleteConfirm(null)}
            />
        </div>
    );
};

export default StatusPages;
