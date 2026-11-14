import { useCallback, useMemo, useState } from 'react';
import useGridViews from './useGridViews';
import { OPS, applyFilters, emptyValueFor, isFilterable, ruleId, withInferredTypes } from './fields';

const NO_FILTERS = { match: 'all', rules: [] };

/**
 * THE entry point for the grid chrome (view picker · chip bar · filter drawer ·
 * tools menu) on a page that renders <DataTable> — i.e. the sorts[] +
 * hiddenKeys + groupBy state model rather than DataGrid's single cfg object.
 *
 * Written once here so every list page gets the SAME chrome instead of each one
 * growing its own toolbar. Give it the page's existing state and setters; it
 * returns `cfg` + `api` (what the chrome components expect), the extra
 * DataTable props, and the wired-up `views`.
 *
 *   const chrome = useTableChrome({
 *       columns, rows: filtered, viewPageKey: 'cron', builtinViews: BUILTIN_VIEWS,
 *       sorts, setSorts, hiddenKeys, setHiddenKeys, groupBy, setGroupBy,
 *       pageState: { filter, search },              // the page's own bag
 *       applyPage: (p) => { setFilter(p.filter); setSearch(p.search); },
 *   });
 *
 *   <GridViewPicker views={chrome.views} … />
 *   <GridChips {...chrome.chipProps} />
 *   <DataTable {…chrome.tableProps} columns={chrome.columns} … />
 *   <GridFilterDrawer {...chrome.drawerProps} />
 *
 * `pageState` is the envelope's `page` bag (see `viewState.js`) — the only
 * place a page may invent a key. Everything else is captured identically on
 * every page, which is what makes a saved view, a shareable link and a guard
 * one concept instead of eleven.
 */
const NO_KEYS = [];

