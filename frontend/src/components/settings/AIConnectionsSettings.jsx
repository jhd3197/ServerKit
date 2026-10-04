import { FormField, FormRow } from '../FormField';
import { useRef, useState } from 'react';
import api from '../../services/api';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '../ui/button';
import { useTranslation } from 'react-i18next';

import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import ModelPicker from '../ai/ModelPicker';
import useSettingFocus from '../../hooks/useSettingFocus';

function ChoiceField({ id, label, value, onChange, disabled, placeholder, options, children }) {
    return <FormField htmlFor={id} label={label}>
        <Select value={value || '__new__'} onValueChange={(next) => onChange(next === '__new__' ? '' : next)} disabled={disabled}>
            <SelectTrigger id={id}><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="__new__">{placeholder}</SelectItem>
                {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}
            </SelectContent>
        </Select>
        {children}
    </FormField>;
}

const empty = () => ({ id: '', name: '', provider: '', model: '', config: {}, secrets_set: [], make_default: false });

export default function AIConnectionsSettings({ connections, providers, defaultId, onSaved }) {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const register = useSettingFocus();
    const [draft, setDraft] = useState(() => {
        const row = connections.find((connection) => connection.id === defaultId);
        return row ? { ...row, config: { ...row.config }, make_default: true } : empty();
    });
    const [models, setModels] = useState([]);
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState(null);
    const [message, setMessage] = useState(null);
    const revision = useRef(0);
    const meta = providers.find((provider) => provider.id === draft.provider);

    const edit = (next) => {
        revision.current += 1;
        setDraft(next);
        setModels([]);
        setMessage(null);
    };
    const selectConnection = (id) => {
        const row = connections.find((connection) => connection.id === id);
        edit(row ? { ...row, config: { ...row.config }, make_default: row.id === defaultId } : empty());
    };
    const selectProvider = (provider) => {
        const selected = providers.find((item) => item.id === provider);
        edit({ ...draft, provider, model: '', secrets_set: [],
            config: Object.fromEntries((selected?.fields || []).filter((field) => !field.secret).map((field) => [field.name, field.default])) });
    };
    const setField = (field, value, clear = false) => {
        const config = { ...draft.config, [field.name]: value };
        if (field.secret && !value && !clear && draft.secrets_set.includes(field.name)) delete config[field.name];
        let secretsSet = draft.secrets_set;
        if (field.secret && clear) secretsSet = secretsSet.filter((name) => name !== field.name);
        if (field.type === 'url') {
            for (const secret of meta.fields.filter((item) => item.secret)) delete config[secret.name];
            secretsSet = [];
        }
        revision.current += 1;
        setDraft({ ...draft, config, secrets_set: secretsSet });
        setModels([]);
        setMessage(null);
    };
    const run = async (operation) => {
        const current = revision.current;
        setBusy(true);
        setOperation(operation);
        setMessage(null);
        try {
            if (operation === 'save') {
                const row = await api.aiSaveConnection(draft);
                const fresh = await onSaved();
                if (current === revision.current) setDraft({ ...row, make_default: row.id === fresh.default_connection_id });
                setMessage({ type: 'success', text: t('ai.connections.savedMessage', 'Connection saved. Existing chats keep their connection and model.') });
            } else {
                const result = await api.aiProbeConnection({ ...draft, test: operation === 'test' });
                if (current !== revision.current) return;
                if (operation === 'models') {
                    setModels(result.model_details || result.models || []);
                    setMessage({ type: 'success', text: t('ai.connections.modelsFound', '{{count}} models found. You can also enter a model ID manually.', { count: result.models?.length || 0 }) });
                } else setMessage({ type: 'success', text: result.message || t('ai.connections.verified', 'Connection verified.') });
            }
        } catch (error) {
            if (current === revision.current) setMessage({ type: 'error', text: error.message });
        } finally { setBusy(false); setOperation(null); }
    };
    const remove = async () => {
        if (!await confirm({ title: t('ai.connections.deleteTitle', 'Delete AI connection?'), message: t('ai.connections.deleteMessage', 'Delete {{name}}? Connections used by chats or selected as default cannot be deleted.', { name: draft.name }), confirmText: t('ai.connections.delete', 'Delete'), variant: 'danger' })) return;
        setBusy(true);
        try {
            await api.aiDeleteConnection(draft.id);
            await onSaved();
            edit(empty());
        } catch (error) { setMessage({ type: 'error', text: error.message }); }
        finally { setBusy(false); setOperation(null); }
    };

    return (
        <div className="settings-card ai-connections">
            <h3>{t('ai.connections.title', 'Provider connections')}</h3>
            <p className="section-description">{t('ai.connections.description', 'Configure native Prompture providers or connect a gateway such as OmniRoute. Credentials stay encrypted on the server.')}</p>
            <ChoiceField id="ai-connection" label={t('ai.connections.saved', 'Saved connection')}
                value={draft.id} onChange={selectConnection} disabled={busy}
                placeholder={t('ai.connections.add', 'Add a connection…')}
                options={connections.map((connection) => ({ id: connection.id, label: connection.name + (connection.id === defaultId ? t('ai.connections.defaultSuffix', ' (default)') : '') }))} />
            <FormRow>
                <FormField htmlFor="ai-connection-name" label={t('ai.connections.name', 'Connection name')} required>
                    <Input id="ai-connection-name" value={draft.name} maxLength={100} disabled={busy} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={t('ai.connections.namePlaceholder', 'e.g. Team Anthropic or Local OmniRoute')} />
                </FormField>
                <ChoiceField id="ai-provider" label={t('ai.connections.provider', 'Provider')}
                    value={draft.provider} onChange={selectProvider} disabled={busy}
                    placeholder={t('ai.connections.selectProvider', 'Select a provider…')}
                    options={providers.map((provider) => ({ id: provider.id, label: provider.label + (provider.available ? '' : t('ai.connections.missingDependency', ' (dependency required)')) }))}>
                    {meta && !meta.available && <p className="error-message">{meta.unavailable_reason}</p>}
                </ChoiceField>
            </FormRow>
            {!!meta?.presets?.length && <ChoiceField id="ai-preset" label={t('ai.connections.preset', 'Endpoint preset')}
                value={meta.presets.find((preset) => preset.endpoint === draft.config.endpoint)?.id || ''}
                disabled={busy} placeholder={t('ai.connections.choosePreset', 'Custom URL, or choose a preset…')}
                options={meta.presets.map((preset) => ({ id: preset.id, label: preset.id }))}
                onChange={(id) => {
                    const preset = meta.presets.find((item) => item.id === id);
                    if (preset) setField({ name: 'endpoint', type: 'url' }, preset.endpoint);
                }} />}
            <div {...register('ai-api-key')}>
                <div {...register('ai-endpoint', 'ai-connections__fields')}>
                    {(meta?.fields || []).map((field) => (
                        <FormField key={field.name} htmlFor={`ai-config-${field.name}`}
                            label={<>{field.label}{field.required ? t('ai.connections.required', ' (required)') : t('ai.connections.optional', ' (optional)')}</>}
                            hint={field.type === 'url' ? t('ai.connections.endpointHelp', 'Use an address reachable from the ServerKit backend. In Docker, localhost refers to the panel container. Changing this URL requires re-entering credentials.') : undefined}>
                            <Input id={`ai-config-${field.name}`} type={field.secret ? 'password' : field.type}
                                autoComplete="off" disabled={busy} value={draft.config[field.name] ?? ''}
                                placeholder={field.secret && draft.secrets_set.includes(field.name) ? t('ai.connections.secretConfigured', 'Configured (leave blank to keep)') : field.default || ''}
                                onChange={(event) => setField(field, event.target.value)} />
                            {field.secret && draft.secrets_set.includes(field.name) && (
                                <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setField(field, '', true)}>
                                    {t('ai.connections.clearSecret', 'Clear saved credential')}
                                </Button>
                            )}
                        </FormField>
                    ))}
                </div>
            </div>
            <div {...register('ai-model')}>
                <FormField htmlFor="ai-model" label={t('ai.connections.defaultModel', 'Default model ID')}
                    hint={t('ai.connections.discoveryHint', 'Discover models from this connection, then browse or enter an exact model ID.')}>
                    <ModelPicker id="ai-model" value={draft.model} models={models} disabled={busy}
                        onChange={(model) => { revision.current += 1; setDraft({ ...draft, model }); setMessage(null); }} />
                </FormField>
            </div>
            <div className="settings-row">
                <label htmlFor="ai-make-default">{t('ai.connections.makeDefault', 'Use as the default for new chats')}</label>
                <Switch id="ai-make-default" checked={draft.make_default} disabled={busy}
                    onCheckedChange={(checked) => setDraft({ ...draft, make_default: checked })} />
            </div>
            {message && <div className={`alert alert-${message.type === 'error' ? 'danger' : 'success'}`} role="status">{message.text}</div>}
            <div className="settings-actions">
                <Button variant="unstyled" type="button" className="btn btn-ghost" disabled={busy || !meta?.available} onClick={() => run('models')}>{operation === 'models' ? t('ai.connections.discovering', 'Discovering…') : t('ai.connections.discover', 'Discover models')}</Button>
                <Button variant="unstyled" type="button" className="btn btn-ghost" disabled={busy || !meta?.available || !draft.model} onClick={() => run('test')}>{operation === 'test' ? t('ai.connections.testing', 'Testing…') : t('ai.connections.test', 'Test connection')}</Button>
                <Button variant="unstyled" type="button" className="btn btn-primary" disabled={busy || !meta?.available || !draft.name.trim() || !draft.model.trim()} onClick={() => run('save')}>{operation === 'save' ? t('ai.connections.working', 'Working…') : t('ai.connections.save', 'Save connection')}</Button>
                {draft.id && <Button variant="unstyled" type="button" className="btn btn-danger" disabled={busy} onClick={remove}>{t('ai.connections.delete', 'Delete')}</Button>}
            </div>
        </div>
    );
}
