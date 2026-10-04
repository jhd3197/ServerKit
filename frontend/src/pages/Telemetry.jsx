// Events — the system event stream (the "Events" tab of the Monitoring group).
//
// Rebuilt on the standard tab-group page pattern. What it used to do wrong:
//   - it rendered its own <PageTopbar> while nested inside <TabGroupLayout>,
//     so the page carried two stacked headers
//   - its KPI row was bespoke `telemetry-stat` divs instead of KpiBand +
//     MetricCard, so it matched nothing else in the panel
//   - filters were an inline collapsible panel instead of the shared topbar
//     SearchField + FilterDrawer that Domains / Cron / Jobs / Monitors use
//
// Every capability it had is kept: source / type / severity / resource / date
// filters, correlation drill-down, test-event emit, cleanup, and pagination.
//
// The KPI band that rebuild introduced is gone again. Five of its six tiles
// were filter shortcuts wearing a number — clicking one only ever set
// `filters.severity` — so they are saved views now (see BUILTIN_VIEWS), which
// is the same shortcut plus a name, a link and a place in the picker. The
// sixth, "Total (24h)", was a real backend aggregate, but the view row is the
// view name alone now and there was nowhere left to put it — so the
// /telemetry/stats call went with it. The footer counts what is loaded.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Activity, ChevronRight, Info, Loader2, RefreshCw, Trash2,
} from 'lucide-react';
import api from '../services/api';
import {
    DataTable, DataTableFooter, Drawer, FilterButton, FilterDrawer,
    Pill, SearchField, countActiveFilters,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridToolsMenu,
} from '@/components/ds/grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useConfirm } from '@/hooks/useConfirm';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useAuth } from '../contexts/useAuth.js';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { statusKind } from '@/components/ds/status';
import { useTranslation } from 'react-i18next';
import { errorReason } from '@/utils/errorMessage';

const SEVERITY_ORDER = ['critical', 'error', 'warning', 'info', 'debug'];

// `pill` is a Pill kind (green|amber|red|cyan|violet|gray) — only tokens Pill
// knows, or the badge silently renders without its background. `label` is the
// one spelling of a severity the whole page uses: the pill, the filter drawer's
// option list and the built-in view names all read from here.
// Severity tones ride the shared vocabulary (plan 77 D3); labels are local.
const SEVERITY_LABEL = {
    critical: 'Critical', error: 'Error', warning: 'Warning',
    info: 'Info', debug: 'Debug',
};

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
    source: '',
    event_type: '',
    severity: '',
    resource_type: '',
    resource_id: '',
    correlation_id: '',
    start_date: '',
    end_date: '',
};

// Built-in saved views, in the shared envelope (see ds/grid/viewState.js).
//
// `page.serverFilters` is this page's SERVER-side query object (EMPTY_FILTERS
// shape: source / event_type / severity / resource_type / …), merged over
// EMPTY_FILTERS and sent straight to the API. It is deliberately NOT
// `columnFilters`: those are client-side column rules, which can only narrow
// the one page of rows already loaded, while this narrows the query. That is
// why the retired severity tiles became these presets and not column rules.
//
// It used to live at the TOP level of the state under the name `filters`, which
// is the envelope's word for column rules — the collision this rename fixes.
// Views users already saved keep working via `rename` on useTableChrome.
const NO_RULES = { match: 'all', rules: [] };
const NEWEST_FIRST = [{ key: 'timestamp', direction: 'desc' }];

// One preset describes a COMPLETE state. `serverFilters` is spelled out even
// when empty, so switching into a view clears the previous one's query instead
// of silently inheriting it — same reason `columnFilters` is always explicit.
const VIEW = (name, serverFilters, sorts = []) => ({
    name,
    state: { sorts, hiddenKeys: [], columnFilters: NO_RULES, page: { serverFilters } },
});

