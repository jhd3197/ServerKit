#!/usr/bin/env node
// Plan 79 D3 ratchet — untranslated user-visible copy.
//
// Counts string literals that a user can READ and that are not addressed by a
// translation key. Five shapes, because copy escapes into all five:
//
//   1. JSX text nodes            <p>No applications yet</p>
//   2. JSX copy attributes       <Input placeholder="Search apps" />
//   3. Toast / confirm arguments toast.error('Failed to save')
//   4. Copy keys in data objects { label: 'Applications' }   <- sidebarItems.js
//   5. Inline alternatives       {saving ? 'Saving…' : 'Save'}  {`${n} services`}
//
// Shapes 4 and 5 look through the expression to the strings a user can end
// up reading: both arms of a ternary, the fallback of `a || 'Unknown'`, the
// right side of `ok && 'Ready'`, and the text of a template literal (its
// `${}` holes stand in as {{x}}). The CONDITION of a ternary is not read --
// `status === 'Running' ? ...` compares a value, it does not show one.
//
// Shape 4 is the one that usually escapes an extraction pass: a label sitting
// in a data file is still copy, and if it is resolved at module load it also
// never re-renders on a locale switch. It is counted so that converting those
// files is visible here.
//
// A literal is exempt when it is an argument of `t(...)` — that is the whole
// point of the migration — or when it does not look like prose (see isCopy).
//
// This is a ratchet, not a gate: the count may only go down. It is seeded
// BEFORE the migration starts (plan 76 rule 1: a migration without a ratchet
// regrows) so that a new page, or plan 68's Recipes surface, cannot add
// untranslated copy without failing `npm run lint`.
//
// Usage (from frontend/):
//   node scripts/check-i18n-literals.mjs            # check against the ceiling
//   node scripts/check-i18n-literals.mjs --report   # list the worst files
//   node scripts/check-i18n-literals.mjs --report --file src/pages/Apps.jsx
//   node scripts/check-i18n-literals.mjs --update    # write the current count

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// `--root <dir>` points the census at another tree — an extension repo's own
// src/. Extensions ship UI with the same copy problem and none of them live
// under frontend/src, so without this the ratchet cannot see them at all.
// An extension repo runs this file from the host checkout rather than copying
// it, which is how the vendor shims drifted.
const rootArg = process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : null;
const srcDir = rootArg ? resolve(process.cwd(), rootArg) : resolve(root, 'src');
const ceilingFile = resolve(here, 'I18N_LITERAL_CEILING');

// Slack before the ceiling is considered stale. Larger than the style
// ratchet's 5 because this census starts in the thousands and a single page
// conversion moves it by dozens; smaller than a wave, so a finished wave still
// has to write its result down.
const STALE_SLACK = 50;

// Props whose value is read by a human. `title` is here even though it is
// sometimes a machine value — the false positives are excluded by isCopy.
const COPY_PROPS = new Set([
    'label', 'placeholder', 'title', 'description', 'helpText', 'help',
    'emptyText', 'emptyMessage', 'confirmText', 'cancelText', 'submitText',
    'heading', 'subtitle', 'subheading', 'caption', 'hint', 'tooltip',
    'alt', 'aria-label', 'aria-description', 'aria-placeholder',
    'message', 'text', 'buttonText', 'actionLabel', 'header',
]);

// Object keys that carry copy in data files (sidebarItems.js, column defs,
// wizard step tables, validation maps).
const COPY_KEYS = new Set([
    'label', 'title', 'description', 'placeholder', 'helpText', 'help',
    'emptyText', 'emptyMessage', 'confirmText', 'cancelText', 'submitText',
    'heading', 'subtitle', 'subheading', 'caption', 'hint', 'tooltip',
    'message', 'buttonText', 'actionLabel', 'header', 'summary',
]);

// Callees whose string arguments are shown to a user.
const COPY_CALLS = new Set([
    'success', 'error', 'info', 'warning', 'warn', 'message', 'loading',
    'showToast', 'toast', 'notify', 'confirm', 'alert',
]);
const TOAST_OBJECTS = new Set(['toast', 'toasts', 'sonner', 'notifications']);

// Directories that hold no user-facing copy, or hold it deliberately.
const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules']);
const SKIP_FILE = /\.(test|spec|stories)\.[jt]sx?$/;
// The i18n plumbing itself: locale JSON loaders, the manifest, the format
// door's own fallback strings.
const SKIP_PATH = /^(i18n\/|data\/bundledThemes)/;

// A dotted, lowercase-namespaced path: `nav.dashboard`, `common.actions.save`.
const TRANSLATION_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;

