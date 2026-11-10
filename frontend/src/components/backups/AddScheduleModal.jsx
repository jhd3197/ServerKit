import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '@/components/Modal';
import { FormField } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import useForm from '@/hooks/useForm';
import useFieldErrors from '@/hooks/useFieldErrors';

export default function AddScheduleModal({ open, onClose, onCreate, onCreated, remoteEnabled, timezone }) {
    const { t } = useTranslation();
    const form = useForm({
        initialValues: { name: '', backupType: 'application', target: '', scheduleTime: '02:00', days: ['daily'], uploadRemote: false },
        onSubmit: async (values) => {
            await onCreate(values);
            form.reset();
            fe.reset();
            onCreated();
        },
    });
    const fieldId = useId();
    const required = t('common.validation.required', 'This field is required.');
    const fe = useFieldErrors({
        name: form.values.name.trim() ? null : required,
        target: form.values.target.trim() ? null : required,
        scheduleTime: form.values.scheduleTime ? null : required,
    }, fieldId);
    const submit = (e) => {
        if (!fe.attempt()) { e.preventDefault(); return undefined; }
        return form.handleSubmit(e);
    };
    const close = () => { fe.reset(); onClose(); };
    const err = (name) => fe.error(name) || form.getFieldError(name);
    // Wraps getFieldProps so edits/blur also drive the inline-error timing.
    const props = (name) => {
        const p = form.getFieldProps(name);
        return { ...p, onBlur: () => { p.onBlur(); fe.touch(name); }, 'aria-invalid': Boolean(err(name)) };
    };
    const targetLabel = form.values.backupType === 'files'
        ? t('app.backups.schedulePaths', 'Paths (comma-separated)')
        : form.values.backupType === 'database'
            ? t('app.backups.scheduleDatabase', 'Database (format: mysql:dbname or postgresql:dbname)')
            : t('app.backups.applicationName', 'Service name');

    return (
        <Modal open={open} onClose={() => { if (!form.isSubmitting) close(); }} title={t('app.backups.addBackupSchedule', 'New backup schedule')}>
            <form onSubmit={submit} noValidate data-walkthrough="backup-schedule-form">
                {form.submitError && <p className="error-message" role="alert">{form.submitError}</p>}
                <FormField htmlFor={`${fieldId}-name`} label={t('app.backups.scheduleName', 'Schedule name')} error={err('name')} required>
                    <Input id={`${fieldId}-name`} type="text" {...props('name')} placeholder={t('app.backups.dailyAppBackup', 'Daily service backup')} />
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
                            <SelectItem value="application">{t('app.backups.application', 'Service')}</SelectItem>
                            <SelectItem value="database">{t('app.backups.database', 'Database')}</SelectItem>
                            <SelectItem value="files">{t('app.backups.filesDirectories', 'Files / directories')}</SelectItem>
                        </SelectContent>
                    </Select>
                </FormField>
                <FormField htmlFor={`${fieldId}-target`} label={targetLabel} error={err('target')} required>
                    <Input id={`${fieldId}-target`} type="text" {...props('target')} placeholder={form.values.backupType === 'files' ? '/etc/nginx,/var/www/config' : form.values.backupType === 'database' ? 'mysql:mydb' : 'my-app'} />
                </FormField>
                <FormField htmlFor={`${fieldId}-scheduleTime`} label={t('common.labels.time', 'Time')} error={err('scheduleTime')} hint={timezone} required>
                    <Input id={`${fieldId}-scheduleTime`} type="time" {...props('scheduleTime')} />
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
                    <Button type="button" variant="outline" onClick={close} disabled={form.isSubmitting}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button type="submit" disabled={form.isSubmitting} data-walkthrough="backup-schedule-submit">{t('app.backups.addSchedule', 'Create schedule')}</Button>
                </div>
            </form>
        </Modal>
    );
}
