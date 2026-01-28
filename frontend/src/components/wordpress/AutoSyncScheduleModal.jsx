import React, { useState, useEffect } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import Spinner from '../Spinner';

const SCHEDULE_PRESETS = [
    { label: 'Daily at 3 AM', value: '0 3 * * *' },
    { label: 'Weekly Sunday 3 AM', value: '0 3 * * 0' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Custom', value: 'custom' },
];

const AutoSyncScheduleModal = ({ environment, prodId, onClose, api }) => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [schedule, setSchedule] = useState('0 3 * * *');
    const [selectedPreset, setSelectedPreset] = useState('0 3 * * *');
    const [customCron, setCustomCron] = useState('');
    const [nextRuns, setNextRuns] = useState([]);

    useEffect(() => {
        loadSchedule();
    }, []);

    async function loadSchedule() {
        setLoading(true);
        try {
            const data = await api.getAutoSyncSchedule(prodId, environment.id);
            setEnabled(data.enabled || false);
            if (data.schedule) {
                const matchingPreset = SCHEDULE_PRESETS.find(p => p.value === data.schedule);
                if (matchingPreset) {
                    setSelectedPreset(data.schedule);
                } else {
                    setSelectedPreset('custom');
                    setCustomCron(data.schedule);
                }
                setSchedule(data.schedule);
            }
            setNextRuns(data.next_runs || []);
        } catch {
            // Default values already set
        } finally {
            setLoading(false);
        }
    }

    function handlePresetChange(value) {
        setSelectedPreset(value);
        if (value !== 'custom') {
            setSchedule(value);
        }
    }

    function handleCustomCronChange(value) {
        setCustomCron(value);
        setSchedule(value);
    }

    async function handleSave() {
        setSaving(true);
        try {
            const finalSchedule = selectedPreset === 'custom' ? customCron : selectedPreset;
            await api.updateAutoSyncSchedule(prodId, environment.id, {
                enabled,
                schedule: finalSchedule,
            });
            onClose();
        } catch (err) {
            console.error('Failed to save auto-sync schedule:', err);
        } finally {
            setSaving(false);
        }
    }

    function formatDateTime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleString();
    }

    const envName = environment?.name || 'Environment';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal auto-sync-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Clock size={18} />
                        Auto-Sync Schedule
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {loading ? (
                    <div className="auto-sync-loading">
                        <Spinner size="sm" />
                        <span>Loading schedule...</span>
                    </div>
                ) : (
                    <div className="auto-sync-body">
                        <div className="auto-sync-env-name">{envName}</div>

                        <div className="auto-sync-toggle">
                            <label className="auto-sync-toggle-label">
                                <span>Enable Auto-Sync from Production</span>
                                <button
                                    className={`toggle-switch ${enabled ? 'active' : ''}`}
                                    onClick={() => setEnabled(!enabled)}
                                >
                                    <span className="toggle-switch-slider" />
                                </button>
                            </label>
                            <p className="auto-sync-description">
                                Automatically sync this environment from production on a schedule.
                            </p>
                        </div>

                        {enabled && (
                            <>
                                <div className="form-group">
                                    <label>Schedule</label>
                                    <div className="auto-sync-presets">
                                        {SCHEDULE_PRESETS.map(preset => (
                                            <label key={preset.value} className="radio-label">
                                                <input
                                                    type="radio"
                                                    name="schedule-preset"
                                                    checked={selectedPreset === preset.value}
                                                    onChange={() => handlePresetChange(preset.value)}
                                                />
                                                <span className="radio-content">
                                                    <strong>{preset.label}</strong>
                                                    {preset.value !== 'custom' && (
                                                        <span className="auto-sync-cron-display">{preset.value}</span>
                                                    )}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {selectedPreset === 'custom' && (
                                    <div className="form-group">
                                        <label>Custom Cron Expression</label>
                                        <input
                                            type="text"
                                            value={customCron}
                                            onChange={e => handleCustomCronChange(e.target.value)}
                                            placeholder="0 3 * * *"
                                            className="auto-sync-cron-input"
                                        />
                                        <span className="form-hint">
                                            Format: minute hour day-of-month month day-of-week
                                        </span>
                                    </div>
                                )}

                                {nextRuns.length > 0 && (
                                    <div className="auto-sync-next-runs">
                                        <h5>Next Scheduled Runs</h5>
                                        <ul>
                                            {nextRuns.map((run, i) => (
                                                <li key={i}>
                                                    <RefreshCw size={10} />
                                                    <span>{formatDateTime(run)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving || loading}>
                        {saving ? <><Spinner size="sm" /> Saving...</> : 'Save Schedule'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AutoSyncScheduleModal;
