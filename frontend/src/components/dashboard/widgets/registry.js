/**
 * Widget type registry for the dashboard grid (plan 62).
 *
 * A widget TYPE describes a placeable kind of widget:
 *   { id, name, icon, cat, desc, w, h, min: [w,h], defaultCfg, component?, plugin? }
 *
 * Core types render through `WidgetBody` in ./renderers.jsx. Plugin-contributed
 * types carry their own `component`, resolved from the plugin's frontend module.
 */
import { useMemo } from 'react';
import {
    Activity,
    BarChart3,
    CheckCircle2,
    CircleDashed,
    Clock,
    Cpu,
    FileText,
    History,
    LayoutGrid,
    Rocket,
    Rows3,
    ShieldAlert,
    Terminal,
    Zap,
} from 'lucide-react';
import { useContributions, resolveComponent } from '@/plugins/contributions';

export const WIDGET_CATEGORIES = ['Metrics', 'Inventory', 'Operations', 'Utility'];

export const CORE_WIDGET_TYPES = [
    {
        id: 'stat',
        name: 'Stat',
        icon: BarChart3,
        cat: 'Metrics',
        desc: 'Single value with sparkline and threshold colouring',
        w: 3,
        h: 2,
        min: [2, 2],
        defaultCfg: {
            titleKey: 'app.registry.cpuUsage', title: 'CPU usage',
            resource: '$server',
            metric: 'cpu',
            agg: 'last',
            spark: true,
            thresholds: [70, 90],
            color: '',
        },
    },
    {
        id: 'timeseries',
        name: 'Time series',
        icon: Activity,
        cat: 'Metrics',
        desc: 'Multi-series area chart with legend',
        w: 8,
        h: 4,
        min: [3, 3],
        defaultCfg: {
            titleKey: 'app.registry.realTimePerformance', title: 'Real-time performance',
            series: [
                { resource: '$server', metric: 'cpu' },
                { resource: '$server', metric: 'ram' },
            ],
            legend: true,
            fill: true,
        },
    },
    {
        id: 'gauge',
        name: 'Gauge',
        icon: CircleDashed,
        cat: 'Metrics',
        desc: 'Radial gauge against a maximum',
        w: 3,
        h: 3,
        min: [2, 3],
        defaultCfg: {
            titleKey: 'app.registry.diskUsage', title: 'Disk usage',
            resource: '$server',
            metric: 'disk',
            agg: 'last',
            thresholds: [70, 88],
        },
    },
    {
        id: 'topn',
        name: 'Top N',
        icon: Rows3,
        cat: 'Metrics',
        desc: 'Ranked bars across the server fleet',
        w: 4,
        h: 4,
        min: [3, 3],
        defaultCfg: {
            titleKey: 'app.registry.busiestServers', title: 'Busiest servers',
            dim: 'servers',
            metric: 'cpu',
            limit: 5,
        },
    },
    {
        id: 'table',
        name: 'Resource table',
        icon: LayoutGrid,
        cat: 'Inventory',
        desc: 'Services, servers, containers or deployments',
        w: 8,
        h: 4,
        min: [4, 3],
        defaultCfg: {
            titleKey: 'app.registry.applications', title: 'Services',
            source: 'services',
            limit: 6,
        },
    },
    {
        id: 'logs',
        name: 'Log stream',
        icon: Terminal,
        cat: 'Operations',
        desc: 'Tailing log lines with a level filter',
        w: 6,
        h: 4,
        min: [3, 3],
        defaultCfg: {
            titleKey: 'app.registry.liveLogs', title: 'Live logs',
            source: 'file',
            path: '',
            containerId: '',
            level: 'all',
            lines: 60,
        },
    },
    {
        id: 'deploys',
        name: 'Deploy activity',
        icon: Rocket,
        cat: 'Operations',
        desc: 'Recent deployment jobs with step progress',
        w: 4,
        h: 4,
        min: [3, 3],
        defaultCfg: {
            titleKey: 'app.registry.deployActivity', title: 'Deploy activity',
            limit: 5,
        },
    },
    {
        id: 'alerts',
        name: 'Alerts',
        icon: ShieldAlert,
        cat: 'Operations',
        desc: 'Open threshold alerts across the fleet and this host',
        w: 4,
        h: 3,
        min: [3, 2],
        defaultCfg: {
            titleKey: 'app.registry.openAlerts', title: 'Open alerts',
            severity: 'all',
            limit: 8,
        },
    },
    {
        id: 'status',
        name: 'Status grid',
        icon: CheckCircle2,
        cat: 'Operations',
        desc: 'Up/down matrix for servers or services',
        w: 4,
        h: 3,
        min: [3, 2],
        defaultCfg: {
            titleKey: 'app.registry.statusGrid', title: 'Status grid',
            source: 'servers',
            limit: 12,
        },
    },
    {
        id: 'feed',
        name: 'Activity feed',
        icon: History,
        cat: 'Operations',
        desc: 'Audit trail of recent changes (admin only)',
        w: 4,
        h: 4,
        min: [3, 3],
        defaultCfg: {
            titleKey: 'app.registry.recentActivity', title: 'Recent activity',
            limit: 6,
        },
    },
    {
        id: 'actions',
        name: 'Quick actions',
        icon: Zap,
        cat: 'Utility',
        desc: 'Shortcut buttons into other sections',
        w: 3,
        h: 3,
        min: [2, 2],
        defaultCfg: {
            titleKey: 'app.registry.quickActions', title: 'Quick actions',
            items: ['servers', 'docker', 'terminal'],
        },
    },
    {
        id: 'specs',
        name: 'Host details',
        icon: Cpu,
        cat: 'Utility',
        desc: 'Key/value hardware and OS facts',
        w: 3,
        h: 3,
        min: [2, 2],
        defaultCfg: {
            titleKey: 'app.registry.hostDetails', title: 'Host details',
            resource: '$server',
        },
    },
    {
        id: 'clock',
        name: 'Clock',
        icon: Clock,
        cat: 'Utility',
        desc: 'Current time, for a wall display or a second timezone',
        w: 3,
        h: 2,
        min: [2, 2],
        defaultCfg: {
            title: '',
            timezone: '',
            showDate: true,
            showSeconds: true,
        },
    },
    {
        id: 'note',
        name: 'Text note',
        icon: FileText,
        cat: 'Utility',
        desc: 'Markdown-ish note for runbooks and context',
        w: 3,
        h: 2,
        min: [2, 2],
        defaultCfg: {
            titleKey: 'app.registry.note', title: 'Note',
            text: 'On-call: check **deploy activity** before restarting anything.',
        },
    },
];

