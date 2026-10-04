// Categorical palette: literal hex on purpose (consumed as inline styles in
// JS). Values follow the redesign palette in styles/_theme-variables.scss —
// green #3ddc97 / red #fb6f6f / amber #f5b945 / accent #6d7cff /
// cyan #49c7f0 / violet #b07bf5, neutral gray #646b7a.
const SERVICE_TYPES = {
    // Tab order note: ops/waf/build/deploy were merged in from the retired
    // ApplicationDetail page (§1 feature unification), then relocated into the
    // Settings sub-nav to declutter the top strip — Container Ops + Git & Deploy
    // + Build live under Settings, WAF under Settings → Security. Type-gating of
    // those sections is handled in SettingsTab (ops = Docker only; waf = Docker +
    // Python). `previews` stays a top-level tab.
    docker: {
        labelKey: 'common.labels.docker', label: 'Docker',
        color: '#49c7f0',
        bgColor: 'rgba(73, 199, 240, 0.1)',
        borderColor: 'rgba(73, 199, 240, 0.2)',
        icon: 'docker',
        tabs: ['overview', 'events', 'logs', 'environment', 'shell', 'metrics', 'previews', 'settings'],
    },
    flask: {
        labelKey: 'app.serviceTypes.flask', label: 'Flask',
        color: '#f5b945',
        bgColor: 'rgba(245, 185, 69, 0.1)',
        borderColor: 'rgba(245, 185, 69, 0.2)',
        icon: 'flask',
        tabs: ['overview', 'events', 'logs', 'environment', 'packages', 'gunicorn', 'commands', 'metrics', 'previews', 'settings'],
    },
    django: {
        labelKey: 'app.serviceTypes.django', label: 'Django',
        color: '#3ddc97',
        bgColor: 'rgba(61, 220, 151, 0.1)',
        borderColor: 'rgba(61, 220, 151, 0.2)',
        icon: 'django',
        tabs: ['overview', 'events', 'logs', 'environment', 'packages', 'gunicorn', 'commands', 'metrics', 'previews', 'settings'],
    },
    php: {
        label: 'PHP',
        color: '#b07bf5',
        bgColor: 'rgba(176, 123, 245, 0.1)',
        borderColor: 'rgba(176, 123, 245, 0.2)',
        icon: 'php',
        tabs: ['overview', 'events', 'logs', 'environment', 'previews', 'settings'],
    },
    static: {
        labelKey: 'app.serviceTypes.static', label: 'Static',
        color: '#6d7cff',
        bgColor: 'rgba(109, 124, 255, 0.1)',
        borderColor: 'rgba(109, 124, 255, 0.2)',
        icon: 'static',
        tabs: ['overview', 'events', 'environment', 'previews', 'settings'],
    },
    wordpress: {
        labelKey: 'app.serviceTypes.wordpress', label: 'WordPress',
        color: '#49c7f0',
        bgColor: 'rgba(73, 199, 240, 0.1)',
        borderColor: 'rgba(73, 199, 240, 0.2)',
        icon: 'wordpress',
        tabs: ['overview', 'events', 'logs', 'environment', 'settings'],
    },
};

const STATUS_CONFIG = {
    running: { labelKey: 'app.serviceTypes.live', label: 'Live', color: '#3ddc97', dotClass: 'live' },
    stopped: { labelKey: 'app.serviceTypes.stopped', label: 'Stopped', color: '#646b7a', dotClass: 'stopped' },
    deploying: { labelKey: 'app.serviceTypes.deploying', label: 'Deploying', color: '#f5b945', dotClass: 'deploying' },
    failed: { labelKey: 'common.state.failed', label: 'Failed', color: '#fb6f6f', dotClass: 'failed' },
    building: { labelKey: 'app.serviceTypes.building', label: 'Building', color: '#49c7f0', dotClass: 'building' },
};

const DEPLOY_STATUS = {
    success: { labelKey: 'app.serviceTypes.live', label: 'Live', color: '#3ddc97' },
    failed: { labelKey: 'common.state.failed', label: 'Failed', color: '#fb6f6f' },
    in_progress: { labelKey: 'app.serviceTypes.inProgress', label: 'In progress', color: '#f5b945' },
    rolled_back: { labelKey: 'app.serviceTypes.rolledBack', label: 'Rolled back', color: '#646b7a' },
    pending: { labelKey: 'app.serviceTypes.pending', label: 'Pending', color: '#49c7f0' },
};

export function getServiceType(appType) {
    return SERVICE_TYPES[appType] || {
        label: appType?.charAt(0).toUpperCase() + appType?.slice(1) || 'Unknown',
        color: '#646b7a',
        bgColor: 'rgba(100, 107, 122, 0.1)',
        borderColor: 'rgba(100, 107, 122, 0.2)',
        icon: 'default',
        tabs: ['overview', 'events', 'logs', 'environment', 'previews', 'settings'],
    };
}

export function getStatusConfig(status) {
    return STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
}

export function getDeployStatus(status) {
    return DEPLOY_STATUS[status] || DEPLOY_STATUS.pending;
}

export function getTabsForType(appType) {
    const type = getServiceType(appType);
    return type.tabs;
}

export function isPythonApp(appType) {
    return ['flask', 'django'].includes(appType);
}

export function isDockerApp(appType) {
    return appType === 'docker';
}

// Re-export the canonical verbose relative-time helper so existing imports
// from this module keep working.
export { formatRelativeTime } from '@/utils/time';

export function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '-';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${min}m ${sec}s`;
}

export { SERVICE_TYPES, STATUS_CONFIG, DEPLOY_STATUS };
