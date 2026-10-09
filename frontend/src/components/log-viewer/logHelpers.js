// Helpers for the log viewer: severity detection, file categorisation,
// formatting, search highlighting.

export const LOG_GROUPS = [
    { id: 'web',      labelKey: 'app.logHelpers.webServers', label: 'Web servers', match: (p) => /(nginx|apache2|httpd)/i.test(p) },
    { id: 'app',      labelKey: 'app.logHelpers.applications', label: 'Applications', match: (p) => /(php-fpm|gunicorn|uwsgi|node|app)/i.test(p) && !/nginx|apache/i.test(p) },
    { id: 'database', labelKey: 'common.labels.databases', label: 'Databases', match: (p) => /(mysql|mariadb|postgres|redis|mongo)/i.test(p) },
    { id: 'system',   labelKey: 'common.labels.system', label: 'System', match: (p) => /(syslog|messages|auth|secure|kern|dmesg|boot|cron)/i.test(p) },
    { id: 'mail',     labelKey: 'app.logHelpers.mail', label: 'Mail', match: (p) => /(mail|postfix|dovecot|exim)/i.test(p) },
    { id: 'security', labelKey: 'common.labels.security', label: 'Security', match: (p) => /(fail2ban|ufw|iptables|audit)/i.test(p) },
];

export function categoriseLog(log) {
    const probe = `${log.path || ''} ${log.name || ''}`;
    for (const g of LOG_GROUPS) {
        if (g.match(probe)) return g.id;
    }
    return 'other';
}

export function logKindFromPath(path) {
    if (/error|err\b/i.test(path)) return 'error';
    if (/access/i.test(path)) return 'access';
    if (/nginx/i.test(path)) return 'nginx';
    if (/apache/i.test(path)) return 'apache';
    if (/mysql|mariadb|postgres/i.test(path)) return 'database';
    if (/php/i.test(path)) return 'php';
    if (/syslog|messages/i.test(path)) return 'system';
    if (/auth|secure/i.test(path)) return 'security';
    if (/mail|postfix|dovecot/i.test(path)) return 'mail';
    return 'default';
}

// Detect severity per line. Order matters — fatal/error before warn before info.
const SEVERITY_PATTERNS = [
    { id: 'fatal', re: /\b(FATAL|CRITICAL|EMERG|ALERT|PANIC)\b/i },
    { id: 'error', re: /\b(ERROR|ERR|FAIL(?:ED)?|EXCEPTION|TRACEBACK)\b/i },
    { id: 'warn',  re: /\b(WARN(?:ING)?|DEPRECATED|NOTICE)\b/i },
    { id: 'info',  re: /\b(INFO|NOTICE|STARTING|STARTED|READY|LISTENING)\b/i },
    { id: 'debug', re: /\b(DEBUG|TRACE|VERBOSE)\b/i },
];

export function severityOf(line) {
    if (!line) return null;
    for (const p of SEVERITY_PATTERNS) {
        if (p.re.test(line)) return p.id;
    }
    return null;
}

// Build escape-safe regex for highlighting search matches.
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns array of segments: [{ text, match: bool }]
export function splitOnMatch(text, query) {
    if (!query) return [{ text, match: false }];
    const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
    const parts = text.split(re);
    return parts
        .filter((p) => p !== '')
        .map((p) => ({ text: p, match: re.test(p) && p.toLowerCase() === query.toLowerCase() }));
}

// Bytes formatter shared by sidebar and status bar — canonical impl.
export { formatBytes } from '@/utils/formatBytes';

// Relative-time formatter — canonical impl.
export { formatRelativeTime } from '@/utils/time';
