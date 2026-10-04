import { useState, useEffect, useCallback } from 'react';
import { statusVariant } from '@/components/ds/status';
import { useLocation, useSearchParams, useNavigate } from 'react-router-dom';
import {
    Activity,
    CheckCircle2,
    DownloadCloud,
    ExternalLink,
    Gamepad2,
    LayoutGrid,
    Package,
    PackageCheck,
    Plug,
    PlugZap,
    ServerCog,
    ShieldAlert,
    ShieldCheck,
    ShieldQuestion,
    Sparkles,
    Star,
    UploadCloud,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { sanitizeSvgInner } from '../utils/sanitizeSvg';
import Modal from '@/components/Modal';
import PageLoader from '../components/PageLoader';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    SearchField, FilterDrawer, FilterButton, countActiveFilters,
} from '@/components/ds';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import ManualInstallModal from '../components/marketplace/ManualInstallModal';
import ExtensionPermissionsDialog from '../components/marketplace/ExtensionPermissionsDialog';
import { ExtensionBrandMark } from '../components/icons/ExtensionBrands';
import { hasBrandMark, extensionCoverStyle } from '../components/icons/extensionBrandData';
import { resolveExtensionIcon } from '../components/icons/ExtensionIcons';
import { useTranslation } from 'react-i18next';

const CATEGORIES = ['ai', 'games', 'monitoring', 'security', 'deployment', 'integration', 'ui', 'utility'];

const CATEGORY_ICONS = {
    ai: Sparkles,
    games: Gamepad2,
    monitoring: Activity,
    security: ShieldCheck,
    deployment: ServerCog,
    integration: Plug,
    ui: LayoutGrid,
    utility: Package,
};

