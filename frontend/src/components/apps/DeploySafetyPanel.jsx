import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';

// Must match app/services/deploy_settings.py DEFAULTS / _RULES.
const TIMEOUT_DEFAULT = 120;
const TIMEOUT_MIN = 5;
const TIMEOUT_MAX = 1800;

// Health gate settings (plan 87 §A4). A deploy waits for the new release to
// answer its health path before it counts as live; these say where to ask and
// how long to wait.
const DeploySafetyPanel = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const settings = app.deploy_settings || {};
    const [path, setPath] = useState(app.healthcheck_path || '');
    const [timeout, setTimeoutValue] = useState(String(settings.healthcheck_timeout ?? TIMEOUT_DEFAULT));
    const [allow4xx, setAllow4xx] = useState(!!settings.healthcheck_allow_4xx);
    const [saving, setSaving] = useState(false);

    const timeoutNumber = Number(timeout);
    const timeoutValid = Number.isInteger(timeoutNumber)
        && timeoutNumber >= TIMEOUT_MIN && timeoutNumber <= TIMEOUT_MAX;
    const dirty = path.trim() !== (app.healthcheck_path || '')
        || (timeoutValid && timeoutNumber !== (settings.healthcheck_timeout ?? TIMEOUT_DEFAULT))
        || allow4xx !== !!settings.healthcheck_allow_4xx;

    async function handleSave() {
        setSaving(true);
        try {
            await api.updateApp(app.id, {
                healthcheck_path: path.trim(),
                deploy_settings: {
                    healthcheck_timeout: timeoutNumber,
                    healthcheck_allow_4xx: allow4xx,
                },
            });
            toast.success(t('app.deploySafetyPanel.saved', 'Health check settings saved'));
            onChanged?.();
        } catch (err) {
            toast.error(err.message || t('app.deploySafetyPanel.saveFailed', 'Failed to save health check settings'));
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <HeartPulse />
                <span>{t('app.deploySafetyPanel.healthCheck', 'Health check')}</span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.deploySafetyPanel.intro', 'Before a new release counts as live, ServerKit asks it for this path and waits for a 2xx or 3xx answer three times in a row. A release that never answers fails the deploy.')}
                </p>

                <div className="settings-row">
                    <div className="settings-label">
                        <label htmlFor={`health-path-${app.id}`}>
                            {t('app.deploySafetyPanel.path', 'Health check path')}
                        </label>
                        <span className="settings-hint">
                            {t('app.deploySafetyPanel.pathHint', 'Leave empty to use /. Point it at a page that answers without a login.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Input
                            id={`health-path-${app.id}`}
                            placeholder="/"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            disabled={saving}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label">
                        <label htmlFor={`health-timeout-${app.id}`}>
                            {t('app.deploySafetyPanel.timeout', 'Timeout (seconds)')}
                        </label>
                        <span className="settings-hint">
                            {t('app.deploySafetyPanel.timeoutHint', 'How long a new release may take to start answering ({{min}}–{{max}}).', { min: TIMEOUT_MIN, max: TIMEOUT_MAX })}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Input
                            id={`health-timeout-${app.id}`}
                            type="number"
                            min={TIMEOUT_MIN}
                            max={TIMEOUT_MAX}
                            value={timeout}
                            onChange={(e) => setTimeoutValue(e.target.value)}
                            disabled={saving}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.deploySafetyPanel.allow4xx', 'Accept a 4xx answer')}</span>
                        <span className="settings-hint">
                            {t('app.deploySafetyPanel.allow4xxHint', 'Only for a health path that sits behind a login and answers 401 or 403 when the app is up. Otherwise a 4xx means the release is broken.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Switch
                            checked={allow4xx}
                            onCheckedChange={setAllow4xx}
                            disabled={saving}
                            aria-label={t('app.deploySafetyPanel.allow4xx', 'Accept a 4xx answer')}
                        />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label" />
                    <div className="settings-control">
                        <Button size="sm" onClick={handleSave} disabled={saving || !dirty || !timeoutValid}>
                            {saving ? t('common.editing.saving', 'Saving…') : t('common.actions.save', 'Save')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DeploySafetyPanel;
