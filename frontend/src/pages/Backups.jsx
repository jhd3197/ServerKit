import { useState, useEffect, useCallback, useMemo } from 'react';
import useTabParam from '../hooks/useTabParam';
import { Upload, Check, AlertTriangle, Archive, Clock, Database, Package, FolderArchive, HardDrive, History, Cloud, RefreshCw, Trash2, Plus, FileArchive, DollarSign } from 'lucide-react';
import api from '../services/api';
import { formatBytes } from '@/utils/formatBytes';
import { scrollBehavior } from '@/utils/reducedMotion';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import EmptyState from '../components/EmptyState';
import Modal from '@/components/Modal';
import { FormField, FormRow } from '../components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { InfoList, InfoItem } from '../components/InfoList';
import {
    Pill, SearchField, SegControl, DataTable, DataTableFooter,
} from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import BackupsOverview from '../components/backups/BackupsOverview';
import SchedulesTable from '../components/backups/SchedulesTable';
import AddScheduleModal from '../components/backups/AddScheduleModal';
import { useBackupSchedules } from '../hooks/useBackupSchedules';
import StorageDestinations from '../components/backups/StorageDestinations';
import { useManagedProfile } from '../contexts/useManagedProfile';
import ManagedCard from '../components/ManagedCard';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import useFocusParam from '../hooks/useFocusParam';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';

// `backups` is kept as an alias so old /backups/backups links still resolve to
// the archive, which now answers to `snapshots`.
const VALID_TABS = ['overview', 'schedules', 'snapshots', 'storage', 'settings'];
const TAB_ALIASES = { backups: 'snapshots' };

const PROVIDER_LABELS = { local: 'Local only', s3: 'S3-Compatible', b2: 'Backblaze B2' };

// Where a snapshot actually lives, as the one word the Storage pill prints.
// The filter rules read the same map, so a preset that says 'Local' means the
// rows whose cell says Local — never the raw `remote_status` behind it.
const REMOTE_STATUS_LABEL = { synced: 'Synced', 'remote-only': 'Remote' };
const remoteStatusLabel = (status) => REMOTE_STATUS_LABEL[status] || 'Local';

// Built-in views for the snapshot archive. Every rule matches against a
// column's `value` accessor, so 'application' below is the raw type the Type
// tag prints and 'Local' is the word the Storage pill prints.
//
// The first four replace the All/Applications/Databases/Files segment row that
// used to sit above the table. A segment that buckets rows IS a column rule,
// and as a view each bucket can also carry the sort and the columns it wants
// instead of only narrowing the list.
const NO_RULES = { match: 'all', rules: [] };

const SNAPSHOT_VIEWS = [
    {
        // The archive's natural read: what was captured most recently.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
            page: { search: '' },
        },
    },
    {
        // Site snapshots. Type is hidden — every row under this view is one,
        // so the column would be the same tag repeated down the page.
        name: 'Applications',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: ['type'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'bs1', field: 'type', op: 'any', value: ['application'] }],
            },
            page: { search: '' },
        },
    },
    {
        // Dump files, newest first — the ones a restore actually reaches for.
        name: 'Databases',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: ['type'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'bs2', field: 'type', op: 'any', value: ['database'] }],
            },
            page: { search: '' },
        },
    },
    {
        // A files snapshot is a list of paths, so it has no site to name and
        // Site/Service would be a column of em-dashes.
        name: 'Files',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: ['type', 'site'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'bs3', field: 'type', op: 'any', value: ['files'] }],
            },
            page: { search: '' },
        },
    },
    {
        // The risk list: snapshots that exist ONLY on this box, biggest first.
        // If the disk goes they go with it, and the biggest are the ones worth
        // copying off. Storage is hidden because every row here says Local.
        name: 'Local only',
        state: {
            sorts: [{ key: 'size', direction: 'desc' }],
            hiddenKeys: ['storage'],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'bs4', field: 'storage', op: 'any', value: ['Local'] }],
            },
            page: { search: '' },
        },
    },
];

