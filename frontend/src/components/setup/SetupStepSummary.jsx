import React from 'react';
import { useResourceTier } from '../../contexts/ResourceTierContext';
import { Sparkles } from 'lucide-react';

const USE_CASE_LABELS = {
    wordpress: 'WordPress Sites',
    'web-apps': 'Web Applications',
    'self-hosted': 'Self-Hosted Services',
    devops: 'DevOps & Monitoring',
};

const RECOMMENDATIONS = {
    wordpress: ['WordPress', 'Nginx Proxy Manager', 'phpMyAdmin'],
    'web-apps': ['Node.js App', 'Python App', 'Portainer'],
    'self-hosted': ['Nextcloud', 'Vaultwarden', 'Wiki.js'],
    devops: ['Grafana', 'Prometheus', 'Portainer'],
};

const DEFAULT_RECOMMENDATIONS = ['Portainer', 'Uptime Kuma', 'Nginx Proxy Manager'];

function getRecommendations(useCases) {
    if (!useCases || useCases.length === 0) return DEFAULT_RECOMMENDATIONS;

    const seen = new Set();
    const result = [];
    for (const uc of useCases) {
        const items = RECOMMENDATIONS[uc] || [];
        for (const item of items) {
            if (!seen.has(item)) {
                seen.add(item);
                result.push(item);
            }
        }
    }
    return result.length > 0 ? result.slice(0, 4) : DEFAULT_RECOMMENDATIONS;
}

const SetupStepSummary = ({ accountInfo, useCases, onFinish }) => {
    const { tier, specs, loading } = useResourceTier();
    const recommendations = getRecommendations(useCases);

    function formatSpecs() {
        if (!specs) return 'Detecting...';
        const parts = [];
        if (specs.cpu_cores) parts.push(`${specs.cpu_cores} core${specs.cpu_cores > 1 ? 's' : ''}`);
        if (specs.total_memory_gb) parts.push(`${specs.total_memory_gb} GB RAM`);
        return parts.join(', ');
    }

    function tierLabel() {
        if (loading) return 'Detecting...';
        if (!tier) return 'Unknown';
        return tier.charAt(0).toUpperCase() + tier.slice(1);
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">You're all set</h2>
            <p className="wizard-step-description">
                Here's a summary of your setup. You can change these later in Settings.
            </p>

            <div className="summary-panel">
                <div className="summary-section">
                    <div className="summary-section-title">Account</div>
                    <div className="summary-row">
                        <span className="summary-label">Username</span>
                        <span className="summary-value">{accountInfo?.username || '-'}</span>
                    </div>
                    <div className="summary-row">
                        <span className="summary-label">Email</span>
                        <span className="summary-value">{accountInfo?.email || '-'}</span>
                    </div>
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">Use Cases</div>
                    {useCases && useCases.length > 0 ? (
                        <div className="summary-tags">
                            {useCases.map((uc) => (
                                <span key={uc} className="summary-tag">
                                    {USE_CASE_LABELS[uc] || uc}
                                </span>
                            ))}
                        </div>
                    ) : (
                        <div className="summary-row">
                            <span className="summary-label">None selected</span>
                        </div>
                    )}
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">Server</div>
                    <div className="summary-row">
                        <span className="summary-label">Tier</span>
                        <span className="summary-value">{tierLabel()}</span>
                    </div>
                    <div className="summary-row">
                        <span className="summary-label">Specs</span>
                        <span className="summary-value">{formatSpecs()}</span>
                    </div>
                </div>

                <div className="summary-section">
                    <div className="summary-section-title">
                        <Sparkles size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                        Recommended for you
                    </div>
                    <div className="recommendation-chips">
                        {recommendations.map((name) => (
                            <span key={name} className="recommendation-chip">
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            <div className="wizard-nav" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
                <button className="btn-wizard-next" onClick={onFinish}>
                    Go to Dashboard
                </button>
            </div>
        </div>
    );
};

export default SetupStepSummary;
