// Locale precedence, as pure functions so it can be tested
// without a browser, a store, or i18next.
//
//   user.language (server, per-user)
//     -> localStorage 'language'   (pre-auth cache; stops the login flash)
//       -> panel default           (system_settings, unauthenticated endpoint)
//           -> 'en'                  (US English; browser language is ignored)
//
// This mirrors ThemeContext's precedence (workspace -> user -> skin ->
// default) deliberately: same problem shape, same solution, one thing to
// learn.

// Import attribute required by Node (the test runner); Vite/rollup honour it too.
import manifest from './languages.json' with { type: 'json' };

export const LANGUAGES = manifest.languages;
export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_CODES = LANGUAGES.map((language) => language.code);
export const STORAGE_KEY = 'language';

/**
 * Match a requested BCP 47 tag against what we ship.
 *
 * `es-419`, `es-MX` and `ES` all resolve to `es`. Region-specific bundles are
 * not shipped for most languages. Chinese is the exception: script and region
 * subtags select `zh-Hans` or `zh-Hant`, while legacy bare `zh` safely keeps
 * the historical Simplified Chinese behavior.
 */
export function matchSupported(tag, supported = SUPPORTED_CODES) {
    if (!tag || typeof tag !== 'string') return null;
    const normalized = tag.trim().toLowerCase().replaceAll('_', '-');
    if (!normalized) return null;

    const canonical = new Map(supported.map((code) => [code.toLowerCase(), code]));
    if (canonical.has(normalized)) return canonical.get(normalized);

    const parts = normalized.split('-');
    const base = parts[0];
    if (base === 'zh') {
        const traditional = parts.includes('hant')
            || parts.some((part) => ['tw', 'hk', 'mo'].includes(part));
        const script = traditional ? 'zh-hant' : 'zh-hans';
        if (canonical.has(script)) return canonical.get(script);
    }

    return canonical.get(base) || null;
}

/**
 * First supported match across an ordered list of candidate tags.
 * Unsupported and malformed entries are skipped rather than failing — a
 * user row carrying a locale we no longer ship must not break the app.
 */
export function resolveLocale({
    userLanguage = null,
    stored = null,
    panelDefault = null,
    supported = SUPPORTED_CODES,
} = {}) {
    const candidates = [userLanguage, stored, panelDefault];
    for (const candidate of candidates) {
        const match = matchSupported(candidate, supported);
        if (match) return match;
    }
    return DEFAULT_LANGUAGE;
}

/** The manifest row for a code, or the English row. */
export function languageInfo(code) {
    return LANGUAGES.find((language) => language.code === code)
        || LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE);
}

/** Writing direction for a code — drives <html dir>. */
export function directionFor(code) {
    return languageInfo(code).dir || 'ltr';
}