// Clamp a contributed size to something the grid can actually place.
function clampSpan(value, fallback, max) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(Math.round(n), max);
}

/**
 * Namespaced type id for a contributed widget: `<plugin-slug>:<id>`.
 *
 * Without this, two extensions both shipping an `activity` widget would
 * collide and one would vanish. The namespace is also what a saved board
 * stores in `widget.type`, so a board keeps pointing at the right plugin's
 * widget even if another plugin later claims the same bare id.
 */
export function contributedTypeId(plugin, id) {
    return `${plugin}:${id}`;
}

// Manifest fields are snake_case like the rest of `contributions` (see
// docs/EXTENSIONS.md). The camelCase spellings are tolerated as aliases so an
// extension author who guessed the JS convention isn't silently ignored.
function normalizeContributed(decl, component) {
    const w = clampSpan(decl.w, 4, 12);
    const h = clampSpan(decl.h, 3, 12);
    const min = Array.isArray(decl.min) ? decl.min : [];
    const category = decl.category || decl.cat;
    const defaultCfg = decl.default_cfg || decl.defaultCfg;
    return {
        id: contributedTypeId(decl.plugin, decl.id),
        name: decl.name || decl.id,
        icon: LayoutGrid,
        cat: WIDGET_CATEGORIES.includes(category) ? category : 'Utility',
        desc: decl.description || decl.desc || '',
        w,
        h,
        min: [clampSpan(min[0], 2, w), clampSpan(min[1], 2, h)],
        defaultCfg: defaultCfg && typeof defaultCfg === 'object' ? defaultCfg : {},
        component,
        plugin: decl.plugin,
    };
}

/**
 * Core types plus anything plugins contribute under
 * `contributions.dashboard_widgets`.
 *
 * That contribution surface does not exist in the backend envelope yet — the
 * `|| []` below is what keeps this working today and lights it up the moment
 * the backend starts emitting it. A contributed entry is skipped (silently,
 * not fatally) when its component cannot be resolved, which is the normal
 * state for a plugin whose frontend bundle has not been built.
 */
export function useWidgetTypes() {
    const contributions = useContributions();

    return useMemo(() => {
        const declared = Array.isArray(contributions?.dashboard_widgets)
            ? contributions.dashboard_widgets
            : [];

        const types = [...CORE_WIDGET_TYPES];
        const seen = new Set(types.map((t) => t.id));

        for (const decl of declared) {
            if (!decl || typeof decl !== 'object' || !decl.id || !decl.plugin) continue;
            const typeId = contributedTypeId(decl.plugin, decl.id);
            if (seen.has(typeId)) continue;
            const component = resolveComponent(decl.plugin, decl.component);
            if (!component) continue;
            seen.add(typeId);
            types.push(normalizeContributed(decl, component));
        }

        return types;
    }, [contributions]);
}

/** Pure lookup. Returns null for an unknown id so callers can render a
 *  "this widget type is gone" placeholder instead of crashing. */
export function getWidgetType(types, id) {
    if (!Array.isArray(types) || !id) return null;
    return types.find((t) => t && t.id === id) || null;
}

const METRIC_TITLES = {
    cpu: 'CPU usage',
    ram: 'Memory',
    disk: 'Disk',
    load: 'Load average',
    net_in: 'Network in',
    net_out: 'Network out',
};

const SOURCE_TITLES = {
    apps: 'Services',
    services: 'Services',
    servers: 'Servers',
    containers: 'Containers',
    deploys: 'Deployments',
};

/**
 * What to show in a widget's header.
 *
 * Falling straight back to the TYPE name meant a board of four different stats
 * read "Stat" four times, which tells you nothing about any of them. So when a
 * widget carries no explicit title, name it after what it is pointed at before
 * giving up and using the type.
 *
 * This is deliberately derived at render time rather than written into the
 * widget's stored config — config the user never set should not appear in their
 * saved board.
 */
export function deriveWidgetTitle(widget, type) {
    const cfg = widget?.cfg || {};
    if (cfg.title) return cfg.title;

    if (METRIC_TITLES[cfg.metric]) return METRIC_TITLES[cfg.metric];
    if (SOURCE_TITLES[cfg.source]) return SOURCE_TITLES[cfg.source];

    // A multi-series chart is named by its series, up to a point.
    if (Array.isArray(cfg.series) && cfg.series.length) {
        const names = cfg.series
            .map((s) => METRIC_TITLES[s?.metric])
            .filter(Boolean);
        if (names.length === 1) return names[0];
        if (names.length > 1) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
    }

    return type?.name || widget?.type || 'Widget';
}
