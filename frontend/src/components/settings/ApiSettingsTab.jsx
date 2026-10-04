import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import api from '../../services/api';
import useSettingFocus from '../../hooks/useSettingFocus';
import ApiKeyModal from './ApiKeyModal';
import WebhookSubscriptionModal from './WebhookSubscriptionModal';
import {
    Key, Plus, Trash2, RotateCcw, Activity, AlertCircle,
    Check, Send, ChevronDown, ChevronUp, Zap, BarChart3, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Pill } from '@/components/ds/Pill';
import { DataTable, DataTableFooter } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import EmptyState from '../EmptyState';
import { useConfirm } from '@/hooks/useConfirm';
import { useTranslation } from 'react-i18next';

const ApiSettingsTab = () => {
    const { isAdmin } = useAuth();

    return (
        <div className="api-settings">
            <ApiKeysSection />
            {isAdmin && <RateLimitsSection />}
            <WebhookSection />
            {isAdmin && <AnalyticsSection />}
        </div>
    );
};

// ─── API Keys Section ──────────────────────────────────

// The label the Status cell shows. A key is live only while it is active AND
// un-revoked, so the view's rule has to read the same pair the badge does.
const keyStatus = (key) => (key.is_active && !key.revoked_at ? 'Active' : 'Revoked');

// Built-in saved views for the API keys table. Only this table gets them: the
// webhook deliveries list and the top-endpoints summary further down are a
// drill-down and a readout, not surfaces you come back to and narrow.
const API_KEY_VIEWS = [
    {
        // What is actually live. Revoked keys are never deleted, so on an
        // instance that has been running a while they are most of the table.
        // Least recently used first — a live key nobody calls is one to ask
        // about.
        name: 'Active keys',
        state: {
            sorts: [{ key: 'lastUsed', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'kv1', field: 'status', op: 'any', value: ['Active'] }],
            },
        },
    },
    {
        // The security review: which keys can call everything. `is` rather
        // than `contains` because the value is the joined scope list, and
        // `contains '*'` would also catch a key scoped to `domains:*`.
        name: 'Full access',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'kv2', field: 'scopes', op: 'is', value: '*' }],
            },
        },
    },
    {
        // The audit trail. Rotations and revocations pile up here; most
        // recently used first, because that is the one whose blast radius you
        // are trying to remember.
        name: 'Revoked',
        state: {
            sorts: [{ key: 'lastUsed', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'kv3', field: 'status', op: 'any', value: ['Revoked'] }],
            },
        },
    },
];

