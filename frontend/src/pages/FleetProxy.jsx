import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Network, RefreshCw, Server as ServerIcon } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { DataTable, Pill, serviceStatusKind, statusLabel as dsStatusLabel } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import EmptyState from '../components/EmptyState';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n/t';

// Fleet-wide reverse-proxy dashboard (Phase 4 of C6). Aggregates every
// server's managed-proxy posture into one table: which proxy each server runs
// (host nginx by default, or a managed Traefik/Caddy stack), its status, when
// its config was last regenerated, and how many docker networks it joins.
// Per-server configuration still lives on each server's Proxy tab — every row
// links through to it.

// Human label + Pill kind for each proxy type. Host nginx is the default and
// reads as the "neutral" choice; the managed stacks get accent colors.
const PROXY_TYPE_META = {
    nginx: { labelKey: 'app.fleetProxy.nginx', label: 'Nginx', kind: 'gray' },
    traefik: { labelKey: 'app.fleetProxy.traefik', label: 'Traefik', kind: 'cyan' },
    caddy: { labelKey: 'app.fleetProxy.caddy', label: 'Caddy', kind: 'violet' },
};

// Recommendation level → Pill kind. 'ok' reads green (aligned), 'info' is a
// neutral note, 'warn' is amber so the operator can spot what needs action.
const RECOMMENDATION_KIND = {
    ok: 'green',
    info: 'gray',
    warn: 'amber',
};

// Urgency order for the Recommendation column, so sorting it puts what needs
// doing on top instead of alphabetising the sentence (every mismatch text
// starts with its own count, which scattered those rows across the list).
const RECOMMENDATION_RANK = { warn: 0, info: 1, ok: 2 };

function formatTimestamp(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
}

function typeMeta(type) {
    return PROXY_TYPE_META[type] || { label: type || 'Unknown', kind: 'gray' };
}

const statusLabel = (row) => dsStatusLabel(row.status);

