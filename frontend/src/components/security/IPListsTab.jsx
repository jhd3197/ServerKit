import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '@/hooks/useConfirm';
import Modal from '../Modal';
import ErrorState from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, DataTableFooter } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer, applyFilters,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n/t';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';
import { errorReason } from '@/utils/errorMessage';

// Both lists have the same columns; only the accent tone and the remove
// target differ, so one factory builds both. Two accessors per column on
// purpose: `value` is what the column menu, the filter rules and the export
// read (ds/grid/fields.js), `sortValue` is what DataTable orders by.
const ipListColumns = (listType, tone, onRemove) => [
    {
        key: 'ip',
        headerKey: 'app.iPListsTab.ipCidr', header: 'IP / CIDR',
        sortable: true,
        hideable: false,
        type: 'text',
        value: (item) => item.ip || '',
        sortValue: (item) => item.ip || '',
        cellClassName: `sk-cell-mono sec-ip--${tone}`,
        render: (item) => item.ip,
    },
    {
        key: 'comment',
        headerKey: 'app.iPListsTab.comment', header: 'Comment',
        sortable: true,
        type: 'text',
        // Filters read the em dash the empty cell actually shows. That is what
        // makes "needs a comment" expressible at all: a rule with an empty
        // value is never armed (fields.js `ruleIsArmed`), so the obvious
        // `comment is ""` would quietly match every row instead of none.
        value: (item) => item.comment || '—',
        // Ordering stays on the raw comment so undocumented entries sink to the
        // bottom instead of clustering wherever an em dash happens to collate.
        sortValue: (item) => item.comment || '',
        render: (item) => item.comment || <span className="sec-dash">—</span>,
    },
    {
        key: 'added',
        headerKey: 'app.iPListsTab.added', header: 'Added',
        sortable: true,
        // Declared, not inferred: the sorter wants epoch ms, and letting that
        // number type the column would offer "is under 1754…" instead of a date
        // picker — and make any date rule match nothing.
        type: 'date',
        value: (item) => item.added_at || null,
        sortValue: (item) => {
            const t = new Date(item.added_at).getTime();
            return Number.isNaN(t) ? null : t;
        },
        cellClassName: 'sk-cell-dim sec-faint',
        render: (item) => new Date(item.added_at).toLocaleDateString(),
    },
    {
        key: 'actions',
        header: '',
        sortable: false,
        hideable: false,
        cellClassName: 'sec-rowend',
        render: (item) => (
            <Button variant="destructive" size="sm" onClick={() => onRemove(item, listType)}>
                {t('common.actions.remove', 'Remove')}
            </Button>
        ),
    },
];

// Built-in views. The two lists ask the same questions of the same columns, so
// they share these definitions — but each list keeps its OWN saved-view bucket
// (`viewPageKey`) and its own URL namespace (`urlScope`), so a view saved on
// the allowlist never turns up on the blocklist.
const NO_RULES = { match: 'all', rules: [] };

const IP_LIST_VIEWS = [
    {
        // The hygiene worklist. An entry nobody explained is also one nobody
        // dares remove; newest first, because those are the ones whose reason
        // someone can still remember.
        name: 'Needs a comment',
        state: {
            sorts: [{ key: 'added', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ipc1', field: 'comment', op: 'is', value: '—' }],
            },
        },
    },
    {
        // Sort only — what changed lately. The empty rule set is spelled out so
        // switching here CLEARS whatever the previous view was filtering.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'added', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: NO_RULES,
        },
    },
    {
        // Ranges, not hosts: one /24 is 256 addresses, so a CIDR entry carries
        // 256x the consequence of the line above it in either list.
        name: 'Ranges (CIDR)',
        state: {
            sorts: [{ key: 'ip', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'ipr1', field: 'ip', op: 'contains', value: '/' }],
            },
        },
    },
];

