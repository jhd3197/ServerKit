import assert from 'node:assert/strict';
import test from 'node:test';

import { createPrimaryActionStore } from './pagePrimaryActionStore.js';

test('register publishes the action and release clears it', () => {
    const store = createPrimaryActionStore();
    let notified = 0;
    store.subscribe(() => { notified += 1; });

    const release = store.register({ id: 'a', label: 'Add' });
    assert.equal(store.get().label, 'Add');
    release();
    assert.equal(store.get(), null);
    assert.equal(notified, 2);
});

test('a stale release does not clear a newer registration', () => {
    const store = createPrimaryActionStore();
    const first = store.register({ id: 'a', label: 'One' });
    store.register({ id: 'a', label: 'Two' });
    first();
    assert.equal(store.get().label, 'Two');
});

test('releasing the later claim restores the earlier one', () => {
    const store = createPrimaryActionStore();
    store.register({ id: 'a', label: 'One' });
    const second = store.register({ id: 'b', label: 'Two' });
    assert.equal(store.get().label, 'Two');
    second();
    assert.equal(store.get().label, 'One');
});

test('releasing the earlier claim keeps the later one', () => {
    const store = createPrimaryActionStore();
    const first = store.register({ id: 'a', label: 'One' });
    store.register({ id: 'b', label: 'Two' });
    first();
    assert.equal(store.get().label, 'Two');
    assert.equal(store.get(), store.get());
});
