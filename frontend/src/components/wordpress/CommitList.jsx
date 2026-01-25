import React, { useState } from 'react';
import { GitCommit, Rocket, Copy, CheckCircle } from 'lucide-react';

const CommitList = ({ commits, currentCommit, onDeploy, onCreateDev, loading = false }) => {
    const [actionLoading, setActionLoading] = useState({});
    const [showDevModal, setShowDevModal] = useState(null);

    function formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffHours < 1) return 'Just now';
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    async function handleDeploy(commit) {
        if (!confirm(`Deploy commit ${commit.sha.substring(0, 7)} to production?`)) {
            return;
        }
        setActionLoading(prev => ({ ...prev, [`deploy-${commit.sha}`]: true }));
        try {
            await onDeploy?.({ commit_sha: commit.sha });
        } finally {
            setActionLoading(prev => ({ ...prev, [`deploy-${commit.sha}`]: false }));
        }
    }

    async function handleCreateDev(commit, config) {
        setActionLoading(prev => ({ ...prev, [`dev-${commit.sha}`]: true }));
        try {
            await onCreateDev?.({
                commit_sha: commit.sha,
                config
            });
            setShowDevModal(null);
        } finally {
            setActionLoading(prev => ({ ...prev, [`dev-${commit.sha}`]: false }));
        }
    }

    if (loading) {
        return <div className="loading">Loading commits...</div>;
    }

    if (!commits || commits.length === 0) {
        return (
            <div className="empty-state-small">
                <p>No commits found.</p>
                <p className="hint">Push changes to your repository to see commits here.</p>
            </div>
        );
    }

    return (
        <div className="commit-list">
            {commits.map(commit => {
                const isCurrent = currentCommit === commit.sha;
                const isDeploying = actionLoading[`deploy-${commit.sha}`];
                const isCreatingDev = actionLoading[`dev-${commit.sha}`];

                return (
                    <div key={commit.sha} className={`commit-item ${isCurrent ? 'current' : ''}`}>
                        <div className="commit-icon">
                            {isCurrent ? (
                                <CheckCircle size={16} className="current-icon" />
                            ) : (
                                <GitCommit size={16} />
                            )}
                        </div>

                        <div className="commit-info">
                            <div className="commit-header">
                                <span className="commit-sha mono">{commit.sha.substring(0, 7)}</span>
                                {isCurrent && <span className="current-badge">Deployed</span>}
                                <span className="commit-date">{formatDate(commit.date)}</span>
                            </div>
                            <p className="commit-message">{commit.message}</p>
                            {commit.author && (
                                <span className="commit-author">{commit.author}</span>
                            )}
                        </div>

                        <div className="commit-actions">
                            {!isCurrent && (
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleDeploy(commit)}
                                    disabled={isDeploying}
                                    title="Deploy this commit"
                                >
                                    <Rocket size={12} />
                                    {isDeploying ? 'Deploying...' : 'Deploy'}
                                </button>
                            )}
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setShowDevModal(commit)}
                                disabled={isCreatingDev}
                                title="Create dev environment from this commit"
                            >
                                <Copy size={12} />
                                {isCreatingDev ? 'Creating...' : 'Create Dev'}
                            </button>
                        </div>
                    </div>
                );
            })}

            {showDevModal && (
                <CreateDevModal
                    commit={showDevModal}
                    onClose={() => setShowDevModal(null)}
                    onCreate={(config) => handleCreateDev(showDevModal, config)}
                    loading={actionLoading[`dev-${showDevModal.sha}`]}
                />
            )}
        </div>
    );
};

const CreateDevModal = ({ commit, onClose, onCreate, loading }) => {
    const [formData, setFormData] = useState({
        name: `dev-${commit.sha.substring(0, 7)}`,
        domain: ''
    });

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    function handleSubmit(e) {
        e.preventDefault();
        onCreate(formData);
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Dev Environment</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    <p className="hint">
                        Create a development environment with code from commit{' '}
                        <code>{commit.sha.substring(0, 7)}</code>
                    </p>
                    <p className="commit-message-preview">"{commit.message}"</p>

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Environment Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="dev-abc1234"
                            />
                        </div>

                        <div className="form-group">
                            <label>Domain (optional)</label>
                            <input
                                type="text"
                                name="domain"
                                value={formData.domain}
                                onChange={handleChange}
                                placeholder="dev.example.com"
                            />
                            <span className="form-hint">Leave empty to auto-generate</span>
                        </div>

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={onClose}>
                                Cancel
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating...' : 'Create Environment'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default CommitList;