const IPListsTab = () => {
    const { t } = useTranslation();
    const [lists, setLists] = useState({ allowlist: [], blocklist: [] });
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [showAddModal, setShowAddModal] = useState(null);
    const [newIP, setNewIP] = useState('');
    const [newComment, setNewComment] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();
    const { confirm } = useConfirm();
    // Each list is its own table with its own persisted sort/columns state.
    const allowSorts = useTableSort({ storageKey: 'serverkit-table-ip-allowlist-sort' });
    const allowCols = useColumnVisibility({ storageKey: 'serverkit-table-ip-allowlist-cols' });
    const blockSorts = useTableSort({ storageKey: 'serverkit-table-ip-blocklist-sort' });
    const blockCols = useColumnVisibility({ storageKey: 'serverkit-table-ip-blocklist-cols' });

    useEffect(() => {
        loadLists();
    }, []);

    const loadLists = async () => {
        setLoading(true);
        try {
            const data = await api.getIPLists();
            setLists({
                allowlist: data.allowlist || [],
                blocklist: data.blocklist || []
            });
            setLoaded(true);
            setLoadError(null);
        } catch (error) {
            console.error('Failed to load IP lists:', error);
            setLoadError(error);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!newIP.trim()) return;
        setActionLoading(true);
        try {
            await api.addToIPList(newIP, showAddModal, newComment);
            toast.success(t('app.iPListsTab.ipAddedTo', 'IP added to {{showAddModal}}', { showAddModal: showAddModal }));
            setShowAddModal(null);
            setNewIP('');
            setNewComment('');
            await loadLists();
        } catch (error) {
            toast.error(t('app.iPListsTab.failedToAddIp', "Couldn't add the IP. {{message}}", { message: errorReason(error) }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemove = async (item, listType) => {
        const confirmed = await confirm({
            title: t('app.iPListsTab.removeFrom', 'Remove from {{listType}}', { listType: listType }),
            message: t('app.iPListsTab.areYouSureYouWantTo', 'Remove {{ip}} from the {{listType}}? The list stops applying to it.', { ip: item.ip, listType: listType }),
            confirmText: t('common.actions.remove', 'Remove'),
            variant: 'warning',
        });
        if (!confirmed) return;
        try {
            await api.removeFromIPList(item.ip, listType);
            toast.success(t('app.iPListsTab.ipRemovedFrom', 'IP removed from {{listType}}', { listType: listType }), {
                duration: 8000,
                action: {
                    label: t('app.iPListsTab.undo', 'Undo'),
                    onClick: async () => {
                        try {
                            await api.addToIPList(item.ip, listType, item.comment || '');
                            toast.success(t('app.iPListsTab.ipRestoredTo', 'IP restored to {{listType}}', { listType: listType }));
                            await loadLists();
                        } catch (error) {
                            toast.error(t('app.iPListsTab.couldNotRestoreIp', "Couldn't restore the IP. {{message}}", { message: errorReason(error) }));
                        }
                    },
                },
            });
            await loadLists();
        } catch (error) {
            toast.error(t('app.iPListsTab.failedToRemoveIp', "Couldn't remove the IP. {{message}}", { message: errorReason(error) }));
        }
    };

    // Two tables on one route, so two chrome instances — called here at the top
    // level in a fixed order, because renderList below is a plain function and
    // a hook cannot live inside it. Each gets its own view bucket AND its own
    // `urlScope`: the link params (`view`, `sort`, `hide`, `f`…) are global
    // names, so unscoped the allowlist's sort would arrive as the blocklist's.
    const allowChrome = useTableChrome({
        columns: ipListColumns('allowlist', 'green', handleRemove),
        rows: lists.allowlist,
        viewPageKey: 'security-ip-allowlist',
        urlScope: 'allowlist',
        builtinViews: IP_LIST_VIEWS,
        noun: 'entries',
        sorts: allowSorts.sorts,
        setSorts: allowSorts.setSorts,
        hiddenKeys: allowCols.hiddenKeys,
        setHiddenKeys: allowCols.setHiddenKeys,
    });
    const blockChrome = useTableChrome({
        columns: ipListColumns('blocklist', 'red', handleRemove),
        rows: lists.blocklist,
        viewPageKey: 'security-ip-blocklist',
        urlScope: 'blocklist',
        builtinViews: IP_LIST_VIEWS,
        noun: 'entries',
        sorts: blockSorts.sorts,
        setSorts: blockSorts.setSorts,
        hiddenKeys: blockCols.hiddenKeys,
        setHiddenKeys: blockCols.setHiddenKeys,
    });

    // Cell markup/classNames identical to the hand-rolled table they replace.
    const renderList = (listType, items, sortState, chrome) => {
        // DataTable applies the column rules itself, so mirror them here for
        // the footer — a count reading "12 entries" under 3 filtered rows is
        // the table lying about what you are looking at.
        const shown = applyFilters(items, chrome.cfg.filters, chrome.columns);
        return (
        <SharedCard variant="legacy" className="card sec-flush">
            <SharedCardHeader variant="legacy" className="card-header">
                {/* The view name IS the heading — there is no room for two
                    titles in a card this narrow. `label` keeps which list this
                    is inside that name, since the pair sits side by side and
                    used to be told apart by this line alone. */}
                <GridViewPicker
                    views={chrome.views}
                    label={listType === 'allowlist'
                        ? t('app.iPListsTab.allowlistEntries', 'Allowlist entries')
                        : t('app.iPListsTab.blocklistEntries', 'Blocklist entries')}
                    onCreate={chrome.createView}
                    actions={(
                        <>
                            <GridFilterButton
                                count={chrome.filterCount}
                                onClick={() => chrome.setDrawerOpen(true)}
                            />
                            <GridToolsMenu {...chrome.toolsProps} onRefresh={loadLists} />
                        </>
                    )}
                />
                <div className="sec-tableactions">
                    <Button variant="default" size="sm" onClick={() => setShowAddModal(listType)}>
                        {t('app.iPListsTab.addTo', 'Add to')} {listType}
                    </Button>
                </div>
            </SharedCardHeader>
            <GridChips {...chrome.chipProps} />
            {items.length === 0 ? (
                <SharedCardContent variant="legacy" className="card-body">
                    <p className="text-muted">{t('app.iPListsTab.noIpsIn', 'No IPs in')} {listType}.</p>
                </SharedCardContent>
            ) : (
                <DataTable
                    columns={chrome.columns}
                    data={items}
                    keyField={(item) => item.ip}
                    sorts={sortState.sorts}
                    onSortsChange={sortState.setSorts}
                    {...chrome.tableProps}
                    footer={(
                        <DataTableFooter
                            shown={shown.length}
                            total={items.length}
                            noun="entry"
                        />
                    )}
                />
            )}
            <GridFilterDrawer {...chrome.drawerProps} />
        </SharedCard>
        );
    };

    if (loading) {
        return <div className="loading-sm">{t('app.iPListsTab.loadingIpLists', 'Loading IP lists…')}</div>;
    }

    if (loadError && !loaded) {
        return (
            <ErrorState
                title={t('app.iPListsTab.couldntLoadIpLists', "Couldn't load IP lists.")}
                error={loadError}
                onRetry={loadLists}
            />
        );
    }

    return (
        <div className="ip-lists-tab">
            {loadError && <ErrorState compact error={loadError} onRetry={loadLists} />}
            <div className="ip-lists-grid">
                {renderList('allowlist', lists.allowlist, allowSorts, allowChrome)}
                {renderList('blocklist', lists.blocklist, blockSorts, blockChrome)}
            </div>

            <Modal open={!!showAddModal} onClose={() => setShowAddModal(null)} title={t('app.iPListsTab.addTo2', 'Add to {{value}}', { value: showAddModal || '' })}>
                <div className="form-group">
                    <Label>{t('app.iPListsTab.ipAddressOrCidr', 'IP address or CIDR')}</Label>
                    <Input
                        type="text"
                        value={newIP}
                        onChange={(e) => setNewIP(e.target.value)}
                        placeholder={t('app.iPListsTab.1921681100Or10', '192.168.1.100 or 10.0.0.0/24')}
                    />
                </div>
                <div className="form-group">
                    <Label>{t('app.iPListsTab.commentOptional', 'Comment (optional)')}</Label>
                    <Input
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder={t('app.iPListsTab.officeIpVpnEtc', 'Office IP, VPN, etc.')}
                    />
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowAddModal(null)}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="default" onClick={handleAdd} disabled={actionLoading || !newIP.trim()}>
                        {actionLoading ? t('app.iPListsTab.adding', 'Adding…') : t('common.actions.add', 'Add')}
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

export default IPListsTab;
