import { Archive, Boxes, Container, Database, FolderOpen, Globe, ListChecks, Activity, Rocket, Server, ShieldCheck, Terminal } from 'lucide-react';

// Every destination is a real route registered in App.jsx.
export const ACTIONS = {
    servers: ['Manage servers', Server, '/servers'],
    services: ['Services', Boxes, '/services'],
    docker: ['Docker containers', Container, '/docker'],
    terminal: ['Open terminal', Terminal, '/terminal'],
    deploys: ['Deploy activity', Rocket, '/deployments'],
    databases: ['Databases', Database, '/databases'],
    backups: ['Backups', Archive, '/backups'],
    monitoring: ['Monitoring', Activity, '/monitoring'],
    domains: ['Domains', Globe, '/domains'],
    files: ['File manager', FolderOpen, '/files'],
    security: ['Security', ShieldCheck, '/security'],
    jobs: ['Jobs', ListChecks, '/monitoring/jobs'],
};

export const QUICK_ACTION_KEYS = Object.keys(ACTIONS);

// [key, label] pairs for the inspector's shortcut picker. Derived from ACTIONS
// so the list of shortcuts a user can *choose* can never drift from the list
// this widget can actually *render* — they did drift once already.
export const QUICK_ACTION_OPTIONS = Object.entries(ACTIONS).map(([key, [label]]) => [key, label]);
