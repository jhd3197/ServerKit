import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetAlertText } from './alertText.js';

const t = (_key, fallback, vars = {}) => fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]);

test('host offline never says "over limit" or prints null', () => {
    const text = fleetAlertText(t, { metric: 'offline', value: null, threshold: null }, 'web-1');
    assert.deepEqual(text, { title: 'Host offline', detail: 'web-1 stopped reporting' });
});

test('service-down alert names the service', () => {
    const text = fleetAlertText(t, { metric: 'svc:mysql', value: null, threshold: null }, 'web-1');
    assert.equal(text.title, 'mysql is down');
    assert.doesNotMatch(text.detail, /null|—|over limit/);
});

test('threshold alert shows reading and limit', () => {
    const text = fleetAlertText(t, { metric: 'cpu', value: 91.234, threshold: 90 }, 'web-1');
    assert.equal(text.title, 'CPU % over limit on web-1');
    assert.equal(text.detail, 'CPU % 91.2 · Limit: 90');
});

test('threshold alert without a limit omits it', () => {
    const text = fleetAlertText(t, { metric: 'disk', value: 50, threshold: null }, 'web-1');
    assert.equal(text.detail, 'Disk % 50.0');
});
