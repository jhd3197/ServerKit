import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useAuth } from '../contexts/useAuth.js';
import { useRecordVisit } from '@/hooks/useRecordVisit';
import FavoriteStar from '@/components/FavoriteStar';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Modal from '@/components/Modal';
import { Pill, ServiceTile } from '@/components/ds';
import PageLayout from '../layouts/PageLayout';
import { Button } from '@/components/ui/button';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
    LayoutGrid, ChevronLeft, Server, Box, Globe,
    Users, Settings2,
} from 'lucide-react';
import WorkspaceOverviewTab from '../components/workspaces/WorkspaceOverviewTab';
import WorkspaceServersTab from '../components/workspaces/WorkspaceServersTab';
import WorkspaceServicesTab from '../components/workspaces/WorkspaceServicesTab';
import WorkspaceSitesTab from '../components/workspaces/WorkspaceSitesTab';
import WorkspaceMembersTab from '../components/workspaces/WorkspaceMembersTab';
import WorkspaceSettingsTab from '../components/workspaces/WorkspaceSettingsTab';
import { useWorkspace } from '../contexts/useWorkspace.js';
import { useTranslation } from 'react-i18next';

const VALID_TABS = ['overview', 'servers', 'services', 'sites', 'members', 'settings'];

const TAB_META = {
    overview: { labelKey: 'common.labels.overview', label: 'Overview', icon: LayoutGrid },
    servers: { labelKey: 'common.labels.servers', label: 'Servers', icon: Server },
    services: { labelKey: 'common.labels.services', label: 'Services', icon: Box },
    sites: { labelKey: 'app.workspaceDetail.sites', label: 'Sites', icon: Globe },
    members: { labelKey: 'app.workspaceDetail.members', label: 'Members', icon: Users },
    settings: { labelKey: 'common.labels.settings', label: 'Settings', icon: Settings2 },
};

const formatSince = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? null
        : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const asServerList = (data) => (Array.isArray(data) ? data : (data?.servers || []));

