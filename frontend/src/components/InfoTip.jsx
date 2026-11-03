import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { t } from '../i18n/t';

// An (i) button that holds the explanation a page used to print inline.
// Mouse: hover/focus previews it. Touch, click, Enter and Space: toggles a
// pinned popover that closes on outside tap or Escape. The panel is portalled
// (no button-in-button) and above Modal/Sheet (.info-tip__panel z-index).
export default function InfoTip({ children, label, side = 'top', size = 'sm', className = '' }) {
    const [open, setOpen] = useState(false);
    const pinned = useRef(false);
    const hoverable = (e) => e.pointerType === 'mouse';

    const onOpenChange = (next) => {
        pinned.current = next;
        setOpen(next);
    };
    const stop = (e) => e.stopPropagation();

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                {/* eslint-disable-next-line no-restricted-syntax -- bare 18px glyph button; Button/IconButton add control-sized chrome and a nested Tip */}
                <button
                    type="button"
                    className={`info-tip info-tip--${size} ${className}`.trim()}
                    aria-label={label || t('common.moreInfo', 'More info')}
                    onClick={stop}
                    onPointerEnter={(e) => { if (hoverable(e)) setOpen(true); }}
                    onPointerLeave={(e) => { if (hoverable(e) && !pinned.current) setOpen(false); }}
                    onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
                    onBlur={() => { if (!pinned.current) setOpen(false); }}
                >
                    <Info aria-hidden="true" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                side={side}
                className="info-tip__panel"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                onClick={stop}
            >
                {children}
            </PopoverContent>
        </Popover>
    );
}
