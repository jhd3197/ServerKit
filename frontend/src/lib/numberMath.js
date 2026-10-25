// Pure number helpers behind NumberField and Slider. Kept out of the
// components so the rounding rules are unit-tested (lib/__tests__).

/** Decimal places of a step: 0.25 -> 2, 1 -> 0, 1e-3 -> 3. */
export function decimalsOf(step) {
    if (!Number.isFinite(step)) return 0;
    const text = String(step);
    if (text.includes('e-')) return Number(text.split('e-')[1]);
    const dot = text.indexOf('.');
    return dot === -1 ? 0 : text.length - dot - 1;
}

export function clamp(value, min, max) {
    let next = value;
    if (Number.isFinite(min) && next < min) next = min;
    if (Number.isFinite(max) && next > max) next = max;
    return next;
}

/**
 * Snap to the step grid anchored at `min` (or 0), then round away float
 * noise: 0.1 + 0.2 lands on 0.3, not 0.30000000000000004.
 */
export function snapToStep(value, step = 1, min) {
    if (!Number.isFinite(value)) return value;
    if (!Number.isFinite(step) || step <= 0) return value;
    const base = Number.isFinite(min) ? min : 0;
    const snapped = base + Math.round((value - base) / step) * step;
    const places = Math.max(decimalsOf(step), decimalsOf(base));
    return Number(snapped.toFixed(places));
}

/** Clamp, then snap, then clamp again (snapping can step past a bound). */
export function normalizeNumber(value, { min, max, step = 1 } = {}) {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return clamp(snapToStep(clamp(value, min, max), step, min), min, max);
}

/**
 * One step from `value` in `direction` (+1 / -1), `multiplier` steps at a
 * time. An empty field starts from the bound it moves away from, so "+" on
 * an empty 1..10 field gives 1, not 0 clamped up.
 */
export function stepNumber(value, direction, { min, max, step = 1, multiplier = 1 } = {}) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        if (direction > 0) return Number.isFinite(min) ? min : normalizeNumber(0, { min, max, step });
        return Number.isFinite(max) ? max : normalizeNumber(0, { min, max, step });
    }
    return normalizeNumber(value + direction * step * multiplier, { min, max, step });
}

/** What may be typed so far: '', '-', '1.', '-0.5' are all mid-entry states. */
export function isPartialNumber(text, { allowNegative = true, allowDecimal = true } = {}) {
    const sign = allowNegative ? '-?' : '';
    const fraction = allowDecimal ? '(\\.\\d*)?' : '';
    return new RegExp(`^${sign}\\d*${fraction}$`).test(text);
}

/** Parse typed text; null for empty or a lone sign/point. */
export function parseNumber(text) {
    if (text === '' || text === '-' || text === '.' || text === '-.') return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}
