import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInstallCommands, CAPABILITIES, levelAllows, normalizeLevel, serverHealth } from '../agentPermissionLevel.js';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

test('install commands carry the level', () => {
    const cmds = buildInstallCommands({ origin: 'https://p.example', token: 'T', level: 'protect' });
    assert.match(cmds.linux, /--level protect$/);
    assert.match(cmds.windows, /-Level protect$/);
});

test('unknown level falls back to monitor', () => {
    assert.equal(normalizeLevel('root'), null);
    const cmds = buildInstallCommands({ origin: 'o', token: 'T', level: 'root' });
    assert.match(cmds.linux, /--level monitor$/);
});

test('health combines status, report age and checks', () => {
    const base = { status: 'online', last_report_at: ago(30), report_interval_seconds: 60 };
    assert.equal(serverHealth(base, NOW).code, 'healthy');
    assert.equal(serverHealth({ ...base, service_checks: [{ name: 'mysql', status: 'down' }] }, NOW).code, 'failing');
    assert.equal(serverHealth({ ...base, service_checks: [{ name: 'php', status: 'degraded' }] }, NOW).kind, 'amber');
    assert.equal(serverHealth({ ...base, last_report_at: ago(600) }, NOW).code, 'stale');
    assert.equal(serverHealth({ ...base, status: 'offline' }, NOW).kind, 'red');
    assert.equal(serverHealth({ status: 'pending' }, NOW).code, 'pending');
});

test('capability matrix per level', () => {
    const blocked = (level) => CAPABILITIES.filter((c) => !levelAllows(level, c));
    assert.deepEqual(blocked('monitor'), ['firewall', 'ban', 'terminal', 'docker', 'files']);
    assert.deepEqual(blocked('protect'), ['terminal', 'docker', 'files']);
    assert.deepEqual(blocked('full'), []);
    assert.equal(levelAllows('protect', 'firewall'), true);
    assert.equal(levelAllows('protect', 'ban'), true);
    assert.equal(levelAllows('bogus', 'terminal'), false);
});
