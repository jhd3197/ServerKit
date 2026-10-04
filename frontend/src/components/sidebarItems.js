import { SERVER_TABS } from './servers/serverTabs';
import { DOMAIN_TABS } from './domains/domainTabs';
import { SERVICE_TABS } from './services/serviceTabs';
import { FILE_TABS } from './files/fileTabs';
import { MONITOR_TABS } from './monitoring/monitorTabs';
import { MARKET_TABS } from './marketplace/marketTabs';
import { ORG_TABS } from './organization/organizationTabs';

// Path prefixes for a tab group, used to keep the group's sidebar item lit
// across all its tabs (e.g. Servers stays active on /fleet, /cloud, …).
const groupPrefixes = (tabs) => tabs.map((t) => t.to);

// Sidebar navigation items definition
// Items with subItems render as collapsible groups (collapsed by default)
// The 'dashboard' item is always visible and cannot be hidden

export const SIDEBAR_CATEGORIES = ['overview', 'infrastructure', 'operations', 'system'];

// Category headings. Key and English default sit in ONE object per category:
// two parallel maps (labels here, keys there) are not sibling properties, so
// the extractor cannot pair them and the keys never reach en.json -- which is
// exactly how these headings stayed English in every locale until the locale
// probe caught it.
//
// Keys resolve at RENDER, not at import: a label translated at module load
// would translate once and never follow a locale switch (plan 79 §E).
export const SIDEBAR_CATEGORY_LABELS = {
    overview: { labelKey: 'nav.category.overview', label: 'Overview' },
    infrastructure: { labelKey: 'nav.category.infrastructure', label: 'Infrastructure' },
    operations: { labelKey: 'nav.category.operations', label: 'Operations' },
    system: { labelKey: 'nav.category.system', label: 'System' }
};

// Plain English map, for the few callers that only need a string.
export const CATEGORY_LABELS = Object.fromEntries(
    Object.entries(SIDEBAR_CATEGORY_LABELS).map(([key, entry]) => [key, entry.label]),
);

