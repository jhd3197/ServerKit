import { useState, useEffect, useCallback } from 'react';
import {
    GitPullRequest, ExternalLink, RefreshCw, Trash2, RotateCcw,
} from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
import PreviewCreateForm from './PreviewCreateForm';
import { Pill, serviceStatusKind } from '../ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';
import InfoTip from '@/components/InfoTip';

const DEFAULT_TEMPLATE = 'pr-{pr_number}.{app_domain}';

const PreviewList = ({ appId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [previews, setPreviews] = useState([]);
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [creating, setCreating] = useState(false);
    const [template, setTemplate] = useState(DEFAULT_TEMPLATE);

    const load = useCallback(async () => {
        try {
            const [list, conf] = await Promise.all([
                api.getPreviews(appId),
                api.getPreviewSettings(appId),
            ]);
            setPreviews(list?.previews || []);
            setSettings(conf || null);
            setTemplate(conf?.domain_template || DEFAULT_TEMPLATE);
        } catch (err) {
            console.error('Failed to load previews:', err);
            toastError(toast, t('app.previewList.couldNotLoadPrPreviews', "Couldn't load PR previews."), err);
        } finally {
            setLoading(false);
        }
    }, [appId, t, toast]);

    useEffect(() => { load(); }, [load]);

    async function saveSettings(patch) {
        setSaving(true);
        try {
            const updated = await api.updatePreviewSettings(appId, patch);
            setSettings(updated);
            setTemplate(updated?.domain_template || DEFAULT_TEMPLATE);
            toast?.success?.(t('app.previewList.previewSettingsSaved', 'Preview settings saved'));
        } catch (err) {
            console.error('Failed to save preview settings:', err);
            toastError(toast, t('app.previewList.couldNotSaveSettings', "Couldn't save the settings."), err);
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(enabled) {
        await saveSettings({ enabled });
    }

    async function handleSaveTemplate() {
        await saveSettings({ domain_template: template || DEFAULT_TEMPLATE });
    }

    async function handleSync() {
        setSyncing(true);
        try {
            await api.syncPreviews(appId);
            toast?.success?.(t('app.previewList.reconciledPreviewsAgainstOpenPrs', 'Reconciled previews against open PRs'));
            await load();
        } catch (err) {
            toastError(toast, t('app.previewList.syncFailed', "Couldn't sync previews."), err);
        } finally {
            setSyncing(false);
        }
    }

    async function handleRedeploy(preview) {
        setBusyId(preview.id);
        try {
            const result = await api.redeployPreview(appId, preview.id);
            if (result.status === 'unavailable' || result.status === 'failed') {
                toastError(toast, t('app.previewList.previewNotDeployed', 'The preview was not deployed. Review its status below.'));
            } else {
                toast?.success?.(t('app.previewList.redeployingPreviewForPr', 'Redeploying preview for PR #{{prnumber}}', { prnumber: preview.pr_number }));
            }
            await load();
        } catch (err) {
            toastError(toast, t('app.previewList.redeployFailed', "Couldn't redeploy the preview."), err);
        } finally {
            setBusyId(null);
        }
    }

    async function handleCreate(pr) {
        setCreating(true);
        try {
            await api.createPreview(appId, pr);
            toast?.success?.(t('app.previewList.queued', 'Preview deployment queued. Refresh for status; execution details are in Jobs.'));
            await load();
        } catch (err) {
            toastError(toast, t('app.previewList.createFailed', 'Could not queue the preview.'), err);
        } finally {
            setCreating(false);
        }
    }

    async function handleDestroy(preview) {
        const ok = await confirm({
            title: t('app.previewList.destroyPreview', 'Delete preview'),
            message: t('app.previewList.tearDownThePreviewEnvironmentFor', 'Tear down the preview environment for PR #{{prnumber}}? This removes its temporary domain and resources.', { prnumber: preview.pr_number }),
            confirmText: t('app.previewList.destroy', 'Delete'),
            variant: 'danger',
        });
        if (!ok) return;
        setBusyId(preview.id);
        try {
            const result = await api.destroyPreview(appId, preview.id);
            toast?.success?.(result.status === 'queued'
                ? t('app.previewList.deletionQueued', 'Preview deletion queued. Refresh for status.')
                : t('app.previewList.previewForPrDestroyed', 'Preview for PR #{{prnumber}} deleted', { prnumber: preview.pr_number }));
            await load();
        } catch (err) {
            toastError(toast, t('app.previewList.destroyFailed', "Couldn't delete the preview."), err);
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return <EmptyState loading loadingVariant="cards" title={t('app.previewList.loadingPreviews', 'Loading previews…')} />;
    }

    const enabled = !!settings?.enabled;

    return (
        <div className="preview-list">
            {/* Enable / configure card */}
            <div className="preview-settings">
                <div className="preview-settings__header">
                    <div className="preview-settings__title">
                        <GitPullRequest size={18} />
                        <div>
                            <h3>{t('app.previewList.prPreviewEnvironments', 'PR preview environments')}</h3>
                            <p className="preview-settings__hint">
                                {t('app.previewList.genericSupportShort', 'Git-backed Dockerfile and buildpack apps.')} <InfoTip>{t('app.previewList.genericSupport', 'Generic previews support local Git-backed Dockerfile and container-buildpack apps with nginx. Compose, remote targets and host-command builds are not supported. Configure preview DNS to point at this server.')}</InfoTip>
                            </p>
                        </div>
                    </div>
                    <div className="preview-settings__toggle">
                        <Label htmlFor="preview-enabled">{enabled ? t('app.previewList.enabled', 'Enabled') : t('app.previewList.disabled', 'Disabled')}</Label>
                        <Switch
                            id="preview-enabled"
                            checked={enabled}
                            disabled={saving}
                            onCheckedChange={handleToggle}
                        />
                    </div>
                </div>

                {enabled && (
                    <div className="preview-settings__template">
                        <Label htmlFor="preview-template">{t('app.previewList.domainTemplate', 'Domain template')}</Label>
                        <div className="preview-settings__template-row">
                            <Input
                                id="preview-template"
                                value={template}
                                onChange={(e) => setTemplate(e.target.value)}
                                placeholder={DEFAULT_TEMPLATE}
                                spellCheck={false}
                            />
                            <Button
                                variant="outline"
                                onClick={handleSaveTemplate}
                                disabled={saving || template === settings?.domain_template}
                            >
                                {t('common.actions.save', 'Save')}
                            </Button>
                        </div>
                        <p className="preview-settings__hint">
                            {t('app.previewList.placeholders', 'Placeholders:')} <code>{'{pr_number}'}</code>, <code>{'{branch}'}</code>,{' '}
                            <code>{'{app_domain}'}</code>.
                        </p>
                    </div>
                )}
            </div>

            {enabled && <>
                <div className="preview-settings__toggle">
                    <Label htmlFor="preview-inherit">{t('app.previewList.inheritEnv', 'Inherit application environment (may grant access to production databases and services)')}</Label>
                    <Switch id="preview-inherit" checked={!!settings?.inherit_environment} disabled={saving}
                        onCheckedChange={inherit_environment => saveSettings({ inherit_environment })} />
                </div>
                <PreviewCreateForm onCreate={handleCreate} busy={creating} />
            </>}

            {/* Active previews */}
            <div className="preview-list__toolbar">
                <h4>{t('app.previewList.activePreviews', 'Active previews')}</h4>
                <Button variant="ghost" onClick={load}>{t('app.previewList.refresh', 'Refresh status')}</Button>
                <Button variant="ghost" onClick={handleSync} disabled={syncing}>
                    <RefreshCw size={15} className={syncing ? 'spin' : undefined} />
                    {t('app.previewList.syncWithOpenPrs', 'Sync with open PRs')}
                </Button>
            </div>

            {previews.length === 0 ? (
                <EmptyState
                    icon={GitPullRequest}
                    title={t('app.previewList.noActivePreviews', 'No active previews')}
                    description={
                        enabled
                            ? t('app.previewList.createOrWebhook', 'Deploy a pinned branch above, or connect a signed PR webhook to this application.')
                            : t('app.previewList.enablePrPreviewsAboveToStart', 'Enable PR previews above to start deploying preview environments.')
                    }
                />
            ) : (
                <ul className="preview-list__items">
                    {previews.map((p) => (
                        <li key={p.id} className="preview-item">
                            <div className="preview-item__main">
                                <div className="preview-item__title">
                                    <span className="preview-item__pr">{t('app.previewList.pr', 'PR #')}{p.pr_number}</span>
                                    <span className="preview-item__name">{p.pr_title || '(untitled)'}</span>
                                    <Pill kind={serviceStatusKind(p.status)}>{p.status}</Pill>
                                </div>
                                <div className="preview-item__meta">
                                    {p.branch && <span className="preview-item__branch mono">{p.branch}</span>}
                                    {p.short_sha && <span className="preview-item__sha mono">{p.short_sha}</span>}
                                    {p.url && p.status === 'running' && (
                                        <a
                                            className="preview-item__url"
                                            href={p.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {p.domain}
                                        </a>
                                    )}
                                </div>
                                {p.status_reason && p.status !== 'running' && <p className="preview-settings__hint">{p.status_reason}</p>}
                                {p.status === 'unavailable' && !p.status_reason && (
                                    <p className="preview-settings__hint">
                                        {t('app.previewList.noRuntime', 'No provisioned runtime is recorded for this preview. Its URL is unavailable.')}
                                    </p>
                                )}
                            </div>
                            <div className="preview-item__actions">
                                {p.url && p.status === 'running' && (
                                    <Button variant="ghost" size="sm" asChild>
                                        <a href={p.url} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink size={15} />
                                            {t('common.actions.open', 'Open')}
                                        </a>
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRedeploy(p)}
                                    disabled={busyId === p.id}
                                >
                                    <RotateCcw size={15} />
                                    {t('app.previewList.redeploy', 'Redeploy')}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDestroy(p)}
                                    disabled={busyId === p.id}
                                >
                                    <Trash2 size={15} />
                                    {t('app.previewList.destroy', 'Delete')}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default PreviewList;
