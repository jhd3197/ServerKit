#!/usr/bin/env node
// One table. Every list table in the panel renders through ds/DataTable and
// looks exactly like `.sk-dtable` inside `.sk-dtable-wrap`
// (styles/components/_design-system.scss). Fails when a page:
//
//   - restyles table elements (th/td/tr/thead/tbody, nth-child widths) in its
//     own SCSS instead of sizing columns through the column `width` prop,
//   - renders a raw <table> instead of DataTable,
//   - passes a `tableClassName` re-skin to DataTable.
//
// The Databases studio is the one exemption (its grids are an editor, not a
// list). Counts may only go down; lower a ceiling when a migration lands.
// Extension copies under src/plugins/ are out of scope (their source repos
// adopt the SDK DataTable instead).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Files that own table markup or styling.
const OWNERS = new Set([
    'components/ui/table.jsx',
    'components/ds/DataTable.jsx',
    'components/ds/DataTableFooter.jsx',
    'styles/components/_design-system.scss',
    'styles/components/_ui.scss',
    'styles/components/_datagrid.scss',
    'styles/components/_tables.scss',
    // Living documentation of the primitives.
    'pages/StyleGuide.jsx',
    // Dashboard table widget: a widget can be three rows tall, so it keeps
    // compact rows + a sticky head; its styling otherwise follows .sk-dtable.
    'components/dashboard/widgets/renderers.jsx',
    'styles/components/_dashboard-widgets.scss',
]);
// The Databases studio's own stylesheets (its tuner + insights grids).
const EXEMPT = /^(components\/databases\/|styles\/pages\/_(databases|db-tuner)\.scss$|plugins\/)/;

// Remaining legacy sites: the DNS drawer's fixed-layout table (`.ddp__table`
// in _domains.scss + its tableClassName) and the now-unused `.sk-dlog__table`
// rules in _notification-center.scss.
const CEILINGS = {
    scss: 1,
    rawTable: 0,
    tableClassName: 1,
};

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules' || name === '__tests__') continue;
            yield* walk(p);
        } else if (/\.(jsx?|scss)$/.test(name)) {
            yield p;
        }
    }
}

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A selector line (ends in `{` or `,`, or opens a one-line rule
// `sel { … }`) that targets a table element.
const TABLE_SELECTOR = /(^|[\s>+~,(&])(th|td|tr|thead|tbody|table)(?![\w-])[^{;]*(\{|,\s*$)/;

const found = { scss: [], rawTable: [], tableClassName: [] };
for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (OWNERS.has(rel) || EXEMPT.test(rel)) continue;
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
        const where = `${rel}:${i + 1}`;
        if (rel.endsWith('.scss')) {
            if (TABLE_SELECTOR.test(line)) found.scss.push(`${where}  ${line.trim()}`);
        } else {
            if (/<table\b/.test(line)) found.rawTable.push(where);
            if (/\btableClassName=/.test(line)) found.tableClassName.push(where);
        }
    });
}

const LABEL = {
    scss: 'page SCSS styling table elements (size columns via the column `width` prop)',
    rawTable: 'raw <table> (use DataTable)',
    tableClassName: 'tableClassName re-skins (DataTable already is the look)',
};

const report = process.argv.includes('--report');
let failed = false;
for (const key of Object.keys(CEILINGS)) {
    const n = found[key].length;
    if (report || n > CEILINGS[key]) {
        console.log(`${n > CEILINGS[key] ? '✗' : '·'} ${LABEL[key]}: ${n} (ceiling ${CEILINGS[key]})`);
        for (const f of found[key]) console.log(`    ${f}`);
    }
    if (n > CEILINGS[key]) failed = true;
}

if (failed) {
    console.error('\nOne table: render lists through DataTable and leave its look to .sk-dtable.');
    process.exit(1);
}
const total = Object.values(found).reduce((a, b) => a + b.length, 0);
console.log(`✓ tables: one look — ${total} legacy site(s) remain ratcheted (scss ${found.scss.length}/${CEILINGS.scss}, raw ${found.rawTable.length}/${CEILINGS.rawTable}, tableClassName ${found.tableClassName.length}/${CEILINGS.tableClassName}).`);
