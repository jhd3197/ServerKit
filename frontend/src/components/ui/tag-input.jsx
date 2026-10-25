import * as React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-tag-input*).

// How long an existing chip flashes when its duplicate is typed again.
const DUPLICATE_FLASH_MS = 900;
const PASTE_SPLIT = /[\s,;]+/;

/**
 * Free-form list of short values: domains, IPs, tags, header names.
 *
 *   <TagInput value={aliases} onChange={setAliases} placeholder="Add a domain" />
 *   <TagInput value={ips} onChange={setIps} validate={(v) => isIp(v) ? null : 'Not an IP'} />
 *
 * Enter, comma or Tab (with text) adds the typed value; pasting a list splits
 * on commas, spaces and newlines. Backspace in an empty box removes the last
 * chip. `validate` returns an error string to reject a value (it stays in the
 * box, marked invalid). A duplicate is not added; its chip flashes instead.
 */
const TagInput = React.forwardRef(({
    value = [],
    onChange,
    validate,
    normalize = (text) => text.trim(),
    max,
    placeholder,
    disabled = false,
    size,
    className,
    onBlur,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const fieldProps = useFieldProps(props);
    const inputRef = React.useRef(null);
    React.useImperativeHandle(ref, () => inputRef.current);
    const [text, setText] = React.useState('');
    const [error, setError] = React.useState(null);
    const [flash, setFlash] = React.useState(null);
    const flashTimer = React.useRef(null);
    const errorId = React.useId();
    React.useEffect(() => () => clearTimeout(flashTimer.current), []);

    const full = Number.isFinite(max) && value.length >= max;

    const flashChip = (item) => {
        clearTimeout(flashTimer.current);
        setFlash(item);
        flashTimer.current = setTimeout(() => setFlash(null), DUPLICATE_FLASH_MS);
    };

    // Add every candidate it can; return the ones that failed so they stay typed.
    const add = (candidates) => {
        const next = [...value];
        let rejected = null;
        for (const raw of candidates) {
            const item = normalize(raw);
            if (!item) continue;
            if (next.includes(item)) { flashChip(item); continue; }
            if (Number.isFinite(max) && next.length >= max) { rejected = { raw, message: null }; break; }
            const message = validate?.(item, next) || null;
            if (message) { rejected = { raw, message }; break; }
            next.push(item);
        }
        if (next.length !== value.length) onChange?.(next);
        setError(rejected?.message || null);
        return rejected ? rejected.raw : '';
    };

    const removeAt = (index) => {
        onChange?.(value.filter((_, i) => i !== index));
        inputRef.current?.focus();
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && text.trim())) {
            if (!text.trim()) { if (event.key !== 'Tab') event.preventDefault(); return; }
            event.preventDefault();
            setText(add([text]));
        } else if (event.key === 'Backspace' && !text && value.length) {
            event.preventDefault();
            onChange?.(value.slice(0, -1));
        } else if (event.key === 'Escape' && text) {
            setText('');
            setError(null);
        }
    };

    const handlePaste = (event) => {
        const pasted = event.clipboardData.getData('text');
        if (!PASTE_SPLIT.test(pasted.trim())) return;   // a single value pastes normally
        event.preventDefault();
        setText(add(pasted.split(PASTE_SPLIT)));
    };

    const invalid = fieldProps['aria-invalid'] || Boolean(error) || undefined;
    const describedBy = [fieldProps['aria-describedby'], error && errorId].filter(Boolean).join(' ') || undefined;

    return (
        <div className="ui-tag-input-field">
            <div
                className={cn(
                    'ui-tag-input',
                    size === 'sm' && 'ui-tag-input--sm',
                    invalid && 'is-invalid',
                    disabled && 'is-disabled',
                    className,
                )}
                onClick={(event) => { if (event.target === event.currentTarget) inputRef.current?.focus(); }}
            >
                {value.map((item, index) => (
                    <span key={item} className={cn('ui-tag-input__chip', flash === item && 'is-flashing')}>
                        <span className="ui-tag-input__chip-label">{item}</span>
                        {!disabled && (
                            <Button variant="unstyled"
                                type="button"
                                tabIndex={-1}
                                className="ui-tag-input__chip-remove"
                                aria-label={t('common.controls.removeItem', 'Remove {{label}}', { label: item })}
                                onClick={() => removeAt(index)}
                            >
                                <X aria-hidden="true" />
                            </Button>
                        )}
                    </span>
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    className="ui-tag-input__input"
                    value={text}
                    disabled={disabled || full}
                    placeholder={full ? '' : placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    {...fieldProps}
                    aria-invalid={invalid}
                    aria-describedby={describedBy}
                    onChange={(event) => { setText(event.target.value); if (error) setError(null); }}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onBlur={(event) => {
                        if (text.trim()) setText(add([text]));
                        onBlur?.(event);
                    }}
                />
            </div>
            {error && <p id={errorId} className="ui-tag-input__error" role="alert">{error}</p>}
        </div>
    );
});
TagInput.displayName = 'TagInput';

export { TagInput };
