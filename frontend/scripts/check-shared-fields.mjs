#!/usr/bin/env node
// One field per job. Fails when core code hand-builds something a shared
// component already does:
//
//   pick a server ............ components/ServerPicker.jsx
//   enter a domain ........... components/DomainField.jsx (+ services/attachDomain.js)
//   enter a host port ........ components/PortField.jsx
//   choose one of N .......... components/ui/select.jsx (Radix) or ds/SegControl
//
// Each rule names the only files allowed to touch the underlying API or
// element. A new exception needs a reason in this file, not a copy of the
// component. Copy-to-clipboard is ratcheted by check-frontend-boundaries.
// Extension copies under src/plugins/ are out of scope (their source repos
// adopt the SDK exports instead).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const RULES = [
    {
        name: 'native <select>',
        door: 'Select from @/components/ui/select (size="sm" for compact) or SegControl',
        pattern: /<select\b/,
        allowed: new Set([
            // Fill in only with a reason.
        ]),
        jsxOnly: true,
    },
    {
        // Reading the server list as data is fine (status bar, widgets); a
        // resource picker over servers is a second ServerPicker.
        name: 'server picker',
        door: 'ServerPicker',
        pattern: /types=\{\[\s*['"]server['"]\s*\]\}|TargetPicker/,
        allowed: new Set(['components/ServerPicker.jsx']),
    },
    {
        name: 'base-domain / subdomain API',
        door: 'DomainField + attachDomain',
        pattern: /\b(getSiteBaseDomains|giveSubdomain|suggestSubdomain)\s*\(/,
        allowed: new Set([
            'components/DomainField.jsx',
            'services/attachDomain.js',
            'services/api/files.js',
            // Base-domain registry management, not a domain input.
            'components/settings/SiteSettingsTab.jsx',
            // Deploy drawer's read-only "will publish at" preview.
            'pages/Templates.jsx',
        ]),
    },
    {
        name: 'host-port check API',
        door: 'PortField',
        pattern: /\b(checkPort|suggestPort)\s*\(/,
        allowed: new Set(['components/PortField.jsx', 'services/api/apps.js']),
    },
];

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
            if (name === 'node_modules' || name === '__tests__') continue;
            yield* walk(p);
        } else if (/\.(jsx?|mjs)$/.test(name)) {
            yield p;
        }
    }
}

// Strip comments so prose like "replaces native <select>" does not count.
function code(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const problems = [];
for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (rel.startsWith('plugins/')) continue;
    const body = code(readFileSync(file, 'utf8'));
    for (const rule of RULES) {
        if (rule.jsxOnly && !rel.endsWith('.jsx')) continue;
        if (rule.allowed.has(rel)) continue;
        if (rule.pattern.test(body)) problems.push(`  - ${rel}: ${rule.name} — use ${rule.door}`);
    }
}

if (problems.length) {
    console.error('Shared-field check failed (one field per job):\n');
    console.error(problems.join('\n'));
    console.error('\nUse the shared component, or add the file to that rule\'s allowlist with a reason.');
    process.exit(1);
}
console.log(`✓ shared fields: ${RULES.length} doors hold (select, server picker, domain, port).`);
