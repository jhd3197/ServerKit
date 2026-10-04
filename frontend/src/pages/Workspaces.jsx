import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import Modal from '@/components/Modal';
import ResourceListPage from '../components/layouts/ResourceListPage';
import { LayoutGrid, Plus, ChevronRight } from 'lucide-react';
import { Pill, ServiceTile, SearchField } from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import useFocusParam from '@/hooks/useFocusParam';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '../contexts/useWorkspace.js';
import { useAuth } from '../contexts/useAuth.js';
import { useServerMutation, useServerQuery } from '../hooks/useServerQuery';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Preset views. `servers` and `users` are quota CEILINGS, not usage, so there
// is no column to express "near capacity" against.
//
// `status` values are the RAW ws.status the column's `value` accessor returns.
// The old "Inactive" segment meant `!== 'active'`, not literally 'inactive', so
// it translates to `is none of [active]` rather than `is any of [inactive]` —
// otherwise workspaces in any other state would silently drop out of the view.
// There is no separate status segment any more: the Status column's own menu is
// the one place workspaces are narrowed by state.
const NOT_ACTIVE = { id: 'st', field: 'status', op: 'none', value: ['active'] };
const NO_RULES = { match: 'all', rules: [] };

const WORKSPACE_VIEWS = [
    {
        name: 'Active',
        state: {
            search: '', sorts: [], hiddenKeys: [],
            columnFilters: { match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value: ['active'] }] },
        },
    },
    {
        name: 'Inactive',
        state: { search: '', sorts: [], hiddenKeys: [], columnFilters: { match: 'all', rules: [NOT_ACTIVE] } },
    },
    {
        name: 'Most members',
        state: {
            search: '', hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'members', direction: 'desc' }],
        },
    },
    {
        // Created and then never staffed — candidates to archive.
        name: 'Empty workspaces',
        state: {
            search: '', hiddenKeys: ['servers', 'users'], groupBy: null,
            sorts: [{ key: 'name', direction: 'asc' }],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ew1', field: 'members', op: 'eq', value: 0 }],
            },
        },
    },
    {
        // Deactivated but people are still attached — access that outlived the workspace.
        name: 'Archived but still staffed',
        state: {
            search: '', hiddenKeys: ['servers', 'users'], groupBy: null,
            sorts: [{ key: 'members', direction: 'desc' }],
            columnFilters: {
                match: 'all',
                rules: [NOT_ACTIVE, { id: 'as1', field: 'members', op: 'gt', value: 0 }],
            },
        },
    },
];

