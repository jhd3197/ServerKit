import { useState, useEffect, useCallback } from 'react';
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import { PackageCheck, Package, UploadCloud } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import Modal from '@/components/Modal';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { Button } from '@/components/ui/button';
import {
    SearchField, FilterDrawer, FilterButton, countActiveFilters, CatalogGrid, SegControl,
} from '@/components/ds';
import { statusVariant } from '@/components/ds/status';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { useExtensionUpdates, refreshExtensionUpdates } from '@/hooks/useExtensionUpdates';
import ManualInstallModal from '../components/marketplace/ManualInstallModal';
import ExtensionPermissionsDialog from '../components/marketplace/ExtensionPermissionsDialog';
import CatalogExtensionCard from '../components/marketplace/CatalogExtensionCard';
import ExtensionDetailModal from '../components/marketplace/ExtensionDetailModal';
import { PluginConfigDialog, PluginUninstallDialog } from '../components/marketplace/PluginDialogs';
import InstalledCard from '../components/marketplace/InstalledCard';
import UpdatesBanner from '../components/marketplace/UpdatesBanner';
import UpdatesView from '../components/marketplace/UpdatesView';
import CategoryChips from '../components/marketplace/CategoryChips';
import { useUpdateAll } from '../components/marketplace/useUpdateAll';
import { indexUpdates } from '../components/marketplace/extensionUpdates';
import {
    deriveCatalogCategories, getRegistryCatalogEntry, getLocalCatalogEntry, catalogEntryMatches,
} from '../components/marketplace/extensionCatalog';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const Marketplace = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const [plugins, setPlugins] = useState([]);
    const [builtins, setBuiltins] = useState([]);
    const [loadErrors, setLoadErrors] = useState({ installed: null, catalog: null });
    const [registryExtensions, setRegistryExtensions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    // Advanced filters live in a shared FilterDrawer. `ownership` is single-select
    // ('' all, 'serverkit' firstParty, 'community'); `category` is multi-select.
    const [filters, setFilters] = useState({ ownership: '', category: [] });
    const [category, setCategory] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [installedSearch, setInstalledSearch] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    // The active view is driven by the route (/marketplace = browse,
    // /marketplace/installed = installed). The legacy ?tab=installed deep link
    // still resolves to the installed view.
    const updatesView = location.pathname.endsWith('/updates');
    const installedView = !updatesView && (location.pathname.endsWith('/installed')
        || searchParams.get('tab') === 'installed');
    const store = useExtensionUpdates();
    // Manual install modal (URL / folder / zip); null when closed, otherwise
    // the source sub-tab to preselect.
    const [manualInstallSource, setManualInstallSource] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [detailEntry, setDetailEntry] = useState(null);
    // Registry entry awaiting risk confirmation — drives the acknowledge-risk
    // dialog (confirm retries with acknowledge_risk: true). Shape:
    // { slug, reason } where reason is 'unreviewed' (proactive gate or 409),
    // 'unverified' (409: entry has no pinned checksum), or 'untrusted_key'
    // (signed by a publisher key this panel doesn't pin).
    const [riskTarget, setRiskTarget] = useState(null);
    // Plugin pending uninstall — drives the keep-vs-purge data-policy dialog.
    const [uninstallTarget, setUninstallTarget] = useState(null);
    // Id of the installed plugin whose row action (uninstall/toggle/update) is
    // in flight. Drives per-row button disabling + live status copy so an
    // operation can't be double-fired and the operator always sees progress.
    const [busyPlugin, setBusyPlugin] = useState(null); // { id, action }
    // Plugin whose config is being edited (#49) — drives the config dialog.
    const [configTarget, setConfigTarget] = useState(null);
    // Plugin whose declared-vs-observed permissions and pending Python
    // dependencies are being read (tasks 6+7) — drives the read-only
    // permissions dialog.
    const [permissionsTarget, setPermissionsTarget] = useState(null);

    const loadExtensions = useCallback(async () => {
        // Each source settles on its own so one failing endpoint doesn't hide
        // the others. A failed source keeps its last good list and is recorded
        // per view, so it renders as an error rather than as "nothing here".
        const settle = (promise) => promise.then(
            (data) => ({ data, error: null }),
            (error) => ({ data: null, error }),
        );
        try {
            const [pRes, bRes, rRes] = await Promise.all([
                settle(api.getInstalledPlugins()),
                settle(api.getBuiltinExtensions()),
                settle(api.getRegistryExtensions()),
            ]);
            if (pRes.data) setPlugins(pRes.data.plugins || []);
            if (bRes.data) setBuiltins(bRes.data.builtin || []);
            if (rRes.data) setRegistryExtensions(rRes.data.extensions || []);
            setLoadErrors({
                installed: pRes.error,
                catalog: bRes.error || rRes.error,
            });
        } finally {
            setLoading(false);
        }
        // Install / update / uninstall all land here: invalidate the shared update store.
        refreshExtensionUpdates();
    }, []);

    useEffect(() => { loadExtensions(); }, [loadExtensions]);

    // Deep link: /extensions?install=<slug> opens that extension's detail
    // modal. This is what a serverkit.ai install link lands on (and the
    // counterpart to Templates.jsx's ?install=<id>).
    //
    // It opens the modal rather than installing: a URL arriving from another
    // site must never be able to install anything on its own, so the operator
    // still presses Install and every trust gate behind it still fires.
    //
    // Note /marketplace?install=… cannot work — that path only redirects here
    // via <Navigate>, which drops the query string. Links must target
    // /extensions directly.
    const installSlug = searchParams.get('install');
    useEffect(() => {
        if (!installSlug || loading) return;

        // Lookup only, so the catalog's featured/sort ordering is irrelevant.
        const entry = [
            ...builtins.map(getLocalCatalogEntry),
            ...registryExtensions.map(getRegistryCatalogEntry),
        ].find((candidate) => candidate.installKey === installSlug);

        if (entry) {
            setDetailEntry(entry);
        } else {
            toast.error(t('app.marketplace.noExtensionNamedInThisPanel', 'No extension named "{{installSlug}}" in this panel\'s catalog.', { installSlug: installSlug }));
        }

        // Drop the param either way so a refresh doesn't reopen it.
        const next = new URLSearchParams(searchParams);
        next.delete('install');
        setSearchParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [installSlug, loading, builtins, registryExtensions]);

    const handleBuiltinInstall = async (slug) => {
        setInstalling(true);
        try {
            const result = await api.installBuiltinExtension(slug);
            toast.success(t('app.marketplace.installedHotReloadShouldPickIt', 'Installed "{{displayname}}". Hot-reload should pick it up; restart backend if blueprint routes do not appear.', { displayname: result.display_name }));
            loadExtensions();
        } catch (err) {
            toastError(toast, t('app.marketplace.localInstallFailed', "Couldn't install from the local file."), err);
        } finally {
            setInstalling(false);
        }
    };

    const handleRegistryInstall = async (slug, acknowledgeRisk = false) => {
        setInstalling(true);
        try {
            const result = await api.installRegistryExtension(
                slug, acknowledgeRisk ? { acknowledge_risk: true } : undefined);
            toast.success(t('app.marketplace.installedRestartBackendIfBlueprintRoutes', 'Installed "{{displayname}}". Restart backend if blueprint routes do not appear.', { displayname: result.display_name }));
            loadExtensions();
        } catch (err) {
            // 409 trust gate — ask for explicit confirmation, then retry.
            if (err.status === 409 && err.data?.requires_acknowledgment) {
                setRiskTarget({ slug, reason: err.data?.reason || 'unreviewed' });
            } else {
                toastError(toast, t('app.marketplace.registryInstallFailed', "Couldn't install from the registry."), err);
            }
        } finally {
            setInstalling(false);
        }
    };

    const installEntry = (entry) => {
        if (entry.source === 'local') {
            handleBuiltinInstall(entry.installKey);
        } else if (entry.trust === 'unreviewed') {
            // Proactive gate: unreviewed registry entries confirm first
            // (the backend 409 path above covers the race/stale cases).
            setRiskTarget({ slug: entry.installKey, reason: 'unreviewed' });
        } else if (entry.signed && !entry.publisherTrusted) {
            // Signed by a publisher key this panel doesn't pin — consent first;
            // the backend 409 path is the authoritative backstop.
            setRiskTarget({ slug: entry.installKey, reason: 'untrusted_key' });
        } else {
            handleRegistryInstall(entry.installKey);
        }
    };

    const confirmRiskyInstall = () => {
        const slug = riskTarget?.slug;
        const updatePluginId = riskTarget?.updatePluginId;
        setRiskTarget(null);
        if (updatePluginId) {
            handlePluginUpdate(updatePluginId, true);
        } else if (slug) {
            handleRegistryInstall(slug, true);
        }
    };

    // Land on Installed after a manual install so the new row (and its
    // actions) is immediately visible.
    const handleManualInstalled = () => {
        setManualInstallSource(null);
        loadExtensions();
        navigate('/extensions/installed');
    };

    // Open the data-policy dialog instead of uninstalling immediately, so the
    // operator can choose to keep or purge the extension's tables.
    const requestPluginUninstall = (plugin) => setUninstallTarget(plugin);

    const confirmPluginUninstall = async (purge) => {
        const plugin = uninstallTarget;
        setUninstallTarget(null);
        if (!plugin || busyPlugin) return;
        setBusyPlugin({ id: plugin.id, action: 'uninstall' });
        try {
            await api.uninstallPlugin(plugin.id, purge);
            toast.success(purge ? t('app.marketplace.extensionUninstalledDataPurged', 'Extension uninstalled; data deleted') : t('app.marketplace.extensionUninstalledDataKept', 'Extension uninstalled; data kept'));
            await loadExtensions();
        } catch (err) {
            toastError(toast, t('app.marketplace.couldntUninstall', "Couldn't uninstall the extension."), err);
        } finally {
            setBusyPlugin(null);
        }
    };

    const handlePluginUpdate = async (pluginId, acknowledgeRisk = false) => {
        if (busyPlugin) return;
        setBusyPlugin({ id: pluginId, action: 'update' });
        try {
            const result = await api.updatePlugin(
                pluginId, acknowledgeRisk ? { acknowledge_risk: true } : undefined);
            toast.success(t('app.marketplace.extensionUpdatedToV', 'Extension "{{displayname}}" updated to v{{version}}', { displayname: result.display_name, version: result.version }));
            await loadExtensions();
        } catch (err) {
            // 409 consent gate (audit M2) — same acknowledge flow as installs.
            if (err.status === 409 && err.data?.requires_acknowledgment) {
                setRiskTarget({ updatePluginId: pluginId, reason: err.data?.reason || 'unsigned' });
            } else {
                toastError(toast, t('app.marketplace.extensionUpdateFailed', "Couldn't update the extension."), err);
            }
        } finally {
            setBusyPlugin(null);
        }
    };

    const handlePluginToggle = async (plugin) => {
        if (busyPlugin) return;
        setBusyPlugin({ id: plugin.id, action: plugin.status === 'active' ? 'disable' : 'enable' });
        try {
            if (plugin.status === 'active') {
                await api.disablePlugin(plugin.id);
                toast.success(t('app.marketplace.extensionDisabled', 'Extension disabled'));
            } else {
                await api.enablePlugin(plugin.id);
                toast.success(t('app.marketplace.extensionEnabled', 'Extension enabled'));
            }
            await loadExtensions();
        } catch (err) {
            toastError(toast, t('app.marketplace.couldntToggle', "Couldn't turn the extension on or off."), err);
        } finally {
            setBusyPlugin(null);
        }
    };

    const resetFilters = () => {
        setSearch('');
        setCategory('');
        setFilters({ ownership: '' });
    };

    const updateAll = useUpdateAll(store.updates, loadExtensions);
    const activeFilterCount = countActiveFilters(filters);
    const showSearch = !updatesView;

    // Search + publisher filter sit in the shared page top bar next to Install
    // manually. Search is debounced, so re-publishing here is cheap and React
    // reconciles the input in place (focus is preserved between keystrokes).
    useTopbarActions(() =>
        <>
            {showSearch && (
                <SearchField
                    value={installedView ? installedSearch : search}
                    onSearch={installedView ? setInstalledSearch : setSearch}
                    placeholder={t('app.marketplace.searchExtensions', 'Search extensions…')}
                />
            )}
            {!installedView && !updatesView && (
                <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={() => setManualInstallSource('url')}
                title={t('app.marketplace.installManually', 'Install manually')}
                aria-label={t('app.marketplace.installManually', 'Install manually')}
            >
                <UploadCloud aria-hidden="true" />
                {t('app.marketplace.installShort', 'Install')}
            </Button>
        </>,
        [installedView, updatesView, search, installedSearch, activeFilterCount],
    );

    if (loading) return <PageLoader />;

    const mergedCatalogEntries = [...builtins.map(getLocalCatalogEntry), ...registryExtensions.map(getRegistryCatalogEntry)]
        .map((entry, index) => ({ entry, index }))
        .sort((x, y) => {
            // Featured first, by feature score; otherwise keep catalog order.
            const fx = x.entry.featured ? 1 : 0;
            const fy = y.entry.featured ? 1 : 0;
            if (fx !== fy) return fy - fx;
            if (fx && x.entry.featureScore !== y.entry.featureScore) return y.entry.featureScore - x.entry.featureScore;
            return x.index - y.index;
        })
        .map(({ entry }) => entry);
    const updatesByKey = indexUpdates(store.updates);
    const categoryBySlug = Object.fromEntries(plugins.map((p) => [p.slug, p.category]));
    const filterGroups = [{
        key: 'ownership',
        labelKey: 'app.marketplace.publisher', label: 'Publisher',
        type: 'single',
        options: [
            { value: 'serverkit', labelKey: 'app.marketplace.byServerkit', label: 'By ServerKit' },
            { value: 'community', labelKey: 'app.marketplace.community', label: 'Community' },
        ],
    }];
    const catalogEntries = mergedCatalogEntries
        .filter((entry) => catalogEntryMatches(entry, search, category))
        .filter((entry) => {
            if (filters.ownership === 'serverkit') return entry.firstParty;
            if (filters.ownership === 'community') return !entry.firstParty;
            return true;
        });
    const hasFilters = Boolean(search.trim() || category || activeFilterCount > 0);

    const query = installedSearch.trim().toLowerCase();
    const shownPlugins = plugins
        .filter((p) => !query || [p.display_name, p.slug, p.description].some((v) => String(v || '').toLowerCase().includes(query)))
        .filter((p) => !statusFilter
            || (statusFilter === 'active' ? p.status === 'active'
                : statusFilter === 'error' ? p.status === 'error'
                    : p.status !== 'active' && p.status !== 'error'));
    const statusOptions = [
        { value: '', label: t('app.marketplace.all', 'All') },
        { value: 'active', label: t('app.marketplace.enabled', 'Enabled') },
        { value: 'disabled', label: t('app.marketplace.disabled', 'Disabled') },
        { value: 'error', label: t('app.marketplace.errors', 'Errors') },
    ];

    return (
        <div className="sk-tabgroup__inner marketplace-page">
            <UpdatesBanner
                count={store.count}
                readyCount={updateAll.readyCount}
                progress={updateAll.progress}
                onUpdateAll={updateAll.run}
            />

            {updatesView ? (
                <UpdatesView
                    store={store}
                    categories={categoryBySlug}
                    busyId={busyPlugin?.action === 'update' ? busyPlugin.id : null}
                    onUpdate={handlePluginUpdate}
                />
            ) : !installedView ? (
                <section className="marketplace-section">
                    <CategoryChips
                        categories={deriveCatalogCategories(mergedCatalogEntries)}
                        value={category}
                        onChange={setCategory}
                    />
                    {hasFilters && (
                        <div className="marketplace-resultbar">
                            <Button variant="ghost" size="sm" onClick={resetFilters}>
                                {t('app.marketplace.resetFilters', 'Reset filters')}
                            </Button>
                        </div>
                    )}
                    {loadErrors.catalog && mergedCatalogEntries.length > 0 && (
                        <ErrorState compact error={loadErrors.catalog} onRetry={loadExtensions} />
                    )}
                    {loadErrors.catalog && mergedCatalogEntries.length === 0 ? (
                        <ErrorState
                            title={t('app.marketplace.couldntLoadTheCatalog', "Couldn't load the extension catalog.")}
                            error={loadErrors.catalog}
                            onRetry={loadExtensions}
                        />
                    ) : catalogEntries.length > 0 ? (
                        <CatalogGrid>
                            {catalogEntries.map((entry) => {
                                const update = entry.installed ? updatesByKey.get(entry.installKey) : null;
                                const row = update && plugins.find((p) => p.slug === entry.installKey);
                                return (
                                    <CatalogExtensionCard
                                        key={entry.key}
                                        entry={entry}
                                        update={update}
                                        busy={Boolean(row) && busyPlugin?.id === row.id}
                                        installing={installing}
                                        onInstall={() => installEntry(entry)}
                                        onUpdate={(u) => handlePluginUpdate(u.plugin_id)}
                                        onOpenDetail={setDetailEntry}
                                    />
                                );
                            })}
                        </CatalogGrid>
                    ) : (
                        <EmptyState
                            icon={Package}
                            title={t('app.marketplace.noCatalogEntriesFound', 'No catalog entries found')}
                            description={hasFilters ? t('app.marketplace.noBuiltInOrRegistryEntries', 'No built-in or registry entries match the current filter.') : t('app.marketplace.noExtensionEntriesAreAvailableYet', 'No extension entries are available yet.')}
                            action={hasFilters ? (
                                <Button variant="outline" size="sm" onClick={resetFilters}>{t('common.actions.clearFilters', 'Clear filters')}</Button>
                            ) : undefined}
                        />
                    )}
                </section>
            ) : (
                <section className="marketplace-section">
                    {plugins.length > 0 && (
                        <SegControl className="marketplace-chips" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
                    )}
                    {loadErrors.installed && plugins.length > 0 && (
                        <ErrorState compact error={loadErrors.installed} onRetry={loadExtensions} />
                    )}
                    {loadErrors.installed && plugins.length === 0 ? (
                        <ErrorState
                            title={t('app.marketplace.couldntLoadInstalledExtensions', "Couldn't load installed extensions.")}
                            error={loadErrors.installed}
                            onRetry={loadExtensions}
                        />
                    ) : shownPlugins.length > 0 ? (
                        <CatalogGrid>
                            {shownPlugins.map((plugin) => (
                                <InstalledCard
                                    key={plugin.id}
                                    plugin={plugin}
                                    update={updatesByKey.get(String(plugin.id))}
                                    busy={busyPlugin?.id === plugin.id ? busyPlugin.action : null}
                                    onToggle={handlePluginToggle}
                                    onUpdate={handlePluginUpdate}
                                    onUninstall={requestPluginUninstall}
                                    onConfigure={setConfigTarget}
                                    onInspectPermissions={setPermissionsTarget}
                                />
                            ))}
                        </CatalogGrid>
                    ) : (
                        <EmptyState
                            icon={PackageCheck}
                            title={plugins.length ? t('app.marketplace.noMatches', 'No matching extensions') : t('app.marketplace.noExtensionsInstalled', 'No extensions installed')}
                            description={plugins.length ? undefined : t('app.marketplace.installOneFromTheCatalogOr', 'Install one from the catalog or use Install manually.')}
                            action={plugins.length ? undefined : (
                                <Button variant="outline" size="sm" onClick={() => navigate('/extensions')}>
                                    {t('app.marketplace.browseCatalog', 'Browse catalog')}
                                </Button>
                            )}
                        />
                    )}
                </section>
            )}

            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filters}
                onChange={setFilters}
                title={t('app.marketplace.filterExtensions', 'Filter extensions')}
            />

            {manualInstallSource && (
                <ManualInstallModal
                    defaultSource={manualInstallSource}
                    onClose={() => setManualInstallSource(null)}
                    onInstalled={handleManualInstalled}
                />
            )}

            {detailEntry && (
                <ExtensionDetailModal
                    entry={detailEntry}
                    installing={installing}
                    statusVariant={statusVariant}
                    onClose={() => setDetailEntry(null)}
                    onInstall={() => {
                        installEntry(detailEntry);
                        setDetailEntry(null);
                    }}
                />
            )}

            {uninstallTarget && (
                <PluginUninstallDialog
                    plugin={uninstallTarget}
                    onCancel={() => setUninstallTarget(null)}
                    onConfirm={confirmPluginUninstall}
                />
            )}

            {riskTarget && (
                <Modal
                    open
                    onClose={() => setRiskTarget(null)}
                    title={riskTarget.reason === 'unverified'
                        ? t('app.marketplace.installWithoutChecksumVerification', 'Install without checksum verification?')
                        : riskTarget.reason === 'untrusted_key'
                            ? t('app.marketplace.installWithAnUnverifiableSignature', 'Install with an unverifiable signature?')
                            : riskTarget.reason === 'unsigned'
                                ? t('app.marketplace.anUnsignedRelease', '{{value}} an unsigned release?', { value: riskTarget.updatePluginId ? t('app.marketplace.update', 'Update') : t('app.marketplace.install', 'Install') })
                                : t('app.marketplace.installUnreviewedExtension', 'Install unreviewed extension?')}
                    size="sm"
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setRiskTarget(null)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button variant="destructive" onClick={confirmRiskyInstall}>
                                {riskTarget.updatePluginId ? t('app.marketplace.updateAnyway', 'Update anyway') : t('app.marketplace.installAnyway', 'Install anyway')}
                            </Button>
                        </>
                    }
                >
                    <div className="extension-risk-dialog">
                        <p>
                            {riskTarget.reason === 'unverified'
                                ? 'This extension has no pinned checksum, so the panel '
                                  + 'cannot verify the artifact it would download.'
                                : riskTarget.reason === 'untrusted_key'
                                    ? 'This extension is signed, but the publisher key is not '
                                      + 'pinned by this panel, so the signature cannot be '
                                      + 'verified. Treat it as unsigned.'
                                    : riskTarget.reason === 'unsigned'
                                        ? 'This release is not signed with a publisher key pinned '
                                          + 'by this panel, so its origin cannot be verified. It '
                                          + 'may be a legitimate older release — or a downgrade attempt.'
                                        : 'This is a community extension whose exact code has not '
                                          + 'been reviewed by the ServerKit maintainers.'}
                        </p>
                        <p className="text-muted">
                            {t('app.marketplace.itRunsWithFullPanelPrivileges', 'It runs with full panel privileges. Only install it if you trust the author.')}
                        </p>
                    </div>
                </Modal>
            )}

            {configTarget && (
                <PluginConfigDialog
                    plugin={configTarget}
                    onClose={() => setConfigTarget(null)}
                />
            )}

            {permissionsTarget && (
                <ExtensionPermissionsDialog
                    plugin={permissionsTarget}
                    onClose={() => setPermissionsTarget(null)}
                />
            )}
        </div>
    );
};

export default Marketplace;
