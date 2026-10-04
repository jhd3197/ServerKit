import { useNavigate } from 'react-router-dom';
import { Box, Globe, Plus } from 'lucide-react';
import { ServiceTile, Pill, DataTable, DataTableFooter, serviceStatusKind } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { useTranslation } from 'react-i18next';

// What the Status cell shows when the row carries none. A real word, not '':
// `ruleIsArmed` drops any rule whose value is empty.
const UNKNOWN = 'unknown';

const NO_RULES = { match: 'all', rules: [] };
const BY_NAME = [{ key: 'name', direction: 'asc' }];

const CONFIG = {
    services: { noun: 'service', icon: Box, ruleId: 'wsv1', allView: 'All services' },
    sites: { noun: 'site', icon: Globe, ruleId: 'wsi1', allView: 'All sites' },
};
const BUILTIN_VIEWS = Object.fromEntries(Object.entries(CONFIG).map(([kind, config]) => [kind, [
    { name: config.allView, state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: NO_RULES } },
    {
        name: 'Not running',
        state: {
            sorts: BY_NAME, hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: config.ruleId, field: 'status', op: 'none', value: ['running'] }],
            },
        },
    },
]]));

// `loadError` / `onRetry`: the page's apps request failed, so an empty list
// means "unknown", not "nothing here".
const WorkspaceApplicationsTab = ({ kind, wsId, rows, appsOut, onMoveApp, onShare, loadError, onRetry }) => {
    const { t } = useTranslation();
    const config = CONFIG[kind];
    const labels = kind === 'sites' ? {
        header: t('app.workspaceSitesTab.site', 'Site'),
        empty: t('app.workspaceSitesTab.noSitesInThisWorkspaceYet', 'No sites in this workspace yet'),
        moveBelow: t('app.workspaceSitesTab.moveOneInBelow', 'Move one in below.'),
        move: t('app.workspaceSitesTab.moveASiteIntoThisWorkspace', 'Move a site into this workspace'),
    } : {
        header: t('common.labels.service', 'Service'),
        empty: t('app.workspaceServicesTab.noServicesInThisWorkspaceYet', 'No services in this workspace yet'),
        moveBelow: t('app.workspaceServicesTab.moveOneInBelow', 'Move one in below.'),
        move: t('app.workspaceServicesTab.moveAnApplicationIntoThisWorkspace', 'Move an application into this workspace'),
    };
    const navigate = useNavigate();
    const { sorts, setSorts } = useTableSort({ storageKey: `serverkit-table-ws-${kind}-sort` });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({ storageKey: `serverkit-table-ws-${kind}-cols` });

    // DataTable columns. Cell markup and classNames are unchanged, so the
    // shared .sk-cell-name / .sk-cell-sub rules keep applying.
    const columns = [
        {
            key: 'name',
            header: labels.header,
            sortable: true,
            hideable: false,
            type: 'text',
            value: (a) => a.name || '',
            sortValue: (a) => a.name || '',
            render: (a) => (
                <div className="sk-cell-name">
                    <ServiceTile name={a.name} size={30} />
                    <div>
                        <div>{a.name}</div>
                        <div className="sk-cell-sub">{a.app_type}{a.domain ? ` · ${a.domain}` : ''}</div>
                    </div>
                </div>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared, not inferred: a workspace holding two services of two
            // statuses fails the enum cardinality test and would fall back to
            // text, turning the pick-list into a typed fragment and the view
            // above into a no-op. No `enumOrder` — the options come from the
            // data, which is the only source that agrees with itself here.
            type: 'enum',
            value: (a) => a.status || UNKNOWN,
            sortValue: (a) => a.status || UNKNOWN,
            render: (a) => <Pill kind={serviceStatusKind(a.status)}>{a.status || UNKNOWN}</Pill>,
        },
        {
            key: 'actions',
            header: '',
            width: 220,
            sortable: false,
            hideable: false,
            render: (a) => (
                <div className="ws-detail__rowactions" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => onShare(a)}>{t('app.workspaceServicesTab.share', 'Share')}</Button>
                    <Button size="sm" variant="destructive" onClick={() => onMoveApp(a.id, null)}>{t('common.actions.remove', 'Remove')}</Button>
                </div>
            ),
        },
    ];

    // One ROUTE renders four of these tabs, so each carries its own view
    // namespace and its own `urlScope` — without the scope they would all write
    // `?view=`/`?sort=` and a link saved on Services would reopen on Sites.
    const chrome = useTableChrome({
        columns,
        rows,
        viewPageKey: `workspace-${kind}`,
        builtinViews: BUILTIN_VIEWS[kind],
        noun: kind,
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        urlScope: kind,
    });

    return (
        <>
            {/* Inline chrome, not hoisted: this is a tab inside a detail page
                that already owns the top bar, so hoisting would hijack it. */}
            <GridViewPicker
                views={chrome.views}
                label={kind}
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
                data={rows}
                keyField="id"
                sorts={sorts}
                onSortsChange={setSorts}
                {...chrome.tableProps}
                onRowClick={(a) => navigate(`/services/${a.id}`)}
                className="ws-detail__tablecard"
                emptyState={loadError ? (
                    <ErrorState
                        title={kind === 'sites'
                            ? t('app.workspaceApplicationsTab.couldntLoadSites', "Couldn't load sites")
                            : t('app.workspaceApplicationsTab.couldntLoadServices', "Couldn't load services")}
                        error={loadError}
                        onRetry={onRetry}
                    />
                ) : (
                    <EmptyState icon={config.icon} title={labels.empty} description={labels.moveBelow} />
                )}
                footer={(
                    <DataTableFooter
                        shown={chrome.shownCount}
                        total={rows.length}
                        noun={config.noun}
                    />
                )}
            />

            <GridFilterDrawer {...chrome.drawerProps} />

            {appsOut.length > 0 && (
                <>
                    <div className="ws-pick-label">{labels.move}</div>
                    <div className="ws-pick">
                        {appsOut.map(a => (
                            <div key={a.id} className="ws-pick__item" onClick={() => onMoveApp(a.id, wsId)}>
                                <ServiceTile name={a.name} size={28} className="ws-pick__tile" />
                                <span className="ws-pick__name">{a.name}</span>
                                <span className="sk-tag">{a.app_type}</span>
                                <Plus size={16} className="ws-pick__plus" />
                            </div>
                        ))}
                    </div>
                </>
            )}
        </>
    );
};

export default WorkspaceApplicationsTab;
