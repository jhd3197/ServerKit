import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Grid2x2, History, Keyboard, Maximize2, Plus,
    RefreshCw, SlidersHorizontal, X,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/useAuth.js';
import { useToast } from '../contexts/useToast.js';
import { useMetrics } from '../hooks/useMetrics';
import useDashboardBoards from '../hooks/useDashboardBoards';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import ServerPicker from '../components/ServerPicker';
import { SegControl } from '@/components/ds';
import { Button } from '@/components/ui/button';
import ChangeBar from '../components/ds/ChangeBar';
import ShortcutSheet from '../components/ds/ShortcutSheet';
import EmptyState from '../components/EmptyState';
import PluginSlot from '../components/PluginSlot';
import SetupHealthWidget from '../components/dashboard/SetupHealthWidget';
import { DashGrid } from '../components/dashboard/grid/DashGrid';
import { WidgetLibrary } from '../components/dashboard/grid/WidgetLibrary';
import { WidgetEditor } from '../components/dashboard/grid/WidgetEditor';
import { WidgetFullscreen } from '../components/dashboard/grid/WidgetFullscreen';
import {
    compact, findFreeSpot, nextWidgetId, pushDown,
} from '../components/dashboard/grid/layout';
import { useWidgetTypes, getWidgetType } from '../components/dashboard/widgets/registry';
import { RANGES } from '../components/dashboard/widgets/metrics';
import { usePolling } from '@/hooks/usePolling';
import useEditingSession from '../hooks/useEditingSession';
import { useShortcut, useShortcutCommands } from '../hooks/useShortcut';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Auto-refresh choices, in seconds. 0 means "don't".
const REFRESH_OPTIONS = [
    { labelKey: 'app.dashboard.off', label: 'Off', value: 0 },
    { label: '5s', value: 5 },
    { label: '10s', value: 10 },
    { label: '30s', value: 30 },
    { label: '1m', value: 60 },
];

