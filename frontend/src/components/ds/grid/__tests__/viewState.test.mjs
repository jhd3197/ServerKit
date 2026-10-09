// Proving tests for "is this still the view I picked?" (sameViewState).
//
// Regression pinned here: picking a BUILT-IN view on any ResourceListPage list
// (Services ▸ Running, WordPress ▸ Stopped) showed "Unsaved" immediately. The
// live state always carries the wrapper's page bag ({ filter, search,
// pageSize }) while a built-in view sets none of pageSize, so the page bags
// never compared equal.
//
// Run: node --test src/components/ds/grid/__tests__/viewState.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { sameViewState } from '../viewState.js';

const RUNNING = { match: 'all', rules: [{ id: 'st', field: 'status', op: 'any', value: ['running'] }] };

// What ResourceListPage captures right after a built-in view is applied.
const live = (page) => ({
    sorts: [],
    hiddenKeys: [],
    columnOrder: null,
    groupBy: null,
    columnFilters: { match: 'all', rules: [{ id: 'other-id', field: 'status', op: 'any', value: ['running'] }] },
    page,
});

const BUILTIN = { search: '', sorts: [], hiddenKeys: [], columnFilters: RUNNING };

test('a just-picked built-in view is not dirty', () => {
    assert.equal(sameViewState(live({ filter: undefined, search: undefined, pageSize: 25 }), BUILTIN), true);
    assert.equal(sameViewState(live({ filter: undefined, search: '', pageSize: 25 }), BUILTIN), true);
});

test('typing a search after picking a view that clears it is dirty', () => {
    assert.equal(sameViewState(live({ filter: undefined, search: 'wp', pageSize: 25 }), BUILTIN), false);
});

test('a page size the view saved still counts', () => {
    const saved = { ...BUILTIN, page: { pageSize: 50 } };
    assert.equal(sameViewState(live({ search: '', pageSize: 25 }), saved), false);
    assert.equal(sameViewState(live({ search: '', pageSize: 50 }), saved), true);
});

test('a page key the page retired is not a difference', () => {
    const saved = { ...BUILTIN, page: { bucket: 'old' } };
    assert.equal(sameViewState(live({ search: '', pageSize: 25 }), saved), true);
});

test('a different filter rule is dirty', () => {
    const stopped = { ...BUILTIN, columnFilters: { match: 'all', rules: [{ field: 'status', op: 'none', value: ['running'] }] } };
    assert.equal(sameViewState(live({ pageSize: 25 }), stopped), false);
});
