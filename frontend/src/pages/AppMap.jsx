import { useMemo, useState } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    Controls,
    MiniMap,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    Map as MapIcon, Layers, Compass, Network, Info,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageLayout from '../layouts/PageLayout';
import useTabParam from '../hooks/useTabParam';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const VIEWS = [
    {
        id: 'stack',
        labelKey: 'app.appMap.requestStack', label: 'Request Stack',
        icon: Layers,
        descriptionKey: 'app.appMap.howARequestFlowsFromThe', description: 'How a request flows from the browser through the frontend, backend, services and database.',
    },
    {
        id: 'routes',
        labelKey: 'app.appMap.routesApis', label: 'Routes & APIs',
        icon: Compass,
        descriptionKey: 'app.appMap.sidebarNavigationPagesBackendApiBlueprints', description: 'Sidebar navigation → pages → backend API blueprints they call.',
    },
    {
        id: 'topology',
        labelKey: 'app.appMap.runtimeTopology', label: 'Runtime Topology',
        icon: Network,
        descriptionKey: 'app.appMap.howThePanelConnectsToServers', description: 'How the panel connects to servers, agents, services and apps in production.',
    },
];

// ─── shared node styling ────────────────────────────────────────────────────
const nodeBase = {
    border: '1px solid var(--border-default)',
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary)',
    background: 'var(--bg-card)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    minWidth: 150,
    textAlign: 'center',
};
const tone = (bg, border, color) => ({ background: bg, borderColor: border, color });

const STYLES = {
    client: tone('rgba(99,102,241,0.10)', 'rgba(99,102,241,0.45)', 'var(--text-primary)'),
    frontend: tone('rgba(59,130,246,0.10)', 'rgba(59,130,246,0.40)', 'var(--text-primary)'),
    backend: tone('rgba(16,185,129,0.10)', 'rgba(16,185,129,0.40)', 'var(--text-primary)'),
    service: tone('rgba(245,158,11,0.10)', 'rgba(245,158,11,0.40)', 'var(--text-primary)'),
    data: tone('rgba(168,85,247,0.10)', 'rgba(168,85,247,0.40)', 'var(--text-primary)'),
    infra: tone('rgba(236,72,153,0.10)', 'rgba(236,72,153,0.40)', 'var(--text-primary)'),
    agent: tone('rgba(20,184,166,0.10)', 'rgba(20,184,166,0.40)', 'var(--text-primary)'),
};

const mk = (id, label, x, y, kind, sub) => ({
    id,
    position: { x, y },
    data: { label: sub ? (
        <div>
            <div className="app-map__node-name">{label}</div>
            <div className="app-map__node-sub">{sub}</div>
        </div>
    ) : label },
    style: { ...nodeBase, ...STYLES[kind] },
});

const edge = (id, source, target, label, animated = false) => ({
    id,
    source,
    target,
    label,
    animated,
    type: 'smoothstep',
    style: { stroke: 'var(--border-default)', strokeWidth: 1.5 },
    labelStyle: { fontSize: 12, fill: 'var(--text-secondary)' },
    labelBgStyle: { fill: 'var(--bg-card)' },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border-default)' },
});

// ─── 1. Request stack view ──────────────────────────────────────────────────
function buildStackGraph() {
    const nodes = [
        mk('browser', 'Browser', 360, 0, 'client', 'User session, cookies, JWT'),
        mk('nginx', 'Nginx', 360, 90, 'infra', 'TLS, reverse proxy, static'),
        mk('vite', 'Vite Dev Server', 80, 90, 'frontend', 'HMR (dev only)'),
        mk('react', 'React SPA', 360, 180, 'frontend', 'pages/, components/, contexts/'),
        mk('api-svc', 'ApiService', 360, 270, 'frontend', 'frontend/src/services/api.js'),
        mk('socket', 'Socket.IO Client', 660, 270, 'frontend', 'metrics, logs, terminal'),
        mk('flask', 'Flask App', 360, 380, 'backend', 'create_app(), JWT middleware'),
        mk('blueprints', 'API Blueprints', 360, 470, 'backend', 'app/api/*  (60+ files)'),
        mk('sockio', 'Socket Handlers', 660, 470, 'backend', 'app/sockets.py'),
        mk('services', 'Service Layer', 360, 570, 'service', 'app/services/* (stateless)'),
        mk('models', 'SQLAlchemy Models', 180, 670, 'data', 'app/models/*'),
        mk('agentgw', 'Agent Gateway', 560, 670, 'agent', 'app/agent_gateway.py'),
        mk('db', 'SQLite / PostgreSQL', 180, 760, 'data'),
        mk('shell', 'Shell / Docker / FS', 360, 760, 'infra', 'subprocess, docker SDK'),
        mk('agents', 'Remote Agents', 560, 760, 'agent', 'managed servers'),
    ];
    const edges = [
        edge('e1', 'browser', 'nginx', 'HTTPS'),
        edge('e2', 'nginx', 'react', 'static'),
        edge('e3', 'browser', 'vite', 'dev'),
        edge('e4', 'react', 'api-svc'),
        edge('e5', 'react', 'socket'),
        edge('e6', 'api-svc', 'flask', '/api/v1/*', true),
        edge('e7', 'socket', 'sockio', 'WebSocket', true),
        edge('e8', 'flask', 'blueprints'),
        edge('e9', 'blueprints', 'services'),
        edge('e10', 'sockio', 'services'),
        edge('e11', 'services', 'models'),
        edge('e12', 'services', 'shell'),
        edge('e13', 'services', 'agentgw'),
        edge('e14', 'models', 'db'),
        edge('e15', 'agentgw', 'agents', 'mTLS'),
    ];
    return { nodes, edges };
}

