import { useCallback, useEffect } from 'react';

const ACTIVE_SELECTOR = '[aria-selected="true"], [aria-current], [data-state="active"], .active';
const FADE_THRESHOLD = 2; // px of slack before an edge counts as "more to scroll"

/**
 * Where to put scrollLeft so an item sits centred in a horizontally scrolling
 * strip, clamped to the strip's range. Pure so it is testable without a DOM.
 */
export function scrollTargetForItem({ itemLeft, itemWidth, containerWidth, scrollWidth }) {
    const centred = itemLeft + itemWidth / 2 - containerWidth / 2;
    return Math.max(0, Math.min(centred, Math.max(0, scrollWidth - containerWidth)));
}

/** Which edges still have hidden content (drives the fade masks). */
export function scrollEdges({ scrollLeft, containerWidth, scrollWidth }) {
    // scrollLeft is negative in RTL; the magnitude is what matters for both ends.
    const offset = Math.abs(scrollLeft);
    return {
        start: offset > FADE_THRESHOLD,
        end: offset + containerWidth < scrollWidth - FADE_THRESHOLD,
    };
}

/**
 * Shared behaviour for every horizontally scrolling tab strip (pair it with the
 * `.sk-tabscroll` class): the active tab is scrolled into view on mount and
 * whenever the active marker moves (aria-selected / data-state / .active) or
 * the tabs themselves change, and `data-fade-start` / `data-fade-end` mirror which
 * edges have more to reveal so the stylesheet can fade them.
 *
 * Only the strip scrolls — `scrollTo` on the container never moves the page.
 */
export function useScrollTabs(ref, enabled = true) {
    const syncEdges = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const { start, end } = scrollEdges({
            scrollLeft: el.scrollLeft,
            containerWidth: el.clientWidth,
            scrollWidth: el.scrollWidth,
        });
        el.toggleAttribute('data-fade-start', start);
        el.toggleAttribute('data-fade-end', end);
    }, [ref]);

    const revealActive = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const active = el.querySelector(ACTIVE_SELECTOR);
        if (!active) return;
        const box = el.getBoundingClientRect();
        const item = active.getBoundingClientRect();
        const rtl = getComputedStyle(el).direction === 'rtl';
        // Item offset within the scroll content, independent of current scroll.
        const itemLeft = rtl
            ? box.right - item.right + Math.abs(el.scrollLeft)
            : item.left - box.left + el.scrollLeft;
        const target = scrollTargetForItem({
            itemLeft, itemWidth: item.width, containerWidth: el.clientWidth, scrollWidth: el.scrollWidth,
        });
        el.scrollTo({ left: rtl ? -target : target });
    }, [ref]);

    useEffect(() => {
        const el = ref.current;
        if (!enabled || !el) return undefined;
        revealActive();
        syncEdges();
        el.addEventListener('scroll', syncEdges, { passive: true });
        const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncEdges);
        resize?.observe(el);
        const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
            revealActive();
            syncEdges();
        });
        mutations?.observe(el, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['aria-selected', 'aria-current', 'data-state', 'class'],
        });
        return () => {
            el.removeEventListener('scroll', syncEdges);
            resize?.disconnect();
            mutations?.disconnect();
        };
    }, [ref, enabled, revealActive, syncEdges]);
}
