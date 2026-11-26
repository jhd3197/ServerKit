// Drops a call while a previous one is still running. Backed by a plain
// object (hold it in a useRef) so a double-click is refused synchronously,
// before React has flushed any `disabled` state.
export function createSingleFlight() {
    let busy = false;
    return async function run(fn) {
        if (busy) return undefined;
        busy = true;
        try {
            return await fn();
        } finally {
            busy = false;
        }
    };
}
