import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Ban, Activity, TimerReset } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { usePolling } from '../../hooks/usePolling';
import EmptyState from '../EmptyState';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { toastError } from '@/utils/errorMessage';

const REFRESH_MS = 5000;
const QUERY_PREVIEW_LEN = 120;

// What the cells render when the engine reports nothing. Real values, not '':
// an empty rule value is dropped before it ever filters, so "db is ''" would
// silently match everything — filtering on the same dash the cell shows keeps
// the rule and the row telling the same story.
const NO_DB = '—';
const IDLE = 'idle';

// A session that has been open for over a minute is either a long query or a
// connection nobody closed; either way it is the row you came here to find.
const LONG_RUNNING_S = 60;

// Built-in saved views. Deliberately none about "active vs idle": MySQL reports
// that in `Command` (Sleep/Query) and PostgreSQL in `state` (idle/active), so a
// preset phrased in either engine's vocabulary would be a no-op on the other.
// Time and database mean the same thing on both.
const NO_RULES = { match: 'all', rules: [] };
const BY_TIME = [{ key: 'time', direction: 'desc' }];
const PAGE_CLEAR = { search: '' };

const PROCESS_VIEWS = [
    {
        name: 'All sessions',
        state: { sorts: BY_TIME, hiddenKeys: [], groupBy: null, columnFilters: NO_RULES, page: PAGE_CLEAR },
    },
    {
        name: 'Long running',
        state: {
            sorts: BY_TIME,
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'pl1', field: 'time', op: 'gt', value: LONG_RUNNING_S }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // Which database is holding the connections — the question a raw
        // processlist makes you count by eye.
        name: 'By database',
        state: { sorts: BY_TIME, hiddenKeys: [], groupBy: 'db', columnFilters: NO_RULES, page: PAGE_CLEAR },
    },
];