// Columns for the shared DataTable. Two accessors per column on purpose:
// `value` is what the column MENU, the filter rules and the export read
// (ds/grid/fields.js), `sortValue` is what DataTable's sorter reads. A column
// that declares only one of them silently gets the other from the wrong place.
const FLEET_COLUMNS = [
    {
        key: 'server',
        headerKey: 'common.labels.server', header: 'Server',
        sortable: true,
        hideable: false,
        type: 'text',
        value: (row) => row.server_name || 'Unnamed server',
        sortValue: (row) => row.server_name || '',
        render: (row) => (
            <Link to={`/servers/${row.server_id}/proxy`} className="fleet-proxy__server">
                <ServerIcon size={14} />
                <span>{row.server_name || 'Unnamed server'}</span>
            </Link>
        ),
    },
    {
        key: 'type',
        headerKey: 'app.fleetProxy.proxyType', header: 'Proxy type',
        sortable: true,
        type: 'enum',
        groupable: true,
        // Filter, group and sort on the LABEL the pill shows, so a preset that
        // says 'Traefik' reads the same way the row does. `groupValue` has to
        // be spelled out too — DataTable's grouping falls back to row[key],
        // and there is no `row.type`.
        value: (row) => typeMeta(row.proxy_type).label,
        groupValue: (row) => typeMeta(row.proxy_type).label,
        sortValue: (row) => typeMeta(row.proxy_type).label,
        render: (row) => {
            const meta = typeMeta(row.proxy_type);
            return <Pill kind={meta.kind} dot={false}>{meta.label}</Pill>;
        },
    },
    {
        key: 'status',
        headerKey: 'common.labels.status', header: 'Status',
        sortable: true,
        type: 'enum',
        groupable: true,
        value: statusLabel,
        groupValue: statusLabel,
        sortValue: statusLabel,
        render: (row) => (
            <Pill kind={serviceStatusKind(row.status)}>{statusLabel(row)}</Pill>
        ),
    },
    {
        key: 'apps',
        headerKey: 'app.fleetProxy.apps', header: 'Services',
        sortable: true,
        type: 'num',
        value: (row) => row.app_count ?? 0,
        sortValue: (row) => row.app_count ?? 0,
        cellClassName: 'fleet-proxy__muted',
        render: (row) => row.app_count ?? 0,
    },
    {
        // Its own column rather than a pill tacked onto Apps: "how many apps
        // are pointed at the wrong ingress plane" is the one number on this
        // page you act on, and inside another cell it could not be sorted or
        // filtered. A row without a count reads 0 here, so the `gt 0` preset
        // below needs a real, positive mismatch — a missing count can never
        // look like a fault.
        key: 'mismatches',
        headerKey: 'app.fleetProxy.mismatches', header: 'Mismatches',
        sortable: true,
        type: 'num',
        value: (row) => row.mismatch_count ?? 0,
        sortValue: (row) => row.mismatch_count ?? 0,
        render: (row) => (row.mismatch_count > 0 ? (
            <span className="fleet-proxy__apps">
                <Pill kind="amber" dot={false}>
                    <AlertTriangle size={12} />
                    {row.mismatch_count}
                </Pill>
            </span>
        ) : (
            <span className="fleet-proxy__muted">0</span>
        )),
    },
    {
        key: 'recommendation',
        headerKey: 'app.fleetProxy.recommendation', header: 'Recommendation',
        sortable: true,
        type: 'enum',
        // The LEVEL is the filterable dimension — the text carries a per-row
        // count, so it is four sentences on paper and N distinct values in
        // practice. No built-in view filters it: level 'warn' is exactly
        // `mismatches > 0`, and the number sorts by severity as well.
        value: (row) => row.recommendation?.level || 'none',
        sortValue: (row) => RECOMMENDATION_RANK[row.recommendation?.level] ?? 3,
        render: (row) => (
            row.recommendation ? (
                <Pill
                    kind={RECOMMENDATION_KIND[row.recommendation.level] || 'gray'}
                    dot={false}
                    className="fleet-proxy__recommendation"
                    title={row.recommendation.text}
                >
                    {row.recommendation.text}
                </Pill>
            ) : (
                <span className="fleet-proxy__muted">—</span>
            )
        ),
    },
    {
        key: 'lastRegenerated',
        headerKey: 'app.fleetProxy.lastRegenerated', header: 'Last regenerated',
        sortable: true,
        // Declared, not inferred: the sorter wants epoch ms, and letting that
        // number type the column would offer "is under 1754…" instead of a
        // date picker — and make any date rule match nothing.
        type: 'date',
        value: (row) => row.last_regenerated_at || null,
        sortValue: (row) => {
            const time = Date.parse(row.last_regenerated_at);
            return Number.isNaN(time) ? null : time;
        },
        cellClassName: 'fleet-proxy__muted',
        render: (row) => formatTimestamp(row.last_regenerated_at),
    },
    {
        key: 'networks',
        headerKey: 'app.fleetProxy.networks', header: 'Networks',
        sortable: true,
        type: 'num',
        value: (row) => row.networks_count ?? 0,
        sortValue: (row) => row.networks_count ?? 0,
        cellClassName: 'fleet-proxy__muted',
        render: (row) => row.networks_count ?? 0,
    },
    {
        key: 'actions',
        header: '',
        className: 'fleet-proxy__col-actions',
        cellClassName: 'fleet-proxy__col-actions',
        render: (row) => (
            <Button asChild variant="ghost" size="sm">
                <Link to={`/servers/${row.server_id}/proxy`}>{t('app.fleetProxy.manage', 'Manage')}</Link>
            </Button>
        ),
    },
];

// Built-in saved views. Every rule matches against a column's `value`
// accessor, so the strings below are the LABELS the cells render ('Traefik',
// 'Host default') — never the raw backend enum ('traefik', 'host').
//
// The first two are deliberately exception lists: an aligned, healthy fleet
// shows nothing under them, which is the answer they exist to give.
const NO_RULES = { match: 'all', rules: [] };

