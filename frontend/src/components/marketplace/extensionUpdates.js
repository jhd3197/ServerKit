// Pure helpers over the GET /plugins/updates payload (no React, no DOM).

// An update the operator can act on: newer version exists AND this panel can run it.
export const isUpdatable = (u) => Boolean(u && u.update_available && u.compatible !== false);

export const countUpdatable = (updates) => (updates || []).filter(isUpdatable).length;

// ready: one-click safe (Update all runs these); review: needs the operator's
// acknowledgment, so only ever updated one at a time; incompatible: newer
// version exists but can't run here. Entries without an update are dropped.
export function partitionUpdates(updates) {
    const out = { ready: [], review: [], incompatible: [] };
    for (const u of updates || []) {
        if (!u || !u.update_available) continue;
        if (u.compatible === false) out.incompatible.push(u);
        else if (u.requires_ack) out.review.push(u);
        else out.ready.push(u);
    }
    return out;
}

export const versionLabel = (u) => `v${u.installed_version} → v${u.available_version}`;

// Lookup by plugin id and slug so a caller can match whichever it has.
export function indexUpdates(updates) {
    const map = new Map();
    for (const u of updates || []) {
        if (u.plugin_id != null) map.set(String(u.plugin_id), u);
        if (u.slug) map.set(u.slug, u);
    }
    return map;
}

// Whole minutes since `checkedAt` (ISO string); null when unknown.
export function minutesSince(checkedAt, now = Date.now()) {
    const ms = Date.parse(checkedAt);
    return Number.isNaN(ms) ? null : Math.max(0, Math.floor((now - ms) / 60000));
}
