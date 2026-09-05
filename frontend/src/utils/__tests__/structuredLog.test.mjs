import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStructuredLogLine } from '../structuredLog.js';

test('formats a Pino JSON line as a readable object', () => {
    const result = parseStructuredLogLine(
        '{"level":30,"cpf":"000.000.000-00","cacheHit":true}'
    );

    assert.equal(result.structured, true);
    assert.equal(result.level, 'info');
    assert.equal(
        result.formatted,
        '{\n  "level": 30,\n  "cpf": "000.000.000-00",\n  "cacheHit": true\n}'
    );
});

test('separates a Docker timestamp from a structured payload', () => {
    const result = parseStructuredLogLine(
        '2026-09-05T10:48:00.000000000Z {"level":40,"msg":"Rejected"}'
    );

    assert.equal(result.structured, true);
    assert.equal(result.timestamp, '2026-09-05T10:48:00.000000000Z');
    assert.equal(result.level, 'warn');
});

test('leaves plain and malformed log lines unchanged', () => {
    const plain = parseStructuredLogLine('Application started');
    const malformed = parseStructuredLogLine('{not-json}');

    assert.equal(plain.structured, false);
    assert.equal(plain.raw, 'Application started');
    assert.equal(malformed.structured, false);
    assert.equal(malformed.raw, '{not-json}');
});

