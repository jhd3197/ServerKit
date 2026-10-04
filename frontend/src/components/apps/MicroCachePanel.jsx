import { useEffect, useState } from 'react';
import { Zap, Eraser } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/hooks/useConfirm';
import { formatPercent } from '@/utils/intl';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Must match NginxService.MICROCACHE_TTL_DEFAULT / MICROCACHE_TTL_MAX.
const TTL_DEFAULT = 10;
const TTL_MAX = 300;
// App types whose vhost proxies to the app — the only ones the fingerprinted
// asset rule applies to (NginxService._with_immutable_assets).
const PROXIED_TYPES = ['docker', 'flask', 'django', 'python', 'remote'];

// Micro-cache panel (task #21, plan 86 §B3) — opt-in nginx page cache per
// site. The backend rewrites the site's vhost with the cache directives plus
// hard bypasses for anything personalized (logged-in cookies, carts,
// admin/login paths, non-GET requests, query strings). Stale copies are served
// while the app is down or the entry refreshes.
const MicroCachePanel = ({ app, onChanged }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [enabled, setEnabled] = useState(!!app.micro_cache_enabled);
    const [ttl, setTtl] = useState(String(app.micro_cache_ttl ?? TTL_DEFAULT));
    const [saving, setSaving] = useState(false);
    const [purging, setPurging] = useState(false);
    const [hitRatio, setHitRatio] = useState(null);
    const [immutable, setImmutable] = useState(!!app.immutable_assets);
    const proxied = PROXIED_TYPES.includes(app.app_type);

    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        api.getAppRequestMetrics(app.id, '24h')
            .then((data) => { if (!cancelled) setHitRatio(data?.summary?.cache_hit_ratio ?? null); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id, enabled]);

    const ttlNumber = Number(ttl);
    const ttlValid = Number.isInteger(ttlNumber) && ttlNumber >= 1 && ttlNumber <= TTL_MAX;
    const ttlDirty = ttlValid && ttlNumber !== (app.micro_cache_ttl ?? TTL_DEFAULT);

    async function save(nextEnabled, nextTtl) {
        setSaving(true);
        try {
            const data = await api.setMicroCache(app.id, nextEnabled, nextTtl);
            if (data.warning) toast.warning(data.warning);
            if (data.note) toast.info(data.note);
            onChanged?.();
            return data;
        } finally {
            setSaving(false);
        }
    }

    async function handleToggle(next) {
        setEnabled(next); // optimistic; reverted on failure
        try {
            const data = await save(next, ttlValid ? ttlNumber : undefined);
            if (!data.note) {
                toast.success(next
                    ? t('app.microCachePanel.microCacheEnabledTheSiteConfig', 'Micro-cache enabled. The site config was updated.')
                    : t('app.microCachePanel.microCacheDisabledTheSiteConfig', 'Micro-cache disabled. The site config was updated.'));
            }
        } catch (err) {
            setEnabled(!next);
            toastError(toast, t('app.microCachePanel.failedToUpdateMicroCache', 'Failed to update micro-cache'), err);
        }
    }

    async function handleSaveTtl() {
        try {
            await save(enabled, ttlNumber);
            toast.success(t('app.microCachePanel.cacheLifetimeSaved', 'Cache lifetime saved'));
        } catch (err) {
            toastError(toast, t('app.microCachePanel.failedToUpdateMicroCache', 'Failed to update micro-cache'), err);
        }
    }

    async function handleImmutable(next) {
        setImmutable(next);
        try {
            const data = await api.setImmutableAssets(app.id, next);
            if (data.warning) toast.warning(data.warning);
            else toast.success(t('app.microCachePanel.assetCachingSaved', 'Asset caching saved'));
            onChanged?.();
        } catch (err) {
            setImmutable(!next);
            toastError(toast, t('app.microCachePanel.couldntUpdateImmutableAssets', "Couldn't update immutable asset caching."), err);
        }
    }

    async function handlePurge() {
        if (!await confirm({
            title: t('app.microCachePanel.clearMicroCache', 'Clear micro-cache'),
            message: t('app.microCachePanel.clearCachedPagesForThisSite', 'Clear the cached pages for this service? Other services keep their cache.'),
            confirmText: t('app.microCachePanel.clearCache', 'Clear cache'),
        })) return;
        setPurging(true);
        try {
            const data = await api.purgeMicroCache(app.id);
            toast.success(data.message || t('app.microCachePanel.microCacheCleared', 'Micro-cache cleared'));
        } catch (err) {
            toastError(toast, t('app.microCachePanel.failedToClearTheMicroCache', 'Failed to clear the micro-cache'), err);
        } finally {
            setPurging(false);
        }
    }

    return (
        <div className="app-panel">
            <div className="app-panel-header">
                <Zap />
                <span>{t('app.microCachePanel.microCache', 'Micro-cache')}</span>
            </div>
            <div className="app-panel-body">
                <p className="app-panel-hint">
                    {t('app.microCachePanel.cachesFullPagesInNginx', 'Caches full pages in nginx for a few seconds, so traffic spikes hit the cache instead of your service, and visitors still get the last good page while the service restarts or errors. It is safe to enable: requests from logged-in users, carts and checkouts, admin and login pages, non-GET requests, and URLs with query strings always bypass the cache and reach the service directly.')}
                </p>

                <div className="settings-row">
                    <div className="settings-label">
                        <span>{t('app.microCachePanel.enableMicroCache', 'Enable micro-cache')}</span>
                        <span className="settings-hint">
                            {t('app.microCachePanel.rewritesThisSiteSNginxConfig', "Rewrites this service's nginx config with the cache rules. Turning it off removes them again.")}
                        </span>
                    </div>
                    <div className="settings-control">
                        <Switch
                            checked={enabled}
                            onCheckedChange={handleToggle}
                            disabled={saving}
                            aria-label={t('app.microCachePanel.enableMicroCache', 'Enable micro-cache')}
                        />
                        {saving && <span className="settings-saving">{t('common.editing.saving', 'Saving…')}</span>}
                    </div>
                </div>

                {proxied && (
                    <div className="settings-row">
                        <div className="settings-label">
                            <span>{t('app.microCachePanel.longCacheAssets', 'Long-cache fingerprinted assets')}</span>
                            <span className="settings-hint">
                                {t('app.microCachePanel.longCacheAssetsHint', 'Browsers keep files whose name carries a content hash (app.3f9a2c1d.js) for a year. Only turn this on if your build names assets that way: a file that changes without a new name would stay stale.')}
                            </span>
                        </div>
                        <div className="settings-control">
                            <Switch
                                checked={immutable}
                                onCheckedChange={handleImmutable}
                                aria-label={t('app.microCachePanel.longCacheAssets', 'Long-cache fingerprinted assets')}
                            />
                        </div>
                    </div>
                )}

                {enabled && (
                    <>
                        <div className="settings-row">
                            <div className="settings-label">
                                <label htmlFor={`micro-cache-ttl-${app.id}`}>
                                    {t('app.microCachePanel.cacheLifetime', 'Cache lifetime (seconds)')}
                                </label>
                                <span className="settings-hint">
                                    {t('app.microCachePanel.cacheLifetimeHint', 'How long a page is served from the cache before the service is asked again (1–{{max}}). Longer means fewer requests reach the service, and changes take longer to show.', { max: TTL_MAX })}
                                </span>
                            </div>
                            <div className="settings-control micro-cache__ttl">
                                <Input
                                    id={`micro-cache-ttl-${app.id}`}
                                    type="number"
                                    min={1}
                                    max={TTL_MAX}
                                    value={ttl}
                                    onChange={(e) => setTtl(e.target.value)}
                                    disabled={saving}
                                />
                                <Button variant="outline" size="sm" onClick={handleSaveTtl}
                                    disabled={saving || !ttlDirty}>
                                    {t('common.actions.save', 'Save')}
                                </Button>
                            </div>
                        </div>

                        <div className="settings-row">
                            <div className="settings-label">
                                <span>{t('app.microCachePanel.hitRatio', 'Hit ratio (24 h)')}</span>
                                <span className="settings-hint">
                                    {t('app.microCachePanel.hitRatioHint', 'Share of cacheable requests answered from the cache. Bypassed requests are not counted.')}
                                </span>
                            </div>
                            <div className="settings-control">
                                <span className="micro-cache__ratio">
                                    {hitRatio === null
                                        ? t('app.microCachePanel.noCachedTrafficYet', 'No cached traffic yet')
                                        : formatPercent(hitRatio * 100)}
                                </span>
                            </div>
                        </div>

                        <div className="settings-row">
                            <div className="settings-label">
                                <span>{t('app.microCachePanel.clearCache', 'Clear cache')}</span>
                                <span className="settings-hint">
                                    {t('app.microCachePanel.clearThisSitesEntries', "Entries expire on their own after the cache lifetime; use this when a change must be visible now. Only this service's pages are cleared.")}
                                </span>
                            </div>
                            <div className="settings-control">
                                <Button variant="outline" size="sm" onClick={handlePurge} disabled={purging}>
                                    <Eraser size={14} />
                                    {purging
                                        ? t('app.microCachePanel.clearing', 'Clearing…')
                                        : t('app.microCachePanel.clearCache', 'Clear cache')}
                                </Button>
                            </div>
                        </div>
                    </>
                )}

                <p className="app-panel-hint">
                    {t('app.microCachePanel.toVerifyItWorksCheckThe', 'To verify it works, check the')} <code>{t('app.microCachePanel.xSkCache', 'X-SK-Cache')}</code> {t('app.microCachePanel.responseHeaderOnTheSite', 'response header on the site:')} <code>HIT</code> {t('app.microCachePanel.meansThePageCameFromThe', 'means the page came from the cache,')}
                    <code> MISS</code>/<code>EXPIRED</code> {t('app.microCachePanel.thatItWasFetchedFreshAnd', 'that it was fetched fresh, and')}
                    <code> BYPASS</code> {t('app.microCachePanel.thatABypassRuleApplied', 'that a bypass rule applied.')}
                </p>
            </div>
        </div>
    );
};

export default MicroCachePanel;
