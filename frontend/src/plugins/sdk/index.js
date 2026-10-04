/**
 * ServerKit Plugin SDK
 *
 * Re-exports the core building blocks plugins need so they don't have to
 * reach into deep host paths. Plugins should import from this entry only:
 *
 *     import { api, useToast, Button } from '../../sdk';
 *
 * If we ever rename or restructure the host, plugins keep working as
 * long as the SDK surface stays stable.
 *
 * What a plugin's frontend can ship:
 *
 *   index.js / index.jsx           — main module, exports named React
 *                                    components matched by `component`
 *                                    references in the manifest's
 *                                    `contributions` block.
 *   plugin.json                    — copy of the manifest, written by the
 *                                    backend installer; included so Vite
 *                                    can read static metadata at build
 *                                    time if a plugin wants to.
 *   styles/*.scss|css|less         — auto-discovered and listed in
 *                                    plugins-manifest.json.
 *
 * The host fetches /api/v1/plugins/contributions at runtime; each
 * contribution's `component` field is matched against the named exports
 * of this plugin's index module. A contribution with no matching export
 * is skipped (and logged in dev).
 */

// The SDK compatibility contract. Bump this (semver) whenever the exported
// surface below changes in a way extensions can observe:
//   MAJOR — a removed/renamed export or a breaking signature change.
//   MINOR — a new export added (older extensions keep working).
//   PATCH — a non-surface fix.
// Extensions pin a compatible range in plugin.json (`sdk_version`, e.g. "^1.0.0"),
// checked at install (manifest lint) and reported at runtime via
// GET /api/v1/plugins/contributions. The backend mirror lives in
// backend/app/utils/sdk.py — keep the two in lock-step (asserted by
// backend/tests/test_sdk_contract.py).
export const SDK_VERSION = '1.6.0';

export { api, default as defaultApi } from '../../services/api';

// Design-system primitives — the sanctioned building blocks for plugin pages.
// A plugin page should look like a core page: PageTopbar + KpiBand +
// DataTable/ResourceList. Extensions previously deep-imported '@/components/ds'
// (still works, same modules); this is the blessed surface (Plan 20 Decision 4).
export {
    KpiBand,
    MetricCard,
    Gauge,
    ScoreGauge,
    Sparkline,
    Pill,
    EnvTag,
    SegControl,
    ServiceTile,
    PageTopbar,
    DataTable,
    ResourceCard,
    ResourceList,
    CatalogCard,
    CatalogGrid,
    Drawer,
} from '../../components/ds';

// One field per job (SDK 1.6). An extension asking for a server, a domain, a
// host port, env rows or a value to copy uses these, so it looks and checks
// exactly like core: ServerPicker (value 'local' | server id), DomainField
// (subdomain of a managed base or own domain) + attachDomain, PortField
// (live free/taken check on host ports), EnvEditor ([{key, value}] rows),
// CopyField (secrets masked), InfoList/InfoItem (label/value rows).
export { default as ServerPicker } from '../../components/ServerPicker';
export { serverTarget, targetServerId, LOCAL_SERVER_ID } from '../../utils/serverTarget';
export { default as DomainField } from '../../components/DomainField';
export { attachDomain } from '../../services/attachDomain';
export { normalizeDomain, isValidDomain } from '../../utils/domains';
export { default as PortField } from '../../components/PortField';
export { default as EnvEditor } from '../../components/EnvEditor';
export { parseDotenv, envToObject, envFromObject } from '../../utils/dotenv';
export { default as CopyField } from '../../components/CopyField';
export { CopyButton } from '../../components/CopyButton';
export { InfoList, InfoItem } from '../../components/InfoList';

// Scheduling — extensions schedule things (cert windows, report runs, cleanup
// jobs) with the same friendly cron picker as core (Presets/Builder/Advanced +
// server-side preview). Props: value, onChange(cronString), presets?, compact?.
export { default as SchedulePicker } from '../../components/SchedulePicker';

// Common UI primitives plugins are likely to want. Re-exports kept thin
// on purpose — plugins can still reach for niche components directly,
// but the everyday surface lives here.
export { useToast } from '../../contexts/useToast.js';
export { useAuth } from '../../contexts/useAuth.js';
export { useTheme } from '../../contexts/useTheme.js';

// AI assistant — plugins consume the core assistant rather than building their
// own chat UI. `useServerkitAI()` exposes:
//   open() / close() / toggle() / isOpen
//   ask(prompt, { context?, mode?: 'assistant'|'simple', open?=true })
//   mode / setMode(mode)
//   registerContextProvider(routePattern, () => contextObj) -> unregister
//   registerToolRenderer(toolName, Component) -> unregister
//   isStreaming / providerConfigured
//
// Plugins can also declare contributions.ai = { suggested_prompts: [{route,label,prompt}],
// tool_renderers: [{tool, component}] } in plugin.json.
export { useServerkitAI, AIContext } from '../../contexts/useServerkitAI.js';

// Routing helpers — plugin pages need these to navigate within the SPA.
export {
    Link,
    NavLink,
    useNavigate,
    useLocation,
    useParams,
    Outlet,
} from 'react-router-dom';

