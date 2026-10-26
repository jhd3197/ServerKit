import { createContext, useContext } from 'react';

// FormField publishes the ids of its label, hint and error here so the control
// inside it can point at them without every call site threading
// `aria-describedby` by hand. Controls read it through useFieldProps().
//
// Overlays (popover, dialog, sheet) reset it to null: their content is a
// portal but still a React child, and a search box inside a picker's popover
// must not claim the field's id.
export const FieldContext = createContext(null);

export function useField() {
    return useContext(FieldContext);
}

/**
 * Merge the surrounding FormField's wiring into a control's props. Explicit
 * props win; `aria-describedby` is joined rather than replaced.
 */
export function useFieldProps(props = {}) {
    const field = useContext(FieldContext);
    if (!field) return props;
    const describedBy = [props['aria-describedby'], field.describedBy]
        .filter(Boolean).join(' ') || undefined;
    return {
        ...props,
        id: props.id ?? field.id,
        'aria-describedby': describedBy,
        'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
        'aria-required': props['aria-required'] ?? (field.required || undefined),
    };
}