export const SIDEBAR_ITEMS = [
    {
        id: 'dashboard',
        labelKey: 'nav.dashboard',
        label: 'Dashboard',
        route: '/',
        category: 'overview',
        alwaysVisible: true,
        end: true,
        icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
    },
    {
        // "Organization" groups the cross-cutting features that structure work
        // across a team/account — Projects, Shared Variables, and Workspaces.
        // Like every other group (Servers, Domains, …) it uses the top-bar tab
        // layout, NOT a collapsible sidebar sub-menu: the sub-nav lives in the
        // page's PageTopbar (ORG_TABS via TabGroupLayout). matchPrefixes keeps
        // the single sidebar item lit across all three routes.
        id: 'organization',
        labelKey: 'nav.organization',
        label: 'Organization',
        route: '/projects',
        matchPrefixes: groupPrefixes(ORG_TABS),
        category: 'overview',
        icon: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>',
    },
    {
        // Redesign: Servers uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // Its Agent Fleet / Fleet Proxy / Cloud Servers / Config Templates
        // sub-nav now lives in the page's top bar (PageTopbar SERVER_TABS), not
        // as sidebar sub-items. Routes /fleet, /fleet-proxy, /cloud,
        // /server-templates are unchanged and reachable from those tabs.
        // (Fleet Monitor left this group for /monitoring.)
        id: 'servers',
        labelKey: 'nav.servers',
        label: 'Servers',
        route: '/servers',
        // Keep "Servers" lit across the whole tab group (Agent Fleet, Fleet
        // Proxy, Cloud Servers, Config Templates) — see serverTabs.jsx.
        matchPrefixes: groupPrefixes(SERVER_TABS),
        category: 'infrastructure',
        icon: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>'
    },
    {
        // Redesign: Domains is migrated to the top-bar layout (REDESIGN_MAP §6
        // decision 3). Its DNS Zones + SSL sub-nav now lives in the page's top
        // bar (PageTopbar tabs), not as sidebar sub-items. Routes /dns and /ssl
        // are unchanged and still reachable from those tabs.
        id: 'domains',
        labelKey: 'nav.domains',
        label: 'Domains',
        route: '/domains',
        matchPrefixes: groupPrefixes(DOMAIN_TABS),
        category: 'infrastructure',
        icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
    },
    {
        // Redesign: Services uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // New Service / Templates / Deploy Activity now live in the page's top
        // bar (PageTopbar SERVICE_TABS), not as sidebar sub-items. Routes
        // /services/new, /templates, /deployments are unchanged.
        id: 'services',
        labelKey: 'nav.services',
        label: 'Services',
        route: '/services',
        matchPrefixes: groupPrefixes(SERVICE_TABS),
        category: 'infrastructure',
        icon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
    },
    // WordPress is the standalone serverkit-wordpress extension (plan 52
    // Phase 5 — registry-installed, offered in the setup wizard);
    // its sidebar item is contributed by the extension manifest (nav), so it
    // disappears cleanly when the extension is uninstalled.
    // Automations (tramo) is the standalone serverkit-tramo extension (own repo,
    // registry-installed) that replaced the old Workflow Builder; its sidebar
    // item comes from the extension manifest.
    {
        id: 'databases',
        labelKey: 'nav.databases',
        label: 'Databases',
        route: '/databases',
        category: 'infrastructure',
        icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
    },
    {
        id: 'docker',
        labelKey: 'nav.docker',
        label: 'Docker',
        route: '/docker',
        category: 'infrastructure',
        icon: '<rect x="2" y="7" width="6" height="6" rx="1"/><rect x="9" y="7" width="6" height="6" rx="1"/><rect x="16" y="7" width="6" height="6" rx="1"/><rect x="2" y="14" width="6" height="6" rx="1"/><rect x="9" y="14" width="6" height="6" rx="1"/>'
    },
    // NOTE: "Git" appears under Infrastructure too, but it is contributed by the
    // built-in serverkit-git PLUGIN (see plugins/contributions.js), which also
    // registers the /git route. Keeping it plugin-owned means it correctly
    // disappears (no dead link) when the plugin is disabled — so do NOT add a
    // core 'git' item here. Sidebar presets that list 'git' still hide the
    // plugin's nav item via getHiddenItemIds().
    {
        // Redesign: Files uses the top-bar layout (REDESIGN_MAP §6 decision 3).
        // FTP Server now lives in the page's top bar (PageTopbar FILE_TABS), not
        // as a sidebar sub-item. Route /ftp is unchanged, reachable from the tab.
        id: 'files',
        labelKey: 'nav.files',
        label: 'Files',
        route: '/files',
        matchPrefixes: groupPrefixes(FILE_TABS),
        category: 'operations',
        icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
    },
    {
        // Redesign: Monitoring uses the top-bar layout (REDESIGN_MAP §6 dec. 3).
        // Its sections (Overview / Monitors / Incidents / Rules / Capacity /
        // Events / Jobs / Doctor) share the top bar (PageTopbar MONITOR_TABS);
        // the sidebar entry lights for any of them via matchPrefixes. Events
        // absorbed the old standalone Telemetry and Jobs the old top-level Jobs
        // page. Labelled "Monitoring" to match the route and the page — this
        // used to say "Observability", which named the same thing twice.
        id: 'monitoring',
        labelKey: 'nav.monitoring',
        label: 'Monitoring',
        route: '/monitoring',
        matchPrefixes: groupPrefixes(MONITOR_TABS),
        category: 'operations',
        icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'
    },
    {
        id: 'backups',
        labelKey: 'nav.backups',
        label: 'Backups',
        route: '/backups',
        category: 'operations',
        icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
    },
    {
        id: 'cron',
        labelKey: 'nav.cron',
        label: 'Cron jobs',
        route: '/cron',
        category: 'operations',
        icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
    },
    {
        id: 'security',
        labelKey: 'nav.security',
        label: 'Security',
        route: '/security',
        category: 'operations',
        icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4m0 4h.01"/>'
    },
    // Email Server is now the serverkit-email builtin extension; its sidebar item
    // is contributed by the extension manifest.
    {
        id: 'queue',
        labelKey: 'nav.queue',
        label: 'Queue bus',
        route: '/queue',
        category: 'operations',
        icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
    },
    {
        id: 'terminal',
        labelKey: 'nav.terminal',
        label: 'Terminal / logs',
        route: '/terminal',
        category: 'system',
        icon: '<path d="M4 17l6-6-6-6M12 19h8"/>'
    },
    // Jobs is a Monitoring tab now (/monitoring/jobs), not a top-level page: it
    // is the same class of thing as Events and the two read as rival pages when
    // one sat in the sidebar and the other inside the group. /jobs redirects.
    // GPU Monitor lives in the standalone serverkit-gpu extension (own repo,
    // registry-installed); its sidebar item (still gated on gpuAvailable via
    // requiresCondition) is contributed by the extension manifest.
    // The inbound-webhook console is no longer a sidebar page: it's server
    // configuration, so it lives at Settings → Admin → Webhooks alongside the
    // outbound notification subscriptions. /webhooks redirects there.
    // Test Sandbox (admin distro-matrix test console) is not a sidebar item
    // either — it lives in the dev-only "Dev Tools" section in Sidebar.jsx,
    // gated on the same useDevMode flag as its route guard.
    {
        // Redesign: Marketplace uses the top-bar layout (REDESIGN_MAP §6 dec. 3).
        // Downloads now lives in the page's top bar (PageTopbar MARKET_TABS), not
        // as a sidebar sub-item. Route /downloads is unchanged.
        id: 'marketplace',
        labelKey: 'nav.marketplace',
        label: 'Extensions',
        route: '/extensions',
        matchPrefixes: groupPrefixes(MARKET_TABS),
        category: 'system',
        // Always visible, like Dashboard — Extensions is the front door to
        // extensions, so no onboarding preset (or custom config) should hide it.
        alwaysVisible: true,
        icon: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>'
    }
];

