import React, { useState } from 'react';
import {
    ExternalLink, Play, Square, RefreshCw, ArrowRight,
    ArrowDownLeft, Lock, Unlock, FileText, Trash2, MoreVertical,
    GitBranch, Plus, GitCompare, Cpu, Shield, Terminal, Clock,
    HardDrive, Settings
} from 'lucide-react';
import EnvironmentStatusBadge from './EnvironmentStatusBadge';
import { HealthDot } from './HealthStatusPanel';
import DiskUsageBar from './DiskUsageBar';

const PipelineView = ({
    pipeline,
    onPromote,
    onSync,
    onStart,
    onStop,
    onRestart,
    onDelete,
    onLock,
    onUnlock,
    onViewLogs,
    onCreateMultidev,
    onCompare,
    onResourceLimits,
    onBasicAuth,
    onWpCli,
    onAutoSync,
    onHealthCheck,
    operationInProgress,
    healthData,
    diskUsageData,
    bulkSelected,
    onBulkToggle,
}) => {
    if (!pipeline) return null;

    const { production, environments = [] } = pipeline;
    const devEnv = environments.find(e => e.environment_type === 'development');
    const stagingEnv = environments.find(e => e.environment_type === 'staging');
    const multidevEnvs = environments.filter(e => e.environment_type === 'multidev');

    // Pipeline order: Dev -> Staging -> Production
    const pipelineEnvs = [devEnv, stagingEnv].filter(Boolean);

    return (
        <div className="pipeline-view">
            <div className="pipeline-row">
                {/* Development */}
                {devEnv ? (
                    <PipelineCard
                        env={devEnv}
                        onStart={onStart}
                        onStop={onStop}
                        onRestart={onRestart}
                        onDelete={onDelete}
                        onLock={onLock}
                        onUnlock={onUnlock}
                        onViewLogs={onViewLogs}
                        onResourceLimits={onResourceLimits}
                        onBasicAuth={onBasicAuth}
                        onWpCli={onWpCli}
                        onAutoSync={onAutoSync}
                        onHealthCheck={onHealthCheck}
                        operationInProgress={operationInProgress}
                        healthStatus={healthData?.[devEnv.id]?.overall_status}
                        diskUsage={diskUsageData?.[devEnv.id]?.usage}
                        bulkSelected={bulkSelected?.includes(devEnv.id)}
                        onBulkToggle={onBulkToggle}
                    />
                ) : (
                    <EmptySlot type="development" />
                )}

                {/* Arrow: Dev -> Staging (Promote) */}
                <PipelineArrow
                    label="Promote"
                    direction="forward"
                    disabled={!devEnv || !stagingEnv}
                    onClick={() => devEnv && stagingEnv && onPromote?.(devEnv, stagingEnv)}
                />

                {/* Staging */}
                {stagingEnv ? (
                    <PipelineCard
                        env={stagingEnv}
                        onStart={onStart}
                        onStop={onStop}
                        onRestart={onRestart}
                        onDelete={onDelete}
                        onLock={onLock}
                        onUnlock={onUnlock}
                        onViewLogs={onViewLogs}
                        onResourceLimits={onResourceLimits}
                        onBasicAuth={onBasicAuth}
                        onWpCli={onWpCli}
                        onAutoSync={onAutoSync}
                        onHealthCheck={onHealthCheck}
                        operationInProgress={operationInProgress}
                        healthStatus={healthData?.[stagingEnv.id]?.overall_status}
                        diskUsage={diskUsageData?.[stagingEnv.id]?.usage}
                        bulkSelected={bulkSelected?.includes(stagingEnv.id)}
                        onBulkToggle={onBulkToggle}
                    />
                ) : (
                    <EmptySlot type="staging" />
                )}

                {/* Arrow: Staging -> Production (Promote) */}
                <PipelineArrow
                    label="Promote"
                    direction="forward"
                    disabled={!stagingEnv}
                    onClick={() => stagingEnv && production && onPromote?.(stagingEnv, production)}
                />

                {/* Production */}
                {production && (
                    <PipelineCard
                        env={production}
                        isProduction
                        onStart={onStart}
                        onStop={onStop}
                        onRestart={onRestart}
                        onLock={onLock}
                        onUnlock={onUnlock}
                        onViewLogs={onViewLogs}
                        onResourceLimits={onResourceLimits}
                        onBasicAuth={onBasicAuth}
                        onWpCli={onWpCli}
                        onHealthCheck={onHealthCheck}
                        operationInProgress={operationInProgress}
                        healthStatus={healthData?.[production.id]?.overall_status}
                        diskUsage={diskUsageData?.[production.id]?.usage}
                    />
                )}
            </div>

            {/* Sync arrows (below, reversed) */}
            <div className="pipeline-sync-row">
                {devEnv && (
                    <div className="pipeline-sync-action">
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => onSync?.(devEnv)}
                            title="Pull production data into development"
                        >
                            <ArrowDownLeft size={14} />
                            Pull from Prod
                        </button>
                    </div>
                )}
                {stagingEnv && (
                    <div className="pipeline-sync-action">
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => onSync?.(stagingEnv)}
                            title="Pull production data into staging"
                        >
                            <ArrowDownLeft size={14} />
                            Pull from Prod
                        </button>
                    </div>
                )}
            </div>

            {/* Compare row */}
            {onCompare && (devEnv || stagingEnv) && production && (
                <div className="pipeline-compare-row">
                    {devEnv && (
                        <button
                            className="btn btn-ghost btn-sm pipeline-compare-btn"
                            onClick={() => onCompare(devEnv, production)}
                            title="Compare development vs production"
                        >
                            <GitCompare size={14} />
                            Compare vs Prod
                        </button>
                    )}
                    {stagingEnv && (
                        <button
                            className="btn btn-ghost btn-sm pipeline-compare-btn"
                            onClick={() => onCompare(stagingEnv, production)}
                            title="Compare staging vs production"
                        >
                            <GitCompare size={14} />
                            Compare vs Prod
                        </button>
                    )}
                    {devEnv && stagingEnv && (
                        <button
                            className="btn btn-ghost btn-sm pipeline-compare-btn"
                            onClick={() => onCompare(devEnv, stagingEnv)}
                            title="Compare development vs staging"
                        >
                            <GitCompare size={14} />
                            Dev vs Staging
                        </button>
                    )}
                </div>
            )}

            {/* Multidev section */}
            <div className="pipeline-multidev-section">
                <div className="pipeline-section-header">
                    <h4 className="pipeline-section-title">
                        <GitBranch size={16} />
                        Multidev Environments
                        {multidevEnvs.length > 0 && (
                            <span className="pipeline-section-count">{multidevEnvs.length}</span>
                        )}
                    </h4>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={onCreateMultidev}
                    >
                        <Plus size={14} />
                        New Multidev
                    </button>
                </div>
                {multidevEnvs.length > 0 ? (
                    <div className="pipeline-multidev-grid">
                        {multidevEnvs.map(env => (
                            <MultidevCard
                                key={env.id}
                                env={env}
                                onStart={onStart}
                                onStop={onStop}
                                onRestart={onRestart}
                                onDelete={onDelete}
                                onPromote={onPromote}
                                onSync={onSync}
                                onLock={onLock}
                                onUnlock={onUnlock}
                                onViewLogs={onViewLogs}
                                devEnv={devEnv}
                                stagingEnv={stagingEnv}
                                production={production}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="pipeline-multidev-empty">
                        <GitBranch size={24} />
                        <p>No multidev environments yet</p>
                        <span>Create branch-based environments for feature development and testing</span>
                        <button className="btn btn-primary btn-sm" onClick={onCreateMultidev}>
                            <Plus size={14} />
                            Create Multidev
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const PipelineCard = ({
    env,
    isProduction = false,
    onStart,
    onStop,
    onRestart,
    onDelete,
    onLock,
    onUnlock,
    onViewLogs,
    onResourceLimits,
    onBasicAuth,
    onWpCli,
    onAutoSync,
    onHealthCheck,
    operationInProgress,
    healthStatus,
    diskUsage,
    bulkSelected,
    onBulkToggle,
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const isRunning = env.status === 'running' || env.application?.status === 'running';
    const envType = env.environment_type || (isProduction ? 'production' : 'development');
    const domain = env.application?.domains?.[0] || env.url || '';

    function formatRelativeTime(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / 86400000);
        const diffHours = Math.floor(diffMs / 3600000);

        if (diffHours < 1) return 'Just now';
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    return (
        <div className={`pipeline-card ${isProduction ? 'production' : ''} ${env.is_locked ? 'locked' : ''}`}>
            <div className="pipeline-card-header">
                {onBulkToggle && !isProduction && (
                    <input
                        type="checkbox"
                        className="pipeline-card-checkbox"
                        checked={bulkSelected || false}
                        onChange={() => onBulkToggle(env.id)}
                    />
                )}
                <EnvironmentStatusBadge
                    type={envType}
                    status={isRunning ? 'running' : 'stopped'}
                    isLocked={env.is_locked}
                />
                {healthStatus && (
                    <HealthDot status={healthStatus} size={8} />
                )}
                <div className="pipeline-card-menu-wrapper">
                    <button
                        className="btn btn-ghost btn-sm pipeline-card-menu-btn"
                        onClick={() => setShowMenu(!showMenu)}
                    >
                        <MoreVertical size={14} />
                    </button>
                    {showMenu && (
                        <div className="pipeline-card-menu" onMouseLeave={() => setShowMenu(false)}>
                            {isRunning ? (
                                <>
                                    <button onClick={() => { onStop?.(env); setShowMenu(false); }}>
                                        <Square size={12} /> Stop
                                    </button>
                                    <button onClick={() => { onRestart?.(env); setShowMenu(false); }}>
                                        <RefreshCw size={12} /> Restart
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => { onStart?.(env); setShowMenu(false); }}>
                                    <Play size={12} /> Start
                                </button>
                            )}
                            <button onClick={() => { onViewLogs?.(env); setShowMenu(false); }}>
                                <FileText size={12} /> Logs
                            </button>
                            <div className="pipeline-card-menu-divider" />
                            <button onClick={() => { onResourceLimits?.(env); setShowMenu(false); }}>
                                <Cpu size={12} /> Resources
                            </button>
                            <button onClick={() => { onBasicAuth?.(env); setShowMenu(false); }}>
                                <Shield size={12} /> Basic Auth
                            </button>
                            <button onClick={() => { onWpCli?.(env); setShowMenu(false); }}>
                                <Terminal size={12} /> WP-CLI
                            </button>
                            {!isProduction && onAutoSync && (
                                <button onClick={() => { onAutoSync?.(env); setShowMenu(false); }}>
                                    <Clock size={12} /> Auto-Sync
                                </button>
                            )}
                            <div className="pipeline-card-menu-divider" />
                            {env.is_locked ? (
                                <button onClick={() => { onUnlock?.(env); setShowMenu(false); }}>
                                    <Unlock size={12} /> Unlock
                                </button>
                            ) : (
                                <button onClick={() => { onLock?.(env); setShowMenu(false); }}>
                                    <Lock size={12} /> Lock
                                </button>
                            )}
                            {!isProduction && (
                                <button className="danger" onClick={() => { onDelete?.(env); setShowMenu(false); }}>
                                    <Trash2 size={12} /> Delete
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="pipeline-card-body">
                <h4 className="pipeline-card-name">{env.name}</h4>
                {domain && (
                    <a
                        href={domain.startsWith('http') ? domain : `https://${domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pipeline-card-domain"
                    >
                        {domain}
                    </a>
                )}
                <div className="pipeline-card-meta">
                    {env.wp_version && (
                        <span className="pipeline-meta-item">v{env.wp_version}</span>
                    )}
                    {env.last_sync && !isProduction && (
                        <span className="pipeline-meta-item">
                            Synced {formatRelativeTime(env.last_sync)}
                        </span>
                    )}
                    {diskUsage && (
                        <DiskUsageBar usage={diskUsage} compact />
                    )}
                </div>
            </div>

            <div className="pipeline-card-footer">
                {domain && (
                    <a
                        href={domain.startsWith('http') ? domain : `https://${domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                    >
                        <ExternalLink size={12} /> Visit
                    </a>
                )}
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => onViewLogs?.(env)}
                >
                    <FileText size={12} /> Logs
                </button>
            </div>

            {env.is_locked && env.locked_reason && (
                <div className="pipeline-card-lock-banner">
                    <Lock size={10} />
                    <span>{env.locked_reason}</span>
                </div>
            )}
        </div>
    );
};

const PipelineArrow = ({ label, direction, disabled, onClick }) => {
    return (
        <div className={`pipeline-arrow ${disabled ? 'disabled' : ''}`}>
            <button
                className="pipeline-arrow-btn"
                onClick={onClick}
                disabled={disabled}
                title={disabled ? 'Environment not available' : label}
            >
                <ArrowRight size={16} />
                <span className="pipeline-arrow-label">{label}</span>
            </button>
        </div>
    );
};

const EmptySlot = ({ type }) => {
    return (
        <div className="pipeline-card empty">
            <div className="pipeline-empty-content">
                <span className={`wp-env-badge env-${type}`}>
                    {type.toUpperCase()}
                </span>
                <p>No {type} environment</p>
            </div>
        </div>
    );
};

const MultidevCard = ({
    env, onStart, onStop, onRestart, onDelete, onPromote,
    onSync, onLock, onUnlock, onViewLogs,
    devEnv, stagingEnv, production
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const isRunning = env.status === 'running' || env.application?.status === 'running';
    const domain = env.application?.domains?.[0] || env.url || '';

    function formatRelativeTime(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / 86400000);
        const diffHours = Math.floor(diffMs / 3600000);
        if (diffHours < 1) return 'Just now';
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    // Determine best promote target
    const promoteTarget = devEnv || stagingEnv || production;

    return (
        <div className={`multidev-card ${env.is_locked ? 'locked' : ''}`}>
            <div className="multidev-card-header">
                <div className="multidev-card-header-left">
                    <span className="wp-env-badge env-multidev">MULTIDEV</span>
                    <span className={`wp-env-status ${isRunning ? 'running' : 'stopped'}`}>
                        <span className="status-dot" />
                        {isRunning ? 'Running' : 'Stopped'}
                    </span>
                    {env.is_locked && (
                        <Lock size={12} className="multidev-lock-icon" />
                    )}
                </div>
                <div className="multidev-card-menu-wrapper">
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowMenu(!showMenu)}
                    >
                        <MoreVertical size={14} />
                    </button>
                    {showMenu && (
                        <div className="pipeline-card-menu" onMouseLeave={() => setShowMenu(false)}>
                            {isRunning ? (
                                <>
                                    <button onClick={() => { onStop?.(env); setShowMenu(false); }}>
                                        <Square size={12} /> Stop
                                    </button>
                                    <button onClick={() => { onRestart?.(env); setShowMenu(false); }}>
                                        <RefreshCw size={12} /> Restart
                                    </button>
                                </>
                            ) : (
                                <button onClick={() => { onStart?.(env); setShowMenu(false); }}>
                                    <Play size={12} /> Start
                                </button>
                            )}
                            <button onClick={() => { onSync?.(env); setShowMenu(false); }}>
                                <ArrowDownLeft size={12} /> Sync from Prod
                            </button>
                            <button onClick={() => { onViewLogs?.(env); setShowMenu(false); }}>
                                <FileText size={12} /> Logs
                            </button>
                            {env.is_locked ? (
                                <button onClick={() => { onUnlock?.(env); setShowMenu(false); }}>
                                    <Unlock size={12} /> Unlock
                                </button>
                            ) : (
                                <button onClick={() => { onLock?.(env); setShowMenu(false); }}>
                                    <Lock size={12} /> Lock
                                </button>
                            )}
                            <button className="danger" onClick={() => { onDelete?.(env); setShowMenu(false); }}>
                                <Trash2 size={12} /> Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <div className="multidev-card-body">
                <h5 className="multidev-card-name">{env.name}</h5>
                {env.multidev_branch && (
                    <span className="multidev-branch">
                        <GitBranch size={12} />
                        {env.multidev_branch}
                    </span>
                )}
                {domain && (
                    <a
                        href={domain.startsWith('http') ? domain : `https://${domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="multidev-domain"
                    >
                        {domain}
                    </a>
                )}
                <div className="multidev-card-meta">
                    {env.created_at && (
                        <span className="multidev-meta-item">
                            Created {formatRelativeTime(env.created_at)}
                        </span>
                    )}
                </div>
            </div>
            <div className="multidev-card-footer">
                {domain && (
                    <a
                        href={domain.startsWith('http') ? domain : `https://${domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                    >
                        <ExternalLink size={12} /> Visit
                    </a>
                )}
                <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => promoteTarget && onPromote?.(env, promoteTarget)}
                    disabled={!promoteTarget}
                    title={promoteTarget ? `Promote to ${promoteTarget.environment_type || 'production'}` : 'No target environment'}
                >
                    <ArrowRight size={12} /> Promote
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => onViewLogs?.(env)}>
                    <FileText size={12} />
                </button>
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => onDelete?.(env)}>
                    <Trash2 size={12} />
                </button>
            </div>
            {env.is_locked && env.locked_reason && (
                <div className="pipeline-card-lock-banner">
                    <Lock size={10} />
                    <span>{env.locked_reason}</span>
                </div>
            )}
        </div>
    );
};

export default PipelineView;
