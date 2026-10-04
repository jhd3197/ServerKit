import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    PanelLeftClose, PanelLeftOpen, X, RefreshCw, Plus, Terminal,
    Archive, Database, Table2, Server, ChevronDown,
    Trash2, DatabaseBackup, Copy, FileCode2, Lock, BookMarked, Activity,
    SlidersHorizontal, Layers, ExternalLink, Download, Gauge,
} from 'lucide-react';
import api from '../services/api';
import Modal from '@/components/Modal';
import { SearchField } from '@/components/ds';
import ManagedDatabasesPanel from '../components/databases/ManagedDatabasesPanel';
import { formatBytes } from '@/utils/formatBytes';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import EmptyState from '../components/EmptyState';
import SourceTree from '../components/databases/SourceTree';
import ConsoleTab from '../components/databases/ConsoleTab';
import TableDataTab from '../components/databases/TableDataTab';
import BackupsTab from '../components/databases/BackupsTab';
import ProcessListPanel from '../components/databases/ProcessListPanel';
import InsightsPanel from '../components/databases/InsightsPanel';
import ConfigTunerPanel from '../components/databases/ConfigTunerPanel';
import {
    CreateDatabaseModal, CreateMySQLUserModal, CreatePostgreSQLUserModal,
} from '../components/databases/modals';
import CreateTableModal from '../components/databases/CreateTableModal';
import ImportDumpModal from '../components/databases/ImportDumpModal';
import EngineCatalogDrawer from '../components/databases/EngineCatalogDrawer';
import EngineInstallDrawer from '../components/databases/EngineInstallDrawer';
import {
    EngineInstallingPanel, EngineReadyPanel, DatabaseEmptyPanel,
} from '../components/databases/DbBlankStates';
import {
    engineBrandKey, engineInstanceKey, engineTreeStatus, engineUnit, singular,
} from '../components/databases/engineHelpers';
import { listTables, connKey, connLabel, quoteIdent, ENGINE_META } from '../components/databases/dbAdapter';
import { useClipboard } from '@/hooks/useClipboard';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton, Button } from '@/components/ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import PageLayout from '@/layouts/PageLayout';

// Cadence while an engine install is in flight.
const ENGINE_POLL_MS = 4000;


const SIDEBAR_KEY = 'serverkit-dbx-sidebar';

function engineState(engine, status) {
    if (engine !== 'mysql' && engine !== 'postgresql') return 'available';
    const s = status?.[engine];
    if (!s) return 'available';
    if (!s.installed) return 'missing';
    return s.running ? 'active' : 'inactive';
}

// ─── node builders ───────────────────────────────────────────
function dbNode(engine, conn, label, size, idOverride) {
    return {
        id: idOverride || `${engine}:db:${label}`,
        kind: 'database', engine, label, expandable: true, conn,
        sizeText: size ? formatBytes(size) : null,
    };
}

// A database living inside a Docker container, surfaced under its engine node
// (e.g. a WordPress stack's MySQL appears under "MySQL / MariaDB"). Tagged with
// source/appName so the tree can show a Docker badge.
function dockerDbNode(engine, db, i) {
    return {
        id: `${engine}:docker:${db.container}:${db.database || 'default'}:${i}`,
        kind: 'database', engine, label: db.database || 'default', expandable: true,
        conn: {
            dbType: 'docker', container: db.container, name: db.database,
            password: db.password || db.root_password, user: db.user, dockerType: db.type,
        },
        source: 'docker', appName: db.app_name,
    };
}

function TabIcon({ tab }) {
    if (tab.kind === 'backups') return <Archive size={13} aria-hidden="true" />;
    if (tab.kind === 'processes') return <Activity size={13} aria-hidden="true" />;
    if (tab.kind === 'insights') return <Gauge size={13} aria-hidden="true" />;
    if (tab.kind === 'console') return <Terminal size={13} aria-hidden="true" />;
    return <Table2 size={13} aria-hidden="true" />;
}

