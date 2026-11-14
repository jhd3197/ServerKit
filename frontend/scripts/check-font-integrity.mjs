#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
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

const GLYF = 10;
const LOCA = 11;
const KNOWN_TAGS = { 1: 'head', 4: 'maxp', [GLYF]: 'glyf' };
const HEAD_MAGIC = 0x5f0f3cf5;

// Parse the WOFF2 header + table directory and brotli-decode the table data,
// so a truncated or bit-rotted file fails here instead of silently in the browser.
function validateWoff2(font, filename) {
    const fail = (why) => { throw new Error(`${filename}: ${why}`); };
    if (font.length < 48) fail('shorter than the WOFF2 header');
    if (font.readUInt32BE(8) !== font.length) fail('header length does not match file size');
    const numTables = font.readUInt16BE(12);
    const compressedSize = font.readUInt32BE(20);
    if (numTables === 0) fail('has no tables');

    let pos = 48;
    const base128 = () => {
        let value = 0;
        for (let i = 0; i < 5; i += 1) {
            if (pos >= font.length) fail('table directory is truncated');
            const byte = font[pos++];
            value = value * 128 + (byte & 0x7f);
            if (!(byte & 0x80)) return value;
        }
        return fail('invalid UIntBase128 in table directory');
    };
    let expected = 0;
    const tables = {};
    for (let i = 0; i < numTables; i += 1) {
        const flags = font[pos++];
        const index = flags & 0x3f;
        const version = flags >> 6;
        if (index === 63) pos += 4;
        const origLength = base128();
        const transformed = index === GLYF || index === LOCA ? version !== 3 : version !== 0;
        const length = transformed ? base128() : origLength;
        if (KNOWN_TAGS[index]) tables[KNOWN_TAGS[index]] = { offset: expected, length };
        expected += length;
    }
    if (pos + compressedSize > font.length) fail('compressed table data runs past end of file');

    let data;
    try {
        data = brotliDecompressSync(font.subarray(pos, pos + compressedSize));
    } catch (error) {
        fail(`table data does not brotli-decode (${error.message})`);
    }
    if (data.length !== expected) {
        fail(`decoded table data is ${data.length} bytes, directory declares ${expected}`);
    }

    // brotli can succeed on zeroed-out tables, which browsers' font sanitizer then rejects.
    const { head, maxp, glyf } = tables;
    if (!head || !maxp || !glyf) fail('missing head/maxp/glyf table');
    if (data.readUInt32BE(head.offset + 12) !== HEAD_MAGIC) fail('head table magic number is wrong');
    const numGlyphs = data.readUInt16BE(maxp.offset + 4);
    if (numGlyphs === 0) fail('maxp declares zero glyphs');
    if (data.readUInt16BE(glyf.offset + 4) !== numGlyphs) fail('glyf glyph count does not match maxp');
}

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
    validateWoff2(font, filename);

    const face = fontFaces.find((block) => block.includes(filename));
    if (!face || !face.includes(`font-weight: ${weight};`)) {
        throw new Error(`${filename} is not declared as CSS weight ${weight}`);
    }
}

console.log('✓ font integrity: IBM Plex Sans 400/500/600/700 decode as valid WOFF2 assets');
