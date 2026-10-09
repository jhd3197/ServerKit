import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDotenv, envToObject, envFromObject, isValidEnvKey, looksSecret } from '../dotenv.js';

test('parseDotenv handles comments, export, quotes and = in values', () => {
    const rows = parseDotenv('# db\nexport DB_HOST=localhost\nDB_PASS="p=ss word"\n\nEMPTY=\nnot a line\nURL=\'https://x/?a=1\'');
    assert.deepEqual(rows, [
        { key: 'DB_HOST', value: 'localhost' },
        { key: 'DB_PASS', value: 'p=ss word' },
        { key: 'EMPTY', value: '' },
        { key: 'URL', value: 'https://x/?a=1' },
    ]);
});

test('object round trip keeps the last duplicate and drops blank keys', () => {
    assert.deepEqual(envToObject([{ key: 'A', value: '1' }, { key: ' ', value: 'x' }, { key: 'A', value: '2' }]), { A: '2' });
    assert.deepEqual(envFromObject({ A: 1, B: null }), [{ key: 'A', value: '1' }, { key: 'B', value: '' }]);
});

test('key validation and secret detection', () => {
    assert.equal(isValidEnvKey('DB_HOST'), true);
    assert.equal(isValidEnvKey('1BAD'), false);
    assert.equal(isValidEnvKey('has-dash'), false);
    assert.equal(looksSecret('STRIPE_SECRET_KEY'), true);
    assert.equal(looksSecret('NODE_ENV'), false);
});
