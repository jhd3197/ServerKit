#!/usr/bin/env node
// One type scale. Every font-size in core SCSS is a $text-* token (seven
// sizes, 12px floor) and every font-weight is one of three tokens, so text
// looks the same on every page. Defined in src/styles/_variables.scss.
//
// Allowed besides tokens: inherit, 0, em-relative sizes (inline code that
// tracks its parent), and lines marked `// icon glyph` (a font-size that
// sizes an icon, not text). Extension copies under src/plugins/ are out of
// scope; they still compile against the legacy $font-size-* aliases.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const STYLES = new URL('../src/styles', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SIZE_OK = /^(\$text-(xs|sm|base|md|lg|xl|2xl)|inherit|0|[\d.]+em)(\s*!important)?$/;
const WEIGHT_OK = /^(\$font-weight-(normal|medium|semibold)|inherit)(\s*!important)?$/;

// Public status page hero scales with the viewport on purpose.
const CLAMP_ALLOWED = new Set(['pages/_status-pages.scss']);

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) yield* walk(p);
        // _fonts.scss declares the @font-face files by their real weights.
        else if (name.endsWith('.scss') && name !== '_variables.scss' && name !== '_fonts.scss') yield p;
    }
}

const problems = [];
for (const file of walk(STYLES)) {
    const rel = relative(STYLES, file).split(sep).join('/');
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        const size = code.match(/font-size:\s*([^;]+);/);
        if (size && !SIZE_OK.test(size[1].trim()) && !line.includes('// icon glyph')
            && !(CLAMP_ALLOWED.has(rel) && size[1].includes('clamp('))) {
            problems.push(`  - ${rel}:${i + 1}: font-size: ${size[1].trim()} — use a $text-* token`);
        }
        const weight = code.match(/font-weight:\s*([^;]+);/);
        if (weight && !WEIGHT_OK.test(weight[1].trim())) {
            problems.push(`  - ${rel}:${i + 1}: font-weight: ${weight[1].trim()} — use $font-weight-normal|medium|semibold`);
        }
        if (/\$font-size-|\$font-weight-bold/.test(code)) {
            problems.push(`  - ${rel}:${i + 1}: legacy typography variable — use $text-* / $font-weight-*`);
        }
    });
}

if (problems.length) {
    console.error('Type-scale check failed:\n');
    console.error(problems.join('\n'));
    process.exit(1);
}
console.log('✓ type scale: every font-size and font-weight in core SCSS is a token.');