const ApiKeysSection = () => {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const register = useSettingFocus();
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [createdKey, setCreatedKey] = useState(null);

    // Lifted out of <DataTable> so a saved view can capture them. The storage
    // keys are the ones DataTable derived from storageKey="serverkit-table-
    // settings-api-keys", so a persisted sort or hidden column survives.
    const { sorts, setSorts } = useTableSort({
        storageKey: 'serverkit-table-settings-api-keys-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-settings-api-keys-cols',
    });

    const loadKeys = () => {
        setLoading(true);
        api.getApiKeys().then(data => {
            setKeys(data.api_keys || []);
        }).catch(() => {}).finally(() => setLoading(false));
    };

    useEffect(() => { loadKeys(); }, []);

    const handleCreate = async (data) => {
        const result = await api.createApiKey(data);
        setCreatedKey(result.raw_key);
        loadKeys();
    };

    const handleRevoke = async (keyId) => {
        if (!await confirm({
            title: t('app.apiSettingsTab.revokeApiKey', 'Revoke API key'),
            message: t('app.apiSettingsTab.revokeThisApiKeyThisCannot', 'Revoke this API key? This cannot be undone.'),
            confirmText: t('app.apiSettingsTab.revokeKey', 'Revoke key'),
        })) return;
        await api.revokeApiKey(keyId);
        loadKeys();
    };

    const handleRotate = async (keyId) => {
        if (!await confirm({
            title: t('app.apiSettingsTab.rotateApiKey', 'Rotate API key'),
            message: t('app.apiSettingsTab.rotateThisKeyTheOldKey', 'Rotate this key? The old key will stop working immediately.'),
            confirmText: t('app.apiSettingsTab.rotateKey', 'Rotate key'),
            variant: 'warning',
        })) return;
        const result = await api.rotateApiKey(keyId);
        setCreatedKey(result.raw_key);
        setShowModal(true);
        loadKeys();
    };

    const closeModal = () => {
        setShowModal(false);
        setCreatedKey(null);
    };

    // Columns for the shared DataTable. Cell markup and classNames are
    // identical to the hand-rolled table they replace, so _api-settings.scss
    // keeps applying (.api-settings__key-name, __key-prefix, __scopes,
    // __muted, __actions).
    //
    // `type` + `value` are declared on every column a built-in view reads.
    // Two of them would otherwise be typed from the wrong thing: Last Used has
    // a `sortValue` of epoch ms, which inference would call numeric, and
    // Scopes and Status render from fields no accessor exposed at all, so they
    // were not filterable in any way.
    const keyColumns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (key) => key.name || '',
            sortValue: (key) => key.name || '',
            cellClassName: 'api-settings__key-name',
            render: (key) => key.name,
        },
        {
            key: 'key',
            headerKey: 'common.labels.key', header: 'Key',
            // Searchable by prefix: that is the only part of a key that ever
            // appears again after creation, so it is how a log line gets
            // matched back to a row here.
            type: 'text',
            value: (key) => key.key_prefix || '',
            render: (key) => <code className="api-settings__key-prefix">{key.key_prefix}...</code>,
        },
        {
            key: 'scopes',
            headerKey: 'app.apiSettingsTab.scopes', header: 'Scopes',
            // The joined list, so "contains domains" finds every key that can
            // touch domains and "is *" finds exactly the full-access ones.
            type: 'text',
            value: (key) => (key.scopes || []).join(', '),
            render: (key) => (
                <div className="api-settings__scopes">
                    {(!key.scopes || key.scopes.length === 0) ? (
                        <span className="api-settings__muted">{t('app.apiSettingsTab.none', 'None')}</span>
                    ) : key.scopes.includes('*') ? (
                        <Pill kind="violet">{t('app.apiSettingsTab.fullAccess', 'Full access')}</Pill>
                    ) : (
                        <>
                            {key.scopes.slice(0, 3).map(s => (
                                <Pill key={s} kind="cyan" dot={false}>{s}</Pill>
                            ))}
                            {key.scopes.length > 3 && (
                                <Pill kind="gray" dot={false}>+{key.scopes.length - 3}</Pill>
                            )}
                        </>
                    )}
                </div>
            ),
        },
        {
            key: 'tier',
            headerKey: 'app.apiSettingsTab.tier', header: 'Tier',
            type: 'enum',
            value: (key) => key.tier || '',
            render: (key) => <Badge variant="outline">{key.tier}</Badge>,
        },
        {
            key: 'lastUsed',
            headerKey: 'app.apiSettingsTab.lastUsed', header: 'Last used',
            sortable: true,
            type: 'date',
            value: (key) => key.last_used_at || null,
            sortValue: (key) => (key.last_used_at ? new Date(key.last_used_at).getTime() : null),
            cellClassName: 'api-settings__muted',
            render: (key) => (
                key.last_used_at
                    ? new Date(key.last_used_at).toLocaleDateString()
                    : 'Never'
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            type: 'enum',
            value: keyStatus,
            sortValue: keyStatus,
            render: (key) => (
                keyStatus(key) === 'Active' ? (
                    <Badge variant="success">{t('app.apiSettingsTab.active', 'Active')}</Badge>
                ) : (
                    <Badge variant="destructive">{t('app.apiSettingsTab.revoked', 'Revoked')}</Badge>
                )
            ),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'api-settings__actions',
            render: (key) => (
                key.is_active && !key.revoked_at && (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRotate(key.id)}
                            title={t('app.apiSettingsTab.rotate', 'Rotate')}
                        >
                            <RotateCcw size={14} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(key.id)}
                            title={t('app.apiSettingsTab.revoke', 'Revoke')}
                            className="api-settings__revoke"
                        >
                            <Trash2 size={14} />
                        </Button>
                    </>
                )
            ),
        },
    ];

    // This tab renders three tables, so the link params are namespaced — the
    // deliveries and top-endpoints tables below have no chrome today, but an
    // unscoped `?view=` here would be theirs to collide with the moment one
    // did. No `pageState`: the section has no search or filter of its own.
    const chrome = useTableChrome({
        columns: keyColumns,
        rows: keys,
        viewPageKey: 'settings-api-keys',
        urlScope: 'keys',
        builtinViews: API_KEY_VIEWS,
        noun: 'keys',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    return (
        <div {...register('api-keys', 'settings-card')}>
            <GridViewPicker
                views={chrome.views}
                label="keys"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <Button variant="default" size="sm" onClick={() => setShowModal(true)}>
                            <Plus size={14} /> {t('app.apiSettingsTab.createKey', 'Create key')}
                        </Button>
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadKeys} />
                    </>
                )}
            />
            <GridChips {...chrome.chipProps} />

            {loading ? (
                <div className="settings-card__loading">{t('common.loading', 'Loading…')}</div>
            ) : keys.length === 0 ? (
                <EmptyState
                    icon={Key}
                    title={t('app.apiSettingsTab.noApiKeysYet', 'No API keys yet.')}
                    description={t('app.apiSettingsTab.createOneToGetStarted', 'Create a key to access the API.')}
                />
            ) : (
                <div className="api-settings__table-wrap">
                    <DataTable
                        columns={chrome.columns}
                        data={keys}
                        keyField="id"
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        tableClassName="api-settings__table"
                    />
                </div>
            )}

            {(showModal || createdKey) && (
                <ApiKeyModal
                    onClose={closeModal}
                    onSubmit={handleCreate}
                    createdKey={createdKey}
                />
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

// ─── Rate Limits Section ───────────────────────────────
const RateLimitsSection = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const [limits, setLimits] = useState({
        rate_limit_standard: '100 per minute',
        rate_limit_elevated: '500 per minute',
        rate_limit_unlimited: '5000 per minute',
        rate_limit_unauthenticated: '30 per minute',
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        api.getSystemSettings().then(data => {
            setLimits(prev => ({
                rate_limit_standard: data.rate_limit_standard || prev.rate_limit_standard,
                rate_limit_elevated: data.rate_limit_elevated || prev.rate_limit_elevated,
                rate_limit_unlimited: data.rate_limit_unlimited || prev.rate_limit_unlimited,
                rate_limit_unauthenticated: data.rate_limit_unauthenticated || prev.rate_limit_unauthenticated,
            }));
        }).catch(() => {});
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            for (const [key, value] of Object.entries(limits)) {
                await api.updateSystemSetting(key, value);
            }
            setMessage({ type: 'success', text: 'Rate limits updated' });
        } catch {
            setMessage({ type: 'error', text: 'Failed to update rate limits' });
        } finally {
            setSaving(false);
        }
    };

    const labels = {
        rate_limit_standard: 'Standard Tier',
        rate_limit_elevated: 'Elevated Tier',
        rate_limit_unlimited: 'Unlimited Tier',
        rate_limit_unauthenticated: 'Unauthenticated',
    };

    return (
        <div {...register('api-rate-limits', 'settings-card')}>
            <div className="settings-card__header">
                <div className="settings-card__header-left">
                    <Activity size={20} />
                    <div>
                        <h3>{t('app.apiSettingsTab.rateLimits', 'Rate limits')}</h3>
                        <p>{t('app.apiSettingsTab.configureRequestRateLimitsByTier', 'Configure request rate limits by tier')}</p>
                    </div>
                </div>
            </div>

            {message && (
                <div className={`alert alert--${message.type}`}>
                    {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
                    {message.text}
                </div>
            )}

            <div className="api-settings__rate-limits">
                {Object.entries(limits).map(([key, value]) => (
                    <div key={key} className="form-group form-group--inline">
                        <Label>{labels[key]}</Label>
                        <Input
                            type="text"
                            value={value}
                            onChange={e => setLimits(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={t('app.apiSettingsTab.eG100PerMinute', 'e.g. 100 per minute')}
                        />
                    </div>
                ))}
            </div>

            <div className="settings-card__footer">
                <Button variant="default" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Rate Limits'}
                </Button>
            </div>
        </div>
    );
};

// ─── Webhook Subscriptions Section ─────────────────────

// Columns for the deliveries DataTable (compact variant). Cell markup is
// identical to the hand-rolled table it replaces.
const DELIVERY_COLUMNS = [
    {
        key: 'event',
        headerKey: 'app.apiSettingsTab.event', header: 'Event',
        sortable: true,
        hideable: false,
        sortValue: (d) => d.event_type || '',
        render: (d) => <code>{d.event_type}</code>,
    },
    {
        key: 'status',
        headerKey: 'common.labels.status', header: 'Status',
        sortable: true,
        sortValue: (d) => d.status || '',
        render: (d) => (
            <Badge variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'destructive' : 'warning'}>
                {d.status}
            </Badge>
        ),
    },
    {
        key: 'http',
        header: 'HTTP',
        sortable: true,
        sortValue: (d) => d.http_status ?? null,
        render: (d) => d.http_status || '-',
    },
    {
        key: 'duration',
        headerKey: 'common.labels.duration', header: 'Duration',
        sortable: true,
        sortValue: (d) => d.duration_ms ?? null,
        render: (d) => (d.duration_ms ? `${d.duration_ms}ms` : '-'),
    },
    {
        key: 'time',
        headerKey: 'common.labels.time', header: 'Time',
        sortable: true,
        sortValue: (d) => (d.created_at ? new Date(d.created_at).getTime() : null),
        cellClassName: 'api-settings__muted',
        render: (d) => (d.created_at ? new Date(d.created_at).toLocaleString() : '-'),
    },
];

const WebhookSection = () => {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const register = useSettingFocus();
    const [subscriptions, setSubscriptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingSub, setEditingSub] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [deliveries, setDeliveries] = useState({});

    const loadSubscriptions = () => {
        setLoading(true);
        api.getEventSubscriptions().then(data => {
            setSubscriptions(data.subscriptions || []);
        }).catch(() => {}).finally(() => setLoading(false));
    };

    useEffect(() => { loadSubscriptions(); }, []);

    const handleCreate = async (data) => {
        await api.createEventSubscription(data);
        setShowModal(false);
        loadSubscriptions();
    };

    const handleUpdate = async (data) => {
        await api.updateEventSubscription(editingSub.id, data);
        setEditingSub(null);
        loadSubscriptions();
    };

    const handleDelete = async (id) => {
        if (!await confirm({
            title: t('app.apiSettingsTab.deleteWebhookSubscription', 'Delete webhook subscription'),
            message: t('app.apiSettingsTab.deleteThisSubscription', 'Delete this subscription?'),
            confirmText: t('app.apiSettingsTab.deleteSubscription', 'Delete subscription'),
        })) return;
        await api.deleteEventSubscription(id);
        loadSubscriptions();
    };

    const handleTest = async (id) => {
        try {
            await api.testEventSubscription(id);
            loadDeliveries(id);
        } catch { /* ignore */ }
    };

    const loadDeliveries = async (id) => {
        try {
            const data = await api.getEventDeliveries(id);
            setDeliveries(prev => ({ ...prev, [id]: data.deliveries || [] }));
        } catch { /* ignore */ }
    };

    const toggleExpand = (id) => {
        if (expandedId === id) {
            setExpandedId(null);
        } else {
            setExpandedId(id);
            if (!deliveries[id]) loadDeliveries(id);
        }
    };

    return (
        <div {...register('api-webhooks', 'settings-card')}>
            <div className="settings-card__header">
                <div className="settings-card__header-left">
                    <Zap size={20} />
                    <div>
                        <h3>{t('app.apiSettingsTab.webhookSubscriptions', 'Webhook subscriptions')}</h3>
                        <p>{t('app.apiSettingsTab.receiveHttpNotificationsWhenEventsOccur', 'Receive HTTP notifications when events occur')}</p>
                    </div>
                </div>
                <Button variant="default" size="sm" onClick={() => setShowModal(true)}>
                    <Plus size={14} /> {t('app.apiSettingsTab.addWebhook', 'Add webhook')}
                </Button>
            </div>

            {loading ? (
                <div className="settings-card__loading">{t('common.loading', 'Loading…')}</div>
            ) : subscriptions.length === 0 ? (
                <EmptyState
                    icon={Zap}
                    title={t('app.apiSettingsTab.noWebhookSubscriptions', 'No webhook subscriptions.')}
                    description={t('app.apiSettingsTab.createOneToGetNotifiedOf', 'Create one to get notified of events.')}
                />
            ) : (
                <div className="api-settings__webhooks">
                    {subscriptions.map(sub => (
                        <div key={sub.id} className="api-settings__webhook-card">
                            <div className="api-settings__webhook-header" onClick={() => toggleExpand(sub.id)}>
                                <div className="api-settings__webhook-info">
                                    <span className="api-settings__webhook-name">{sub.name}</span>
                                    <span className="api-settings__webhook-url">{sub.url}</span>
                                    <div className="api-settings__webhook-events">
                                        {sub.events.slice(0, 3).map(e => (
                                            <Badge key={e} variant="secondary">{e}</Badge>
                                        ))}
                                        {sub.events.length > 3 && (
                                            <Badge variant="secondary">+{sub.events.length - 3}</Badge>
                                        )}
                                    </div>
                                </div>
                                <div className="api-settings__webhook-controls">
                                    <Badge variant={sub.is_active ? 'success' : 'destructive'}>
                                        {sub.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                    {expandedId === sub.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </div>
                            </div>
                            {expandedId === sub.id && (
                                <div className="api-settings__webhook-details">
                                    <div className="api-settings__webhook-actions">
                                        <Button variant="outline" size="sm" onClick={() => handleTest(sub.id)}>
                                            <Send size={14} /> {t('common.actions.test', 'Test')}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => setEditingSub(sub)}>
                                            {t('common.actions.edit', 'Edit')}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(sub.id)}
                                            className="api-settings__revoke"
                                        >
                                            <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => loadDeliveries(sub.id)}>
                                            <RefreshCw size={14} />
                                        </Button>
                                    </div>
                                    {deliveries[sub.id] && (
                                        <div className="api-settings__deliveries">
                                            <h4>{t('app.apiSettingsTab.recentDeliveries', 'Recent deliveries')}</h4>
                                            {deliveries[sub.id].length === 0 ? (
                                                <p className="api-settings__muted">{t('app.apiSettingsTab.noDeliveriesYet', 'No deliveries yet')}</p>
                                            ) : (
                                                <DataTable
                                                    columns={DELIVERY_COLUMNS}
                                                    data={deliveries[sub.id].slice(0, 10)}
                                                    keyField="id"
                                                    storageKey="serverkit-table-settings-webhook-deliveries"
                                                    tableClassName="api-settings__table api-settings__table--compact"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showModal && (
                <WebhookSubscriptionModal
                    onClose={() => setShowModal(false)}
                    onSubmit={handleCreate}
                />
            )}
            {editingSub && (
                <WebhookSubscriptionModal
                    subscription={editingSub}
                    onClose={() => setEditingSub(null)}
                    onSubmit={handleUpdate}
                />
            )}
        </div>
    );
};

// ─── Analytics Section ─────────────────────────────────

// Columns for the top-endpoints DataTable (compact variant). Cell markup is
// identical to the hand-rolled table it replaces.
const ENDPOINT_COLUMNS = [
    {
        key: 'method',
        headerKey: 'app.apiSettingsTab.method', header: 'Method',
        sortable: true,
        hideable: false,
        sortValue: (ep) => ep.method || '',
        render: (ep) => <Badge variant="outline">{ep.method}</Badge>,
    },
    {
        key: 'endpoint',
        headerKey: 'app.apiSettingsTab.endpoint', header: 'Endpoint',
        sortable: true,
        sortValue: (ep) => ep.endpoint || '',
        render: (ep) => <code>{ep.endpoint}</code>,
    },
    {
        key: 'requests',
        headerKey: 'app.apiSettingsTab.requests', header: 'Requests',
        sortable: true,
        sortValue: (ep) => ep.count ?? null,
        render: (ep) => ep.count.toLocaleString(),
    },
    {
        key: 'avgTime',
        headerKey: 'app.apiSettingsTab.avgTime', header: 'Avg time',
        sortable: true,
        sortValue: (ep) => ep.avg_response_time_ms ?? null,
        render: (ep) => `${ep.avg_response_time_ms}ms`,
    },
    {
        key: 'errors',
        headerKey: 'app.apiSettingsTab.errors', header: 'Errors',
        sortable: true,
        sortValue: (ep) => ep.error_count ?? null,
        render: (ep) => (ep.error_count > 0 ? <span className="api-settings__error-count">{ep.error_count}</span> : '-'),
    },
];

const AnalyticsSection = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const [overview, setOverview] = useState(null);
    const [endpoints, setEndpoints] = useState([]);
    const [timeseries, setTimeseries] = useState([]);
    const [period, setPeriod] = useState('24h');
    const [loading, setLoading] = useState(true);

    const loadData = useCallback(() => {
        setLoading(true);
        Promise.all([
            api.getApiAnalyticsOverview(period),
            api.getApiAnalyticsEndpoints(period),
            api.getApiAnalyticsTimeseries(period),
        ]).then(([ov, ep, ts]) => {
            setOverview(ov);
            setEndpoints(ep.endpoints || []);
            setTimeseries(ts.data || []);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [period]);

    useEffect(() => { loadData(); }, [loadData]);

    const maxCount = Math.max(...timeseries.map(d => d.count), 1);

    return (
        <div {...register('api-analytics', 'settings-card')}>
            <div className="settings-card__header">
                <div className="settings-card__header-left">
                    <BarChart3 size={20} />
                    <div>
                        <h3>{t('app.apiSettingsTab.apiUsageAnalytics', 'API usage analytics')}</h3>
                        <p>{t('app.apiSettingsTab.monitorApiTrafficResponseTimesAnd', 'Monitor API traffic, response times, and errors')}</p>
                    </div>
                </div>
                <div className="api-settings__period-select">
                    {['1h', '24h', '7d', '30d'].map(p => (
                        <Button
                            key={p}
                            size="sm"
                            variant={period === p ? 'default' : 'ghost'}
                            onClick={() => setPeriod(p)}
                        >
                            {p}
                        </Button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="settings-card__loading">{t('common.loading', 'Loading…')}</div>
            ) : (
                <>
                    {overview && (
                        <div className="stat-strip">
                            <div className="stat-strip__item">
                                <span className="stat-strip__value">{overview.total_requests.toLocaleString()}</span>
                                <span className="stat-strip__label">{t('app.apiSettingsTab.totalRequests', 'Total requests')}</span>
                            </div>
                            <div className="stat-strip__item">
                                <span className="stat-strip__value">{overview.avg_response_time_ms}ms</span>
                                <span className="stat-strip__label">{t('app.apiSettingsTab.avgResponseTime', 'Avg response time')}</span>
                            </div>
                            <div className="stat-strip__item">
                                <span className="stat-strip__value">{overview.error_rate}%</span>
                                <span className="stat-strip__label">{t('app.apiSettingsTab.errorRate', 'Error rate')}</span>
                            </div>
                            <div className="stat-strip__item">
                                <span className="stat-strip__value">{overview.success_count.toLocaleString()}</span>
                                <span className="stat-strip__label">{t('app.apiSettingsTab.successful', 'Successful')}</span>
                            </div>
                        </div>
                    )}

                    {timeseries.length > 0 && (
                        <div className="api-settings__chart">
                            <h4>{t('app.apiSettingsTab.requestVolume', 'Request volume')}</h4>
                            <div className="api-settings__bar-chart">
                                {timeseries.map((d, i) => (
                                    <div key={i} className="api-settings__bar-col" title={t('app.apiSettingsTab.requests2', '{{period}}: {{count}} requests', { period: d.period, count: d.count })}>
                                        <div
                                            className="api-settings__bar"
                                            style={{ height: `${(d.count / maxCount) * 100}%` }}
                                        />
                                        {d.errors > 0 && (
                                            <div
                                                className="api-settings__bar api-settings__bar--error"
                                                style={{ height: `${(d.errors / maxCount) * 100}%` }}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {endpoints.length > 0 && (
                        <div className="api-settings__top-endpoints">
                            <h4>{t('app.apiSettingsTab.topEndpoints', 'Top endpoints')}</h4>
                            <DataTable
                                columns={ENDPOINT_COLUMNS}
                                data={endpoints.slice(0, 10)}
                                keyField={(ep) => `${ep.method} ${ep.endpoint}`}
                                storageKey="serverkit-table-settings-api-endpoints"
                                tableClassName="api-settings__table api-settings__table--compact"
                                footer={(
                                    <DataTableFooter
                                        shown={Math.min(endpoints.length, 10)}
                                        total={endpoints.length}
                                        noun="endpoint"
                                    />
                                )}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ApiSettingsTab;
