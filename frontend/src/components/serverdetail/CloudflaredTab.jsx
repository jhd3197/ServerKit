import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, DataTableFooter, Pill } from '../ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import EmptyState from '../EmptyState';
import { Cloud } from 'lucide-react';
import Modal from '@/components/Modal';
import { Label } from '@/components/ui/label';
import CopyField from '@/components/CopyField';
import DomainField from '@/components/DomainField';
import { rooms } from '@/constants/events';
import { useTranslation } from 'react-i18next';
import {
    OfflineIcon,
    TrashIcon,
} from './serverDetailShared';

// CloudflaredTab — manage Cloudflare named tunnels via the agent.
//
// Auth model: the user runs `cloudflared tunnel login` once on the
// server. That writes ~/.cloudflared/cert.pem (or
// /etc/cloudflared/cert.pem when run as root). The panel never sees
// a Cloudflare API token — every action shells out to cloudflared
// using that cert. /status surfaces both "binary present" and
// "cert present" so we can show "log in first" before users hit
// CRUD actions and get confusing errors back.
// Built-in saved views. A tunnel row is { id, name, created_at?, connections[] }
// — cloudflared reports no status field of its own, so "is this thing carrying
// anything" IS the connection count, and the `state` column below is the only
// honest way to name it. Rules match that column's `value`, which is the same
// word the Pill renders.
const NO_RULES = { match: 'all', rules: [] };
const STATE_IS = (value) => ({
    match: 'all',
    rules: [{ id: 'cf1', field: 'state', op: 'any', value: [value] }],
});

const TUNNEL_VIEWS = [
    {
        // Everything, alphabetically — the landing view and the "nothing is
        // filtered" answer.
        name: 'All tunnels',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
        },
    },
    {
        // Tunnels with at least one edge connection: what is actually serving
        // traffic right now, busiest first.
        name: 'Connected',
        state: {
            sorts: [{ key: 'connections', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: STATE_IS('connected'),
        },
    },
    {
        // The cleanup list. A named tunnel with no connector attached is a
        // hostname that resolves to nothing — either the connector died or the
        // tunnel was created and never wired up.
        name: 'Idle',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: STATE_IS('idle'),
        },
    },
    {
        // "Which one did I just make?" — the question this tab's own Create
        // button leaves you with. Tunnels whose created_at the agent could not
        // read sort last: nulls always sink.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: NO_RULES,
        },
    },
];

