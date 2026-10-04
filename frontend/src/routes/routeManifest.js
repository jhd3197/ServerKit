/**
 * Core route descriptor contract.
 *
 * @typedef {'root' | 'dashboard'} RoutePlacement
 * @typedef {'public' | 'private' | 'setup'} RouteGuard
 * @typedef {Object} CoreRoute
 * @property {string} id Stable identity used by tests and diagnostics.
 * @property {string} path Absolute React Router path (or `*` for the dashboard fallback).
 * @property {RoutePlacement} placement Router level where the route is mounted.
 * @property {string=} component Key in routeComponents.jsx.
 * @property {string=} redirect Absolute redirect destination.
 * @property {'apps' | 'git-extension'=} legacyRedirect Parameter-aware legacy redirect.
 * @property {RouteGuard=} guard Root-route authentication policy.
 * @property {string=} group Dashboard tab-group identity.
 * @property {string=} title Browser title before the panel brand.
 * @property {string=} titlePath Optional exact title-only path for a parameterized route.
 * @property {boolean=} index Whether this is the dashboard index route.
 * @property {boolean=} devOnly Whether the page is hidden outside developer mode.
 * @property {Record<string, Record<string, {titleKey: string, title: string}>>=} titleByParam Title overrides keyed by parameter.
 */

