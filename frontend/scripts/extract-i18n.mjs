#!/usr/bin/env node
// Plan 79 D1 — generate src/i18n/locales/en.json from the source tree.
//
// The inline English default IS the source of truth:
//
//     t('apps.empty.title', 'No applications yet')
//
// en.json is generated from those defaults and must never be hand-edited. Two
// properties follow from that, and they are what make a migration of this size
// survivable:
//
//   * A key that has not been extracted yet still renders correct English, so
//     a half-migrated page is never broken and never shows a raw key path to a
//     user.
//   * Renaming the English copy is a one-place edit in the component; the
//     translations for other locales stay keyed and are visibly stale rather
//     than silently wrong.
//
// Usage (from frontend/):
//   node scripts/extract-i18n.mjs           # write en.json
//   node scripts/extract-i18n.mjs --check   # fail if en.json is out of date

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// `--root <dir> --out <file>` extracts another tree — an extension repo's own
// source into its own bundle. Extensions carry inline English defaults exactly
// like core, so they get en.json generated the same way rather than a second
// extractor that would drift from this one.
const argOf = (name) => (process.argv.includes(name)
    ? process.argv[process.argv.indexOf(name) + 1]
    : null);
const rootArg = argOf('--root');
const outArg = argOf('--out');
const srcDir = rootArg ? resolve(process.cwd(), rootArg) : resolve(root, 'src');
const outFile = outArg
    ? resolve(process.cwd(), outArg)
    : resolve(srcDir, 'i18n', 'locales', 'en.json');

const SKIP_DIRS = new Set(['node_modules', '__mocks__']);
const SKIP_FILE = /\.(test|spec|stories)\.[jt]sx?$/;

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        // An extension that ships its own locales/en.json (an installed,
        // git-ignored copy under src/plugins/) owns its keys; collecting them
        // into core's en.json made the --check fail on machines that have it.
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) return [];
            if (existsSync(join(path, 'plugin.json')) && existsSync(join(path, 'locales', 'en.json'))) return [];
            return walk(path);
        }
        if (!['.js', '.jsx'].includes(extname(entry.name))) return [];
        if (SKIP_FILE.test(entry.name)) return [];
        return [path];
    });
}

// Bare `t(...)` only -- the `const { t } = useTranslation()` idiom.
//
// Deliberately NOT `<anything>.t(...)`: `i18next.t(key, ...)` inside the
// format door re-dispatches a key it was handed, so its argument is a variable
// by construction. Flagging that would make the door unextractable while the
// literal keys at its own call sites are right there to collect.
function isTranslationCall(node) {
    return node.type === 'CallExpression'
        && node.callee.type === 'Identifier'
        && node.callee.name === 't';
}

/**
 * Is SOME default declared? For a computed key the default is computed too
 * (`t(item.labelKey, { defaultValue: item.label })`), so it cannot be
 * extracted — but its presence is still what stops a missing bundle rendering
 * the raw key path to a user, and that is what this gate is for.
 */
function hasDefault(node) {
    const [, second, third] = node.arguments;
    if (second?.type === 'Literal' && typeof second.value === 'string') return true;
    for (const candidate of [second, third]) {
        if (candidate?.type !== 'ObjectExpression') continue;
        for (const property of candidate.properties) {
            if (property.type !== 'Property' || property.computed) continue;
            if ((property.key.name || property.key.value) === 'defaultValue') return true;
        }
    }
    return false;
}

/** The English default declared at a call site, or null. */
function defaultValueOf(node) {
    const [, second, third] = node.arguments;
    if (second?.type === 'Literal' && typeof second.value === 'string') return second.value;
    for (const candidate of [second, third]) {
        if (candidate?.type !== 'ObjectExpression') continue;
        for (const property of candidate.properties) {
            if (property.type !== 'Property' || property.computed) continue;
            const key = property.key.name || property.key.value;
            if (key === 'defaultValue' && property.value.type === 'Literal') {
                return String(property.value.value);
            }
        }
    }
    return null;
}

