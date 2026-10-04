import { FolderKanban, Braces, KeyRound, LayoutGrid } from 'lucide-react';

// Shared sub-nav for the Organization page group (Projects / Shared Variables /
// Vaults / Workspaces). Rendered in the shared PageTopbar via TabGroupLayout —
// the top-bar layout replaces the old collapsible sidebar sub-menu, matching
// every other group (Servers, Domains, Services, …). See docs/REDESIGN_MAP.md §6
// decision 3. Routes /projects, /shared-variables, /vaults, /workspaces are
// unchanged and still reachable from these tabs.
//
// Vaults (encrypted secret stores) sits beside Shared Variables here because
// both are key/value config surfaces; inbound Webhooks — the other half of the
// retired "Secrets & Webhooks" page — now lives at Settings → Admin → Webhooks.
export const ORG_TABS = [
    { to: '/projects', labelKey: 'app.organizationTabs.projects', label: 'Projects', end: true, icon: <FolderKanban size={15} /> },
    { to: '/shared-variables', labelKey: 'app.organizationTabs.sharedVariables', label: 'Shared variables', icon: <Braces size={15} /> },
    { to: '/vaults', labelKey: 'app.organizationTabs.vaults', label: 'Vaults', icon: <KeyRound size={15} /> },
    { to: '/workspaces', labelKey: 'app.organizationTabs.workspaces', label: 'Workspaces', icon: <LayoutGrid size={15} /> },
];
