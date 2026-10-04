import { useCallback, useState, useEffect, useMemo  } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '@/hooks/useConfirm';
import EmptyState from '@/components/EmptyState';
import Modal from '../Modal';
import { InfoList, InfoItem } from '../InfoList';
import PortField from '../PortField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DataTable, DataTableFooter, ListToolbar, Pill, SegControl } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer, applyFilters,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Ban, Shield } from 'lucide-react';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';

const RULE_TYPE_TONES = {
    port: 'accent',
    service: 'cyan',
    rich: 'violet',
};

// UFW and firewalld describe the same rule differently: firewalld splits a port
// rule into `port` + `protocol`, while UFW hands back one printed target
// ('8080/tcp') and no protocol field at all. Reading both here is what lets a
// saved view mean the same thing whichever firewall the host runs — and stops
// the Protocol column reading '-' on every UFW box.
const ruleTarget = (rule) => rule.service || rule.port || rule.rule || '';
const ruleProtocol = (rule) => (
    rule.protocol || /\/(tcp|udp)\b/i.exec(String(ruleTarget(rule)))?.[1] || ''
).toLowerCase();

// Built-in saved views. Every rule matches a column's `value` accessor, so the
// strings below are what the Protocol cell actually shows: 'tcp' / 'udp' for a
// port opening on either firewall, and '' for a rule that opens no port at all.
// The three partition the table on that one axis, because "what is reachable"
// and "what is blocked or named" are the two questions this list answers.
const FIREWALL_VIEWS = [
    {
        // The port surface, in target order: what this host answers on. A
        // firewalld *service* rule (ssh, http) carries no protocol of its own,
        // so it is deliberately absent here — it lands under the third view.
        name: 'Port openings',
        state: {
            sorts: [{ key: 'target', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fw1', field: 'protocol', op: 'any', value: ['tcp', 'udp'] }],
            },
        },
    },
    {
        // Short by design. UDP gets opened for DNS, WireGuard or QUIC and
        // almost never by accident, so any row appearing here is worth reading.
        name: 'UDP openings',
        state: {
            sorts: [{ key: 'target', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fw2', field: 'protocol', op: 'any', value: ['udp'] }],
            },
        },
    },
    {
        // The half the two port views hide: firewalld services and rich
        // drop/reject rules, UFW app profiles and address-scoped rules. An IP
        // block lives here, so this is the list to read after an incident.
        name: 'Service & rich rules',
        state: {
            sorts: [{ key: 'type', direction: 'asc' }, { key: 'target', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fw3', field: 'protocol', op: 'none', value: ['tcp', 'udp'] }],
            },
        },
    },
];

const FirewallTab = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState(null);
    const [rules, setRules] = useState([]);
    const [blockedIPs, setBlockedIPs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeSubTab, setActiveSubTab] = useState('status');
    const [showBlockIPModal, setShowBlockIPModal] = useState(false);
    const [showPortModal, setShowPortModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [blockIP, setBlockIP] = useState('');
    const [newPort, setNewPort] = useState({ port: '', protocol: 'tcp' });
    const [selectedFirewall, setSelectedFirewall] = useState('ufw');
    const [actionLoading, setActionLoading] = useState(false);
    const [guard, setGuard] = useState(null);
    const [guardLoading, setGuardLoading] = useState(false);
    const toast = useToast();
    const { confirm } = useConfirm();
    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-firewall-rules-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-firewall-rules-cols' });

    const commonPorts = [
        { port: 22, name: 'SSH', protocol: 'tcp' },
        { port: 80, name: 'HTTP', protocol: 'tcp' },
        { port: 443, name: 'HTTPS', protocol: 'tcp' },
        { port: 21, name: 'FTP', protocol: 'tcp' },
        { port: 25, name: 'SMTP', protocol: 'tcp' },
        { port: 3306, name: 'MySQL', protocol: 'tcp' },
        { port: 5432, name: 'PostgreSQL', protocol: 'tcp' },
        { port: 6379, name: 'Redis', protocol: 'tcp' },
        { port: 27017, name: 'MongoDB', protocol: 'tcp' },
    ];

    const loadStatus = useCallback(async () => {
        try {
            const data = await api.getFirewallStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load status:', error);
        }
    }, []);

    const loadRules = useCallback(async () => {
        try {
            const data = await api.getFirewallRules();
            setRules(data.rules || []);
        } catch (error) {
            console.error('Failed to load rules:', error);
        }
    }, []);

    const loadBlockedIPs = useCallback(async () => {
        try {
            const data = await api.getBlockedIPs();
            setBlockedIPs(data.blocked_ips || []);
        } catch (error) {
            console.error('Failed to load blocked IPs:', error);
        }
    }, []);

    const loadGuard = useCallback(async () => {
        try {
            const data = await api.getMetadataGuard();
            setGuard(data);
        } catch (error) {
            console.error('Failed to load metadata guard status:', error);
        }
    }, []);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            await Promise.all([loadStatus(), loadRules(), loadBlockedIPs(), loadGuard()]);
        } catch (error) {
            console.error('Failed to load firewall data:', error);
        } finally {
            setLoading(false);
        }
    }, [loadStatus, loadRules, loadBlockedIPs, loadGuard]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    const handleGuardToggle = async (enabled) => {
        setGuardLoading(true);
        try {
            const data = await api.setMetadataGuard(enabled);
            setGuard(data);
            toast.success(t('app.firewallTab.cloudMetadataGuard', 'Cloud metadata guard {{value}}', { value: enabled ? 'enabled' : 'disabled' }));
        } catch (error) {
            toast.error(t('app.firewallTab.failedToUpdateMetadataGuard', 'Failed to update metadata guard: {{message}}', { message: error.message }));
            await loadGuard();
        } finally {
            setGuardLoading(false);
        }
    };

    const handleEnable = async () => {
        setActionLoading(true);
        try {
            await api.enableFirewall();
            toast.success(t('app.firewallTab.firewallEnabled', 'Firewall enabled'));
            await loadStatus();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToEnableFirewall', 'Failed to enable firewall: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleDisable = async () => {
        const confirmed = await confirm({
            title: t('app.firewallTab.disableFirewall', 'Disable Firewall'),
            message: t('app.firewallTab.areYouSureYouWantTo', 'Are you sure you want to disable the firewall? This will leave your server unprotected.'),
            confirmText: t('common.actions.disable', 'Disable'),
            variant: 'danger',
        });
        if (!confirmed) return;
        setActionLoading(true);
        try {
            await api.disableFirewall();
            toast.success(t('app.firewallTab.firewallDisabled', 'Firewall disabled'));
            await loadStatus();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToDisableFirewall', 'Failed to disable firewall: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleBlockIP = async () => {
        if (!blockIP.trim()) return;
        setActionLoading(true);
        try {
            await api.blockIP(blockIP);
            toast.success(t('app.firewallTab.ipBlocked', 'IP {{blockIP}} blocked', { blockIP: blockIP }));
            setShowBlockIPModal(false);
            setBlockIP('');
            await loadBlockedIPs();
            await loadRules();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToBlockIp', 'Failed to block IP: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnblockIP = async (ip) => {
        const confirmed = await confirm({
            title: t('app.firewallTab.unblockIp', 'Unblock IP'),
            message: t('app.firewallTab.areYouSureYouWantTo3', 'Are you sure you want to unblock {{ip}}?', { ip: ip }),
            confirmText: t('app.firewallTab.unblock', 'Unblock'),
            variant: 'warning',
        });
        if (!confirmed) return;
        try {
            await api.unblockIP(ip);
            toast.success(t('app.firewallTab.ipUnblocked', 'IP {{ip}} unblocked', { ip: ip }));
            await loadBlockedIPs();
            await loadRules();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToUnblockIp', 'Failed to unblock IP: {{message}}', { message: error.message }));
        }
    };

    const handleAllowPort = async () => {
        if (!newPort.port) return;
        setActionLoading(true);
        try {
            await api.allowPort(parseInt(newPort.port), newPort.protocol);
            toast.success(t('app.firewallTab.portAllowed', 'Port {{port}}/{{protocol}} allowed', { port: newPort.port, protocol: newPort.protocol }));
            setShowPortModal(false);
            setNewPort({ port: '', protocol: 'tcp' });
            await loadRules();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToAllowPort', 'Failed to allow port: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleQuickAllowPort = async (port, protocol) => {
        setActionLoading(true);
        try {
            await api.allowPort(port, protocol);
            toast.success(t('app.firewallTab.portAllowed', 'Port {{port}}/{{protocol}} allowed', { port: port, protocol: protocol }));
            await loadRules();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToAllowPort', 'Failed to allow port: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemovePort = async (port, protocol) => {
        const confirmed = await confirm({
            title: t('app.firewallTab.removePortRule', 'Remove Port Rule'),
            message: t('app.firewallTab.areYouSureYouWantTo4', 'Are you sure you want to remove the rule for port {{port}}/{{protocol}}?', { port: port, protocol: protocol }),
            confirmText: t('common.actions.remove', 'Remove'),
            variant: 'danger',
        });
        if (!confirmed) return;
        try {
            await api.denyPort(parseInt(port), protocol);
            toast.success(t('app.firewallTab.portRuleRemoved', 'Port {{port}}/{{protocol}} rule removed', { port: port, protocol: protocol }));
            await loadRules();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToRemovePort', 'Failed to remove port: {{message}}', { message: error.message }));
        }
    };

    const handleInstall = async () => {
        setActionLoading(true);
        try {
            await api.installFirewall(selectedFirewall);
            toast.success(t('app.firewallTab.installedSuccessfully', '{{value}} installed successfully', { value: selectedFirewall.toUpperCase() }));
            setShowInstallModal(false);
            await loadData();
        } catch (error) {
            toast.error(t('app.firewallTab.failedToInstallFirewall', 'Failed to install firewall: {{message}}', { message: error.message }));
        } finally {
            setActionLoading(false);
        }
    };

    const isActive = status?.any_active;
    const activeFirewall = status?.active_firewall;

    // Cell markup/classNames are identical to the hand-rolled table they
    // replace, so _security.scss keeps applying (.sec-state, .sec-rich-rule…).
    const ruleColumns = [
        {
            key: 'type',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            sortValue: (rule) => rule.type || '',
            render: (rule) => (
                <span className={`sec-state sec-state--${RULE_TYPE_TONES[rule.type] || 'gray'}`}>
                    {rule.type}
                </span>
            ),
        },
        {
            key: 'target',
            headerKey: 'common.labels.target', header: 'Target',
            sortable: true,
            sortValue: ruleTarget,
            cellClassName: 'sk-cell-mono',
            render: (rule) => (
                <>
                    {rule.type === 'service' && rule.service}
                    {rule.type === 'port' && rule.port}
                    {rule.type === 'rich' && <span className="sec-rich-rule">{rule.rule}</span>}
                </>
            ),
        },
        {
            key: 'protocol',
            headerKey: 'app.firewallTab.protocol', header: 'Protocol',
            sortable: true,
            // Declared, not inferred: with only tcp/udp in play a short rule
            // list fails the enum cardinality test and falls back to text,
            // which turns the pick-list into a typed fragment and every view
            // above into a no-op. `value` is what the rules read; `sortValue`
            // is what the sorter reads, and they must agree.
            type: 'enum',
            value: ruleProtocol,
            sortValue: ruleProtocol,
            cellClassName: 'sk-cell-mono sec-proto',
            render: (rule) => ruleProtocol(rule) || '-',
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            render: (rule) => (
                rule.type === 'port' && (
                    <Button variant="destructive" size="sm" onClick={() => handleRemovePort(rule.port, rule.protocol)}>
                        {t('common.actions.remove', 'Remove')}
                    </Button>
                )
            ),
        },
    ];

    // Saved views are scoped to THIS table, not to Security as a page: only one
    // of the 13 tabs is mounted at a time, so a picker at the page heading would
    // sit above whichever tab happened to be open. No `urlScope` either — the
    // rules table is the only one on this tab, so its shareable links keep the
    // plain ?view= names every single-table page produces.
    //
    // No `pageState`: the sub-tab strip below is navigation, not a filter, and a
    // view that switched you to another sub-tab would hide the table it names.
    const chrome = useTableChrome({
        columns: ruleColumns,
        rows: rules,
        viewPageKey: 'security-firewall',
        builtinViews: FIREWALL_VIEWS,
        noun: 'rules',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    // The count has to be the count you can SEE. DataTable applies the column
    // rules itself, so without re-applying them here a view that narrows to two
    // rows would still claim the full total.
    const shownRules = useMemo(
        () => applyFilters(rules, chrome.cfg.filters, chrome.columns),
        [rules, chrome.cfg.filters, chrome.columns],
    );

    if (loading) {
        return <div className="loading-sm">{t('app.firewallTab.loadingFirewallStatus', 'Loading firewall status…')}</div>;
    }

    return (
        <div className="firewall-tab">
            {!status?.any_installed ? (
                <EmptyState
                    icon={Shield}
                    title={t('app.firewallTab.noFirewallInstalled', 'No Firewall Installed')}
                    description={t('app.firewallTab.installAFirewallToProtectYour', 'Install a firewall to protect your server from unauthorized access.')}
                    action={(
                        <Button variant="default" onClick={() => setShowInstallModal(true)}>
                            {t('app.firewallTab.installFirewall', 'Install Firewall')}
                        </Button>
                    )}
                />
            ) : (
                <>
                    <div className="firewall-header">
                        <div className="firewall-status-row">
                            <div className={`status-indicator ${isActive == null ? 'unknown' : isActive ? 'active' : 'inactive'}`}>
                                <span className="sec-shield">
                                    <Shield size={17} />
                                </span>
                                <span className="status-indicator__label">{isActive == null ? 'Firewall Status Unknown' : isActive ? 'Firewall Active' : 'Firewall Inactive'}</span>
                                <span className="firewall-type">{activeFirewall?.toUpperCase()}</span>
                            </div>
                            <div className="firewall-actions">
                                <Button variant="outline" size="sm" onClick={() => setShowBlockIPModal(true)}>
                                    {t('app.firewallTab.blockIp', 'Block IP')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setShowPortModal(true)}>
                                    {t('app.firewallTab.allowPort', 'Allow Port')}
                                </Button>
                                {isActive ? (
                                    <Button variant="destructive" size="sm" onClick={handleDisable} disabled={actionLoading}>
                                        {t('common.actions.disable', 'Disable')}
                                    </Button>
                                ) : (
                                    <Button variant="default" size="sm" onClick={handleEnable} disabled={actionLoading}>
                                        {t('common.actions.enable', 'Enable')}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="firewall-stats">
                        <div className="stat-mini">
                            <span className="stat-value">{rules.length}</span>
                            <span className="stat-label">{t('app.firewallTab.rules', 'Rules')}</span>
                        </div>
                        <div className="stat-mini">
                            <span className="stat-value">{blockedIPs.length}</span>
                            <span className="stat-label">{t('app.firewallTab.blockedIps', 'Blocked IPs')}</span>
                        </div>
                        <div className="stat-mini">
                            <span className="stat-value">{rules.filter(r => r.type === 'port' || r.port).length}</span>
                            <span className="stat-label">{t('app.firewallTab.portsOpen', 'Ports Open')}</span>
                        </div>
                    </div>

                    <SegControl
                        className="sec-subseg"
                        value={activeSubTab}
                        onChange={setActiveSubTab}
                        options={[
                            { value: 'status', labelKey: 'common.labels.status', label: 'Status' },
                            { value: 'rules', labelKey: 'app.firewallTab.rules', label: 'Rules', count: rules.length },
                            { value: 'blocked', labelKey: 'app.firewallTab.blockedIps', label: 'Blocked IPs', count: blockedIPs.length },
                            { value: 'quick', labelKey: 'app.firewallTab.quickPorts', label: 'Quick Ports' },
                        ]}
                    />

                    {activeSubTab === 'status' && (
                        <SharedCard variant="legacy" className="card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.firewallTab.firewallInformation', 'Firewall Information')}</h3>
                                <Button variant="outline" size="sm" onClick={loadData}>{t('common.actions.refresh', 'Refresh')}</Button>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <InfoList>
                                    <InfoItem label={t('common.labels.type', 'Type')} value={activeFirewall?.toUpperCase()} mono />
                                    <InfoItem label={t('common.labels.status', 'Status')}>
                                        <Pill kind={isActive ? 'green' : 'red'}>
                                            {isActive ? 'Active' : 'Inactive'}
                                        </Pill>
                                    </InfoItem>
                                    {activeFirewall === 'firewalld' && status?.firewalld?.default_zone && (
                                        <InfoItem label={t('app.firewallTab.defaultZone', 'Default zone')} value={status.firewalld.default_zone} mono />
                                    )}
                                </InfoList>
                            </SharedCardContent>
                        </SharedCard>
                    )}

                    {activeSubTab === 'rules' && (
                        <>
                            {/* The view name IS this section's heading — the old
                                "Firewall Rules" <h3> would title the same table
                                twice, and the segment above already says Rules. */}
                            <GridViewPicker
                                views={chrome.views}
                                label="rules"
                                onCreate={chrome.createView}
                                actions={(
                                    <>
                                        <GridFilterButton
                                            count={chrome.filterCount}
                                            onClick={() => chrome.setDrawerOpen(true)}
                                        />
                                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadData} />
                                    </>
                                )}
                            />
                            {/* The toolbar survives only because Add Rule needs a
                                home: this tab is nested, so there is no top bar
                                to hoist a create action into. */}
                            <ListToolbar>
                                <Button variant="default" size="sm" onClick={() => setShowPortModal(true)}>{t('app.firewallTab.addRule', 'Add Rule')}</Button>
                            </ListToolbar>

                            <GridChips {...chrome.chipProps} />

                            {rules.length === 0 ? (
                                <SharedCard variant="legacy" className="card">
                                    <p className="text-muted">{t('app.firewallTab.noRulesConfigured', 'No rules configured')}</p>
                                </SharedCard>
                            ) : (
                                <SharedCard variant="legacy" className="card sec-flush">
                                    <DataTable
                                        columns={chrome.columns}
                                        data={rules}
                                        keyField={(rule) => `${rule.type}-${rule.service || rule.port || rule.rule}-${rule.protocol || ''}`}
                                        sorts={sorts}
                                        onSortsChange={setSorts}
                                        {...chrome.tableProps}
                                        footer={(
                                            <DataTableFooter
                                                shown={shownRules.length}
                                                total={rules.length}
                                                noun="rule"
                                            />
                                        )}
                                    />
                                </SharedCard>
                            )}
                        </>
                    )}

                    {activeSubTab === 'blocked' && (
                        <SharedCard variant="legacy" className="card sec-flush">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.firewallTab.blockedIpAddresses', 'Blocked IP Addresses')}</h3>
                                <Button variant="default" size="sm" onClick={() => setShowBlockIPModal(true)}>{t('app.firewallTab.blockIp', 'Block IP')}</Button>
                            </SharedCardHeader>
                            {blockedIPs.length === 0 ? (
                                <SharedCardContent variant="legacy" className="card-body">
                                    <EmptyState icon={Ban} title={t('app.firewallTab.noBlockedIps', 'No blocked IPs')} />
                                </SharedCardContent>
                            ) : (
                                <div className="blocked-list">
                                    {blockedIPs.map((item, index) => (
                                        <div key={index} className="blocked-item">
                                            <div className="blocked-info">
                                                <span className="blocked-ip">{item.ip}</span>
                                            </div>
                                            <Button variant="secondary" size="sm" onClick={() => handleUnblockIP(item.ip)}>
                                                {t('app.firewallTab.unblock', 'Unblock')}
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </SharedCard>
                    )}

                    {activeSubTab === 'quick' && (
                        <SharedCard variant="legacy" className="card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.firewallTab.quickPortAccess', 'Quick Port Access')}</h3>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <p className="sec-hint sec-hint--lead">{t('app.firewallTab.oneClickEnableDisableCommonService', 'One-click enable/disable common service ports')}</p>
                                <div className="quick-ports-grid">
                                    {commonPorts.map(({ port, name, protocol }) => {
                                        const isAllowed = rules.some(r =>
                                            (r.port === String(port) || r.port === port) && r.protocol === protocol
                                        );
                                        return (
                                            <div key={port} className={`quick-port-card ${isAllowed ? 'is-allowed' : ''}`}>
                                                <div className="port-info">
                                                    <span className="port-name">{name}</span>
                                                    <span className="port-number">{port}/{protocol}</span>
                                                </div>
                                                {isAllowed ? (
                                                    <Button variant="destructive" size="sm" onClick={() => handleRemovePort(port, protocol)} disabled={actionLoading}>
                                                        {t('app.firewallTab.block', 'Block')}
                                                    </Button>
                                                ) : (
                                                    <Button variant="default" size="sm" onClick={() => handleQuickAllowPort(port, protocol)} disabled={actionLoading}>
                                                        {t('app.firewallTab.allow', 'Allow')}
                                                    </Button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </SharedCardContent>
                        </SharedCard>
                    )}
                </>
            )}

            {guard && (
                <SharedCard variant="legacy" className="card">
                    <SharedCardHeader variant="legacy" className="card-header">
                        <h3>{t('app.firewallTab.cloudMetadataGuard2', 'Cloud Metadata Guard')}</h3>
                        {guard.supported ? (
                            <Pill kind={guard.active ? 'green' : 'gray'}>
                                {guard.active ? 'Active' : 'Inactive'}
                            </Pill>
                        ) : (
                            <Pill kind="gray">{t('app.firewallTab.unsupportedOnThisHost', 'Unsupported on this host')}</Pill>
                        )}
                    </SharedCardHeader>
                    <SharedCardContent variant="legacy" className="card-body">
                        <InfoList>
                            <InfoItem label={t('app.firewallTab.blockContainerAccessTo169254', 'Block container access to 169.254.169.254')}>
                                <Switch
                                    checked={!!guard.enabled_setting}
                                    onCheckedChange={handleGuardToggle}
                                    disabled={guardLoading || !guard.supported}
                                    aria-label={t('app.firewallTab.toggleCloudMetadataGuard', 'Toggle cloud metadata guard')}
                                />
                            </InfoItem>
                            {guard.supported && guard.backend && (
                                <InfoItem label={t('app.firewallTab.backend', 'Backend')} value={guard.backend} mono />
                            )}
                        </InfoList>
                        <p className="sec-hint">
                            {t('app.firewallTab.stopsAppContainersFromReachingThe', 'Stops app containers from reaching the cloud metadata endpoint, preventing SSRF attacks from stealing instance credentials.')}
                        </p>
                    </SharedCardContent>
                </SharedCard>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />

            {/* Block IP Modal */}
            <Modal open={showBlockIPModal} onClose={() => setShowBlockIPModal(false)} title={t('app.firewallTab.blockIpAddress', 'Block IP Address')}>
                <div className="form-group">
                    <Label>{t('common.labels.ipAddress', 'IP Address')}</Label>
                    <Input
                        type="text"
                        value={blockIP}
                        onChange={(e) => setBlockIP(e.target.value)}
                        placeholder={t('app.firewallTab.1921681100Or10', '192.168.1.100 or 10.0.0.0/24')}
                    />
                </div>
                <p className="text-muted">{t('app.firewallTab.youCanBlockASingleIp', 'You can block a single IP or a range using CIDR notation.')}</p>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowBlockIPModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="destructive" onClick={handleBlockIP} disabled={actionLoading || !blockIP.trim()}>
                        {actionLoading ? 'Blocking...' : 'Block IP'}
                    </Button>
                </div>
            </Modal>

            {/* Allow Port Modal */}
            <Modal open={showPortModal} onClose={() => setShowPortModal(false)} title={t('app.firewallTab.allowPort', 'Allow Port')}>
                <div className="form-row">
                    <div className="form-group">
                        <Label htmlFor="firewall-allow-port">{t('app.firewallTab.portNumber', 'Port Number')}</Label>
                        <PortField
                            id="firewall-allow-port"
                            host={false}
                            allowPrivileged
                            value={newPort.port}
                            onChange={(port) => setNewPort({ ...newPort, port })}
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('app.firewallTab.protocol', 'Protocol')}</Label>
                        <Select value={newPort.protocol} onValueChange={(value) => setNewPort({ ...newPort, protocol: value })}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="tcp">TCP</SelectItem>
                                <SelectItem value="udp">UDP</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowPortModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="default" onClick={handleAllowPort} disabled={actionLoading || !newPort.port}>
                        {actionLoading ? 'Adding...' : 'Allow Port'}
                    </Button>
                </div>
            </Modal>

            {/* Install Firewall Modal */}
            <Modal open={showInstallModal} onClose={() => setShowInstallModal(false)} title={t('app.firewallTab.installFirewall', 'Install Firewall')}>
                <div className="form-group">
                    <Label>{t('app.firewallTab.selectFirewall', 'Select Firewall')}</Label>
                    <Select value={selectedFirewall} onValueChange={setSelectedFirewall}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ufw">{t('app.firewallTab.ufwRecommendedForUbuntu', 'UFW (Recommended for Ubuntu)')}</SelectItem>
                            <SelectItem value="firewalld">{t('app.firewallTab.firewalldCentosRhel', 'firewalld (CentOS/RHEL)')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="install-info">
                    {selectedFirewall === 'ufw' ? (
                        <p><strong>{t('app.firewallTab.ufwUncomplicatedFirewall', 'UFW (Uncomplicated Firewall)')}</strong> {t('app.firewallTab.isSimpleAndEasyToUse', 'is simple and easy to use for Ubuntu/Debian systems.')}</p>
                    ) : (
                        <p><strong>firewalld</strong> {t('app.firewallTab.isADynamicallyManagedFirewallWith', 'is a dynamically managed firewall with zone-based configuration for CentOS/RHEL.')}</p>
                    )}
                </div>
                <div className="modal-footer">
                    <Button variant="outline" onClick={() => setShowInstallModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="default" onClick={handleInstall} disabled={actionLoading}>
                        {actionLoading ? 'Installing...' : 'Install'}
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

export default FirewallTab;