const CloudflaredTab = ({ serverId, serverStatus }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm: confirmCf } = useConfirm();
    const [status, setStatus] = useState(null);
    const [tunnels, setTunnels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [createName, setCreateName] = useState('');
    const [creating, setCreating] = useState(false);

    const [showRouteModal, setShowRouteModal] = useState(false);
    const [routeTunnel, setRouteTunnel] = useState(null);
    const [routeHostname, setRouteHostname] = useState('');
    const [routing, setRouting] = useState(false);

    // Login flow: { channel, authUrl, status: 'starting'|'awaiting'|'done'|'error', error, certPath }
    const [login, setLogin] = useState(null);

    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-sd-cloudflared-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-sd-cloudflared-cols' });

    const loadStatus = useCallback(async () => {
        try {
            const s = await api.getRemoteCloudflaredStatus(serverId);
            setStatus(s);
        } catch (err) {
            console.error('Failed to load cloudflared status:', err);
        }
    }, [serverId]);

    const loadTunnels = useCallback(async () => {
        try {
            const data = await api.getRemoteCloudflaredTunnels(serverId);
            setTunnels(data?.tunnels || []);
            setError(null);
        } catch (err) {
            // Auth errors here are common when the user hasn't logged
            // in yet — the status banner already explains; don't show
            // a redundant scary alert.
            setError(err.message || 'Failed to load tunnels');
        }
    }, [serverId]);

    useEffect(() => {
        if (serverStatus !== 'online') {
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            setLoading(true);
            await loadStatus();
            await loadTunnels();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [serverStatus, loadStatus, loadTunnels]);

    async function handleCreate(e) {
        e.preventDefault();
        const name = createName.trim();
        if (!name) {
            toast.error(t('app.cloudflaredTab.nameIsRequired', 'Name is required'));
            return;
        }
        setCreating(true);
        try {
            await api.createRemoteCloudflaredTunnel(serverId, name);
            toast.success(t('app.cloudflaredTab.tunnelCreated', 'Tunnel "{{name}}" created', { name: name }));
            setShowCreateModal(false);
            setCreateName('');
            loadTunnels();
        } catch (err) {
            toast.error(err.message || t('app.cloudflaredTab.failedToCreateTunnel', 'Failed to create tunnel'));
        } finally {
            setCreating(false);
        }
    }

    async function handleRoute(e) {
        e.preventDefault();
        const hostname = routeHostname.trim();
        if (!hostname || !routeTunnel) return;
        setRouting(true);
        try {
            await api.routeRemoteCloudflaredTunnel(serverId, routeTunnel.id || routeTunnel.name, hostname);
            toast.success(`${hostname} → ${routeTunnel.name}`);
            setShowRouteModal(false);
            setRouteHostname('');
            setRouteTunnel(null);
        } catch (err) {
            toast.error(err.message || t('app.cloudflaredTab.failedToAddRoute', 'Failed to add route'));
        } finally {
            setRouting(false);
        }
    }

    async function handleDelete(tunnel) {
        const ok = await confirmCf({
            titleKey: 'app.cloudflaredTab.deleteTunnel', title: 'Delete tunnel',
            message: `Delete tunnel "${tunnel.name}"? Active connections will be force-closed.`,
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.deleteRemoteCloudflaredTunnel(serverId, tunnel.id || tunnel.name);
            toast.success(t('app.cloudflaredTab.tunnelDeleted', 'Tunnel deleted'));
            loadTunnels();
        } catch (err) {
            toast.error(err.message || t('app.cloudflaredTab.failedToDeleteTunnel', 'Failed to delete tunnel'));
        }
    }

    // Triggers `cloudflared tunnel login` on the agent and subscribes
    // to the streaming auth flow. The first event carries the auth URL
    // we surface as a clickable button; the final event flips us back
    // to ready state once cert.pem appears.
    async function handleStartLogin() {
        try {
            const res = await api.startRemoteCloudflaredLogin(serverId);
            const channel = res?.channel || `job:${res?.job_id}`;
            setLogin({ channel, status: 'starting', authUrl: null, error: null, certPath: null });

            // Reuse the live socket service to subscribe to the
            // server_stream room. We don't open the JobProgressModal
            // because the login flow needs a different shape (a single
            // big "Open URL" CTA, not a log tail).
            const { joinServerStream } = await import('../../hooks/useServerStream');
            const room = rooms.serverChannel(serverId, channel);
            let stopStream = () => {};
            const onStream = (msg) => {
                if (msg?.channel !== channel) return;
                const ev = msg.data || {};
                const url = ev?.extra?.auth_url;
                if (url) {
                    setLogin((cur) => cur ? { ...cur, status: 'awaiting', authUrl: url } : cur);
                }
                if (ev.phase === 'done') {
                    if (ev.error) {
                        setLogin((cur) => cur ? { ...cur, status: 'error', error: ev.error } : cur);
                        toast.error(t('app.cloudflaredTab.loginFailed', 'Login failed: {{error}}', { error: ev.error }));
                    } else {
                        setLogin((cur) => cur ? { ...cur, status: 'done', certPath: ev?.extra?.cert_path } : cur);
                        toast.success(t('app.cloudflaredTab.cloudflareLoginComplete', 'Cloudflare login complete'));
                        // Refresh capabilities + status so the tab unlocks
                        // without a manual reload.
                        api.refreshRemoteCapabilities(serverId).catch(() => {});
                        loadStatus();
                        loadTunnels();
                    }
                    stopStream();
                }
            };
            stopStream = joinServerStream(room, 'server_stream', onStream);
        } catch (err) {
            toast.error(err.message || t('app.cloudflaredTab.failedToStartLogin', 'Failed to start login'));
            setLogin(null);
        }
    }

    function handleCancelLogin() {
        setLogin(null);
    }

    // Tunnels table columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace so the .cron-tab__* / .data-table SCSS
    // keeps applying.
    //
    // Declared above the offline/loading guards: the chrome below is a hook, so
    // it cannot sit behind an early return.
    const tunnelColumns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (t) => t.name || '',
            sortValue: (t) => t.name || '',
            render: (t) => <span className="cron-tab__name">{t.name}</span>,
        },
        {
            key: 'id',
            header: 'ID',
            // The cell shows the first 8 chars, but a rule reads the whole
            // UUID: pasting one out of a cloudflared log should find its row.
            type: 'text',
            value: (t) => t.id || '',
            cellClassName: 'mono',
            render: (t) => `${(t.id || '').substring(0, 8)}…`,
        },
        {
            // Its own column rather than a pill tacked onto Connections:
            // "is this tunnel carrying anything" is the question this table
            // exists to answer, and cloudflared reports no status field to read
            // it from — the connector count IS the status. Declared enum, not
            // inferred: two tunnels in the same state fail the cardinality test
            // and would fall back to text, which turns the pick-list into a
            // typed fragment and both views above into no-ops.
            key: 'state',
            headerKey: 'common.labels.state', header: 'State',
            sortable: true,
            type: 'enum',
            enumOrder: ['connected', 'idle'],
            value: (t) => (t.connections?.length ? 'connected' : 'idle'),
            sortValue: (t) => (t.connections?.length ? 'connected' : 'idle'),
            render: (t) => (
                <Pill kind={t.connections?.length ? 'green' : 'gray'}>
                    {t.connections?.length ? 'connected' : 'idle'}
                </Pill>
            ),
        },
        {
            key: 'connections',
            headerKey: 'app.cloudflaredTab.connections', header: 'Connections',
            sortable: true,
            type: 'num',
            value: (t) => t.connections?.length ?? 0,
            sortValue: (t) => t.connections?.length ?? 0,
            render: (t) => t.connections?.length || 0,
        },
        {
            // `created_at` is omitempty on the agent's Tunnel struct, so a row
            // may legitimately carry none — hence the em dash. Declared date
            // rather than inferred from the epoch `sortValue`, or the menu
            // would offer "is under 1754…" instead of a date picker.
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            type: 'date',
            value: (t) => t.created_at || null,
            sortValue: (t) => {
                const time = Date.parse(t.created_at);
                return Number.isNaN(time) ? null : time;
            },
            cellClassName: 'mono',
            render: (t) => (t.created_at ? new Date(t.created_at).toLocaleString() : '—'),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            className: 'actions-cell',
            cellClassName: 'actions-cell',
            render: (t) => (
                <>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setRouteTunnel(t); setShowRouteModal(true); }}
                    >
                        {t('app.cloudflaredTab.routeSubdomain', 'Route subdomain')}
                    </Button>
                    <Button variant="unstyled" type="button"
                        className="btn-icon danger"
                        onClick={() => handleDelete(t)}
                        title={t('common.actions.delete', 'Delete')}
                    >
                        <TrashIcon />
                    </Button>
                </>
            ),
        },
    ];

    // Scoped to this tab, not to the server as a page: one tab is mounted at a
    // time, so a picker at the page heading would sit above whichever tab
    // happened to be open. No `urlScope` — the tunnels table is the only one on
    // this tab, so its links keep the plain ?view= names.
    const chrome = useTableChrome({
        columns: tunnelColumns,
        rows: tunnels,
        viewPageKey: 'serverdetail-tunnels',
        builtinViews: TUNNEL_VIEWS,
        noun: 'tunnels',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>{t('app.cloudflaredTab.serverOffline', 'Server offline')}</h4>
                <p>{t('app.cloudflaredTab.tunnelManagementRequiresTheServerTo', 'Tunnel management requires the server to be online.')}</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading loadingVariant="table" title={t('app.cloudflaredTab.loadingTunnels', 'Loading tunnels')} />;
    }

    // Status banner — three distinct states the UI cares about:
    //   1. binary missing      → "install cloudflared"
    //   2. binary, no cert     → "log in once"
    //   3. binary + cert       → ready to manage tunnels
    const notInstalled = status?.available === false;
    const notAuthed = status?.available && status?.authenticated === false;

    return (
        <div className="cloudflared-tab">
            <div className="cron-tab__header">
                <div className="cron-tab__status">
                    {notInstalled ? (
                        <Pill kind="amber">{t('app.cloudflaredTab.cloudflaredNotInstalled', 'cloudflared not installed')}</Pill>
                    ) : notAuthed ? (
                        <Pill kind="amber">{t('app.cloudflaredTab.notAuthenticatedRunCloudflaredTunnelLogin', 'not authenticated: run cloudflared tunnel login')}</Pill>
                    ) : (
                        <Pill kind="green">{t('app.cloudflaredTab.cloudflaredReady', 'cloudflared ready')}{status?.version ? ` (${status.version})` : ''}</Pill>
                    )}
                    {/* No tunnel count here — the table footer reports it,
                        under the rows it is counting. */}
                </div>
                <div className="cron-tab__actions">
                    <Button variant="outline" onClick={loadTunnels} disabled={notInstalled}>{t('common.actions.refresh', 'Refresh')}</Button>
                    <Button onClick={() => setShowCreateModal(true)} disabled={notInstalled || notAuthed}>
                        {t('app.cloudflaredTab.createTunnel', 'Create tunnel')}
                    </Button>
                </div>
            </div>

            {(notInstalled || notAuthed) && (
                <div className="cloudflared-tab__hint">
                    {notInstalled ? (
                        <>
                            {t('app.cloudflaredTab.installCloudflaredOnTheServerThen', 'Install cloudflared on the server, then return here. See the')}{' '}
                            <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/" target="_blank" rel="noreferrer">
                                {t('app.cloudflaredTab.cloudflareDocs', 'Cloudflare docs')}
                            </a>.
                        </>
                    ) : login ? (
                        <CloudflaredLoginCard login={login} onCancel={handleCancelLogin} />
                    ) : (
                        <div className="cloudflared-login-prompt">
                            <p>
                                {t('app.cloudflaredTab.cloudflareNeedsYouToAuthoriseThis', 'Cloudflare needs you to authorise this agent once. Click')}{' '}
                                <strong>{t('app.cloudflaredTab.login', 'Login')}</strong> {t('app.cloudflaredTab.belowWeLlStartTheOauth', "below. We'll start the OAuth flow on the server and surface the URL for you to open in your browser. Once you authorise, the agent picks up the cert.pem automatically and the rest of this tab unlocks.")}
                            </p>
                            <Button onClick={handleStartLogin}>{t('app.cloudflaredTab.loginToCloudflare', 'Login to Cloudflare')}</Button>
                        </div>
                    )}
                </div>
            )}

            {error && !notAuthed && !notInstalled && (
                <div className="alert alert-danger">{error}</div>
            )}

            {!notInstalled && !notAuthed && (
                tunnels.length === 0 ? (
                    <EmptyState
                        icon={Cloud}
                        title={t('app.cloudflaredTab.noTunnels', 'No tunnels')}
                        description={t('app.cloudflaredTab.noTunnelsOnThisServerUse', 'No tunnels on this server. Use Create tunnel to make one.')}
                    />
                ) : (
                    <>
                        {/* One row of chrome: the view name is the heading, and
                            the filter button and "⋮" ride it rather than a
                            second bar that would hold nothing else. */}
                        <GridViewPicker
                            views={chrome.views}
                            label="tunnels"
                            onCreate={chrome.createView}
                            actions={(
                                <>
                                    <GridFilterButton
                                        count={chrome.filterCount}
                                        onClick={() => chrome.setDrawerOpen(true)}
                                    />
                                    <GridToolsMenu {...chrome.toolsProps} onRefresh={loadTunnels} />
                                </>
                            )}
                        />

                        <GridChips {...chrome.chipProps} />

                        <DataTable
                            columns={chrome.columns}
                            data={tunnels}
                            keyField={(t) => t.id || t.name}
                            sorts={sorts}
                            onSortsChange={setSorts}
                            {...chrome.tableProps}
                            tableClassName="data-table"
                            emptyTitle="No tunnels match this view."
                            emptyMessage=""
                            footer={(
                                <DataTableFooter
                                    // DataTable applies the column rules itself,
                                    // so the shown count comes from the chrome —
                                    // `tunnels` is only ever the whole list.
                                    shown={chrome.shownCount}
                                    total={tunnels.length}
                                    noun="tunnel"
                                />
                            )}
                        />
                    </>
                )
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            <Modal
                open={showCreateModal}
                onClose={() => { if (!creating) setShowCreateModal(false); }}
                title={t('app.cloudflaredTab.createTunnel', 'Create tunnel')}
            >
                <p className="sk-modal__subtitle">
                    {t('app.cloudflaredTab.provisionsANewCloudflareTunnelOn', 'Provisions a new Cloudflare Tunnel on this server.')}
                </p>
                <form onSubmit={handleCreate} className="sk-form-stack">
                        <div className="sk-form-field">
                            <Label htmlFor="cf-name">{t('app.cloudflaredTab.tunnelName', 'Tunnel name')}</Label>
                            <Input
                                id="cf-name"
                                value={createName}
                                onChange={(e) => setCreateName(e.target.value)}
                                placeholder="my-app"
                                required
                                autoFocus
                            />
                            <p className="sk-form-hint">{t('app.cloudflaredTab.lettersNumbersDashesUnderscoresUpTo', 'Letters, numbers, dashes, underscores. Up to 32 chars.')}</p>
                        </div>
                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} disabled={creating}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
                        </div>
                    </form>
            </Modal>

            <Modal
                open={showRouteModal && !!routeTunnel}
                onClose={() => { if (!routing) setShowRouteModal(false); }}
                title={t('app.cloudflaredTab.routeSubdomain2', 'Route Subdomain{{value}}', { value: routeTunnel ? ` → ${routeTunnel.name}` : '' })}
            >
                <p className="sk-modal__subtitle">
                    {t('app.cloudflaredTab.aCnameForThisHostnameWill', 'A CNAME for this hostname will be created in Cloudflare DNS, pointing at the tunnel.')}
                </p>
                <form onSubmit={handleRoute} className="sk-form-stack">
                        <div className="sk-form-field">
                            <Label htmlFor="cf-host">{t('app.cloudflaredTab.hostname', 'Hostname')}</Label>
                            <DomainField
                                id="cf-host"
                                modes={['custom']}
                                value={routeHostname}
                                onChange={setRouteHostname}
                                hint={(name) => t('app.cloudflaredTab.routeCreatesRecord', 'Adding the route creates the Cloudflare DNS record for {{name}}.', { name })}
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={() => setShowRouteModal(false)} disabled={routing}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button type="submit" disabled={routing || !routeHostname}>{routing ? 'Adding…' : 'Add Route'}</Button>
                        </div>
                    </form>
            </Modal>
        </div>
    );
};

// CloudflaredLoginCard renders the in-flight OAuth login state. The
// agent has spawned `cloudflared tunnel login` on the server and is
// streaming progress on a job channel; we render either a spinner
// (while we wait for the URL), the Open-in-Browser CTA (once the URL
// arrives), or a final success/error message.
const CloudflaredLoginCard = ({ login, onCancel }) => {
    const { t } = useTranslation();
    if (!login) return null;
    if (login.status === 'starting') {
        return (
            <div className="cloudflared-login-card">
                <p>{t('app.cloudflaredTab.askingTheAgentToStartThe', 'Asking the agent to start the Cloudflare login flow…')}</p>
                <Button variant="outline" size="sm" onClick={onCancel}>{t('common.actions.cancel', 'Cancel')}</Button>
            </div>
        );
    }
    if (login.status === 'awaiting' && login.authUrl) {
        return (
            <div className="cloudflared-login-card">
                <p>
                    <strong>{t('app.cloudflaredTab.step12', 'Step 1 / 2:')}</strong> {t('app.cloudflaredTab.openTheFollowingUrlInYour', 'open the following URL in your browser, sign in to Cloudflare, and pick the zone you want to associate with this agent.')}
                </p>
                <CopyField value={login.authUrl} />
                <div className="cloudflared-login-card__actions">
                    <a
                        href={login.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary"
                    >
                        {t('app.cloudflaredTab.openCloudflareLogin', 'Open Cloudflare login')}
                    </a>
                </div>
                <p className="cloudflared-login-card__hint">
                    <strong>{t('app.cloudflaredTab.step22', 'Step 2 / 2:')}</strong> {t('app.cloudflaredTab.waitingForTheAgentToReceive', 'waiting for the agent to receive cert.pem from Cloudflare. This page will refresh automatically once authorisation completes.')}
                </p>
                <Button variant="outline" size="sm" onClick={onCancel}>{t('common.actions.cancel', 'Cancel')}</Button>
            </div>
        );
    }
    if (login.status === 'done') {
        return (
            <div className="cloudflared-login-card cloudflared-login-card--success">
                {t('app.cloudflaredTab.authenticatedRefreshing', 'Authenticated. Refreshing…')}
            </div>
        );
    }
    if (login.status === 'error') {
        return (
            <div className="cloudflared-login-card cloudflared-login-card--error">
                <strong>{t('app.cloudflaredTab.loginFailed2', 'Login failed:')}</strong> {login.error || 'unknown error'}
                <Button variant="outline" size="sm" onClick={onCancel}>{t('common.actions.dismiss', 'Dismiss')}</Button>
            </div>
        );
    }
    return null;
};

export default CloudflaredTab;
