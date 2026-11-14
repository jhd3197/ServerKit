/**
 * Layout screenshot regressions: main pages at phone (390x844), tablet
 * (768x1024) and desktop (1440x900), rendered from synthetic API fixtures
 * (no backend, no network), compared with committed baselines.
 *
 * Per snapshot it asserts: no page-level horizontal scroll, no visible control
 * clipped by the viewport edge (outside intentional overflow-x scrollers), the
 * page header is present and there is no uncaught page error. Then it diffs the
 * viewport screenshot against tests/layout-baselines/<page>-<width>[-light].png
 * (per-channel tolerance, fails above LAYOUT_DIFF_RATIO of pixels differing).
 * A pixel only counts as different if it mismatches the baseline at the same
 * position AND no pixel within 1px in the other image matches it, checked in
 * both directions (like pixelmatch's AA detection): text anti-aliasing/hinting
 * differences between machines pass, moved or resized boxes still fail.
 * Chromium is launched with fixed font-rendering flags to keep text stable.
 *
 *   npm run test:layout                       # check
 *   LAYOUT_UPDATE=1 npm run test:layout       # rewrite baselines
 *   LAYOUT_ONLY=dashboard,ssl npm run test:layout
 *   LAYOUT_DIFF_RATIO=0.01 npm run test:layout
 *
 * A missing baseline is created locally and fails under CI. On a diff, the
 * actual and diff (magenta) images land in test-results/layout/. Diffs appear
 * when layout/CSS changes (update the baselines in the same commit if intended)
 * or when fonts/rendering differ from the machine that made the baselines;
 * regenerate with the Playwright chromium that CI installs.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fixtureFor } from './layout-fixtures.mjs';

const DIFF_RATIO = Number(process.env.LAYOUT_DIFF_RATIO ?? 0.002);
const TOLERANCE = 24;
const LAUNCH_ARGS = ['--font-render-hinting=none', '--disable-font-subpixel-positioning', '--disable-lcd-text', '--force-color-profile=srgb'];
const OUT = 'test-results/layout';
const BASE_DIR = 'tests/layout-baselines';
const NOW = '2026-01-15T12:00:00Z';
const WIDTHS = { 390: 844, 768: 1024, 1440: 900 };
const PAGES = [
    { key: 'dashboard', path: '/' },
    { key: 'servers', path: '/servers' },
    { key: 'services', path: '/services' },
    { key: 'monitoring', path: '/monitoring' },
    { key: 'notifications', path: '/notifications' },
    { key: 'settings', path: '/settings/general' },
    { key: 'ssl', path: '/ssl' },
    { key: 'queue', path: '/queue' },
];
const only = (process.env.LAYOUT_ONLY || '').split(',').filter(Boolean);
const jobs = [];
for (const p of PAGES) {
    if (only.length && !only.includes(p.key)) continue;
    for (const w of Object.keys(WIDTHS)) jobs.push({ ...p, width: Number(w), theme: 'dark' });
}
if (!only.length || only.includes('dashboard')) jobs.push({ ...PAGES[0], width: 1440, theme: 'light' });

const FREEZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

// Runs inside the page: loads both PNGs into canvases and counts differing pixels.
const diffInPage = async ({ a, b, tol }) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: false };
    const read = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
    const da = read(ia); const db = read(ib);
    const out = new ImageData(ia.width, ia.height);
    const { width: W, height: H } = ia;
    const near = (x, y, i, o) => Math.abs(x[i] - y[o]) <= tol && Math.abs(x[i + 1] - y[o + 1]) <= tol && Math.abs(x[i + 2] - y[o + 2]) <= tol;
    // true if any pixel of `d` within 1px of (px,py) matches pixel i of `s` (AA shifts glyph edges by <=1px)
    const matchesAround = (s, d, i, px, py) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = px + dx; const y = py + dy;
            if (x >= 0 && y >= 0 && x < W && y < H && near(s, d, i, (y * W + x) * 4)) return true;
        }
        return false;
    };
    let count = 0;
    for (let i = 0; i < da.data.length; i += 4) {
        const px = (i / 4) % W; const py = Math.floor(i / 4 / W);
        const bad = !near(da.data, db.data, i, i) && !matchesAround(da.data, db.data, i, px, py) && !matchesAround(db.data, da.data, i, px, py);
        if (bad) { count++; out.data.set([255, 0, 255, 255], i); } else out.data.set([db.data[i], db.data[i + 1], db.data[i + 2], 80], i);
    }
    const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height; c.getContext('2d').putImageData(out, 0, 0);
    return { size: true, count, total: ia.width * ia.height, diff: c.toDataURL('image/png') };
};

// Runs inside the page: layout invariants; returns a list of problems.
const invariants = () => {
    const problems = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) problems.push(`page scrolls horizontally (${root.scrollWidth} > ${root.clientWidth})`);
    if (!document.querySelector('header, [role=banner], .page-header, .topbar, .header')) problems.push('page header/topbar missing');
    const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
    for (const el of document.querySelectorAll('button, a, input, select, [role=button]')) {
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || el.closest('[hidden],[aria-hidden=true],[inert]')) continue;
        if ((r.left < -1 || r.right > root.clientWidth + 1) && !inScroller(el)) {
            problems.push(`control clipped horizontally: <${el.tagName.toLowerCase()}> "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" [${Math.round(r.left)}..${Math.round(r.right)}]`);
            if (problems.length > 8) break;
        }
    }
    return problems;
};

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
let browser;
const failures = [];
const started = Date.now();
try {
    await server.listen();
    const base = server.resolvedUrls.local[0];
    const origin = new URL(base).origin;
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    await mkdir(OUT, { recursive: true });
    await mkdir(BASE_DIR, { recursive: true });
    const diffPage = await browser.newPage();
    for (const job of jobs) {
        const name = `${job.key}-${job.width}${job.theme === 'light' ? '-light' : ''}`;
        const context = await browser.newContext({
            viewport: { width: job.width, height: WIDTHS[job.width] }, locale: 'en-US', timezoneId: 'UTC',
            reducedMotion: 'reduce', colorScheme: job.theme, deviceScaleFactor: 1,
        });
        await context.addInitScript((theme) => {
            localStorage.setItem('access_token', 'synthetic-browser-fixture');
            localStorage.setItem('theme', theme);
            document.addEventListener('DOMContentLoaded', () => document.documentElement.setAttribute('data-theme', theme), { once: true });
        }, job.theme);
        const page = await context.newPage();
        await page.clock.install({ time: new Date(NOW) });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.routeWebSocket(/socket\.io/, (ws) => ws.close());
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            // .env may point the API at a local backend port; serve that from fixtures too
            const local = ['localhost', '127.0.0.1'].includes(url.hostname);
            if (!local || (url.origin !== origin && !url.pathname.startsWith('/api/v1/'))) { if (process.env.LAYOUT_DEBUG) console.log('  abort', url.href); return route.abort(); }
            if (url.pathname.startsWith('/socket.io/')) return route.abort(); // no live socket: keeps data static
            if (!url.pathname.startsWith('/api/v1/')) return route.continue();
            const body = fixtureFor(url.pathname.slice('/api/v1'.length), route.request().method());
            if (process.env.LAYOUT_DEBUG) console.log(`  api ${name} ${url.pathname}${body === undefined ? ' (unhandled)' : ''}`);
            return route.fulfill({ json: body ?? {} });
        });
        await page.goto(`${base.replace(/\/$/, '')}${job.path}`, { waitUntil: 'networkidle' });
        await page.addStyleTag({ content: FREEZE_CSS });
        await page.evaluate(() => document.fonts.ready);
        await page.clock.runFor(1000);
        await page.waitForLoadState('networkidle');
        await page.waitForFunction(() => !document.querySelector('[class*=skeleton], [aria-busy=true], [role=progressbar], .spinner, .loading'), null, { timeout: 10000 }).catch(async () => { if (process.env.LAYOUT_DEBUG) console.log('  busy:', await page.evaluate(() => [...document.querySelectorAll('[class*=skeleton], [aria-busy=true], [role=progressbar], .spinner, .loading')].map((e) => e.className).join(' | '))); });
        const problems = await page.evaluate(invariants);
        errors.forEach((e) => problems.push(`uncaught page error: ${e}`));
        const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
        await context.close();

        const file = `${BASE_DIR}/${name}.png`;
        if (process.env.LAYOUT_UPDATE || !existsSync(file)) {
            if (!process.env.LAYOUT_UPDATE && process.env.CI) problems.push(`baseline ${file} is missing (run LAYOUT_UPDATE=1 npm run test:layout and commit it)`);
            else await writeFile(file, shot);
        } else {
            const res = await diffPage.evaluate(diffInPage, { a: `data:image/png;base64,${shot.toString('base64')}`, b: `data:image/png;base64,${(await readFile(file)).toString('base64')}`, tol: TOLERANCE });
            if (!res.size || res.count / res.total > DIFF_RATIO) {
                await writeFile(`${OUT}/${name}.actual.png`, shot);
                if (res.size) await writeFile(`${OUT}/${name}.diff.png`, Buffer.from(res.diff.split(',')[1], 'base64'));
                problems.push(res.size ? `pixel diff ${(100 * res.count / res.total).toFixed(2)}% > ${(100 * DIFF_RATIO).toFixed(2)}% (see ${OUT}/${name}.diff.png)` : 'screenshot size differs from baseline');
            }
        }
        for (const p of problems) failures.push(`${job.key}@${job.width}${job.theme === 'light' ? ' (light)' : ''}: ${p}`);
        console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}`);
    }
} finally {
    await browser?.close();
    await server.close();
}
console.log(`${jobs.length} snapshots in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failures.length) {
    console.error(`\nLayout regressions:\n - ${failures.join('\n - ')}`);
    process.exitCode = 1;
}
