// Agent permission levels: install-command builder and server health summary.
// The level is enforced by the agent and only reported to the panel; nothing
// here (or anywhere in the UI) changes it.

export const PERMISSION_LEVELS = ['monitor', 'protect', 'full'];
export const DEFAULT_LEVEL = 'monitor';

const MIN_SILENCE_MS = 3 * 60 * 1000;

export function normalizeLevel(level) {
    return PERMISSION_LEVELS.includes(level) ? level : null;
}

export function levelKind(level) {
    if (level === 'monitor') return 'cyan';
    if (level === 'protect') return 'violet';
    return 'amber';
}

export function buildInstallCommands({ origin, token, level }) {
    const lvl = normalizeLevel(level) || DEFAULT_LEVEL;
    return {
        linux: `curl -fsSL ${origin}/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh && \\
  sudo bash /tmp/serverkit-agent-install.sh \\
  --server "${origin}" \\
  --token "${token}" \\
  --level ${lvl}`,
        windows: `irm ${origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${origin}" -Token "${token}" -Level ${lvl}`,
    };
}

// Health = online/offline + report age + failing service checks.
// -> { kind: Pill kind, code, failing: [check names], degraded: [check names] }
export function serverHealth(server, now = Date.now()) {
    const status = server.status || 'pending';
    if (status === 'pending' || status === 'connecting') {
        return { kind: 'gray', code: 'pending', failing: [], degraded: [] };
    }
    const checks = server.service_checks || [];
    const failing = checks.filter((c) => c.status === 'down').map((c) => c.name);
    const degraded = checks.filter((c) => c.status === 'degraded').map((c) => c.name);
    if (status !== 'online') return { kind: 'red', code: 'offline', failing, degraded };

    const seen = server.last_report_at || server.last_seen;
    const limit = Math.max(MIN_SILENCE_MS, 3 * 1000 * (server.report_interval_seconds || 0));
    if (seen && now - new Date(seen).getTime() > limit) {
        return { kind: 'amber', code: 'stale', failing, degraded };
    }
    if (failing.length) return { kind: 'red', code: 'failing', failing, degraded };
    if (degraded.length) return { kind: 'amber', code: 'degraded', failing, degraded };
    return { kind: 'green', code: 'healthy', failing, degraded };
}

// What each level lets the panel do on a server. Mirrors
// backend/app/services/permission_levels.py: monitor is report-only, protect
// adds the PROTECT_ACTIONS (firewall, fail2ban/CrowdSec, Cloudflare origin
// lock), full is everything.
export const CAPABILITIES = ['cpu', 'memory', 'disk', 'services', 'database', 'firewall', 'ban', 'terminal', 'docker', 'files'];
const HEALTH = ['cpu', 'memory', 'disk', 'services', 'database'];
const PROTECT = [...HEALTH, 'firewall', 'ban'];

export const LEVEL_CAPABILITIES = {
    monitor: HEALTH,
    protect: PROTECT,
    full: CAPABILITIES,
};

export function levelAllows(level, capability) {
    return (LEVEL_CAPABILITIES[normalizeLevel(level) || DEFAULT_LEVEL] || []).includes(capability);
}