// ─── 2. Routes & APIs view ──────────────────────────────────────────────────
const ROUTE_MAP = [
    ['Dashboard', '/', ['system', 'metrics', 'monitoring']],
    ['Servers', '/servers', ['servers', 'fleet']],
    ['Agent Fleet', '/fleet', ['fleet', 'pairing']],
    ['Cloud', '/cloud', ['cloud']],
    ['Domains', '/domains', ['domains', 'nginx']],
    ['DNS Zones', '/dns', ['dns']],
    ['SSL', '/ssl', ['ssl', 'ssl/advanced']],
    ['Services', '/services', ['apps', 'templates']],
    ['Deployments', '/deployments', ['deploy', 'deployment-jobs', 'builds']],
    ['Workflow', '/workflow', ['workflows']],
    ['WordPress', '/wordpress', ['wordpress']],
    ['Databases', '/databases', ['databases']],
    ['Docker', '/docker', ['docker']],
    ['Files', '/files', ['files']],
    ['Git', '/git', ['git']],
    ['Backups', '/backups', ['backups']],
    ['Monitoring', '/monitoring', ['monitoring', 'metrics', 'logs']],
    ['Cron', '/cron', ['cron']],
    ['Security', '/security', ['security', 'firewall']],
    ['Email', '/email', ['email']],
    ['Terminal', '/terminal', ['(socket)']],
    ['Settings', '/settings', ['auth', 'admin', 'api-keys', 'sso']],
];

