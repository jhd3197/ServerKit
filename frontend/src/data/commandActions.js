// Runnable actions for the command palette (plan 41, Phase 3). Typing `>` filters
// results to this list. v1 ships only safe, non-destructive verbs — openers and
// navigation-with-intent — never blind destructive/exec commands (those belong to
// entity rows with confirm dialogs; see the plan's "Deliberately deferred").
//
// Each action: { id, label, keywords, adminOnly?, suggested?, perform(ctx) }.
// `ctx` = { navigate, toggleTheme, logout, api } is assembled by CommandPalette
// from the app's hooks. `suggested: true` surfaces the action on the empty-query
// screen. Every action still passes the Phase-1 authz filter (adminOnly + nav).

import { copyToClipboard } from '@/utils/clipboard';

export const COMMAND_ACTIONS = [
    {
        id: 'new-service',
        labelKey: 'app.commandActions.newService', label: 'New service',
        keywords: 'create app deploy add service container',
        suggested: true,
        perform: ({ navigate }) => navigate('/services/new'),
    },
    {
        id: 'add-server',
        labelKey: 'app.commandActions.addServer', label: 'Add server',
        keywords: 'connect agent fleet new server node',
        suggested: true,
        perform: ({ navigate }) => navigate('/servers'),
    },
    {
        id: 'add-domain',
        labelKey: 'app.commandActions.addDomain', label: 'Add domain',
        keywords: 'dns new create domain zone',
        perform: ({ navigate }) => navigate('/domains'),
    },
    {
        id: 'new-cron',
        labelKey: 'app.commandActions.newCronJob', label: 'New cron job',
        keywords: 'schedule task create cron job',
        perform: ({ navigate }) => navigate('/cron'),
    },
    {
        id: 'new-backup-policy',
        labelKey: 'app.commandActions.newBackupPolicy', label: 'New backup policy',
        keywords: 'backup schedule protection create policy',
        perform: ({ navigate }) => navigate('/backups'),
    },
    {
        id: 'install-extension',
        labelKey: 'app.commandActions.installExtension', label: 'Install extension',
        keywords: 'marketplace plugin add manual install extension',
        perform: ({ navigate }) => navigate('/extensions'),
    },
    {
        id: 'open-terminal',
        labelKey: 'app.commandActions.openTerminal', label: 'Open terminal',
        keywords: 'shell ssh console terminal logs',
        perform: ({ navigate }) => navigate('/terminal'),
    },
    {
        id: 'toggle-theme',
        labelKey: 'app.commandActions.toggleTheme', label: 'Toggle theme',
        keywords: 'dark light mode appearance theme switch',
        perform: ({ toggleTheme }) => toggleTheme && toggleTheme(),
    },
    {
        id: 'copy-version',
        labelKey: 'app.commandActions.copyPanelVersion', label: 'Copy panel version',
        keywords: 'about build version copy',
        perform: async ({ api }) => {
            try {
                const data = (await (api.getSystemInfo
                    ? api.getSystemInfo()
                    : api.getSystemSettings())) || {};
                const version = data.version || data.app_version || data.panel_version;
                if (version) await copyToClipboard(version);
            } catch {
                /* best-effort clipboard copy — never surface an error */
            }
        },
    },
    {
        id: 'sign-out',
        labelKey: 'app.commandActions.signOut', label: 'Sign Out',
        keywords: 'logout log out exit sign out',
        perform: ({ logout }) => logout && logout(),
    },
];

export default COMMAND_ACTIONS;
