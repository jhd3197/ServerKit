import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { PageTopbar } from '@/components/ds';
import { PageTopbarContext } from '@/hooks/useTopbarActions';

// Shell for a STANDALONE page — one that owns its whole route rather than
// living inside a PageTopbar tab group. It is the exact same frame
// TabGroupLayout gives a group (see layouts/TabGroupLayout.jsx): the top bar
// pins flush to the top of the content region edge-to-edge, and the body
// scrolls beneath it, centered at the reading max-width.
//
//   <PageLayout icon={<Clock size={18} />} title="Cron Jobs" actions={…}>
//       …page body…
//   </PageLayout>
//
// Rendering a PageTopbar inside the default padded `.page-container` instead
// (what every standalone page used to do by hand) leaves the bar floating in
// the middle of the content well with a gutter on every side — it carries the
// sidebar's surface and a bottom border precisely because it is meant to be
// chrome pinned to the frame, not the first row of the page body.
//
// Sections inside the page can publish into its bar with useListTopbar /
// useTopbarActions, the same way a tab-group page does: what they publish
// renders after `actions`, so a page-wide button (Prune) stays put while the
// create button and search follow the active section.
//
// `fill` hands the body the whole region to manage its own scrolling (log
// consoles, file trees, terminals); the default centers and pads it.
export default function PageLayout({
    icon,
    title,
    meta,
    tabs,
    navLabel,
    actions,
    fill = false,
    className,
    topbarClassName,
    contentClassName,
    children,
}) {
    const [published, setPublished] = useState(null);
    const host = useMemo(() => ({ setTopbarActions: setPublished }), []);
    const barActions = actions || published ? <>{actions}{published}</> : null;

    return (
        <PageTopbarContext.Provider value={host}>
        <div className={cn('page-container page-container--full-bleed sk-pageshell', className)}>
            <PageTopbar
                className={topbarClassName}
                icon={icon}
                title={title}
                meta={meta}
                tabs={tabs}
                navLabel={navLabel}
                actions={barActions}
            />
            <div className="sk-pageshell__content">
                {fill ? (
                    <div className={cn('sk-pageshell__fill', contentClassName)}>{children}</div>
                ) : (
                    <div className={cn('sk-pageshell__inner', contentClassName)}>{children}</div>
                )}
            </div>
        </div>
        </PageTopbarContext.Provider>
    );
}
