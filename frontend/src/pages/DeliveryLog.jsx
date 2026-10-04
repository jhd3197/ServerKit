import { useState, useEffect, useCallback, useMemo } from 'react';
import { Send, Inbox } from 'lucide-react';
import api from '../services/api';
import {
    FilterDrawer, FilterButton, DataTable, DataTableFooter,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import PageLayout from '../layouts/PageLayout';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { Button } from '@/components/ui/button';
import { useAuth } from '../contexts/useAuth.js';
import { useToast } from '../contexts/useToast.js';
import { timeAgo } from '../utils/time';
import EmailProviders from '../components/EmailProviders';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { errorReason } from '@/utils/errorMessage';

const STATUSES = ['all', 'pending', 'sent', 'failed', 'skipped'];
const CHANNELS = ['all', 'inapp', 'email', 'discord', 'slack', 'telegram', 'webhook'];
const POLL_MS = 5000;

// Built-in saved views.
//
// This list is SERVER-filtered and SERVER-paginated: GET /admin/deliveries
// takes `status` and `channel` and returns only the newest page of matches
// (50 by default), while `stats` is a group-by over every row in the table.
// A client-side column rule can therefore only narrow the page already loaded
// — it can never reach the rows the server left behind. So every status preset
// drives the SERVER filter through the `page` bag instead, which is what makes
// a preset's row set the same set the old "Sent / Pending / Failed" tiles were
// counting rather than a per-page shadow of it.
//
// Both `status` and `channel` are spelled out on every preset even when one is
// 'all': `capture()` always emits both, so a preset that omits one can never
// compare equal to the live state and the view would read as permanently
// unsaved.
const SERVER = (status, channel = 'all') => ({
    sorts: [],
    hiddenKeys: [],
    columnFilters: { match: 'all', rules: [] },
    page: { status, channel },
});

const DELIVERY_BUILTIN_VIEWS = [
    // What broke. The server already returns newest-first, so no sort is needed
    // to put the most recent failure at the top.
    { name: 'Failed', state: SERVER('failed') },
    // Still in the queue — nothing has been handed to a channel yet.
    { name: 'Pending', state: SERVER('pending') },
    { name: 'Sent', state: SERVER('sent') },
    // Deliberately not sent, almost always because the recipient has the
    // channel enabled but no target on file (no email address, no chat id).
    // A misconfiguration bucket, not a failure one.
    { name: 'Skipped', state: SERVER('skipped') },
    {
        // The only preset that has to be a client rule: the server's channel
        // filter is equality, so "everything except in-app" has no server-side
        // equivalent. It narrows the loaded page rather than the whole table,
        // which is the right trade here — in-app rows are the bulk of the log
        // (one per admin per notification) and drown out the channels that can
        // actually fail on the wire.
        name: 'External channels',
        state: {
            sorts: [],
            hiddenKeys: [],
            page: { status: 'all', channel: 'all' },
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ex1', field: 'channel', op: 'none', value: ['inapp'] }],
            },
        },
    },
];

