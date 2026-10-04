import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/ErrorState';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';

const SecurityConfigTab = () => {
    const { t } = useTranslation();
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        loadConfig();
    }, []);

    async function loadConfig() {
        setLoading(true);
        try {
            const data = await api.getSecurityConfig();
            setConfig(data);
            setLoadError(null);
        } catch (err) {
            console.error('Failed to load security config:', err);
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSecurityConfig(config);
            setMessage({ type: 'success', text: 'Settings saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    }

    function updateConfig(section, key, value) {
        setConfig(prev => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value
            }
        }));
    }

    if (loading) {
        return <div className="loading-sm">{t('app.securityConfigTab.loadingSettings', 'Loading settings…')}</div>;
    }

    // Never render the form on a failed load: saving it would write the
    // empty defaults over the real configuration.
    if (loadError && !config) {
        return (
            <ErrorState
                title={t('app.securityConfigTab.couldntLoadSettings', "Couldn't load security settings")}
                error={loadError}
                onRetry={loadConfig}
            />
        );
    }

    return (
        <div className="settings-tab">
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.securityConfigTab.clamavSettings', 'ClamAV settings')}</h3>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="clamav-enabled">{t('app.securityConfigTab.enableClamavScanning', 'Enable ClamAV scanning')}</Label>
                            <Switch
                                id="clamav-enabled"
                                checked={config?.clamav?.enabled || false}
                                onCheckedChange={(checked) => updateConfig('clamav', 'enabled', checked)}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="clamav-scan-upload">{t('app.securityConfigTab.scanFilesOnUpload', 'Scan files on upload')}</Label>
                            <Switch
                                id="clamav-scan-upload"
                                checked={config?.clamav?.scan_on_upload || false}
                                onCheckedChange={(checked) => updateConfig('clamav', 'scan_on_upload', checked)}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <Label>{t('app.securityConfigTab.quarantinePath', 'Quarantine path')}</Label>
                        <Input
                            type="text"
                            value={config?.clamav?.quarantine_path || '/var/quarantine'}
                            onChange={(e) => updateConfig('clamav', 'quarantine_path', e.target.value)}
                        />
                    </div>
                </SharedCardContent>
            </SharedCard>

            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.securityConfigTab.fileIntegritySettings', 'File integrity settings')}</h3>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="integrity-enabled">{t('app.securityConfigTab.enableFileIntegrityMonitoring', 'Enable file integrity monitoring')}</Label>
                            <Switch
                                id="integrity-enabled"
                                checked={config?.file_integrity?.enabled || false}
                                onCheckedChange={(checked) => updateConfig('file_integrity', 'enabled', checked)}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="integrity-alert">{t('app.securityConfigTab.alertOnFileChanges', 'Alert on file changes')}</Label>
                            <Switch
                                id="integrity-alert"
                                checked={config?.file_integrity?.alert_on_change || false}
                                onCheckedChange={(checked) => updateConfig('file_integrity', 'alert_on_change', checked)}
                            />
                        </div>
                    </div>
                </SharedCardContent>
            </SharedCard>

            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.securityConfigTab.notificationSettings', 'Notification settings')}</h3>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="notify-malware">{t('app.securityConfigTab.notifyOnMalwareDetection', 'Notify on malware detection')}</Label>
                            <Switch
                                id="notify-malware"
                                checked={config?.notifications?.on_malware_found || false}
                                onCheckedChange={(checked) => updateConfig('notifications', 'on_malware_found', checked)}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="notify-integrity">{t('app.securityConfigTab.notifyOnIntegrityChanges', 'Notify on integrity changes')}</Label>
                            <Switch
                                id="notify-integrity"
                                checked={config?.notifications?.on_integrity_change || false}
                                onCheckedChange={(checked) => updateConfig('notifications', 'on_integrity_change', checked)}
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <div className="toggle-switch-label">
                            <Label htmlFor="notify-suspicious">{t('app.securityConfigTab.notifyOnSuspiciousActivity', 'Notify on suspicious activity')}</Label>
                            <Switch
                                id="notify-suspicious"
                                checked={config?.notifications?.on_suspicious_activity || false}
                                onCheckedChange={(checked) => updateConfig('notifications', 'on_suspicious_activity', checked)}
                            />
                        </div>
                    </div>
                </SharedCardContent>
            </SharedCard>

            <div className="form-actions">
                <Button variant="default" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Settings'}
                </Button>
            </div>
        </div>
    );
};

export default SecurityConfigTab;