// Layout + feedback primitives (plan 52 Phase 4 — the WordPress frontend
// relocation proved these out). Generic re-exports, same modules core pages
// use; an extension page should be able to mirror a core page's chrome
// (tab group, modal, confirm, empty/loading states) without deep imports.
export { default as TabGroupLayout } from '../../layouts/TabGroupLayout';
export { default as Modal } from '../../components/Modal';
export { ConfirmDialog } from '../../components/ConfirmDialog';
export { Spinner, LoadingState } from '../../components/Spinner';
export { default as EmptyState } from '../../components/EmptyState';
export { SkeletonBoundary } from '../../components/SkeletonBoundary';
export { Skeleton } from '../../components/Skeleton';

// Form primitives — the ui/* kit extensions reach for most.
export { Button } from '../../components/ui/button';
export { Input } from '../../components/ui/input';
export { Label } from '../../components/ui/label';
export { Switch } from '../../components/ui/switch';
export { Checkbox } from '../../components/ui/checkbox';
export { Textarea } from '../../components/ui/textarea';
export { Badge } from '../../components/ui/badge';
export {
    Select, SelectGroup, SelectValue, SelectTrigger, SelectContent,
    SelectLabel, SelectItem, SelectSeparator,
} from '../../components/ui/select';

// Common hooks.
export { useConfirm } from '../../hooks/useConfirm';
export { default as useTabParam } from '../../hooks/useTabParam';
export { useTopbarActions } from '../../hooks/useTopbarActions';

// Formatting utilities (canonical host implementations — no local copies).
export { formatBytes } from '../../utils/formatBytes';
export { timeAgo, formatRelativeTime, formatDuration } from '../../utils/time';

// Localization (plan 79). These are the HOST's singletons, not a parallel
// extension i18n: `useTranslation`/`Trans` resolve against the panel's own
// i18next instance (shared via vendorManifest), so an extension's copy follows
// the user's language, plural rules and locale switch with no wiring of its
// own. An extension ships its keys as inline defaults exactly like core —
// `t('myext.title', 'My Extension')` — so a missing bundle renders English
// rather than a raw key path.
export { useTranslation, Trans } from 'react-i18next';
export { t } from '../../i18n/t';
export { useLocale } from '../../contexts/useLocale.js';
export { translateLabel, default as useLabel } from '../../i18n/labels';

// The one locale-aware formatting door. An extension MUST NOT call
// `toLocaleDateString()` itself: with no argument it follows the browser, not
// the panel, so its dates would disagree with every date around them.
export { default as useFormat } from '../../hooks/useFormat';
export {
    formatDate, formatTime, formatDateTime, formatRelative,
    formatNumber, formatPercent, formatList,
} from '../../utils/intl';

// Generic page furniture + cross-feature embeds (plan 52 Phase 5 — the
// WordPress runtime-ESM extraction proved these out). Two consumer classes:
//   - generic primitives any extension page may need (ErrorBoundary,
//     DangerZone, ResourceAdvisory, ResourceListPage, the logs drawer, and
//     PluginSlot so an extension can itself host a slot);
//   - shared cross-feature embeds with ≥2 consumers (a git repo-connect form
//     used by both the Git and WordPress surfaces; the backups protection
//     panel embedded by both the Backups page and WordPress). Exposing them
//     here pins their props as SDK contract — change them accordingly.
export { default as ErrorBoundary } from '../../components/ErrorBoundary';
export { default as ErrorState } from '../../components/ErrorState';
export { DangerZone } from '../../components/DangerZone';
export { default as ResourceAdvisory } from '../../components/ResourceAdvisory';
export { default as PluginSlot } from '../../components/PluginSlot';
export { default as ResourceListPage } from '../../components/layouts/ResourceListPage';
export { useLogsDrawer } from '../../contexts/LogsDrawerContext';
export { default as RepoConnectForm } from '../../components/git/RepoConnectForm';
export { RepoProviderStrip } from '../../components/git/GitProviders';
export { GIT_PROVIDERS, detectProvider } from '../../components/git/gitProviderData';
export { default as ProtectionPanel } from '../../components/backups/ProtectionPanel';

// List-page chrome (1.4.0, plan 52 Phase 2 — the email/cloudflare-ops frontend
// relocations proved these out). The full table kit a relocated list page
// needs: the DataTable footer/toolbar pieces, the saved-view chrome from
// ds/grid, the standalone-page layout, and the two table hooks. Same modules
// core pages use — generic re-exports, no extension special-casing.
export {
    DataTableFooter, ListToolbar, SearchField, SortChipBar,
} from '../../components/ds';
export {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '../../components/ds/grid';
export {
    statusKind, statusVariant, statusDotClass, statusLabel,
} from '../../components/ds/status';
export { default as PageLayout } from '../../layouts/PageLayout';
export { useTableSort } from '../../hooks/useTableSort';
export { useColumnVisibility } from '../../hooks/useColumnVisibility';
export { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs';
export { PageLoader } from '../../components/PageLoader';
export { copyToClipboard } from '../../utils/clipboard';
export { downloadBlob } from '../../utils/downloadBlob';

// Declarative walkthrough authoring (1.5.0). Extensions normally contribute
// definitions through plugin.json; these exports power authoring tools,
// validation previews, and successful-action signals without exposing the
// walkthrough engine's internal state shape.
export {
    WALKTHROUGH_COMPLETION_TYPES,
    emitWalkthroughSignal,
    normalizeWalkthroughDefinition,
    validateWalkthroughDefinition,
} from '../../services/walkthroughRegistry';
export { useWalkthroughs } from '../../contexts/walkthroughContextValue';