function buildRoutesGraph() {
    const nodes = [];
    const edges = [];
    nodes.push(mk('sidebar', 'Sidebar Nav', 0, 360, 'frontend', 'frontend/src/components/Sidebar.jsx'));
    nodes.push(mk('apisvc', 'ApiService', 740, 360, 'frontend', 'frontend/src/services/api.js'));

    const apiSet = new Map();
    ROUTE_MAP.forEach(([label, route, apis], i) => {
        const y = i * 60;
        const pid = `p-${route}`;
        nodes.push(mk(pid, label, 320, y, 'frontend', route));
        edges.push(edge(`s-${pid}`, 'sidebar', pid));
        edges.push(edge(`pa-${pid}`, pid, 'apisvc'));
        apis.forEach(api => {
            const key = api;
            if (!apiSet.has(key)) {
                apiSet.set(key, { y: apiSet.size * 38 });
            }
        });
    });

    let i = 0;
    apiSet.forEach((_, key) => {
        const aid = `a-${key}`;
        nodes.push(mk(aid, key === '(socket)' ? 'Socket.IO' : `/api/v1/${key}`, 1100, i * 38, 'backend'));
        ROUTE_MAP.forEach(([, route, apis]) => {
            if (apis.includes(key)) {
                edges.push(edge(`api-${route}-${key}`, 'apisvc', aid));
            }
        });
        i++;
    });

    // Dedupe ApiService→endpoint edges
    const seen = new Set();
    const filtered = edges.filter(e => {
        const k = `${e.source}->${e.target}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return { nodes, edges: filtered };
}

// ─── 3. Runtime topology view ───────────────────────────────────────────────
function buildTopologyGraph() {
    const nodes = [
        mk('user', 'Operator', 0, 200, 'client', 'Browser / Mobile'),
        mk('panel', 'ServerKit Panel', 240, 200, 'backend', 'Flask + Socket.IO'),
        mk('paneldb', 'Panel DB', 240, 320, 'data', 'SQLite / Postgres'),
        mk('gateway', 'Agent Gateway', 480, 200, 'agent', 'mTLS / WebSocket'),

        mk('srv1', 'Server: prod-web-01', 760, 40, 'infra', 'Linux VPS'),
        mk('srv2', 'Server: db-01', 760, 200, 'infra', 'Linux VPS'),
        mk('srv3', 'Server: edge-cloud', 760, 360, 'infra', 'Cloud-provisioned'),

        mk('ag1', 'serverkit-agent', 1020, 40, 'agent'),
        mk('ag2', 'serverkit-agent', 1020, 200, 'agent'),
        mk('ag3', 'serverkit-agent', 1020, 360, 'agent'),

        mk('app1', 'Nginx + PHP-FPM', 1280, -20, 'service', 'WordPress site'),
        mk('app2', 'Docker containers', 1280, 60, 'service', 'app:8001-8999'),
        mk('app3', 'PostgreSQL', 1280, 180, 'data'),
        mk('app4', 'Redis', 1280, 240, 'data'),
        mk('app5', 'Custom workload', 1280, 360, 'service'),

        mk('cloud', 'Cloud Providers', 480, 360, 'infra', 'Hetzner / DO / AWS'),
    ];
    const edges = [
        edge('t1', 'user', 'panel', 'HTTPS', true),
        edge('t2', 'panel', 'paneldb'),
        edge('t3', 'panel', 'gateway'),
        edge('t4', 'gateway', 'srv1', 'mTLS', true),
        edge('t5', 'gateway', 'srv2', 'mTLS', true),
        edge('t6', 'gateway', 'srv3', 'mTLS', true),
        edge('t7', 'srv1', 'ag1'),
        edge('t8', 'srv2', 'ag2'),
        edge('t9', 'srv3', 'ag3'),
        edge('t10', 'ag1', 'app1'),
        edge('t11', 'ag1', 'app2'),
        edge('t12', 'ag2', 'app3'),
        edge('t13', 'ag2', 'app4'),
        edge('t14', 'ag3', 'app5'),
        edge('t15', 'panel', 'cloud', 'provision API'),
        edge('t16', 'cloud', 'srv3', 'spawns'),
    ];
    return { nodes, edges };
}

const GRAPHS = {
    stack: buildStackGraph,
    routes: buildRoutesGraph,
    topology: buildTopologyGraph,
};

const LEGEND = [
    ['Client / Browser', 'client'],
    ['Frontend (React)', 'frontend'],
    ['Backend (Flask)', 'backend'],
    ['Service layer', 'service'],
    ['Data / Models', 'data'],
    ['Infrastructure', 'infra'],
    ['Agents', 'agent'],
];

function Diagram({ viewId }) {
    const { nodes, edges } = useMemo(() => GRAPHS[viewId](), [viewId]);
    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.2}
            maxZoom={1.5}
        >
            <Background gap={18} size={1} color="var(--border-subtle)" />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
        </ReactFlow>
    );
}

export default function AppMap() {
    const { t } = useTranslation();
    const [activeView, setActiveView] = useTabParam('/app-map', VIEWS.map(v => v.id), 'stack');
    const [showLegend, setShowLegend] = useState(true);
    const view = VIEWS.find(v => v.id === activeView) || VIEWS[0];

    return (
        <PageLayout className="app-map" icon={<MapIcon size={18} />} title={t('app.appMap.appMap', 'App Map')}>
            <Tabs value={activeView} onValueChange={setActiveView}>
                <TabsList>
                    {VIEWS.map(v => (
                        <TabsTrigger key={v.id} value={v.id}>
                            <v.icon size={14} />
                            {v.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <div className="app-map__viewmeta">
                <Info size={14} />
                <span>{view.description}</span>
                <SharedButton variant="unstyled"
                    type="button"
                    className="app-map__legend-toggle"
                    onClick={() => setShowLegend(s => !s)}
                >
                    {showLegend ? 'Hide legend' : 'Show legend'}
                </SharedButton>
            </div>

            {showLegend && (
                <div className="app-map__legend">
                    {LEGEND.map(([label, kind]) => (
                        <span key={kind} className="app-map__legend-item">
                            <span className="app-map__legend-swatch" style={{
                                background: STYLES[kind].background,
                                borderColor: STYLES[kind].borderColor,
                            }} />
                            {label}
                        </span>
                    ))}
                </div>
            )}

            <div className="app-map__canvas">
                <ReactFlowProvider>
                    <Diagram viewId={activeView} />
                </ReactFlowProvider>
            </div>
        </PageLayout>
    );
}
