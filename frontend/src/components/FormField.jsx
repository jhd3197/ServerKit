import { useId, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { FieldContext } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';
import InfoTip from './InfoTip';

/**
 * Standard form field wrapper: label, hint, error message, and input slot.
 *
 *   <FormField label="Email" error="Required" hint="Used for notifications">
 *     <Input ... />
 *   </FormField>
 *
 * The control inside receives the field's id, `aria-describedby` (hint or
 * error), `aria-invalid` and `aria-required` through FieldContext, so a
 * screen reader announces the hint and the validation message with the field.
 * Every control in components/ui reads it; `htmlFor` is only needed when the
 * control already has its own id. One control per field.
 *
 * Required/optional convention (use it everywhere):
 *   - required fields: `required` prop -> red "*" after the label (aria-hidden)
 *     and `aria-required` on the control. Outside FormField, `<Label required>`
 *     draws the same marker.
 *   - optional fields: no marker; where a form mixes both and it helps, the
 *     label may end in "(optional)".
 *   - errors: pass `error` (short, specific). Show it only after the field was
 *     blurred or a submit was attempted (hooks/useFieldErrors.js), never on a
 *     freshly opened dialog.
 */
export function FormField({
    label,
    htmlFor,
    children,
    error,
    hint,
    info,
    required = false,
    className,
    labelClassName,
}) {
    const autoId = useId();
    const inputId = htmlFor || `${autoId}control`;
    const hintId = `${autoId}hint`;
    const errorId = `${autoId}error`;
    const invalid = Boolean(error);
    const showHint = Boolean(hint) && !invalid;

    const field = useMemo(() => ({
        id: inputId,
        describedBy: invalid ? errorId : (showHint ? hintId : undefined),
        invalid,
        required,
    }), [inputId, invalid, showHint, errorId, hintId, required]);

    return (
        <div className={cn('form-field', invalid && 'form-field--invalid', className)}>
            {label && (() => {
                const labelEl = (
                    <Label htmlFor={inputId} required={required} className={cn('form-field__label', labelClassName)}>
                        {label}
                    </Label>
                );
                return info
                    ? <div className="form-field__head">{labelEl}<InfoTip>{info}</InfoTip></div>
                    : labelEl;
            })()}
            <div className="form-field__control">
                <FieldContext.Provider value={field}>
                    {children}
                </FieldContext.Provider>
            </div>
            {showHint && <p id={hintId} className="form-field__hint">{hint}</p>}
            {invalid && <p id={errorId} className="form-field__error" role="alert">{error}</p>}
        </div>
    );
}

/**
 * Horizontal row of form fields. Use for side-by-side inputs.
 *
 *   <FormRow>
 *     <FormField label="First name"><Input ... /></FormField>
 *     <FormField label="Last name"><Input ... /></FormField>
 *   </FormRow>
 */
export function FormRow({ children, className }) {
    return (
        <div className={cn('form-row', className)}>
            {children}
        </div>
    );
}

export default FormField;
