import React, { useState, useEffect, useRef } from 'react';
import { Activity, RefreshCw, CheckCircle, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import Spinner from '../Spinner';

const STATUS_CONFIG = {
    healthy: { icon: CheckCircle, color: 'green', label: 'Healthy' },
    degraded: { icon: AlertTriangle, color: 'yellow', label: 'Degraded' },
    unhealthy: { icon: XCircle, color: 'red', label: 'Unhealthy' },
    unknown: { icon: HelpCircle, color: 'gray', label: 'Unknown' },
};

const HealthDot = ({ status, size = 8 }) => {
    const colorMap = {
        healthy: 'var(--color-success, #22c55e)',
        degraded: 'var(--color-warning, #eab308)',
        unhealthy: 'var(--color-danger, #ef4444)',
        unknown: 'var(--color-text-tertiary, #6b7280)',
    };

    return (
        <span
            className={`health-dot health-dot-${status}`}
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                display: 'inline-block',
                backgroundColor: colorMap[status] || colorMap.unknown,
            }}
            title={STATUS_CONFIG[status]?.label || 'Unknown'}
        />
    );
};

const HealthStatusPanel = ({ projectId, environments, api, compact = false }) => {
    const [healthData, setHealthData] = useState({});
    const [loading, setLoading] = useState(true);
    const intervalRef = useRef(null);

    useEffect(() => {
        loadHealth();

        // Auto-refresh every 30 seconds
        intervalRef.current = setInterval(loadHealth, 30000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [projectId]);

    async function loadHealth() {
        try {
            const data = await api.getProjectHealth(projectId);
            if (data.success) {
                setHealthData(data.environments || {});
            }
        } catch {
            // Silently fail - health checks are optional
        } finally {
            setLoading(false);
        }
    }

    if (compact) {
        // Return just dots for pipeline cards
        return null; // Dots are rendered directly via HealthDot export
    }

    if (loading) {
        return (
            <div className="health-status-panel">
                <div className="health-panel-loading">
                    <Spinner size="sm" />
                    <span>Checking health...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="health-status-panel">
            <div className="health-panel-header">
                <h4>
                    <Activity size={16} />
                    Environment Health
                </h4>
                <button className="btn btn-ghost btn-sm" onClick={loadHealth}>
                    <RefreshCw size={12} />
                    Refresh
                </button>
            </div>

            <div className="health-panel-grid">
                {Object.entries(healthData).map(([envId, data]) => {
                    const env = environments?.find(e => String(e.id) === String(envId));
                    const envName = env?.name || `Environment ${envId}`;
                    const overall = data?.overall_status || 'unknown';
                    const checks = data?.checks || {};

                    return (
                        <div key={envId} className="health-panel-env">
                            <div className="health-panel-env-header">
                                <HealthDot status={overall} size={10} />
                                <span className="health-panel-env-name">{envName}</span>
                                <span className={`health-panel-overall health-${overall}`}>
                                    {STATUS_CONFIG[overall]?.label || 'Unknown'}
                                </span>
                            </div>
                            <div className="health-panel-checks">
                                {Object.entries(checks).map(([checkName, checkData]) => (
                                    <div key={checkName} className="health-panel-check">
                                        <HealthDot status={checkData.status} size={6} />
                                        <span className="health-panel-check-name">
                                            {checkName.charAt(0).toUpperCase() + checkName.slice(1)}
                                        </span>
                                        <span className="health-panel-check-msg">
                                            {checkData.message}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {Object.keys(healthData).length === 0 && (
                <div className="health-panel-empty">
                    No health data available
                </div>
            )}
        </div>
    );
};

export { HealthDot };
export default HealthStatusPanel;
