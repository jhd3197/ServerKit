#!/usr/bin/env node
// Plan 79 D2 — locale-file integrity.
//
// Four assertions, each guarding a failure that is invisible until a user in
// that language hits it:
//
//   1. No orphan keys. A key in es.json that no longer exists in en.json is
//      dead weight at best, and at worst hides that the English moved on.
//   2. No missing interpolation placeholders. A translation that drops
//      `{{count}}` renders a sentence with a hole in it; one that keeps a
//      placeholder English no longer passes renders literal braces to a user.
//   3. Same shape. A leaf in one file and a namespace in another means one of
//      the two renders "[object Object]".
//   4. The manifest and the shipped files agree. A language advertised in the
//      selector with no bundle silently falls back to English, and the user
//      cannot tell the difference between "not translated" and "broken".
//
// Coverage (how much of the app is keyed at all) is the separate
// check-i18n-literals ratchet; this script is about the files being coherent.
//
// Usage (from frontend/):
//   node scripts/check-i18n.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// `--locales <dir>` checks another tree's bundles — an extension repo's own
// locales/. Same four assertions; extensions get orphan and placeholder drift
// exactly like the panel does, and a dropped {{count}} is just as invisible
// there. `--no-manifest` skips the languages.json cross-check, which only the
// panel has (an extension ships bundles, not a language list).
const localesArg = process.argv.includes('--locales')
    ? process.argv[process.argv.indexOf('--locales') + 1]
    : null;
const skipManifest = process.argv.includes('--no-manifest') || Boolean(localesArg);
const localesDir = localesArg
    ? resolve(process.cwd(), localesArg)
    : resolve(root, 'src', 'i18n', 'locales');
const manifestFile = resolve(root, 'src', 'i18n', 'languages.json');

const DEFAULT_LOCALE = 'en';
const PLURAL_FORM = /^(.+)_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*(\w+)[^}]*\}\}/g;

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/** Flatten a nested locale tree into dotted key -> string. */
function flatten(node, prefix = '', out = new Map()) {
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            flatten(value, path, out);
        } else {
            out.set(path, value);
        }
    }
    return out;
}

function placeholders(value) {
    return new Set([...String(value).matchAll(PLACEHOLDER)].map((match) => match[1]));
}

const problems = [];

const shipped = readdirSync(localesDir)
    .filter((name) => extname(name) === '.json')
    .map((name) => basename(name, '.json'));

// 4. manifest <-> files (panel only)
if (!skipManifest) {
    const manifest = readJson(manifestFile);
    const declared = manifest.languages.map((language) => language.code);
    for (const code of declared) {
        if (!shipped.includes(code)) {
            problems.push(`languages.json advertises '${code}' but src/i18n/locales/${code}.json is missing`);
        }
    }
    for (const code of shipped) {
        if (!declared.includes(code)) {
            problems.push(`src/i18n/locales/${code}.json ships but languages.json does not advertise '${code}'`);
        }
    }
}

const base = flatten(readJson(join(localesDir, `${DEFAULT_LOCALE}.json`)));

for (const code of shipped.filter((name) => name !== DEFAULT_LOCALE)) {
    const translated = flatten(readJson(join(localesDir, `${code}.json`)));

    for (const [key, value] of translated) {
        // 1. orphans. A plural form English lacks (`k_few`, `k_many`) is
        // legitimate when English declares the pair (`k_one` / `k_other`):
        // other languages have more plural categories than English.
        const plural = PLURAL_FORM.exec(key);
        const reference = !base.has(key) && plural && base.has(`${plural[1]}_other`)
            ? `${plural[1]}_other` : key;
        if (!base.has(reference)) {
            problems.push(`${code}.json: '${key}' does not exist in ${DEFAULT_LOCALE}.json`);
            continue;
        }
        // 3. shape
        if (typeof value !== 'string') {
            problems.push(`${code}.json: '${key}' is ${typeof value}, expected a string`);
            continue;
        }
        // 2. placeholders
        const expected = placeholders(base.get(reference));
        const actual = placeholders(value);
        for (const name of expected) {
            if (!actual.has(name)) {
                problems.push(`${code}.json: '${key}' drops the {{${name}}} placeholder`);
            }
        }
        for (const name of actual) {
            if (!expected.has(name)) {
                problems.push(`${code}.json: '${key}' introduces an unknown {{${name}}} placeholder`);
            }
        }
    }
}

if (problems.length) {
    console.error('\ni18n locale check failed:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('');
    process.exit(1);
}

for (const code of shipped.filter((name) => name !== DEFAULT_LOCALE)) {
    const translated = flatten(readJson(join(localesDir, `${code}.json`)));
    const missing = [...base.keys()].filter((key) => !translated.has(key));
    if (missing.length) {
        console.log(`  ${code}: ${missing.length} key(s) not translated yet `
            + `(they render English) — e.g. ${missing.slice(0, 3).join(', ')}`);
    }
}

const translatedCount = shipped.filter((name) => name !== DEFAULT_LOCALE).length;
console.log(
    `✓ i18n locales: ${base.size} keys, ${translatedCount} translated locale(s), no orphans or placeholder drift.`,
);
