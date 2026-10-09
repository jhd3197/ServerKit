import { useEffect, useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Table2, Columns3, KeyRound, Terminal } from 'lucide-react';
import { runQuery, getStructure, buildBrowseQuery } from './dbAdapter';
import ResultsGrid from './ResultsGrid';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const PAGE_SIZE = 100;

// What the Key cell renders for a column that carries none. A real value, not
// '': an empty rule value is dropped before it filters, so "key is ''" would
// silently match everything.
const NO_KEY = '—';
const PRIMARY = 'PRIMARY';

// Built-in saved views over a table's schema. The default sort is EMPTY on
// purpose — a schema's natural order is its ordinal order, and that is the one
// listing in which a column's position means something.
const NO_RULES = { match: 'all', rules: [] };
const NATURAL_ORDER = [];
const PAGE_CLEAR = { search: '' };

const STRUCTURE_VIEWS = [
    {
        name: 'All columns',
        state: { sorts: NATURAL_ORDER, hiddenKeys: [], columnFilters: NO_RULES, page: PAGE_CLEAR },
    },
    {
        // Where the NULLs can come from — the question you ask a schema before
        // writing a query that joins on one of its columns.
        name: 'Nullable columns',
        state: {
            sorts: NATURAL_ORDER,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'st1', field: 'nullable', op: 'is', value: true }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // "is none of —" rather than a list of PRI/UNI/MUL, so a key kind this
        // build has never seen still lands here.
        name: 'Indexed columns',
        state: {
            sorts: NATURAL_ORDER,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'st2', field: 'key', op: 'none', value: [NO_KEY] }],
            },
            page: PAGE_CLEAR,
        },
    },
];

