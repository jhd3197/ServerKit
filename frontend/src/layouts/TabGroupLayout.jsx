import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { PageTopbar } from '@/components/ds';
import { useContributions } from '@/plugins/contributions';
import { sanitizeSvgInner } from '@/utils/sanitizeSvg';
import { translateLabel } from '@/i18n/labels';
import { useExtensionUpdates } from '@/hooks/useExtensionUpdates';

// Generic shell for a PageTopbar tab group (Servers, Domains, Services, Files,
// Monitoring, Marketplace, …). A parent route renders the PageTopbar + routed
// sub-nav ONCE and swaps only the content below, so the tabs behave like real
// tabs — no full-page remount — and the matching sidebar item stays lit (see
// sidebarItems.js `matchPrefixes`). Child pages render no top bar of their own;
// they publish their own top-bar actions via the useTopbarActions() hook.
//
//   <Route element={<TabGroupLayout tabs={DOMAIN_TABS} />}>
//       <Route path="domains" element={<Domains />} />
//       <Route path="dns" element={<DNSZones />} />
//       <Route path="ssl" element={<SSLCertificates />} />
//   </Route>
//
// Groups that accept extension-contributed tabs (#43) also pass a `groupId`
// (== the group's sidebar item id): installed extensions can then add entries
// to the strip via a `tabs` contribution, paired with `group`-nested routes
// mounted by App.jsx inside this same parent <Route>.
function matchTab(tab, path) {
    if (tab.end) return path === tab.to;
    // Segment-aware so "/fleet" doesn't swallow "/fleet-monitor".
    return path === tab.to || path.startsWith(tab.to + '/');
}

// Contributed tab icons arrive as raw inner-SVG markup (same convention as
// sidebar nav icons); wrap them in the lucide-compatible svg shell the core
// tab entries use.
function contributedIcon(inner) {
    if (!inner) return null;
    return (
        <svg
            width={15}
            height={15}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            dangerouslySetInnerHTML={{ __html: sanitizeSvgInner(inner) }}
        />
    );
}

export default function TabGroupLayout({ tabs, groupId }) {
    const { t: translate } = useTranslation();
    const location = useLocation();
    const [actions, setActions] = useState(null);
    // Two slots, not one. `actions` is the page's ("Add domain") and comes up
    // through state; `chrome` is the table's (search · filter · "⋮") and is
    // PORTALED into the empty div below by whatever renders the table — often a
    // shared wrapper, which must not clobber the page's actions to get its two
    // icons into the bar. The chrome goes through the DOM rather than through
    // state because the node closes over values that change identity every
    // render, and pushing that upward is an infinite render loop. See
    // useTopbarChrome.
    const [chromeSlot, setChromeSlot] = useState(null);
    const { tabs: contributedTabs } = useContributions();
    // Tab `badge` keys resolve to counts here (hook called unconditionally;
    // `enabled` keeps groups without an updates badge from fetching).
    const updates = useExtensionUpdates({ enabled: (tabs || []).some((tab) => tab?.badge === 'updates') });

    const outletContext = useMemo(
        () => ({ setTopbarActions: setActions, topbarChromeSlot: chromeSlot, hasTopbarChrome: true }),
        [chromeSlot],
    );

    // Merge extension-contributed tabs for this group into the strip.
    // Dedup by `to` (core wins); optional numeric `order` picks the
    // insertion index, default appends at the end.
    const mergedTabs = useMemo(() => {
        const coreTabs = (Array.isArray(tabs) ? tabs : [])
            .filter((tab) => tab && typeof tab.to === 'string' && tab.to.length > 0)
            .map((tab) => ({
                ...tab,
                label: translateLabel(translate, tab),
                badgeCount: tab.badge === 'updates' ? updates.count : undefined,
            }));

        if (!groupId) return coreTabs;
        const extras = (contributedTabs || [])
            .filter((tab) => tab && tab.group === groupId && tab.to && tab.label)
            .filter((tab) => !coreTabs.some((core) => core.to === tab.to))
            .map((tab) => ({
                to: tab.to,
                // An extension tab may declare `labelKey` beside `label`;
                // core tabs already do. Same resolver either way.
                label: translateLabel(translate, tab),
                end: !!tab.end,
                icon: contributedIcon(tab.icon),
                order: tab.order,
            }));
        if (!extras.length) return coreTabs;
        const merged = [...coreTabs];
        for (const extra of extras) {
            const { order, ...tab } = extra;
            const idx = Number.isInteger(order)
                ? Math.min(Math.max(order, 0), merged.length)
                : merged.length;
            merged.splice(idx, 0, tab);
        }
        return merged;
    }, [tabs, groupId, contributedTabs, translate, updates.count]);

    // The group renders no page title: the tab strip IS the heading, so it runs
    // flush-left in the bar (the active tab already names the section, as does
    // the lit sidebar item). The active tab is still resolved to label the nav
    // for assistive tech.
    const active = useMemo(
        () => mergedTabs.find((t) => matchTab(t, location.pathname)) || mergedTabs[0],
        [mergedTabs, location.pathname]
    );

    return (
        <div className="page-container page-container--full-bleed sk-tabgroup">
            <PageTopbar
                navLabel={active?.label || translate('common.page', 'Page')}
                tabs={mergedTabs}
                actions={<>{actions}<span className="sk-topbar__chrome" ref={setChromeSlot} /></>}
            />
            <div className="sk-tabgroup__content">
                <Outlet context={outletContext} />
            </div>
        </div>
    );
}
