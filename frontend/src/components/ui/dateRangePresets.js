import { addDays, addMonths, endOfMonth, startOfMonth } from '@/lib/dateMath';

/**
 * The presets most range filters want. Each is computed when opened, so
 * "Last 7 days" means the seven days before today, not before page load.
 */
export function defaultRangePresets(t) {
    return [
        { id: 'today', label: t('common.controls.presetToday', 'Today'), range: (today) => ({ start: today, end: today }) },
        { id: 'yesterday', label: t('common.controls.presetYesterday', 'Yesterday'), range: (today) => ({ start: addDays(today, -1), end: addDays(today, -1) }) },
        { id: 'last7', label: t('common.controls.presetLast7', 'Last 7 days'), range: (today) => ({ start: addDays(today, -6), end: today }) },
        { id: 'last30', label: t('common.controls.presetLast30', 'Last 30 days'), range: (today) => ({ start: addDays(today, -29), end: today }) },
        { id: 'thisMonth', label: t('common.controls.presetThisMonth', 'This month'), range: (today) => ({ start: startOfMonth(today), end: today }) },
        {
            id: 'lastMonth',
            label: t('common.controls.presetLastMonth', 'Last month'),
            range: (today) => {
                const previous = addMonths(startOfMonth(today), -1);
                return { start: previous, end: endOfMonth(previous) };
            },
        },
    ];
}