/** @type {ReadonlyArray<Readonly<CoreRoute>>} */
export const CORE_ROUTES = Object.freeze([
    { id: 'migration', path: '/migrate', placement: 'root', component: 'DatabaseMigration', titleKey: 'app.routeManifest.databaseMigration', title: 'Database migration' },
    { id: 'setup', path: '/setup', placement: 'root', component: 'Setup', guard: 'setup', titleKey: 'app.routeManifest.setup', title: 'Setup' },
    { id: 'login', path: '/login', placement: 'root', component: 'Login', guard: 'public', titleKey: 'app.routeManifest.login', title: 'Sign in' },
    { id: 'sso-callback', path: '/login/callback/:provider', placement: 'root', component: 'SSOCallback', guard: 'public', titleKey: 'app.routeManifest.login', title: 'Sign in' },
    { id: 'register', path: '/register', placement: 'root', component: 'Register', guard: 'public', titleKey: 'app.routeManifest.register', title: 'Register' },
    { id: 'connection-callback', path: '/connections/callback/:provider', placement: 'root', component: 'SourceConnectionCallback', guard: 'private', titleKey: 'app.routeManifest.githubConnection', title: 'GitHub connection', titlePath: '/connections/callback/github' },
    { id: 'github-app-callback', path: '/connections/github-app/callback', placement: 'root', component: 'GithubAppCallback', guard: 'private', titleKey: 'app.routeManifest.githubSetup', title: 'GitHub setup' },
    { id: 'public-status', path: '/status/:slug', placement: 'root', component: 'PublicStatusPage' },

    { id: 'dashboard', path: '/', placement: 'dashboard', component: 'Dashboard', titleKey: 'app.routeManifest.dashboard', title: 'Dashboard', index: true },
    { id: 'services', path: '/services', placement: 'dashboard', group: 'services', component: 'Services', titleKey: 'common.labels.services', title: 'Services' },
    { id: 'new-service', path: '/services/new', placement: 'dashboard', group: 'services', component: 'NewService', titleKey: 'app.routeManifest.newService', title: 'New service' },
    { id: 'templates', path: '/templates', placement: 'dashboard', group: 'services', component: 'Templates', titleKey: 'app.routeManifest.templates', title: 'Templates' },
    { id: 'deployments', path: '/deployments', placement: 'dashboard', group: 'services', component: 'Deployments', titleKey: 'app.routeManifest.deploymentActivity', title: 'Deployment activity' },
    { id: 'deploy-console', path: '/deployments/:jobId', placement: 'dashboard', group: 'services', component: 'DeployConsole', titleKey: 'app.routeManifest.deploymentActivity', title: 'Deployment activity' },
    { id: 'recipes', path: '/recipes', placement: 'dashboard', group: 'services', component: 'Recipes', titleKey: 'app.routeManifest.recipes', title: 'Recipes' },
    { id: 'service-detail', path: '/services/:id', placement: 'dashboard', component: 'ServiceDetail', titleKey: 'common.labels.services', title: 'Services' },
    { id: 'service-detail-tab', path: '/services/:id/:tab', placement: 'dashboard', component: 'ServiceDetail', titleKey: 'common.labels.services', title: 'Services' },
    { id: 'service-detail-section', path: '/services/:id/:tab/:section', placement: 'dashboard', component: 'ServiceDetail', titleKey: 'common.labels.services', title: 'Services' },
    { id: 'imports', path: '/imports', placement: 'dashboard', component: 'ImportWizard', titleKey: 'app.routeManifest.importASite', title: 'Import a site' },
    { id: 'imports-coexistence', path: '/imports/coexistence', placement: 'dashboard', component: 'Coexistence', titleKey: 'app.routeManifest.runningAlongsideAnotherPanel', title: 'Running alongside another panel' },
    { id: 'legacy-apps', path: '/apps', placement: 'dashboard', redirect: '/services' },
    { id: 'legacy-app-detail', path: '/apps/:id', placement: 'dashboard', legacyRedirect: 'apps' },
    { id: 'legacy-app-tab', path: '/apps/:id/:tab', placement: 'dashboard', legacyRedirect: 'apps' },
    { id: 'legacy-workflow', path: '/workflow', placement: 'dashboard', redirect: '/automations' },

    { id: 'domains', path: '/domains', placement: 'dashboard', group: 'domains', component: 'Domains', titleKey: 'common.labels.domains', title: 'Domains' },
    { id: 'ssl', path: '/ssl', placement: 'dashboard', group: 'domains', component: 'SSLCertificates', titleKey: 'app.routeManifest.sslCertificates', title: 'SSL certificates' },
    { id: 'legacy-dns', path: '/dns', placement: 'dashboard', redirect: '/domains', titleKey: 'app.routeManifest.dnsZones', title: 'DNS zones' },
    { id: 'legacy-dynamic-dns', path: '/dynamic-dns', placement: 'dashboard', redirect: '/domains', titleKey: 'app.routeManifest.dynamicDns', title: 'Dynamic DNS' },
    { id: 'databases', path: '/databases', placement: 'dashboard', component: 'Databases', titleKey: 'common.labels.databases', title: 'Databases' },
    { id: 'databases-tab', path: '/databases/:tab', placement: 'dashboard', component: 'Databases', titleKey: 'common.labels.databases', title: 'Databases' },
    { id: 'docker', path: '/docker', placement: 'dashboard', redirect: '/docker/containers', titleKey: 'common.labels.docker', title: 'Docker' },
    { id: 'docker-tab', path: '/docker/:tab', placement: 'dashboard', component: 'Docker', titleKey: 'common.labels.docker', title: 'Docker' },

    { id: 'servers', path: '/servers', placement: 'dashboard', group: 'servers', component: 'Servers', titleKey: 'common.labels.servers', title: 'Servers' },
    { id: 'fleet', path: '/fleet', placement: 'dashboard', group: 'servers', component: 'AgentFleet', titleKey: 'app.routeManifest.agentFleet', title: 'Agent fleet' },
    { id: 'fleet-proxy', path: '/fleet-proxy', placement: 'dashboard', group: 'servers', component: 'FleetProxy', titleKey: 'app.routeManifest.fleetProxy', title: 'Fleet proxy' },
    { id: 'server-templates', path: '/server-templates', placement: 'dashboard', group: 'servers', component: 'ServerTemplates', titleKey: 'app.routeManifest.serverTemplates', title: 'Server templates' },
    { id: 'server-detail', path: '/servers/:id', placement: 'dashboard', component: 'ServerDetail', titleKey: 'common.labels.servers', title: 'Servers' },
    { id: 'server-detail-tab', path: '/servers/:id/:tab', placement: 'dashboard', component: 'ServerDetail', titleKey: 'common.labels.servers', title: 'Servers' },
    { id: 'legacy-agent-plugins', path: '/agent-plugins', placement: 'dashboard', redirect: '/extensions', titleKey: 'common.labels.extensions', title: 'Extensions' },

    { id: 'projects', path: '/projects', placement: 'dashboard', group: 'organization', component: 'Projects', titleKey: 'app.routeManifest.projects', title: 'Projects' },
    { id: 'shared-variables', path: '/shared-variables', placement: 'dashboard', group: 'organization', component: 'SharedVariables', titleKey: 'app.routeManifest.sharedVariables', title: 'Shared variables' },
    { id: 'vaults', path: '/vaults', placement: 'dashboard', group: 'organization', component: 'Vaults', titleKey: 'app.routeManifest.vaults', title: 'Vaults' },
    { id: 'workspaces', path: '/workspaces', placement: 'dashboard', group: 'organization', component: 'Workspaces', titleKey: 'app.routeManifest.workspaces', title: 'Workspaces' },
    { id: 'project-detail', path: '/projects/:id', placement: 'dashboard', component: 'ProjectDetail', titleKey: 'app.routeManifest.projects', title: 'Projects' },
    { id: 'project-detail-tab', path: '/projects/:id/:tab', placement: 'dashboard', component: 'ProjectDetail', titleKey: 'app.routeManifest.projects', title: 'Projects' },
    { id: 'workspace-detail', path: '/workspaces/:id', placement: 'dashboard', component: 'WorkspaceDetail', titleKey: 'common.labels.workspace', title: 'Workspace' },
    {
        id: 'workspace-detail-tab', path: '/workspaces/:id/:tab', placement: 'dashboard', component: 'WorkspaceDetail', titleKey: 'common.labels.workspace', title: 'Workspace',
        titleByParam: { tab: {
            overview: { titleKey: 'app.routeManifest.workspaceOverview', title: 'Workspace overview' },
            servers: { titleKey: 'app.routeManifest.workspaceServers', title: 'Workspace servers' },
            services: { titleKey: 'app.routeManifest.workspaceServices', title: 'Workspace services' },
            sites: { titleKey: 'app.routeManifest.workspaceSites', title: 'Workspace sites' },
            members: { titleKey: 'app.routeManifest.workspaceMembers', title: 'Workspace members' },
            settings: { titleKey: 'app.routeManifest.workspaceSettings', title: 'Workspace settings' },
        } },
    },
    {
        id: 'workspace-detail-section', path: '/workspaces/:id/:tab/:section', placement: 'dashboard', component: 'WorkspaceDetail', titleKey: 'common.labels.workspace', title: 'Workspace',
        titleByParam: {
            tab: { settings: { titleKey: 'app.routeManifest.workspaceSettings', title: 'Workspace settings' } },
            section: {
                general: { titleKey: 'app.routeManifest.workspaceSettings', title: 'Workspace settings' },
                navigation: { titleKey: 'app.routeManifest.workspaceNavigationPermissions', title: 'Workspace navigation permissions' },
            },
        },
    },

    { id: 'extensions', path: '/extensions', placement: 'dashboard', group: 'marketplace', component: 'Marketplace', titleKey: 'common.labels.extensions', title: 'Extensions' },
    { id: 'installed-extensions', path: '/extensions/installed', placement: 'dashboard', group: 'marketplace', component: 'Marketplace', titleKey: 'app.routeManifest.installedExtensions', title: 'Installed extensions' },
    { id: 'marketplace-recipes', path: '/extensions/recipes', placement: 'dashboard', group: 'marketplace', component: 'Recipes', titleKey: 'app.routeManifest.recipes', title: 'Recipes' },
    { id: 'downloads', path: '/downloads', placement: 'dashboard', group: 'marketplace', component: 'Downloads', titleKey: 'app.routeManifest.downloads', title: 'Downloads' },
    { id: 'legacy-marketplace', path: '/marketplace', placement: 'dashboard', redirect: '/extensions' },
    { id: 'legacy-marketplace-installed', path: '/marketplace/installed', placement: 'dashboard', redirect: '/extensions/installed' },
    { id: 'style-guide', path: '/style-guide', placement: 'dashboard', component: 'StyleGuide', titleKey: 'app.routeManifest.styleGuide', title: 'Style guide' },
    { id: 'style-guide-tab', path: '/style-guide/:tab', placement: 'dashboard', component: 'StyleGuide', titleKey: 'app.routeManifest.styleGuide', title: 'Style guide' },
    { id: 'app-map', path: '/app-map', placement: 'dashboard', component: 'AppMap', titleKey: 'app.routeManifest.appMap', title: 'App map' },
    { id: 'app-map-tab', path: '/app-map/:tab', placement: 'dashboard', component: 'AppMap', titleKey: 'app.routeManifest.appMap', title: 'App map' },
    { id: 'documentation', path: '/documentation', placement: 'dashboard', component: 'Documentation', titleKey: 'app.routeManifest.documentation', title: 'Documentation' },
    { id: 'legacy-firewall', path: '/firewall', placement: 'dashboard', redirect: '/security/firewall' },
    { id: 'legacy-git-extension', path: '/git-ext', placement: 'dashboard', legacyRedirect: 'git-extension' },
    { id: 'legacy-git-extension-tab', path: '/git-ext/:tab', placement: 'dashboard', legacyRedirect: 'git-extension' },

    { id: 'files', path: '/files', placement: 'dashboard', group: 'files', component: 'FileManager', titleKey: 'app.routeManifest.fileManager', title: 'File manager' },
    { id: 'monitoring', path: '/monitoring', placement: 'dashboard', group: 'monitoring', component: 'Monitoring', titleKey: 'common.labels.monitoring', title: 'Monitoring' },
    { id: 'monitors', path: '/monitoring/monitors', placement: 'dashboard', group: 'monitoring', component: 'Monitors', titleKey: 'app.routeManifest.monitors', title: 'Monitors' },
    { id: 'incidents', path: '/monitoring/incidents', placement: 'dashboard', group: 'monitoring', component: 'Incidents', titleKey: 'app.routeManifest.incidents', title: 'Incidents' },
    { id: 'legacy-alerts', path: '/monitoring/alerts', placement: 'dashboard', group: 'monitoring', redirect: '/monitoring/incidents' },
    { id: 'legacy-fleet-alerts', path: '/monitoring/fleet-alerts', placement: 'dashboard', group: 'monitoring', redirect: '/monitoring/incidents' },
    { id: 'jobs', path: '/monitoring/jobs', placement: 'dashboard', group: 'monitoring', component: 'Jobs', titleKey: 'app.routeManifest.jobs', title: 'Jobs' },
    { id: 'scheduled-jobs', path: '/monitoring/jobs/scheduled', placement: 'dashboard', group: 'monitoring', component: 'Jobs', titleKey: 'common.labels.monitoring', title: 'Monitoring' },
    { id: 'errors', path: '/monitoring/errors', placement: 'dashboard', group: 'monitoring', component: 'Errors', titleKey: 'app.routeManifest.errors', title: 'Errors' },
    { id: 'monitoring-tab', path: '/monitoring/:tab', placement: 'dashboard', group: 'monitoring', component: 'Monitoring', titleKey: 'common.labels.monitoring', title: 'Monitoring' },
    { id: 'telemetry', path: '/telemetry', placement: 'dashboard', group: 'monitoring', component: 'Telemetry', titleKey: 'app.routeManifest.telemetry', title: 'Telemetry' },
    { id: 'monitor-detail', path: '/monitoring/monitors/:monitorId', placement: 'dashboard', component: 'MonitorDetail', titleKey: 'common.labels.monitoring', title: 'Monitoring' },
    { id: 'legacy-observability', path: '/observability', placement: 'dashboard', redirect: '/monitoring', titleKey: 'common.labels.monitoring', title: 'Monitoring' },
    { id: 'legacy-fleet-monitor', path: '/fleet-monitor', placement: 'dashboard', redirect: '/monitoring' },

    { id: 'backups', path: '/backups', placement: 'dashboard', group: 'backups', component: 'Backups', titleKey: 'common.labels.backups', title: 'Backups' },
    { id: 'backups-tab', path: '/backups/:tab', placement: 'dashboard', group: 'backups', component: 'Backups', titleKey: 'common.labels.backups', title: 'Backups' },
    { id: 'cron', path: '/cron', placement: 'dashboard', component: 'CronJobs', titleKey: 'app.routeManifest.cronJobs', title: 'Cron jobs' },
    { id: 'security', path: '/security', placement: 'dashboard', group: 'security', component: 'Security', titleKey: 'common.labels.security', title: 'Security' },
    { id: 'security-tab', path: '/security/:tab', placement: 'dashboard', group: 'security', component: 'Security', titleKey: 'common.labels.security', title: 'Security' },
    { id: 'terminal', path: '/terminal', placement: 'dashboard', component: 'Terminal', titleKey: 'app.routeManifest.terminal', title: 'Terminal' },
    { id: 'legacy-terminal', path: '/terminal/terminal', placement: 'dashboard', redirect: '/terminal/shell' },
    { id: 'terminal-tab', path: '/terminal/:tab', placement: 'dashboard', component: 'Terminal', titleKey: 'app.routeManifest.terminal', title: 'Terminal' },
    { id: 'legacy-webhooks', path: '/webhooks', placement: 'dashboard', redirect: '/settings/webhooks' },
    { id: 'legacy-secret-webhooks', path: '/secrets/webhooks', placement: 'dashboard', redirect: '/settings/webhooks' },
    { id: 'legacy-secrets', path: '/secrets', placement: 'dashboard', redirect: '/vaults' },
    { id: 'legacy-secrets-tab', path: '/secrets/:tab', placement: 'dashboard', redirect: '/vaults' },
    { id: 'queue', path: '/queue', placement: 'dashboard', component: 'QueueOperations', titleKey: 'app.routeManifest.queueBus', title: 'Queue bus' },
    { id: 'test-sandbox', path: '/test-sandbox', placement: 'dashboard', component: 'TestSandbox', titleKey: 'app.routeManifest.testSandbox', title: 'Test sandbox', devOnly: true },
    { id: 'queue-detail', path: '/queue/:groupSlug/:queueSlug', placement: 'dashboard', component: 'QueueDetail', titleKey: 'app.routeManifest.queueBus', title: 'Queue bus' },
    { id: 'notifications', path: '/notifications', placement: 'dashboard', component: 'Notifications', titleKey: 'app.routeManifest.notifications', title: 'Notifications' },
    { id: 'notification-delivery-log', path: '/admin/notifications', placement: 'dashboard', component: 'DeliveryLog', titleKey: 'app.routeManifest.notificationDeliveryLog', title: 'Notification delivery log' },
    { id: 'legacy-jobs', path: '/jobs', placement: 'dashboard', redirect: '/monitoring/jobs', titleKey: 'app.routeManifest.jobs', title: 'Jobs' },
    { id: 'legacy-scheduled-jobs', path: '/jobs/scheduled', placement: 'dashboard', redirect: '/monitoring/jobs/scheduled', titleKey: 'app.routeManifest.jobs', title: 'Jobs' },
    { id: 'settings', path: '/settings', placement: 'dashboard', component: 'Settings', titleKey: 'common.labels.settings', title: 'Settings' },
    { id: 'settings-tab', path: '/settings/:tab', placement: 'dashboard', component: 'Settings', titleKey: 'common.labels.settings', title: 'Settings' },
    { id: 'not-found', path: '*', placement: 'dashboard', component: 'NotFound' },
]);

