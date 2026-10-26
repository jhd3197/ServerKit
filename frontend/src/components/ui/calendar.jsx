import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useFormat from '@/hooks/useFormat';
import {
    addDays, addMonths, clampDay, endOfMonth, endOfWeek, isAfter, isBefore, isSameDay, isSameMonth,
    isWithinRange, monthGrid, orderRange, startOfDay, startOfMonth, startOfWeek,
} from '@/lib/dateMath';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-calendar*).

function isRtl(node) {
    return node?.closest('[dir]')?.getAttribute('dir') === 'rtl';
}

/**
 * Month grid for picking one day or a range. Usually rendered by
 * DatePicker / DateRangePicker; use it bare for an inline calendar.
 *
 *   <Calendar value={day} onChange={setDay} min={today} />
 *   <Calendar mode="range" value={{ start, end }} onChange={setRange} months={2} />
 *
 * Values are local calendar days (lib/dateMath). Keyboard follows the WAI
 * date-grid pattern: arrows move a day / week, Home/End the week edges,
 * PageUp/PageDown a month, Shift+PageUp/PageDown a year, Enter/Space picks.
 * Only the focused day is a tab stop.
 */
function Calendar({
    mode = 'single',
    value,
    onChange,
    min,
    max,
    isDateDisabled,
    months = 1,
    defaultMonth,
    autoFocus = false,
    className,
}) {
    const { t } = useTranslation();
    const { formatDate, getWeekStart } = useFormat();
    const weekStartsOn = getWeekStart();
    const today = startOfDay(new Date());
    const range = mode === 'range' ? (value || {}) : null;
    const anchor = mode === 'range' ? range.start : value;

    const [visibleMonth, setVisibleMonth] = React.useState(() => startOfMonth(defaultMonth || anchor || today));
    const [focusedDay, setFocusedDay] = React.useState(() => anchor || clampDay(today, min, max));
    const [hoverDay, setHoverDay] = React.useState(null);
    const gridRef = React.useRef(null);
    const focusWithin = React.useRef(autoFocus);

    const lastVisible = addMonths(visibleMonth, months - 1);
    const disabledDay = (day) => (min && isBefore(day, min))
        || (max && isAfter(day, max))
        || Boolean(isDateDisabled?.(day));

    // Page the grid so `day` is inside one of the visible months.
    const reveal = React.useCallback((day) => {
        setVisibleMonth((first) => {
            if (isBefore(day, first)) return startOfMonth(day);
            if (isAfter(day, endOfMonth(addMonths(first, months - 1)))) {
                return startOfMonth(addMonths(day, -(months - 1)));
            }
            return first;
        });
    }, [months]);

    const moveFocus = (day) => {
        const next = clampDay(day, min, max);
        setFocusedDay(next);
        reveal(next);
    };

    // A value set from outside (a preset, a typed date) brings its month in.
    const anchorTime = anchor ? anchor.getTime() : null;
    React.useEffect(() => {
        if (anchorTime === null) return;
        const day = new Date(anchorTime);
        setFocusedDay(day);
        reveal(day);
    }, [anchorTime, reveal]);

    React.useLayoutEffect(() => {
        if (!focusWithin.current) return;
        gridRef.current?.querySelector('[data-focused="true"]')?.focus();
    }, [focusedDay, visibleMonth]);

    const pick = (day) => {
        if (disabledDay(day)) return;
        setFocusedDay(day);
        if (mode !== 'range') { onChange?.(day); return; }
        if (!range.start || range.end) {
            onChange?.({ start: day, end: null });
        } else {
            onChange?.(orderRange(range.start, day));
            setHoverDay(null);
        }
    };

    const handleKeyDown = (event) => {
        const rtl = isRtl(event.currentTarget);
        const horizontal = rtl ? -1 : 1;
        const moves = {
            ArrowLeft: () => addDays(focusedDay, -horizontal),
            ArrowRight: () => addDays(focusedDay, horizontal),
            ArrowUp: () => addDays(focusedDay, -7),
            ArrowDown: () => addDays(focusedDay, 7),
            Home: () => startOfWeek(focusedDay, weekStartsOn),
            End: () => endOfWeek(focusedDay, weekStartsOn),
            PageUp: () => addMonths(focusedDay, event.shiftKey ? -12 : -1),
            PageDown: () => addMonths(focusedDay, event.shiftKey ? 12 : 1),
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        focusWithin.current = true;
        moveFocus(move());
    };

    const page = (delta) => {
        setVisibleMonth((month) => addMonths(month, delta));
        setFocusedDay((day) => clampDay(addMonths(day, delta), min, max));
    };

    const weekdays = monthGrid(visibleMonth, weekStartsOn)[0];
    const previewEnd = range && range.start && !range.end && hoverDay ? hoverDay : null;
    const shownRange = previewEnd ? orderRange(range.start, previewEnd) : range;
    const prevDisabled = min && !isAfter(visibleMonth, startOfMonth(min));
    const nextDisabled = max && !isBefore(lastVisible, startOfMonth(max));

    return (
        <div
            ref={gridRef}
            className={cn('ui-calendar', months > 1 && 'ui-calendar--multi', className)}
            onFocus={() => { focusWithin.current = true; }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
            }}
        >
            <div className="ui-calendar__nav">
                <Button variant="unstyled"
                    type="button"
                    className="ui-calendar__nav-button"
                    aria-label={t('common.controls.previousMonth', 'Previous month')}
                    disabled={prevDisabled}
                    onClick={() => page(-1)}
                >
                    <ChevronLeft aria-hidden="true" />
                </Button>
                <Button variant="unstyled"
                    type="button"
                    className="ui-calendar__nav-button"
                    aria-label={t('common.controls.nextMonth', 'Next month')}
                    disabled={nextDisabled}
                    onClick={() => page(1)}
                >
                    <ChevronRight aria-hidden="true" />
                </Button>
            </div>
            <div className="ui-calendar__months">
                {Array.from({ length: months }, (_, offset) => {
                    const month = addMonths(visibleMonth, offset);
                    const title = formatDate(month, { parts: { month: 'long', year: 'numeric' } });
                    return (
                        <div key={offset} className="ui-calendar__month">
                            <div className="ui-calendar__title" aria-live="polite">{title}</div>
                            <div role="grid" aria-label={title} className="ui-calendar__grid" onKeyDown={handleKeyDown}>
                                <div role="row" className="ui-calendar__row ui-calendar__row--head">
                                    {weekdays.map((day) => (
                                        <span
                                            key={day.getDay()}
                                            role="columnheader"
                                            aria-label={formatDate(day, { parts: { weekday: 'long' } })}
                                            className="ui-calendar__weekday"
                                        >
                                            {formatDate(day, { parts: { weekday: 'narrow' } })}
                                        </span>
                                    ))}
                                </div>
                                {monthGrid(month, weekStartsOn).map((week) => (
                                        <div key={week[0].getTime()} role="row" className="ui-calendar__row">
                                            {week.map((day) => {
                                                const outside = !isSameMonth(day, month);
                                                if (outside && months > 1) {
                                                    return <span key={day.getTime()} role="gridcell" className="ui-calendar__cell is-outside" />;
                                                }
                                                const disabled = disabledDay(day);
                                                const isStart = shownRange && isSameDay(day, shownRange.start);
                                                const isEnd = shownRange && isSameDay(day, shownRange.end);
                                                const inRange = shownRange && isWithinRange(day, shownRange.start, shownRange.end);
                                                const selected = mode === 'range' ? (isStart || isEnd || inRange) : isSameDay(day, value);
                                                const focused = isSameDay(day, focusedDay) && isSameMonth(day, month);
                                                return (
                                                    <span
                                                        key={day.getTime()}
                                                        role="gridcell"
                                                        aria-selected={selected || undefined}
                                                        className={cn(
                                                            'ui-calendar__cell',
                                                            outside && 'is-outside',
                                                            inRange && 'is-in-range',
                                                            isStart && 'is-range-start',
                                                            isEnd && 'is-range-end',
                                                        )}
                                                    >
                                                        <Button variant="unstyled"
                                                            type="button"
                                                            tabIndex={focused ? 0 : -1}
                                                            data-focused={focused || undefined}
                                                            disabled={disabled}
                                                            aria-label={formatDate(day, { style: 'full' })}
                                                            aria-current={isSameDay(day, today) ? 'date' : undefined}
                                                            className={cn(
                                                                'ui-calendar__day',
                                                                selected && 'is-selected',
                                                                (isStart || isEnd || mode !== 'range') && selected && 'is-endpoint',
                                                                isSameDay(day, today) && 'is-today',
                                                            )}
                                                            onClick={() => pick(day)}
                                                            onMouseEnter={() => { if (range?.start && !range.end) setHoverDay(day); }}
                                                        >
                                                            {day.getDate()}
                                                        </Button>
                                                    </span>
                                                );
                                            })}
                                        </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export { Calendar };
