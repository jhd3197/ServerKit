import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

// Styling lives in styles/components/_controls.scss (.ui-pin-input*).

const PATTERNS = {
    numeric: /^\d$/,
    alphanumeric: /^[a-z0-9]$/i,
};

/**
 * One-time code entry: a row of single-character cells.
 *
 *   <PinInput length={6} value={code} onChange={setCode} onComplete={verify} />
 *
 * Typing advances, Backspace walks back (clearing as it goes), arrows move,
 * and pasting a code fills every cell at once — including the SMS / password
 * manager autofill that `autocomplete="one-time-code"` invites. `onComplete`
 * fires once when the last cell fills. `groupSize={3}` adds a gap mid-code.
 */
const PinInput = React.forwardRef(({
    length = 6,
    value = '',
    onChange,
    onComplete,
    type = 'numeric',
    mask = false,
    groupSize,
    disabled = false,
    autoFocus = false,
    className,
    'aria-label': ariaLabel,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const fieldProps = useFieldProps(props);
    const cells = React.useRef([]);
    React.useImperativeHandle(ref, () => cells.current[0]);
    const pattern = PATTERNS[type] || PATTERNS.numeric;
    const chars = Array.from({ length }, (_, i) => value[i] || '');

    const focusCell = (index) => {
        const cell = cells.current[Math.max(0, Math.min(length - 1, index))];
        cell?.focus();
        cell?.select();
    };

    // Focus that follows a write waits for the re-render: moving it at once
    // runs the cell's onFocus guard against the OLD value, which sends focus
    // back to the first empty cell and the next keystroke overwrites a digit.
    const pendingFocus = React.useRef(null);
    React.useLayoutEffect(() => {
        if (pendingFocus.current === null) return;
        const index = pendingFocus.current;
        pendingFocus.current = null;
        focusCell(index);
    });

    // The code is always contiguous: no holes, so focus never lands past the
    // first empty cell and the value is always a prefix of the final code.
    const write = (next, focusIndex) => {
        const code = next.slice(0, length);
        if (code !== value) {
            onChange?.(code);
            if (code.length === length) onComplete?.(code);
        }
        if (focusIndex === undefined) return;
        if (code === value) focusCell(focusIndex);
        else pendingFocus.current = focusIndex;
    };

    const accept = (text) => Array.from(text).filter((ch) => pattern.test(ch)).join('');

    const handleInput = (index) => (event) => {
        // A cell already holding a character receives old + new; keep the new.
        const raw = event.target.value;
        const typed = accept(chars[index] && raw.length > 1 && raw.startsWith(chars[index]) ? raw.slice(1) : raw);
        if (!typed) return;
        const at = Math.min(index, value.length);
        write(value.slice(0, at) + typed + value.slice(at + typed.length), at + typed.length);
    };

    const handleKeyDown = (index) => (event) => {
        const moves = {
            ArrowLeft: index - 1,
            ArrowRight: Math.min(index + 1, value.length),
            Home: 0,
            End: Math.min(value.length, length - 1),
        };
        if (event.key in moves) {
            event.preventDefault();
            focusCell(moves[event.key]);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            if (chars[index]) write(value.slice(0, index) + value.slice(index + 1), index);
            else if (event.key === 'Backspace' && index > 0) write(value.slice(0, index - 1), index - 1);
        }
    };

    const handlePaste = (event) => {
        const pasted = accept(event.clipboardData.getData('text'));
        if (!pasted) return;
        event.preventDefault();
        write(pasted, Math.min(pasted.length, length - 1));
    };

    const groupLabel = ariaLabel || t('common.controls.verificationCode', 'Verification code');

    return (
        <div
            role="group"
            aria-label={groupLabel}
            aria-describedby={fieldProps['aria-describedby']}
            className={cn('ui-pin-input', fieldProps['aria-invalid'] && 'is-invalid', className)}
        >
            {chars.map((char, index) => (
                <React.Fragment key={index}>
                    {groupSize && index > 0 && index % groupSize === 0 && (
                        <span className="ui-pin-input__separator" aria-hidden="true" />
                    )}
                    <input
                        ref={(node) => { cells.current[index] = node; }}
                        id={index === 0 ? fieldProps.id : undefined}
                        type={mask ? 'password' : 'text'}
                        inputMode={type === 'numeric' ? 'numeric' : 'text'}
                        autoComplete={index === 0 ? 'one-time-code' : 'off'}
                        autoCapitalize="off"
                        spellCheck={false}
                        maxLength={length}
                        className={cn('ui-pin-input__cell', char && 'is-filled')}
                        value={char}
                        disabled={disabled}
                        autoFocus={autoFocus && index === 0}
                        aria-label={t('common.controls.characterOf', 'Character {{index}} of {{count}}', { index: index + 1, count: length })}
                        aria-invalid={fieldProps['aria-invalid']}
                        onChange={handleInput(index)}
                        onKeyDown={handleKeyDown(index)}
                        onPaste={handlePaste}
                        onFocus={(event) => {
                            if (index > value.length) focusCell(value.length);
                            else event.target.select();
                        }}
                    />
                </React.Fragment>
            ))}
        </div>
    );
});
PinInput.displayName = 'PinInput';

export { PinInput };