// "Advanced" items are powerful but not part of the everyday core for a solo
// dev / small team — currently the internal job-queue console. They're hidden by
// the default ("Recommended") view and every curated preset, but stay one click
// away via the "Full" view or Customize Sidebar — and remain fully routable
// (deep links, command palette). The Marketplace is NOT in this list — it's
// alwaysVisible so extensions are always discoverable. ("webhooks" left this
// list when the console moved into Settings → Admin.)
export const ADVANCED_ITEM_IDS = ['queue'];

// Preset profiles define which items are hidden (top-level only)
export const SIDEBAR_PRESETS = {
    recommended: {
        labelKey: 'nav.preset.recommended.label',
        label: 'Recommended',
        descriptionKey: 'nav.preset.recommended.description',
        description: 'Everyday essentials, with advanced tools hidden',
        hiddenItems: [...ADVANCED_ITEM_IDS]
    },
    full: {
        labelKey: 'nav.preset.full.label',
        label: 'Full',
        descriptionKey: 'nav.preset.full.description',
        description: 'All sidebar items visible',
        hiddenItems: []
    },
    web: {
        labelKey: 'nav.preset.web.label',
        label: 'Web hosting',
        descriptionKey: 'nav.preset.web.description',
        description: 'Domains, SSL, databases, and web essentials',
        hiddenItems: ['docker', 'git', 'workflow', 'email', ...ADVANCED_ITEM_IDS]
    },
    email: {
        labelKey: 'nav.preset.email.label',
        label: 'Email admin',
        descriptionKey: 'nav.preset.email.description',
        description: 'Email server, security, DNS, and monitoring',
        hiddenItems: ['services', 'workflow', 'databases', 'docker', 'git', 'cron', ...ADVANCED_ITEM_IDS]
    },
    devops: {
        labelKey: 'nav.preset.devops.label',
        label: 'Docker / DevOps',
        descriptionKey: 'nav.preset.devops.description',
        description: 'Docker, Git, monitoring, and CI/CD tools',
        hiddenItems: ['email', ...ADVANCED_ITEM_IDS]
    },
    minimal: {
        labelKey: 'nav.preset.minimal.label',
        label: 'Minimal',
        descriptionKey: 'nav.preset.minimal.description',
        description: 'Core only, without databases, containers, or scheduling',
        hiddenItems: ['workflow', 'databases', 'docker', 'git', 'email', 'cron', ...ADVANCED_ITEM_IDS]
    }
    // Note: no 'wordpress' literal — its nav item is contributed by the
    // serverkit-wordpress extension manifest (plan 52 Phase 4), so presets
    // don't hardcode an extension's id; uninstalled = absent.
};