const WorkspaceDetail = () => {
    const { t } = useTranslation();
    const { id } = useParams();
    const wsId = Number(id);
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const {
        activeWorkspaceId,
        clearActiveWorkspace,
        refreshActiveWorkspace,
        setActiveWorkspace: selectWorkspace,
    } = useWorkspace();
    const [activeTab, setActiveTab] = useTabParam(`/workspaces/${id}`, VALID_TABS, 'overview');

    const [ws, setWs] = useState(null);
    useRecordVisit(ws && {
        type: 'workspace', id: ws.id, path: `/workspaces/${ws.id}`, label: ws.name,
    });
    const [members, setMembers] = useState([]);
    const [apps, setApps] = useState([]);
    const [servers, setServers] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    // `loadError` is the workspace request itself; `sourceErrors` the side
    // lists, each handed to the tab that renders it.
    const [loadError, setLoadError] = useState(null);
    const [sourceErrors, setSourceErrors] = useState({});
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [sharingApp, setSharingApp] = useState(null);
    const [grants, setGrants] = useState([]);
    const [grantRole, setGrantRole] = useState('editor');

    const load = useCallback(async () => {
        // The side lists settle on their own: a failed one keeps its last good
        // rows and is recorded, so it can't read as "no members"/"no servers".
        const failures = {};
        const settle = (key, promise) => promise.catch((err) => { failures[key] = err; return null; });
        try {
            const [wsData, mData, appData, srvData, uData] = await Promise.all([
                api.getWorkspace(wsId),
                settle('members', api.getWorkspaceMembers(wsId)),
                settle('apps', api.getApps({ allWorkspaces: true })),
                settle('servers', api.getServers({ allWorkspaces: true })),
                settle('users', api.getUsers()),
            ]);
            setWs(wsData);
            refreshActiveWorkspace(wsData);
            if (mData) setMembers(mData.members || []);
            if (appData) setApps(appData.apps || []);
            if (srvData) setServers(asServerList(srvData));
            if (uData) setAllUsers(uData.users || []);
            setSourceErrors(failures);
            setLoadError(null);
        } catch (err) {
            // Only a 404 means the workspace is gone; anything else is a
            // failure to read it, which keeps what is on screen.
            if (err.status === 404) setWs(null);
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, [wsId, refreshActiveWorkspace]);

    useEffect(() => { setLoading(true); load(); }, [load]);

    const isCurrent = activeWorkspaceId === String(wsId);

    const setActiveWorkspace = () => {
        selectWorkspace(ws);
        window.location.reload();
    };

    const handleArchive = async () => {
        try {
            await api.archiveWorkspace(wsId);
            toast.success(t('app.workspaceDetail.workspaceArchived', 'Workspace archived'));
            load();
        } catch (err) { toast.error(err.message); }
    };

    const handleRestore = async () => {
        try {
            await api.restoreWorkspace(wsId);
            toast.success(t('app.workspaceDetail.workspaceRestored', 'Workspace restored'));
            load();
        } catch (err) { toast.error(err.message); }
    };

    const handleDelete = async () => {
        try {
            await api.deleteWorkspace(wsId);
            if (isCurrent) clearActiveWorkspace();
            toast.success(t('app.workspaceDetail.workspaceDeleted', 'Workspace deleted'));
            navigate('/workspaces');
        } catch (err) { toast.error(err.message); }
    };

    const handleAddMember = async (userId) => {
        try {
            await api.addWorkspaceMember(wsId, userId);
            toast.success(t('app.workspaceDetail.memberAdded', 'Member added'));
            load();
        } catch (err) { toast.error(err.message); }
    };

    const handleRemoveMember = async (memberId) => {
        try {
            await api.removeWorkspaceMember(memberId);
            toast.success(t('app.workspaceDetail.memberRemoved', 'Member removed'));
            load();
        } catch (err) { toast.error(err.message); }
    };

    const handleMoveApp = async (appId, workspaceId) => {
        try {
            await api.setAppWorkspace(appId, workspaceId);
            toast.success(workspaceId ? t('app.workspaceDetail.applicationMovedIn', 'Application moved in') : t('app.workspaceDetail.applicationRemoved', 'Application removed'));
            const data = await api.getApps({ allWorkspaces: true });
            setApps(data.apps || []);
        } catch (err) { toast.error(err.message); }
    };

    const handleMoveServer = async (serverId, workspaceId) => {
        try {
            await api.setServerWorkspace(serverId, workspaceId);
            toast.success(workspaceId ? t('app.workspaceDetail.serverMovedIn', 'Server moved in') : t('app.workspaceDetail.serverRemoved', 'Server removed'));
            setServers(asServerList(await api.getServers({ allWorkspaces: true })));
        } catch (err) { toast.error(err.message); }
    };

    const loadSharing = async (appObj) => {
        try {
            const gData = await api.getAppGrants(appObj.id);
            setGrants(gData.grants || []);
            setSharingApp(appObj);
        } catch { toast.error(t('app.workspaceDetail.failedToLoadSharing', 'Failed to load sharing')); }
    };

    const handleGrant = async (userId) => {
        try {
            await api.grantAppAccess(sharingApp.id, userId, grantRole);
            toast.success(t('app.workspaceDetail.accessGranted', 'Access granted'));
            const gData = await api.getAppGrants(sharingApp.id);
            setGrants(gData.grants || []);
        } catch (err) { toast.error(err.message); }
    };

    const handleRevoke = async (grantId) => {
        try {
            await api.revokeAppAccess(sharingApp.id, grantId);
            toast.success(t('app.workspaceDetail.accessRevoked', 'Access revoked'));
            const gData = await api.getAppGrants(sharingApp.id);
            setGrants(gData.grants || []);
        } catch (err) { toast.error(err.message); }
    };

    // Pre-load states take the same shell as the loaded page.
    if (loading) {
        return (
            <PageLayout className="ws-detail-page" icon={<LayoutGrid size={18} />} title={t('common.labels.workspace', 'Workspace')}>
                <EmptyState loading loadingVariant="detail" title={t('app.workspaceDetail.loadingWorkspace', 'Loading workspace')} />
            </PageLayout>
        );
    }

    if (!ws && loadError && loadError.status !== 404) {
        return (
            <PageLayout className="ws-detail-page" icon={<LayoutGrid size={18} />} title={t('common.labels.workspace', 'Workspace')}>
                <Link className="ws-detail__back" to="/workspaces"><ChevronLeft size={14} /> {t('app.workspaceDetail.allWorkspaces', 'All workspaces')}</Link>
                <ErrorState
                    title={t('app.workspaceDetail.couldntLoadWorkspace', "Couldn't load this workspace")}
                    error={loadError}
                    onRetry={load}
                />
            </PageLayout>
        );
    }

    if (!ws) {
        return (
            <PageLayout className="ws-detail-page" icon={<LayoutGrid size={18} />} title={t('common.labels.workspace', 'Workspace')}>
                <Link className="ws-detail__back" to="/workspaces"><ChevronLeft size={14} /> {t('app.workspaceDetail.allWorkspaces', 'All workspaces')}</Link>
                <EmptyState icon={LayoutGrid} title={t('app.workspaceDetail.workspaceNotFound', 'Workspace not found')} description={t('app.workspaceDetail.itMayHaveBeenDeletedOr', 'It may have been deleted, or you may not have access.')} />
            </PageLayout>
        );
    }

    const appsIn = apps.filter(a => a.workspace_id === wsId);
    const appsOut = apps.filter(a => a.workspace_id !== wsId);
    const srvIn = servers.filter(s => s.workspace_id === wsId);
    const srvOut = servers.filter(s => s.workspace_id !== wsId);
    const services = appsIn.filter(a => a.app_type !== 'wordpress');
    const sites = appsIn.filter(a => a.app_type === 'wordpress');
    const since = formatSince(ws.created_at);

    return (
        <PageLayout
            className="ws-detail-page"
            topbarClassName="ws-detail-topbar"
            contentClassName="app-detail-page app-detail-page--wide"
            icon={<LayoutGrid size={18} />}
            title={(
                <span className="ws-crumbs">
                    <Link to="/workspaces">{t('app.workspaceDetail.workspaces', 'Workspaces')}</Link>
                    <span className="ws-crumbs__sep">/</span>
                    <span className="ws-crumbs__cur">{ws.name}</span>
                </span>
            )}
        >

            <div className="app-detail-body">
                {loadError && <ErrorState compact error={loadError} onRetry={load} />}
                {!loadError && activeTab === 'overview' && Object.values(sourceErrors).some(Boolean) && (
                    <ErrorState
                        compact
                        error={Object.values(sourceErrors).find(Boolean)}
                        onRetry={load}
                    />
                )}
                <div className="app-detail-header">
                    <ServiceTile name={ws.name} size={54} gradient={ws.primary_color || undefined} className="ws-detail__tile" />
                    <div className="app-detail-title-block">
                        <h1>
                            {ws.name}
                            <FavoriteStar type="workspace" id={ws.id} path={`/workspaces/${ws.id}`} label={ws.name} />
                            {isCurrent
                                ? <Pill kind="green">{t('app.workspaceDetail.activeWorkspace', 'active workspace')}</Pill>
                                : <Pill kind={ws.status === 'active' ? 'green' : 'amber'}>{ws.status}</Pill>}
                        </h1>
                        <div className="app-detail-subtitle">
                            <span>/{ws.slug}</span>
                            <span className="separator">·</span>
                            <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                            {since && <><span className="separator">·</span><span>since {since}</span></>}
                        </div>
                    </div>
                </div>

                {ws.description && <p className="ws-detail__desc">{ws.description}</p>}

                <div className="app-detail-tabs">
                    {VALID_TABS.map((tab) => {
                        const meta = TAB_META[tab];
                        const Icon = meta.icon;
                        return (
                            <div
                                key={tab}
                                className={`app-detail-tab ${activeTab === tab ? 'active' : ''} ${tab === 'settings' ? 'app-detail-tab--end' : ''}`}
                                onClick={() => setActiveTab(tab)}
                            >
                                <Icon size={14} /> {meta.label}
                            </div>
                        );
                    })}
                </div>

                <div className="app-detail-content">
                    {activeTab === 'overview' && (
                        <WorkspaceOverviewTab
                            ws={ws}
                            since={since}
                            members={members}
                            srvIn={srvIn}
                            services={services}
                            sites={sites}
                        />
                    )}
                    {activeTab === 'servers' && (
                        <WorkspaceServersTab
                            wsId={wsId}
                            srvIn={srvIn}
                            srvOut={srvOut}
                            onMoveServer={handleMoveServer}
                            loadError={sourceErrors.servers}
                            onRetry={load}
                        />
                    )}
                    {activeTab === 'services' && (
                        <WorkspaceServicesTab
                            wsId={wsId}
                            services={services}
                            appsOut={appsOut.filter(a => a.app_type !== 'wordpress')}
                            onMoveApp={handleMoveApp}
                            onShare={loadSharing}
                            loadError={sourceErrors.apps}
                            onRetry={load}
                        />
                    )}
                    {activeTab === 'sites' && (
                        <WorkspaceSitesTab
                            wsId={wsId}
                            sites={sites}
                            appsOut={appsOut.filter(a => a.app_type === 'wordpress')}
                            onMoveApp={handleMoveApp}
                            onShare={loadSharing}
                            loadError={sourceErrors.apps}
                            onRetry={load}
                        />
                    )}
                    {activeTab === 'members' && (
                        <WorkspaceMembersTab
                            wsId={wsId}
                            members={members}
                            allUsers={allUsers}
                            onAddMember={handleAddMember}
                            onRemoveMember={handleRemoveMember}
                            loadError={sourceErrors.members || sourceErrors.users}
                            onRetry={load}
                        />
                    )}
                    {activeTab === 'settings' && (
                        <WorkspaceSettingsTab
                            wsId={wsId}
                            ws={ws}
                            onUpdate={load}
                            user={user}
                            isCurrent={isCurrent}
                            onSetActive={setActiveWorkspace}
                            onArchive={handleArchive}
                            onRestore={handleRestore}
                            onDeleteClick={() => setDeleteConfirm(true)}
                        />
                    )}
                </div>
            </div>

            <Modal
                open={Boolean(sharingApp)}
                onClose={() => setSharingApp(null)}
                title={sharingApp ? t('app.workspaceDetail.sharing', 'Sharing: {{name}}', { name: sharingApp.name }) : t('app.workspaceDetail.sharing2', 'Sharing')}
            >
                {sharingApp && (
                    <>
                        <p className="form-hint">{t('app.workspaceDetail.grantAUserAccessToThis', 'Grant a user access to this application without transferring ownership.')}</p>
                        <div className="ws-rows">
                            {grants.length === 0 && <p className="form-hint">{t('app.workspaceDetail.notSharedWithAnyoneYet', 'Not shared with anyone yet.')}</p>}
                            {grants.map(g => (
                                <div key={g.id} className="ws-row">
                                    <ServiceTile name={g.username || g.email || '?'} size={28} className="ws-row__av" />
                                    <div className="ws-row__id">
                                        <strong>{g.username || g.email}</strong>
                                        <span className="sk-tag">{g.role}</span>
                                    </div>
                                    <Button size="sm" variant="destructive" onClick={() => handleRevoke(g.id)}>{t('app.workspaceDetail.revoke', 'Revoke')}</Button>
                                </div>
                            ))}
                        </div>
                        <hr />
                        <h4>{t('app.workspaceDetail.grantAccess', 'Grant Access')}</h4>
                        <div className="form-group">
                            <label htmlFor="ws-grant-role">{t('app.workspaceDetail.roleForNewGrants', 'Role for new grants')}</label>
                            <Select value={grantRole} onValueChange={setGrantRole}>
                                <SelectTrigger id="ws-grant-role"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="editor">{t('app.workspaceDetail.editorViewOperate', 'Editor · view + operate')}</SelectItem>
                                    <SelectItem value="viewer">{t('app.workspaceDetail.viewerReadOnly', 'Viewer · read-only')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="ws-pick">
                            {allUsers.filter(u => u.id !== sharingApp.user_id && !grants.find(g => g.user_id === u.id)).map(u => (
                                <div key={u.id} className="ws-pick__item" onClick={() => handleGrant(u.id)}>
                                    <ServiceTile name={u.username || u.email || '?'} size={24} className="ws-row__av" />
                                    <span className="ws-pick__name">{u.username || u.email}</span>
                                    <span className="ws-pick__plus">+</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Modal>

            {deleteConfirm && (
                <ConfirmDialog
                    title={t('app.workspaceDetail.deleteWorkspace', 'Delete Workspace')}
                    message={t('app.workspaceDetail.deleteAllDataWillBeLost', 'Delete "{{name}}"? All data will be lost.', { name: ws.name })}
                    onConfirm={handleDelete}
                    onCancel={() => setDeleteConfirm(false)}
                    variant="danger"
                />
            )}
        </PageLayout>
    );
};

export default WorkspaceDetail;
