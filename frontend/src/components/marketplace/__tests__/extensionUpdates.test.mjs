import assert from 'node:assert/strict';
import test from 'node:test';

import {
    countUpdatable, indexUpdates, isUpdatable, minutesSince, partitionUpdates, versionLabel,
} from '../extensionUpdates.js';

const u = (over) => ({
    plugin_id: 1, slug: 'a', installed_version: '1.0.0', available_version: '1.1.0',
    update_available: true, compatible: true, requires_ack: false, ...over,
});

test('only compatible updates count', () => {
    const list = [u(), u({ plugin_id: 2, compatible: false }), u({ plugin_id: 3, update_available: false })];
    assert.equal(countUpdatable(list), 1);
    assert.equal(isUpdatable(list[1]), false);
    assert.equal(countUpdatable(undefined), 0);
});

test('partition splits ready / review / incompatible and drops non-updates', () => {
    const p = partitionUpdates([
        u({ plugin_id: 1 }),
        u({ plugin_id: 2, requires_ack: true }),
        u({ plugin_id: 3, compatible: false }),
        u({ plugin_id: 4, update_available: false }),
    ]);
    assert.deepEqual(p.ready.map((x) => x.plugin_id), [1]);
    assert.deepEqual(p.review.map((x) => x.plugin_id), [2]);
    assert.deepEqual(p.incompatible.map((x) => x.plugin_id), [3]);
});

test('version label and index', () => {
    assert.equal(versionLabel(u()), 'v1.0.0 → v1.1.0');
    const idx = indexUpdates([u({ plugin_id: 7, slug: 'x' })]);
    assert.equal(idx.get('7'), idx.get('x'));
});

test('minutesSince', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    assert.equal(minutesSince('2026-01-01T00:00:00Z', now), 10);
    assert.equal(minutesSince('2026-01-01T00:20:00Z', now), 0);
    assert.equal(minutesSince('nope', now), null);
    assert.equal(minutesSince(null, now), null);
});
