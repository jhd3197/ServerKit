#!/usr/bin/env node
// Frontend browser-boundary ratchet.
//
// Shared helpers own browser APIs whose failure/auth/dialog semantics must stay
// consistent. New direct call sites fail lint. Clipboard has a finite legacy
// baseline so this can land without a risky all-at-once UI rewrite; the exact
// counts deliberately make every cleanup update (and shrink) the baseline.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'src');
const repoRoot = resolve(root, '..');

// Styles owned by a builtin extension must enter the bundle through that
// extension's module graph, not through core styles/main.scss. Keeping this
// declaration here makes ownership executable: both the source-of-truth and
// its checked-in pre-bundled copy must expose the same style entry, while core
// is forbidden from quietly taking the page partial back.
const EXTENSION_OWNED_STYLES = [
    {
        slug: 'serverkit-remote-access',
        importPath: './styles/remote-access.scss',
        forbiddenCoreImports: ['pages/_remote-access', 'pages/remote-access'],
    },
];

// Emptied 2026-08-18 (plan 76, F3): every call site now goes through
// copyToClipboard/useClipboard, whose execCommand fallback is what makes copy
// buttons work on an HTTP-served panel — navigator.clipboard is undefined in an
// insecure context, and SSL is optional by policy. This map must stay empty.
const LEGACY_CLIPBOARD = new Map();

// Polling belongs to usePolling / useServerQuery({refetchInterval}), which do
// two things a hand-rolled setInterval does not: they never start a request
// while the previous one is still in flight, and they stop entirely while the
// tab is hidden, catching up once on return. A bare setInterval that fetches is
// the documented poller-stampede shape - the page gets slower the longer it is
// left open. Finite legacy baseline with exact counts, so every cleanup shrinks
// it. A genuine non-fetching timer (a clock tick, a countdown) may stay, but it
// is still listed so nothing new slips in unnoticed.
// Hex literals outside the token files. Each one is a colour a runtime skin
// cannot reach: a theme is a JSON map of CSS custom properties (plan 60), so
// only values written as var(--token) change when someone switches skin. A
// literal here is a spot that stays dark-theme-blue on every theme.
//
// Per-file exact counts rather than a ban, because milestone G is explicit
// that legitimate brand and data-visualisation colours stay — they just have
// to be listed, so the number is honest and can only go down.
const LEGACY_COLOR_LITERALS = new Map(Object.entries({
    'styles/base/_reset.scss': 1,
    'styles/components/_ai-assistant.scss': 10,
    'styles/components/_buttons.scss': 2,
    'styles/components/_dashboard-widgets.scss': 6,
    'styles/components/_datagrid.scss': 6,
    'styles/components/_deploy.scss': 6,
    'styles/components/_design-system.scss': 2,
    'styles/components/_logs-drawer.scss': 1,
    'styles/components/_notification-center.scss': 1,
    'styles/components/_skeleton.scss': 1,
    'styles/components/_spinner.scss': 2,
    'styles/components/_staging-banner.scss': 1,
    'styles/components/_ui.scss': 2,
    'styles/components/_users.scss': 2,
    'styles/components/_widget-editor.scss': 1,
    'styles/layout/_main-content.scss': 1,
    'styles/layout/_sidebar.scss': 5,
    'styles/pages/_applications.scss': 4,
    'styles/pages/_auth.scss': 3,
    'styles/pages/_backups.scss': 1,
    'styles/pages/_bandwidth.scss': 1,
    'styles/pages/_cutover.scss': 1,
    'styles/pages/_databases.scss': 3,
    'styles/pages/_deploy-console.scss': 14,
    'styles/pages/_doctor.scss': 1,
    'styles/pages/_domains.scss': 1,
    'styles/pages/_file-manager.scss': 10,
    'styles/pages/_git.scss': 6,
    'styles/pages/_import-wizard.scss': 1,
    'styles/pages/_marketplace.scss': 2,
    'styles/pages/_notification-center.scss': 4,
    'styles/pages/_settings.scss': 14,
    'styles/pages/_setup-wizard.scss': 5,
    'styles/pages/_terminal.scss': 19,
}));

