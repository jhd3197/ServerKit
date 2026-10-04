import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Folder, Plus, RefreshCw, Server as ServerLucideIcon, X } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
    DataTable, DataTableFooter, Drawer, Gauge, Pill, SearchField, statusKind,
} from '@/components/ds';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useConfirm } from '@/hooks/useConfirm';
import CopyField from '../components/CopyField';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import useFocusParam from '@/hooks/useFocusParam';
import LinkPanelForm from '../components/servers/LinkPanelForm';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n/t';

// Radix Select items cannot use '' — stands in for "no group".
const NO_GROUP = '__none';

// Status -> Pill tone. `connecting` and `pending` both mean "not reporting
// yet" but for different reasons (handshake in flight vs agent never
// installed), so they stay distinct rather than folding into one bucket.
// Built-in saved views. States only use real column keys (SERVER_COLUMNS) —
// there is no separate status segment or group select any more; the Status and
// Group columns' own menus are the one place the fleet is narrowed, and they
// carry live per-value counts neither control had.
//
// NOTE for anyone adding a metric preset: only ever use `gt` on cpu/memory/disk.
// Their sortValue is null for a non-live row, and a `lt` rule would match every
// offline and pending server (see the null guard in ds/grid/fields.js).
const STATUS = (...value) => ({ match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value }] });
const NO_RULES = { match: 'all', rules: [] };

const SERVER_BUILTIN_VIEWS = [
    { name: 'Online', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: STATUS('online') } },
    { name: 'Offline', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: STATUS('offline') } },
    { name: 'By CPU', state: { search: '', sorts: [{ key: 'cpu', direction: 'desc' }], hiddenKeys: [], columnFilters: NO_RULES } },
    {
        // Machines that HAVE an agent but stopped answering, longest silence
        // first. `pending` is excluded — that means nobody ever installed one.
        // CPU/Memory/Disk are hidden because no row here is live, so all three
        // would render an em-dash.
        name: 'Not reporting',
        state: {
            search: '', groupBy: null,
            sorts: [{ key: 'lastSeen', direction: 'asc' }],
            hiddenKeys: ['cpu', 'memory', 'disk'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'nr1', field: 'status', op: 'any', value: ['offline', 'connecting'] }],
            },
        },
    },
    {
        // Saturated on EITHER axis — a box swapping at 95% memory with calm CPU
        // is the one that falls over, so match:any rather than all.
        //
        // No `status is online` rule here, deliberately: `match` is per VIEW,
        // not per rule, so adding one to an `any` list would OR it in and widen
        // the view to every online server. It is not needed — the metrics are
        // null on a non-live row and `gt` rejects null, so both rules already
        // only ever match a reporting machine.
        name: 'Under load',
        state: {
            search: '', groupBy: null, hiddenKeys: [],
            sorts: [{ key: 'cpu', direction: 'desc' }],
            columnFilters: {
                match: 'any',
                rules: [
                    { id: 'ul1', field: 'cpu', op: 'gt', value: 85 },
                    { id: 'ul2', field: 'memory', op: 'gt', value: 90 },
                ],
            },
        },
    },
    {
        // The one fleet metric that never recovers on its own.
        name: 'Disk pressure',
        state: {
            search: '', groupBy: null,
            sorts: [{ key: 'disk', direction: 'desc' }],
            hiddenKeys: ['agent', 'cpu', 'memory'],
            columnFilters: {
                match: 'all',
                rules: [
                    { id: 'dp0', field: 'status', op: 'any', value: ['online'] },
                    { id: 'dp1', field: 'disk', op: 'gt', value: 85 },
                ],
            },
        },
    },
    {
        // Fleet commands target a group_id, so an ungrouped server is silently
        // skipped by every bulk action. This view is the worklist that fixes it.
        // 'Ungrouped' is the Group column's own label for a null group_name,
        // not a sentinel — see the `value` accessor on that column.
        name: 'Ungrouped',
        state: {
            search: '', groupBy: null, hiddenKeys: [],
            sorts: [{ key: 'name', direction: 'asc' }],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ug1', field: 'group', op: 'any', value: ['Ungrouped'] }],
            },
        },
    },
];

const formatLastSeen = (timestamp) => {
    if (!timestamp) return 'Never';
    const diff = (Date.now() - new Date(timestamp).getTime()) / 1000;
    if (Number.isNaN(diff)) return 'Never';
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(timestamp).toLocaleDateString();
};

const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0));

const isLive = (server) => Boolean(server.metrics) && (server.status || 'pending') === 'online';