// Browses one table: a paginated data grid (SELECT * LIMIT/OFFSET under the
// hood) plus a Structure view. `rowsEstimate` comes from the tree's table list
// so we can show a range without a COUNT(*) round-trip.
export default function TableDataTab({ conn, tabId, table, rowsEstimate, active, onStatus, onOpenConsole }) {
    const { t } = useTranslation();
    const [view, setView] = useState('data');
    const [page, setPage] = useState(0);
    const [data, setData] = useState(null);
    const [dataLoading, setDataLoading] = useState(false);
    const [dataError, setDataError] = useState('');
    const [structure, setStructure] = useState(null);
    const [structureLoading, setStructureLoading] = useState(false);
    const [structureUnsupported, setStructureUnsupported] = useState(false);
    const [search, setSearch] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: NATURAL_ORDER,
        storageKey: 'serverkit-table-db-structure-sort',
    });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-db-structure-cols' });

    const loadData = useCallback(async (pageIdx) => {
        setDataLoading(true);
        setDataError('');
        try {
            const sql = buildBrowseQuery(conn, table, { limit: PAGE_SIZE, offset: pageIdx * PAGE_SIZE });
            const result = await runQuery(conn, sql, true);
            if (result.success) setData(result);
            else setDataError(result.error || 'Failed to load rows.');
        } catch (err) {
            setDataError(err.message || 'Failed to load rows.');
        } finally {
            setDataLoading(false);
        }
    }, [conn, table]);

    useEffect(() => { loadData(page); }, [loadData, page]);

    const loadStructure = useCallback(async (force = false) => {
        if (structureUnsupported || structureLoading) return;
        if (structure && !force) return;
        setStructureLoading(true);
        try {
            const result = await getStructure(conn, table);
            if (result.unsupported) setStructureUnsupported(true);
            else if (result.success) setStructure(result.columns || []);
        } catch { /* leave structure empty; the view shows a fallback */ }
        finally { setStructureLoading(false); }
    }, [conn, table, structure, structureLoading, structureUnsupported]);

    useEffect(() => {
        if (view === 'structure') loadStructure();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    useEffect(() => {
        if (!active) return;
        const start = rowsEstimate === 0 ? 0 : page * PAGE_SIZE + 1;
        const end = page * PAGE_SIZE + (data?.row_count || 0);
        onStatus?.(tabId, {
            connText: `${conn.dbType} · ${table}`,
            readonly: true,
            rangeText: data ? `${start}–${end}${rowsEstimate != null ? ` of ≈${rowsEstimate}` : ''}` : null,
            execTime: data?.execution_time,
        });
    }, [active, data, page, rowsEstimate, conn, table, onStatus, tabId]);

    const hasMore = (data?.row_count || 0) === PAGE_SIZE;

    // Schema rows. `nullable` is a BOOLEAN and `key`/`default` are absent on
    // PostgreSQL, so every one of these needs a `render` — React draws a boolean
    // and an undefined as nothing at all, which is how a converted column ends
    // up silently blank.
    const structureColumns = [
        {
            key: 'name',
            headerKey: 'app.tableDataTab.column', header: 'Column',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (col) => col.name || '',
            cellClassName: 'sk-cell-name',
            render: (col) => (
                <>
                    {(col.key === 'PRI' || col.primary_key) && (
                        <KeyRound size={12} className="dbx-pk" aria-label={t('app.tableDataTab.primaryKey', 'Primary key')} />
                    )}
                    {col.name}
                </>
            ),
        },
        {
            key: 'type',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            // Declared: a table of ten VARCHARs and two INTs would infer as an
            // enum on one table and as text on the next, so the control the
            // column offers would change from table to table.
            type: 'enum',
            value: (col) => col.type || '',
            sortValue: (col) => col.type || '',
            cellClassName: 'sk-cell-mono',
        },
        {
            key: 'nullable',
            headerKey: 'app.tableDataTab.nullable', header: 'Nullable',
            sortable: true,
            type: 'bool',
            value: (col) => !!col.nullable,
            sortValue: (col) => (col.nullable ? 1 : 0),
            render: (col) => (col.nullable ? 'YES' : 'NO'),
        },
        {
            key: 'key',
            headerKey: 'common.labels.key', header: 'Key',
            sortable: true,
            type: 'enum',
            value: (col) => ((col.key === 'PRI' || col.primary_key) ? PRIMARY : (col.key || NO_KEY)),
            sortValue: (col) => ((col.key === 'PRI' || col.primary_key) ? PRIMARY : (col.key || '')),
            cellClassName: 'sk-cell-mono',
            render: (col) => ((col.key === 'PRI' || col.primary_key) ? PRIMARY : (col.key || NO_KEY)),
        },
        {
            key: 'default',
            headerKey: 'common.labels.default', header: 'Default',
            sortable: true,
            type: 'text',
            value: (col) => (col.default == null ? 'NULL' : String(col.default)),
            cellClassName: 'sk-cell-mono',
            render: (col) => (
                <span className={col.default == null ? 'is-null' : undefined}>
                    {col.default == null ? 'NULL' : String(col.default)}
                </span>
            ),
        },
    ];

    const shownColumns = useMemo(() => {
        const list = structure || [];
        const term = search.trim().toLowerCase();
        if (!term) return list;
        return list.filter((col) => (
            (col.name || '').toLowerCase().includes(term)
            || (col.type || '').toLowerCase().includes(term)
        ));
    }, [structure, search]);

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Scoped to the structure view, and namespaced in the URL: several table
    // tabs plus a processes tab can be open on this route at once, and their
    // chrome instances would otherwise fight over the same ?view=/?sort=.
    const chrome = useTableChrome({
        columns: structureColumns,
        rows: shownColumns,
        viewPageKey: 'databases-table-structure',
        builtinViews: STRUCTURE_VIEWS,
        // Scoped per TAB, not per component: the explorer keeps every open tab
        // mounted (a half-typed query has to survive a click on the tree), so
        // four open tables mean four live chrome instances. A shared scope had
        // them all writing the same ?dbstruct.view= and reading each other's
        // back. The saved-view namespace stays shared, which is what you want —
        // a "structure" view is worth reusing across tables.
        urlScope: `dbstruct-${tabId}`,
        noun: 'columns',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    return (
        <div className="dbx-table-tab">
            <div className="dbx-table-toolbar">
                <div className="dbx-segmented" role="tablist" aria-label={t('app.tableDataTab.tableView', 'Table view')}>
                    <SharedButton variant="unstyled"
                        type="button"
                        role="tab"
                        aria-selected={view === 'data'}
                        className={view === 'data' ? 'is-active' : ''}
                        onClick={() => setView('data')}
                    >
                        <Table2 size={14} aria-hidden="true" /> {t('app.tableDataTab.data', 'Data')}
                    </SharedButton>
                    <SharedButton variant="unstyled"
                        type="button"
                        role="tab"
                        aria-selected={view === 'structure'}
                        className={view === 'structure' ? 'is-active' : ''}
                        onClick={() => setView('structure')}
                    >
                        <Columns3 size={14} aria-hidden="true" /> {t('app.tableDataTab.structure', 'Structure')}
                    </SharedButton>
                </div>

                {view === 'data' && (
                    <div className="dbx-pager">
                        <SharedButton variant="unstyled"
                            type="button"
                            className="dbx-icon-btn"
                            onClick={() => setPage((p) => Math.max(0, p - 1))}
                            disabled={page === 0 || dataLoading}
                            aria-label={t('app.tableDataTab.previousPage', 'Previous page')}
                        >
                            <ChevronLeft size={15} aria-hidden="true" />
                        </SharedButton>
                        <span className="dbx-pager-label">
                            {rowsEstimate === 0
                                ? t('app.tableDataTab.zeroRows', '0 rows')
                                : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + (data?.row_count || 0)}`}
                            {rowsEstimate != null && rowsEstimate > 0 && <span className="dbx-pager-total"> {t('app.tableDataTab.of', 'of ≈')}{rowsEstimate.toLocaleString()}</span>}
                        </span>
                        <SharedButton variant="unstyled"
                            type="button"
                            className="dbx-icon-btn"
                            onClick={() => setPage((p) => p + 1)}
                            disabled={!hasMore || dataLoading}
                            aria-label={t('app.tableDataTab.nextPage', 'Next page')}
                        >
                            <ChevronRight size={15} aria-hidden="true" />
                        </SharedButton>
                    </div>
                )}

                <div className="dbx-table-toolbar-spacer" />

                <SharedButton variant="unstyled" type="button" className="dbx-chip" onClick={() => onOpenConsole?.(`SELECT * FROM ${table} LIMIT 100;`)}>
                    <Terminal size={14} aria-hidden="true" /> {t('app.tableDataTab.query', 'Query')}
                </SharedButton>
                {/* Data only. The structure table's refresh lives in its own
                    "⋮" with the rest of its table-wide actions, so the schema
                    never carries two ways to reload it. */}
                {view === 'data' && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="dbx-icon-btn"
                        onClick={() => loadData(page)}
                        disabled={dataLoading}
                        aria-label={t('common.actions.refresh', 'Refresh')}
                    >
                        <RefreshCw size={14} className={dataLoading ? 'dbx-spin' : ''} aria-hidden="true" />
                    </SharedButton>
                )}
            </div>

            <div className="dbx-table-body">
                {view === 'data' ? (
                    <ResultsGrid
                        columns={data?.columns}
                        rows={data?.rows}
                        loading={dataLoading}
                        error={dataError}
                        emptyTitle="Empty table"
                        emptyDescription="This table has no rows yet."
                    />
                ) : structureUnsupported ? (
                    <div className="dbx-structure-fallback">
                        {t('app.tableDataTab.columnMetadataIsnTAvailableFor', 'Column metadata isn\'t available for databases inside Docker containers. Use the Data view or a SQL console.')}
                    </div>
                ) : structureLoading ? (
                    <div className="dbx-structure-fallback">{t('app.tableDataTab.loadingStructure', 'Loading structure…')}</div>
                ) : (
                    <div className="dbx-structure-pane">
                        {/* One row of chrome for the schema table. This tab sits
                            inside the explorer's own tab bar, so it stays inline
                            rather than being hoisted. */}
                        <GridViewPicker
                            views={chrome.views}
                            label="columns"
                            onCreate={chrome.createView}
                            actions={(
                                <>
                                    <SearchField
                                        value={search}
                                        onSearch={setSearch}
                                        placeholder={t('app.tableDataTab.filterColumnOrType', 'Filter column or type…')}
                                    />
                                    <GridFilterButton
                                        count={chrome.filterCount}
                                        onClick={() => chrome.setDrawerOpen(true)}
                                    />
                                    <GridToolsMenu
                                        {...chrome.toolsProps}
                                        onRefresh={() => loadStructure(true)}
                                    />
                                </>
                            )}
                        />

                        <GridChips {...chrome.chipProps} />

                        <DataTable
                            {...chrome.tableProps}
                            columns={chrome.columns}
                            data={shownColumns}
                            keyField="name"
                            sorts={sorts}
                            onSortsChange={setSorts}
                            className="dbx-pane-scroll"
                            emptyTitle={structure ? 'No matching columns' : 'No columns reported.'}
                            emptyMessage={structure ? t('app.tableDataTab.noColumnMatchesTheCurrentSearch', 'No column matches the current search.') : ''}
                            footer={(
                                <DataTableFooter
                                    shown={chrome.shownCount}
                                    total={(structure || []).length}
                                    noun="column"
                                />
                            )}
                        />

                        <GridFilterDrawer {...chrome.drawerProps} />
                    </div>
                )}
            </div>
        </div>
    );
}
