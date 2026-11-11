import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { buttonVariants } from './buttonVariants';
import { Spinner } from '../Spinner';
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip';

// Why is this button off?
//   disabled because of a missing prerequisite → pass `disabledReason` (short,
//     says what to do: "Install Certbot first"). The button gets aria-disabled
//     instead of the native attribute, so it stays focusable and hoverable and
//     the reason shows in a tooltip (hover, focus, tap) and is read by screen
//     readers. Clicks are swallowed.
//   disabled only while a request runs → use `loading`, no reason needed.

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
  disabled, disabledReason, children, onClick, title, 'aria-describedby': describedBy, ...props
}, ref) => {
  const [open, setOpen] = React.useState(false);
  const reasonId = React.useId();
  const Comp = asChild ? Slot : 'button';
  if (asChild) {
    return (
      <Comp ref={ref} data-slot="button" className={buttonVariants({ variant, size, className })} disabled={disabled} onClick={onClick} title={title} {...props}>
        {children}
      </Comp>
    );
  }
  const reasoned = Boolean(disabled && !loading && disabledReason);
  const text = title && disabledReason ? `${title}: ${disabledReason}` : disabledReason;
  const button = (
    <Comp
      ref={ref}
      data-slot="button"
      className={buttonVariants({ variant, size, className: loading ? `btn-loading ${className || ''}` : className })}
      disabled={reasoned ? undefined : disabled || loading}
      aria-disabled={reasoned || undefined}
      aria-describedby={reasoned ? [describedBy, reasonId].filter(Boolean).join(' ') : describedBy}
      aria-busy={loading || undefined}
      title={reasoned ? undefined : title}
      aria-label={reasoned && title ? title : undefined} // the native title (the name of an icon button) is dropped for the tooltip
      onClick={reasoned ? (e) => { e.preventDefault(); setOpen(true); } : onClick}
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
  if (!reasoned) return button;
  // Tap has no hover: opening on click is what makes the reason reachable on touch.
  // The description sits beside the button, not in it: a child of the button is
  // folded into its accessible name even when aria-hidden.
  return (
    <>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent><span>{text}</span></TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">{text}</span>
    </>
  );
});
Button.displayName = 'Button';

export { Button };