export const ROUTE_GROUP_IDS = Object.freeze([
    'services',
    'domains',
    'servers',
    'organization',
    'marketplace',
    'files',
    'monitoring',
    'backups',
    'security',
]);

export function routesForPlacement(placement) {
    return CORE_ROUTES.filter((route) => route.placement === placement);
}

export function routesForGroup(group) {
    return CORE_ROUTES.filter((route) => route.group === group);
}

function matchPattern(pattern, pathname) {
    const patternParts = pattern.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    if (pattern === '/' && pathname === '/') return { params: {}, score: 1000 };
    if (pattern === '*' || patternParts.length !== pathParts.length) return null;

    const params = {};
    let staticSegments = 0;
    for (let index = 0; index < patternParts.length; index += 1) {
        const expected = patternParts[index];
        const actual = pathParts[index];
        if (expected.startsWith(':')) {
            params[expected.slice(1)] = actual;
        } else if (expected === actual) {
            staticSegments += 1;
        } else {
            return null;
        }
    }

    return { params, score: staticSegments * 100 - patternParts.length };
}

export function resolveCoreRouteTitle(pathname) {
    let best = null;

    for (const route of CORE_ROUTES) {
        if (!route.title) continue;
        const titlePattern = route.titlePath || route.path;
        const match = matchPattern(titlePattern, pathname);
        if (!match || (best && match.score <= best.score)) continue;

        let title = route.title;
        if (route.titleByParam) {
            for (const [param, titles] of Object.entries(route.titleByParam)) {
                title = titles[match.params[param]]?.title || title;
            }
        }
        best = { score: match.score, title };
    }

    return best?.title || '';
}

export function resolveExactCoreRouteTitle(pathname) {
    const route = CORE_ROUTES.find((candidate) => {
        const titlePath = candidate.titlePath || candidate.path;
        return candidate.title && !titlePath.includes(':') && titlePath === pathname;
    });
    return route?.title || '';
}
