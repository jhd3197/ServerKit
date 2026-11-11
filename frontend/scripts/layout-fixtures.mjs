// Synthetic API responses for layout-screenshots-browser.mjs. example.test data only.
const T = '2026-01-14T09:30:00Z';
const user = { id: 1, username: 'operator', email: 'operator@example.test', role: 'admin', is_active: true, auth_provider: 'local', permissions: {}, created_at: T, totp_enabled: false };
const servers = [
    { id: 'srv-1', name: 'web-01.example.test', hostname: 'web-01.example.test', ip_address: '192.0.2.10', status: 'online', is_local: true, os_type: 'linux', os_version: 'Ubuntu 24.04', agent_version: '1.0.0', permission_level_effective: 'standard', created_at: T, last_seen: T },
    { id: 'srv-2', name: 'db-01.example.test', hostname: 'db-01.example.test', ip_address: '192.0.2.11', status: 'offline', os_type: 'linux', os_version: 'Debian 12', agent_version: '1.0.0', permission_level_effective: 'standard', created_at: T, last_seen: T },
];
const apps = [
    { id: 1, name: 'blog', domains: ['blog.example.test'], status: 'running', app_type: 'docker', stack: 'node', created_at: T, updated_at: T },
    { id: 2, name: 'shop', domains: ['shop.example.test'], status: 'stopped', app_type: 'php', stack: 'php', created_at: T, updated_at: T },
];
const notifications = [
    { delivery_id: 1, title: 'Backup completed', body: 'Nightly backup finished for blog.example.test', severity: 'info', category: 'backup', read: false, is_read: false, created_at: T },
    { delivery_id: 2, title: 'Certificate expiring', body: 'shop.example.test expires in 12 days', severity: 'warning', category: 'ssl', read: true, is_read: true, created_at: T },
];
const certificates = [
    { domain: 'blog.example.test', issuer: "Let's Encrypt", status: 'valid', days_remaining: 62, expires_at: '2026-03-18T00:00:00Z', auto_renew: true },
    { domain: 'shop.example.test', issuer: "Let's Encrypt", status: 'expiring', days_remaining: 12, expires_at: '2026-01-27T00:00:00Z', auto_renew: false },
];

// Longest-prefix-free rules, first match wins. Anything else answers `{}`.
const RULES = [
    [/^\/auth\/setup-status/, { needs_setup: false, registration_enabled: false }],
    [/^\/auth\/me/, { user }],
    [/^\/plugins\/contributions/, { contributions: [], routes: [], items: [] }],
    [/^\/servers\/groups/, []],
    [/^\/servers\/?$/, servers],
    [/^\/servers\/available/, { servers }],
    [/^\/(apps|services)/, { apps, services: apps, total: apps.length }],
    [/^\/notifications/, { notifications, items: notifications, unread_count: 1, total: 2 }],
    [/^\/ssl/, { certificates, items: certificates }],
    [/^\/queues?/, { groups: [], queues: [] }],
];

export function fixtureFor(path) {
    return RULES.find(([re]) => re.test(path))?.[1];
}
