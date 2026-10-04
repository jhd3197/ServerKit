import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import { Layers } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Must match app/services/deploy_settings.py DEFAULTS / _RULES.
const WATCH_DEFAULT = 60;
const WATCH_MAX = 900;
const STANDBY_DEFAULT = 10;
const STANDBY_MAX = 1440;

function intIn(value, min, max) {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// A/B slot deploys (plan 87 §F): the opt-in and its knobs. Eligibility comes
// from the server with its reasons, so the toggle never promises what a
// deploy would then refuse.
const SlotDeploysPanel = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const settings = app.deploy_settings || {};
    const [status, setStatus] = useState(null);
    const [toggling, setToggling] = useState(false);
    const [saving, setSaving] = useState(false);
    const [watch, setWatch] = useState(String(settings.watch_seconds ?? WATCH_DEFAULT));
    const [standby, setStandby] = useState(String(settings.standby_warm_minutes ?? STANDBY_DEFAULT));
    const [volumesOk, setVolumesOk] = useState(!!settings.slot_volumes_confirmed);
    const [releaseCommand, setReleaseCommand] = useState(settings.release_command || '');
    const [snapshotDbs, setSnapshotDbs] = useState(settings.snapshot_databases ?? true);
    const [stopOld, setStopOld] = useState(!!settings.stop_old_before_release);
    const [split, setSplit] = useState(null);
    const [splitting, setSplitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getAppSlots(app.id)
            .then((data) => { if (!cancelled) setStatus(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id, app.deploy_settings]);

    const watchValue = intIn(watch, 0, WATCH_MAX);
    const standbyValue = intIn(standby, 0, STANDBY_MAX);
    const dirty = (watchValue !== null && watchValue !== (settings.watch_seconds ?? WATCH_DEFAULT))
        || (standbyValue !== null && standbyValue !== (settings.standby_warm_minutes ?? STANDBY_DEFAULT))
        || volumesOk !== !!settings.slot_volumes_confirmed
        || releaseCommand.trim() !== (settings.release_command || '')
        || snapshotDbs !== (settings.snapshot_databases ?? true)
        || stopOld !== !!settings.stop_old_before_release;

    async function handleToggle(next) {
        setToggling(true);
        try {
            const data = await api.setAppSlots(app.id, next);
            setStatus(data.slots);
            toast.success(next
                ? t('app.slotDeploysPanel.enabled', 'Slot deploys on. The running container is now slot A; the next deploy boots slot B.')
                : (data.note || t('app.slotDeploysPanel.disabled', 'Slot deploys off')));
            onChanged?.();
        } catch (err) {
            toastError(toast, t('app.slotDeploysPanel.toggleFailed', 'Could not change slot deploys'), err);
        } finally {
            setToggling(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        try {
            await api.updateApp(app.id, {
                deploy_settings: {
                    watch_seconds: watchValue,
                    standby_warm_minutes: standbyValue,
                    slot_volumes_confirmed: volumesOk,
                    release_command: releaseCommand.trim() || null,
                    snapshot_databases: snapshotDbs,
                    stop_old_before_release: stopOld,
                },
            });
            toast.success(t('app.slotDeploysPanel.saved', 'Rollout settings saved'));
            onChanged?.();
        } catch (err) {
            toastError(toast, t('app.slotDeploysPanel.saveFailed', 'Failed to save rollout settings'), err);
        } finally {
            setSaving(false);
        }
    }

    async function handlePreviewSplit() {
        try {
            setSplit(await api.previewAppComposeSplit(app.id));
        } catch (err) {
            toastError(toast, t('app.slotDeploysPanel.splitPreviewFailed', 'Could not preview the split'), err);
        }
    }

    async function handleApplySplit() {
        setSplitting(true);
        try {
            const data = await api.applyAppComposeSplit(app.id);
            setStatus(data.slots);
            setSplit(null);
            toast.success(t('app.slotDeploysPanel.splitDone', 'Stateful compose services moved. The service now deploys through slots.'));
            onChanged?.();
        } catch (err) {
            toastError(toast, t('app.slotDeploysPanel.splitFailed', 'The split failed'), err);
        } finally {
            setSplitting(false);
        }
    }

    if (!status) return null;
    const { eligibility } = status;
    const hasVolumes = (status.volumes || []).length > 0;

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <Layers />
                <span>{t('app.slotDeploysPanel.title', 'Slot deploys')}</span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.slotDeploysPanel.intro', 'Each deploy boots the new release in a second slot on its own port while the live one keeps serving. It switches traffic only after the new release passes its health check, watches it for a while, and switches back on its own if it falls over. The previous release stays warm for an instant manual switch back.')}
                </p>

                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.slotDeploysPanel.enable', 'Use slot deploys')}</span>
                        <span className="settings-hint">
                            {eligibility.eligible
                                ? t('app.slotDeploysPanel.enableHint', 'Turning it on restarts nothing: the running container becomes slot A.')
                                : eligibility.reasons.join(' ')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Switch
                            checked={!!status.enabled}
                            onCheckedChange={handleToggle}
                            disabled={toggling || (!status.enabled && !eligibility.eligible)}
                            aria-label={t('app.slotDeploysPanel.enable', 'Use slot deploys')}
                        />
                    </div>
                </div>

                {eligibility.split_needed && (
                    <div className="settings-row">
                        <div className="settings-label">
                            <span>{t('app.slotDeploysPanel.split', 'Move the stateful services first')}</span>
                            <span className="settings-hint">
                                {t('app.slotDeploysPanel.splitHint', 'A database or cache cannot run twice. It moves once into a shared data compose project that both slots reach by the same name, on the same volumes. Preview exactly what changes before anything happens.')}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Button variant="outline" size="sm" onClick={handlePreviewSplit}>
                                {t('app.slotDeploysPanel.previewSplit', 'Preview the split')}
                            </Button>
                        </div>
                    </div>
                )}

                <div className="settings-row">
                    <div className="settings-label">
                        <label htmlFor={`slot-watch-${app.id}`}>
                            {t('app.slotDeploysPanel.watch', 'Watch window (seconds)')}
                        </label>
                        <span className="settings-hint">
                            {t('app.slotDeploysPanel.watchHint', 'How long a release is watched after it goes live. If it stops answering in that time, traffic goes back to the previous release. 0 turns the watch off.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Input id={`slot-watch-${app.id}`} type="number" min={0} max={WATCH_MAX}
                            value={watch} onChange={(e) => setWatch(e.target.value)} disabled={saving} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label">
                        <label htmlFor={`slot-standby-${app.id}`}>
                            {t('app.slotDeploysPanel.standby', 'Keep the previous release warm (minutes)')}
                        </label>
                        <span className="settings-hint">
                            {t('app.slotDeploysPanel.standbyHint', 'While warm, switching back takes seconds. After that it is stopped: it no longer uses memory, and switching back starts it first.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Input id={`slot-standby-${app.id}`} type="number" min={0} max={STANDBY_MAX}
                            value={standby} onChange={(e) => setStandby(e.target.value)} disabled={saving} />
                    </div>
                </div>

                {hasVolumes && (
                    <div className="settings-row">
                        <div className="settings-label">
                            <span>{t('app.slotDeploysPanel.volumes', 'Two copies may share the volumes')}</span>
                            <span className="settings-hint">
                                {t('app.slotDeploysPanel.volumesHint', 'For a few seconds around each switch both releases mount the same volumes. Leave this off if the service keeps something like SQLite there, which breaks when two processes write to it.')}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Switch checked={volumesOk} onCheckedChange={setVolumesOk} disabled={saving}
                                aria-label={t('app.slotDeploysPanel.volumes', 'Two copies may share the volumes')} />
                        </div>
                    </div>
                )}

                <div className="settings-row">
                    <div className="settings-label">
                        <label htmlFor={`slot-release-${app.id}`}>
                            {t('app.slotDeploysPanel.release', 'Release command')}
                        </label>
                        <span className="settings-hint">
                            {t('app.slotDeploysPanel.releaseHint', 'Runs once in a throwaway container of the new release, before traffic switches, for example database migrations. If it fails the deploy stops and the live release is untouched. Empty uses the release: line of the Procfile or serverkit.yaml, if there is one.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Input id={`slot-release-${app.id}`} placeholder={t('app.slotDeploysPanel.releasePlaceholder', 'npm run migrate')}
                            value={releaseCommand} onChange={(e) => setReleaseCommand(e.target.value)} disabled={saving} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.slotDeploysPanel.snapshot', 'Snapshot the databases first')}</span>
                        <span className="settings-hint">
                            {t('app.slotDeploysPanel.snapshotHint', 'Dumps the databases this service owns before the release command runs, so a migration can be undone after a switch back.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Switch checked={snapshotDbs} onCheckedChange={setSnapshotDbs} disabled={saving}
                            aria-label={t('app.slotDeploysPanel.snapshot', 'Snapshot the databases first')} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.slotDeploysPanel.stopOld', 'Stop the live release before the release command')}</span>
                        <span className="settings-hint">
                            {t('app.slotDeploysPanel.stopOldHint', 'For schema changes the running release cannot survive. The service is down from the release command until the new release passes its health check; a failure starts the old release again.')}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Switch checked={stopOld} onCheckedChange={setStopOld} disabled={saving}
                            aria-label={t('app.slotDeploysPanel.stopOld', 'Stop the live release before the release command')} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-label" />
                    <div className="settings-control">
                        <Button size="sm" onClick={handleSave}
                            disabled={saving || !dirty || watchValue === null || standbyValue === null}>
                            {saving ? t('common.editing.saving', 'Saving…') : t('common.actions.save', 'Save')}
                        </Button>
                    </div>
                </div>

                {split && (
                    <Modal
                        open
                        onClose={() => setSplit(null)}
                        title={t('app.slotDeploysPanel.splitTitle', 'Move {{services}} to {{project}}', {
                            services: split.stateful.join(', '), project: split.data_project,
                        })}
                        size="lg"
                        footer={(
                            <>
                                <Button variant="outline" onClick={() => setSplit(null)} disabled={splitting}>
                                    {t('common.actions.cancel', 'Cancel')}
                                </Button>
                                <Button onClick={handleApplySplit} disabled={splitting}>
                                    {splitting
                                        ? t('app.slotDeploysPanel.splitting', 'Moving…')
                                        : t('app.slotDeploysPanel.applySplit', 'Stop the service once and move them')}
                                </Button>
                            </>
                        )}
                    >
                        <p className="slot-split__downtime">{split.downtime}</p>
                        <h4 className="slot-split__label">{t('app.slotDeploysPanel.dataProject', 'Shared data compose project')}</h4>
                        <pre className="slot-split__yaml">{split.data_compose}</pre>
                        <h4 className="slot-split__label">{t('app.slotDeploysPanel.slotProject', 'Each slot')}</h4>
                        <pre className="slot-split__yaml">{split.slot_compose}</pre>
                    </Modal>
                )}

                <p className="app-panel-hint">
                    {t('app.slotDeploysPanel.schemaRule', 'Both releases use the same database during the switch. Keep schema changes backward-compatible for one deploy: add first, deploy, remove later.')}
                </p>
            </div>
        </div>
    );
};

export default SlotDeploysPanel;
