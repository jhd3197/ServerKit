import { useState, useCallback, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useOverflowItems } from '@/hooks/useOverflowItems';
import { t } from '@/i18n/t';
import { Button as SharedButton } from '@/components/ui/button';

// The demo's page top bar (see docs/REDESIGN_MAP.md §6 decision 3): infra pages
// carry their own top bar — an icon + title, an optional routed sub-nav that
// replaces sidebar sub-menus, a spacer, and right-aligned actions.
//
//   <PageTopbar icon={<Globe/>} title="Domains"
//       tabs={[{ to:'/domains', label:'Domains', end:true }, { to:'/dns', label:'DNS Zones' }]}
//       actions={<Button>Add domain</Button>} />
//
// Omitting `title` (what TabGroupLayout does) drops the title block entirely and
// runs the tabs flush-left as the bar's primary navigation — the section is
// already named by the lit sidebar item and the active tab, so repeating it as a
// heading only pushed the tabs off the left edge. Entity pages that DO pass a
// title (ServiceDetail, WordPressDetail, …) keep it: there the title names
// *which* entity you are on, which nothing else in the bar says. Pass
// `navLabel` to name the nav for assistive tech when there is no title.
export function PageTopbar({ icon, title, meta, tabs, actions, className, navLabel }) {
    const hasTabs = tabs && tabs.length > 0;
    const hasTitle = !!title;
    return (
        <header className={cn('sk-topbar', !hasTitle && 'sk-topbar--titleless', className)}>
            {hasTitle && (
                <>
                    {icon && <span className="sk-topbar__ico">{icon}</span>}
                    <div className="sk-topbar__titles">
                        <h1 className="sk-topbar__title">{title}</h1>
                        {meta && <span className="sk-topbar__meta">{meta}</span>}
                    </div>
                </>
            )}

            {/* The tab nav grows to fill the bar; when there are more tabs than
                fit, the overflow collapses into a "More" menu (so groups with
                many sections — e.g. Security — stay on one row). Pages without
                tabs keep the plain spacer that pushes actions to the right. */}
            {hasTabs
                ? <TopbarTabs tabs={tabs} label={navLabel || title || t('common.page', 'Page')} />
                : <div className="sk-topbar__spacer" />}

            {actions && <div className="sk-topbar__actions">{actions}</div>}
        </header>
    );
}

function matchTab(tab, path) {
    if (tab.end) return path === tab.to;
    // Segment-aware so "/fleet" doesn't swallow "/fleet-monitor".
    return path === tab.to || path.startsWith(tab.to + '/');
}

// Routed sub-nav with overflow handling. Tabs that don't fit the available width
// are hidden and surfaced through a trailing "More" popover via useOverflowItems.
function TopbarTabs({ tabs, label }) {
    const location = useLocation();
    const [popoverOpen, setPopoverOpen] = useState(false);
    const safeTabs = useMemo(
        () => (Array.isArray(tabs) ? tabs : []).filter(
            (tab) => tab && typeof tab.to === 'string' && tab.to.length > 0
        ),
        [tabs]
    );

    const activeIndex = useMemo(
        () => safeTabs.findIndex((tab) => matchTab(tab, location.pathname)),
        [safeTabs, location.pathname]
    );

    const getActiveIndex = useCallback(() => activeIndex, [activeIndex]);

    const { containerRef, itemRefs, moreBtnRef, hiddenIndices, hiddenSet } = useOverflowItems({
        count: safeTabs.length,
        gap: 2,
        moreWidth: 56,
        getActiveIndex,
        deps: [activeIndex],
    });

    return (
        // The nav is the flex-fill measurement region (kept right-aligned so a
        // changing page title never shoves the tabs sideways); the inner bar is
        // the visible segmented control that actually holds the tabs.
        <nav ref={containerRef} className="sk-topbar__tabs" aria-label={t('app.pageTopbar.sections', '{{label}} sections', { label })}>
            <div className="sk-topbar__tabs-inner">
                {safeTabs.map((tab, i) => {
                    const isHidden = hiddenSet.has(i);
                    return (
                        <NavLink
                            key={tab.to}
                            to={tab.to}
                            end={tab.end}
                            ref={(el) => { itemRefs.current[i] = el; }}
                            className={({ isActive }) => cn('sk-topbar__tab', isActive && 'is-active', isHidden && 'is-hidden')}
                            data-overflow={isHidden ? 'hidden' : undefined}
                        >
                            {tab.icon}
                            {tab.label}
                        </NavLink>
                    );
                })}
                {hiddenIndices.length > 0 && (
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                        <PopoverTrigger asChild>
                            <SharedButton variant="unstyled"
                                ref={moreBtnRef}
                                type="button"
                                className="sk-topbar__tab sk-topbar__more"
                                aria-label={t('common.moreSections', 'More sections')}
                            >
                                <MoreHorizontal size={16} />
                                {t('common.more', 'More')}
                            </SharedButton>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={6} className="ui-popover-content">
                            <div className="tabs-overflow-list">
                                {hiddenIndices.map((idx) => {
                                    const tab = safeTabs[idx];
                                    if (!tab) return null;
                                    return (
                                        <NavLink
                                            key={tab.to}
                                            to={tab.to}
                                            end={tab.end}
                                            className="tabs-overflow-item"
                                            data-state={idx === activeIndex ? 'active' : 'inactive'}
                                            onClick={() => setPopoverOpen(false)}
                                        >
                                            {tab.icon}
                                            {tab.label}
                                        </NavLink>
                                    );
                                })}
                            </div>
                        </PopoverContent>
                    </Popover>
                )}
            </div>
        </nav>
    );
}

export default PageTopbar;
