// The saved-view envelope — ONE state shape for every list page.
//
//   {
//     sorts:         [{ key, direction }],        // ordered; sorts[0] is primary
//     hiddenKeys:    ['next_run'],                // set semantics, order is noise
//     columnOrder:   ['name','status'] | null,    // null = the page's natural order
//     groupBy:       'status' | null,
//     columnFilters: { match:'all', rules:[…] },  // CLIENT-side column rules
//     page:          { … },                       // the ONLY per-page bag
//   }
//
// Why an envelope at all: before this, each page named its own view state, and
// `filters` meant column rules on three pages and a SERVER-side query object on
// three others. Every addition to the shared chrome — the `columnFilters` key,
// shareable links, the pre-restore guard — then had to be re-remembered per
// page, and each one was in fact missed on at least one of them.
//
// Now the common half is common by construction and the private half is
// namespaced, so a page can never again collide with the chrome.
//
// Nothing here is lossy for state written by older builds: `toEnvelope` folds
// any unrecognised top-level key into `page`, so saved views persisted in the
// flat shape keep working without a migration pass over the database.

export const NO_COLUMN_FILTERS = { match: 'all', rules: [] };

// The keys that mean the same thing on every page. Everything else is `page`.
export const COMMON_KEYS = ['sorts', 'hiddenKeys', 'columnOrder', 'groupBy', 'columnFilters'];

export function emptyViewState() {
    return {
        sorts: [],
        hiddenKeys: [],
        columnOrder: null,
        groupBy: null,
        columnFilters: { match: 'all', rules: [] },
        page: {},
    };
}

function normalizeFilters(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.rules)) {
        return { match: 'all', rules: [] };
    }
    return { match: value.match === 'any' ? 'any' : 'all', rules: value.rules };
}

/**
 * Coerce any saved-view state — current envelope, legacy flat shape, or a raw
 * DataGrid cfg — into the envelope.
 *
 * `rename` maps a LEGACY top-level key to its name inside `page`, which is how
 * the pages whose `filters` meant a server-side query move to `serverFilters`
 * without orphaning views their users already saved:
 *
 *   toEnvelope(saved, { rename: { filters: 'serverFilters' } })
 */
export function toEnvelope(state, { rename } = {}) {
    const out = emptyViewState();
    if (!state || typeof state !== 'object') return out;

    // An explicit `page` bag always wins over a legacy top-level key of the
    // same name — the newer write is the one that meant it.
    const page = { ...(state.page && typeof state.page === 'object' ? state.page : {}) };

    for (const [key, value] of Object.entries(state)) {
        if (key === 'page' || value === undefined) continue;
        if (COMMON_KEYS.includes(key)) {
            out[key] = value;
            continue;
        }
        const target = rename?.[key] ?? key;
        if (!(target in page)) page[target] = value;
    }

    out.sorts = Array.isArray(out.sorts) ? out.sorts : [];
    out.hiddenKeys = Array.isArray(out.hiddenKeys) ? out.hiddenKeys : [];
    out.columnOrder = Array.isArray(out.columnOrder) ? out.columnOrder : null;
    out.groupBy = out.groupBy ?? null;
    out.columnFilters = normalizeFilters(out.columnFilters);
    out.page = page;
    return out;
}

// ---------------------------------------------------------------- comparison

// Canonical form for equality: object keys sorted, undefined dropped. Rule
// `id`s are stripped — they are generated per rule instance, so two identical
// filter sets would otherwise never compare equal and the view would read as
// permanently unsaved.
function canon(value, dropId = false) {
    if (Array.isArray(value)) return value.map((v) => canon(v, dropId));
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            if (key === 'id' && dropId) continue;
            if (value[key] === undefined) continue;
            out[key] = canon(value[key], dropId);
        }
        return out;
    }
    return value;
}

/**
 * Is the live state the same view as the saved one? Both sides go through
 * `toEnvelope` first, so a view saved in the flat shape does not read as dirty
 * the instant it is applied.
 */
