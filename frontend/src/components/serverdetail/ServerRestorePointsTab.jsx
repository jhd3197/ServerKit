import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, RefreshCw, Save } from 'lucide-react';
import api from '../../services/api';
import Modal from '../Modal';
import FormField from '../FormField';
import DeploymentTimeline from '../deployments/DeploymentTimeline';
import { Button } from '../ui/button';
import { useToast } from '../../contexts/useToast.js';
import { useTranslation } from 'react-i18next';

export default function ServerRestorePointsTab({ serverId }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [apps, setApps] = useState([]);
    const [appsLoading, setAppsLoading] = useState(true);
    const [appsError, setAppsError] = useState(null);
    const [showQuicksave, setShowQuicksave] = useState(false);
    const [selectedAppId, setSelectedAppId] = useState('');
    const [label, setLabel] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);

    const loadApps = useCallback(async () => {
        try {
            setAppsLoading(true);
            const data = await api.getApps({ allWorkspaces: true });
            setApps(data.apps || []);
            setAppsError(null);
        } catch (err) {
            setAppsError(err.message);
        } finally {
            setAppsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadApps();
    }, [loadApps]);

    const serverApps = useMemo(
        () => apps
            .filter((app) => String(app.server_id || '') === String(serverId))
            .sort((left, right) => left.name.localeCompare(right.name)),
        [apps, serverId],
    );

    function openQuicksave() {
        setSelectedAppId(serverApps.length === 1 ? String(serverApps[0].id) : '');
        setLabel('');
        setSaveError(null);
        setShowQuicksave(true);
    }

    function handleRefresh() {
        loadApps();
        setTimelineRefreshKey((value) => value + 1);
    }

    async function handleQuicksave() {
        if (!selectedAppId) {
            setSaveError(t('app.serverRestorePoints.chooseApplication', 'Choose an application to quicksave.'));
            return;
        }
        try {
            setSaving(true);
            setSaveError(null);
            await api.createRestorePoint({
                scopeType: 'env',
                scopeId: selectedAppId,
                label: label.trim() || null,
            });
            setShowQuicksave(false);
            setTimelineRefreshKey((value) => value + 1);
            toast.success(t('app.serverRestorePoints.quicksaveCreated', 'Environment quicksave created.'));
        } catch (err) {
            setSaveError(err.message);
            toast.error(err.message || t('app.serverRestorePoints.quicksaveFailed', 'Failed to create quicksave.'));
        } finally {
            setSaving(false);
        }
    }

    const quicksaveFooter = (
        <>
            <Button type="button" variant="outline" onClick={() => setShowQuicksave(false)} disabled={saving}>
                {t('common.actions.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving || !selectedAppId}>
                <Save size={14} />
                {saving
                    ? t('app.serverRestorePoints.saving', 'Saving…')
                    : t('app.serverRestorePoints.createQuicksave', 'Create quicksave')}
            </Button>
        </>
    );

    return (
        <section className="server-restore-points">
            <header className="server-restore-points__header">
                <div>
                    <h2>{t('app.serverRestorePoints.title', 'Restore points')}</h2>
                </div>
                <div className="server-restore-points__actions">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefresh}
                    >
                        <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
                    </Button>
                    <Button
                        size="sm"
                        onClick={openQuicksave}
                        disabled={appsLoading || serverApps.length === 0}
                    >
                        <Save size={14} /> {t('app.serverRestorePoints.quicksave', 'Quicksave')}
                    </Button>
                </div>
            </header>

            <div className="server-restore-points__scope-note">
                <Info size={17} />
                <p>{t('app.serverRestorePoints.scopeNote', 'Remote quicksave currently covers application environment variables stored by ServerKit. Secret values are masked and cannot be recovered. Shared variable groups and host-level cron, firewall, DNS, and Nginx are not included.')}</p>
            </div>

            {appsLoading && (
                <div className="server-restore-points__apps-status" role="status">
                    {t('app.serverRestorePoints.loadingApplications', 'Loading applications for this server…')}
                </div>
            )}

            {appsError && (
                <div className="server-restore-points__apps-status alert alert-danger">
                    <span>{appsError}</span>
                    <Button variant="outline" size="sm" onClick={loadApps}>
                        {t('common.actions.retry', 'Retry')}
                    </Button>
                </div>
            )}

            {!appsLoading && !appsError && serverApps.length === 0 && (
                <div className="server-restore-points__apps-status server-restore-points__apps-status--empty">
                    <Save size={16} />
                    <div>
                        <strong>{t('app.serverRestorePoints.noApplications', 'No applications are available for quicksave')}</strong>
                        <span>{t('app.serverRestorePoints.noApplicationsDescription', 'The timeline remains available. Add or gain access to an application on this server to create an environment quicksave.')}</span>
                    </div>
                </div>
            )}

            <DeploymentTimeline serverId={serverId} refreshKey={timelineRefreshKey} />

            {showQuicksave && (
                <Modal
                    open
                    onClose={() => setShowQuicksave(false)}
                    title={t('app.serverRestorePoints.createEnvironmentQuicksave', 'Create environment quicksave')}
                    onSubmit={handleQuicksave}
                    footer={quicksaveFooter}
                >
                    <div className="server-restore-points__form">
                        <p className="server-restore-points__form-intro">
                            {t('app.serverRestorePoints.formDescription', 'Choose one application on this server. Only its ServerKit-managed environment variables will be captured.')}
                        </p>
                        <FormField
                            label={t('app.serverRestorePoints.application', 'Application')}
                            htmlFor="restore-point-app"
                            required
                        >
                            <select
                                id="restore-point-app"
                                value={selectedAppId}
                                onChange={(event) => {
                                    setSelectedAppId(event.target.value);
                                    setSaveError(null);
                                }}
                                required
                            >
                                <option value="">{t('app.serverRestorePoints.selectApplication', 'Select an application')}</option>
                                {serverApps.map((app) => (
                                    <option key={app.id} value={app.id}>{app.name}</option>
                                ))}
                            </select>
                        </FormField>
                        <FormField
                            label={t('app.serverRestorePoints.label', 'Label (optional)')}
                            htmlFor="restore-point-label"
                        >
                            <input
                                id="restore-point-label"
                                type="text"
                                maxLength={255}
                                value={label}
                                onChange={(event) => setLabel(event.target.value)}
                                placeholder={t('app.serverRestorePoints.labelPlaceholder', 'Before environment change')}
                            />
                        </FormField>
                        {saveError && <div className="error-message" role="alert">{saveError}</div>}
                    </div>
                </Modal>
            )}
        </section>
    );
}