// The severity ladder is the old KPI band, in the band's own order. The three
// that already existed keep their names verbatim — a built-in is identified by
// name, so renaming one would orphan every shared ?view= link and anyone's
// saved default. Info and Debug are new: their tiles had no preset before.
const BUILTIN_VIEWS = [
    VIEW('Critical only', { severity: 'critical' }, NEWEST_FIRST),
    VIEW('Errors', { severity: 'error' }),
    VIEW('Warnings', { severity: 'warning' }),
    VIEW('Info', { severity: 'info' }),
    VIEW('Debug', { severity: 'debug' }),
    VIEW('Newest first', {}, NEWEST_FIRST),
    VIEW('Deploy failures', { source: 'deployment', severity: 'error' }, NEWEST_FIRST),
    VIEW('Backup failures', { source: 'backup', severity: 'error' }, NEWEST_FIRST),
    VIEW('Audit trail', { source: 'audit' }, NEWEST_FIRST),
];

export default function Telemetry() {
    const { t } = useTranslation();
    const { isAdmin } = useAuth();
    const { success: toastSuccess, error: showError } = useToast();
    const { confirm } = useConfirm();

    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [page, setPage] = useState(1);
    const [sources, setSources] = useState([]);
    const [eventTypes, setEventTypes] = useState([]);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [q, setQ] = useState('');

    // Table sort + column visibility, controlled so saved views can drive
    // them — same localStorage keys the DataTable used when uncontrolled.
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-telemetry-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({ storageKey: 'serverkit-table-telemetry-cols' });

    // The page-private half of a saved view: the FilterDrawer's server-side
    // query, and nothing else. The load-more page and the detail drawer are
    // deliberately out — as is `q`, which never was captured: a view that
    // pinned the search box would fight whatever the operator is typing.
    const viewPageState = useMemo(() => ({ serverFilters: filters }), [filters]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.serverFilters !== undefined) {
            setFilters({ ...EMPTY_FILTERS, ...saved.serverFilters });
        }
    }, []);

    const loadFilterOptions = useCallback(async () => {
        try {
            const [sourcesData, typesData] = await Promise.all([
                api.getTelemetrySources(),
                api.getTelemetryEventTypes({ source: filters.source || undefined }),
            ]);
            setSources(sourcesData.sources || []);
            setEventTypes(typesData.event_types || []);
        } catch {
            // filter options are optional
        }
    }, [filters.source]);

    const fetchEvents = useCallback(async (nextPage = 1, replace = true) => {
        setLoading(true);
        try {
            const params = { ...filters, q, per_page: PAGE_SIZE, page: nextPage };
            Object.keys(params).forEach((key) => {
                if (params[key] === '') delete params[key];
            });
            const data = await api.getTelemetryEvents(params);
            const fresh = data.events || [];
            setEvents((prev) => (replace ? fresh : [...prev, ...fresh]));
            setHasMore(fresh.length === PAGE_SIZE);
            setPage(nextPage);
            setLoadError(null);
        } catch (err) {
            // Rendered in the list area (with Retry) rather than as a toast
            // that fades and leaves "No events recorded yet" behind.
            setLoadError(err);
            setHasMore(false);
        } finally {
            setLoading(false);
        }
    }, [filters, q]);

    useEffect(() => {
        loadFilterOptions();
        fetchEvents(1, true);
    }, [loadFilterOptions, fetchEvents]);

    const emitTestEvent = async () => {
        try {
            await api.emitTestTelemetryEvent({
                source: 'system',
                event_type: 'telemetry.test',
                messageKey: 'app.telemetry.testEventFromUi', message: 'Test event from UI',
                severity: 'info',
                payload: { from_ui: true },
            });
            toastSuccess(t('app.telemetry.testEventEmitted', 'Test event emitted'));
            fetchEvents(1, true);
        } catch (err) {
            showError(t('app.telemetry.failedToEmitTestEvent', 'Failed to emit test event: {{message}}', { message: errorReason(err) }));
        }
    };

    const cleanupOldEvents = async () => {
        const confirmed = await confirm({
            title: t('app.telemetry.cleanUpOldEvents', 'Clean up old events'),
            message: t('app.telemetry.deleteTelemetryEventsOlderThan90', 'Delete telemetry events older than 90 days? This cannot be undone.'),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!confirmed) {
            return;
        }
        try {
            const data = await api.cleanupTelemetryEvents(90);
            toastSuccess(t('app.telemetry.deletedOldEvents', 'Deleted {{deleted}} old events', { deleted: data.deleted }));
            fetchEvents(1, true);
        } catch (err) {
            showError(t('app.telemetry.cleanupFailed', 'Cleanup failed: {{message}}', { message: errorReason(err) }));
        }
    };

    const activeFilterCount = countActiveFilters(filters);

    // Search + advanced filters + Refresh live in the group's shared top bar,
    // the way every other list page in the panel does it.
    useTopbarActions(() => (
        <>
            <SearchField value={q} onSearch={(value) => setQ(value.trim())} placeholder={t('app.telemetry.searchMessages', 'Search messages…')} />
            <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
            {isAdmin && (
                <Button variant="outline" size="sm" onClick={emitTestEvent}>
                    <Activity size={14} /> {t('app.telemetry.testEvent', 'Test event')}
                </Button>
            )}
            {isAdmin && (
                <Button variant="outline" size="sm" onClick={cleanupOldEvents}>
                    <Trash2 size={14} /> {t('app.telemetry.cleanup', 'Cleanup')}
                </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => fetchEvents(1, true)} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} /> {t('common.actions.refresh', 'Refresh')}
            </Button>
        </>
    ), [q, activeFilterCount, isAdmin, loading, fetchEvents]);

    const filterGroups = useMemo(() => ([
        {
            key: 'source',
            labelKey: 'common.labels.source', label: 'Source',
            type: 'single',
            options: sources.map((s) => ({ value: s, label: s })),
        },
        {
            key: 'event_type',
            labelKey: 'app.telemetry.eventType', label: 'Event type',
            type: 'single',
            options: eventTypes.map((t) => ({ value: t, label: t })),
        },
        {
            key: 'severity',
            labelKey: 'common.labels.severity', label: 'Severity',
            type: 'single',
            options: SEVERITY_ORDER.map((s) => ({ value: s, label: SEVERITY_LABEL[s] })),
        },
    ]), [sources, eventTypes]);

    const columns = [
        {
            key: 'severity',
            headerKey: 'common.labels.severity', header: 'Severity',
            sortable: true,
            type: 'enum',
            // Sorting and filtering want DIFFERENT values here, so both are
            // spelled out. `sortValue` is the rank, because critical-before-
            // debug is the only useful order and alphabetical is nonsense.
            // `value` is the raw string, because that is what a rule matches —
            // and with only `sortValue` present, `fieldValue` falls back to it,
            // the column infers as `num`, and a rule of `severity is any of
            // critical` compares "critical" against 0 and matches nothing.
            value: (event) => event.severity,
            sortValue: (event) => {
                const rank = SEVERITY_ORDER.indexOf(event.severity);
                return rank === -1 ? null : rank;
            },
            // The grid only ever holds one page of events, so the menu would
            // otherwise list whichever severities the last 50 rows happened to
            // contain, alphabetically. Pin the full ladder in rank order.
            enumOrder: SEVERITY_ORDER,
            render: (event) => {
                const severity = event.severity in SEVERITY_LABEL ? event.severity : 'info';
                return <Pill kind={statusKind(severity)}>{SEVERITY_LABEL[severity]}</Pill>;
            },
        },
        {
            key: 'message',
            headerKey: 'app.telemetry.event', header: 'Event',
            sortable: true,
            sortValue: (event) => event.message || event.event_type || null,
            render: (event) => (
                <div className="telemetry-cell">
                    <div className="telemetry-cell__message">{event.message || event.event_type}</div>
                    <div className="telemetry-cell__meta">
                        <span className="telemetry-cell__source">{event.source}</span>
                        <span className="telemetry-cell__type">{event.event_type}</span>
                        {event.resource_type && (
                            <span className="telemetry-cell__badge">
                                {event.resource_type}:{event.resource_id}
                            </span>
                        )}
                        {event.actor_username && (
                            <span className="telemetry-cell__badge">by {event.actor_username}</span>
                        )}
                    </div>
                </div>
            ),
        },
        {
            key: 'correlation_id',
            headerKey: 'app.telemetry.related', header: 'Related',
            render: (event) => (event.correlation_id ? (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                        e.stopPropagation();
                        setFilters((f) => ({ ...f, correlation_id: event.correlation_id }));
                    }}
                    title={t('app.telemetry.showEveryEventInThisTrace', 'Show every event in this trace')}
                >
                    trace <ChevronRight size={12} />
                </Button>
            ) : <span className="telemetry-cell__muted">—</span>),
        },
        {
            key: 'timestamp',
            headerKey: 'common.labels.when', header: 'When',
            sortable: true,
            sortValue: (event) => (event.timestamp ? new Date(event.timestamp).getTime() : null),
            cellClassName: 'telemetry-cell__when',
            render: (event) => new Date(event.timestamp).toLocaleString(),
        },
    ];

    // Shared list chrome: view picker + chips + column-rule drawer + tools. It
    // sits ALONGSIDE the server-side FilterDrawer above, not in place of it —
    // a column rule sifts the 50 rows on screen, the drawer sifts the query.
    const chrome = useTableChrome({
        columns,
        rows: events,
        viewPageKey: 'telemetry',
        builtinViews: BUILTIN_VIEWS,
        noun: 'events',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
        // Views saved before the envelope kept this page's server-side query at
        // the top level as `filters`, which now means column rules.
        rename: { filters: 'serverFilters' },
    });

    // The "⋮" rides the top bar next to the page's own controls, leaving the
    // view row as just the view name. It is NOT joined by a grid filter button:
    // this page's one filter button is the top bar's, which opens the SERVER
    // query drawer (eight keys, applied to the query rather than the loaded 50).
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <GridToolsMenu {...chrome.toolsProps} onRefresh={() => fetchEvents(1, true)} />,
    );

    const hasFilters = Boolean(q || activeFilterCount);

    return (
        <div className="sk-tabgroup__inner telemetry-page">
            {topbarChrome}
            {/* Outside the empty check below on purpose: a view that returns
                no events must still be swappable for another one. */}
            <GridViewPicker
                views={chrome.views}
                label="events"
                onCreate={chrome.createView}
            
                actions={chromeActions}
            />

            <GridChips {...chrome.chipProps} />

            {filters.correlation_id && (
                <div className="telemetry-trace">
                    <span>
                        {t('app.telemetry.showingOneTrace', 'Showing one trace:')} <code>{filters.correlation_id}</code>
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFilters((f) => ({ ...f, correlation_id: '' }))}
                    >
                        {t('common.actions.clear', 'Clear')}
                    </Button>
                </div>
            )}

            {loadError && events.length > 0 && (
                <ErrorState compact error={loadError} onRetry={() => fetchEvents(1, true)} />
            )}

            {loadError && events.length === 0 && !loading ? (
                <ErrorState
                    title={t('app.telemetry.couldntLoadTelemetry', "Couldn't load telemetry")}
                    error={loadError}
                    onRetry={() => fetchEvents(1, true)}
                />
            ) : events.length === 0 && !loading ? (
                <EmptyState
                    icon={Info}
                    title={hasFilters ? t('app.telemetry.noEventsMatch', 'No events match') : t('app.telemetry.noEventsRecordedYet', 'No events recorded yet')}
                    description={hasFilters
                        ? t('app.telemetry.tryADifferentSearchOrClear', 'Try a different search or clear the filters.')
                        : t('app.telemetry.systemActivityShowsUpHereAs', 'System activity shows up here as it happens.')}
                    action={hasFilters
                        ? (
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setFilters(EMPTY_FILTERS);
                                    setQ('');
                                    // The chips sit right above this button, so
                                    // leaving the column rules armed would read
                                    // as "Clear filters" doing half its job.
                                    chrome.api.resetToView();
                                }}
                            >
                                {t('common.actions.clearFilters', 'Clear filters')}
                            </Button>
                        )
                        : undefined}
                />
            ) : (
                <>
                    <DataTable
                        tableClassName="sk-dtable telemetry-table"
                        data={events}
                        keyField="id"
                        columns={chrome.columns}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        loading={loading && events.length === 0}
                        onRowClick={setSelectedEvent}
                        rowClassName={(event) => `is-${event.severity}`}
                        footer={(
                            <DataTableFooter
                                shown={events.length}
                                total={null}
                                noun="event"
                                hasMore={hasMore}
                                onLoadMore={() => fetchEvents(page + 1, false)}
                                loading={loading}
                            />
                        )}
                    />

                    {loading && events.length > 0 && (
                        <div className="telemetry-loading"><Loader2 size={20} className="spin" /></div>
                    )}
                </>
            )}

            {/* The query filter, opened from the top bar's FilterButton. It
                narrows what the API returns, so it reaches every event on the
                server — not just the page in memory. The column-rule drawer
                below is the other tool, not a replacement for this one. */}
            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filters}
                onChange={setFilters}
                onClear={() => setFilters(EMPTY_FILTERS)}
                activeCount={activeFilterCount}
                title={t('app.telemetry.filterEvents', 'Filter events')}
            >
                {/* Free-text and date bounds don't fit the option-list shape the
                    drawer's groups use, so they ride along as extra fields. */}
                <div className="form-group">
                    <Label htmlFor="tel-resource-type">{t('app.telemetry.resourceType', 'Resource type')}</Label>
                    <Input
                        id="tel-resource-type"
                        value={filters.resource_type}
                        onChange={(e) => setFilters({ ...filters, resource_type: e.target.value })}
                        placeholder="application"
                    />
                </div>
                <div className="form-group">
                    <Label htmlFor="tel-resource-id">{t('app.telemetry.resourceId', 'Resource ID')}</Label>
                    <Input
                        id="tel-resource-id"
                        value={filters.resource_id}
                        onChange={(e) => setFilters({ ...filters, resource_id: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <Label htmlFor="tel-start">{t('app.telemetry.from', 'From')}</Label>
                    <Input
                        id="tel-start"
                        type="datetime-local"
                        value={filters.start_date}
                        onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
                    />
                </div>
                <div className="form-group">
                    <Label htmlFor="tel-end">To</Label>
                    <Input
                        id="tel-end"
                        type="datetime-local"
                        value={filters.end_date}
                        onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
                    />
                </div>
            </FilterDrawer>

            <Drawer
                open={Boolean(selectedEvent)}
                onOpenChange={(open) => { if (!open) setSelectedEvent(null); }}
                title={selectedEvent?.message || selectedEvent?.event_type || t('app.telemetry.event', 'Event')}
                subtitle={selectedEvent
                    ? `${selectedEvent.source} · ${new Date(selectedEvent.timestamp).toLocaleString()}`
                    : ''}
                icon={<Activity size={18} />}
            >
                {selectedEvent && (
                    <div className="telemetry-detail">
                        <dl className="mon-inforows">
                            <div><dt>ID</dt><dd><code>{selectedEvent.id}</code></dd></div>
                            <div><dt>{t('common.labels.type', 'Type')}</dt><dd>{selectedEvent.event_type}</dd></div>
                            <div>
                                <dt>{t('common.labels.severity', 'Severity')}</dt>
                                <dd>
                                    <Pill kind={statusKind(selectedEvent.severity in SEVERITY_LABEL ? selectedEvent.severity : 'info')}>
                                        {selectedEvent.severity}
                                    </Pill>
                                </dd>
                            </div>
                            {selectedEvent.resource_type && (
                                <div>
                                    <dt>{t('app.telemetry.resource', 'Resource')}</dt>
                                    <dd>{selectedEvent.resource_type}:{selectedEvent.resource_id}</dd>
                                </div>
                            )}
                            {selectedEvent.actor_username && (
                                <div><dt>{t('app.telemetry.actor', 'Actor')}</dt><dd>{selectedEvent.actor_username}</dd></div>
                            )}
                            {selectedEvent.correlation_id && (
                                <div>
                                    <dt>{t('app.telemetry.correlation', 'Correlation')}</dt>
                                    <dd>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setFilters((f) => ({ ...f, correlation_id: selectedEvent.correlation_id }));
                                                setSelectedEvent(null);
                                            }}
                                        >
                                            {selectedEvent.correlation_id} <ChevronRight size={12} />
                                        </Button>
                                    </dd>
                                </div>
                            )}
                        </dl>
                        <h4 className="telemetry-detail__heading">{t('app.telemetry.payload', 'Payload')}</h4>
                        <pre className="telemetry-detail__payload">
                            {JSON.stringify(selectedEvent.payload || {}, null, 2)}
                        </pre>
                    </div>
                )}
            </Drawer>
        </div>
    );
}
