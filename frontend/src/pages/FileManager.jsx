import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/useToast.js';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Modal from '@/components/Modal';
import {
    Folder, FolderOpen, File, Upload, FolderPlus,
    ArrowLeft, ArrowRight, ArrowUp, Search, X, RefreshCw, Eye, EyeOff,
    Download, Edit3, Trash2, ChevronDown, ChevronRight,
    HardDrive, Clock, PanelLeftClose, PanelLeftOpen,
    LayoutGrid, List, Home, CloudUpload,
    Check, Copy, ArrowUpDown, Zap, Globe, Boxes, SlidersHorizontal, FileText,
    FolderTree as FolderTreeIcon, Terminal,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import FolderTree from '../components/file-manager/FolderTree';
import FileCard from '../components/file-manager/FileCard';
import FileRow from '../components/file-manager/FileRow';
import PreviewDrawer from '../components/file-manager/PreviewDrawer';
import ContextMenu from '../components/file-manager/ContextMenu';
import ServerPicker from '../components/ServerPicker';
import { serverTarget, targetServerId } from '../utils/serverTarget';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { TREE_ROOTS, getFileType, formatBytes } from '../components/file-manager/fileTypes';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from 'react-i18next';
import { useTopbarActions } from '@/hooks/useTopbarActions';

// Demo rail shortcuts (Quick access) — one-click jumps to the paths people
// actually visit on a ServerKit host. "Stack" starts at the default install
// location and is re-pointed from /system/version's install_dir, so a custom
// SERVERKIT_DIR install jumps to the real tree.
const QUICK_ACCESS = [
    { labelKey: 'app.fileManager.sites', label: 'Sites', path: '/var/www', icon: Globe },
    { labelKey: 'app.fileManager.stack', label: 'Stack', path: '/opt/serverkit', icon: Boxes },
    { labelKey: 'app.fileManager.webConfig', label: 'Web config', path: '/etc/nginx', icon: SlidersHorizontal },
    { labelKey: 'common.labels.logs', label: 'Logs', path: '/var/log', icon: FileText },
];

// Remote-agent rails: the panel stack doesn't exist on an agent box, so link
// the agent's own footprint instead. These paths are fixed by the agent
// installers the panel serves (scripts/install.sh: /etc/serverkit-agent;
// scripts/install.ps1: ProgramData\ServerKit\Agent) — agents run on the wire
// with forward-slash paths, Windows included.
const QUICK_ACCESS_AGENT = {
    linux: [
        { labelKey: 'app.fileManager.sites', label: 'Sites', path: '/var/www', icon: Globe },
        { labelKey: 'app.fileManager.agent', label: 'Agent', path: '/etc/serverkit-agent', icon: Boxes },
        { labelKey: 'app.fileManager.webConfig', label: 'Web config', path: '/etc/nginx', icon: SlidersHorizontal },
        { labelKey: 'common.labels.logs', label: 'Logs', path: '/var/log', icon: FileText },
    ],
    windows: [
        { labelKey: 'app.fileManager.agent', label: 'Agent', path: 'C:/ProgramData/ServerKit/Agent', icon: Boxes },
        { labelKey: 'app.fileManager.agentLogs', label: 'Agent logs', path: 'C:/ProgramData/ServerKit/Agent/logs', icon: FileText },
        { labelKey: 'app.fileManager.users', label: 'Users', path: 'C:/Users', icon: Home },
    ],
    darwin: [
        { labelKey: 'app.fileManager.home', label: 'Home', path: '/Users', icon: Home },
        { labelKey: 'common.labels.logs', label: 'Logs', path: '/var/log', icon: FileText },
    ],
};

// File manager operations that the agent can serve over file:* commands.
// Anything else (mkdir, delete, rename, copy, chmod, search, disk usage,
// upload/download) is panel-host-only until the matching agent verbs land.
const REMOTE_SUPPORTED = new Set(['browse', 'read', 'write']);

// Operations the S3 target can't serve (no real directories, permissions, or
// in-place rename). Everything else — browse/read/write/delete/upload/download —
// works against the bucket.
const S3_BLOCKED = new Set(['create file', 'create folder', 'rename', 'change permissions']);

function deriveParent(path) {
    if (!path || path === '/' || path === '') return null;
    // A Windows drive root ("C:/" or "C:") sits directly under the agent's
    // drive list, which the agent serves for the "/" path. Remote agents
    // emit forward-slash paths on the wire, so we only ever see "/" here.
    if (/^[A-Za-z]:\/?$/.test(path)) return '/';
    const trimmed = path.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    const parent = trimmed.slice(0, idx);
    // Keep a bare drive letter as a drive root ("C:" -> "C:/") so navigating
    // up doesn't hit Windows' "current directory on C:" semantics.
    if (/^[A-Za-z]:$/.test(parent)) return parent + '/';
    return parent;
}

function unwrapAgentData(res) {
    // Remote endpoints return the agent payload directly
    // (RemoteFileService → _agent_result unwraps {data}). Defensive
    // unwrap covers both shapes for older agent responses.
    if (res && typeof res === 'object' && 'success' in res && 'data' in res) {
        return res.data;
    }
    return res;
}

function mountDisplayName(mount) {
    if (!mount?.mountpoint || mount.mountpoint === '/') return null;
    const parts = mount.mountpoint.split('/').filter(Boolean);
    const leaf = parts[parts.length - 1] || mount.mountpoint;
    return leaf === 'docker-desktop-user-distro' ? 'docker-desktop' : leaf;
}

const STORAGE = {
    sidebar: 'serverkit-fm-sidebar',
    treeCollapsed: 'serverkit-fm-tree-collapsed',
    expanded: 'serverkit-fm-tree-expanded',
    viewMode: 'serverkit-fm-view-mode',
    sortBy: 'serverkit-fm-sort-by',
    sortDir: 'serverkit-fm-sort-dir',
};

const FILTER_OPTIONS = [
    { id: 'all', labelKey: 'common.labels.all', label: 'All' },
    { id: 'folder', labelKey: 'app.fileManager.folders', label: 'Folders' },
    { id: 'image', labelKey: 'app.fileManager.images', label: 'Images' },
    { id: 'code', labelKey: 'app.fileManager.code', label: 'Code' },
    { id: 'text', labelKey: 'app.fileManager.documents', label: 'Documents' },
    { id: 'data', labelKey: 'app.fileManager.data', label: 'Data' },
    { id: 'video', labelKey: 'app.fileManager.videos', label: 'Videos' },
    { id: 'audio', labelKey: 'app.fileManager.audio', label: 'Audio' },
    { id: 'archive', labelKey: 'app.fileManager.archives', label: 'Archives' },
];

function FileManager() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // ─── target ──────────────────────────────────────────
    // Local panel host by default. Switching to an agent re-routes the
    // browse/read/write verbs through /servers/<id>/files/* and disables
    // operations the agent can't serve yet.
    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';
    const isS3 = target.kind === 's3';
    const { copy: copyText } = useClipboard({
        successMessage: t('app.fileManager.pathCopied', 'Path copied'),
        errorMessage: t('app.fileManager.couldNotCopyPath', 'Could not copy path'),
    });
    const previousTargetRef = useRef({ kind: 'local', server_id: null });

    // The "S3 bucket" target is offered only when an S3-compatible backup
    // destination is configured (Connections → Storage, or the Backups page).
    const [s3Available, setS3Available] = useState(false);
    const s3Options = useMemo(
        () => (s3Available ? [{ value: 's3', label: t('app.fileManager.s3Bucket', 'S3 bucket') }] : []),
        [s3Available, t],
    );
    useEffect(() => {
        let cancelled = false;
        api.getStorageConfig()
            .then((c) => {
                if (cancelled) return;
                const p = c?.provider;
                setS3Available((p === 's3' || p === 'b2') && Boolean(c?.[p]?.bucket));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // The "Stack" quick link tracks the panel's real install dir (custom
    // SERVERKIT_DIR installs aren't at /opt/serverkit).
    const [panelInstallDir, setPanelInstallDir] = useState('/opt/serverkit');
    useEffect(() => {
        let cancelled = false;
        api.getVersion()
            .then((v) => {
                if (!cancelled && v?.install_dir) setPanelInstallDir(v.install_dir);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Per-target rail: agents get their OS's set (unknown os_type — an agent
    // predating sysinfo reporting — is treated as linux, the historical
    // behavior), with the agent's SELF-REPORTED config dir preferred over the
    // installer convention when the agent sent one (system_info footprint);
    // the local host gets the panel set with the resolved Stack dir.
    const quickAccess = useMemo(() => {
        if (isRemote) {
            const os = (target.os_type || 'linux').toLowerCase();
            const rail = QUICK_ACCESS_AGENT[os] || QUICK_ACCESS_AGENT.linux;
            // Windows agents report filepath-style backslashes; the file
            // wire protocol speaks forward slashes.
            const configDir = target.agentConfigDir
                ? target.agentConfigDir.replace(/\\/g, '/').replace(/\/+$/, '')
                : null;
            if (!configDir) return rail;
            return rail.map((q) => {
                if (q.label === 'Agent') return { ...q, path: configDir };
                if (q.label === 'Agent logs') return { ...q, path: `${configDir}/logs` };
                return q;
            });
        }
        return QUICK_ACCESS.map((q) =>
            q.label === 'Stack' ? { ...q, path: panelInstallDir } : q
        );
    }, [isRemote, target.os_type, target.agentConfigDir, panelInstallDir]);

    // ─── core ────────────────────────────────────────────
    const [currentPath, setCurrentPath] = useState(() => searchParams.get('path') || '/home');
    const [entries, setEntries] = useState([]);
    const [parentPath, setParentPath] = useState(null);
    const [loading, setLoading] = useState(true);
    // The open folder's own load failure, shown in the listing in place of
    // "This folder is empty". Navigation into a folder that fails still
    // toasts and steps back, since the previous folder is what stays shown.
    const [dirError, setDirError] = useState(null);
    const [showHidden, setShowHidden] = useState(false);

    // ─── search ──────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);

    // ─── selection ───────────────────────────────────────
    const [selectedPaths, setSelectedPaths] = useState(new Set());
    const [lastClickedPath, setLastClickedPath] = useState(null);
    const [selectMode, setSelectMode] = useState(false);

    // ─── preview ─────────────────────────────────────────
    const [previewFile, setPreviewFile] = useState(null);
    const [fileContent, setFileContent] = useState('');
    const [editing, setEditing] = useState(false);

    // ─── modals ──────────────────────────────────────────
    const [showNewFileModal, setShowNewFileModal] = useState(false);
    const [showNewFolderModal, setShowNewFolderModal] = useState(false);
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [renameTarget, setRenameTarget] = useState(null);
    const [newName, setNewName] = useState('');
    const [permissionsTarget, setPermissionsTarget] = useState(null);
    const [newPermissions, setNewPermissions] = useState('');
    const [confirmDialog, setConfirmDialog] = useState(null);

    // ─── upload ──────────────────────────────────────────
    const [uploads, setUploads] = useState([]);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);
    const dragCounter = useRef(0);

    // ─── view prefs ──────────────────────────────────────
    const [viewMode, setViewMode] = useState(() => localStorage.getItem(STORAGE.viewMode) || 'list');
    const gridSize = 'md';
    const [sortBy, setSortBy] = useState(() => localStorage.getItem(STORAGE.sortBy) || 'name');
    const [sortDir, setSortDir] = useState(() => localStorage.getItem(STORAGE.sortDir) || 'asc');
    const [activeFilter, setActiveFilter] = useState('all');

    // ─── left sidebar ────────────────────────────────────
    const [sidebarVisible, setSidebarVisible] = useState(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches) return false;
        const v = localStorage.getItem(STORAGE.sidebar);
        return v !== null ? v === 'true' : true;
    });
    const [treeCollapsed, setTreeCollapsed] = useState(() => localStorage.getItem(STORAGE.treeCollapsed) === 'true');

    // ─── folder tree state ───────────────────────────────
    const [treeExpanded, setTreeExpanded] = useState(() => {
        try {
            const stored = localStorage.getItem(STORAGE.expanded);
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch { return new Set(); }
    });
    const [treeCache, setTreeCache] = useState(new Map());
    const [treeLoading, setTreeLoading] = useState(new Set());

    // ─── disk ────────────────────────────────────────────
    const [diskMounts, setDiskMounts] = useState([]);
    const [diskLastUpdated, setDiskLastUpdated] = useState(null);
    const [diskLoading, setDiskLoading] = useState(false);

    // ─── history ─────────────────────────────────────────
    const [history, setHistory] = useState(['/home']);
    const [historyIdx, setHistoryIdx] = useState(0);
    const navByHistory = useRef(false);
    const lastValidPathRef = useRef('/home');

    // ─── context menu ────────────────────────────────────
    const [contextMenu, setContextMenu] = useState(null);

    const toast = useToast();

    // ─── persistence ─────────────────────────────────────
    useEffect(() => { localStorage.setItem(STORAGE.sidebar, sidebarVisible); }, [sidebarVisible]);
    useEffect(() => { localStorage.setItem(STORAGE.treeCollapsed, treeCollapsed); }, [treeCollapsed]);
    useEffect(() => { localStorage.setItem(STORAGE.viewMode, viewMode); }, [viewMode]);
    useEffect(() => { localStorage.setItem(STORAGE.sortBy, sortBy); }, [sortBy]);
    useEffect(() => { localStorage.setItem(STORAGE.sortDir, sortDir); }, [sortDir]);
    useEffect(() => {
        localStorage.setItem(STORAGE.expanded, JSON.stringify([...treeExpanded]));
    }, [treeExpanded]);

    useEffect(() => {
        const pathFromUrl = searchParams.get('path') || '/home';
        if (pathFromUrl !== currentPath) {
            setCurrentPath(pathFromUrl);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    useEffect(() => {
        const pathFromUrl = searchParams.get('path') || '/home';
        if (pathFromUrl === currentPath) return;

        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('path', currentPath);
        setSearchParams(nextParams, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPath]);

    // ─── file API adapter ────────────────────────────────
    // Routes the three verbs the agent supports through the remote
    // endpoints when target is an agent; falls back to the panel-local
    // FileService otherwise. Other ops keep going to panel-local — the
    // remoteGuard helper short-circuits them with a toast when the user
    // is on a remote target so we don't accidentally write to the panel
    // host while they think they're editing a remote server.
    const fileApi = useMemo(() => ({
        browse: async (path, hidden) => {
            if (isS3) return api.browseS3(path);
            if (isRemote) {
                return unwrapAgentData(await api.browseRemoteFiles(target.server_id, path));
            }
            return api.browseFiles(path, hidden);
        },
        read: async (path) => {
            if (isS3) return api.readS3(path);
            if (isRemote) {
                return unwrapAgentData(await api.readRemoteFile(target.server_id, path));
            }
            return api.readFile(path);
        },
        write: async (path, content) => {
            if (isS3) return api.writeS3(path, content);
            if (isRemote) {
                return unwrapAgentData(await api.writeRemoteFile(target.server_id, path, content));
            }
            return api.writeFile(path, content);
        },
        del: async (path) => (isS3 ? api.deleteS3(path) : api.deleteFile(path)),
        download: (entry) => (isS3 ? api.downloadS3File(entry.path) : api.downloadFile(entry.path)),
    }), [isRemote, isS3, target]);

    const remoteGuard = useCallback((op) => {
        if (isRemote && !REMOTE_SUPPORTED.has(op)) {
            toast.error(t('app.fileManager.isNotYetSupportedOnRemote', '{{op}} is not yet supported on remote agents', { op: op }));
            return true;
        }
        if (isS3 && S3_BLOCKED.has(op)) {
            toast.error(t('app.fileManager.isnTAvailableOnS3Buckets', '{{op}} isn\'t available on S3 buckets', { op: op }));
            return true;
        }
        return false;
    }, [isRemote, isS3, t, toast]);

    // When the user switches to a remote target, jump to its first
    // advertised allowed_path so they don't see a "panel /home" view
    // that doesn't exist on the remote host.
    useEffect(() => {
        const previousTarget = previousTargetRef.current;
        const targetChanged = previousTarget.kind !== target.kind || previousTarget.server_id !== target.server_id;
        previousTargetRef.current = { kind: target.kind, server_id: target.server_id };

        if (!targetChanged) return;

        if (target.kind === 'agent' && Array.isArray(target.allowedPaths) && target.allowedPaths.length > 0) {
            setCurrentPath(target.allowedPaths[0]);
        } else if (target.kind === 's3') {
            setCurrentPath('/');
        } else if (target.kind === 'local') {
            setCurrentPath('/home');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target.kind, target.server_id]);

    // ─── load directory ──────────────────────────────────
    const loadDirectory = useCallback(async (path) => {
        setLoading(true);
        setSearchResults(null);
        setSelectedPaths(new Set());
        setSelectMode(false);
        try {
            const data = await fileApi.browse(path, showHidden);
            // Agent file:list returns {path, files: [...]} with a flat
            // entry shape; panel browseFiles returns {path, parent,
            // entries: [...]}. Normalize so the UI can keep using
            // entries/parent.
            const entriesList = data.entries || data.files || [];
            setEntries(entriesList);
            setParentPath(data.parent ?? deriveParent(data.path || path));
            setCurrentPath(data.path || path);
            lastValidPathRef.current = data.path || path;
            setDirError(null);
        } catch (error) {
            if (path !== lastValidPathRef.current) {
                toast.error(t('app.fileManager.failedToLoadDirectory', 'Failed to load directory: {{message}}', { message: error.message }));
                setCurrentPath(lastValidPathRef.current);
            } else {
                setEntries([]);
                setDirError(error);
            }
        } finally {
            setLoading(false);
        }
    }, [fileApi, showHidden, toast, t]);

    useEffect(() => {
        loadDirectory(currentPath);
    }, [currentPath, showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        loadDiskMounts();
    }, []);

    // history tracking
    useEffect(() => {
        if (navByHistory.current) {
            navByHistory.current = false;
            return;
        }
        setHistory((h) => {
            const trimmed = h.slice(0, historyIdx + 1);
            if (trimmed[trimmed.length - 1] === currentPath) return h;
            return [...trimmed, currentPath];
        });
        setHistoryIdx((i) => (history[i] === currentPath ? i : i + 1));
    }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── disk mounts ─────────────────────────────────────
    const loadDiskMounts = async () => {
        setDiskLoading(true);
        try {
            const data = await api.getAllDiskMounts();
            setDiskMounts(data.mounts || []);
            setDiskLastUpdated(new Date());
        } catch (e) {
            console.error('Failed to load disk mounts:', e);
        } finally {
            setDiskLoading(false);
        }
    };

    // ─── tree expand/collapse ────────────────────────────
    const toggleTreeExpand = useCallback(async (path) => {
        if (treeExpanded.has(path)) {
            const next = new Set(treeExpanded);
            next.delete(path);
            setTreeExpanded(next);
            return;
        }
        if (!treeCache.has(path)) {
            setTreeLoading((s) => { const n = new Set(s); n.add(path); return n; });
            try {
                const data = await fileApi.browse(path, false);
                const entries = data.entries || data.files || [];
                const folders = entries.filter((e) => e.is_dir).map((e) => ({
                    path: e.path,
                    name: e.name,
                }));
                setTreeCache((c) => { const n = new Map(c); n.set(path, folders); return n; });
            } catch {
                setTreeCache((c) => { const n = new Map(c); n.set(path, []); return n; });
            } finally {
                setTreeLoading((s) => { const n = new Set(s); n.delete(path); return n; });
            }
        }
        setTreeExpanded((s) => { const n = new Set(s); n.add(path); return n; });
    }, [treeExpanded, treeCache, fileApi]);

    // Auto-expand the tree along the current path so the active row is visible.
    useEffect(() => {
        const parts = currentPath.split('/').filter(Boolean);
        const ancestors = [];
        let acc = '';
        for (const p of parts) {
            acc += '/' + p;
            ancestors.push(acc);
        }
        ancestors.forEach((a) => {
            const isUnderRoot = TREE_ROOTS.some((r) => a === r.path || a.startsWith(r.path + '/') || r.path.startsWith(a + '/'));
            if (isUnderRoot && !treeExpanded.has(a) && a !== currentPath) {
                toggleTreeExpand(a);
            }
        });
    }, [currentPath]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── search ──────────────────────────────────────────
    const handleSearch = async () => {
        if (remoteGuard('search')) { setSearchResults([]); return; }
        if (!searchQuery.trim()) { setSearchResults(null); return; }
        setLoading(true);
        try {
            const data = await api.searchFiles(currentPath, searchQuery);
            setSearchResults(data.results || []);
        } catch (error) {
            toast.error(t('app.fileManager.searchFailed', 'Search failed: {{message}}', { message: error.message }));
        } finally {
            setLoading(false);
        }
    };

    // ─── navigation ──────────────────────────────────────
    const navigateTo = (path) => {
        setPreviewFile(null);
        setEditing(false);
        setCurrentPath(path);
    };

    const goBack = () => {
        if (historyIdx > 0) {
            navByHistory.current = true;
            setHistoryIdx(historyIdx - 1);
            setCurrentPath(history[historyIdx - 1]);
        }
    };
    const goForward = () => {
        if (historyIdx < history.length - 1) {
            navByHistory.current = true;
            setHistoryIdx(historyIdx + 1);
            setCurrentPath(history[historyIdx + 1]);
        }
    };
    const goUp = () => parentPath && navigateTo(parentPath);

    const handleOpen = async (entry) => {
        if (entry.is_dir) {
            navigateTo(entry.path);
        } else {
            setPreviewFile(entry);
            setEditing(false);
            if (entry.is_editable) {
                try {
                    const data = await fileApi.read(entry.path);
                    setFileContent(data.content);
                } catch (error) {
                    toast.error(t('app.fileManager.failedToReadFile', 'Failed to read file: {{message}}', { message: error.message }));
                }
            }
        }
    };

    // ─── selection ───────────────────────────────────────
    const handleToggleSelect = (entry, e) => {
        const path = entry.path;
        if (e?.shiftKey && lastClickedPath) {
            const list = sortedFiltered;
            const a = list.findIndex((x) => x.path === lastClickedPath);
            const b = list.findIndex((x) => x.path === path);
            if (a >= 0 && b >= 0) {
                const [from, to] = [Math.min(a, b), Math.max(a, b)];
                const rangePaths = list.slice(from, to + 1).map((x) => x.path);
                const next = new Set([...selectedPaths, ...rangePaths]);
                setSelectedPaths(next);
                setSelectMode(next.size > 0);
            }
        } else {
            const next = new Set(selectedPaths);
            if (next.has(path)) next.delete(path); else next.add(path);
            setSelectedPaths(next);
            setSelectMode(next.size > 0);
            setLastClickedPath(path);
        }
    };

    const clearSelection = () => {
        setSelectedPaths(new Set());
        setSelectMode(false);
    };

    // ─── ops ─────────────────────────────────────────────
    const handleSaveFile = async () => {
        if (!previewFile) return;
        try {
            await fileApi.write(previewFile.path, fileContent);
            toast.success(t('app.fileManager.fileSaved', 'File saved'));
            setEditing(false);
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(t('app.fileManager.failedToSave', 'Failed to save: {{message}}', { message: error.message }));
        }
    };

    const handleCreateFile = async () => {
        if (!newFileName.trim()) return;
        if (remoteGuard('create file')) return;
        try {
            await api.createFile(`${currentPath}/${newFileName}`);
            toast.success(t('app.fileManager.fileCreated', 'File created'));
            setShowNewFileModal(false);
            setNewFileName('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(t('app.fileManager.failedToCreateFile', 'Failed to create file: {{message}}', { message: error.message }));
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        if (remoteGuard('create folder')) return;
        try {
            await api.createDirectory(`${currentPath}/${newFolderName}`);
            toast.success(t('app.fileManager.folderCreated', 'Folder created'));
            setShowNewFolderModal(false);
            setNewFolderName('');
            loadDirectory(currentPath);
            // Refresh tree cache for parent so the new folder appears in the tree
            const parent = currentPath;
            if (treeCache.has(parent)) {
                try {
                    const data = await api.browseFiles(parent, false);
                    const folders = (data.entries || []).filter((e) => e.is_dir).map((e) => ({ path: e.path, name: e.name }));
                    setTreeCache((c) => { const n = new Map(c); n.set(parent, folders); return n; });
                } catch { /* ignore */ }
            }
        } catch (error) {
            toast.error(t('app.fileManager.failedToCreateFolder', 'Failed to create folder: {{message}}', { message: error.message }));
        }
    };

    const handleDelete = (target) => {
        const items = Array.isArray(target) ? target : [target];
        if (items.length === 0) return;
        if (remoteGuard('delete')) return;
        const message = items.length === 1
            ? `Delete "${items[0].name}"?${items[0].is_dir ? ' All contents inside will be removed.' : ''}`
            : `Delete ${items.length} items? This cannot be undone.`;
        setConfirmDialog({
            titleKey: 'app.fileManager.deleteConfirmation', title: 'Delete confirmation',
            message,
            confirmTextKey: 'common.actions.delete', confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                const failures = [];
                for (const it of items) {
                    try {
                        await fileApi.del(it.path);
                    } catch (error) {
                        failures.push(`${it.name}: ${error.message}`);
                    }
                }
                if (failures.length === 0) toast.success(t('app.fileManager.deletedItem', 'Deleted {{length}} item{{value}}', { length: items.length, value: items.length > 1 ? 's' : '' }));
                else toast.error(t('app.fileManager.failed', 'Failed: {{value}}', { value: failures.join(', ') }));
                if (previewFile && items.some((i) => i.path === previewFile.path)) setPreviewFile(null);
                clearSelection();
                loadDirectory(currentPath);
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null),
        });
    };

    const handleRename = async () => {
        if (!renameTarget || !newName.trim()) return;
        if (remoteGuard('rename')) return;
        try {
            await api.renameFile(renameTarget.path, newName);
            toast.success(t('app.fileManager.renamed', 'Renamed'));
            setShowRenameModal(false);
            setRenameTarget(null);
            setNewName('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(t('app.fileManager.failedToRename', 'Failed to rename: {{message}}', { message: error.message }));
        }
    };

    const handleChangePermissions = async () => {
        if (!permissionsTarget || !newPermissions.trim()) return;
        if (remoteGuard('change permissions')) return;
        try {
            await api.changeFilePermissions(permissionsTarget.path, newPermissions);
            toast.success(t('app.fileManager.permissionsUpdated', 'Permissions updated'));
            setShowPermissionsModal(false);
            setPermissionsTarget(null);
            setNewPermissions('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(t('app.fileManager.failed2', 'Failed: {{message}}', { message: error.message }));
        }
    };

    const openRenameModal = (entry) => {
        setRenameTarget(entry);
        setNewName(entry.name);
        setShowRenameModal(true);
    };
    const openPermissionsModal = (entry) => {
        setPermissionsTarget(entry);
        setNewPermissions(entry.permissions_octal || '755');
        setShowPermissionsModal(true);
    };

    // ─── upload ──────────────────────────────────────────
    const uploadFiles = async (files) => {
        const fileList = Array.from(files);
        if (fileList.length === 0) return;
        if (remoteGuard('upload')) return;
        const queue = fileList.map((f, i) => ({
            id: `${Date.now()}-${i}`,
            name: f.name,
            size: f.size,
            progress: 0,
            status: 'pending',
        }));
        setUploads((p) => [...p, ...queue]);

        let succeeded = 0;
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const itemId = queue[i].id;
            try {
                setUploads((p) => p.map((u) => u.id === itemId ? { ...u, status: 'uploading' } : u));
                const doUpload = isS3 ? api.uploadS3 : api.uploadFile;
                await doUpload(currentPath, file, (progress) => {
                    setUploads((p) => p.map((u) => u.id === itemId ? { ...u, progress } : u));
                });
                setUploads((p) => p.map((u) => u.id === itemId ? { ...u, status: 'done', progress: 100 } : u));
                succeeded++;
            } catch (error) {
                setUploads((p) => p.map((u) => u.id === itemId ? { ...u, status: 'error', error: error.message } : u));
            }
        }
        if (succeeded > 0) toast.success(t('app.fileManager.uploadedOfFile', 'Uploaded {{succeeded}} of {{length}} file{{value}}', { succeeded: succeeded, length: fileList.length, value: fileList.length > 1 ? 's' : '' }));
        loadDirectory(currentPath);
        setTimeout(() => {
            setUploads((p) => p.filter((u) => u.status === 'uploading' || u.status === 'pending'));
        }, 4000);
    };

    const handleUploadInput = (e) => {
        if (e.target.files) uploadFiles(e.target.files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDragEnter = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current += 1;
        if (e.dataTransfer.items?.length > 0) setDragActive(true);
    };
    const handleDragLeave = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current === 0) setDragActive(false);
    };
    const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const handleDrop = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current = 0;
        setDragActive(false);
        if (e.dataTransfer.files?.length > 0) uploadFiles(e.dataTransfer.files);
    };

    // ─── derived ─────────────────────────────────────────
    const breadcrumbs = useMemo(() => {
        const parts = currentPath.split('/').filter(Boolean);
        // Windows drive-rooted path ("C:/Users/Juan"): the first segment is
        // the drive and the root crumb is the agent's drive list. Building
        // crumbs with a leading "/" (the POSIX branch below) would produce
        // bogus "/C:" paths that the agent can't resolve.
        if (/^[A-Za-z]:$/.test(parts[0] || '')) {
            const crumbs = [{ name: 'Drives', path: '/' }];
            let acc = parts[0];
            crumbs.push({ name: parts[0], path: acc + '/' });
            for (let i = 1; i < parts.length; i++) {
                acc += '/' + parts[i];
                crumbs.push({ name: parts[i], path: acc });
            }
            return crumbs;
        }
        const crumbs = [{ name: '/', path: '/' }];
        let acc = '';
        parts.forEach((p) => { acc += '/' + p; crumbs.push({ name: p, path: acc }); });
        return crumbs;
    }, [currentPath]);

    const sortedFiltered = useMemo(() => {
        let list = [...(searchResults || entries)];
        if (activeFilter !== 'all') list = list.filter((e) => getFileType(e) === activeFilter);
        const dir = sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            switch (sortBy) {
                case 'size': return ((a.size || 0) - (b.size || 0)) * dir;
                case 'modified': return (new Date(a.modified) - new Date(b.modified)) * dir;
                case 'type': return getFileType(a).localeCompare(getFileType(b)) * dir;
                case 'name':
                default: return a.name.localeCompare(b.name) * dir;
            }
        });
        return list;
    }, [entries, searchResults, sortBy, sortDir, activeFilter]);

    const filterCounts = useMemo(() => {
        const counts = { all: entries.length };
        FILTER_OPTIONS.forEach((c) => { if (c.id !== 'all') counts[c.id] = 0; });
        entries.forEach((e) => { const t = getFileType(e); if (counts[t] !== undefined) counts[t]++; });
        return counts;
    }, [entries]);

    const stats = useMemo(() => {
        const list = sortedFiltered;
        const folders = list.filter((e) => e.is_dir).length;
        const files = list.length - folders;
        const totalBytes = list.reduce((s, e) => s + (e.size || 0), 0);
        const selectedList = list.filter((e) => selectedPaths.has(e.path));
        const selectedBytes = selectedList.reduce((s, e) => s + (e.size || 0), 0);
        return { folders, files, totalBytes, total: list.length, selectedCount: selectedList.length, selectedBytes };
    }, [sortedFiltered, selectedPaths]);

    const activeMount = useMemo(() => diskMounts
        .filter((mount) => {
            const mountPath = mount.mountpoint || '/';
            if (mountPath === '/') return currentPath.startsWith('/');
            return currentPath === mountPath || currentPath.startsWith(`${mountPath.replace(/\/$/, '')}/`);
        })
        .sort((a, b) => (b.mountpoint || '/').length - (a.mountpoint || '/').length)[0] || null,
    [currentPath, diskMounts]);

    const activeUploads = uploads.filter((u) => u.status === 'uploading' || u.status === 'pending');
    const totalUploadProgress = activeUploads.length > 0
        ? activeUploads.reduce((s, u) => s + u.progress, 0) / activeUploads.length
        : 0;

    const sortValue = `${sortBy}-${sortDir}`;
    const filterLabels = {
        all: t('common.labels.all', 'All'),
        folder: t('app.fileManager.folders', 'Folders'),
        image: t('app.fileManager.images', 'Images'),
        code: t('app.fileManager.code', 'Code'),
        text: t('app.fileManager.documents', 'Documents'),
        data: t('app.fileManager.data', 'Data'),
        video: t('app.fileManager.videos', 'Videos'),
        audio: t('app.fileManager.audio', 'Audio'),
        archive: t('app.fileManager.archives', 'Archives'),
    };
    const handleSortChange = (value) => {
        const [nextSortBy, nextSortDir] = value.split('-');
        setSortBy(nextSortBy);
        setSortDir(nextSortDir);
    };

    const selectedEntries = useMemo(
        () => sortedFiltered.filter((e) => selectedPaths.has(e.path)),
        [sortedFiltered, selectedPaths],
    );

    // ─── shortcuts ───────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
            if (inInput) return;
            if (e.key === 'Escape') {
                if (contextMenu) setContextMenu(null);
                else if (previewFile) setPreviewFile(null);
                else if (selectedPaths.size > 0) clearSelection();
            }
            if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selectedEntries.length > 0) {
                e.preventDefault();
                handleDelete(selectedEntries);
            }
            if (e.key === 'F2' && selectedEntries.length === 1) openRenameModal(selectedEntries[0]);
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setSelectedPaths(new Set(sortedFiltered.map((x) => x.path)));
                setSelectMode(sortedFiltered.length > 0);
            }
            if (e.key === 'Backspace' && !e.metaKey && parentPath) { e.preventDefault(); goUp(); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedEntries, sortedFiltered, contextMenu, previewFile, parentPath, selectedPaths]); // eslint-disable-line

    // ─── close popovers ──────────────────────────────────
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => { setContextMenu(null); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [contextMenu]);

    const openContextMenu = (e, entry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedPaths.has(entry.path)) {
            setSelectedPaths(new Set([entry.path]));
            setSelectMode(true);
            setLastClickedPath(entry.path);
        }
        setContextMenu({ x: e.clientX, y: e.clientY, entry });
    };

    const copyPathToClipboard = (path) => copyText(path);

    const downloadSelected = () => {
        selectedEntries.filter((e) => !e.is_dir).forEach((e) => fileApi.download(e));
    };

    const getDiskColor = (percent) => {
        if (percent >= 90) return 'critical';
        if (percent >= 70) return 'warning';
        return 'healthy';
    };

    useTopbarActions(() => (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewFolderModal(true)}
                disabled={isRemote || isS3}
            >
                <FolderPlus size={14} /> {t('app.fileManager.newFolder', 'New folder')}
            </Button>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRemote}
            >
                <Upload size={14} /> {t('app.fileManager.upload', 'Upload')}
            </Button>
            {!isS3 && (
                <Button type="button" size="sm" onClick={() => navigate('/terminal')}>
                    <Terminal size={14} /> {t('app.fileManager.terminal', 'Terminal')}
                </Button>
            )}
        </>
    ), [isRemote, isS3, currentPath]);

    // ─── render ──────────────────────────────────────────
    return (
        <div
            className={`sk-tabgroup__fill file-manager-page file-manager fullscreen ${sidebarVisible ? 'sidebar-open' : ''} view-${viewMode} grid-${gridSize} ${selectMode ? 'select-mode' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <input
                type="file"
                ref={fileInputRef}
                multiple
                className="hidden"
                onChange={handleUploadInput}
            />

            {isRemote && (
                <div className="file-manager-target-banner">
                    {t('app.fileManager.browsingOn', 'Browsing on')} <strong>{target.name}</strong> {t('app.fileManager.readWriteOnlyMkdirDeleteRename', "(read/write only). Mkdir/delete/rename/upload aren't yet supported on remote agents.")}
                </div>
            )}

            {isS3 && (
                <div className="file-manager-target-banner">
                    {t('app.fileManager.browsingYour', 'Browsing your')} <strong>{t('app.fileManager.s3Bucket', 'S3 bucket')}</strong>. Upload, download, edit and delete work;
                    folders, rename and permissions don&apos;t apply to object storage.
                </div>
            )}

            {uploads.length > 0 && (
                <div className="upload-tray">
                    <div className="upload-tray-header">
                        <CloudUpload size={16} />
                        <span>
                            {activeUploads.length > 0
                                ? `Uploading ${activeUploads.length} file${activeUploads.length > 1 ? 's' : ''}…`
                                : 'Uploads complete'}
                        </span>
                        {activeUploads.length > 0 && (
                            <span className="upload-tray-percent">{Math.round(totalUploadProgress)}%</span>
                        )}
                        <Button variant="unstyled" type="button" className="toolbar-icon-btn small" onClick={() => setUploads([])} title={t('common.actions.clear', 'Clear')}>
                            <X size={14} />
                        </Button>
                    </div>
                    <div className="upload-tray-list">
                        {uploads.map((u) => (
                            <div key={u.id} className={`upload-tray-item status-${u.status}`}>
                                <span className="upload-name">{u.name}</span>
                                <div className="upload-bar">
                                    <div className="upload-bar-fill" style={{ width: `${u.progress}%` }} />
                                </div>
                                <span className="upload-status">
                                    {u.status === 'done' ? 'Done' : u.status === 'error' ? 'Failed' : `${Math.round(u.progress)}%`}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="file-manager-toolbar">
                <div className="toolbar-left">
                    <Button variant="unstyled" type="button"
                        className="toolbar-icon-btn"
                        onClick={() => setSidebarVisible(!sidebarVisible)}
                        title={sidebarVisible ? t('app.fileManager.hideSidebar', 'Hide sidebar') : t('app.fileManager.showSidebar', 'Show sidebar')}
                    >
                        {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                    </Button>
                    <div className="nav-buttons">
                        <Button variant="unstyled" type="button" className="nav-btn" onClick={goBack} disabled={historyIdx === 0} title={t('common.actions.back', 'Back')}>
                            <ArrowLeft size={14} />
                        </Button>
                        <Button variant="unstyled" type="button" className="nav-btn" onClick={goForward} disabled={historyIdx >= history.length - 1} title={t('app.fileManager.forward', 'Forward')}>
                            <ArrowRight size={14} />
                        </Button>
                        <Button variant="unstyled" type="button" className="nav-btn" onClick={goUp} disabled={!parentPath} title="Up">
                            <ArrowUp size={14} />
                        </Button>
                        <Button variant="unstyled" type="button" className="nav-btn" onClick={() => navigateTo(isS3 ? '/' : '/home')} title={t('app.fileManager.home', 'Home')}>
                            <Home size={14} />
                        </Button>
                    </div>
                    <div className="path-breadcrumb">
                        {breadcrumbs.map((crumb, idx) => (
                            <span key={crumb.path + idx} className="crumb-segment">
                                {idx > 0 && <span className="crumb-separator">/</span>}
                                <Button variant="unstyled" type="button"
                                    className={`crumb ${idx === breadcrumbs.length - 1 ? 'crumb-active' : ''}`}
                                    onClick={() => navigateTo(crumb.path)}
                                >
                                    {crumb.name}
                                </Button>
                            </span>
                        ))}
                    </div>
                    {activeMount && !isRemote && !isS3 && (
                        <span className="file-mount-chip" title={`${activeMount.device} · ${activeMount.total_human}`}>
                            <HardDrive size={12} />
                            <span>{activeMount.mountpoint === '/' ? t('app.fileManager.rootDisk', 'Root disk') : activeMount.mountpoint}</span>
                        </span>
                    )}
                </div>
                <div className="toolbar-right">
                    <Select value={activeFilter} onValueChange={setActiveFilter}>
                        <SelectTrigger
                            className="file-toolbar-select"
                            title={t('app.fileManager.types', 'Types')}
                            aria-label={t('app.fileManager.types', 'Types')}
                        >
                            <File size={13} aria-hidden="true" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FILTER_OPTIONS.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                    {filterLabels[option.id]} ({filterCounts[option.id] ?? 0})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={sortValue} onValueChange={handleSortChange}>
                        <SelectTrigger
                            className="file-toolbar-select"
                            title={t('app.fileManager.sort', 'Sort')}
                            aria-label={t('app.fileManager.sort', 'Sort')}
                        >
                            <ArrowUpDown size={13} aria-hidden="true" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="name-asc">{t('app.fileManager.nameAZ', 'Name A-Z')}</SelectItem>
                            <SelectItem value="name-desc">{t('app.fileManager.nameZA', 'Name Z-A')}</SelectItem>
                            <SelectItem value="modified-desc">{t('app.fileManager.newest', 'Newest')}</SelectItem>
                            <SelectItem value="modified-asc">{t('app.fileManager.oldest', 'Oldest')}</SelectItem>
                            <SelectItem value="size-desc">{t('app.fileManager.largest', 'Largest')}</SelectItem>
                            <SelectItem value="size-asc">{t('app.fileManager.smallest', 'Smallest')}</SelectItem>
                            <SelectItem value="type-asc">{t('common.labels.type', 'Type')}</SelectItem>
                            <SelectItem value="type-desc">{t('app.fileManager.typeZA', 'Type Z-A')}</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="search-field">
                        <Search size={14} className="search-field-icon" />
                        <input
                            type="text"
                            placeholder={t('app.fileManager.searchFiles', 'Search files…')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                        {(searchResults || searchQuery) && (
                            <Button variant="unstyled" type="button"
                                className="search-field-clear"
                                onClick={() => { setSearchResults(null); setSearchQuery(''); }}
                                title={t('common.actions.clear', 'Clear')}
                            >
                                <X size={12} />
                            </Button>
                        )}
                    </div>
                    <div className="view-toggle">
                        <Button variant="unstyled" type="button"
                            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title={t('app.fileManager.gridView', 'Grid view')}
                        >
                            <LayoutGrid size={14} />
                        </Button>
                        <Button variant="unstyled" type="button"
                            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                            title={t('app.fileManager.listView', 'List view')}
                        >
                            <List size={14} />
                        </Button>
                    </div>
                    <Button variant="unstyled" type="button"
                        className={`toolbar-icon-btn ${showHidden ? 'active' : ''}`}
                        onClick={() => setShowHidden(!showHidden)}
                        title={t('app.fileManager.toggleHiddenFiles', 'Toggle hidden files')}
                    >
                        {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </Button>
                    <Button variant="unstyled" type="button"
                        className="toolbar-icon-btn"
                        onClick={() => loadDirectory(currentPath)}
                        title={t('common.actions.refresh', 'Refresh')}
                    >
                        <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                    </Button>
                </div>
            </div>

            {selectedPaths.size > 0 && (
                <div className="bulk-bar">
                    <div className="bulk-bar-info">
                        <Check size={14} />
                        <span>{selectedPaths.size} {t('app.fileManager.selected', 'selected ·')} {formatBytes(stats.selectedBytes)}</span>
                    </div>
                    <div className="bulk-bar-actions">
                        <Button variant="unstyled" type="button" className="bulk-btn" onClick={downloadSelected}>
                            <Download size={14} /> {t('common.actions.download', 'Download')}
                        </Button>
                        {selectedEntries.length === 1 && (
                            <>
                                <Button variant="unstyled" type="button" className="bulk-btn" onClick={() => openRenameModal(selectedEntries[0])}>
                                    <Edit3 size={14} /> {t('app.fileManager.rename', 'Rename')}
                                </Button>
                                <Button variant="unstyled" type="button" className="bulk-btn" onClick={() => copyPathToClipboard(selectedEntries[0].path)}>
                                    <Copy size={14} /> {t('app.fileManager.copyPath', 'Copy path')}
                                </Button>
                            </>
                        )}
                        <Button variant="unstyled" type="button" className="bulk-btn danger" onClick={() => handleDelete(selectedEntries)}>
                            <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                        </Button>
                        <Button variant="unstyled" type="button" className="bulk-btn ghost" onClick={clearSelection}>
                            <X size={14} /> {t('common.actions.clear', 'Clear')}
                        </Button>
                    </div>
                </div>
            )}

            <div className={`file-manager-body ${previewFile ? 'has-preview' : ''}`}>
                {sidebarVisible && (
                    <aside className="file-manager-sidebar left">
                        <div className="file-manager-source">
                            <Button variant="unstyled"
                                type="button"
                                className="file-manager-source__close"
                                onClick={() => setSidebarVisible(false)}
                                aria-label={t('app.fileManager.hideSidebar', 'Hide sidebar')}
                            >
                                <X size={14} />
                            </Button>
                            <ServerPicker
                                capability="files"
                                value={targetServerId(target)}
                                onChange={(id, server) => setTarget(serverTarget(id, server || (id === 's3' ? null : {})))}
                                extraOptions={s3Options}
                                className="file-manager-source__picker"
                            />
                            <div className="file-manager-source__meta">
                                <span className={`file-manager-source__dot${isS3 ? ' is-cloud' : ''}`} aria-hidden="true" />
                                <span>
                                    {isRemote
                                        ? t('app.fileManager.remoteAgent', 'Remote agent')
                                        : isS3
                                            ? t('app.fileManager.objectStorage', 'Object storage')
                                            : t('app.fileManager.localPanelHost', 'Panel server')}
                                </span>
                            </div>
                        </div>

                        {!isRemote && !isS3 && (
                            <div className="sidebar-section sidebar-section--volumes">
                                <div className="sidebar-section-header sidebar-section-header--split">
                                    <span className="sidebar-section-title" title={t('app.fileManager.diskUsage', 'Disk usage')}>
                                        <HardDrive size={13} />
                                        <span>{t('app.fileManager.volumes', 'Volumes')}</span>
                                    </span>
                                    <Button variant="unstyled" type="button" className="sidebar-action-btn" onClick={loadDiskMounts} disabled={diskLoading} title={t('common.actions.refresh', 'Refresh')}>
                                        <RefreshCw size={12} className={diskLoading ? 'spinning' : ''} />
                                    </Button>
                                </div>
                                <div className="sidebar-section-content disk-mount-list">
                                    {diskMounts.map((mount) => (
                                        <Button variant="unstyled"
                                            type="button"
                                            key={`${mount.device}:${mount.mountpoint}`}
                                            className={`disk-mount-item${activeMount?.mountpoint === mount.mountpoint ? ' active' : ''}`}
                                            onClick={() => navigateTo(mount.mountpoint)}
                                            title={`${mount.device} · ${mount.used_human} / ${mount.total_human}`}
                                        >
                                            <div className="disk-mount-header">
                                                <span className="disk-mount-point">
                                                    {mount.mountpoint === '/'
                                                        ? t('app.fileManager.rootDisk', 'Root disk')
                                                        : mountDisplayName(mount)}
                                                </span>
                                                <span className={`disk-percent ${getDiskColor(mount.percent)}`}>
                                                    {mount.percent}%
                                                </span>
                                            </div>
                                            <div className={`disk-progress ${getDiskColor(mount.percent)}`}>
                                                <span className="disk-progress-fill" style={{ width: `${mount.percent}%` }} />
                                            </div>
                                        </Button>
                                    ))}
                                    {diskLastUpdated && (
                                        <span className="disk-updated disk-updated--footer">
                                            <Clock size={11} />
                                            {t('app.fileManager.updatedAt', 'Updated {{time}}', { time: diskLastUpdated.toLocaleTimeString() })}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {!isS3 && (<>
                        <div className="sidebar-section">
                            <div className="sidebar-section-header static">
                                <Zap size={16} />
                                <span>{t('app.fileManager.quickAccess', 'Quick access')}</span>
                            </div>
                            <div className="sidebar-section-content quick-access-list">
                                {quickAccess.map(q => (
                                    <Button variant="unstyled" type="button"
                                        key={q.label}
                                        className={`quick-access-item ${currentPath === q.path ? 'active' : ''}`}
                                        onClick={() => navigateTo(q.path)}
                                    >
                                        <q.icon size={14} />
                                        <span>{q.label}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="sidebar-section">
                            <div className="sidebar-section-header sidebar-section-header--split">
                                <Button variant="unstyled"
                                    type="button"
                                    className="sidebar-section-toggle"
                                    onClick={() => setTreeCollapsed(!treeCollapsed)}
                                    title={t('app.fileManager.folders', 'Folders')}
                                >
                                    <FolderTreeIcon size={16} />
                                    <span>{t('app.fileManager.fileSystem', 'File system')}</span>
                                    {treeCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                </Button>
                                <Button variant="unstyled" type="button"
                                    className="sidebar-action-btn"
                                    onClick={() => setShowNewFolderModal(true)}
                                    disabled={isRemote}
                                    title={t('app.fileManager.newFolder', 'New folder')}
                                >
                                    <FolderPlus size={14} />
                                </Button>
                            </div>
                            {!treeCollapsed && (
                                <div className="sidebar-section-content tree-content">
                                    <FolderTree
                                        roots={TREE_ROOTS}
                                        expanded={treeExpanded}
                                        treeCache={treeCache}
                                        treeLoading={treeLoading}
                                        currentPath={currentPath}
                                        onNavigate={navigateTo}
                                        onToggle={toggleTreeExpand}
                                    />
                                </div>
                            )}
                        </div>
                        </>)}

                    </aside>
                )}

                <main className="file-manager-main">
                    <div
                        className="file-list-container"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) clearSelection();
                        }}
                    >
                        {dragActive && (
                            <div className="drag-overlay">
                                <div className="drag-overlay-inner">
                                    <CloudUpload size={56} strokeWidth={1.5} />
                                    <h3>{t('app.fileManager.dropToUpload', 'Drop to upload')}</h3>
                                    <p>{t('app.fileManager.filesWillBeUploadedTo', 'Files will be uploaded to')} <code>{currentPath}</code></p>
                                </div>
                            </div>
                        )}

                        {loading ? (
                            <EmptyState loading loadingVariant="tree" title={t('app.fileManager.loadingFiles', 'Loading files')} />
                        ) : dirError && !searchResults ? (
                            <ErrorState
                                title={t('app.fileManager.couldntOpenThisFolder', "Couldn't open this folder")}
                                error={dirError}
                                onRetry={() => loadDirectory(currentPath)}
                            />
                        ) : sortedFiltered.length === 0 ? (
                            <EmptyState
                                icon={FolderOpen}
                                title={searchResults ? t('app.fileManager.noMatches', 'No matches') : activeFilter !== 'all' ? t('app.fileManager.noFiles', 'No {{activeFilter}} files', { activeFilter: activeFilter }) : t('app.fileManager.thisFolderIsEmpty', 'This folder is empty')}
                                description={searchResults
                                    ? t('app.fileManager.tryADifferentSearchTermOr', 'Try a different search term or browse another folder.')
                                    : activeFilter !== 'all'
                                        ? t('app.fileManager.tryADifferentFilter', 'Try a different filter.')
                                        : t('app.fileManager.dropFilesHereOrUseThe', 'Drop files here, or use the buttons above to create something new.')}
                            />
                        ) : viewMode === 'grid' ? (
                            <div className="file-grid">
                                {sortedFiltered.map((entry) => (
                                    <FileCard
                                        key={entry.path}
                                        entry={entry}
                                        selected={selectedPaths.has(entry.path)}
                                        selectMode={selectMode}
                                        onOpen={handleOpen}
                                        onToggleSelect={handleToggleSelect}
                                        onContext={openContextMenu}
                                        isS3={isS3}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="file-list">
                                <div className="file-list-header">
                                    <span className="col-check">
                                        <Button variant="unstyled" type="button"
                                            className="checkbox-btn"
                                            onClick={() => {
                                                if (selectedPaths.size === sortedFiltered.length) clearSelection();
                                                else {
                                                    setSelectedPaths(new Set(sortedFiltered.map((x) => x.path)));
                                                    setSelectMode(sortedFiltered.length > 0);
                                                }
                                            }}
                                        >
                                            <span className={`checkbox ${selectedPaths.size === sortedFiltered.length && sortedFiltered.length > 0 ? 'checked' : ''}`}>
                                                {selectedPaths.size === sortedFiltered.length && sortedFiltered.length > 0 && <Check size={12} />}
                                            </span>
                                        </Button>
                                    </span>
                                    <span className="col-name">{t('common.labels.name', 'Name')}</span>
                                    <span className="col-size">{t('common.labels.size', 'Size')}</span>
                                    <span className="col-modified">{t('app.fileManager.modified', 'Modified')}</span>
                                    <span className="col-permissions">{t('common.labels.permissions', 'Permissions')}</span>
                                    <span className="col-owner">{t('app.fileManager.owner', 'Owner')}</span>
                                    <span className="col-actions">{t('common.labels.actions', 'Actions')}</span>
                                </div>
                                {sortedFiltered.map((entry) => (
                                    <FileRow
                                        key={entry.path}
                                        entry={entry}
                                        selected={selectedPaths.has(entry.path)}
                                        selectMode={selectMode}
                                        onOpen={handleOpen}
                                        onToggleSelect={handleToggleSelect}
                                        onContext={openContextMenu}
                                        onDownload={(e) => fileApi.download(e)}
                                        onRename={openRenameModal}
                                        onPermissions={openPermissionsModal}
                                        onDelete={(e) => handleDelete(e)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </main>

                <PreviewDrawer
                    inline
                    isS3={isS3}
                    file={previewFile}
                    fileContent={fileContent}
                    setFileContent={setFileContent}
                    editing={editing}
                    onStartEdit={() => setEditing(true)}
                    onCancelEdit={() => setEditing(false)}
                    onSave={handleSaveFile}
                    onClose={() => { setPreviewFile(null); setEditing(false); }}
                    onDownload={(e) => fileApi.download(e)}
                    onRename={openRenameModal}
                    onPermissions={openPermissionsModal}
                    onCopyPath={copyPathToClipboard}
                    onDelete={(e) => handleDelete(e)}
                />
            </div>

            <div className="status-bar">
                <div className="status-bar-left">
                    <span className="status-item">
                        <span className="status-label">{t('app.fileManager.total', 'Total')}</span>
                        <span className="status-value">{stats.total} item{stats.total !== 1 ? 's' : ''}</span>
                    </span>
                    <span className="status-divider" />
                    <span className="status-item">
                        <Folder size={12} />
                        <span>{stats.folders} folder{stats.folders !== 1 ? 's' : ''}</span>
                    </span>
                    <span className="status-item">
                        <File size={12} />
                        <span>{stats.files} file{stats.files !== 1 ? 's' : ''}</span>
                    </span>
                    {stats.totalBytes > 0 && (
                        <>
                            <span className="status-divider" />
                            <span className="status-item">
                                <span className="status-label">{t('common.labels.size', 'Size')}</span>
                                <span className="status-value">{formatBytes(stats.totalBytes)}</span>
                            </span>
                        </>
                    )}
                </div>
                <div className="status-bar-right">
                    {stats.selectedCount > 0 && (
                        <span className="status-selection">
                            {stats.selectedCount} {t('app.fileManager.selected', 'selected ·')} {formatBytes(stats.selectedBytes)}
                        </span>
                    )}
                    <span className="status-shortcuts" title={t('app.fileManager.keyboardShortcuts', 'Keyboard shortcuts')}>
                        {t('app.fileManager.upDelDeleteF2RenameA', '⌫ Up · Del Delete · F2 Rename · ⌘A All')}
                    </span>
                </div>
            </div>

            <ContextMenu
                menu={contextMenu}
                selectionCount={selectedEntries.length}
                onClose={() => setContextMenu(null)}
                onOpen={handleOpen}
                onDownload={(e) => fileApi.download(e)}
                onRename={openRenameModal}
                onPermissions={openPermissionsModal}
                onCopyPath={copyPathToClipboard}
                onDelete={(e) => handleDelete(selectedEntries.length > 1 ? selectedEntries : e)}
            />

            {/* Modals */}
            <Modal open={showNewFileModal} onClose={() => setShowNewFileModal(false)} title={t('app.fileManager.createNewFile', 'Create new file')}>
                            <div className="form-group">
                                <Label>{t('app.fileManager.fileName', 'File name')}</Label>
                                <Input
                                    type="text"
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    placeholder="example.txt"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
                                />
                            </div>
                            <p className="text-muted">{t('app.fileManager.willBeCreatedIn', 'Will be created in:')} <code>{currentPath}</code></p>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowNewFileModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button onClick={handleCreateFile}>{t('app.fileManager.createFile', 'Create file')}</Button>
                        </div>
            </Modal>

            <Modal open={showNewFolderModal} onClose={() => setShowNewFolderModal(false)} title={t('app.fileManager.createNewFolder', 'Create new folder')}>
                            <div className="form-group">
                                <Label>{t('app.fileManager.folderName', 'Folder name')}</Label>
                                <Input
                                    type="text"
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    placeholder="new-folder"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                                />
                            </div>
                            <p className="text-muted">{t('app.fileManager.willBeCreatedIn', 'Will be created in:')} <code>{currentPath}</code></p>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowNewFolderModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button onClick={handleCreateFolder}>{t('app.fileManager.createFolder', 'Create folder')}</Button>
                        </div>
            </Modal>

            <Modal open={showRenameModal} onClose={() => setShowRenameModal(false)} title={t('app.fileManager.rename2', 'Rename {{value}}', { value: renameTarget?.is_dir ? 'Folder' : 'File' })}>
                            <div className="form-group">
                                <Label>{t('app.fileManager.newName', 'New name')}</Label>
                                <Input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                                />
                            </div>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowRenameModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button onClick={handleRename}>{t('app.fileManager.rename', 'Rename')}</Button>
                        </div>
            </Modal>

            <Modal open={showPermissionsModal} onClose={() => setShowPermissionsModal(false)} title={t('app.fileManager.changePermissions', 'Change permissions')}>
                            <div className="form-group">
                                <Label>{t('app.fileManager.permissionsOctal', 'Permissions (octal)')}</Label>
                                <Input
                                    type="text"
                                    value={newPermissions}
                                    onChange={(e) => setNewPermissions(e.target.value)}
                                    placeholder="755"
                                    maxLength={4}
                                    autoFocus
                                />
                            </div>
                            <p className="text-muted">{t('app.fileManager.current', 'Current:')} {permissionsTarget?.permissions} ({permissionsTarget?.permissions_octal})</p>
                            <div className="permissions-help">
                                <p>{t('app.fileManager.commonValues', 'Common values:')}</p>
                                <ul>
                                    <li><code>755</code> {t('app.fileManager.ownerRwxGroupOtherRxDirectories', 'Owner: rwx, Group/Other: rx (directories)')}</li>
                                    <li><code>644</code> {t('app.fileManager.ownerRwGroupOtherRFiles', 'Owner: rw, Group/Other: r (files)')}</li>
                                    <li><code>600</code> {t('app.fileManager.ownerRwOnlyPrivateFiles', 'Owner: rw only (private files)')}</li>
                                </ul>
                            </div>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowPermissionsModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button onClick={handleChangePermissions}>{t('app.fileManager.apply', 'Apply')}</Button>
                        </div>
            </Modal>

            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
}

export default FileManager;
