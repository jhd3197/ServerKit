import React from 'react';
import { Lock } from 'lucide-react';

const EnvironmentStatusBadge = ({ type, status, isLocked }) => {
    function getTypeBadgeClass() {
        switch (type) {
            case 'production': return 'env-production';
            case 'staging': return 'env-staging';
            case 'multidev': return 'env-multidev';
            default: return 'env-development';
        }
    }

    const isRunning = status === 'running';

    return (
        <div className="env-status-badge-group">
            <span className={`wp-env-badge ${getTypeBadgeClass()}`}>
                {type?.toUpperCase() || 'DEV'}
            </span>
            {isLocked && (
                <span className="env-locked-badge" title="Environment is locked">
                    <Lock size={10} />
                </span>
            )}
            <span className={`wp-env-status ${isRunning ? 'running' : 'stopped'}`}>
                <span className="status-dot" />
                {isRunning ? 'Running' : 'Stopped'}
            </span>
        </div>
    );
};

export default EnvironmentStatusBadge;
