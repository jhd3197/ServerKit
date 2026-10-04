import assert from 'node:assert/strict';
import test from 'node:test';
import { runRecipe } from '../runRecipe.js';

test('recipe start awaits the shared mutation contract before returning its job', async () => {
    const messages = [];
    let resolve;
    const body = { recipe_id: 'web', server_id: 7 };
    const pending = runRecipe({
        startRun: { mutate: (value) => {
            assert.equal(value, body);
            return new Promise((done) => { resolve = done; });
        } },
        toast: { success: (message) => messages.push(message), error: assert.fail },
        t: (_key, fallback, values) => fallback.replace('{{server}}', values.server),
    }, body, { serverName: 'Local' });
    assert.deepEqual(messages, []);
    resolve({ job_id: 'job-123' });
    assert.equal(await pending, 'job-123');
    assert.deepEqual(messages, ['Recipe started on Local']);
});

test('failed recipe starts return no navigation target and report what failed and why', async () => {
    const messages = [];
    let failed = '';
    const job = await runRecipe({
        startRun: { mutate: async () => { throw new Error('Server is offline'); } },
        toast: { success: assert.fail, error: (message) => messages.push(message) },
        t: (_key, fallback) => { failed = fallback; return fallback; },
    }, {}, { serverName: 'Local' });
    assert.equal(job, null);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].startsWith(failed.replace(/\.$/, '')), messages[0]);
    assert.ok(messages[0].endsWith(' Server is offline.'), messages[0]);
});
