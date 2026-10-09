import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useServerMutation, useServerQuery } from './useServerQuery';
import { toastError } from '@/utils/errorMessage';

const SCHEDULE_KEY = ['backups', 'schedules'];
const EMPTY_SCHEDULES = [];

// One workspace-scoped cache owns policy CRUD and scheduler timing. Refresh
// through the shared poller so a passed next_run_at advances without reloading
// the whole backup archive or overwriting unfinished settings forms.
export function useBackupSchedules() {
    const { t } = useTranslation();
    const toast = useToast();
    const query = useServerQuery(SCHEDULE_KEY, () => api.getBackupSchedules(), {
        refetchInterval: 60_000,
        onError: (error) => toastError(toast, t('app.backups.couldntLoadSchedules', "Couldn't load backup schedules."), error),
    });
    const create = useServerMutation((values) => api.addBackupSchedule(
        values.name, values.backupType, values.target, values.scheduleTime,
        values.days, values.uploadRemote,
    ), { invalidate: [SCHEDULE_KEY] });
    const toggle = useServerMutation((schedule) => api.updateBackupSchedule(schedule.id, { enabled: !schedule.enabled }), {
        invalidate: [SCHEDULE_KEY],
        onSuccess: (_, schedule) => toast.success(schedule.enabled
            ? t('app.backups.scheduleOff', 'Schedule turned off')
            : t('app.backups.scheduleOn', 'Schedule turned on')),
        onError: (error) => toastError(toast, t('app.backups.couldntToggleSchedule', "Couldn't turn the schedule on or off."), error),
    });
    const remove = useServerMutation((id) => api.removeBackupSchedule(id), {
        invalidate: [SCHEDULE_KEY],
        onSuccess: () => toast.success(t('app.backups.scheduleRemoved', 'Schedule deleted')),
        onError: (error) => toastError(toast, t('app.backups.couldntDeleteSchedule', "Couldn't delete the schedule."), error),
    });
    const refetch = query.refetch;
    const reportError = toast.error;
    const refresh = useCallback(() => refetch().catch((error) => reportError(error.message)), [refetch, reportError]);

    // UI event handlers intentionally resolve after the mutation's shared error
    // presentation. Creation retains rejection for useForm's inline errors.
    return {
        schedules: query.data?.schedules ?? EMPTY_SCHEDULES,
        timezone: query.data?.timezone,
        isLoading: query.isLoading,
        refresh,
        create: create.mutate,
        toggle: (schedule) => toggle.mutate(schedule).catch(() => undefined),
        remove: (id) => remove.mutate(id).catch(() => undefined),
    };
}
