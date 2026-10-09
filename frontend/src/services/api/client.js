// Base HTTP client - constructor, token management, core request methods
import { workspaceStore } from '../workspaceStore.js';
import { translateServerError } from './errorCodes.js';
import { TUNNEL_BASE, storageKey } from '../tunnelBase.js';

const AUTH_EXPIRED_EVENT = 'serverkit:auth-expired';

const normalizeApiBaseUrl = (url) => {
    if (!url) return '/api/v1';
    const trimmed = url.replace(/\/+$/, '');
    return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
};

// In dev the API gets its OWN ORIGIN rather than being proxied through Vite.
//
// Same-origin looks simpler, and it is what this did for a long time, but it
// puts every API call into the same per-origin connection pool as Vite's module
// graph — and Vite serves each of the ~760 source files as its own request. A
// browser allows six concurrent HTTP/1.1 connections per origin, so a page that
// makes twenty API calls queues them behind hundreds of .jsx requests. That is
// not a theory about the mechanism: a DevTools capture of /domains showed a 404
// taking 28.77 seconds that the backend's own request log measured at 1.0ms.
// The whole gap was Stalled/Queueing. Splitting the origin doubles the usable
// sockets and, more importantly, stops a slow API call from blocking a module.
//
// The backend already allows the Vite dev origin (config.py
// DEFAULT_CORS_ORIGINS) and now sends Access-Control-Max-Age, so the preflight
// each Authorization-bearing request needs is paid once per endpoint per hour
// rather than every few seconds.
//
// Set VITE_API_PROXY=true to go back to same-origin — the escape hatch if a
// setup has an origin CORS does not expect. Socket.IO is unaffected: it stays
// on window.location.origin in dev (see services/socket.js) because a WebSocket
// upgrades out of the HTTP connection pool anyway.
const viteEnv = import.meta.env || {};
const configuredBase = (viteEnv.DEV && viteEnv.VITE_API_PROXY === 'true')
    ? '/api/v1'
    : normalizeApiBaseUrl(viteEnv.VITE_API_URL);
// Opened through ServerKit Cloud's relay, every API call goes through the
// relay under the panel's prefix (services/tunnelBase.js) — even in a build
// with an absolute VITE_API_URL, since only the relay attaches Cloud's grant.
const API_BASE_URL = TUNNEL_BASE
    ? `${TUNNEL_BASE}${configuredBase.startsWith('/') ? configuredBase : '/api/v1'}`
    : configuredBase;

// Requests that are safe to share with a concurrent identical caller: a plain
// GET with no body, no custom headers (X-DB-Password and friends change what
// comes back) and no abort signal (one caller aborting must not cancel
// someone else's request).
// A joining caller gets its own copy, so the two callers keep the independent
// objects they had when each ran its own fetch — one of them mutating the
// result (sorting an array in place, say) must not corrupt the other's.
const cloneResult = (data) => {
    if (data === null || typeof data !== 'object') return data;
    try {
        return structuredClone(data);
    } catch {
        return data;   // exotic payload — sharing beats throwing
    }
};

const isCoalescable = (options) => (
    (!options.method || options.method === 'GET')
    && !options.body
    && !options.headers
    && !options.signal
);

class ApiClient {
    constructor({ workspace = workspaceStore } = {}) {
        this.baseUrl = API_BASE_URL;
        this.workspace = workspace;
        // In-flight GET coalescing. Two callers asking for the same URL at the
        // same moment share one network request instead of racing.
        //
        // This is NOT a cache — the entry is dropped the moment the request
        // settles, so nobody ever reads a stale body. It only collapses the
        // overlap, which is where the duplicates actually came from: React's
        // StrictMode double-invokes every effect in dev, two independent
        // components own the same endpoint (/system/notices,
        // /plugins/contributions), and a poller whose previous tick has not
        // returned fires again on schedule. A DevTools capture of one page load
        // showed the same endpoint requested up to five times concurrently.
        //
        // It matters more than it looks: in dev the API shares the browser's
        // six-connection HTTP/1.1 budget with Vite's module graph, so a
        // redundant request does not merely waste the backend's time, it holds
        // a connection the page needs to finish rendering.
        this._inflight = new Map();
    }

    getToken() {
        return localStorage.getItem(storageKey('access_token'));
    }

    setTokens(accessToken, refreshToken) {
        localStorage.setItem(storageKey('access_token'), accessToken);
        localStorage.setItem(storageKey('refresh_token'), refreshToken);
    }