/**
 * Does this literal read as prose a user would notice?
 *
 * Deliberately generous on the exclusion side: a ratchet that flags
 * `className="btn"` trains people to ignore it. The rule is "contains a space,
 * or is a capitalised word of 3+ characters" — which keeps "Save" and
 * "No results found" and drops "sm", "btn-primary", "app_id", "/api/v1/apps".
 */
function isCopy(raw) {
    const value = String(raw).trim();
    if (value.length < 2) return false;
    if (!/[A-Za-z]/.test(value)) return false;          // numbers, symbols, spacers
    if (/^https?:\/\//.test(value)) return false;        // URLs
    if (/^[/#.]/.test(value)) return false;              // routes, selectors, anchors
    if (/^[a-z0-9]+([-_.:][a-z0-9]+)+$/.test(value)) return false;  // ids, css classes, keys
    if (/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(value)) return false;       // CONSTANT_CASE
    if (/^[a-z]+$/.test(value)) return false;            // bare lowercase token: 'sm', 'primary'
    if (/^\{\{.*\}\}$/.test(value)) return false;        // interpolation placeholder
    if (/^[a-z][a-zA-Z0-9]*$/.test(value)) return false; // camelCase identifier
    return /\s/.test(value) || /^[A-Z].{2,}/.test(value);
}

function walkFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name) ? [] : walkFiles(join(dir, entry.name));
        }
        const ext = extname(entry.name);
        if (ext !== '.js' && ext !== '.jsx') return [];
        if (SKIP_FILE.test(entry.name)) return [];
        return [join(dir, entry.name)];
    });
}

function calleeName(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed) {
        return node.property?.name ?? null;
    }
    return null;
}

function calleeObject(node) {
    if (node?.type === 'MemberExpression' && node.object?.type === 'Identifier') {
        return node.object.name;
    }
    return null;
}

/** Is this a translation call — `t(...)`, `i18n.t(...)`, `props.t(...)`? */
function isTranslationCall(node) {
    if (node.type !== 'CallExpression') return false;
    return calleeName(node.callee) === 't';
}

function attributeName(attr) {
    const name = attr.name;
    if (!name) return null;
    return name.type === 'JSXNamespacedName'
        ? `${name.namespace.name}:${name.name.name}`
        : name.name;
}

function propertyKey(prop) {
    if (prop.computed) return null;
    const key = prop.key;
    if (!key) return null;
    return key.type === 'Identifier' ? key.name : (typeof key.value === 'string' ? key.value : null);
}

/** Every string literal reachable from a node, ignoring nested translation calls. */
function collectStrings(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) collectStrings(child, out);
        return;
    }
    if (!node.type) return;
    if (isTranslationCall(node)) return;
    // Stop at nested JSX. A copy prop holding an element —
    // `message={<span>… <a rel="noopener noreferrer">…</a></span>}` — must not
    // have that element's OWN attributes counted: `rel` is not copy, and the
    // walk reaches the element on its own terms anyway. Counting them made the
    // ratchet unreachable on correct code.
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') return;
    if (node.type === 'Literal' && typeof node.value === 'string') {
        out.push(node);
        return;
    }
    if (node.type === 'TemplateLiteral') {
        out.push({ loc: node.loc, value: templateText(node) });
        for (const expr of node.expressions) collectStrings(expr, out);
        return;
    }
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
        collectStrings(node[key], out);
    }
}

// A template literal read as one sentence: `${n} services` is the copy
// "{{x}} services", not the lone word "services" (which isCopy would drop as
// a bare lowercase token).
const HOLE = '{{x}}';
function templateText(node) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(HOLE);
}

/**
 * The strings a user can end up READING out of an expression, without the
 * ones it merely computes with. Ternaries yield both arms (never the test);
 * `a || 'x'` and `a ?? 'x'` yield both sides; `ok && 'x'` only the right one;
 * a template literal yields its text. Calls (t() included), member reads and
 * JSX stop the walk -- JSX is visited on its own terms.
 */
function leafStrings(node, out) {
    if (!node) return;
    switch (node.type) {
        case 'Literal':
            if (typeof node.value === 'string') out.push(node);
            return;
        case 'TemplateLiteral':
            out.push({ loc: node.loc, value: templateText(node) });
            for (const expr of node.expressions) leafStrings(expr, out);
            return;
        case 'ConditionalExpression':
            leafStrings(node.consequent, out);
            leafStrings(node.alternate, out);
            return;
        case 'LogicalExpression':
            if (node.operator !== '&&') leafStrings(node.left, out);
            leafStrings(node.right, out);
            return;
        default:
            return;
    }
}

