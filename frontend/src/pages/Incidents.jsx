// Incidents — one place for "something is wrong right now".
//
// This absorbed the old Alerts tab, and then the Fleet Alerts panel that used
// to sit directly under this table with a second table and an
// Active/Acknowledged/Resolved segment row of its own. A CPU threshold crossing
// on a host and a monitor going down are the same question asked of two
// different subjects; a threshold crossing on a PAIRED host is that same
// question a third time. All three are rows here, told apart by the Source
// column, and every bucket the segment offered is a saved view below.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { statusKind, alertStatusKind } from '@/components/ds/status';
import { Link } from 'react-router-dom';
import {
    AlertTriangle, CheckCircle2, ChevronRight, Eye, Radar, RefreshCw, Siren,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { DataTable, DataTableFooter, Drawer, Pill, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { METRIC_LABELS } from '../components/monitoring/fleetMetrics';
import { impactTone, INCIDENT_STATES } from '../components/monitoring/monitorShared';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Built-in views. This page used to carry THREE old affordances at once — a KPI
// band whose tiles set a filter, an Active/Resolved/All segment row, and the
// fleet panel's own Active/Acknowledged/Resolved segment — while having no
// column menu, no search and no saved views at all. Every bucket any of them
// offered is a rule here now.
//
// `resolved` is the axis all three sources share: an incident is resolved when
// its status says so, a host alert when it is history rather than firing, a
// fleet alert when someone closed it out.
const NO_RULES = { match: 'all', rules: [] };
const RESOLVED_IS = (value) => ({
    match: 'all',
    rules: [{ id: 'rs', field: 'resolved', op: 'is', value }],
});

const BUILTIN_VIEWS = [
    {
        // The page's reason to exist: what is wrong RIGHT NOW.
        name: 'Active',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: [],
            columnFilters: RESOLVED_IS(false), page: { search: '' },
        },
    },
    {
        // The fleet segment's middle bucket, and the only one Active/Resolved
        // could not already express. Acking does not fix anything, so these
        // rows stay in Active too — the segment's exclusive tabs are what made
        // an acknowledged alert look handled.
        name: 'Acknowledged',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: ['kind'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ak', field: 'state', op: 'any', value: ['acknowledged'] }],
            },
            page: { search: '' },
        },
    },
    {
        name: 'Resolved',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: [],
            columnFilters: RESOLVED_IS(true), page: { search: '' },
        },
    },
    {
        // What the "Open incidents" tile counted — and note it is NOT the same
        // as Active: it deliberately excludes host alerts, which is why the
        // tile's number never matched the segment's row count.
        name: 'Open incidents',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: ['kind'],
            columnFilters: {
                match: 'all',
                rules: [
                    { id: 'oi1', field: 'kind', op: 'any', value: ['incident'] },
                    { id: 'oi2', field: 'resolved', op: 'is', value: false },
                ],
            },
            page: { search: '' },
        },
    },
    {
        // The host side of the same question, for when a threshold is flapping.
        name: 'Host alerts',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: ['kind'],
            columnFilters: { match: 'all', rules: [{ id: 'ha', field: 'kind', op: 'any', value: ['alert'] }] },
            page: { search: '' },
        },
    },
    {
        name: 'Everything, newest first',
        state: {
            sorts: [{ key: 'when', direction: 'desc' }], hiddenKeys: [],
            columnFilters: NO_RULES, page: { search: '' },
        },
    },
];



function formatWhen(iso) {
    if (!iso) return 'unknown';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'unknown';
    return date.toLocaleString();
}

function formatValue(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '—';
    return value.toFixed(1);
}