const LEGACY_POLLERS = new Map(Object.entries({
    'components/dashboard/widgets/renderers.jsx': 1,
    'components/deploy-console/SuccessBanner.jsx': 1,
    'components/server/OnboardingWizard.jsx': 1,
    'pages/Dashboard.jsx': 1,
    'pages/DeployConsole.jsx': 1,
    'pages/Monitors.jsx': 1,
    'plugins/serverkit-gui/components/ServerGui.jsx': 1,
}));

// The polling door itself, plus the query hook that wraps it.
const POLLING_DOOR = new Set([
    'utils/pollScheduler.js',
    'hooks/usePolling.js',
    'hooks/useServerQuery.js',
]);

// These are purpose-built experiences whose geometry/content is intentionally
// richer than the ordinary Modal contract. Any new exception needs review.
const LOW_LEVEL_DIALOG_EXCEPTIONS = new Set([
    'components/settings/connections/ConnectProviderModal.jsx',
    'components/settings/ThemeBrowseModal.jsx',
    'components/settings/ThemeStudioModal.jsx',
]);

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
    });
}

const files = walk(src).filter((path) => ['.js', '.jsx'].includes(extname(path)));
const failures = [];
const seenClipboard = new Set();
const seenPollers = new Set();

function rel(path) {
    return relative(src, path).replaceAll('\\', '/');
}

function count(source, pattern) {
    return [...source.matchAll(pattern)].length;
}