const INLINE_SHAPES = new Set(['ConditionalExpression', 'LogicalExpression', 'TemplateLiteral', 'Literal']);

function censusFile(path, rel) {
    const source = readFileSync(path, 'utf8');
    let ast;
    try {
        ast = parse(source, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
            loc: true,
        });
    } catch (error) {
        // A file this script cannot parse cannot be censused; failing loudly
        // beats silently dropping its literals out of the ceiling.
        throw new Error(`${rel}: parse failed — ${error.message}`);
    }

    const hits = [];
    // Properties exempted because the object also declares a translation key
    // for them: `{ labelKey: 'nav.apps', label: 'Applications' }`. The label is
    // the English default for that key, resolved at render -- not stray copy.
    const keyed = new WeakSet();
    const record = (node, kind, value) => {
        const text = String(value).trim().replace(/\s+/g, ' ');
        // `${a} ${b}` is all holes: nothing in it is copy of its own.
        if (text.includes(HOLE) && !/[A-Za-z]{2,}/.test(text.split(HOLE).join(' '))) return;
        if (!isCopy(text)) return;
        hits.push({ line: node.loc?.start.line ?? 0, kind, text: text.slice(0, 70) });
    };

    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) visit(child);
            return;
        }
        if (!node.type) return;

        // 0. Translated already — the literal inside `t('k', 'Default')` is the
        //    source of English, not an untranslated string. Do not descend.
        if (isTranslationCall(node)) return;

        switch (node.type) {
            // 1. JSX text nodes.
            case 'JSXText':
                record(node, 'text', node.value);
                break;

            // 5. Inline alternatives rendered as a child:
            //    {saving ? 'Saving…' : 'Save'}   {`${n} services`}   {err || 'Failed'}
            //    Attribute values are not children; shape 2 owns those.
            case 'JSXElement':
            case 'JSXFragment':
                for (const child of node.children) {
                    if (child.type !== 'JSXExpressionContainer') continue;
                    if (!INLINE_SHAPES.has(child.expression?.type)) continue;
                    const strings = [];
                    leafStrings(child.expression, strings);
                    for (const literal of strings) record(literal, 'expr', literal.value);
                }
                break;

            // 2. JSX copy attributes.
            case 'JSXAttribute': {
                const name = attributeName(node);
                if (name && COPY_PROPS.has(name) && node.value) {
                    if (node.value.type === 'Literal' && typeof node.value.value === 'string') {
                        record(node, 'prop', node.value.value);
                    } else if (node.value.type === 'JSXExpressionContainer') {
                        const strings = [];
                        // A ternary's test is a comparison, not copy:
                        // title={status === 'Running' ? t(...) : t(...)}.
                        if (INLINE_SHAPES.has(node.value.expression?.type)) {
                            leafStrings(node.value.expression, strings);
                        } else {
                            collectStrings(node.value.expression, strings);
                        }
                        for (const literal of strings) record(literal, 'prop', literal.value);
                    }
                    // Value handled; keep descending for nested JSX only.
                    if (node.value.type === 'JSXExpressionContainer') break;
                    return;
                }
                break;
            }

            // 3. Toast / confirm arguments.
            case 'CallExpression': {
                const name = calleeName(node.callee);
                const object = calleeObject(node.callee);
                const isCopyCall = name && COPY_CALLS.has(name)
                    && (object === null || TOAST_OBJECTS.has(object) || name === 'confirm');
                if (isCopyCall) {
                    for (const arg of node.arguments) {
                        const strings = [];
                        collectStrings(arg, strings);
                        for (const literal of strings) record(literal, 'toast', literal.value);
                    }
                    for (const arg of node.arguments) visit(arg);
                    return;
                }
                break;
            }

            // Declarative key pairs, marked before their properties are seen.
            case 'ObjectExpression': {
                const named = new Map();
                for (const property of node.properties) {
                    if (property.type !== 'Property' || property.computed) continue;
                    named.set(property.key?.name || property.key?.value, property);
                }
                for (const [name, property] of named) {
                    if (!name || !name.endsWith('Key')) continue;
                    if (property.value?.type !== 'Literal') continue;
                    if (!TRANSLATION_KEY.test(String(property.value.value))) continue;
                    const sibling = named.get(name.slice(0, -3));
                    if (sibling) keyed.add(sibling);
                }
                break;
            }

            // 4. Copy keys in data objects.
            case 'Property': {
                if (keyed.has(node)) return;
                const key = propertyKey(node);
                if (key && COPY_KEYS.has(key) && node.value?.type === 'Literal'
                    && typeof node.value.value === 'string') {
                    record(node, 'data', node.value.value);
                    return;
                }
                // { label: busy ? 'Saving…' : 'Save' }, { title: `Delete ${name}` }
                if (key && COPY_KEYS.has(key) && INLINE_SHAPES.has(node.value?.type)) {
                    const strings = [];
                    leafStrings(node.value, strings);
                    for (const literal of strings) record(literal, 'data', literal.value);
                    // Keep descending: an arm may hold JSX or a t() call.
                }
                break;
            }

            default:
                break;
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
            visit(node[key]);
        }
    };

    visit(ast);
    return hits;
}

