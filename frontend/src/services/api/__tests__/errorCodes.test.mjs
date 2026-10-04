import test from 'node:test';
import assert from 'node:assert/strict';
import i18next from 'i18next';
import { translateServerError } from '../errorCodes.js';

// An empty English bundle makes every t() return its inline default, so these
// assertions read the registry's English: the same text en.json is built from.
await i18next.init({ lng: 'en', resources: { en: { translation: {} } } });

test('a fixed-message code replaces the server text', () => {
    assert.equal(translateServerError('not_found.service', 'Service not found'), 'Service not found');
    assert.equal(
        translateServerError('permission.denied', 'whatever the server said'),
        "You don't have permission to do this. Ask an admin for access.");
});

test("the agent dispatcher's AGENT_OFFLINE means the same as agent.offline", () => {
    assert.equal(
        translateServerError('AGENT_OFFLINE', 'Agent not connected'),
        translateServerError('agent.offline', 'x'));
});

test('an unknown or prose-carrying code falls back to the server text', () => {
    assert.equal(translateServerError('not_found', 'Monitor not found'), 'Monitor not found');
    assert.equal(translateServerError('permission_denied', 'Path not allowed'), 'Path not allowed');
    assert.equal(translateServerError(null, 'Plain text'), 'Plain text');
});

test('codes that name something need details, else keep the server text', () => {
    assert.equal(translateServerError('validation.required', 'name is required'), 'name is required');
    assert.equal(
        translateServerError('validation.required', 'x', { field: 'name' }), 'name is required');
    assert.equal(
        translateServerError('conflict.exists', 'x', { resource: 'domain' }), 'Domain already exists');
    assert.equal(
        translateServerError('conflict.exists', 'Widget already exists', { resource: 'widget' }),
        'Widget already exists');
});
