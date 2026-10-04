// Static top-level pages for the command palette (plan 41). Extracted from the
// old inline STATIC_PAGES so the palette component stays about orchestration.
//
// `navId` ties a page to its sidebar item id, letting the palette apply the SAME
// workspace nav-permission gate the sidebar uses (a member whose workspace hides
// "servers" shouldn't find the Servers page here). Pages with no navId (e.g.
// Import a Site) have no sidebar item and are always reachable.
//
// The seven hand-typed `Settings: X` rows that used to live here retired in
// favor of data/settingsIndex.js, which indexes settings at the card level.
// WordPress / FTP / Status / GPU / Workflow / Remote-Access / Cloud-Provision
// palette entries are contributed by their extensions (command_palette).

export const PALETTE_PAGES = [
    { labelKey: 'common.labels.services', label: 'Services', path: '/services', navId: 'services', keywords: 'apps containers' },
    { labelKey: 'common.labels.docker', label: 'Docker', path: '/docker', navId: 'docker', keywords: 'containers images' },
    { labelKey: 'common.labels.databases', label: 'Databases', path: '/databases', navId: 'databases', keywords: 'mysql postgres sql mongo' },
    { labelKey: 'common.labels.domains', label: 'Domains', path: '/domains', navId: 'domains', keywords: 'dns nginx records nameserver zones' },
    { labelKey: 'app.palettePages.sslCertificates', label: 'SSL certificates', path: '/ssl', navId: 'domains', keywords: 'https tls certificate' },
    { labelKey: 'app.palettePages.templates', label: 'Templates', path: '/templates', navId: 'services', keywords: 'deploy one-click gallery' },
    { labelKey: 'app.palettePages.deployments', label: 'Deployments', path: '/deployments', navId: 'services', keywords: 'deploy jobs status logs' },
    { labelKey: 'app.palettePages.files', label: 'Files', path: '/files', navId: 'files', keywords: 'file manager explorer' },
    { labelKey: 'common.labels.monitoring', label: 'Monitoring', path: '/monitoring', navId: 'monitoring', keywords: 'metrics uptime observability alerts host health' },
    { labelKey: 'app.palettePages.events', label: 'Events', path: '/telemetry', navId: 'monitoring', keywords: 'telemetry metrics observability system events' },
    { labelKey: 'common.labels.backups', label: 'Backups', path: '/backups', navId: 'backups', keywords: 'snapshots restore protection' },
    { labelKey: 'app.palettePages.cronJobs', label: 'Cron jobs', path: '/cron', navId: 'cron', keywords: 'schedule tasks' },
    { labelKey: 'common.labels.security', label: 'Security', path: '/security', navId: 'security', keywords: 'firewall fail2ban' },
    { labelKey: 'app.palettePages.terminal', label: 'Terminal', path: '/terminal', navId: 'terminal', keywords: 'shell ssh console logs' },
    { labelKey: 'common.labels.servers', label: 'Servers', path: '/servers', navId: 'servers', keywords: 'fleet agents' },
    { labelKey: 'app.palettePages.fleetMonitor', label: 'Fleet monitor', path: '/monitoring', navId: 'monitoring', keywords: 'agents status heatmap fleet host health servers' },
    { labelKey: 'app.palettePages.capacityForecast', label: 'Capacity forecast', path: '/monitoring/capacity', navId: 'monitoring', keywords: 'compare anomaly forecast disk trend' },
    { labelKey: 'app.palettePages.alertRules', label: 'Alert rules', path: '/monitoring/rules', navId: 'monitoring', keywords: 'thresholds limits notifications delivery' },
    { labelKey: 'common.labels.extensions', label: 'Extensions', path: '/extensions', navId: 'marketplace', keywords: 'extensions plugins marketplace' },
    { labelKey: 'app.palettePages.downloads', label: 'Downloads', path: '/downloads', navId: 'marketplace', keywords: 'agent installer' },
    { labelKey: 'app.palettePages.importASite', label: 'Import a site', path: '/imports', keywords: 'import migrate cpanel directadmin hestia backup adoption move existing' },
    { labelKey: 'app.palettePages.projects', label: 'Projects', path: '/projects', navId: 'organization', keywords: 'organization group' },
    { labelKey: 'app.palettePages.sharedVariables', label: 'Shared variables', path: '/shared-variables', navId: 'organization', keywords: 'env secrets shared' },
    { labelKey: 'app.palettePages.workspaces', label: 'Workspaces', path: '/workspaces', navId: 'organization', keywords: 'organization team' },
    { labelKey: 'app.palettePages.vaults', label: 'Vaults', path: '/vaults', navId: 'organization', keywords: 'secrets tokens credentials vault' },
    { labelKey: 'app.palettePages.queueBus', label: 'Queue bus', path: '/queue', navId: 'queue', keywords: 'bus operations tasks' },
    { labelKey: 'app.palettePages.jobs', label: 'Jobs', path: '/monitoring/jobs', navId: 'monitoring', keywords: 'scheduler background work' },
    { labelKey: 'app.palettePages.monitors', label: 'Monitors', path: '/monitoring/monitors', navId: 'monitoring', keywords: 'uptime check probe http ping website' },
    { labelKey: 'app.palettePages.incidents', label: 'Incidents', path: '/monitoring/incidents', navId: 'monitoring', keywords: 'outage alert downtime postmortem' },
    // No navId: the inbound-webhook console is a Settings tab now, not a
    // sidebar page, so there's no nav item for the permission gate to consult.
    { labelKey: 'app.palettePages.webhooks', label: 'Webhooks', path: '/settings/webhooks', keywords: 'webhook receive forward delivery inbound' },
].map((p) => ({ ...p, id: `page:${p.path}`, category: 'Pages' }));

export default PALETTE_PAGES;
