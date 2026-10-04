import { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useToast } from '@/contexts/useToast.js';
import useSettingFocus from '@/hooks/useSettingFocus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EmptyState from '@/components/EmptyState';
import DiskReclaimModal from '@/components/monitoring/DiskReclaimModal';
import formatBytes from '@/utils/formatBytes';
import { formatDateTime, formatPercent, formatRelative } from '@/utils/intl';
import { toastError } from '@/utils/errorMessage';

// The four day-count windows plus the rollback window: integers, 0 = off.
const NUMBER_KEYS = [
    'telemetry.retention_days',
    'jobs.retention_days',
    'history.retention_days',
    'audit_log_retention_days',
    'storage.previous_slot_hours',
];
const LOG_SIZE_KEY = 'storage.docker_log_max_size';
// Docker json-file max-size: a number with an optional k/m/g unit.
const LOG_SIZE_PATTERN = /^\d+[kmg]?$/i;

function toForm(retention) {
    const form = {};
    for (const key of [...NUMBER_KEYS, LOG_SIZE_KEY]) {
        const value = retention?.[key];
        form[key] = value === null || value === undefined ? '' : String(value);
    }
    return form;
}

function diskTone(percent) {
    if (percent >= 90) return 'danger';
    if (percent >= 75) return 'warning';
    return 'ok';
}

/**
 * Where the panel host's disk goes (plan 85 §D1/§D2). Reads the storage
 * overview, hands cleanup to the existing curated reclaim flow, and edits the
 * retention settings that bound ServerKit's own share of the disk.
 */
