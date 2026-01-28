import React from 'react';
import { useResourceTier } from '../../contexts/ResourceTierContext';
import { Check, X, AlertTriangle, Loader } from 'lucide-react';

const TIERS = [
    {
        id: 'lite',
        name: 'Lite',
        specs: '1 core or <2 GB RAM',
        features: [
            { label: 'Docker containers', available: true },
            { label: 'Database management', available: true },
            { label: 'App deployment', available: true },
            { label: 'Manage WordPress', available: true },
            { label: 'Create WordPress sites', available: false },
        ],
    },
    {
        id: 'standard',
        name: 'Standard',
        specs: '2-3 cores, 2-4 GB RAM',
        features: [
            { label: 'Docker containers', available: true },
            { label: 'Database management', available: true },
            { label: 'App deployment', available: true },
            { label: 'Manage WordPress', available: true },
            { label: 'Create WordPress sites', available: true },
        ],
    },
    {
        id: 'performance',
        name: 'Performance',
        specs: '4+ cores, >4 GB RAM',
        features: [
            { label: 'Docker containers', available: true },
            { label: 'Database management', available: true },
            { label: 'App deployment', available: true },
            { label: 'Manage WordPress', available: true },
            { label: 'Create WordPress sites', available: true },
        ],
    },
];

const SetupStepTier = ({ useCases, onComplete }) => {
    const { tier, specs, loading } = useResourceTier();
    const showWarning = useCases.includes('wordpress') && tier === 'lite';

    if (loading) {
        return (
            <div className="wizard-step">
                <div className="wizard-loading">
                    <Loader size={24} className="spin" />
                </div>
            </div>
        );
    }

    function formatSpecs() {
        if (!specs) return null;
        const parts = [];
        if (specs.cpu_cores) parts.push(`${specs.cpu_cores} core${specs.cpu_cores > 1 ? 's' : ''}`);
        if (specs.total_memory_gb) parts.push(`${specs.total_memory_gb} GB RAM`);
        return parts.join(', ');
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">Server Resources</h2>
            <p className="wizard-step-description">
                We detected your server's hardware. Here's what each tier unlocks.
            </p>

            {showWarning && (
                <div className="tier-warning">
                    <div className="tier-warning-icon">
                        <AlertTriangle size={20} />
                    </div>
                    <div className="tier-warning-text">
                        Your server is in the <strong>Lite</strong> tier. WordPress site
                        creation requires at least the Standard tier (2+ cores, 2+ GB RAM).
                        You can still manage existing WordPress sites.
                    </div>
                </div>
            )}

            <div className="tier-grid">
                {TIERS.map((t) => {
                    const isDetected = tier === t.id;
                    return (
                        <div
                            key={t.id}
                            className={`tier-card${isDetected ? ' detected' : ''}`}
                        >
                            <div className="tier-card-header">
                                <span className="tier-card-name">{t.name}</span>
                                {isDetected && (
                                    <span className="tier-card-badge">Your Server</span>
                                )}
                            </div>
                            <div className="tier-card-specs">
                                {isDetected && specs ? formatSpecs() : t.specs}
                            </div>
                            <div className="tier-features">
                                {t.features.map((f) => (
                                    <div
                                        key={f.label}
                                        className={`tier-feature ${f.available ? 'available' : 'unavailable'}`}
                                    >
                                        <span className="feature-icon">
                                            {f.available ? <Check size={16} /> : <X size={16} />}
                                        </span>
                                        {f.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="wizard-nav" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
                <button className="btn-wizard-next" onClick={onComplete}>
                    Continue
                </button>
            </div>
        </div>
    );
};

export default SetupStepTier;
