import { useCallback, useEffect, useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableFooter, Drawer, Pill, SearchField, statusKind, envActionKind } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { InfoList, InfoItem } from '../InfoList';
import api from '../../services/api';
import { useAuth } from '../../contexts/useAuth.js';
import { useDeployments } from '../../hooks/useDeployments';
import { getDeployStatus, formatRelativeTime, formatDuration } from '../../utils/serviceTypes';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';

// Deployment status → tone and env-var change action → tone both come from
// the ONE shared status vocabulary (ds/status).
// The three streams this timeline merges, in the order the Kind menu lists
// them. Declared rather than derived: an app that has never been deployed
// still has "Deploy" as a real kind, and a pick-list that hides it would
// suggest otherwise.
const KIND_LABELS = { deploy: 'Deploy', env: 'Config', audit: 'Audit' };
const KIND_ORDER = ['Deploy', 'Config', 'Audit'];

// What a cell shows when the row genuinely has nothing behind that column —
// an audit entry has no outcome, and env history records a user id rather than
// a name. It has to be a real value, not '': `ruleIsArmed` drops rules whose
// value is empty, so "status is ''" would filter nothing at all.
const NONE = '—';

const titleCase = (word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : '');

const NO_RULES = { match: 'all', rules: [] };
const NEWEST_FIRST = [{ key: 'time', direction: 'desc' }];

// Built-in saved views. Both slices ride axes the merged stream really has —
// which source an entry came from, and whether a deploy failed — and both are
// the questions the flat timeline buries once an admin's audit entries are
// interleaved with the deploys.
const EVENT_VIEWS = [
    {
        // Everything that happened to this service, newest first: the landing
        // view, and the one that says "nothing is filtered". Named for the
        // picker's own fallback heading ("All " + label) so the two agree.
        name: 'All events',
        state: { sorts: NEWEST_FIRST, hiddenKeys: [], columnFilters: NO_RULES },
    },
    {
        // The release history on its own. For an admin the audit feed is the
        // loudest of the three streams, and "when did this last ship" is the
        // question the tab exists to answer.
        name: 'Deployments',
        state: {
            sorts: NEWEST_FIRST,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ev1', field: 'kind', op: 'any', value: ['Deploy'] }],
            },
        },
    },
    {
        // Only deploys carry an outcome, so this is the one failure axis the
        // data supports. Empty on a service that has never broken, which is
        // exactly the answer it exists to give.
        name: 'Failed deploys',
        state: {
            sorts: NEWEST_FIRST,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ev2', field: 'status', op: 'any', value: ['Failed'] }],
            },
        },
    },
];

