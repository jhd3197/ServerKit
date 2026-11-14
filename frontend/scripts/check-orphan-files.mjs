#!/usr/bin/env node
// Fails when a source file under src/ is imported by nothing.
//
// Components, hooks and stylesheets used to outlive the last code that used
// them (20 files, ~2,000 lines, found in one audit), each still costing
// review time and translation strings. Resolution follows relative and `@/`
// imports, dynamic `import()`, and SCSS `@import`/`@use` (bare paths are
// relative to the importing stylesheet). Entry points and glob-loaded trees
// are roots; deliberate keeps live in KEEP with a reason.
//
// Usage (from frontend/): node scripts/check-orphan-files.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src').split('\\').join('/');

// file (relative to src/) -> why it stays without an importer
const KEEP = {
    'main.jsx': 'entry point',
    'styles/main.scss': 'entry stylesheet',
    'plugins/runtime/vendorManifest.js': 'read by the vendor-shim generator and extension bundle checks',
    'utils/snapshotBones.js': 'imported by scripts/capture-skeletons.mjs',
};
// Trees loaded by import.meta.glob, tests, and bundled extension copies.
const ROOT_TREES = [/\/__tests__\//, /\.test\.(m?js|jsx)$/, /^plugins\/serverkit-/, /^plugins\/[^/]+\/index\./,
    /^data\/themes\//, /^i18n\/locales\//];

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name).split('\\').join('/')]);
const files = walk(src).filter((f) => /\.(jsx?|mjs|scss)$/.test(f));
const referenced = new Set();
const EXT = ['', '.js', '.jsx', '.mjs', '.scss', '/index.js', '/index.jsx'];

function resolveSpec(from, spec) {
    let base;
    if (spec.startsWith('@/')) base = `${src}/${spec.slice(2)}`;
    else if (spec.startsWith('.') || from.endsWith('.scss')) base = posix.join(posix.dirname(from), spec);
    else return;
    for (const ext of EXT) {
        for (const candidate of [base + ext, posix.join(posix.dirname(base), `_${posix.basename(base)}`) + ext]) {
            if (existsSync(candidate) && statSync(candidate).isFile()) {
                referenced.add(candidate);
                return;
            }
        }
    }
}

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|@import\s+|@use\s+|@forward\s+)['"]([^'"]+)['"]/g;
for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) resolveSpec(file, match[1]);
}

const orphans = files
    .map((f) => relative(src, f).split('\\').join('/'))
    .filter((rel) => !referenced.has(`${src}/${rel}`) && !KEEP[rel] && !ROOT_TREES.some((re) => re.test(rel)));
const staleKeeps = Object.keys(KEEP).filter((rel) => !existsSync(`${src}/${rel}`));

if (orphans.length || staleKeeps.length) {
    if (orphans.length) {
        console.error(`\n${orphans.length} file(s) under src/ are imported by nothing:\n`);
        for (const rel of orphans) console.error(`  ${rel}`);
        console.error('\nDelete them, or add them to KEEP in scripts/check-orphan-files.mjs with a reason.\n');
    }
    if (staleKeeps.length) console.error(`KEEP lists files that no longer exist: ${staleKeeps.join(', ')}\n`);
    process.exit(1);
}
console.log(`✓ orphan files: every one of ${files.length} source files is imported (${Object.keys(KEEP).length} kept by reason).`);
