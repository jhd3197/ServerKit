#!/usr/bin/env node
// One geometry system: spacing on the $space-* scale, four theme-driven
// radii, three control heights, two shadows and a focus ring. Tokens live in
// src/styles/_variables.scss. Legacy token names are rejected outright; raw
// values are ratcheted (the ceilings below only go down) while the
// remaining files move over.
//
// Allowed raw: 0, 1px, auto, %, em, negatives, calc(), and lines marked
// `// geometry: <reason>` (an icon drawn with box-shadow, a fixed chart box).

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const STYLES = new URL('../src/styles', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const CEILING_FILE = new URL('./GEOMETRY_CEILING.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['_variables.scss', '_fonts.scss', '_theme-variables.scss']);

const RAW_PX = /(?<![\w$.#-])([2-9]|\d{2,})(\.\d+)?px\b/;
const CHECKS = {
    spacing: /^\s*(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?\s*:/,
    radius: /^\s*border(-[a-z]+)*-radius\s*:/,
    shadow: /^\s*box-shadow\s*:/,
    height: /^\s*(height|min-height)\s*:/,
};
const LEGACY = /\$(radius-(sm|md|lg|xl|2xl)|shadow-(sm|md|lg|accent))\b/;

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) yield* walk(p);
        else if (name.endsWith('.scss') && !SKIP.has(name)) yield p;
    }
}

const counts = { spacing: 0, radius: 0, shadow: 0, height: 0 };
const problems = [];
for (const file of walk(STYLES)) {
    const rel = relative(STYLES, file).split(sep).join('/');
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (line.includes('// geometry:')) return;
        const code = line.replace(/\/\/.*$/, '');
        if (LEGACY.test(code)) problems.push(`  - ${rel}:${i + 1}: legacy geometry token — use $radius-badge|control|card|overlay / $shadow-raised|overlay`);
        const value = code.split(':').slice(1).join(':');
        if (!value || value.includes('calc(')) return;
        for (const [kind, re] of Object.entries(CHECKS)) {
            if (!re.test(code)) continue;
            if (kind === 'shadow') {
                if (!/^\s*(none|\$[a-z-]+|var\(--[a-z-]+\))\s*(!important)?\s*;?\s*$/.test(value)) counts.shadow += 1;
            } else if (kind === 'height') {
                const m = value.match(/(\d+)px/);
                if (m && +m[1] >= 20 && +m[1] <= 48) counts.height += 1; // control-range only
            } else if (value.split(/\s+/).some((v) => !v.startsWith('-') && RAW_PX.test(v))) {
                counts[kind] += 1;
            }
        }
    });
}

let ceiling = {};
try { ceiling = JSON.parse(readFileSync(CEILING_FILE, 'utf8')); } catch { /* first run */ }
if (process.argv.includes('--update')) {
    writeFileSync(CEILING_FILE, JSON.stringify(counts, null, 4) + '\n');
    console.log('geometry ceilings updated:', counts);
    process.exit(0);
}
for (const [kind, n] of Object.entries(counts)) {
    if (ceiling[kind] === undefined) continue;
    if (n > ceiling[kind]) problems.push(`  - raw ${kind} values: ${n}, ceiling ${ceiling[kind]} — use the tokens in _variables.scss`);
    else if (n < ceiling[kind]) console.log(`note: raw ${kind} dropped to ${n}; run with --update to lower the ceiling.`);
}

if (problems.length) {
    console.error('Geometry check failed:\n');
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log(`✓ geometry: no legacy tokens; raw values within ceilings (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}).`);
