// Errors — the error tracker (backend + frontend exceptions, deduplicated by
// fingerprint), a tab in the Monitoring group.
//
// Follows the group's standard tab-page pattern (Telemetry / Jobs): the shared
// PageTopbar carries SearchField + Refresh via useTopbarActions, quick filters
// are SegControls in the one ListToolbar, and the list is a server-paginated
// DataTable whose footer owns the count and the pager. A row click opens the
// detail Drawer; resolve/delete live there, not in row actions.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertOctagon, CheckCheck, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import api from '../services/api';
import {
    DataTable, DataTableFooter, Drawer, ListToolbar, Pill, SearchField, SegControl,
} from '@/components/ds';
import { Button } from '@/components/ui/button';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { useConfirm } from '@/hooks/useConfirm';
import { useAuth } from '../contexts/useAuth.js';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import { timeAgo } from '../utils/time';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const PAGE_SIZE = 50;

// `level` is a free-form severity string from the reporter; bucket it onto the
// Pill palette. Anything unrecognized renders gray rather than guessing.
const LEVEL_KIND = {
    critical: 'red',
    fatal: 'red',
    error: 'red',
    warning: 'amber',
    warn: 'amber',
    info: 'cyan',
    debug: 'gray',
};

function levelKind(level) {
    return LEVEL_KIND[String(level || '').toLowerCase()] || 'gray';
}

