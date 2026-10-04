import { useState, useEffect } from 'react';
import { SegControl } from '@/components/ds';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar, Save, Loader2 } from 'lucide-react';
import SchedulePicker from '../SchedulePicker';
import { useTranslation } from 'react-i18next';

// Card 2 of the backup "Protection" panel: the editable schedule form.
// The saved policy carries a raw cron string; this card now mounts the shared
// SchedulePicker (compact) so backups get the same Presets/Builder/Advanced UI
// and server-side preview as every other cron surface. Local state mirrors the
// form while a useEffect re-seeds it whenever the parent reloads the policy, so
// an external save stays in sync. Save is disabled until something actually
// changes (dirty tracking) and shows a spinner while the request is in flight.

const DEFAULT_CRON = '0 2 * * *'; // Daily at 02:00 server time.
const MIN_COUNT = 1; // floor shared by every numeric field (count/days/full-every)

// Coerce a numeric form field (kept as a string) to a number, treating empty
// or sub-floor values as the minimum so we never persist 0 / NaN.
const toNum = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= MIN_COUNT ? n : MIN_COUNT;
};

const ScheduleCard = ({ policy, remoteConfigured, onSave, saving }) => {
    const { t } = useTranslation();
    // All hooks run unconditionally, before any early return (Rules of Hooks).
    // The form is only shown once a policy exists, so the seed values used when
    // `policy` is null are throwaway and get re-seeded by the effect on load.
    const [cron, setCron] = useState(policy?.schedule_cron || DEFAULT_CRON);
    const [retentionCount, setRetentionCount] = useState(String(policy?.retention_count ?? ''));
    const [retentionDays, setRetentionDays] = useState(String(policy?.retention_days ?? ''));
    const [fullEvery, setFullEvery] = useState(String(policy?.full_every_n_days ?? ''));
    const [compression, setCompression] = useState(policy?.compression ?? 'balanced');
    const [remoteCopy, setRemoteCopy] = useState(!!policy?.remote_copy);
    const [drillCadence, setDrillCadence] = useState(policy?.drill_cadence ?? 'off');

    // Re-seed the form when the saved policy changes (e.g. external reload after
    // a successful save). Keyed on the persisted values so it only fires when
    // the source of truth actually moves, not on every render.
    useEffect(() => {
        if (!policy) return;
        setCron(policy.schedule_cron || DEFAULT_CRON);
        setRetentionCount(String(policy.retention_count));
        setRetentionDays(String(policy.retention_days));
        setFullEvery(String(policy.full_every_n_days));
        setCompression(policy.compression);
        setRemoteCopy(!!policy.remote_copy);
        setDrillCadence(policy.drill_cadence || 'off');
    }, [
        policy,
        policy?.schedule_cron,
        policy?.retention_count,
        policy?.retention_days,
        policy?.full_every_n_days,
        policy?.compression,
        policy?.remote_copy,
        policy?.drill_cadence,
    ]);

    const currentCron = cron;

    // Conditional render AFTER all hooks have run.
    if (!policy) {
        return (
            <div className="app-panel schedule-card">
                <div className="app-panel-header">
                    <Calendar size={16} />
                    <span>{t('common.labels.schedule', 'Schedule')}</span>
                </div>
                <div className="app-panel-body">
                    <p className="app-panel-hint">{t('app.scheduleCard.loadingBackupSchedule', 'Loading backup schedule…')}</p>
                </div>
            </div>
        );
    }

    // The form is dirty when any field diverges from the saved policy. Numeric
    // fields are compared via toNum so an empty box reads as the floor (= what
    // would actually be persisted), avoiding a phantom-dirty Save button.
    const dirty =
        currentCron !== policy.schedule_cron ||
        toNum(retentionCount) !== policy.retention_count ||
        toNum(retentionDays) !== policy.retention_days ||
        toNum(fullEvery) !== policy.full_every_n_days ||
        compression !== policy.compression ||
        remoteCopy !== !!policy.remote_copy ||
        drillCadence !== (policy.drill_cadence || 'off');

    const handleSave = () => {
        onSave({
            schedule_cron: currentCron,
            retention_count: toNum(retentionCount),
            retention_days: toNum(retentionDays),
            full_every_n_days: toNum(fullEvery),
            compression,
            remote_copy: remoteCopy,
            drill_cadence: drillCadence,
        });
    };

    return (
        <div className="app-panel schedule-card">
            <div className="app-panel-header">
                <Calendar size={16} />
                <span>{t('common.labels.schedule', 'Schedule')}</span>
                <span className="app-panel-header-actions app-panel-hint">
                    {t('app.scheduleCard.backupsRunQuietlyInTheBackground', 'Backups run quietly in the background.')}
                </span>
            </div>
            <div className="app-panel-body">
                <div className="schedule-card__field">
                    <label>{t('app.scheduleCard.frequency', 'Frequency')}</label>
                    <SchedulePicker value={cron} onChange={setCron} compact />
                </div>

                <div className="schedule-card__field schedule-card__retention">
                    <label>{t('app.scheduleCard.retention', 'Retention')}</label>
                    <div className="schedule-card__retention-row">
                        <span>{t('app.scheduleCard.keepLast', 'Keep last')}</span>
                        <Input
                            type="number"
                            min={MIN_COUNT}
                            value={retentionCount}
                            onChange={(e) => setRetentionCount(e.target.value)}
                        />
                        <span>backups</span>
                    </div>
                    <div className="schedule-card__retention-row">
                        <span>{t('app.scheduleCard.deleteOlderThan', 'Delete older than')}</span>
                        <Input
                            type="number"
                            min={MIN_COUNT}
                            value={retentionDays}
                            onChange={(e) => setRetentionDays(e.target.value)}
                        />
                        <span>days</span>
                    </div>
                    <p className="app-panel-hint">
                        {t('app.scheduleCard.bothRulesApplyABackupIs', 'Both rules apply. A backup is kept only if it is within the last N backups AND within the last N days.')}
                    </p>
                </div>

                <div className="schedule-card__field">
                    <label>{t('app.scheduleCard.fullBackupEvery', 'Full backup every')}</label>
                    <div className="schedule-card__retention-row">
                        <Input
                            type="number"
                            min={MIN_COUNT}
                            value={fullEvery}
                            onChange={(e) => setFullEvery(e.target.value)}
                        />
                        <span>days</span>
                    </div>
                    <p className="app-panel-hint">
                        {t('app.scheduleCard.aFullBackupIsTakenEvery', 'A full backup is taken every N days; the rest are incremental.')}
                    </p>
                </div>

                <div className="schedule-card__field">
                    <label>{t('app.scheduleCard.compression', 'Compression')}</label>
                    <SegControl
                        options={[
                            { value: 'fast', labelKey: 'app.scheduleCard.fast', label: 'Fast' },
                            { value: 'balanced', labelKey: 'app.scheduleCard.balanced', label: 'Balanced' },
                            { value: 'max', labelKey: 'app.scheduleCard.max', label: 'Max' },
                        ]}
                        value={compression}
                        onChange={setCompression}
                    />
                </div>

                <div className="schedule-card__field">
                    <label>{t('app.scheduleCard.restoreDrillCadence', 'Restore drill cadence')}</label>
                    <SegControl
                        options={[
                            { value: 'off', labelKey: 'app.scheduleCard.off', label: 'Off' },
                            { value: 'weekly', labelKey: 'app.scheduleCard.weekly', label: 'Weekly' },
                            { value: 'monthly', labelKey: 'app.scheduleCard.monthly', label: 'Monthly' },
                        ]}
                        value={drillCadence}
                        onChange={setDrillCadence}
                    />
                    <p className="app-panel-hint">
                        {t('app.scheduleCard.periodicallyTestRestoreTheLatestBackup', 'Periodically test-restore the latest backup to prove it can actually be recovered. Drills run into a throwaway location and never touch this site. Replaying an incremental backup chain during a drill needs GNU tar, so those drills run on Linux hosts only.')}
                    </p>
                </div>

                <div className="schedule-card__field schedule-card__remote">
                    <Switch
                        id="remote-copy"
                        checked={remoteCopy}
                        onCheckedChange={setRemoteCopy}
                        disabled={!remoteConfigured}
                    />
                    <label htmlFor="remote-copy">
                        <span>{t('app.scheduleCard.copyBackupsToRemoteStorage', 'Copy backups to remote storage')}</span>
                        <span className="app-panel-hint">
                            {remoteConfigured
                                ? t('app.scheduleCard.usesConfiguredProvider', 'Uses the provider configured in Backups → Storage.')
                                : t('app.scheduleCard.noRemoteStorage', 'No remote storage configured. Set one up in Backups → Storage.')}
                        </span>
                    </label>
                </div>

                <div className="schedule-card__actions">
                    <Button
                        variant="primary"
                        size="sm"
                        disabled={!dirty || saving}
                        onClick={handleSave}
                    >
                        {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        {t('app.scheduleCard.saveSchedule', 'Save schedule')}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleCard;