function formatTime(s) {
    if (s == null) return '—';
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// Live processlist (SHOW FULL PROCESSLIST / pg_stat_activity) for the selected
// engine or container, with an admin-only kill action and a 5s auto-refresh
// toggle. `active` gates polling so hidden tabs don't keep hammering the API.
export default function ProcessListPanel({ conn, engine, active, isAdmin }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [killing, setKilling] = useState(null);
    const [search, setSearch] = useState('');
    const inFlight = useRef(false);
    const { sorts, setSorts } = useTableSort({
        defaultSorts: BY_TIME,
        storageKey: 'serverkit-table-db-processes-sort',
    });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-db-processes-cols' });
    // Not persisted on its own: a grouping worth keeping is a saved view.
    const [groupBy, setGroupBy] = useState(null);

    const isDocker = conn?.dbType === 'docker';
    const engineKind = isDocker ? (conn.dockerType || 'mysql') : (engine || conn?.dbType);

    const load = useCallback(async (silent = false) => {
        if (inFlight.current) return;
        inFlight.current = true;
        if (!silent) setLoading(true);
        try {
            const d = isDocker
                ? await api.getDockerDbProcesses(conn.container, engineKind, conn.user, conn.password)
                : await api.getHostDbProcesses(engineKind);
            setRows(d.processes || []);
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load processes');
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, [isDocker, engineKind, conn]);

    useEffect(() => { load(); }, [load]);

    usePolling(() => load(true), REFRESH_MS, {
        enabled: active && autoRefresh,
        immediate: false,       // the effect above already loaded once
    });

    async function killProcess(proc) {
        const terminate = engineKind === 'postgresql';
        const owner = proc.user ? ` (${proc.user}${proc.db ? ` on ${proc.db}` : ''})` : '';
        const ok = await confirm({
            title: terminate
                ? t('app.processListPanel.terminateTitle', 'Terminate process {{id}}', { id: proc.id })
                : t('app.processListPanel.killTitle', 'Kill process {{id}}', { id: proc.id }),
            message: terminate
                ? t('app.processListPanel.terminateConfirm', 'Terminate process {{id}}{{owner}}? Its running query is aborted.', { id: proc.id, owner })
                : t('app.processListPanel.killConfirm', 'Kill process {{id}}{{owner}}? Its running query is aborted.', { id: proc.id, owner }),
            confirmText: terminate
                ? t('app.processListPanel.terminateButton', 'Terminate {{id}}', { id: proc.id })
                : t('app.processListPanel.killButton', 'Kill {{id}}', { id: proc.id }),
            variant: 'danger',
        });
        if (!ok) return;
        setKilling(proc.id);
        try {
            if (isDocker) {
                await api.killDockerDbProcess(conn.container, proc.id, engineKind, conn.user, conn.password);
            } else {
                await api.killHostDbProcess(engineKind, proc.id);
            }
            toast.success(terminate
                ? t('app.processListPanel.processTerminated', 'Process {{id}} terminated', { id: proc.id })
                : t('app.processListPanel.processKilled', 'Process {{id}} killed', { id: proc.id }));
            load(true);
        } catch (err) {
            toastError(toast, terminate
                ? t('app.processListPanel.couldntTerminate', "Couldn't terminate process {{id}}.", { id: proc.id })
                : t('app.processListPanel.couldntKill', "Couldn't kill process {{id}}.", { id: proc.id }), err);
        } finally {
            setKilling(null);
        }
    }

    const isPg = engineKind === 'postgresql';

    // `db`, `state`, `time` and `query` all render something the row does not
    // literally hold — a dash, an engine-dependent field, a formatted duration,
    // a truncated preview — so each carries `render` as well as `value`.
    const columns = [
        {
            key: 'id',
            header: 'ID',
            sortable: true,
            hideable: false,
            type: 'num',
            value: (p) => p.id,
            sortValue: (p) => p.id,
            cellClassName: 'sk-cell-mono',
        },
        {
            key: 'user',
            headerKey: 'common.labels.user', header: 'User',
            sortable: true,
            type: 'enum',
            value: (p) => p.user || NO_DB,
            sortValue: (p) => p.user || '',
            render: (p) => p.user || NO_DB,
        },
        {
            key: 'db',
            headerKey: 'app.processListPanel.database', header: 'Database',
            sortable: true,
            // Grouping is the whole point of the "By database" view, and
            // `groupValue` has to be spelled out: the grouper falls back to
            // row[key], which is null for a session not bound to a database.
            groupable: true,
            groupValue: (p) => p.db || NO_DB,
            value: (p) => p.db || NO_DB,
            sortValue: (p) => p.db || '',
            render: (p) => p.db || NO_DB,
        },
        {
            key: 'state',
            header: isPg ? t('app.processListPanel.state', 'State') : t('app.processListPanel.command', 'Command'),
            sortable: true,
            // Declared: a server with two sessions fails the enum cardinality
            // test, and a pick-list is what makes this column useful at all.
            type: 'enum',
            value: (p) => (isPg ? (p.state || NO_DB) : (p.command || p.state || NO_DB)),
            sortValue: (p) => (isPg ? (p.state || '') : (p.command || p.state || '')),
            render: (p) => (
                <span className="dbp-state">
                    {isPg ? (p.state || NO_DB) : (p.command || p.state || NO_DB)}
                </span>
            ),
        },
        {
            key: 'time',
            headerKey: 'common.labels.time', header: 'Time',
            sortable: true,
            // Declared as seconds, not as the "3m 12s" the cell shows: the rule
            // engine has to compare numbers for "Long running" to mean anything.
            type: 'num',
            unit: 's',
            value: (p) => (typeof p.time_s === 'number' ? p.time_s : null),
            sortValue: (p) => (typeof p.time_s === 'number' ? p.time_s : null),
            cellClassName: 'sk-cell-dim',
            render: (p) => formatTime(p.time_s),
        },
        {
            key: 'query',
            headerKey: 'app.processListPanel.query', header: 'Query',
            sortable: false,
            // High cardinality by definition — you type a fragment of a table
            // name, you never pick a whole statement off a list.
            type: 'text',
            value: (p) => p.query || IDLE,
            cellClassName: 'dbp-query',
            render: (p) => (
                <span title={p.query || ''}>
                    {p.query
                        ? (p.query.length > QUERY_PREVIEW_LEN ? `${p.query.slice(0, QUERY_PREVIEW_LEN)}…` : p.query)
                        : <span className="dbp-idle">{IDLE}</span>}
                </span>
            ),
        },
    ];

    if (isAdmin) {
        columns.push({
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            className: 'text-right',
            cellClassName: 'dbp-actions',
            render: (p) => (
                <SharedButton variant="unstyled"
                    type="button"
                    className="dbx-icon-btn is-danger"
                    onClick={() => killProcess(p)}
                    disabled={killing === p.id}
                    aria-label={t('app.processListPanel.killProcess', 'Kill process {{id}}', { id: p.id })}
                    title={isPg ? t('app.processListPanel.terminateBackend', 'Terminate backend') : t('app.processListPanel.killProcess2', 'Kill process')}
                >
                    <Ban size={14} aria-hidden="true" />
                </SharedButton>
            ),
        });
    }

    const shown = useMemo(() => {
        const list = rows || [];
        const term = search.trim().toLowerCase();
        if (!term) return list;
        return list.filter((p) => (
            String(p.id).includes(term)
            || (p.user || '').toLowerCase().includes(term)
            || (p.db || '').toLowerCase().includes(term)
            || (p.query || '').toLowerCase().includes(term)
        ));
    }, [rows, search]);

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Scoped to this tab, and namespaced in the URL: the explorer can hold a
    // processes tab, a backups tab and a table's structure at once, and three
    // chrome instances would otherwise fight over the same ?view=/?sort=.
    const chrome = useTableChrome({
        columns,
        rows: shown,
        // Namespaced by ENGINE, because the same column key does not mean the
        // same thing across them: `state` reads p.command on MySQL ('Sleep',
        // 'Query') and p.state on PostgreSQL ('idle', 'active'). One shared
        // namespace let a view saved against MySQL values apply itself to a
        // PostgreSQL session list and match nothing, which reads as a broken
        // view rather than an inapplicable one.
        viewPageKey: `databases-processes-${engine || 'sql'}`,
        builtinViews: PROCESS_VIEWS,
        // Scoped by connection: the explorer keeps panes mounted, so two open
        // process lists would otherwise write the same ?dbproc.view=.
        urlScope: `dbproc-${conn?.id ?? 'x'}`,
        noun: 'sessions',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    return (
        <div className="dbp">
            {/* One row of chrome. Auto-refresh rides it because it changes what
                the table is showing rather than acting on a row; refresh itself
                is in the "⋮". No process count here — the footer reports it,
                under the rows it is counting. */}
            <GridViewPicker
                views={chrome.views}
                label="sessions"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <label className="dbp-auto">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                            />
                            <TimerReset size={13} aria-hidden="true" /> {t('app.processListPanel.autoRefresh5s', 'Auto-refresh (5s)')}
                        </label>
                        <SearchField
                            value={search}
                            onSearch={setSearch}
                            placeholder={t('app.processListPanel.filterSessions', 'Filter sessions…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={() => load()} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {error ? (
                <div className="dbp-error" role="alert">{error}</div>
            ) : rows && rows.length === 0 ? (
                <div className="dbp-empty">
                    <EmptyState
                        icon={Activity}
                        title={t('app.processListPanel.noProcesses', 'No processes')}
                        description={t('app.processListPanel.noClientSessionsAreCurrentlyConnected', 'No client sessions are currently connected to this server.')}
                    />
                </div>
            ) : shown.length === 0 && !loading ? (
                <div className="dbp-empty">
                    <EmptyState
                        icon={Activity}
                        title={t('app.processListPanel.noMatchingSessions', 'No matching sessions')}
                        description={t('app.processListPanel.noSessionMatchesTheCurrentSearch', 'No session matches the current search.')}
                    />
                </div>
            ) : (
                <DataTable
                    {...chrome.tableProps}
                    columns={chrome.columns}
                    data={shown}
                    keyField="id"
                    loading={loading && !rows}
                    sorts={sorts}
                    onSortsChange={setSorts}
                    groupBy={groupBy}
                    onGroupByChange={setGroupBy}
                    className="dbx-pane-scroll"
                    footer={(
                        <DataTableFooter
                            shown={chrome.shownCount}
                            total={(rows || []).length}
                            // "session", not "process": the footer pluralises by
                            // appending an s, and "processs" is what that gives.
                            noun="session"
                        />
                    )}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
}
