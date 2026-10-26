import { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './contexts/useAuth.js';
import { ToastProvider } from './contexts/ToastContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { LocaleProvider } from './contexts/LocaleContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { ResourceTierProvider } from './contexts/ResourceTierContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { rememberRedirect } from './utils/redirectAfterLogin';
import { TUNNEL_BASE } from './services/tunnelBase.js';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import ThemeSync from './components/ThemeSync';
import LocaleSync from './components/LocaleSync';
import DashboardLayout from './layouts/DashboardLayout';
import ShortcutProvider from './contexts/ShortcutProvider';
import AppLoader from './components/AppLoader';
import TabGroupLayout from './layouts/TabGroupLayout';
import { SERVER_TABS } from './components/servers/serverTabs';
import { DOMAIN_TABS } from './components/domains/domainTabs';
import { SERVICE_TABS } from './components/services/serviceTabs';
import { FILE_TABS } from './components/files/fileTabs';
import { MONITOR_TABS } from './components/monitoring/monitorTabs';
import { MARKET_TABS } from './components/marketplace/marketTabs';
import { BACKUP_TABS } from './components/backups/backupTabs';
import { SECURITY_TABS } from './components/security/securityTabs';
import { ORG_TABS } from './components/organization/organizationTabs';
import useDevMode from './hooks/useDevMode';
import useExtensionRoutes from './plugins/ExtensionRoutes';
import { useContributions } from './plugins/contributions';
import { ROUTE_COMPONENTS } from './routes/routeComponents';
import {
    ROUTE_GROUP_IDS,
    resolveCoreRouteTitle,
    resolveExactCoreRouteTitle,
    routesForGroup,
    routesForPlacement,
} from './routes/routeManifest';

// /apps/* is the legacy URL space for what is now "Services".
// The list route already redirects; this preserves deep links to a single app
// (and its active tab) by forwarding to the matching /services/* path.
function LegacyAppRedirect() {
    const { id, tab } = useParams();
    const suffix = [id, tab].filter(Boolean).join('/');
    return <Navigate to={`/services/${suffix}`} replace />;
}

function PageTitleUpdater() {
    const location = useLocation();
    const { page_titles: pluginTitles } = useContributions();
    const { panelTitle, publicTitle } = useAuth();

    useEffect(() => {
        const path = location.pathname;
        const basePath = '/' + path.split('/')[1];
        const title = resolveExactCoreRouteTitle(path)
            || (pluginTitles && pluginTitles[path])
            || resolveCoreRouteTitle(path)
            || (pluginTitles && pluginTitles[basePath])
            || '';

        // Public (pre-auth) routes stay brand-neutral; the app interior uses the panel brand.
        const isPublicRoute = ['/login', '/register', '/setup', '/forgot'].some(p => path.startsWith(p));
        const brand = isPublicRoute ? (publicTitle || 'Control Panel') : (panelTitle || 'ServerKit');
        document.title = title ? `${title} | ${brand}` : brand;
    }, [location, pluginTitles, panelTitle, publicTitle]);

    return null;
}

// Guard for developer-only pages (Test Sandbox). Reads the same shared flag as
// the sidebar's requiresCondition: 'devMode', so the nav entry and the route can
// never disagree. Off ⇒ the URL behaves as if the page doesn't exist.
function DevOnlyRoute({ children }) {
    const { devMode, resolved } = useDevMode({ withStatus: true });
    if (!resolved) return <AppLoader />;
    if (!devMode) return <Navigate to="/" replace />;
    return children;
}

function PrivateRoute({ children }) {
    const { isAuthenticated, loading, needsSetup, needsMigration } = useAuth();
    const location = useLocation();

    if (loading) {
        return <AppLoader />;
    }

    // Priority: migrations > setup > auth
    if (needsMigration) {
        return <Navigate to="/migrate" />;
    }

    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    if (isAuthenticated) return children;

    // Park the destination so login can return to it. Deep links into the
    // panel (?install= from a serverkit.ai badge, a shared /servers/:id) are
    // routinely opened without a session, and landing on the dashboard with
    // no explanation is the worst version of that.
    rememberRedirect(location);
    return <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
    const { isAuthenticated, loading, needsSetup, needsMigration } = useAuth();

    if (loading) {
        return <AppLoader />;
    }

    // Priority: migrations > setup > auth
    if (needsMigration) {
        return <Navigate to="/migrate" />;
    }

    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    return isAuthenticated ? <Navigate to="/" /> : children;
}

function SetupRoute({ children }) {
    const { loading, needsSetup, isAuthenticated } = useAuth();

    if (loading) {
        return <AppLoader />;
    }

    // If setup is not needed, redirect appropriately
    if (!needsSetup) {
        return isAuthenticated ? <Navigate to="/" /> : <Navigate to="/login" />;
    }

    return children;
}

function LegacyGitExtRedirect() {
    const { tab } = useParams();
    return <Navigate to={tab ? `/git/${tab}` : '/git'} replace />;
}

const ROUTE_GROUP_LAYOUTS = Object.freeze({
    services: { tabs: SERVICE_TABS },
    domains: { tabs: DOMAIN_TABS },
    servers: { tabs: SERVER_TABS, groupId: 'servers' },
    organization: { tabs: ORG_TABS },
    marketplace: { tabs: MARKET_TABS },
    files: { tabs: FILE_TABS, groupId: 'files' },
    monitoring: { tabs: MONITOR_TABS, groupId: 'monitoring' },
    backups: { tabs: BACKUP_TABS },
    security: { tabs: SECURITY_TABS, groupId: 'security' },
});

// These are the four extension nesting slots supported before the manifest
// refactor. Keeping the list explicit prevents a newly named contribution
// group from becoming routable without an intentional host change.
const EXTENSION_ROUTE_GROUPS = new Set(['servers', 'files', 'monitoring', 'security']);

function ManifestRouteElement({ route }) {
    let element;
    if (route.redirect) {
        element = <Navigate to={route.redirect} replace />;
    } else if (route.legacyRedirect === 'apps') {
        element = <LegacyAppRedirect />;
    } else if (route.legacyRedirect === 'git-extension') {
        element = <LegacyGitExtRedirect />;
    } else {
        const Component = ROUTE_COMPONENTS[route.component];
        element = (
            <Suspense fallback={<AppLoader />}>
                <Component />
            </Suspense>
        );
    }

    if (route.devOnly) element = <DevOnlyRoute>{element}</DevOnlyRoute>;
    if (route.guard === 'setup') element = <SetupRoute>{element}</SetupRoute>;
    if (route.guard === 'public') element = <PublicRoute>{element}</PublicRoute>;
    if (route.guard === 'private') element = <PrivateRoute>{element}</PrivateRoute>;
    return element;
}

function renderManifestRoute(route) {
    return (
        <Route
            key={route.id}
            index={route.index || undefined}
            path={route.index ? undefined : route.path}
            element={<ManifestRouteElement route={route} />}
        />
    );
}

function AppRoutes() {
    const { dashboardRoutes, groupRoutes, standaloneGroups } = useExtensionRoutes();
    return (
        <Routes>
            {routesForPlacement('root').map(renderManifestRoute)}
            {/* Standalone plugin layouts — bare or custom. Each group is
                a sibling top-level Route under PrivateRoute, so the
                plugin owns the chrome (no DashboardLayout sidebar). */}
            {standaloneGroups.map((group) => {
                const Layout = group.LayoutComponent;
                return (
                    <Route
                        key={`standalone:${group.layoutId}`}
                        element={<PrivateRoute><Layout /></PrivateRoute>}
                    >
                        {group.routes}
                    </Route>
                );
            })}
            <Route path="/" element={
                <PrivateRoute>
                    <ShortcutProvider>
                        <DashboardLayout />
                    </ShortcutProvider>
                </PrivateRoute>
            }>
                {ROUTE_GROUP_IDS.map((group) => {
                    const layout = ROUTE_GROUP_LAYOUTS[group];
                    return (
                        <Route
                            key={`group:${group}`}
                            element={<TabGroupLayout tabs={layout.tabs} groupId={layout.groupId} />}
                        >
                            {routesForGroup(group).map(renderManifestRoute)}
                            {EXTENSION_ROUTE_GROUPS.has(group) && groupRoutes[group]}
                        </Route>
                    );
                })}
                {routesForPlacement('dashboard')
                    .filter((route) => !route.group)
                    .map(renderManifestRoute)}
                {dashboardRoutes}
            </Route>
        </Routes>
    );
}

function App() {
    return (
        <Router basename={TUNNEL_BASE || undefined}>
            {/* Outermost: a toast raised while the theme or workspace is still
                initialising must already be translatable. */}
            <LocaleProvider>
            <WorkspaceProvider>
                <ThemeProvider>
                    <LayoutProvider>
                        <AuthProvider>
                            {/* Inside AuthProvider — PageTitleUpdater reads panelTitle/
                                publicTitle via useAuth (branding), so it must sit under
                                the provider. It stays inside Router for useLocation. */}
                            <PageTitleUpdater />
                            <ThemeSync />
                            <LocaleSync />
                            <ResourceTierProvider>
                                <ToastProvider>
                                    <TooltipProvider>
                                        <NotificationsProvider>
                                            <AppRoutes />
                                        </NotificationsProvider>
                                    </TooltipProvider>
                                    <Toaster />
                                </ToastProvider>
                            </ResourceTierProvider>
                        </AuthProvider>
                    </LayoutProvider>
                </ThemeProvider>
            </WorkspaceProvider>
            </LocaleProvider>
        </Router>
    );
}

export default App;