const Dashboard = () => {
    const { t } = useTranslation();
    const { isAdmin } = useAuth();
    const toast = useToast();
    const widgetTypes = useWidgetTypes();

    const {
        boards, activeBoard, activeBoardId, setActiveBoardId,
        loading: boardsLoading, error: boardsError,
        saveActive, createBoard, renameBoard, removeBoard, resetActiveBoard,
    } = useDashboardBoards();

    // ---- board editing UI state -------------------------------------------
    const [edit, setEdit] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [fullscreen, setFullscreen] = useState(null);
    const [renamingId, setRenamingId] = useState(null);
    const [tvMode, setTvMode] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const editing = useEditingSession({ baseline: [] });
    const {
        canRedo, canUndo, draft: draftWidgets, isDirty,
        redo, reset: resetEditing, save: saveEditing,
        transaction: updateDraft, undo,
    } = editing;
    const shortcutCommands = useShortcutCommands();

    // ---- board-wide variables ---------------------------------------------
    const [range, setRange] = useState('1h');
    const [tick, setTick] = useState(0);
    const [refreshInterval, setRefreshInterval] = useState(() => {
        const saved = localStorage.getItem('dashboard_refresh_interval');
        return saved ? parseInt(saved, 10) : 10;
    });

    // ---- host identity strip ----------------------------------------------
    const [systemInfo, setSystemInfo] = useState(null);
    const [servers, setServers] = useState([]);
    const [selectedServer, setSelectedServer] = useState({ id: 'local', name: 'Local (this server)' });
    const [remoteMetrics, setRemoteMetrics] = useState(null);
    const [remoteSystemInfo, setRemoteSystemInfo] = useState(null);
    const isRemote = selectedServer.id !== 'local';
    const { metrics: localMetrics, loading: metricsLoading, refresh: refreshMetrics } = useMetrics(true, refreshInterval * 1000, {
        enabled: !isRemote,
        autoRefresh: refreshInterval > 0,
    });
    const metrics = isRemote ? remoteMetrics : localMetrics;

    // Uptime and clock tick locally between server samples so they don't freeze
    // between polls; the refs stop a repeated sample from resetting the drift.
    const [localUptime, setLocalUptime] = useState(null);
    const [localTime, setLocalTime] = useState(null);
    const lastServerUptime = useRef(null);
    const lastServerTime = useRef(null);

    useEffect(() => {
        if (!edit && activeBoard) resetEditing(activeBoard.widgets || []);
    }, [activeBoard, edit, resetEditing]);

    const closeEditing = useCallback(() => {
        resetEditing(activeBoard?.widgets || []);
        setEdit(false);
        setSelectedId(null);
        setLibraryOpen(false);
    }, [activeBoard?.widgets, resetEditing]);

    const { requestLeave, guardedNavigate } = useUnsavedChangesGuard({
        isDirty: edit && isDirty,
        confirmOptions: {
            title: t('common.editing.unsavedChanges', 'Unsaved changes'),
            message: t('common.editing.unsavedChanges', 'Unsaved changes'),
            confirmText: t('app.dashboard.discard', 'Discard'),
        },
        onDiscard: closeEditing,
    });

    const widgets = useMemo(
        () => (edit ? draftWidgets : activeBoard?.widgets || []),
        [activeBoard?.widgets, draftWidgets, edit],
    );
    const selectedWidget = widgets.find((w) => w.i === selectedId) || null;
    const selectedType = getWidgetType(widgetTypes, selectedWidget?.type);

    const resources = useMemo(() => ([
        { id: 'local', labelKey: 'app.dashboard.localThisServer', label: 'Local (this server)', kind: 'panel server' },
        ...servers
            .filter((s) => s && s.id && s.id !== 'local')
            .map((s) => ({ id: s.id, label: s.name || s.id, kind: 'server' })),
    ]), [servers]);

    const ctx = useMemo(() => ({
        range,
        tick,
        serverVar: selectedServer.id,
        isAdmin,
        navigate: guardedNavigate,
        types: widgetTypes,
    }), [range, tick, selectedServer.id, isAdmin, guardedNavigate, widgetTypes]);

    // ---- data loading ------------------------------------------------------
    useEffect(() => {
        api.getAvailableServers()
            .then((data) => setServers(Array.isArray(data) ? data : []))
            .catch(() => setServers([]));
        api.getSystemInfo()
            .then(setSystemInfo)
            .catch(() => setSystemInfo(null));
    }, []);

    // The shell status bar owns the app-wide $server scope. Keep the dashboard
    // variable in sync so changing the server at the bottom edge immediately
    // retargets the board without another page-specific selector state.
    useEffect(() => {
        const applyServerScope = (serverId) => {
            if (!serverId || serverId === 'local') {
                setSelectedServer({ id: 'local', name: t('app.dashboard.localThisServer', 'Local (this server)') });
                return;
            }
            const match = servers.find((server) => String(server.id) === String(serverId));
            if (match) setSelectedServer(match);
        };
        let stored = 'local';
        try { stored = localStorage.getItem('serverkit.activeServerScope') || 'local'; } catch { /* ignore */ }
        applyServerScope(stored);
        const handleScope = (event) => applyServerScope(event.detail?.serverId);
        window.addEventListener('serverkit:server-scope', handleScope);
        return () => window.removeEventListener('serverkit:server-scope', handleScope);
    }, [servers, t]);

    const fetchRemote = useCallback(async () => {
        if (!isRemote) return;
        try {
            const [m, info] = await Promise.all([
                api.getRemoteSystemMetrics(selectedServer.id),
                api.getRemoteSystemInfo(selectedServer.id).catch(() => null),
            ]);
            setRemoteMetrics(m);
            setRemoteSystemInfo(info);
        } catch {
            // The identity strip degrades to placeholders; widgets report their
            // own failures individually.
        }
    }, [isRemote, selectedServer.id]);

    useEffect(() => {
        if (!isRemote) {
            setRemoteMetrics(null);
            setRemoteSystemInfo(null);
            return;
        }
        fetchRemote();
    }, [fetchRemote, isRemote]);

    usePolling(fetchRemote, refreshInterval * 1000, {
        enabled: isRemote && refreshInterval > 0,
        immediate: false,
    });

    // Shared scheduler pauses widget refreshes in hidden tabs.
    usePolling(() => setTick((k) => k + 1), refreshInterval * 1000, {
        enabled: refreshInterval > 0,
        immediate: false,
    });

    useEffect(() => {
        const uptime = metrics?.system?.uptime_seconds;
        const stamp = metrics?.time?.current_time_formatted;
        if (uptime && uptime !== lastServerUptime.current) {
            lastServerUptime.current = uptime;
            setLocalUptime(uptime);
        }
        if (stamp && stamp !== lastServerTime.current) {
            lastServerTime.current = stamp;
            const parsed = new Date(stamp);
            if (!Number.isNaN(parsed.getTime())) setLocalTime(parsed);
        }
    }, [metrics?.system?.uptime_seconds, metrics?.time?.current_time_formatted]);

    const hasUptime = localUptime !== null;
    const hasClock = localTime !== null;
    useEffect(() => {
        if (!hasUptime && !hasClock) return undefined;
        const id = setInterval(() => {
            if (hasUptime) setLocalUptime((prev) => prev + 1);
            if (hasClock) setLocalTime((prev) => new Date(prev.getTime() + 1000));
        }, 1000);
        return () => clearInterval(id);
    }, [hasUptime, hasClock]);

    // ---- widget operations -------------------------------------------------
    const addWidget = useCallback((type) => {
        if (!edit) resetEditing(activeBoard?.widgets || []);
        const spot = findFreeSpot(widgets, type.w, type.h);
        const widget = {
            i: nextWidgetId(widgets),
            type: type.id,
            ...spot,
            w: type.w,
            h: type.h,
            cfg: JSON.parse(JSON.stringify(type.defaultCfg || {})),
        };
        updateDraft((list) => compact([...list, widget]));
        setSelectedId(widget.i);
        setLibraryOpen(false);
        if (!edit) setEdit(true);
    }, [activeBoard?.widgets, edit, resetEditing, updateDraft, widgets]);

    const duplicateWidget = useCallback((widget) => {
        if (!edit) resetEditing(activeBoard?.widgets || []);
        const spot = findFreeSpot(widgets, widget.w, widget.h);
        const copy = { ...JSON.parse(JSON.stringify(widget)), i: nextWidgetId(widgets), ...spot };
        updateDraft((list) => compact([...list, copy]));
        if (!edit) setEdit(true);
        setSelectedId(copy.i);
    }, [activeBoard?.widgets, edit, resetEditing, updateDraft, widgets]);

    const removeWidget = useCallback((id) => {
        if (!edit) resetEditing(activeBoard?.widgets || []);
        updateDraft((list) => compact(list.filter((w) => w.i !== id)));
        if (!edit) setEdit(true);
        setSelectedId(null);
    }, [activeBoard?.widgets, edit, resetEditing, updateDraft]);

    // The inspector can change w/h, which may overlap neighbours — re-settle.
    const updateWidget = useCallback((next) => {
        updateDraft(
            (list) => pushDown(list.map((w) => (w.i === next.i ? next : w)), next),
            { coalesceKey: `widget:${next.i}` },
        );
    }, [updateDraft]);

    const onWidgetMenu = useCallback((action, widget) => {
        if (action === 'config') {
            if (!edit) resetEditing(activeBoard?.widgets || []);
            setEdit(true);
            setSelectedId(widget.i);
        }
        else if (action === 'dup') duplicateWidget(widget);
        else if (action === 'del') removeWidget(widget.i);
        else if (action === 'full') setFullscreen(widget);
    }, [activeBoard?.widgets, duplicateWidget, edit, removeWidget, resetEditing]);

    // ---- edit session ------------------------------------------------------
    const startEdit = useCallback(() => {
        resetEditing(activeBoard?.widgets || []);
        setEdit(true);
    }, [activeBoard?.widgets, resetEditing]);

    const discardEdit = useCallback(async () => {
        if (isDirty) await requestLeave();
        else closeEditing();
    }, [closeEditing, isDirty, requestLeave]);

    const finishEdit = useCallback(async () => {
        try {
            const savedWidgets = await saveEditing(async (draft) => {
                const saved = await saveActive(draft);
                return saved?.widgets || draft;
            });
            setEdit(false);
            setSelectedId(null);
            toast.success(t('app.dashboard.dashboardSaved', 'Dashboard saved'), {
                description: t('app.dashboard.widget', '{{length}} widget{{value}} · {{value2}}', { length: savedWidgets.length, value: savedWidgets.length === 1 ? '' : 's', value2: activeBoard?.name }),
            });
        } catch (err) {
            toastError(toast, t('app.dashboard.couldNotSave', 'Could not save'), err, { description: t('app.dashboard.yourLayoutIsStillHereTry', 'Your layout is still here. Try again.') });
        }
    }, [activeBoard?.name, saveActive, saveEditing, t, toast]);

    useShortcut({
        id: 'dashboard-undo',
        label: t('common.editing.undo', 'Undo'),
        group: 'dashboard',
        keys: [{ key: 'z', ctrlOrMeta: true }],
        enabled: edit && canUndo,
        priority: 50,
        handler: undo,
    });
    useShortcut({
        id: 'dashboard-redo',
        label: t('common.editing.redo', 'Redo'),
        group: 'dashboard',
        keys: [
            { key: 'z', ctrlOrMeta: true, shift: true },
            { key: 'y', ctrlOrMeta: true },
        ],
        enabled: edit && canRedo,
        priority: 50,
        handler: redo,
    });
    useShortcut({
        id: 'dashboard-save',
        label: t('common.actions.done', 'Done'),
        group: 'dashboard',
        keys: [{ key: 'Enter', ctrlOrMeta: true }],
        enabled: edit && isDirty && editing.saveState !== 'saving',
        priority: 50,
        handler: finishEdit,
    });
    useShortcut({
        id: 'dashboard-delete-widget',
        keys: [{ key: 'Delete' }, { key: 'Backspace' }],
        enabled: edit && Boolean(selectedId),
        priority: 40,
        handler: () => removeWidget(selectedId),
    });
    useShortcut({
        id: 'dashboard-clear-selection',
        keys: [{ key: 'Escape' }],
        enabled: tvMode || Boolean(selectedId),
        priority: 40,
        handler: () => {
            if (tvMode) setTvMode(false);
            else setSelectedId(null);
        },
    });
    useShortcut({
        id: 'dashboard-shortcut-sheet',
        label: t('app.fileManager.keyboardShortcuts', 'Keyboard shortcuts'),
        group: 'dashboard',
        keys: [{ key: '?', shift: true }],
        priority: 30,
        handler: () => setShortcutsOpen(true),
    });

    useEffect(() => {
        if (selectedId && !widgets.some((widget) => widget.i === selectedId)) {
            setSelectedId(null);
        }
    }, [selectedId, widgets]);

    const handleReset = async () => {
        try {
            const board = await resetActiveBoard();
            resetEditing(board?.widgets || []);
            toast.info(t('app.dashboard.resetToTheShippedLayout', 'Reset to the shipped layout'), { description: activeBoard?.name });
        } catch (err) {
            toastError(toast, t('app.dashboard.couldNotReset', 'Could not reset'), err, { description: t('app.dashboard.thisBoardHasNoShippedDefault', 'This board has no shipped default.') });
        }
    };

    const leaveEditor = useCallback(async () => {
        if (!edit) return true;
        if (isDirty) return requestLeave();
        closeEditing();
        return true;
    }, [closeEditing, edit, isDirty, requestLeave]);

    const handleBoardSwitch = useCallback(async (boardId) => {
        if (boardId === activeBoardId) return;
        if (!await leaveEditor()) return;
        setActiveBoardId(boardId);
        setSelectedId(null);
    }, [activeBoardId, leaveEditor, setActiveBoardId]);

    const handleCreateBoard = useCallback(async () => {
        if (!await leaveEditor()) return;
        const board = await createBoard();
        setRenamingId(board.id);
    }, [createBoard, leaveEditor]);

    const handleRemoveBoard = useCallback(async (boardId) => {
        if (!await leaveEditor()) return;
        await removeBoard(boardId);
    }, [leaveEditor, removeBoard]);

    const handleServerChange = (serverId, row) => {
        const server = row
            || servers.find((s) => String(s.id) === String(serverId))
            || { id: 'local', name: 'Local (this server)' };
        setSelectedServer(server);
        lastServerUptime.current = null;
        lastServerTime.current = null;
        setLocalUptime(null);
        setLocalTime(null);
    };

    const handleRefreshIntervalChange = (value) => {
        setRefreshInterval(value);
        localStorage.setItem('dashboard_refresh_interval', String(value));
    };

    // ---- derived display ---------------------------------------------------
    // IP, kernel and uptime used to live in a header strip above the board.
    // That strip is gone — the controls are one row now — and those facts are
    // the Host details widget, which can be placed, sized and pointed at
    // whichever server you like. The clock is its own widget for the same
    // reason. Only what the bar itself still needs is derived here.
    const activeSysInfo = isRemote ? remoteSystemInfo : systemInfo;
    const hostname = metrics?.system?.hostname || activeSysInfo?.hostname || 'server';
    const isConnected = isRemote ? !!remoteMetrics : !!localMetrics;
    const displayTime = localTime
        ? localTime.toLocaleTimeString('en-GB', { hour12: false })
        : metrics?.time?.current_time_formatted?.split(' ')[1] || '--:--:--';

    if (boardsLoading && metricsLoading) {
        return <EmptyState loading loadingVariant="chart" title={t('app.dashboard.loadingDashboard', 'Loading dashboard…')} />;
    }

    const grid = (
        <DashGrid
            widgets={widgets}
            edit={edit}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(next) => updateDraft(next)}
            ctx={ctx}
            onWidgetMenu={onWidgetMenu}
        />
    );

    // TV mode: the board, a clock and nothing else — for a wall display.
    if (tvMode) {
        return (
            <div className="skw-tv">
                <div className="skw-tv__bar">
                    <span className="skw-tv__name">{activeBoard?.name}</span>
                    <span className={`conn-status conn-status--${isConnected ? 'live' : 'down'}`} role="status">
                        <span className="conn-status__dot" aria-hidden="true"></span>
                        {isConnected ? 'Live' : 'Reconnecting'}
                    </span>
                    <span className="skw-tv__meta">
                        {selectedServer.name} · {range} {t('app.dashboard.refresh', '· refresh')} {refreshInterval ? `${refreshInterval}s` : 'off'}
                    </span>
                    <span className="skw-tv__clock">{displayTime}</span>
                    <Button variant="unstyled" type="button" className="btn btn-outline btn-sm" onClick={() => setTvMode(false)}>
                        <X size={14} /> {t('app.dashboard.exit', 'Exit')}
                    </Button>
                </div>
                <div className="skw-tv__body">{grid}</div>
            </div>
        );
    }

    // The widget editor is a drawer over the board now, not a docked panel, so
    // the page no longer reserves a right-hand gutter for it.
    return (
        <div className="page-container dashboard-page">
            {/* Extension slot: widgets contributed to the top of the dashboard */}
            <PluginSlot name="dashboard.top" />

            {/* Setup health. Deliberately NOT a placeable board widget: an
                unfirewalled box must be visible without the operator first
                opting into a widget, and the card collapses to a single "all
                set" line once everything is done, so it costs nothing when
                clean. Admin-only — the endpoint is too. */}
            {isAdmin && <SetupHealthWidget />}

            {/* Board tabs + board-wide controls */}
            <div className="skw-bar">
                <div className="skw-tabs">
                    {boards.map((board) => (
                        <div
                            key={board.id}
                            className={`skw-tab${board.id === activeBoardId ? ' is-on' : ''}`}
                            onClick={() => handleBoardSwitch(board.id)}
                            onDoubleClick={() => edit && setRenamingId(board.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleBoardSwitch(board.id); }}
                        >
                            <Grid2x2 size={14} aria-hidden="true" />
                            {renamingId === board.id ? (
                                <input
                                    className="skw-rename"
                                    autoFocus
                                    defaultValue={board.name}
                                    onBlur={(e) => {
                                        renameBoard(board.id, e.target.value.trim() || board.name);
                                        setRenamingId(null);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') e.target.blur();
                                        if (e.key === 'Escape') setRenamingId(null);
                                    }}
                                />
                            ) : (
                                <span>{board.name}</span>
                            )}
                            <span className="skw-tab__count">
                                {board.id === activeBoardId && edit ? widgets.length : (board.widgets || []).length}
                            </span>
                            {edit && boards.length > 1 && board.id === activeBoardId && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="skw-iconbtn skw-iconbtn--bare"
                                    aria-label={t('app.dashboard.delete', 'Delete {{name}}', { name: board.name })}
                                    onClick={(e) => { e.stopPropagation(); handleRemoveBoard(board.id); }}
                                >
                                    <X size={12} />
                                </Button>
                            )}
                        </div>
                    ))}
                    <Button variant="unstyled"
                        type="button"
                        className="skw-tab skw-tab--add"
                        onClick={handleCreateBoard}
                        aria-label={t('app.dashboard.newDashboard', 'New dashboard')}
                        title={t('app.dashboard.newDashboard', 'New dashboard')}
                    >
                        <Plus size={14} />
                    </Button>
                </div>

                <div className="skw-bar__ctl">
                    {/* Which machine the board's $server variable points at.
                        A chevron opening a menu of one is noise, so with a
                        single host this is a plain readout. */}
                    {servers.length < 2 ? (
                        <span className="skw-varpick skw-varpick--static">
                            <span className="skw-varpick__k">server</span>
                            <span className="skw-varpick__v">{hostname}</span>
                        </span>
                    ) : (
                        <ServerPicker
                            value={selectedServer.id}
                            onChange={handleServerChange}
                            label={t('app.dashboard.switchServer', 'Switch server')}
                            className="skw-serverpick"
                        />
                    )}
                    <SegControl
                        options={RANGES.map(([value, label]) => ({ value, label }))}
                        value={range}
                        onChange={setRange}
                        aria-label={t('app.dashboard.timeRange', 'Time range')}
                    />
                    <Select
                        value={String(refreshInterval)}
                        onValueChange={(value) => handleRefreshIntervalChange(parseInt(value, 10))}
                    >
                        <SelectTrigger
                            className="skw-refresh-trigger"
                            title={t('app.dashboard.autoRefreshInterval', 'Auto-refresh interval')}
                            aria-label={t('app.dashboard.autoRefreshInterval', 'Auto-refresh interval')}
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {REFRESH_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={String(opt.value)}>↻ {opt.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="unstyled"
                        type="button"
                        className="skw-iconbtn"
                        title={t('app.dashboard.refreshNow', 'Refresh now')}
                        aria-label={t('app.dashboard.refreshNow', 'Refresh now')}
                        onClick={() => { setTick((k) => k + 1); if (isRemote) fetchRemote(); else refreshMetrics(); }}
                    >
                        <RefreshCw size={15} />
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="skw-iconbtn"
                        title={t('app.dashboard.tvMode', 'TV mode')}
                        aria-label={t('app.dashboard.tvMode', 'TV mode')}
                        onClick={() => setTvMode(true)}
                    >
                        <Maximize2 size={15} />
                    </Button>
                    {edit ? (
                        <>
                            <Button variant="unstyled" type="button" className="skw-barbtn" onClick={() => setLibraryOpen(true)}>
                                <Plus size={14} /> {t('app.dashboard.addWidget', 'Add widget')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="skw-iconbtn"
                                onClick={() => setShortcutsOpen(true)}
                                title={t('app.fileManager.keyboardShortcuts', 'Keyboard shortcuts')}
                                aria-label={t('app.fileManager.keyboardShortcuts', 'Keyboard shortcuts')}
                            >
                                <Keyboard size={14} />
                            </Button>
                            <Button variant="unstyled"
                                type="button"
                                className="skw-iconbtn"
                                onClick={handleReset}
                                title={t('app.dashboard.restoreTheShippedLayout', 'Restore the shipped layout')}
                                aria-label={t('app.dashboard.restoreTheShippedLayout', 'Restore the shipped layout')}
                            >
                                <History size={14} />
                            </Button>
                        </>
                    ) : (
                        <Button variant="unstyled" type="button" className="skw-barbtn" onClick={startEdit}>
                            <SlidersHorizontal size={14} /> {t('common.actions.edit', 'Edit')}
                        </Button>
                    )}
                </div>
            </div>

            {boardsError && <div className="skw-hint skw-hint--error">{boardsError}</div>}

            {edit && (
                <div className="skw-hint">
                    <Grid2x2 size={13} aria-hidden="true" /> {t('app.dashboard.dragHeadersToMoveDragThe', 'Drag headers to move · drag the corner to resize · click a widget to configure it')}{selectedId ? ' · Delete removes it' : ''}
                </div>
            )}

            {widgets.length === 0 ? (
                <div className="skw-empty-board">
                    <div className="skw-empty-board__title">{t('app.dashboard.build', 'Build "')}{activeBoard?.name || 'this dashboard'}{'"'}</div>
                    <div className="skw-empty-board__desc">
                        {t('app.dashboard.thisBoardHasNoWidgetsYet', 'This board has no widgets yet. Add one, or restore the layout it shipped with.')}
                    </div>
                    <div className="skw-empty-board__acts">
                        <Button variant="unstyled"
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => { startEdit(); setLibraryOpen(true); }}
                        >
                            <Plus size={14} /> {t('app.dashboard.addAWidget', 'Add a widget')}
                        </Button>
                        {activeBoard?.slug && (
                            <Button variant="unstyled" type="button" className="btn btn-outline btn-sm" onClick={handleReset}>
                                <History size={14} /> {t('app.dashboard.restoreDefaultLayout', 'Restore default layout')}
                            </Button>
                        )}
                    </div>
                </div>
            ) : grid}

            {edit && (
                <ChangeBar session={editing} onDiscard={discardEdit} onSave={finishEdit} />
            )}

            {libraryOpen && (
                <WidgetLibrary
                    types={widgetTypes}
                    onAdd={addWidget}
                    onClose={() => setLibraryOpen(false)}
                />
            )}
            {edit && selectedWidget && (
                <WidgetEditor
                    widget={selectedWidget}
                    type={selectedType}
                    resources={resources}
                    ctx={ctx}
                    onChange={updateWidget}
                    onClose={() => setSelectedId(null)}
                    onDuplicate={() => duplicateWidget(selectedWidget)}
                    onRemove={() => removeWidget(selectedWidget.i)}
                />
            )}
            {fullscreen && (
                <WidgetFullscreen
                    widget={fullscreen}
                    type={getWidgetType(widgetTypes, fullscreen.type)}
                    ctx={ctx}
                    onClose={() => setFullscreen(null)}
                />
            )}
            <ShortcutSheet
                open={shortcutsOpen}
                onClose={() => setShortcutsOpen(false)}
                title={t('app.fileManager.keyboardShortcuts', 'Keyboard shortcuts')}
                commands={shortcutCommands}
            />
        </div>
    );
};

export default Dashboard;
