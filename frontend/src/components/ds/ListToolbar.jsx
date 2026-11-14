import { cn } from '@/lib/utils';

// The one list toolbar. Every list page used to hand-roll its own header row
// (.dom-listhead, .cron-listhead, .bk-listhead, .servers-listhead,
// .incidents-listhead, .wp-list__toolbar…) — same anatomy, a dozen names.
// This component is the anatomy:
//
//   [title?] [filters] [children]                 [tools?]
//
//   <ListToolbar
//     title="Cron jobs"                          // optional section title
//     filters={<SegControl … />}                 // primary quick filters, left
//   >
//     {/* optional extras between filters and the right group (e.g. a select) */}
//   </ListToolbar>
//
// Placement rule (scripts/check-list-chrome.mjs): a table gets ONE row of
// chrome — the GridViewPicker line. Filters, fields and the table tools are
// entries in that selector's menu; search rides the page's top bar. This
// toolbar is for what is left: a quick-filter segment, a scope select, a
// checkbox. A page with none of those renders no toolbar at all.
//
// `count` is DEPRECATED and has no core render site. It held a row count that
// the view line above and the table footer below both already reported — the
// same number three times, on the pages that had it. The footer is the one that
// sits next to the rows it counts. Kept only so an extension passing it does not
// crash; drop it on the next SDK major.
export function ListToolbar({ title, filters, count, tools, children, className }) {
    return (
        <div className={cn('sk-listhead', className)}>
            {title && <h2 className="sk-listhead__title">{title}</h2>}
            {filters}
            {children}
            {(count || tools) && (
                <div className="sk-listhead__right">
                    {count && <span className="sk-listhead__count">{count}</span>}
                    {tools}
                </div>
            )}
        </div>
    );
}

export default ListToolbar;