for (const path of files) {
    const file = rel(path);
    const source = readFileSync(path, 'utf8');

    if (file !== 'utils/clipboard.js') {
        const actual = count(source, /navigator\s*\.\s*clipboard/g);
        const expected = LEGACY_CLIPBOARD.get(file) || 0;
        if (actual !== expected) {
            failures.push(`${file}: direct navigator.clipboard count is ${actual}; legacy baseline is ${expected}. Use useClipboard/copyToClipboard and shrink the baseline.`);
        }
        if (expected) seenClipboard.add(file);
    }

    if (!POLLING_DOOR.has(file)) {
        const actual = count(source, /setInterval\s*\(/g);
        const expected = LEGACY_POLLERS.get(file) || 0;
        if (actual !== expected) {
            failures.push(`${file}: raw setInterval count is ${actual}; legacy baseline is ${expected}. Use usePolling() (or useServerQuery({refetchInterval})) and shrink the baseline.`);
        }
        if (expected) seenPollers.add(file);
    }

    // Saving a file to disk belongs to utils/downloadBlob. The six-line anchor
    // ritual it replaces had been pasted into 14 components and had drifted:
    // only 3 appended the anchor to the document (Firefox does not reliably
    // click a detached one) and most revoked the object URL on the line after
    // click(), which races the download it just started. An `.download =`
    // assignment outside the helper is that ritual coming back.
    if (file !== 'utils/downloadBlob.js' && /\.\s*download\s*=/.test(source)) {
        failures.push(`${file}: use downloadBlob() instead of building a download anchor by hand.`);
    }

    if (/(?:(?:window|globalThis)\s*\.\s*)?confirm\s*\(\s*['"`]/m.test(source)) {
        failures.push(`${file}: use useConfirm() instead of the browser confirm dialog.`);
    }

    const isUiCode = /^(?:components|contexts|data|hooks|pages)\//.test(file);
    if (isUiCode) {
        const rawFetch = source.split(/\r?\n/).some((line) => (
            /(?:^|[^.\w])(?:(?:window|globalThis)\s*\.\s*)?fetch\s*\(/.test(line)
            && !/\b(?:async\s+)?fetch\s*\([^)]*\)\s*\{/.test(line)
        ));
        if (rawFetch) {
            failures.push(`${file}: route authenticated requests through services/api instead of calling fetch directly.`);
        }
    }

    const isFeatureCode = /^(?:components|data|hooks|pages)\//.test(file);
    if (isFeatureCode && /localStorage\s*\.\s*getItem\s*\(\s*['"](?:accessToken|access_token|refresh_token)['"]/.test(source)) {
        failures.push(`${file}: do not read auth tokens in feature code; the centralized API client owns token access.`);
    }

    if (
        file !== 'services/workspaceStore.js'
        && /localStorage\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*['"](?:active_workspace_id|active_workspace|workspace_accent)['"]/.test(source)
    ) {
        failures.push(`${file}: use WorkspaceContext/workspaceStore instead of reading or writing workspace persistence directly.`);
    }

    if (
        /(?:^|\/)ui\/dialog['"]/.test(source)
        && file !== 'components/Modal.jsx'
        && file !== 'components/ui/command.jsx'
        && !LOW_LEVEL_DIALOG_EXCEPTIONS.has(file)
    ) {
        failures.push(`${file}: use components/Modal for ordinary dialogs.`);
    }
}

for (const file of LEGACY_CLIPBOARD.keys()) {
    if (!seenClipboard.has(file)) {
        failures.push(`${file}: legacy clipboard entry is stale; remove it from the boundary baseline.`);
    }
}

for (const file of LEGACY_POLLERS.keys()) {
    if (!seenPollers.has(file)) {
        failures.push(`${file}: legacy poller entry is stale; remove it from the boundary baseline.`);
    }
}

// Adoption ceilings (plan 76, milestones E1/F2/C4-interim). These populations
// are in the hundreds, so per-file baselines would be unmaintainable; a total
// that may only go down is the honest ratchet. Each entry names the door the
// sites should migrate to when their surface is next touched.
const ADOPTION_CEILINGS = [
    {
        name: 'raw api.* calls in pages/ (E1: useServerQuery/useServerMutation)',
        ceiling: 398,
        include: (file) => file.startsWith('pages/'),
        pattern: /\bapi\s*\.\s*\w+\s*\(/g,
    },
    {
        name: 'per-page toast.error extractions in pages/ (E1: query-layer error presentation)',
        ceiling: 206,
        include: (file) => file.startsWith('pages/'),
        // toastError(toast, …) (utils/errorMessage) is the same per-page
        // presentation with the server reason attached, so it counts too.
        pattern: /toast\s*\.\s*error\s*\(|\btoastError\s*\(/g,
    },
    {
        name: 'hand-rolled form-group blocks (F2: FormField/useForm)',
        ceiling: 321,
        include: (file) => file.startsWith('pages/') || file.startsWith('components/'),
        pattern: /form-group/g,
    },
    {
        name: 'unencoded ?k=${v} query interpolations in services/api (C4: buildQuery/encoding template)',
        ceiling: 0,
        include: (file) => file.startsWith('services/api/'),
        pattern: /[?&][A-Za-z_]+=\$\{(?!encodeURIComponent)/g,
    },
];

const adoptionActuals = new Map();
for (const rule of ADOPTION_CEILINGS) {
    let totalCount = 0;
    for (const path of files) {
        const file = rel(path);
        if (!rule.include(file)) continue;
        totalCount += count(readFileSync(path, 'utf8'), rule.pattern);
    }
    adoptionActuals.set(rule.name, totalCount);
    if (totalCount > rule.ceiling) {
        failures.push(`${rule.name}: ${totalCount} sites, ceiling ${rule.ceiling}. Migrate through the named door instead of adding another bypass.`);
    } else if (rule.ceiling - totalCount > 25) {
        failures.push(`${rule.name}: ceiling ${rule.ceiling} is ${rule.ceiling - totalCount} above the actual ${totalCount}; lower it in check-frontend-boundaries.mjs so the migration cannot silently regrow.`);
    }
}

// A @keyframes name is global and last-definition-wins, across every partial
// main.scss pulls in. Two partials defining the same name is therefore not
// duplication that merely wastes bytes: one of them is silently dead, and which
// one depends on import order. `pulse-dot` was defined twice with genuinely
// different animations, so the uptime dot had been running the services one for
// as long as pages/_services was imported after components/_uptime.
const styleFiles = walk(resolve(src, 'styles')).filter((path) => extname(path) === '.scss');
const keyframeOwners = new Map();
for (const path of styleFiles) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
        const name = match[1];
        if (!keyframeOwners.has(name)) keyframeOwners.set(name, []);
        keyframeOwners.get(name).push(rel(path));
    }
}
const TOKEN_FILES = new Set(['_variables.scss', '_theme-variables.scss', '_mixins.scss']);
for (const path of styleFiles) {
    const file = rel(path);
    if (TOKEN_FILES.has(file.split('/').pop())) continue;
    const actual = count(readFileSync(path, 'utf8'), /#[0-9a-fA-F]{3,8}\b/g);
    const expected = LEGACY_COLOR_LITERALS.get(file) || 0;
    if (actual !== expected) {
        failures.push(`${file}: ${actual} hex colour literal(s), legacy baseline is ${expected}. Use a var(--token) so runtime skins can recolour it, and shrink the baseline.`);
    }
}

for (const [name, owners] of keyframeOwners) {
    if (owners.length > 1) {
        failures.push(`@keyframes ${name} is defined in ${owners.length} places (${owners.join(', ')}); the last one imported silently wins for all of them. Give each a scoped name or move the shared one to base/_utilities.scss.`);
    }
}

const mainStylesPath = resolve(src, 'styles', 'main.scss');
const mainStyles = readFileSync(mainStylesPath, 'utf8');
for (const ownership of EXTENSION_OWNED_STYLES) {
    for (const importPath of ownership.forbiddenCoreImports) {
        const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`@(?:import|use)\\s+['\"]${escaped}['\"]`).test(mainStyles)) {
            failures.push(
                `styles/main.scss: ${ownership.slug} owns ${importPath}; import its styles from the extension entry instead.`,
            );
        }
    }

    const entryPaths = [
        resolve(repoRoot, 'builtin-extensions', ownership.slug, 'frontend', 'index.jsx'),
        resolve(src, 'plugins', ownership.slug, 'index.jsx'),
    ];
    for (const entryPath of entryPaths) {
        const displayPath = relative(repoRoot, entryPath).replaceAll('\\', '/');
        if (!existsSync(entryPath)) {
            failures.push(`${displayPath}: missing extension frontend entry.`);
            continue;
        }
        const entry = readFileSync(entryPath, 'utf8');
        const escaped = ownership.importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`import\\s+['\"]${escaped}['\"]`).test(entry)) {
            failures.push(`${displayPath}: must import ${ownership.importPath}.`);
        }

        const stylePath = resolve(dirname(entryPath), ownership.importPath);
        if (!existsSync(stylePath)) {
            failures.push(`${relative(repoRoot, stylePath).replaceAll('\\', '/')}: missing extension-owned stylesheet.`);
        }
    }
}

// Machine-readable ratchet report for the plan-76 H-closure inventory
// generator (scripts/generate-migration-inventory.py at the repo root).
if (process.argv.includes('--inventory')) {
    const inventory = [];
    for (const rule of ADOPTION_CEILINGS) {
        inventory.push({ name: rule.name, actual: adoptionActuals.get(rule.name), ceiling: rule.ceiling });
    }
    const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    inventory.push({ name: 'raw setInterval pollers (E2: usePolling/refetchInterval)',
        actual: sum(LEGACY_POLLERS), ceiling: sum(LEGACY_POLLERS) });
    inventory.push({ name: 'direct navigator.clipboard call sites (F3: copyToClipboard)',
        actual: sum(LEGACY_CLIPBOARD), ceiling: 0 });
    inventory.push({ name: 'hex colour literals outside token files (G: var(--token))',
        actual: sum(LEGACY_COLOR_LITERALS), ceiling: sum(LEGACY_COLOR_LITERALS) });
    console.log(JSON.stringify({ ok: failures.length === 0, failures, inventory }, null, 2));
    process.exit(failures.length ? 1 : 0);
}

if (failures.length) {
    console.error('\nFrontend boundary check failed:\n');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    console.error('');
    process.exit(1);
}

console.log(`✓ frontend boundaries: browser/API/dialog boundaries and ${EXTENSION_OWNED_STYLES.length} extension style ownership rule(s) hold (${LEGACY_CLIPBOARD.size} clipboard / ${LEGACY_POLLERS.size} poller files remain ratcheted, ${keyframeOwners.size} unique @keyframes, ${[...LEGACY_COLOR_LITERALS.values()].reduce((a, b) => a + b, 0)} colour literals).`);
