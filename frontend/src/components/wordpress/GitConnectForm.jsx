import React, { useState } from 'react';
import { GitBranch, Link, Unlink } from 'lucide-react';

const GitConnectForm = ({ gitStatus, onConnect, onDisconnect }) => {
    const [formData, setFormData] = useState({
        repoUrl: '',
        branch: 'main',
        paths: ['wp-content/themes', 'wp-content/plugins'],
        autoDeploy: false
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const isConnected = gitStatus?.connected;

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    function handlePathsChange(e) {
        const paths = e.target.value.split('\n').filter(p => p.trim());
        setFormData(prev => ({ ...prev, paths }));
    }

    async function handleConnect(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await onConnect({
                repo_url: formData.repoUrl,
                branch: formData.branch,
                paths: formData.paths,
                auto_deploy: formData.autoDeploy
            });
        } catch (err) {
            setError(err.message || 'Failed to connect repository');
        } finally {
            setLoading(false);
        }
    }

    async function handleDisconnect() {
        if (!confirm('Disconnect Git repository? This will not delete any files.')) {
            return;
        }
        setLoading(true);
        try {
            await onDisconnect();
        } catch (err) {
            setError(err.message || 'Failed to disconnect repository');
        } finally {
            setLoading(false);
        }
    }

    if (isConnected) {
        return (
            <div className="git-connected-card">
                <div className="git-connected-header">
                    <GitBranch size={20} />
                    <div className="git-connected-info">
                        <h4>Repository Connected</h4>
                        <a
                            href={gitStatus.repo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="git-repo-url"
                        >
                            {gitStatus.repo_url}
                        </a>
                    </div>
                </div>

                <div className="git-connected-meta">
                    <div className="git-meta-item">
                        <span className="meta-label">Branch</span>
                        <span className="meta-value">{gitStatus.branch}</span>
                    </div>
                    <div className="git-meta-item">
                        <span className="meta-label">Auto Deploy</span>
                        <span className="meta-value">{gitStatus.auto_deploy ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    {gitStatus.last_deploy_commit && (
                        <div className="git-meta-item">
                            <span className="meta-label">Last Deploy</span>
                            <span className="meta-value mono">{gitStatus.last_deploy_commit.substring(0, 7)}</span>
                        </div>
                    )}
                    {gitStatus.last_deploy_at && (
                        <div className="git-meta-item">
                            <span className="meta-label">Deployed At</span>
                            <span className="meta-value">
                                {new Date(gitStatus.last_deploy_at).toLocaleString()}
                            </span>
                        </div>
                    )}
                </div>

                <div className="git-connected-actions">
                    <button
                        className="btn btn-danger-outline"
                        onClick={handleDisconnect}
                        disabled={loading}
                    >
                        <Unlink size={14} />
                        {loading ? 'Disconnecting...' : 'Disconnect'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="git-connect-form">
            <h4>Connect Git Repository</h4>
            <p className="hint">
                Connect a Git repository to manage themes and plugins via version control.
            </p>

            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleConnect}>
                <div className="form-group">
                    <label>Repository URL *</label>
                    <input
                        type="text"
                        name="repoUrl"
                        value={formData.repoUrl}
                        onChange={handleChange}
                        placeholder="https://github.com/user/repo.git"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>Branch</label>
                    <input
                        type="text"
                        name="branch"
                        value={formData.branch}
                        onChange={handleChange}
                        placeholder="main"
                    />
                </div>

                <div className="form-group">
                    <label>Tracked Paths (one per line)</label>
                    <textarea
                        value={formData.paths.join('\n')}
                        onChange={handlePathsChange}
                        placeholder="wp-content/themes&#10;wp-content/plugins"
                        rows={3}
                    />
                    <span className="form-hint">
                        Paths relative to WordPress root that should be tracked
                    </span>
                </div>

                <div className="form-group">
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            name="autoDeploy"
                            checked={formData.autoDeploy}
                            onChange={handleChange}
                        />
                        <span>Enable auto-deploy on push</span>
                    </label>
                </div>

                <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        <Link size={14} />
                        {loading ? 'Connecting...' : 'Connect Repository'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default GitConnectForm;
