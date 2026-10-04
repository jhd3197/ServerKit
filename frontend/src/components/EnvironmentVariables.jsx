import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Copy, Download, Eye, EyeOff, History, Pencil, Plus, Trash2, Upload, Variable,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import Modal from './Modal';
import EmptyState from './EmptyState';
import { DataTable, DataTableFooter, ListToolbar, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useConfirm } from '@/hooks/useConfirm';
import { useClipboard } from '@/hooks/useClipboard';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// What a masked value renders as. Unchanged from the list this table replaces:
// every env var is stored as a secret, so every value is dots until the row's
// eye (or Show All) reveals it.
const MASK = '••••••••••••';

// What the Description and Applies-to cells show when the row carries neither.
// They have to be real values, not '': `ruleIsArmed` drops any rule whose value
// is empty, so "description is ''" would filter nothing at all — and the
// Undocumented view below is exactly that rule.
const NO_DESCRIPTION = '—';
const ALL_SERVICES = 'All services';

const BY_KEY = [{ key: 'key', direction: 'asc' }];
const NO_RULES = { match: 'all', rules: [] };

// Built-in saved views. Scope is deliberately not one of them: it only exists
// on compose apps, and the Applies-to column's own menu already offers the
// per-service pick-list with live counts wherever it applies.
const ENV_VIEWS = [
    {
        // Every variable the container will see, in the order you would read a
        // .env file. The landing view, and the one that says "nothing is
        // filtered".
        name: 'All variables',
        state: { sorts: BY_KEY, hiddenKeys: [], columnFilters: NO_RULES },
    },
    {
        // A hygiene worklist rather than a slice: a variable nobody described
        // is a variable nobody can safely delete, and it is the one most likely
        // to outlive whoever added it. Empty on a fully documented app, which
        // is exactly the answer it exists to give.
        name: 'Undocumented',
        state: {
            sorts: BY_KEY,
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'env1', field: 'description', op: 'is', value: NO_DESCRIPTION }],
            },
        },
    },
];

const EVERY_SERVICE = '__all';

