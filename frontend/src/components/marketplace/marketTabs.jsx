import { Puzzle, PackageCheck, Download, ChefHat, ArrowUpCircle } from 'lucide-react';

// Shared sub-nav for the Extensions page group (Library / Installed / Updates /
// Recipes / Downloads). Rendered by TabGroupLayout in the shared top bar. Installed
// and Updates are real routes so they deep-link. `badge: 'updates'` is resolved
// to a count by TabGroupLayout; `iconOnlyNarrow` shows only the active tab's label on phones so
// every tab (and the Updates badge) fits without falling into "More".
export const MARKET_TABS = [
    { to: '/extensions', labelKey: 'app.marketTabs.library', label: 'Library', end: true, icon: <Puzzle size={15} />, iconOnlyNarrow: true },
    { to: '/extensions/installed', labelKey: 'app.marketTabs.installed', label: 'Installed', icon: <PackageCheck size={15} />, iconOnlyNarrow: true },
    { to: '/extensions/updates', labelKey: 'app.marketTabs.updates', label: 'Updates', icon: <ArrowUpCircle size={15} />, badge: 'updates', iconOnlyNarrow: true },
    { to: '/extensions/recipes', labelKey: 'app.marketTabs.recipes', label: 'Recipes', icon: <ChefHat size={15} />, iconOnlyNarrow: true },
    { to: '/downloads', labelKey: 'app.marketTabs.downloads', label: 'Downloads', icon: <Download size={15} />, iconOnlyNarrow: true },
];
