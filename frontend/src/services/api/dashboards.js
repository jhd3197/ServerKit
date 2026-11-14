// Dashboard board persistence.
// A board is one dashboard tab: { id, slug, name, icon, position, widgets }.
// Boards are per-user — the backend scopes every call to the caller, and the
// first getDashboards() of a new account seeds the shipped default boards.

// This user's boards, ordered by position. Seeds the defaults on first call.
export async function getDashboards() {
    return this.request('/dashboards');
}

// Add a board. { name, icon?, widgets? } — a new tab usually starts empty.
export async function createDashboard(payload) {
    return this.request('/dashboards', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

// Patch a board. { name?, icon?, position?, widgets? } — this is also how a
// drag/resize is persisted, by sending the whole widget list back.
export async function updateDashboard(id, payload) {
    return this.request(`/dashboards/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
}

export async function deleteDashboard(id) {
    return this.request(`/dashboards/${id}`, { method: 'DELETE' });
}

// Restore a shipped default board (overview / infra / apps). Boards the user
// created themselves have no default and are refused with a 400.
export async function resetDashboard(id) {
    return this.request(`/dashboards/${id}/reset`, { method: 'POST' });
}

// The Overview layout this user saved for one kind of detail page ('server' |
// 'service'), or null while they are still on the shipped layout. It is a
// board like any other, so deleteDashboard(id) is what puts the shipped layout
// back.
export async function getOverviewBoard(kind) {
    const data = await this.request(`/dashboards?scope=entity:${kind}`);
    return data?.boards?.[0] || null;
}

// Store (or replace) this user's Overview layout for one kind of detail page.
export async function saveOverviewBoard(kind, widgets) {
    return this.request('/dashboards', {
        method: 'POST',
        body: JSON.stringify({ name: `${kind} overview`, scope: `entity:${kind}`, widgets }),
    });
}

