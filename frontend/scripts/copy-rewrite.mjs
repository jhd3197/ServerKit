#!/usr/bin/env node
// Rewrite English copy at its source of truth: the inline default literal.
//
// en.json is generated from the inline defaults (scripts/extract-i18n.mjs), so
// changing copy means editing every literal that declares a key's English:
//
//     t('k', 'English')                       second argument
//     t('k', 'English {{x}}', { x })          second argument
//     t('k', { defaultValue: 'English' })     defaultValue property
//     { labelKey: 'k', label: 'English' }     sibling of any `<name>Key`
//     <Trans i18nKey="k" defaults="English" /> defaults attribute
//
// This walks the same shapes extract-i18n reads, so a key the extractor sees
// is a key this tool can rewrite. Keys never change; only the English does.
//
// Usage (from frontend/):
//   node scripts/copy-rewrite.mjs map.json             # apply {key: "new English"}
//   node scripts/copy-rewrite.mjs map.json --dry-run   # report only
//   node scripts/copy-rewrite.mjs --list sites.json    # dump every site as JSON
//
// Options:
//   --root <dir>        tree to walk (default: src)
//   --exclude <prefix>  skip files under <prefix> (relative to frontend/,
//                       repeatable; default: src/plugins/)
//   --include-plugins   do not apply the default src/plugins/ exclusion
//
// The quote style of each literal is kept. A JS literal escapes as needed; a
// JSX attribute cannot escape, so it switches to the other quote, and a value
// holding both quote kinds is reported and left alone. Line endings and every
// byte outside the rewritten literals are untouched.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const srcDir = resolve(root, argOf('--root') || 'src');
const excludes = [];
args.forEach((a, i) => { if (a === '--exclude') excludes.push(args[i + 1]); });
if (!args.includes('--include-plugins') && !excludes.length) excludes.push('src/plugins/');
const dryRun = args.includes('--dry-run');
const listOut = argOf('--list');
const mapFile = args.find((a, i) => !a.startsWith('--')
    && !['--root', '--exclude', '--list'].includes(args[i - 1]));

const SKIP_DIRS = new Set(['node_modules', '__mocks__']);
const SKIP_FILE = /\.(test|spec|stories)\.[jt]sx?$/;
const TRANSLATION_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)+$/;

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(path);
        if (!['.js', '.jsx'].includes(extname(entry.name))) return [];
        if (SKIP_FILE.test(entry.name)) return [];
        return [path];
    });
}

const isStr = (n) => n?.type === 'Literal' && typeof n.value === 'string';

/** Every (key, default-literal node) pair in one AST. */
function sitesOf(ast) {
    const out = [];
    const visit = (node, parent) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach((c) => visit(c, parent)); return; }
        if (!node.type) return;

        if (node.type === 'CallExpression' && node.callee.type === 'Identifier'
            && node.callee.name === 't' && isStr(node.arguments[0])) {
            const [first, second, third] = node.arguments;
            if (isStr(second)) {
                out.push({ key: first.value, lit: second, shape: 'call', jsx: false });
            } else {
                for (const cand of [second, third]) {
                    if (cand?.type !== 'ObjectExpression') continue;
                    const prop = cand.properties.find((p) => p.type === 'Property' && !p.computed
                        && (p.key.name || p.key.value) === 'defaultValue');
                    if (prop && isStr(prop.value)) {
                        out.push({ key: first.value, lit: prop.value, shape: 'defaultValue', jsx: false });
                        break;
                    }
                }
            }
        }

        if (node.type === 'ObjectExpression') {
            const lits = new Map();
            for (const p of node.properties) {
                if (p.type !== 'Property' || p.computed) continue;
                if (isStr(p.value)) lits.set(p.key.name || p.key.value, p.value);
            }
            for (const [name, lit] of lits) {
                if (!name.endsWith('Key') || !TRANSLATION_KEY.test(lit.value)) continue;
                const sib = lits.get(name.slice(0, -3));
                if (sib) out.push({ key: lit.value, lit: sib, shape: `pair:${name.slice(0, -3)}`, jsx: false });
            }
        }

        if (node.type === 'JSXElement') {
            const nm = node.openingElement?.name;
            if (nm?.type === 'JSXIdentifier' && nm.name === 'Trans') {
                const attrs = new Map();
                for (const a of node.openingElement.attributes) {
                    if (a.type === 'JSXAttribute' && isStr(a.value)) attrs.set(a.name.name, a.value);
                }
                if (attrs.get('i18nKey') && attrs.get('defaults')) {
                    out.push({ key: attrs.get('i18nKey').value, lit: attrs.get('defaults'), shape: 'trans', jsx: true });
                }
            }
        }

        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'loc' || k === 'range' || k === 'parent') continue;
            visit(node[k], node);
        }
    };
    visit(ast, null);
    return out;
}

