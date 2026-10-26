import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { FieldContext } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

// The panel is outside the field that opened it: reset FieldContext so an
// input inside (a search box, a time input) does not take the field's id.
const PopoverContent = React.forwardRef(({ className, align = 'center', sideOffset = 4, children, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn('ui-popover-panel', className)}
      {...props}
    >
      <FieldContext.Provider value={null}>{children}</FieldContext.Provider>
    </PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
