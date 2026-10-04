import assert from 'node:assert/strict';
import test from 'node:test';
import i18next from 'i18next';
import { errorReason, errorText, toastError } from '../errorMessage.js';

// Uninitialised i18next returns undefined; the app initialises it in i18n/index.js.
await i18next.init({ lng: 'en', resources: {} });

function apiError(status, data, message) {
    const err = new Error(message ?? data.error ?? `Request failed (${status}): /api/v1/x`);
    err.status = status;
    err.code = data.code || null;
    err.data = data;
    return err;
}

test('the server reason wins over the generic transport message', () => {
    const err = apiError(409, { error: 'Domain is attached to a service' });
    assert.equal(errorReason(err), 'Domain is attached to a service');
});

test('data.message is used when data.error is absent', () => {
    const err = new Error('Request failed (400): /api/v1/x');
    err.data = { message: 'Port 80 is taken' };
    assert.equal(errorReason(err), 'Port 80 is taken');
});

test('a translated code beats the server English', () => {
    const err = apiError(401, { error: 'Invalid username/email or password', code: 'auth.x' }, 'Contraseña incorrecta');
    assert.equal(errorReason(err), 'Contraseña incorrecta');
});

test('a bare request failure becomes a next step', () => {
    const err = apiError(500, {});
    assert.match(errorReason(err), /server logs/);
    assert.match(errorReason(new TypeError('Failed to fetch')), /didn't respond/);
});

test('result objects and strings carry their reason', () => {
    assert.equal(errorReason({ success: false, error: 'Disk full' }), 'Disk full');
    assert.equal(errorReason('Disk full'), 'Disk full');
    assert.equal(errorReason(null), '');
    assert.equal(errorReason(undefined), '');
});

test('errorText joins what failed and why with sentence stops', () => {
    const err = apiError(400, { error: 'Name is required' });
    assert.equal(errorText("Couldn't save the service.", err), "Couldn't save the service. Name is required.");
    assert.equal(errorText("Couldn't save the service.", null), "Couldn't save the service.");
    assert.equal(errorText("Couldn't save. Name is required.", err), "Couldn't save. Name is required.");
});

test('toastError hands the joined text and options to toast.error', () => {
    const calls = [];
    toastError({ error: (...args) => calls.push(args) }, "Couldn't delete the domain.",
        apiError(404, { error: 'Domain not found' }), { duration: 5000 });
    assert.deepEqual(calls, [["Couldn't delete the domain. Domain not found.", { duration: 5000 }]]);
});
