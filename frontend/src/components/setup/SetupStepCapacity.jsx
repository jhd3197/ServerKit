import { useState } from 'react';
import { useResourceTier } from '../../contexts/useResourceTier.js';
import { Check, X, AlertTriangle, Loader, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Display order. The card bodies themselves come from the backend so the
// installer and the panel can never disagree about what a profile contains.
const PROFILE_ORDER = ['minimal', 'standard', 'full'];

const SetupStepCapacity = ({ useCases, onComplete }) => {
    const { t } = useTranslation();
    const {
        specs,
        headroom,
        profile,
        profiles,
        capabilities,
        recommendedProfile,
        profileDrift,
        loading,
    } = useResourceTier();

    // Seeded from what was actually installed, not from the recommendation —
    // this step confirms reality first and offers a change second.
    const [selected, setSelected] = useState(null);
    const [saving, setSaving] = useState(false);

    const activeProfile = selected || profile || recommendedProfile;

    if (loading) {
        return (
            <div className="wizard-step">
                <div className="wizard-loading">
                    <Loader size={24} className="spin" />
                </div>
            </div>
        );
    }

    async function handleContinue() {
        // Only write when the operator actually changed something.
        if (selected && selected !== profile) {
            setSaving(true);
            try {
                await api.request('/system/capacity/profile', {
                    method: 'PUT',
                    body: { profile: selected },
                });
            } catch {
                // A failed preference write must not strand someone in the
                // wizard — the profile is advisory and editable in Settings.
            } finally {
                setSaving(false);
            }
        }
        onComplete();
    }

    function renderSpecs() {
        if (!specs) return null;
        const items = [
            {
                icon: Cpu,
                label: `${specs.cpu_cores} core${specs.cpu_cores > 1 ? 's' : ''}`,
            },
            {
                icon: MemoryStick,
                label: `${specs.total_memory_gb} GB RAM`,
            },
        ];
        if (specs.disk_free_gb != null) {
            items.push({ icon: HardDrive, label: `${specs.disk_free_gb} GB disk free` });
        }
        return (
            <div className="capacity-specs">
                {items.map(({ icon: Icon, label }) => (
                    <span key={label} className="capacity-spec">
                        <Icon size={15} />
                        {label}
                    </span>
                ))}
                {specs.container && (
                    <span className="capacity-spec capacity-spec--muted">
                        {specs.container} container
                    </span>
                )}
            </div>
        );
    }

    // Selecting a profile richer than what is installed is allowed, but the
    // panel cannot apt-install Docker from inside the wizard — so say plainly
    // what is still needed instead of pretending the choice took effect.
    const needsDocker =
        (activeProfile === 'standard' || activeProfile === 'full') &&
        capabilities?.docker === false;

    const warnings = headroom?.warnings || [];

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">{t('app.setupStepCapacity.whatThisServerCanHold', 'What this server can hold')}</h2>
            <p className="wizard-step-description">
                {t('app.setupStepCapacity.weMeasuredYourHardwareNothingHere', 'We measured your hardware. Nothing here is a locked plan; anything skipped can be installed later from Settings.')}
            </p>

            <div className="capacity-headline">
                <div className="capacity-headline__summary">
                    {headroom?.summary || 'Measuring available capacity...'}
                </div>
                {renderSpecs()}
            </div>

            {warnings.map((warning) => (
                <div key={warning} className="tier-warning">
                    <AlertTriangle size={20} className="tier-warning-icon" />
                    <div className="tier-warning-text">{warning}</div>
                </div>
            ))}

            {profileDrift?.map((note) => (
                <div key={note} className="tier-warning">
                    <AlertTriangle size={20} className="tier-warning-icon" />
                    <div className="tier-warning-text">{note}</div>
                </div>
            ))}

            <div className="tier-grid">
                {PROFILE_ORDER.filter((id) => profiles?.[id]).map((id) => {
                    const info = profiles[id];
                    const isActive = activeProfile === id;
                    const isInstalled = profile === id;
                    const isRecommended = recommendedProfile === id;

                    return (
                        <SharedButton variant="unstyled"
                            type="button"
                            key={id}
                            className={`tier-card tier-card--selectable${isActive ? ' detected' : ''}`}
                            onClick={() => setSelected(id)}
                            aria-pressed={isActive}
                        >
                            <div className="tier-card-header">
                                <span className="tier-card-name">{info.label}</span>
                                {isInstalled && (
                                    <span className="tier-card-badge">{t('app.setupStepCapacity.installed', 'Installed')}</span>
                                )}
                                {!isInstalled && isRecommended && (
                                    <span className="tier-card-badge tier-card-badge--muted">
                                        {t('app.setupStepCapacity.suggested', 'Suggested')}
                                    </span>
                                )}
                            </div>
                            <div className="tier-card-specs">{info.suited_for}</div>
                            <div className="tier-features">
                                {info.installs.map((item) => (
                                    <div key={item} className="tier-feature available">
                                        <span className="feature-icon">
                                            <Check size={16} />
                                        </span>
                                        {item}
                                    </div>
                                ))}
                                {info.skips.map((item) => (
                                    <div key={item} className="tier-feature unavailable">
                                        <span className="feature-icon">
                                            <X size={16} />
                                        </span>
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </SharedButton>
                    );
                })}
            </div>

            {needsDocker && (
                <div className="tier-warning">
                    <AlertTriangle size={20} className="tier-warning-icon" />
                    <div className="tier-warning-text">
                        {t('app.setupStepCapacity.dockerIsNotInstalledOrNot', "Docker is not installed or not responding, so service hosting stays off until it is. We'll remember this choice. Install Docker and restart ServerKit, or re-run the installer with")}{' '}
                        <code>{t('app.setupStepCapacity.serverkitProfile', 'SERVERKIT_PROFILE=')}{activeProfile}</code>.
                    </div>
                </div>
            )}

            {useCases?.includes('wordpress') && headroom?.fits?.wordpress === false && (
                <div className="tier-warning">
                    <AlertTriangle size={20} className="tier-warning-icon" />
                    <div className="tier-warning-text">
                        {t('app.setupStepCapacity.youPickedWordpressButThereIs', 'You picked WordPress, but there is only')}{' '}
                        {headroom.ram_for_apps_mb} {t('app.setupStepCapacity.mbFreeAndASiteNeeds', 'MB free and a service needs about 512 MB. You can still create one, but expect it to be slow, or add RAM or swap first.')}
                    </div>
                </div>
            )}

            <div className="wizard-nav wizard-nav--flush">
                <SharedButton variant="unstyled"
                    type="button"
                    className="btn-wizard-next"
                    onClick={handleContinue}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : 'Continue'}
                </SharedButton>
            </div>
        </div>
    );
};

export default SetupStepCapacity;
