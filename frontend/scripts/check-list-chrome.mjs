#!/usr/bin/env node
// One list-page shell. Every page with a table puts its controls in the same
// places, so the create button and the search box never move between pages:
//
//   top bar        [secondary …] [create] [search]      (ds/ListActions)
//   view selector  saved views · filters and fields · copy link / export /
//                  reset · page extras                  (GridViewPicker)
//
// Fails when a page:
//
//   - renders a filter icon or a "⋮" tools menu of its own (they are entries in
//     the view selector's menu: `<GridViewPicker {...chrome.pickerProps} />`),
//   - hoists table controls into the top bar with useTopbarChrome,
//   - puts a filter button in the top bar, or orders the bar differently
//     (create after search, anything after search),
//   - adds a KPI strip to a page that is not an overview.
//
// The allowlists are the known exceptions, each with its reason. They may only
// shrink. Extension copies under src/plugins/ are out of scope.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Files that may render <GridFilterButton> / <GridToolsMenu>.
const CHROME_OWNERS = new Set([
    // A table with no saved views has no selector to hold them (SDK surface).
    'components/layouts/ResourceListPage.jsx',
    // Living documentation of the primitives.
    'pages/StyleGuide.jsx',
]);

// Files that may call useTopbarChrome.
const TOPBAR_CHROME_USERS = new Set([
    'hooks/useTopbarActions.js',
    // A workspace, not a table: its view switch and path tools ride the bar.
    'pages/FileManager.jsx',
]);

// Top bars that keep a filter button: card catalogues with no view selector.
const TOPBAR_FILTER_USERS = new Set([
    'pages/Marketplace.jsx',
]);

// Overview surfaces: the only places a KPI strip belongs. A list of records
// gets none — its counts are the table footer and the saved views.
const KPI_OWNERS = new Set([
    'components/ds/KpiBand.jsx',
    'pages/StyleGuide.jsx',
    'components/backups/ProtectionStatusCard.jsx',
    'pages/Monitoring.jsx',
    // The agent fleet's Dashboard tab and the FTP server's status block.
    'pages/AgentFleet.jsx',
    'pages/FTPServer.jsx',
    // Detail pages; they move to the shared detail header with the rest.
    'pages/MonitorDetail.jsx',
    'pages/QueueDetail.jsx',
]);

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules' || name === '__tests__' || name === 'plugins') continue;
            yield* walk(p);
        } else if (/\.jsx?$/.test(name)) {
            yield p;
        }
    }
}

function stripComments(src) {
    return src
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:'"`])\/\/.*$/gm, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

// The balanced (...) argument list of the call that starts at `from`.
function callBlock(src, from) {
    const start = src.indexOf('(', from);
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return '';
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

const problems = [];
for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    const src = stripComments(readFileSync(file, 'utf8'));
    const inGrid = rel.startsWith('components/ds/grid/');

    if (!inGrid && !CHROME_OWNERS.has(rel)) {
        for (const m of src.matchAll(/<(GridFilterButton|GridToolsMenu)\b/g)) {
            problems.push(`${rel}:${lineOf(src, m.index)}  <${m[1]}> — fold it into the view selector: <GridViewPicker {...chrome.pickerProps} />`);
        }
    }

    if (!TOPBAR_CHROME_USERS.has(rel)) {
        for (const m of src.matchAll(/(?<![\w.])useTopbarChrome\(/g)) {
            problems.push(`${rel}:${lineOf(src, m.index)}  useTopbarChrome — table controls live in the view selector, not the top bar`);
        }
    }

    if (!KPI_OWNERS.has(rel)) {
        for (const m of src.matchAll(/<KpiBand\b/g)) {
            problems.push(`${rel}:${lineOf(src, m.index)}  <KpiBand> — KPI strips belong to overview surfaces, not list pages`);
        }
    }

    if (rel === 'hooks/useTopbarActions.js') continue;
    for (const m of src.matchAll(/(?<![\w.])(useTopbarActions|useListTopbar)\(/g)) {
        const block = callBlock(src, m.index);
        const at = `${rel}:${lineOf(src, m.index)}`;
        if (!TOPBAR_FILTER_USERS.has(rel) && /<(FilterButton|GridFilterButton|GridToolsMenu)\b/.test(block)) {
            problems.push(`${at}  filter/tools button in the top bar — move it into the view selector's menu`);
        }
        if (m[1] !== 'useTopbarActions') continue;
        // Each fragment is one rendering of the bar (a page may switch between
        // two): within it, search is last and the create button precedes it.
        for (const part of block.split('<>').slice(1)) {
            const search = part.indexOf('<SearchField');
            if (search < 0) continue;
            const after = part.slice(search + 1);
            if (/<(PagePrimaryButton|Button|SearchField)\b/.test(after)) {
                problems.push(`${at}  top-bar order — search goes last: [secondary] [create] [search]; use useListTopbar`);
                break;
            }
        }
    }
}

if (problems.length) {
    console.error(`check-list-chrome: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nSee the header of scripts/check-list-chrome.mjs for the list-page shell.');
    process.exit(1);
}
console.log('check-list-chrome: ok');