export function sameViewState(a, b, { rename } = {}) {
    const left = toEnvelope(a, { rename });
    const right = toEnvelope(b, { rename });
    for (const side of [left, right]) {
        side.hiddenKeys = [...side.hiddenKeys].sort();
        side.columnFilters = {
            match: side.columnFilters.match,
            rules: side.columnFilters.rules.map((r) => canon(r, true)),
        };
    }
    // Compare only the `page` keys the page still captures. The bag is the one
    // place a page may invent a key, so it is also the one place a key can be
    // RETIRED — when a page stops capturing (say) a bucket it has replaced with
    // a column rule, every view a user saved while it existed would otherwise
    // never compare equal again, leaving "Unsaved" pinned on forever with
    // nothing the user can do to clear it. A key the live state no longer knows
    // about is not a difference the user made.
    //
    // The converse holds too: a key the saved view never set (a built-in view
    // says nothing about page size) is not a difference either, or every
    // built-in view reads "Unsaved" the moment it is picked. An empty search
    // and no search are the same state.
    const savedKeys = new Set(Object.keys(right.page || {}));
    const shared = new Set(Object.keys(left.page || {}).filter((k) => savedKeys.has(k)));
    const unset = (v) => v === undefined || v === null || v === '';
    const clean = (bag) => Object.fromEntries(
        Object.entries(bag || {}).filter(([k, v]) => shared.has(k) && !unset(v)),
    );
    left.page = clean(left.page);
    right.page = clean(right.page);
    return JSON.stringify(canon(left)) === JSON.stringify(canon(right));
}

// ------------------------------------------------------- DataGrid cfg bridge

// DataGrid keeps its chrome in one `cfg` object: `cols` is the visible columns
// IN ORDER (so "move left" is a splice), and `sort` is a single level. The
// envelope keeps `hiddenKeys` + `columnOrder` + `sorts[]` because that is what
// <DataTable> pages own. Both are mapped here rather than in either hook, so a
// Domains view and a Cron view are the same JSON and a link from one page's
// chrome means the same thing on the other's.

// A view saved (or authored) as a raw DataGrid cfg rather than an envelope:
// `cols` is a cfg-only key and `sorts` is envelope-only, so the pair is
// unambiguous. Detecting this matters — run such a state through `toEnvelope`
// directly and `cols`/`sort`/`filters` all get filed into `page` as unknown
// keys, which silently drops every rule the preset declared.
export const isLegacyCfg = (state) => !!state && typeof state === 'object'
    && Array.isArray(state.cols) && !Array.isArray(state.sorts);

export function cfgToEnvelope(cfg, allKeys = []) {
    const cols = Array.isArray(cfg?.cols) ? cfg.cols : [];
    return {
        sorts: cfg?.sort?.key ? [{ key: cfg.sort.key, direction: cfg.sort.dir || 'asc' }] : [],
        hiddenKeys: allKeys.filter((k) => !cols.includes(k)),
        columnOrder: cols.length ? cols : null,
        groupBy: cfg?.group ?? null,
        columnFilters: normalizeFilters(cfg?.filters),
        page: { density: cfg?.density ?? 'cozy', sub: cfg?.sub ?? [] },
    };
}

/**
 * Envelope -> DataGrid cfg. `allKeys` is every column key in the page's natural
 * order; it is what lets `columnOrder` + `hiddenKeys` rebuild `cols`, and what
 * makes a column added in a later release show up in a view saved before it
 * existed instead of silently vanishing.
 */
export function envelopeToCfg(state, allKeys = [], fallback = {}) {
    // A view saved by an older build is the raw cfg itself.
    if (isLegacyCfg(state)) {
        return {
            cols: state.cols,
            sort: state.sort || { key: null, dir: 'asc' },
            group: state.group ?? null,
            filters: normalizeFilters(state.filters),
            density: state.density || 'cozy',
            sub: state.sub || [],
        };
    }

    const env = toEnvelope(state);
    const order = env.columnOrder?.length ? env.columnOrder : allKeys;
    const ordered = [
        ...order.filter((k) => allKeys.includes(k)),
        ...allKeys.filter((k) => !order.includes(k)),
    ];
    return {
        cols: ordered.filter((k) => !env.hiddenKeys.includes(k)),
        sort: env.sorts[0]
            ? { key: env.sorts[0].key, dir: env.sorts[0].direction || 'asc' }
            : { key: null, dir: 'asc' },
        group: env.groupBy,
        filters: env.columnFilters,
        density: env.page.density ?? fallback.density ?? 'cozy',
        sub: env.page.sub ?? fallback.sub ?? [],
    };
}
