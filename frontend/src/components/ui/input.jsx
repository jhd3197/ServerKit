import * as React from 'react';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

// forwardRef so composed controls (TagInput, NumberField) and callers can
// focus the element; a plain function component silently drops `ref`.
const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    data-slot="input"
    className={cn('ui-input', className)}
    {...useFieldProps(props)}
  />
));
Input.displayName = 'Input';

export { Input };
