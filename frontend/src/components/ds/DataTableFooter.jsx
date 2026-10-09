import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegControl } from './SegControl';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

// Shared table footer — one standard way to answer "how much am I looking at
// and how do I see more", replacing the four ad-hoc pagers pages grew
// (Prev/Next labels, bare "Load more", server params, nothing).
//
// Client-side slicing:
//   <DataTableFooter shown={rows.length} total={rows.length}
//     pageSize={pageSize} onPageSizeChange={setPageSize} />
//
// Incremental loading (server or client):
//   <DataTableFooter shown={rows.length} total={total}
//     hasMore={hasMore} onLoadMore={loadMore} loading={loading} />
//
// Paged server data:
//   <DataTableFooter shown={rows.length} total={total}
//     page={page} totalPages={pages} onPageChange={setPage} />
export function DataTableFooter({
    shown,
    total,
    noun = 'row',
    // Explicit plural for the nouns a naive +"s" mangles — "5 processs",
    // "3 policys". Omit it wherever +"s" is already right.
    plural,
    // client-side page-size segment (omit to hide)
    pageSize,
    pageSizeOptions = [25, 50, 100],
    onPageSizeChange,
    // load-more mode
    hasMore = false,
    onLoadMore,
    loading = false,
    // paged mode
    page,
    totalPages,
    onPageChange,
    className,
}) {
    const { t } = useTranslation();
    const many = plural || `${noun}s`;
    const label = total == null || total === shown
        ? `${shown} ${shown === 1 ? noun : many}`
        : `Shown ${shown} of ${total} ${many}`;

    const paged = page != null && totalPages != null && onPageChange;

    // "25 · 50 · 100 · All" over three rows is a control with nothing to
    // control — every option shows the same three rows. Offer it only once the
    // table is longer than the smallest page it could cut to (or when a page
    // size is already pinned, so the way back to All never disappears).
    const smallestPage = Math.min(...pageSizeOptions);
    const worthPaging = (total ?? shown) > smallestPage || (pageSize != null && pageSize !== 'all');

    return (
        <div className={cn('sk-dtable-footer', className)}>
            <span className="sk-dtable-footer__count">{label}</span>
            <div className="sk-dtable-footer__controls">
                {onPageSizeChange && worthPaging && (
                    <SegControl
                        className="sk-dtable-footer__sizes"
                        value={String(pageSize)}
                        onChange={(value) => onPageSizeChange(value === 'all' ? 'all' : Number(value))}
                        options={[
                            ...pageSizeOptions.map((n) => ({ value: String(n), label: String(n) })),
                            { value: 'all', labelKey: 'common.labels.all', label: 'All' },
                        ]}
                        aria-label={t('app.dataTableFooter.rowsPerPage', 'Rows per page')}
                    />
                )}
                {onLoadMore && hasMore && (
                    <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
                        {loading ? t('common.loading', 'Loading…') : t('common.actions.loadMore', 'Load more')}
                    </Button>
                )}
                {paged && totalPages > 1 && (
                    <div className="sk-dtable-footer__pager">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => onPageChange(page - 1)}
                            disabled={page <= 1}
                            aria-label={t('app.dataTableFooter.previousPage', 'Previous page')}
                        >
                            <ChevronLeft aria-hidden="true" />
                        </Button>
                        <span className="sk-dtable-footer__page">
                            {page} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => onPageChange(page + 1)}
                            disabled={page >= totalPages}
                            aria-label={t('app.dataTableFooter.nextPage', 'Next page')}
                        >
                            <ChevronRight aria-hidden="true" />
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default DataTableFooter;
