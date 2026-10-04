import { useState } from 'react';
import { Layers, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/useAuth.js';
import useModules from '../../hooks/useModules';
import api from '../../services/api';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import EmptyState from '../EmptyState';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';

// Admin-only card to enable/disable the optional feature verticals (Email,
// WordPress). Toggling writes through the /modules API and then refreshes the
// shared module state so the sidebar + route guards update immediately.
const ModulesTab = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const { isAdmin } = useAuth();
    const { modules, refresh } = useModules();
    const [saving, setSaving] = useState({});
    const [message, setMessage] = useState(null);

    async function handleToggle(name, enabled) {
        setSaving((prev) => ({ ...prev, [name]: true }));
        setMessage(null);
        try {
            await api.setModule(name, enabled);
            // Re-fetch shared state so the sidebar / guards reflect the change.
            await refresh();
            setMessage({ type: 'success', text: `Module ${enabled ? 'enabled' : 'disabled'}` });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to update module' });
        } finally {
            setSaving((prev) => ({ ...prev, [name]: false }));
            setTimeout(() => setMessage(null), 5000);
        }
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2><Layers size={20} /> {t('app.modulesTab.modules', 'Features')}</h2>
                <p>{t('app.modulesTab.enableOrDisableOptionalFeatureAreas', 'Enable or disable optional feature areas. Disabled features are hidden from the sidebar and their pages become unreachable.')}</p>
            </div>

            {message && (
                <div className={`alert alert--${message.type}`}>
                    {message.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {message.text}
                </div>
            )}

            {!modules ? (
                <EmptyState loading title={t('app.modulesTab.loadingModules', 'Loading features…')} />
            ) : (
                <div {...register('modules-toggle', 'settings-card')}>
                    {modules.map((mod) => (
                        <div className="settings-row" key={mod.name}>
                            <div className="settings-label">
                                <Label>{mod.label || mod.name}</Label>
                                {mod.description && (
                                    <span className="settings-hint">{mod.description}</span>
                                )}
                            </div>
                            <div className="settings-control">
                                <Switch
                                    checked={!!mod.enabled}
                                    onCheckedChange={(checked) => handleToggle(mod.name, checked)}
                                    disabled={!isAdmin || !!saving[mod.name]}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ModulesTab;
