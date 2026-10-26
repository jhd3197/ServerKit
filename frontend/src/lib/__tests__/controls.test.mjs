import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clamp, decimalsOf, isPartialNumber, normalizeNumber, parseNumber, snapToStep, stepNumber,
} from '../numberMath.js';
import {
    addMonths, compareDays, fromISODate, isWithinRange, monthGrid, orderRange,
    startOfWeek, toISODate,
} from '../dateMath.js';
import { matchesAccept, validateFiles } from '../fileAccept.js';

test('decimalsOf reads step precision, including exponent notation', () => {
    assert.equal(decimalsOf(1), 0);
    assert.equal(decimalsOf(0.25), 2);
    assert.equal(decimalsOf(1e-7), 7);
});

test('snapToStep removes float noise and anchors at min', () => {
    assert.equal(snapToStep(0.1 + 0.2, 0.1), 0.3);
    assert.equal(snapToStep(7, 5, 1), 6);    // grid is 1, 6, 11 …
    assert.equal(snapToStep(9, 5, 1), 11);
});

test('normalizeNumber clamps after snapping past a bound', () => {
    assert.equal(normalizeNumber(99, { min: 0, max: 10, step: 3 }), 9);
    assert.equal(normalizeNumber(10, { min: 0, max: 10, step: 3 }), 9);
    assert.equal(normalizeNumber(-4, { min: 0, max: 10 }), 0);
    assert.equal(normalizeNumber(null, { min: 0 }), null);
});

test('stepNumber starts an empty field at the bound it moves away from', () => {
    assert.equal(stepNumber(null, 1, { min: 1, max: 10 }), 1);
    assert.equal(stepNumber(null, -1, { min: 1, max: 10 }), 10);
    assert.equal(stepNumber(null, 1, {}), 0);
    assert.equal(stepNumber(5, 1, { step: 2, multiplier: 10, max: 12 }), 12);
    assert.equal(stepNumber(0.2, 1, { step: 0.1 }), 0.3);
});

test('partial entry and parsing', () => {
    for (const text of ['', '-', '1.', '-0.5', '12']) assert.ok(isPartialNumber(text), text);
    assert.equal(isPartialNumber('1a'), false);
    assert.equal(isPartialNumber('-1', { allowNegative: false }), false);
    assert.equal(isPartialNumber('1.5', { allowDecimal: false }), false);
    assert.equal(parseNumber('-'), null);
    assert.equal(parseNumber('3.5'), 3.5);
    assert.equal(clamp(5, undefined, 3), 3);
});

test('addMonths clamps the day instead of overflowing into the next month', () => {
    assert.equal(toISODate(addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
    assert.equal(toISODate(addMonths(new Date(2028, 0, 31), 1)), '2028-02-29');
    assert.equal(toISODate(addMonths(new Date(2026, 2, 15), -3)), '2025-12-15');
});

test('monthGrid is always 6×7 and starts on the requested weekday', () => {
    const sundayFirst = monthGrid(new Date(2026, 9, 1), 0);
    const mondayFirst = monthGrid(new Date(2026, 9, 1), 1);
    assert.equal(sundayFirst.length, 6);
    assert.ok(sundayFirst.every((row) => row.length === 7));
    assert.equal(sundayFirst[0][0].getDay(), 0);
    assert.equal(mondayFirst[0][0].getDay(), 1);
    assert.equal(toISODate(startOfWeek(new Date(2026, 9, 25), 1)), '2026-10-19');
});

test('ISO dates round-trip as LOCAL days and reject impossible dates', () => {
    const day = fromISODate('2026-10-25');
    assert.equal(day.getDate(), 25);
    assert.equal(toISODate(day), '2026-10-25');
    assert.equal(fromISODate('2026-02-30'), null);
    assert.equal(fromISODate('25/10/2026'), null);
});

test('ranges order themselves and include both ends', () => {
    const a = new Date(2026, 9, 20);
    const b = new Date(2026, 9, 10);
    const { start, end } = orderRange(a, b);
    assert.ok(compareDays(start, end) < 0);
    assert.ok(isWithinRange(new Date(2026, 9, 10), start, end));
    assert.ok(isWithinRange(new Date(2026, 9, 20), start, end));
    assert.equal(isWithinRange(new Date(2026, 9, 21), start, end), false);
});

test('accept matching covers extensions, wildcards and exact MIME', () => {
    const zip = { name: 'Site.ZIP', type: 'application/zip', size: 10 };
    const png = { name: 'logo.png', type: 'image/png', size: 10 };
    assert.ok(matchesAccept(zip, '.zip'));
    assert.ok(matchesAccept(png, 'image/*'));
    assert.ok(matchesAccept(png, 'application/json, image/png'));
    assert.equal(matchesAccept(zip, 'image/*'), false);
    assert.ok(matchesAccept(zip, ''));
});

test('validateFiles reports type, size and count rejections in order', () => {
    const files = [
        { name: 'a.sql', type: '', size: 10 },
        { name: 'b.sql', type: '', size: 5000 },
        { name: 'c.txt', type: 'text/plain', size: 10 },
        { name: 'd.sql', type: '', size: 10 },
    ];
    const { accepted, rejected } = validateFiles(files, { accept: '.sql', maxSize: 1000, maxFiles: 2, existingCount: 1 });
    assert.deepEqual(accepted.map((f) => f.name), ['a.sql']);
    assert.deepEqual(rejected.map((r) => [r.file.name, r.reason]), [
        ['b.sql', 'size'], ['c.txt', 'type'], ['d.sql', 'count'],
    ]);
});
