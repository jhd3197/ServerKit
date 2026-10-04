import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const GunicornTab = ({ appId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [config, setConfig] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadConfig = useCallback(async () => {
        try {
            const data = await api.getGunicornConfig(appId);
            setConfig(data.content || '');
        } catch (err) {
            console.error('Failed to load config:', err);
        } finally {
            setLoading(false);
        }
    }, [appId]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    async function handleSave() {
        setSaving(true);
        try {
            await api.updateGunicornConfig(appId, config);
            toast.success(t('app.gunicornTab.configurationSavedRestartTheAppTo', 'Configuration saved. Restart the service to apply changes.'));
        } catch (err) {
            toastError(toast, t('app.gunicornTab.failedToSaveConfiguration', 'Failed to save configuration'), err);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <EmptyState loading title={t('app.gunicornTab.loadingGunicornConfiguration', 'Loading Gunicorn configuration…')} />;
    }

    return (
        <div>
            <div className="section-header">
                <h3 className="svc-eyebrow">{t('app.gunicornTab.gunicornConfiguration', 'Gunicorn configuration')}</h3>
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </div>
            <Textarea
                className="code-editor"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                spellCheck={false}
            />
        </div>
    );
};

export default GunicornTab;
