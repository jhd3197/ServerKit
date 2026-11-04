#!/usr/bin/env node
// ============================================================
// fetch-fonts.mjs — vendor IBM Plex woff2 into frontend/public/fonts/
// ============================================================
// ServerKit self-hosts its fonts for privacy (no Google Fonts CDN — that would
// leak every visitor's IP + usage to a third party). This script downloads the
// OFL-licensed IBM Plex faces once into the repo's public/fonts/ folder so
// they're served from our own origin. The Sans 400/500/600/700 faces come directly
// from the official IBM/plex repository; existing valid faces retain their
// original @fontsource jsDelivr source.
//
//   node frontend/scripts/fetch-fonts.mjs
//
// Re-run only when changing weights. Commit the resulting .woff2 files.
// Requires Node 18+ (global fetch). No network at build/runtime — only here.
// ============================================================

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'fonts');
const FONTSOURCE_BASE = 'https://cdn.jsdelivr.net/npm';
const IBM_PLEX_REVISION = 'bf260093582f04622aacc1e9f9ca604d7ccd0c42';
const IBM_PLEX_BASE = `https://raw.githubusercontent.com/IBM/plex/${IBM_PLEX_REVISION}`;

// local filename -> source URL
const FONTS = {
    'ibm-plex-sans-400.woff2': `${IBM_PLEX_BASE}/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-Regular.woff2`,
    'ibm-plex-sans-500.woff2': `${IBM_PLEX_BASE}/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-Medium.woff2`,
    'ibm-plex-sans-600.woff2': `${IBM_PLEX_BASE}/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-SemiBold.woff2`,
    'ibm-plex-sans-700.woff2': `${IBM_PLEX_BASE}/packages/plex-sans/fonts/complete/woff2/IBMPlexSans-Bold.woff2`,
    'ibm-plex-mono-400.woff2': `${FONTSOURCE_BASE}/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2`,
    'ibm-plex-mono-500.woff2': `${FONTSOURCE_BASE}/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2`,
    'ibm-plex-mono-600.woff2': `${FONTSOURCE_BASE}/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2`,
};

async function main() {
    await mkdir(OUT, { recursive: true });
    let ok = 0;
    for (const [name, url] of Object.entries(FONTS)) {
        const dest = join(OUT, name);
        try {
            const existing = await readFile(dest);
            if (existing.subarray(0, 4).toString('ascii') === 'wOF2') {
                console.log(`✓ ${name} (already present)`);
                ok++;
                continue;
            }
        } catch { /* not present — download */ }

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            await writeFile(dest, buf);
            console.log(`↓ ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
            ok++;
        } catch (err) {
            console.error(`✗ ${name} — ${err.message}\n   ${url}`);
        }
    }
    console.log(`\n${ok}/${Object.keys(FONTS).length} fonts in ${OUT}`);
    if (ok < Object.keys(FONTS).length) process.exitCode = 1;
}

main();
