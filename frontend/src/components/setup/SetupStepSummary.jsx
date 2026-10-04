import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useResourceTier } from '../../contexts/useResourceTier.js';
import { Sparkles, Check, Loader, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';
import {
    SIDEBAR_ITEMS,
    SIDEBAR_PRESETS,
    presetForUseCases,
    visibleCountForPreset,
} from '../sidebarItems';
import { Button as SharedButton } from '@/components/ui/button';

const USE_CASE_LABELS = {
    wordpress: 'WordPress Sites',
    'web-apps': 'Web Applications',
    'self-hosted': 'Self-Hosted Services',
    devops: 'DevOps & Monitoring',
};

const SetupStepSummary = ({ accountInfo, useCases, twoFactorEnabled, onFinish }) => {
    const { t } = useTranslation();
    const { specs, headroom, profile, profiles, loading } = useResourceTier();

    // Sidebar profile. Pre-selected from the use cases already picked, so the
    // default path is zero extra clicks — "Change" reveals the full set for
    // anyone who wants to tune it before landing on the dashboard. Seeded once:
    // this step unmounts when the user steps back, so returning here re-derives
    // the suggestion from any edited use cases without clobbering a live choice.
    const [sidebarPreset, setSidebarPreset] = useState(() => presetForUseCases(useCases));
    const [presetOpen, setPresetOpen] = useState(false);

    // Recommended extensions (real slugs from the backend), the checked set, and
    // per-slug install status shown while finishing.
    const [recommendations, setRecommendations] = useState([]);
    const [recsLoading, setRecsLoading] = useState(true);
    const [checked, setChecked] = useState(() => new Set());
    const [installing, setInstalling] = useState(false);
    const [installState, setInstallState] = useState({}); // slug -> 'installing'|'done'|'error'

    // Security posture (plan 47 Ph5). Levels come catalog-resolved from the
    // backend — a level only lists extensions that are installable right now,
    // so this section renders honestly even before every security extension
    // is published. 'minimal' is the lean default.
    const [postures, setPostures] = useState({});
    const [securityPosture, setSecurityPosture] = useState('minimal');

    useEffect(() => {
        let active = true;
        setRecsLoading(true);
        api.getRecommendedExtensions(useCases)
            .then((res) => {
                if (!active) return;
                const recs = res?.recommendations || [];
                setRecommendations(recs);
                setPostures(res?.security_postures || {});
                // Default: everything checked ("lean" = uncheck what you don't want)
                setChecked(new Set(recs.filter((r) => !r.installed).map((r) => r.slug)));
            })
            .catch(() => {
                if (active) setRecommendations([]);
            })
            .finally(() => {
                if (active) setRecsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [useCases]);

    function toggle(slug) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(slug)) next.delete(slug);
            else next.add(slug);
            return next;
        });
    }

    async function handleFinish() {
        // Install the checked (not-already-installed) extensions plus the
        // chosen security posture's extensions, source-aware, one at a time
        // with per-item progress. Fail-soft: an install failure is surfaced
        // but never blocks completing onboarding.
        const postureExts = (postures[securityPosture] || []);
        // Posture extensions install regardless of the recommendation
        // checkboxes — the posture choice is the authorization. Overlapping
        // slugs are dropped from the recommendations half, not the posture
        // half, so unchecking a recommendation can't veto the posture.
        const postureSlugs = new Set(postureExts.map((r) => r.slug));
        const queue = recommendations
            .filter((r) => checked.has(r.slug) && !r.installed && !postureSlugs.has(r.slug))
            .concat(postureExts.filter((r) => !r.installed));
        const installedSlugs = recommendations
            .filter((r) => r.installed && checked.has(r.slug))
            .map((r) => r.slug);

        if (queue.length > 0) {
            setInstalling(true);
            for (const rec of queue) {
                setInstallState((s) => ({ ...s, [rec.slug]: 'installing' }));
                try {
                    if (rec.source === 'registry') {
                        await api.installRegistryExtension(rec.slug);
                    } else {
                        await api.installBuiltinExtension(rec.slug);
                    }
                    installedSlugs.push(rec.slug);
                    setInstallState((s) => ({ ...s, [rec.slug]: 'done' }));
                } catch {
                    setInstallState((s) => ({ ...s, [rec.slug]: 'error' }));
                }
            }
        }

        await onFinish(installedSlugs, sidebarPreset, securityPosture);
    }

    function formatSpecs() {
        if (!specs) return 'Detecting...';
        const parts = [];
        if (specs.cpu_cores) parts.push(`${specs.cpu_cores} core${specs.cpu_cores > 1 ? 's' : ''}`);
        if (specs.total_memory_gb) parts.push(`${specs.total_memory_gb} GB RAM`);
        return parts.join(', ');
    }

    function profileLabel() {
        if (loading) return 'Detecting...';
        return profiles?.[profile]?.label || 'Standard';
    }

    const anyError = Object.values(installState).some((v) => v === 'error');

    function renderRecStatus(rec) {
        if (rec.installed) {
            return <span className="recommendation-item__status recommendation-item__status--installed">{t('app.setupStepSummary.installed', 'Installed')}</span>;
        }
        const state = installState[rec.slug];
        if (state === 'installing') {
            return <Loader size={15} className="recommendation-item__spinner" />;
        }
        if (state === 'done') {
            return <Check size={15} className="recommendation-item__status--done" />;
        }
        if (state === 'error') {
            return <AlertTriangle size={15} className="recommendation-item__status--error" />;
        }
        return null;
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">{t('app.setupStepSummary.youReAllSet', 'Setup complete')}</h2>
            <p className="wizard-step-description">
                {t('app.setupStepSummary.hereSASummaryOfYour', 'Here\'s a summary of your setup. You can change these later in Settings.')}
            </p>

            <div className="summary-panel">
                <div className="summary-section">
                    <div className="summary-section-title">{t('app.setupStepSummary.account', 'Account')}</div>
                    <div className="summary-row">
                        <span className="summary-label">{t('common.labels.username', 'Username')}</span>
                        <span className="summary-value">{accountInfo?.username || '-'}</span>
                    </div>
                    <div className="summary-row">
                        <span className="summary-label">{t('app.setupStepSummary.email', 'Email')}</span>
                        <span className="summary-value">{accountInfo?.email || '-'}</span>
                    </div>
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">{t('app.setupStepSummary.useCases', 'Use cases')}</div>
                    {useCases && useCases.length > 0 ? (
                        <div className="summary-tags">
                            {useCases.map((uc) => (
                                <Badge key={uc} variant="secondary">
                                    {USE_CASE_LABELS[uc] || uc}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        <div className="summary-row">
                            <span className="summary-label">{t('app.setupStepSummary.noneSelected', 'None selected')}</span>
                        </div>
                    )}
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">{t('common.labels.server', 'Server')}</div>
                    <div className="summary-row">
                        <span className="summary-label">{t('app.setupStepSummary.profile', 'Profile')}</span>
                        <span className="summary-value">{profileLabel()}</span>
                    </div>
                    <div className="summary-row">
                        <span className="summary-label">{t('app.setupStepSummary.specs', 'Specs')}</span>
                        <span className="summary-value">{formatSpecs()}</span>
                    </div>
                    {headroom?.summary && (
                        <div className="summary-row">
                            <span className="summary-label">{t('app.setupStepSummary.capacity', 'Capacity')}</span>
                            <span className="summary-value">{headroom.summary}</span>
                        </div>
                    )}
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">{t('common.labels.security', 'Security')}</div>
                    <div className="summary-row">
                        <span className="summary-label">{t('app.setupStepSummary.twoFactor', 'Two-factor')}</span>
                        <span className="summary-value">
                            {twoFactorEnabled ? 'Enabled' : 'Off — you can turn it on in Settings'}
                        </span>
                    </div>

                    {/* Security posture (plan 47 Ph5): how much tooling to
                        install now. Only levels that resolve at least one
                        installable extension differ from "minimal"; each card
                        names exactly what it would install. */}
                    <p className="recommendation-hint">
                        {t('app.setupStepSummary.howMuchSecurityTooling', 'How much security tooling should we install? Everything here is an extension. Add or remove any of it later from the Marketplace.')}
                    </p>
                    <div className="summary-preset-list">
                        {[
                            { key: 'minimal', label: t('app.setupStepSummary.postureMinimal', 'Minimal'), desc: t('app.setupStepSummary.postureMinimalDesc', 'The lean default: firewall, SSH keys, IP lists, integrity and audit, with nothing extra installed.') },
                            { key: 'recommended', label: t('app.setupStepSummary.postureRecommended', 'Recommended'), desc: t('app.setupStepSummary.postureRecommendedDesc', 'Adds brute-force protection and automatic security updates.') },
                            { key: 'hardened', label: t('app.setupStepSummary.postureHardened', 'Hardened'), desc: t('app.setupStepSummary.postureHardenedDesc', 'Adds malware scanning, host audits, container image scanning and crowd-sourced IP blocking.') },
                        ].map((level) => {
                            const exts = postures[level.key] || [];
                            return (
                                <SharedButton variant="unstyled"
                                    type="button"
                                    key={level.key}
                                    className={`summary-preset-card${securityPosture === level.key ? ' active' : ''}`}
                                    onClick={() => setSecurityPosture(level.key)}
                                    aria-pressed={securityPosture === level.key}
                                    disabled={installing}
                                >
                                    <span className="summary-preset-card__head">
                                        <span className="summary-preset-card__label">{level.label}</span>
                                        {securityPosture === level.key && <Check size={14} />}
                                    </span>
                                    <span className="summary-preset-card__desc">
                                        {level.desc}
                                        {level.key !== 'minimal' && exts.length > 0 && (
                                            <> {'— '}{exts.map((e) => e.display_name).join(', ')}</>
                                        )}
                                        {level.key !== 'minimal' && exts.length === 0 && (
                                            <> {t('app.setupStepSummary.postureNotYetAvailable', '(not yet available from the extension registry; pick it later from the Marketplace)')}</>
                                        )}
                                    </span>
                                </SharedButton>
                            );
                        })}
                    </div>
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">{t('app.setupStepSummary.sidebar', 'Sidebar')}</div>
                    <div className="summary-row">
                        <span className="summary-label">{t('app.setupStepSummary.view', 'View')}</span>
                        <span className="summary-value summary-value--action">
                            {SIDEBAR_PRESETS[sidebarPreset]?.label || 'Recommended'}
                            <span className="summary-value-note">
                                {visibleCountForPreset(sidebarPreset)} of {SIDEBAR_ITEMS.length} items
                            </span>
                            <SharedButton variant="unstyled"
                                type="button"
                                className="summary-change-btn"
                                onClick={() => setPresetOpen((open) => !open)}
                                aria-expanded={presetOpen}
                            >
                                {presetOpen ? 'Done' : 'Change'}
                            </SharedButton>
                        </span>
                    </div>

                    {presetOpen && (
                        <div className="summary-preset-picker">
                            <p className="recommendation-hint">
                                {t('app.setupStepSummary.hiddenPagesStayReachableByUrl', 'Hidden pages stay reachable by URL and from search; this only trims the sidebar. Change it any time in Settings.')}
                            </p>
                            <div className="summary-preset-list">
                                {Object.entries(SIDEBAR_PRESETS).map(([key, profile]) => (
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        key={key}
                                        className={`summary-preset-card${sidebarPreset === key ? ' active' : ''}`}
                                        onClick={() => setSidebarPreset(key)}
                                        aria-pressed={sidebarPreset === key}
                                    >
                                        <span className="summary-preset-card__head">
                                            <span className="summary-preset-card__label">
                                                {profile.label}
                                            </span>
                                            {sidebarPreset === key && <Check size={14} />}
                                        </span>
                                        <span className="summary-preset-card__desc">
                                            {profile.description}
                                        </span>
                                    </SharedButton>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {(recsLoading || recommendations.length > 0) && (
                    <div className="summary-section">
                        <div className="summary-section-title">
                            <Sparkles size={14} className="summary-rec-ico" />
                            {t('app.setupStepSummary.recommendedForYou', 'Recommended for you')}
                        </div>
                        {recsLoading ? (
                            <div className="summary-row">
                                <span className="summary-label">{t('app.setupStepSummary.loadingRecommendations', 'Loading recommendations…')}</span>
                            </div>
                        ) : (
                            <>
                                <p className="recommendation-hint">
                                    {t('app.setupStepSummary.weLlInstallWhatYouCheck', "We'll install what you check. Uncheck anything you don't need; you can add it later from Extensions.")}
                                </p>
                                <div className="recommendation-list">
                                    {recommendations.map((rec) => (
                                        <label key={rec.slug} className="recommendation-item">
                                            <input
                                                type="checkbox"
                                                className="recommendation-item__check"
                                                checked={rec.installed || checked.has(rec.slug)}
                                                disabled={rec.installed || installing}
                                                onChange={() => toggle(rec.slug)}
                                            />
                                            <span className="recommendation-item__body">
                                                <span className="recommendation-item__name">
                                                    {rec.display_name}
                                                </span>
                                                {rec.description && (
                                                    <span className="recommendation-item__desc">
                                                        {rec.description}
                                                    </span>
                                                )}
                                            </span>
                                            {renderRecStatus(rec)}
                                        </label>
                                    ))}
                                </div>
                                {anyError && (
                                    <p className="recommendation-error">
                                        {t('app.setupStepSummary.someExtensionsCouldnTBeInstalled', 'Some extensions couldn\'t be installed. You can retry from the')} <Link to="/extensions">{t('common.labels.extensions', 'Extensions')}</Link> page.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            <div className="wizard-nav wizard-nav--flush">
                <SharedButton variant="unstyled"
                    type="button"
                    className="btn-wizard-next"
                    onClick={handleFinish}
                    disabled={installing}
                >
                    {installing ? 'Setting up...' : 'Go to Dashboard'}
                </SharedButton>
            </div>
        </div>
    );
};

export default SetupStepSummary;
