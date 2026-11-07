import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollEdges, scrollTargetForItem } from '../useScrollTabs.js';

const strip = { containerWidth: 300, scrollWidth: 900 };

test('centres the active tab in the strip', () => {
    assert.equal(scrollTargetForItem({ ...strip, itemLeft: 400, itemWidth: 100 }), 300);
});

test('clamps to the start and end of the strip', () => {
    assert.equal(scrollTargetForItem({ ...strip, itemLeft: 0, itemWidth: 80 }), 0);
    assert.equal(scrollTargetForItem({ ...strip, itemLeft: 820, itemWidth: 80 }), 600);
});

test('a strip that fits never scrolls', () => {
    assert.equal(scrollTargetForItem({ itemLeft: 50, itemWidth: 50, containerWidth: 300, scrollWidth: 200 }), 0);
});

test('edge fades appear only on the sides with hidden content', () => {
    assert.deepEqual(scrollEdges({ ...strip, scrollLeft: 0 }), { start: false, end: true });
    assert.deepEqual(scrollEdges({ ...strip, scrollLeft: 300 }), { start: true, end: true });
    assert.deepEqual(scrollEdges({ ...strip, scrollLeft: 600 }), { start: true, end: false });
    assert.deepEqual(scrollEdges({ containerWidth: 300, scrollWidth: 300, scrollLeft: 0 }), { start: false, end: false });
    // RTL scrolls into negative offsets; the magnitude decides.
    assert.deepEqual(scrollEdges({ ...strip, scrollLeft: -600 }), { start: true, end: false });
});
