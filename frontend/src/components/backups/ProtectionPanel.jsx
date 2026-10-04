// Shared "Protection" panel — the upgraded backup experience rendered for both
// WordPress sites and applications (Services). Loads the backup policy + run
// history and owns every mutation (toggle, schedule save, manual backup,
// restore, verify, delete). Three stacked cards plus detail/restore drawers.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, RefreshCw, Loader2, List, CalendarDays, X } from 'lucide-react';

import api from '@/services/api';
import { useToast } from '@/contexts/useToast.js';
import { useOperations } from '@/contexts/OperationsContext';
import { useConfirm } from '@/hooks/useConfirm';
import { Button } from '@/components/ui/button';

import ProtectionStatusCard from './ProtectionStatusCard';
import ScheduleCard from './ScheduleCard';
import BackupHistoryList from './BackupHistoryList';
import BackupCalendar from './BackupCalendar';
import BackupDetailDrawer from './BackupDetailDrawer';
import RestoreDrawer from './RestoreDrawer';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

function sameLocalDay(iso, date) {
    if (!iso) return false;
    const d = new Date(iso);
    return d.getFullYear() === date.getFullYear()
        && d.getMonth() === date.getMonth()
        && d.getDate() === date.getDate();
}

export default function ProtectionPanel({ targetType, targetId, targetName, showMaintenanceModeOption = false }) {
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { confirm } = useConfirm();
    const { openRun } = useOperations();

    const [view, setView] = useState(null);   // policy view payload
    const [runs, setRuns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [backingUp, setBackingUp] = useState(false);
    const [drilling, setDrilling] = useState(false);
    const [historyView, setHistoryView] = useState('list');  // 'list' | 'calendar'
    const [dayFilter, setDayFilter] = useState(null);        // Date | null
    const [detailRun, setDetailRun] = useState(null);
    const [restoreRun, setRestoreRun] = useState(null);
    // Restore scopes this target type supports, from the target-types API
    // (extension-provided types declare their own — plan 52 D4). Null until
    // loaded; RestoreDrawer falls back to its built-in defaults then.
    const [restoreScopes, setRestoreScopes] = useState(null);
    const reloadTimers = useRef([]);

    // Fetched once per target type, not on every load() (which refires on
    // window focus) — the type catalog changes only when extensions change.
    useEffect(() => {
        let cancelled = false;
        api.getBackupTargetTypes()
            .then((res) => {
                if (cancelled) return;
                const entry = (res?.target_types || []).find(
                    (t) => t.target_type === targetType);
                setRestoreScopes(entry?.restore_scopes || null);
            })
            .catch(() => { /* optional — the drawer has sane fallbacks */ });
        return () => { cancelled = true; };
    }, [targetType]);

    const load = useCallback(async () => {
        if (!targetId) return;
        try {
            const [policyView, runsResp] = await Promise.all([
                api.getBackupPolicy(targetType, targetId),
                api.getBackupRuns(targetType, targetId),
            ]);
            setView(policyView);
            setRuns(runsResp?.runs || []);
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToLoadProtectionSettings', "Couldn't load protection settings."), err);
        } finally {
            setLoading(false);
        }
    }, [targetId, targetType, toast, t]);

    useEffect(() => {
        setLoading(true);
        load();
    }, [load]);

    // Refresh when the tab regains focus (a background backup may have finished).
    useEffect(() => {
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [load]);

    // Clear any pending delayed reloads on unmount.
    useEffect(() => () => reloadTimers.current.forEach(clearTimeout), []);

    const scheduleReloads = useCallback(() => {
        reloadTimers.current.forEach(clearTimeout);
        reloadTimers.current = [setTimeout(load, 2500), setTimeout(load, 7000)];
    }, [load]);

    const handleToggle = useCallback(async (enabled) => {
        setSaving(true);
        try {
            const updated = await api.updateBackupPolicy(targetType, targetId, { enabled });
            setView(updated);
            toast.success(enabled ? t('app.protectionPanel.automaticBackupsEnabled', 'Automatic backups enabled') : t('app.protectionPanel.automaticBackupsDisabled', 'Automatic backups disabled'));
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToUpdateProtection', "Couldn't update protection."), err);
        } finally {
            setSaving(false);
        }
    }, [targetType, targetId, toast, t]);

    const handleSaveSchedule = useCallback(async (fields) => {
        setSaving(true);
        try {
            const updated = await api.updateBackupPolicy(targetType, targetId, fields);
            setView(updated);
            toast.success(t('app.protectionPanel.scheduleSaved', 'Schedule saved'));
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToSaveSchedule', "Couldn't save the schedule."), err);
        } finally {
            setSaving(false);
        }
    }, [targetType, targetId, toast, t]);

    const handleBackupNow = useCallback(async () => {
        setBackingUp(true);
        try {
            const result = await api.triggerBackup(targetType, targetId);
            if (result?.job_id) openRun('job', result.job_id);
            toast.success(t('app.protectionPanel.backupStarted', 'Backup started'));
            scheduleReloads();
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToStartBackup', "Couldn't start the backup."), err);
        } finally {
            setBackingUp(false);
        }
    }, [targetType, targetId, openRun, toast, t, scheduleReloads]);

    const handleRunDrill = useCallback(async () => {
        setDrilling(true);
        try {
            await api.runBackupDrill(targetType, targetId);
            toast.success(t('app.protectionPanel.restoreDrillStarted', 'Restore drill started'));
            scheduleReloads();
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToStartRestoreDrill', "Couldn't start the restore drill."), err);
        } finally {
            setDrilling(false);
        }
    }, [targetType, targetId, toast, t, scheduleReloads]);

    // Restore is always initiated from a run — opening the restore drawer.
    const openRestore = useCallback((run) => setRestoreRun(run), []);

    const handleRestoreConfirm = useCallback(async (options) => {
        if (!restoreRun) return;
        try {
            await api.restoreBackupRun(targetType, targetId, restoreRun.id, {
                ...options,
                maintenance_mode: showMaintenanceModeOption ? options.maintenance_mode : false,
            });
            toast.success(t('app.protectionPanel.restoreStarted', 'Restore started'));
            setRestoreRun(null);
            setDetailRun(null);
            scheduleReloads();
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToStartRestore', "Couldn't start the restore."), err);
        }
    }, [restoreRun, targetType, targetId, showMaintenanceModeOption, toast, t, scheduleReloads]);

    const handleVerify = useCallback(async (run) => {
        try {
            const result = await api.verifyBackupRun(targetType, targetId, run.id);
            if (result?.verified) toast.success(t('app.protectionPanel.remoteCopyVerified', 'Remote copy verified'));
            else toast.warning(t('app.protectionPanel.remoteCopyCouldNotBeVerified', 'Remote copy could not be verified'));
            load();
        } catch (err) {
            toastError(toast, t('app.protectionPanel.verificationFailed', "Couldn't verify the backup."), err);
        }
    }, [targetType, targetId, toast, t, load]);

    const handleDelete = useCallback(async (run) => {
        const ok = await confirm({
            title: t('app.protectionPanel.deleteBackup', 'Delete backup?'),
            message: t('app.protectionPanel.thisPermanentlyDeletesTheBackupIncluding', 'This permanently deletes the backup, including any remote copy. This cannot be undone.'),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.deleteBackupRun(targetType, targetId, run.id);
            toast.success(t('app.protectionPanel.backupDeleted', 'Backup deleted'));
            if (detailRun?.id === run.id) setDetailRun(null);
            load();
        } catch (err) {
            toastError(toast, t('app.protectionPanel.failedToDeleteBackup', "Couldn't delete the backup."), err);
        }
    }, [confirm, t, targetType, targetId, toast, detailRun?.id, load]);

    const visibleRuns = useMemo(
        () => (dayFilter ? runs.filter((r) => sameLocalDay(r.started_at, dayFilter)) : runs),
        [runs, dayFilter],
    );

    return (
        <div className="protection-panel app-overview-grid">
            <div className="app-overview-left">
                <ProtectionStatusCard
                    policyView={view}
                    onToggle={handleToggle}
                    onBackupNow={handleBackupNow}
                    onRunDrill={handleRunDrill}
                    onViewGlobal={() => navigate('/backups')}
                    onViewJobs={() => navigate('/monitoring/jobs')}
                    busy={saving}
                    backingUp={backingUp}
                    drilling={drilling || !!view?.restore_proof?.is_drilling}
                />

                <ScheduleCard
                    policy={view?.policy}
                    remoteConfigured={!!view?.remote_configured}
                    onSave={handleSaveSchedule}
                    saving={saving}
                />

                <div className="app-panel backup-history-card">
                    <div className="app-panel-header">
                        <History size={16} />
                        <span>{t('app.protectionPanel.backupHistory', 'Backup history')}</span>
                        <span className="app-panel-header-actions backup-history-card__tools">
                            {dayFilter && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="backup-history-card__chip"
                                    onClick={() => setDayFilter(null)}
                                >
                                    {dayFilter.toLocaleDateString()} <X size={12} />
                                </Button>
                            )}
                            <div className="backup-history-card__toggle">
                                <Button variant="unstyled"
                                    type="button"
                                    className={historyView === 'list' ? 'is-active' : ''}
                                    onClick={() => setHistoryView('list')}
                                    aria-label={t('app.protectionPanel.listView', 'List view')}
                                >
                                    <List size={14} />
                                </Button>
                                <Button variant="unstyled"
                                    type="button"
                                    className={historyView === 'calendar' ? 'is-active' : ''}
                                    onClick={() => setHistoryView('calendar')}
                                    aria-label={t('app.protectionPanel.calendarView', 'Calendar view')}
                                >
                                    <CalendarDays size={14} />
                                </Button>
                            </div>
                            <Button size="sm" variant="outline" onClick={load} disabled={loading} title={t('common.actions.refresh', 'Refresh')}>
                                {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                            </Button>
                        </span>
                    </div>
                    <div className="app-panel-body">
                        {historyView === 'calendar' ? (
                            <BackupCalendar
                                runs={runs}
                                onDayClick={(date) => { setDayFilter(date); setHistoryView('list'); }}
                            />
                        ) : (
                            <BackupHistoryList
                                runs={visibleRuns}
                                drills={dayFilter ? [] : view?.restore_proof?.recent_drills}
                                loading={loading}
                                onRestore={openRestore}
                                onVerify={handleVerify}
                                onDelete={handleDelete}
                                onRowClick={(run) => setDetailRun(run)}
                            />
                        )}
                    </div>
                </div>
            </div>

            <BackupDetailDrawer
                run={detailRun}
                open={!!detailRun}
                onClose={() => setDetailRun(null)}
                onRestore={(run) => { setDetailRun(null); openRestore(run); }}
                onVerify={handleVerify}
                onDelete={handleDelete}
            />

            <RestoreDrawer
                run={restoreRun}
                open={!!restoreRun}
                onClose={() => setRestoreRun(null)}
                onConfirm={handleRestoreConfirm}
                targetName={targetName}
                targetType={targetType}
                restoreScopes={restoreScopes}
                showMaintenanceModeOption={showMaintenanceModeOption}
            />
        </div>
    );
}
