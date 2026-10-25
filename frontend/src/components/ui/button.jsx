import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { buttonVariants } from './buttonVariants';
import { Spinner } from '../Spinner';

// forwardRef is load-bearing, not ceremony: every Radix trigger used as
// `<PopoverTrigger asChild><Button/></PopoverTrigger>` hands the button a ref
// and uses that element as the popper's anchor. Without it React drops the ref
// ("Function components cannot be given refs … Primitive.button.SlotClone"),
// floating-ui never gets a reference element, and the panel is left parked at
// its pre-position `translate(0, -200%)` — open, focusable and completely
// off-screen. That is why Sort/Columns/Views/Filter looked like dead buttons.
//
// `loading` keeps the label in the layout (transparent, .btn-loading in
// _spinner.scss) and centres a spinner over it, so a Save button does not
// change width mid-click and the row around it does not jump. The button is
// disabled and aria-busy while it lasts; `loadingText` replaces the
// accessible name ("Saving…") when the visible label would lie.
const Button = React.forwardRef(({
  className, variant, size, asChild = false, loading = false, loadingText,
  disabled, children, ...props
}, ref) => {
  const Comp = asChild ? Slot : 'button';
  if (asChild) {
    return (
      <Comp ref={ref} data-slot="button" className={buttonVariants({ variant, size, className })} disabled={disabled} {...props}>
        {children}
      </Comp>
    );
  }
  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={buttonVariants({ variant, size, className: loading ? `btn-loading ${className || ''}` : className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="btn__label" aria-hidden={loadingText ? true : undefined}>{children}</span>
          <Spinner size="sm" />
          {loadingText && <span className="sr-only">{loadingText}</span>}
        </>
      ) : children}
    </Comp>
  );
});
Button.displayName = 'Button';

export { Button };
