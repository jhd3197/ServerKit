import { Children, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button as SharedButton } from '@/components/ui/button';

// KpiBand — the one responsive grid wrapper for KPI/stat tiles (design-system
// primitive, plan 20). Lays a row of <MetricCard> tiles into a single grid so
// every page's summary strip shares the same spacing + collapse behaviour
// instead of ~20 hand-rolled `*-kpis` grids.
//
// Use it for EVERY row of tiles. A page that writes its own grid container is
// one stylesheet edit away from tiles stacked full-width, and that has now
// happened three times: twice when a rebuild dropped a `*-kpis` rule, and once
// on Git, which shipped `className="dom-kpis"` that no stylesheet ever defined,
// so the tiles were full-width blocks from the day it was written. There is
// nothing to lose here — the grid is declared once, in _design-system.scss.
//
// Props:
//   dense    — compact 5-column variant (tighter gap).
//   max      — how many tiles stay "primary" before folding (default 4, hard
//              capped at 5). Order is priority: children past `max` — or any
//              child flagged `secondary` — fold into a disclosed compact strip.
//   loading  — render `count` skeleton tiles matching the grid geometry.
//   count    — skeleton tile count (default 4).
//   className — applied to the grid element (pages style the tile container,
//              e.g. security's `.sec-posture__kpis`).
//
// The fold is a disclosure, not persisted state: a real <button> carrying
// `aria-expanded` toggles an inline strip of the folded tiles (value + label,
// no icon). A dev-only warning fires past 8 children — the signal a page is
// dumping counters instead of choosing the few KPIs that drive action.
export function KpiBand({
    dense = false,
    max = 4,
    loading = false,
    count = 4,
    className,
    children,
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const cap = Math.min(dense ? 5 : max, 5);

    if (loading) {
        const cols = Math.min(count, 5) || 1;
        return (
            <div className="sk-kpiband-wrap">
                <div
                    className={cn('sk-kpiband', dense && 'sk-kpiband--dense', className)}
                    style={{ '--kpi-cols': cols }}
                >
                    {Array.from({ length: count }).map((_, i) => (
                        <div key={i} className="sk-kpiband__skel" aria-hidden="true" />
                    ))}
                </div>
            </div>
        );
    }

    const items = Children.toArray(children).filter(Boolean);

    if (import.meta.env.DEV && items.length > 8) {
        console.warn(
            `[KpiBand] received ${items.length} tiles — that's a lot of KPIs. ` +
            'Pick the few that drive action and fold or drop the rest.'
        );
    }

    // Order is priority. The first `cap` tiles that are not force-folded stay
    // primary; everything else (past the cap, or flagged `secondary`) folds.
    const primary = [];
    const secondary = [];
    items.forEach((child) => {
        const forced = child?.props?.secondary;
        if (!forced && primary.length < cap) primary.push(child);
        else secondary.push(child);
    });

    const cols = Math.min(primary.length, cap) || 1;

    return (
        <div className="sk-kpiband-wrap">
            <div
                className={cn('sk-kpiband', dense && 'sk-kpiband--dense', className)}
                style={{ '--kpi-cols': cols }}
            >
                {primary}
            </div>

            {secondary.length > 0 && (
                <>
                    <SharedButton variant="unstyled"
                        type="button"
                        className="sk-kpiband__more"
                        aria-expanded={expanded}
                        onClick={() => setExpanded((v) => !v)}
                    >
                        {expanded
                            ? t('app.kpiBand.fewerStats', 'Fewer stats')
                            : t('app.kpiBand.moreStats', 'More stats ({{count}})', { count: secondary.length })}
                    </SharedButton>
                    {expanded && (
                        <div className="sk-kpiband__strip">
                            {secondary.map((child, i) => (
                                <div key={i} className="sk-kpiband__stripitem">
                                    <span className="sk-kpiband__stripval">
                                        {child?.props?.value}
                                        {child?.props?.unit && (
                                            <small> {child.props.unit}</small>
                                        )}
                                    </span>
                                    <span className="sk-kpiband__striplabel">
                                        {child?.props?.label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default KpiBand;
