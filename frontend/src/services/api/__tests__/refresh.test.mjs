import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ApiClient from '../client.js';

// A browser-ish world: localStorage, window events, and a scripted fetch.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const events = [];
globalThis.window ??= globalThis;
globalThis.window.dispatchEvent = (e) => events.push(e.type);

const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
});
const accessKey = () => [...store.keys()].find((k) => k.endsWith('access_token'));
const refreshKey = () => [...store.keys()].find((k) => k.endsWith('refresh_token'));

function client() {
    const c = new ApiClient();
    c.setTokens('expired', 'refresh-ok');
    return c;
}

beforeEach(() => { store.clear(); events.length = 0; });

test('parallel expired requests share one refresh', async () => {
    const c = client();
    let refreshes = 0;
    globalThis.fetch = async (url, init) => {
        if (url.endsWith('/auth/refresh')) {
            refreshes += 1;
            await new Promise((r) => setTimeout(r, 10));
            return json(200, { access_token: 'fresh' });
        }
        return init.headers.Authorization === 'Bearer fresh'
            ? json(200, { ok: true })
            : json(401, { msg: 'Token has expired' });
    };
    const results = await Promise.all([1, 2, 3].map((n) => c._request(`/things/${n}`)));
    assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
    assert.equal(refreshes, 1);
});

for (const failure of ['offline', 500, 429]) {
    test(`a transient refresh failure (${failure}) keeps the session`, async () => {
        const c = client();
        globalThis.fetch = async (url) => {
            if (!url.endsWith('/auth/refresh')) return json(401, { msg: 'Token has expired' });
            if (failure === 'offline') throw new TypeError('Failed to fetch');
            return json(failure, { error: 'busy' });
        };
        await assert.rejects(c._request('/things'));
        assert.equal(store.get(refreshKey()), 'refresh-ok');
        assert.deepEqual(events, []);
    });
}

test('a rejected refresh token ends the session', async () => {
    const c = client();
    globalThis.fetch = async (url) => (url.endsWith('/auth/refresh')
        ? json(401, { msg: 'Token has been revoked' })
        : json(401, { msg: 'Token has expired' }));
    await assert.rejects(c._request('/things'), (err) => err.status === 401);
    assert.equal(accessKey(), undefined);
    assert.equal(refreshKey(), undefined);
    assert.deepEqual(events, ['serverkit:auth-expired']);
});