// One metric column (CPU / Memory / Disk): a percentage over a thin gauge.
// A gauge with nothing behind it reads as 0%, which is a claim — offline and
// pending rows get a dash instead, and sort as null (always last).
const meterColumn = (key, header, metricKey) => ({
    key,
    header,
    sortable: true,
    sortValue: (server) => (isLive(server) ? clamp(server.metrics?.[metricKey]) : null),
    className: 'servers-table__meter',
    cellClassName: 'servers-table__meter',
    render: (server) => {
        if (!isLive(server)) return <span className="servers-row__nodata">&mdash;</span>;
        const value = clamp(server.metrics?.[metricKey]);
        return (
            <>
                <div className="sk-cell-mono">{value.toFixed(0)}%</div>
                <Gauge value={value} />
            </>
        );
    },
});

// Columns for the shared DataTable. Cell markup and classNames are identical
// to the hand-rolled table they replace, so _servers.scss keeps applying
// (.sk-cell-name, .sk-cell-mono, .servers-row__*, .servers-table__meter).
const SERVER_COLUMNS = [
    {
        key: 'name',
        headerKey: 'common.labels.server', header: 'Server',
        sortable: true,
        hideable: false,
        sortValue: (server) => server.name || '',
        render: (server) => (
            <div className="sk-cell-name">
                <span className="servers-row__ico">
                    <ServerLucideIcon size={15} />
                </span>
                <span>
                    <div>{server.name}</div>
                    <div className="sk-cell-sub">
                        {[server.group_name, server.os_version || server.os_type]
                            .filter(Boolean).join(' \u00b7 ') || 'unclaimed'}
                    </div>
                </span>
            </div>
        ),
    },
    {
        key: 'host',
        headerKey: 'app.servers.host', header: 'Host',
        cellClassName: 'sk-cell-mono',
        render: (server) => server.hostname || server.ip_address || '\u2014',
    },
    {
        key: 'agent',
        headerKey: 'app.servers.agent', header: 'Agent',
        cellClassName: 'sk-cell-mono servers-row__agent',
        render: (server) => server.agent_version || 'not installed',
    },
    {
        key: 'group',
        headerKey: 'app.servers.group', header: 'Group',
        sortable: true,
        type: 'enum',
        // An ungrouped server needs a real LABEL, not null: the enum engine
        // compares String(value), so a null would only ever be matchable as the
        // literal string 'null'. This label is what the "Ungrouped" preset
        // filters on, and what the column menu lists.
        value: (server) => server.group_name || 'Ungrouped',
        groupable: true,
        render: (server) => (
            server.group_name || <span className="servers-row__nodata">{t('app.servers.ungrouped', 'Ungrouped')}</span>
        ),
    },
    {
        key: 'status',
        headerKey: 'common.labels.status', header: 'Status',
        sortable: true,
        type: 'enum',
        // Explicit, rather than leaning on the sortValue fallback: this pins
        // the null -> 'pending' coercion as the FILTER value too, so a server
        // that never reported does not stringify to 'null' in a rule.
        value: (server) => server.status || 'pending',
        sortValue: (server) => server.status || 'pending',
        groupable: true,
        groupLabel: (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'None'),
        render: (server) => {
            const status = server.status || 'pending';
            return <Pill kind={statusKind(status)}>{status}</Pill>;
        },
    },
    meterColumn('cpu', 'CPU', 'cpu_percent'),
    meterColumn('memory', 'Memory', 'memory_percent'),
    meterColumn('disk', 'Disk', 'disk_percent'),
    {
        key: 'lastSeen',
        headerKey: 'app.servers.lastSeen', header: 'Last seen',
        sortable: true,
        sortValue: (server) => (server.last_seen ? new Date(server.last_seen).getTime() : null),
        cellClassName: 'sk-cell-mono servers-row__seen',
        render: (server) => formatLastSeen(server.last_seen),
    },
    {
        key: 'open',
        header: '',
        sortable: false,
        hideable: false,
        render: () => <ChevronRight size={16} className="servers-row__chev" />,
    },
];

