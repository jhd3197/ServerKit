import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { FormField } from '../FormField';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';
import ModelBinding from '../ai/ModelBinding';
import EmptyState from '../EmptyState';

// Radix Select cannot hold an empty value; this stands in for "no override".
const PROVIDER_DEFAULT = '__default';

export default function AIManagementSettings({ connections, defaultId }) {
    const { t } = useTranslation();
    const [config, setConfig] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [sample, setSample] = useState('');
    const [preview, setPreview] = useState(null);
    const defaultConnection = connections.find((item) => item.id === defaultId);
    const inherited = config?.profiles.standard || (defaultConnection && { connection_id: defaultId, model: defaultConnection.model });
    const load = () => api.aiGetManagement().then(setConfig).catch((e) => setError(e.message));
    useEffect(() => { let active = true; api.aiGetManagement().then((data) => { if (active) setConfig(data); }).catch((e) => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
    const change = (key, value) => { setConfig((current) => ({ ...current, [key]: value })); setSaved(false); setPreview(null); };
    const submit = async () => {
        setBusy(true); setError('');
        try {
            setConfig(await api.aiSaveManagement(config)); setSaved(true);
            window.dispatchEvent(new Event('serverkit:ai-config-changed'));
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const previewRoute = async () => {
        setBusy(true); setError('');
        try { setPreview(await api.aiPreviewRouting({ message: sample, config })); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    if (!config) return <div className="settings-card">{error ? <><p role="alert">{error}</p><Button onClick={load}>{t('common.retry', 'Retry')}</Button></> : <EmptyState loading title={t('common.loading', 'Loading…')} />}</div>;
    const profiles = [
        ['utility', t('ai.management.utility', 'Utility'), t('ai.management.utilityHint', 'Economical model for summaries and structured extraction.')],
        ['standard', t('ai.management.standard', 'Standard'), t('ai.management.standardHint', 'Everyday questions and tool-assisted troubleshooting.')],
        ['advanced', t('ai.management.advanced', 'Advanced'), t('ai.management.advancedHint', 'Complex analysis and read-only diagnostic tasks.')],
    ];
    const numberField = (key, label, min, max, hint, step = '1') => <FormField key={key} htmlFor={`ai-${key}`} label={label} hint={hint}>
        <Input id={`ai-${key}`} type="number" min={min} max={max} step={step} value={config[key]} disabled={busy} onChange={(e) => change(key, e.target.value)} />
    </FormField>;
    const toggle = (key, label) => <div className="settings-row"><label htmlFor={`ai-${key}`}>{label}</label>
        <Switch id={`ai-${key}`} checked={config[key]} disabled={busy} onCheckedChange={(value) => change(key, value)} /></div>;
    const candidates = (key) => <div className="sk-ai-candidates">
        {config[key].map((candidate, index) => <div className="sk-ai-candidates__row" key={`${key}-${index}`}>
            <ModelBinding id={`ai-${key}-${index}`} value={candidate} connections={connections} disabled={busy} discover onChange={(next) => change(key, config[key].map((item, i) => i === index ? { ...next, ...(key === 'pool' ? { tier: candidate.tier } : {}) } : item))} />
            {key === 'pool' && <FormField htmlFor={`ai-tier-${index}`} label={t('ai.management.tier', 'Capability tier')}>
                <Select value={candidate.tier} disabled={busy} onValueChange={(tier) => change(key, config[key].map((item, i) => i === index ? { ...item, tier } : item))}>
                    <SelectTrigger id={`ai-tier-${index}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="budget">{t('ai.management.utility', 'Utility')}</SelectItem>
                        <SelectItem value="standard">{t('ai.management.standard', 'Standard')}</SelectItem>
                        <SelectItem value="premium">{t('ai.management.advanced', 'Advanced')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>}
            <div className="settings-actions">
                {key === 'fallbacks' && <Button type="button" variant="outline" disabled={busy || index === 0} onClick={() => { const next = [...config[key]]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(key, next); }}>{t('ai.management.moveUp', 'Move up')}</Button>}
                <Button type="button" variant="ghost" disabled={busy} onClick={() => change(key, config[key].filter((_, i) => i !== index))}>{t('common.actions.remove', 'Remove')}</Button>
            </div>
        </div>)}
        <Button type="button" variant="outline" disabled={busy || !connections.length || config[key].length >= 12} onClick={() => change(key, [...config[key], { connection_id: connections[0].id, model: connections[0].model, ...(key === 'pool' ? { tier: 'standard' } : {}) }])}>
            {t('ai.management.addCandidate', 'Add model candidate')}
        </Button>
    </div>;
    return <div className="sk-ai-management">
        <section className="settings-card">
            <h3>{t('ai.management.taskModels', 'Task models')}</h3>
            <p>{t('ai.management.taskModelsHint', 'Choose models by task. New chats resolve these roles; existing chats keep their selected connection.')}</p>
            {profiles.map(([key, label, hint]) => <div className="sk-ai-profile" key={key}>
                <h4>{label}</h4><p className="settings-hint">{hint}</p>
                <ModelBinding id={`ai-profile-${key}`} value={config.profiles[key]} connections={connections} allowInherit discover disabled={busy}
                    inheritLabel={key === 'standard' ? t('ai.management.panelDefault', 'Use panel default') : undefined}
                    onChange={(value) => change('profiles', { ...config.profiles, [key]: value })} />
                {!config.profiles[key] && inherited && <p className="settings-hint">{t('ai.management.inheritedModel', 'Inherited model: {{connection}} · {{model}}', {
                    connection: connections.find((item) => item.id === inherited.connection_id)?.name, model: inherited.model,
                })}</p>}
            </div>)}
        </section>
        <section className="settings-card">
            <h3>{t('ai.management.routing', 'Routing and fallback')}</h3>
            <p>{t('ai.management.routingHint', 'Automatic routing uses only the approved pool below. An explicit model choice takes priority. Capability tiers guide selection; speed is not a measured guarantee.')}</p>
            {toggle('routing_enabled', t('ai.management.enableRouting', 'Enable automatic routing'))}
            <FormField htmlFor="ai-routing-strategy" label={t('ai.management.strategy', 'Strategy')}>
                <Select value={config.strategy} disabled={busy} onValueChange={(value) => change('strategy', value)}>
                    <SelectTrigger id="ai-routing-strategy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="cost_optimized">{t('ai.management.economical', 'Cost optimized')}</SelectItem>
                        <SelectItem value="balanced">{t('ai.management.balanced', 'Balanced')}</SelectItem>
                        <SelectItem value="quality_first">{t('ai.management.quality', 'Quality first')}</SelectItem>
                        <SelectItem value="fast">{t('ai.management.fast', 'Fast')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
            {candidates('pool')}
            <FormField htmlFor="ai-routing-sample" label={t('ai.management.previewTask', 'Preview a task')} hint={t('ai.management.previewHint', 'Uses the current draft. Preview does not send your task to a provider or spend tokens.')}>
                <Input id="ai-routing-sample" value={sample} onChange={(e) => setSample(e.target.value)} maxLength={16000} />
            </FormField>
            <Button type="button" variant="outline" onClick={previewRoute} disabled={busy || !sample.trim()}>{t('ai.management.preview', 'Preview routing')}</Button>
            {preview && <div className="sk-ai-routing-result" role="status"><strong>{connections.find((item) => item.id === preview.connection_id)?.name} · {preview.model}</strong><p>{preview.reason}</p></div>}
            {toggle('fallback_enabled', t('ai.management.enableFallback', 'Enable fallback before output starts'))}
            <p className="settings-hint">{t('ai.management.fallbackHint', 'Candidates are tried in order using their own saved credentials. Delivered output and tool actions are never replayed. Degradation chooses a lower-priced candidate before a turn at 80% of the conversation allowance; unknown prices cannot be compared.')}</p>
            {candidates('fallbacks')}
        </section>
        <section className="settings-card">
            <h3>{t('ai.management.behavior', 'Generation and spending')}</h3>
            <FormField htmlFor="ai-budget-policy" label={t('ai.management.budgetPolicy', 'Conversation budget behavior')}>
                <Select value={config.budget_policy} disabled={busy} onValueChange={(value) => change('budget_policy', value)}>
                    <SelectTrigger id="ai-budget-policy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="hard_stop">{t('ai.management.stop', 'Stop at the limit')}</SelectItem>
                        <SelectItem value="warn_and_continue">{t('ai.management.warn', 'Warn and continue')}</SelectItem>
                        <SelectItem value="degrade">{t('ai.management.degrade', 'Use a cheaper model near the limit, then stop')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
            <div className="ai-connections__fields">
                {numberField('max_output_tokens', t('ai.management.outputTokens', 'Maximum output tokens per response'), 64, 65536)}
                {numberField('max_tokens', t('ai.management.totalTokens', 'Conversation token allowance'), 0, 10000000, t('ai.management.zeroUnlimited', 'Set 0 for no limit.'))}
            </div>
            <details className="sk-ai-advanced"><summary>{t('ai.management.advancedControls', 'Advanced generation controls')}</summary>
                <div className="ai-connections__fields">
                    {numberField('max_tool_rounds', t('ai.management.toolRounds', 'Maximum tool rounds'), 1, 20)}
                    {numberField('max_tool_result_length', t('ai.management.toolLength', 'Maximum tool result characters'), 256, 32000)}
                    {numberField('max_history_messages', t('ai.management.history', 'Messages kept in model context'), 4, 200)}
                    <FormField htmlFor="ai-temperature" label={t('ai.management.temperature', 'Temperature')} hint={t('ai.management.supportedOnly', 'Applied only when the model catalog confirms support. Blank uses the provider default.')}>
                        <Input id="ai-temperature" type="number" min="0" max="2" step="0.1" disabled={busy} value={config.temperature ?? ''} onChange={(e) => change('temperature', e.target.value === '' ? null : e.target.value)} />
                    </FormField>
                    <FormField htmlFor="ai-reasoning" label={t('ai.management.reasoning', 'Reasoning effort')} hint={t('ai.management.reasoningHint', 'Applied to supported OpenAI reasoning models. Other models retain provider defaults.')}>
                        <Select disabled={busy} value={config.reasoning_effort || PROVIDER_DEFAULT} onValueChange={(value) => change('reasoning_effort', value === PROVIDER_DEFAULT ? null : value)}>
                            <SelectTrigger id="ai-reasoning"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={PROVIDER_DEFAULT}>{t('ai.management.providerDefault', 'Provider default')}</SelectItem>
                                <SelectItem value="low">{t('ai.management.low', 'Low')}</SelectItem>
                                <SelectItem value="medium">{t('ai.management.medium', 'Medium')}</SelectItem>
                                <SelectItem value="high">{t('ai.management.high', 'High')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
            </details>
            <details className="sk-ai-advanced"><summary>{t('ai.management.monthly', 'Monthly spending allowances')}</summary>
                <p>{t('ai.management.allowanceHint', 'Allowances include active run reservations. Unknown-cost attempts consume the reservation conservatively. Limits use reported or estimated costs; a final call can overshoot. Use provider limits for authoritative billing caps.')}</p>
                <div className="ai-connections__fields">
                    {numberField('monthly_limit_usd', t('ai.management.panelLimit', 'Panel allowance (USD / month)'), 0, 1000000, null, '0.01')}
                    {numberField('user_monthly_limit_usd', t('ai.management.userLimit', 'Allowance per user (USD / month)'), 0, 1000000, null, '0.01')}
                    {numberField('workspace_monthly_limit_usd', t('ai.management.workspaceLimit', 'Allowance per workspace (USD / month)'), 0, 1000000, t('ai.management.workspaceHint', 'Applies to chats started in an active workspace. User and panel limits also apply.'), '0.01')}
                    {numberField('reservation_usd', t('ai.management.reserve', 'Reserve per run (USD)'), 0.01, 1000, t('ai.management.reserveHint', 'When monthly limits apply, each run reserves this amount and stops further calls when it is spent.'), '0.01')}
                </div>
            </details>
            {error && <p role="alert" className="error-message">{error}</p>}
            {saved && <p role="status">{t('ai.management.saved', 'AI management settings saved.')}</p>}
            <div className="settings-actions settings-actions--footer"><Button onClick={submit} disabled={busy}>{busy ? t('common.saving', 'Saving…') : t('ai.management.save', 'Save AI management settings')}</Button></div>
        </section>
    </div>;
}