const EnvironmentVariables = ({ appId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const showError = toast.error;
    const { confirm } = useConfirm();
    const { copy } = useClipboard();
    const [envVars, setEnvVars] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form state (add modal). Env vars are always stored as secrets — there is
    // no "make this one public" choice, so no is_secret toggle here.
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newTargetService, setNewTargetService] = useState('');

    // Compose service targeting (empty list => single-container app, hide selector)
    const [composeServices, setComposeServices] = useState([]);

    // UI state
    const [showValues, setShowValues] = useState({});
    const [allVisible, setAllVisible] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [editTargetService, setEditTargetService] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [importContent, setImportContent] = useState('');
    const [importOverwrite, setImportOverwrite] = useState(true);
    const [history, setHistory] = useState([]);
    const [search, setSearch] = useState('');

    const { sorts, setSorts } = useTableSort({
        defaultSorts: BY_KEY,
        storageKey: 'serverkit-table-svc-env-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-svc-env-cols',
    });

    const fileInputRef = useRef(null);

    const loadComposeServices = useCallback(async () => {
        try {
            const data = await api.getComposeServices(appId);
            setComposeServices(data.services || []);
        } catch {
            // Non-compose apps or errors: keep single-container UX (no selector).
            setComposeServices([]);
        }
    }, [appId]);

    const loadEnvVars = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getEnvVars(appId);
            setEnvVars(data.env_vars || []);
        } catch (err) {
            toastError(showError, t('app.environmentVariables.failedToLoadEnvironmentVariables', "Couldn't load environment variables."), err);
            console.error('Failed to load env vars:', err);
        } finally {
            setLoading(false);
        }
    }, [appId, t, showError]);

    useEffect(() => {
        loadEnvVars();
        loadComposeServices();
    }, [loadEnvVars, loadComposeServices]);


    function openAddModal() {
        setNewKey('');
        setNewValue('');
        setNewDescription('');
        setNewTargetService('');
        setShowAddModal(true);
    }

    async function handleAdd(e) {
        e.preventDefault();
        if (!newKey.trim()) {
            toast.error(t('app.environmentVariables.keyIsRequired', 'Key is required'));
            return;
        }

        setSaving(true);
        try {
            // Always stored as a secret — env vars are treated as sensitive by
            // default, so we never ask the user to opt out of masking.
            await api.createEnvVar(appId, newKey.trim(), newValue, true, newDescription || null, newTargetService || null);
            toast.success(t('app.environmentVariables.environmentVariableAdded', 'Environment variable added'));
            setNewKey('');
            setNewValue('');
            setNewDescription('');
            setNewTargetService('');
            setShowAddModal(false);
            loadEnvVars();
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToAddEnvironmentVariable', "Couldn't add the environment variable."), err);
        } finally {
            setSaving(false);
        }
    }

    async function handleUpdate(key) {
        if (editingId === null) return;

        setSaving(true);
        try {
            const payload = { value: editValue };
            // Only thread target_service through for compose apps. Empty string
            // clears the var back to all-services; a name targets one service.
            if (composeServices.length > 0) {
                payload.target_service = editTargetService || '';
            }
            await api.updateEnvVar(appId, key, payload);
            toast.success(t('app.environmentVariables.environmentVariableUpdated', 'Environment variable updated'));
            setEditingId(null);
            setEditValue('');
            setEditTargetService('');
            loadEnvVars();
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToUpdateEnvironmentVariable', "Couldn't update the environment variable."), err);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(key) {
        if (!await confirm({
            title: t('app.environmentVariables.deleteEnvironmentVariable', 'Delete environment variable'),
            message: t('app.environmentVariables.deleteEnvironmentVariable2', 'Delete environment variable "{{key}}"?', { key: key }),
            confirmText: t('app.environmentVariables.deleteVariable', 'Delete variable'),
        })) return;

        try {
            await api.deleteEnvVar(appId, key);
            toast.success(t('app.environmentVariables.environmentVariableDeleted', 'Environment variable deleted'));
            loadEnvVars();
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToDeleteEnvironmentVariable', "Couldn't delete the environment variable."), err);
        }
    }

    function toggleShowValue(id) {
        setShowValues(prev => {
            const next = { ...prev, [id]: !prev[id] };
            const allShown = envVars.every(ev => next[ev.id]);
            setAllVisible(allShown);
            return next;
        });
    }

    function toggleShowAll() {
        if (allVisible) {
            setShowValues({});
            setAllVisible(false);
        } else {
            const all = {};
            envVars.forEach(ev => { all[ev.id] = true; });
            setShowValues(all);
            setAllVisible(true);
        }
    }

    function startEditing(envVar) {
        setEditingId(envVar.id);
        setEditValue(envVar.value);
        setEditTargetService(envVar.target_service || '');
    }

    function cancelEditing() {
        setEditingId(null);
        setEditValue('');
        setEditTargetService('');
    }

    async function handleExport(includeSecrets = true) {
        try {
            const data = await api.exportEnvFile(appId, includeSecrets);
            downloadBlob(data.content, data.filename || 'app.env');
            toast.success(t('app.environmentVariables.environmentFileExported', 'Environment file exported'));
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToExport', "Couldn't export the variables."), err);
        }
    }

    async function handleImport() {
        if (!importContent.trim()) {
            toast.error(t('app.environmentVariables.pleasePasteEnvContent', 'Please paste .env content'));
            return;
        }

        setSaving(true);
        try {
            const result = await api.importEnvFile(appId, importContent, importOverwrite);
            toast.success(t('app.environmentVariables.variablesImported', '{{count}} variables imported', { count: result.count }));
            setShowImportModal(false);
            setImportContent('');
            loadEnvVars();
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToImport', "Couldn't import the variables."), err);
        } finally {
            setSaving(false);
        }
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            setImportContent(event.target.result);
        };
        reader.readAsText(file);
    }

    async function handleShowHistory() {
        try {
            const data = await api.getEnvVarHistory(appId);
            setHistory(data.history || []);
            setShowHistoryModal(true);
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToLoadHistory', "Couldn't load the history."), err);
        }
    }

    async function handleClearAll() {
        if (!await confirm({
            title: t('app.environmentVariables.clearEnvironmentVariables', 'Clear environment variables'),
            message: t('app.environmentVariables.deleteAllEnvironmentVariablesThisCannot', 'Delete all environment variables? This cannot be undone.'),
            confirmText: t('common.actions.continue', 'Continue'),
        })) return;
        if (!await confirm({
            title: t('app.environmentVariables.confirmDeletion', 'Confirm deletion'),
            message: t('app.environmentVariables.areYouAbsolutelySure', 'Are you absolutely sure?'),
            confirmText: t('app.environmentVariables.deleteAllVariables', 'Delete all variables'),
        })) return;

        try {
            await api.clearEnvVars(appId);
            toast.success(t('app.environmentVariables.allEnvironmentVariablesCleared', 'All environment variables cleared'));
            loadEnvVars();
        } catch (err) {
            toastError(toast, t('app.environmentVariables.failedToClear', "Couldn't clear the variables."), err);
        }
    }

    // The search box narrows the rows before any column rule sees them, over
    // the two fields you actually remember: the key and what someone wrote it
    // was for.
    const filteredEnvVars = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return envVars;
        return envVars.filter((ev) => (
            ev.key.toLowerCase().includes(needle)
            || (ev.description && ev.description.toLowerCase().includes(needle))
        ));
    }, [envVars, search]);

    // Declared above the loading guard: the chrome below is a hook, so it
    // cannot sit behind an early return.
    const columns = [
        {
            key: 'key',
            headerKey: 'common.labels.key', header: 'Key',
            sortable: true,
            hideable: false,
            // An identifier you type a fragment of, never pick from a list.
            type: 'text',
            value: (ev) => ev.key || '',
            sortValue: (ev) => ev.key || '',
            cellClassName: 'sk-cell-name env-cell-key',
            render: (ev) => ev.key,
        },
        {
            key: 'value',
            headerKey: 'common.labels.value', header: 'Value',
            sortable: false,
            // Neither sortable nor filterable, and `value` answers with the
            // mask rather than the secret: those three accessors also feed the
            // "⋮" export and the column menu's pick-list, so a real accessor
            // here would make the grid the one path that hands out a value the
            // rest of the tab keeps behind an eye toggle.
            filterable: false,
            value: () => MASK,
            cellClassName: 'env-cell-value',
            render: (ev) => (editingId === ev.id ? (
                <div className="env-edit-row">
                    <Input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdate(ev.key);
                            if (e.key === 'Escape') cancelEditing();
                        }}
                    />
                    {composeServices.length > 0 && (
                        <Select
                            value={editTargetService || EVERY_SERVICE}
                            onValueChange={(v) => setEditTargetService(v === EVERY_SERVICE ? '' : v)}
                        >
                            <SelectTrigger
                                size="sm"
                                title={t('app.environmentVariables.injectThisVariableIntoASingle', 'Inject this variable into a single compose service')}
                                aria-label={t('app.environmentVariables.appliesTo', 'Applies to')}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={EVERY_SERVICE}>{t('app.environmentVariables.allServices', 'All services')}</SelectItem>
                                {composeServices.map((svc) => (
                                    <SelectItem key={svc} value={svc}>{svc}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <Button size="sm" onClick={() => handleUpdate(ev.key)}>{t('common.actions.save', 'Save')}</Button>
                    <Button variant="outline" size="sm" onClick={cancelEditing}>{t('common.actions.cancel', 'Cancel')}</Button>
                </div>
            ) : (showValues[ev.id] ? ev.value : MASK)),
        },
        // Only compose apps can target a single service, so on a single-service
        // app the column would say "All services" on every row and answer
        // nothing. But `composeServices` comes from the app's CURRENT compose
        // file, and a variable can still carry a `target_service` from before a
        // service was renamed or removed — hiding the column outright is how a
        // variable that applies to exactly one service silently looks like it
        // applies to all of them. Show it whenever either source says there is
        // a distinction to draw.
        ...(composeServices.length > 0 || envVars.some((ev) => ev.target_service) ? [{
            key: 'scope',
            headerKey: 'app.environmentVariables.appliesTo', header: 'Applies to',
            sortable: true,
            // Declared, not inferred: a compose app with two services and three
            // variables is over the enum cardinality ratio and would degrade to
            // free text, turning the per-service pick-list into a typed
            // fragment.
            type: 'enum',
            value: (ev) => ev.target_service || ALL_SERVICES,
            sortValue: (ev) => ev.target_service || ALL_SERVICES,
            render: (ev) => (ev.target_service ? (
                <span
                    className="env-target-chip"
                    title={t('app.environmentVariables.appliesOnlyToTheService', 'Applies only to the "{{targetservice}}" service', { targetservice: ev.target_service })}
                >
                    &rarr; {ev.target_service}
                </span>
            ) : <span className="env-muted">{ALL_SERVICES}</span>),
        }] : []),
        {
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            // Text, never enum: on an app where nothing is documented the
            // inference would see one repeated dash and offer a checklist.
            // `value` substitutes the dash the cell shows so the undocumented
            // rows are addressable by the view below; `sortValue` stays '' so
            // they collate as empty rather than as whatever "—" sorts under.
            type: 'text',
            value: (ev) => ev.description || NO_DESCRIPTION,
            sortValue: (ev) => ev.description || '',
            render: (ev) => ev.description || <span className="env-muted">{NO_DESCRIPTION}</span>,
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            className: 'actions-cell',
            cellClassName: 'actions-cell',
            render: (ev) => (
                <>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-icon"
                        onClick={() => toggleShowValue(ev.id)}
                        title={showValues[ev.id] ? t('app.environmentVariables.hideValue', 'Hide value') : t('app.environmentVariables.showValue', 'Show value')}
                    >
                        {showValues[ev.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-icon"
                        onClick={() => copy(ev.value)}
                        title={t('app.environmentVariables.copyValue', 'Copy value')}
                    >
                        <Copy size={16} />
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-icon"
                        onClick={() => startEditing(ev)}
                        title={t('common.actions.edit', 'Edit')}
                    >
                        <Pencil size={16} />
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-icon btn-danger"
                        onClick={() => handleDelete(ev.key)}
                        title={t('common.actions.delete', 'Delete')}
                    >
                        <Trash2 size={16} />
                    </Button>
                </>
            ),
        },
    ];

    // The page-private half of a saved view: the search box narrows the rows
    // before any column rule runs, so a view has to carry it.
    const pageState = useMemo(() => ({ search }), [search]);
    const applyPage = useCallback((saved) => {
        if (saved.search !== undefined) setSearch(saved.search);
    }, []);

    // Scoped to this tab, and namespaced: /services/:id renders one tab at a
    // time but the Events tab on the same ROUTE hosts a chrome of its own, so
    // unscoped the two would read and write the same ?view=/?sort= and each
    // would arrive as the other's.
    const chrome = useTableChrome({
        columns,
        rows: filteredEnvVars,
        viewPageKey: 'servicedetail-environment',
        urlScope: 'env',
        builtinViews: ENV_VIEWS,
        noun: 'variables',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        pageState,
        applyPage,
    });

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.environmentVariables.loadingEnvironmentVariables', 'Loading environment variables…')} />;
    }

    return (
        <div className="env-vars-container">
            <p className="hint">
                {t('app.environmentVariables.environmentVariablesAreEncryptedAtRest', 'Environment variables are encrypted at rest and masked by default. Changes require a service restart to take effect.')}
            </p>

            {envVars.length === 0 ? (
                <EmptyState
                    icon={Variable}
                    title={t('app.environmentVariables.noEnvironmentVariables', 'No environment variables')}
                    description={t('app.environmentVariables.addOneHereOrImportAn', 'Add one here, or import an existing .env file.')}
                    action={(
                        <div className="env-empty-actions">
                            <Button onClick={openAddModal}>
                                <Plus size={15} />
                                {t('app.environmentVariables.addVariable', 'Add variable')}
                            </Button>
                            <Button variant="outline" onClick={() => setShowImportModal(true)}>
                                <Upload size={14} />
                                {t('app.environmentVariables.import', 'Import')}
                            </Button>
                        </div>
                    )}
                />
            ) : (
                <>
                    {/* One row of chrome: the view name is this tab's heading and
                        the search, the filter and the "⋮" ride the same line.
                        ServiceDetail owns the page top bar, so the chrome stays
                        inline here rather than being hoisted (see
                        useTopbarChrome). No count on it — the footer reports
                        that, under the rows it is counting. */}
                    <GridViewPicker
                        views={chrome.views}
                        label="variables"
                        onCreate={chrome.createView}
                        actions={(
                            <>
                                <SearchField
                                    value={search}
                                    onSearch={setSearch}
                                    placeholder={t('app.environmentVariables.searchKeysOrDescriptions', 'Search keys or descriptions…')}
                                />
                                <GridFilterButton
                                    count={chrome.filterCount}
                                    onClick={() => chrome.setDrawerOpen(true)}
                                />
                                <GridToolsMenu {...chrome.toolsProps} onRefresh={loadEnvVars} />
                            </>
                        )}
                    />

                    {/* What acts on the .env file itself, rather than on what you
                        are looking at. Refresh is gone from it — it is in the "⋮". */}
                    <ListToolbar>
                        <Button size="sm" onClick={openAddModal}>
                            <Plus size={15} />
                            {t('app.environmentVariables.addVariable', 'Add variable')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={toggleShowAll}
                            title={allVisible ? t('app.environmentVariables.hideAllValues', 'Hide all values') : t('app.environmentVariables.showAllValues', 'Show all values')}
                        >
                            {allVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                            {allVisible ? 'Hide All' : 'Show All'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowImportModal(true)}>
                            <Upload size={14} />
                            {t('app.environmentVariables.import', 'Import')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleExport(true)}>
                            <Download size={14} />
                            {t('app.environmentVariables.export', 'Export')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleShowHistory}>
                            <History size={14} />
                            {t('app.environmentVariables.history', 'History')}
                        </Button>
                        <Button variant="outline" size="sm" className="env-clear-btn" onClick={handleClearAll}>
                            <Trash2 size={14} />
                            {t('app.environmentVariables.clearAll', 'Clear all')}
                        </Button>
                    </ListToolbar>

                    <GridChips {...chrome.chipProps} />

                    <DataTable
                        columns={chrome.columns}
                        data={filteredEnvVars}
                        keyField="id"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        tableClassName="data-table"
                        emptyTitle="No variables match your search."
                        emptyMessage=""
                        footer={(
                            <DataTableFooter
                                // DataTable applies the column rules itself, so
                                // the shown count comes from the chrome —
                                // `envVars` is only ever the whole file.
                                shown={chrome.shownCount}
                                total={envVars.length}
                                noun="variable"
                            />
                        )}
                    />
                </>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            {/* Add Variable Modal */}
            <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title={t('app.environmentVariables.addEnvironmentVariable', 'Add environment variable')}>
                <form onSubmit={handleAdd}>
                    <div className="form-group">
                        <Label>{t('common.labels.key', 'Key')}</Label>
                        <Input
                            type="text"
                            value={newKey}
                            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                            placeholder="KEY_NAME"
                            className="env-key-input"
                            autoFocus
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('common.labels.value', 'Value')}</Label>
                        <Input
                            type="text"
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            placeholder="value"
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('common.labels.description', 'Description')} <span className="env-optional">(optional)</span></Label>
                        <Input
                            type="text"
                            value={newDescription}
                            onChange={(e) => setNewDescription(e.target.value)}
                            placeholder={t('app.environmentVariables.whatIsThisVariableFor', 'What is this variable for?')}
                        />
                    </div>
                    {composeServices.length > 0 && (
                        <div className="form-group">
                            <Label htmlFor="env-add-target">{t('app.environmentVariables.appliesTo', 'Applies to')}</Label>
                            {/* Radix reserves '' for "no selection": "All services" rides a sentinel. */}
                            <Select
                                value={newTargetService || EVERY_SERVICE}
                                onValueChange={(v) => setNewTargetService(v === EVERY_SERVICE ? '' : v)}
                            >
                                <SelectTrigger id="env-add-target"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={EVERY_SERVICE}>{t('app.environmentVariables.allServices', 'All services')}</SelectItem>
                                    {composeServices.map((svc) => (
                                        <SelectItem key={svc} value={svc}>{svc}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <p className="hint env-modal-hint">
                        {t('app.environmentVariables.storedEncryptedAndMaskedByDefault', 'Stored encrypted and masked by default. Reveal it any time with the eye icon.')}
                    </p>
                    <div className="modal-footer">
                        <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" disabled={saving}>
                            {saving ? 'Adding...' : 'Add Variable'}
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* Import Modal */}
            <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title={t('app.environmentVariables.importEnvironmentVariables', 'Import environment variables')}>
                <p className="hint">{t('app.environmentVariables.pasteYourEnvFileContentBelow', 'Paste your .env file content below or upload a file.')}</p>

                <div className="import-file-upload">
                    <input
                        type="file"
                        ref={fileInputRef}
                        accept=".env,.txt"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                        {t('app.environmentVariables.chooseFile', 'Choose file')}
                    </Button>
                </div>

                <Textarea
                    value={importContent}
                    onChange={(e) => setImportContent(e.target.value)}
                    placeholder={t('app.environmentVariables.databaseUrlPostgresApiKeyYour', 'DATABASE_URL=postgres://...\nAPI_KEY=your-api-key\nDEBUG=false')}
                    rows={10}
                    className="import-textarea"
                />

                <label className="checkbox-label">
                    <Checkbox
                        checked={importOverwrite}
                        onCheckedChange={setImportOverwrite}
                    />
                    <span>{t('app.environmentVariables.overwriteExistingVariablesWithSameKeys', 'Overwrite existing variables with same keys')}</span>
                </label>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowImportModal(false)}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button onClick={handleImport} disabled={saving}>
                        {saving ? 'Importing...' : 'Import'}
                    </Button>
                </div>
            </Modal>

            {/* History Modal */}
            <Modal open={showHistoryModal} onClose={() => setShowHistoryModal(false)} title={t('app.environmentVariables.changeHistory', 'Change history')} size="lg">
                {history.length === 0 ? (
                    <p className="hint">{t('app.environmentVariables.noChangesRecordedYet', 'No changes recorded yet.')}</p>
                ) : (
                    <DataTable
                        columns={[
                            {
                                key: 'key',
                                headerKey: 'common.labels.key', header: 'Key',
                                sortable: true,
                                hideable: false,
                                sortValue: (h) => h.key || '',
                                cellClassName: 'mono',
                                render: (h) => h.key,
                            },
                            {
                                key: 'action',
                                headerKey: 'common.labels.action', header: 'Action',
                                sortable: true,
                                sortValue: (h) => h.action || '',
                                render: (h) => (
                                    <Badge variant={h.action === 'created' ? 'success' : h.action === 'deleted' ? 'destructive' : 'warning'}>
                                        {h.action}
                                    </Badge>
                                ),
                            },
                            {
                                key: 'changed_at',
                                headerKey: 'app.environmentVariables.changedAt', header: 'Changed At',
                                sortable: true,
                                sortValue: (h) => new Date(h.changed_at).getTime(),
                                render: (h) => new Date(h.changed_at).toLocaleString(),
                            },
                        ]}
                        data={history.map((h, idx) => ({ ...h, __idx: idx }))}
                        keyField="__idx"
                        storageKey="serverkit-table-env-history"
                        tableClassName="table"
                        footer={(
                            <DataTableFooter
                                shown={history.length}
                                total={history.length}
                                noun="change"
                            />
                        )}
                    />
                )}
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowHistoryModal(false)}>
                        {t('common.actions.close', 'Close')}
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

export default EnvironmentVariables;
