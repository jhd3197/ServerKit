import * as React from 'react';
import { CalendarDays, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFieldProps } from '@/components/ui/field-context';
import useFormat from '@/hooks/useFormat';
import { isSameDay, startOfDay } from '@/lib/dateMath';
import { defaultRangePresets } from '@/components/ui/dateRangePresets';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-date-picker*).

/** Trigger + clear button shared by both pickers. */
const PickerTrigger = React.forwardRef(({
    label, placeholder, open, disabled, size, invalid, onClear, clearLabel, fieldProps, className,
}, ref) => (
    <PopoverAnchor asChild>
        <div className={cn(
            'ui-date-picker',
            size === 'sm' && 'ui-date-picker--sm',
            invalid && 'is-invalid',
            disabled && 'is-disabled',
            className,
        )}>
            <PopoverTrigger asChild>
                <Button variant="unstyled"
                    ref={ref}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    disabled={disabled}
                    className="ui-date-picker__trigger"
                    {...fieldProps}
                >
                    <CalendarDays className="ui-date-picker__icon" aria-hidden="true" />
                    {label
                        ? <span className="ui-date-picker__value">{label}</span>
                        : <span className="ui-date-picker__placeholder">{placeholder}</span>}
                </Button>
            </PopoverTrigger>
            {onClear && (
                <Button variant="unstyled" type="button" className="ui-date-picker__clear" aria-label={clearLabel} onClick={onClear}>
                    <X aria-hidden="true" />
                </Button>
            )}
        </div>
    </PopoverAnchor>
));
PickerTrigger.displayName = 'PickerTrigger';

/**
 * One calendar day.
 *
 *   <DatePicker value={expires} onChange={setExpires} min={new Date()} />
 *
 * `value` is a local-midnight Date or null (lib/dateMath has toISODate /
 * fromISODate for the wire). Picking a day closes the popover.
 */
const DatePicker = React.forwardRef(({
    value,
    onChange,
    min,
    max,
    isDateDisabled,
    placeholder,
    clearable = true,
    disabled = false,
    size,
    className,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const { formatDate } = useFormat();
    const fieldProps = useFieldProps(props);
    const [open, setOpen] = React.useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PickerTrigger
                ref={ref}
                label={value ? formatDate(value, { style: 'medium' }) : null}
                placeholder={placeholder || t('common.controls.pickDate', 'Pick a date')}
                open={open}
                disabled={disabled}
                size={size}
                invalid={fieldProps['aria-invalid']}
                fieldProps={fieldProps}
                className={className}
                clearLabel={t('common.controls.clearDate', 'Clear date')}
                onClear={clearable && value && !disabled ? () => onChange?.(null) : null}
            />
            <PopoverContent className="ui-date-picker__panel" align="start">
                <Calendar
                    autoFocus
                    value={value}
                    min={min}
                    max={max}
                    isDateDisabled={isDateDisabled}
                    onChange={(day) => { onChange?.(day); setOpen(false); }}
                />
            </PopoverContent>
        </Popover>
    );
});
DatePicker.displayName = 'DatePicker';

/**
 * A start–end range of days with quick presets, for log, metric and audit
 * filters.
 *
 *   <DateRangePicker value={range} onChange={setRange} max={new Date()} />
 *
 * `value` is `{ start, end }` (either may be null). The first click picks the
 * start, the second the end (in either order); the popover closes once both
 * are set. `presets={[]}` hides the preset list.
 */
const DateRangePicker = React.forwardRef(({
    value,
    onChange,
    min,
    max,
    presets,
    months = 2,
    placeholder,
    clearable = true,
    disabled = false,
    size,
    className,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const { formatDate } = useFormat();
    const fieldProps = useFieldProps(props);
    const [open, setOpen] = React.useState(false);
    const [draft, setDraft] = React.useState(value || { start: null, end: null });
    const presetList = presets ?? defaultRangePresets(t);

    // Each opening starts from the committed value; a half-picked range that
    // was dismissed does not come back.
    const openChange = (next) => {
        if (next) setDraft(value || { start: null, end: null });
        setOpen(next);
    };

    const today = startOfDay(new Date());
    const activePreset = value?.start && value?.end && presetList.find((preset) => {
        const range = preset.range(today);
        return isSameDay(range.start, value.start) && isSameDay(range.end, value.end);
    });

    let label = null;
    if (activePreset) label = activePreset.label;
    else if (value?.start && value?.end) {
        label = isSameDay(value.start, value.end)
            ? formatDate(value.start, { style: 'medium' })
            : t('common.controls.dateRange', '{{start}} – {{end}}', {
                start: formatDate(value.start, { style: 'medium' }),
                end: formatDate(value.end, { style: 'medium' }),
            });
    }

    const commit = (range) => {
        setDraft(range);
        if (range.start && range.end) {
            onChange?.(range);
            setOpen(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={openChange}>
            <PickerTrigger
                ref={ref}
                label={label}
                placeholder={placeholder || t('common.controls.pickDateRange', 'Pick a date range')}
                open={open}
                disabled={disabled}
                size={size}
                invalid={fieldProps['aria-invalid']}
                fieldProps={fieldProps}
                className={className}
                clearLabel={t('common.controls.clearDateRange', 'Clear date range')}
                onClear={clearable && value?.start && !disabled ? () => onChange?.({ start: null, end: null }) : null}
            />
            <PopoverContent className="ui-date-picker__panel ui-date-picker__panel--range" align="start">
                {presetList.length > 0 && (
                    <ul className="ui-date-picker__presets" aria-label={t('common.controls.presets', 'Presets')}>
                        {presetList.map((preset) => (
                            <li key={preset.id}>
                                <Button variant="unstyled"
                                    type="button"
                                    className={cn('ui-date-picker__preset', activePreset?.id === preset.id && 'is-active')}
                                    aria-pressed={activePreset?.id === preset.id}
                                    onClick={() => commit(preset.range(today))}
                                >
                                    {preset.label}
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="ui-date-picker__range-body">
                    <Calendar
                        autoFocus
                        mode="range"
                        months={months}
                        value={draft}
                        min={min}
                        max={max}
                        onChange={commit}
                    />
                    <p className="ui-date-picker__hint" aria-live="polite">
                        {draft.start && !draft.end
                            ? t('common.controls.pickEndDate', 'Now pick the end date.')
                            : t('common.controls.pickStartDate', 'Pick a start date, or choose a preset.')}
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
});
DateRangePicker.displayName = 'DateRangePicker';

export { DatePicker, DateRangePicker };
