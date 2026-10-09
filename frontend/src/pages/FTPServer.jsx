import { useCallback, useState, useEffect  } from 'react';
import {
    FolderUp, UserPlus, Network, Activity, Server, Users as UsersIcon,
    Cable, KeyRound, Ban, Check, Trash2, RefreshCw, X,
} from 'lucide-react';
import useTabParam from '../hooks/useTabParam';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { api } from '../services/api';
import { DataTable, DataTableFooter, MetricCard, KpiBand, Pill, ListToolbar } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useToast } from '../contexts/useToast.js';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { InfoList, InfoItem } from '../components/InfoList';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { errorReason, toastError } from '@/utils/errorMessage';

const VALID_TABS = ['overview', 'users', 'connections', 'logs'];

// Built-in saved views for the users table. An FTP account has one axis worth
// slicing — whether its shell still permits a login — and it is the axis the
// row already renders as a pill, so the rules below match the `status` column's
// `value`, which is the same word the Pill shows.
const NO_RULES = { match: 'all', rules: [] };
const BY_NAME = [{ key: 'username', direction: 'asc' }];
const STATUS_IS = (value) => ({
    match: 'all',
    rules: [{ id: 'fu1', field: 'status', op: 'any', value: [value] }],
});

const FTP_USER_VIEWS = [
    {
        // Every account the panel can see, in the order you would read them.
        name: 'All users',
        state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: NO_RULES },
    },
    {
        // Who can actually connect right now — the unfiltered table cannot
        // answer that at a glance once a few accounts have been parked.
        name: 'Active',
        state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: STATUS_IS('Active') },
    },
    {
        // The other half: accounts left in /etc/passwd with a nologin shell.
        // Worth reading before creating a user that duplicates one.
        name: 'Disabled',
        state: { sorts: BY_NAME, hiddenKeys: [], columnFilters: STATUS_IS('Disabled') },
    },
];

