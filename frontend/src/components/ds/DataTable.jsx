import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronRight, Filter } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { applyTableSorts, nextSorts, useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import EmptyState from '../EmptyState';
import ColumnMenu from './grid/ColumnMenu';
import { applyFilters, isDecorative, withInferredTypes } from './grid/fields';
import { useTranslation } from 'react-i18next';
import { translateLabel } from '../../i18n/labels';
import { Button as SharedButton } from '@/components/ui/button';

/**
 * Declarative data table built on top of the shadcn/ui Table primitives.
 *
 * Multi-column sorting (datatables.net style): a plain header click makes that
 * column the only sort (asc -> desc -> none); shift+click stacks additional
 * sort levels. Sort state is uncontrolled by default; pass `sorts` +
 * `onSortsChange` to control it (e.g. to pair with <SortMenu> in a toolbar).
 * Column visibility works the same way via `hiddenKeys` + `onHiddenKeysChange`
 * and ds/ColumnsMenu. `storageKey` persists both to localStorage.
 *
 * Grouping: pass `groupBy` (a column key) — rows collapse under sticky group
 * headers with counts. Columns opt in with `groupable: true` and may define
 * `groupValue(row)` / `groupLabel(value, rows)`. Pair with ds/GroupMenu.
 *
 * Selection: `selectable` + controlled `selectedKeys` / `onToggleRow` /
 * `onToggleAll` renders a real checkbox column (header box goes
 * indeterminate when partially selected).
 *
 * Keyboard nav: `keyboardNav` adds a row cursor — j/k (or arrows) move,
 * Enter triggers onRowClick, x toggles the cursor row's selection. Keys are
 * ignored while typing in a field or while a dialog holds focus.
 *
 * Example:
 *   <DataTable
 *     columns={[
 *       { key: 'name', header: 'Server', sortable: true, hideable: false,
 *         render: s => <ServerCell server={s} /> },
 *       { key: 'status', header: 'Status', sortable: true, groupable: true,
 *         render: s => <Pill kind={s.status}>{s.status}</Pill> },
 *       { key: 'actions', header: '', className: 'text-right', sortable: false,
 *         hideable: false, render: s => <Actions server={s} /> },
 *     ]}
 *     data={servers}
 *     keyField="id"
 *     storageKey="serverkit-table-servers"
 *     keyboardNav
 *     footer={<DataTableFooter shown={rows.length} total={rows.length} />}
 *     emptyTitle="No servers"
 *     emptyMessage="Add your first server to start monitoring."
 *   />
 */
export function DataTable({
    columns,
    data,
    keyField = 'id',
    sortable = true,
    // Legacy single-sort default; prefer defaultSorts.
    defaultSort = null,
    defaultSorts,
    // Controlled sort state (optional).
    sorts: controlledSorts,
    onSortsChange,
    // Controlled column visibility (optional).
    hiddenKeys: controlledHiddenKeys,
    onHiddenKeysChange,
    // Grouping (optional; controlled via groupBy + onGroupByChange).
    groupBy: controlledGroupBy,
    onGroupByChange,
    // Per-column header menu (sort · group · filter · move · hide). On by
    // default: it is the table's own affordance, not a page feature.
    columnMenu = true,
    // Column filter rules. Uncontrolled by default — pass both to mirror the
    // rules in a chip bar or a filter drawer.
    filters: controlledFilters,
    onFiltersChange,
    // Column order (visible order). Uncontrolled by default.
    columnOrder: controlledOrder,
    onColumnOrderChange,
    // Selection (optional, controlled).
    selectable = false,
    selectedKeys,
    onToggleRow,
    onToggleAll,
    // j/k/Enter/x row cursor.
    keyboardNav = false,
    storageKey,
    emptyState,
    emptyTitle = 'No results',
    emptyMessage = 'Nothing to show yet.',
    loading = false,
    onRowClick,
    renderRow,
    footer,
    className,
    rowClassName,
    tableClassName,
}) {
    const { t } = useTranslation();
    const internal = useTableSort({
        defaultSorts: defaultSorts ?? (defaultSort ? [defaultSort] : []),
        storageKey: storageKey ? `${storageKey}-sort` : undefined,
    });
    const sorts = controlledSorts ?? internal.sorts;
    const toggleSort = useMemo(() => (
        onSortsChange
            ? (key, additive) => onSortsChange(nextSorts(sorts, key, additive))
            : internal.toggleSort
    ), [onSortsChange, sorts, internal.toggleSort]);
    const setSorts = onSortsChange ?? internal.setSorts;

    // The header menu picks a DIRECTION rather than cycling, so it replaces the
    // whole sort stack. Shift+click on the header is still how you stack levels.
    const setSortDirection = useCallback(
        (key, direction) => setSorts([{ key, direction }]),
        [setSorts],
    );

    const [openMenu, setOpenMenu] = useState(null);

    const internalCols = useColumnVisibility({
        storageKey: storageKey ? `${storageKey}-cols` : undefined,
    });
    const hiddenKeys = controlledHiddenKeys ?? internalCols.hiddenKeys;
    const setHiddenKeys = onHiddenKeysChange
        ?? (controlledHiddenKeys ? null : internalCols.setHiddenKeys);

    const [internalGroupBy, setInternalGroupBy] = useState(null);
    const groupBy = controlledGroupBy !== undefined ? controlledGroupBy : internalGroupBy;
    const setGroupBy = onGroupByChange ?? setInternalGroupBy;

    // ---- column filters (header menu) --------------------------------------
    // Types are inferred from the data for every column that doesn't declare
    // one, so the ~50 tables written before the field model existed get
    // filtering without touching a single call site.
    const typedColumns = useMemo(
        () => (columnMenu ? withInferredTypes(columns, data) : columns),
        [columns, data, columnMenu],
    );

    const [internalFilters, setInternalFilters] = useState({ match: 'all', rules: [] });
    const filters = controlledFilters ?? internalFilters;
    const setFilters = onFiltersChange ?? setInternalFilters;

    // Every setter below is called with an explicit VALUE, never an updater
    // function: half of them may be a controlled `onXChange` prop from a page,
    // which is a plain `(next) => void` and would receive the function itself.
    const putRule = useCallback((key, rule) => {
        setFilters({
            ...filters,
            rules: [...filters.rules.filter((r) => r.field !== key), ...(rule ? [rule] : [])],
        });
    }, [setFilters, filters]);

    // ---- column order (header menu: move left / right) ---------------------
    const [internalOrder, setInternalOrder] = useState(null);
    const order = controlledOrder ?? internalOrder;
    const setOrder = onColumnOrderChange ?? setInternalOrder;

    const orderedColumns = useMemo(() => {
        if (!order?.length) return typedColumns;
        const byKey = new Map(typedColumns.map((c) => [c.key, c]));
        const moved = order.map((k) => byKey.get(k)).filter(Boolean);
        // Columns absent from a stale saved order keep their declared position.
        const rest = typedColumns.filter((c) => !order.includes(c.key));
        return [...moved, ...rest];
    }, [typedColumns, order]);

    const visibleColumns = useMemo(
        () => orderedColumns.filter((c) => !hiddenKeys.includes(c.key)),
        [orderedColumns, hiddenKeys],
    );

    const moveColumn = useCallback((key, delta) => {
        const keys = visibleColumns.map((c) => c.key);
        const from = keys.indexOf(key);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= keys.length) return;
        keys.splice(to, 0, ...keys.splice(from, 1));
        setOrder(keys);
    }, [visibleColumns, setOrder]);

    const hideColumn = useCallback((key) => {
        if (!hiddenKeys.includes(key)) setHiddenKeys?.([...hiddenKeys, key]);
        putRule(key, null);
        if (groupBy === key) setGroupBy?.(null);
    }, [setHiddenKeys, hiddenKeys, putRule, setGroupBy, groupBy]);

    // Group BY a column (header menu). Distinct from `toggleGroup` below, which
    // collapses/expands one already-rendered group row.
    const toggleGroupBy = useCallback((key) => {
        setGroupBy?.(groupBy === key ? null : key);
    }, [setGroupBy, groupBy]);

    const filteredData = useMemo(
        () => (filters?.rules?.length ? applyFilters(data, filters, typedColumns) : data),
        [data, filters, typedColumns],
    );

    const sortedData = useMemo(
        () => (sortable ? applyTableSorts(filteredData, sorts, columns) : filteredData),
        [filteredData, sorts, sortable, columns],
    );

    // ---- grouping ----------------------------------------------------------
    const groupColumn = useMemo(
        () => columns.find((c) => c.key === groupBy && c.groupable),
        [columns, groupBy],
    );
    const groups = useMemo(() => {
        if (!groupColumn) return null;
        const getValue = groupColumn.groupValue || ((row) => row[groupColumn.key]);
        const byKey = new Map();
        for (const row of sortedData) {
            const value = getValue(row);
            const key = value == null || value === '' ? '__none__' : String(value);
            if (!byKey.has(key)) byKey.set(key, { key, value, rows: [] });
            byKey.get(key).rows.push(row);
        }
        // Group order follows the sorted data (first appearance), so the active
        // sort decides which group leads; the "no value" group always trails.
        const ordered = [...byKey.values()];
        ordered.sort((a, b) => (a.key === '__none__') - (b.key === '__none__'));
        return ordered;
    }, [sortedData, groupColumn]);
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
    const toggleGroup = (key) => setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });

    // Rows in display order (groups expanded) — the cursor space for keyboardNav.
    const flatRows = useMemo(() => {
        if (!groups) return sortedData;
        return groups.flatMap((g) => (collapsedGroups.has(g.key) ? [] : g.rows));
    }, [groups, sortedData, collapsedGroups]);
    const rowIndexByKey = useMemo(() => {
        const map = new Map();
        flatRows.forEach((row, index) => {
            const key = typeof keyField === 'function' ? keyField(row) : row[keyField];
            map.set(key, index);
        });
        return map;
    }, [flatRows, keyField]);

    // ---- keyboard navigation ----------------------------------------------
    const [cursor, setCursor] = useState(-1);
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!keyboardNav) return undefined;
        const onKey = (event) => {
            const target = event.target;
            // A focused Radix Select (trigger = combobox, open list = listbox)
            // owns its arrows and Enter, exactly like the native <select> did.
            if (target instanceof Element && target.closest('input, textarea, select, [role="combobox"], [role="listbox"], [contenteditable="true"], [role="dialog"]')) {
                return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const rowCount = flatRows.length;
            if (!rowCount) return;
            if (event.key === 'j' || event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((c) => Math.min(c + 1, rowCount - 1));
            } else if (event.key === 'k' || event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
            } else if (event.key === 'Enter' && cursor >= 0 && onRowClick) {
                event.preventDefault();
                onRowClick(flatRows[cursor]);
            } else if (event.key === 'x' && selectable && cursor >= 0) {
                event.preventDefault();
                const row = flatRows[cursor];
                const key = typeof keyField === 'function' ? keyField(row) : row[keyField];
                onToggleRow?.(key, !selectedKeys?.includes(key));
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [keyboardNav, flatRows, cursor, onRowClick, selectable, selectedKeys, onToggleRow, keyField]);

    // Keep the cursor row on screen.
    useEffect(() => {
        if (cursor < 0 || !wrapRef.current) return;
        wrapRef.current.querySelector('tr.is-cursor')?.scrollIntoView({ block: 'nearest' });
    }, [cursor]);

    const handleHeaderClick = (event, column) => {
        if (!sortable || !column.sortable) return;
        toggleSort(column.key, event.shiftKey);
    };

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.dataTable.loading', 'Loading')} />;
    }

    if (!loading && data.length === 0) {
        if (emptyState) return emptyState;
        return <EmptyState title={emptyTitle} description={emptyMessage} />;
    }

    const multiSort = sorts.length > 1;
    const columnCount = visibleColumns.length + (selectable ? 1 : 0);

    const allSelected = selectable && flatRows.length > 0 && flatRows.every((row) => {
        const key = typeof keyField === 'function' ? keyField(row) : row[keyField];
        return selectedKeys?.includes(key);
    });
    const someSelected = selectable && !allSelected && flatRows.some((row) => {
        const key = typeof keyField === 'function' ? keyField(row) : row[keyField];
        return selectedKeys?.includes(key);
    });

    const renderDataRow = (row) => {
        const key = typeof keyField === 'function' ? keyField(row) : row[keyField];
        const computedRowClass = typeof rowClassName === 'function'
            ? rowClassName(row)
            : rowClassName;
        const rowIndex = rowIndexByKey.get(key) ?? -1;
        const isSelected = selectable && selectedKeys?.includes(key);

        if (renderRow) {
            return renderRow(row, { key, className: computedRowClass });
        }

        return (
            <TableRow
                key={key}
                className={cn(
                    computedRowClass,
                    onRowClick && 'is-clickable',
                    isSelected && 'is-selected',
                    keyboardNav && rowIndex === cursor && 'is-cursor',
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
                {selectable && (
                    <TableCell className="sk-dtable__check" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => onToggleRow?.(key, !!checked)}
                            aria-label={t('app.dataTable.selectRow', 'Select row')}
                        />
                    </TableCell>
                )}
                {visibleColumns.map((column) => (
                    <TableCell
                        key={`${key}-${column.key}`}
                        className={column.cellClassName}
                    >
                        {column.render
                            ? column.render(row)
                            : row[column.key]}
                    </TableCell>
                ))}
            </TableRow>
        );
    };

    return (
        <div className={cn('sk-dtable-wrap', className)} ref={wrapRef}>
            <Table className={cn('sk-dtable', tableClassName)}>
                <TableHeader>
                    <TableRow>
                        {selectable && (
                            <TableHead className="sk-dtable__check">
                                <Checkbox
                                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                                    onCheckedChange={(checked) => onToggleAll?.(!!checked)}
                                    aria-label={t('app.dataTable.selectAllRows', 'Select all rows')}
                                />
                            </TableHead>
                        )}
                        {visibleColumns.map((column, columnIndex) => {
                            const sortIndex = sorts.findIndex((s) => s.key === column.key);
                            const isSorted = sortIndex !== -1;
                            const canSort = sortable && column.sortable;
                            const rule = filters.rules.find((r) => r.field === column.key) || null;
                            const showMenu = columnMenu && !isDecorative(column);
                            return (
                                <TableHead
                                    key={column.key}
                                    className={cn(
                                        column.className,
                                        canSort && 'is-sortable',
                                        isSorted && 'is-sorted',
                                        rule && 'is-filtered',
                                        showMenu && 'has-menu',
                                    )}
                                    style={column.width ? { width: column.width } : undefined}
                                    onClick={(event) => handleHeaderClick(event, column)}
                                    title={canSort ? t('app.dataTable.clickToSortShiftClickTo', 'Click to sort · Shift+click to add a sort level') : undefined}
                                    aria-sort={
                                        isSorted
                                            ? sorts[sortIndex].direction === 'asc'
                                                ? 'ascending'
                                                : 'descending'
                                            : 'none'
                                    }
                                >
                                    <span className="sk-dtable__head-inner">
                                        {typeof column.header === 'string' ? translateLabel(t, column, 'header') : column.header}
                                        {canSort && (
                                            <span className="sk-dtable__sort">
                                                {isSorted && sorts[sortIndex].direction === 'asc' ? (
                                                    <ChevronUp size={14} />
                                                ) : isSorted ? (
                                                    <ChevronDown size={14} />
                                                ) : (
                                                    <ChevronUp size={14} className="sk-dtable__sort-placeholder" />
                                                )}
                                                {isSorted && multiSort && (
                                                    <span className="sk-dtable__sort-priority">{sortIndex + 1}</span>
                                                )}
                                            </span>
                                        )}
                                        {rule && <Filter size={11} className="sk-dtable__filter-mark" />}
                                    </span>
                                    {showMenu && (
                                        <ColumnMenu
                                            column={column}
                                            rows={data}
                                            sortDir={isSorted ? sorts[sortIndex].direction : null}
                                            grouped={groupBy === column.key}
                                            rule={rule}
                                            canMoveLeft={columnIndex > 0}
                                            canMoveRight={columnIndex < visibleColumns.length - 1}
                                            canHide={!!setHiddenKeys && column.hideable !== false}
                                            onSort={canSort ? setSortDirection : undefined}
                                            onToggleGroup={column.groupable ? toggleGroupBy : undefined}
                                            onPutRule={putRule}
                                            onMove={moveColumn}
                                            onHide={hideColumn}
                                            open={openMenu === column.key}
                                            onOpenChange={(open) => setOpenMenu(open ? column.key : null)}
                                        />
                                    )}
                                </TableHead>
                            );
                        })}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {/* Filtered to nothing is NOT the empty state: the header
                        has to stay on screen, because the control that undoes
                        it lives in the header menu. */}
                    {sortedData.length === 0 && data.length > 0 ? (
                        <TableRow className="sk-dtable__nomatch">
                            <TableCell colSpan={columnCount}>
                                <span>{t('app.dataTable.noRowsMatchTheActiveColumn', 'No rows match the active column filters.')}</span>
                                <SharedButton variant="unstyled"
                                    type="button"
                                    onClick={() => setFilters({ match: filters.match, rules: [] })}
                                >
                                    {t('common.actions.clearFilters', 'Clear filters')}
                                </SharedButton>
                            </TableCell>
                        </TableRow>
                    ) : groups
                        ? groups.map((group) => {
                            const isCollapsed = collapsedGroups.has(group.key);
                            const label = groupColumn.groupLabel
                                ? groupColumn.groupLabel(group.value, group.rows)
                                : (group.value ?? 'None');
                            return [
                                <TableRow
                                    key={`group-${group.key}`}
                                    className={cn('sk-dtable__group', isCollapsed && 'is-collapsed')}
                                    onClick={() => toggleGroup(group.key)}
                                >
                                    <TableCell colSpan={columnCount}>
                                        <span className="sk-dtable__group-inner">
                                            <ChevronRight size={14} className="sk-dtable__group-chev" />
                                            <span className="sk-dtable__group-label">{label}</span>
                                            <span className="sk-dtable__group-count">{group.rows.length}</span>
                                        </span>
                                    </TableCell>
                                </TableRow>,
                                ...(isCollapsed ? [] : group.rows.map(renderDataRow)),
                            ];
                        })
                        : sortedData.map(renderDataRow)}
                </TableBody>
            </Table>
            {footer}
        </div>
    );
}

export default DataTable;
