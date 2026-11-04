import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn('ui-sheet-overlay', className)}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const SheetContent = React.forwardRef(({ side = 'right', className, overlayClassName, children, ...props }, ref) => {
  const { t } = useTranslation();
  return (
  <SheetPortal>
    <SheetOverlay className={overlayClassName} />
    <SheetPrimitive.Content
      ref={ref}
      className={cn('ui-sheet-content', `ui-sheet-content--${side}`, className)}
      {...props}
    >
      <SheetPrimitive.Close className="ui-sheet-close">
        <X />
        <span className="sr-only">{t('common.actions.close', 'Close')}</span>
      </SheetPrimitive.Close>
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

// Bare modal panel for legacy hand-rolled drawers that own their own chrome and
// CSS: Radix supplies role=dialog, aria-modal, focus trap, focus restore and
// Escape; the caller supplies the classes and an element carrying the title.
function SheetPanel({ onClose, overlayClassName, className, label, children }) {
  return (
    <SheetPrimitive.Root open onOpenChange={(v) => !v && onClose()}>
      <SheetPortal>
        <SheetPrimitive.Overlay className={overlayClassName} />
        <SheetPrimitive.Content className={className} aria-label={label} aria-describedby={undefined}>
          {children}
        </SheetPrimitive.Content>
      </SheetPortal>
    </SheetPrimitive.Root>
  );
}
SheetPanel.displayName = 'SheetPanel';

function SheetHeader({ className, ...props }) {
  return <div className={cn('ui-sheet-header', className)} {...props} />;
}
SheetHeader.displayName = 'SheetHeader';

function SheetFooter({ className, ...props }) {
  return <div className={cn('ui-sheet-footer', className)} {...props} />;
}
SheetFooter.displayName = 'SheetFooter';

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn('ui-sheet-title', className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn('ui-sheet-description', className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetPanel, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
