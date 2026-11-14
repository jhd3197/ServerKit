import {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { LayoutGrid } from 'lucide-react';
import { getWidgetType, useWidgetTypes } from '../widgets/registry';
import {
    GRID_COLS, GRID_GAP, GRID_ROW, pushDown,
} from './layout';
import WidgetFrame from './WidgetFrame';
import { useTranslation } from 'react-i18next';

// Shortest board the host will render, so an empty/short dashboard still has a
// drop target worth aiming at.
const MIN_ROWS = 6;
// Breathing room under the last row so the resize grip is never flush with the
// page edge.
const HOST_PAD = 8;
// Fallback minimum span when a widget type declares none.
const FALLBACK_MIN = [2, 2];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/**
 * The board host. Measures its own width, derives the cell size from
 * GRID_COLS/GRID_GAP, absolutely positions every WidgetFrame, and drives
 * pointer-based move/resize with a live preview of the resulting layout.
 *
 * `onWidgetMenu(action, widget)` receives one of: 'config' | 'dup' | 'full' |
 * 'del' — the host page decides what each one means.
 */
export function DashGrid({
    widgets = [],
    edit = false,
    selectedId = null,
    onSelect,
    onChange,
    ctx,
    onWidgetMenu,
    // Height of one grid row. The home dashboard uses the default; a host can
    // pass a finer row for layouts that need smaller height steps.
    rowHeight = GRID_ROW,
}) {
    const { t } = useTranslation();
    const hostRef = useRef(null);
    const [hostWidth, setHostWidth] = useState(0);
    const [drag, setDrag] = useState(null);
    // Detach function for the in-flight pointer gesture, so a mid-drag unmount
    // (or a pointer released outside the viewport) never leaves listeners behind.
    const detachRef = useRef(null);
    // A host with its own widget types (an entity overview's page blocks)
    // passes them through ctx; the home dashboard uses the registry.
    const registeredTypes = useWidgetTypes();
    const types = ctx?.types || registeredTypes;

    useEffect(() => {
        const element = hostRef.current;
        if (!element) return undefined;
        const measure = () => setHostWidth(element.clientWidth);
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => () => {
        if (detachRef.current) detachRef.current();
    }, []);

    const cell = hostWidth > 0
        ? (hostWidth - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS
        : 0;
    const stepX = cell + GRID_GAP;
    const stepY = rowHeight + GRID_GAP;

    // While dragging we paint the previewed layout instead of the committed one.
    const list = drag ? drag.preview : widgets;
    const rows = Math.max(MIN_ROWS, ...list.map((widget) => widget.y + widget.h));

    const beginGesture = useCallback((event, widget, mode) => {
        if (!edit || cell <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        // A second pointer landing mid-gesture must not orphan the first one's
        // window listeners.
        if (detachRef.current) detachRef.current();

        const originX = event.clientX;
        const originY = event.clientY;
        const base = { ...widget };
        const type = getWidgetType(types, widget.type);
        const [minW, minH] = type?.min || FALLBACK_MIN;
        const handle = event.currentTarget;
        const { pointerId } = event;
        let latest = widgets;

        // Capture so the gesture keeps tracking even when the pointer leaves
        // the handle; the events still bubble up to our window listeners.
        try { handle.setPointerCapture?.(pointerId); } catch { /* capture is best-effort */ }

        const handleMove = (moveEvent) => {
            const dx = Math.round((moveEvent.clientX - originX) / stepX);
            const dy = Math.round((moveEvent.clientY - originY) / stepY);
            const next = mode === 'move'
                ? {
                    ...base,
                    x: clamp(base.x + dx, 0, GRID_COLS - base.w),
                    y: Math.max(0, base.y + dy),
                }
                : {
                    ...base,
                    w: Math.max(minW, Math.min(GRID_COLS - base.x, base.w + dx)),
                    h: Math.max(minH, base.h + dy),
                };
            latest = pushDown(widgets, next);
            setDrag({ mode, id: widget.i, preview: latest });
        };

        const detach = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', finishGesture);
            window.removeEventListener('pointercancel', finishGesture);
            try { handle.releasePointerCapture?.(pointerId); } catch { /* already released */ }
            detachRef.current = null;
        };

        function finishGesture() {
            detach();
            setDrag(null);
            if (latest !== widgets) onChange?.(latest);
        }

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', finishGesture);
        window.addEventListener('pointercancel', finishGesture);
        detachRef.current = detach;

        setDrag({ mode, id: widget.i, preview: widgets });
        onSelect?.(widget.i);
    }, [edit, cell, stepX, stepY, types, widgets, onChange, onSelect]);

    // Only the cell maths is inline; `position` and the settle transition are
    // owned by `.skw-grid > .skw-frame` (and killed by `.skw-grid--dragging`).
    const frameStyle = useCallback((widget) => ({
        left: widget.x * stepX,
        top: widget.y * stepY,
        width: widget.w * cell + (widget.w - 1) * GRID_GAP,
        height: widget.h * rowHeight + (widget.h - 1) * GRID_GAP,
        zIndex: drag?.id === widget.i ? 5 : 1,
    }), [drag, cell, stepX, stepY, rowHeight]);

    const hostClassName = useMemo(() => [
        'skw-grid',
        edit && 'skw-grid--edit',
        drag && 'skw-grid--dragging',
    ].filter(Boolean).join(' '), [edit, drag]);

    return (
        <div
            ref={hostRef}
            className={hostClassName}
            style={{ height: rows * rowHeight + (rows - 1) * GRID_GAP + HOST_PAD }}
            onMouseDown={(event) => {
                if (edit && event.target === event.currentTarget) onSelect?.(null);
            }}
        >
            {edit && (
                <div
                    className="skw-grid__ghost"
                    aria-hidden="true"
                    style={{ backgroundSize: `${stepX}px ${stepY}px` }}
                />
            )}

            {cell > 0 && list.map((widget) => (
                <WidgetFrame
                    key={widget.i}
                    widget={widget}
                    type={getWidgetType(types, widget.type)}
                    ctx={ctx}
                    edit={edit}
                    selected={selectedId === widget.i}
                    onSelect={onSelect}
                    onMenu={onWidgetMenu}
                    onDragStart={(event, target) => beginGesture(event, target, 'move')}
                    onResizeStart={(event, target) => beginGesture(event, target, 'resize')}
                    style={frameStyle(widget)}
                />
            ))}

            {list.length === 0 && (
                <div className="skw-grid__empty">
                    <LayoutGrid size={22} aria-hidden="true" />
                    <div>{t('app.dashGrid.noWidgetsOnThisDashboardYet', 'No widgets on this dashboard yet.')}</div>
                </div>
            )}
        </div>
    );
}

export default DashGrid;
