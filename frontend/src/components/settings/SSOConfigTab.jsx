import { useState, useEffect } from 'react';
import api from '../../services/api';
import useSettingFocus from '../../hooks/useSettingFocus';
import SSOProviderIcon from '../SSOProviderIcon';
import {
    Save, RefreshCw, CheckCircle, XCircle, AlertTriangle, Shield, Globe,
    ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

const PROVIDERS = [
    { id: 'google', name: 'Google', fields: ['client_id', 'client_secret'] },
    { id: 'github', name: 'GitHub', fields: ['client_id', 'client_secret'] },
    {
        id: 'oidc', name: 'OIDC', fields: [
            'provider_name', 'client_id', 'client_secret', 'discovery_url'
        ]
    },
    {
        id: 'saml', name: 'SAML 2.0', fields: [
            'entity_id', 'idp_metadata_url', 'idp_sso_url', 'idp_cert'
        ]
    },
];

const FIELD_LABELS = {
    client_id: 'Client ID',
    client_secret: 'Client Secret',
    provider_name: 'Provider Name',
    discovery_url: 'Discovery URL',
    entity_id: 'SP Entity ID',
    idp_metadata_url: 'IdP Metadata URL',
    idp_sso_url: 'IdP SSO URL',
    idp_cert: 'IdP Certificate (PEM)',
};

const SSOConfigTab = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const [config, setConfig] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [testing, setTesting] = useState({});
    const [testResults, setTestResults] = useState({});
    const [generalSaving, setGeneralSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [expandedProvider, setExpandedProvider] = useState(null);

    // General settings local state
    const [autoProvision, setAutoProvision] = useState(true);
    const [defaultRole, setDefaultRole] = useState('developer');
    const [forceSso, setForceSso] = useState(false);
    const [allowedDomains, setAllowedDomains] = useState('');

    useEffect(() => {
        loadConfig();
    }, []);

    async function loadConfig() {
        try {
            const data = await api.getSSOConfig();
            setConfig(data.config || {});
            setAutoProvision(data.config?.sso_auto_provision ?? true);
            setDefaultRole(data.config?.sso_default_role || 'developer');
            setForceSso(data.config?.sso_force_sso ?? false);
            const domains = data.config?.sso_allowed_domains || [];
            setAllowedDomains(Array.isArray(domains) ? domains.join(', ') : '');
        } catch {
            setMessage({ type: 'error', text: 'Failed to load SSO config' });
        } finally {
            setLoading(false);
        }
    }

    function getFieldValue(provider, field) {
        const key = `sso_${provider}_${field}`;
        return config[key] ?? '';
    }

    function setFieldValue(provider, field, value) {
        const key = `sso_${provider}_${field}`;
        setConfig(prev => ({ ...prev, [key]: value }));
    }

    async function handleSaveProvider(providerId) {
        setSaving(prev => ({ ...prev, [providerId]: true }));
        setMessage(null);
        try {
            const provider = PROVIDERS.find(p => p.id === providerId);
            const body = {};
            body.enabled = config[`sso_${providerId}_enabled`] ?? false;
            for (const field of provider.fields) {
                body[field] = getFieldValue(providerId, field);
            }
            await api.updateSSOProviderConfig(providerId, body);
            setMessage({ type: 'success', text: `${provider.name} config saved` });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(prev => ({ ...prev, [providerId]: false }));
        }
    }

    async function handleTestProvider(providerId) {
        setTesting(prev => ({ ...prev, [providerId]: true }));
        setTestResults(prev => ({ ...prev, [providerId]: null }));
        try {
            const result = await api.testSSOProvider(providerId);
            setTestResults(prev => ({ ...prev, [providerId]: result }));
        } catch (err) {
            setTestResults(prev => ({
                ...prev,
                [providerId]: { ok: false, error: err.message }
            }));
        } finally {
            setTesting(prev => ({ ...prev, [providerId]: false }));
        }
    }

    async function handleSaveGeneral() {
        setGeneralSaving(true);
        setMessage(null);
        try {
            const domains = allowedDomains
                .split(',')
                .map(d => d.trim().toLowerCase())
                .filter(Boolean);
            await api.updateSSOGeneralSettings({
                sso_auto_provision: autoProvision,
                sso_default_role: defaultRole,
                sso_force_sso: forceSso,
                sso_allowed_domains: domains,
            });
            setMessage({ type: 'success', text: 'General SSO settings saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setGeneralSaving(false);
        }
    }

    if (loading) {
        return <div className="settings-section"><p>{t('app.sSOConfigTab.loadingSsoConfiguration', 'Loading SSO settings…')}</p></div>;
    }

    return (
        <div className="sso-config">
            <div className="settings-section">
                <h2><Shield size={20} /> {t('app.sSOConfigTab.ssoOauthConfiguration', 'SSO / OAuth settings')}</h2>
                <p className="text-secondary">
                    {t('app.sSOConfigTab.configureExternalIdentityProvidersForSingle', 'Configure external identity providers for single sign-on.')}
                </p>
            </div>

            {message && (
                <div className={`alert alert--${message.type}`}>
                    {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {message.text}
                </div>
            )}

            {/* General Settings */}
            <div {...register('sso-general-settings', 'settings-card sso-general-card')}>
                <div className="settings-card__header">
                    <div className="settings-card__header-left">
                        <Globe size={20} />
                        <div>
                            <h3>{t('app.sSOConfigTab.generalSettings', 'General settings')}</h3>
                        </div>
                    </div>
                </div>

                <div className="sso-general-form">
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>{t('app.sSOConfigTab.autoProvisionUsers', 'Auto-provision users')}</Label>
                            <span className="settings-hint">{t('app.sSOConfigTab.automaticallyCreateAccountsForNewSso', 'Automatically create accounts for new SSO users')}</span>
                        </div>
                        <div className="settings-control">
                            <Switch
                                checked={autoProvision}
                                onCheckedChange={setAutoProvision}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <Label>{t('app.sSOConfigTab.defaultRoleForNewSsoUsers', 'Default role for new SSO users')}</Label>
                        <Select value={defaultRole} onValueChange={setDefaultRole}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="viewer">{t('app.sSOConfigTab.viewer', 'Viewer')}</SelectItem>
                                <SelectItem value="developer">{t('app.sSOConfigTab.developer', 'Developer')}</SelectItem>
                                <SelectItem value="admin">{t('app.sSOConfigTab.admin', 'Admin')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="settings-row">
                        <div className="settings-label">
                            <Label>{t('app.sSOConfigTab.ssoOnlyMode', 'SSO-only mode')}</Label>
                            <span className="settings-hint">
                                {forceSso ? (
                                    <span className="text-warning">
                                        <AlertTriangle size={14} /> {t('app.sSOConfigTab.passwordLoginWillBeDisabledFor', 'Password sign-in will be disabled for all users.')}
                                    </span>
                                ) : (
                                    'Disable password sign-in and require SSO for all users'
                                )}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Switch
                                checked={forceSso}
                                onCheckedChange={setForceSso}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <Label>{t('app.sSOConfigTab.allowedEmailDomains', 'Allowed email domains')}</Label>
                        <Input
                            type="text"
                            value={allowedDomains}
                            onChange={e => setAllowedDomains(e.target.value)}
                            placeholder={t('app.sSOConfigTab.companyComExampleOrg', 'company.com, example.org')}
                        />
                        <span className="form-help">{t('app.sSOConfigTab.commaSeparatedLeaveEmptyToAllow', 'Comma-separated. Leave empty to allow all domains.')}</span>
                    </div>

                    <Button
                        variant="default"
                        onClick={handleSaveGeneral}
                        disabled={generalSaving}
                    >
                        <Save size={16} />
                        {generalSaving ? 'Saving...' : 'Save General Settings'}
                    </Button>
                </div>
            </div>

            {/* Provider Cards */}
            {PROVIDERS.map(provider => {
                const enabled = config[`sso_${provider.id}_enabled`] ?? false;
                const isExpanded = expandedProvider === provider.id;
                const testResult = testResults[provider.id];

                return (
                    <div key={provider.id} {...register(`sso-${provider.id}`, `settings-card sso-provider-config ${enabled ? 'sso-provider-config--enabled' : ''}`)}>
                        <div
                            className="sso-provider-config__header"
                            onClick={() => setExpandedProvider(isExpanded ? null : provider.id)}
                        >
                            <div className="sso-provider-config__title">
                                <SSOProviderIcon provider={provider.id} />
                                <h3>{provider.name}</h3>
                                {enabled && (
                                    <span className="sso-provider-config__status sso-provider-config__status--active">
                                        {t('app.sSOConfigTab.active', 'Active')}
                                    </span>
                                )}
                            </div>
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </div>

                        {isExpanded && (
                            <div className="sso-provider-config__body">
                                <div className="settings-row">
                                    <div className="settings-label">
                                        <Label>{t('common.actions.enable', 'Enable')} {provider.name}</Label>
                                    </div>
                                    <div className="settings-control">
                                        <Switch
                                            checked={enabled}
                                            onCheckedChange={(checked) => setFieldValue(provider.id, 'enabled', checked)}
                                        />
                                    </div>
                                </div>

                                {provider.fields.map(field => (
                                    <div key={field} className="form-group">
                                        <Label>{FIELD_LABELS[field] || field}</Label>
                                        {field === 'idp_cert' ? (
                                            <Textarea
                                                rows={4}
                                                value={getFieldValue(provider.id, field)}
                                                onChange={e => setFieldValue(provider.id, field, e.target.value)}
                                                placeholder={t('app.sSOConfigTab.enter', 'Enter {{value}}', { value: FIELD_LABELS[field] })}
                                            />
                                        ) : (
                                            <Input
                                                type={field.includes('secret') ? 'password' : 'text'}
                                                value={getFieldValue(provider.id, field)}
                                                onChange={e => setFieldValue(provider.id, field, e.target.value)}
                                                placeholder={t('app.sSOConfigTab.enter', 'Enter {{value}}', { value: FIELD_LABELS[field] })}
                                            />
                                        )}
                                    </div>
                                ))}

                                {testResult && (
                                    <div className={`alert alert--${testResult.ok ? 'success' : 'error'}`}>
                                        {testResult.ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                                        {testResult.ok ? testResult.message : testResult.error}
                                    </div>
                                )}

                                <div className="sso-provider-config__actions">
                                    <Button
                                        variant="default"
                                        onClick={() => handleSaveProvider(provider.id)}
                                        disabled={saving[provider.id]}
                                    >
                                        <Save size={16} />
                                        {saving[provider.id] ? 'Saving...' : 'Save'}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() => handleTestProvider(provider.id)}
                                        disabled={testing[provider.id]}
                                    >
                                        <RefreshCw size={16} className={testing[provider.id] ? 'spinning' : ''} />
                                        {testing[provider.id] ? 'Testing...' : 'Test Connection'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default SSOConfigTab;
