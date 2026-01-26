import React from 'react';
import { AlertTriangle, Cpu, HardDrive, Server, ArrowUpCircle } from 'lucide-react';
import { useResourceTier } from '../contexts/ResourceTierContext';

const ResourceGate = ({ children, feature = 'wordpress_create' }) => {
    const {
        tier,
        specs,
        features,
        loading,
        isLiteTier,
        canCreateWordPress
    } = useResourceTier();

    // While loading, show nothing or a skeleton
    if (loading) {
        return children;
    }

    // Check if the specific feature is blocked
    const isBlocked = feature === 'wordpress_create' && !canCreateWordPress;

    if (!isBlocked) {
        return children;
    }

    // Minimum requirements
    const minCores = 2;
    const minRamGb = 2;

    return (
        <div className="resource-gate">
            <div className="resource-gate-container">
                <div className="resource-gate-icon">
                    <AlertTriangle size={48} />
                </div>

                <h2 className="resource-gate-title">Server Resources Insufficient</h2>

                <p className="resource-gate-description">
                    WordPress site creation requires more server resources than currently available.
                    Your server is classified as a <strong>Lite</strong> tier server.
                </p>

                <div className="resource-gate-specs">
                    <div className="resource-gate-spec-card current">
                        <div className="resource-gate-spec-header">
                            <Server size={18} />
                            <span>Your Server</span>
                        </div>
                        <div className="resource-gate-spec-items">
                            <div className="resource-gate-spec-item">
                                <Cpu size={16} />
                                <span className="spec-label">CPU Cores</span>
                                <span className="spec-value insufficient">
                                    {specs?.cpu_cores || '?'}
                                </span>
                            </div>
                            <div className="resource-gate-spec-item">
                                <HardDrive size={16} />
                                <span className="spec-label">RAM</span>
                                <span className="spec-value insufficient">
                                    {specs?.ram_gb || '?'} GB
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="resource-gate-spec-arrow">
                        <ArrowUpCircle size={24} />
                    </div>

                    <div className="resource-gate-spec-card required">
                        <div className="resource-gate-spec-header">
                            <Server size={18} />
                            <span>Minimum Required</span>
                        </div>
                        <div className="resource-gate-spec-items">
                            <div className="resource-gate-spec-item">
                                <Cpu size={16} />
                                <span className="spec-label">CPU Cores</span>
                                <span className="spec-value">{minCores}+</span>
                            </div>
                            <div className="resource-gate-spec-item">
                                <HardDrive size={16} />
                                <span className="spec-label">RAM</span>
                                <span className="spec-value">{minRamGb}+ GB</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="resource-gate-recommendation">
                    <h4>Recommendation</h4>
                    <p>
                        Upgrade your server to at least <strong>{minCores} CPU cores</strong> and{' '}
                        <strong>{minRamGb}GB RAM</strong> to enable WordPress site creation.
                        A <strong>Standard</strong> or <strong>Performance</strong> tier server
                        is recommended for optimal WordPress performance.
                    </p>
                </div>

                <div className="resource-gate-tiers">
                    <div className={`resource-gate-tier ${tier === 'lite' ? 'current' : ''}`}>
                        <div className="tier-name">Lite</div>
                        <div className="tier-specs">1 core or &lt;2GB RAM</div>
                        <div className="tier-wp">WordPress: Blocked</div>
                    </div>
                    <div className={`resource-gate-tier ${tier === 'standard' ? 'current' : ''}`}>
                        <div className="tier-name">Standard</div>
                        <div className="tier-specs">2-3 cores, 2-4GB RAM</div>
                        <div className="tier-wp allowed">WordPress: Allowed</div>
                    </div>
                    <div className={`resource-gate-tier ${tier === 'performance' ? 'current' : ''}`}>
                        <div className="tier-name">Performance</div>
                        <div className="tier-specs">4+ cores, &gt;4GB RAM</div>
                        <div className="tier-wp allowed">WordPress: Allowed</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ResourceGate;
