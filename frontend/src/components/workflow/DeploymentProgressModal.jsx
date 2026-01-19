import React from 'react';
import { X, Loader, CheckCircle, XCircle, Server, Database, Globe, Box, ExternalLink } from 'lucide-react';

const nodeTypeConfig = {
    dockerApp: { icon: Server, label: 'Docker App', color: '#2496ed' },
    database: { icon: Database, label: 'Database', color: '#f59e0b' },
    domain: { icon: Globe, label: 'Domain', color: '#10b981' },
    service: { icon: Box, label: 'Service', color: '#6366f1' }
};

const DeploymentProgressModal = ({ isDeploying, results, nodes, onClose }) => {
    // Build node status map from results
    const nodeStatusMap = {};
    if (results?.results) {
        results.results.forEach((result) => {
            nodeStatusMap[result.nodeId] = result;
        });
    }

    const hasErrors = results?.errors?.length > 0;
    const isComplete = !isDeploying && results;

    return (
        <div className="deployment-modal-overlay" onClick={onClose}>
            <div className="deployment-modal" onClick={(e) => e.stopPropagation()}>
                <div className="deployment-modal-header">
                    <h2>
                        {isDeploying ? 'Deploying...' : hasErrors ? 'Deployment Completed with Errors' : 'Deployment Complete'}
                    </h2>
                    <button className="modal-close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="deployment-modal-content">
                    {isDeploying && !results && (
                        <div className="deployment-loading">
                            <Loader size={32} className="spin" />
                            <p>Deploying infrastructure...</p>
                            <span>This may take a moment</span>
                        </div>
                    )}

                    {results && (
                        <>
                            {/* Summary */}
                            <div className={`deployment-summary ${hasErrors ? 'has-errors' : 'success'}`}>
                                {hasErrors ? (
                                    <>
                                        <XCircle size={24} />
                                        <span>
                                            {results.results?.filter(r => r.success).length || 0} of {results.results?.length || 0} nodes deployed
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle size={24} />
                                        <span>All {results.results?.length || 0} nodes deployed successfully</span>
                                    </>
                                )}
                            </div>

                            {/* Node Results */}
                            <div className="deployment-results">
                                {nodes.map((node) => {
                                    const result = nodeStatusMap[node.id];
                                    const config = nodeTypeConfig[node.type] || nodeTypeConfig.service;
                                    const Icon = config.icon;

                                    return (
                                        <div
                                            key={node.id}
                                            className={`deployment-result-item ${result?.success ? 'success' : result ? 'error' : 'pending'}`}
                                        >
                                            <div className="result-icon" style={{ backgroundColor: config.color }}>
                                                <Icon size={16} />
                                            </div>
                                            <div className="result-info">
                                                <div className="result-name">{node.data?.name || node.id}</div>
                                                <div className="result-type">{config.label}</div>
                                            </div>
                                            <div className="result-status">
                                                {isDeploying && !result ? (
                                                    <Loader size={18} className="spin" />
                                                ) : result?.success ? (
                                                    <CheckCircle size={18} className="status-success" />
                                                ) : result ? (
                                                    <XCircle size={18} className="status-error" />
                                                ) : (
                                                    <span className="status-pending">Pending</span>
                                                )}
                                            </div>
                                            {result?.resourceId && (
                                                <a
                                                    href={getResourceLink(node.type, result.resourceId)}
                                                    className="result-link"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <ExternalLink size={14} />
                                                </a>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Errors */}
                            {hasErrors && (
                                <div className="deployment-errors">
                                    <h4>Errors</h4>
                                    {results.errors.map((error, index) => (
                                        <div key={index} className="error-item">
                                            <XCircle size={14} />
                                            <span>{error.error || 'Unknown error'}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="deployment-modal-footer">
                    {isComplete && (
                        <button className="btn btn-primary" onClick={onClose}>
                            {hasErrors ? 'Close' : 'Done'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

function getResourceLink(nodeType, resourceId) {
    switch (nodeType) {
        case 'dockerApp':
        case 'service':
            return `/apps/${resourceId}`;
        case 'domain':
            return `/domains/${resourceId}`;
        default:
            return '#';
    }
}

export default DeploymentProgressModal;