// "since Jun 2026" card meta from the workspace's real created_at.
const formatSince = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const Workspaces = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { activeWorkspaceId } = useWorkspace();
    // Workspace creation is admin-only server-side (@admin_required); hide the
    // entry points for everyone else instead of letting them hit a 403.
    const { isAdmin } = useAuth();
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showCreateModal, setShowCreateModal] = useState(false);
    // Quick-create deep link: /workspaces?focus=create:workspace opens the modal.
    useFocusParam('create', () => { if (isAdmin) setShowCreateModal(true); });
    const [form, setForm] = useState({ name: '', description: '', max_servers: 0, max_users: 0, primary_color: '#6d7cff' });

    const loadWorkspaces = useCallback(
        ({ signal }) => api.getWorkspaces({}, { signal }).then((data) => data.workspaces || []),
        [],
    );
    const {
        data: workspaces = [],
        isLoading: loading,
        error: loadError,
        refetch: refetchWorkspaces,
    } = useServerQuery(['workspaces'], loadWorkspaces, {
        staleTime: 30_000,
    });
    const createWorkspace = useServerMutation(
        (values) => api.createWorkspace(values),
        { invalidate: [['workspaces']] },
    );

    useTopbarActions(() => (
        <>
            {isAdmin && (
                <Button size="sm" onClick={() => setShowCreateModal(true)}>
                    <Plus size={16} />
                    {t('app.workspaces.newWorkspace', 'New workspace')}
                </Button>
            )}
            <SearchField
                value={search}
                onSearch={setSearch}
                placeholder={t('app.workspaces.searchWorkspaces', 'Search workspaces…')}
            />
        </>
    ), [search, isAdmin]);

    const handleCreate = async () => {
        try {
            await createWorkspace.mutate(form);
            toast.success(t('app.workspaces.workspaceCreated', 'Workspace created'));
            setShowCreateModal(false);
            setForm({ name: '', description: '', max_servers: 0, max_users: 0, primary_color: '#6d7cff' });
        } catch (err) {
            toastError(toast, t('app.workspaces.couldntCreate', "Couldn't create the workspace."), err);
        }
    };

    const q = search.trim().toLowerCase();
    const shownWorkspaces = workspaces.filter(ws => (
        q === '' || [ws.name, ws.slug, ws.description]
            .some(v => v && String(v).toLowerCase().includes(q))
    ));

    const toggleOne = (id, checked) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
    };

    // DataTable columns. Interactive cells stop click propagation so they don't
    // trigger the row's navigate.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.workspace', header: 'Workspace',
            sortable: true,
            hideable: false,
            render: (ws) => {
                const since = formatSince(ws.created_at);
                return (
                    <div className="sk-cell-name">
                        <ServiceTile
                            name={ws.name}
                            size={30}
                            gradient={ws.primary_color || undefined}
                            className="wp-list__tile"
                            aria-hidden="true"
                        />
                        <span>
                            <div>{ws.name}</div>
                            {ws.description && <div className="sk-cell-sub">{ws.description}</div>}
                            {since && !ws.description && <div className="sk-cell-sub">since {since}</div>}
                        </span>
                    </div>
                );
            },
        },
        { key: 'slug', headerKey: 'app.workspaces.slug', header: 'Slug', sortable: true, cellClassName: 'sk-cell-mono', render: (ws) => `/${ws.slug}` },
        // Numeric sorts: unlimited (0/unset) sorts last.
        { key: 'members', headerKey: 'app.workspaces.members', header: 'Members', sortable: true, sortValue: (ws) => ws.member_count ?? null, cellClassName: 'sk-cell-dim', render: (ws) => ws.member_count ?? 0 },
        { key: 'servers', headerKey: 'common.labels.servers', header: 'Servers', sortable: true, sortValue: (ws) => (ws.max_servers > 0 ? ws.max_servers : null), cellClassName: 'sk-cell-dim', render: (ws) => (ws.max_servers > 0 ? ws.max_servers : '—') },
        { key: 'users', headerKey: 'app.workspaces.users', header: 'Users', sortable: true, sortValue: (ws) => (ws.max_users > 0 ? ws.max_users : null), cellClassName: 'sk-cell-dim', render: (ws) => (ws.max_users > 0 ? ws.max_users : '—') },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            // `value` is the FILTER value, `sortValue` is the ORDERING key, and
            // here they are different things — so the column has to say so.
            // Without an explicit `value` the rule engine falls back to
            // sortValue, sees 0/1, types the column `num`, and offers "is under
            // / is over" instead of a pick-list; a `status is any of [active]`
            // rule would then match nothing at all.
            value: (ws) => ws.status || 'unknown',
            // Matches the pill: the active workspace (and active status) first.
            sortValue: (ws) => (activeWorkspaceId === String(ws.id) || ws.status === 'active' ? 0 : 1),
            groupable: true,
            groupValue: (ws) => ws.status,
            groupLabel: (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None'),
            render: (ws) => (
                activeWorkspaceId === String(ws.id)
                    ? <Pill kind="green">active</Pill>
                    : <Pill kind={ws.status === 'active' ? 'green' : 'amber'}>{ws.status || 'unknown'}</Pill>
            ),
        },
        {
            key: '__chev',
            header: '',
            sortable: false,
            hideable: false,
            className: 'wp-list__action',
            render: () => <ChevronRight size={16} className="wp-list__chev" />,
        },
    ];

    return (
        <ResourceListPage
            className="workspaces-page"
            loading={loading}
            loadingTitle="Loading workspaces"
            storageKey="serverkit-list-workspaces"
            viewPageKey="workspaces"
            noun="workspaces"
            builtinViews={WORKSPACE_VIEWS}
            totalCount={workspaces.length}
            error={loadError}
            errorTitle={t('app.workspaces.couldntLoadWorkspaces', "Couldn't load workspaces")}
            onRetry={() => refetchWorkspaces().catch(() => {})}
            items={shownWorkspaces}
            columns={columns}
            keyField="id"
            onRowClick={(ws) => navigate(`/workspaces/${ws.id}`)}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={toggleOne}
            onSelectAll={(checked) => setSelectedIds(checked ? new Set(shownWorkspaces.map(ws => ws.id)) : new Set())}
            searchTerm={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search workspaces…"
            searchInTopbar
            selectedCount={selectedIds.size}
            onClearSelection={() => setSelectedIds(new Set())}
            emptyIcon={LayoutGrid}
            emptyTitle="No workspaces yet"
            emptyDescription={isAdmin
                ? 'Create one to isolate servers by team or project.'
                : 'Workspaces isolate servers by team or project. Ask an admin to create one.'}
            emptyAction={isAdmin ? (
                <Button onClick={() => setShowCreateModal(true)}>
                    {t('app.workspaces.newWorkspace', 'New workspace')}
                </Button>
            ) : null}
            filteredEmptyIcon={LayoutGrid}
            filteredEmptyTitle="No workspaces found"
            filteredEmptyDescription="Try adjusting your search or filter."
        >

            <Modal
                open={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                title={t('app.workspaces.createWorkspace', 'New workspace')}
                footer={(
                    <>
                        <Button variant="outline" onClick={() => setShowCreateModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button
                            onClick={handleCreate}
                            disabled={!form.name || createWorkspace.isPending}
                        >
                            {createWorkspace.isPending ? 'Creating…' : 'Create'}
                        </Button>
                    </>
                )}
            >
                <div className="form-group">
                    <label>{t('common.labels.name', 'Name')}</label>
                    <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t('app.workspaces.myTeam', 'My team')} />
                </div>
                <div className="form-group">
                    <label>{t('common.labels.description', 'Description')}</label>
                    <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={2} />
                </div>
                <div className="form-row">
                    <div className="form-group">
                        <label>{t('app.workspaces.maxServers0Unlimited', 'Max servers (0 = unlimited)')}</label>
                        <Input type="number" value={form.max_servers} onChange={e => setForm({...form, max_servers: parseInt(e.target.value) || 0})} />
                    </div>
                    <div className="form-group">
                        <label>{t('app.workspaces.maxUsers0Unlimited', 'Max users (0 = unlimited)')}</label>
                        <Input type="number" value={form.max_users} onChange={e => setForm({...form, max_users: parseInt(e.target.value) || 0})} />
                    </div>
                </div>
                <div className="form-group">
                    <label>{t('app.workspaces.brandColor', 'Brand color')}</label>
                    <input
                        type="color"
                        className="workspace-color-input"
                        value={form.primary_color}
                        onChange={e => setForm({...form, primary_color: e.target.value})}
                        aria-label={t('app.workspaces.workspaceBrandColor', 'Workspace brand color')}
                    />
                    <span className="form-hint">{t('app.workspaces.recolorsThePanelForAnyoneViewing', 'Recolors the panel for anyone viewing this workspace. Leave the default for no custom branding.')}</span>
                </div>
            </Modal>
        </ResourceListPage>
    );
};

export default Workspaces;