// Map the Setup wizard's "use case" selections to an initial sidebar preset, so
// a fresh install opens tailored instead of showing every item. This is only the
// *suggestion* the Summary step pre-selects — the user can override it there (or
// later in Settings), so this deliberately stays coarse rather than trying to
// reach all six profiles from four intent checkboxes.
//
// The rule is "does one family of work dominate?": a purely WordPress install
// gets the web-hosting view, an install that is only container/CI work gets the
// DevOps view, and anything mixed falls back to the lean "Recommended" baseline
// (which still surfaces the common pages).
export function presetForUseCases(useCases = []) {
    const set = new Set((useCases || []).filter(Boolean));
    if (set.size === 0) return 'recommended';

    // Only WordPress → web hosting (Docker/Git/email hidden).
    if (set.size === 1 && set.has('wordpress')) return 'web';

    // Container/CI work with no WordPress in the mix → DevOps.
    const devopsIntents = ['web-apps', 'devops'];
    const everyIntentIsDevops = [...set].every((id) => devopsIntents.includes(id));
    if (everyIntentIsDevops) return 'devops';

    return 'recommended';
}

// Number of core sidebar items a preset leaves visible. Used by the Setup
// wizard to describe a profile ("14 of 18 items") before the user commits.
// Counts core items only — extension-contributed nav (WordPress, Git, Email)
// isn't resolvable until those extensions are installed.
export function visibleCountForPreset(presetKey) {
    const hidden = new Set(SIDEBAR_PRESETS[presetKey]?.hiddenItems || []);
    return SIDEBAR_ITEMS.filter(
        (item) => item.alwaysVisible || !hidden.has(item.id)
    ).length;
}

export function getHiddenItemIds(sidebarConfig) {
    const { preset = 'recommended', hiddenItems = [] } = sidebarConfig || {};

    const hidden = preset === 'custom'
        ? hiddenItems
        : (SIDEBAR_PRESETS[preset]?.hiddenItems || []);

    return new Set(hidden);
}

// Get visible items based on config
export function getVisibleItems(sidebarConfig) {
    const hidden = getHiddenItemIds(sidebarConfig);

    return SIDEBAR_ITEMS.filter(item =>
        item.alwaysVisible || !hidden.has(item.id)
    );
}

/**
 * Apply workspace-level nav permissions. A workspace can define
 * `settings.nav = { admin: ['servers', 'domains', ...], member: ['domains'], ... }`
 * to restrict which sidebar items are visible per effective workspace role.
 * Items marked `alwaysVisible` (e.g. Dashboard) are never hidden.
 */
export function applyWorkspaceNavPermissions(items, workspace, user) {
    if (!workspace?.settings?.nav) return items;
    // Super-admins bypass workspace nav restrictions so they can manage the
    // workspace itself without getting locked out.
    if (user?.is_admin) return items;
    const role = workspace.my_effective_role || workspace.my_role || 'member';
    const allowedIds = workspace.settings.nav[role];
    if (!Array.isArray(allowedIds) || allowedIds.length === 0) return items;
    const allowed = new Set(allowedIds);
    return items.filter(item => item.alwaysVisible || allowed.has(item.id));
}

// ---------------------------------------------------------------------------
// Managed profile (ServerKit Cloud, plan 25)
//
// The one table mapping a held managed capability to the sidebar ids it
// removes, the route prefixes whose pages render the managed card, and the
// in-page controls that collapse — re-exported here because this module is
// where the mapping is read alongside the items it hides. The table itself
// lives in ./managedCapabilities.js, which stays dependency-free so the drift
// guard (routes/__tests__/managedProfile.test.mjs) can import it under plain
// node. Hidden is not removed: every route stays registered and every API
// keeps answering.
export {
    MANAGED_CAPABILITY_MAP,
    managedSidebarIds,
    managedCapabilityForPath,
    managedControlHeld,
} from './managedCapabilities';
