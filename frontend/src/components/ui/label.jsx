import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

// `required` appends the same aria-hidden "*" marker FormField draws, for
// labels written outside FormField. The control carries aria-required itself.
function Label({ className, required, children, ...props }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('ui-label', className)}
      {...props}
    >
      {children}
      {required && <span className="form-field__required" aria-hidden="true">*</span>}
    </LabelPrimitive.Root>
  );
}

export { Label };
