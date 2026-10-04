import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useAuth } from '../contexts/useAuth.js';
import PageLoader from '../components/PageLoader';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import { LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DataTable, Pill, CatalogCard, CatalogGrid } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';

// Two surfaces, two treatments — on purpose.
//
// The Library is a catalogue you shop: half a dozen fixed blueprints you read
// the description of and pick one, so it stays a card grid.
//
// Your own templates are an inventory you administer, and the card was a table
// row wearing a box — six labelled scalars and two buttons, no image, no
// hierarchy — while hiding the two fields that decide anything: whether the
// template is allowed to rewrite a server on its own, and when it last changed.
// The questions actually asked here ("which of these am I running?", "which
// one is unassigned?", "which can edit a box without asking?") are sorts and
// filters, so that half is a table with the shared grid chrome.
const CATEGORY_LABELS = {
    general: 'General', web: 'Web Server', database: 'Database', mail: 'Mail Server', custom: 'Custom',
};

const categoryLabel = (tmpl) => CATEGORY_LABELS[tmpl.category] || tmpl.category || 'General';

// Library card facts: a zero count is left out rather than printed.
const countLabel = (n, one, many) => {
    if (!n) return null;
    return n === 1 ? one : many(n);
};

// Auto-remediation is three states, not two booleans, and the difference is
// the whole risk story: Manual never touches a server, "on approval" waits for
// a human, "unattended" rewrites the box by itself. Collapsed into one enum so
// it is a single sortable, filterable column rather than two yes/no ones that
// only mean something read together.
const REMEDIATION_MANUAL = 'Manual';
const REMEDIATION_APPROVAL = 'Auto, on approval';
const REMEDIATION_UNATTENDED = 'Auto, unattended';

const remediationLabel = (tmpl) => {
    if (!tmpl.auto_remediate) return REMEDIATION_MANUAL;
    return tmpl.remediation_approval_required ? REMEDIATION_APPROVAL : REMEDIATION_UNATTENDED;
};

const REMEDIATION_KIND = {
    [REMEDIATION_MANUAL]: 'gray',
    [REMEDIATION_APPROVAL]: 'cyan',
    // Amber rather than green: a template that edits servers without asking is
    // the one setting on this page worth spotting from across the room.
    [REMEDIATION_UNATTENDED]: 'amber',
};

// Compliance used to be three fleet-wide tiles above the table. They said how
// many ASSIGNMENTS had drifted but never which template was responsible, which
// is the only version of the question you can act on — so the same three states
// are now a per-row column, and the tiles' colours moved onto the pill.
const COMPLIANCE_COMPLIANT = 'Compliant';
const COMPLIANCE_DRIFTED = 'Drifted';
const COMPLIANCE_UNKNOWN = 'Unknown';
const COMPLIANCE_NONE = 'Not assigned';

const complianceLabel = (tmpl) => {
    const assigned = tmpl.assignment_count ?? 0;
    if (assigned === 0) return COMPLIANCE_NONE;
    // One drifted server makes the template drifted: a partial pass is not a
    // pass, and the row exists to send you somewhere.
    if ((tmpl.drifted_count ?? 0) > 0) return COMPLIANCE_DRIFTED;
    if ((tmpl.compliant_count ?? 0) === assigned) return COMPLIANCE_COMPLIANT;
    return COMPLIANCE_UNKNOWN;
};

const COMPLIANCE_KIND = {
    [COMPLIANCE_COMPLIANT]: 'green',
    [COMPLIANCE_DRIFTED]: 'red',
    [COMPLIANCE_UNKNOWN]: 'amber',
    [COMPLIANCE_NONE]: 'gray',
};

function formatUpdated(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
}

// Built-in saved views. Every rule matches a column's `value` accessor, so the
// strings below are the LABELS the cells render — never a raw backend field.
// `auto_remediate` is a boolean nobody would recognise in a filter chip.
const NO_RULES = { match: 'all', rules: [] };

