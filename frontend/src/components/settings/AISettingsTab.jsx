import { useEffect, useState } from 'react';
import api from '../../services/api';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useAuth } from '../../contexts/useAuth.js';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '../ui/input';
import EmptyState from '../EmptyState';
import { Button } from '@/components/ui/button';
import AIConnectionsSettings from './AIConnectionsSettings';
import AIManagementSettings from './AIManagementSettings';
import AIUsageSettings from './AIUsageSettings';
import { SegControl } from '../ds/SegControl';
import { useTranslation } from 'react-i18next';

const AI_CONFIG_CHANGED_EVENT = 'serverkit:ai-config-changed';

const AISettingsTab = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const { isAdmin } = useAuth();
    const [settings, setSettings] = useState({
        enabled: false, provider: '', model: '', endpoint: '',
        pii_redaction: true, injection_detection: true, max_cost_usd: '0.5',
        api_key_set: false,
    });
    const [providers, setProviders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [message, setMessage] = useState(null);
    const [section, setSection] = useState('connections');

    useEffect(() => {
        if (!isAdmin) { setLoading(false); return; }
        let active = true;
        setLoading(true);
        Promise.all([api.aiGetSettings(), api.aiGetProviders()])
            .then(([s, p]) => {
                if (!active) return;
                setSettings((prev) => ({ ...prev, ...s, max_cost_usd: String(s.max_cost_usd ?? '0.5') }));
                setProviders(p.providers || []);
            })
            .catch((e) => { if (!active) return; setLoadError(true); setMessage({ type: 'error', text: e.message || 'Failed to load AI settings' }); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [isAdmin]);

    const refreshConnections = async () => {
        const fresh = await api.aiGetSettings();
        setSettings((prev) => ({ ...prev, connections: fresh.connections, default_connection_id: fresh.default_connection_id }));
        window.dispatchEvent(new Event(AI_CONFIG_CHANGED_EVENT));
        return fresh;
    };

    const buildPayload = () => {
        const payload = {
            pii_redaction: settings.pii_redaction,
            injection_detection: settings.injection_detection,
            max_cost_usd: settings.max_cost_usd,
        };
        return payload;
    };

    const handleEnabledChange = async (enabled) => {
        setToggling(true);
        setMessage(null);
        try {
            await api.aiUpdateSettings({ enabled });
            setSettings((prev) => ({ ...prev, enabled }));
            window.dispatchEvent(new Event(AI_CONFIG_CHANGED_EVENT));
            setMessage({ type: 'success', text: enabled
                ? t('ai.settings.enabledMessage', 'Assistant enabled. New messages can use the default connection.')
                : t('ai.settings.disabledMessage', 'Assistant disabled. New messages are blocked; chat history is kept.') });
        } catch (error) {
            setMessage({ type: 'error', text: error.message });
        } finally { setToggling(false); }
    };

    const handleSave = async () => {
        if (!settings.max_cost_usd.trim() || !Number.isFinite(Number(settings.max_cost_usd)) || Number(settings.max_cost_usd) < 0) {
            setMessage({ type: 'error', text: t('ai.settings.invalidBudget', 'Enter a cost ceiling of zero or more.') });
            return;
        }
        setSaving(true);
        setMessage(null);
        try {
            await api.aiUpdateSettings(buildPayload());
            const fresh = await api.aiGetSettings();
            setSettings((prev) => ({ ...prev, ...fresh, max_cost_usd: String(fresh.max_cost_usd ?? '0.5') }));
            window.dispatchEvent(new Event(AI_CONFIG_CHANGED_EVENT));
            setMessage({ type: 'success', text: 'AI settings saved' });
        } catch (e) {
            setMessage({ type: 'error', text: e.message || 'Failed to save AI settings' });
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) {
        return <div className="settings-section"><p>{t('app.aISettingsTab.adminAccessRequired', 'Admin access required.')}</p></div>;
    }
    if (loading) {
        return <EmptyState loading title={t('common.loading', 'Loading…')} />;
    }


    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.aISettingsTab.aiAssistant', 'AI Assistant')}</h2>
            </div>
            {message && <div className={`alert alert-${message.type === 'error' ? 'danger' : 'success'}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
            <SegControl className="sk-ai-settings-tabs" value={section} onChange={setSection} aria-label={t('ai.management.sections', 'AI settings sections')} options={[
                { value: 'connections', label: t('ai.management.connectionsSafety', 'Connections and protections') },
                { value: 'models', label: t('ai.management.modelsBehavior', 'Task models and behavior') },
                { value: 'usage', label: t('ai.usage.title', 'AI usage') },
            ]} />
            <div hidden={section !== 'connections'}>
            <div {...register('ai-enable', 'settings-card')}>
                <div className="settings-row">
                    <div className="settings-label">
                        <Label htmlFor="ai-enabled">{t('app.aISettingsTab.enableAiAssistant', 'Enable AI assistant')}</Label>
                        <span className="settings-hint">{settings.default_connection_id
                            ? t('ai.settings.enabledHint', 'Changes apply immediately to new messages. Configure the default connection below.')
                            : t('ai.settings.setupHint', 'Save a provider connection below before enabling the assistant.')}</span>
                    </div>
                    <Switch id="ai-enabled" checked={settings.enabled}
                        disabled={loadError || toggling || saving || (!settings.enabled && !settings.default_connection_id)}
                        onCheckedChange={handleEnabledChange} />
                </div>
            </div>
            <div {...register('ai-provider')}>
                <AIConnectionsSettings connections={settings.connections || []} providers={providers}
                    defaultId={settings.default_connection_id} onSaved={refreshConnections} />
            </div>
            <div className="settings-card">
                <h3>{t('ai.settings.limits', 'Limits and protections')}</h3>
                <p>{t('ai.settings.limitsHint', 'These settings apply to assistant conversations. Save changes to apply them.')}</p>
                <div {...register('ai-cost-limit', 'form-group')}>
                    <label htmlFor="ai-max-cost">{t('app.aISettingsTab.perConversationCostCeilingUsd', 'Per-conversation cost ceiling (USD)')}</label>
                    <Input
                        id="ai-max-cost"
                        type="number"
                        step="0.01"
                        min="0"
                        aria-describedby="ai-max-cost-hint"
                        disabled={loadError || saving}
                        value={settings.max_cost_usd}
                        onChange={(e) => setSettings((s) => ({ ...s, max_cost_usd: e.target.value }))}
                    />
                    <p id="ai-max-cost-hint" className="settings-hint">{t('ai.settings.costHint', 'Used by the budget behavior in Task models and behavior. A call can exceed the remaining amount; models with unknown pricing need a provider-side limit. Set 0 for no limit.')}</p>
                </div>

                <div {...register('ai-pii-redaction', 'form-group')}>
                    <div className="settings-row">
                        <div className="settings-label"><Label htmlFor="ai-pii">{t('app.aISettingsTab.redactPiiFromMessagesToolOutput', 'Redact PII from messages & tool output')}</Label></div>
                        <Switch id="ai-pii" disabled={loadError || saving}
                            checked={settings.pii_redaction}
                            onCheckedChange={(v) => setSettings((s) => ({ ...s, pii_redaction: v }))}
                        />
                    </div>
                </div>
                <div {...register('ai-injection-detection', 'form-group')}>
                    <div className="settings-row">
                        <div className="settings-label"><Label htmlFor="ai-injection">{t('app.aISettingsTab.blockPromptInjectionAttempts', 'Block prompt-injection attempts')}</Label></div>
                        <Switch id="ai-injection" disabled={loadError || saving}
                            checked={settings.injection_detection}
                            onCheckedChange={(v) => setSettings((s) => ({ ...s, injection_detection: v }))}
                        />
                    </div>
                </div>

                <div className="settings-actions">
                    <Button variant="primary" onClick={handleSave} disabled={loadError || saving || toggling}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
            </div>
            </div>
            <div hidden={section !== 'models'}><AIManagementSettings connections={settings.connections || []} defaultId={settings.default_connection_id} /></div>
            <div hidden={section !== 'usage'}><AIUsageSettings connections={settings.connections || []} /></div>
        </div>
    );
};

export default AISettingsTab;
