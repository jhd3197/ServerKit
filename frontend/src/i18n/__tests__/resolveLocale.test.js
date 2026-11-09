import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_LANGUAGE, SUPPORTED_CODES,
    directionFor, languageInfo, matchSupported, resolveLocale,
} from '../resolveLocale.js';

const SUPPORTED = ['en', 'es'];

test('matchSupported resolves language-only', () => {
    assert.equal(matchSupported('es', SUPPORTED), 'es');
    assert.equal(matchSupported('es-MX', SUPPORTED), 'es');
    assert.equal(matchSupported('ES', SUPPORTED), 'es');
    assert.equal(matchSupported('es_419', SUPPORTED), 'es');
    assert.equal(matchSupported('en-GB', SUPPORTED), 'en');
});

test('matchSupported distinguishes Simplified and Traditional Chinese', () => {
    const supported = ['en', 'zh-Hans', 'zh-Hant'];

    assert.equal(matchSupported('zh', supported), 'zh-Hans');
    assert.equal(matchSupported('zh-CN', supported), 'zh-Hans');
    assert.equal(matchSupported('zh-SG', supported), 'zh-Hans');
    assert.equal(matchSupported('zh-Hans', supported), 'zh-Hans');
    assert.equal(matchSupported('zh-TW', supported), 'zh-Hant');
    assert.equal(matchSupported('zh-HK', supported), 'zh-Hant');
    assert.equal(matchSupported('zh-MO', supported), 'zh-Hant');
    assert.equal(matchSupported('zh_Hant_TW', supported), 'zh-Hant');
});

test('matchSupported normalizes regional tags for the second-wave locales', () => {
    const supported = ['en', 'th', 'ar', 'it', 'pl', 'bn'];

    assert.equal(matchSupported('th-TH', supported), 'th');
    assert.equal(matchSupported('ar-EG', supported), 'ar');
    assert.equal(matchSupported('it-IT', supported), 'it');
    assert.equal(matchSupported('pl-PL', supported), 'pl');
    assert.equal(matchSupported('bn-BD', supported), 'bn');
});

test('matchSupported rejects what we do not ship', () => {
    assert.equal(matchSupported('fr', SUPPORTED), null);
    assert.equal(matchSupported('', SUPPORTED), null);
    assert.equal(matchSupported(null, SUPPORTED), null);
    assert.equal(matchSupported(undefined, SUPPORTED), null);
    assert.equal(matchSupported(42, SUPPORTED), null);
});

test('the user preference outranks everything', () => {
    assert.equal(resolveLocale({
        userLanguage: 'es',
        stored: 'en',
        panelDefault: 'en',
        supported: SUPPORTED,
    }), 'es');
});

test('the stored value outranks the panel default', () => {
    // This is what stops the sign-in screen flashing the panel language at a
    // returning user who chose otherwise.
    assert.equal(resolveLocale({
        stored: 'es',
        panelDefault: 'en',
        supported: SUPPORTED,
    }), 'es');
});

test('the panel default outranks the English default', () => {
    assert.equal(resolveLocale({
        panelDefault: 'es',
        supported: SUPPORTED,
    }), 'es');
});

test('browser language is ignored; a first visit defaults to English', () => {
    // Even a Spanish navigator must not pick Spanish: resolveLocale takes no navigator input.
    assert.equal(resolveLocale({
        navigatorLanguages: ['es-MX', 'es'],
        supported: SUPPORTED,
    }), 'en');
});

test('unsupported candidates are skipped, not fatal', () => {
    // A user row carrying a locale we stopped shipping must not break the app.
    assert.equal(resolveLocale({
        userLanguage: 'fr',
        stored: 'de',
        panelDefault: 'ja',
        supported: SUPPORTED,
    }), DEFAULT_LANGUAGE);
});

test('falls back to English when nothing matches', () => {
    assert.equal(resolveLocale({
        userLanguage: 'fr',
        supported: SUPPORTED,
    }), DEFAULT_LANGUAGE);
    assert.equal(resolveLocale({ supported: SUPPORTED }), DEFAULT_LANGUAGE);
    assert.equal(resolveLocale(), DEFAULT_LANGUAGE);
});

test('null user language is not the same as choosing English', () => {
    // The column is nullable for exactly this: "never chose" must fall through
    // to the panel default, while an explicit 'en' must pin English.
    assert.equal(resolveLocale({
        userLanguage: null, panelDefault: 'es', supported: SUPPORTED,
    }), 'es');
    assert.equal(resolveLocale({
        userLanguage: 'en', panelDefault: 'es', supported: SUPPORTED,
    }), 'en');
});

test('every shipped language has a usable manifest row', () => {
    for (const code of SUPPORTED_CODES) {
        const info = languageInfo(code);
        assert.equal(info.code, code);
        assert.ok(info.name && info.nativeName, `${code} needs both names`);
        assert.ok(['ltr', 'rtl'].includes(directionFor(code)), `${code} direction`);
    }
});

test('an unknown code still yields a usable row', () => {
    assert.equal(languageInfo('zz').code, DEFAULT_LANGUAGE);
    assert.equal(directionFor('zz'), 'ltr');
});

test('Arabic activates right-to-left document direction', () => {
    assert.equal(directionFor('ar'), 'rtl');
});