// Plurals: `t('k', { count, defaultValue_one: '1 file', defaultValue_other:
// '{{count}} files' })`. i18next resolves `k_one` / `k_other` by the
// language's plural rules, so the extractor writes those keys, never a bare
// `k`. A hand-rolled `file{{s}}` or `file(s)` cannot be translated: other
// languages have more than two forms, and check-i18n accepts a translator's
// `k_few` / `k_many` next to the English pair.
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** { one: '…', other: '…' } declared at a call site, or null. */
function pluralDefaultsOf(node) {
    const [, second, third] = node.arguments;
    for (const candidate of [second, third]) {
        if (candidate?.type !== 'ObjectExpression') continue;
        const forms = {};
        for (const property of candidate.properties) {
            if (property.type !== 'Property' || property.computed) continue;
            const name = property.key.name || property.key.value;
            const match = /^defaultValue_(\w+)$/.exec(name);
            if (match && PLURAL_SUFFIXES.includes(match[1])
                && property.value.type === 'Literal' && typeof property.value.value === 'string') {
                forms[match[1]] = property.value.value;
            }
        }
        if (forms.one !== undefined || forms.other !== undefined) return forms;
    }
    return null;
}

// Declarative keys in data files.
//
// A label sitting in a data table (sidebarItems.js, tab tables, column defs)
// is still copy, but it cannot be a `t()` call: resolving at module load would
// translate it once, at import, and never again on a locale switch. So the
// data declares the pair
//
//     { labelKey: 'nav.dashboard', label: 'Dashboard' }
//
// and the renderer resolves `t(item.labelKey, item.label)` at render time.
// This collects the pair at its declaration site, the only place both halves
// are literal.
// A dotted, lowercase-namespaced path: `nav.dashboard`, `common.actions.save`.
const TRANSLATION_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;

function declarativePairs(node) {
    if (node.type !== 'ObjectExpression') return null;
    const literals = new Map();
    for (const property of node.properties) {
        if (property.type !== 'Property' || property.computed) continue;
        const name = property.key.name || property.key.value;
        if (property.value?.type === 'Literal' && typeof property.value.value === 'string') {
            literals.set(name, property.value.value);
        }
    }
    const pairs = [];
    for (const [name, value] of literals) {
        if (!name.endsWith('Key')) continue;
        const sibling = name.slice(0, -3);
        // The value must LOOK like a translation key. `Key` already means
        // "identifier" in several places -- `archKey: 'amd64'` next to
        // `arch: 'x64 (amd64)'` is a CPU architecture, not copy, and a looser
        // rule silently pulled it into en.json.
        if (!TRANSLATION_KEY.test(value)) continue;
        if (literals.has(sibling)) pairs.push({ key: value, value: literals.get(sibling) });
    }
    return pairs.length ? pairs : null;
}

// <Trans i18nKey="..." defaults="Type <0>{{value}}</0> to confirm:" />
//
// A sentence with an element inside it cannot be a plain `t()` call, and it
// must not be split into prefix/suffix keys either: word order differs by
// language, and a split sentence cannot be reordered by a translator.
function transPair(node) {
    if (node.type !== 'JSXElement') return null;
    const name = node.openingElement?.name;
    if (name?.type !== 'JSXIdentifier' || name.name !== 'Trans') return null;

    const literals = new Map();
    for (const attribute of node.openingElement.attributes) {
        if (attribute.type !== 'JSXAttribute') continue;
        if (attribute.value?.type === 'Literal' && typeof attribute.value.value === 'string') {
            literals.set(attribute.name.name, attribute.value.value);
        }
    }
    const key = literals.get('i18nKey');
    const value = literals.get('defaults');
    return key && value ? { key, value } : null;
}

function visit(node, onCall, onPair) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) visit(child, onCall, onPair);
        return;
    }
    if (!node.type) return;
    if (isTranslationCall(node)) onCall(node);
    const pairs = declarativePairs(node);
    if (pairs) for (const pair of pairs) onPair(pair, node);
    const trans = transPair(node);
    if (trans) onPair(trans, node);
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'range') continue;
        visit(node[key], onCall, onPair);
    }
}

