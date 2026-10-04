import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Undo2, Wand2 } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Curated config tuner: a small set of vetted engine settings with RAM-aware
// suggested values. Shows current vs suggested; the operator picks which
// settings to apply — nothing is ever applied automatically. Applying writes
// a ServerKit-owned config drop-in and restarts the DB container; a backup of
// the previous config is kept so it can be rolled back cleanly.
//
// Props:
//   target   — Docker container name (or managed database id as a string)
//   engine   — 'mysql' | 'mariadb' | 'postgresql' (optional for managed ids)
//   user     — DB admin user (optional)
//   password — DB admin password, sent via X-DB-Password (optional)
export default function ConfigTunerPanel({ target, engine, user, password }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [dedicated, setDedicated] = useState(false);
    const [selected, setSelected] = useState({});   // key -> bool
    const [values, setValues] = useState({});       // key -> edited target value

    const load = useCallback(async (isDedicated) => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.inspectDbTuner(target, {
                engine, user, password, dedicated: isDedicated,
            });
            setData(res);
            const next = {};
            (res?.settings || []).forEach((s) => { next[s.key] = s.suggested; });
            setValues(next);
            setSelected({});
        } catch (err) {
            setError(err.message || 'Failed to inspect the database configuration');
        } finally {
            setLoading(false);
        }
    }, [target, engine, user, password]);

    useEffect(() => { load(dedicated); }, [load, dedicated]);

    function clampValue(setting, raw) {
        const num = Number(raw);
        if (Number.isNaN(num)) return setting.suggested;
        return Math.min(setting.max, Math.max(setting.min, num));
    }

    function setValue(key, raw) {
        setValues((prev) => ({ ...prev, [key]: raw }));
    }

    function commitValue(setting) {
        setValues((prev) => ({ ...prev, [setting.key]: clampValue(setting, prev[setting.key]) }));
    }

    function toggle(key) {
        setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
    }

    const selectedKeys = Object.keys(selected).filter((k) => selected[k]);

    async function applySelected() {
        if (!selectedKeys.length) return;
        const ok = await confirm({
            title: t('app.configTunerPanel.applySettings', { count: selectedKeys.length, defaultValue_one: 'Apply 1 setting?', defaultValue_other: 'Apply {{count}} settings?' }),
            message: t('app.configTunerPanel.applyingRestartsTheDatabaseEngineConnected', 'Applying restarts the database engine, so connected services will see a short ')
                + t('app.configTunerPanel.interruptionThePreviousConfigurationIsBacked', 'interruption. The previous configuration is backed up and can be rolled back.'),
            confirmText: t('app.configTunerPanel.applyAndRestart', 'Apply and restart'),
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const settings = {};
            selectedKeys.forEach((k) => {
                const setting = data.settings.find((s) => s.key === k);
                settings[k] = clampValue(setting, values[k]);
            });
            await api.applyDbTunerSettings(target, settings, { engine, user, password });
            toast.success(t('app.configTunerPanel.settingsAppliedAndEngineRestarted', 'Settings applied and engine restarted'));
            await load(dedicated);
        } catch (err) {
            toastError(toast, t('app.configTunerPanel.failedToApplySettings', "Couldn't apply the settings."), err);
        } finally {
            setBusy(false);
        }
    }

    async function rollback() {
        const ok = await confirm({
            title: t('app.configTunerPanel.rollBackToThePreviousConfiguration', 'Roll back to the previous configuration?'),
            message: t('app.configTunerPanel.theLastBackedUpConfigurationIs', 'The last backed-up configuration is restored and the database engine ')
                + t('app.configTunerPanel.isRestarted', 'is restarted.'),
            confirmText: t('app.configTunerPanel.rollBackAndRestart', 'Roll back and restart'),
            danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            await api.rollbackDbTuner(target, { engine, user, password });
            toast.success(t('app.configTunerPanel.previousConfigurationRestored', 'Previous configuration restored'));
            await load(dedicated);
        } catch (err) {
            toastError(toast, t('app.configTunerPanel.rollbackFailed', "Couldn't roll back."), err);
        } finally {
            setBusy(false);
        }
    }

    if (loading) return <p className="db-tuner__hint">{t('app.configTunerPanel.readingEngineConfiguration', 'Reading engine configuration…')}</p>;
    if (error) return <p className="db-tuner__error">{error}</p>;
    if (!data) return null;

    return (
        <div className="db-tuner">
            <div className="db-tuner__head">
                <p className="db-tuner__hint">
                    {t('app.configTunerPanel.suggestionsBasedOnRam', 'Suggestions are based on {{ram}} MB of RAM ({{source}}). Nothing is applied until you choose to.', {
                        ram: data.ram_mb,
                        source: data.ram_source === 'container_limit'
                            ? t('app.configTunerPanel.containerMemoryLimit', 'container memory limit')
                            : t('app.configTunerPanel.hostTotal', 'host total'),
                    })}
                </p>
                <label className="db-tuner__dedicated">
                    <input
                        type="checkbox"
                        checked={dedicated}
                        onChange={(e) => setDedicated(e.target.checked)}
                    />
                    {t('app.configTunerPanel.dedicatedDbServer', 'Dedicated DB server')}
                </label>
                <Button type="button" size="sm" variant="ghost" onClick={() => load(dedicated)} aria-label={t('common.actions.refresh', 'Refresh')}>
                    <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
                </Button>
            </div>

            <div className="db-tuner__table-wrap">
                <table className="db-tuner__table">
                    <thead>
                        <tr>
                            <th aria-label={t('app.configTunerPanel.select', 'Select')} />
                            <th>{t('app.configTunerPanel.setting', 'Setting')}</th>
                            <th>{t('common.labels.current', 'Current')}</th>
                            <th>{t('app.configTunerPanel.suggested', 'Suggested')}</th>
                            <th>{t('app.configTunerPanel.targetValue', 'Target value')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.settings.map((s) => (
                            <tr key={s.key} className={s.differs ? 'is-diff' : ''}>
                                <td>
                                    <input
                                        type="checkbox"
                                        checked={!!selected[s.key]}
                                        onChange={() => toggle(s.key)}
                                        aria-label={t('app.configTunerPanel.select2', 'Select {{key}}', { key: s.key })}
                                    />
                                </td>
                                <td>
                                    <span className="db-tuner__key">{s.key}</span>
                                    <span className="db-tuner__desc">{s.description}</span>
                                </td>
                                <td className="db-tuner__num">
                                    {s.current != null ? `${s.current} ${s.unit}` : '—'}
                                </td>
                                <td className={`db-tuner__num${s.differs ? ' db-tuner__num--suggest' : ''}`}>
                                    {s.suggested} {s.unit}
                                </td>
                                <td>
                                    <input
                                        className="db-tuner__input"
                                        type="number"
                                        min={s.min}
                                        max={s.max}
                                        step="any"
                                        value={values[s.key] ?? ''}
                                        onChange={(e) => setValue(s.key, e.target.value)}
                                        onBlur={() => commitValue(s)}
                                        aria-label={t('app.configTunerPanel.targetValueFor', 'Target value for {{key}}', { key: s.key })}
                                    />
                                    <span className="db-tuner__range">{s.min}–{s.max} {s.unit}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="db-tuner__actions">
                <Button
                    type="button"
                    disabled={busy || selectedKeys.length === 0}
                    onClick={applySelected}
                >
                    <Wand2 size={14} /> {t('app.configTunerPanel.applySelected', 'Apply selected (')}{selectedKeys.length})
                </Button>
                {data.can_rollback && (
                    <Button type="button" variant="outline" disabled={busy} onClick={rollback}>
                        <Undo2 size={14} /> {t('app.configTunerPanel.rollBackLastApply', 'Roll back last apply')}
                    </Button>
                )}
            </div>
        </div>
    );
}
