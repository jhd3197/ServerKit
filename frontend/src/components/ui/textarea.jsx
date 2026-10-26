import * as React from 'react';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn('ui-textarea', className)}
    {...useFieldProps(props)}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
