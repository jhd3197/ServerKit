import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { FormField } from '../FormField';
import { Button } from '../ui/button';
import ModelPicker from './ModelPicker';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';

// Radix Select reserves '' for "no selection", so "inherit / none" is a sentinel.
const NO_CONNECTION = '__none';

export default function ModelBinding({ id, value, onChange, connections, disabled, allowInherit = false, inheritLabel, discover = false }) {
    const { t } = useTranslation();
    const [models, setModels] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const connection = connections.find((item) => item.id === value?.connection_id);
    const catalog = models || connection?.model_catalog || [];
    const refresh = async () => {
        setBusy(true); setError('');
        try {
            const result = await api.aiProbeConnection({ ...connection, test: false });
            setModels(result.model_details || result.models || []);
        } catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    return <div className="sk-ai-binding">
        <FormField htmlFor={`${id}-connection`} label={t('ai.connections.connection', 'Connection')}>
            <Select disabled={disabled || busy} value={value?.connection_id ? String(value.connection_id) : NO_CONNECTION} onValueChange={(picked) => {
                const next = connections.find((item) => String(item.id) === picked);
                setModels(null); setError('');
                onChange(next ? { connection_id: next.id, model: next.model } : null);
            }}>
                <SelectTrigger id={`${id}-connection`}><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value={NO_CONNECTION}>{allowInherit ? (inheritLabel || t('ai.management.inherit', 'Use Standard / panel default')) : t('ai.management.chooseConnection', 'Choose a connection')}</SelectItem>
                    {connections.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </FormField>
        {value && <FormField htmlFor={`${id}-model`} label={t('ai.connections.model', 'Model')}>
            <ModelPicker id={`${id}-model`} value={value.model} models={catalog} disabled={disabled || busy}
                onChange={(model) => onChange({ ...value, model })} />
        </FormField>}
        {discover && connection && <Button variant="outline" type="button" disabled={disabled || busy} onClick={refresh}>
            {busy ? t('ai.connections.discovering', 'Discovering…') : t('ai.connections.discover', 'Discover models')}
        </Button>}
        {error && <p className="error-message" role="alert">{error}</p>}
    </div>;
}
