import { Box, Plus, LayoutTemplate, Activity, ChefHat } from 'lucide-react';

// Shared sub-nav for the Services page group (Services / New Service /
// Templates / Recipes / Deploy Activity). Rendered in each page's
// <PageTopbar tabs={SERVICE_TABS}> — the demo's top-bar layout replaces the old
// sidebar sub-menu (see docs/REDESIGN_MAP.md §6 decision 3).
export const SERVICE_TABS = [
    { to: '/services', labelKey: 'common.labels.services', label: 'Services', end: true, icon: <Box size={15} /> },
    { to: '/services/new', labelKey: 'app.serviceTabs.newService', label: 'New service', icon: <Plus size={15} /> },
    { to: '/templates', labelKey: 'app.serviceTabs.templates', label: 'Templates', icon: <LayoutTemplate size={15} /> },
    { to: '/recipes', labelKey: 'app.serviceTabs.recipes', label: 'Recipes', icon: <ChefHat size={15} /> },
    { to: '/deployments', labelKey: 'app.serviceTabs.deployActivity', label: 'Deploy activity', icon: <Activity size={15} /> },
];
