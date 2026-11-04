import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAlertMetric, describeAlert, formatReading } from '../alertCopy.js';

// Minimal i18next stand-in: default string + {{var}} interpolation.
const t = (_key, fallback, vars = {}) => fallback.replace(/{{(\w+)}}/g, (_, k) => vars[k]);
const text = (alert) => JSON.stringify(describeAlert(t, alert));

test('classifies health signals apart from threshold metrics', () => {
    assert.deepEqual(classifyAlertMetric('offline'), { kind: 'offline' });
    assert.deepEqual(classifyAlertMetric('svc:mysql'), { kind: 'service', service: 'mysql' });
    assert.deepEqual(classifyAlertMetric('cpu'), { kind: 'threshold' });
});

test('offline and service alerts never claim a limit or render placeholders', () => {
    const offline = describeAlert(t, { metric: 'offline', value: null, threshold: null, subject: 'web-1' });
    assert.equal(offline.title, 'web-1 is offline');
    const service = describeAlert(t, { metric: 'svc:mysql', value: null, threshold: null, subject: 'web-1' });
    assert.equal(service.title, 'mysql is down on web-1');
    assert.equal(service.detail, 'mysql is not running');
    for (const s of [text({ metric: 'offline', subject: 'x' }), text({ metric: 'svc:a', subject: 'x' })]) {
        assert.doesNotMatch(s, /null|undefined|—|over limit/);
    }
});

test('threshold alerts include the reading when present and omit it when not', () => {
    const full = describeAlert(t, { metric: 'cpu', value: 93.456, threshold: 90, subject: 'db' });
    assert.equal(full.title, 'CPU % over limit on db');
    assert.equal(full.detail, 'CPU % 93.5 of 90 limit');
    const bare = describeAlert(t, { metric: 'disk', value: null, threshold: null, subject: 'db' });
    assert.equal(bare.detail, 'Disk %');
    assert.doesNotMatch(text({ metric: 'memory', subject: 'db' }), /null|undefined|—/);
});

test('unknown or missing metric falls back to a neutral title', () => {
    assert.equal(describeAlert(t, { metric: undefined, subject: 'db' }).title, 'Alert on db');
    assert.equal(formatReading('x'), null);
});
