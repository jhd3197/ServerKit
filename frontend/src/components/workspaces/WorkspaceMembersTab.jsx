import { Plus } from 'lucide-react';
import { ServiceTile, Pill, DataTable, DataTableFooter } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import ErrorState from '../ErrorState';
import { useTranslation } from 'react-i18next';

const NO_RULES = { match: 'all', rules: [] };
const BY_NAME = [{ key: 'name', direction: 'asc' }];

// Built-in saved views. Role is the only axis a membership row has, and it is
// the one that answers "who can change things here".
const WORKSPACE_MEMBER_VIEWS = [
    {
        name: 'All members',
        state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: NO_RULES },
    },
    {
        name: 'Owners',
        state: {
            sorts: BY_NAME,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'wsm1', field: 'role', op: 'any', value: ['owner'] }],
            },
        },
    },
];

// `loadError` / `onRetry`: the page's members request failed, so an empty
// list means "unknown", not "no members".
const WorkspaceMembersTab = ({ members, allUsers, onAddMember, onRemoveMember, loadError, onRetry }) => {
    const { t } = useTranslation();
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-ws-members-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-ws-members-cols' });

    // DataTable columns. Cell markup and classNames are unchanged, so the
    // shared .sk-cell-name / .sk-cell-sub rules keep applying.
    const columns = [
        {
            key: 'name',
            headerKey: 'app.workspaceMembersTab.member', header: 'Member',
            sortable: true,
            hideable: false,
            // There is no `name` key on the row — the cell falls back from
            // username to email, so `value` has to do the same or the filter
            // would match nothing at all.
            type: 'text',
            value: (m) => m.username || m.email || '',
            sortValue: (m) => m.username || m.email || '',
            render: (m) => (
                <div className="sk-cell-name">
                    <ServiceTile name={m.username || m.email || '?'} size={30} className="ws-row__av" />
                    <div>
                        <div>{m.username || m.email}</div>
                        {m.username && m.email && <div className="sk-cell-sub">{m.email}</div>}
                    </div>
                </div>
            ),
        },
        {
            key: 'role',
            headerKey: 'app.workspaceMembersTab.role', header: 'Role',
            sortable: true,
            // Declared, not inferred: a workspace with an owner and one member
            // fails the enum cardinality test and would fall back to text,
            // turning the pick-list into a typed fragment and "Owners" into a
            // no-op.
            type: 'enum',
            value: (m) => m.role || '',
            sortValue: (m) => m.role || '',
            render: (m) => (
                m.role === 'owner'
                    ? <Pill kind="green">{m.role}</Pill>
                    : <span className="sk-tag">{m.role}</span>
            ),
        },
        {
            key: 'actions',
            header: '',
            width: 120,
            sortable: false,
            hideable: false,
            render: (m) => (
                m.role !== 'owner' && (
                    <Button size="sm" variant="destructive" onClick={() => onRemoveMember(m.id)}>{t('common.actions.remove', 'Remove')}</Button>
                )
            ),
        },
    ];

    // One ROUTE renders four of these tabs, so each carries its own view
    // namespace and its own `urlScope` — without the scope they would all write
    // `?view=`/`?sort=` and a link saved on Members would reopen on Servers.
    const chrome = useTableChrome({
        columns,
        rows: members,
        viewPageKey: 'workspace-members',
        builtinViews: WORKSPACE_MEMBER_VIEWS,
        noun: 'members',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        urlScope: 'members',
    });

    const unassigned = allUsers.filter(u => !members.find(m => m.user_id === u.id));

    return (
        <>
            {/* Inline chrome, not hoisted: this is a tab inside a detail page
                that already owns the top bar, so hoisting would hijack it. */}
            <GridViewPicker
                views={chrome.views}
                label="members"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            <DataTable
                columns={chrome.columns}
                data={members}
                keyField="id"
                sorts={sorts}
                onSortsChange={setSorts}
                {...chrome.tableProps}
                className="ws-detail__tablecard"
                emptyState={loadError ? (
                    <ErrorState
                        title={t('app.workspaceMembersTab.couldntLoadMembers', "Couldn't load members.")}
                        error={loadError}
                        onRetry={onRetry}
                    />
                ) : undefined}
                emptyTitle="No members"
                emptyMessage={t('app.workspaceMembersTab.thisWorkspaceHasNoMembersYet', 'This workspace has no members yet.')}
                footer={(
                    <DataTableFooter
                        shown={chrome.shownCount}
                        total={members.length}
                        noun="member"
                    />
                )}
            />

            <GridFilterDrawer {...chrome.drawerProps} />

            {unassigned.length > 0 && (
                <>
                    <div className="ws-pick-label">{t('app.workspaceMembersTab.addAMember', 'Add a member')}</div>
                    <div className="ws-pick">
                        {unassigned.map(u => (
                            <div key={u.id} className="ws-pick__item" onClick={() => onAddMember(u.id)}>
                                <ServiceTile name={u.username || u.email || '?'} size={24} className="ws-row__av" />
                                <span className="ws-pick__name">{u.username || u.email}</span>
                                <Plus size={14} className="ws-pick__plus" />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
};

export default WorkspaceMembersTab;
