import { useEffect, useRef, useState } from 'react';
import {
    Copy, GripVertical, Maximize2, MoreVertical, SlidersHorizontal, Trash2,
} from 'lucide-react';
import { WidgetBody } from '../widgets/renderers';
import { deriveWidgetTitle } from '../widgets/registry';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Chrome around one placed widget: a header (drag handle + title + actions),
// the renderer body, and — in edit mode — the bottom-right resize grip.
// Positioning is owned by DashGrid and arrives through `style`.
export function WidgetFrame({
    widget,
    type,
    ctx,
    edit = false,
    selected = false,
    onSelect,
    onMenu,
    onDragStart,
    onResizeStart,
    style,
}) {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    // Close the overflow menu on any outside pointer press or Escape. Bound
    // only while the menu is open, and always torn down.
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onPointerDown = (event) => {
            if (!menuRef.current || !menuRef.current.contains(event.target)) setMenuOpen(false);
        };
        const onKeyDown = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [menuOpen]);

    const title = deriveWidgetTitle(widget, type);
    const fire = (action) => {
        setMenuOpen(false);
        onMenu?.(action, widget);
    };

    const className = [
        'skw-frame',
        // A bare widget is its own card (a KPI tile): no header outside edit
        // mode, where the header is still needed as the drag handle.
        type?.bare && 'skw-frame--bare',
        edit && 'skw-frame--edit',
        selected && 'skw-frame--selected',
    ].filter(Boolean).join(' ');

    return (
        <div
            className={className}
            style={style}
            onMouseDown={() => { if (edit) onSelect?.(widget.i); }}
        >
            <div
                className="skw-frame__head"
                onPointerDown={(event) => {
                    if (edit && !event.target.closest('button')) onDragStart?.(event, widget);
                }}
            >
                {edit && (
                    <span className="skw-frame__grip" aria-hidden="true">
                        <GripVertical size={13} />
                    </span>
                )}
                <span className="skw-frame__title" title={title}>{title}</span>
                {widget.type === 'logs' && <span className="skw-frame__live" aria-hidden="true" />}
                <div className="skw-frame__actions">
                    {edit && (
                        <SharedButton variant="unstyled"
                            type="button"
                            className="skw-iconbtn skw-iconbtn--bare"
                            title={t('app.widgetFrame.configureWidget', 'Configure widget')}
                            aria-label={t('app.widgetFrame.configureWidget', 'Configure widget')}
                            onClick={(event) => { event.stopPropagation(); fire('config'); }}
                        >
                            <SlidersHorizontal size={13} />
                        </SharedButton>
                    )}
                    <SharedButton variant="unstyled"
                        type="button"
                        className="skw-iconbtn skw-iconbtn--bare"
                        title={t('app.widgetFrame.viewFullscreen', 'View fullscreen')}
                        aria-label={t('app.widgetFrame.viewFullscreen', 'View fullscreen')}
                        onClick={(event) => { event.stopPropagation(); fire('full'); }}
                    >
                        <Maximize2 size={13} />
                    </SharedButton>
                    <div className="skw-frame__menu-wrap" ref={menuRef}>
                        <SharedButton variant="unstyled"
                            type="button"
                            className="skw-iconbtn skw-iconbtn--bare"
                            title={t('app.widgetFrame.widgetMenu', 'Widget menu')}
                            aria-label={t('app.widgetFrame.widgetMenu', 'Widget menu')}
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                            onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}
                        >
                            <MoreVertical size={14} />
                        </SharedButton>
                        {menuOpen && (
                            <div className="skw-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                                <SharedButton variant="unstyled" type="button" className="skw-menu__item" role="menuitem" onClick={() => fire('config')}>
                                    <span className="skw-menu__ic"><SlidersHorizontal size={14} /></span>
                                    {t('app.widgetFrame.configure', 'Configure')}
                                </SharedButton>
                                <SharedButton variant="unstyled" type="button" className="skw-menu__item" role="menuitem" onClick={() => fire('dup')}>
                                    <span className="skw-menu__ic"><Copy size={14} /></span>
                                    {t('app.widgetFrame.duplicate', 'Duplicate')}
                                </SharedButton>
                                <SharedButton variant="unstyled" type="button" className="skw-menu__item" role="menuitem" onClick={() => fire('full')}>
                                    <span className="skw-menu__ic"><Maximize2 size={14} /></span>
                                    {t('app.widgetFrame.viewFullscreen', 'View fullscreen')}
                                </SharedButton>
                                <div className="skw-menu__sep" role="separator" />
                                <SharedButton variant="unstyled"
                                    type="button"
                                    className="skw-menu__item skw-menu__item--danger"
                                    role="menuitem"
                                    onClick={() => fire('del')}
                                >
                                    <span className="skw-menu__ic"><Trash2 size={14} /></span>
                                    {t('common.actions.remove', 'Remove')}
                                </SharedButton>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="skw-frame__body">
                <WidgetBody widget={widget} ctx={ctx} />
            </div>

            {edit && (
                // Pointer-only affordance; the keyboard path to resizing is the
                // inspector's width/height steppers.
                <span
                    className="skw-frame__resize"
                    aria-hidden="true"
                    onPointerDown={(event) => onResizeStart?.(event, widget)}
                />
            )}
        </div>
    );
}

export default WidgetFrame;
