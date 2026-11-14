// Holds the create action the current page registered for the mobile header
// "+". Plain store (no React) so the claim/release rules are testable.
// Claims are kept in registration order: the newest live claim wins, and a
// release removes only its own, so the earlier one takes over again.
export function createPrimaryActionStore() {
    let claims = [];
    let current = null;
    const listeners = new Set();
    const update = (next) => {
        claims = next;
        current = claims.length ? claims[claims.length - 1] : null;
        listeners.forEach((fn) => fn());
    };

    return {
        get: () => current,
        subscribe(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        register(action) {
            const claim = { ...action };
            update([...claims, claim]);
            return () => {
                if (claims.includes(claim)) update(claims.filter((c) => c !== claim));
            };
        },
    };
}
