import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// Right-side slide-over, built on the existing shadcn Sheet (Radix dialog) so
// focus-trap / escape / overlay behavior is consistent. Renders the redesign's
// drawer-head chrome (icon chip + title + subtitle). Use this as the one
// shared drawer pattern instead of the per-feature drawers.
//
//   <Drawer open={open} onOpenChange={setOpen} title="wp-config.php"
//           subtitle="server filesystem" icon={<FileIcon/>} width={760}>
//       …body…
//   </Drawer>
//
// The body is PADDED by default, to the same 18px inset as the header — a
// drawer that forgets to pad itself used to render every field flush against
// the panel edge, and enough of them forgot that the drawers stopped looking
// like one component. Pass `flush` for bodies that own their own regions
// (a form with a pinned footer, a two-pane catalog, an editor, a log tail):
//
//   <Drawer flush …>
//       <form className="sk-formdrawer__form">   ← pads its own scroll region
//           <div className="sk-formdrawer__body">…</div>
//           <footer>…</footer>
//       </form>
//   </Drawer>
export function Drawer({
    open,
    onOpenChange,
    title,
    subtitle,
    icon,
    iconColor,
    width = 720,
    side = 'right',
    headerExtra,
    className,
    bodyClassName,
    flush = false,
    children,
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side={side} className={cn('sk-drawer', className)} style={{ width }}>
                <div className="sk-drawer__head">
                    {icon && (
                        <span className="sk-drawer__ico" style={iconColor ? { color: iconColor } : undefined}>
                            {icon}
                        </span>
                    )}
                    <div>
                        {/* SheetTitle is required by Radix for a11y; keep it as the visible title. */}
                        <SheetTitle className="sk-drawer__title">{title}</SheetTitle>
                        {subtitle && <div className="sk-drawer__sub">{subtitle}</div>}
                    </div>
                    {headerExtra}
                </div>
                <div className={cn('sk-drawer__body', flush && 'sk-drawer__body--flush', bodyClassName)}>
                    {children}
                </div>
            </SheetContent>
        </Sheet>
    );
}

export default Drawer;
