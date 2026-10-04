import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    CORE_ROUTES,
    ROUTE_GROUP_IDS,
    resolveCoreRouteTitle,
    resolveExactCoreRouteTitle,
    routesForGroup,
    routesForPlacement,
} from '../routeManifest.js';

test('core route paths and ids are unique', () => {
    assert.equal(CORE_ROUTES.length, 98, 'route changes must update the parity baseline intentionally');
    assert.equal(new Set(CORE_ROUTES.map(({ id }) => id)).size, CORE_ROUTES.length);
    assert.equal(new Set(CORE_ROUTES.map(({ path }) => path)).size, CORE_ROUTES.length);
});

test('each route has one render strategy and valid placement metadata', () => {
    for (const route of CORE_ROUTES) {
        const strategies = [route.component, route.redirect, route.legacyRedirect].filter(Boolean);
        assert.equal(strategies.length, 1, `${route.id} must define exactly one render strategy`);
        assert.ok(['root', 'dashboard'].includes(route.placement), `${route.id} has an invalid placement`);
        if (route.group) assert.ok(ROUTE_GROUP_IDS.includes(route.group), `${route.id} has an unknown group`);
        if (route.guard) assert.equal(route.placement, 'root', `${route.id} cannot guard a nested dashboard route`);
    }
});

test('route selectors partition the manifest without duplication', () => {
    const selected = [...routesForPlacement('root'), ...routesForPlacement('dashboard')];
    assert.equal(selected.length, CORE_ROUTES.length);

    for (const group of ROUTE_GROUP_IDS) {
        assert.ok(routesForGroup(group).length > 0, `${group} must own at least one route`);
    }
});

test('title resolution prefers static routes and handles dynamic workspace titles', () => {
    assert.equal(resolveExactCoreRouteTitle('/services/new'), 'New service');
    assert.equal(resolveExactCoreRouteTitle('/services/123'), '');
    assert.equal(resolveCoreRouteTitle('/services/new'), 'New service');
    assert.equal(resolveCoreRouteTitle('/services/123/settings'), 'Services');
    assert.equal(resolveCoreRouteTitle('/workspaces/42/overview'), 'Workspace Overview');
    assert.equal(resolveCoreRouteTitle('/workspaces/42/settings/navigation'), 'Workspace Navigation Permissions');
    assert.equal(resolveCoreRouteTitle('/connections/callback/github'), 'GitHub connection');
    assert.equal(resolveCoreRouteTitle('/status/public'), '');
    assert.equal(resolveCoreRouteTitle('/not-a-core-route'), '');
});

test('every component key has exactly one lazy page registration', async () => {
    const registryPath = fileURLToPath(new URL('../routeComponents.jsx', import.meta.url));
    const registrySource = await readFile(registryPath, 'utf8');
    const registered = new Set(
        [...registrySource.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]+): lazy\(/gm)]
            .map((match) => match[1]),
    );
    const referenced = new Set(CORE_ROUTES.map(({ component }) => component).filter(Boolean));

    assert.deepEqual([...registered].sort(), [...referenced].sort());
});