export function collect() {
    const entries = new Map();       // key -> { value, sites: [] }
    const problems = [];

    for (const path of walk(srcDir)) {
        const rel = relative(root, path).replaceAll('\\', '/');
        let ast;
        try {
            ast = parse(readFileSync(path, 'utf8'), {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: { jsx: true },
                loc: true,
            });
        } catch (error) {
            problems.push(`${rel}: parse failed — ${error.message}`);
            continue;
        }

        const record = (key, value, site) => {
            const existing = entries.get(key);
            if (existing && existing.value !== value) {
                problems.push(
                    `${site}: key '${key}' redefines the English default\n`
                    + `        here:  ${JSON.stringify(value)}\n`
                    + `        there: ${JSON.stringify(existing.value)} (${existing.sites[0]})`,
                );
                return;
            }
            if (existing) {
                existing.sites.push(site);
                return;
            }
            entries.set(key, { value, sites: [site] });
        };

        visit(
            ast,
            (node) => {
                const first = node.arguments[0];
                const site = `${rel}:${node.loc.start.line}`;
                const value = defaultValueOf(node);

                if (first?.type !== 'Literal' || typeof first.value !== 'string') {
                    // A computed key is legitimate when the pair was declared
                    // in data (see declarativePair) and this site only resolves
                    // it -- but only if a default rides along, or a missing
                    // bundle renders the raw key path to a user.
                    if (!hasDefault(node)) {
                        problems.push(`${site}: t() has a computed key and no defaultValue`);
                    }
                    return;
                }
                const plural = pluralDefaultsOf(node);
                if (plural) {
                    if (plural.other === undefined) {
                        problems.push(`${site}: t('${first.value}') declares plural defaults without defaultValue_other`);
                        return;
                    }
                    for (const [suffix, form] of Object.entries(plural)) {
                        record(`${first.value}_${suffix}`, form, site);
                    }
                    return;
                }
                if (value === null) {
                    problems.push(`${site}: t('${first.value}') has no inline English default`);
                    return;
                }
                record(first.value, value, site);
            },
            (pair, node) => record(pair.key, pair.value, `${rel}:${node.loc.start.line}`),
        );
    }

    return { entries, problems };
}

/** Dotted keys into the nested shape the locale files use. */
export function nest(entries) {
    const tree = {};
    const problems = [];

    for (const key of [...entries.keys()].sort()) {
        const parts = key.split('.');
        let node = tree;
        let ok = true;
        for (const part of parts.slice(0, -1)) {
            if (typeof node[part] === 'string') {
                problems.push(`key '${key}' nests under '${part}', which is already a string`);
                ok = false;
                break;
            }
            node[part] = node[part] || {};
            node = node[part];
        }
        if (!ok) continue;
        const leaf = parts[parts.length - 1];
        if (node[leaf] && typeof node[leaf] === 'object') {
            problems.push(`key '${key}' is both a string and a namespace`);
            continue;
        }
        node[leaf] = entries.get(key).value;
    }

    return { tree, problems };
}

const { entries, problems: collectProblems } = collect();
const { tree, problems: nestProblems } = nest(entries);
const problems = [...collectProblems, ...nestProblems];

if (problems.length) {
    console.error('\ni18n extraction failed:\n');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('\n  Every t() needs a literal key and an inline English default:');
    console.error("      t('apps.empty.title', 'No applications yet')\n");
    process.exit(1);
}

const serialized = `${JSON.stringify(tree, null, 4)}\n`;

if (process.argv.includes('--check')) {
    let current = '';
    try {
        current = readFileSync(outFile, 'utf8');
    } catch {
        current = '';
    }
    if (current !== serialized) {
        console.error('\nen.json is out of date — it is generated, not written.\n');
        console.error('  node scripts/extract-i18n.mjs\n');
        process.exit(1);
    }
    console.log(`✓ en.json is current (${entries.size} keys).`);
    process.exit(0);
}

writeFileSync(outFile, serialized);
console.log(`✓ wrote ${relative(root, outFile).replaceAll('\\', '/')} — ${entries.size} keys.`);
