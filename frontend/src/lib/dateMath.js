// Calendar-day arithmetic behind Calendar / DatePicker / DateRangePicker.
//
// Every value here is a LOCAL calendar day: a Date at local midnight. A date
// picker picks a day, not an instant, so nothing in this file touches UTC —
// `new Date('2026-10-25')` would parse as UTC midnight and render as the 24th
// west of Greenwich, which is the classic date-picker off-by-one.

export function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Month arithmetic that clamps the day: Jan 31 + 1 month is Feb 28/29. */
export function addMonths(date, months) {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

export function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function isSameDay(a, b) {
    return Boolean(a && b)
        && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

export function isSameMonth(a, b) {
    return Boolean(a && b) && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Negative, zero or positive, comparing calendar days only. */
export function compareDays(a, b) {
    return startOfDay(a).getTime() - startOfDay(b).getTime();
}

export function isBefore(a, b) { return compareDays(a, b) < 0; }
export function isAfter(a, b) { return compareDays(a, b) > 0; }

export function isWithinRange(day, start, end) {
    if (!start || !end) return false;
    return compareDays(day, start) >= 0 && compareDays(day, end) <= 0;
}

/** First day of the week containing `date`; weekStartsOn is 0 (Sun) .. 6 (Sat). */
export function startOfWeek(date, weekStartsOn = 0) {
    const offset = (date.getDay() - weekStartsOn + 7) % 7;
    return addDays(date, -offset);
}

export function endOfWeek(date, weekStartsOn = 0) {
    return addDays(startOfWeek(date, weekStartsOn), 6);
}

/**
 * The 6×7 grid shown for `month`: always six rows so the popover never
 * changes height while paging through months.
 */
export function monthGrid(month, weekStartsOn = 0) {
    const first = startOfWeek(startOfMonth(month), weekStartsOn);
    return Array.from({ length: 6 }, (_, row) => (
        Array.from({ length: 7 }, (_, col) => addDays(first, row * 7 + col))
    ));
}

/** Clamp a day into [min, max]; either bound may be null. */
export function clampDay(day, min, max) {
    if (min && isBefore(day, min)) return startOfDay(min);
    if (max && isAfter(day, max)) return startOfDay(max);
    return day;
}

/** Order a picked pair so start <= end. */
export function orderRange(a, b) {
    return isAfter(a, b) ? { start: b, end: a } : { start: a, end: b };
}

/** `YYYY-MM-DD` for a local day (the wire format for date-only fields). */
export function toISODate(date) {
    if (!date) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD` as a LOCAL day; null when malformed. */
export function fromISODate(text) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 ? date : null;
}