    clearTokens() {
        localStorage.removeItem(storageKey('access_token'));
        localStorage.removeItem(storageKey('refresh_token'));
        this.workspace.clearActiveWorkspace();  // drop workspace context on logout
    }

    request(endpoint, options = {}) {
        if (!isCoalescable(options)) return this._request(endpoint, options);

        // Scope the key by workspace: the same path returns different rows
        // under a different X-Workspace-Id.
        const { activeWorkspaceId } = this.workspace.getSnapshot();
        const key = `${activeWorkspaceId}|${endpoint}`;
        const existing = this._inflight.get(key);
        if (existing) return existing.then(cloneResult);

        const pending = this._request(endpoint, options)
            .finally(() => { this._inflight.delete(key); });
        this._inflight.set(key, pending);
        return pending;
    }

    requestBlob(endpoint, options = {}) {
        return this._request(endpoint, { ...options, responseType: 'blob' });
    }

    async _request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const token = this.getToken();
        const { responseType = 'json', ...fetchOptions } = options;

        // FormData uploads need browser-built Content-Type (with boundary)
        // and must NOT be JSON-stringified. Detect and bypass both.
        const isFormData = fetchOptions.body instanceof FormData;

        // Active workspace context (#33). Sent ambiently so the backend can scope
        // resources; endpoints that don't honor it ignore it. A stale value is safe
        // — the backend resolves it leniently (falls back to no scope).
        const { activeWorkspaceId } = this.workspace.getSnapshot();

        // Spread `...options` FIRST, then set merged headers LAST — otherwise a
        // call passing custom `headers` (e.g. X-DB-Password) would clobber the
        // whole merged set, dropping Content-Type/Authorization and triggering
        // 415 (no application/json) on JSON POSTs.
        const config = {
            ...fetchOptions,
            headers: {
                ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
                ...(token && { Authorization: `Bearer ${token}` }),
                ...(activeWorkspaceId !== 'all' && { 'X-Workspace-Id': activeWorkspaceId }),
                ...fetchOptions.headers,
            },
        };

        if (
            !isFormData &&
            options.body &&
            typeof options.body === 'object' &&
            !(options.body instanceof Blob)
        ) {
            config.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, config);

        if (response.status === 401) {
            // flask-jwt-extended returns 401 with `{"msg": "..."}` when
            // the token is the problem; domain endpoints (e.g. wrong
            // pair-code passphrase) return `{"error": "..."}`. Only the
            // former should trigger a token refresh — refreshing on a
            // domain 401 wastes a backend round-trip and burns through
            // rate limits twice as fast.
            const probe = await response.clone().json().catch(() => ({}));
            const isJwtIssue = probe && probe.msg && !probe.error;

            if (isJwtIssue) {
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    config.headers.Authorization = `Bearer ${this.getToken()}`;
                    const retryResponse = await fetch(url, config);
                    return this.handleResponse(retryResponse, responseType);
                }
                this.clearTokens();
                window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
                const err = new Error('Session expired');
                err.status = 401;
                throw err;
            }
            // Domain 401 — fall through so handleResponse throws the
            // server's error message verbatim, with status attached.
        }

        return this.handleResponse(response, responseType);
    }

    async handleResponse(response, responseType = 'json') {
        // Error bodies stay JSON even for binary endpoints so callers receive
        // the backend's useful message instead of an opaque Blob.
        const data = response.ok && responseType === 'blob'
            ? await response.blob()
            : await response.json().catch(() => ({}));
        if (!response.ok) {
            // No server-provided message means the route itself misbehaved
            // (404 unknown endpoint, 405 SPA catch-all, 502 proxy...) — name
            // the endpoint and status so the toast is diagnosable.
            let fallback = `Request failed (${response.status})`;
            try {
                fallback += `: ${new URL(response.url).pathname}`;
            } catch { /* keep the status-only message */ }
            // Plan 79 F1: when the route names a machine `code`, the message
            // becomes translatable — `errors.<code>` with the server's own
            // English as the inline default, so an un-keyed code degrades to
            // exactly today's behaviour. The 257 `toast.error(err.message)`
            // sites keep working unchanged and gain translations as codes land.
            const serverMessage = data.error || data.msg || fallback;
            const err = new Error(translateServerError(data.code, serverMessage, data.details));
            err.status = response.status;
            err.code = data.code || null;
            err.serverMessage = serverMessage;
            err.data = data;
            throw err;
        }
        return data;
    }

    async refreshToken() {
        const refreshToken = localStorage.getItem(storageKey('refresh_token'));
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${refreshToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem(storageKey('access_token'), data.access_token);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export default ApiClient;
