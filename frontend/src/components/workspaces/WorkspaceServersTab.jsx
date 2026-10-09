import { useNavigate } from 'react-router-dom';
import { Server, Plus } from 'lucide-react';
import { ServiceTile, Pill, DataTable, DataTableFooter } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { statusKind } from '@/components/ds/status';
import { useTranslation } from 'react-i18next';


// What the Status cell shows when the row carries none. A real word, not '':
// `ruleIsArmed` drops any rule whose value is empty, so a rule on '' would
// silently filter nothing.
const UNKNOWN = 'unknown';

// Built-in saved views. The membership question ("is it in this workspace")
// is already answered by the tab itself, so reachability is the axis left.
const NO_RULES = { match: 'all', rules: [] };
const BY_NAME = [{ key: 'name', direction: 'asc' }];

const WORKSPACE_SERVER_VIEWS = [
    {
        name: 'All servers',
        state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: NO_RULES },
    },
    {
        // Stated as "not online" rather than as a list of bad statuses, so a
        // status we have never seen still shows up here.
        name: 'Needs attention',
        state: {
            sorts: BY_NAME,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'wss1', field: 'status', op: 'none', value: ['online'] }],
            },
        },
    },
];

// `loadError` / `onRetry`: the page's servers request failed, so an empty
// list means "unknown", not "no servers".
const WorkspaceServersTab = ({ wsId, srvIn, srvOut, onMoveServer, loadError, onRetry }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-ws-servers-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-ws-servers-cols' });

    // DataTable columns. Cell markup and classNames are unchanged, so the
    // shared .sk-cell-name / .sk-cell-sub rules keep applying.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.server', header: 'Server',
            sortable: true,
            hideable: false,
            // Hostnames are near-unique per row — you type a fragment.
            type: 'text',
            value: (s) => s.name || '',
            sortValue: (s) => s.name || '',
            render: (s) => (
                <div className="sk-cell-name">
                    <ServiceTile name={s.name} size={30} />
                    <div>
                        <div>{s.name}</div>
                        <div className="sk-cell-sub">{s.ip_address || s.hostname || ''}</div>
                    </div>
                </div>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared, not inferred: a workspace holding two servers of two
            // statuses fails the enum cardinality test and would fall back to
            // text, turning the pick-list into a typed fragment and the view
            // above into a no-op. `value` is the word the Pill shows.
            type: 'enum',
            enumOrder: ['online', 'pending', 'offline', UNKNOWN],
            value: (s) => s.status || UNKNOWN,
            sortValue: (s) => s.status || UNKNOWN,
            render: (s) => <Pill kind={statusKind(s.status)}>{s.status || UNKNOWN}</Pill>,
        },
        {
            key: 'actions',
            header: '',
            width: 160,
            sortable: false,
            hideable: false,
            render: (s) => (
                <div className="ws-detail__rowactions" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="destructive" onClick={() => onMoveServer(s.id, null)}>{t('common.actions.remove', 'Remove')}</Button>
                </div>
            ),
        },
    ];

    // One ROUTE renders four of these tabs, so each carries its own view
    // namespace and its own `urlScope` — without the scope they would all write
    // `?view=`/`?sort=` and a link saved on Servers would reopen on Members.
    const chrome = useTableChrome({
        columns,
        rows: srvIn,
        viewPageKey: 'workspace-servers',
        builtinViews: WORKSPACE_SERVER_VIEWS,
        noun: 'servers',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        urlScope: 'servers',
    });

    return (
        <>
            {/* Inline chrome, not hoisted: this is a tab inside a detail page
                that already owns the top bar, so hoisting would hijack it. */}
            <GridViewPicker
                views={chrome.views}
                label="servers"
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
                data={srvIn}
                keyField="id"
                sorts={sorts}
                onSortsChange={setSorts}
                {...chrome.tableProps}
                onRowClick={(s) => navigate(`/servers/${s.id}`)}
                emptyState={loadError ? (
                    <ErrorState
                        title={t('app.workspaceServersTab.couldntLoadServers', "Couldn't load servers.")}
                        error={loadError}
                        onRetry={onRetry}
                    />
                ) : (
                    <EmptyState icon={Server} title={t('app.workspaceServersTab.noServersInThisWorkspaceYet', 'No servers in this workspace yet')} description={t('app.workspaceServersTab.moveOneInBelow', 'Move one in below.')} />
                )}
                footer={(
                    <DataTableFooter
                        // DataTable applies the column rules itself, so the
                        // shown count comes from the chrome — `srvIn` is only
                        // ever the whole membership.
                        shown={chrome.shownCount}
                        total={srvIn.length}
                        noun="server"
                    />
                )}
            />

            <GridFilterDrawer {...chrome.drawerProps} />

            {srvOut.length > 0 && (
                <>
                    <div className="ws-pick-label">{t('app.workspaceServersTab.moveAServerIntoThisWorkspace', 'Move a server into this workspace')}</div>
                    <div className="ws-pick">
                        {srvOut.map(s => (
                            <div key={s.id} className="ws-pick__item" onClick={() => onMoveServer(s.id, wsId)}>
                                <ServiceTile name={s.name} size={28} className="ws-pick__tile" />
                                <span className="ws-pick__name">{s.name}</span>
                                {s.ip_address && <span className="sk-tag mono">{s.ip_address}</span>}
                                <Plus size={16} className="ws-pick__plus" />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
};

export default WorkspaceServersTab;
