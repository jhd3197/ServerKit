import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity, Bell, BookOpenCheck, Building2, Check, ChevronUp,
    Command, Server, ShieldAlert, Sparkles, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import api from '../services/api';
import { useAuth } from '../contexts/useAuth.js';
import { useNotifications } from '../contexts/useNotifications.js';
import { useOperations } from '../contexts/OperationsContext';
import { useServerkitAI } from '../contexts/useServerkitAI.js';
import { useShellDock } from '../contexts/useShellDock.js';
import { useWalkthroughs } from '../contexts/walkthroughContextValue';
import { useWorkspace } from '../contexts/useWorkspace.js';
import { timeAgo } from '../utils/time';
import ShellDockTabs from './ShellDockTabs';
import { Button as SharedButton } from '@/components/ui/button';

const SERVER_SCOPE_KEY = 'serverkit.activeServerScope';

function readServerScope() {
    try { return localStorage.getItem(SERVER_SCOPE_KEY) || 'local'; } catch { return 'local'; }
}

function statusTone(server) {
    const value = String(server?.status || server?.agent_status || '').toLowerCase();
    if (['offline', 'failed', 'error', 'disconnected'].some((state) => value.includes(state))) return 'down';
    if (['pending', 'warning', 'idle', 'unknown'].some((state) => value.includes(state))) return 'idle';
    return 'online';
}

function alertTone(item) {
    if (item?.severity === 'critical') return 'critical';
    if (item?.severity === 'warning') return 'warning';
    if (item?.severity === 'success') return 'success';
    return 'info';
}

// Styled replacement for the old native <select> poppers — the browser menu
// ignored the theme entirely (white list over a dark shell). Anchored above
// its status-bar trigger, prototype env-menu look: dot · name · meta · check.
function ScopeMenu({ label, options, value, onPick, wide = false }) {
    return (
        <div
            className={`statusbar-menu${wide ? ' statusbar-menu--wide' : ''}`}
            role="listbox"
            aria-label={label}
        >
            <div className="statusbar-menu__head">{label}</div>
            {options.map((option) => (
                <SharedButton variant="unstyled"
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={String(option.id) === String(value)}
                    className="statusbar-menu__option"
                    onClick={() => onPick(option.id)}
                >
                    <span className={`statusbar-menu__swatch is-${option.tone || 'accent'}`} aria-hidden="true" />
                    <span className="statusbar-menu__copy">
                        <span className="statusbar-menu__name">{option.name}</span>
                        {option.meta && <span className={`statusbar-menu__meta${option.metaMono ? ' mono' : ''}`}>{option.meta}</span>}
                    </span>
                    {String(option.id) === String(value) && (
                        <Check size={15} className="statusbar-menu__check" aria-hidden="true" />
                    )}
                </SharedButton>
            ))}
        </div>
    );
}