export default function StorageTab() {
    const { t } = useTranslation();
    const toast = useToast();
    const register = useSettingFocus();
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [reclaimOpen, setReclaimOpen] = useState(false);
    const [form, setForm] = useState(toForm(null));
    const [saving, setSaving] = useState(false);

    const itemLabels = {
        docker_images: t('app.storageTab.itemDockerImages', 'Service images'),
        docker_volumes: t('app.storageTab.itemDockerVolumes', 'Service volumes'),
        docker_build_cache: t('app.storageTab.itemDockerBuildCache', 'Docker build cache'),
        panel_database: t('app.storageTab.itemPanelDatabase', 'Panel database'),
        backups: t('app.storageTab.itemBackups', 'Backups and upgrade snapshots'),
        panel_logs: t('app.storageTab.itemPanelLogs', 'Panel logs'),
        previous_install: t('app.storageTab.itemPreviousInstall', 'Previous version (rollback)'),
    };

    const retentionFields = {
        'telemetry.retention_days': {
            label: t('app.storageTab.telemetryRetention', 'Telemetry retention (days)'),
            hint: t('app.storageTab.telemetryRetentionHint', 'Queue messages, system events and API usage logs.'),
        },
        'jobs.retention_days': {
            label: t('app.storageTab.jobsRetention', 'Job retention (days)'),
            hint: t('app.storageTab.jobsRetentionHint', 'Succeeded and cancelled background jobs. Failed jobs are kept three times as long.'),
        },
        'history.retention_days': {
            label: t('app.storageTab.historyRetention', 'History retention (days)'),
            hint: t('app.storageTab.historyRetentionHint', 'Error logs, notifications, deployment jobs, cron runs, webhook deliveries and sandbox runs.'),
        },
        audit_log_retention_days: {
            label: t('app.storageTab.auditRetention', 'Audit log retention (days)'),
            hint: t('app.storageTab.auditRetentionHint', 'Who did what in the panel.'),
        },
        'storage.previous_slot_hours': {
            label: t('app.storageTab.previousSlotHours', 'Keep previous version (hours)'),
            hint: t('app.storageTab.previousSlotHoursHint', 'How long after a healthy update the previous install stays for instant rollback. 0 keeps it until the next update.'),
        },
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getStorageOverview();
            setOverview(data);
            setForm(toForm(data?.retention));
        } catch (err) {
            setError(err.message || t('app.storageTab.couldNotLoad', 'Could not load the storage overview'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { load(); }, [load]);

    const closeReclaim = () => {
        setReclaimOpen(false);
        load();
    };

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

    const save = async () => {
        const payload = {};
        for (const key of NUMBER_KEYS) {
            const raw = form[key].trim();
            if (!/^\d+$/.test(raw)) {
                toast.error(t('app.storageTab.invalidNumber', '{{field}} must be a whole number, 0 or more', { field: retentionFields[key].label }));
                return;
            }
            payload[key] = Number(raw);
        }
        const logSize = form[LOG_SIZE_KEY].trim();
        if (!LOG_SIZE_PATTERN.test(logSize)) {
            toast.error(t('app.storageTab.invalidLogSize', 'Container log size must look like 50m, 200k or 1g'));
            return;
        }
        payload[LOG_SIZE_KEY] = logSize.toLowerCase();

        setSaving(true);
        try {
            await api.updateSystemSettings(payload);
            toast.success(t('app.storageTab.retentionSaved', 'Retention settings saved'));
            await load();
        } catch (err) {
            toastError(toast, t('app.storageTab.saveFailed', 'Could not save retention settings'), err);
        } finally {
            setSaving(false);
        }
    };

    if (loading && !overview) {
        return (
            <div className="settings-section">
                <EmptyState loading title={t('app.storageTab.measuring', 'Measuring disk usage…')} />
            </div>
        );
    }

    if (error && !overview) {
        return (
            <div className="settings-section">
                <EmptyState
                    icon={HardDrive}
                    title={t('app.storageTab.couldNotLoad', 'Could not load the storage overview')}
                    description={error}
                    action={(
                        <Button variant="outline" onClick={load}>
                            {t('common.actions.retry', 'Retry')}
                        </Button>
                    )}
                />
            </div>
        );
    }

    const disk = overview?.disk || {};
    const percent = typeof disk.percent === 'number' ? disk.percent : null;
    const items = [...(overview?.items || [])].sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    const previous = overview?.previous_install;

    let previousWhen;
    if (previous?.removable_now) {
        previousWhen = t('app.storageTab.previousRemovedNextCleanup', 'Removed at the next cleanup');
    } else if (previous?.removable_at) {
        const at = new Date(previous.removable_at * 1000);
        previousWhen = t('app.storageTab.previousRemovedAt', 'Removed automatically {{relative}} ({{date}})', {
            relative: formatRelative(at),
            date: formatDateTime(at),
        });
    } else if (previous) {
        previousWhen = t('app.storageTab.previousKeptUntilUpdate', 'Kept until the next update');
    }

    return (
        <div className="settings-section storage-tab">
            <div className="section-header">
                <h2>{t('app.storageTab.title', 'Storage')}</h2>
            </div>

            <div {...register('storage-disk', 'settings-card')}>
                <div className="settings-card__header">
                    <div className="settings-card__header-left">
                        <HardDrive size={18} />
                        <div>
                            <h3>{t('app.storageTab.diskUsage', 'Disk usage')}</h3>
                            {disk.path && <p className="storage-tab__path">{disk.path}</p>}
                        </div>
                    </div>
                    <div className="storage-tab__actions">
                        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
                            <RefreshCw size={14} />
                            {t('common.actions.refresh', 'Refresh')}
                        </Button>
                        <Button size="sm" onClick={() => setReclaimOpen(true)}>
                            <HardDrive size={14} />
                            {t('app.storageTab.freeUpSpace', 'Free up space')}
                        </Button>
                    </div>
                </div>

                {percent === null ? (
                    <p className="storage-tab__muted">{t('app.storageTab.diskUnavailable', 'Disk usage could not be measured on this host.')}</p>
                ) : (
                    <>
                        <div className="storage-disk__summary">
                            <span className="storage-disk__percent">{formatPercent(percent, { decimals: 1 })}</span>
                            <span className="storage-disk__detail">
                                {t('app.storageTab.usedOfTotal', '{{used}} used of {{total}}', {
                                    used: formatBytes(disk.used),
                                    total: formatBytes(disk.total),
                                })}
                            </span>
                            <span className="storage-disk__free">
                                {t('app.storageTab.freeAmount', '{{free}} free', { free: formatBytes(disk.free) })}
                            </span>
                        </div>
                        <progress
                            className={`storage-disk__bar storage-disk__bar--${diskTone(percent)}`}
                            max={100}
                            value={percent}
                            aria-label={t('app.storageTab.diskUsage', 'Disk usage')}
                        />
                    </>
                )}

                {overview?.profile === 'small' && (
                    <p className="storage-tab__note">
                        {t('app.storageTab.smallDiskNote', 'Small disk: shorter retention defaults are in use.')}
                    </p>
                )}
            </div>

            <div {...register('storage-breakdown', 'settings-card')}>
                <h3>{t('app.storageTab.breakdown', 'What is using the disk')}</h3>
                <p>{t('app.storageTab.breakdownHint', 'Measured now. Reclaimable is what Docker reports it could free without touching running services.')}</p>
                {items.length === 0 ? (
                    <p className="storage-tab__muted">{t('app.storageTab.noItems', 'Nothing to report. Docker is not answering and no panel data was found.')}</p>
                ) : (
                    <ul className="storage-breakdown">
                        {items.map((item) => (
                            <li key={item.key} className="storage-breakdown__row">
                                <span className="storage-breakdown__label">{itemLabels[item.key] || item.label}</span>
                                <span className="storage-breakdown__size">{formatBytes(item.bytes)}</span>
                                <span className="storage-breakdown__reclaim">
                                    {item.reclaimable
                                        ? t('app.storageTab.reclaimable', '{{size}} reclaimable', { size: formatBytes(item.reclaimable) })
                                        : ''}
                                </span>
                                {disk.total ? (
                                    <progress
                                        className="storage-breakdown__bar"
                                        max={disk.total}
                                        value={item.bytes || 0}
                                        aria-hidden="true"
                                    />
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {previous && (
                <div {...register('storage-previous-install', 'settings-card')}>
                    <h3>{t('app.storageTab.previousInstall', 'Previous version (rollback)')}</h3>
                    <p>{t('app.storageTab.previousInstallHint', 'The install from before the last update, kept so a rollback is instant.')}</p>
                    <div className="settings-row">
                        <div className="settings-label">
                            <span className="storage-tab__mono">{previous.path}</span>
                            <span className="settings-hint">{previousWhen}</span>
                        </div>
                        <div className="settings-control">
                            <span className="storage-breakdown__size">{formatBytes(previous.bytes)}</span>
                        </div>
                    </div>
                </div>
            )}

            <div {...register('storage-retention', 'settings-card')}>
                <h3>{t('app.storageTab.retention', 'Retention')}</h3>
                <p>{t('app.storageTab.retentionHint', 'How long ServerKit keeps its own records before pruning them. 0 disables pruning.')}</p>

                <div className="form-group">
                    {NUMBER_KEYS.map((key) => {
                        const id = `storage-${key.replace(/[._]/g, '-')}`;
                        return (
                            <div key={key} className="settings-row">
                                <div className="settings-label">
                                    <Label htmlFor={id}>{retentionFields[key].label}</Label>
                                    <span className="settings-hint">{retentionFields[key].hint}</span>
                                </div>
                                <div className="settings-control">
                                    <Input
                                        id={id}
                                        type="number"
                                        min={0}
                                        step={1}
                                        className="storage-tab__input"
                                        value={form[key]}
                                        onChange={(e) => setField(key, e.target.value)}
                                        disabled={saving}
                                    />
                                </div>
                            </div>
                        );
                    })}
                    <div className="settings-row">
                        <div className="settings-label">
                            <Label htmlFor="storage-docker-log-max-size">
                                {t('app.storageTab.dockerLogMaxSize', 'Container log size cap')}
                            </Label>
                            <span className="settings-hint">
                                {t('app.storageTab.dockerLogMaxSizeHint', 'Per container log file, three files kept (for example 50m). Applies to containers created after Docker restarts.')}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Input
                                id="storage-docker-log-max-size"
                                type="text"
                                className="storage-tab__input"
                                value={form[LOG_SIZE_KEY]}
                                onChange={(e) => setField(LOG_SIZE_KEY, e.target.value)}
                                disabled={saving}
                            />
                        </div>
                    </div>
                </div>

                <div className="settings-card__footer">
                    <Button onClick={save} disabled={saving}>
                        {saving ? t('common.editing.saving', 'Saving…') : t('common.actions.save', 'Save')}
                    </Button>
                </div>
            </div>

            <DiskReclaimModal open={reclaimOpen} onClose={closeReclaim} />
        </div>
    );
}
