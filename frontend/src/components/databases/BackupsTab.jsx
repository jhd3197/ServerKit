import { useEffect, useState, useMemo, useCallback } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import api from '../../services/api';
import EmptyState from '../EmptyState';
import { useConfirm } from '../../hooks/useConfirm';
import { formatBytes } from '@/utils/formatBytes';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// The backend reports the engine as the bare wire name it derived from the
// filename prefix; these are what the row (and therefore every rule) says.
const ENGINE_LABEL = { mysql: 'MySQL', postgresql: 'PostgreSQL' };

// Built-in saved views. The All / MySQL / PostgreSQL segmented row this replaces
// was a column rule on the engine wearing a segmented control — and it re-asked
// the server for a subset it already had. The list is fetched whole once and
// sliced here, so the presets combine with a search and with each other's sorts.
const NO_RULES = { match: 'all', rules: [] };
const NEWEST_FIRST = [{ key: 'created', direction: 'desc' }];
const PAGE_CLEAR = { search: '' };
const ENGINE_IS = (label, id) => ({
    match: 'all',
    rules: [{ id, field: 'engine', op: 'any', value: [label] }],
});

const BACKUP_VIEWS = [
    {
        // The landing view: everything, most recent dump first, because the
        // backup you care about is almost always the last one taken.
        name: 'All backups',
        state: { sorts: NEWEST_FIRST, hiddenKeys: [], columnFilters: NO_RULES, page: PAGE_CLEAR },
    },
    {
        name: 'MySQL',
        state: { sorts: NEWEST_FIRST, hiddenKeys: ['engine'], columnFilters: ENGINE_IS('MySQL', 'bk1'), page: PAGE_CLEAR },
    },
    {
        name: 'PostgreSQL',
        state: { sorts: NEWEST_FIRST, hiddenKeys: ['engine'], columnFilters: ENGINE_IS('PostgreSQL', 'bk2'), page: PAGE_CLEAR },
    },
    {
        // Disk pressure, which is the other reason anyone opens this tab: the
        // dumps worth pruning are at the top.
        name: 'Largest first',
        state: {
            sorts: [{ key: 'size', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
];

export default function BackupsTab() {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: NEWEST_FIRST,
        storageKey: 'serverkit-table-db-backups-sort',
    });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-db-backups-cols' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getDatabaseBackups();
            setBackups(data.backups || []);
        } catch (err) {
            console.error('Failed to load backups:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function remove(filename) {
        const ok = await confirm({ title: t('app.backupsTab.deleteBackup', 'Delete backup'), message: t('app.backupsTab.deleteBackupThisCannotBeUndone', 'Delete backup "{{filename}}"? This cannot be undone.', { filename: filename }), confirmText: t('app.backupsTab.deleteBackup', 'Delete backup'), variant: 'danger' });
        if (!ok) return;
        try {
            await api.deleteDatabaseBackup(filename);
            load();
        } catch (err) {
            console.error('Failed to delete backup:', err);
        }
    }

    // Every derived column carries BOTH `value` (what the rules, the pick-lists
    // and the export read) and `render` (the cell): `engine` and `created` are
    // not keys on a backup row at all, and `size` is a raw byte count that would
    // otherwise print as nine digits.
    const columns = [
        {
            key: 'database',
            headerKey: 'app.backupsTab.database', header: 'Database',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (b) => b.database || '',
            cellClassName: 'sk-cell-name',
        },
        {
            key: 'engine',
            headerKey: 'app.backupsTab.engine', header: 'Engine',
            sortable: true,
            // Declared, not inferred: a directory holding two MySQL dumps and
            // nothing else fails the enum cardinality test, which would turn the
            // pick-list into a typed fragment and both engine views into no-ops.
            type: 'enum',
            enumOrder: ['MySQL', 'PostgreSQL'],
            value: (b) => ENGINE_LABEL[b.type] || b.type || '',
            sortValue: (b) => ENGINE_LABEL[b.type] || b.type || '',
            render: (b) => (
                <span className={`dbx-engine-tag is-${b.type}`}>{ENGINE_LABEL[b.type] || b.type}</span>
            ),
        },
        {
            key: 'filename',
            headerKey: 'app.backupsTab.file', header: 'File',
            sortable: true,
            type: 'text',
            value: (b) => b.filename || '',
            cellClassName: 'sk-cell-mono',
        },
        {
            key: 'size',
            headerKey: 'common.labels.size', header: 'Size',
            sortable: true,
            type: 'num',
            value: (b) => (typeof b.size === 'number' ? b.size : null),
            sortValue: (b) => (typeof b.size === 'number' ? b.size : null),
            cellClassName: 'sk-cell-dim',
            render: (b) => formatBytes(b.size, { decimals: 2, defaultValue: '0 B' }),
        },
        {
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            // Declared: `sortValue` is epoch ms, and letting that number type the
            // column would offer "is under 1754…" instead of a date picker.
            type: 'date',
            value: (b) => b.created_at || null,
            sortValue: (b) => {
                const parsed = Date.parse(b.created_at || '');
                return Number.isNaN(parsed) ? null : parsed;
            },
            cellClassName: 'sk-cell-dim',
            render: (b) => {
                const parsed = Date.parse(b.created_at || '');
                return Number.isNaN(parsed) ? '—' : new Date(parsed).toLocaleString();
            },
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            className: 'text-right',
            cellClassName: 'dbx-grid-actions',
            render: (b) => (
                <SharedButton variant="unstyled" type="button" className="dbx-icon-btn is-danger" onClick={() => remove(b.filename)} aria-label={t('app.backupsTab.delete', 'Delete {{filename}}', { filename: b.filename })}>
                    <Trash2 size={14} aria-hidden="true" />
                </SharedButton>
            ),
        },
    ];

    const shown = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return backups;
        return backups.filter((b) => (
            (b.database || '').toLowerCase().includes(term)
            || (b.filename || '').toLowerCase().includes(term)
        ));
    }, [backups, search]);

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Scoped to this tab. `urlScope` because the Databases route can have a
    // processes tab and a table's structure open beside this one, and three
    // chrome instances would otherwise fight over the same ?view=/?sort=.
    const chrome = useTableChrome({
        columns,
        rows: shown,
        viewPageKey: 'databases-backups',
        builtinViews: BACKUP_VIEWS,
        urlScope: 'dbbackups',
        noun: 'backups',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.backupsTab.loadingBackups', 'Loading backups…')} />;
    }

    // An empty pane still needs a way to re-check. Returning the EmptyState on
    // its own took the chrome — and with it the only Refresh on this tab — off
    // the screen exactly when the user most wants to press it, because a backup
    // that finished a second ago is the reason the list looks empty.
    if (backups.length === 0) {
        return (
            <div className="dbx-backups">
                <GridViewPicker
                    views={chrome.views}
                    label="backups"
                    onCreate={chrome.createView}
                    actions={<GridToolsMenu {...chrome.toolsProps} onRefresh={load} />}
                />
                <EmptyState
                    icon={Archive}
                    title={t('app.backupsTab.noBackupsYet', 'No backups yet')}
                    description={t('app.backupsTab.backUpADatabaseFromIts', 'Back up a database from its tree menu and it will appear here.')}
                />
            </div>
        );
    }

    return (
        <div className="dbx-backups">
            {/* One row of chrome. This pane lives inside the explorer's own tab
                bar, so it stays inline rather than being hoisted; refresh is in
                the "⋮" with the other table-wide actions. */}
            <GridViewPicker
                views={chrome.views}
                label="backups"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={search}
                            onSearch={setSearch}
                            placeholder={t('app.backupsTab.filterDatabaseOrFile', 'Filter database or file…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {/* Only the SEARCH can empty the pane outright. A column rule that
                matches nothing keeps the table mounted — the header menu that
                undoes it lives in the header. */}
            {shown.length === 0 ? (
                <EmptyState
                    icon={Archive}
                    title={t('app.backupsTab.noMatchingBackups', 'No matching backups')}
                    description={t('app.backupsTab.noBackupMatchesTheCurrentSearch', 'No backup matches the current search.')}
                />
            ) : (
                <DataTable
                    {...chrome.tableProps}
                    columns={chrome.columns}
                    data={shown}
                    keyField="filename"
                    sorts={sorts}
                    onSortsChange={setSorts}
                    className="dbx-pane-scroll"
                    footer={(
                        <DataTableFooter
                            shown={chrome.shownCount}
                            total={backups.length}
                            noun="backup"
                        />
                    )}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
}