export function useTableChrome({
    columns,
    rows = [],
    viewPageKey,
    builtinViews = [],
    noun = 'rows',
    sorts = [],
    setSorts,
    hiddenKeys = [],
    setHiddenKeys,
    // Columns a fresh table keeps out of sight. "Reset" goes back to THIS set,
    // not to "show everything": a table that offers twenty fields does not want
    // all twenty on screen the moment someone clears a filter.
    defaultHiddenKeys = NO_KEYS,
    groupBy = null,
    setGroupBy,
    pageState,
    applyPage,
    // Legacy top-level view keys -> their name inside `page`, for pages that
    // persisted a key before the envelope existed. e.g. { filters: 'serverFilters' }.
    rename,
    // URL namespace for shareable links. Pass one whenever a ROUTE renders more
    // than one table — a tab with an allowlist AND a blocklist, say — or the two
    // chrome instances fight over `?view=`/`?sort=` and swap each other's state.
    urlScope,
}) {
    const [filters, setFilters] = useState(NO_FILTERS);
    const [columnOrder, setColumnOrder] = useState(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    // Infer types HERE, once, and hand the same typed list to the chip bar, the
    // drawer and <DataTable>. DataTable can infer them itself, but then the
    // chrome would be reasoning about untyped columns while the table reasoned
    // about typed ones — and the drawer's rule editor would look up
    // OPS[undefined] for any rule the header menu had just created.
    const typedColumns = useMemo(() => withInferredTypes(columns, rows), [columns, rows]);

    const orderedColumns = useMemo(() => {
        if (!columnOrder?.length) return typedColumns;
        const byKey = new Map(typedColumns.map((c) => [c.key, c]));
        return [
            ...columnOrder.map((k) => byKey.get(k)).filter(Boolean),
            ...typedColumns.filter((c) => !columnOrder.includes(c.key)),
        ];
    }, [typedColumns, columnOrder]);

    const cfg = useMemo(() => ({
        cols: orderedColumns.filter((c) => !hiddenKeys.includes(c.key)).map((c) => c.key),
        sort: sorts[0] ? { key: sorts[0].key, dir: sorts[0].direction } : { key: null, dir: 'asc' },
        group: groupBy,
        filters,
        density: 'cozy',
        sub: [],
    }), [orderedColumns, hiddenKeys, sorts, groupBy, filters]);

    const removeRule = useCallback(
        (id) => setFilters((p) => ({ ...p, rules: p.rules.filter((r) => r.id !== id) })),
        [],
    );
    const clearRules = useCallback(() => setFilters((p) => ({ ...p, rules: [] })), []);
    const setMatch = useCallback((match) => setFilters((p) => ({ ...p, match })), []);

    const api = useMemo(() => ({
        setRules: (rules) => setFilters((p) => ({ ...p, rules })),
        setMatch,
        addRule: (cols) => {
            const first = cols.find(isFilterable);
            if (!first) return;
            setFilters((p) => ({
                ...p,
                rules: [...p.rules, {
                    id: ruleId(),
                    field: first.key,
                    op: OPS[first.type][0][0],
                    value: emptyValueFor(first.type),
                }],
            }));
        },
        removeRule,
        setColumnOrder,
        toggleColumn: (key) => setHiddenKeys?.(
            hiddenKeys.includes(key) ? hiddenKeys.filter((k) => k !== key) : [...hiddenKeys, key],
        ),
        setSub: () => {},
        setDensity: () => {},
        resetToView: () => { clearRules(); setHiddenKeys?.([...defaultHiddenKeys]); setColumnOrder(null); },
    }), [setMatch, removeRule, clearRules, hiddenKeys, setHiddenKeys, defaultHiddenKeys]);

    // The envelope. The column rules are `columnFilters`, never `filters`:
    // three pages persist a `filters` key of their own meaning a SERVER-side
    // query pair, and sharing the name is what made their presets cross-wire.
    const capture = useCallback(() => ({
        sorts,
        hiddenKeys,
        groupBy,
        columnFilters: filters,
        columnOrder,
        page: pageState || {},
    }), [sorts, hiddenKeys, groupBy, filters, columnOrder, pageState]);

    const apply = useCallback((state) => {
        applyPage?.(state.page || {});
        if (Array.isArray(state.sorts)) setSorts?.(state.sorts);
        if (Array.isArray(state.hiddenKeys)) setHiddenKeys?.(state.hiddenKeys);
        if (state.groupBy !== undefined) setGroupBy?.(state.groupBy);
        // A preset with no rules must CLEAR the live ones, or switching views
        // leaves the previous view's filters silently applied.
        setFilters(state.columnFilters ?? NO_FILTERS);
        setColumnOrder(state.columnOrder ?? null);

    }, [applyPage, setSorts, setHiddenKeys, setGroupBy]);

    const { views, copyLink, createView } = useGridViews({
        page: viewPageKey,
        builtinViews,
        capture,
        apply,
        rename,
        urlScope,
        resetToView: api.resetToView,
    });

    // What the table will ACTUALLY render. `rows` is the page's own already
    // searched/filtered array; the column rules are applied by <DataTable>
    // itself, so a page counting `rows.length` for its view bar reported "4 of
    // 4" while the table showed 2. Computed here, once, from the same engine
    // the table uses, so the two can never disagree.
    const shownRows = useMemo(
        () => applyFilters(rows, filters, orderedColumns),
        [rows, filters, orderedColumns],
    );

    return {
        cfg,
        api,
        views,
        columns: orderedColumns,
        noun,
        shownRows,
        shownCount: shownRows.length,
        filterCount: filters.rules.length,
        drawerOpen,
        setDrawerOpen,
        createView,
        copyLink,

        // spread straight onto the matching components
        tableProps: {
            filters,
            onFiltersChange: setFilters,
            columnOrder,
            onColumnOrderChange: setColumnOrder,
            hiddenKeys,
            onHiddenKeysChange: setHiddenKeys,
        },
        chipProps: {
            cfg,
            columns: orderedColumns,
            onRemove: removeRule,
            onClear: clearRules,
            onMatchChange: setMatch,
        },
        drawerProps: {
            open: drawerOpen,
            onOpenChange: setDrawerOpen,
            columns: orderedColumns,
            rows,
            cfg,
            grid: api,
            noun,
            showRowDetail: false,
            showDensity: false,
        },
        toolsProps: {
            cfg,
            columns: orderedColumns,
            rows,
            viewName: views.activeView?.name || noun,
            noun,
            onReset: api.resetToView,
            onCopyLink: copyLink,
            showDensity: false,
        },
    };
}

export default useTableChrome;
