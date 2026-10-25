import { useId, useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { FieldContext } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

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
 */
export function FormField({
    label,
    htmlFor,
    children,
    error,
    hint,
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
            {label && (
                <Label htmlFor={inputId} className={cn('form-field__label', labelClassName)}>
                    {label}
                    {required && <span className="form-field__required" aria-hidden="true">*</span>}
                </Label>
            )}
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