function formatStamp(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

// `context` arrives as an object from the API but is rendered as text; a
// string context (already JSON, or a plain note) is shown verbatim.
function contextText(context) {
    if (context == null) return null;
    if (typeof context === 'string') return context;
    try {
        return JSON.stringify(context, null, 2);
    } catch {
        return String(context);
    }
}

export default function Errors() {
    const { t } = useTranslation();
    const { isAdmin } = useAuth();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [entries, setEntries] = useState([]);
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [page, setPage] = useState(1);
    const [stats, setStats] = useState(null);
    const [source, setSource] = useState('all');       // all | backend | frontend
    const [status, setStatus] = useState('all');       // all | unresolved | resolved
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState(null);

    // Only the newest query may paint. Changing a filter (or the page) while a
    // load is in flight fires a second request against different params, and
    // the two can settle out of order — the older one would otherwise repaint
    // the table with rows the toolbar no longer describes. The same token
    // guards setLoading(false), so the first of two overlapping responses
    // cannot stop the Refresh spinner while the second is still running.
    //
    // Identical back-to-back loads (Refresh clicked twice) never get this far:
    // ApiService coalesces in-flight GETs by URL — see services/api/client.js.
    // Same shape as the drawer's own stale-response check in openDetail below.
    const reqSeq = useRef(0);

    const load = useCallback(async () => {
        const seq = ++reqSeq.current;
        setLoading(true);
        try {
            const params = { page, per_page: PAGE_SIZE };
            if (source !== 'all') params.source = source;
            if (status !== 'all') params.resolved = status === 'resolved';
            if (q) params.search = q;
            const data = await api.getErrorLogs(params);
            if (seq !== reqSeq.current) return;
            setEntries(data.items || []);
            setTotal(data.total ?? (data.items?.length || 0));
            setPages(data.pages ?? 1);
        } catch {
            // Keep the last good list on screen rather than blanking the page.
        } finally {
            if (seq === reqSeq.current) setLoading(false);
        }
    }, [page, source, status, q]);

    const loadStats = useCallback(async () => {
        try {
            setStats(await api.getErrorLogStats());
        } catch {
            // The strip is a summary; the table below is the source of truth.
        }
    }, []);

    useEffect(() => {
        if (!isAdmin) return;
        load();
        loadStats();
    }, [isAdmin, load, loadStats]);

    // Any filter change restarts pagination — staying on page 4 of the old
    // query would land on an empty table.
    const onSourceChange = (value) => { setSource(value); setPage(1); };
    const onStatusChange = (value) => { setStatus(value); setPage(1); };
    const onSearch = (value) => { setQ(value.trim()); setPage(1); };
    const refresh = () => { load(); loadStats(); };

    // Search + Refresh live in the group's shared top bar, the way every other
    // list page in the panel does it.
    useTopbarActions(() => {
        if (!isAdmin) return null;
        return (
            <>
                <SearchField value={q} onSearch={onSearch} placeholder={t('app.errors.searchMessagesOrTypes', 'Search messages or types…')} />
                <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                    <RefreshCw size={14} className={loading ? 'spin' : ''} /> {t('common.actions.refresh', 'Refresh')}
                </Button>
            </>
        );
    }, [isAdmin, q, loading, load, loadStats]);

    // The list rows already carry the full record (traceback, context); the
    // detail call only refreshes count/resolved while the drawer is open.
    const openDetail = (entry) => {
        setSelected(entry);
        api.getErrorLog(entry.id)
            .then((data) => setSelected((cur) => (cur && cur.id === entry.id ? { ...entry, ...data } : cur)))
            .catch(() => { /* the list row is enough */ });
    };

    const onToggleResolve = async (entry) => {
        try {
            await api.resolveErrorLog(entry.id, !entry.resolved);
            toast.success(entry.resolved ? t('app.errors.markedAsUnresolved', 'Marked as unresolved') : t('app.errors.markedAsResolved', 'Marked as resolved'));
            setSelected(null);
            refresh();
        } catch (err) {
            toastError(toast, t('app.errors.updateFailed', "Couldn't update it."), err);
        }
    };

    const onDelete = async (entry) => {
        const confirmed = await confirm({
            title: t('app.errors.deleteError', 'Delete error'),
            message: t('app.errors.deleteAndItsHistoryThisCannot', 'Delete "{{value}}" and its history? This cannot be undone.', { value: entry.exception_type || 'this error' }),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.deleteErrorLog(entry.id);
            toast.success(t('app.errors.errorDeleted', 'Error deleted'));
            setSelected(null);
            refresh();
        } catch (err) {
            toastError(toast, t('app.errors.deleteFailed', "Couldn't delete it."), err);
        }
    };

    const columns = [
        {
            key: 'level',
            headerKey: 'app.errors.level', header: 'Level',
            sortable: true,
            type: 'enum',
            value: (e) => e.level || '',
            sortValue: (e) => e.level || '',
            render: (e) => <Pill kind={levelKind(e.level)}>{e.level || 'error'}</Pill>,
        },
        {
            key: 'source',
            headerKey: 'common.labels.source', header: 'Source',
            sortable: true,
            type: 'enum',
            value: (e) => e.source || '',
            sortValue: (e) => e.source || '',
            render: (e) => (
                <Pill kind={e.source === 'frontend' ? 'violet' : 'cyan'} dot={false}>{e.source}</Pill>
            ),
        },
        {
            key: 'error',
            headerKey: 'app.errors.error', header: 'Error',
            sortable: true,
            sortValue: (e) => e.exception_type || e.message || '',
            render: (e) => (
                <div className="sk-err__cell">
                    <div className="sk-err__type">{e.exception_type || t('app.errors.errorType', 'Error')}</div>
                    <div className="sk-err__message" title={e.message}>{e.message}</div>
                </div>
            ),
        },
        {
            key: 'endpoint',
            headerKey: 'app.errors.endpoint', header: 'Endpoint',
            sortable: true,
            sortValue: (e) => e.endpoint || null,
            cellClassName: 'sk-err__endpoint',
            render: (e) => (e.endpoint
                ? <span title={e.endpoint}>{e.method ? `${e.method} ` : ''}{e.endpoint}</span>
                : <span className="sk-err__muted">—</span>),
        },
        {
            key: 'count',
            headerKey: 'app.errors.count', header: 'Count',
            sortable: true,
            type: 'number',
            value: (e) => e.count ?? 1,
            sortValue: (e) => e.count ?? 1,
            render: (e) => ((e.count ?? 1) > 1
                ? <span className="sk-err__count">×{e.count}</span>
                : <span className="sk-err__muted">1</span>),
        },
        {
            key: 'last_seen',
            headerKey: 'app.errors.lastSeen', header: 'Last seen',
            sortable: true,
            type: 'date',
            value: (e) => e.last_seen || null,
            sortValue: (e) => (e.last_seen ? new Date(e.last_seen).getTime() : null),
            cellClassName: 'sk-err__when',
            render: (e) => <span title={formatStamp(e.last_seen)}>{timeAgo(e.last_seen) || '—'}</span>,
        },
        {
            key: 'resolved',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            value: (e) => (e.resolved ? 'Resolved' : 'Unresolved'),
            sortValue: (e) => (e.resolved ? 'Resolved' : 'Unresolved'),
            render: (e) => (
                <Pill kind={e.resolved ? 'green' : 'red'}>{e.resolved ? t('app.errors.resolved', 'Resolved') : t('app.errors.unresolved', 'Unresolved')}</Pill>
            ),
        },
    ];

    if (!isAdmin) {
        return (
            <div className="sk-tabgroup__inner errors-page">
                <EmptyState title={t('app.errors.adminsOnly', 'Admins only.')} />
            </div>
        );
    }

    const hasFilters = Boolean(q || source !== 'all' || status !== 'all');
    const selectedContext = selected ? contextText(selected.context) : null;

    return (
        <div className="sk-tabgroup__inner errors-page">
            {/* Whole-table aggregates — the footer counts only the loaded page,
                so Total / Unresolved / Last 24h come from /error-logs/stats. */}
            {stats && (
                <div className="stat-strip">
                    <div className="stat-strip__item">
                        <span className="stat-strip__label">{t('app.errors.total', 'Total')}</span>
                        <span className="stat-strip__value">{stats.total ?? 0}</span>
                    </div>
                    <div className={`stat-strip__item${stats.unresolved ? ' is-danger' : ''}`}>
                        <span className="stat-strip__label">{t('app.errors.unresolved', 'Unresolved')}</span>
                        <span className="stat-strip__value">
                            <span className="stat-strip__dot" />
                            {stats.unresolved ?? 0}
                        </span>
                    </div>
                    <div className="stat-strip__item">
                        <span className="stat-strip__label">{t('app.errors.last24h', 'Last 24h')}</span>
                        <span className="stat-strip__value">{stats.last_24h ?? 0}</span>
                    </div>
                </div>
            )}

            {/* One toolbar row: the two quick filters are SegControls, per the
                shared ListToolbar anatomy. */}
            <ListToolbar
                filters={(
                    <>
                        <SegControl
                            value={source}
                            onChange={onSourceChange}
                            options={[
                                { value: 'all', labelKey: 'common.labels.all', label: 'All' },
                                { value: 'backend', labelKey: 'app.errors.backend', label: 'Backend', count: stats?.by_source?.backend },
                                { value: 'frontend', labelKey: 'app.errors.frontend', label: 'Frontend', count: stats?.by_source?.frontend },
                            ]}
                        />
                        <SegControl
                            value={status}
                            onChange={onStatusChange}
                            options={[
                                { value: 'all', labelKey: 'common.labels.all', label: 'All' },
                                { value: 'unresolved', labelKey: 'app.errors.unresolved', label: 'Unresolved' },
                                { value: 'resolved', labelKey: 'app.errors.resolved', label: 'Resolved' },
                            ]}
                        />
                    </>
                )}
            />

            <DataTable
                tableClassName="sk-dtable errors-table"
                storageKey="serverkit-table-errors"
                data={entries}
                keyField="id"
                columns={columns}
                loading={loading && entries.length === 0}
                onRowClick={openDetail}
                rowClassName={(e) => (e.resolved ? 'is-resolved' : undefined)}
                emptyTitle={hasFilters ? 'No errors match these filters.' : 'No errors recorded yet.'}
                emptyMessage={hasFilters
                    ? t('app.errors.tryADifferentSearchOrClear', 'Try a different search or clear the filters.')
                    : t('app.errors.uncaughtBackendAndFrontendExceptionsWill', 'Uncaught backend and frontend exceptions will show up here, grouped by fingerprint.')}
                footer={(
                    <DataTableFooter
                        shown={entries.length}
                        total={total}
                        noun="error"
                        page={page}
                        totalPages={pages}
                        onPageChange={setPage}
                    />
                )}
            />

            <Drawer
                open={Boolean(selected)}
                onOpenChange={(open) => { if (!open) setSelected(null); }}
                title={selected?.exception_type || t('app.errors.error', 'Error')}
                subtitle={selected ? `${selected.source} · ${selected.endpoint || t('app.errors.noEndpoint', 'no endpoint')}` : ''}
                icon={<AlertOctagon size={18} />}
                width={640}
            >
                {selected && (
                    <div className="err-detail">
                        <dl className="err-detail__rows">
                            <div><dt>{t('app.errors.message', 'Message')}</dt><dd>{selected.message}</dd></div>
                            <div>
                                <dt>{t('app.errors.level', 'Level')}</dt>
                                <dd><Pill kind={levelKind(selected.level)}>{selected.level || 'error'}</Pill></dd>
                            </div>
                            <div><dt>{t('common.labels.source', 'Source')}</dt><dd>{selected.source}</dd></div>
                            {selected.endpoint && (
                                <div>
                                    <dt>{t('app.errors.endpoint', 'Endpoint')}</dt>
                                    <dd>{selected.method ? `${selected.method} ` : ''}{selected.endpoint}</dd>
                                </div>
                            )}
                            {selected.user_id != null && (
                                <div><dt>{t('common.labels.user', 'User')}</dt><dd>#{selected.user_id}</dd></div>
                            )}
                            <div><dt>{t('app.errors.fingerprint', 'Fingerprint')}</dt><dd><code>{selected.fingerprint}</code></dd></div>
                            <div><dt>{t('app.errors.occurrences', 'Occurrences')}</dt><dd>{selected.count ?? 1}</dd></div>
                            <div><dt>{t('app.errors.firstSeen', 'First seen')}</dt><dd>{formatStamp(selected.first_seen)}</dd></div>
                            <div><dt>{t('app.errors.lastSeen', 'Last seen')}</dt><dd>{formatStamp(selected.last_seen)}</dd></div>
                            <div>
                                <dt>{t('common.labels.status', 'Status')}</dt>
                                <dd>
                                    <Pill kind={selected.resolved ? 'green' : 'red'}>
                                        {selected.resolved ? t('app.errors.resolved', 'Resolved') : t('app.errors.unresolved', 'Unresolved')}
                                    </Pill>
                                </dd>
                            </div>
                        </dl>

                        {selected.traceback && (
                            <>
                                <h4 className="err-detail__heading">{t('app.errors.traceback', 'Traceback')}</h4>
                                <pre className="err-detail__traceback">{selected.traceback}</pre>
                            </>
                        )}

                        {selectedContext && (
                            <>
                                <h4 className="err-detail__heading">{t('app.errors.context', 'Context')}</h4>
                                <pre className="err-detail__context">{selectedContext}</pre>
                            </>
                        )}

                        <div className="err-detail__actions">
                            <Button variant="outline" size="sm" onClick={() => onToggleResolve(selected)}>
                                {selected.resolved
                                    ? <><Undo2 size={14} /> {t('app.errors.markUnresolved', 'Mark unresolved')}</>
                                    : <><CheckCheck size={14} /> {t('app.errors.markResolved', 'Mark resolved')}</>}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => onDelete(selected)}>
                                <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                            </Button>
                        </div>
                    </div>
                )}
            </Drawer>
        </div>
    );
}
