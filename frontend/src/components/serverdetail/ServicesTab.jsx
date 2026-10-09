import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Pill, Drawer, DataTable, DataTableFooter, ListToolbar, SearchField, serviceStatusKind } from '../ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import LogToolbar from '../log-viewer/LogToolbar';
import LogContent from '../log-viewer/LogContent';
import { downloadBlob } from '@/utils/downloadBlob';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Unit log tail cadence while auto-refresh is on.
const LOG_TAIL_MS = 3000;


// Built-in saved views. These are the four buttons that used to sit in the
// toolbar (All / Active / Failed / Inactive) — they narrowed the AGENT query
// (`systemctl --state=…`), which meant every other control on the page was
// reasoning about a partial list. The agent already passes `--all`, so the
// unfiltered response carries every state and the same buckets are exact
// client-side rules over the whole set.
//
// Every rule matches the `state` column's `value`, which is systemd's own
// ACTIVE word — the one the Pill renders.
const NO_RULES = { match: 'all', rules: [] };
const STATE_IS = (id, ...values) => ({
    match: 'all',
    rules: [{ id, field: 'state', op: 'any', value: values }],
});

// Each view clears the search box (`page: { search: '' }`) rather than leaving
// it out: an omitted key means "leave whatever is typed", and the view would
// then read as unsaved the moment it was applied on top of a search.
const SERVICE_VIEWS = [
    {
        // The worklist. A failed unit is the only row on this page that is
        // unambiguously wrong, so it leads.
        name: 'Failed units',
        state: {
            sorts: [{ key: 'unit', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: STATE_IS('sv1', 'failed'),
            page: { search: '' },
        },
    },
    {
        // What is actually up. 'activating' rides along: it is on its way to
        // active, and burying a unit stuck mid-start under "everything else" is
        // how a slow boot gets missed.
        name: 'Running',
        state: {
            sorts: [{ key: 'unit', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: STATE_IS('sv2', 'active', 'activating'),
            page: { search: '' },
        },
    },
    {
        // Installed but not running. On a `--all` listing this is most of the
        // list, and it is the half you scan when something should be up.
        name: 'Inactive',
        state: {
            sorts: [{ key: 'unit', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: STATE_IS('sv3', 'inactive'),
            page: { search: '' },
        },
    },
    {
        // Everything the agent returned, no rules — the "nothing is filtered"
        // answer, and the view a search is usually run against.
        name: 'All units',
        state: {
            sorts: [{ key: 'unit', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
            page: { search: '' },
        },
    },
];

// systemd active/sub state → ds Pill kind comes from the ONE shared
// vocabulary (ds/status).
// The panel host and an agent answer the same question in different
// vocabularies: `/processes/services` probes a fixed list of well-known daemons
// and reports running/stopped, the agent runs `systemctl list-units --all` and
// reports systemd's own ACTIVE word. Normalising the local answer INTO the unit
// shape — rather than teaching the table, the columns and the views two shapes —
// is what lets one component serve both hosts.
const localServiceToUnit = (s) => ({
    unit: s.name,
    active: s.status === 'running' ? 'active' : 'inactive',
    sub: s.status || '',
    pid: s.pid ?? null,
});

// `serverId` absent means the panel host itself (Terminal › Services); a server
// id means a paired agent (Server Detail › Services).
const ServicesTab = ({ serverId = null, serverStatus = 'online' }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const isLocal = !serverId;
    const [units, setUnits] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [busyUnit, setBusyUnit] = useState(null);

    // Local and remote units are the same table but not the same list, so their
    // saved views and column prefs are namespaced apart. Server Detail keeps the
    // keys it already persists under.
    const viewPageKey = isLocal ? 'terminal-services' : 'serverdetail-services';
    const storageKey = isLocal ? 'serverkit-table-terminal-services' : 'serverkit-table-sd-services';
    const { sorts, setSorts } = useTableSort({ storageKey: `${storageKey}-sort` });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: `${storageKey}-cols` });

    // Log drawer state. The unit under inspection plus the viewer preferences
    // the shared LogToolbar drives.
    const [logsFor, setLogsFor] = useState(null);
    const [logText, setLogText] = useState('');
    const [logsLoading, setLogsLoading] = useState(false);
    const [logSearch, setLogSearch] = useState('');
    const [appliedLogSearch, setAppliedLogSearch] = useState('');
    const [logLineCount, setLogLineCount] = useState(200);
    const [logShowLineNumbers, setLogShowLineNumbers] = useState(true);
    const [logWrap, setLogWrap] = useState(true);
    const [logAutoRefresh, setLogAutoRefresh] = useState(false);
    const logContentRef = useRef(null);

    // One unfiltered fetch. The state buckets are column rules now, so asking
    // the agent for a subset would only hide rows from the rules — and from the
    // count next to them.
    const loadUnits = useCallback(async () => {
        setLoading(true);
        try {
            if (isLocal) {
                const data = await api.getServicesStatus();
                setUnits((data?.services || []).map(localServiceToUnit));
            } else {
                const data = await api.getRemoteServices(serverId);
                setUnits(data?.units || []);
            }
        } catch (err) {
            toastError(toast, t('app.servicesTab.failedToLoadServices', "Couldn't load services."), err);
        } finally {
            setLoading(false);
        }
    }, [isLocal, serverId, t, toast]);

    useEffect(() => {
        if (!isLocal && serverStatus !== 'online') {
            setLoading(false);
            return;
        }
        loadUnits();
    }, [isLocal, serverStatus, loadUnits]);

    const filtered = useMemo(() => {
        if (!search.trim()) return units;
        const needle = search.trim().toLowerCase();
        return units.filter((u) => (
            u.unit?.toLowerCase().includes(needle)
            || u.description?.toLowerCase().includes(needle)
        ));
    }, [units, search]);

    // The row the log drawer is describing, read back from the CURRENT list: a
    // start/stop from inside the drawer reloads the units, and a snapshot taken
    // when it opened would keep showing the state you just changed.
    const logsUnit = useMemo(
        () => (logsFor ? units.find((u) => u.unit === logsFor.unit) || logsFor : null),
        [units, logsFor],
    );

    // The page's own half of a saved view. Everything else — sorts, hidden
    // columns, rules — is captured identically on every list page.
    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    async function control(unit, action) {
        // Stopping or restarting a unit takes something down; starting one
        // cannot, so only the first two ask.
        if (action !== 'start') {
            const ok = await confirm({
                title: action === 'stop' ? t('app.servicesTab.stopService', 'Stop service') : t('app.servicesTab.restartService', 'Restart service'),
                message: action === 'stop'
                    ? t('app.servicesTab.stopUnitConfirm', 'Stop {{unit}}?', { unit: unit })
                    : t('app.servicesTab.restartUnitConfirm', 'Restart {{unit}}?', { unit: unit }),
                variant: 'warning',
                confirmText: action === 'stop' ? t('common.actions.stop', 'Stop') : t('common.actions.restart', 'Restart'),
            });
            if (!ok) return;
        }
        setBusyUnit(unit);
        try {
            if (isLocal) await api.controlService(unit, action);
            else await api.controlRemoteService(serverId, unit, action);
            toast.success(action === 'start'
                ? t('app.servicesTab.unitStarted', '{{unit}} started', { unit })
                : action === 'stop'
                    ? t('app.servicesTab.unitStopped', '{{unit}} stopped', { unit })
                    : t('app.servicesTab.unitRestarted', '{{unit}} restarted', { unit }));
            // Refresh state — only the affected row needs a reload but
            // re-fetching the list is simpler and keeps the filter consistent.
            loadUnits();
        } catch (err) {
            toastError(toast, action === 'start'
                ? t('app.servicesTab.couldntStartUnit', "Couldn't start {{unit}}.", { unit })
                : action === 'stop'
                    ? t('app.servicesTab.couldntStopUnit', "Couldn't stop {{unit}}.", { unit })
                    : t('app.servicesTab.couldntRestartUnit', "Couldn't restart {{unit}}.", { unit }), err);
        } finally {
            setBusyUnit(null);
        }
    }

    // `lines` is passed explicitly by the line-count control: the state setter
    // has not landed when the refetch fires, so reading logLineCount there
    // would re-fetch the count the user just moved away from.
    const loadLogs = useCallback(async (unit, { spinner = true, lines } = {}) => {
        const count = lines ?? logLineCount;
        if (spinner) setLogsLoading(true);
        try {
            if (isLocal) {
                const data = await api.getJournalLogs(unit, count);
                setLogText(data?.lines?.join('\n') || '');
            } else {
                const data = await api.getRemoteServiceLogs(serverId, unit, count);
                setLogText((data?.entries || [])
                    .map((e) => (e.priority ? `[${e.priority}] ` : '') + (e.message || ''))
                    .join('\n'));
            }
        } catch (err) {
            setLogText(`Error: ${err.message}`);
        } finally {
            setLogsLoading(false);
        }
    }, [isLocal, serverId, logLineCount]);

    usePolling(
        () => loadLogs(logsFor.unit, { spinner: false }),
        LOG_TAIL_MS,
        { enabled: logAutoRefresh && Boolean(logsFor), immediate: false },
    );

    function openLogs(unit) {
        setLogsFor({ unit });
        setLogSearch('');
        setAppliedLogSearch('');
        setLogText('');
        loadLogs(unit);
    }

    function closeLogs() {
        setLogsFor(null);
        setLogAutoRefresh(false);
        setLogText('');
    }

    async function reloadDaemon() {
        setBusyUnit('__daemon__');
        try {
            await api.reloadRemoteSystemdDaemon(serverId);
            toast.success(t('app.servicesTab.systemctlDaemonReloadCompleted', 'systemctl daemon-reload completed'));
        } catch (err) {
            toastError(toast, t('app.servicesTab.daemonReloadFailed', "Couldn't run daemon-reload."), err);
        } finally {
            setBusyUnit(null);
        }
    }

    function downloadLogs() {
        if (!logText || !logsFor) return;
        downloadBlob(logText, `${logsFor.unit}-${Date.now()}.log`);
    }

    // Units table columns. The table's look is .sk-dtable's; the only page
    // classes left are on cell content (.server-services__desc,
    // .server-services__row-actions).
    //
    // The two hosts do not answer with the same fields: an agent unit carries a
    // description and no PID, the panel host's daemon probe carries a PID and no
    // description. Declaring only the column the payload actually fills is what
    // keeps this from being a column of blanks on one host or the other.
    //
    // Declared above the offline guard: the chrome below is a hook, so it
    // cannot sit behind an early return.
    const unitColumns = [
        {
            key: 'unit',
            headerKey: 'app.servicesTab.unit', header: 'Unit',
            sortable: true,
            hideable: false,
            // Hundreds of distinct names on a real host — a fragment you type,
            // never a list you pick from.
            type: 'text',
            value: (u) => u.unit || '',
            sortValue: (u) => u.unit || '',
            cellClassName: 'sk-cell-mono',
            render: (u) => u.unit,
        },
        {
            key: 'state',
            headerKey: 'common.labels.state', header: 'State',
            sortable: true,
            // Declared, not inferred: systemd's ACTIVE vocabulary is six words
            // wide, but a host where every unit is active offers ONE distinct
            // value and the column would fall back to text — which turns the
            // pick-list into a typed fragment and every view above into a
            // no-op. `value` is what the rules read: the same word the Pill
            // renders, `sub` standing in only when the agent's plain-text
            // fallback left ACTIVE empty.
            type: 'enum',
            enumOrder: ['active', 'activating', 'failed', 'inactive'],
            value: (u) => u.active || u.sub || 'unknown',
            sortValue: (u) => u.active || u.sub || 'unknown',
            render: (u) => (
                <Pill kind={serviceStatusKind(u.active || u.sub)}>
                    {u.active || u.sub || 'unknown'}
                </Pill>
            ),
        },
        ...(isLocal ? [{
            key: 'pid',
            header: 'PID',
            sortable: true,
            type: 'num',
            value: (u) => u.pid ?? null,
            sortValue: (u) => u.pid ?? null,
            cellClassName: 'sk-cell-mono',
            render: (u) => u.pid ?? '—',
        }] : [{
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            type: 'text',
            value: (u) => u.description || '',
            sortValue: (u) => u.description || '',
            cellClassName: 'server-services__desc',
            render: (u) => u.description,
        }]),
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            cellClassName: 'server-services__row-actions',
            render: (u) => (
                <>
                    <Button
                        size="sm" variant="outline"
                        disabled={busyUnit === u.unit}
                        onClick={() => control(u.unit, 'start')}
                    >{t('common.actions.start', 'Start')}</Button>
                    <Button
                        size="sm" variant="outline"
                        disabled={busyUnit === u.unit}
                        onClick={() => control(u.unit, 'stop')}
                    >{t('common.actions.stop', 'Stop')}</Button>
                    <Button
                        size="sm" variant="outline"
                        disabled={busyUnit === u.unit}
                        onClick={() => control(u.unit, 'restart')}
                    >{t('common.actions.restart', 'Restart')}</Button>
                    <Button
                        size="sm" variant="outline"
                        onClick={() => openLogs(u.unit)}
                    >{t('common.labels.logs', 'Logs')}</Button>
                </>
            ),
        },
    ];

    // `rows` is the SEARCHED list — the column rules are applied inside
    // DataTable, and the counts below come back through `chrome.shownCount`.
    // The search box is the page's own state, so it rides `page` in the
    // envelope and a saved view carries it. No `urlScope`: the units table is
    // the only one on this tab, so its links keep the plain ?view= names.
    const chrome = useTableChrome({
        columns: unitColumns,
        rows: filtered,
        viewPageKey,
        builtinViews: SERVICE_VIEWS,
        noun: 'units',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (!isLocal && serverStatus !== 'online') {
        return (
            <div className="empty-state">
                <p>{t('app.servicesTab.serverIsOfflineReconnectToManage', 'Server is offline. Reconnect to manage services.')}</p>
            </div>
        );
    }

    return (
        <div className="server-services">
            {/* The view name is the heading and the table's whole chrome rides
                it: search, the filter button and the "⋮". The toolbar below
                keeps only what belongs to systemd rather than to the table —
                and not Refresh, which is "Refresh data" in the "⋮". */}
            <GridViewPicker
                views={chrome.views}
                label="units"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={search}
                            onSearch={setSearch}
                            placeholder={t('app.servicesTab.filterByUnitName', 'Filter by unit name…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadUnits} />
                    </>
                )}
            />
            {/* daemon-reload is an agent verb; the panel host has no endpoint
                for it, so local gets no toolbar row at all rather than an
                empty one. */}
            {!isLocal && (
                <ListToolbar
                    tools={(
                        <div className="server-services__actions">
                            <Button
                                variant="outline"
                                onClick={reloadDaemon}
                                disabled={busyUnit === '__daemon__'}
                            >
                                {t('app.servicesTab.reloadDaemon', 'Reload daemon')}
                            </Button>
                        </div>
                    )}
                />
            )}

            <GridChips {...chrome.chipProps} />

            {loading ? (
                <p className="text-muted-foreground">{t('common.loading', 'Loading…')}</p>
            ) : filtered.length === 0 ? (
                <p className="text-muted-foreground">{t('app.servicesTab.noMatchingUnits', 'No matching units.')}</p>
            ) : (
                <DataTable
                    columns={chrome.columns}
                    data={filtered}
                    keyField="unit"
                    sorts={sorts}
                    onSortsChange={setSorts}
                    {...chrome.tableProps}
                    emptyTitle="No units match this view."
                    emptyMessage=""
                    footer={(
                        <DataTableFooter
                            shown={chrome.shownCount}
                            total={units.length}
                            noun="unit"
                        />
                    )}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            {/* The shared log viewer, not a <pre> in a modal: the same search,
                line numbers, wrap, live tail and download the Log Files tab
                offers, so a unit's journal is not a lesser surface. */}
            <Drawer
                open={!!logsFor}
                onOpenChange={(open) => { if (!open) closeLogs(); }}
                title={logsUnit?.unit || ''}
                subtitle={logsUnit ? (logsUnit.description || t('app.servicesTab.journalctlU', 'journalctl -u {{unit}}', { unit: logsUnit.unit })) : ''}
                width={620}
                flush
            >
                {logsUnit && (
                    <>
                        <div className="preview-drawer-meta">
                            <div className="meta-item">
                                <span className="meta-label">{t('common.labels.state', 'State')}</span>
                                <span className="meta-value">
                                    {logsUnit.active || logsUnit.sub || 'unknown'}
                                </span>
                            </div>
                            {logsUnit.pid != null && (
                                <div className="meta-item">
                                    <span className="meta-label">PID</span>
                                    <span className="meta-value mono">{logsUnit.pid}</span>
                                </div>
                            )}
                        </div>

                        <div className="preview-drawer-actions">
                            <Button variant="unstyled" type="button"
                                className="drawer-action-btn"
                                onClick={() => control(logsFor.unit, 'start')}
                                disabled={busyUnit === logsFor.unit}
                            >{t('common.actions.start', 'Start')}</Button>
                            <Button variant="unstyled" type="button"
                                className="drawer-action-btn"
                                onClick={() => control(logsFor.unit, 'stop')}
                                disabled={busyUnit === logsFor.unit}
                            >{t('common.actions.stop', 'Stop')}</Button>
                            <Button variant="unstyled" type="button"
                                className="drawer-action-btn"
                                onClick={() => control(logsFor.unit, 'restart')}
                                disabled={busyUnit === logsFor.unit}
                            >{t('common.actions.restart', 'Restart')}</Button>
                        </div>

                        <LogToolbar
                            searchPattern={logSearch}
                            onSearchChange={setLogSearch}
                            onSearchSubmit={() => setAppliedLogSearch(logSearch)}
                            onSearchClear={() => { setLogSearch(''); setAppliedLogSearch(''); }}
                            lineCount={logLineCount}
                            onLineCountChange={(n) => { setLogLineCount(n); loadLogs(logsFor.unit, { lines: n }); }}
                            autoRefresh={logAutoRefresh}
                            onAutoRefreshToggle={() => setLogAutoRefresh(!logAutoRefresh)}
                            showLineNumbers={logShowLineNumbers}
                            onToggleLineNumbers={() => setLogShowLineNumbers(!logShowLineNumbers)}
                            wrapLines={logWrap}
                            onToggleWrap={() => setLogWrap(!logWrap)}
                            isFullscreen={false}
                            onToggleFullscreen={() => {}}
                            onRefresh={() => loadLogs(logsFor.unit)}
                            onDownload={downloadLogs}
                            onClear={() => toast.error(t('app.servicesTab.journalLogsCannotBeTruncatedFrom', 'Journal logs cannot be truncated from the panel.'))}
                            onScrollToBottom={() => {
                                if (logContentRef.current) {
                                    logContentRef.current.scrollTop = logContentRef.current.scrollHeight;
                                }
                            }}
                            canAct={!logsLoading}
                        />

                        <div className="preview-drawer-body">
                            <LogContent
                                ref={logContentRef}
                                live={logAutoRefresh}
                                scrollKey={logsFor.unit}
                                content={logText}
                                loading={logsLoading}
                                emptyMessage={t('app.servicesTab.noLogOutput', 'No log output.')}
                                showLineNumbers={logShowLineNumbers}
                                wrapLines={logWrap}
                                searchPattern={appliedLogSearch}
                            />
                        </div>
                    </>
                )}
            </Drawer>
        </div>
    );
};

export default ServicesTab;
