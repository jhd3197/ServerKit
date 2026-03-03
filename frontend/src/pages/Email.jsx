import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function Email() {
    const [status, setStatus] = useState(null);
    const [domains, setDomains] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [aliases, setAliases] = useState([]);
    const [forwarding, setForwarding] = useState([]);
    const [dnsProviders, setDnsProviders] = useState([]);
    const [spamConfig, setSpamConfig] = useState(null);
    const [webmailStatus, setWebmailStatus] = useState(null);
    const [mailQueue, setMailQueue] = useState([]);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState(null);

    // Modal states
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [showAddDomainModal, setShowAddDomainModal] = useState(false);
    const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
    const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
    const [showEditQuotaModal, setShowEditQuotaModal] = useState(false);
    const [showAddAliasModal, setShowAddAliasModal] = useState(false);
    const [showAddForwardingModal, setShowAddForwardingModal] = useState(false);
    const [showAddProviderModal, setShowAddProviderModal] = useState(false);
    const [showInstallWebmailModal, setShowInstallWebmailModal] = useState(false);

    // Form states
    const [installHostname, setInstallHostname] = useState('');
    const [newDomain, setNewDomain] = useState({ domain: '', dns_provider_id: '', zone_id: '' });
    const [providerZones, setProviderZones] = useState([]);
    const [zonesLoading, setZonesLoading] = useState(false);
    const [selectedDomainId, setSelectedDomainId] = useState('');
    const [newAccount, setNewAccount] = useState({ username: '', password: '', quota: 1024 });
    const [passwordTarget, setPasswordTarget] = useState(null);
    const [newPassword, setNewPassword] = useState('');
    const [quotaTarget, setQuotaTarget] = useState(null);
    const [newQuota, setNewQuota] = useState(1024);
    const [newAlias, setNewAlias] = useState({ source: '', destination: '' });
    const [selectedForwardingAccount, setSelectedForwardingAccount] = useState('');
    const [newForwarding, setNewForwarding] = useState({ destination: '', keep_copy: true });
    const [newProvider, setNewProvider] = useState({ name: '', type: 'cloudflare', api_key: '', api_secret: '', api_email: '' });
    const [webmailProxyDomain, setWebmailProxyDomain] = useState('');
    const [spamForm, setSpamForm] = useState({
        required_score: 5,
        rewrite_subject: '[SPAM]',
        use_bayes: true,
        auto_learn: true,
        skip_rbl_checks: false
    });

    const toast = useToast();

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            await Promise.all([
                loadStatus(),
                loadDomains(),
                loadDnsProviders()
            ]);
        } catch (error) {
            console.error('Failed to load email data:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const data = await api.getEmailStatus();
            setStatus(data);
        } catch (error) {
            console.error('Failed to load email status:', error);
        }
    };

    const loadDomains = async () => {
        try {
            const data = await api.getEmailDomains();
            setDomains(data.domains || data || []);
        } catch (error) {
            console.error('Failed to load email domains:', error);
        }
    };

    const loadAccounts = async (domainId) => {
        if (!domainId) return;
        try {
            const data = await api.getEmailAccounts(domainId);
            setAccounts(data.accounts || data || []);
        } catch (error) {
            console.error('Failed to load email accounts:', error);
        }
    };

    const loadAliases = async (domainId) => {
        if (!domainId) return;
        try {
            const data = await api.getEmailAliases(domainId);
            setAliases(data.aliases || data || []);
        } catch (error) {
            console.error('Failed to load email aliases:', error);
        }
    };

    const loadForwarding = async (accountId) => {
        if (!accountId) return;
        try {
            const data = await api.getEmailForwarding(accountId);
            setForwarding(data.rules || data || []);
        } catch (error) {
            console.error('Failed to load forwarding rules:', error);
        }
    };

    const loadDnsProviders = async () => {
        try {
            const data = await api.getEmailDNSProviders();
            setDnsProviders(data.providers || data || []);
        } catch (error) {
            console.error('Failed to load DNS providers:', error);
        }
    };

    const loadSpamConfig = async () => {
        try {
            const data = await api.getSpamConfig();
            setSpamConfig(data);
            if (data) {
                setSpamForm({
                    required_score: data.required_score ?? 5,
                    rewrite_subject: data.rewrite_subject ?? '[SPAM]',
                    use_bayes: data.use_bayes ?? true,
                    auto_learn: data.auto_learn ?? true,
                    skip_rbl_checks: data.skip_rbl_checks ?? false
                });
            }
        } catch (error) {
            console.error('Failed to load spam config:', error);
        }
    };

    const loadWebmailStatus = async () => {
        try {
            const data = await api.getWebmailStatus();
            setWebmailStatus(data);
        } catch (error) {
            console.error('Failed to load webmail status:', error);
        }
    };

    const loadMailQueue = async () => {
        try {
            const data = await api.getMailQueue();
            setMailQueue(data.queue || data || []);
        } catch (error) {
            console.error('Failed to load mail queue:', error);
        }
    };

    const loadLogs = async () => {
        try {
            const data = await api.getMailLogs(200);
            setLogs(data.content || data.logs || 'No logs available');
        } catch (error) {
            setLogs('Failed to load logs');
        }
    };

    // --- Action handlers ---

    const handleInstall = async () => {
        if (!installHostname.trim()) return;
        setActionLoading(true);
        try {
            await api.installEmailServer({ hostname: installHostname });
            toast.success('Email server installed successfully');
            setShowInstallModal(false);
            setInstallHostname('');
            await loadData();
        } catch (error) {
            toast.error(`Failed to install email server: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleServiceControl = async (component, action) => {
        setActionLoading(true);
        try {
            await api.controlEmailService(component, action);
            toast.success(`${component} ${action}ed successfully`);
            await loadStatus();
        } catch (error) {
            toast.error(`Failed to ${action} ${component}: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleAddDomain = async () => {
        if (!newDomain.domain.trim()) return;
        setActionLoading(true);
        try {
            await api.addEmailDomain(newDomain);
            toast.success('Domain added successfully');
            setShowAddDomainModal(false);
            setNewDomain({ domain: '', dns_provider_id: '', zone_id: '' });
            setProviderZones([]);
            await loadDomains();
        } catch (error) {
            toast.error(`Failed to add domain: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteDomain = async (domainId, domainName) => {
        setConfirmDialog({
            title: 'Delete Email Domain',
            message: `Are you sure you want to delete domain "${domainName}"? This will remove all accounts and aliases.`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteEmailDomain(domainId);
                    toast.success('Domain deleted successfully');
                    await loadDomains();
                } catch (error) {
                    toast.error(`Failed to delete domain: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleVerifyDNS = async (domainId) => {
        setActionLoading(true);
        try {
            const result = await api.verifyEmailDNS(domainId);
            if (result.all_valid || result.success) {
                toast.success('DNS records verified successfully');
            } else {
                toast.warning('Some DNS records need attention');
            }
            await loadDomains();
        } catch (error) {
            toast.error(`DNS verification failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeployDNS = async (domainId) => {
        setActionLoading(true);
        try {
            await api.deployEmailDNS(domainId);
            toast.success('DNS records deployed successfully');
            await loadDomains();
        } catch (error) {
            toast.error(`Failed to deploy DNS records: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleProviderChange = async (providerId) => {
        setNewDomain({ ...newDomain, dns_provider_id: providerId, zone_id: '' });
        setProviderZones([]);
        if (!providerId) return;
        setZonesLoading(true);
        try {
            const data = await api.getEmailDNSZones(providerId);
            setProviderZones(data.zones || data || []);
        } catch (error) {
            toast.error(`Failed to load DNS zones: ${error.message}`);
        } finally {
            setZonesLoading(false);
        }
    };

    const handleCreateAccount = async () => {
        if (!newAccount.username.trim() || !selectedDomainId) return;
        setActionLoading(true);
        try {
            await api.createEmailAccount(selectedDomainId, newAccount);
            toast.success('Account created successfully');
            setShowCreateAccountModal(false);
            setNewAccount({ username: '', password: '', quota: 1024 });
            await loadAccounts(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to create account: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteAccount = async (accountId, email) => {
        setConfirmDialog({
            title: 'Delete Email Account',
            message: `Are you sure you want to delete "${email}"?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteEmailAccount(accountId);
                    toast.success('Account deleted successfully');
                    await loadAccounts(selectedDomainId);
                } catch (error) {
                    toast.error(`Failed to delete account: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleChangePassword = async () => {
        if (!passwordTarget || !newPassword.trim()) return;
        setActionLoading(true);
        try {
            await api.changeEmailPassword(passwordTarget, newPassword);
            toast.success('Password changed successfully');
            setShowChangePasswordModal(false);
            setPasswordTarget(null);
            setNewPassword('');
        } catch (error) {
            toast.error(`Failed to change password: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleEditQuota = async () => {
        if (!quotaTarget) return;
        setActionLoading(true);
        try {
            await api.updateEmailAccount(quotaTarget, { quota: newQuota });
            toast.success('Quota updated successfully');
            setShowEditQuotaModal(false);
            setQuotaTarget(null);
            await loadAccounts(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to update quota: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const generatePassword = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let pass = '';
        for (let i = 0; i < 16; i++) {
            pass += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return pass;
    };

    const handleAddAlias = async () => {
        if (!newAlias.source.trim() || !newAlias.destination.trim() || !selectedDomainId) return;
        setActionLoading(true);
        try {
            await api.createEmailAlias(selectedDomainId, newAlias);
            toast.success('Alias created successfully');
            setShowAddAliasModal(false);
            setNewAlias({ source: '', destination: '' });
            await loadAliases(selectedDomainId);
        } catch (error) {
            toast.error(`Failed to create alias: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteAlias = async (aliasId) => {
        setConfirmDialog({
            title: 'Delete Alias',
            message: 'Are you sure you want to delete this alias?',
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteEmailAlias(aliasId);
                    toast.success('Alias deleted successfully');
                    await loadAliases(selectedDomainId);
                } catch (error) {
                    toast.error(`Failed to delete alias: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleAddForwarding = async () => {
        if (!newForwarding.destination.trim() || !selectedForwardingAccount) return;
        setActionLoading(true);
        try {
            await api.createEmailForwarding(selectedForwardingAccount, newForwarding);
            toast.success('Forwarding rule created successfully');
            setShowAddForwardingModal(false);
            setNewForwarding({ destination: '', keep_copy: true });
            await loadForwarding(selectedForwardingAccount);
        } catch (error) {
            toast.error(`Failed to create forwarding rule: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleForwarding = async (rule) => {
        try {
            await api.updateEmailForwarding(rule.id, { ...rule, active: !rule.active });
            toast.success('Forwarding rule updated');
            await loadForwarding(selectedForwardingAccount);
        } catch (error) {
            toast.error(`Failed to update forwarding: ${error.message}`);
        }
    };

    const handleToggleForwardingKeepCopy = async (rule) => {
        try {
            await api.updateEmailForwarding(rule.id, { ...rule, keep_copy: !rule.keep_copy });
            toast.success('Forwarding rule updated');
            await loadForwarding(selectedForwardingAccount);
        } catch (error) {
            toast.error(`Failed to update forwarding: ${error.message}`);
        }
    };

    const handleDeleteForwarding = async (ruleId) => {
        setConfirmDialog({
            title: 'Delete Forwarding Rule',
            message: 'Are you sure you want to delete this forwarding rule?',
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteEmailForwarding(ruleId);
                    toast.success('Forwarding rule deleted');
                    await loadForwarding(selectedForwardingAccount);
                } catch (error) {
                    toast.error(`Failed to delete forwarding rule: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleAddProvider = async () => {
        if (!newProvider.name.trim() || !newProvider.api_key.trim()) return;
        setActionLoading(true);
        try {
            await api.addEmailDNSProvider(newProvider);
            toast.success('DNS provider added successfully');
            setShowAddProviderModal(false);
            setNewProvider({ name: '', type: 'cloudflare', api_key: '', api_secret: '', api_email: '' });
            await loadDnsProviders();
        } catch (error) {
            toast.error(`Failed to add DNS provider: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleTestProvider = async (providerId) => {
        setActionLoading(true);
        try {
            const result = await api.testEmailDNSProvider(providerId);
            if (result.success) {
                toast.success('Connection test successful');
            } else {
                toast.error(result.error || 'Connection test failed');
            }
        } catch (error) {
            toast.error(`Connection test failed: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteProvider = async (providerId, providerName) => {
        setConfirmDialog({
            title: 'Delete DNS Provider',
            message: `Are you sure you want to delete provider "${providerName}"?`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteEmailDNSProvider(providerId);
                    toast.success('DNS provider deleted');
                    await loadDnsProviders();
                } catch (error) {
                    toast.error(`Failed to delete provider: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleSaveSpamConfig = async () => {
        setActionLoading(true);
        try {
            await api.updateSpamConfig(spamForm);
            toast.success('Spam filter configuration saved');
            await loadSpamConfig();
        } catch (error) {
            toast.error(`Failed to save spam config: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUpdateSpamRules = async () => {
        setActionLoading(true);
        try {
            await api.updateSpamRules();
            toast.success('Spam rules updated successfully');
        } catch (error) {
            toast.error(`Failed to update spam rules: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInstallWebmail = async () => {
        setActionLoading(true);
        try {
            await api.installWebmail({});
            toast.success('Roundcube webmail installed successfully');
            setShowInstallWebmailModal(false);
            await loadWebmailStatus();
        } catch (error) {
            toast.error(`Failed to install webmail: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleWebmailControl = async (action) => {
        setActionLoading(true);
        try {
            await api.controlWebmail(action);
            toast.success(`Webmail ${action}ed successfully`);
            await loadWebmailStatus();
        } catch (error) {
            toast.error(`Failed to ${action} webmail: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleConfigureProxy = async () => {
        if (!webmailProxyDomain.trim()) return;
        setActionLoading(true);
        try {
            await api.configureWebmailProxy(webmailProxyDomain);
            toast.success('Nginx proxy configured successfully');
            setWebmailProxyDomain('');
        } catch (error) {
            toast.error(`Failed to configure proxy: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleFlushQueue = async () => {
        setActionLoading(true);
        try {
            await api.flushMailQueue();
            toast.success('Mail queue flushed');
            await loadMailQueue();
        } catch (error) {
            toast.error(`Failed to flush queue: ${error.message}`);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDeleteQueueItem = async (queueId) => {
        try {
            await api.deleteMailQueueItem(queueId);
            toast.success('Queue item deleted');
            await loadMailQueue();
        } catch (error) {
            toast.error(`Failed to delete queue item: ${error.message}`);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            toast.success('Copied to clipboard');
        }).catch(() => {
            toast.error('Failed to copy');
        });
    };

    const openPasswordModal = (accountId) => {
        setPasswordTarget(accountId);
        setNewPassword('');
        setShowChangePasswordModal(true);
    };

    const openEditQuotaModal = (accountId, currentQuota) => {
        setQuotaTarget(accountId);
        setNewQuota(currentQuota || 1024);
        setShowEditQuotaModal(true);
    };

    // --- Tab change handlers ---

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        if (tab === 'domains') {
            loadDomains();
        } else if (tab === 'accounts') {
            if (selectedDomainId) loadAccounts(selectedDomainId);
        } else if (tab === 'aliases') {
            if (selectedDomainId) {
                loadAliases(selectedDomainId);
                loadAccounts(selectedDomainId);
            }
        } else if (tab === 'dns') {
            loadDnsProviders();
            loadDomains();
        } else if (tab === 'spam') {
            loadSpamConfig();
        } else if (tab === 'webmail') {
            loadWebmailStatus();
        }
    };

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    const isInstalled = status?.installed || status?.postfix?.installed;
    const services = [
        { key: 'postfix', label: 'Postfix', data: status?.postfix },
        { key: 'dovecot', label: 'Dovecot', data: status?.dovecot },
        { key: 'opendkim', label: 'OpenDKIM', data: status?.opendkim },
        { key: 'spamassassin', label: 'SpamAssassin', data: status?.spamassassin },
        { key: 'roundcube', label: 'Roundcube', data: status?.roundcube }
    ];

    const totalDomains = domains.length;
    const totalAccounts = domains.reduce((sum, d) => sum + (d.accounts_count || 0), 0);

    return (
        <div className="email-server">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Email Server</h1>
                    <p className="page-description">Manage email domains, accounts, and mail services</p>
                </div>
                <div className="page-header-actions">
                    {!isInstalled ? (
                        <button className="btn btn-primary" onClick={() => setShowInstallModal(true)}>
                            Install Email Server
                        </button>
                    ) : (
                        <>
                            <button
                                className="btn btn-secondary"
                                onClick={() => handleServiceControl('postfix', 'restart')}
                                disabled={actionLoading}
                            >
                                Restart Postfix
                            </button>
                        </>
                    )}
                </div>
            </div>

            {!isInstalled ? (
                <div className="empty-state-large">
                    <span className="icon">email</span>
                    <h2>No Email Server Installed</h2>
                    <p>Install an email server to manage domains, accounts, and mail delivery.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => setShowInstallModal(true)}>
                        Install Email Server
                    </button>
                </div>
            ) : (
                <>
                    <div className="status-cards">
                        <div className={`status-card ${status?.postfix?.running ? 'success' : 'warning'}`}>
                            <div className="status-icon">
                                <span className="icon">{status?.postfix?.running ? 'check_circle' : 'pause_circle'}</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Postfix</span>
                                <span className="status-value">{status?.postfix?.running ? 'Running' : 'Stopped'}</span>
                            </div>
                        </div>
                        <div className={`status-card ${status?.dovecot?.running ? 'success' : 'warning'}`}>
                            <div className="status-icon">
                                <span className="icon">{status?.dovecot?.running ? 'check_circle' : 'pause_circle'}</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Dovecot</span>
                                <span className="status-value">{status?.dovecot?.running ? 'Running' : 'Stopped'}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">domain</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Domains</span>
                                <span className="status-value">{totalDomains}</span>
                            </div>
                        </div>
                        <div className="status-card">
                            <div className="status-icon">
                                <span className="icon">people</span>
                            </div>
                            <div className="status-info">
                                <span className="status-label">Accounts</span>
                                <span className="status-value">{totalAccounts}</span>
                            </div>
                        </div>
                    </div>

                    <div className="tabs">
                        {['overview', 'domains', 'accounts', 'aliases', 'dns', 'spam', 'webmail'].map((tab) => (
                            <button
                                key={tab}
                                className={`tab ${activeTab === tab ? 'active' : ''}`}
                                onClick={() => handleTabChange(tab)}
                            >
                                {{
                                    overview: 'Overview',
                                    domains: 'Domains',
                                    accounts: 'Accounts',
                                    aliases: 'Aliases & Forwarding',
                                    dns: 'DNS & Authentication',
                                    spam: 'Spam Filter',
                                    webmail: 'Webmail'
                                }[tab]}
                            </button>
                        ))}
                    </div>

                    <div className="tab-content">
                        {/* ===== OVERVIEW TAB ===== */}
                        {activeTab === 'overview' && (
                            <div className="overview-tab">
                                <h3>Service Status</h3>
                                <div className="config-grid">
                                    {services.map((svc) => (
                                        <div key={svc.key} className="card" style={{ marginBottom: '1rem' }}>
                                            <div className="card-header">
                                                <h4>{svc.label}</h4>
                                                <span className={`badge ${svc.data?.installed ? 'badge-success' : 'badge-danger'}`}>
                                                    {svc.data?.installed ? 'Installed' : 'Not Installed'}
                                                </span>
                                            </div>
                                            <div className="card-body">
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <span>Status: </span>
                                                    <span className={`badge ${svc.data?.running ? 'badge-success' : 'badge-warning'}`}>
                                                        {svc.data?.running ? 'Running' : 'Stopped'}
                                                    </span>
                                                </div>
                                                {svc.data?.version && (
                                                    <div style={{ marginBottom: '0.5rem' }}>
                                                        <span>Version: </span>
                                                        <code>{svc.data.version}</code>
                                                    </div>
                                                )}
                                                {svc.data?.installed && (
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                        {svc.data?.running ? (
                                                            <>
                                                                <button
                                                                    className="btn btn-sm btn-secondary"
                                                                    onClick={() => handleServiceControl(svc.key, 'restart')}
                                                                    disabled={actionLoading}
                                                                >
                                                                    Restart
                                                                </button>
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={() => handleServiceControl(svc.key, 'stop')}
                                                                    disabled={actionLoading}
                                                                >
                                                                    Stop
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                className="btn btn-sm btn-primary"
                                                                onClick={() => handleServiceControl(svc.key, 'start')}
                                                                disabled={actionLoading}
                                                            >
                                                                Start
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <h3>Statistics</h3>
                                <div className="stats-grid">
                                    <div className="stat-card">
                                        <div className="stat-content">
                                            <span className="stat-label">Total Domains</span>
                                            <span className="stat-value">{totalDomains}</span>
                                        </div>
                                    </div>
                                    <div className="stat-card">
                                        <div className="stat-content">
                                            <span className="stat-label">Total Accounts</span>
                                            <span className="stat-value">{totalAccounts}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ===== DOMAINS TAB ===== */}
                        {activeTab === 'domains' && (
                            <div className="domains-tab">
                                <div className="section-header">
                                    <h3>Email Domains</h3>
                                    <button className="btn btn-primary" onClick={() => setShowAddDomainModal(true)}>
                                        Add Domain
                                    </button>
                                </div>
                                {domains.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">domain</span>
                                        <p>No email domains configured</p>
                                        <button className="btn btn-primary" onClick={() => setShowAddDomainModal(true)}>
                                            Add First Domain
                                        </button>
                                    </div>
                                ) : (
                                    <div className="config-grid">
                                        {domains.map((domain) => (
                                            <div key={domain.id} className="card" style={{ marginBottom: '1rem' }}>
                                                <div className="card-header">
                                                    <h4>{domain.domain || domain.name}</h4>
                                                </div>
                                                <div className="card-body">
                                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                                                        <span>Accounts: <strong>{domain.accounts_count || 0}</strong></span>
                                                        <span>Aliases: <strong>{domain.aliases_count || 0}</strong></span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                        <span className={`badge ${domain.dkim_valid ? 'badge-success' : 'badge-danger'}`}>
                                                            DKIM {domain.dkim_valid ? '\u2713' : '\u2717'}
                                                        </span>
                                                        <span className={`badge ${domain.spf_valid ? 'badge-success' : 'badge-danger'}`}>
                                                            SPF {domain.spf_valid ? '\u2713' : '\u2717'}
                                                        </span>
                                                        <span className={`badge ${domain.dmarc_valid ? 'badge-success' : 'badge-danger'}`}>
                                                            DMARC {domain.dmarc_valid ? '\u2713' : '\u2717'}
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            className="btn btn-sm btn-secondary"
                                                            onClick={() => handleVerifyDNS(domain.id)}
                                                            disabled={actionLoading}
                                                        >
                                                            Verify DNS
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-secondary"
                                                            onClick={() => handleDeployDNS(domain.id)}
                                                            disabled={actionLoading}
                                                        >
                                                            Deploy DNS
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleDeleteDomain(domain.id, domain.domain || domain.name)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== ACCOUNTS TAB ===== */}
                        {activeTab === 'accounts' && (
                            <div className="accounts-tab">
                                <div className="section-header">
                                    <h3>Email Accounts</h3>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <select
                                            value={selectedDomainId}
                                            onChange={(e) => {
                                                setSelectedDomainId(e.target.value);
                                                if (e.target.value) loadAccounts(e.target.value);
                                            }}
                                        >
                                            <option value="">Select Domain</option>
                                            {domains.map((d) => (
                                                <option key={d.id} value={d.id}>{d.domain || d.name}</option>
                                            ))}
                                        </select>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => setShowCreateAccountModal(true)}
                                            disabled={!selectedDomainId}
                                        >
                                            Create Account
                                        </button>
                                    </div>
                                </div>
                                {!selectedDomainId ? (
                                    <div className="empty-state">
                                        <span className="icon">domain</span>
                                        <p>Select a domain to view accounts</p>
                                    </div>
                                ) : accounts.length === 0 ? (
                                    <div className="empty-state">
                                        <span className="icon">person_add</span>
                                        <p>No accounts for this domain</p>
                                        <button className="btn btn-primary" onClick={() => setShowCreateAccountModal(true)}>
                                            Create First Account
                                        </button>
                                    </div>
                                ) : (
                                    <div className="users-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Email</th>
                                                    <th>Quota Usage</th>
                                                    <th>Status</th>
                                                    <th>Created</th>
                                                    <th>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {accounts.map((account) => {
                                                    const usedMB = account.quota_used || 0;
                                                    const totalMB = account.quota || 1024;
                                                    const pct = totalMB > 0 ? Math.min(100, Math.round((usedMB / totalMB) * 100)) : 0;
                                                    return (
                                                        <tr key={account.id}>
                                                            <td>
                                                                <strong>{account.email || account.username}</strong>
                                                            </td>
                                                            <td>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <div style={{
                                                                        flex: 1,
                                                                        height: '8px',
                                                                        background: 'var(--bg-tertiary, #e5e7eb)',
                                                                        borderRadius: '4px',
                                                                        overflow: 'hidden',
                                                                        minWidth: '80px'
                                                                    }}>
                                                                        <div style={{
                                                                            width: `${pct}%`,
                                                                            height: '100%',
                                                                            background: pct > 90 ? 'var(--color-danger, #ef4444)' : pct > 70 ? 'var(--color-warning, #f59e0b)' : 'var(--color-success, #22c55e)',
                                                                            borderRadius: '4px',
                                                                            transition: 'width 0.3s ease'
                                                                        }} />
                                                                    </div>
                                                                    <span style={{ fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                                                                        {usedMB} / {totalMB} MB ({pct}%)
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <span className={`badge ${account.active !== false ? 'badge-success' : 'badge-warning'}`}>
                                                                    {account.active !== false ? 'Active' : 'Inactive'}
                                                                </span>
                                                            </td>
                                                            <td>{account.created_at ? new Date(account.created_at).toLocaleDateString() : '-'}</td>
                                                            <td className="actions">
                                                                <button
                                                                    className="btn btn-sm btn-secondary"
                                                                    onClick={() => openPasswordModal(account.id)}
                                                                    title="Change Password"
                                                                >
                                                                    Password
                                                                </button>
                                                                <button
                                                                    className="btn btn-sm btn-secondary"
                                                                    onClick={() => openEditQuotaModal(account.id, account.quota)}
                                                                    title="Edit Quota"
                                                                >
                                                                    Quota
                                                                </button>
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={() => handleDeleteAccount(account.id, account.email || account.username)}
                                                                    title="Delete"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== ALIASES & FORWARDING TAB ===== */}
                        {activeTab === 'aliases' && (
                            <div className="aliases-tab">
                                <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                                    <label>Select Domain</label>
                                    <select
                                        value={selectedDomainId}
                                        onChange={(e) => {
                                            setSelectedDomainId(e.target.value);
                                            if (e.target.value) {
                                                loadAliases(e.target.value);
                                                loadAccounts(e.target.value);
                                            }
                                        }}
                                    >
                                        <option value="">Select Domain</option>
                                        {domains.map((d) => (
                                            <option key={d.id} value={d.id}>{d.domain || d.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {!selectedDomainId ? (
                                    <div className="empty-state">
                                        <span className="icon">domain</span>
                                        <p>Select a domain to manage aliases and forwarding</p>
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                        {/* Aliases Section */}
                                        <div className="card">
                                            <div className="card-header">
                                                <h4>Aliases</h4>
                                                <button className="btn btn-sm btn-primary" onClick={() => setShowAddAliasModal(true)}>
                                                    Add Alias
                                                </button>
                                            </div>
                                            <div className="card-body">
                                                {aliases.length === 0 ? (
                                                    <div className="empty-state">
                                                        <p>No aliases configured</p>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        {aliases.map((alias) => (
                                                            <div key={alias.id} style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                padding: '0.5rem 0',
                                                                borderBottom: '1px solid var(--border-color, #e5e7eb)'
                                                            }}>
                                                                <div>
                                                                    <code>{alias.source}</code>
                                                                    <span style={{ margin: '0 0.5rem', color: 'var(--text-muted)' }}>&rarr;</span>
                                                                    <code>{alias.destination}</code>
                                                                </div>
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={() => handleDeleteAlias(alias.id)}
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Forwarding Section */}
                                        <div className="card">
                                            <div className="card-header">
                                                <h4>Forwarding</h4>
                                                <button
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => setShowAddForwardingModal(true)}
                                                    disabled={!selectedForwardingAccount}
                                                >
                                                    Add Rule
                                                </button>
                                            </div>
                                            <div className="card-body">
                                                <div className="form-group" style={{ marginBottom: '1rem' }}>
                                                    <label>Account</label>
                                                    <select
                                                        value={selectedForwardingAccount}
                                                        onChange={(e) => {
                                                            setSelectedForwardingAccount(e.target.value);
                                                            if (e.target.value) loadForwarding(e.target.value);
                                                        }}
                                                    >
                                                        <option value="">Select Account</option>
                                                        {accounts.map((a) => (
                                                            <option key={a.id} value={a.id}>{a.email || a.username}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {!selectedForwardingAccount ? (
                                                    <div className="empty-state">
                                                        <p>Select an account to view forwarding rules</p>
                                                    </div>
                                                ) : forwarding.length === 0 ? (
                                                    <div className="empty-state">
                                                        <p>No forwarding rules</p>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        {forwarding.map((rule) => (
                                                            <div key={rule.id} style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                padding: '0.5rem 0',
                                                                borderBottom: '1px solid var(--border-color, #e5e7eb)'
                                                            }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <code>{rule.destination}</code>
                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', cursor: 'pointer' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={rule.keep_copy ?? true}
                                                                            onChange={() => handleToggleForwardingKeepCopy(rule)}
                                                                        />
                                                                        Keep copy
                                                                    </label>
                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85em', cursor: 'pointer' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={rule.active ?? true}
                                                                            onChange={() => handleToggleForwarding(rule)}
                                                                        />
                                                                        Active
                                                                    </label>
                                                                </div>
                                                                <button
                                                                    className="btn btn-sm btn-danger"
                                                                    onClick={() => handleDeleteForwarding(rule.id)}
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== DNS & AUTHENTICATION TAB ===== */}
                        {activeTab === 'dns' && (
                            <div className="dns-tab">
                                {/* DNS Providers */}
                                <div className="section-header">
                                    <h3>DNS Providers</h3>
                                    <button className="btn btn-primary" onClick={() => setShowAddProviderModal(true)}>
                                        Add Provider
                                    </button>
                                </div>
                                {dnsProviders.length === 0 ? (
                                    <div className="empty-state" style={{ marginBottom: '2rem' }}>
                                        <p>No DNS providers configured</p>
                                        <button className="btn btn-primary" onClick={() => setShowAddProviderModal(true)}>
                                            Add First Provider
                                        </button>
                                    </div>
                                ) : (
                                    <div className="config-grid" style={{ marginBottom: '2rem' }}>
                                        {dnsProviders.map((provider) => (
                                            <div key={provider.id} className="card" style={{ marginBottom: '1rem' }}>
                                                <div className="card-header">
                                                    <h4>{provider.name}</h4>
                                                    <span className="badge badge-info">{provider.type}</span>
                                                </div>
                                                <div className="card-body">
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            className="btn btn-sm btn-secondary"
                                                            onClick={() => handleTestProvider(provider.id)}
                                                            disabled={actionLoading}
                                                        >
                                                            Test Connection
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleDeleteProvider(provider.id, provider.name)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* DKIM Records */}
                                <h3>DKIM Records</h3>
                                {domains.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>No domains configured</p>
                                ) : (
                                    <div style={{ marginBottom: '2rem' }}>
                                        {domains.map((domain) => (
                                            <div key={domain.id} className="card" style={{ marginBottom: '1rem' }}>
                                                <div className="card-header">
                                                    <h4>{domain.domain || domain.name} - DKIM</h4>
                                                </div>
                                                <div className="card-body">
                                                    {domain.dkim_record ? (
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                                            <code style={{
                                                                flex: 1,
                                                                padding: '0.5rem',
                                                                background: 'var(--bg-tertiary, #f3f4f6)',
                                                                borderRadius: '4px',
                                                                fontSize: '0.8em',
                                                                wordBreak: 'break-all'
                                                            }}>
                                                                {domain.dkim_record}
                                                            </code>
                                                            <button
                                                                className="btn btn-sm btn-ghost"
                                                                onClick={() => copyToClipboard(domain.dkim_record)}
                                                                title="Copy"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p style={{ color: 'var(--text-muted)' }}>DKIM record not available</p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* SPF / DMARC Records */}
                                <h3>SPF & DMARC Records</h3>
                                {domains.length === 0 ? (
                                    <p style={{ color: 'var(--text-muted)' }}>No domains configured</p>
                                ) : (
                                    <div>
                                        {domains.map((domain) => (
                                            <div key={domain.id} className="card" style={{ marginBottom: '1rem' }}>
                                                <div className="card-header">
                                                    <h4>{domain.domain || domain.name}</h4>
                                                </div>
                                                <div className="card-body">
                                                    <div style={{ marginBottom: '1rem' }}>
                                                        <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>SPF Record</label>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <code style={{
                                                                flex: 1,
                                                                padding: '0.5rem',
                                                                background: 'var(--bg-tertiary, #f3f4f6)',
                                                                borderRadius: '4px',
                                                                fontSize: '0.85em'
                                                            }}>
                                                                {domain.spf_record || `v=spf1 mx a ~all`}
                                                            </code>
                                                            <button
                                                                className="btn btn-sm btn-ghost"
                                                                onClick={() => copyToClipboard(domain.spf_record || `v=spf1 mx a ~all`)}
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>DMARC Record</label>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <code style={{
                                                                flex: 1,
                                                                padding: '0.5rem',
                                                                background: 'var(--bg-tertiary, #f3f4f6)',
                                                                borderRadius: '4px',
                                                                fontSize: '0.85em'
                                                            }}>
                                                                {domain.dmarc_record || `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain.domain || domain.name}`}
                                                            </code>
                                                            <button
                                                                className="btn btn-sm btn-ghost"
                                                                onClick={() => copyToClipboard(domain.dmarc_record || `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain.domain || domain.name}`)}
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ===== SPAM FILTER TAB ===== */}
                        {activeTab === 'spam' && (
                            <div className="spam-tab">
                                <h3>SpamAssassin Configuration</h3>
                                {status?.spamassassin?.installed && (
                                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                                        <span className={`badge ${status.spamassassin.installed ? 'badge-success' : 'badge-danger'}`}>
                                            {status.spamassassin.installed ? 'Installed' : 'Not Installed'}
                                        </span>
                                        <span className={`badge ${status.spamassassin.running ? 'badge-success' : 'badge-warning'}`}>
                                            {status.spamassassin.running ? 'Running' : 'Stopped'}
                                        </span>
                                        {status.spamassassin.version && (
                                            <span className="badge">v{status.spamassassin.version}</span>
                                        )}
                                    </div>
                                )}

                                <div className="card">
                                    <div className="card-body">
                                        <div className="form-group">
                                            <label>Required Score (1-20)</label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="20"
                                                value={spamForm.required_score}
                                                onChange={(e) => setSpamForm({ ...spamForm, required_score: Number(e.target.value) })}
                                            />
                                            <span className="form-help">Messages scoring above this threshold are marked as spam</span>
                                        </div>

                                        <div className="form-group">
                                            <label>Rewrite Subject Prefix</label>
                                            <input
                                                type="text"
                                                value={spamForm.rewrite_subject}
                                                onChange={(e) => setSpamForm({ ...spamForm, rewrite_subject: e.target.value })}
                                                placeholder="[SPAM]"
                                            />
                                            <span className="form-help">Prefix added to subject line of spam messages</span>
                                        </div>

                                        <div className="form-group">
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={spamForm.use_bayes}
                                                    onChange={(e) => setSpamForm({ ...spamForm, use_bayes: e.target.checked })}
                                                />
                                                Use Bayes Filter
                                            </label>
                                            <span className="form-help">Enable Bayesian spam classification</span>
                                        </div>

                                        <div className="form-group">
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={spamForm.auto_learn}
                                                    onChange={(e) => setSpamForm({ ...spamForm, auto_learn: e.target.checked })}
                                                />
                                                Auto-learn
                                            </label>
                                            <span className="form-help">Automatically learn from incoming messages</span>
                                        </div>

                                        <div className="form-group">
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={spamForm.skip_rbl_checks}
                                                    onChange={(e) => setSpamForm({ ...spamForm, skip_rbl_checks: e.target.checked })}
                                                />
                                                Skip RBL Checks
                                            </label>
                                            <span className="form-help">Skip real-time blackhole list checks</span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleSaveSpamConfig}
                                                disabled={actionLoading}
                                            >
                                                {actionLoading ? 'Saving...' : 'Save Configuration'}
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={handleUpdateSpamRules}
                                                disabled={actionLoading}
                                            >
                                                {actionLoading ? 'Updating...' : 'Update Rules'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ===== WEBMAIL TAB ===== */}
                        {activeTab === 'webmail' && (
                            <div className="webmail-tab">
                                <h3>Roundcube Webmail</h3>

                                <div className="card" style={{ marginBottom: '1.5rem' }}>
                                    <div className="card-header">
                                        <h4>Status</h4>
                                    </div>
                                    <div className="card-body">
                                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                            <span className={`badge ${webmailStatus?.installed ? 'badge-success' : 'badge-danger'}`}>
                                                {webmailStatus?.installed ? 'Installed' : 'Not Installed'}
                                            </span>
                                            {webmailStatus?.installed && (
                                                <span className={`badge ${webmailStatus?.running ? 'badge-success' : 'badge-warning'}`}>
                                                    {webmailStatus?.running ? 'Running' : 'Stopped'}
                                                </span>
                                            )}
                                            {webmailStatus?.port && (
                                                <span className="badge">Port: {webmailStatus.port}</span>
                                            )}
                                        </div>

                                        {!webmailStatus?.installed ? (
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleInstallWebmail}
                                                disabled={actionLoading}
                                            >
                                                {actionLoading ? 'Installing...' : 'Install Roundcube'}
                                            </button>
                                        ) : (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {webmailStatus?.running ? (
                                                    <>
                                                        <button
                                                            className="btn btn-sm btn-secondary"
                                                            onClick={() => handleWebmailControl('restart')}
                                                            disabled={actionLoading}
                                                        >
                                                            Restart
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleWebmailControl('stop')}
                                                            disabled={actionLoading}
                                                        >
                                                            Stop
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => handleWebmailControl('start')}
                                                        disabled={actionLoading}
                                                    >
                                                        Start
                                                    </button>
                                                )}
                                                {webmailStatus?.url && (
                                                    <a
                                                        href={webmailStatus.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="btn btn-sm btn-secondary"
                                                    >
                                                        Open Roundcube
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {webmailStatus?.installed && (
                                    <div className="card">
                                        <div className="card-header">
                                            <h4>Configure Nginx Proxy</h4>
                                        </div>
                                        <div className="card-body">
                                            <div className="form-group">
                                                <label>Domain</label>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <input
                                                        type="text"
                                                        value={webmailProxyDomain}
                                                        onChange={(e) => setWebmailProxyDomain(e.target.value)}
                                                        placeholder="mail.example.com"
                                                        style={{ flex: 1 }}
                                                    />
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={handleConfigureProxy}
                                                        disabled={actionLoading || !webmailProxyDomain.trim()}
                                                    >
                                                        {actionLoading ? 'Configuring...' : 'Configure'}
                                                    </button>
                                                </div>
                                                <span className="form-help">Set up Nginx reverse proxy for Roundcube on this domain</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {webmailStatus?.installed && webmailStatus?.port && (
                                    <div style={{ marginTop: '1rem' }}>
                                        <a
                                            href={`http://localhost:${webmailStatus.port}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-secondary"
                                        >
                                            Open Roundcube (localhost:{webmailStatus.port})
                                        </a>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ===== MODALS ===== */}

            {/* Install Email Server Modal */}
            {showInstallModal && (
                <div className="modal-overlay" onClick={() => setShowInstallModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Install Email Server</h2>
                            <button className="btn btn-icon" onClick={() => setShowInstallModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>This will install and configure Postfix, Dovecot, OpenDKIM, and SpamAssassin.</p>
                            <div className="form-group">
                                <label>Hostname *</label>
                                <input
                                    type="text"
                                    value={installHostname}
                                    onChange={(e) => setInstallHostname(e.target.value)}
                                    placeholder="mail.example.com"
                                />
                                <span className="form-help">The fully qualified domain name for your mail server</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleInstall}
                                disabled={actionLoading || !installHostname.trim()}
                            >
                                {actionLoading ? 'Installing...' : 'Install'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Domain Modal */}
            {showAddDomainModal && (
                <div className="modal-overlay" onClick={() => setShowAddDomainModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Email Domain</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddDomainModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Domain Name *</label>
                                <input
                                    type="text"
                                    value={newDomain.domain}
                                    onChange={(e) => setNewDomain({ ...newDomain, domain: e.target.value })}
                                    placeholder="example.com"
                                />
                            </div>
                            <div className="form-group">
                                <label>DNS Provider</label>
                                <select
                                    value={newDomain.dns_provider_id}
                                    onChange={(e) => handleProviderChange(e.target.value)}
                                >
                                    <option value="">None (Manual DNS)</option>
                                    {dnsProviders.map((p) => (
                                        <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                                    ))}
                                </select>
                                <span className="form-help">Select a DNS provider for automatic DNS record management</span>
                            </div>
                            {newDomain.dns_provider_id && (
                                <div className="form-group">
                                    <label>DNS Zone</label>
                                    {zonesLoading ? (
                                        <p>Loading zones...</p>
                                    ) : (
                                        <select
                                            value={newDomain.zone_id}
                                            onChange={(e) => setNewDomain({ ...newDomain, zone_id: e.target.value })}
                                        >
                                            <option value="">Select Zone</option>
                                            {providerZones.map((z) => (
                                                <option key={z.id} value={z.id}>{z.name || z.domain}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddDomainModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddDomain}
                                disabled={actionLoading || !newDomain.domain.trim()}
                            >
                                {actionLoading ? 'Adding...' : 'Add Domain'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Account Modal */}
            {showCreateAccountModal && (
                <div className="modal-overlay" onClick={() => setShowCreateAccountModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Email Account</h2>
                            <button className="btn btn-icon" onClick={() => setShowCreateAccountModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Username *</label>
                                <input
                                    type="text"
                                    value={newAccount.username}
                                    onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                                    placeholder="user"
                                />
                                <span className="form-help">The local part of the email address (before @)</span>
                            </div>
                            <div className="form-group">
                                <label>Password *</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        type="text"
                                        value={newAccount.password}
                                        onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                                        placeholder="Enter password"
                                        style={{ flex: 1 }}
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => setNewAccount({ ...newAccount, password: generatePassword() })}
                                    >
                                        Generate
                                    </button>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Quota (MB)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <input
                                        type="range"
                                        min="64"
                                        max="10240"
                                        step="64"
                                        value={newAccount.quota}
                                        onChange={(e) => setNewAccount({ ...newAccount, quota: Number(e.target.value) })}
                                        style={{ flex: 1 }}
                                    />
                                    <input
                                        type="number"
                                        min="64"
                                        max="10240"
                                        value={newAccount.quota}
                                        onChange={(e) => setNewAccount({ ...newAccount, quota: Number(e.target.value) })}
                                        style={{ width: '100px' }}
                                    />
                                    <span>MB</span>
                                </div>
                                <span className="form-help">Default: 1024 MB (1 GB)</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCreateAccountModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateAccount}
                                disabled={actionLoading || !newAccount.username.trim()}
                            >
                                {actionLoading ? 'Creating...' : 'Create Account'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Change Password Modal */}
            {showChangePasswordModal && (
                <div className="modal-overlay" onClick={() => setShowChangePasswordModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Change Password</h2>
                            <button className="btn btn-icon" onClick={() => setShowChangePasswordModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>New Password *</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        type="text"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="Enter new password"
                                        style={{ flex: 1 }}
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => setNewPassword(generatePassword())}
                                    >
                                        Generate
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowChangePasswordModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleChangePassword}
                                disabled={actionLoading || !newPassword.trim()}
                            >
                                {actionLoading ? 'Changing...' : 'Change Password'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Quota Modal */}
            {showEditQuotaModal && (
                <div className="modal-overlay" onClick={() => setShowEditQuotaModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Edit Quota</h2>
                            <button className="btn btn-icon" onClick={() => setShowEditQuotaModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Quota (MB)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <input
                                        type="range"
                                        min="64"
                                        max="10240"
                                        step="64"
                                        value={newQuota}
                                        onChange={(e) => setNewQuota(Number(e.target.value))}
                                        style={{ flex: 1 }}
                                    />
                                    <input
                                        type="number"
                                        min="64"
                                        max="10240"
                                        value={newQuota}
                                        onChange={(e) => setNewQuota(Number(e.target.value))}
                                        style={{ width: '100px' }}
                                    />
                                    <span>MB</span>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowEditQuotaModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleEditQuota}
                                disabled={actionLoading}
                            >
                                {actionLoading ? 'Saving...' : 'Save Quota'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Alias Modal */}
            {showAddAliasModal && (
                <div className="modal-overlay" onClick={() => setShowAddAliasModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Alias</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddAliasModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Source *</label>
                                <input
                                    type="text"
                                    value={newAlias.source}
                                    onChange={(e) => setNewAlias({ ...newAlias, source: e.target.value })}
                                    placeholder="info"
                                />
                                <span className="form-help">
                                    Local part (the domain will be appended automatically)
                                </span>
                            </div>
                            <div className="form-group">
                                <label>Destination *</label>
                                <input
                                    type="text"
                                    value={newAlias.destination}
                                    onChange={(e) => setNewAlias({ ...newAlias, destination: e.target.value })}
                                    placeholder="user@example.com"
                                />
                                <span className="form-help">Full email address to deliver to</span>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddAliasModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddAlias}
                                disabled={actionLoading || !newAlias.source.trim() || !newAlias.destination.trim()}
                            >
                                {actionLoading ? 'Adding...' : 'Add Alias'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Forwarding Modal */}
            {showAddForwardingModal && (
                <div className="modal-overlay" onClick={() => setShowAddForwardingModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add Forwarding Rule</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddForwardingModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Destination Email *</label>
                                <input
                                    type="email"
                                    value={newForwarding.destination}
                                    onChange={(e) => setNewForwarding({ ...newForwarding, destination: e.target.value })}
                                    placeholder="forward@example.com"
                                />
                            </div>
                            <div className="form-group">
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={newForwarding.keep_copy}
                                        onChange={(e) => setNewForwarding({ ...newForwarding, keep_copy: e.target.checked })}
                                    />
                                    Keep a copy in the original mailbox
                                </label>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddForwardingModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddForwarding}
                                disabled={actionLoading || !newForwarding.destination.trim()}
                            >
                                {actionLoading ? 'Adding...' : 'Add Rule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add DNS Provider Modal */}
            {showAddProviderModal && (
                <div className="modal-overlay" onClick={() => setShowAddProviderModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Add DNS Provider</h2>
                            <button className="btn btn-icon" onClick={() => setShowAddProviderModal(false)}>
                                <span className="icon">close</span>
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Provider Name *</label>
                                <input
                                    type="text"
                                    value={newProvider.name}
                                    onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                                    placeholder="My DNS Provider"
                                />
                            </div>
                            <div className="form-group">
                                <label>Type *</label>
                                <select
                                    value={newProvider.type}
                                    onChange={(e) => setNewProvider({ ...newProvider, type: e.target.value })}
                                >
                                    <option value="cloudflare">Cloudflare</option>
                                    <option value="route53">Route53</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>API Key *</label>
                                <input
                                    type="password"
                                    value={newProvider.api_key}
                                    onChange={(e) => setNewProvider({ ...newProvider, api_key: e.target.value })}
                                    placeholder="Enter API key"
                                />
                            </div>
                            {newProvider.type === 'route53' && (
                                <div className="form-group">
                                    <label>API Secret *</label>
                                    <input
                                        type="password"
                                        value={newProvider.api_secret}
                                        onChange={(e) => setNewProvider({ ...newProvider, api_secret: e.target.value })}
                                        placeholder="Enter API secret"
                                    />
                                </div>
                            )}
                            {newProvider.type === 'cloudflare' && (
                                <div className="form-group">
                                    <label>API Email</label>
                                    <input
                                        type="email"
                                        value={newProvider.api_email}
                                        onChange={(e) => setNewProvider({ ...newProvider, api_email: e.target.value })}
                                        placeholder="email@example.com"
                                    />
                                    <span className="form-help">Required if using Global API Key (not API Token)</span>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddProviderModal(false)}>
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddProvider}
                                disabled={actionLoading || !newProvider.name.trim() || !newProvider.api_key.trim()}
                            >
                                {actionLoading ? 'Adding...' : 'Add Provider'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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

export default Email;