/** Source text for a literal holding `value`, in the style of `raw`. */
function literalFor(value, raw, jsx) {
    const q = raw[0] === '"' ? '"' : "'";
    const alt = q === '"' ? "'" : '"';
    if (jsx) {
        if (!value.includes(q)) return q + value + q;
        if (!value.includes(alt)) return alt + value + alt;
        return null;
    }
    const quote = value.includes(q) && !value.includes(alt) ? alt : q;
    const body = value
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`)
        .split(quote).join(`\\${quote}`);
    return quote + body + quote;
}

const files = walk(srcDir).filter((p) => {
    const rel = relative(root, p).replaceAll('\\', '/');
    return !excludes.some((ex) => rel.startsWith(ex));
});

const map = mapFile ? JSON.parse(readFileSync(resolve(process.cwd(), mapFile), 'utf8')) : {};
const listing = [];
const touched = new Map();       // key -> [{ site, old }]
const problems = [];
let filesChanged = 0;

for (const path of files) {
    const rel = relative(root, path).replaceAll('\\', '/');
    const src = readFileSync(path, 'utf8');
    let ast;
    try {
        ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true });
    } catch (error) {
        problems.push(`${rel}: parse failed — ${error.message}`);
        continue;
    }
    const sites = sitesOf(ast);
    if (listOut) {
        for (const s of sites) {
            listing.push({ key: s.key, value: s.lit.value, file: rel, line: s.lit.loc.start.line, shape: s.shape });
        }
        continue;
    }
    const edits = [];
    for (const s of sites) {
        if (!Object.prototype.hasOwnProperty.call(map, s.key)) continue;
        const next = map[s.key];
        const site = `${rel}:${s.lit.loc.start.line}`;
        if (!touched.has(s.key)) touched.set(s.key, []);
        touched.get(s.key).push({ site, old: s.lit.value });
        if (s.lit.value === next) continue;
        const text = literalFor(next, s.lit.raw, s.jsx);
        if (text === null) {
            problems.push(`${site}: '${s.key}' — JSX attribute cannot hold both quote kinds; left alone`);
            continue;
        }
        edits.push({ start: s.lit.range[0], end: s.lit.range[1], text });
    }
    if (!edits.length) continue;
    edits.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    filesChanged += 1;
    if (!dryRun) writeFileSync(path, out, 'utf8');
}

if (listOut) {
    writeFileSync(resolve(process.cwd(), listOut), `${JSON.stringify(listing, null, 1)}\n`);
    console.log(`listed ${listing.length} sites in ${files.length} files -> ${listOut}`);
    process.exit(0);
}

const missing = Object.keys(map).filter((k) => !touched.has(k));
const multi = [...touched].filter(([, s]) => s.length > 1);
const divergent = multi.filter(([, s]) => new Set(s.map((x) => x.old)).size > 1);
const changed = [...touched].filter(([k, s]) => s.some((x) => x.old !== map[k]));

console.log(`${dryRun ? '[dry-run] ' : ''}keys in map: ${Object.keys(map).length}`);
console.log(`  rewritten: ${changed.length} keys across ${filesChanged} files`);
console.log(`  multi-site keys: ${multi.length} (all sites rewritten)`);
for (const [k, s] of divergent) {
    console.log(`  divergent defaults for '${k}': ${s.map((x) => `${x.site} ${JSON.stringify(x.old)}`).join(' | ')}`);
}
if (missing.length) {
    console.log(`  not found (${missing.length}): ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ', …' : ''}`);
}
for (const p of problems) console.log(`  PROBLEM ${p}`);
process.exit(problems.length ? 1 : 0);
