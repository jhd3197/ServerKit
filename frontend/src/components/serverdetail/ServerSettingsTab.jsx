import { TOKEN_EXPIRY_OPTIONS } from './serverDetailData';
import { useCallback, useState, useEffect  } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import CopyField from '@/components/CopyField';
import { InfoList, InfoItem } from '../InfoList';
import { DangerZone } from '../DangerZone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pill } from '../ds';
import Modal from '@/components/Modal';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import TagsPanel from '../shared/TagsPanel';
import { useTranslation } from 'react-i18next';
import {
    KeyIcon,
    ServerIcon,
    NetworkIcon,
    TrashIcon,
    TagIcon,
} from './serverDetailShared';
import { toastError } from '@/utils/errorMessage';

// Radix Select items cannot carry an empty value; this stands for "no group".
const NO_GROUP = '__none';

const AgentRegistrationSection = ({ server, onRegenerateToken }) => {
    const { t } = useTranslation();
    const expires = server.registration_expires;
    const isExpired = expires && new Date(expires) < new Date();
    const isOnline = server.status === 'online';

    return (
        <div className="form-section form-section--accent">
            <div className="form-section__header">
                <span className="form-section__icon"><KeyIcon /></span>
                <div>
                    <h3>{t('app.serverSettingsTab.connectionString', 'Connection string')}</h3>
                    <p className="section-description">
                        {t('app.serverSettingsTab.generateAFreshConnectionStringTo', 'Generate a fresh connection string to pair (or re-pair) this server. Useful after reinstalling the agent: old credentials are gone, but a new string brings the agent right back to this row.')}
                        {isOnline && ' This server is currently online; regenerating only affects re-pairing.'}
                        {isExpired && ' The previous token has expired.'}
                    </p>
                </div>
            </div>
            <Button onClick={onRegenerateToken}>
                <KeyIcon /> {t('app.serverSettingsTab.generateConnectionString', 'Generate connection string')}
            </Button>
        </div>
    );
};

