import { Archive, Clock, Cloud, LayoutGrid, Settings } from 'lucide-react';

// Shared sub-nav for the Backups page group. Rendered in the shared PageTopbar
// tabs so the sections live in the page top bar — matching the Domains/Services
// top-bar layout (see docs/REDESIGN_MAP.md §6 decision 3). All sections render
// from the single Backups page, keyed off the /backups/:tab route.
//
// Overview leads ("is my data safe?") and the archive table moved behind
// Snapshots ("show me every file") — two different questions, and the summary
// band that belongs to the first used to repeat above all of them.
export const BACKUP_TABS = [
    { to: '/backups', labelKey: 'common.labels.overview', label: 'Overview', end: true, icon: <LayoutGrid size={15} /> },
    { to: '/backups/schedules', labelKey: 'app.backupTabs.schedules', label: 'Schedules', icon: <Clock size={15} /> },
    { to: '/backups/snapshots', labelKey: 'app.backupTabs.snapshots', label: 'Backups', icon: <Archive size={15} /> },
    { to: '/backups/storage', labelKey: 'common.labels.storage', label: 'Storage', icon: <Cloud size={15} /> },
    { to: '/backups/settings', labelKey: 'common.labels.settings', label: 'Settings', icon: <Settings size={15} /> },
];