// The fleet as one table. The previous layout wrapped this list in a rail of
// its own: a health dial, a status nav and a groups nav, each restating a
// number the table already carries. Every one of those is now a column or a
// filter, and per-row actions moved to the server's own page, which is where
// rebooting or deleting a machine belongs.
const Servers = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [servers, setServers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    // Quick-create deep link: /servers?focus=create:server opens the add modal.
    useFocusParam('create', () => setShowAddModal(true));
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-servers-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-servers-cols' });
    const [groupBy, setGroupBy] = useState(() => {
        try {
            return window.localStorage.getItem('serverkit-table-servers-group') || null;
        } catch {
            return null;
        }
    });
    const toast = useToast();

    const changeGroupBy = (next) => {
        setGroupBy(next);
        try {
            if (next) window.localStorage.setItem('serverkit-table-servers-group', next);
            else window.localStorage.removeItem('serverkit-table-servers-group');
        } catch {
            /* private mode / quota — the choice just doesn't persist */
        }
    };

    // Page-owned view state — search is all that is left. Status and group used
    // to live here too, as a segment row and a select; both are column rules
    // now, which useTableChrome captures itself.
    const viewPageState = useMemo(() => ({ search: searchTerm }), [searchTerm]);

    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearchTerm(saved.search);
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [serversData, groupsData] = await Promise.all([
                api.getServers(),
                api.getServerGroups(),
            ]);
            setServers(Array.isArray(serversData) ? serversData : []);
            setGroups(Array.isArray(groupsData) ? groupsData : []);
        } catch (err) {
            console.error('Failed to load servers:', err);
            toast.error(t('app.servers.failedToLoadServers', 'Failed to load servers'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const filteredServers = servers.filter((server) => {
        const q = searchTerm.trim().toLowerCase();
        return !q
            || server.name?.toLowerCase().includes(q)
            || server.hostname?.toLowerCase().includes(q)
            || server.ip_address?.toLowerCase().includes(q)
            || server.group_name?.toLowerCase().includes(q);
    });

    // The tab-group top bar owns this page's controls, search included.
    useTopbarActions(() => (
        <>
            <Button variant="outline" size="sm" onClick={() => setShowGroupModal(true)}>
                <Folder size={16} /> {t('app.servers.groups', 'Groups')}
            </Button>
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                <RefreshCw size={16} className={loading ? 'spin' : ''} /> {t('app.servers.sync', 'Sync')}
            </Button>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
                <Plus size={16} /> {t('app.servers.addServer', 'Add server')}
            </Button>
            <SearchField
                value={searchTerm}
                onSearch={setSearchTerm}
                placeholder={t('app.servers.searchServers', 'Search servers…')}
            />
        </>
    ), [searchTerm, loading]);

    const chrome = useTableChrome({
        columns: SERVER_COLUMNS,
        rows: filteredServers,
        viewPageKey: 'servers',
        builtinViews: SERVER_BUILTIN_VIEWS,
        noun: 'servers',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy: changeGroupBy,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    // Filter + "⋮" ride in the top bar next to the actions and the search box,
    // not in a toolbar under the view name. That toolbar was also repeating the
    // row count the view row already showed, with an "N online" tacked on that
    // no filter, sort or view ever referred to.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={loadData} />
        </>,
    );

    if (loading) {
        return (
            <div className="sk-tabgroup__inner servers-page">
                <EmptyState loading loadingVariant="table" title={t('app.servers.scanningFleet', 'Scanning fleet…')} />
            </div>
        );
    }

    return (
        <div className="sk-tabgroup__inner servers-page" data-walkthrough="server-list">
            {topbarChrome}
            <GridViewPicker
                views={chrome.views}
                label="servers"
                onCreate={chrome.createView}
            
                actions={chromeActions}
            />

            <GridChips {...chrome.chipProps} />

            {filteredServers.length === 0 ? (
                <EmptyState
                    icon={ServerLucideIcon}
                    title={servers.length === 0 ? t('app.servers.noServersYet', 'No servers yet') : t('app.servers.noServersMatchTheseFilters', 'No servers match these filters')}
                    description={servers.length === 0
                        ? t('app.servers.pairAnAgentAndTheMachine', 'Pair an agent and the machine shows up here with its CPU, memory and disk alongside every other box you run.')
                        : t('app.servers.adjustTheSearchOrClearThe', 'Adjust the search or clear the column filters to see your servers.')}
                    action={servers.length === 0 ? (
                        <Button onClick={() => setShowAddModal(true)}>
                            <Plus size={16} /> {t('app.servers.addYourFirstServer', 'Add your first server')}
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            onClick={() => {
                                setSearchTerm('');
                                chrome.api.resetToView();
                            }}
                        >
                            {t('common.actions.clearFilters', 'Clear filters')}
                        </Button>
                    )}
                />
            ) : (
                <DataTable
                    columns={chrome.columns}
                    data={filteredServers}
                    keyField="id"
                    sorts={sorts}
                    onSortsChange={setSorts}
                    {...chrome.tableProps}
                    groupBy={groupBy}
                    onGroupByChange={changeGroupBy}
                    selectable
                    selectedKeys={[...selectedIds]}
                    onToggleRow={(id, checked) => setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(id);
                        else next.delete(id);
                        return next;
                    })}
                    onToggleAll={(checked) => setSelectedIds(
                        checked ? new Set(filteredServers.map((s) => s.id)) : new Set(),
                    )}
                    keyboardNav
                    onRowClick={(server) => navigate(`/servers/${server.id}`)}
                    rowClassName="servers-row"
                    className="servers-card"
                    tableClassName="servers-table"
                    footer={(
                        <DataTableFooter
                            shown={chrome.shownCount}
                            total={servers.length}
                            noun="server"
                        />
                    )}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            {/* Bulk edit: assign the selected servers to a group. */}
            {selectedIds.size > 0 && (
                <div className="sk-bulkbar" role="status">
                    <span className="sk-bulkbar__count">{selectedIds.size} selected</span>
                    <div className="sk-bulkbar__actions">
                        {/* An action, not a setting: the trigger always reads "Set group…". */}
                        <Select
                            value=""
                            disabled={bulkBusy}
                            onValueChange={async (groupId) => {
                                if (!groupId) return;
                                setBulkBusy(true);
                                try {
                                    await Promise.all([...selectedIds].map((id) => api.updateServer(id, {
                                        group_id: groupId === 'none' ? null : Number(groupId),
                                    })));
                                    const groupName = groupId === 'none'
                                        ? 'Ungrouped'
                                        : groups.find((g) => String(g.id) === groupId)?.name;
                                    toast.success(t('app.servers.movedServerSTo', 'Moved {{size}} server(s) to {{groupName}}', { size: selectedIds.size, groupName: groupName }));
                                    setSelectedIds(new Set());
                                    loadData();
                                } catch (err) {
                                    toast.error(err.message || t('app.servers.couldNotSetTheGroup', 'Could not set the group'));
                                } finally {
                                    setBulkBusy(false);
                                }
                            }}
                        >
                            <SelectTrigger
                                className="servers-bulk-group"
                                aria-label={t('app.servers.setGroupForSelectedServers', 'Set group for selected servers')}
                            >
                                <SelectValue placeholder={t('app.servers.setGroup', 'Set group…')} />
                            </SelectTrigger>
                            <SelectContent>
                                {groups.map((g) => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                                <SelectItem value="none">{t('app.servers.ungrouped', 'Ungrouped')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Button variant="unstyled"
                        type="button"
                        className="sk-bulkbar__clear"
                        onClick={() => setSelectedIds(new Set())}
                        aria-label={t('app.servers.clearSelection', 'Clear selection')}
                    >
                        <X size={14} />
                    </Button>
                </div>
            )}

            {showAddModal && (
                <AddServerModal
                    groups={groups}
                    onClose={() => setShowAddModal(false)}
                    onCreated={() => {
                        setShowAddModal(false);
                        loadData();
                    }}
                />
            )}

            {showGroupModal && (
                <ManageGroupsModal
                    groups={groups}
                    onClose={() => setShowGroupModal(false)}
                    onUpdated={loadData}
                />
            )}
        </div>
    );
};

const PairAgentForm = ({ groups, onClose, onClaimed }) => {
    const { t } = useTranslation();
    const [pairCode, setPairCode] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [name, setName] = useState('');
    const [groupId, setGroupId] = useState('');
    const [lookupResult, setLookupResult] = useState(null);
    const [lookupError, setLookupError] = useState('');
    const [claimError, setClaimError] = useState('');
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    const formattedCode = pairCode
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '')
        .replace(/[01OIL]/g, '')
        .slice(0, 6);

    // Auto-lookup as soon as the user finishes typing all 6 characters.
    // Avoids showing "must be 6 chars" while the user is still mid-entry or
    // just clicking around — the previous onBlur trigger fired too eagerly.
    useEffect(() => {
        if (formattedCode.length !== 6) return;
        let cancelled = false;
        setLookupError('');
        setLoading(true);
        api.lookupPairCode(formattedCode)
            .then((res) => {
                if (cancelled) return;
                setLookupResult(res);
                // Prefer the operator-set display name (entered in the agent's
                // wizard) over the raw hostname. Falls back to hostname when
                // the agent didn't supply one.
                const suggestedName = res.system_info?.display_name
                    || res.system_info?.hostname;
                if (!name && suggestedName) setName(suggestedName);
            })
            .catch((err) => {
                if (cancelled) return;
                setLookupError(err.message || 'Pair code not found');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formattedCode]);

    async function handleClaim(e) {
        e.preventDefault();
        setClaimError('');
        // Trim before validating: copy/paste from the agent screen sometimes
        // catches a trailing space, which used to silently fail the claim.
        const cleanPass = passphrase.trim();
        if (!cleanPass) {
            setClaimError('Passphrase is required');
            return;
        }
        setLoading(true);
        try {
            await api.claimPairedAgent({
                pair_code: formattedCode,
                passphrase: cleanPass,
                name: name || undefined,
                group_id: groupId || undefined,
                trust_fingerprint: true
            });
            toast.success(t('app.servers.agentPairedSuccessfully', 'Agent paired successfully'));
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'server-paired' },
            }));
            onClaimed();
        } catch (err) {
            const status = err.status || err.response?.status;
            if (status === 429) {
                setClaimError('Too many attempts. Wait a few minutes, or re-open the agent wizard to start a new pairing.');
            } else if (status === 401) {
                setClaimError('Pair code or passphrase is wrong. Check both values exactly as shown on the agent screen.');
            } else {
                setClaimError(err.message || 'Failed to claim agent');
            }
        } finally {
            setLoading(false);
        }
    }

    function formatDisplay(code) {
        if (!code) return '------';
        return code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
    }

    return (
        <form className="server-setup-form" onSubmit={handleClaim}>
            <div className="server-setup-form__body">
                <div className="pair-instructions">
                    <p>
                        {t('app.servers.onTheTargetMachineStartThe', 'On the target machine, start the agent. It will display a 6-character pair code and a passphrase — enter both below.')}
                    </p>
                </div>

                <div className="form-group">
                    <label>{t('app.servers.pairCode', 'Pair code')}</label>
                    <Input
                        type="text"
                        value={formatDisplay(formattedCode)}
                        onChange={(e) => {
                            setPairCode(e.target.value);
                            setLookupResult(null);
                            setLookupError('');
                        }}
                        placeholder={t('app.servers.abc123', 'ABC-123')}
                        autoFocus
                        autoComplete="off"
                        spellCheck={false}
                        className="server-pair-code"
                        required
                    />
                    <span className="form-hint">{t('app.servers.theCodeIsShownInThe', 'The code is shown in the terminal output or system tray.')}</span>
                    {lookupError && <div className="error-message server-pair-error">{lookupError}</div>}
                </div>

                {lookupResult && (
                    <div className="success-banner server-pair-banner">
                        <div>
                            <strong>{t('app.servers.agentFound', 'Agent found')}</strong>
                            <p className="success-subtitle">
                                {lookupResult.system_info?.display_name && (
                                    <>{t('app.servers.server2', 'Server:')} <code>{lookupResult.system_info.display_name}</code><br /></>
                                )}
                                {t('app.servers.hostname', 'Hostname:')} <code>{lookupResult.system_info?.hostname || 'unknown'}</code><br />
                                {t('app.servers.fingerprint', 'Fingerprint:')} <code className="server-pair-fpr">{lookupResult.pubkey_fpr}</code>
                            </p>
                            <p className="text-muted server-pair-note">
                                {t('app.servers.confirmThisFingerprintMatchesTheOne', 'Confirm this fingerprint matches the one shown by the agent before continuing.')}
                            </p>
                        </div>
                    </div>
                )}

                <div className="form-group">
                    <label>{t('app.servers.passphrase', 'Passphrase *')}</label>
                    <Input
                        type="text"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder={t('app.servers.shownOnTheAgentSPairing', 'Shown on the agent\'s pairing screen')}
                        autoComplete="off"
                        spellCheck={false}
                        className="server-pair-passphrase"
                        required
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>{t('app.servers.serverName', 'Server name')}</label>
                        <Input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={lookupResult?.system_info?.hostname || t('app.servers.autoDetectedFromAgentOptional', 'Auto-detected from agent (optional)')}
                        />
                        <span className="form-hint">{t('app.servers.leaveBlankToUseTheAgent', 'Leave blank to use the agent\'s hostname.')}</span>
                    </div>
                    <div className="form-group">
                        <label htmlFor="pair-group">{t('app.servers.group', 'Group')}</label>
                        <Select
                            value={groupId === '' ? NO_GROUP : String(groupId)}
                            onValueChange={(v) => setGroupId(v === NO_GROUP ? '' : v)}
                        >
                            <SelectTrigger id="pair-group"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_GROUP}>{t('app.servers.noGroup', 'No Group')}</SelectItem>
                                {groups.map(g => (
                                    <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {claimError && <div className="error-message">{claimError}</div>}
            </div>

            <div className="modal-actions">
                <Button type="button" variant="outline" onClick={onClose}>
                    {t('common.actions.cancel', 'Cancel')}
                </Button>
                <Button type="submit" disabled={loading || formattedCode.length !== 6}>
                    {loading ? 'Pairing…' : 'Pair Agent'}
                </Button>
            </div>
        </form>
    );
};

// Token-lifetime presets shown in the "Add Server" expiry dropdown. The value
// is in seconds; -1 is a sentinel for "never" (the backend turns it into a
// far-future date). Default is 7 days — long enough to set up later that
// evening, short enough that an abandoned string doesn't linger forever as a
// usable bearer credential.
const EXPIRY_OPTIONS = [
    { labelKey: 'app.servers.1Hour', label: '1 hour',  value: 60 * 60 },
    { labelKey: 'app.servers.24Hours', label: '24 hours', value: 24 * 60 * 60 },
    { labelKey: 'app.servers.7Days', label: '7 days',  value: 7 * 24 * 60 * 60 },
    { labelKey: 'app.servers.30Days', label: '30 days', value: 30 * 24 * 60 * 60 },
    { labelKey: 'app.servers.never', label: 'Never',   value: -1 },
];
const DEFAULT_EXPIRY = 7 * 24 * 60 * 60;

const AddServerModal = ({ groups, onClose, onCreated }) => {
    const { t } = useTranslation();
    const [mode, setMode] = useState('install');
    const [step, setStep] = useState(1);
    const [groupId, setGroupId] = useState('');
    const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRY);
    const [registrationData, setRegistrationData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleCreateServer(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // The backend now derives the server name from the agent's
            // hostname on /register, so we just send what the user can
            // actually pick: the token's lifetime and (optionally) which
            // group the row should land in.
            const result = await api.createServer({
                expires_in: expiresIn,
                group_id: groupId || undefined,
            });
            setRegistrationData(result);
            setStep(2);
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'server-connection-string-generated' },
            }));
        } catch (err) {
            setError(err.message || 'Failed to create server');
        } finally {
            setLoading(false);
        }
    }

    const connectionString = registrationData?.connection_string || '';
    // Download, then run — deliberately not `curl … | sudo bash`. In a pipe the
    // shell reports bash's status, not curl's, so a failed download exits 0:
    // the operator sees one line of curl noise, the shell says success, and
    // nothing was installed. The `&&` makes a failed fetch stop the command and
    // surface curl's non-zero exit (issue #101).
    const linuxInstallScript = registrationData ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh && \\
  sudo bash /tmp/serverkit-agent-install.sh \\
  --server "${window.location.origin}" \\
  --token "${registrationData.registration_token}"` : '';

    const windowsInstallScript = registrationData ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${registrationData.registration_token}"` : '';

    // A right-side drawer, not a centred dialog: this flow is a multi-step
    // wizard with install scripts in it, and it always was a drawer — the
    // `.server-setup-drawer` rules carry the original slide-over intent.
    // Rendering them through the centred Dialog primitive left `left: 50%` and
    // the -50% transform applied on top of `right: 0`, which is what pushed the
    // panel half off-screen.
    const title = step === 1
        ? (mode === 'link' ? 'Link to Master Panel' : 'Add Server')
        : (mode === 'pair' ? 'Pair Agent' : 'Connect Agent');
    const subtitle = step === 1 && mode === 'link'
        ? 'Make THIS server manageable by another ServerKit panel'
        : step === 2 && mode !== 'pair'
            ? 'Paste the connection string into the agent'
            : step === 2
                ? 'Enter the code shown on the agent screen'
                : 'Connect an existing agent, or set up a new machine';

    return (
        <Drawer
            flush
            open
            onOpenChange={(next) => { if (!next) onClose(); }}
            title={title}
            subtitle={subtitle}
            icon={<ServerLucideIcon size={17} />}
            width={520}
            className="server-setup-drawer"
        >
                {step === 1 && (
                    <div className="mode-switcher" data-walkthrough="server-setup">
                        <Button variant="unstyled"
                            type="button"
                            className={`mode-switcher__tab${mode === 'install' ? ' is-active' : ''}`}
                            onClick={() => setMode('install')}
                        >
                            {t('app.servers.connectionString', 'Connection string')}
                        </Button>
                        <Button variant="unstyled"
                            type="button"
                            className={`mode-switcher__tab${mode === 'pair' ? ' is-active' : ''}`}
                            onClick={() => setMode('pair')}
                        >
                            {t('app.servers.pairCode', 'Pair code')}
                        </Button>
                        <Button variant="unstyled"
                            type="button"
                            className={`mode-switcher__tab${mode === 'link' ? ' is-active' : ''}`}
                            onClick={() => setMode('link')}
                        >
                            {t('app.servers.linkPanel', 'Link panel')}
                        </Button>
                    </div>
                )}

                {step === 1 && mode === 'link' ? (
                    <LinkPanelForm onClose={onClose} />
                ) : step === 1 && mode === 'pair' ? (
                    <PairAgentForm
                        groups={groups}
                        onClose={onClose}
                        onClaimed={onCreated}
                    />
                ) : step === 1 ? (
                    <form className="server-setup-form" onSubmit={handleCreateServer} data-walkthrough="server-generate-connection">
                        <div className="server-setup-form__body">
                            {error && <div className="error-message">{error}</div>}

                            <p className="section-description">
                                {t('app.servers.generateASingleConnectionStringPaste', 'Generate a single connection string. Paste it into the agent\'s pairing wizard, or use it with the one-liner installer. The agent\'s hostname becomes the server name on first connect — you can rename it later from the server\'s Settings tab.')}
                            </p>

                            <div className="form-row">
                                <div className="form-group">
                                    <label htmlFor="add-server-group">{t('app.servers.group', 'Group')}</label>
                                    <Select
                                        value={groupId === '' ? NO_GROUP : String(groupId)}
                                        onValueChange={(v) => setGroupId(v === NO_GROUP ? '' : v)}
                                    >
                                        <SelectTrigger id="add-server-group"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={NO_GROUP}>{t('app.servers.noGroup', 'No Group')}</SelectItem>
                                            {groups.map(group => (
                                                <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="form-group">
                                    <label htmlFor="add-server-expiry">{t('app.servers.tokenExpires', 'Token expires')}</label>
                                    <Select
                                        value={String(expiresIn)}
                                        onValueChange={(v) => setExpiresIn(Number(v))}
                                    >
                                        <SelectTrigger id="add-server-expiry"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {EXPIRY_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="form-hint">{t('app.servers.singleUseBurnedTheMomentAn', 'Single-use. Burned the moment an agent registers with it.')}</span>
                                </div>
                            </div>
                        </div>

                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={onClose}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button type="submit" disabled={loading}>
                                {loading ? 'Generating…' : 'Generate Connection String'}
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="install-instructions">
                        <div className="install-instructions__scroll">
                            <div className="success-banner">
                                <CheckCircleIcon />
                                <div>
                                    <strong>{t('app.servers.connectionStringReady', 'Connection string ready')}</strong>
                                    <p className="success-subtitle">{t('app.servers.pasteThisIntoTheAgentOr', 'Paste this into the agent, or run the installer.')}</p>
                                </div>
                            </div>

                            <div className="server-connection-string" data-walkthrough="server-connection-string">
                                <CopyField
                                    label={t('app.servers.connectionString', 'Connection string')}
                                    value={connectionString}
                                    multiline
                                    onCopy={() => {
                                        window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                                            detail: { type: 'server-connection-string-copied' },
                                        }));
                                    }}
                                />
                            </div>

                            <details className="install-fallback">
                                <summary>{t('app.servers.needToInstallTheAgentFirst', 'Need to install the agent first? Use the one-liner installer.')}</summary>
                                <div className="install-tabs install-tabs--after-summary">
                                    <CopyField
                                        label={`${t('app.servers.linux', 'Linux')} · ${t('app.servers.curlTarSudoAndSystemd', 'curl, tar, sudo, and systemd')}`}
                                        value={linuxInstallScript}
                                        multiline
                                    />
                                    <CopyField
                                        label={`${t('app.servers.windowsPowershell', 'Windows (PowerShell)')} · ${t('app.servers.runAsAdministrator', 'Run as Administrator')}`}
                                        value={windowsInstallScript}
                                        multiline
                                    />
                                </div>
                            </details>

                            <div className="install-info">
                                <h4>{t('app.servers.whatHappensNext', 'What happens next?')}</h4>
                                <ol>
                                    <li>{t('app.servers.openTheAgentOnYourTarget', 'Open the agent on your target machine and paste the connection string.')}</li>
                                    <li>{t('app.servers.theAgentRegistersAutomaticallyAndReports', 'The agent registers automatically and reports its hostname back as the server name.')}</li>
                                    <li>{t('app.servers.theRowInThisListWill', 'The row in this list will switch from')} <strong>{t('app.servers.pending', 'Pending')}</strong> to <strong>{t('app.servers.online', 'Online')}</strong>.</li>
                                </ol>
                                <p className="text-muted">
                                    {t('app.servers.theTokenIsSingleUseIf', 'The token is single-use. If you reinstall the agent later, generate a new connection string from the server\'s Settings tab.')}
                                </p>
                            </div>
                        </div>

                        <div className="modal-actions">
                            <Button onClick={onCreated}>
                                {t('common.actions.close', 'Close')}
                            </Button>
                        </div>
                    </div>
                )}
        </Drawer>
    );
};

const ManageGroupsModal = ({ groups, onClose, onUpdated }) => {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const [groupList, setGroupList] = useState(groups);
    const [newGroupName, setNewGroupName] = useState('');
    const [editingGroup, setEditingGroup] = useState(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    async function handleCreateGroup(e) {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        setLoading(true);
        try {
            await api.createServerGroup({ name: newGroupName.trim() });
            setNewGroupName('');
            toast.success(t('app.servers.groupCreated', 'Group created'));
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || t('app.servers.failedToCreateGroup', 'Failed to create group'));
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateGroup(groupId, newName) {
        try {
            await api.updateServerGroup(groupId, { name: newName });
            toast.success(t('app.servers.groupUpdated', 'Group updated'));
            setEditingGroup(null);
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || t('app.servers.failedToUpdateGroup', 'Failed to update group'));
        }
    }

    async function handleDeleteGroup(groupId) {
        if (!await confirm({
            title: t('app.servers.deleteServerGroup', 'Delete server group'),
            message: t('app.servers.deleteThisGroupServersInIt', 'Delete this group? Servers in it will become ungrouped.'),
            confirmText: t('app.servers.deleteGroup', 'Delete group'),
        })) return;

        try {
            await api.deleteServerGroup(groupId);
            toast.success(t('app.servers.groupDeleted', 'Group deleted'));
            onUpdated();
            const data = await api.getServerGroups();
            setGroupList(Array.isArray(data) ? data : []);
        } catch (err) {
            toast.error(err.message || t('app.servers.failedToDeleteGroup', 'Failed to delete group'));
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.servers.manageServerGroups', 'Manage Server Groups')}>
                <form onSubmit={handleCreateGroup} className="group-form">
                    <Input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder={t('app.servers.newGroupName', 'New group name…')}
                        disabled={loading}
                    />
                    <Button type="submit" disabled={loading || !newGroupName.trim()}>
                        <PlusIcon /> {t('common.actions.add', 'Add')}
                    </Button>
                </form>

                <div className="groups-list">
                    {groupList.length === 0 ? (
                        <div className="empty-groups">{t('app.servers.noGroupsCreatedYet', 'No groups created yet')}</div>
                    ) : (
                        groupList.map(group => (
                            <div key={group.id} className="group-item">
                                {editingGroup === group.id ? (
                                    <Input
                                        type="text"
                                        defaultValue={group.name}
                                        onBlur={(e) => handleUpdateGroup(group.id, e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdateGroup(group.id, e.target.value);
                                            if (e.key === 'Escape') setEditingGroup(null);
                                        }}
                                        autoFocus
                                    />
                                ) : (
                                    <>
                                        <span className="group-name">
                                            <FolderIcon size={14} />
                                            {group.name}
                                        </span>
                                        <span className="group-count">{group.server_count || 0} servers</span>
                                        <div className="group-actions">
                                            <Button variant="unstyled" type="button"
                                                className="btn-icon"
                                                onClick={() => setEditingGroup(group.id)}
                                                title={t('common.actions.edit', 'Edit')}
                                            >
                                                <EditIcon />
                                            </Button>
                                            <Button variant="unstyled" type="button"
                                                className="btn-icon danger"
                                                onClick={() => handleDeleteGroup(group.id)}
                                                title={t('common.actions.delete', 'Delete')}
                                            >
                                                <TrashIcon />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div className="modal-actions">
                    <Button onClick={onClose}>{t('common.actions.done', 'Done')}</Button>
                </div>
        </Modal>
    );
};

// Icons
const PlusIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
);

const FolderIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
);

const CheckCircleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
);

const EditIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
);

const TrashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

export default Servers;