const ServerSettingsTab = ({ server, onUpdate, onRegenerateToken, onDelete }) => {
    const { t } = useTranslation();
    const { confirm: confirmSettings } = useConfirm();
    const [formData, setFormData] = useState({
        name: server.name || '',
        description: server.description || '',
        hostname: server.hostname || '',
        ip_address: server.ip_address || '',
        group_id: server.group_id || ''
    });
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [allowedIPs, setAllowedIPs] = useState([]);
    const [newIP, setNewIP] = useState('');
    const [connectionInfo, setConnectionInfo] = useState(null);
    const [rotatingKey, setRotatingKey] = useState(false);
    const toast = useToast();

    const loadSecurityData = useCallback(async () => {
        try {
            const [ipsData, connData] = await Promise.all([
                api.getAllowedIPs(server.id),
                api.getConnectionInfo(server.id),
            ]);
            setAllowedIPs(ipsData.allowed_ips || []);
            setConnectionInfo(connData);
        } catch (err) {
            console.error('Failed to load security data:', err);
        }
    }, [server.id]);

    useEffect(() => {
        loadGroups();
        loadSecurityData();
    }, [loadSecurityData]);

    async function loadGroups() {
        try {
            const data = await api.getServerGroups();
            setGroups(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Failed to load groups:', err);
        }
    }


    async function handleAddIP() {
        if (!newIP.trim()) return;
        const updated = [...allowedIPs, newIP.trim()];
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            setNewIP('');
            toast.success(t('app.serverSettingsTab.ipAllowlistUpdated', 'IP allowlist updated'));
        } catch (err) {
            toastError(toast, t('app.serverSettingsTab.invalidIpPattern', 'Enter an IP address or CIDR range, like 192.168.1.0/24.'), err.details?.[0] || err);
        }
    }

    async function handleRemoveIP(ip) {
        const updated = allowedIPs.filter(i => i !== ip);
        try {
            await api.updateAllowedIPs(server.id, updated);
            setAllowedIPs(updated);
            toast.success(t('app.serverSettingsTab.ipRemovedFromAllowlist', 'IP removed from allowlist'));
        } catch (err) {
            toastError(toast, t('app.serverSettingsTab.failedToUpdateAllowlist', "Couldn't update the allowlist."), err);
        }
    }

    async function handleRotateKey() {
        const confirmed = await confirmSettings({ titleKey: 'app.serverSettingsTab.rotateCredentials', title: 'Rotate credentials', messageKey: 'app.serverSettingsTab.rotateApiCredentialsTheAgentMust', message: 'Rotate API credentials? The agent must be online to receive new credentials.', variant: 'warning' });
        if (!confirmed) return;
        setRotatingKey(true);
        try {
            const result = await api.rotateAPIKey(server.id);
            if (result.success) {
                toast.success(t('app.serverSettingsTab.credentialRotationInitiatedAgentWillUpdate', 'Credential rotation initiated. Agent will update shortly.'));
            } else {
                toastError(toast, t('app.serverSettingsTab.failedToRotateCredentials', "Couldn't rotate the credentials."), result.error);
            }
        } catch (err) {
            toastError(toast, t('app.serverSettingsTab.failedToRotateCredentials', "Couldn't rotate the credentials."), err);
        } finally {
            setRotatingKey(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);

        try {
            await api.updateServer(server.id, formData);
            toast.success(t('app.serverSettingsTab.serverUpdatedSuccessfully', 'Server updated'));
            onUpdate();
        } catch (err) {
            toastError(toast, t('app.serverSettingsTab.failedToUpdateServer', "Couldn't update the server."), err);
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    return (
        <div className="settings-tab">
            <div className="settings-grid">
                <form onSubmit={handleSubmit} className="settings-form">
                    <div className="form-section form-section--accent">
                        <div className="form-section__header">
                            <span className="form-section__icon"><ServerIcon /></span>
                            <div>
                                <h3>{t('app.serverSettingsTab.basicInformation', 'Basic information')}</h3>
                                <p className="section-description">{t('app.serverSettingsTab.identityAndGroupingForThisServer', 'Identity and grouping for this server.')}</p>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>{t('app.serverSettingsTab.serverName', 'Server name')}</label>
                            <Input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>{t('common.labels.description', 'Description')}</label>
                            <Textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                rows={3}
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>{t('app.serverSettingsTab.hostname', 'Hostname')}</label>
                                <Input
                                    type="text"
                                    name="hostname"
                                    value={formData.hostname}
                                    onChange={handleChange}
                                />
                            </div>
                            <div className="form-group">
                                <label>{t('common.labels.ipAddress', 'IP address')}</label>
                                <Input
                                    type="text"
                                    name="ip_address"
                                    value={formData.ip_address}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="server-settings-group">{t('app.serverSettingsTab.group', 'Group')}</label>
                            <Select
                                name="group_id"
                                value={formData.group_id === '' || formData.group_id == null ? NO_GROUP : String(formData.group_id)}
                                onValueChange={(value) => setFormData(prev => ({ ...prev, group_id: value === NO_GROUP ? '' : value }))}
                            >
                                <SelectTrigger id="server-settings-group"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={NO_GROUP}>{t('app.serverSettingsTab.noGroup', 'No group')}</SelectItem>
                                    {groups.map(group => (
                                        <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <Button type="submit" disabled={loading}>
                            {loading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>

                <AgentRegistrationSection
                    server={server}
                    onRegenerateToken={onRegenerateToken}
                />
            </div>

            <div className="security-grid">
                <div className="form-section form-section--accent">
                    <div className="form-section__header">
                        <span className="form-section__icon"><NetworkIcon /></span>
                        <div>
                            <h3>{t('app.serverSettingsTab.connectionIpAllowlist', 'Connection and IP allowlist')}</h3>
                            <p className="section-description">
                                {t('app.serverSettingsTab.restrictWhichIpsCanConnectSupports', 'Restrict which IPs can connect. Supports single IPs, CIDR notation, and wildcards.')}
                            </p>
                        </div>
                    </div>

                    {connectionInfo && (
                        <InfoList className="security-info-bar">
                            <InfoItem
                                label={t('app.serverSettingsTab.connectionIp', 'Connection IP')}
                                value={connectionInfo.ip_address || 'Not connected'}
                                mono
                            />
                            {connectionInfo.connected_since && (
                                <InfoItem
                                    label={t('app.serverSettingsTab.connectedSince', 'Connected since')}
                                    value={new Date(connectionInfo.connected_since).toLocaleString()}
                                />
                            )}
                        </InfoList>
                    )}

                    <div className="subsection">
                        <div className="ip-list">
                            {allowedIPs.length === 0 ? (
                                <div className="ip-empty">{t('app.serverSettingsTab.noIpRestrictionsAllIpsAllowed', 'No IP restrictions (all IPs allowed)')}</div>
                            ) : (
                                allowedIPs.map((ip, idx) => (
                                    <div key={idx} className="ip-item">
                                        <code>{ip}</code>
                                        {connectionInfo?.ip_address === ip && (
                                            <Pill kind="green" dot={false}>{t('common.labels.current', 'Current')}</Pill>
                                        )}
                                        <Button variant="unstyled" type="button"
                                            className="btn-icon danger"
                                            onClick={() => handleRemoveIP(ip)}
                                            title={t('common.actions.remove', 'Remove')}
                                        >
                                            <TrashIcon />
                                        </Button>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="ip-add-form">
                            <Input
                                type="text"
                                placeholder={t('app.serverSettingsTab.ipAddressOrCidrEG', 'IP address or CIDR (e.g. 192.168.1.0/24)')}
                                value={newIP}
                                onChange={(e) => setNewIP(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddIP())}
                            />
                            <Button variant="outline" onClick={handleAddIP}>
                                {t('common.actions.add', 'Add')}
                            </Button>
                        </div>

                        {connectionInfo?.ip_address && allowedIPs.length > 0 && !allowedIPs.some(ip => {
                            return ip === connectionInfo.ip_address || ip.includes('*') || ip.includes('/');
                        }) && (
                            <div className="security-warning">
                                {t('app.serverSettingsTab.currentConnectionIp', 'Current connection IP (')}{connectionInfo.ip_address}{t('app.serverSettingsTab.mayBeBlockedByTheseRules', ') may be blocked by these rules.')}
                            </div>
                        )}
                    </div>
                </div>

                <div className="form-section form-section--accent">
                    <div className="form-section__header">
                        <span className="form-section__icon"><KeyIcon /></span>
                        <div>
                            <h3>{t('app.serverSettingsTab.apiKeyRotation', 'API key rotation')}</h3>
                            <p className="section-description">
                                {t('app.serverSettingsTab.rotateTheApiCredentialsUsedBy', 'Rotate the API credentials used by the agent. The agent must be online to receive new credentials.')}
                            </p>
                        </div>
                    </div>
                    <div className="key-rotation-actions">
                        <Button
                            variant="outline"
                            onClick={handleRotateKey}
                            disabled={rotatingKey || server.status !== 'online'}
                        >
                            <KeyIcon /> {rotatingKey ? 'Rotating...' : 'Rotate API Key'}
                        </Button>
                        {server.api_key_last_rotated && (
                            <span className="key-rotation-hint">{t('app.serverSettingsTab.lastRotated', 'Last rotated:')} {new Date(server.api_key_last_rotated).toLocaleString()}</span>
                        )}
                    </div>

                    {server.status !== 'online' && (
                        <div className="security-notice">
                            {t('app.serverSettingsTab.serverMustBeOnlineToRotate', 'Server must be online to rotate credentials.')}
                        </div>
                    )}
                </div>
            </div>

            <div className="form-section form-section--accent shared-resources-section">
                <div className="form-section__header">
                    <span className="form-section__icon"><TagIcon /></span>
                    <div>
                        <h3>{t('app.serverSettingsTab.tags', 'Tags')}</h3>
                        <p className="section-description">
                            {t('app.serverSettingsTab.freeFormLabelsForGroupingAnd', 'Free-form labels for grouping and filtering this server across the panel.')}
                        </p>
                    </div>
                </div>
                <TagsPanel resourceType="server" resourceId={server.id} />
            </div>

            <DangerZone
                title={t('app.serverSettingsTab.dangerZone', 'Remove server')}
                description={t('app.serverSettingsTab.removingThisServerWillDisconnectThe', 'Removing this server will disconnect the agent and delete all associated data.')}
                action={
                    <Button variant="destructive" onClick={onDelete}>
                        <TrashIcon /> {t('app.serverSettingsTab.removeServer', 'Remove server')}
                    </Button>
                }
            />
        </div>
    );
};

export const TokenModal = ({ server, onClose, onGenerated }) => {
    const { t } = useTranslation();
    const toast = useToast();

    const [expiresIn, setExpiresIn] = useState(7 * 24 * 60 * 60);
    const [generating, setGenerating] = useState(false);
    // Result of the most recent generation in *this* modal session. We
    // don't fall back to server.connection_string because the panel only
    // ever returns the connection string at create/regenerate time — once
    // the modal closes, the value is gone, so showing a stale one would
    // be misleading.
    const [result, setResult] = useState(null);

    async function handleGenerate() {
        setGenerating(true);
        try {
            const data = await api.generateRegistrationToken(server.id, { expires_in: expiresIn });
            setResult(data);
            onGenerated?.(data);
            toast.success(t('app.serverSettingsTab.connectionStringGenerated', 'Connection string generated'));
        } catch (err) {
            toastError(toast, t('app.serverSettingsTab.failedToGenerateConnectionString', "Couldn't generate the connection string."), err);
        } finally {
            setGenerating(false);
        }
    }

    // Download-then-run, not `curl … | sudo bash`: a piped curl failure is
    // invisible (the pipeline reports bash's exit status, so a 404 still exits
    // 0 with nothing installed). See issue #101.
    const linuxScript = result ? `curl -fsSL ${window.location.origin}/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh && \\
  sudo bash /tmp/serverkit-agent-install.sh \\
  --server "${window.location.origin}" \\
  --token "${result.registration_token}"` : '';
    const windowsScript = result ? `irm ${window.location.origin}/api/v1/servers/install.ps1 | iex
Install-ServerKitAgent -Server "${window.location.origin}" -Token "${result.registration_token}"` : '';

    return (
        <Modal
            open
            onClose={onClose}
            title={t('app.serverSettingsTab.connectionString', 'Connection string')}
            size="lg"
            footer={!result ? (
                <>
                    <Button variant="outline" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button onClick={handleGenerate} disabled={generating}>
                        {generating ? 'Generating…' : 'Generate'}
                    </Button>
                </>
            ) : (
                <>
                    <Button variant="outline" onClick={() => setResult(null)}>
                        {t('app.serverSettingsTab.generateAnother', 'Generate another')}
                    </Button>
                    <Button onClick={onClose}>{t('common.actions.done', 'Done')}</Button>
                </>
            )}
        >
            {!result && (
                <p className="sk-modal__subtitle">
                    {t('app.serverSettingsTab.generateASinglePasteableStringThe', 'Generate a single pasteable string the agent can consume. The token inside is single-use and burns the moment any agent registers with it.')}
                </p>
            )}

            {!result ? (
                <>
                        <div className="space-y-2">
                            <Label htmlFor="token-expires">{t('app.serverSettingsTab.tokenExpires', 'Token expires')}</Label>
                            <Select value={String(expiresIn)} onValueChange={(v) => setExpiresIn(Number(v))}>
                                <SelectTrigger id="token-expires">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TOKEN_EXPIRY_OPTIONS.map(opt => (
                                        <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="token-status">
                            <span className="token-status-dot active" />
                            <span>
                                {t('app.serverSettingsTab.activeExpires', 'Active, expires')} {new Date(result.registration_expires).toLocaleString()}
                            </span>
                        </div>

                        <div className="server-connection-string">
                            <CopyField
                                label={t('app.serverSettingsTab.connectionString3', 'Connection string')}
                                value={result.connection_string}
                                multiline
                            />
                        </div>

                        <details className="install-fallback">
                            <summary>{t('app.serverSettingsTab.needToInstallTheAgentFirst', 'Need to install the agent first? Use the one-liner installer.')}</summary>
                            <div className="install-tabs install-tabs--after-summary">
                                <CopyField
                                    label={`${t('app.serverSettingsTab.linux', 'Linux')} · ${t('app.serverSettingsTab.curlTarSudoAndSystemd', 'curl, tar, sudo, and systemd')}`}
                                    value={linuxScript}
                                    multiline
                                />
                                <CopyField
                                    label={`${t('app.serverSettingsTab.windowsPowershell', 'Windows (PowerShell)')} · ${t('app.serverSettingsTab.runAsAdministrator', 'Run as administrator')}`}
                                    value={windowsScript}
                                    multiline
                                />
                            </div>
                        </details>
                    </>
                )}
        </Modal>
    );
};

export default ServerSettingsTab;
