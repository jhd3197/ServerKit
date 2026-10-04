import { countActiveFilters, emptyFilterValue } from './filterValues';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Drawer } from './Drawer';
import { useTranslation } from 'react-i18next';

// Schema-driven advanced-filter slide-over, shared across tables/lists. A page
// passes a `groups` schema plus a controlled `value`/`onChange`, and the drawer
// renders each group as a set of toggle chips. Changes apply live so results
// update behind the open drawer.
//
// WHICH FILTER CONTROL TO USE — pages had drifted into three unrelated
// interactions for the same job, so pick by shape, not by taste:
//
//   <= 4 mutually-exclusive options, one dimension  ->  <SegControl/>, inline
//   more options, or more than one dimension        ->  this drawer
//   an unbounded list (servers, groups, versions)   ->  the shared Select
//                                                       (@/components/ui/select)
//
// A dropdown is never right for a fixed set of states, and a segmented
// control is never right for two dimensions at once.
//
//   groups = [
//     { key: 'ownership', label: 'Publisher', type: 'single',
//       options: [{ value: 'serverkit', label: 'By ServerKit' }, …] },
//     { key: 'category',  label: 'Categories', type: 'multi',
//       options: [{ value: 'security', label: 'Security' }, …] },
//   ]
//   value  = { ownership: '', category: ['security'] }
//
// `single` groups hold a string ('' = none); `multi` groups hold a string[].

// The trigger button, with an active-count badge. Kept here so hosts get the
// button + drawer as a matched pair.
export function FilterButton({ count = 0, onClick, className, label = 'Filters' }) {
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={onClick}
            className={cn('sk-filter-btn', count > 0 && 'sk-filter-btn--active', className)}
        >
            <SlidersHorizontal aria-hidden="true" />
            {label}
            {count > 0 && <span className="sk-filter-btn__badge">{count}</span>}
        </Button>
    );
}

export function FilterDrawer({
    open,
    onOpenChange,
    groups = [],
    value = {},
    onChange,
    title = 'Filters',
    width = 380,
    // Optional: how many rows the current selection yields. Given one, the
    // confirm button reports it ("Show 45 templates") instead of a bare "Done",
    // so the effect of a selection is visible before closing the drawer.
    resultCount,
    resultNoun = 'result',
    // Optional: the host's own active-filter count. Pass the same number the
    // FilterButton badge shows, so the two can never disagree — a host may
    // legitimately not count a group whose value is just its default (a sort
    // order sitting on "featured" is not a filter the user applied).
    activeCount,
    // Optional: extra fields rendered below the chip groups, for filters that
    // aren't a pick-from-a-list (free text, date bounds). A host that passes
    // these must also pass `onClear`, otherwise "Clear all" would reset only the
    // groups and silently leave the extra fields applied.
    children,
    onClear,
}) {
    const { t } = useTranslation();
    const isOn = (group, optValue) => (
        group.type === 'multi'
            ? (value[group.key] || []).includes(optValue)
            : (value[group.key] || '') === optValue
    );

    const toggle = (group, optValue) => {
        if (group.type === 'multi') {
            const current = Array.isArray(value[group.key]) ? value[group.key] : [];
            const next = current.includes(optValue)
                ? current.filter((item) => item !== optValue)
                : [...current, optValue];
            onChange({ ...value, [group.key]: next });
        } else {
            const current = value[group.key] || '';
            onChange({ ...value, [group.key]: current === optValue ? '' : optValue });
        }
    };

    const active = activeCount ?? countActiveFilters(value);
    const clearAll = () => (onClear ? onClear() : onChange(emptyFilterValue(groups)));

    return (
        <Drawer
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            subtitle={active ? `${active} active` : t('app.filterDrawer.noFilters', 'no filters')}
            icon={<SlidersHorizontal size={16} />}
            width={width}
        >
            <div className="sk-filter">
                {groups.map((group) => (
                    <div key={group.key} className="sk-filter__group">
                        <div className="sk-filter__label">{group.label}</div>
                        <div className="sk-filter__chips">
                            {group.options.map((option) => (
                                <Button variant="unstyled"
                                    key={option.value}
                                    type="button"
                                    className={cn('sk-filter__chip', isOn(group, option.value) && 'is-on')}
                                    onClick={() => toggle(group, option.value)}
                                    aria-pressed={isOn(group, option.value)}
                                >
                                    {option.label}
                                    {/* An option may carry how many rows it would
                                        match, so a dead-end filter is visible
                                        before you spend a click on it. */}
                                    {option.count != null && (
                                        <span className="sk-filter__chip-count">{option.count}</span>
                                    )}
                                </Button>
                            ))}
                        </div>
                    </div>
                ))}
                {children && <div className="sk-filter__extra">{children}</div>}
                <div className="sk-filter__footer">
                    <Button variant="ghost" size="sm" onClick={clearAll} disabled={!active}>
                        {t('app.filterDrawer.clearAll', 'Clear all')}
                    </Button>
                    <Button size="sm" onClick={() => onOpenChange(false)}>
                        {resultCount == null
                            ? 'Done'
                            : `Show ${resultCount} ${resultNoun}${resultCount === 1 ? '' : 's'}`}
                    </Button>
                </div>
            </div>
        </Drawer>
    );
}

export default FilterDrawer;
