import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Inbox,
    Send,
    Trash2,
    RefreshCw,
    Lock,
    X,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
    DataTable, DataTableFooter, MetricCard, KpiBand, Pill, SortChipBar,
    statusKind, statusLabel,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

const STATUS_ORDER = ['pending', 'in_flight', 'completed', 'failed', 'dead_letter'];

const POLL_INTERVAL = 3000;

// Built-in saved views.
//
// These views are shared by EVERY queue this route renders, so nothing here may
// name a queue or a group — each one is a statement about messages.
//
// The status presets drive the page's own `statusFilter` (the `page` bag)
// rather than a column rule. /messages is filtered SERVER side and capped at
// 100 rows, so a client-side rule could only narrow the page that already
// loaded; asking the server for `dead_letter` is the only way to see a dead
// letter that sits past row 100 of a busy queue.
const PAGE = (statusFilter) => ({ statusFilter });
const NO_RULES = { match: 'all', rules: [] };

const BUILTIN_VIEWS = [
    {
        // Head of line first — the oldest pending message is the one holding
        // up everything behind it.
        name: 'Waiting',
        state: {
            page: PAGE('pending'), hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'created', direction: 'asc' }],
        },
    },
    {
        // Leased to a consumer. Oldest first: a message that has been in
        // flight for a long time is a consumer that died holding the lease.
        name: 'In flight',
        state: {
            page: PAGE('in_flight'), hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'created', direction: 'asc' }],
        },
    },
    {
        // Erroring but still inside max_attempts. Most-attempted first, which
        // is the order they will give up in.
        name: 'Failed',
        state: {
            page: PAGE('failed'), hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'attempts', direction: 'desc' }],
        },
    },
    {
        // Retries exhausted: the requeue worklist.
        name: 'Dead letter',
        state: {
            page: PAGE('dead_letter'), hiddenKeys: [], columnFilters: NO_RULES,
            sorts: [{ key: 'created', direction: 'desc' }],
        },
    },
    {
        // A first-time delivery leaves attempts at 1, so `> 1` is exactly the
        // set that needed redelivering — a flaky consumer shows up here across
        // every status, including the messages that eventually completed.
        name: 'Retried',
        state: {
            page: PAGE('all'), hiddenKeys: [],
            sorts: [{ key: 'attempts', direction: 'desc' }],
            columnFilters: { match: 'all', rules: [{ id: 'retry', field: 'attempts', op: 'gt', value: 1 }] },
        },
    },
];

