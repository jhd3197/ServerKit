import { useState, useEffect, useCallback } from 'react';
import { statusKind } from '@/components/ds/status';
import { RefreshCw, ArrowUpCircle, Moon, Sun, Boxes } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Pill } from '../ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { InfoList, InfoItem } from '../InfoList';
import { useTranslation } from 'react-i18next';

// Short SHA helper for image digests (handles "sha256:abcdef..." or bare hashes)
function shortDigest(digest) {
    if (!digest) return '—';
    const value = String(digest).includes(':') ? String(digest).split(':').pop() : String(digest);
    return value.slice(0, 12);
}


// Radix Select items cannot carry an empty value; this stands for "no registry".
const NO_REGISTRY = '__none';

function formatStatusLabel(status) {
    if (!status) return 'Not checked';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================
// Image update section
// ============================================================
const ImageUpdateSection = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [info, setInfo] = useState(app.image_update || null);
    const [checking, setChecking] = useState(false);
    const [applying, setApplying] = useState(false);

    const isCompose = app.app_type === 'docker';

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await api.getImageUpdate(app.id);
                if (active && data) setInfo(data);
            } catch {
                /* no prior check is fine — fall back to the badge on app */
            }
        })();
        return () => { active = false; };
    }, [app.id]);

    async function handleCheck() {
        setChecking(true);
        try {
            const data = await api.checkImageUpdate(app.id);
            setInfo(data);
            if (data.update_available) {
                toast.info(t('app.containerOpsPanel.anImageUpdateIsAvailable', 'An image update is available'));
            } else {
                toast.success(t('app.containerOpsPanel.imageIsUpToDate', 'Image is up to date'));
            }
            onChanged?.();
        } catch (err) {
            toast.error(err.message || t('app.containerOpsPanel.failedToCheckForUpdates', 'Failed to check for updates'));
        } finally {
            setChecking(false);
        }
    }

    async function handleApply() {
        const confirmed = await confirm({
            title: t('app.containerOpsPanel.updateImage', 'Update image'),
            message: t('app.containerOpsPanel.pullTheLatestImageAndRecreate', 'Pull the latest image and recreate the container? The app will briefly restart.'),
            confirmText: t('app.containerOpsPanel.updateNow', 'Update now'),
        });
        if (!confirmed) return;

        setApplying(true);
        try {
            const data = await api.applyImageUpdate(app.id);
            toast.success(data.message || t('app.containerOpsPanel.imageUpdated', 'Image updated'));
            onChanged?.();
            // Refresh the local check after applying
            try {
                const refreshed = await api.getImageUpdate(app.id);
                if (refreshed) setInfo(refreshed);
            } catch { /* optional */ }
        } catch (err) {
            toast.error(err.message || t('app.containerOpsPanel.failedToApplyUpdate', 'Failed to apply update'));
        } finally {
            setApplying(false);
        }
    }

    const status = info?.status;
    const updateAvailable = info?.update_available;
    const checkedAt = info?.checked_at;

    return (
        <div className="app-panel container-ops__section">
            <div className="app-panel-header">
                <RefreshCw />
                <span>{t('app.containerOpsPanel.imageUpdate', 'Image update')}</span>
                <span className="app-panel-header-actions">
                    {status && (
                        <Pill kind={statusKind(status)}>
                            {formatStatusLabel(status)}
                        </Pill>
                    )}
                </span>
            </div>
            <div className="app-panel-body">
                {!isCompose && (
                    <p className="app-panel-hint">
                        {t('app.containerOpsPanel.imageUpdatesApplyToDockerCompose', 'Image updates apply to Docker Compose apps. You can still check this app\'s digest, but "Update now" is only available for docker-compose apps.')}
                    </p>
                )}

                <InfoList className="container-ops__digests">
                    <InfoItem label={t('app.containerOpsPanel.currentDigest', 'Current digest')} value={shortDigest(info?.current_digest)} mono />
                    <InfoItem label={t('app.containerOpsPanel.latestDigest', 'Latest digest')} value={shortDigest(info?.latest_digest)} mono />
                    <InfoItem
                        label={t('app.containerOpsPanel.lastChecked', 'Last checked')}
                        value={checkedAt ? new Date(checkedAt).toLocaleString() : 'Never'}
                    />
                </InfoList>

                <div className="app-detail-actions container-ops__actions">
                    <Button variant="outline" size="sm" onClick={handleCheck} disabled={checking}>
                        {checking ? 'Checking…' : 'Check for update'}
                    </Button>
                    {updateAvailable && isCompose && (
                        <Button size="sm" onClick={handleApply} disabled={applying}>
                            <ArrowUpCircle size={15} />
                            {applying ? 'Updating…' : 'Update now'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Private registry section — which stored registry credentials to
// authenticate with before pulling this app's image (docker login).
// ============================================================
const RegistrySection = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [registries, setRegistries] = useState([]);
    const [selected, setSelected] = useState(app.registry_id ?? '');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => { setSelected(app.registry_id ?? ''); }, [app.registry_id]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const data = await api.getContainerRegistries();
                if (active) setRegistries(data?.registries || []);
            } catch {
                /* listing failing just means no picker options */
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    async function handleChange(value) {
        const next = value === '' ? null : Number(value);
        setSelected(value);
        setSaving(true);
        try {
            await api.updateApp(app.id, { registry_id: next });
            toast.success(next ? t('app.containerOpsPanel.registryAttached', 'Registry attached') : t('app.containerOpsPanel.registryDetachedPullsAreAnonymous', 'Registry detached. Pulls are anonymous.'));
            onChanged?.();
        } catch (err) {
            toast.error(err.message || t('app.containerOpsPanel.failedToUpdateRegistry', 'Failed to update registry'));
            setSelected(app.registry_id ?? '');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="app-panel container-ops__section">
            <div className="app-panel-header">
                <Boxes />
                <span>{t('app.containerOpsPanel.privateRegistry', 'Private registry')}</span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.containerOpsPanel.authenticateWithStoredCredentialsBeforePulling', 'Authenticate with stored credentials before pulling this app\'s image. Add registries under')} <Link to="/settings/connections">{t('app.containerOpsPanel.settingsConnections', 'Settings → Connections')}</Link>.
                </p>

                <div className="container-ops__field">
                    <div className="container-ops__field-text">
                        <Label htmlFor={`registry-${app.id}`}>{t('app.containerOpsPanel.registry', 'Registry')}</Label>
                        <span className="container-ops__field-hint">
                            {t('app.containerOpsPanel.publicImagesPullAnonymouslyPickA', 'Public images pull anonymously; pick a registry for private images.')}
                        </span>
                    </div>
                    <Select
                        value={selected === '' || selected == null ? NO_REGISTRY : String(selected)}
                        onValueChange={(value) => handleChange(value === NO_REGISTRY ? '' : value)}
                        disabled={loading || saving}
                    >
                        <SelectTrigger id={`registry-${app.id}`} className="container-ops__select">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_REGISTRY}>{t('app.containerOpsPanel.publicNoAuth', 'Public (no auth)')}</SelectItem>
                            {registries.map((r) => (
                                <SelectItem key={r.id} value={String(r.id)}>
                                    {r.name} · {r.login_host}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Auto-sleep section
// ============================================================
const AutoSleepSection = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [policy, setPolicy] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [idleTimeout, setIdleTimeout] = useState(30);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getSleepPolicy(app.id);
            setPolicy(data);
            if (data?.idle_timeout_minutes != null) {
                setIdleTimeout(data.idle_timeout_minutes);
            }
        } catch (err) {
            console.error('Failed to load sleep policy:', err);
        } finally {
            setLoading(false);
        }
    }, [app.id]);

    useEffect(() => { load(); }, [load]);

    async function savePolicy(next) {
        setSaving(true);
        try {
            const data = await api.updateSleepPolicy(app.id, next);
            setPolicy((prev) => ({ ...prev, ...(data || next) }));
            toast.success(t('app.containerOpsPanel.autoSleepPolicySaved', 'Auto-sleep policy saved'));
            onChanged?.();
        } catch (err) {
            toast.error(err.message || t('app.containerOpsPanel.failedToSavePolicy', 'Failed to save policy'));
            load();
        } finally {
            setSaving(false);
        }
    }

    function handleToggle(enabled) {
        setPolicy((prev) => ({ ...prev, enabled }));
        savePolicy({ enabled, idle_timeout_minutes: idleTimeout });
    }

    function handleTimeoutCommit() {
        const value = Math.max(1, parseInt(idleTimeout, 10) || 1);
        setIdleTimeout(value);
        if (value !== policy?.idle_timeout_minutes) {
            savePolicy({ enabled: policy?.enabled ?? false, idle_timeout_minutes: value });
        }
    }

    async function handleSleepWake() {
        setBusy(true);
        try {
            if (policy?.asleep) {
                await api.wakeApp(app.id);
                toast.success(t('app.containerOpsPanel.appWoken', 'App woken'));
            } else {
                await api.sleepApp(app.id);
                toast.success(t('app.containerOpsPanel.appPutToSleep', 'App put to sleep'));
            }
            await load();
            onChanged?.();
        } catch (err) {
            toast.error(err.message || t('app.containerOpsPanel.actionFailed', 'Action failed'));
        } finally {
            setBusy(false);
        }
    }

    const asleep = policy?.asleep;

    return (
        <div className="app-panel container-ops__section">
            <div className="app-panel-header">
                <Moon />
                <span>{t('app.containerOpsPanel.autoSleep', 'Auto-sleep')}</span>
                <span className="app-panel-header-actions">
                    {!loading && (
                        <Pill kind={asleep ? 'gray' : 'green'}>{asleep ? 'Asleep' : 'Awake'}</Pill>
                    )}
                </span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.containerOpsPanel.stopTheContainerAfterAPeriod', 'Stop the container after a period of inactivity to free resources. It wakes automatically on the next request.')}
                </p>

                <div className="container-ops__field">
                    <div className="container-ops__field-text">
                        <Label htmlFor={`sleep-enabled-${app.id}`}>{t('app.containerOpsPanel.enableAutoSleep', 'Enable auto-sleep')}</Label>
                        <span className="container-ops__field-hint">
                            {t('app.containerOpsPanel.idleAppsAreSuspendedAfterThe', 'Idle apps are suspended after the timeout below.')}
                        </span>
                    </div>
                    <Switch
                        id={`sleep-enabled-${app.id}`}
                        checked={!!policy?.enabled}
                        onCheckedChange={handleToggle}
                        disabled={loading || saving}
                    />
                </div>

                <div className="container-ops__field">
                    <div className="container-ops__field-text">
                        <Label htmlFor={`sleep-timeout-${app.id}`}>{t('app.containerOpsPanel.idleTimeoutMinutes', 'Idle timeout (minutes)')}</Label>
                        <span className="container-ops__field-hint">
                            {policy?.last_activity_at
                                ? `Last activity ${new Date(policy.last_activity_at).toLocaleString()}`
                                : 'No recorded activity yet.'}
                        </span>
                    </div>
                    <Input
                        id={`sleep-timeout-${app.id}`}
                        type="number"
                        min={1}
                        className="container-ops__num"
                        value={idleTimeout}
                        onChange={(e) => setIdleTimeout(e.target.value)}
                        onBlur={handleTimeoutCommit}
                        disabled={loading || saving}
                    />
                </div>

                <div className="app-detail-actions container-ops__actions">
                    <Button variant="outline" size="sm" onClick={handleSleepWake} disabled={busy || loading}>
                        {asleep ? <Sun size={15} /> : <Moon size={15} />}
                        {busy ? 'Working…' : asleep ? 'Wake now' : 'Sleep now'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Panel shell
// ============================================================
const ContainerOpsPanel = ({ app, onChanged }) => {
    if (!app) return null;

    return (
        <div className="container-ops">
            <ImageUpdateSection app={app} onChanged={onChanged} />
            <RegistrySection app={app} onChanged={onChanged} />
            <AutoSleepSection app={app} onChanged={onChanged} />
        </div>
    );
};

export default ContainerOpsPanel;
