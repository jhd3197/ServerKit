import { useEffect, useSyncExternalStore } from 'react';
import api from '../services/api';
import { countUpdatable } from '@/components/marketplace/extensionUpdates';

// One module-level store for GET /plugins/updates, shared by the Extensions
// tabs (badge), the update banner and the views, so they never disagree or
// fetch twice. Loads once on the first enabled subscriber; install / update /
// uninstall flows call refreshExtensionUpdates() to invalidate it.
let state = { updates: [], count: 0, loading: false, error: null, checkedAt: null, loaded: false };
let inflight = null;
const listeners = new Set();

function set(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
}

export function refreshExtensionUpdates({ force = false } = {}) {
    if (inflight) return inflight;
    set({ loading: true });
    inflight = api.getPluginUpdates({ refresh: force })
        .then((data) => {
            const updates = data?.updates || [];
            set({
                updates, count: countUpdatable(updates), error: null, loaded: true,
                checkedAt: data?.checked_at || new Date().toISOString(),
            });
        })
        // Keep the last good list on failure; the error is surfaced separately.
        .catch((error) => set({ error, loaded: true }))
        .finally(() => { inflight = null; set({ loading: false }); });
    return inflight;
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;

export function useExtensionUpdates({ enabled = true } = {}) {
    const s = useSyncExternalStore(subscribe, snapshot);
    useEffect(() => {
        if (enabled && !state.loaded && !inflight) refreshExtensionUpdates();
    }, [enabled]);
    return { ...s, refresh: refreshExtensionUpdates };
}
