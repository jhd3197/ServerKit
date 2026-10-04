import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Database, Loader, CheckCircle, ArrowUpCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { errorReason } from '@/utils/errorMessage';

// Revisions in this project are short descriptive slugs (e.g. 016_resource_grants),
// so show them in full rather than truncating mid-word.
const short = (rev) => rev || '';

// Built-in saved views. Revisions are numbered slugs, so sorting the Revision
// column IS chronological order — there is no timestamp on a revision row.
const MIGRATION_VIEWS = [
    {
        // What is about to run, in the order it will run. This is the list you
        // read before pressing Apply, and on a long history it is three rows
        // buried at the bottom of eighty.
        name: 'Pending',
        state: {
            sorts: [{ key: 'revision', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'mv1', field: 'status', op: 'any', value: ['Pending'] }],
            },
        },
    },
    {
        // No rules — the whole chain, newest first. "What did the last upgrade
        // bring in" is the other question this table gets asked, and the
        // natural order (oldest first) is the wrong end for it.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'revision', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: { match: 'all', rules: [] },
        },
    },
];

const MigrationHistoryTab = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const register = useSettingFocus();

    const [revisions, setRevisions] = useState([]);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [applying, setApplying] = useState(false);
    const [backupFirst, setBackupFirst] = useState(true);

    // Lifted out of <DataTable> so a saved view can capture them. The storage
    // keys are the ones DataTable derived from storageKey="serverkit-table-
    // settings-migrations", so a persisted sort or hidden column survives.
    const { sorts, setSorts } = useTableSort({
        storageKey: 'serverkit-table-settings-migrations-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-settings-migrations-cols',
    });

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const [hist, stat] = await Promise.all([
                api.getMigrationHistory(),
                api.getMigrationStatus(),
            ]);
            setRevisions(hist.revisions || []);
            setStatus(stat);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // History is returned oldest -> newest along a linear chain. Everything after
    // the applied (current) revision is unapplied, through head. status.pending_count
    // is computed once at boot and can be stale, so trust the ordered history.
    const currentIdx = revisions.findIndex((r) => r.is_current);
    const pending = currentIdx >= 0 ? revisions.slice(currentIdx + 1) : revisions.slice();
    const pendingIds = new Set(pending.map((r) => r.revision));
    const hasPending = pending.length > 0;

    const currentRev = status?.current_revision;
    const headRev = status?.head_revision;
    const count = pending.length;

    // The DB records a revision that no longer exists in the migration scripts
    // (renamed during development). The schema is already in sync, so applying
    // re-stamps the version pointer rather than running DDL.
    const orphaned = Boolean(currentRev) && currentIdx === -1 && revisions.length > 0;

    // The label the Status cell shows. Derived, not stored: a revision is
    // "pending" because of where it sits relative to the current one, so the
    // view's rule has to read the same computation the badge does.
    const statusLabel = (rev) => (
        rev.is_current ? 'Current' : pendingIds.has(rev.revision) ? 'Pending' : 'Applied'
    );

    // Columns for the shared DataTable. Cell markup is identical to the
    // hand-rolled table it replaces, so the .data-table rules keep applying.
    const columns = [
        {
            key: 'revision',
            headerKey: 'app.migrationHistoryTab.revision', header: 'Revision',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (rev) => rev.revision || '',
            sortValue: (rev) => rev.revision || '',
            render: (rev) => <code>{short(rev.revision)}</code>,
        },
        {
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            type: 'text',
            value: (rev) => rev.description || 'Schema update',
            sortValue: (rev) => rev.description || 'Schema update',
            render: (rev) => rev.description || 'Schema update',
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Typed explicitly: `sortValue` is a rank, and letting that number
            // infer the type would make Status numeric — "Pending" would then
            // be a string rule against a numeric column, matching zero rows.
            type: 'enum',
            value: statusLabel,
            // current -> applied -> pending keeps the lifecycle order sensible.
            sortValue: (rev) => (rev.is_current ? 0 : pendingIds.has(rev.revision) ? 2 : 1),
            render: (rev) => (
                rev.is_current ? (
                    <Badge variant="success">
                        <CheckCircle size={12} /> {t('common.labels.current', 'Current')}
                    </Badge>
                ) : pendingIds.has(rev.revision) ? (
                    <Badge variant="warning">
                        <ArrowUpCircle size={12} /> {t('app.migrationHistoryTab.pending', 'Pending')}
                    </Badge>
                ) : (
                    <Badge variant="secondary">{t('app.migrationHistoryTab.applied', 'Applied')}</Badge>
                )
            ),
        },
    ];

    // Single table on this tab, so no `urlScope` — the shareable link keeps the
    // plain `?view=` every other single-table page produces. No `pageState`
    // either: the history endpoint returns the whole chain, unfiltered.
    const chrome = useTableChrome({
        columns,
        rows: revisions,
        viewPageKey: 'settings-migrations',
        builtinViews: MIGRATION_VIEWS,
        noun: 'migrations',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    async function runMigrations() {
        const ok = await confirm({
            title: orphaned ? t('app.migrationHistoryTab.reSyncDatabaseVersion', 'Re-sync database version?') : t('app.migrationHistoryTab.applyMigrations', { count, defaultValue_one: 'Apply 1 migration?', defaultValue_other: 'Apply {{count}} migrations?' }),
            message: orphaned
                ? t('app.migrationHistoryTab.yourSchemaAlreadyMatchesThisRepairs', 'Your schema already matches {{value}}; this repairs the version pointer{{value2}}.', { value: short(headRev) || 'head', value2: backupFirst ? ' after creating a backup' : ' (no backup will be created)' })
                : backupFirst
                    ? t('app.migrationHistoryTab.aDatabaseBackupIsCreatedFirst', 'A database backup is created first, then the schema is upgraded from {{value}} to {{value2}}.', { value: short(currentRev) || 'none', value2: short(headRev) || 'head' })
                    : t('app.migrationHistoryTab.theSchemaIsUpgradedFromTo', 'The schema is upgraded from {{value}} to {{value2}}. No backup will be created.', { value: short(currentRev) || 'none', value2: short(headRev) || 'head' }),
            confirmText: orphaned ? t('app.migrationHistoryTab.reSyncDatabase', 'Re-sync database') : t('app.migrationHistoryTab.applyMigrationsButton', { count, defaultValue_one: 'Apply migration', defaultValue_other: 'Apply migrations' }),
            cancelText: t('common.actions.cancel', 'Cancel'),
            variant: 'warning',
        });
        if (!ok) return;

        setApplying(true);
        try {
            if (backupFirst) {
                try {
                    const b = await api.createMigrationBackup();
                    const name = b?.path ? b.path.split(/[\\/]/).pop() : null;
                    toast.success(name ? t('app.migrationHistoryTab.databaseBackedUp', 'Database backed up ({{name}})', { name: name }) : t('app.migrationHistoryTab.databaseBackedUp2', 'Database backed up'));
                } catch (err) {
                    toast.error(t('app.migrationHistoryTab.backupFailedMigrationsNotApplied', "Couldn't back up, so no migrations ran. {{value}}", { value: errorReason(err) }));
                    return;
                }
            }
            const res = await api.applyMigrations();
            toast.success(t('app.migrationHistoryTab.migrationsAppliedNowAt', 'Migrations applied (now at {{value}})', { value: short(res?.revision || headRev) }));
            await load();
        } catch (err) {
            toast.error(t('app.migrationHistoryTab.migrationFailed', "Couldn't run the migration. {{value}}", { value: errorReason(err) }));
        } finally {
            setApplying(false);
        }
    }

    if (loading) {
        return (
            <div className="settings-section">
                <div className="loading-state">
                    <Loader size={20} className="spin" />
                    <span>{t('app.migrationHistoryTab.loadingMigrationHistory', 'Loading migration history…')}</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="settings-section">
                <ErrorState
                    title={t('app.migrationHistoryTab.couldntLoadMigrationHistory', "Couldn't load migration history.")}
                    error={error}
                    onRetry={load}
                />
            </div>
        );
    }

    return (
        <div className="settings-section">
            <div className="settings-section-header">
                <h2>{t('app.migrationHistoryTab.databaseMigrations', 'Database migrations')}</h2>
                <p className="settings-section-description">
                    {t('app.migrationHistoryTab.schemaVersionsAppliedToThisInstance', 'Schema versions applied to this instance. Apply pending updates after upgrading ServerKit.')}
                </p>
            </div>

            {hasPending ? (
                <div {...register('migrations-apply', 'migration-pending-banner')}>
                    <ArrowUpCircle size={20} className="migration-pending-icon" aria-hidden="true" />
                    <div className="migration-pending-body">
                        <p className="migration-pending-title">
                            {orphaned
                                ? t('app.migrationHistoryTab.versionNeedsRepair', 'Database version needs repair')
                                : t('app.migrationHistoryTab.migrationsPending', { count, defaultValue_one: '1 migration pending', defaultValue_other: '{{count}} migrations pending' })}
                        </p>
                        <p className="migration-pending-desc">
                            {orphaned ? (
                                <>
                                    {t('app.migrationHistoryTab.recordedVersion', 'Recorded version')} <code>{short(currentRev)}</code> {t('app.migrationHistoryTab.isnTInTheMigrationHistory', "isn't in the migration history (it was renamed). Your schema already matches")}{' '}
                                    <code>{short(headRev) || 'head'}</code> {t('app.migrationHistoryTab.reSyncToRepairTheVersion', '(re-sync to repair the version pointer).')}
                                </>
                            ) : (
                                <>
                                    {t('app.migrationHistoryTab.yourDatabaseIsAt', 'Your database is at')} <code>{short(currentRev) || 'none'}</code>{t('app.migrationHistoryTab.latestIs', ', latest is')}{' '}
                                    <code>{short(headRev) || 'unknown'}</code>. Apply to bring the schema up to date.
                                </>
                            )}
                        </p>
                        <div className="migration-pending-actions">
                            <SharedButton variant="primary"
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={runMigrations}
                                disabled={applying}
                            >
                                {applying ? (
                                    <><Loader size={14} className="spin" /> {orphaned ? 'Repairing…' : 'Applying…'}</>
                                ) : orphaned ? (
                                    <><Database size={14} /> {t('app.migrationHistoryTab.reSyncDatabase', 'Re-sync database')}</>
                                ) : (
                                    <><Database size={14} /> {t('app.migrationHistoryTab.applyCount', { count, defaultValue_one: 'Apply 1 migration', defaultValue_other: 'Apply {{count}} migrations' })}</>
                                )}
                            </SharedButton>
                            <label className="migration-backup-toggle">
                                <input
                                    type="checkbox"
                                    checked={backupFirst}
                                    onChange={(e) => setBackupFirst(e.target.checked)}
                                    disabled={applying}
                                />
                                {t('app.migrationHistoryTab.backUpDatabaseFirst', 'Back up database first')}
                            </label>
                        </div>
                    </div>
                </div>
            ) : (
                revisions.length > 0 && (
                    <div className="migration-uptodate">
                        <ShieldCheck size={16} aria-hidden="true" />
                        {t('app.migrationHistoryTab.schemaIsUpToDate', 'Schema is up to date')}{currentRev && <> {t('app.migrationHistoryTab.revision2', 'at revision')} <code>{short(currentRev)}</code></>}.
                    </div>
                )
            )}

            {revisions.length === 0 ? (
                <EmptyState icon={Database} title={t('app.migrationHistoryTab.noMigrationHistoryFound', 'No migration history found.')} />
            ) : (
                <>
                    {/* The section's h2 above stays put — it heads the apply
                        banner as well as the table, so the picker sits with
                        the table it actually belongs to. */}
                    <GridViewPicker
                        views={chrome.views}
                        label="migrations"
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

                    <div {...register('migrations-history', 'table-container')}>
                        <DataTable
                            columns={chrome.columns}
                            data={revisions}
                            keyField="revision"
                            sorts={sorts}
                            onSortsChange={setSorts}
                            {...chrome.tableProps}
                            tableClassName="data-table"
                        />
                    </div>
                </>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

export default MigrationHistoryTab;