const titleCase = (value = '') => {
    const cleaned = String(value || 'utility').replace(/[-_]/g, ' ');
    return cleaned
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const getCategoryIcon = (category) => CATEGORY_ICONS[category] || Package;

// A first-party ("by ServerKit") entry is one authored by ServerKit or one whose
// manifest explicitly opts in via `first_party`. Case-insensitive on author.
const isFirstParty = (author, source = {}) => {
    if (source && source.first_party) return true;
    return String(author || '').trim().toLowerCase() === 'serverkit';
};

// Union of categories actually present across the merged catalog, ordered by the
// canonical CATEGORIES list first, then any extras alphabetically (stable, deduped).
const deriveCatalogCategories = (entries) => {
    const present = new Set(entries.map((entry) => entry.category || 'utility'));
    const known = CATEGORIES.filter((item) => present.has(item));
    const extra = [...present].filter((item) => !CATEGORIES.includes(item)).sort();
    return [...known, ...extra];
};

const getRegistryCatalogEntry = (entry) => ({
    key: `registry:${entry.slug}`,
    source: 'registry',
    sourceLabel: 'Registry',
    sourceDetail: 'Remote registry package',
    installKey: entry.slug,
    displayName: entry.display_name || entry.slug,
    description: entry.description || 'No description provided.',
    category: entry.category || 'utility',
    version: entry.version || '0.0.0',
    author: entry.author,
    firstParty: isFirstParty(entry.author, entry),
    trust: entry.trust || 'unreviewed',
    review: entry.review || null,
    // Release-signature state from the index (plan 55): `signed` means the
    // entry carries an ed25519 signature the panel verifies at install;
    // `publisherTrusted` means the named key is pinned by this panel.
    signed: Boolean(entry.signature),
    publisherTrusted: Boolean(entry.publisher_trusted),
    publisherKeyId: entry.publisher_key_id || null,
    icon: entry.icon || null,
    logo: entry.logo || null,
    repo: entry.repo || entry.homepage || null,
    screenshots: Array.isArray(entry.screenshots) ? entry.screenshots : [],
    permissions: Array.isArray(entry.permissions) ? entry.permissions : [],
    configSchema: entry.config_schema && typeof entry.config_schema === 'object' ? entry.config_schema : null,
    extensionType: 'registry',
    installed: Boolean(entry.installed),
    status: entry.status,
    featured: Boolean(entry.featured),
    featureScore: Number(entry.feature_score) || 0,
});

// Source badge tint: built-in is 'warning', registry is 'info'.
const sourceBadgeVariant = (source) => {
    if (source === 'local') return 'warning';
    if (source === 'registry') return 'info';
    return 'outline';
};

// Trust badge derived from the registry's hash-bound review stamp. 'reviewed'
// shows who/when in the tooltip; 'unreviewed' warns on registry entries
// (built-in entries never carry a trust field).
const TrustBadge = ({ entry }) => {
    const { t } = useTranslation();
    if (entry.trust === 'reviewed') {
        const review = entry.review || {};
        const title = review.reviewer && review.date
            ? `Reviewed by ${review.reviewer} on ${review.date}`
            : 'Reviewed by the ServerKit maintainers';
        return (
            <Badge variant="success" title={title}>
                <ShieldCheck aria-hidden="true" /> {t('app.marketplace.reviewed', 'Reviewed')}
            </Badge>
        );
    }
    if (entry.trust === 'unreviewed' && entry.source === 'registry') {
        return <Badge variant="warning">{t('app.marketplace.unreviewed', 'Unreviewed')}</Badge>;
    }
    return null;
};

// Release-signature badge (plan 55). Shown on the registry detail modal next
// to TrustBadge: 'signed · verified' means the index pins an ed25519 signature
// whose publisher key this panel trusts (verified cryptographically at
// install); unsigned entries get the honest unsigned treatment.
const SignatureBadge = ({ entry }) => {
    const { t } = useTranslation();
    if (entry.source !== 'registry') return null;
    if (entry.signed && entry.publisherTrusted) {
        return (
            <Badge variant="success" title={t('app.marketplace.releaseZipIsSignedThePanel', 'Release zip is signed; the panel verifies the ed25519 signature at install')}>
                <ShieldCheck aria-hidden="true" /> {t('app.marketplace.signed', 'Signed')}
            </Badge>
        );
    }
    if (entry.signed) {
        return (
            <Badge variant="warning" title={t('app.marketplace.signedWithPublisherKeyWhichThis', 'Signed with publisher key \'{{publisherKeyId}}\', which this panel does not pin', { publisherKeyId: entry.publisherKeyId })}>
                <ShieldAlert aria-hidden="true" /> {t('app.marketplace.unknownSigner', 'Unknown signer')}
            </Badge>
        );
    }
    return (
        <Badge variant="outline" title={t('app.marketplace.thisReleaseCarriesNoPublisherSignature', 'This release carries no publisher signature')}>
            {t('app.marketplace.unsigned', 'Unsigned')}
        </Badge>
    );
};

const getLocalCatalogEntry = (builtin) => {
    const manifest = builtin.manifest || {};

    return {
        key: `local:${builtin.slug}`,
        source: 'local',
        sourceLabel: 'Built-in',
        sourceDetail: 'Bundled with ServerKit',
        installKey: builtin.slug,
        displayName: manifest.display_name || builtin.slug,
        description: manifest.description || 'Bundled extension.',
        category: manifest.category || 'utility',
        version: manifest.version || '0.0.0',
        author: manifest.author,
        firstParty: isFirstParty(manifest.author, manifest),
        icon: manifest.icon || null,
        logo: manifest.logo || null,
        screenshots: Array.isArray(manifest.screenshots) ? manifest.screenshots : [],
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        configSchema: manifest.config_schema && typeof manifest.config_schema === 'object' ? manifest.config_schema : null,
        extensionType: 'built-in',
        installed: Boolean(builtin.installed),
        status: builtin.status,
        featured: Boolean(manifest.featured),
        featureScore: Number(manifest.feature_score) || 0,
    };
};

const catalogEntryMatches = (entry, search, category) => {
    if (category && entry.category !== category) return false;

    const query = search.trim().toLowerCase();
    if (!query) return true;

    return [
        entry.displayName,
        entry.description,
        entry.category,
        entry.author,
        entry.sourceLabel,
    ].some((value) => String(value || '').toLowerCase().includes(query));
};

const Marketplace = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const [plugins, setPlugins] = useState([]);
    const [builtins, setBuiltins] = useState([]);
    const [registryExtensions, setRegistryExtensions] = useState([]);
    const [pluginUpdates, setPluginUpdates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    // Advanced filters live in a shared FilterDrawer. `ownership` is single-select
    // ('' all, 'serverkit' firstParty, 'community'); `category` is multi-select.
    const [filters, setFilters] = useState({ ownership: '', category: [] });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    // The active view is driven by the route (/marketplace = browse,
    // /marketplace/installed = installed). The legacy ?tab=installed deep link
    // still resolves to the installed view.
    const installedView = location.pathname.endsWith('/installed')
        || searchParams.get('tab') === 'installed';
    // Manual install modal (URL / folder / zip); null when closed, otherwise
    // the source sub-tab to preselect.
    const [manualInstallSource, setManualInstallSource] = useState(null);
    const [installing, setInstalling] = useState(false);
    const [detailEntry, setDetailEntry] = useState(null);
    // Registry entry awaiting risk confirmation — drives the acknowledge-risk
    // dialog (confirm retries with acknowledge_risk: true). Shape:
    // { slug, reason } where reason is 'unreviewed' (proactive gate or 409),
    // 'unverified' (409: entry has no pinned checksum), or 'untrusted_key'
    // (signed by a publisher key this panel doesn't pin — plan 55).
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
    // dependencies are being read (plan 55 tasks 6+7) — drives the read-only
    // permissions dialog.
    const [permissionsTarget, setPermissionsTarget] = useState(null);

    const loadExtensions = useCallback(async () => {
        try {
            const [pData, bData, rData, uData] = await Promise.all([
                api.getInstalledPlugins().catch(() => ({ plugins: [] })),
                api.getBuiltinExtensions().catch(() => ({ builtin: [] })),
                api.getRegistryExtensions().catch(() => ({ extensions: [] })),
                api.getPluginUpdates().catch(() => ({ updates: [] })),
            ]);
            setPlugins(pData.plugins || []);
            setBuiltins(bData.builtin || []);
            setRegistryExtensions(rData.extensions || []);
            setPluginUpdates(uData.updates || []);
        } catch {
            toast.error(t('app.marketplace.failedToLoadExtensions', 'Failed to load extensions'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

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
            toast.error(err.message || t('app.marketplace.localInstallFailed', 'Local install failed'));
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
                toast.error(err.message || t('app.marketplace.registryInstallFailed', 'Registry install failed'));
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
            // Signed by a publisher key this panel doesn't pin — consent first
            // (plan 55); the backend 409 path is the authoritative backstop.
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
            toast.success(purge ? t('app.marketplace.extensionUninstalledDataPurged', 'Extension uninstalled; data purged') : t('app.marketplace.extensionUninstalledDataKept', 'Extension uninstalled; data kept'));
            await loadExtensions();
        } catch (err) {
            toast.error(err.message);
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
            toast.success(t('app.marketplace.extensionUpdatedToV', 'Extension "{{displayname}}" updated to v{{version}}.', { displayname: result.display_name, version: result.version }));
            await loadExtensions();
        } catch (err) {
            // 409 consent gate (audit M2) — same acknowledge flow as installs.
            if (err.status === 409 && err.data?.requires_acknowledgment) {
                setRiskTarget({ updatePluginId: pluginId, reason: err.data?.reason || 'unsigned' });
            } else {
                toast.error(err.message || t('app.marketplace.extensionUpdateFailed', 'Extension update failed'));
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
            toast.error(err.message);
        } finally {
            setBusyPlugin(null);
        }
    };

    const resetFilters = () => {
        setSearch('');
        setFilters({ ownership: '', category: [] });
    };

    const pluginStatusVariant = (status) => statusVariant(status);

    const activeFilterCount = countActiveFilters(filters);

    // Search + advanced-filter trigger sit in the shared page top bar (next to
    // Install manually) so the browse body starts straight at the grid. Only the
    // browse view gets search/filters; the installed view keeps Install manually
    // alone. Search is debounced, so re-publishing here is cheap and React
    // reconciles the input in place (focus is preserved between keystrokes).
    useTopbarActions(() =>
        <>
            {!installedView && (
                <>
                    <SearchField
                        value={search}
                        onSearch={setSearch}
                        placeholder={t('app.marketplace.searchExtensions', 'Search extensions…')}
                    />
                    <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
                </>
            )}
            <Button variant="outline" size="sm" onClick={() => setManualInstallSource('url')}>
                <UploadCloud aria-hidden="true" />
                {t('app.marketplace.installManually', 'Install manually')}
            </Button>
        </>,
        [installedView, search, activeFilterCount],
    );

    if (loading) return <PageLoader />;

    const localCatalogEntries = builtins.map(getLocalCatalogEntry);
    const registryCatalogEntries = registryExtensions.map(getRegistryCatalogEntry);
    // Update descriptors keyed by both plugin_id and slug so PluginRow can match
    // whichever identifier it has on hand.
    const updatesByKey = new Map();
    pluginUpdates.forEach((update) => {
        if (update.plugin_id != null) updatesByKey.set(String(update.plugin_id), update);
        if (update.slug) updatesByKey.set(update.slug, update);
    });
    // Featured entries float to the top of the catalog, ordered by their
    // feature score (higher = more prominent). The score itself is not shown —
    // it only drives ordering; featured cards just get a "Featured" badge.
    const mergedCatalogEntries = [...localCatalogEntries, ...registryCatalogEntries]
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => {
            const fa = a.entry.featured ? 1 : 0;
            const fb = b.entry.featured ? 1 : 0;
            if (fa !== fb) return fb - fa;
            if (fa && a.entry.featureScore !== b.entry.featureScore) {
                return b.entry.featureScore - a.entry.featureScore;
            }
            return a.index - b.index; // stable: preserve original order otherwise
        })
        .map(({ entry }) => entry);
    const catalogCategories = deriveCatalogCategories(mergedCatalogEntries);
    const filterGroups = [
        {
            key: 'ownership',
            labelKey: 'app.marketplace.publisher', label: 'Publisher',
            type: 'single',
            options: [
                { value: 'serverkit', labelKey: 'app.marketplace.byServerkit', label: 'By ServerKit' },
                { value: 'community', labelKey: 'app.marketplace.community', label: 'Community' },
            ],
        },
        {
            key: 'category',
            labelKey: 'app.marketplace.categories', label: 'Categories',
            type: 'multi',
            options: catalogCategories.map((item) => ({ value: item, label: titleCase(item) })),
        },
    ];
    const catalogEntries = mergedCatalogEntries
        // Category is handled below (multi-select), so pass '' to the shared matcher.
        .filter((entry) => catalogEntryMatches(entry, search, ''))
        .filter((entry) => {
            if (filters.ownership === 'serverkit') return entry.firstParty;
            if (filters.ownership === 'community') return !entry.firstParty;
            return true;
        })
        .filter((entry) => {
            const cats = filters.category || [];
            return cats.length === 0 || cats.includes(entry.category);
        });
    const hasFilters = Boolean(search.trim() || activeFilterCount > 0);

    return (
        <div className="sk-tabgroup__inner marketplace-page">
            {!installedView ? (
                <>
                    {hasFilters && (
                        <div className="marketplace-resultbar">
                            <Button variant="ghost" size="sm" onClick={resetFilters}>
                                {t('app.marketplace.resetFilters', 'Reset filters')}
                            </Button>
                        </div>
                    )}

                    <section className="marketplace-section">
                        {catalogEntries.length > 0 ? (
                            <div className="extensions-grid">
                                {catalogEntries.map((entry) => (
                                    <CatalogExtensionCard
                                        key={entry.key}
                                        entry={entry}
                                        installing={installing}
                                        onInstall={() => installEntry(entry)}
                                        onOpenDetail={setDetailEntry}
                                        statusVariant={pluginStatusVariant}
                                    />
                                ))}
                            </div>
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
                </>
            ) : (
                <section className="marketplace-section">
                    <SectionHeader
                        title={t('app.marketplace.installedExtensions', 'Installed extensions')}
                        meta={`${plugins.length} installed`}
                    />
                    {plugins.length > 0 ? (
                        <div className="installed-list">
                            {plugins.map((plugin) => (
                                <PluginRow
                                    key={plugin.id}
                                    plugin={plugin}
                                    update={updatesByKey.get(String(plugin.id))}
                                    busy={busyPlugin?.id === plugin.id ? busyPlugin.action : null}
                                    onToggle={handlePluginToggle}
                                    onUpdate={handlePluginUpdate}
                                    onUninstall={requestPluginUninstall}
                                    onConfigure={setConfigTarget}
                                    onInspectPermissions={setPermissionsTarget}
                                    statusVariant={pluginStatusVariant}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={PackageCheck}
                            title={t('app.marketplace.noExtensionsInstalled', 'No extensions installed')}
                            description={t('app.marketplace.installOneFromTheCatalogOr', 'Install one from the catalog or use Install manually.')}
                            action={(
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
                    statusVariant={pluginStatusVariant}
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
                                {riskTarget.updatePluginId ? 'Update anyway' : 'Install anyway'}
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

const SectionHeader = ({ title, meta }) => (
    <div className="marketplace-section__header">
        <h2>{title}</h2>
        {meta && <Badge variant="outline">{meta}</Badge>}
    </div>
);

// Cover banner + artwork with a deterministic fallback chain:
// registry logo image -> bundled illustrated icon -> Simple Icons brand mark ->
// manifest icon SVG -> category lucide glyph. Image artwork (logo or bundled
// icon) sits on a clean light tile at one shared size; the white brand-mark /
// glyph fallbacks keep the deterministic gradient so they stay legible. The
// tile is chosen from what actually renders, so a registry logo that fails to
// load falls back to the gradient instead of a white glyph on white. `base` is
// the cover class ('extension-card__cover' or 'extension-detail__cover'); both
// the card and the detail modal share this component.
const ExtensionCover = ({ base, entry, category, brandSize = 34, children }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const rasterIcon = resolveExtensionIcon(entry.installKey, category);
    const imageSrc = entry.logo && !logoFailed ? entry.logo : rasterIcon;

    if (imageSrc) {
        return (
            <div className={`${base} ${base}--icon`}>
                <img
                    src={imageSrc}
                    loading="lazy"
                    alt=""
                    aria-hidden="true"
                    className="extension-card__icon"
                    onError={imageSrc === entry.logo ? () => setLogoFailed(true) : undefined}
                />
                {children}
            </div>
        );
    }
    return (
        <div className={base} style={extensionCoverStyle(entry.installKey, category)}>
            <ExtensionGlyph entry={entry} category={category} brandSize={brandSize} />
            {children}
        </div>
    );
};

const ExtensionGlyph = ({ entry, category, brandSize }) => {
    const Icon = getCategoryIcon(category);
    const iconSvg = entry.icon ? sanitizeSvgInner(entry.icon) : '';

    if (hasBrandMark(entry.installKey)) {
        return (
            <ExtensionBrandMark
                slug={entry.installKey}
                size={brandSize}
                className="extension-card__brand"
            />
        );
    }
    if (iconSvg) {
        return (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
                focusable="false"
                className="extension-card__glyph"
                /* sink-safe: iconSvg = sanitizeSvgInner(entry.icon) above */
                dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
        );
    }
    return <Icon aria-hidden="true" className="extension-card__glyph" />;
};

const CatalogExtensionCard = ({ entry, installing, onInstall, onOpenDetail, statusVariant }) => {
    const { t } = useTranslation();
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    const openDetail = () => onOpenDetail(entry);
    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openDetail();
        }
    };

    return (
        <article
            className={`extension-card extension-card--${entry.source} extension-card--${category} extension-card--clickable card${entry.featured ? ' extension-card--featured' : ''}`}
            role="button"
            tabIndex={0}
            onClick={openDetail}
            onKeyDown={handleKeyDown}
        >
            <ExtensionCover base="extension-card__cover" entry={entry} category={category} brandSize={34}>
                {entry.featured && (
                    <span className="extension-featured-badge">
                        <Star aria-hidden="true" /> {t('app.marketplace.featured', 'Featured')}
                    </span>
                )}
            </ExtensionCover>
            <div className="extension-card__badges">
                <Badge variant={sourceBadgeVariant(entry.source)}>{entry.sourceLabel}</Badge>
                <Badge variant="outline">{titleCase(category)}</Badge>
            </div>
            <div className="extension-card__body">
                <h3>{entry.displayName}</h3>
                <p className="extension-card__desc">{entry.description}</p>
            </div>
            <div className="extension-card__footer">
                <div className="extension-card__info">
                    <span>v{entry.version}</span>
                    {entry.firstParty ? (
                        <Badge variant="secondary" className="extension-firstparty">{t('app.marketplace.byServerkit2', 'by ServerKit')}</Badge>
                    ) : (
                        entry.author && <span>by {entry.author}</span>
                    )}
                    <TrustBadge entry={entry} />
                </div>
                <div className="extension-card__actions">
                    {entry.installed ? (
                        <Badge variant={isLocal ? statusVariant(entry.status) : 'success'}>
                            <CheckCircle2 aria-hidden="true" />
                            {installedLabel}
                        </Badge>
                    ) : (
                        <Button
                            size="sm"
                            disabled={installing}
                            onClick={(event) => {
                                event.stopPropagation();
                                onInstall(entry.installKey);
                            }}
                        >
                            <DownloadCloud aria-hidden="true" />
                            {installing ? 'Installing...' : 'Install'}
                        </Button>
                    )}
                </div>
            </div>
        </article>
    );
};

const ExtensionDetailModal = ({ entry, installing, statusVariant, onClose, onInstall }) => {
    const { t } = useTranslation();
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const screenshots = entry.screenshots || [];
    const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
    const configKeys = entry.configSchema && typeof entry.configSchema === 'object'
        ? Object.keys(entry.configSchema)
        : [];
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    return (
        <Modal open onClose={onClose} title={entry.displayName} size="lg">
            <div className="extension-detail">
                <ExtensionCover base="extension-detail__cover" entry={entry} category={category} brandSize={46} />
                <div className="extension-detail__header">
                    <div className="extension-detail__heading">
                        <div className="extension-detail__badges">
                            {entry.firstParty && (
                                <Badge variant="secondary" className="extension-firstparty">{t('app.marketplace.byServerkit2', 'by ServerKit')}</Badge>
                            )}
                            <TrustBadge entry={entry} />
                            <SignatureBadge entry={entry} />
                            <Badge variant={sourceBadgeVariant(entry.source)}>{entry.sourceLabel}</Badge>
                            <Badge variant="outline">{titleCase(category)}</Badge>
                        </div>
                        <div className="extension-detail__meta">
                            <span>v{entry.version}</span>
                            {entry.author && <span>by {entry.author}</span>}
                            <span>{isLocal ? 'built-in' : entry.extensionType}</span>
                            {entry.repo && (
                                <a
                                    href={entry.repo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="extension-detail__repo-link"
                                >
                                    <ExternalLink aria-hidden="true" />
                                    {t('app.marketplace.sourceRepo', 'Source repo')}
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                <p className="extension-detail__desc">{entry.description}</p>

                {permissions.length > 0 && (
                    <div className="extension-detail__consent">
                        <p className="extension-detail__section-label">{t('app.marketplace.thisExtensionRequests', 'This extension requests:')}</p>
                        <div className="extension-detail__chips">
                            {permissions.map((permission) => (
                                <Badge key={permission} variant="outline">{permission}</Badge>
                            ))}
                        </div>
                    </div>
                )}

                {configKeys.length > 0 && (
                    <div className="extension-detail__config">
                        <p className="extension-detail__section-label">{t('app.marketplace.configuration', 'Configuration')}</p>
                        <ul className="extension-detail__config-list">
                            {configKeys.map((key) => (
                                <li key={key}><code>{key}</code></li>
                            ))}
                        </ul>
                    </div>
                )}

                {screenshots.length > 0 && (
                    <div className="extension-detail__gallery" aria-label={t('app.marketplace.screenshots', 'Screenshots')}>
                        {screenshots.map((src, index) => (
                            <img
                                key={src}
                                src={src}
                                alt={`${entry.displayName} screenshot ${index + 1}`}
                                className="extension-detail__shot"
                                loading="lazy"
                            />
                        ))}
                    </div>
                )}

                <div className="extension-detail__actions">
                    {entry.installed ? (
                        <Badge variant={isLocal ? statusVariant(entry.status) : 'success'}>
                            <CheckCircle2 aria-hidden="true" />
                            {installedLabel}
                        </Badge>
                    ) : (
                        <Button disabled={installing} onClick={onInstall}>
                            <DownloadCloud aria-hidden="true" />
                            {installing ? 'Installing...' : 'Install'}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
};

// Install-origin badge for installed rows. url/local/upload all collapse to
// "Manual" — the raw origin lives in the tooltip.
const PLUGIN_SOURCE_BADGES = {
    builtin: { labelKey: 'app.marketplace.builtIn', label: 'Built-in', variant: 'warning' },
    registry: { labelKey: 'app.marketplace.registry', label: 'Registry', variant: 'info' },
};

const PluginRow = ({
    plugin, update, busy, onToggle, onUpdate, onUninstall, onConfigure,
    onInspectPermissions, statusVariant,
}) => {
    const { t } = useTranslation();
    const updateAvailable = Boolean(update?.update_available);
    const compatible = update?.compatible !== false;
    // A row action is in flight — disable every action on this row so it can't
    // be double-fired, and surface which one via the button copy.
    const isBusy = Boolean(busy);
    const configurable = plugin.config_schema
        && typeof plugin.config_schema === 'object'
        && Object.keys(plugin.config_schema).length > 0;
    const sourceBadge = PLUGIN_SOURCE_BADGES[plugin.source_type]
        || { labelKey: 'app.marketplace.manual', label: 'Manual', variant: 'outline', title: plugin.source_url || undefined };

    return (
        <article className={`installed-item installed-item--plugin card ${plugin.status === 'error' ? 'installed-item--error' : ''}`}>
            <div className="installed-item__main">
                <div className="installed-item__icon installed-item__icon--plugin">
                    <PlugZap aria-hidden="true" />
                </div>
                <div className="installed-item__content">
                    <div className="installed-item__title-line">
                        <strong>{plugin.display_name}</strong>
                        <span className="text-muted">v{plugin.version}</span>
                        <Badge variant={statusVariant(plugin.status)}>{plugin.status}</Badge>
                        <Badge variant={sourceBadge.variant} title={sourceBadge.title}>{sourceBadge.label}</Badge>
                        {plugin.has_backend && <Badge variant="secondary">{t('app.marketplace.backend', 'Backend')}</Badge>}
                        {plugin.has_frontend && <Badge variant="secondary">{t('app.marketplace.frontend', 'Frontend')}</Badge>}
                        {updateAvailable && (
                            <Badge variant="info" className="plugin-update-badge">
                                {t('app.marketplace.updateAvailableV', 'Update available → v')}{update.available_version}
                            </Badge>
                        )}
                    </div>
                    {plugin.description && <p className="installed-item__description">{plugin.description}</p>}
                    {plugin.error_message && <p className="installed-item__error">{plugin.error_message}</p>}
                </div>
            </div>
            <div className="installed-item__actions">
                {updateAvailable && (
                    <Button
                        size="sm"
                        disabled={!compatible || isBusy}
                        title={compatible ? undefined : t('app.marketplace.panelVersionIsTooOldFor', 'Panel version is too old for this update')}
                        onClick={() => onUpdate(plugin.id)}
                    >
                        <DownloadCloud aria-hidden="true" />
                        {busy === 'update' ? 'Updating…' : 'Update'}
                    </Button>
                )}
                {configurable && (
                    <Button size="sm" variant="outline" disabled={isBusy} onClick={() => onConfigure(plugin)}>
                        {t('app.marketplace.configure', 'Configure')}
                    </Button>
                )}
                <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    title={t('app.marketplace.declaredPermissionsWhatThePanelHas', 'Declared permissions, what the panel has observed, and pending Python dependencies')}
                    onClick={() => onInspectPermissions(plugin)}
                >
                    <ShieldQuestion aria-hidden="true" />
                    {t('common.labels.permissions', 'Permissions')}
                </Button>
                <Button
                    size="sm"
                    variant={plugin.status === 'active' ? 'outline' : 'default'}
                    disabled={isBusy}
                    onClick={() => onToggle(plugin)}
                >
                    {busy === 'enable' ? 'Enabling…'
                        : busy === 'disable' ? 'Disabling…'
                        : plugin.status === 'active' ? 'Disable' : 'Enable'}
                </Button>
                <Button size="sm" variant="destructive" disabled={isBusy} onClick={() => onUninstall(plugin)}>
                    {busy === 'uninstall' ? 'Uninstalling…' : 'Uninstall'}
                </Button>
            </div>
        </article>
    );
};

// Config editor for an installed plugin (#49). Fields come from the manifest's
// config_schema (top-level keys, or JSON-schema `properties`); values persist
// via PUT /plugins/<id>/config and the plugin reads them on the backend via
// plugins_sdk.config(slug).
const PluginConfigDialog = ({ plugin, onClose }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [values, setValues] = useState(null);
    const [saving, setSaving] = useState(false);

    const schema = plugin.config_schema || {};
    const fields = schema.properties && typeof schema.properties === 'object'
        ? schema.properties
        : schema;

    useEffect(() => {
        api.getPluginConfig(plugin.id)
            .then((data) => setValues(data.config || {}))
            .catch(() => setValues({}));
    }, [plugin.id]);

    const setField = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

    const save = async () => {
        setSaving(true);
        try {
            await api.updatePluginConfig(plugin.id, values || {});
            toast.success(t('app.marketplace.extensionConfigurationSaved', 'Extension configuration saved'));
            onClose();
        } catch (err) {
            toast.error(err.message || t('app.marketplace.failedToSaveConfiguration', 'Failed to save configuration'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={t('app.marketplace.configure2', 'Configure {{displayname}}', { displayname: plugin.display_name })}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button onClick={save} disabled={saving || values === null}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </>
            }
        >
            {values === null ? (
                <p className="text-muted">{t('common.loading', 'Loading…')}</p>
            ) : (
                <div className="plugin-config-form">
                    {Object.entries(fields).map(([key, spec]) => {
                        const s = spec && typeof spec === 'object' ? spec : {};
                        const type = s.type || 'string';
                        const isNumber = type === 'number' || type === 'integer';
                        const value = values[key] ?? s.default ?? (type === 'boolean' ? false : '');
                        return (
                            <label key={key} className="plugin-config-form__field">
                                <span className="plugin-config-form__label">{s.title || key}</span>
                                {type === 'boolean' ? (
                                    <input
                                        type="checkbox"
                                        checked={Boolean(value)}
                                        onChange={(e) => setField(key, e.target.checked)}
                                    />
                                ) : Array.isArray(s.enum) ? (
                                    <select
                                        className="ui-input"
                                        value={value}
                                        onChange={(e) => setField(key, e.target.value)}
                                    >
                                        {s.enum.map((opt) => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        className="ui-input"
                                        type={isNumber ? 'number' : (s.secret ? 'password' : 'text')}
                                        value={value}
                                        onChange={(e) => setField(
                                            key,
                                            isNumber
                                                ? (e.target.value === '' ? '' : Number(e.target.value))
                                                : e.target.value
                                        )}
                                    />
                                )}
                                {s.description && (
                                    <span className="plugin-config-form__hint text-muted">{s.description}</span>
                                )}
                            </label>
                        );
                    })}
                    {Object.keys(fields).length === 0 && (
                        <p className="text-muted">{t('app.marketplace.thisExtensionDeclaresNoConfigurationFields', 'This extension declares no configuration fields.')}</p>
                    )}
                </div>
            )}
        </Modal>
    );
};

// Data-policy dialog for plugin uninstall. Keeping data (default) leaves the
// extension's tables intact for a later reinstall; purging drops them.
const PluginUninstallDialog = ({ plugin, onCancel, onConfirm }) => {
    const { t } = useTranslation();
    return (
        <Modal
            open
            onClose={onCancel}
            title={t('app.marketplace.uninstall', 'Uninstall {{displayname}}?', { displayname: plugin.display_name })}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onCancel}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="outline" onClick={() => onConfirm(false)}>{t('app.marketplace.keepData', 'Keep data')}</Button>
                    <Button variant="destructive" onClick={() => onConfirm(true)}>{t('app.marketplace.purgeData', 'Purge data')}</Button>
                </>
            }
        >
            <div className="plugin-uninstall-dialog">
                <p>{t('app.marketplace.removingThisExtensionStopsItsRoutes', 'Removing this extension stops its routes and UI contributions.')}</p>
                <p className="text-muted">
                    <strong>{t('app.marketplace.keepData', 'Keep data')}</strong> {t('app.marketplace.leavesTheExtensionSDatabaseTables', 'leaves the extension\'s database tables intact so you can reinstall later.')} <strong>{t('app.marketplace.purgeData', 'Purge data')}</strong> {t('app.marketplace.permanentlyDropsTheExtensionSTables', 'permanently drops the extension\'s tables and cannot be undone.')}
                </p>
            </div>
        </Modal>
    );
};

export default Marketplace;
