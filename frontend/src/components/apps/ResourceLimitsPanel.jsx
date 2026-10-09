import { useState, useEffect, useCallback } from 'react';
import { Gauge } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Docker memory limit: number + one-letter unit (b/k/m/g), e.g. "512m", "2g".
const MEMORY_LIMIT_RE = /^\d+(\.\d+)?(b|k|m|g)$/i;

function validateCpu(value) {
    const text = String(value ?? '').trim();
    if (!text) return null; // empty = unlimited
    const cores = Number(text);
    if (!Number.isFinite(cores) || cores <= 0) {
        return 'CPU limit must be a positive number of cores, e.g. 1.5';
    }
    return null;
}

function validateMemory(value) {
    const text = String(value ?? '').trim();
    if (!text) return null; // empty = unlimited
    if (!MEMORY_LIMIT_RE.test(text)) {
        return 'Memory limit must be a number with a unit, e.g. 512m or 2g';
    }
    return null;
}

// Clamp a bar width to [0, 100].
function barWidth(percent) {
    if (percent == null || !Number.isFinite(percent)) return 0;
    return Math.max(0, Math.min(100, percent));
}

// Resource limits panel (task #23) — surface Docker CPU/memory caps as
// first-class app fields with live usage next to them, instead of asking
// people to hand-edit the compose file.
const ResourceLimitsPanel = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [cpuLimit, setCpuLimit] = useState('');
    const [memoryLimit, setMemoryLimit] = useState('');
    const [usage, setUsage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [restartRequired, setRestartRequired] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getAppResources(app.id);
            setCpuLimit(data.cpu_limit ?? '');
            setMemoryLimit(data.memory_limit ?? '');
            setUsage(data.usage ?? null);
        } catch (err) {
            console.error('Failed to load resource limits:', err);
        } finally {
            setLoading(false);
        }
    }, [app.id]);

    useEffect(() => { load(); }, [load]);

    const cpuError = validateCpu(cpuLimit);
    const memoryError = validateMemory(memoryLimit);

    async function handleSave() {
        if (cpuError || memoryError) return;
        setSaving(true);
        try {
            const data = await api.updateAppResources(app.id, {
                cpu_limit: String(cpuLimit).trim() || null,
                memory_limit: String(memoryLimit).trim() || null,
            });
            setRestartRequired(!data.applied && data.note === 'restart required');
            toast.success(data.applied
                ? t('app.resourceLimitsPanel.resourceLimitsSavedAndApplied', 'Resource limits saved and applied')
                : t('app.resourceLimitsPanel.resourceLimitsSaved', 'Resource limits saved'));
            onChanged?.();
        } catch (err) {
            toastError(toast, t('app.resourceLimitsPanel.failedToSaveResourceLimits', "Couldn't save the resource limits."), err);
        } finally {
            setSaving(false);
        }
    }

    // Live-usage bars. CPUPerc is % of one core, so scale it against the
    // configured core cap when one is set; MemPerc is already % of the
    // container's own limit.
    const cpuCores = Number(String(cpuLimit).trim());
    const cpuPercentOfLimit = usage?.cpu_percent != null && Number.isFinite(cpuCores) && cpuCores > 0
        ? usage.cpu_percent / cpuCores
        : usage?.cpu_percent;

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <Gauge />
                <span>{t('app.resourceLimitsPanel.resourceLimits', 'Resource limits')}</span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.resourceLimitsPanel.capHowMuchCpuAndMemory', 'Cap how much CPU and memory this service\'s container may use. Leave a field empty for no limit. Limits are written into the generated compose configuration and enforced by Docker.')}
                </p>

                {usage ? (
                    <>
                        <div className="resource-bar-container">
                            <div className="resource-bar-header">
                                <span className="resource-bar-label">CPU</span>
                                <span className="resource-bar-value">
                                    {usage.cpu_percent != null ? `${usage.cpu_percent.toFixed(1)}%` : '—'}
                                    {String(cpuLimit).trim() ? ` ${t('app.resourceLimitsPanel.ofCores', {
                                        count: Number(String(cpuLimit).trim()) || 0,
                                        cores: String(cpuLimit).trim(),
                                        defaultValue_one: 'of {{cores}} core',
                                        defaultValue_other: 'of {{cores}} cores',
                                    })}` : ''}
                                </span>
                            </div>
                            <div className="resource-bar-track">
                                <span
                                    className="resource-bar-fill cpu"
                                    style={{ width: `${barWidth(cpuPercentOfLimit)}%` }}
                                />
                            </div>
                        </div>
                        <div className="resource-bar-container">
                            <div className="resource-bar-header">
                                <span className="resource-bar-label">{t('common.labels.memory', 'Memory')}</span>
                                <span className="resource-bar-value">
                                    {usage.memory_usage || '—'}
                                    {usage.memory_limit ? ` / ${usage.memory_limit}` : ''}
                                </span>
                            </div>
                            <div className="resource-bar-track">
                                <span
                                    className="resource-bar-fill ram"
                                    style={{ width: `${barWidth(usage.memory_percent)}%` }}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="resource-hint">
                        {loading
                            ? t('app.resourceLimitsPanel.loadingLiveUsage', 'Loading live usage…')
                            : t('app.resourceLimitsPanel.liveUsageUnavailable', "Live usage isn't available. The service is stopped or Docker stats aren't reachable.")}
                    </p>
                )}

                <div className="container-ops__grid">
                    <div className="container-ops__input">
                        <Label htmlFor={`res-cpu-${app.id}`}>{t('app.resourceLimitsPanel.cpuLimitCores', 'CPU limit (cores)')}</Label>
                        <Input
                            id={`res-cpu-${app.id}`}
                            type="text"
                            value={cpuLimit}
                            onChange={(e) => setCpuLimit(e.target.value)}
                            placeholder={t('app.resourceLimitsPanel.eG15', 'e.g. 1.5')}
                            disabled={loading || saving}
                        />
                        {cpuError && <span className="error-text">{cpuError}</span>}
                    </div>
                    <div className="container-ops__input">
                        <Label htmlFor={`res-mem-${app.id}`}>{t('app.resourceLimitsPanel.memoryLimit', 'Memory limit')}</Label>
                        <Input
                            id={`res-mem-${app.id}`}
                            type="text"
                            value={memoryLimit}
                            onChange={(e) => setMemoryLimit(e.target.value)}
                            placeholder={t('app.resourceLimitsPanel.eG512m', 'e.g. 512m')}
                            disabled={loading || saving}
                        />
                        {memoryError && <span className="error-text">{memoryError}</span>}
                    </div>
                </div>

                {restartRequired && (
                    <p className="app-panel-hint">
                        {t('app.resourceLimitsPanel.limitsSavedRestartOrRedeployThe', 'Limits saved. Restart or redeploy the service for them to take effect.')}
                    </p>
                )}

                <div className="app-detail-actions container-ops__actions">
                    <Button size="sm" onClick={handleSave} disabled={saving || loading || !!cpuError || !!memoryError}>
                        {saving ? t('common.saving', 'Saving…') : t('app.resourceLimitsPanel.saveLimits', 'Save limits')}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ResourceLimitsPanel;
