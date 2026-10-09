import { procUser } from './processData';
import { useCallback, useMemo, useState } from 'react';
import { processStateVariant } from '@/components/ds/status';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';

// Built-in saved views. These are the five chips that used to sit in a second
// toolbar row on Terminal › Processes (All / Running / Sleeping / Stopped /
// Zombie) — every one of them was a rule over the `status` column wearing a
// button's clothes. Written as rules they combine with the search and with any
// column filter, they carry live counts in the picker, and a user can save
// their own slice next to them.
//
// Every rule matches the `status` column's `value`, which is psutil's own
// lowercase status word — the one the Badge renders.
const NO_RULES = { match: 'all', rules: [] };
const STATUS_IS = (id, ...values) => ({
    match: 'all',
    rules: [{ id, field: 'status', op: 'any', value: values }],
});

// Busiest-first is the only ordering that makes a top-N slice meaningful, so
// every view carries it rather than inheriting whatever was clicked last.
const BY_CPU = [{ key: 'cpu', direction: 'desc' }];

const PROCESS_VIEWS = [
    {
        // The worklist. A stopped or zombie process is the only row here that
        // is unambiguously wrong — a zombie is holding a PID its parent never
        // reaped, a stopped one is parked on a signal — so it leads.
        name: 'Stopped & zombie',
        state: {
            sorts: BY_CPU,
            hiddenKeys: [],
            columnFilters: STATUS_IS('pv1', 'stopped', 'zombie'),
            page: { search: '' },
        },
    },
    {
        name: 'Running',
        state: {
            sorts: BY_CPU,
            hiddenKeys: [],
            columnFilters: STATUS_IS('pv2', 'running'),
            page: { search: '' },
        },
    },
    {
        // Almost everything on a healthy box. Worth its own view because it is
        // the half you subtract to see what is actually doing work.
        name: 'Sleeping',
        state: {
            sorts: BY_CPU,
            hiddenKeys: [],
            columnFilters: STATUS_IS('pv3', 'sleeping', 'idle', 'disk-sleep'),
            page: { search: '' },
        },
    },
    {
        name: 'All processes',
        state: {
            sorts: BY_CPU,
            hiddenKeys: [],
            columnFilters: NO_RULES,
            page: { search: '' },
        },
    },
];

// psutil reports the owner as `username`; the per-PID detail endpoint and the
// style-guide fixtures call it `user`. Read both so the column is never blank
// against a real payload.

export function UsageCell({ percent = 0, variant = 'cpu', label }) {
    const clamped = Math.min(Number(percent) || 0, 100);
    return (
        <div className="usage-cell">
            <div className={`usage-bar ${variant}`} style={{ width: `${clamped}%` }} />
            <span>{label ?? `${clamped.toFixed(1)}%`}</span>
        </div>
    );
}