/**
 * Extension copies under plugins/ that git does not track: a sibling repo's
 * build dropped into a dev checkout. They are censused in their own repo
 * (`--root`), and counting them here made the host number depend on which
 * extensions a machine happens to have installed -- a fresh clone could never
 * reach a ceiling written on a dev box. Null when git is unavailable (release
 * tarball): then everything on disk is counted.
 */
function trackedPluginDirs() {
    if (rootArg) return null;
    try {
        const out = execFileSync('git', ['ls-files', '--', 'plugins'], {
            cwd: srcDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        return new Set(out.split('\n').filter(Boolean).map((line) => line.split('/')[1]));
    } catch {
        return null;
    }
}

export function census() {
    const byFile = new Map();
    const tracked = trackedPluginDirs();
    for (const path of walkFiles(srcDir)) {
        const rel = relative(srcDir, path).replaceAll('\\', '/');
        if (SKIP_PATH.test(rel)) continue;
        const parts = rel.split('/');
        if (tracked && parts[0] === 'plugins' && parts.length > 2 && !tracked.has(parts[1])) continue;
        const hits = censusFile(path, rel);
        if (hits.length) byFile.set(rel, hits);
    }
    return byFile;
}

const byFile = census();
const count = [...byFile.values()].reduce((total, hits) => total + hits.length, 0);

if (process.argv.includes('--update')) {
    if (rootArg) {
        console.error('--update writes the HOST ceiling; refusing to do that from --root.');
        process.exit(2);
    }
    writeFileSync(ceilingFile, `${count}\n`);
    console.log(`i18n literal ceiling updated to ${count}`);
    process.exit(0);
}

if (process.argv.includes('--report')) {
    const fileArg = process.argv[process.argv.indexOf('--file') + 1];
    if (process.argv.includes('--file') && fileArg) {
        const key = fileArg.replace(/\\/g, '/').replace(/^(frontend\/)?src\//, '');
        const hits = byFile.get(key) || [];
        for (const hit of hits) {
            console.log(`  ${String(hit.line).padStart(5)}  ${hit.kind.padEnd(5)}  ${hit.text}`);
        }
        console.log(`\n${key}: ${hits.length}`);
        process.exit(0);
    }
    const rows = [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, 40);
    for (const [file, hits] of rows) {
        const kinds = hits.reduce((acc, hit) => {
            acc[hit.kind] = (acc[hit.kind] || 0) + 1;
            return acc;
        }, {});
        const detail = Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(' ');
        console.log(`  ${String(hits.length).padStart(4)}  ${file.padEnd(58)} ${detail}`);
    }
    console.log(`\ntotal: ${count} untranslated literals in ${byFile.size} files`);
    process.exit(0);
}

const ceiling = Number(readFileSync(ceilingFile, 'utf8').trim());

if (count > ceiling) {
    const worst = [...byFile].sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    console.error('\ni18n literal check failed:\n');
    console.error(`  ${count} untranslated user-visible literals; the ceiling is ${ceiling}.`);
    console.error('  New copy must go through a translation key:\n');
    console.error("      import { useTranslation } from 'react-i18next';");
    console.error('      const { t } = useTranslation();');
    console.error("      <h2>{t('apps.empty.title', 'No applications yet')}</h2>\n");
    console.error('  The second argument is the English default — it is what `en.json` is');
    console.error('  generated from, so it is never wrong to include it.\n');
    for (const [file, hits] of worst) {
        console.error(`  ${String(hits.length).padStart(4)}  ${file}`);
    }
    console.error('\n  node scripts/check-i18n-literals.mjs --report --file <path>  to see them\n');
    process.exit(1);
}

if (ceiling - count > STALE_SLACK) {
    console.error(`\ni18n literal ceiling is ${ceiling} but only ${count} remain; run`);
    console.error('  node scripts/check-i18n-literals.mjs --update\n');
    process.exit(1);
}

console.log(`✓ i18n literals: ${count} untranslated literals remain ratcheted (ceiling ${ceiling}).`);