function FTPServer() {
    const { t } = useTranslation();
    const [status, setStatus] = useState(null);
    const [users, setUsers] = useState([]);
    const [connections, setConnections] = useState([]);
    const [config, setConfig] = useState(null);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useTabParam('/ftp', VALID_TABS);
    const [showUserModal, setShowUserModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [newUser, setNewUser] = useState({ username: '', password: '', homeDir: '' });
    const [passwordTarget, setPasswordTarget] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [selectedService, setSelectedService] = useState('vsftpd');
    const [confirmDialog, setConfirmDialog] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const toast = useToast();
    const { sorts: userSorts, setSorts: setUserSorts } = useTableSort({
        storageKey: 'serverkit-table-ftp-users-sort',
    });
    const {
        hiddenKeys: userHiddenKeys,
        setHiddenKeys: setUserHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-ftp-users-cols' });
    const { sorts: connSorts, setSorts: setConnSorts } = useTableSort({
        storageKey: 'serverkit-table-ftp-connections-sort',
    });
    const {
        hiddenKeys: connHiddenKeys,
        setHiddenKeys: setConnHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-ftp-connections-cols' });

    const loadConfig = useCallback(async (service) => {
        try {
            const data = await api.getFTPConfig(service);
            setConfig(data);
        } catch (error) {
            console.error('Failed to load FTP config:', error);
        }
    }, []);

    const loadStatus = useCallback(async () => {
        try {
            const data = await api.getFTPStatus();
            setStatus(data);
            if (data.active_server) {
                loadConfig(data.active_server);
            }
        } catch (error) {
            console.error('Failed to load FTP status:', error);
        }
    }, [loadConfig]);

    const loadUsers = useCallback(async () => {
        try {
            const data = await api.getFTPUsers();
            setUsers(data.users || []);
        } catch (error) {
            console.error('Failed to load FTP users:', error);
        }
    }, []);

    const loadConnections = useCallback(async () => {
        try {
            const data = await api.getFTPConnections();
            setConnections(data.connections || []);
        } catch (error) {
            console.error('Failed to load FTP connections:', error);
        }
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadStatus(),
                loadUsers(),
                loadConnections()
            ]);
        } catch (error) {
            console.error('Failed to load FTP data:', error);
        } finally {
            setLoading(false);
        }
    }, [loadStatus, loadUsers, loadConnections]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    const loadLogs = async () => {
        try {
            const data = await api.getFTPLogs(200);
            setLogs(data.content || 'No logs available');
        } catch {
            setLogs('Failed to load logs');
        }
    };

    const handleServiceAction = async (action) => {
        if (!status?.active_server) return;
        setActionLoading(true);
        try {
            await api.controlFTPService(action, status.active_server);
            const done = {
                start: t('app.fTPServer.ftpServerStarted', 'FTP server started'),
                stop: t('app.fTPServer.ftpServerStopped', 'FTP server stopped'),
                restart: t('app.fTPServer.ftpServerRestarted', 'FTP server restarted'),
            };
            toast.success(done[action] || t('app.fTPServer.ftpServerUpdated', 'FTP server updated'));
            await loadStatus();
        } catch (error) {
            const failed = {
                start: t('app.fTPServer.couldntStartFtp', "Couldn't start the FTP server. {{message}}.", { message: errorReason(error) }),
                stop: t('app.fTPServer.couldntStopFtp', "Couldn't stop the FTP server. {{message}}.", { message: errorReason(error) }),
                restart: t('app.fTPServer.couldntRestartFtp', "Couldn't restart the FTP server. {{message}}.", { message: errorReason(error) }),
            };
            toast.error(failed[action] || error.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFTPServer(selectedService);
            toast.success(t('app.fTPServer.installedSuccessfully', '{{selectedService}} installed', { selectedService: selectedService }));
            setShowInstallModal(false);
            await loadData();
        } catch (error) {
            toast.error(t('app.fTPServer.failedToInstall', "Couldn't install. {{message}}", { message: errorReason(error) }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreateUser = async () => {
        if (!newUser.username.trim()) return;
        setActionLoading(true);
        try {
            const result = await api.createFTPUser(
                newUser.username,
                newUser.password || null,
                newUser.homeDir || null
            );
            toast.success(t('app.fTPServer.userCreatedPassword', 'User created. Password: {{password}}', { password: result.password }));
            setShowUserModal(false);
            setNewUser({ username: '', password: '', homeDir: '' });
            await loadUsers();
        } catch (error) {
            toast.error(t('app.fTPServer.failedToCreateUser', "Couldn't create the user. {{message}}", { message: errorReason(error) }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteUser = async (username) => {
        setConfirmDialog({
            titleKey: 'app.fTPServer.deleteFtpUser', title: 'Delete FTP user',
            message: t('app.fTPServer.deleteUserMessage', 'Delete the FTP user "{{username}}"?', { username }),
            confirmTextKey: 'common.actions.delete', confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteFTPUser(username, false);
                    toast.success(t('app.fTPServer.userDeletedSuccessfully', 'User deleted'));
                    await loadUsers();
                } catch (error) {
                    toast.error(t('app.fTPServer.failedToDeleteUser', "Couldn't delete the user. {{message}}", { message: errorReason(error) }));
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleToggleUser = async (username, currentStatus) => {
        try {
            await api.toggleFTPUser(username, !currentStatus);
            toast.success(currentStatus
                ? t('app.fTPServer.userOff', 'User turned off')
                : t('app.fTPServer.userOn', 'User turned on'));
            await loadUsers();
        } catch (error) {
            toast.error(t('app.fTPServer.failedToToggleUser', "Couldn't turn the user on or off. {{message}}", { message: errorReason(error) }));
        }
    };

    const handleChangePassword = async () => {
        if (!passwordTarget) return;
        setActionLoading(true);
        try {
            const result = await api.changeFTPPassword(passwordTarget, newPassword || null);
            toast.success(t('app.fTPServer.passwordChangedNewPassword', 'Password changed. New password: {{password}}', { password: result.password }));
            setShowPasswordModal(false);
            setPasswordTarget(null);
            setNewPassword('');
        } catch (error) {
            toast.error(t('app.fTPServer.failedToChangePassword', "Couldn't change the password. {{message}}", { message: errorReason(error) }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisconnect = async (pid) => {
        try {
            await api.disconnectFTPSession(pid);
            toast.success(t('app.fTPServer.sessionDisconnected', 'Session disconnected'));
            await loadConnections();
        } catch (error) {
            toast.error(t('app.fTPServer.failedToDisconnect', "Couldn't disconnect. {{message}}", { message: errorReason(error) }));
        }
    };

    const handleTestConnection = async () => {
        setActionLoading(true);
        try {
            const result = await api.testFTPConnection('localhost', 21);
            if (result.success) {
                toast.success(result.message);
            } else {
                toastError(toast, t('app.fTPServer.couldntConnect', "Couldn't connect to the FTP server."), result.error);
            }
        } catch (error) {
            toast.error(t('app.fTPServer.connectionTestFailed', "Couldn't connect. {{message}}", { message: errorReason(error) }));
        } finally {
            setActionLoading(false);
        }
    };

    const openPasswordModal = (username) => {
        setPasswordTarget(username);
        setNewPassword('');
        setShowPasswordModal(true);
    };

    // Columns for the shared DataTable. Cell markup and classNames are
    // identical to the hand-rolled tables they replace, so _ftp-server.scss
    // keeps applying (.user-name, .sk-cell-mono, .actions).
    const userColumns = [
        {
            key: 'username',
            headerKey: 'common.labels.username', header: 'Username',
            sortable: true,
            hideable: false,
            // A login name is a fragment you type, not a value you pick.
            type: 'text',
            value: (user) => user.username || '',
            sortValue: (user) => user.username || '',
            render: (user) => (
                <>
                    <span className="user-name">{user.username}</span>
                    {user.in_userlist && (
                        <Badge variant="info">FTP</Badge>
                    )}
                </>
            ),
        },
        {
            key: 'home',
            headerKey: 'app.fTPServer.homeDirectory', header: 'Home directory',
            sortable: true,
            type: 'text',
            value: (user) => user.home || '',
            sortValue: (user) => user.home || '',
            cellClassName: 'sk-cell-mono',
            render: (user) => (
                <>
                    <code>{user.home}</code>
                    {!user.home_exists && (
                        <Badge variant="warning">{t('app.fTPServer.missing', 'Missing')}</Badge>
                    )}
                </>
            ),
        },
        {
            key: 'usage',
            headerKey: 'app.fTPServer.usage', header: 'Usage',
            sortable: true,
            // Filter on the byte count, not on the "1.2 MB" string the cell
            // shows — "greater than" is the only useful question here.
            type: 'num',
            value: (user) => user.home_size ?? null,
            sortValue: (user) => user.home_size ?? null,
            cellClassName: 'sk-cell-dim',
            render: (user) => user.home_size_human,
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // Declared, not inferred: a box with two FTP accounts of two
            // statuses fails the enum cardinality test and would fall back to
            // text, which turns the pick-list into a typed fragment and both
            // status views above into no-ops. There is no `status` key on the
            // row either — `value` is what the rules read.
            type: 'enum',
            enumOrder: ['Active', 'Disabled'],
            value: (user) => (user.is_active ? 'Active' : 'Disabled'),
            sortValue: (user) => (user.is_active ? 'Active' : 'Disabled'),
            render: (user) => (
                <Pill kind={user.is_active ? 'green' : 'gray'}>
                    {user.is_active ? t('app.fTPServer.active', 'Active') : t('app.fTPServer.disabled', 'Disabled')}
                </Pill>
            ),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions',
            render: (user) => (
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openPasswordModal(user.username)}
                        title={t('app.fTPServer.changePassword', 'Change password')}
                    >
                        <KeyRound size={14} />
                    </Button>
                    <Button
                        variant={user.is_active ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => handleToggleUser(user.username, user.is_active)}
                        title={user.is_active ? t('common.actions.disable', 'Disable') : t('common.actions.enable', 'Enable')}
                    >
                        {user.is_active ? <Ban size={14} /> : <Check size={14} />}
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteUser(user.username)}
                        title={t('common.actions.delete', 'Delete')}
                    >
                        <Trash2 size={14} />
                    </Button>
                </>
            ),
        },
    ];

    const connectionColumns = [
        {
            key: 'local',
            headerKey: 'app.fTPServer.localAddress', header: 'Local address',
            sortable: true,
            hideable: false,
            // addr:port pairs are near-unique per row — you type a fragment.
            type: 'text',
            value: (conn) => conn.local || '',
            sortValue: (conn) => conn.local || '',
            cellClassName: 'sk-cell-mono',
            render: (conn) => <code>{conn.local}</code>,
        },
        {
            key: 'remote',
            headerKey: 'app.fTPServer.remoteAddress', header: 'Remote address',
            sortable: true,
            type: 'text',
            value: (conn) => conn.remote || '',
            sortValue: (conn) => conn.remote || '',
            cellClassName: 'sk-cell-mono',
            render: (conn) => <code>{conn.remote}</code>,
        },
        {
            key: 'state',
            headerKey: 'common.labels.state', header: 'State',
            sortable: true,
            // Declared: with a single connection listed the one distinct value
            // fails the cardinality test and the column would drop to text.
            type: 'enum',
            value: (conn) => conn.state || '',
            sortValue: (conn) => conn.state || '',
            render: (conn) => (
                <Pill kind="green">{conn.state}</Pill>
            ),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions',
            render: (conn) => (
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDisconnect(conn.pid)}
                    title={t('app.fTPServer.disconnect', 'Disconnect')}
                >
                    <X size={14} />
                </Button>
            ),
        },
    ];

    // Chrome stays INLINE rather than hoisted: /ftp is one page in the Files
    // tab group, so its top bar is shared with File Manager, and these tables
    // are two of four inner tabs — a hoisted picker would sit over Overview and
    // Logs too. One route, two tables, so each needs its own `urlScope`:
    // without it both would write `?view=`/`?sort=` and clobber each other.
    const userChrome = useTableChrome({
        columns: userColumns,
        rows: users,
        viewPageKey: 'ftp-users',
        builtinViews: FTP_USER_VIEWS,
        noun: 'users',
        sorts: userSorts,
        setSorts: setUserSorts,
        hiddenKeys: userHiddenKeys,
        setHiddenKeys: setUserHiddenKeys,
        urlScope: 'users',
    });

    // No built-in views: every row here is an established session to port 21,
    // so there is no second slice to name — `ss` reports nothing else.
    const connChrome = useTableChrome({
        columns: connectionColumns,
        rows: connections,
        viewPageKey: 'ftp-connections',
        noun: 'connections',
        sorts: connSorts,
        setSorts: setConnSorts,
        hiddenKeys: connHiddenKeys,
        setHiddenKeys: setConnHiddenKeys,
        urlScope: 'connections',
    });

    const isInstalled = status?.any_installed;
    const isRunning = status?.any_running;

    useTopbarActions(() =>
        <>
        {!isInstalled ? (
            <Button onClick={() => setShowInstallModal(true)}>
                {t('app.fTPServer.installFtpServer', 'Install FTP server')}
            </Button>
        ) : (
            <>
                <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={actionLoading}
                >
                    {t('app.fTPServer.testConnection', 'Test connection')}
                </Button>
                {isRunning ? (
                    <>
                        <Button
                            variant="outline"
                            onClick={() => handleServiceAction('restart')}
                            disabled={actionLoading}
                        >
                            {t('common.actions.restart', 'Restart')}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => handleServiceAction('stop')}
                            disabled={actionLoading}
                        >
                            {t('common.actions.stop', 'Stop')}
                        </Button>
                    </>
                ) : (
                    <Button
                        onClick={() => handleServiceAction('start')}
                        disabled={actionLoading}
                    >
                        {t('common.actions.start', 'Start')}
                    </Button>
                )}
            </>
        )}
        </>,
        [isInstalled, isRunning, actionLoading],
    );

    if (loading) {
        return <EmptyState loading loadingVariant="table" size="lg" title={t('app.fTPServer.loadingFtpServer', 'Loading FTP server')} />;
    }

    const activeServer = status?.active_server;
    const disabledUsers = users.filter((user) => !user.is_active).length;
    const ftpPort = config?.settings
        ? (config.settings.listen_port || config.settings.port || 21)
        : null;

    return (
        <div className="sk-tabgroup__inner ftp-server">
            {!isInstalled ? (
                <EmptyState
                    size="lg"
                    icon={FolderUp}
                    title={t('app.fTPServer.noFtpServerInstalled', 'No FTP server installed')}
                    description={t('app.fTPServer.installAnFtpServerToEnable', 'Install an FTP server to enable file transfers on your server.')}
                    action={<Button size="lg" onClick={() => setShowInstallModal(true)}>{t('app.fTPServer.installFtpServer', 'Install FTP server')}</Button>}
                />
            ) : (
                <>
                    <KpiBand role="group" aria-label={t('app.fTPServer.ftpServerStatus', 'FTP server status')}>
                        <MetricCard
                            tone={isRunning ? 'green' : 'amber'}
                            icon={<Activity size={16} />}
                            value={isRunning ? 'Running' : 'Stopped'}
                            label={t('app.fTPServer.serverStatus', 'Server status')}
                        />
                        <MetricCard
                            tone="accent"
                            icon={<Server size={16} />}
                            value={activeServer || 'None'}
                            label={t('app.fTPServer.activeServer', 'Active server')}
                        >
                            {ftpPort != null && (
                                <div className="sk-kpi__sub"><span>port {ftpPort}</span></div>
                            )}
                        </MetricCard>
                        <MetricCard
                            tone="cyan"
                            icon={<UsersIcon size={16} />}
                            value={users.length}
                            label={t('app.fTPServer.ftpUsers', 'FTP users')}
                        >
                            {disabledUsers > 0 && (
                                <div className="sk-kpi__sub"><span>{disabledUsers} disabled</span></div>
                            )}
                        </MetricCard>
                        <MetricCard
                            tone="violet"
                            icon={<Cable size={16} />}
                            value={connections.length}
                            label={t('app.fTPServer.activeConnections', 'Active connections')}
                        />
                    </KpiBand>

                    <Tabs value={activeTab} onValueChange={(val) => {
                        setActiveTab(val);
                        if (val === 'connections') loadConnections();
                        if (val === 'logs') loadLogs();
                    }}>
                        <TabsList>
                            <TabsTrigger value="overview">{t('common.labels.overview', 'Overview')}</TabsTrigger>
                            <TabsTrigger value="users">{t('app.fTPServer.users', 'Users')}</TabsTrigger>
                            <TabsTrigger value="connections">{t('app.fTPServer.connections', 'Connections')}</TabsTrigger>
                            <TabsTrigger value="logs">{t('common.labels.logs', 'Logs')}</TabsTrigger>
                        </TabsList>

                        <TabsContent value="overview">
                            <div className="overview-tab">
                                <div className="config-section">
                                    <h3>{t('app.fTPServer.serverConfiguration', 'Server configuration')}</h3>
                                    {config?.settings ? (
                                        <InfoList>
                                            <InfoItem label={t('common.labels.port', 'Port')} value={config.settings.listen_port || config.settings.port || 21} mono />
                                            <InfoItem label={t('app.fTPServer.anonymousAccess', 'Anonymous access')}>
                                                <span className={`info-value ${config.settings.anonymous_enable ? 'warning' : 'success'}`}>
                                                    {config.settings.anonymous_enable ? t('app.fTPServer.enabled', 'Enabled') : t('app.fTPServer.disabled', 'Disabled')}
                                                </span>
                                            </InfoItem>
                                            <InfoItem label={t('app.fTPServer.localUsers', 'Local users')} value={config.settings.local_enable ? 'Enabled' : 'Disabled'} />
                                            <InfoItem label={t('app.fTPServer.writePermission', 'Write permission')} value={config.settings.write_enable ? 'Enabled' : 'Disabled'} />
                                            <InfoItem label={t('app.fTPServer.chrootUsers', 'Chroot users')} value={config.settings.chroot_local_user ? 'Yes' : 'No'} />
                                            <InfoItem label={t('app.fTPServer.sslTls', 'SSL/TLS')}>
                                                <span className={`info-value ${config.settings.ssl_enable ? 'success' : 'warning'}`}>
                                                    {config.settings.ssl_enable ? t('app.fTPServer.enabled', 'Enabled') : t('app.fTPServer.disabled', 'Disabled')}
                                                </span>
                                            </InfoItem>
                                        </InfoList>
                                    ) : (
                                        <p className="text-muted">{t('app.fTPServer.configurationNotAvailable', 'Configuration not available')}</p>
                                    )}
                                </div>

                                <div className="info-section">
                                    <h3>{t('app.fTPServer.connectionInformation', 'Connection information')}</h3>
                                    <InfoList>
                                        <InfoItem label={t('app.fTPServer.host', 'Host')} value={t('app.fTPServer.yourServerIpOrDomain', 'Your server IP or domain')} />
                                        <InfoItem label={t('common.labels.port', 'Port')} value="21" mono />
                                        <InfoItem label={t('app.fTPServer.protocol', 'Protocol')} value={`FTP${config?.settings?.ssl_enable ? 'S' : ''}`} />
                                    </InfoList>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="users">
                            <div className="users-tab">
                                {/* The view name replaces the old "FTP Users"
                                    eyebrow: one heading, and it now names the
                                    slice you are looking at. Add User keeps its
                                    own bar because it acts on the server, not
                                    on what you are looking at; Refresh is in
                                    the "⋮". */}
                                <GridViewPicker
                                    views={userChrome.views}
                                    label="users"
                                    onCreate={userChrome.createView}
                                    actions={(
                                        <>
                                            <GridFilterButton
                                                count={userChrome.filterCount}
                                                onClick={() => userChrome.setDrawerOpen(true)}
                                            />
                                            <GridToolsMenu {...userChrome.toolsProps} onRefresh={loadUsers} />
                                        </>
                                    )}
                                />
                                <ListToolbar>
                                    <Button onClick={() => setShowUserModal(true)}>
                                        {t('app.fTPServer.addUser', 'New user')}
                                    </Button>
                                </ListToolbar>

                                <GridChips {...userChrome.chipProps} />

                                <DataTable
                                    columns={userChrome.columns}
                                    data={users}
                                    keyField="username"
                                    sorts={userSorts}
                                    onSortsChange={setUserSorts}
                                    {...userChrome.tableProps}
                                    className="users-table"
                                    emptyState={(
                                        <EmptyState
                                            icon={UserPlus}
                                            title={t('app.fTPServer.noFtpUsersConfigured', 'No FTP users configured')}
                                            action={<Button onClick={() => setShowUserModal(true)}>{t('app.fTPServer.createFirstUser', 'New user')}</Button>}
                                        />
                                    )}
                                    footer={(
                                        <DataTableFooter
                                            // DataTable applies the column rules
                                            // itself, so the shown count comes
                                            // from the chrome — `users` is only
                                            // ever the whole account list.
                                            shown={userChrome.shownCount}
                                            total={users.length}
                                            noun="user"
                                        />
                                    )}
                                />

                                <GridFilterDrawer {...userChrome.drawerProps} />
                            </div>
                        </TabsContent>

                        <TabsContent value="connections">
                            <div className="connections-tab">
                                {/* Refresh moved into the "⋮" so it stays
                                    reachable even with nothing connected —
                                    the empty state is the table's now. */}
                                <GridViewPicker
                                    views={connChrome.views}
                                    label="connections"
                                    onCreate={connChrome.createView}
                                    actions={(
                                        <>
                                            <GridFilterButton
                                                count={connChrome.filterCount}
                                                onClick={() => connChrome.setDrawerOpen(true)}
                                            />
                                            <GridToolsMenu {...connChrome.toolsProps} onRefresh={loadConnections} />
                                        </>
                                    )}
                                />

                                <GridChips {...connChrome.chipProps} />

                                <DataTable
                                    columns={connChrome.columns}
                                    data={connections}
                                    keyField={(conn) => conn.pid ?? `${conn.local}-${conn.remote}`}
                                    sorts={connSorts}
                                    onSortsChange={setConnSorts}
                                    {...connChrome.tableProps}
                                    className="connections-table"
                                    emptyState={<EmptyState icon={Network} title={t('app.fTPServer.noActiveConnections', 'No active connections')} />}
                                    footer={(
                                        <DataTableFooter
                                            shown={connChrome.shownCount}
                                            total={connections.length}
                                            noun="connection"
                                        />
                                    )}
                                />

                                <GridFilterDrawer {...connChrome.drawerProps} />
                            </div>
                        </TabsContent>

                        <TabsContent value="logs">
                            <div className="logs-tab">
                                {/* No table here, so no view picker — a title
                                    and the one action, through the shared
                                    toolbar instead of a hand-rolled row. */}
                                <ListToolbar
                                    title={t('app.fTPServer.serverLogs', 'Server logs')}
                                    tools={(
                                        <Button variant="outline" onClick={loadLogs}>
                                            <RefreshCw size={14} />
                                            {t('common.actions.refresh', 'Refresh')}
                                        </Button>
                                    )}
                                />
                                <div className="log-viewer">
                                    <pre>{logs}</pre>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            )}

            {/* Install Modal */}
            <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)} title={t('app.fTPServer.installFtpServer', 'Install FTP server')}>
                            <div className="form-group">
                                <Label htmlFor="ftp-install-service">{t('app.fTPServer.selectFtpServer', 'Select FTP server')}</Label>
                                <Select value={selectedService} onValueChange={setSelectedService}>
                                    <SelectTrigger id="ftp-install-service"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="vsftpd">{t('app.fTPServer.vsftpdRecommended', 'vsftpd (recommended)')}</SelectItem>
                                        <SelectItem value="proftpd">{t('app.fTPServer.proftpd', 'ProFTPD')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="install-info">
                                {selectedService === 'vsftpd' ? (
                                    <p>
                                        <strong>vsftpd</strong> {t('app.fTPServer.isASecureFastAndStable', 'is a secure, fast, and stable FTP server. It\'s the default choice for most Ubuntu/Debian systems.')}
                                    </p>
                                ) : (
                                    <p>
                                        <strong>{t('app.fTPServer.proftpd', 'ProFTPD')}</strong> {t('app.fTPServer.isAHighlyConfigurableFtpServer', 'is a highly configurable FTP server with advanced features and Apache-like configuration syntax.')}
                                    </p>
                                )}
                            </div>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowInstallModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                onClick={handleInstall}
                                disabled={actionLoading}
                            >
                                {actionLoading ? t('app.fTPServer.installing', 'Installing…') : t('app.fTPServer.install', 'Install')}
                            </Button>
                        </div>
            </Modal>

            {/* Create User Modal */}
            <Modal open={showUserModal} onClose={() => setShowUserModal(false)} title={t('app.fTPServer.createFtpUser', 'New FTP user')}>
                            <div className="form-group">
                                <Label>{t('app.fTPServer.username2', 'Username *')}</Label>
                                <Input
                                    type="text"
                                    value={newUser.username}
                                    onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                                    placeholder="ftpuser"
                                />
                            </div>
                            <div className="form-group">
                                <Label>{t('app.fTPServer.passwordLeaveEmptyToAutoGenerate', 'Password (leave empty to auto-generate)')}</Label>
                                <Input
                                    type="password"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                    placeholder={t('app.fTPServer.autoGeneratedIfEmpty', 'Auto-generated if empty')}
                                />
                            </div>
                            <div className="form-group">
                                <Label>{t('app.fTPServer.homeDirectoryOptional', 'Home directory (optional)')}</Label>
                                <Input
                                    type="text"
                                    value={newUser.homeDir}
                                    onChange={(e) => setNewUser({ ...newUser, homeDir: e.target.value })}
                                    placeholder="/home/ftp/username"
                                />
                            </div>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowUserModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                onClick={handleCreateUser}
                                disabled={actionLoading || !newUser.username.trim()}
                            >
                                {actionLoading ? t('app.fTPServer.creating', 'Creating…') : t('app.fTPServer.createUser', 'Create user')}
                            </Button>
                        </div>
            </Modal>

            {/* Change Password Modal */}
            <Modal open={showPasswordModal} onClose={() => setShowPasswordModal(false)} title={t('app.fTPServer.changePassword', 'Change password')}>
                            <p>{t('app.fTPServer.changingPasswordForUser', 'Changing password for user:')} <strong>{passwordTarget}</strong></p>
                            <div className="form-group">
                                <Label>{t('app.fTPServer.newPasswordLeaveEmptyToAuto', 'New password (leave empty to auto-generate)')}</Label>
                                <Input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder={t('app.fTPServer.autoGeneratedIfEmpty', 'Auto-generated if empty')}
                                />
                            </div>
                        <div className="modal-actions">
                            <Button variant="outline" onClick={() => setShowPasswordModal(false)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </Button>
                            <Button
                                onClick={handleChangePassword}
                                disabled={actionLoading}
                            >
                                {actionLoading ? t('app.fTPServer.changing', 'Changing…') : t('app.fTPServer.changePassword', 'Change password')}
                            </Button>
                        </div>
            </Modal>

            {/* Confirm Dialog */}
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

export default FTPServer;
