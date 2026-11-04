import {
    Activity, Gamepad2, LayoutGrid, Package, Plug, ServerCog, ShieldCheck, Sparkles,
} from 'lucide-react';
import { t } from '@/i18n/t';

// Catalog model: normalises registry + built-in entries into one card shape.

export const CATEGORIES = ['ai', 'games', 'monitoring', 'security', 'deployment', 'integration', 'ui', 'utility'];

export const CATEGORY_ICONS = {
    ai: Sparkles,
    games: Gamepad2,
    monitoring: Activity,
    security: ShieldCheck,
    deployment: ServerCog,
    integration: Plug,
    ui: LayoutGrid,
    utility: Package,
};

export const titleCase = (value = '') => {
    const cleaned = String(value || 'utility').replace(/[-_]/g, ' ');
    return cleaned
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

export const getCategoryIcon = (category) => CATEGORY_ICONS[category] || Package;

// A first-party ("by ServerKit") entry is one authored by ServerKit or one whose
// manifest explicitly opts in via `first_party`. Case-insensitive on author.
export const isFirstParty = (author, source = {}) => {
    if (source && source.first_party) return true;
    return String(author || '').trim().toLowerCase() === 'serverkit';
};

// Union of categories actually present across the merged catalog, ordered by the
// canonical CATEGORIES list first, then any extras alphabetically (stable, deduped).
export const deriveCatalogCategories = (entries) => {
    const present = new Set(entries.map((entry) => entry.category || 'utility'));
    const known = CATEGORIES.filter((item) => present.has(item));
    const extra = [...present].filter((item) => !CATEGORIES.includes(item)).sort();
    return [...known, ...extra];
};

export const getRegistryCatalogEntry = (entry) => ({
    key: `registry:${entry.slug}`,
    source: 'registry',
    sourceLabel: 'Registry',
    sourceDetail: 'Remote registry package',
    installKey: entry.slug,
    displayName: entry.display_name || entry.slug,
    description: entry.description || t('app.marketplace.noDescriptionProvided', 'No description provided.'),
    category: entry.category || 'utility',
    version: entry.version || '0.0.0',
    author: entry.author,
    firstParty: isFirstParty(entry.author, entry),
    trust: entry.trust || 'unreviewed',
    review: entry.review || null,
    // Release-signature state from the index: `signed` means the
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
export const sourceBadgeVariant = (source) => {
    if (source === 'local') return 'warning';
    if (source === 'registry') return 'info';
    return 'outline';
};


export const getLocalCatalogEntry = (builtin) => {
    const manifest = builtin.manifest || {};

    return {
        key: `local:${builtin.slug}`,
        source: 'local',
        sourceLabel: 'Built-in',
        sourceDetail: 'Bundled with ServerKit',
        installKey: builtin.slug,
        displayName: manifest.display_name || builtin.slug,
        description: manifest.description || t('app.marketplace.bundledExtension', 'Bundled extension.'),
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

export const catalogEntryMatches = (entry, search, category) => {
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
