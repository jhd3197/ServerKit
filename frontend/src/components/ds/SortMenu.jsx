import { ArrowDownUp, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { translateLabel } from '../../i18n/labels';

// Toolbar popover for user-controllable multi-column sorting (Frappe CRM
// style). Each active sort is a row: field label, asc/desc toggle, remove.
// "Add sort level" stacks another column; priority is the row order. The
// trigger button carries a count badge while any sort is active.
//
//   const { sorts, setSorts } = useTableSort();
//   <SortMenu columns={columns} sorts={sorts} onChange={setSorts} />
export function SortMenu({ columns = [], sorts = [], onChange, className }) {
    const { t } = useTranslation();
    const sortableColumns = columns.filter((c) => c.sortable);
    const labelFor = (key) => {
        const column = sortableColumns.find((c) => c.key === key);
        if (!column) return key;
        // Column headers may be React nodes; only plain text makes a usable label.
        return typeof column.header === 'string' ? translateLabel(t, column, 'header') : column.key;
    };

    const flip = (key) => onChange?.(
        sorts.map((s) => (s.key === key
            ? { ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }
            : s)),
    );
    const remove = (key) => onChange?.(sorts.filter((s) => s.key !== key));
    const add = (key) => onChange?.([...sorts, { key, direction: 'asc' }]);
    const clear = () => onChange?.([]);

    const available = sortableColumns.filter((c) => !sorts.some((s) => s.key === c.key));

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn('sk-filter-btn', sorts.length > 0 && 'sk-filter-btn--active', className)}
                >
                    <ArrowDownUp aria-hidden="true" />
                    {t('app.sortMenu.sort', 'Sort')}
                    {sorts.length > 0 && <span className="sk-filter-btn__badge">{sorts.length}</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="sk-tablemenu">
                <div className="sk-tablemenu__title">{t('app.sortMenu.sortBy', 'Sort by')}</div>
                {sorts.length === 0 && (
                    <div className="sk-tablemenu__empty">{t('app.sortMenu.noSortingApplied', 'No sorting applied')}</div>
                )}
                {sorts.map((sort, index) => (
                    <div key={sort.key} className="sk-tablemenu__row">
                        {sorts.length > 1 && (
                            <span className="sk-tablemenu__priority">{index + 1}</span>
                        )}
                        <span className="sk-tablemenu__field">{labelFor(sort.key)}</span>
                        <Button variant="unstyled"
                            type="button"
                            className="sk-tablemenu__dir"
                            onClick={() => flip(sort.key)}
                            aria-label={sort.direction === 'asc'
                                ? t('app.sortMenu.sortDescending', 'Sort {{column}} descending', { column: labelFor(sort.key) })
                                : t('app.sortMenu.sortAscending', 'Sort {{column}} ascending', { column: labelFor(sort.key) })}
                            title={sort.direction === 'asc' ? t('app.sortMenu.ascending', 'Ascending') : t('app.sortMenu.descending', 'Descending')}
                        >
                            {sort.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                        </Button>
                        <Button variant="unstyled"
                            type="button"
                            className="sk-tablemenu__remove"
                            onClick={() => remove(sort.key)}
                            aria-label={t('app.sortMenu.removeSortOn', 'Remove sort on {{value}}', { value: labelFor(sort.key) })}
                        >
                            <X size={13} />
                        </Button>
                    </div>
                ))}
                {available.length > 0 && (
                    <>
                        <div className="sk-tablemenu__section">{t('app.sortMenu.addSortLevel', 'Add sort level')}</div>
                        <div className="sk-tablemenu__list">
                            {available.map((c) => (
                                <Button variant="unstyled"
                                    key={c.key}
                                    type="button"
                                    className="sk-tablemenu__item"
                                    onClick={() => add(c.key)}
                                >
                                    {labelFor(c.key)}
                                </Button>
                            ))}
                        </div>
                    </>
                )}
                <div className="sk-tablemenu__footer">
                    <Button variant="ghost" size="sm" onClick={clear} disabled={sorts.length === 0}>
                        {t('common.actions.clear', 'Clear')}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default SortMenu;