export default function Incidents() {
    const { t } = useTranslation();
    const toast = useToast();
    const [search, setSearch] = useState('');
    const [incidents, setIncidents] = useState([]);
    const [activeAlerts, setActiveAlerts] = useState([]);
    const [alertHistory, setAlertHistory] = useState([]);
    const [fleetAlerts, setFleetAlerts] = useState([]);
    const [monitors, setMonitors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [selected, setSelected] = useState(null);
    const [note, setNote] = useState('');
    const [checking, setChecking] = useState(false);
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'when', direction: 'desc' }],
        storageKey: 'serverkit-table-incidents-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-incidents-cols',
    });

    const load = useCallback(async () => {
        // A failed source keeps its last good rows (never blanks the page) and
        // is recorded, so a failure can't read as "nothing is wrong".
        const failures = [];
        const settle = (promise) => promise.catch((err) => { failures.push(err); return null; });
        try {
            const [incidentsRes, statusRes, historyRes, monitorsRes, fleetRes] = await Promise.all([
                settle(api.getIncidents({ state: 'all', limit: 200 })),
                settle(api.getMonitoringStatus()),
                settle(api.getAlertHistory(50)),
                settle(api.getMonitors()),
                // Every status, deliberately: the Active/Acknowledged/Resolved
                // split is a saved view now, not a server-side query.
                settle(api.getFleetAlerts({ limit: 200 })),
            ]);
            if (incidentsRes) setIncidents(incidentsRes.incidents || []);
            if (statusRes) setActiveAlerts(statusRes.active_alerts || []);
            if (historyRes) setAlertHistory(historyRes.alerts || []);
            if (monitorsRes) setMonitors(monitorsRes.monitors || []);
            if (fleetRes) setFleetAlerts(Array.isArray(fleetRes) ? fleetRes : []);
            setLoadError(failures[0] || null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const onCheckAlerts = async () => {
        setChecking(true);
        try {
            const result = await api.checkAlerts();
            const count = result.alerts?.length || 0;
            toast[count > 0 ? 'warning' : 'success'](t('app.incidents.hostAlertsFiring', { count, defaultValue_one: '1 host alert firing', defaultValue_other: '{{count}} host alerts firing' }));
            await load();
        } catch (err) {
            toastError(toast, t('app.incidents.alertCheckFailed', "Couldn't check alerts."), err);
        } finally {
            setChecking(false);
        }
    };

    useTopbarActions(() => (
        <>
            <Button variant="outline" size="sm" onClick={onCheckAlerts} disabled={checking}>
                <Siren size={14} /> {checking ? 'Checking…' : 'Check hosts'}
            </Button>
            <Button variant="outline" size="sm" onClick={load}>
                <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
            </Button>
            <SearchField
                value={search}
                onSearch={setSearch}
                placeholder={t('app.incidents.searchIncidentsAndAlerts', 'Search incidents and alerts…')}
            />
        </>
    ), [checking, load, search]);

    const monitorsById = useMemo(
        () => Object.fromEntries(monitors.map((m) => [m.id, m])),
        [monitors],
    );

    // One list, four sources. Host alerts have no lifecycle of their own — they
    // are either firing or historical — so they map onto the same active/resolved
    // axis the incidents use. Every row normalises `metric`/`value`/`threshold`
    // and a one-line `detail`, so the cells and the drawer read the merged item
    // rather than reaching back into whichever payload it came from.
    const items = useMemo(() => {
        const fromIncidents = incidents.map((incident) => {
            const subject = monitorsById[incident.component_id]?.name || 'Service';
            return {
                kind: 'incident',
                key: `incident-${incident.id}`,
                id: incident.id,
                title: incident.title,
                subject,
                detail: subject,
                state: incident.status,
                tone: statusKind(incident.status),
                impact: incident.impact,
                when: incident.created_at,
                resolved: incident.status === 'resolved',
                raw: incident,
            };
        });

        const hostDetail = (alert) => (alert.type
            ? `${alert.type} ${formatValue(alert.value)} / ${alert.threshold}`
            : 'This server');

        const fromActive = activeAlerts.map((alert, index) => ({
            kind: 'alert',
            key: `active-${alert.type}-${index}`,
            title: alert.message,
            subject: 'This server',
            detail: hostDetail(alert),
            state: 'firing',
            tone: 'red',
            impact: alert.severity,
            metric: alert.type,
            value: alert.value,
            threshold: alert.threshold,
            when: alert.timestamp,
            resolved: false,
            raw: alert,
        }));

        const fromHistory = alertHistory.map((alert, index) => ({
            kind: 'alert',
            key: `history-${alert.timestamp || index}-${index}`,
            title: alert.message,
            subject: 'This server',
            detail: hostDetail(alert),
            state: alert.severity,
            tone: statusKind(alert.severity),
            impact: alert.severity,
            metric: alert.type,
            value: alert.value,
            threshold: alert.threshold,
            when: alert.timestamp,
            resolved: true,
            raw: alert,
        }));

        // A threshold crossing on a PAIRED host — the rows the Fleet Alerts
        // panel used to own, mapped onto these columns: server -> subject,
        // metric/value/threshold -> what happened, severity -> impact,
        // status -> state. `alertId` is what marks a row as actionable; the two
        // sources above describe the panel's own box and have no server-side
        // lifecycle to ack or resolve.
        const fromFleet = fleetAlerts.map((alert) => {
            const metric = METRIC_LABELS[alert.metric] || alert.metric;
            const subject = alert.server_name || 'Unknown server';
            return {
                kind: 'alert',
                key: `fleet-${alert.id}`,
                alertId: alert.id,
                title: `${metric} over limit on ${subject}`,
                subject,
                detail: `${metric} ${formatValue(alert.value)} / ${alert.threshold}`,
                state: alert.status,
                tone: alertStatusKind(alert.status),
                impact: alert.severity,
                metric,
                value: alert.value,
                threshold: alert.threshold,
                when: alert.created_at,
                resolved: alert.status === 'resolved',
                raw: alert,
            };
        });

        return [...fromActive, ...fromFleet, ...fromIncidents, ...fromHistory]
            .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
    }, [incidents, activeAlerts, alertHistory, fleetAlerts, monitorsById]);

    // Search only. The active/resolved split used to live here as a segment
    // filter; it is a column rule now, applied inside the table.
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) => (
            [item.title, item.subject, item.state].some((v) => String(v || '').toLowerCase().includes(q))
        ));
    }, [items, search]);

    // Ack / Resolve, carried over from the deleted panel. Reloading rather than
    // patching the row in place keeps the alert's status honest even when the
    // scheduler resolved it a second earlier.
    const onAlertAction = useCallback(async (item, action) => {
        try {
            await (action === 'ack'
                ? api.acknowledgeFleetAlert(item.alertId)
                : api.resolveFleetAlert(item.alertId));
            await load();
        } catch (err) {
            toastError(toast, action === 'ack'
                ? t('app.incidents.couldntAcknowledgeAlert', "Couldn't acknowledge the alert.")
                : t('app.incidents.couldntResolveAlert', "Couldn't resolve the alert."), err);
        }
    }, [load, t, toast]);

    const onPostUpdate = async (state) => {
        if (!selected || selected.kind !== 'incident') return;
        try {
            await api.updateIncident(selected.id, {
                status: state,
                update_body: note.trim() || `Status moved to ${state}.`,
            });
            toast.success(t('app.incidents.incident', 'Incident {{state}}', { state: state }));
            setNote('');
            setSelected(null);
            await load();
        } catch (err) {
            toastError(toast, t('app.incidents.couldNotPostTheUpdate', "Couldn't post the update."), err);
        }
    };

    // Column values are the RAW strings the rules filter on; the cells render
    // the same values, so a preset reads the way the row does.
    const columns = useMemo(() => [
        {
            key: 'title',
            headerKey: 'app.incidents.whatHappened', header: 'What happened',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (item) => item.title || '',
            render: (item) => (
                <div className="sk-cell-name">
                    <span className={`incident-row__sev incident-row__sev--${item.tone}`} />
                    <span>
                        <div>{item.title}</div>
                        <div className="sk-cell-sub">{item.detail}</div>
                    </span>
                </div>
            ),
        },
        {
            key: 'state',
            headerKey: 'common.labels.state', header: 'State',
            sortable: true,
            type: 'enum',
            value: (item) => item.state || '',
            render: (item) => <Pill kind={item.tone}>{item.state}</Pill>,
        },
        {
            key: 'subject',
            headerKey: 'app.incidents.subject', header: 'Subject',
            sortable: true,
            type: 'enum',
            value: (item) => item.subject || '',
        },
        {
            // The axis every source shares, and what Active/Resolved filter on.
            key: 'resolved',
            headerKey: 'app.incidents.resolved', header: 'Resolved',
            sortable: true,
            type: 'bool',
            value: (item) => !!item.resolved,
            render: (item) => (item.resolved ? 'yes' : 'no'),
        },
        {
            // Monitor outage vs host threshold alert — the distinction the
            // "Open incidents" tile silently relied on.
            key: 'kind',
            headerKey: 'common.labels.source', header: 'Source',
            sortable: true,
            type: 'enum',
            value: (item) => item.kind || '',
            render: (item) => (item.kind === 'alert' ? 'host alert' : 'incident'),
        },
        {
            key: 'impact',
            headerKey: 'app.incidents.impact', header: 'Impact',
            sortable: true,
            type: 'enum',
            value: (item) => item.impact || '—',
        },
        {
            key: 'when',
            headerKey: 'common.labels.when', header: 'When',
            sortable: true,
            type: 'date',
            value: (item) => item.when || null,
            sortValue: (item) => (item.when ? new Date(item.when).getTime() : null),
            cellClassName: 'sk-cell-dim',
            render: (item) => formatWhen(item.when),
        },
        {
            // Ack / Resolve ride in the trailing cell rather than a column of
            // their own: only a fleet alert carries a lifecycle to act on, so
            // every other row would show an empty column forever.
            key: 'open',
            header: '',
            sortable: false,
            hideable: false,
            cellClassName: 'mon-row-actions',
            render: (item) => (
                <>
                    {item.alertId && !item.resolved && (
                        <span
                            className="incident-row__acts"
                            role="presentation"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {item.state === 'active' && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onAlertAction(item, 'ack')}
                                >
                                    <Eye size={14} /> {t('app.incidents.ack', 'Ack')}
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onAlertAction(item, 'resolve')}
                            >
                                <CheckCircle2 size={14} /> {t('app.incidents.resolve', 'Resolve')}
                            </Button>
                        </span>
                    )}
                    <ChevronRight size={16} className="incident-row__chev" />
                </>
            ),
        },
    ], [onAlertAction, t]);

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    const chrome = useTableChrome({
        columns,
        rows: shown,
        viewPageKey: 'incidents',
        builtinViews: BUILTIN_VIEWS,
        noun: 'incidents',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    const tableChrome = (
        <>
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
        </>
    );
    const { hosted, portal: topbarChrome } = useTopbarChrome(tableChrome);

    if (loading) {
        return (
            <div className="sk-tabgroup__inner incidents-page">
                <EmptyState loading loadingVariant="feed" title={t('app.incidents.loadingIncidents', 'Loading incidents')} />
            </div>
        );
    }

    const selectedMonitor = selected?.kind === 'incident'
        ? monitorsById[selected.raw.component_id]
        : null;

    return (
        <div className="sk-tabgroup__inner incidents-page">
            {topbarChrome}
            <GridViewPicker
                views={chrome.views}
                label="incidents"
                onCreate={chrome.createView}
                actions={hosted ? null : tableChrome}
            />

            <GridChips {...chrome.chipProps} />

            {loadError && items.length > 0 && (
                <ErrorState compact error={loadError} onRetry={load} />
            )}

            {loadError && items.length === 0 ? (
                <ErrorState
                    title={t('app.incidents.couldntLoadIncidents', "Couldn't load incidents.")}
                    error={loadError}
                    onRetry={load}
                />
            ) : items.length === 0 ? (
                <EmptyState
                    icon={CheckCircle2}
                    title={t('app.incidents.nothingIsWrongRightNow', 'Nothing is wrong right now')}
                    description={t('app.incidents.noMonitorIsDownAndNo', 'No monitor is down and no host is over its limit.')}
                />
            ) : (
                <div className="mon-card">
                    <DataTable
                        {...chrome.tableProps}
                        tableClassName="sk-dtable incidents-table"
                        columns={chrome.columns}
                        data={shown}
                        keyField="key"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        onRowClick={setSelected}
                        emptyTitle="No incidents match this view."
                        emptyMessage=""
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={items.length}
                                noun="incident"
                            />
                        )}
                    />
                </div>
            )}

            <Drawer
                open={Boolean(selected)}
                onOpenChange={(open) => { if (!open) { setSelected(null); setNote(''); } }}
                title={selected?.title || ''}
                subtitle={selected ? `${selected.subject} · ${formatWhen(selected.when)}` : ''}
                icon={selected?.kind === 'incident' ? <AlertTriangle size={18} /> : <Siren size={18} />}
            >
                {selected?.kind === 'incident' && (
                    <div className="incident-detail">
                        <div className="incident-detail__pills">
                            <Pill kind={statusKind(selected.raw.status)}>{selected.raw.status}</Pill>
                            <Pill kind={impactTone(selected.raw.impact)}>{selected.raw.impact} impact</Pill>
                        </div>

                        {selected.raw.body && <p className="incident-detail__body">{selected.raw.body}</p>}

                        {selectedMonitor && (
                            <Link className="incident-detail__link" to={`/monitoring/monitors/${selectedMonitor.id}`}>
                                <Radar size={14} /> {t('common.actions.open', 'Open')} {selectedMonitor.name}
                            </Link>
                        )}

                        <h4 className="incident-detail__heading">{t('app.incidents.timeline', 'Timeline')}</h4>
                        {selected.raw.updates?.length ? (
                            <ol className="incident-timeline">
                                {selected.raw.updates.map((update) => (
                                    <li key={update.id} className="incident-timeline__item">
                                        <span className={`incident-timeline__dot is-${statusKind(update.status)}`} />
                                        <div>
                                            <div className="incident-timeline__head">
                                                <Pill kind={statusKind(update.status)}>{update.status}</Pill>
                                                <span>{formatWhen(update.created_at)}</span>
                                            </div>
                                            <p>{update.body}</p>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p className="mon-panel-hint">{t('app.incidents.noUpdatesPostedYet', 'No updates posted yet.')}</p>
                        )}

                        {selected.raw.status !== 'resolved' && (
                            <div className="incident-detail__post">
                                <h4 className="incident-detail__heading">{t('app.incidents.postAnUpdate', 'Post an update')}</h4>
                                <Input
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder={t('app.incidents.whatChanged', 'What changed?')}
                                />
                                <div className="incident-detail__states">
                                    {INCIDENT_STATES.map((state) => (
                                        <Button
                                            key={state}
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onPostUpdate(state)}
                                        >
                                            {state}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {selected?.kind === 'alert' && (
                    <div className="incident-detail">
                        <div className="incident-detail__pills">
                            <Pill kind={selected.tone}>{selected.state}</Pill>
                            <Pill kind={statusKind(selected.raw.severity)}>
                                {selected.raw.severity}
                            </Pill>
                        </div>
                        <dl className="mon-inforows">
                            <div><dt>{t('app.incidents.metric', 'Metric')}</dt><dd>{selected.metric || '—'}</dd></div>
                            <div><dt>{t('app.incidents.reading', 'Reading')}</dt><dd>{formatValue(selected.value)}</dd></div>
                            <div><dt>{t('app.incidents.limit', 'Limit')}</dt><dd>{selected.threshold ?? '—'}</dd></div>
                            <div><dt>{t('common.labels.when', 'When')}</dt><dd>{formatWhen(selected.when)}</dd></div>
                        </dl>
                        <p className="mon-panel-hint">
                            {t('app.incidents.hostLimitsLiveOnThe', 'Host limits live on the')} <Link to="/monitoring/rules">{t('app.incidents.rules', 'Rules')}</Link> tab.
                        </p>
                    </div>
                )}
            </Drawer>

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
}
