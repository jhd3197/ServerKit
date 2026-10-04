// Managed profile (ServerKit Cloud, plan 25)
//
// When ServerKit Cloud holds a Managed scope for this server it sends a signed
// presentation policy naming the capabilities it has taken over. This ONE
// table is the whole mapping from a held capability to what the panel stops
// showing: the sidebar items it removes, the route prefixes whose pages render
// the managed card instead of their content, and the in-page controls
// elsewhere that collapse to the card in miniature. Hidden is not removed —
// every route stays registered and every API keeps answering.
//
// This lives in its own module (re-exported from sidebarItems.js, which is
// where the mapping is read alongside the items it hides) because it must
// stay dependency-free: the drift guard in
// routes/__tests__/managedProfile.test.mjs imports it under plain node, and
// sidebarItems.js pulls in JSX tab modules node cannot parse.
export const MANAGED_CAPABILITY_MAP = {
    // Servers, Agent Fleet and Fleet Proxy — the whole Servers top bar,
    // including per-server detail pages under /servers/:id.
    fleet: {
        labelKey: 'managed.capability.fleet',
        label: 'Server fleet',
        noteKey: 'managed.capabilityNote.fleet',
        note: 'Servers, agent fleet and fleet proxy',
        sidebarIds: ['servers'],
        routePrefixes: ['/servers', '/fleet', '/fleet-proxy'],
        // "Deploy to server" in Templates targets a fleet the customer no
        // longer operates.
        controls: ['templates-deploy'],
    },
    // Cloud Servers (the serverkit-cloud-provision tab).
    provisioning: {
        labelKey: 'managed.capability.provisioning',
        label: 'Server provisioning',
        noteKey: 'managed.capabilityNote.provisioning',
        note: 'Cloud servers',
        sidebarIds: [],
        routePrefixes: ['/cloud'],
        controls: [],
    },
    // Server Templates (Config Templates under the Servers top bar).
    config_templates: {
        labelKey: 'managed.capability.config_templates',
        label: 'Server templates',
        noteKey: 'managed.capabilityNote.config_templates',
        note: 'Config templates',
        sidebarIds: [],
        routePrefixes: ['/server-templates'],
        controls: [],
    },
    // Panel/agent update screens and self-update. The self-update section in
    // Settings › About collapses to the card in miniature. (The panel's
    // self-update still runs; the card says so until plan 08's rings own it.)
    updates: {
        labelKey: 'managed.capability.updates',
        label: 'Updates',
        noteKey: 'managed.capabilityNote.updates',
        note: 'Panel and agent update screens and self-update',
        sidebarIds: [],
        routePrefixes: [],
        controls: ['self-update'],
    },
    // Backup scheduling and destinations. The Backups page stays — local
    // restore is the customer's — but its scheduling sections collapse.
    backups_schedule: {
        labelKey: 'managed.capability.backups_schedule',
        label: 'Backup scheduling',
        noteKey: 'managed.capabilityNote.backups_schedule',
        note: 'Backup schedules and destinations; local restore stays with you',
        sidebarIds: [],
        routePrefixes: [],
        controls: ['backup-scheduling'],
    },
    // Alert rules and channels; the live charts stay.
    monitoring_alerts: {
        labelKey: 'managed.capability.monitoring_alerts',
        label: 'Alert rules',
        noteKey: 'managed.capabilityNote.monitoring_alerts',
        note: 'Alert rules and channels; the live charts stay',
        sidebarIds: [],
        routePrefixes: ['/monitoring/rules'],
        controls: [],
    },
    firewall: {
        labelKey: 'managed.capability.firewall',
        label: 'Firewall',
        noteKey: 'managed.capabilityNote.firewall',
        note: 'Firewall management',
        sidebarIds: [],
        routePrefixes: ['/security/firewall'],
        controls: [],
    },
};

// Sidebar item ids a held capability set removes. alwaysVisible items are
// never in the map, so this needs no alwaysVisible carve-out.
export function managedSidebarIds(capabilities = []) {
    const ids = new Set();
    for (const cap of capabilities) {
        for (const id of MANAGED_CAPABILITY_MAP[cap]?.sidebarIds || []) ids.add(id);
    }
    return ids;
}

// The capability whose pages a path falls under, or null. Segment-boundary
// matching: '/fleet' matches '/fleet' and '/fleet/3', never '/fleet-proxy'.
export function managedCapabilityForPath(pathname, capabilities = []) {
    for (const cap of capabilities) {
        for (const prefix of MANAGED_CAPABILITY_MAP[cap]?.routePrefixes || []) {
            if (pathname === prefix || pathname.startsWith(prefix + '/')) return cap;
        }
    }
    return null;
}

// Does a held capability set cover a named in-page control?
export function managedControlHeld(control, capabilities = []) {
    return capabilities.some((cap) => (MANAGED_CAPABILITY_MAP[cap]?.controls || []).includes(control));
}