const Backups = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [backups, setBackups] = useState([]);
    const [stats, setStats] = useState(null);
    const scheduleStore = useBackupSchedules();
    const { schedules, refresh: reloadSchedules } = scheduleStore;
    // Backup scheduling held by ServerKit Cloud (plan 25): the page and local
    // restore stay, the scheduling and destination surfaces become the card.
    const { isControlHeld, profile: managedProfile } = useManagedProfile();
    const backupsManaged = isControlHeld('backup-scheduling');
    const [config, setConfig] = useState(null);
    const [storageConfig, setStorageConfig] = useState(null);
    const [costSummary, setCostSummary] = useState(null);
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [rawTab, setActiveTab] = useTabParam('/backups', VALID_TABS);
    const activeTab = TAB_ALIASES[rawTab] || rawTab;
    const [search, setSearch] = useState('');
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-backups-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-backups-cols' });

    // Modal states
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [selectedBackup, setSelectedBackup] = useState(null);
    const [uploadingBackup, setUploadingBackup] = useState(null);
    const [testingConnection, setTestingConnection] = useState(false);

    useFocusParam('create', (target) => {
        if (target === 'schedule') setShowScheduleModal(true);
        if (target === 'backup') setShowBackupModal(true);
    });

    // Backup form state
    const [backupForm, setBackupForm] = useState({
        type: 'application',
        applicationId: '',
        includeDb: false,
        dbType: 'mysql',
        dbName: '',
        dbUser: '',
        dbPassword: '',
        dbHost: 'localhost',
        filePaths: '',
        fileName: ''
    });

    // Config form state
    const [configForm, setConfigForm] = useState({
        enabled: false,
        retention_days: 30
    });

    // Cost rates form state ($/GB/month). Local is the operator's own server disk.
    const [ratesForm, setRatesForm] = useState({ local: 0, s3: 0.023, b2: 0.006 });
    const [savingRates, setSavingRates] = useState(false);

    // Storage config form state
    const [storageForm, setStorageForm] = useState({
        provider: 'local',
        s3: { bucket: '', region: 'us-east-1', access_key: '', secret_key: '', endpoint_url: '', path_prefix: 'serverkit-backups' },
        b2: { bucket: '', key_id: '', application_key: '', endpoint_url: '', path_prefix: 'serverkit-backups' },
        auto_upload: false,
        keep_local_copy: true
    });

    const loadData = useCallback(async ({ refreshSchedules = true } = {}) => {
        try {
            setLoading(true);
            const [backupsRes, statsRes, configRes, appsRes, storageRes, costRes, ratesRes] = await Promise.all([
                api.getBackups(),
                api.getBackupStats(),
                api.getBackupConfig(),
                api.getApps(),
                api.getStorageConfig().catch(() => null),
                api.getBackupCostSummary().catch(() => null),
                api.getBackupCostRates().catch(() => null)
            ]);

            setBackups(backupsRes.backups || []);
            setStats(statsRes);
            setConfig(configRes);
            if (refreshSchedules) await reloadSchedules();
            // GET /apps responds { apps: [...] } — reading `.applications` here
            // silently produced [] on every load, so the app picker in the
            // backup dialogs was permanently empty.
            setApps(appsRes.apps || []);
            setCostSummary(costRes || null);

            if (storageRes) {
                setStorageConfig(storageRes);
                setStorageForm(storageRes);
            }

            if (ratesRes?.rates) {
                setRatesForm({
                    local: ratesRes.rates.local ?? 0,
                    s3: ratesRes.rates.s3 ?? 0,
                    b2: ratesRes.rates.b2 ?? 0
                });
            }

            if (configRes) {
                setConfigForm({
                    enabled: configRes.enabled || false,
                    retention_days: configRes.retention_days || 30
                });
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [reloadSchedules]);

    useEffect(() => {
        loadData({ refreshSchedules: false });
    }, [loadData]);

    const handleCreateBackup = async (e) => {
        e.preventDefault();
        try {
            if (backupForm.type === 'application') {
                const dbConfig = backupForm.includeDb ? {
                    type: backupForm.dbType,
                    name: backupForm.dbName,
                    user: backupForm.dbUser,
                    password: backupForm.dbPassword,
                    host: backupForm.dbHost
                } : null;
                await api.backupApplication(parseInt(backupForm.applicationId), backupForm.includeDb, dbConfig);
                toast.success(t('app.backups.applicationBackupCreated', 'Application backup created'));
            } else if (backupForm.type === 'database') {
                await api.backupDatabase(
                    backupForm.dbType,
                    backupForm.dbName,
                    backupForm.dbUser,
                    backupForm.dbPassword,
                    backupForm.dbHost
                );
                toast.success(t('app.backups.databaseBackupCreated', 'Database backup created'));
            } else if (backupForm.type === 'files') {
                const paths = backupForm.filePaths.split('\n').map(p => p.trim()).filter(Boolean);
                if (paths.length === 0) {
                    toast.error(t('app.backups.enterAtLeastOneFilePath', 'Enter at least one file path'));
                    return;
                }
                await api.backupFiles(paths, backupForm.fileName || null);
                toast.success(t('app.backups.fileBackupCreated', 'File backup created'));
            }
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'backup-created' },
            }));
            setShowBackupModal(false);
            resetBackupForm();
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteBackup = async (backupPath) => {
        const confirmed = await confirm({ title: t('app.backups.deleteBackup', 'Delete Backup'), message: t('app.backups.areYouSureYouWantTo', 'Are you sure you want to delete this backup?') });
        if (!confirmed) return;
        try {
            await api.deleteBackup(backupPath);
            toast.success(t('app.backups.backupDeleted', 'Backup deleted'));
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleUploadToRemote = async (backup) => {
        setUploadingBackup(backup.path);
        try {
            await api.uploadBackupToRemote(backup.path);
            toast.success(t('app.backups.backupUploadedToRemoteStorage', 'Backup uploaded to remote storage'));
            loadData();
        } catch (err) {
            toast.error(err.message);
        } finally {
            setUploadingBackup(null);
        }
    };

    const handleRestore = async () => {
        if (!selectedBackup) return;
        const restoreConfirmed = await confirm({ title: t('app.backups.restoreBackup', 'Restore Backup'), message: t('app.backups.areYouSureYouWantTo3', 'Are you sure you want to restore this backup? This may overwrite existing data.'), variant: 'warning' });
        if (!restoreConfirmed) return;

        try {
            if (selectedBackup.type === 'application') {
                await api.restoreApplication(selectedBackup.path);
            } else {
                await api.restoreDatabase(
                    selectedBackup.path,
                    selectedBackup.database_type,
                    selectedBackup.database_name
                );
            }
            setShowRestoreModal(false);
            setSelectedBackup(null);
            toast.success(t('app.backups.backupRestoredSuccessfully', 'Backup restored successfully'));
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleScheduleCreated = () => {
        toast.success(t('app.backups.scheduleAdded', 'Schedule added'));
        window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
            detail: { type: 'backup-schedule-created' },
        }));
        setShowScheduleModal(false);
    };

    const handleRemoveSchedule = async (scheduleId) => {
        const confirmed = await confirm({ title: t('app.backups.removeSchedule', 'Remove Schedule'), message: t('app.backups.areYouSureYouWantTo5', 'Are you sure you want to remove this schedule?') });
        if (!confirmed) return;
        await scheduleStore.remove(scheduleId);
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateBackupConfig(configForm);
            toast.success(t('app.backups.settingsSaved', 'Settings saved'));
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleSaveRates = async (e) => {
        e.preventDefault();
        setSavingRates(true);
        try {
            await api.updateBackupCostRates({
                local: Number(ratesForm.local) || 0,
                s3: Number(ratesForm.s3) || 0,
                b2: Number(ratesForm.b2) || 0
            });
            toast.success(t('app.backups.storageCostRatesSaved', 'Storage cost rates saved'));
            const summary = await api.getBackupCostSummary().catch(() => null);
            setCostSummary(summary || null);
        } catch (err) {
            toast.error(err.message);
        } finally {
            setSavingRates(false);
        }
    };

    const handleSaveStorageConfig = async (e) => {
        e.preventDefault();
        try {
            await api.updateStorageConfig(storageForm);
            toast.success(t('app.backups.storageConfigurationSaved', 'Storage configuration saved'));
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleTestConnection = async () => {
        setTestingConnection(true);
        try {
            const result = await api.testStorageConnection(storageForm);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.error);
            }
        } catch (err) {
            toast.error(err.message);
        } finally {
            setTestingConnection(false);
        }
    };

    const handleCleanup = async () => {
        const confirmed = await confirm({ title: t('app.backups.cleanupBackups', 'Cleanup Backups'), message: t('app.backups.thisWillDeleteBackupsOlderThan', 'This will delete backups older than {{retentiondays}} days. Continue?', { retentiondays: configForm.retention_days }), variant: 'warning' });
        if (!confirmed) return;
        try {
            const result = await api.cleanupBackups(configForm.retention_days);
            toast.success(result.message);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const resetBackupForm = () => {
        setBackupForm({
            type: 'application',
            applicationId: '',
            includeDb: false,
            dbType: 'mysql',
            dbName: '',
            dbUser: '',
            dbPassword: '',
            dbHost: 'localhost',
            filePaths: '',
            fileName: ''
        });
    };

    const formatTimestamp = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };

    const formatMoney = (n) => {
        const v = Number(n || 0);
        return v === 0 || v >= 0.01 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
    };

    const getBackupIcon = (type) => {
        switch (type) {
            case 'application': return <Package size={16} />;
            case 'database': return <Database size={16} />;
            case 'files': return <FolderArchive size={16} />;
            default: return <FileArchive size={16} />;
        }
    };

    // The pill text comes from the same map the filter rules do, so the word in
    // the cell and the word in a rule can never drift apart.
    const getRemoteStatusPill = (status) => {
        const label = remoteStatusLabel(status);
        switch (status) {
            case 'synced':
                return <Pill kind="green" dot={false}><Cloud size={11} /> {label}</Pill>;
            case 'remote-only':
                return <Pill kind="cyan" dot={false}><Cloud size={11} /> {label}</Pill>;
            default:
                return <Pill kind="gray" dot={false}><HardDrive size={11} /> {label}</Pill>;
        }
    };

    // $/month to keep one snapshot at the local rate — the same number the Cost
    // cell prints, so the column's value and its cell can never disagree.
    const monthlyCost = (backup) => (
        ((backup.size || 0) / (1024 ** 3)) * (costSummary?.cost_rates?.local || 0)
    );

    // DataTable columns for the snapshot archive. Cell markup and classNames
    // are identical to the hand-rolled table they replace, so _backups.scss
    // keeps applying (.bk-name, .bk-ico, .bk-when, .bk-actions).
    //
    // Two accessors per column on purpose: `value` is what the column menu, the
    // filter rules and the export read (ds/grid/fields.js), `sortValue` is what
    // DataTable's sorter reads — it does NOT fall back to `value`, so a
    // sortable column needs both. `type` is declared rather than inferred
    // wherever a built-in view filters the column: inference is a guess made
    // from the rows that happen to be loaded, and a preset written against the
    // wrong guess silently matches nothing.
    const snapshotColumns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (b) => b.name || b.app_name || '',
            sortValue: (b) => b.name || b.app_name || '',
            render: (backup) => (
                <div className="sk-cell-name bk-name">
                    <span className={`bk-ico bk-ico--${backup.type}`}>
                        {getBackupIcon(backup.type)}
                    </span>
                    <span title={backup.name || backup.app_name}>
                        {backup.name || backup.app_name}
                    </span>
                </div>
            ),
        },
        {
            // The three buckets the old segment row offered. They are column
            // rules now, and this column's own menu carries the pick-list.
            // No `enumOrder`: the options are built from the rows that are
            // actually loaded, so the menu never offers a bucket that would
            // come back empty — which is exactly what the old "Databases (0)"
            // segment did on a box that only backs up files.
            key: 'type',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            type: 'enum',
            groupable: true,
            value: (b) => b.type || '',
            groupValue: (b) => b.type || '',
            sortValue: (b) => b.type || '',
            render: (backup) => <span className="sk-tag">{backup.type}</span>,
        },
        {
            // Text, not a pick-list: retention keeps many snapshots per site,
            // so this column has as many distinct values as the operator has
            // sites. You type a fragment of a name rather than scroll a list.
            key: 'site',
            headerKey: 'app.backups.siteService', header: 'Site/Service',
            sortable: true,
            type: 'text',
            value: (b) => b.app_name || b.name?.split('_')[0] || '',
            sortValue: (b) => b.app_name || b.name?.split('_')[0] || null,
            render: (backup) => backup.app_name || backup.name?.split('_')[0] || '—',
        },
        {
            // Raw bytes: rules compare numbers while the cell prints the human
            // string. Filtering on the rendered "464 MB" would compare text,
            // and "over 100" would then match 99 GB.
            key: 'size',
            headerKey: 'common.labels.size', header: 'Size',
            sortable: true,
            type: 'num',
            value: (b) => b.size || 0,
            sortValue: (b) => b.size || 0,
            cellClassName: 'sk-cell-dim',
            render: (backup) => formatBytes(backup.size, { defaultValue: '0 B' }),
        },
        {
            key: 'storage',
            headerKey: 'common.labels.storage', header: 'Storage',
            sortable: true,
            type: 'enum',
            groupable: true,
            // The LABEL, not the raw `remote_status`, so the 'Local only' view
            // reads the way its rows do. Sorting the label also puts the
            // at-risk local-only copies together instead of alphabetising
            // 'remote-only' between 'local' and 'synced'.
            value: (b) => remoteStatusLabel(b.remote_status),
            groupValue: (b) => remoteStatusLabel(b.remote_status),
            sortValue: (b) => remoteStatusLabel(b.remote_status),
            render: (backup) => getRemoteStatusPill(backup.remote_status),
        },
        {
            // Declared, not inferred: the sorter wants epoch ms, and letting
            // that number type the column would offer "is under 1754…" instead
            // of a date picker — and make every date rule match nothing.
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            type: 'date',
            value: (b) => b.timestamp || null,
            sortValue: (b) => (b.timestamp ? new Date(b.timestamp).getTime() : null),
            cellClassName: 'bk-when',
            render: (backup) => formatTimestamp(backup.timestamp),
        },
        {
            key: 'cost',
            headerKey: 'app.backups.cost', header: 'Cost',
            sortable: true,
            type: 'num',
            value: monthlyCost,
            sortValue: monthlyCost,
            cellClassName: 'sk-cell-dim',
            render: (backup) => formatMoney(monthlyCost(backup)),
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            render: (backup) => (
                <div className="bk-actions">
                    {backup.type !== 'files' && (
                        <Button variant="unstyled"
                            type="button"
                            className="bk-iconbtn"
                            onClick={() => {
                                setSelectedBackup(backup);
                                setShowRestoreModal(true);
                            }}
                            title={t('app.backups.restoreThisSnapshot', 'Restore this snapshot')}
                            aria-label={t('app.backups.restore', 'Restore {{name}}', { name: backup.name })}
                        >
                            <History size={15} />
                        </Button>
                    )}
                    {storageConfig?.provider !== 'local' && backup.remote_status !== 'synced' && (
                        <Button variant="unstyled"
                            type="button"
                            className="bk-iconbtn"
                            onClick={() => handleUploadToRemote(backup)}
                            disabled={uploadingBackup === backup.path}
                            title={t('app.backups.copyToRemoteStorage', 'Copy to remote storage')}
                            aria-label={t('app.backups.uploadToRemoteStorage', 'Upload {{name}} to remote storage', { name: backup.name })}
                        >
                            {uploadingBackup === backup.path
                                ? <RefreshCw size={15} className="spinning" />
                                : <Upload size={15} />}
                        </Button>
                    )}
                    <Button variant="unstyled"
                        type="button"
                        className="bk-iconbtn bk-iconbtn--danger"
                        onClick={() => handleDeleteBackup(backup.path)}
                        title={t('app.backups.deleteThisSnapshot', 'Delete this snapshot')}
                        aria-label={t('app.backups.delete', 'Delete {{name}}', { name: backup.name })}
                    >
                        <Trash2 size={15} />
                    </Button>
                </div>
            ),
        },
    ];

    // Search only. The type split used to live here as a segment filter; it is
    // a column rule now, applied inside <DataTable> on top of this list.
    const searchedBackups = (() => {
        const q = search.trim().toLowerCase();
        if (!q) return backups;
        return backups.filter(b => (
            (b.name || '').toLowerCase().includes(q)
            || (b.app_name || '').toLowerCase().includes(q)
            || (b.type || '').toLowerCase().includes(q)
        ));
    })();

    const viewPageState = useMemo(() => ({ search }), [search]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // The snapshot archive is the only saved-view surface on this route — the
    // schedules table lives in its own component with its own sort state, and
    // the remaining tabs are forms — so there is no second chrome to fight over
    // `?view=` and no `urlScope` to hand out.
    const chrome = useTableChrome({
        columns: snapshotColumns,
        rows: searchedBackups,
        viewPageKey: 'backups-snapshots',
        builtinViews: SNAPSHOT_VIEWS,
        noun: 'snapshots',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    // One primary action per section, the way the mock does it: Schedules
    // offers "New schedule", everything else offers "Back up now". A Create
    // Backup button on the Schedules tab was answering a question nobody on
    // that tab was asking.
    useTopbarActions(() => (
        <>
            {activeTab === 'schedules' && !backupsManaged ? (
                <Button size="sm" onClick={() => setShowScheduleModal(true)}>
                    <Plus size={16} />
                    {t('app.backups.newSchedule', 'New schedule')}
                </Button>
            ) : (
                <Button size="sm" onClick={() => setShowBackupModal(true)}>
                    <Archive size={16} />
                    {t('app.backups.backUpNow', 'Back up now')}
                </Button>
            )}
            {activeTab === 'snapshots' && (
                <SearchField
                    value={search}
                    onSearch={setSearch}
                    placeholder={t('app.backups.searchSnapshots', 'Search snapshots…')}
                />
            )}
        </>
    ), [activeTab, search, backupsManaged]);

    // The chrome acts on the snapshot table, so it is only published while that
    // section is on screen — the other tabs are forms and a KPI band, with
    // nothing to filter, sort or export.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <GridFilterButton
                count={chrome.filterCount}
                onClick={() => chrome.setDrawerOpen(true)}
            />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={loadData} />
        </>, { enabled: activeTab === 'snapshots' },
    );

    if (loading) {
        return (
            <div className="sk-tabgroup__inner backups-page">
                <EmptyState loading loadingVariant="table" size="lg" title={t('app.backups.loadingBackupData', 'Loading backup data…')} />
            </div>
        );
    }

    return (
        <div className="sk-tabgroup__inner backups-page">
            {topbarChrome}
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <Button variant="unstyled" type="button" onClick={() => setError(null)} className="alert-close">&times;</Button>
                </div>
            )}

            {/* Overview answers "is my data safe?" — the KPI band, the
                activity heatmap, the destinations and the recent feed. The
                archive table it used to sit on top of is now its own section. */}
            {activeTab === 'overview' && (
                <BackupsOverview
                    stats={stats}
                    storageConfig={storageConfig}
                    costSummary={costSummary}
                    schedules={schedules}
                    backups={backups}
                    onGo={setActiveTab}
                />
            )}

            {activeTab === 'snapshots' && (
                <>
                    {/* The view name is all this line carries: search, the
                        filter button and the "⋮" ride the tab group's top bar,
                        and the row count belongs to the footer, under the rows
                        it is counting. */}
                    <GridViewPicker
                        views={chrome.views}
                        label="snapshots"
                        onCreate={chrome.createView}
                    
                actions={chromeActions}
            />

                    <GridChips {...chrome.chipProps} />

                    {backups.length === 0 ? (
                        <EmptyState
                            icon={FileArchive}
                            title={t('app.backups.noBackups', 'No Backups')}
                            description={t('app.backups.noBackupsFoundCreateYourFirst', 'No backups found. Create your first backup to get started.')}
                            action={<Button onClick={() => setShowBackupModal(true)}>{t('app.backups.createBackup', 'Create Backup')}</Button>}
                        />
                    ) : searchedBackups.length === 0 ? (
                        /* Only the SEARCH can empty the list here — a column
                           rule that matches nothing keeps the table on screen
                           with its own "clear filters" row, because the control
                           that undoes it lives in the header menu. */
                        <EmptyState
                            icon={FileArchive}
                            title={t('app.backups.noSnapshotsMatch', 'No snapshots match “{{value}}”.', { value: search.trim() })}
                        />
                    ) : (
                        <div className="bk-card">
                            <DataTable
                                {...chrome.tableProps}
                                columns={chrome.columns}
                                data={searchedBackups}
                                keyField="path"
                                sorts={sorts}
                                onSortsChange={setSorts}
                                tableClassName="bk-table"
                                footer={(
                                    <DataTableFooter
                                        shown={chrome.shownCount}
                                        total={backups.length}
                                        noun="snapshot"
                                    />
                                )}
                            />
                        </div>
                    )}

                    <GridFilterDrawer {...chrome.drawerProps} />
                </>
            )}

            {activeTab === 'schedules' && (
                backupsManaged ? (
                    <ManagedCard capability="backups_schedule" profile={managedProfile} compact />
                ) : (
                <>
                    {schedules.length === 0 ? (
                        <EmptyState
                            icon={Clock}
                            title={t('app.backups.noSchedulesYet', 'No schedules yet')}
                            description={t('app.backups.aScheduleRunsABackupOn', 'A schedule runs a backup on its own so you don\'t have to remember to. Add one and it will appear here with its next fire time.')}
                            action={<Button onClick={() => setShowScheduleModal(true)}>{t('app.backups.newSchedule', 'New schedule')}</Button>}
                        />
                    ) : (
                        <SchedulesTable
                            schedules={schedules}
                            retentionDays={config?.retention_days || 30}
                            remoteLabel={PROVIDER_LABELS[storageConfig?.provider] || 'Local disk'}
                            onToggle={scheduleStore.toggle}
                            onRemove={handleRemoveSchedule}
                        />
                    )}
                </>
                )
            )}

            {activeTab === 'storage' && (
                backupsManaged ? (
                    <ManagedCard capability="backups_schedule" profile={managedProfile} compact />
                ) : (
                <>
                    <StorageDestinations
                        stats={stats}
                        storageConfig={storageConfig}
                        costSummary={costSummary}
                        testing={testingConnection}
                        onTest={handleTestConnection}
                        onBrowse={() => setActiveTab('snapshots')}
                        onAdd={() => {
                            document.getElementById('bk-storage-form')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                        }}
                    />

                    <SharedCard variant="legacy" className="card" id="bk-storage-form">
                        <SharedCardHeader variant="legacy" className="card-header">
                            <h3>{t('app.backups.configureDestination', 'Configure destination')}</h3>
                        </SharedCardHeader>
                        <SharedCardContent variant="legacy" className="card-body">
                            {/* While ServerKit Cloud owns this
                                destination the form here is read-only, and says
                                where the setting comes from and how to take it
                                back. Backups keep running either way. */}
                            {storageConfig?.managed_by_cloud && (
                                <div className="alert alert-info" role="status">
                                    <i className="ph ph-cloud" />
                                    <span>
                                        {storageConfig.managed_note
                                            || t('app.backups.storageManagedByCloud',
                                                 'This destination is managed by ServerKit Cloud. Change it under Backups in Cloud, or unassign it there to edit it here.')}
                                    </span>
                                </div>
                            )}
                            <fieldset disabled={!!storageConfig?.managed_by_cloud} className="bk-storage-fieldset">
                            <form onSubmit={handleSaveStorageConfig}>
                                <FormField label={t('app.backups.storageProvider', 'Storage Provider')} hint={t('app.backups.s3CompatibleWorksWithAwsS3', 'S3-Compatible works with AWS S3, MinIO and Wasabi.')}>
                                    <SegControl
                                        value={storageForm.provider}
                                        onChange={(provider) => setStorageForm({...storageForm, provider})}
                                        options={[
                                            { value: 'local', labelKey: 'app.backups.localOnly', label: 'Local Only' },
                                            { value: 's3', labelKey: 'app.backups.s3Compatible', label: 'S3-Compatible' },
                                            { value: 'b2', labelKey: 'app.backups.backblazeB2', label: 'Backblaze B2' },
                                        ]}
                                    />
                                </FormField>

                                {storageForm.provider === 's3' && (
                                    <div className="storage-provider-config">
                                        <h4>{t('app.backups.s3CompatibleStorage', 'S3-Compatible Storage')}</h4>
                                        <FormRow>
                                            <FormField label={t('app.backups.bucketName', 'Bucket Name')} htmlFor="s3-bucket">
                                                <Input
                                                    id="s3-bucket"
                                                    type="text"
                                                    value={storageForm.s3.bucket}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, bucket: e.target.value}})}
                                                    placeholder="my-backup-bucket"
                                                    required
                                                />
                                            </FormField>
                                            <FormField label={t('app.backups.region', 'Region')} htmlFor="s3-region">
                                                <Input
                                                    id="s3-region"
                                                    type="text"
                                                    value={storageForm.s3.region}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, region: e.target.value}})}
                                                    placeholder="us-east-1"
                                                />
                                            </FormField>
                                        </FormRow>
                                        <FormRow>
                                            <FormField label={t('app.backups.accessKey', 'Access Key')} htmlFor="s3-access-key">
                                                <Input
                                                    id="s3-access-key"
                                                    type="text"
                                                    value={storageForm.s3.access_key}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, access_key: e.target.value}})}
                                                    placeholder={t('app.backups.akia', 'AKIA…')}
                                                    required
                                                />
                                            </FormField>
                                            <FormField label={t('app.backups.secretKey', 'Secret Key')} htmlFor="s3-secret-key">
                                                <Input
                                                    id="s3-secret-key"
                                                    type="password"
                                                    value={storageForm.s3.secret_key}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, secret_key: e.target.value}})}
                                                    required
                                                />
                                            </FormField>
                                        </FormRow>
                                        <FormRow>
                                            <FormField label={t('app.backups.customEndpointUrl', 'Custom Endpoint URL')} htmlFor="s3-endpoint" hint={t('app.backups.optionalForMinioWasabi', 'Optional, for MinIO/Wasabi')}>
                                                <Input
                                                    id="s3-endpoint"
                                                    type="text"
                                                    value={storageForm.s3.endpoint_url}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, endpoint_url: e.target.value}})}
                                                    placeholder="https://s3.example.com"
                                                />
                                            </FormField>
                                            <FormField label={t('app.backups.pathPrefix', 'Path Prefix')} htmlFor="s3-path-prefix">
                                                <Input
                                                    id="s3-path-prefix"
                                                    type="text"
                                                    value={storageForm.s3.path_prefix}
                                                    onChange={(e) => setStorageForm({...storageForm, s3: {...storageForm.s3, path_prefix: e.target.value}})}
                                                    placeholder="serverkit-backups"
                                                />
                                            </FormField>
                                        </FormRow>
                                    </div>
                                )}

                                {storageForm.provider === 'b2' && (
                                    <div className="storage-provider-config">
                                        <h4>{t('app.backups.backblazeB2', 'Backblaze B2')}</h4>
                                        <FormRow>
                                            <FormField label={t('app.backups.bucketName', 'Bucket Name')} htmlFor="b2-bucket">
                                                <Input
                                                    id="b2-bucket"
                                                    type="text"
                                                    value={storageForm.b2.bucket}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, bucket: e.target.value}})}
                                                    placeholder="my-backup-bucket"
                                                    required
                                                />
                                            </FormField>
                                            <FormField label={t('app.backups.s3CompatibleEndpointUrl', 'S3-Compatible Endpoint URL')} htmlFor="b2-endpoint">
                                                <Input
                                                    id="b2-endpoint"
                                                    type="text"
                                                    value={storageForm.b2.endpoint_url}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, endpoint_url: e.target.value}})}
                                                    placeholder="https://s3.us-west-004.backblazeb2.com"
                                                    required
                                                />
                                            </FormField>
                                        </FormRow>
                                        <FormRow>
                                            <FormField label={t('app.backups.applicationKeyId', 'Application Key ID')} htmlFor="b2-key-id">
                                                <Input
                                                    id="b2-key-id"
                                                    type="text"
                                                    value={storageForm.b2.key_id}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, key_id: e.target.value}})}
                                                    required
                                                />
                                            </FormField>
                                            <FormField label={t('app.backups.applicationKey', 'Application Key')} htmlFor="b2-app-key">
                                                <Input
                                                    id="b2-app-key"
                                                    type="password"
                                                    value={storageForm.b2.application_key}
                                                    onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, application_key: e.target.value}})}
                                                    required
                                                />
                                            </FormField>
                                        </FormRow>
                                        <FormField label={t('app.backups.pathPrefix', 'Path Prefix')} htmlFor="b2-path-prefix">
                                            <Input
                                                id="b2-path-prefix"
                                                type="text"
                                                value={storageForm.b2.path_prefix}
                                                onChange={(e) => setStorageForm({...storageForm, b2: {...storageForm.b2, path_prefix: e.target.value}})}
                                                placeholder="serverkit-backups"
                                            />
                                        </FormField>
                                    </div>
                                )}

                                {storageForm.provider !== 'local' && (
                                    <>
                                        <FormField>
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={storageForm.auto_upload}
                                                    onChange={(e) => setStorageForm({...storageForm, auto_upload: e.target.checked})}
                                                />
                                                <span>{t('app.backups.autoUploadNewBackupsToRemote', 'Auto-upload new backups to remote storage')}</span>
                                            </label>
                                        </FormField>

                                        <FormField>
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={storageForm.keep_local_copy}
                                                    onChange={(e) => setStorageForm({...storageForm, keep_local_copy: e.target.checked})}
                                                />
                                                <span>{t('app.backups.keepLocalCopyAfterUploading', 'Keep local copy after uploading')}</span>
                                            </label>
                                        </FormField>
                                    </>
                                )}

                                <div className="form-actions">
                                    <Button type="submit">{t('app.backups.saveStorageConfig', 'Save Storage Config')}</Button>
                                    {storageForm.provider !== 'local' && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleTestConnection}
                                            disabled={testingConnection}
                                        >
                                            {testingConnection ? (
                                                <><RefreshCw size={16} className="spinning" /> {t('app.backups.testing', 'Testing…')}</>
                                            ) : (
                                                <><Check size={16} /> {t('app.backups.testConnection', 'Test Connection')}</>
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </form>
                            </fieldset>
                        </SharedCardContent>
                    </SharedCard>
                </>
                )
            )}

            {activeTab === 'settings' && (
                <>
                    <SharedCard variant="legacy" className="card">
                        <SharedCardHeader variant="legacy" className="card-header">
                            <h3>{t('app.backups.backupSettings', 'Backup Settings')}</h3>
                        </SharedCardHeader>
                        <SharedCardContent variant="legacy" className="card-body">
                            <form onSubmit={handleSaveConfig}>
                                <FormField>
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={configForm.enabled}
                                            onChange={(e) => setConfigForm({...configForm, enabled: e.target.checked})}
                                        />
                                        <span>{t('app.backups.enableScheduledBackups', 'Enable Scheduled Backups')}</span>
                                    </label>
                                </FormField>

                                <FormField label={t('app.backups.retentionPeriodDays', 'Retention Period (days)')} htmlFor="retention-days" hint={t('app.backups.backupsOlderThanThisWillBe', 'Backups older than this will be deleted during cleanup')}>
                                    <Input
                                        id="retention-days"
                                        type="number"
                                        value={configForm.retention_days}
                                        onChange={(e) => setConfigForm({...configForm, retention_days: parseInt(e.target.value)})}
                                        min="1"
                                        max="365"
                                    />
                                </FormField>

                                <div className="form-actions">
                                    <Button type="submit">{t('app.backups.saveSettings', 'Save Settings')}</Button>
                                    <Button type="button" variant="outline" onClick={handleCleanup}>
                                        <Trash2 size={16} />
                                        {t('app.backups.runCleanupNow', 'Run Cleanup Now')}
                                    </Button>
                                </div>
                            </form>
                        </SharedCardContent>
                    </SharedCard>

                    <SharedCard variant="legacy" className="card">
                        <SharedCardHeader variant="legacy" className="card-header">
                            <h3>{t('app.backups.storageCostRates', 'Storage cost rates')}</h3>
                        </SharedCardHeader>
                        <SharedCardContent variant="legacy" className="card-body">
                            <p className="form-help">
                                {t('app.backups.serverkitIsFreeTheseAreYour', 'ServerKit is free — these are your own storage costs. Local is your server disk (leave at 0 if you don\'t track it). S3/B2 are your cloud provider\'s $/GB/month.')}
                            </p>
                            <form onSubmit={handleSaveRates}>
                                <FormRow>
                                    <FormField label={t('app.backups.localGbMonth', 'Local ($/GB/month)')} htmlFor="rate-local" hint={t('app.backups.yourServerDiskUsuallyFree', 'Your server disk — usually free')}>
                                        <Input
                                            id="rate-local"
                                            type="number"
                                            min={0}
                                            step="0.001"
                                            value={ratesForm.local}
                                            onChange={(e) => setRatesForm({...ratesForm, local: e.target.value})}
                                        />
                                    </FormField>
                                    <FormField label={t('app.backups.s3GbMonth', 'S3 ($/GB/month)')} htmlFor="rate-s3">
                                        <Input
                                            id="rate-s3"
                                            type="number"
                                            min={0}
                                            step="0.001"
                                            value={ratesForm.s3}
                                            onChange={(e) => setRatesForm({...ratesForm, s3: e.target.value})}
                                        />
                                    </FormField>
                                    <FormField label={t('app.backups.b2GbMonth', 'B2 ($/GB/month)')} htmlFor="rate-b2">
                                        <Input
                                            id="rate-b2"
                                            type="number"
                                            min={0}
                                            step="0.001"
                                            value={ratesForm.b2}
                                            onChange={(e) => setRatesForm({...ratesForm, b2: e.target.value})}
                                        />
                                    </FormField>
                                </FormRow>
                                <div className="form-actions">
                                    <Button type="submit" disabled={savingRates}>
                                        {savingRates ? (
                                            <><RefreshCw size={16} className="spinning" /> {t('common.editing.saving', 'Saving…')}</>
                                        ) : (
                                            <><DollarSign size={16} /> {t('app.backups.saveRates', 'Save rates')}</>
                                        )}
                                    </Button>
                                </div>
                            </form>
                        </SharedCardContent>
                    </SharedCard>
                </>
            )}

            {/* Create Backup Modal */}
            <Modal open={showBackupModal} onClose={() => setShowBackupModal(false)} title={t('app.backups.createBackup', 'Create Backup')}>
                        <form onSubmit={handleCreateBackup} data-walkthrough="backup-create-form">
                                <div className="form-group">
                                    <label htmlFor="backup-type">{t('app.backups.backupType', 'Backup Type')}</label>
                                    <Select
                                        value={backupForm.type}
                                        onValueChange={(type) => setBackupForm({...backupForm, type})}
                                    >
                                        <SelectTrigger id="backup-type"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="application">{t('app.backups.application', 'Application')}</SelectItem>
                                            <SelectItem value="database">{t('app.backups.databaseOnly', 'Database Only')}</SelectItem>
                                            <SelectItem value="files">{t('app.backups.filesDirectories', 'Files / Directories')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {backupForm.type === 'application' && (
                                    <>
                                        <div className="form-group">
                                            <label htmlFor="backup-application">{t('app.backups.application', 'Application')}</label>
                                            <Select
                                                value={backupForm.applicationId}
                                                onValueChange={(applicationId) => setBackupForm({...backupForm, applicationId})}
                                                required
                                            >
                                                <SelectTrigger id="backup-application">
                                                    <SelectValue placeholder={t('app.backups.selectApplication', 'Select Application')} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {apps.map(app => (
                                                        <SelectItem key={app.id} value={String(app.id)}>{app.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="form-group">
                                            <label className="checkbox-label">
                                                <input
                                                    type="checkbox"
                                                    checked={backupForm.includeDb}
                                                    onChange={(e) => setBackupForm({...backupForm, includeDb: e.target.checked})}
                                                />
                                                <span>{t('app.backups.includeDatabase', 'Include Database')}</span>
                                            </label>
                                        </div>
                                    </>
                                )}

                                {backupForm.type === 'files' && (
                                    <>
                                        <div className="form-group">
                                            <label>{t('app.backups.backupNameOptional', 'Backup Name (optional)')}</label>
                                            <Input
                                                type="text"
                                                value={backupForm.fileName}
                                                onChange={(e) => setBackupForm({...backupForm, fileName: e.target.value})}
                                                placeholder="my-config-backup"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>{t('app.backups.fileDirectoryPathsOnePerLine', 'File/Directory Paths (one per line)')}</label>
                                            <Textarea
                                                value={backupForm.filePaths}
                                                onChange={(e) => setBackupForm({...backupForm, filePaths: e.target.value})}
                                                placeholder={"/etc/nginx/nginx.conf\n/var/www/mysite/config\n/home/user/.env"}
                                                rows={5}
                                                required
                                            />
                                            <span className="form-help">{t('app.backups.enterAbsolutePathsToFilesOr', 'Enter absolute paths to files or directories to backup')}</span>
                                        </div>
                                    </>
                                )}

                                {(backupForm.type === 'database' || backupForm.includeDb) && (
                                    <>
                                        <div className="form-group">
                                            <label htmlFor="backup-db-type">{t('app.backups.databaseType', 'Database Type')}</label>
                                            <Select
                                                value={backupForm.dbType}
                                                onValueChange={(dbType) => setBackupForm({...backupForm, dbType})}
                                            >
                                                <SelectTrigger id="backup-db-type"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="mysql">{t('app.backups.mysql', 'MySQL')}</SelectItem>
                                                    <SelectItem value="postgresql">{t('app.backups.postgresql', 'PostgreSQL')}</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="form-group">
                                            <label>{t('app.backups.databaseName', 'Database Name')}</label>
                                            <Input
                                                type="text"
                                                value={backupForm.dbName}
                                                onChange={(e) => setBackupForm({...backupForm, dbName: e.target.value})}
                                                required
                                            />
                                        </div>

                                        <div className="form-row">
                                            <div className="form-group">
                                                <label>{t('common.labels.username', 'Username')}</label>
                                                <Input
                                                    type="text"
                                                    value={backupForm.dbUser}
                                                    onChange={(e) => setBackupForm({...backupForm, dbUser: e.target.value})}
                                                />
                                            </div>

                                            <div className="form-group">
                                                <label>{t('common.labels.password', 'Password')}</label>
                                                <Input
                                                    type="password"
                                                    value={backupForm.dbPassword}
                                                    onChange={(e) => setBackupForm({...backupForm, dbPassword: e.target.value})}
                                                />
                                            </div>
                                        </div>

                                        <div className="form-group">
                                            <label>{t('app.backups.host', 'Host')}</label>
                                            <Input
                                                type="text"
                                                value={backupForm.dbHost}
                                                onChange={(e) => setBackupForm({...backupForm, dbHost: e.target.value})}
                                            />
                                        </div>
                                    </>
                                )}
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowBackupModal(false)}>
                                    {t('common.actions.cancel', 'Cancel')}
                                </Button>
                                <Button type="submit" data-walkthrough="backup-create-submit">{t('app.backups.createBackup', 'Create Backup')}</Button>
                            </div>
                        </form>
            </Modal>

            <AddScheduleModal
                open={showScheduleModal}
                onClose={() => setShowScheduleModal(false)}
                onCreate={scheduleStore.create}
                onCreated={handleScheduleCreated}
                remoteEnabled={Boolean(storageConfig?.provider && storageConfig.provider !== 'local')}
                timezone={scheduleStore.timezone || schedules[0]?.timezone}
            />

            {/* Restore Modal */}
            <Modal open={showRestoreModal && !!selectedBackup} onClose={() => setShowRestoreModal(false)} title={t('app.backups.restoreBackup', 'Restore Backup')}>
                        {selectedBackup && (<>
                            <div className="bk-restore-warn">
                                <AlertTriangle size={18} />
                                <span><b>{t('app.backups.warning', 'Warning:')}</b> {t('app.backups.restoringThisBackupWillOverwriteExisting', 'restoring this backup will overwrite existing data. This action cannot be undone.')}</span>
                            </div>
                            <InfoList>
                                <InfoItem label={t('app.backups.backupName', 'Backup Name')} value={selectedBackup.name || selectedBackup.app_name} />
                                <InfoItem label={t('common.labels.type', 'Type')} value={selectedBackup.type} />
                                <InfoItem label={t('common.labels.created', 'Created')} value={formatTimestamp(selectedBackup.timestamp)} />
                                <InfoItem label={t('common.labels.size', 'Size')} value={formatBytes(selectedBackup.size, { defaultValue: '0 B' })} />
                            </InfoList>
                        </>)}
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowRestoreModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button variant="destructive" onClick={handleRestore}>
                                {t('app.backups.restoreBackup', 'Restore Backup')}
                            </Button>
                        </div>
            </Modal>
        </div>
    );
};

export default Backups;