export default function Databases() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const { copy } = useClipboard({
        successMessage: t('app.databases.copiedName', 'Copied name'),
        errorMessage: t('app.databases.couldNotCopy', 'Could not copy'),
    });
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [status, setStatus] = useState(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);

    const [expanded, setExpanded] = useState(new Set());
    const [childrenCache, setChildrenCache] = useState(new Map());
    const [loadingNodes, setLoadingNodes] = useState(new Set());
    const [selectedNode, setSelectedNode] = useState(null);

    const [tabs, setTabs] = useState([]);
    const [activeTabId, setActiveTabId] = useState(null);
    const [tabStatuses, setTabStatuses] = useState({});

    const [sidebarVisible, setSidebarVisible] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== 'false');
    const [filter, setFilter] = useState('');
    const [ctxMenu, setCtxMenu] = useState(null);
    const [showManaged, setShowManaged] = useState(false);
    const [tunerTarget, setTunerTarget] = useState(null);
    const [modal, setModal] = useState(null); // { type, databases }
    // Engine catalog + the engines installed from it. `unavailable` is the
    // fail-soft state: the four built-in roots keep working without it.
    const [engineData, setEngineData] = useState({ catalog: [], installed: [], unavailable: false });
    const [enginesLoading, setEnginesLoading] = useState(true);
    const [catalogOpen, setCatalogOpen] = useState(false);
    // Seeds the catalog's search box, so "Install" on a specific tree row opens
    // the catalog already narrowed to the engines that could fill that row.
    const [catalogQuery, setCatalogQuery] = useState('');
    const [installEntry, setInstallEntry] = useState(null);
    // What the workspace shows when there is no tab to show: an engine that is
    // still installing, an engine that is up but empty, an empty database.
    const [blank, setBlank] = useState(null);
    const didAutoExpand = useRef(false);
    const didDeepLink = useRef(false);

    useEffect(() => { localStorage.setItem(SIDEBAR_KEY, String(sidebarVisible)); }, [sidebarVisible]);

    useEffect(() => {
        (async () => {
            try {
                const data = await api.getDatabaseStatus();
                setStatus(data);
            } catch (err) {
                console.error('Failed to get database status:', err);
            } finally {
                setStatusLoading(false);
            }
            try {
                // GET /auth/me answers {user: {...}} — reading `.role` off the
                // envelope was always undefined, so every admin was treated as
                // read-only and never saw the console's write mode.
                const me = await api.getCurrentUser();
                setIsAdmin((me?.user?.role ?? me?.role) === 'admin');
            } catch { /* non-admin / not logged in handled by route guard */ }
        })();
    }, []);

    // The engine catalog is optional: an older backend simply doesn't serve it,
    // and the explorer has to keep working on its four built-in roots.
    const loadEngines = useCallback(async () => {
        try {
            const d = await api.getDatabaseEngines();
            setEngineData({
                catalog: d.catalog || [],
                installed: d.installed || [],
                // The backend derives the family list from the catalog it just
                // built; deriving it again here would be a second source.
                families: d.families || null,
                unavailable: false,
            });
        } catch {
            setEngineData({ catalog: [], installed: [], families: null, unavailable: true });
        } finally {
            setEnginesLoading(false);
        }
    }, []);

    useEffect(() => { loadEngines(); }, [loadEngines]);

    // Poll only while a deploy is in flight, so an `installing` row flips to
    // `running` on its own instead of waiting for a manual refresh.
    const installingCount = engineData.installed.filter(
        (e) => engineTreeStatus(e) === 'installing',
    ).length;
    usePolling(loadEngines, ENGINE_POLL_MS, {
        enabled: installingCount > 0,
        immediate: false,
    });

    const openCatalog = useCallback((query = '') => {
        setCatalogQuery(query);
        setCatalogOpen(true);
    }, []);

    // The install flow for one specific tree row. A single candidate goes
    // straight to its configure drawer; several (MySQL and MariaDB both speak
    // `mysql`) go to the catalog narrowed to exactly those.
    const startInstall = useCallback((node) => {
        const offers = node?.installers || [];
        if (offers.length === 1) {
            setInstallEntry(offers[0]);
            return;
        }
        openCatalog(offers.length ? node.engine || '' : '');
    }, [openCatalog]);

    // Which catalog templates could stand in for a host engine that isn't
    // installed, keyed by the engine's own wire protocol. Nothing is named here:
    // a new MySQL-compatible template joins the `mysql` list by declaring
    // `engine.protocol: mysql`, exactly like MariaDB does.
    const installersByProtocol = useMemo(() => {
        const map = new Map();
        engineData.catalog.forEach((entry) => {
            const key = entry.engine?.protocol || entry.id;
            if (!key) return;
            map.set(key, [...(map.get(key) || []), entry]);
        });
        return map;
    }, [engineData.catalog]);

    const roots = useMemo(() => {
        // mysql/postgresql stay expandable even when the host engine is absent —
        // they can still contain databases that live in Docker containers. And
        // "not installed" is a to-do, not a verdict: the row carries whatever
        // the catalog can do about it.
        const hostRoot = (engine) => {
            const state = engineState(engine, status);
            const node = {
                id: `eng:${engine}`,
                kind: 'engine',
                engine,
                label: ENGINE_META[engine].label,
                status: state,
                expandable: true,
                canCreate: state === 'active',
            };
            if (state !== 'missing') return node;
            const offers = installersByProtocol.get(engine) || [];
            if (offers.length) node.installers = offers;
            else if (!enginesLoading) {
                // No offer is still an answer — say which kind of nothing it is.
                node.installHint = engineData.unavailable
                    ? 'catalog unavailable'
                    : 'no engine template';
            }
            return node;
        };

        return [
            hostRoot('mysql'),
            hostRoot('postgresql'),
            { id: 'eng:sqlite', kind: 'engine', engine: 'sqlite', label: ENGINE_META.sqlite.label, status: 'available', expandable: true },
            { id: 'eng:docker', kind: 'engine', engine: 'docker', label: ENGINE_META.docker.label, status: 'available', expandable: true },
            // Engines installed from the template catalog join the built-in roots
            // rather than replacing them. They are leaves: each runs as its own
            // service, and selecting one shows its state in the workspace.
            ...engineData.installed.map((inst) => ({
                id: `dbe:${engineInstanceKey(inst)}`,
                kind: 'engine',
                engine: engineBrandKey(inst) || 'database',
                iconEntry: inst,
                label: inst.name || inst.instance_name || inst.template_id,
                status: engineTreeStatus(inst),
                // The template's version is the engine's version — the only
                // version any endpoint here reports. Host engines have none.
                version: inst.template_version || null,
                expandable: false,
                instance: inst,
            })),
        ];
    }, [status, engineData.installed, engineData.unavailable, enginesLoading, installersByProtocol]);

    // ─── lazy child loading ───────────────────────────────────
    const loadChildren = useCallback(async (node) => {
        if (node.kind === 'engine') {
            if (node.engine === 'mysql') {
                const [host, docker] = await Promise.all([
                    api.getMySQLDatabases().catch(() => ({ databases: [] })),
                    api.getAllDockerDatabases().catch(() => ({ databases: [] })),
                ]);
                const hostNodes = (host.databases || []).map((db) => dbNode('mysql', { dbType: 'mysql', name: db.name }, db.name, db.size));
                const dockerNodes = (docker.databases || []).filter((db) => db.type === 'mysql').map((db, i) => dockerDbNode('mysql', db, i));
                return [...hostNodes, ...dockerNodes];
            }
            if (node.engine === 'postgresql') {
                const [host, docker] = await Promise.all([
                    api.getPostgreSQLDatabases().catch(() => ({ databases: [] })),
                    api.getAllDockerDatabases().catch(() => ({ databases: [] })),
                ]);
                const hostNodes = (host.databases || []).map((db) => dbNode('postgresql', { dbType: 'postgresql', name: db.name }, db.name, db.size));
                const dockerNodes = (docker.databases || []).filter((db) => db.type === 'postgresql').map((db, i) => dockerDbNode('postgresql', db, i));
                return [...hostNodes, ...dockerNodes];
            }
            if (node.engine === 'sqlite') {
                const d = await api.getSQLiteDatabases();
                return (d.databases || []).map((db) => dbNode('sqlite', { dbType: 'sqlite', name: db.name, path: db.path }, db.name, db.size, `sqlite:db:${db.path}`));
            }
            if (node.engine === 'docker') {
                const d = await api.getApps();
                return (d.apps || []).filter((a) => a.app_type === 'docker').map((app) => ({
                    id: `app:${app.id}`, kind: 'app', engine: 'docker', label: app.name, expandable: true, appId: app.id,
                }));
            }
        }
        if (node.kind === 'app') {
            // An app with nothing to introspect answers 400 ("not a Docker app",
            // no compose to read). That is a fact about the app, not a failure to
            // read it — the row must say "No databases", not turn red. Anything
            // else (auth, network, a broken route) really is a failure.
            let d;
            try {
                d = await api.getAppDatabases(node.appId);
            } catch (err) {
                if (err.status === 400) return [];
                throw err;
            }
            return (d.databases || []).map((db, i) => ({
                // engine = the brand (mysql/postgresql) so the row shows the right
                // brand icon/tint; the connection is still routed over docker exec.
                id: `app:${node.appId}:db:${i}`, kind: 'database', engine: db.type || 'docker',
                label: db.database || 'default', expandable: true,
                conn: { dbType: 'docker', container: db.container, name: db.database, password: db.password || db.root_password, user: db.user, dockerType: db.type },
            }));
        }
        if (node.kind === 'database') {
            const d = await listTables(node.conn);
            // A docker database reports `connected: false` when the container
            // exec/auth fails — surface that as an error row instead of letting
            // it masquerade as an empty database.
            if (d && d.connected === false) {
                const e = new Error(d.error || 'connection failed');
                e.userMessage = d.error
                    ? `Couldn't connect: ${d.error}`
                    : `Couldn't connect to ${connLabel(node.conn)}. Is the container running?`;
                throw e;
            }
            return (d.tables || []).map((t) => ({
                id: `${node.id}:t:${t.name}`, kind: 'table', engine: node.engine, label: t.name,
                expandable: false, conn: node.conn, table: t.name,
                rows: typeof t.rows === 'number' ? t.rows : null,
            }));
        }
        return [];
    }, []);

    const fetchChildren = useCallback(async (node) => {
        setLoadingNodes((s) => new Set(s).add(node.id));
        try {
            const kids = await loadChildren(node);
            setChildrenCache((c) => new Map(c).set(node.id, kids));
        } catch (err) {
            console.error('Failed to load tree node:', err);
            setChildrenCache((c) => new Map(c).set(node.id, { __error: err.userMessage || "Couldn't load. Right-click to retry." }));
        } finally {
            setLoadingNodes((s) => { const n = new Set(s); n.delete(node.id); return n; });
        }
    }, [loadChildren]);

    const toggle = useCallback((node) => {
        const willOpen = !expanded.has(node.id);
        setExpanded((prev) => { const n = new Set(prev); if (willOpen) n.add(node.id); else n.delete(node.id); return n; });
        if (willOpen && !childrenCache.has(node.id)) fetchChildren(node);
    }, [expanded, childrenCache, fetchChildren]);

    const refresh = useCallback((node) => {
        setChildrenCache((c) => { const n = new Map(c); n.delete(node.id); return n; });
        if (expanded.has(node.id)) fetchChildren(node);
    }, [expanded, fetchChildren]);

    // Auto-expand the first running engine so the tree isn't empty on arrival.
    useEffect(() => {
        if (statusLoading || didAutoExpand.current) return;
        const first = roots.find((r) => r.status === 'active');
        if (first) {
            didAutoExpand.current = true;
            setExpanded((prev) => new Set(prev).add(first.id));
            fetchChildren(first);
        }
    }, [statusLoading, roots, fetchChildren]);

    // Deep link from the deploy console: `/databases?engine=<app_id>` selects
    // the engine that run just installed, so finishing an install lands on the
    // thing it created rather than the generic welcome pane. Runs once and then
    // drops the parameter, so a reload or a later click on the tree isn't
    // dragged back. Fail soft — an id that resolves to nothing is just ignored.
    useEffect(() => {
        if (didDeepLink.current || enginesLoading) return;
        const raw = searchParams.get('engine');
        if (!raw) return;
        didDeepLink.current = true;

        const wanted = Number(raw);
        const node = Number.isFinite(wanted)
            ? roots.find((r) => r.instance && engineInstanceKey(r.instance) === wanted)
            : null;
        if (node) {
            // Don't let the "expand the first running engine" convenience fight
            // an explicit destination.
            didAutoExpand.current = true;
            setSelectedNode(node);
            setBlank({ kind: 'engine', instanceId: wanted });
            setActiveTabId(null);
        }

        const next = new URLSearchParams(searchParams);
        next.delete('engine');
        setSearchParams(next, { replace: true });
    }, [enginesLoading, roots, searchParams, setSearchParams]);

    // ─── tabs ─────────────────────────────────────────────────
    const reportStatus = useCallback((tabId, s) => {
        setTabStatuses((prev) => ({ ...prev, [tabId]: s }));
    }, []);

    // Opening any tab takes the workspace out of a blank state — the blank pane
    // and the tab panes are alternatives, not neighbours.
    function showTab(id) {
        setBlank(null);
        setActiveTabId(id);
    }

    function openTableTab(node) {
        const id = `tbl:${connKey(node.conn)}:${node.table}`;
        setTabs((prev) => prev.some((t) => t.id === id) ? prev
            : [...prev, { id, kind: 'table', title: node.table, conn: node.conn, table: node.table, rows: node.rows, engine: node.engine }]);
        showTab(id);
    }

    function openConsole(conn, engine, initialQuery = '') {
        const id = `con:${connKey(conn)}`;
        setTabs((prev) => prev.some((t) => t.id === id) ? prev
            : [...prev, { id, kind: 'console', title: `${connLabel(conn)}`, conn, engine, initialQuery }]);
        showTab(id);
    }

    function openProcesses(conn, engine) {
        // One processes tab per server/container — a database's conn routes to
        // its host server, so key on engine + container rather than connKey.
        const id = `proc:${engine}:${conn.container || 'host'}`;
        const title = conn.container ? `Processes · ${conn.container}` : `Processes · ${ENGINE_META[engine]?.short || engine}`;
        setTabs((prev) => prev.some((t) => t.id === id) ? prev
            : [...prev, { id, kind: 'processes', title, conn, engine }]);
        showTab(id);
    }

    function openInsights(conn, engine) {
        // One insights tab per container, like processes.
        const id = `insights:${engine}:${conn.container}`;
        setTabs((prev) => prev.some((t) => t.id === id) ? prev
            : [...prev, { id, kind: 'insights', title: `Insights · ${conn.container}`, conn, engine }]);
        showTab(id);
    }

    function openBackups() {
        setTabs((prev) => prev.some((t) => t.id === 'backups') ? prev : [...prev, { id: 'backups', kind: 'backups', titleKey: 'common.labels.backups', title: 'Backups' }]);
        showTab('backups');
    }

    function closeTab(id, e) {
        e?.stopPropagation();
        setTabs((prev) => {
            const idx = prev.findIndex((t) => t.id === id);
            const next = prev.filter((t) => t.id !== id);
            setActiveTabId((cur) => {
                if (cur !== id) return cur;
                const fallback = next[idx] || next[idx - 1];
                return fallback ? fallback.id : null;
            });
            return next;
        });
        setTabStatuses((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }

    function activate(node) {
        setSelectedNode(node);
        if (node.kind === 'table') { openTableTab(node); return; }

        // An engine installed from the catalog is a leaf: there is nothing to
        // expand, so selecting it shows what that engine is doing.
        if (node.kind === 'engine' && node.instance) {
            setBlank({ kind: 'engine', instanceId: engineInstanceKey(node.instance) });
            setActiveTabId(null);
            return;
        }

        const kids = childrenCache.get(node.id);
        const knownEmpty = Array.isArray(kids) && kids.length === 0;

        if (node.kind === 'database') {
            // Once we know a database holds nothing, say so instead of opening a
            // console onto an empty schema. Until then, single click opens the
            // console and expands its tables; collapsing stays on the chevron so
            // re-clicks don't fold the tree.
            if (knownEmpty) {
                setBlank({ kind: 'database', node });
                setActiveTabId(null);
                return;
            }
            openConsole(node.conn, node.engine);
            if (node.expandable && !expanded.has(node.id)) toggle(node);
            return;
        }

        if (node.kind === 'engine' && knownEmpty && node.status === 'active') {
            setBlank({ kind: 'host-engine', node });
            setActiveTabId(null);
            return;
        }

        if (node.expandable) toggle(node);
    }

    // ─── tree context menu ────────────────────────────────────
    function openContext(e, node) {
        e.preventDefault();
        e.stopPropagation();
        setSelectedNode(node);
        const menuW = 220;
        const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
        setCtxMenu({ x, y: e.clientY, node });
    }

    useEffect(() => {
        if (!ctxMenu) return;
        const close = () => setCtxMenu(null);
        const onEsc = (e) => { if (e.key === 'Escape') setCtxMenu(null); };
        document.addEventListener('click', close);
        document.addEventListener('keydown', onEsc);
        return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onEsc); };
    }, [ctxMenu]);

    async function backupDatabase(node) {
        try {
            const res = node.engine === 'mysql' ? await api.backupMySQLDatabase(node.label) : await api.backupPostgreSQLDatabase(node.label);
            if (res.success) toast.success(t('app.databases.backupCreated', 'Backup created: {{backuppath}}', { backuppath: res.backup_path }));
        } catch {
            toast.error(t('app.databases.failedToCreateBackup', 'Failed to create backup'));
        }
    }

    async function dropDatabase(node) {
        const ok = await confirm({
            title: t('app.databases.dropDatabase', 'Drop database'),
            message: t('app.databases.dropDatabaseThisPermanentlyDeletesThe', 'Drop database "{{label}}"? This permanently deletes the database and all its data.', { label: node.label }),
            confirmText: t('app.databases.drop', 'Drop {{label}}', { label: node.label }),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            if (node.engine === 'mysql') await api.dropMySQLDatabase(node.label);
            else await api.dropPostgreSQLDatabase(node.label);
            toast.success(t('app.databases.droppedDatabase', 'Dropped database "{{label}}"', { label: node.label }));
            const eng = roots.find((r) => r.engine === node.engine);
            if (eng) refresh(eng);
            setTabs((prev) => prev.filter((t) => !(t.conn && connKey(t.conn) === connKey(node.conn))));
        } catch {
            toast.error(t('app.databases.failedToDropDatabase', 'Failed to drop database'));
        }
    }

    // A table builder or a dump import changes what a database holds, but the
    // node it happened to is not always the one that is selected — resolve it
    // from the connection so the tree reloads the right branch.
    const refreshConn = useCallback((conn) => {
        if (!conn) return;
        const key = connKey(conn);
        childrenCache.forEach((kids) => {
            if (!Array.isArray(kids)) return;
            kids.forEach((n) => {
                if (n.kind === 'database' && n.conn && connKey(n.conn) === key) refresh(n);
            });
        });
    }, [childrenCache, refresh]);

    // What a database node hands to the builder / importer so they open on the
    // thing that was right-clicked instead of on the first database they find.
    function dbPreset(node) {
        if (node?.kind !== 'database' || !node.conn) return null;
        return { conn: node.conn, engine: node.engine, label: node.label };
    }

    function copyName(node) {
        copy(node.label);
    }

    function ctxActions(node) {
        switch (node.kind) {
            case 'engine':
                // An engine installed from a template is an app: its lifecycle
                // lives on the service page rather than being duplicated here.
                if (node.instance) {
                    const appId = engineInstanceKey(node.instance);
                    return [
                        { labelKey: 'app.databases.openService', label: 'Open service', icon: ExternalLink, onClick: () => navigate(`/services/${appId}`) },
                        { labelKey: 'app.databases.deployActivity', label: 'Deploy activity', icon: Activity, onClick: () => navigate('/deployments') },
                        { labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => loadEngines() },
                    ];
                }
                if (node.engine === 'mysql' && node.status === 'active') {
                    return [
                        { labelKey: 'app.databases.createDatabase', label: 'Create database', icon: Plus, onClick: () => setModal({ type: 'mysql-db' }) },
                        { labelKey: 'app.databases.createUser', label: 'Create user', icon: Plus, onClick: () => openUserModal('mysql') },
                        { labelKey: 'app.databases.processes', label: 'Processes', icon: Activity, onClick: () => openProcesses({ dbType: 'mysql' }, 'mysql') },
                        { labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => refresh(node) },
                    ];
                }
                if (node.engine === 'postgresql' && node.status === 'active') {
                    return [
                        { labelKey: 'app.databases.createDatabase', label: 'Create database', icon: Plus, onClick: () => setModal({ type: 'pg-db' }) },
                        { labelKey: 'app.databases.createUser', label: 'Create user', icon: Plus, onClick: () => openUserModal('postgresql') },
                        { labelKey: 'app.databases.processes', label: 'Processes', icon: Activity, onClick: () => openProcesses({ dbType: 'postgresql' }, 'postgresql') },
                        { labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => refresh(node) },
                    ];
                }
                if (node.installers?.length) {
                    return [
                        { label: `Install ${node.label}…`, icon: Download, onClick: () => startInstall(node) },
                        { labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => refresh(node) },
                    ];
                }
                return [{ labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => refresh(node) }];
            case 'database': {
                const actions = [
                    { label: `New ${singular(engineUnit(node))}`, icon: Plus, onClick: () => setModal({ type: 'new-table', preset: dbPreset(node) }) },
                    { labelKey: 'app.databases.openSqlConsole', label: 'Open SQL console', icon: Terminal, onClick: () => openConsole(node.conn, node.engine) },
                    { labelKey: 'app.databases.refreshTables', label: 'Refresh tables', icon: RefreshCw, onClick: () => refresh(node) },
                ];
                // Only host MySQL / PostgreSQL have a restore route; a SQLite
                // file or a containerised database has nothing to import into.
                if (node.conn?.dbType === 'mysql' || node.conn?.dbType === 'postgresql') {
                    actions.splice(2, 0, { labelKey: 'app.databases.importSqlDump', label: 'Import SQL dump…', icon: Download, onClick: () => setModal({ type: 'import', preset: dbPreset(node) }) });
                }
                if (node.engine === 'mysql' || node.engine === 'postgresql') {
                    // Processes live at the server/container level; the db node
                    // is just the natural place to reach them from.
                    actions.splice(1, 0, { labelKey: 'app.databases.serverProcesses', label: 'Server processes', icon: Activity, onClick: () => openProcesses(node.conn, node.engine) });
                    if (node.conn?.dbType === 'docker' && node.conn.container) {
                        // Curated config tuner is container-scoped (docker-only).
                        actions.splice(2, 0, { labelKey: 'app.databases.configTuner', label: 'Config tuner', icon: SlidersHorizontal, onClick: () => setTunerTarget({ container: node.conn.container, engine: node.engine, password: node.conn.password }) });
                        // Top queries + hit ratio (plan 86 §A3), docker-only too.
                        actions.splice(2, 0, { labelKey: 'app.databases.insights', label: 'Insights', icon: Gauge, onClick: () => openInsights(node.conn, node.engine) });
                    }
                    actions.splice(2, 0, { labelKey: 'app.databases.backUpDatabase', label: 'Back up database', icon: DatabaseBackup, onClick: () => backupDatabase(node) });
                    actions.push({ labelKey: 'app.databases.dropDatabase', label: 'Drop database', icon: Trash2, danger: true, onClick: () => dropDatabase(node) });
                }
                return actions;
            }
            case 'app':
                return [{ labelKey: 'common.actions.refresh', label: 'Refresh', icon: RefreshCw, onClick: () => refresh(node) }];
            case 'table':
                return [
                    { labelKey: 'app.databases.openData', label: 'Open data', icon: Table2, onClick: () => openTableTab(node) },
                    { labelKey: 'app.databases.queryInConsole', label: 'Query in console', icon: FileCode2, onClick: () => openConsole(node.conn, node.engine, `SELECT * FROM ${quoteIdent(node.conn, node.table)} LIMIT 100;`) },
                    { labelKey: 'app.databases.copyName', label: 'Copy name', icon: Copy, onClick: () => copyName(node) },
                ];
            default:
                return [];
        }
    }

    async function openUserModal(engine) {
        try {
            const d = engine === 'mysql' ? await api.getMySQLDatabases() : await api.getPostgreSQLDatabases();
            setModal({ type: engine === 'mysql' ? 'mysql-user' : 'pg-user', databases: d.databases || [] });
        } catch {
            setModal({ type: engine === 'mysql' ? 'mysql-user' : 'pg-user', databases: [] });
        }
    }

    function onModalCreated() {
        // Refresh the affected engine's tree so new databases/users appear.
        const engine = modal?.type?.startsWith('mysql') ? 'mysql' : 'postgresql';
        const eng = roots.find((r) => r.engine === engine);
        if (eng) refresh(eng);
    }

    // A freshly installed engine goes straight into the tree and the workspace,
    // so the install has somewhere to land instead of leaving the drawer and
    // nothing to show for it. The install pipeline doesn't always hand back the
    // app row — when it doesn't, the refresh alone is enough.
    function onEngineInstalled(app) {
        loadEngines();
        const appId = app?.app_id ?? app?.id;
        if (typeof appId === 'number') {
            setBlank({ kind: 'engine', instanceId: appId });
            setActiveTabId(null);
        }
    }

    const newConsoleConn = selectedNode?.conn || null;
    const activeStatus = tabStatuses[activeTabId];

    // Blank-state subjects are re-resolved from the latest poll, so an
    // `installing` panel becomes a `ready` panel without any extra wiring.
    const blankInstance = useMemo(() => {
        if (blank?.kind !== 'engine') return null;
        return engineData.installed.find(
            (e) => engineInstanceKey(e) === blank.instanceId,
        ) || null;
    }, [blank, engineData.installed]);

    const treeHandlers = useMemo(() => ({
        onToggle: toggle,
        onActivate: activate,
        onContext: openContext,
        onInstall: startInstall,
        onCreateChild: (node) => setModal({ type: node.engine === 'mysql' ? 'mysql-db' : 'pg-db' }),
    }), [toggle, startInstall]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <PageLayout
            className="db-explorer"
            fill
            icon={<Database size={18} />}
            title={t('common.labels.databases', 'Databases')}
            actions={(
                <>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSidebarVisible((v) => !v)}
                        aria-label={sidebarVisible ? t('app.databases.hideSources', 'Hide sources') : t('app.databases.showSources', 'Show sources')}
                        title={sidebarVisible ? t('app.databases.hideSources', 'Hide sources') : t('app.databases.showSources', 'Show sources')}
                    >
                        {sidebarVisible ? <PanelLeftClose size={15} aria-hidden="true" /> : <PanelLeftOpen size={15} aria-hidden="true" />}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowManaged(true)}>
                        <BookMarked size={15} aria-hidden="true" /> {t('app.databases.managed', 'Managed')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={openBackups}>
                        <Archive size={15} aria-hidden="true" /> {t('common.labels.backups', 'Backups')}
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="sm">
                                <Plus size={15} aria-hidden="true" /> {t('app.databases.new', 'New')} <ChevronDown size={13} aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!newConsoleConn} onSelect={() => openConsole(newConsoleConn, selectedNode.engine)}>
                                <Terminal size={14} aria-hidden="true" /> {t('app.databases.sqlConsole', 'SQL console')}
                                {!newConsoleConn && <span className="dbx-menu-hint">{t('app.databases.selectADatabase', 'select a database')}</span>}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setModal({ type: 'new-table', preset: dbPreset(selectedNode) })}>
                                <Table2 size={14} aria-hidden="true" /> {t('app.databases.tableOrCollection', 'Table or collection')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setModal({ type: 'import', preset: dbPreset(selectedNode) })}>
                                <Download size={14} aria-hidden="true" /> {t('app.databases.importSqlDump', 'Import SQL dump…')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={engineState('mysql', status) !== 'active'} onSelect={() => setModal({ type: 'mysql-db' })}>
                                <Database size={14} aria-hidden="true" /> {t('app.databases.mysqlDatabase', 'MySQL database')}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={engineState('postgresql', status) !== 'active'} onSelect={() => setModal({ type: 'pg-db' })}>
                                <Database size={14} aria-hidden="true" /> {t('app.databases.postgresqlDatabase', 'PostgreSQL database')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={engineState('mysql', status) !== 'active'} onSelect={() => openUserModal('mysql')}>
                                <Server size={14} aria-hidden="true" /> {t('app.databases.mysqlUser', 'MySQL user')}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={engineState('postgresql', status) !== 'active'} onSelect={() => openUserModal('postgresql')}>
                                <Server size={14} aria-hidden="true" /> {t('app.databases.postgresqlUser', 'PostgreSQL user')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => openCatalog()}>
                                <Layers size={14} aria-hidden="true" /> {t('app.databases.installADatabaseEngine', 'Install a database engine…')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </>
            )}
        >
            {/* ─── Body: tree + workspace ─────────────────── */}
            <div className={`dbx-body ${sidebarVisible ? '' : 'is-collapsed'}`}>
                {sidebarVisible && (
                    <aside className="dbx-tree-panel" aria-label={t('app.databases.databaseSources', 'Database sources')}>
                        <div className="dbx-tree-search">
                            {/* The shared search box, not a hand-rolled input —
                                it debounces and clears itself, which is what the
                                icon + input + X this replaces was reimplementing. */}
                            <SearchField
                                value={filter}
                                onSearch={setFilter}
                                placeholder={t('app.databases.filterTables', 'Filter tables…')}
                            />
                        </div>
                        <div className="dbx-tree-scroll">
                            {statusLoading ? (
                                <div className="dbx-tree-loading"><RefreshCw size={14} className="dbx-spin" aria-hidden="true" /> {t('app.databases.checkingServers', 'Checking servers…')}</div>
                            ) : (
                                <>
                                    <SourceTree
                                        roots={roots}
                                        expanded={expanded}
                                        childrenCache={childrenCache}
                                        loading={loadingNodes}
                                        activeKey={null}
                                        selectedId={selectedNode?.id}
                                        filter={filter}
                                        handlers={treeHandlers}
                                    />
                                    {/* The way to get an engine the tree doesn't
                                        list yet, right where you notice it's
                                        missing. */}
                                    {!engineData.unavailable && (
                                        <SharedButton variant="unstyled"
                                            type="button"
                                            className="dbx-tree-install"
                                            onClick={() => openCatalog()}
                                        >
                                            <Layers size={14} aria-hidden="true" /> {t('app.databases.installADatabaseEngine2', 'Install a database engine')}
                                            {engineData.catalog.length > 0 && (
                                                <span
                                                    className="dbx-tree-install-count"
                                                    title={t('app.databases.enginesInTheCatalog', '{{length}} engines in the catalog', { length: engineData.catalog.length })}
                                                >
                                                    {engineData.catalog.length}
                                                </span>
                                            )}
                                        </SharedButton>
                                    )}
                                </>
                            )}
                        </div>
                    </aside>
                )}

                <main className="dbx-workspace">
                    {tabs.length > 0 && (
                        <div className="dbx-tabbar" role="tablist" aria-label={t('app.databases.openTabs', 'Open tabs')}>
                            {tabs.map((tab) => (
                                <div
                                    key={tab.id}
                                    role="tab"
                                    aria-selected={tab.id === activeTabId}
                                    tabIndex={0}
                                    className={`dbx-tab is-${tab.engine || tab.kind} ${tab.id === activeTabId ? 'is-active' : ''}`}
                                    onClick={() => showTab(tab.id)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTab(tab.id); } }}
                                >
                                    <TabIcon tab={tab} />
                                    <span className="dbx-tab-title">{tab.title}</span>
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        className="dbx-tab-close"
                                        onClick={(e) => closeTab(tab.id, e)}
                                        aria-label={t('app.databases.close', 'Close {{title}}', { title: tab.title })}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </SharedButton>
                                </div>
                            ))}
                            <SharedButton variant="unstyled"
                                type="button"
                                className="dbx-tab dbx-tab-new"
                                disabled={!newConsoleConn}
                                onClick={() => { if (newConsoleConn) openConsole(newConsoleConn, selectedNode.engine); }}
                                title={newConsoleConn ? t('app.databases.newSqlConsole', 'New SQL console') : t('app.databases.selectADatabaseToOpenA', 'Select a database to open a console')}
                                aria-label={t('app.databases.newSqlConsole', 'New SQL console')}
                            >
                                <Plus size={14} aria-hidden="true" />
                            </SharedButton>
                        </div>
                    )}

                    <div className="dbx-panes">
                        {blank ? (
                            <>
                                {blank.kind === 'engine' && blankInstance && (
                                    engineTreeStatus(blankInstance) === 'installing'
                                        || engineTreeStatus(blankInstance) === 'failed'
                                        ? <EngineInstallingPanel instance={blankInstance} onRefresh={loadEngines} />
                                        : <EngineReadyPanel instance={blankInstance} />
                                )}
                                {blank.kind === 'host-engine' && (
                                    <EngineReadyPanel
                                        // `id` is what resolves the brand glyph, and a
                                        // built-in root's id is a tree id, not an engine key.
                                        instance={{ id: blank.node.engine, name: blank.node.label }}
                                        label={blank.node.label}
                                        onNewDatabase={() => setModal({
                                            type: blank.node.engine === 'mysql' ? 'mysql-db' : 'pg-db',
                                        })}
                                    />
                                )}
                                {blank.kind === 'database' && (
                                    <DatabaseEmptyPanel
                                        node={blank.node}
                                        unit={engineUnit(blank.node)}
                                        onNewTable={() => setModal({ type: 'new-table', preset: dbPreset(blank.node) })}
                                        onImport={
                                            blank.node.conn?.dbType === 'mysql' || blank.node.conn?.dbType === 'postgresql'
                                                ? () => setModal({ type: 'import', preset: dbPreset(blank.node) })
                                                : null
                                        }
                                        onOpenConsole={() => openConsole(blank.node.conn, blank.node.engine)}
                                    />
                                )}
                            </>
                        ) : tabs.length === 0 ? (
                            <div className="dbx-welcome">
                                <EmptyState
                                    icon={Database}
                                    title={t('app.databases.openATableOrConsole', 'Open a table or console')}
                                    description={statusLoading
                                        ? t('app.databases.checkingYourDatabaseServers', 'Checking your database servers…')
                                        : t('app.databases.pickATableFromTheLeft', 'Pick a table from the left to browse its rows, or open a SQL console on any database. Right-click a node for more actions.')}
                                />
                            </div>
                        ) : null}

                        {/* Panes stay mounted behind a blank state — a half-typed
                            query must survive a click on the tree. */}
                        {tabs.map((tab) => (
                                <div key={tab.id} className="dbx-tabpane" hidden={Boolean(blank) || tab.id !== activeTabId}>
                                    {tab.kind === 'console' && (
                                        <ConsoleTab
                                            conn={tab.conn}
                                            tabId={tab.id}
                                            active={tab.id === activeTabId}
                                            isAdmin={isAdmin}
                                            initialQuery={tab.initialQuery}
                                            onStatus={reportStatus}
                                        />
                                    )}
                                    {tab.kind === 'table' && (
                                        <TableDataTab
                                            conn={tab.conn}
                                            tabId={tab.id}
                                            table={tab.table}
                                            rowsEstimate={tab.rows}
                                            active={tab.id === activeTabId}
                                            onStatus={reportStatus}
                                            onOpenConsole={(q) => openConsole(tab.conn, tab.engine, q)}
                                        />
                                    )}
                                    {tab.kind === 'processes' && (
                                        <ProcessListPanel
                                            conn={tab.conn}
                                            engine={tab.engine}
                                            active={tab.id === activeTabId}
                                            isAdmin={isAdmin}
                                        />
                                    )}
                                    {tab.kind === 'insights' && (
                                        <InsightsPanel conn={tab.conn} engine={tab.engine} isAdmin={isAdmin} />
                                    )}
                                    {tab.kind === 'backups' && <BackupsTab />}
                                </div>
                        ))}
                    </div>
                </main>
            </div>

            {/* ─── Status bar ─────────────────────────────── */}
            <footer className="dbx-statusbar">
                <div className="dbx-statusbar-left">
                    {activeStatus ? (
                        <>
                            <span className="dbx-status-item"><Database size={12} aria-hidden="true" /> {activeStatus.connText}</span>
                            {activeStatus.readonly != null && (
                                <span className={`dbx-status-item ${activeStatus.readonly ? '' : 'is-write'}`}>
                                    {activeStatus.readonly ? <><Lock size={11} aria-hidden="true" /> {t('app.databases.readOnly', 'Read-only')}</> : 'Writes enabled'}
                                </span>
                            )}
                            <span className="dbx-status-item dbx-status-muted">{t('app.databases.utf8', 'UTF-8')}</span>
                        </>
                    ) : (
                        <span className="dbx-status-item dbx-status-muted">{t('app.databases.noTabOpen', 'No tab open')}</span>
                    )}
                </div>
                <div className="dbx-statusbar-right">
                    {activeStatus?.rangeText && <span className="dbx-status-item">{activeStatus.rangeText}</span>}
                    {activeStatus?.rowCount != null && (
                        <span className="dbx-status-item">{activeStatus.rowCount} row{activeStatus.rowCount === 1 ? '' : 's'}{activeStatus.truncated ? ` of ${activeStatus.totalRows}` : ''}</span>
                    )}
                    {activeStatus?.execTime != null && <span className="dbx-status-item dbx-mono">{activeStatus.execTime}s</span>}
                    {activeStatus && <span className="dbx-status-item is-connected">{t('app.databases.connected', 'Connected')}</span>}
                </div>
            </footer>

            {/* ─── Context menu ───────────────────────────── */}
            {ctxMenu && (
                <div className="dbx-context" style={{ left: ctxMenu.x, top: ctxMenu.y }} role="menu">
                    {ctxActions(ctxMenu.node).map((a) => (
                        <SharedButton variant="unstyled"
                            key={a.label}
                            type="button"
                            role="menuitem"
                            className={a.danger ? 'is-danger' : ''}
                            onClick={() => { a.onClick(); setCtxMenu(null); }}
                        >
                            <a.icon size={14} aria-hidden="true" /> {a.label}
                        </SharedButton>
                    ))}
                </div>
            )}

            {/* ─── Modals ─────────────────────────────────── */}
            {(modal?.type === 'mysql-db' || modal?.type === 'pg-db') && (
                <CreateDatabaseModal
                    engine={modal.type === 'mysql-db' ? 'mysql' : 'postgresql'}
                    status={status}
                    onClose={() => setModal(null)}
                    onCreated={onModalCreated}
                    onInstallEngine={() => openCatalog()}
                />
            )}
            {modal?.type === 'mysql-user' && <CreateMySQLUserModal databases={modal.databases} onClose={() => setModal(null)} onCreated={onModalCreated} />}
            {modal?.type === 'pg-user' && <CreatePostgreSQLUserModal databases={modal.databases} onClose={() => setModal(null)} onCreated={onModalCreated} />}
            {modal?.type === 'new-table' && (
                <CreateTableModal
                    preset={modal.preset}
                    engines={engineData.installed}
                    isAdmin={isAdmin}
                    onClose={() => setModal(null)}
                    onCreated={(target) => refreshConn(target?.conn)}
                />
            )}
            {modal?.type === 'import' && (
                <ImportDumpModal
                    preset={modal.preset}
                    isAdmin={isAdmin}
                    onClose={() => setModal(null)}
                    onImported={(target) => refreshConn({ dbType: target.engine, name: target.name })}
                />
            )}

            {/* ─── Engine catalog + install ───────────────── */}
            <EngineCatalogDrawer
                open={catalogOpen}
                onOpenChange={setCatalogOpen}
                catalog={engineData.catalog}
                installed={engineData.installed}
                families={engineData.families}
                presetQuery={catalogQuery}
                loading={enginesLoading}
                unavailable={engineData.unavailable}
                onSynced={loadEngines}
                onPick={(entry) => { setCatalogOpen(false); setInstallEntry(entry); }}
            />
            <EngineInstallDrawer
                entry={installEntry}
                open={Boolean(installEntry)}
                onOpenChange={(next) => { if (!next) setInstallEntry(null); }}
                onInstalled={onEngineInstalled}
            />

            <Modal open={showManaged} onClose={() => setShowManaged(false)} title={t('app.databases.managedDatabases', 'Managed databases')} size="lg">
                <ManagedDatabasesPanel />
            </Modal>

            <Modal open={!!tunerTarget} onClose={() => setTunerTarget(null)} title={t('app.databases.configTuner', 'Config tuner')} size="lg">
                {tunerTarget && (
                    <ConfigTunerPanel target={tunerTarget.container} engine={tunerTarget.engine} password={tunerTarget.password} />
                )}
            </Modal>

        </PageLayout>
    );
}
