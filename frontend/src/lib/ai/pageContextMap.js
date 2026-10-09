// Maps the current route to a human-readable context label + entity ids the
// assistant can use ("this server", "this app"), plus per-page suggested
// prompts for the empty state. Ordered: first matching pattern wins.

const ROUTES = [
    { re: /^\/docker(\/|$)/, labelKey: 'common.labels.docker', label: 'Docker', entity: 'docker' },
    { re: /^\/services\/([^/]+)$/, labelKey: 'common.labels.service', label: 'Service', entity: 'service', idKey: 'service_id' },
    { re: /^\/services(\/|$)/, labelKey: 'common.labels.services', label: 'Services', entity: 'services' },
    { re: /^\/apps\/([^/]+)/, labelKey: 'app.pageContextMap.application', label: 'Service', entity: 'app', idKey: 'app_id' },
    { re: /^\/apps(\/|$)/, labelKey: 'app.pageContextMap.applications', label: 'Services', entity: 'apps' },
    { re: /^\/databases(\/|$)/, labelKey: 'common.labels.databases', label: 'Databases', entity: 'databases' },
    { re: /^\/wordpress\/([^/]+)/, labelKey: 'app.pageContextMap.wordpressSite', label: 'WordPress site', entity: 'wp_site', idKey: 'site_id' },
    { re: /^\/wordpress(\/|$)/, labelKey: 'app.pageContextMap.wordpress', label: 'WordPress', entity: 'wordpress' },
    { re: /^\/servers\/([^/]+)/, labelKey: 'common.labels.server', label: 'Server', entity: 'server', idKey: 'server_id' },
    { re: /^\/servers(\/|$)/, labelKey: 'common.labels.servers', label: 'Servers', entity: 'servers' },
    { re: /^\/fleet/, labelKey: 'app.pageContextMap.fleet', label: 'Fleet', entity: 'fleet' },
    { re: /^\/monitoring(\/|$)/, labelKey: 'common.labels.monitoring', label: 'Monitoring', entity: 'monitoring' },
    { re: /^\/security(\/|$)/, labelKey: 'common.labels.security', label: 'Security', entity: 'security' },
    { re: /^\/backups(\/|$)/, labelKey: 'common.labels.backups', label: 'Backups', entity: 'backups' },
    { re: /^\/dns(\/|$)/, label: 'DNS', entity: 'dns' },
    { re: /^\/domains(\/|$)/, labelKey: 'common.labels.domains', label: 'Domains', entity: 'domains' },
    { re: /^\/files(\/|$)/, labelKey: 'app.pageContextMap.fileManager', label: 'File manager', entity: 'files' },
    { re: /^\/extensions/, labelKey: 'common.labels.extensions', label: 'Extensions', entity: 'marketplace' },
    { re: /^\/$/, labelKey: 'app.pageContextMap.dashboard', label: 'Dashboard', entity: 'dashboard' },
];

const SUGGESTED = {
    docker: ['List my running containers', "Why might a container keep restarting?"],
    apps: ['List my services and their status', 'Which services are unhealthy?'],
    app: ['Summarize the status of this service'],
    databases: ['List my databases', 'How big is each database?'],
    monitoring: ["What's my current CPU, memory, and disk usage?"],
    servers: ['List the servers in my fleet'],
    server: ["Summarize this server's health"],
    dashboard: ['What can you do?', "Give me a quick health summary of this panel"],
};

const GLOBAL_SUGGESTED = ['What can you do?', "What's my system's CPU and memory usage?"];

export function getCoreContext(pathname, params = {}) {
    for (const entry of ROUTES) {
        const m = pathname.match(entry.re);
        if (!m) continue;
        const ids = {};
        if (entry.idKey && m[1]) ids[entry.idKey] = m[1];
        // Merge any router params (covers deeper routes).
        for (const [k, v] of Object.entries(params || {})) {
            if (v != null) ids[k] = v;
        }
        return { route: pathname, label: entry.label, entity: entry.entity, ids };
    }
    return { route: pathname, labelKey: 'app.pageContextMap.dashboard', label: 'Dashboard', entity: 'dashboard', ids: {} };
}

export function getSuggestedPrompts(entity) {
    return SUGGESTED[entity] || GLOBAL_SUGGESTED;
}
