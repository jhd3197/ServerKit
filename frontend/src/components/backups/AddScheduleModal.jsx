import { useTranslation } from 'react-i18next';
import Modal from '@/components/Modal';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import useForm from '@/hooks/useForm';

export default function AddScheduleModal({ open, onClose, onCreate, onCreated, remoteEnabled, timezone }) {
    const { t } = useTranslation();
    const form = useForm({
        initialValues: { name: '', backupType: 'application', target: '', scheduleTime: '02:00', days: ['daily'], uploadRemote: false },
        onSubmit: async (values) => {
            await onCreate(values);
            form.reset();
            onCreated();
        },
    });
    const targetLabel = form.values.backupType === 'files'
        ? t('app.backups.schedulePaths', 'Paths (comma-separated)')
        : form.values.backupType === 'database'
            ? t('app.backups.scheduleDatabase', 'Database (format: mysql:dbname or postgresql:dbname)')
            : t('app.backups.applicationName', 'Application name');

    return (
        <Modal open={open} onClose={() => { if (!form.isSubmitting) onClose(); }} title={t('app.backups.addBackupSchedule', 'Add backup schedule')}>
            <form onSubmit={form.handleSubmit} data-walkthrough="backup-schedule-form">
                {form.submitError && <p className="error-message" role="alert">{form.submitError}</p>}
                <FormField htmlFor="backup-schedule-name" label={t('app.backups.scheduleName', 'Schedule name')} error={form.getFieldError('name')} required>
                    <Input id="backup-schedule-name" type="text" {...form.getFieldProps('name')} placeholder={t('app.backups.dailyAppBackup', 'Daily app backup')} required />
                </FormField>
                <FormField htmlFor="backup-schedule-type" label={t('app.backups.backupType', 'Backup type')} error={form.getFieldError('backupType')}>
                    <Select
                        name="backupType"
                        value={form.values.backupType}
                        onValueChange={(value) => form.setValue('backupType', value, { touch: true })}
                    >
                        <SelectTrigger id="backup-schedule-type" aria-invalid={Boolean(form.getFieldError('backupType'))}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="application">{t('app.backups.application', 'Application')}</SelectItem>
                            <SelectItem value="database">{t('app.backups.database', 'Database')}</SelectItem>
                            <SelectItem value="files">{t('app.backups.filesDirectories', 'Files / directories')}</SelectItem>
                        </SelectContent>
                    </Select>
                </FormField>
                <FormField htmlFor="backup-schedule-target" label={targetLabel} error={form.getFieldError('target')} required>
                    <Input id="backup-schedule-target" type="text" {...form.getFieldProps('target')} placeholder={form.values.backupType === 'files' ? '/etc/nginx,/var/www/config' : form.values.backupType === 'database' ? 'mysql:mydb' : 'my-app'} required />
                </FormField>
                <FormField htmlFor="backup-schedule-time" label={t('common.labels.time', 'Time')} error={form.getFieldError('scheduleTime')} hint={timezone} required>
                    <Input id="backup-schedule-time" type="time" {...form.getFieldProps('scheduleTime')} required />
                </FormField>
                {remoteEnabled && (
                    <FormField>
                        <label className="checkbox-label">
                            <input type="checkbox" name="uploadRemote" checked={form.values.uploadRemote} onChange={form.handleChange} />
                            <span>{t('app.backups.uploadToRemoteStorageAfterBackup', 'Upload to remote storage after backup')}</span>
                        </label>
                    </FormField>
                )}
                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose} disabled={form.isSubmitting}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button type="submit" disabled={form.isSubmitting} data-walkthrough="backup-schedule-submit">{t('app.backups.addSchedule', 'Add schedule')}</Button>
                </div>
            </form>
        </Modal>
    );
}
