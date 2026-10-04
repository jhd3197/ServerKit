import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useConfirm } from '../../hooks/useConfirm';
import { DangerZone } from '../DangerZone';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { EnvTag } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard } from '@/components/ui/card';

const SettingsTab = ({ app, onUpdate }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { confirm: confirmAppSettings } = useConfirm();
    const [deleting, setDeleting] = useState(false);
    const [environmentType, setEnvironmentType] = useState(app.environment_type || 'standalone');
    const [savingEnvironment, setSavingEnvironment] = useState(false);
    const [unlinking, setUnlinking] = useState(false);

    const envLabels = {
        standalone: 'Standalone',
        production: 'Production',
        development: 'Development',
        staging: 'Staging'
    };

    async function handleDelete() {
        // Surface the schedules this delete will strand (kept but detached) so the
        // operator decides with eyes open — the honest-delete half of plan 34 #3.
        let cronNote = '';
        try {
            const jobs = (await api.getCronJobsForApp(app.id))?.jobs || [];
            if (jobs.length) {
                const names = jobs.map((j) => j.name || 'Unnamed').join(', ');
                cronNote = ` ${jobs.length} scheduled task${jobs.length > 1 ? 's' : ''} will be suspended and resumed if you restore it: ${names}.`;
            }
        } catch { /* cron visibility is best-effort — never block the delete */ }

        const firstConfirm = await confirmAppSettings({ titleKey: 'app.settingsTab.deleteApplication', title: 'Delete service', message: `Delete ${app.name}? It stops serving and moves to the recycle bin, where you can restore it for 30 days.${cronNote}` });
        if (!firstConfirm) return;
        const secondConfirm = await confirmAppSettings({ titleKey: 'app.settingsTab.confirmDeletion', title: 'Confirm deletion', messageKey: 'app.settingsTab.areYouSureItsContainersStop', message: 'Delete this service? Its containers stop and it stops being served. Files and data volumes are kept until you purge it from the recycle bin.' });
        if (!secondConfirm) return;

        setDeleting(true);
        try {
            await api.deleteApp(app.id);
            navigate('/apps');
        } catch (err) {
            console.error('Failed to delete app:', err);
            setDeleting(false);
        }
    }

    async function handleEnvironmentChange(newType) {
        if (newType === app.environment_type) return;

        setSavingEnvironment(true);
        try {
            await api.updateAppEnvironment(app.id, newType);
            setEnvironmentType(newType);
            onUpdate();
        } catch (err) {
            console.error('Failed to update environment:', err);
            setEnvironmentType(app.environment_type || 'standalone');
        } finally {
            setSavingEnvironment(false);
        }
    }

    async function handleUnlink() {
        const confirmed = await confirmAppSettings({ titleKey: 'app.settingsTab.unlinkApplication', title: 'Unlink service', message: `Unlink ${app.name} from its linked service? Both services will become standalone.`, variant: 'warning' });
        if (!confirmed) return;

        setUnlinking(true);
        try {
            await api.unlinkApp(app.id);
            onUpdate();
        } catch (err) {
            console.error('Failed to unlink app:', err);
        } finally {
            setUnlinking(false);
        }
    }

    return (
        <div>
            <h3 className="app-eyebrow">{t('app.settingsTab.applicationSettings', 'Service settings')}</h3>

            <SharedCard variant="legacy" className="card settings-section">
                <h4>{t('app.settingsTab.environmentConfiguration', 'Environment settings')}</h4>
                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.settingsTab.environmentType', 'Environment type')}</span>
                        <span className="settings-hint">
                            {app.has_linked_app
                                ? 'This service is linked. Unlink to change environment type.'
                                : 'Set how this service is used in your workflow.'}
                        </span>
                    </div>
                    <div className="settings-control">
                        {app.has_linked_app ? (
                            <EnvTag env={app.environment_type}>
                                {envLabels[app.environment_type] || app.environment_type}
                            </EnvTag>
                        ) : (
                            <Select
                                value={environmentType}
                                onValueChange={handleEnvironmentChange}
                                disabled={savingEnvironment}
                            >
                                <SelectTrigger className="settings-select" aria-label={t('app.settingsTab.environmentType', 'Environment type')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="standalone">{t('app.settingsTab.standalone', 'Standalone')}</SelectItem>
                                    <SelectItem value="development">{t('app.settingsTab.development', 'Development')}</SelectItem>
                                    <SelectItem value="staging">{t('app.settingsTab.staging', 'Staging')}</SelectItem>
                                    <SelectItem value="production">{t('app.settingsTab.production', 'Production')}</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                        {savingEnvironment && <span className="settings-saving">{t('common.editing.saving', 'Saving…')}</span>}
                    </div>
                </div>

                {app.has_linked_app && (
                    <div className="settings-row settings-linked-warning">
                        <div className="settings-label">
                            <span>{t('app.settingsTab.linkedApplication', 'Linked service')}</span>
                            <span className="settings-hint">
                                {t('app.settingsTab.thisAppIsLinkedToAnother', 'This service is linked to another service. Unlinking will reset both services to standalone mode.')}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Button
                                variant="outline"
                                onClick={handleUnlink}
                                disabled={unlinking}
                            >
                                {unlinking ? 'Unlinking...' : 'Unlink service'}
                            </Button>
                        </div>
                    </div>
                )}
            </SharedCard>

            <DangerZone
                title={t('app.settingsTab.dangerZone', 'Delete service')}
                description={t('app.settingsTab.onceYouDeleteAnApplicationThere', "Deleting a service is permanent. You can't undo this.")}
                action={
                    <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                        {deleting ? t('app.settingsTab.deleting', 'Deleting…') : t('app.settingsTab.deleteService', 'Delete service')}
                    </Button>
                }
            />
        </div>
    );
};

export default SettingsTab;