const BUILTIN_VIEWS = [
    {
        // "Which templates am I actually running?" The card grid could not
        // answer it: the assignment count was a line of grey text and nothing
        // sorted on it. Widest coverage first.
        name: 'In use',
        state: {
            sorts: [{ key: 'servers', direction: 'desc' }],
            hiddenKeys: ['version'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'st-used', field: 'servers', op: 'gt', value: 0 }],
            },
        },
    },
    {
        // The two views that replace the old KPI tiles. Widest blast radius
        // first — a drifted template on twelve servers outranks one on one.
        name: 'Drifted',
        state: {
            sorts: [{ key: 'servers', direction: 'desc' }],
            hiddenKeys: ['version'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{
                    id: 'st-drift',
                    field: 'compliance',
                    op: 'any',
                    value: [COMPLIANCE_DRIFTED],
                }],
            },
        },
    },
    {
        // Deliberately excludes 'Unknown': a template whose servers were never
        // checked is not passing, it is unmeasured, and folding the two
        // together is how the old progress bar claimed 100%.
        name: 'Compliant',
        state: {
            sorts: [{ key: 'servers', direction: 'desc' }],
            hiddenKeys: ['version'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{
                    id: 'st-ok',
                    field: 'compliance',
                    op: 'any',
                    value: [COMPLIANCE_COMPLIANT],
                }],
            },
        },
    },
    {
        // The other half: written, then never applied. Newest edit first,
        // because a template you touched last week and never assigned is the
        // one you meant to finish.
        name: 'Not assigned yet',
        state: {
            sorts: [{ key: 'updated', direction: 'desc' }],
            hiddenKeys: ['version'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'st-free', field: 'servers', op: 'eq', value: 0 }],
            },
        },
    },
    {
        // The safety review. Both auto states are listed rather than filtering
        // "is none of Manual", so a fourth remediation label added later has to
        // be considered here instead of silently joining this view.
        name: 'Auto-remediating',
        state: {
            sorts: [{ key: 'servers', direction: 'desc' }],
            hiddenKeys: ['version'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{
                    id: 'st-auto',
                    field: 'remediation',
                    op: 'any',
                    value: [REMEDIATION_APPROVAL, REMEDIATION_UNATTENDED],
                }],
            },
        },
    },
    {
        // No rules at all: everything you own, bucketed the way the category
        // badge already implied, with every column showing.
        name: 'By category',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: 'category',
            columnFilters: NO_RULES,
        },
    },
];