const QueueDetail = () => {
    const { t } = useTranslation();
    const { groupSlug, queueSlug } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [loading, setLoading] = useState(true);
    const [queue, setQueue] = useState(null);
    const [group, setGroup] = useState(null);
    const [messages, setMessages] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [showSend, setShowSend] = useState(false);
    const [sendForm, setSendForm] = useState({ payload: '{}', priority: 0, delay_ms: 0 });
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-queue-messages-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-queue-messages-cols' });

    // The one narrowing control this page owns, as the envelope's `page` bag.
    // It is a SERVER filter — restoring it refetches rather than re-slicing.
    const viewPageState = useMemo(() => ({ statusFilter }), [statusFilter]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.statusFilter !== undefined) setStatusFilter(saved.statusFilter);
    }, []);


    const viewOnly = group?.owner_type === 'system';

    const loadMeta = useCallback(async () => {
        try {
            const [queueRes, groupRes] = await Promise.all([
                api.getQueue(groupSlug, queueSlug),
                api.getQueueGroup(groupSlug).catch(() => null),
            ]);
            setQueue(queueRes.queue || null);
            setGroup(groupRes?.group || null);
        } catch (err) {
            toast.error(err.message);
            navigate('/queue');
        } finally {
            setLoading(false);
        }
    }, [groupSlug, queueSlug, navigate, toast]);

    const loadMessages = useCallback(async (status) => {
        try {
            const res = await api.getMessages(groupSlug, queueSlug, {
                status: status === 'all' ? undefined : status,
                limit: 100,
            });
            setMessages(res.messages || []);
        } catch (err) {
            toast.error(err.message);
        }
    }, [groupSlug, queueSlug, toast]);

    useEffect(() => {
        loadMeta();
    }, [loadMeta]);

    // Reload when the status filter or the queue changes; poll on top of that.
    useEffect(() => {
        loadMessages(statusFilter);
    }, [statusFilter, loadMessages]);

    usePolling(async () => {
        // Awaited together so the in-flight guard covers BOTH requests: the
        // guard only knows a tick is done when the promise it was handed
        // settles, and a bare .then() would report done before the queue call.
        await Promise.all([
            loadMessages(statusFilter),
            api.getQueue(groupSlug, queueSlug)
                .then((r) => setQueue(r.queue || null))
                .catch(() => {}),
        ]);
    }, POLL_INTERVAL, { immediate: false });

    const stats = queue?.stats || {};

    const handleSend = async (e) => {
        e.preventDefault();
        let payload = {};
        try {
            payload = JSON.parse(sendForm.payload);
        } catch {
            toast.error(t('app.queueDetail.payloadMustBeValidJson', 'Payload must be valid JSON'));
            return;
        }
        try {
            await api.sendMessage(groupSlug, queueSlug, payload, {
                priority: parseInt(sendForm.priority, 10) || 0,
                delay_ms: parseInt(sendForm.delay_ms, 10) || 0,
            });
            toast.success(t('app.queueDetail.messageSent', 'Message sent'));
            setShowSend(false);
            setSendForm({ payload: '{}', priority: 0, delay_ms: 0 });
            loadMessages(statusFilter);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRequeue = async (msg) => {
        try {
            await api.requeueMessage(groupSlug, queueSlug, msg.id);
            toast.success(t('app.queueDetail.messageRequeued', 'Message requeued'));
            loadMessages(statusFilter);
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDelete = async (msg) => {
        const confirmed = await confirm({
            title: t('app.queueDetail.deleteMessage', 'Delete message'),
            message: t('app.queueDetail.permanentlyDeleteThisMessage', 'Permanently delete this message?'),
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.deleteMessage(groupSlug, queueSlug, msg.id);
            toast.success(t('app.queueDetail.messageDeleted', 'Message deleted'));
            if (selectedMessage?.id === msg.id) setSelectedMessage(null);
            loadMessages(statusFilter);
        } catch (err) {
            toast.error(err.message);
        }
    };

    // DataTable columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace, so _queue-operations.scss keeps applying
    // (.queue-table, .col-actions, .queue-payload-preview, .queue-actions).
    const columns = [
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // `value` is not optional here. The rule engine falls back to
            // sortValue when a column has none, and this sortValue is a
            // lifecycle RANK — a status rule would then compare 'failed'
            // against 3 and match nothing at all.
            type: 'enum',
            value: (msg) => msg.status,
            enumOrder: STATUS_ORDER,
            // Lifecycle order, not alphabet.
            sortValue: (msg) => STATUS_ORDER.indexOf(msg.status),
            render: (msg) => <Pill kind={statusKind(msg.status)}>{msg.status}</Pill>,
        },
        {
            key: 'payload',
            headerKey: 'app.queueDetail.payload', header: 'Payload',
            sortable: false,
            // The raw payload is an object, and `contains` over one stringifies
            // to '[object Object]' for every row. Match the text the cell
            // actually shows instead, so "payload contains order_id" works.
            type: 'text',
            value: (msg) => JSON.stringify(msg.payload),
            render: (msg) => <code className="queue-payload-preview">{JSON.stringify(msg.payload).slice(0, 80)}</code>,
        },
        {
            key: 'attempts',
            headerKey: 'app.queueDetail.attempts', header: 'Attempts',
            sortable: true,
            // Declared rather than inferred: the "Retried" preset compares
            // against this, and an inference that saw only zeroes on a fresh
            // queue would type the column and then the rule differently.
            type: 'num',
            value: (msg) => msg.attempts,
            sortValue: (msg) => msg.attempts,
            render: (msg) => <>{msg.attempts} / {msg.max_attempts}</>,
        },
        {
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            // Same split as elsewhere: epoch ms sorts, the ISO string filters.
            // Without `value` the column menu would offer "is under 1755…".
            type: 'date',
            value: (msg) => msg.created_at,
            sortValue: (msg) => new Date(msg.created_at).getTime(),
            render: (msg) => new Date(msg.created_at).toLocaleString(),
        },
        ...(!viewOnly ? [{
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            className: 'col-actions',
            cellClassName: 'col-actions',
            render: (msg) => (
                <div className="queue-actions" onClick={e => e.stopPropagation()}>
                    {(msg.status === 'failed' || msg.status === 'dead_letter') && (
                        <Button variant="ghost" size="sm" onClick={() => handleRequeue(msg)} title={t('app.queueDetail.requeue', 'Requeue')}>
                            <RefreshCw size={14} />
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(msg)} title={t('app.queueDetail.deleteMessage3', 'Delete message')}>
                        <Trash2 size={14} />
                    </Button>
                </div>
            ),
        }] : []),
    ];

    // Shared list chrome: view picker + filter chips + filter drawer + tools.
    // Declared before the loading return so the hook order is stable.
    const chrome = useTableChrome({
        columns,
        rows: messages,
        viewPageKey: 'queue-messages',
        builtinViews: BUILTIN_VIEWS,
        noun: 'messages',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (loading) {
        return (
            <div className="queue-page queue-page--loading">
                <div className="queue-loading-card">
                    <Inbox size={24} />
                    <span>{t('app.queueDetail.loadingQueue', 'Loading queue…')}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="queue-page queue-detail">
            <div className="queue-detail-header">
                <Button variant="unstyled" type="button" className="queue-back" onClick={() => navigate('/queue')}>
                    <ArrowLeft size={16} /> {t('app.queueDetail.queueBus', 'Queue bus')}
                </Button>
                <div className="queue-detail-headline">
                    <div className="queue-workbar-title">
                        <span>{t('app.queueDetail.queue', 'Queue')}</span>
                        <h1>{queue?.name || queueSlug}</h1>
                        <em>{groupSlug} / {queueSlug}</em>
                    </div>
                    <div className="queue-detail-actions">
                        {viewOnly && (
                            <span className="queue-readonly-badge">
                                <Lock size={12} /> {t('app.queueDetail.readOnly', 'Read-only')}
                            </span>
                        )}
                        {!viewOnly && (
                            <Button variant="outline" onClick={() => setShowSend(true)}>
                                <Send size={16} /> {t('app.queueDetail.sendMessage', 'Send message')}
                            </Button>
                        )}
                        <Button variant="outline" onClick={() => { loadMeta(); loadMessages(statusFilter); }}>
                            <RefreshCw size={16} /> {t('common.actions.refresh', 'Refresh')}
                        </Button>
                    </div>
                </div>
            </div>

            <KpiBand>
                <MetricCard label={t('app.queueDetail.total', 'Total')} value={stats.total || 0} />
                {STATUS_ORDER.map(s => (
                    <MetricCard
                        key={s}
                        label={statusLabel(s)}
                        value={stats[s] || 0}
                        kind={s === 'failed' || s === 'dead_letter' ? 'danger' : undefined}
                    />
                ))}
            </KpiBand>

            <div className={`queue-detail-body ${selectedMessage ? 'has-panel' : ''}`}>
                <div className="queue-detail-main">
                    {/* The view name heads the message list, with the table's
                        own chrome on the same line. The queue's own name stays
                        in the detail header above — a view here is about the
                        messages, and is shared by every queue. */}
                    <GridViewPicker
                        views={chrome.views}
                        label="messages"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu
                                    {...chrome.toolsProps}
                                    onRefresh={() => { loadMeta(); loadMessages(statusFilter); }}
                                />
                            </>
                        )}
                    />

                    {/* The status select stays on its own line: it is a SERVER
                        filter, not table chrome — changing it refetches. */}
                    <div className="queue-messages-toolbar">
                        <div className="queue-messages-selects">
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="queue-select" aria-label={t('app.queueDetail.allStatuses', 'All statuses')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t('app.queueDetail.allStatuses', 'All statuses')}</SelectItem>
                                    {STATUS_ORDER.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <GridChips {...chrome.chipProps} />

                    <SortChipBar columns={columns} sorts={sorts} onChange={setSorts} />

                    {messages.length === 0 ? (
                        <EmptyState
                            icon={Inbox}
                            title={t('app.queueDetail.noMessages', 'No messages')}
                            description={viewOnly
                                ? t('app.queueDetail.thisSystemQueueHasNoMessages', 'This system queue has no messages in this view.')
                                : t('app.queueDetail.thisQueueIsEmptySendA', 'This queue is empty. Messages you send appear here.')}
                        />
                    ) : (
                        <DataTable
                            columns={chrome.columns}
                            data={messages}
                            keyField="id"
                            sorts={sorts}
                            onSortsChange={setSorts}
                            {...chrome.tableProps}
                            onRowClick={(msg) => setSelectedMessage(msg)}
                            rowClassName={(msg) => (selectedMessage?.id === msg.id ? 'is-selected' : '')}
                            className="queue-table-wrap"
                            tableClassName="queue-table"
                            footer={(
                                <DataTableFooter
                                    shown={messages.length}
                                    total={messages.length}
                                    noun="message"
                                />
                            )}
                        />
                    )}
                </div>

                {selectedMessage && (
                    <aside className="queue-detail-panel">
                        <div className="queue-detail-panel-header">
                            <h2>{t('app.queueDetail.message', 'Message')}</h2>
                            <Button variant="unstyled" type="button" className="queue-panel-close" onClick={() => setSelectedMessage(null)} aria-label={t('common.actions.close', 'Close')}>
                                <X size={16} />
                            </Button>
                        </div>
                        <div className="queue-message-detail">
                            <div><strong>{t('app.queueDetail.id', 'ID:')}</strong> <code>{selectedMessage.id}</code></div>
                            <div><strong>{t('app.queueDetail.status2', 'Status:')}</strong> <Pill kind={statusKind(selectedMessage.status)}>{selectedMessage.status}</Pill></div>
                            <div><strong>{t('app.queueDetail.attempts2', 'Attempts:')}</strong> {selectedMessage.attempts} / {selectedMessage.max_attempts}</div>
                            <div><strong>{t('app.queueDetail.created2', 'Created:')}</strong> {new Date(selectedMessage.created_at).toLocaleString()}</div>
                            {selectedMessage.error_message && (
                                <div className="queue-message-error"><strong>{t('app.queueDetail.error', 'Error:')}</strong> {selectedMessage.error_message}</div>
                            )}
                            <div className="queue-message-section"><strong>{t('app.queueDetail.payload2', 'Payload:')}</strong>
                                <pre>{JSON.stringify(selectedMessage.payload, null, 2)}</pre>
                            </div>
                            {selectedMessage.result && (
                                <div className="queue-message-section"><strong>{t('app.queueDetail.result', 'Result:')}</strong>
                                    <pre>{JSON.stringify(selectedMessage.result, null, 2)}</pre>
                                </div>
                            )}
                        </div>
                        {!viewOnly && (selectedMessage.status === 'failed' || selectedMessage.status === 'dead_letter') && (
                            <div className="queue-detail-panel-footer">
                                <Button onClick={() => handleRequeue(selectedMessage)}>
                                    <RefreshCw size={14} className="queue-action-icon" /> {t('app.queueDetail.requeue', 'Requeue')}
                                </Button>
                            </div>
                        )}
                    </aside>
                )}
            </div>

            <Modal open={showSend && !viewOnly} onClose={() => setShowSend(false)} title={t('app.queueDetail.sendMessage', 'Send message')}>
                        <form onSubmit={handleSend}>
                                <div className="form-group">
                                    <Label htmlFor="payload">{t('app.queueDetail.payloadJson', 'Payload (JSON)')}</Label>
                                    <Textarea id="payload" value={sendForm.payload} onChange={(e) => setSendForm({ ...sendForm, payload: e.target.value })} rows={6} required />
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <Label htmlFor="priority">{t('app.queueDetail.priority', 'Priority')}</Label>
                                        <Input id="priority" type="number" value={sendForm.priority} onChange={(e) => setSendForm({ ...sendForm, priority: e.target.value })} />
                                    </div>
                                    <div className="form-group">
                                        <Label htmlFor="delay_ms">{t('app.queueDetail.delayMs', 'Delay (ms)')}</Label>
                                        <Input id="delay_ms" type="number" value={sendForm.delay_ms} onChange={(e) => setSendForm({ ...sendForm, delay_ms: e.target.value })} />
                                    </div>
                                </div>
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowSend(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                                <Button type="submit"><Send size={14} className="queue-action-icon" /> {t('app.queueDetail.send', 'Send')}</Button>
                            </div>
                        </form>
            </Modal>

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

export default QueueDetail;
