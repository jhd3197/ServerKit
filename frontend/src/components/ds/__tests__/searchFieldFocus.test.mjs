import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { isExternalReset } from '../searchFieldSync.js';

// The parent echoing the debounced query back must not resync the input —
// that dropped keystrokes typed while the request was in flight ("word" → "wrd").
test('an echo of the last emitted query is not a reset', () => {
    assert.equal(isExternalReset('wor', 'wor'), false);
});

test('a programmatic change (Reset filters) is a reset', () => {
    assert.equal(isExternalReset('', 'wor'), true);
});

// No jsdom here, so guard the structural root cause instead: a search-driven
// fetch must never swap the Templates tree (and with it the toolbar) out.
test('Templates keeps its toolbar mounted while loading', () => {
    const src = readFileSync(new URL('../../../pages/Templates.jsx', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\n\s+if \(loading\) \{\s*\n\s+return/);
    assert.match(src, /aria-busy=\{loading\}/);
});
