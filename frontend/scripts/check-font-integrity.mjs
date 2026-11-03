#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = join(FRONTEND, 'public', 'fonts');
const FONT_STYLES = join(FRONTEND, 'src', 'styles', 'base', '_fonts.scss');
const FONTS = [
    ['ibm-plex-sans-400.woff2', 400],
    ['ibm-plex-sans-500.woff2', 500],
    ['ibm-plex-sans-600.woff2', 600],
    ['ibm-plex-sans-700.woff2', 700],
];

const styles = await readFile(FONT_STYLES, 'utf8');
const fontFaces = [...styles.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)]
    .map((match) => match[1]);

for (const [filename, weight] of FONTS) {
    const font = await readFile(join(FONT_DIR, filename));
    if (font.length === 0) throw new Error(`${filename} is empty`);
    if (font.subarray(0, 4).toString('ascii') !== 'wOF2') {
        throw new Error(`${filename} does not have a WOFF2 signature`);
    }
    if (!font.some((byte) => byte !== 0)) {
        throw new Error(`${filename} contains only zero bytes`);
    }

    const face = fontFaces.find((block) => block.includes(filename));
    if (!face || !face.includes(`font-weight: ${weight};`)) {
        throw new Error(`${filename} is not declared as CSS weight ${weight}`);
    }
}

console.log('✓ font integrity: IBM Plex Sans 400/500/600/700 are valid WOFF2 assets');
