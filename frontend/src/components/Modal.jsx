import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Generic modal built on the Radix Dialog primitive. SCSS owns all geometry
// (styles/components/_ui.scss → .sk-modal*). `size` picks a max-width on
// >=sm screens; mobile is always near full-width.
//
// Small screens: height is capped in dvh so the modal fits the visible
// viewport (browser bars / on-screen keyboard); on phones header/body/footer
// padding drops to 16px. A trailing .modal-actions / .modal-footer /
// .form-actions row hand-rolled inside the body (forms inside the body) sticks
// to the bottom of the scrolling body, and a nested .modal-body adds no extra
// padding or scroller. Two-column .form-row stacks in narrow modals.
//
// Form mode: pass `onSubmit` and the body AND footer
// are wrapped in one <form>. This exists because a submit button must live
// inside the form it submits — without it, every modal with a form had to
// bypass `footer` and hand-roll its own footer row inside the body, which is
// why 28 files stopped using this prop. Form mode also gets Enter-to-submit
// for free, which the hand-rolled footers did not have.
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  onSubmit,
  className = '',
  size = 'md',
}) {
  const body = (
    <>
      <div className="sk-modal__body">{children}</div>
      {footer && <div className="sk-modal__footer">{footer}</div>}
    </>
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(event);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn('sk-modal', `sk-modal--${size}`, className)}>
        {title && (
          <div className="sk-modal__header">
            <DialogTitle>{title}</DialogTitle>
          </div>
        )}

        {onSubmit
          ? <form className="sk-modal__form" onSubmit={handleSubmit} noValidate>{body}</form>
          : body}
      </DialogContent>
    </Dialog>
  );
}
