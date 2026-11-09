import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activateLocale } from '../i18n';
import { setFormatLocale } from '../utils/intl';
import {
    DEFAULT_LANGUAGE, LANGUAGES, STORAGE_KEY,
    directionFor, languageInfo, matchSupported, resolveLocale,
} from '../i18n/resolveLocale';

import { LocaleContext } from './useLocale.js';

/**
 * Owns the active locale.
 *
 * Sits ABOVE AuthProvider — the login screen has to be translated before
 * anyone is signed in — so it cannot read auth state itself. The bridge is
 * LocaleSync, which renders inside AuthProvider and pushes the user's stored
 * preference and the panel default down through `applyServerPreferences`.
 * Exactly the arrangement ThemeProvider/ThemeSync already uses.
 */
export function LocaleProvider({ children }) {
    // Synchronous first value: whatever the last session stored, else English.
    // Anything that needs a round trip would repaint.
    const [language, setLanguageState] = useState(() => resolveLocale({
        stored: readStored(),
    }));

    // True once the active bundle is in memory. `en` is bundled, so this is
    // only ever false while a non-default locale's chunk is in flight.
    const [ready, setReady] = useState(language === DEFAULT_LANGUAGE);

    // Set by LocaleSync; persists the choice server-side when signed in.
    const persistRef = useRef(null);
    // Guards the one-shot server hydration so a user who switches language
    // during page load does not get overwritten by their own stored value.
    const hydratedRef = useRef(false);

    // Publish to the format door BEFORE the render that follows, so a
    // non-React caller (API error mapper, CSV export) can never format against
    // the previous locale. Doing this in an effect would be one paint late.
    setFormatLocale(language);

    useEffect(() => {
        let cancelled = false;
        // `en` is bundled, but other locales may need a dynamic import.
        // Reset readiness on each language change so we rerender once the
        // bundle is active.
        setReady(language === DEFAULT_LANGUAGE);
        activateLocale(language).then((applied) => {
            if (cancelled) return;
            setReady(true);
            // The bundle we asked for may not exist; follow what took effect.
            if (applied !== language) setLanguageState(applied);
        });
        return () => { cancelled = true; };
    }, [language]);

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('lang', language);
        root.setAttribute('dir', directionFor(language));
    }, [language]);

    const setLanguage = useCallback((code) => {
        const next = matchSupported(code) || DEFAULT_LANGUAGE;
        hydratedRef.current = true;   // an explicit choice outranks hydration
        setLanguageState(next);
        writeStored(next);
        persistRef.current?.(next);
    }, []);

    /**
     * Server-side preferences arriving after auth resolves.
     *
     * Applied once, and only when the user has not already chosen in this
     * session. `userLanguage` is null for a user who never picked one, which
     * is a different state from "picked English" — that is why the column is
     * nullable.
     */
    const applyServerPreferences = useCallback(({ userLanguage, panelDefault }) => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        const resolved = resolveLocale({
            userLanguage,
            stored: readStored(),
            panelDefault,
            });
        setLanguageState(resolved);
        // Cache for the next pre-auth paint, but do NOT write it back to the
        // server: nothing was chosen here, it was only resolved.
        writeStored(resolved);
    }, []);

    const registerPersist = useCallback((fn) => {
        persistRef.current = fn;
        return () => { persistRef.current = null; };
    }, []);

    const value = useMemo(() => ({
        language,
        setLanguage,
        applyServerPreferences,
        registerPersist,
        ready,
        languages: LANGUAGES,
        languageInfo: languageInfo(language),
        direction: directionFor(language),
    }), [language, setLanguage, applyServerPreferences, registerPersist, ready]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}



function readStored() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;    // private mode / disabled storage: fall through
    }
}

function writeStored(code) {
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch {
        /* preference simply will not survive the tab */
    }
}
