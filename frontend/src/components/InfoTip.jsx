import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from '@/components/ui/sheet';
import useMediaQuery from '../hooks/useMediaQuery';
import { t } from '../i18n/t';

// An (i) button that holds the explanation a page used to print inline.
// Mouse: hover/focus previews it. Touch and click toggle a pinned popover that
// closes on outside tap or Escape. Keyboard: Enter/Space on an unpinned preview
// pins it open; on a pinned tip they toggle it closed. Narrow screens get a
// bottom sheet instead, so the text never sits on top of the content it
// explains. Both are portalled (no button-in-button) and above Modal/Sheet.
// Placement: put it right after the label/heading text it explains, inside
// the same element (separate it with a plain space, or let the flex gap do it),
// never on its own line. Standard: ~4px after the text, centred on that line.
// `trigger` replaces the (i) glyph (e.g. a whole step pill); `title` heads the sheet.
export default function InfoTip({ children, label, title, trigger, side = 'top', size = 'sm', className = '' }) {
    const [open, setOpen] = useState(false);
    const narrow = useMediaQuery('(max-width: 640px)');
    const pinned = useRef(false);
    const pinnedByKey = useRef(false);
    const hoverable = (e) => e.pointerType === 'mouse';

    // preventDefault skips Radix's toggle (it honours defaultPrevented); Space
    // also clicks on keyup, so that one is swallowed too.
    const onKeyDown = (e) => {
        if ((e.key !== 'Enter' && e.key !== ' ') || !open || pinned.current) return;
        e.preventDefault();
        pinned.current = true;
        pinnedByKey.current = e.key === ' ';
    };
    const onKeyUp = (e) => {
        if (e.key === ' ' && pinnedByKey.current) {
            e.preventDefault();
            pinnedByKey.current = false;
        }
    };

    const onOpenChange = (next) => {
        pinned.current = next;
        setOpen(next);
    };
    const stop = (e) => e.stopPropagation();
    const noFocus = (e) => e.preventDefault();

    const button = (
        // eslint-disable-next-line no-restricted-syntax -- bare 18px glyph button; Button/IconButton add control-sized chrome and a nested Tip
        <button
            type="button"
            className={(trigger ? className : `info-tip info-tip--${size} ${className}`).trim()}
            aria-label={trigger ? label : (label || t('common.moreInfo', 'More info'))}
            onClick={stop}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onPointerEnter={(e) => { if (hoverable(e)) setOpen(true); }}
            onPointerLeave={(e) => { if (hoverable(e) && !pinned.current) setOpen(false); }}
            onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
            onBlur={() => { if (!pinned.current) setOpen(false); }}
        >
            {trigger || <Info aria-hidden="true" />}
        </button>
    );

    if (narrow) {
        return (
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetTrigger asChild>{button}</SheetTrigger>
                <SheetContent
                    side="bottom"
                    className="info-tip__sheet"
                    overlayClassName="info-tip__overlay"
                    aria-describedby={undefined}
                    onOpenAutoFocus={noFocus}
                    onCloseAutoFocus={noFocus}
                    onClick={stop}
                >
                    <SheetTitle className="info-tip__sheet-title">{title || label || t('common.moreInfo', 'More info')}</SheetTitle>
                    <div className="info-tip__sheet-body">{children}</div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
            <PopoverContent
                side={side}
                avoidCollisions
                collisionPadding={8}
                className="info-tip__panel"
                onOpenAutoFocus={noFocus}
                onCloseAutoFocus={noFocus}
                onClick={stop}
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}