const FLEET_BUILTIN_VIEWS = [
    {
        // The worklist. An app tagged for the other ingress plane than its
        // server's proxy is either unreachable or colliding on 80/443, so the
        // worst server goes on top. Networks is hidden — it says nothing about
        // which app is misrouted.
        name: 'Ingress mismatches',
        state: {
            sorts: [{ key: 'mismatches', direction: 'desc' }],
            hiddenKeys: ['networks'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fm1', field: 'mismatches', op: 'gt', value: 0 }],
            },
        },
    },
    {
        // A managed stack that is not running means that server is serving
        // nothing. 'Unknown' belongs here: it is the status a stack row starts
        // at, so it means "never confirmed up", not "fine". 'Host default' is
        // absent on purpose — that is the healthy default, not an outage.
        name: 'Proxy not running',
        state: {
            sorts: [{ key: 'server', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{
                    id: 'fp1',
                    field: 'status',
                    op: 'any',
                    value: ['Stopped', 'Error', 'Unknown'],
                }],
            },
        },
    },
    {
        // Who opted out of host nginx, stalest generated config first (a row
        // that was never regenerated sorts last — nulls always sink).
        name: 'Managed stacks',
        state: {
            sorts: [{ key: 'lastRegenerated', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ms1', field: 'type', op: 'any', value: ['Traefik', 'Caddy'] }],
            },
        },
    },
    {
        // The other half of the fleet: still on host nginx, busiest first —
        // those are the servers where a managed stack would buy something.
        // Last regenerated and Networks are hidden because a host row has
        // neither, so both columns would be a wall of "Never" and 0.
        name: 'Still on host Nginx',
        state: {
            sorts: [{ key: 'apps', direction: 'desc' }],
            hiddenKeys: ['lastRegenerated', 'networks'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'hn1', field: 'status', op: 'any', value: ['Host default'] }],
            },
        },
    },
    {
        // No rules at all: the whole fleet, bucketed by what it actually runs.
        // The group headers carry the counts the old KPI band used to.
        name: 'By proxy type',
        state: {
            sorts: [{ key: 'server', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: 'type',
            columnFilters: NO_RULES,
        },
    },
];

const FleetProxy = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Table sort + column visibility, persisted and handed to the chrome.
    // Hiding a column is only safe now that the rows render from the column
    // descriptors: the old renderRow escape hatch always emitted every <td>,
    // so dropping a header would have misaligned the body.
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-fleet-proxy-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-fleet-proxy-cols',
    });
    // Not persisted separately: a grouping worth keeping is a saved view now.
    const [groupBy, setGroupBy] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getFleetProxyOverview();
            const list = Array.isArray(data?.servers) ? data.servers : [];
            setRows(list);
            setError(null);
        } catch (err) {
            setError(err.message || 'Failed to load fleet proxy overview');
            toast.error(t('app.fleetProxy.failedToLoadFleetProxyOverview', 'Failed to load fleet proxy overview'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => {
        load();
    }, [load]);

    // Publish a Refresh button into the shared Servers tab-group top bar.
    useTopbarActions(() => (
        <Button size="sm" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {t('common.actions.refresh', 'Refresh')}
        </Button>
    ), [loading]);

    // No KPI band and no page title: every tile it held was a re-count of a
    // column already on the table below, and the tab strip names the page.
    //
    // No `pageState` either — the list is the fleet overview endpoint's whole
    // response, unpaginated and with no search or server-side filter of its
    // own, so there is nothing page-private for a view to carry and every rule
    // in a preset narrows the same rows the operator is looking at.
    const chrome = useTableChrome({
        columns: FLEET_COLUMNS,
        rows,
        viewPageKey: 'fleet-proxy',
        builtinViews: FLEET_BUILTIN_VIEWS,
        noun: 'servers',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
    });

    // Filter + "⋮" ride in the shared Servers top bar. The toolbar they used to
    // sit in held nothing else but a re-count of the table underneath it.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
        </>,
    );

    return (
        <div className="sk-tabgroup__inner fleet-proxy">
            {topbarChrome}
            {error ? (
                <div className="fleet-proxy__error">
                    <p>{error}</p>
                    <Button variant="outline" size="sm" onClick={load}>{t('common.actions.retry', 'Retry')}</Button>
                </div>
            ) : (
                <>
                    <GridViewPicker
                        views={chrome.views}
                        label="servers"
                        onCreate={chrome.createView}
                    
                actions={chromeActions}
            />

                    <GridChips {...chrome.chipProps} />

                    <div className="fleet-proxy__table">
                        <DataTable
                            loading={loading}
                            columns={chrome.columns}
                            data={rows}
                            keyField="server_id"
                            sorts={sorts}
                            onSortsChange={setSorts}
                            {...chrome.tableProps}
                            groupBy={groupBy}
                            onGroupByChange={setGroupBy}
                            rowClassName="fleet-proxy__row"
                            emptyState={(
                                <EmptyState
                                    icon={Network}
                                    title={t('app.fleetProxy.noServersInTheFleet', 'No servers in the fleet')}
                                    description={t('app.fleetProxy.thisIsWhereEachServerS', 'This is where each server\'s reverse-proxy posture lands: which proxy it runs, whether it\'s healthy, and when its config was last regenerated. Host Nginx is the default; a server can opt into a managed Traefik or Caddy stack from its Proxy tab. Add a server to start.')}
                                />
                            )}
                        />
                    </div>
                </>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

export default FleetProxy;
