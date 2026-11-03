import assert from 'node:assert/strict';
import test from 'node:test';

import { isPlaceholderServerName } from './serverDetailData.js';

test('backend placeholder names are detected', () => {
    assert.equal(isPlaceholderServerName('Pending pairing (342ade51)'), true);
});

test('real names are left alone', () => {
    assert.equal(isPlaceholderServerName('web-01'), false);
    assert.equal(isPlaceholderServerName('Pending pairing'), false);
    assert.equal(isPlaceholderServerName(undefined), false);
});
