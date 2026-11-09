import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';

export const PagePrimaryActionContext = createContext(null);

const noopSubscribe = () => () => {};
const none = () => null;

// The action currently registered by the page, or null. Read by MobileTopBar.
export function useRegisteredPrimaryAction() {
    const store = useContext(PagePrimaryActionContext);
    return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.get : none);
}

// A page registers its ONE primary create action; the mobile header "+" runs
// it. Cleared on unmount. onClick is kept in a ref so a new closure every
// render does not re-register (and so cannot loop); only id/label/disabled do.
// No-op outside the provider.
export function usePagePrimaryAction({ id, label, onClick, disabled = false }) {
    const store = useContext(PagePrimaryActionContext);
    const latest = useRef(onClick);
    latest.current = onClick;

    useEffect(() => {
        if (!store) return undefined;
        return store.register({ id, label, disabled, run: () => latest.current?.() });
    }, [store, id, label, disabled]);
}