const ServerTemplates = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { user } = useAuth();
    const [templates, setTemplates] = useState([]);
    const [library, setLibrary] = useState({});
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [servers, setServers] = useState([]);
    // null until the first load decides; see loadData.
    const [activeTab, setActiveTab] = useState(null);

    // Table sort + column visibility for the Templates tab, persisted and
    // handed to the chrome. `version` starts hidden nowhere — it is small and
    // the card showed it — but every preset bar "By category" drops it, since
    // an auto-incrementing integer says nothing about coverage or risk.
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'servers', direction: 'desc' }],
        storageKey: 'serverkit-table-server-templates-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-server-templates-cols',
    });
    // Not persisted separately: a grouping worth keeping is a saved view now.
    const [groupBy, setGroupBy] = useState(null);

    const [form, setForm] = useState({
        name: '', description: '', category: 'general',
        packages: '', services: [], firewall_rules: [],
        auto_remediate: false, remediation_approval_required: true
    });

    const loadData = useCallback(async () => {
        try {
            const [tData, lData] = await Promise.all([
                api.getServerTemplates(),
                api.getServerTemplateLibrary(),
            ]);
            const mine = tData.templates || [];
            setTemplates(mine);
            setLibrary(lData.templates || {});
            // Pick the opening tab from the data, once. `?? ` so a reload
            // (after creating or deleting one) never yanks the tab out from
            // under whoever is reading it.
            setActiveTab(current => current ?? (mine.length > 0 ? 'templates' : 'library'));
        } catch {
            toast.error(t('app.serverTemplates.failedToLoadTemplates', 'Failed to load templates'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => {
        loadData();
        api.getServers().then(d => setServers(d.servers || [])).catch(() => {});
    }, [loadData]);

    const handleCreate = async () => {
        try {
            const data = {
                ...form,
                packages: form.packages.split('\n').map(p => p.trim()).filter(Boolean),
            };
            await api.createServerTemplate(data);
            toast.success(t('app.serverTemplates.templateCreated', 'Template created'));
            setShowCreateModal(false);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleCreateFromLibrary = async (key) => {
        try {
            await api.createServerTemplateFromLibrary(key);
            toast.success(t('app.serverTemplates.templateCreatedFromLibrary', 'Template created from library'));
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDelete = async (id) => {
        try {
            await api.deleteServerTemplate(id);
            toast.success(t('app.serverTemplates.templateDeleted', 'Template deleted'));
            setDeleteConfirm(null);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleAssign = async (templateId, serverId) => {
        try {
            await api.assignServerTemplate(templateId, serverId);
            toast.success(t('app.serverTemplates.templateAssigned', 'Template assigned'));
            setShowAssignModal(false);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };





    // Publish the admin "Create Template" action to the shared tab-group top bar.
    useTopbarActions(() =>
        user?.is_admin ? (
            <Button size="sm" onClick={() => setShowCreateModal(true)}>{t('app.serverTemplates.createTemplate', 'Create Template')}</Button>
        ) : null,
        [user?.is_admin]
    );

    // Two accessors per column where they differ: `value` is what the column
    // menu, the filter rules, the grouping and the export read, `sortValue` is
    // what DataTable's sorter reads. Every filterable column declares an
    // explicit `type` too — a `sortValue` returning epoch milliseconds would
    // otherwise type "Updated" as a number and offer "is under 1754…" instead
    // of a date, making every date rule match nothing.
    const columns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'app.serverTemplates.template', header: 'Template',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (tmpl) => tmpl.name || '',
            render: (tmpl) => {
                // The description and the inherited parent share the sub-line
                // the way the card stacked them — both are context for the
                // name, and neither is worth a column of its own (nothing in
                // this UI can set a parent, so that column would be empty).
                const sub = [
                    tmpl.description,
                    tmpl.parent_name ? `inherits ${tmpl.parent_name}` : null,
                ].filter(Boolean).join(' · ');
                return (
                    <div className="sk-cell-name">
                        <span>
                            <div>{tmpl.name}</div>
                            {sub && <div className="sk-cell-sub">{sub}</div>}
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'category',
            headerKey: 'app.serverTemplates.category', header: 'Category',
            sortable: true,
            type: 'enum',
            groupable: true,
            // Filter, group and sort on the LABEL the badge shows, so a preset
            // reads the way the row does ('Web Server', not 'web'). `groupValue`
            // is spelled out because DataTable's grouping otherwise falls back
            // to row[key] — and the raw row key holds the backend enum.
            value: categoryLabel,
            groupValue: categoryLabel,
            sortValue: categoryLabel,
            // Badge, not Pill: a category is a neutral label, not a status, so
            // it gets no tone.
            render: (tmpl) => <Badge variant="outline">{categoryLabel(tmpl)}</Badge>,
        },
        {
            key: 'servers',
            headerKey: 'common.labels.servers', header: 'Servers',
            sortable: true,
            type: 'num',
            // A template with no assignments reads 0 rather than a dash, so the
            // "Not assigned yet" preset's `eq 0` has something honest to match.
            value: (tmpl) => tmpl.assignment_count ?? 0,
            sortValue: (tmpl) => tmpl.assignment_count ?? 0,
            // `value` only feeds sorting and the filter rules. Without a
            // `render` DataTable falls back to row['servers'], which is not a
            // key on the payload — the cell rendered blank.
            render: (tmpl) => tmpl.assignment_count ?? 0,
        },
        {
            key: 'compliance',
            headerKey: 'app.serverTemplates.compliance', header: 'Compliance',
            sortable: true,
            type: 'enum',
            groupable: true,
            value: complianceLabel,
            groupValue: complianceLabel,
            sortValue: complianceLabel,
            render: (tmpl) => {
                const label = complianceLabel(tmpl);
                return <Pill kind={COMPLIANCE_KIND[label] || 'gray'} dot={false}>{label}</Pill>;
            },
        },
        {
            key: 'remediation',
            headerKey: 'app.serverTemplates.remediation', header: 'Remediation',
            sortable: true,
            type: 'enum',
            groupable: true,
            value: remediationLabel,
            groupValue: remediationLabel,
            sortValue: remediationLabel,
            render: (tmpl) => {
                const label = remediationLabel(tmpl);
                return <Pill kind={REMEDIATION_KIND[label] || 'gray'} dot={false}>{label}</Pill>;
            },
        },
        {
            key: 'version',
            headerKey: 'common.labels.version', header: 'Version',
            sortable: true,
            type: 'num',
            value: (tmpl) => tmpl.version ?? 1,
            sortValue: (tmpl) => tmpl.version ?? 1,
            cellClassName: 'sk-cell-mono',
            render: (tmpl) => `v${tmpl.version ?? 1}`,
        },
        // The three spec counts the card showed as chips. Separate columns
        // because they are separate questions — "declares no firewall rules"
        // is a real gap, and inside one merged cell it could not be sorted.
        {
            key: 'packages',
            headerKey: 'app.serverTemplates.packages', header: 'Packages',
            sortable: true,
            type: 'num',
            value: (tmpl) => tmpl.packages?.length ?? 0,
            sortValue: (tmpl) => tmpl.packages?.length ?? 0,
            render: (tmpl) => tmpl.packages?.length ?? 0,
        },
        {
            key: 'services',
            headerKey: 'common.labels.services', header: 'Services',
            sortable: true,
            type: 'num',
            value: (tmpl) => tmpl.services?.length ?? 0,
            sortValue: (tmpl) => tmpl.services?.length ?? 0,
            // Without this the fallback printed row['services'] — a list of
            // {name, enabled, running} OBJECTS, which React refuses to render
            // ("Objects are not valid as a React child"), taking the whole tab
            // down for any template that declares a service.
            render: (tmpl) => tmpl.services?.length ?? 0,
        },
        {
            key: 'firewall',
            headerKey: 'app.serverTemplates.firewall', header: 'Firewall',
            sortable: true,
            type: 'num',
            value: (tmpl) => tmpl.firewall_rules?.length ?? 0,
            sortValue: (tmpl) => tmpl.firewall_rules?.length ?? 0,
            render: (tmpl) => tmpl.firewall_rules?.length ?? 0,
        },
        {
            key: 'updated',
            headerKey: 'app.serverTemplates.updated', header: 'Updated',
            sortable: true,
            type: 'date',
            value: (tmpl) => tmpl.updated_at || null,
            sortValue: (tmpl) => {
                const time = Date.parse(tmpl.updated_at);
                return Number.isNaN(time) ? null : time;
            },
            cellClassName: 'sk-cell-mono',
            render: (tmpl) => formatUpdated(tmpl.updated_at),
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            render: (tmpl) => (
                <div className="server-template-error-actions">
                    <Button
                        size="sm"
                        onClick={() => { setSelectedTemplate(tmpl); setShowAssignModal(true); }}
                    >
                        {t('app.serverTemplates.assign', 'Assign')}
                    </Button>
                    {user?.is_admin && (
                        <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(tmpl)}>
                            {t('common.actions.delete', 'Delete')}
                        </Button>
                    )}
                </div>
            ),
        },
    ], [t, user?.is_admin]);

    // No `pageState`: the list is this endpoint's whole response, with no
    // search and no server-side filter of its own, so there is nothing
    // page-private for a view to carry. The Library/Templates tab is
    // deliberately NOT in it either — that is navigation, and a saved view
    // should not be able to move you to a different tab.
    const chrome = useTableChrome({
        columns,
        rows: templates,
        viewPageKey: 'server-templates',
        builtinViews: BUILTIN_VIEWS,
        noun: 'templates',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
    });

    // Filter + "⋮" ride the group's top bar, so the view row is the view name
    // alone. Gated on the tab that owns the table: the Library is a card
    // catalogue these do not act on, and the drawer the filter button opens is
    // rendered inside the Templates tab, so hoisting it unconditionally would
    // leave a button whose panel does not exist.
    const gridIsOnScreen = activeTab === 'templates' && templates.length > 0;
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={loadData} />
        </>, { enabled: gridIsOnScreen },
    );

    if (loading) return <PageLoader />;

    return (
        <div className="sk-tabgroup__inner server-templates-page">
            {topbarChrome}
            {/* Library leads, because on a fresh panel Templates has nothing in
                it — landing there showed an empty page as the first impression.
                The default follows the data rather than being fixed: once you
                have templates of your own, those are what you came for. */}
            <Tabs value={activeTab || 'library'} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="library">{t('app.serverTemplates.library', 'Library')}</TabsTrigger>
                    <TabsTrigger value="templates">
                        {t('app.serverTemplates.templates', 'Templates')}{templates.length > 0 ? ` (${templates.length})` : ''}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="templates">
                    {templates.length === 0 ? (
                        <EmptyState
                            icon={LayoutTemplate}
                            title={t('app.serverTemplates.noTemplatesYet', 'No templates yet')}
                            description={t('app.serverTemplates.startFromAReadyMadeLibrary', 'Start from a ready-made library template, or create one from scratch.')}
                            action={(
                                <Button size="sm" onClick={() => setActiveTab('library')}>
                                    {t('app.serverTemplates.browseTheLibrary', 'Browse the library')}
                                </Button>
                            )}
                        />
                    ) : (
                        <>
                            <GridViewPicker
                                views={chrome.views}
                                label="templates"
                                onCreate={chrome.createView}

                actions={chromeActions}
            />

                            <GridChips {...chrome.chipProps} />

                            <DataTable
                                {...chrome.tableProps}
                                columns={chrome.columns}
                                data={templates}
                                keyField="id"
                                sorts={sorts}
                                onSortsChange={setSorts}
                                groupBy={groupBy}
                                onGroupByChange={setGroupBy}
                            />

                            <GridFilterDrawer {...chrome.drawerProps} />
                        </>
                    )}
                </TabsContent>

                <TabsContent value="library">
                    <CatalogGrid className="server-templates-library">
                        {Object.entries(library).map(([key, tmpl]) => (
                            <CatalogCard
                                key={key}
                                icon={<LayoutTemplate size={18} />}
                                title={tmpl.name}
                                tag={categoryLabel(tmpl)}
                                description={tmpl.description}
                                facts={[
                                    countLabel(tmpl.packages?.length,
                                        t('app.serverTemplates.onePackage', '1 package'),
                                        (n) => t('app.serverTemplates.nPackages', '{{n}} packages', { n })),
                                    countLabel(tmpl.services?.length,
                                        t('app.serverTemplates.oneService', '1 service'),
                                        (n) => t('app.serverTemplates.nServices', '{{n}} services', { n })),
                                    countLabel(tmpl.firewall_rules?.length,
                                        t('app.serverTemplates.oneFirewallRule', '1 firewall rule'),
                                        (n) => `${n} ${t('app.serverTemplates.firewallRules', 'firewall rules')}`),
                                ].filter(Boolean).join(' · ')}
                                action={(
                                    <Button variant="outline" size="sm" onClick={() => handleCreateFromLibrary(key)}>
                                        {t('app.serverTemplates.useTemplate', 'Use Template')}
                                    </Button>
                                )}
                            />
                        ))}
                    </CatalogGrid>
                </TabsContent>
            </Tabs>

            {/* Create Modal */}
            <Modal
                open={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                title={t('app.serverTemplates.createTemplate', 'Create Template')}
                footer={(
                    <>
                        <Button variant="outline" onClick={() => setShowCreateModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button onClick={handleCreate} disabled={!form.name}>{t('common.actions.create', 'Create')}</Button>
                    </>
                )}
            >
                <div className="form-group">
                    <label>{t('common.labels.name', 'Name')}</label>
                    <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                </div>
                <div className="form-group">
                    <label>{t('common.labels.description', 'Description')}</label>
                    <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} />
                </div>
                <div className="form-group">
                    <label htmlFor="server-template-category">{t('app.serverTemplates.category', 'Category')}</label>
                    <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
                        <SelectTrigger id="server-template-category"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="form-group">
                    <label>{t('app.serverTemplates.packagesOnePerLine', 'Packages (one per line)')}</label>
                    <Textarea className="form-input--mono" value={form.packages} onChange={e => setForm({...form, packages: e.target.value})} rows={4} placeholder={t('app.serverTemplates.nginxPhpFpmCertbot', 'nginx\nphp-fpm\ncertbot')} />
                </div>
                <div className="form-group">
                    <label className="checkbox-label">
                        <input type="checkbox" checked={form.auto_remediate} onChange={e => setForm({...form, auto_remediate: e.target.checked})} />
                        {t('app.serverTemplates.autoRemediateDrift', 'Auto-remediate drift')}
                    </label>
                </div>
            </Modal>

            {/* Assign Modal */}
            <Modal
                open={Boolean(showAssignModal && selectedTemplate)}
                onClose={() => setShowAssignModal(false)}
                title={selectedTemplate ? t('app.serverTemplates.assign2', 'Assign {{name}}', { name: selectedTemplate.name }) : t('app.serverTemplates.assignTemplate', 'Assign template')}
            >
                {selectedTemplate && (
                    <>
                        <p>{t('app.serverTemplates.selectAServerToApplyThis', 'Select a server to apply this template:')}</p>
                        <div className="server-select-list">
                            {servers.map(server => (
                                <div key={server.id} className="server-select-item" onClick={() => handleAssign(selectedTemplate.id, server.id)}>
                                    <span className={`status-dot status-dot--${server.status === 'online' ? 'success' : 'danger'}`} />
                                    <span>{server.name}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Modal>

            {deleteConfirm && (
                <ConfirmDialog
                    title={t('app.serverTemplates.deleteTemplate', 'Delete Template')}
                    message={t('app.serverTemplates.deleteThisCannotBeUndone', 'Delete "{{name}}"? This cannot be undone.', { name: deleteConfirm.name })}
                    onConfirm={() => handleDelete(deleteConfirm.id)}
                    onCancel={() => setDeleteConfirm(null)}
                    variant="danger"
                />
            )}
        </div>
    );
};

export default ServerTemplates;
