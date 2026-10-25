import { useMemo } from 'react';
import { useLocale } from '../contexts/useLocale.js';
import * as intl from '../utils/intl';

/**
 * The format door for components.
 *
 * Same implementation as `utils/intl` — this is a subscription, not a second
 * door. Components need it because a locale switch has to re-render them;
 * non-React callers (the API error mapper, the log formatter, CSV export)
 * import the module directly. Both read one module-level locale.
 */
export default function useFormat() {
    const { language } = useLocale();

    // `language` is the dependency on purpose: the functions themselves are
    // stable module references, so without it a switch would not re-render.
    return useMemo(() => ({
        formatDate: intl.formatDate,
        formatTime: intl.formatTime,
        formatDateTime: intl.formatDateTime,
        formatRelative: intl.formatRelative,
        formatRelativeShort: intl.formatRelativeShort,
        formatDuration: intl.formatDuration,
        formatNumber: intl.formatNumber,
        formatCompactNumber: intl.formatCompactNumber,
        formatPercent: intl.formatPercent,
        formatList: intl.formatList,
        getWeekStart: intl.getWeekStart,
        locale: language,

    }), [language]);
}
