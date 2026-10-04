import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import api from '@/services/api';
import { useToast } from '@/contexts/useToast.js';
import { useAuth } from '@/contexts/useAuth.js';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { Pill, DataTable, DataTableFooter } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from 'react-i18next';

// Built-in saved views. Neither one names a `kind`: the registry decides what
// lands here, so a preset that spelled out 'domain' would be a list this file
// otherwise never hard-codes, and it would go stale the day a new model becomes
// restorable. Narrowing to one type is the Type column's own menu — it offers
// exactly the values present, with live counts, and combines with everything
// else. These two answer the questions no column menu can.
const RECYCLEBIN_VIEWS = [
    {
        // Oldest deletion first — the rows closest to being reaped by the
        // retention window, which is the only deadline this page has. The
        // default order (newest first) puts them at the very bottom.
        name: 'Closest to purge',
        state: {
            sorts: [{ key: 'deleted_at', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: { match: 'all', rules: [] },
        },
    },
    {
        // No rules: everything, bucketed by what it is. The group headers carry
        // the per-type counts, so this answers "what kind of thing have we been
        // deleting" without a fixed row of chips to keep in sync.
        name: 'By type',
        state: {
            sorts: [{ key: 'deleted_at', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: 'kind',
            columnFilters: { match: 'all', rules: [] },
        },
    },
];

// Everything the panel has soft-deleted, in one place. Type-agnostic on
// purpose: `kind` comes from the server's registry, so a newly restorable model
// shows up here with no change to this file.
export default function RecycleBinTab() {
    const { t } = useTranslation();
    const toast = useToast();
    const { isAdmin } = useAuth();
    const [items, setItems] = useState([]);
    const [retentionDays, setRetentionDays] = useState(30);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loaded, setLoaded] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [purgeTarget, setPurgeTarget] = useState(null);

    // Lifted out of <DataTable> so a saved view can capture them. The storage
    // keys are the ones DataTable derived from storageKey="serverkit-table-
    // recyclebin", so a persisted sort or hidden column survives.
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'deleted_at', direction: 'desc' }],
        storageKey: 'serverkit-table-recyclebin-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-recyclebin-cols',
    });
    // Not persisted on its own: a grouping worth keeping is a saved view.
    const [groupBy, setGroupBy] = useState(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getRecycleBin();
            setItems(data.items || []);
            setRetentionDays(data.retention_days ?? 30);
            setLoaded(true);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const rowKey = (row) => `${row.kind}:${row.id}`;

    const restore = async (row) => {
        setBusyId(rowKey(row));
        try {
            const res = await api.restoreRecord(row.kind, row.id);
            // Three outcomes, not two: the side effect FAILED (warning), it
            // succeeded but left something the user should know (notice — a
            // domain that came back without its certificate), or it just worked.
            if (res?.warning) toast.error(res.warning);
            else if (res?.item?.notice) toast.warning(res.item.notice);
            else toast.success(t('app.recycleBinTab.restored', 'Restored {{noun}} "{{label}}"', { noun: row.noun, label: row.label }));
            await load();
        } catch (err) {
            toast.error(err.message || t('app.recycleBinTab.restoreFailed', 'Restore failed'));
        } finally {
            setBusyId(null);
        }
    };

    const purge = async (row) => {
        setBusyId(rowKey(row));
        try {
            await api.purgeRecord(row.kind, row.id);
            toast.success(t('app.recycleBinTab.permanentlyDeleted', 'Permanently deleted "{{label}}"', { label: row.label }));
            await load();
        } catch (err) {
            toast.error(err.message || t('app.recycleBinTab.deleteFailed', 'Delete failed'));
        } finally {
            setBusyId(null);
            setPurgeTarget(null);
        }
    };

    const columns = useMemo(() => [
        {
            key: 'label',
            headerKey: 'app.recycleBinTab.record', header: 'Record',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (r) => r.label,
            render: (r) => (
                <div className="sk-cell-name">
                    <span>
                        {r.label}
                        {r.description && <div className="sk-cell-sub">{r.description}</div>}
                    </span>
                </div>
            ),
        },
        {
            key: 'kind',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            type: 'enum',
            groupable: true,
            // `groupValue` spelled out because grouping otherwise falls back to
            // row[key] — the raw registry slug ('saved_view'), where every
            // other surface here reads the noun ('saved view').
            value: (r) => r.noun,
            groupValue: (r) => r.noun,
            render: (r) => <Pill kind="gray">{r.noun}</Pill>,
        },
        {
            key: 'deleted_at',
            headerKey: 'app.recycleBinTab.deleted', header: 'Deleted',
            sortable: true,
            type: 'date',
            value: (r) => r.deleted_at,
            render: (r) => {
                if (!r.deleted_at) return <span className="dom-dash">—</span>;
                const when = new Date(r.deleted_at);
                const days = Math.floor((Date.now() - when.getTime()) / 86400000);
                const left = retentionDays - days;
                return (
                    <div>
                        <div className="sk-cell-dim">{when.toLocaleDateString()}</div>
                        <div className={`sk-cell-sub ${left <= 3 ? 'is-urgent' : ''}`}>
                            {left > 0 ? `purges in ${left}d` : 'past retention'}
                        </div>
                    </div>
                );
            },
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            className: 'text-right',
            render: (r) => (
                <div className="recyclebin__rowactions">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === rowKey(r)}
                        onClick={() => restore(r)}
                    >
                        <Undo2 size={14} /> {t('common.actions.restore', 'Restore')}
                    </Button>
                    {isAdmin && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="recyclebin__purge"
                            disabled={busyId === rowKey(r)}
                            onClick={() => setPurgeTarget(r)}
                            title={t('app.recycleBinTab.deletePermanently', 'Delete permanently')}
                            aria-label={t('app.recycleBinTab.deletePermanently2', 'Delete {{label}} permanently', { label: r.label })}
                        >
                            <Trash2 size={14} />
                        </Button>
                    )}
                </div>
            ),
        },
    ], [busyId, isAdmin, retentionDays]); // eslint-disable-line react-hooks/exhaustive-deps

    // Single table on this tab, so no `urlScope` — the shareable link keeps
    // the plain `?view=` every other single-table page produces. No `pageState`
    // either: everything this page can narrow by now lives in the envelope's
    // shared keys, so a view saved here is the same shape as anywhere else.
    const chrome = useTableChrome({
        columns,
        rows: items,
        viewPageKey: 'settings-recyclebin',
        builtinViews: RECYCLEBIN_VIEWS,
        noun: 'items',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
    });

    return (
        <div className="settings-section recyclebin">
            {loading ? (
                <EmptyState loading loadingVariant="table" title={t('app.recycleBinTab.loadingDeletedRecords', 'Loading deleted records…')} />
            ) : loadError && (!loaded || items.length === 0) ? (
                <ErrorState
                    title={t('app.recycleBinTab.couldntLoadRecycleBin', "Couldn't load the recycle bin")}
                    error={loadError}
                    onRetry={load}
                />
            ) : items.length === 0 ? (
                <EmptyState
                    icon={Trash2}
                    title={t('app.recycleBinTab.nothingDeleted', 'Nothing deleted')}
                    description={t('app.recycleBinTab.recordsYouDeleteLandHereFirst', 'Records you delete land here first, so a mistake is a click away from being undone.')}
                />
            ) : (
                <>
                    {loadError && <ErrorState compact error={loadError} onRetry={load} />}
                    <GridViewPicker
                        views={chrome.views}
                        label="items"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
                            </>
                        )}
                    />

                    <GridChips {...chrome.chipProps} />

                    <DataTable
                        columns={chrome.columns}
                        data={items}
                        keyField={rowKey}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={items.length}
                                noun="item"
                            />
                        )}
                    />
                </>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            <ConfirmDialog
                isOpen={!!purgeTarget}
                variant="danger"
                title={t('app.recycleBinTab.permanentlyDelete', 'Permanently delete "{{value}}"?', { value: purgeTarget?.label ?? '' })}
                message={t('app.recycleBinTab.thisCannotBeUndoneTheRecord', 'This cannot be undone. The record is removed from the database for good.')}
                details={purgeTarget ? `${purgeTarget.noun} · deleted ${purgeTarget.deleted_at?.slice(0, 10) || ''}` : ''}
                confirmText={t('app.recycleBinTab.deletePermanently', 'Delete permanently')}
                onConfirm={() => purgeTarget && purge(purgeTarget)}
                onCancel={() => setPurgeTarget(null)}
            />
        </div>
    );
}