// One timeline for everything that happened to this service (the CRM record
// timeline): deployments, environment-variable changes, and — for admins —
// audit-log entries targeting this app. Newest first.
const EventsTab = ({ appId }) => {
    const { t } = useTranslation();
    const { deployments, loading, error, reload } = useDeployments(appId);
    const { isAdmin } = useAuth();
    const [envHistory, setEnvHistory] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [search, setSearch] = useState('');
    const [deployDetail, setDeployDetail] = useState(null);

    const { sorts, setSorts } = useTableSort({
        defaultSorts: NEWEST_FIRST,
        storageKey: 'serverkit-table-svc-events-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-svc-events-cols',
    });

    // The two supplemental streams. Split out of the effect so the "⋮" Refresh
    // reloads the whole table rather than only its deploys. `isStale` is how
    // the mount effect still discards a response that lands after the appId
    // changed; a manual refresh has nothing to go stale against and omits it.
    const loadSupplemental = useCallback((isStale = () => false) => {
        api.getEnvVarHistory(appId, 30)
            .then((res) => { if (!isStale()) setEnvHistory(res?.history || []); })
            .catch(() => { /* history is supplemental — the timeline works without it */ });
        if (isAdmin) {
            api.getActivityFeed({ target_type: 'app', target_id: appId, per_page: 50 })
                .then((res) => { if (!isStale()) setAuditLogs(res?.logs || []); })
                .catch(() => { /* non-admin / feed unavailable — deploys still show */ });
        }
    }, [appId, isAdmin]);

    useEffect(() => {
        let cancelled = false;
        loadSupplemental(() => cancelled);
        return () => { cancelled = true; };
    }, [loadSupplemental]);

    const refresh = useCallback(() => { reload(); loadSupplemental(); }, [reload, loadSupplemental]);

    // Merge every source into one newest-first stream of rows that all carry
    // the SAME shape — when / kind / text / status / actor — because a column
    // rule reads one accessor across every row, whatever produced it.
    const events = useMemo(() => {
        const items = [];
        deployments.forEach((deploy, idx) => items.push({
            // Indexed, not just `deploy.id`: the hook merges two deploy systems
            // that number their records independently, so their ids can collide.
            id: `deploy-${idx}-${deploy.id ?? ''}`,
            kind: 'deploy',
            at: deploy.timestamp,
            ts: new Date(deploy.timestamp).getTime() || 0,
            // getDeployStatus already labels a successful deploy "Live"; there
            // is no separate latest-success label to compute.
            status: getDeployStatus(deploy.status).label,
            tone: statusKind(deploy.status),
            actor: deploy.trigger || NONE,
            text: deploy.commitMessage || deploy.version || `Deployment #${deployments.length - idx}`,
            deploy,
        }));
        envHistory.forEach((entry, idx) => items.push({
            id: `env-${entry.id ?? idx}-${entry.changed_at}`,
            kind: 'env',
            at: entry.changed_at,
            ts: new Date(entry.changed_at).getTime() || 0,
            status: titleCase(entry.action),
            tone: envActionKind(entry.action),
            // The history row stores changed_by as a user id, never a name.
            actor: NONE,
            text: `${entry.key} ${entry.action}`,
            entry,
        }));
        auditLogs.forEach((log) => items.push({
            id: `audit-${log.id}`,
            kind: 'audit',
            at: log.created_at,
            ts: new Date(log.created_at).getTime() || 0,
            status: NONE,
            tone: 'violet',
            actor: log.username || NONE,
            text: (log.action || '').replace(/[._]/g, ' '),
            detail: log.details?.name || '',
        }));
        return items.sort((a, b) => b.ts - a.ts);
    }, [deployments, envHistory, auditLogs]);

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return events;
        return events.filter((event) => (
            `${event.text} ${event.status} ${event.actor} ${KIND_LABELS[event.kind]}`
                .toLowerCase()
                .includes(needle)
        ));
    }, [events, search]);

    // Declared above the loading/empty guards: the chrome below is a hook, so
    // it cannot sit behind an early return.
    const columns = [
        {
            key: 'time',
            headerKey: 'common.labels.when', header: 'When',
            sortable: true,
            hideable: false,
            // Relative in the cell, exact on hover — "3h ago" is what you scan
            // for, the timestamp is what you quote in an incident.
            type: 'date',
            value: (event) => event.at || null,
            sortValue: (event) => event.ts,
            cellClassName: 'sk-cell-dim',
            render: (event) => (
                <span title={event.at ? new Date(event.at).toLocaleString() : ''}>
                    {formatRelativeTime(event.at)}
                </span>
            ),
        },
        {
            key: 'kind',
            headerKey: 'common.labels.kind', header: 'Kind',
            sortable: true,
            // Declared, not inferred: a young service with three entries of
            // three kinds fails the enum cardinality ratio and would fall back
            // to free text, which turns the pick-list into a typed fragment and
            // the "Deployments" view into a no-op.
            type: 'enum',
            enumOrder: KIND_ORDER,
            groupable: true,
            value: (event) => KIND_LABELS[event.kind],
            groupValue: (event) => KIND_LABELS[event.kind],
            sortValue: (event) => KIND_LABELS[event.kind],
            render: (event) => <span className="sk-tag">{KIND_LABELS[event.kind]}</span>,
        },
        {
            key: 'event',
            headerKey: 'app.eventsTab.event', header: 'Event',
            sortable: true,
            hideable: false,
            // Commit subjects and audit actions: high cardinality, so a typed
            // fragment is the useful control rather than a pick-list.
            type: 'text',
            value: (event) => event.text,
            sortValue: (event) => event.text,
            cellClassName: 'sk-cell-name',
            render: (event) => {
                const sub = event.kind === 'deploy'
                    ? [event.deploy.branch, event.deploy.duration && formatDuration(event.deploy.duration)]
                        .filter(Boolean).join(' · ')
                    : event.detail;
                return (
                    <div className="events-tab__cell">
                        <span className="events-tab__event-message">
                            {event.kind === 'deploy' && event.deploy.commitSha && (
                                <span className="events-tab__event-sha">
                                    {event.deploy.commitSha.substring(0, 7)}
                                </span>
                            )}
                            {event.kind === 'env' ? <><b>{event.entry.key}</b> {event.entry.action}</> : event.text}
                        </span>
                        {sub && <span className="sk-cell-sub">{sub}</span>}
                    </div>
                );
            },
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // No enumOrder: the pick-list should offer the outcomes this
            // service actually produced, with their live counts, rather than
            // every outcome the three streams could theoretically emit.
            type: 'enum',
            value: (event) => event.status,
            sortValue: (event) => event.status,
            render: (event) => (event.status === NONE
                ? <span className="events-tab__none">{NONE}</span>
                : <Pill kind={event.tone}>{event.status}</Pill>),
        },
        {
            key: 'actor',
            headerKey: 'app.eventsTab.triggeredBy', header: 'Triggered by',
            sortable: true,
            // A person for an audit entry, a mechanism ('push', 'manual') for a
            // deploy — one column because the question is the same one.
            type: 'text',
            value: (event) => event.actor,
            sortValue: (event) => event.actor,
            cellClassName: 'sk-cell-dim',
            render: (event) => event.actor,
        },
    ];

    // The page-private half of a saved view: the search box narrows the merged
    // stream before any column rule sees it, so a view has to carry it.
    const pageState = useMemo(() => ({ search }), [search]);
    const applyPage = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Scoped to this tab, and namespaced: /services/:id renders one tab at a
    // time but the Env Vars tab on the same ROUTE hosts a chrome of its own, so
    // unscoped the two would read and write the same ?view=/?sort= and each
    // would arrive as the other's.
    const chrome = useTableChrome({
        columns,
        rows,
        viewPageKey: 'servicedetail-events',
        urlScope: 'events',
        builtinViews: EVENT_VIEWS,
        noun: 'events',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState,
        applyPage,
    });

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.eventsTab.loadingActivity', 'Loading activity…')} />;
    }

    if (error) {
        return (
            <EmptyState
                icon={History}
                title={t('app.eventsTab.failedToLoadActivity', "Couldn't load activity.")}
                description={error}
                action={<Button variant="outline" onClick={refresh}>{t('common.actions.retry', 'Retry')}</Button>}
            />
        );
    }

    if (events.length === 0) {
        return (
            <EmptyState
                icon={History}
                title={t('app.eventsTab.noActivityYet', 'No activity yet')}
                description={t('app.eventsTab.deploymentsConfigChangesAndEditsTo', 'Deployments, config changes and edits to this service will show up here.')}
            />
        );
    }

    return (
        <div className="events-tab">
            {/* One row of chrome: the view name is this tab's heading and the
                search, the filter and the "⋮" ride the same line. ServiceDetail
                owns the page top bar, so the chrome stays inline here rather
                than being hoisted (see useTopbarChrome). Refresh is not
                repeated as a button — it is in the "⋮". */}
            <GridViewPicker
                views={chrome.views}
                label="events"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={search}
                            onSearch={setSearch}
                            placeholder={t('app.eventsTab.searchActivity', 'Search activity…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={refresh} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            <DataTable
                columns={chrome.columns}
                data={rows}
                keyField="id"
                sorts={sorts}
                onSortsChange={setSorts}
                {...chrome.tableProps}
                // Only a deploy has anything more to show; config and audit
                // rows are already fully rendered, exactly as the old timeline
                // made only deploy entries expandable.
                onRowClick={(event) => { if (event.kind === 'deploy') setDeployDetail(event); }}
                rowClassName={(event) => (event.kind === 'deploy' ? '' : 'is-static')}
                emptyTitle="No activity matches your search."
                emptyMessage=""
                footer={(
                    <DataTableFooter
                        // DataTable applies the column rules itself, so the
                        // shown count comes from the chrome — `events` is only
                        // ever the whole merged stream.
                        shown={chrome.shownCount}
                        total={events.length}
                        noun="event"
                    />
                )}
            />

            <GridFilterDrawer {...chrome.drawerProps} />

            {/* The old timeline expanded a deploy row in place to show its
                build log. A row cannot expand inside a shared table, so the
                same log opens in the app's one drawer instead. */}
            <Drawer
                open={!!deployDetail}
                onOpenChange={(open) => { if (!open) setDeployDetail(null); }}
                title={deployDetail?.text || t('app.eventsTab.deployment', 'Deployment')}
                subtitle={deployDetail?.at ? new Date(deployDetail.at).toLocaleString() : ''}
            >
                {deployDetail?.deploy && (
                    <>
                        <InfoList>
                            <InfoItem label={t('common.labels.status', 'Status')} value={deployDetail.status} />
                            <InfoItem label={t('app.eventsTab.triggeredBy', 'Triggered by')} value={deployDetail.actor} />
                            {deployDetail.deploy.branch && (
                                <InfoItem label={t('common.labels.branch', 'Branch')} value={deployDetail.deploy.branch} mono />
                            )}
                            {deployDetail.deploy.commitSha && (
                                <InfoItem label={t('app.eventsTab.commit', 'Commit')} value={deployDetail.deploy.commitSha} mono />
                            )}
                            {deployDetail.deploy.duration && (
                                <InfoItem label={t('common.labels.duration', 'Duration')} value={formatDuration(deployDetail.deploy.duration)} />
                            )}
                        </InfoList>
                        {deployDetail.deploy.logs ? (
                            <div className="events-tab__event-logs">
                                <pre>{deployDetail.deploy.logs}</pre>
                            </div>
                        ) : (
                            <p className="events-tab__none">{t('app.eventsTab.noBuildLogWasCapturedFor', 'No build log was captured for this deployment.')}</p>
                        )}
                    </>
                )}
            </Drawer>
        </div>
    );
};

export default EventsTab;
