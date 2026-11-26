import assert from 'node:assert/strict';
import test from 'node:test';

import { createSingleFlight } from '../singleFlight.js';
import { dismissGuards } from '../../components/ui/dismissGuards.js';

test('single flight refuses a second call before the first settles', async () => {
    const run = createSingleFlight();
    let calls = 0;
    let release;
    const first = run(() => { calls += 1; return new Promise((r) => { release = r; }); });
    assert.equal(await run(() => { calls += 1; }), undefined);
    release('done');
    assert.equal(await first, 'done');
    assert.equal(calls, 1);
    await run(() => { calls += 1; });
    assert.equal(calls, 2);
});

test('single flight unlocks after a failure', async () => {
    const run = createSingleFlight();
    await assert.rejects(run(() => { throw new Error('x'); }));
    assert.equal(await run(() => 'ok'), 'ok');
});

test('dismiss guards only block overlay and Escape when asked', () => {
    assert.deepEqual(dismissGuards(), {});
    const g = dismissGuards(false);
    for (const key of ['onPointerDownOutside', 'onInteractOutside', 'onEscapeKeyDown']) {
        let prevented = false;
        g[key]({ preventDefault: () => { prevented = true; } });
        assert.ok(prevented, key);
    }
});