function AlertsPanel({ onClose }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const notifications = useNotifications();
    const { expanded } = useShellDock();
    const [view, setView] = useState('attention');
    const {
        items = [], loading, markRead, markAllRead, dismissNotice,
    } = notifications || {};

    useEffect(() => { notifications?.refresh?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const visibleItems = useMemo(() => (
        view === 'all'
            ? items
            : items.filter((item) => (
                item.kind === 'notice'
                || item.severity === 'critical'
                || item.severity === 'warning'
            ))
    ), [items, view]);

    const openItem = (item) => {
        if (item.kind !== 'notice' && !item.read && markRead) markRead(item.delivery_id);
        if (item.action_path) {
            navigate(item.action_path);
            onClose();
        }
    };

    return (
        <section className={`shell-panel shell-alerts${expanded ? ' is-expanded' : ''}`} aria-label={t('notifications.heading', 'Notifications')}>
            <header className="shell-panel__head">
                <ShellDockTabs />
            </header>
            <div className="shell-panel__filters">
                <SharedButton variant="unstyled"
                    type="button"
                    className={view === 'attention' ? 'is-active' : ''}
                    onClick={() => setView('attention')}
                    role="tab"
                    aria-selected={view === 'attention'}
                >
                    {t('app.operationsDock.needsAttention', 'Needs attention')}
                </SharedButton>
                <SharedButton variant="unstyled"
                    type="button"
                    className={view === 'all' ? 'is-active' : ''}
                    onClick={() => setView('all')}
                    role="tab"
                    aria-selected={view === 'all'}
                >
                    {t('notifications.everything', 'Everything')}
                </SharedButton>
                <span className="shell-panel__spacer" />
                {items.some((item) => item.kind !== 'notice' && !item.read) && (
                    <SharedButton variant="unstyled" type="button" className="shell-panel__action" onClick={markAllRead}>
                        <Check size={13} /> {t('notifications.markAllRead', 'Mark all read')}
                    </SharedButton>
                )}
            </div>

            <div className="shell-alerts__list">
                {loading && items.length === 0 ? (
                    <div className="shell-panel__empty">{t('common.state.loading', 'Loading')}</div>
                ) : visibleItems.length === 0 ? (
                    <div className="shell-panel__empty">{t('notifications.empty', 'You’re all caught up.')}</div>
                ) : visibleItems.map((item) => (
                    <div
                        key={item.delivery_id || item.notice_id}
                        className={`shell-alerts__row is-${alertTone(item)}${item.read ? ' is-read' : ''}`}
                    >
                        <SharedButton variant="unstyled" type="button" className="shell-alerts__hit" onClick={() => openItem(item)}>
                            <span className="shell-alerts__dot" aria-hidden="true" />
                            <span className="shell-alerts__copy">
                                <strong>{item.title}</strong>
                                {item.body && <span>{item.body}</span>}
                            </span>
                            <span className="shell-alerts__meta">
                                {item.kind === 'notice'
                                    ? item.action_label || t('notifications.review', 'Review')
                                    : timeAgo(item.created_at)}
                            </span>
                        </SharedButton>
                        {item.kind === 'notice' && (
                            <SharedButton variant="unstyled"
                                type="button"
                                className="shell-alerts__dismiss"
                                onClick={() => dismissNotice?.(item.notice_id)}
                                aria-label={t('notifications.dismissItem', 'Dismiss {{title}}', { title: item.title })}
                            >
                                <X size={14} />
                            </SharedButton>
                        )}
                    </div>
                ))}
            </div>

            <footer className="shell-panel__footer">
                <span>{t('notifications.recentActivity', 'Recent system and delivery activity')}</span>
                <SharedButton variant="unstyled" type="button" onClick={() => { navigate('/notifications'); onClose(); }}>
                    {t('notifications.seeAll', 'See all notifications')}
                </SharedButton>
            </footer>
        </section>
    );
}

export default function GlobalStatusBar({ onOpenPalette }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const notifications = useNotifications();
    const { activeOperations, attentionOperations } = useOperations();
    const { activeWalkthrough, activeProgress } = useWalkthroughs();
    const { unread: assistantUnread } = useServerkitAI();
    const { activeTab, toggleTab, close: closeDock } = useShellDock();
    const {
        activeWorkspaceId, clearActiveWorkspace, setActiveWorkspace,
    } = useWorkspace();
    const [workspaces, setWorkspaces] = useState([]);
    const [servers, setServers] = useState([]);
    const [serverId, setServerId] = useState(readServerScope);
    const [setupHealth, setSetupHealth] = useState(null);
    const [scopeMenu, setScopeMenu] = useState(null); // null | 'workspace' | 'server'

    useEffect(() => {
        if (!scopeMenu) return undefined;
        const onPointerDown = (event) => {
            if (!event.target.closest?.('.statusbar-popover')) setScopeMenu(null);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setScopeMenu(null);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [scopeMenu]);

    useEffect(() => {
        let alive = true;
        Promise.all([
            api.getWorkspaces().catch(() => ({ workspaces: [] })),
            api.getAvailableServers().catch(() => []),
            isAdmin ? api.getSetupHealth().catch(() => null) : Promise.resolve(null),
        ]).then(([workspaceData, serverData, healthData]) => {
            if (!alive) return;
            setWorkspaces(workspaceData?.workspaces || []);
            setServers(Array.isArray(serverData) ? serverData : []);
            setSetupHealth(healthData);
        });
        return () => { alive = false; };
    }, [isAdmin]);

    useEffect(() => {
        const availableIds = new Set(['local', ...servers.map((server) => String(server.id))]);
        if (!availableIds.has(String(serverId))) setServerId('local');
    }, [serverId, servers]);

    const workspaceName = workspaces.find(
        (workspace) => String(workspace.id) === activeWorkspaceId,
    )?.name || t('app.workspaceSwitcher.allWorkspaces', 'All workspaces');
    const scopedServers = useMemo(() => ([
        { id: 'local', name: t('app.dashboard.localThisServer', 'Local (this server)'), status: 'online' },
        ...servers.filter((server) => String(server.id) !== 'local'),
    ]), [servers, t]);
    const selectedServer = scopedServers.find(
        (server) => String(server.id) === String(serverId),
    ) || scopedServers[0];
    const runningCount = activeOperations.length;
    const attentionCount = attentionOperations.length;
    const unreadCount = notifications?.unreadCount || 0;
    const setupSummary = setupHealth?.summary;

    const workspaceOptions = useMemo(() => ([
        {
            id: 'all',
            name: t('app.workspaceSwitcher.allWorkspaces', 'All workspaces'),
            meta: t('app.statusbar.allWorkspacesMeta', '{{count}} workspaces · everything you can see', { count: workspaces.length }),
            tone: 'ghost',
        },
        ...workspaces.map((workspace) => ({
            id: String(workspace.id),
            name: workspace.name,
            meta: workspace.member_count != null
                ? t('app.statusbar.workspaceMembers', '{{count}} members', { count: workspace.member_count })
                : workspace.description || null,
        })),
    ]), [t, workspaces]);

    const serverOptions = useMemo(() => scopedServers.map((server) => ({
        id: String(server.id),
        name: server.name || server.id,
        meta: server.hostname || server.ip_address || server.host || null,
        metaMono: true,
        tone: statusTone(server),
    })), [scopedServers]);

    const pickWorkspace = (value) => {
        setScopeMenu(null);
        if (String(value) === activeWorkspaceId) return;
        if (value === 'all') clearActiveWorkspace();
        else {
            const workspace = workspaces.find((item) => String(item.id) === String(value));
            if (workspace) setActiveWorkspace(workspace);
            else return;
        }
        window.location.reload();
    };

    const pickServer = (value) => {
        setScopeMenu(null);
        setServerId(value);
        try { localStorage.setItem(SERVER_SCOPE_KEY, value); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent('serverkit:server-scope', { detail: { serverId: value } }));
    };

    return (
        <>
            {activeTab === 'alerts' && <AlertsPanel onClose={closeDock} />}
            <footer className="global-statusbar" aria-label={t('app.statusbar.shellStatus', 'ServerKit status and tools')}>
                <span className="statusbar-popover">
                    {scopeMenu === 'workspace' && (
                        <ScopeMenu
                            wide
                            label={t('app.workspaceSwitcher.activeWorkspace', 'Active workspace')}
                            options={workspaceOptions}
                            value={activeWorkspaceId}
                            onPick={pickWorkspace}
                        />
                    )}
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`statusbar-select statusbar-select--workspace${scopeMenu === 'workspace' ? ' is-open' : ''}`}
                        onClick={() => setScopeMenu(scopeMenu === 'workspace' ? null : 'workspace')}
                        aria-haspopup="listbox"
                        aria-expanded={scopeMenu === 'workspace'}
                        aria-label={t('app.workspaceSwitcher.activeWorkspace', 'Active workspace')}
                    >
                        <Building2 size={13} aria-hidden="true" />
                        <span className="statusbar-select__value">{workspaceName}</span>
                        <ChevronUp size={12} aria-hidden="true" />
                    </SharedButton>
                </span>

                <span className="global-statusbar__separator" aria-hidden="true" />

                <span className="statusbar-popover">
                    {scopeMenu === 'server' && (
                        <ScopeMenu
                            label={t('app.statusbar.activeServer', 'Active server')}
                            options={serverOptions}
                            value={serverId}
                            onPick={pickServer}
                        />
                    )}
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`statusbar-select${scopeMenu === 'server' ? ' is-open' : ''}`}
                        onClick={() => setScopeMenu(scopeMenu === 'server' ? null : 'server')}
                        aria-haspopup="listbox"
                        aria-expanded={scopeMenu === 'server'}
                        aria-label={t('app.statusbar.activeServer', 'Active server')}
                    >
                        <span className={`global-statusbar__dot is-${statusTone(selectedServer)}`} aria-hidden="true" />
                        <Server size={13} className="global-statusbar__mobile-icon" aria-hidden="true" />
                        <span className="statusbar-select__value">{selectedServer.name || selectedServer.id}</span>
                        <ChevronUp size={12} aria-hidden="true" />
                    </SharedButton>
                </span>

                <span className="global-statusbar__separator" aria-hidden="true" />

                <SharedButton variant="unstyled"
                    type="button"
                    className={`global-statusbar__segment${activeTab === 'ops' ? ' is-active' : ''}`}
                    onClick={() => toggleTab('ops')}
                    aria-expanded={activeTab === 'ops'}
                    aria-label={t('app.operationsDock.title', 'Operations')}
                >
                    <Activity size={13} />
                    <span>{t('app.operationsDock.title', 'Operations')}</span>
                    <span className="global-statusbar__muted">
                        {runningCount
                            ? t('app.statusbar.runningCount', '{{count}} running', { count: runningCount })
                            : t('app.statusbar.idle', 'idle')}
                    </span>
                    {attentionCount > 0 && <span className="global-statusbar__pip is-warning" aria-hidden="true" />}
                </SharedButton>

                <span className="global-statusbar__separator" aria-hidden="true" />
                <SharedButton variant="unstyled"
                    type="button"
                    className={`global-statusbar__segment${activeTab === 'recipes' ? ' is-active' : ''}`}
                    onClick={() => toggleTab('recipes')}
                    aria-expanded={activeTab === 'recipes'}
                    aria-label={activeWalkthrough?.title || t('app.walkthroughs.title', 'Walkthroughs')}
                >
                    <BookOpenCheck size={13} />
                    <span>{activeWalkthrough?.title || t('app.walkthroughs.title', 'Walkthroughs')}</span>
                    {activeWalkthrough && (
                            <span className="global-statusbar__muted">{activeProgress?.count || 0}/{activeProgress?.total || 0}</span>
                    )}
                </SharedButton>

                <span className="global-statusbar__spacer" />

                {setupSummary && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="global-statusbar__segment global-statusbar__setup"
                        onClick={() => navigate('/monitoring/doctor')}
                        title={t('app.setupHealthWidget.setupHealth', 'Setup Health')}
                    >
                        <ShieldAlert size={13} />
                        <span className="global-statusbar__muted">
                            {t('app.statusbar.setupScore', 'setup {{score}}%', { score: setupSummary.score })}
                        </span>
                        <progress max="100" value={setupSummary.score} aria-label={t('app.setupHealthWidget.progress', 'Setup health progress')} />
                    </SharedButton>
                )}

                <span className="global-statusbar__separator" aria-hidden="true" />

                <SharedButton variant="unstyled"
                    type="button"
                    className={`global-statusbar__segment${activeTab === 'alerts' ? ' is-active' : ''}`}
                    onClick={() => toggleTab('alerts')}
                    aria-expanded={activeTab === 'alerts'}
                    aria-label={t('app.statusbar.alerts', 'Alerts')}
                >
                    <Bell size={13} />
                    <span>{t('app.statusbar.alerts', 'Alerts')}</span>
                    {unreadCount > 0 && <span className="global-statusbar__muted">{unreadCount}</span>}
                    {unreadCount > 0 && <span className="global-statusbar__pip is-critical" aria-hidden="true" />}
                </SharedButton>

                <span className="global-statusbar__separator" aria-hidden="true" />

                <SharedButton variant="unstyled"
                    type="button"
                    className={`global-statusbar__segment${activeTab === 'assistant' ? ' is-active' : ''}`}
                    onClick={() => toggleTab('assistant')}
                    aria-expanded={activeTab === 'assistant'}
                    aria-label={t('app.ai.assistant', 'Assistant')}
                >
                    <Sparkles size={13} />
                    <span>{t('app.ai.assistant', 'Assistant')}</span>
                    {assistantUnread > 0 && <span className="global-statusbar__muted">{assistantUnread}</span>}
                </SharedButton>

                <span className="global-statusbar__separator" aria-hidden="true" />

                <SharedButton variant="unstyled"
                    type="button"
                    className="global-statusbar__segment global-statusbar__command"
                    onClick={onOpenPalette}
                    title={t('palette.label', 'Command palette')}
                    aria-label={t('palette.label', 'Command palette')}
                >
                    <Command size={12} />
                    <span className="mono">{t('app.statusbar.commandShortcut', 'Ctrl K')}</span>
                </SharedButton>
            </footer>
        </>
    );
}
