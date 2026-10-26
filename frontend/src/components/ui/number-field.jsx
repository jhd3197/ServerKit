import * as React from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFieldProps } from '@/components/ui/field-context';
import {
    clamp, decimalsOf, isPartialNumber, normalizeNumber, parseNumber, stepNumber,
} from '@/lib/numberMath';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-number-field*).

// Press-and-hold on a stepper: one step at once, then repeat after a pause.
const HOLD_DELAY_MS = 400;
const HOLD_INTERVAL_MS = 60;
// PageUp/PageDown and Shift+Arrow move this many steps.
const LARGE_STEP_MULTIPLIER = 10;

/**
 * Numeric input with steppers, for ports, limits, counts and retention.
 *
 *   <NumberField value={workers} onChange={setWorkers} min={1} max={64} />
 *   <NumberField value={mem} onChange={setMem} min={128} step={128} unit="MB" />
 *
 * `onChange` receives a number, or null while the field is empty. Typing is
 * free; the value is clamped to [min, max] and snapped to `step` on blur and
 * Enter, and the field reads as invalid while a typed value is out of range.
 * Keyboard: ↑/↓ step, Shift+↑/↓ and PageUp/PageDown ×10, Home/End jump to
 * min/max. The steppers repeat while held and are skipped by Tab, so the
 * field is a single tab stop like a native spinbutton.
 */
const NumberField = React.forwardRef(({
    value,
    onChange,
    min,
    max,
    step = 1,
    unit,
    size,
    placeholder,
    disabled = false,
    readOnly = false,
    hideSteppers = false,
    className,
    onBlur,
    onKeyDown,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const fieldProps = useFieldProps(props);
    const [draft, setDraft] = React.useState(null);
    const latest = React.useRef(value);
    latest.current = value;
    const holdTimer = React.useRef(null);

    const current = value === '' || value === undefined ? null : value;
    const text = draft ?? (current === null ? '' : String(current));
    const typed = draft === null ? current : parseNumber(draft);
    const outOfRange = typed !== null && clamp(typed, min, max) !== typed;
    const allowDecimal = decimalsOf(step) > 0 || (Number.isFinite(min) && decimalsOf(min) > 0);
    const allowNegative = !Number.isFinite(min) || min < 0;
    const options = { min, max, step };
    const interactive = !disabled && !readOnly;

    // Compare against the ref, not the render's `value`: the hold interval
    // keeps one closure alive across many re-renders.
    const emit = (next) => {
        if (next === latest.current) return false;
        latest.current = next;
        onChange?.(next);
        return true;
    };

    const commit = () => {
        if (draft === null) return;
        const parsed = parseNumber(draft);
        setDraft(null);
        emit(parsed === null ? null : normalizeNumber(parsed, options));
    };

    const nudge = (direction, multiplier = 1) => {
        const base = draft === null ? latest.current : parseNumber(draft);
        setDraft(null);
        emit(stepNumber(base ?? null, direction, { ...options, multiplier }));
    };

    const stopHold = () => {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
    };
    React.useEffect(() => stopHold, []);

    // A timeout chain rather than an interval: each repeat schedules the next,
    // so a bound reached mid-hold simply stops scheduling. (A disabled button
    // never sees pointerup, so the chain cannot rely on it.)
    const repeat = (direction) => {
        holdTimer.current = setTimeout(() => {
            if (emit(stepNumber(latest.current ?? null, direction, options))) repeat(direction);
            else stopHold();
        }, HOLD_INTERVAL_MS);
    };

    const startHold = (direction) => (event) => {
        if (!interactive || event.button !== 0) return;
        event.preventDefault();   // keep focus where it was (usually the input)
        nudge(direction);
        holdTimer.current = setTimeout(() => repeat(direction), HOLD_DELAY_MS);
    };

    const handleKeyDown = (event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !interactive) return;
        const large = event.shiftKey ? LARGE_STEP_MULTIPLIER : 1;
        const keyActions = {
            ArrowUp: () => nudge(1, large),
            ArrowDown: () => nudge(-1, large),
            PageUp: () => nudge(1, LARGE_STEP_MULTIPLIER),
            PageDown: () => nudge(-1, LARGE_STEP_MULTIPLIER),
            Home: Number.isFinite(min) ? () => { setDraft(null); emit(min); } : null,
            End: Number.isFinite(max) ? () => { setDraft(null); emit(max); } : null,
            Enter: draft !== null ? commit : null,
        };
        const action = keyActions[event.key];
        if (!action) return;
        event.preventDefault();
        action();
    };

    const handleChange = (event) => {
        const next = event.target.value.trim();
        if (!isPartialNumber(next, { allowNegative, allowDecimal })) return;
        setDraft(next);
        const parsed = parseNumber(next);
        // Emit while typing so a form sees the number before blur; clamping
        // waits for commit so typing "1" on the way to "12" is not forced up.
        if (parsed !== null || next === '') emit(parsed);
    };

    const atMin = current !== null && Number.isFinite(min) && current <= min;
    const atMax = current !== null && Number.isFinite(max) && current >= max;
    const invalid = fieldProps['aria-invalid'] || outOfRange || undefined;

    return (
        <div
            className={cn(
                'ui-number-field',
                size === 'sm' && 'ui-number-field--sm',
                invalid && 'is-invalid',
                disabled && 'is-disabled',
                className,
            )}
        >
            {!hideSteppers && (
                <Button variant="unstyled"
                    type="button"
                    tabIndex={-1}
                    className="ui-number-field__step"
                    aria-label={t('common.controls.decrease', 'Decrease')}
                    aria-controls={fieldProps.id}
                    disabled={!interactive || atMin}
                    onPointerDown={startHold(-1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                >
                    <Minus aria-hidden="true" />
                </Button>
            )}
            <div className="ui-number-field__input-wrap">
                <input
                    ref={ref}
                    type="text"
                    inputMode={allowDecimal ? 'decimal' : 'numeric'}
                    role="spinbutton"
                    autoComplete="off"
                    spellCheck={false}
                    className="ui-number-field__input"
                    value={text}
                    placeholder={placeholder}
                    disabled={disabled}
                    readOnly={readOnly}
                    aria-valuenow={current ?? undefined}
                    aria-valuemin={Number.isFinite(min) ? min : undefined}
                    aria-valuemax={Number.isFinite(max) ? max : undefined}
                    aria-valuetext={current !== null && unit ? `${current} ${unit}` : undefined}
                    {...fieldProps}
                    aria-invalid={invalid}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onBlur={(event) => { commit(); onBlur?.(event); }}
                />
                {unit && <span className="ui-number-field__unit" aria-hidden="true">{unit}</span>}
            </div>
            {!hideSteppers && (
                <Button variant="unstyled"
                    type="button"
                    tabIndex={-1}
                    className="ui-number-field__step"
                    aria-label={t('common.controls.increase', 'Increase')}
                    aria-controls={fieldProps.id}
                    disabled={!interactive || atMax}
                    onPointerDown={startHold(1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                >
                    <Plus aria-hidden="true" />
                </Button>
            )}
        </div>
    );
});
NumberField.displayName = 'NumberField';

export { NumberField };