export default function DeliveryLog() {
    const { t } = useTranslation();
    const { isAdmin } = useAuth();
    const toast = useToast();
    const [deliveries, setDeliveries] = useState([]);
    const [status, setStatus] = useState('all');
    const [channel, setChannel] = useState('all');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const load = useCallback(async () => {
        try {
            const params = {};
            if (status !== 'all') params.status = status;
            if (channel !== 'all') params.channel = channel;
            const data = await api.getDeliveryLog(params);
            setDeliveries(data.deliveries || []);
            setLoadError(null);
        } catch (err) {
            // Leave the last good state on screen; the error renders above it,
            // or in its place when nothing has loaded yet.
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, [status, channel]);

    // Reload when the filters change; poll on top of that.
    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin, load]);
    usePolling(load, POLL_MS, { enabled: isAdmin, immediate: false });

    const onRetry = async (id) => {
        try {
            await api.retryDelivery(id);
            toast.success(t('app.deliveryLog.deliveryReQueued', 'Delivery re-queued'));
            load();
        } catch (err) {
            toast.error(t('app.deliveryLog.couldntRetryDelivery', "Couldn't retry the delivery. {{reason}}", { reason: errorReason(err) }));
        }
    };

    // Table sort + column visibility, now controlled so the saved views can
    // capture and restore them (they were DataTable-internal before).
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-delivery-log-sort' });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-delivery-log-cols',
    });

    // The page's own half of a view: the two SERVER query params. Changing
    // either re-runs `load`, which is exactly what a status preset needs.
    const viewPageState = useMemo(() => ({ status, channel }), [status, channel]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.status !== undefined) setStatus(saved.status);
        if (saved.channel !== undefined) setChannel(saved.channel);
    }, []);

    // DataTable columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace, so _notification-center.scss keeps
    // applying (.sk-dlog__table, .sk-dlog__status, .sk-dlog__target, ...).
    //
    // `sortValue` stays on every column because useTableSort reads it (and only
    // it) — `value` is the grid's accessor, used by the header menus, the chips
    // and the filter rules.
    const columns = [
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            // Explicit rather than leaning on the sortValue fallback: without it
            // the type inference is free to read this column as plain text, and
            // then an `is any of` rule from a preset or the header menu matches
            // nothing at all.
            value: (d) => d.status || '',
            sortValue: (d) => d.status || '',
            groupable: true,
            render: (d) => <span className={`sk-dlog__status is-${d.status}`}>{d.status}</span>,
        },
        {
            key: 'channel',
            headerKey: 'app.deliveryLog.channel', header: 'Channel',
            sortable: true,
            type: 'enum',
            value: (d) => d.channel || '',
            sortValue: (d) => d.channel || '',
            groupable: true,
            render: (d) => d.channel,
        },
        {
            key: 'target',
            header: 'To',
            sortable: true,
            sortValue: (d) => d.target || null,
            cellClassName: 'sk-dlog__target',
            render: (d) => d.target || '—',
        },
        {
            key: 'notification',
            headerKey: 'app.deliveryLog.notification', header: 'Notification',
            sortable: true,
            sortValue: (d) => d.title || d.event_key || '',
            render: (d) => (
                <>
                    <div className="sk-dlog__title">{d.title || d.event_key}</div>
                    {d.error && <div className="sk-dlog__error" title={d.error}>{d.error}</div>}
                </>
            ),
        },
        {
            key: 'tries',
            headerKey: 'app.deliveryLog.tries', header: 'Tries',
            sortable: true,
            sortValue: (d) => d.attempts ?? 0,
            render: (d) => d.attempts,
        },
        {
            key: 'when',
            headerKey: 'common.labels.when', header: 'When',
            sortable: true,
            // `date`, declared: the sortValue below is epoch milliseconds, and
            // left to infer, the header menu would offer "is under 1723…" on a
            // column whose cells read "3m ago".
            type: 'date',
            value: (d) => d.created_at || null,
            sortValue: (d) => (d.created_at ? new Date(d.created_at).getTime() : null),
            cellClassName: 'sk-dlog__when',
            render: (d) => timeAgo(d.created_at),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            render: (d) => (
                (d.status === 'failed' || d.status === 'skipped') && d.channel !== 'inapp' && (
                    <Button variant="ghost" size="sm" onClick={() => onRetry(d.id)}>{t('common.actions.retry', 'Retry')}</Button>
                )
            ),
        },
    ];

    const chrome = useTableChrome({
        columns,
        rows: deliveries,
        viewPageKey: 'delivery-log',
        builtinViews: DELIVERY_BUILTIN_VIEWS,
        noun: 'deliveries',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (!isAdmin) {
        return (
            <PageLayout icon={<Send size={18} />} title={t('app.deliveryLog.notificationDeliveryLog', 'Notification delivery log')}>
                <div className="sk-dlog"><EmptyState title={t('app.deliveryLog.adminsOnly', 'Admins only.')} /></div>
            </PageLayout>
        );
    }

    const serverFilterCount = (status !== 'all' ? 1 : 0) + (channel !== 'all' ? 1 : 0);

    return (
        <PageLayout
            icon={<Send size={18} />}
            title={t('app.deliveryLog.notificationDeliveryLog', 'Notification delivery log')}
            meta="Outbound deliveries across all channels"
            actions={(
                // Labelled "Server filters" to keep it apart from the toolbar's
                // filter icon: this one re-queries the whole table, that one
                // narrows the rows already on screen.
                <FilterButton
                    label={t('app.deliveryLog.serverFilters', 'Server filters')}
                    count={serverFilterCount}
                    onClick={() => setFiltersOpen(true)}
                />
            )}
        >
            <div className="sk-dlog">
                <EmailProviders />

                {/* The KPI band is gone: Sent / Pending / Failed are the first
                    three built-in views, and the row count belongs to the
                    footer, under the rows it is counting. */}
                <GridViewPicker
                    views={chrome.views}
                    label="deliveries"
                    onCreate={chrome.createView}
                    actions={(
                        <>
                            {/* The chips only ever show CLIENT rules, so the
                                server query the list was fetched under needs
                                saying here — otherwise a status preset silently
                                changes what is loaded with nothing on screen to
                                explain it. */}
                            <span className="sk-listhead__count">
                                {status === 'all' ? 'all statuses' : status}
                                <i>&middot;</i>
                                {channel === 'all' ? 'all channels' : channel}
                            </span>
                            <GridFilterButton
                                count={chrome.filterCount}
                                onClick={() => chrome.setDrawerOpen(true)}
                            />
                            <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
                        </>
                    )}
                />

                <GridChips {...chrome.chipProps} />

                {loadError && deliveries.length > 0 && (
                    <ErrorState compact error={loadError} onRetry={load} />
                )}

                {loading && deliveries.length === 0 ? (
                    <EmptyState loading loadingVariant="table" title={t('common.loading', 'Loading…')} />
                ) : loadError && deliveries.length === 0 ? (
                    <ErrorState
                        title={t('app.deliveryLog.couldntLoadDeliveries', "Couldn't load deliveries")}
                        error={loadError}
                        onRetry={load}
                    />
                ) : deliveries.length === 0 ? (
                    <EmptyState
                        icon={Inbox}
                        title={t('app.deliveryLog.noDeliveriesMatchTheseFilters', 'No deliveries match these filters.')}
                        action={serverFilterCount > 0 ? (
                            <Button variant="outline" onClick={() => { setStatus('all'); setChannel('all'); }}>
                                {t('common.actions.clearFilters', 'Clear filters')}
                            </Button>
                        ) : undefined}
                    />
                ) : (
                    <DataTable
                        columns={chrome.columns}
                        data={deliveries}
                        keyField="id"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        className="sk-dlog__table-wrap"
                        tableClassName="sk-dlog__table"
                        footer={(
                            <DataTableFooter
                                shown={deliveries.length}
                                total={deliveries.length}
                                noun="delivery"
                            />
                        )}
                    />
                )}
            </div>

            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                title={t('app.deliveryLog.filterDeliveries', 'Filter deliveries')}
                activeCount={serverFilterCount}
                groups={[
                    { key: 'status', labelKey: 'common.labels.status', label: 'Status', type: 'single',
                      options: STATUSES.filter((v) => v !== 'all').map((v) => ({ value: v, label: v })) },
                    { key: 'channel', labelKey: 'app.deliveryLog.channel', label: 'Channel', type: 'single',
                      options: CHANNELS.filter((v) => v !== 'all').map((v) => ({ value: v, label: v })) },
                ]}
                value={{
                    status: status === 'all' ? '' : status,
                    channel: channel === 'all' ? '' : channel,
                }}
                onChange={(next) => {
                    setStatus(next.status || 'all');
                    setChannel(next.channel || 'all');
                }}
            />

            <GridFilterDrawer {...chrome.drawerProps} />
        </PageLayout>
    );
}