export function ProcessTable({
    processes = [],
    selectedPid = null,
    onSelect,
    onKill,
    onForceKill,
    onRefresh,
    formatMemory = defaultFormatMemory,
    getStatusVariant = defaultGetStatusVariant,
    // Saved views + the one row of chrome are opt-in: the style guide renders
    // the bare table, a real page passes the key its views are stored under.
    viewPageKey,
    // Extra nodes for that SAME chrome row — a host's own data-source controls
    // (Terminal's top-N and live toggle), never a second toolbar underneath.
    actions,
    storageKey = 'serverkit-table-processes',
    // Controlled sort, same contract as DataTable's. Terminal drives it because
    // the endpoint returns a top-N slice and the fetch has to be ordered by
    // whatever the table is ordered by.
    sorts: controlledSorts,
    onSortsChange,
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const internalSort = useTableSort({ storageKey: `${storageKey}-sort`, defaultSorts: BY_CPU });
    const sorts = controlledSorts ?? internalSort.sorts;
    const setSorts = onSortsChange ?? internalSort.setSorts;
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({ storageKey: `${storageKey}-cols` });

    const searched = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return processes;
        return processes.filter((p) => (
            p.name?.toLowerCase().includes(needle)
            || procUser(p).toLowerCase().includes(needle)
            || p.command?.toLowerCase().includes(needle)
            || String(p.pid).includes(needle)
        ));
    }, [processes, search]);

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Every column declares BOTH a `value` (what the rules and the exporter
    // read) and a `render` — none of these cells is a bare row property, and a
    // derived column without a render draws nothing at all.
    const columns = [
        {
            key: 'pid',
            header: 'PID',
            sortable: true,
            type: 'num',
            value: (p) => p.pid,
            sortValue: (p) => p.pid,
            cellClassName: 'sk-cell-mono',
            render: (p) => p.pid,
        },
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            // Hundreds of distinct executables on a real host — a fragment you
            // type, never a list you pick from.
            type: 'text',
            value: (p) => p.name || '',
            sortValue: (p) => p.name || '',
            cellClassName: 'sk-cell-name',
            render: (p) => <div className="process-name"><span>{p.name}</span></div>,
        },
        {
            key: 'user',
            headerKey: 'common.labels.user', header: 'User',
            sortable: true,
            value: procUser,
            sortValue: procUser,
            render: procUser,
        },
        {
            key: 'cpu',
            headerKey: 'app.processTable.cpu', header: 'CPU %',
            sortable: true,
            type: 'num',
            value: (p) => Number(p.cpu_percent) || 0,
            sortValue: (p) => Number(p.cpu_percent) || 0,
            render: (p) => <UsageCell percent={p.cpu_percent} variant="cpu" />,
        },
        {
            key: 'memory',
            headerKey: 'common.labels.memory', header: 'Memory',
            sortable: true,
            type: 'num',
            value: (p) => Number(p.memory_percent) || 0,
            sortValue: (p) => Number(p.memory_percent) || 0,
            // ONE memory column, not the two this table used to declare: the
            // process LIST endpoint carries `memory_percent` only — `memory_info`
            // comes back from the per-PID detail call — so the bytes column
            // rendered a dash on every row of real data. The bar is always the
            // percentage; the label upgrades to bytes when a row has them.
            render: (p) => (
                <UsageCell
                    percent={p.memory_percent}
                    variant="memory"
                    label={p.memory_info?.rss != null ? formatMemory(p.memory_info.rss) : undefined}
                />
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared, not inferred: a box where everything sleeps offers ONE
            // distinct value, the column would fall back to text, and every view
            // above would become a no-op typed-fragment match.
            type: 'enum',
            enumOrder: ['running', 'sleeping', 'idle', 'disk-sleep', 'stopped', 'zombie'],
            value: (p) => p.status || '',
            sortValue: (p) => p.status || '',
            render: (p) => (
                <Badge variant={getStatusVariant(p.status)}>{p.status}</Badge>
            ),
        },
        {
            key: '__actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            render: (p) => (
                <div className="action-buttons">
                     {onKill && (
                        <Button
                            variant="outline"
                            size="icon"
                            className="process-action-button"
                            onClick={(e) => { e.stopPropagation(); onKill(p); }}
                            title={t('app.processTable.kill', 'Kill')}
                            aria-label={t('app.processTable.kill2', 'Kill {{name}}', { name: p.name })}
                        >
                            <X size={12} />
                        </Button>
                    )}
                    {onForceKill && (
                        <Button
                            variant="destructive"
                            size="icon"
                            className="process-action-button"
                            onClick={(e) => { e.stopPropagation(); onForceKill(p); }}
                            title={t('app.processTable.forceKill', 'Force kill')}
                            aria-label={t('app.processTable.forceKill2', 'Force kill {{name}}', { name: p.name })}
                        >
                            <AlertTriangle size={12} />
                        </Button>
                    )}
                </div>
            ),
        },
    ];

    // `rows` is the SEARCHED list — the column rules are applied inside
    // DataTable, and the count below comes back through `chrome.shownCount`.
    const chrome = useTableChrome({
        columns,
        rows: searched,
        viewPageKey,
        builtinViews: PROCESS_VIEWS,
        noun: 'processes',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    const table = (
        <DataTable
            columns={chrome.columns}
            data={searched}
            keyField="pid"
            sorts={sorts}
            onSortsChange={setSorts}
            {...chrome.tableProps}
            onRowClick={(p) => onSelect?.(p)}
            rowClassName={(p) => (selectedPid === p.pid ? 'is-selected' : '')}
            className="processes-table"
            emptyTitle="No processes match this view."
            emptyMessage=""
            footer={(
                <DataTableFooter
                    shown={chrome.shownCount}
                    total={processes.length}
                    noun="process"
                    plural="processes"
                />
            )}
        />
    );

    if (!viewPageKey) return table;

    return (
        <>
            {/* One row of chrome: the view name is the heading, and search, the
                host's own controls, the filter button and the "⋮" ride it. */}
            <GridViewPicker
                views={chrome.views}
                label="processes"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={search}
                            onSearch={setSearch}
                            placeholder={t('app.processTable.filterPidNameCommand', 'Filter PID, name, command…')}
                        />
                        {actions}
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={onRefresh} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {table}

            <GridFilterDrawer {...chrome.drawerProps} />
        </>
    );
}

export function ProcessDetailsPanel({ process, onClose, formatMemory = defaultFormatMemory }) {
    const { t } = useTranslation();
    if (!process) return null;
    return (
        <div className="process-details-panel">
            <div className="panel-header">
                <h3>{t('app.processTable.processDetails', 'Process details')}</h3>
                <Button variant="outline" size="sm" onClick={onClose}>{t('common.actions.close', 'Close')}</Button>
            </div>
            <div className="panel-body">
                <div className="details-grid">
                    <DetailItem label="PID" value={process.pid} mono />
                    <DetailItem label={t('common.labels.name', 'Name')} value={process.name} />
                    <DetailItem label={t('common.labels.user', 'User')} value={procUser(process)} />
                    <DetailItem label={t('common.labels.status', 'Status')} value={process.status} />
                    <DetailItem label="CPU" value={`${(process.cpu_percent || 0).toFixed(2)}%`} />
                    <DetailItem label={t('common.labels.memory', 'Memory')} value={formatMemory(process.memory_info?.rss)} />
                    <DetailItem label={t('app.processTable.threads', 'Threads')} value={process.num_threads} />
                    <DetailItem
                        label={t('common.labels.created', 'Created')}
                        value={process.create_time ? new Date(process.create_time * 1000).toLocaleString() : '-'}
                    />
                </div>
                {process.command && (
                    <div className="command-line">
                        <span className="detail-label">{t('common.labels.command', 'Command')}</span>
                        <code>{process.command}</code>
                    </div>
                )}
            </div>
        </div>
    );
}

export function DetailItem({ label, value, mono = false, children }) {
    const valueClass = ['detail-value', mono && 'mono'].filter(Boolean).join(' ');
    return (
        <div className="detail-item">
            <span className="detail-label">{label}</span>
            {children ?? <span className={valueClass}>{value}</span>}
        </div>
    );
}

function defaultFormatMemory(bytes) {
    if (!bytes) return '-';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}

function defaultGetStatusVariant(status) {
    return processStateVariant(status);
}

export default ProcessTable;
