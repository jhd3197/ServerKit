import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import { useTheme } from '../../contexts/useTheme.js';
import api from '../../services/api';
import useSettingFocus from '../../hooks/useSettingFocus';
import { InfoList, InfoItem } from '../InfoList';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { formatBytes } from '@/utils/formatBytes';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';

function formatUptime(seconds) {
    if (!seconds) return '-';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    return parts.join(' ') || '< 1m';
}

const SystemTab = () => {
    const { t } = useTranslation();
    const register = useSettingFocus();
    const { isAdmin } = useAuth();
    const { whiteLabel } = useTheme();
    const brand = whiteLabel?.enabled && whiteLabel?.brandName ? whiteLabel.brandName : 'ServerKit';
    const [metrics, setMetrics] = useState(null);
    const [version, setVersion] = useState('');
    const [loading, setLoading] = useState(true);
    const [timezones, setTimezones] = useState([]);
    const [selectedTimezone, setSelectedTimezone] = useState('');
    const [savingTimezone, setSavingTimezone] = useState(false);
    const [timezoneMessage, setTimezoneMessage] = useState(null);

    const [domainLoading, setDomainLoading] = useState(false);
    const [detectedDomain, setDetectedDomain] = useState(null);
    const [canonicalDomain, setCanonicalDomain] = useState('');
    const [canonicalHttps, setCanonicalHttps] = useState(false);
    const [encryptionConfigured, setEncryptionConfigured] = useState(true);
    const [savingDomain, setSavingDomain] = useState(false);
    const [domainMessage, setDomainMessage] = useState(null);

    useEffect(() => {
        if (isAdmin) {
            loadMetrics();
            loadTimezones();
            loadDomainInfo();
            api.getVersion().then(d => setVersion(d.version || '')).catch(() => {});
        }
    }, [isAdmin]);

    async function loadMetrics() {
        try {
            const data = await api.getSystemMetrics();
            setMetrics(data);
            if (data?.time?.timezone_id) {
                setSelectedTimezone(data.time.timezone_id);
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadTimezones() {
        try {
            const data = await api.getTimezones();
            setTimezones(data.timezones || []);
        } catch (err) {
            console.error('Failed to load timezones:', err);
        }
    }

    async function loadDomainInfo() {
        setDomainLoading(true);
        try {
            const [detection, health] = await Promise.all([
                api.getDomainDetection(),
                api.healthCheck()
            ]);
            setDetectedDomain(detection);
            setCanonicalDomain(detection.current_canonical_domain || '');
            setCanonicalHttps(detection.current_canonical_https_enabled || false);
            setEncryptionConfigured(health.encryption_configured !== false);
        } catch (err) {
            console.error('Failed to load domain info:', err);
        } finally {
            setDomainLoading(false);
        }
    }

    async function handleSaveCanonicalDomain() {
        setSavingDomain(true);
        setDomainMessage(null);
        try {
            const result = await api.setCanonicalDomain(canonicalDomain, canonicalHttps);
            setDomainMessage({
                type: 'success',
                text: `${result.message}. Restart the ServerKit backend service for CORS changes to take full effect.`
            });
            loadDomainInfo();
        } catch (err) {
            setDomainMessage({ type: 'error', text: err.message || 'Failed to save canonical domain' });
        } finally {
            setSavingDomain(false);
            setTimeout(() => setDomainMessage(null), 8000);
        }
    }

    async function handleUseDetectedDomain() {
        if (!detectedDomain?.detected_domain) return;
        setCanonicalDomain(detectedDomain.detected_domain);
        setCanonicalHttps(detectedDomain.is_https);
    }

    async function handleTimezoneChange() {
        if (!selectedTimezone) return;

        setSavingTimezone(true);
        setTimezoneMessage(null);

        try {
            const result = await api.setTimezone(selectedTimezone);
            setTimezoneMessage({ type: 'success', text: result.message || 'Timezone updated' });
            // Refresh metrics to show new time
            loadMetrics();
        } catch (err) {
            setTimezoneMessage({ type: 'error', text: err.message || 'Failed to set timezone' });
        } finally {
            setSavingTimezone(false);
            setTimeout(() => setTimezoneMessage(null), 5000);
        }
    }

    if (!isAdmin) {
        return (
            <div className="settings-section">
                <div className="section-header">
                    <h2>{t('app.systemTab.systemInformation', 'System Information')}</h2>
                </div>
                <div className="alert alert-warning">
                    {t('app.systemTab.adminAccessRequiredToViewSystem', 'Admin access required to view system information.')}
                </div>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title={t('app.systemTab.loadingSystemInformation', 'Loading system information…')} />;
    }

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.systemTab.systemInformation', 'System Information')}</h2>
            </div>

            <div className="system-info-grid">
                <div {...register('system-cpu', 'settings-card')}>
                    <h3>CPU</h3>
                    <InfoList>
                        <InfoItem label={t('app.systemTab.usage', 'Usage')} value={`${metrics?.cpu?.percent?.toFixed(1) || 0}%`} />
                        <InfoItem label={t('app.systemTab.cores', 'Cores')} value={metrics?.cpu?.count || '-'} />
                        <InfoItem
                            label={t('app.systemTab.loadAverage', 'Load Average')}
                            value={metrics?.cpu?.load_avg ? metrics.cpu.load_avg.map(l => l.toFixed(2)).join(', ') : '-'}
                        />
                    </InfoList>
                </div>

                <div {...register('system-memory', 'settings-card')}>
                    <h3>{t('common.labels.memory', 'Memory')}</h3>
                    <InfoList>
                        <InfoItem label={t('app.systemTab.usage', 'Usage')} value={`${metrics?.memory?.percent?.toFixed(1) || 0}%`} />
                        <InfoItem label={t('app.systemTab.used', 'Used')} value={formatBytes(metrics?.memory?.used)} />
                        <InfoItem label={t('app.systemTab.total', 'Total')} value={formatBytes(metrics?.memory?.total)} />
                    </InfoList>
                </div>

                <div {...register('system-disk', 'settings-card')}>
                    <h3>{t('common.labels.disk', 'Disk')}</h3>
                    <InfoList>
                        <InfoItem label={t('app.systemTab.usage', 'Usage')} value={`${metrics?.disk?.percent?.toFixed(1) || 0}%`} />
                        <InfoItem label={t('app.systemTab.used', 'Used')} value={formatBytes(metrics?.disk?.used)} />
                        <InfoItem label={t('app.systemTab.total', 'Total')} value={formatBytes(metrics?.disk?.total)} />
                    </InfoList>
                </div>

                <div {...register('system-network', 'settings-card')}>
                    <h3>{t('app.systemTab.network', 'Network')}</h3>
                    <InfoList>
                        <InfoItem label={t('app.systemTab.bytesSent', 'Bytes Sent')} value={formatBytes(metrics?.network?.bytes_sent)} />
                        <InfoItem label={t('app.systemTab.bytesReceived', 'Bytes Received')} value={formatBytes(metrics?.network?.bytes_recv)} />
                    </InfoList>
                </div>
            </div>

            {(metrics?.system || version) && (
                <div className="settings-card">
                    <h3>{t('app.systemTab.systemDetails', 'System Details')}</h3>
                    <InfoList>
                        <InfoItem label={t('app.systemTab.version', '{{brand}} Version', { brand: brand })} value={version || '-'} />
                        {metrics?.system && (
                            <>
                                <InfoItem label={t('app.systemTab.hostname', 'Hostname')} value={metrics.system.hostname || '-'} />
                                <InfoItem label={t('app.systemTab.platform', 'Platform')} value={metrics.system.platform || '-'} />
                                <InfoItem label={t('app.systemTab.osVersion', 'OS Version')} value={metrics.system.version || '-'} />
                                <InfoItem label={t('common.labels.uptime', 'Uptime')} value={formatUptime(metrics.system.uptime)} />
                            </>
                        )}
                    </InfoList>
                </div>
            )}

            {/* Server Time & Timezone */}
            <div {...register('system-timezone', 'settings-card')}>
                <h3>{t('app.systemTab.serverTimeTimezone', 'Server Time & Timezone')}</h3>
                {metrics?.time && (
                    <InfoList className="info-list--spaced">
                        <InfoItem label={t('app.systemTab.currentTime', 'Current Time')} value={metrics.time.current_time_formatted} />
                        <InfoItem label={t('app.systemTab.utcOffset', 'UTC Offset')} value={metrics.time.utc_offset} />
                        <InfoItem label={t('app.systemTab.currentTimezone', 'Current Timezone')} value={metrics.time.timezone_id || metrics.time.timezone_name} />
                    </InfoList>
                )}
                <div className="form-group">
                    <label>{t('app.systemTab.changeTimezone', 'Change Timezone')}</label>
                    <div className="timezone-selector">
                        <Select
                            value={selectedTimezone || '__none__'}
                            onValueChange={(val) => setSelectedTimezone(val === '__none__' ? '' : val)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('app.systemTab.selectTimezone', 'Select timezone…')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">{t('app.systemTab.selectTimezone', 'Select timezone…')}</SelectItem>
                                {timezones.map((tz) => (
                                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            variant="default"
                            onClick={handleTimezoneChange}
                            disabled={savingTimezone || !selectedTimezone || selectedTimezone === metrics?.time?.timezone_id}
                        >
                            {savingTimezone ? 'Saving...' : 'Apply'}
                        </Button>
                    </div>
                    {timezoneMessage && (
                        <div className={`timezone-message ${timezoneMessage.type}`}>
                            {timezoneMessage.text}
                        </div>
                    )}
                    <span className="form-help">
                        {t('app.systemTab.changingTimezoneRequiresServerRestartTo', 'Changing timezone requires server restart to take full effect')}
                    </span>
                </div>
            </div>

            {/* Panel Domain */}
            <div {...register('system-canonical-domain', 'settings-card')}>
                <h3>{t('app.systemTab.panelDomain', 'Panel Domain')}</h3>
                {!encryptionConfigured && (
                    <div className="alert alert-warning settings-alert-spaced">
                        <strong>{t('app.systemTab.encryptionKeyNotConfigured', 'Encryption key not configured.')}</strong> {t('app.systemTab.agentPairingAndSecretEncryptionWill', 'Agent pairing and secret encryption will fail until SERVERKIT_ENCRYPTION_KEY is set in your .env file.')}
                    </div>
                )}
                {domainLoading ? (
                    <EmptyState loading title={t('app.systemTab.loadingDomainSettings', 'Loading domain settings…')} />
                ) : (
                    <>
                        {detectedDomain?.detected_domain && (
                            <div className="form-group">
                                <label>{t('app.systemTab.detectedDomain', 'Detected Domain')}</label>
                                <div className="form-row system-domain-row">
                                    <code>
                                        {detectedDomain.is_https ? 'https' : 'http'}://{detectedDomain.detected_domain}
                                    </code>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleUseDetectedDomain}
                                        disabled={savingDomain}
                                    >
                                        {t('app.systemTab.useThisDomain', 'Use this domain')}
                                    </Button>
                                </div>
                                <span className="form-help">
                                    {t('app.systemTab.detectedFromTheHostHeaderOf', 'Detected from the Host header of your current request')}
                                </span>
                            </div>
                        )}
                        {detectedDomain?.current_canonical_domain && (
                            <div className="form-group">
                                <label>{t('app.systemTab.currentCanonicalDomain', 'Current Canonical Domain')}</label>
                                <div>
                                    <code>{detectedDomain.current_canonical_origin || '-'}</code>
                                </div>
                            </div>
                        )}
                        <div className="form-group">
                            <label htmlFor="canonical-domain">{t('app.systemTab.canonicalDomain', 'Canonical Domain')}</label>
                            <Input
                                id="canonical-domain"
                                value={canonicalDomain}
                                onChange={(e) => setCanonicalDomain(e.target.value)}
                                placeholder={t('app.systemTab.eGServerkitExampleCom', 'e.g. serverkit.example.com')}
                                disabled={savingDomain}
                            />
                            <span className="form-help">
                                {t('app.systemTab.theDomainYouPointAtThis', 'The domain you point at this ServerKit panel. Used for CORS and agent install commands.')}
                            </span>
                        </div>
                        <div className="form-group system-switch-row">
                            <Switch
                                id="canonical-https"
                                checked={canonicalHttps}
                                onCheckedChange={setCanonicalHttps}
                                disabled={savingDomain}
                            />
                            <label htmlFor="canonical-https">
                                {t('app.systemTab.httpsEnabledForCanonicalDomain', 'HTTPS enabled for canonical domain')}
                            </label>
                        </div>
                        <Button
                            variant="default"
                            onClick={handleSaveCanonicalDomain}
                            disabled={savingDomain || !canonicalDomain}
                        >
                            {savingDomain ? 'Saving...' : 'Save Canonical Domain'}
                        </Button>
                        {domainMessage && (
                            <div className={`timezone-message timezone-message--save-result ${domainMessage.type}`}>
                                {domainMessage.text}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default SystemTab;
