import { useCallback, useMemo, useState } from 'react';
import { Search, Rows3, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SegControl, DataTableFooter, ListToolbar } from '@/components/ds';
import {
    GridViewPicker, GridChips, GridFilterButton, GridToolsMenu, GridFilterDrawer, GridBulkBar,
    useTableChrome,
} from '@/components/ds/grid';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import DataTable from '@/components/ds/DataTable';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Shared chrome for resource list pages (Services, Servers, …): the status
// filter + search toolbar, sort & column menus, the DataTable with a standard
// footer, and the loading / empty / filtered-empty states. Pages become thin:
// they own data + columns + handlers and pass them in. Markup mirrors the
// established `.wp-list` design so existing SCSS applies unchanged.
//
// DEPRECATED props, kept working, zero core render sites: `filters` /
// `activeFilter` / `onFilterChange` (the status segment row) and `renderCard` /
// `viewStorageKey` (the list/cards switch). Both are a second way to decide what
// the table shows that the saved view cannot capture, so core expresses them as
// `columnFilters` rules instead. They stay because this component is exported
// from plugins/sdk — its props ARE the contract — and go on the next SDK major.
// Do not reach for them in core; see the per-prop notes below.
//
//   <ResourceListPage
//     className="services-page"
//     loading={loading}
//     totalCount={apps.length}          // distinguishes "no items at all" from "filtered empty"
//     items={filteredApps}               // already-filtered rows for the table
//     columns={columns} keyField="id"    // columns opt into sorting with `sortable: true`
//     onRowClick={app => navigate(...)} rowClassName={rowClassName}
//     storageKey="serverkit-list-services"   // optional: persist sort/columns/page-size
//     searchTerm={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Search services…"
//     selectedCount={selectedIds.size} onClearSelection={clear} bulkActions={<>…</>}
//     emptyIcon={Layers} emptyTitle="…" emptyDescription="…" emptyAction={<Button…/>}
//     filteredEmptyTitle="…" filteredEmptyDescription="…"
//   >
//     {/* page-specific extras, e.g. a dialog */}
//   </ResourceListPage>
export default function ResourceListPage({
    className,
    loading = false,
    loadingTitle = 'Loading…',
    totalCount,
    items = [],
    columns,
    keyField = 'id',
    onRowClick,
    rowClassName,
    // Global sorting toggle — individual columns still need `sortable: true`.
    sortable = true,
    // Optional localStorage namespace for sort / column / page-size choices.
    storageKey,
    // Saved views: pass the page's view key (e.g. 'services') plus any built-in
    // views to grow the heading view picker. A view state is the shared
    // envelope — { sorts, hiddenKeys, columnOrder, groupBy, columnFilters,
    // page } — where this wrapper's `page` bag is { filter, search, pageSize }.
    // See components/ds/grid/viewState.js.
    viewPageKey,
    builtinViews = [],
    // Plural label used by the view picker, footer and export filename.
    noun = 'rows',
    // optional content rendered inside the wrapper, above the toolbar/empty
    // state (e.g. a one-time credentials banner)
    header,
    // toolbar
    // DEPRECATED — the status segment row. No core page passes these any more:
    // a fixed bucket row is a second, weaker way to narrow rows next to the
    // column's own menu, which combines, shows live per-value counts and can be
    // saved into a view. Express it as a `columnFilters` rule instead.
    //
    // Still accepted because this component is SDK surface (plugins/sdk exports
    // it, which pins its props as contract), so an extension may still be
    // passing them. Remove on the next SDK major.
    filters,
    activeFilter,
    onFilterChange,
    searchTerm,
    onSearchChange,
    searchPlaceholder = 'Search…',
    // Placement rule: on tab-group pages the search input belongs in the shared
    // topbar (the page publishes a SearchField there itself); set this flag so
    // the in-page search slot stays empty. Extensions outside a tab group leave
    // it off and keep the in-page input.
    searchInTopbar = false,
    toolbarExtra,
    // bulk actions
    selectedCount = 0,
    onClearSelection,
    bulkActions,
    // empty (no items at all)
    emptyIcon,
    emptyTitle = 'No results',
    emptyDescription = '',
    emptyAction = null,
    // filtered empty (items exist but none match the filter/search)
    filteredEmptyIcon,
    filteredEmptyTitle = 'No results found',
    filteredEmptyDescription = 'Try adjusting your search or filter.',
    // load error: the request failed, so "no items" is not known to be true.
    // With nothing loaded it replaces the empty state; with rows already on
    // screen (a failed background refresh) it shows compact above them.
    // `error` is the thrown Error (its message is the server's reason) or a
    // string; `onRetry` re-runs the page's loader.
    error = null,
    errorTitle,
    onRetry,
    // Where the table's chrome (filter · "⋮") goes. `true` publishes it into the
    // enclosing tab group's top bar, on the same line as the page's actions and
    // search — the shape every top-level list page has. Set it false for a
    // table nested inside a page that owns that bar already (a tab's inner
    // table), and the chrome renders in the view row instead. Outside a tab
    // group it falls back to the view row on its own.
    chromeInTopbar = true,
    // Opt-in card view: pass a renderer and the chrome grows a list/cards
    // switch. Pages that omit it are table-only exactly as before.
    //
    // DEPRECATED for core: no core page passes it any more. A layout toggle is
    // a third way to change what the table shows, next to views and filters,
    // that none of them can save or share — the saved view is the one answer to
    // "how do I want to look at this". Kept working because this component is
    // SDK surface; remove on the next SDK major.
    renderCard,
    viewStorageKey,
    // Row selection: pass selectedIds (Set) + handlers to get a native
    // checkbox column and the floating bulk bar (replaces the hand-rolled
    // __select column pattern).
    selectable = false,
    selectedIds,
    onToggleSelect,
    onSelectAll,
    // j/k/Enter/x row cursor (defaults on for list pages; keys are ignored
    // while typing or while a dialog is open).
    keyboardNav = true,
    children,
}) {
    const { t } = useTranslation();
    const resolvedTotal = totalCount ?? items.length;
    const errorObj = typeof error === 'string' ? { message: error } : error;
    const [view, setView] = useState(() => {
        if (!renderCard) return 'list';
        try {
            return window.localStorage.getItem(viewStorageKey) === 'cards' ? 'cards' : 'list';
        } catch {
            return 'list';
        }
    });

    const { sorts, setSorts } = useTableSort({
        storageKey: storageKey ? `${storageKey}-sort` : undefined,
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: storageKey ? `${storageKey}-cols` : undefined,
    });
    const [groupBy, setGroupBy] = useState(() => {
        if (!storageKey) return null;
        try {
            return window.localStorage.getItem(`${storageKey}-group`) || null;
        } catch {
            return null;
        }
    });

    const changeGroupBy = (next) => {
        setGroupBy(next);
        if (!storageKey) return;
        try {
            if (next) window.localStorage.setItem(`${storageKey}-group`, next);
            else window.localStorage.removeItem(`${storageKey}-group`);
        } catch {
            /* private mode / quota — the choice just doesn't persist */
        }
    };
    const [pageSize, setPageSize] = useState(() => {
        if (!storageKey) return 'all';
        try {
            const raw = window.localStorage.getItem(`${storageKey}-pagesize`);
            return raw ? (raw === 'all' ? 'all' : Number(raw)) : 'all';
        } catch {
            return 'all';
        }
    });

    const changePageSize = (next) => {
        setPageSize(next);
        if (!storageKey) return;
        try {
            window.localStorage.setItem(`${storageKey}-pagesize`, String(next));
        } catch {
            /* private mode / quota — the choice just doesn't persist */
        }
    };

    const changeView = (next) => {
        setView(next);
        if (!viewStorageKey) return;
        try {
            window.localStorage.setItem(viewStorageKey, next);
        } catch {
            /* private mode / quota — the choice just doesn't persist */
        }
    };

    // The chrome — view picker, chip bar, filter drawer, tools menu, shareable
    // links — comes from the shared hook rather than being adapted again here.
    // This wrapper used to carry its own copy of that adapter, which is how it
    // ended up the one chrome host with no `useViewLink`: every list page built
    // on it silently had no shareable links at all.
    //
    // `page` is the envelope's per-page bag (see grid/viewState.js). The status
    // filter, the search box and the page size are this wrapper's own state —
    // everything else is captured identically to every other list page.
    const pageState = useMemo(
        () => ({ filter: activeFilter, search: searchTerm, pageSize }),
        [activeFilter, searchTerm, pageSize],
    );

    const applyPage = useCallback((saved) => {
        if (saved.filter !== undefined) onFilterChange?.(saved.filter);
        if (saved.search !== undefined) onSearchChange?.(saved.search);
        if (saved.pageSize !== undefined) changePageSize(saved.pageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onFilterChange, onSearchChange]);

    const chrome = useTableChrome({
        columns,
        rows: items,
        viewPageKey,
        builtinViews,
        noun,
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy: changeGroupBy,
        pageState,
        applyPage,
    });

    const orderedColumns = chrome.columns;
    const tableViews = chrome.views;

    // The table's own chrome, built once and rendered in exactly ONE place:
    // hoisted into the tab group's top bar next to the page's actions, or — for
    // an inner table, or a page reused outside a tab group — in the view row.
    // It used to be a second toolbar under the view row on every page, which
    // for most of them was an otherwise empty bar holding two icons.
    const chromeNode = (
        <>
            {view === 'list' && (
                <>
                    <GridFilterButton
                        count={chrome.filterCount}
                        onClick={() => chrome.setDrawerOpen(true)}
                    />
                    <GridToolsMenu
                        {...chrome.toolsProps}
                        selectedRows={selectable && selectedIds
                            ? items.filter((i) => selectedIds.has(i[keyField]))
                            : []}
                    />
                </>
            )}
            {renderCard && (
                <div className="wp-list__viewswitch" role="group" aria-label={t('app.resourceListPage.layout', 'Layout')}>
                    {[['list', Rows3, 'List'], ['cards', LayoutGrid, 'Cards']].map(([key, Icon, label]) => (
                        <SharedButton variant="unstyled"
                            type="button"
                            key={key}
                            className={view === key ? 'is-active' : ''}
                            onClick={() => changeView(key)}
                            title={label}
                            aria-label={label}
                            aria-pressed={view === key}
                        >
                            <Icon size={15} />
                        </SharedButton>
                    ))}
                </div>
            )}
        </>
    );

    // Nothing to host while the page is empty or still loading — the chrome
    // acts on a table that isn't there.
    const hasTable = !loading && resolvedTotal > 0;
    const { hosted: chromeHoisted, portal: chromePortal } = useTopbarChrome(
        chromeNode,
        { enabled: chromeInTopbar && hasTable },
    );

    // Where the chrome lands when the top bar didn't take it: the view row if
    // there is one, otherwise a bar of its own.
    const hasPicker = !!viewPageKey && view === 'list';
    const inlineChrome = chromeHoisted ? null : chromeNode;

    // The quick-filter segment and any page extras still need a bar of their
    // own; pages that have neither get no second row at all.
    const hasToolbar = !!filters || !!toolbarExtra || (onSearchChange && !searchInTopbar);

    // Paged AFTER the column rules, not before. Slicing `items` meant a page
    // size of 25 took 25 unfiltered rows and THEN filtered them, so "show 25"
    // could render three. `chrome.shownRows` is the same set the table renders,
    // so the two agree; DataTable re-applying the rules to it is a no-op.
    const pagedItems = useMemo(
        () => (pageSize === 'all' ? chrome.shownRows : chrome.shownRows.slice(0, pageSize)),
        [chrome.shownRows, pageSize],
    );

    if (loading) {
        // Same wrapper as the loaded state below. A skeleton that renders
        // outside the page's padded container occupies a different box than the
        // content it predicts — it spans edge to edge, then everything jumps
        // inward on arrival, which is precisely the flash a skeleton exists to
        // prevent.
        //
        // The variant tracks the real shape: a resource list is a table, or a
        // card grid when the page opted into one.
        return (
            <div className={cn('sk-tabgroup__inner', className)}>
                <EmptyState
                    loading
                    loadingVariant={renderCard && view === 'cards' ? 'cards' : 'table'}
                    title={loadingTitle}
                />
            </div>
        );
    }

    return (
        <div className={cn('sk-tabgroup__inner', className)}>
            {chromePortal}
            {header}
            {error && resolvedTotal > 0 && (
                <ErrorState compact error={errorObj} onRetry={onRetry} />
            )}
            {error && resolvedTotal === 0 ? (
                <ErrorState
                    title={errorTitle || t('app.resourceListPage.couldntLoad', "Couldn't load {{noun}}.", { noun })}
                    error={errorObj}
                    onRetry={onRetry}
                />
            ) : resolvedTotal === 0 ? (
                <EmptyState
                    size="lg"
                    icon={emptyIcon}
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                />
            ) : (
                <div className="wp-list">
                    {/* The saved view names what you are looking at, so it is the
                        page's heading rather than another toolbar button. Sort,
                        Group and Columns are gone from the toolbar entirely —
                        they live in each column's own "⋮" now, next to the
                        column they act on. */}
                    {hasPicker && (
                        <GridViewPicker
                            views={tableViews}
                            label={noun}
                            onCreate={chrome.createView}
                            actions={inlineChrome}
                        />
                    )}
                    {(hasToolbar || (inlineChrome && !hasPicker)) && (
                        <ListToolbar
                            filters={filters && (
                                <SegControl
                                    value={activeFilter}
                                    onChange={onFilterChange}
                                    options={filters}
                                />
                            )}
                            tools={hasPicker ? undefined : inlineChrome}
                        >
                            {onSearchChange && !searchInTopbar && (
                                <div className="wp-list__search">
                                    <Search size={15} aria-hidden="true" />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => onSearchChange(e.target.value)}
                                        placeholder={searchPlaceholder}
                                        aria-label={searchPlaceholder}
                                    />
                                </div>
                            )}
                            {toolbarExtra}
                        </ListToolbar>
                    )}

                    {view === 'list' && <GridChips {...chrome.chipProps} />}

                    {items.length === 0 ? (
                        <EmptyState
                            icon={filteredEmptyIcon || emptyIcon}
                            title={filteredEmptyTitle}
                            description={filteredEmptyDescription}
                        />
                    ) : view === 'cards' && renderCard ? (
                        <div className="wp-list__cards">
                            {items.map((item) => (
                                <div
                                    key={item[keyField]}
                                    className={cn('wp-list__cardtile', rowClassName?.(item))}
                                    onClick={() => onRowClick?.(item)}
                                >
                                    {renderCard(item)}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="wp-list__card">
                            <DataTable
                                {...chrome.tableProps}
                                columns={orderedColumns}
                                data={pagedItems}
                                keyField={keyField}
                                sortable={sortable}
                                sorts={sorts}
                                onSortsChange={setSorts}
                                groupBy={groupBy}
                                onGroupByChange={changeGroupBy}
                                selectable={selectable}
                                selectedKeys={selectable && selectedIds ? [...selectedIds] : undefined}
                                onToggleRow={selectable ? onToggleSelect : undefined}
                                onToggleAll={selectable ? onSelectAll : undefined}
                                keyboardNav={keyboardNav}
                                onRowClick={onRowClick}
                                rowClassName={rowClassName}
                                footer={(
                                    <DataTableFooter
                                        shown={pagedItems.length}
                                        total={chrome.shownCount}
                                        noun={noun.replace(/s$/, '')}
                                        pageSize={pageSize}
                                        onPageSizeChange={changePageSize}
                                    />
                                )}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* The shared selection bar — this wrapper used to hand-roll its
                own copy, which is how /domains ended up with one at the top of
                the list and /services with a different one at the bottom. */}
            <GridBulkBar count={selectedCount} noun={noun.replace(/s$/, '')} onClear={onClearSelection}>
                {bulkActions}
            </GridBulkBar>
            <GridFilterDrawer {...chrome.drawerProps} />

            {children}
        </div>
    );
}
