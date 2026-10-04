import {
    LayoutDashboard, Shield, Key, Network,
    FileCheck, ScrollText, Bell, Settings,
} from 'lucide-react';

// Shared sub-nav for the Security page group. Rendered in the shared PageTopbar
// tabs so every section lives in the page top bar — matching the Domains/
// Services top-bar layout (see docs/REDESIGN_MAP.md §6 decision 3). Core
// sections only: the install-gated tools (Fail2ban, Malware Scanner,
// Quarantine, Vulnerability Scan, Auto Updates) are security extensions that
// contribute their own tabs into this group when installed (groupId
// "security" — TabGroupLayout merges them in). All core sections render from
// the single Security page, keyed off the /security/:tab route.
export const SECURITY_TABS = [
    { to: '/security', labelKey: 'common.labels.overview', label: 'Overview', end: true, icon: <LayoutDashboard size={15} /> },
    { to: '/security/firewall', labelKey: 'app.securityTabs.firewall', label: 'Firewall', icon: <Shield size={15} /> },
    { to: '/security/ssh-keys', labelKey: 'app.securityTabs.sshKeys', label: 'SSH keys', icon: <Key size={15} /> },
    { to: '/security/ip-lists', labelKey: 'app.securityTabs.ipLists', label: 'IP lists', icon: <Network size={15} /> },
    { to: '/security/integrity', labelKey: 'app.securityTabs.fileIntegrity', label: 'File integrity', icon: <FileCheck size={15} /> },
    { to: '/security/audit', labelKey: 'app.securityTabs.audit', label: 'Audit', icon: <ScrollText size={15} /> },
    { to: '/security/events', labelKey: 'app.securityTabs.events', label: 'Events', icon: <Bell size={15} /> },
    { to: '/security/settings', labelKey: 'common.labels.settings', label: 'Settings', icon: <Settings size={15} /> },
];
