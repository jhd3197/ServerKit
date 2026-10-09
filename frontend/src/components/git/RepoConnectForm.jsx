import { useState, useEffect } from 'react';
import { GitBranch, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import api from '../../services/api';
import { RepoProviderStrip, ProviderBadge } from './GitProviders';
import { detectProvider, GIT_PROVIDERS } from './gitProviderData';
import GithubRepoPicker from './GithubRepoPicker';
import GitlabRepoPicker from './GitlabRepoPicker';
import BitbucketRepoPicker from './BitbucketRepoPicker';
import GiteaRepoPicker from './GiteaRepoPicker';
import PathSelector from './PathSelector';
import { useConfirm } from '@/hooks/useConfirm';
import { useTranslation } from 'react-i18next';

// Canonical "connect a repository" form, shared across ServerKit's surfaces
// (WordPress Git settings, the New Service page, the service connect modal).
// It owns the form state and submits via the `onConnect` callback; when a repo
// is already connected it shows the connected summary + Disconnect.
//
// Provider-specific fast paths:
//   - GitHub / GitLab: OAuth repo picker (URL fallback below it).
//   - Gitea: detect the local ServerKit Gitea instance and list its repos.
//   - Bitbucket / SSH / Other: paste-a-URL flow.
//
// props:
//   gitStatus   { connected, repo_url, branch, auto_deploy, last_deploy_* }
//   onConnect   async ({ repo_url, branch, paths, auto_deploy }) => void
//   onDisconnect async () => void
//   intro       { title, subtitle }
//   showPaths   render the tracked-path selector (WordPress)
//   defaultPaths / pathsLabel / pathsHint
//   urlPlaceholder / submitLabel
//   idPrefix    unique id prefix (so two forms can coexist on one page)
const RepoConnectForm = ({
    gitStatus,
    onConnect,
    onDisconnect,
    intro = {
        titleKey: 'app.repoConnectForm.connectAGitRepository', title: 'Connect a Git repository',
        subtitleKey: 'app.repoConnectForm.trackThisServiceInVersionControl', subtitle: 'Track this service in version control. Push to deploy.',
    },
    showPaths = false,
    defaultPaths = [],
    pathsLabel,
    pathsHint = '',
    urlPlaceholder = 'https://github.com/user/repo.git',
    submitLabel,
    idPrefix = 'repo',
    enableGithub = true,
}) => {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const [formData, setFormData] = useState({
        repoUrl: '',
        branch: 'main',
        paths: defaultPaths,
        autoDeploy: false,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [giteaStatus, setGiteaStatus] = useState(null);

    const isConnected = gitStatus?.connected;
    const provider = detectProvider(formData.repoUrl);

    // Which provider chip is chosen — drives the connect method. A recognized URL
    // wins over a manual click.
    const [selectedKey, setSelectedKey] = useState(enableGithub ? 'github' : 'other');
    useEffect(() => {
        if (provider?.key) setSelectedKey(provider.key);
    }, [provider?.key]);
    const selectedProvider = GIT_PROVIDERS.find((p) => p.key === selectedKey) || GIT_PROVIDERS[0];

    // Detect local Gitea so we can badge the provider card and offer the local repo picker.
    useEffect(() => {
        let cancelled = false;
        api.getGiteaStatus()
            .then((data) => { if (!cancelled) setGiteaStatus(data); })
            .catch(() => { if (!cancelled) setGiteaStatus(null); });
        return () => { cancelled = true; };
    }, []);

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }

    function handlePathsChange(paths) {
        setFormData((prev) => ({ ...prev, paths }));
    }

    function handleRepoPick({ repoUrl, branch }) {
        setFormData((prev) => ({
            ...prev,
            repoUrl: repoUrl || prev.repoUrl,
            branch: branch || prev.branch,
        }));
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
                auto_deploy: formData.autoDeploy,
            });
        } catch (err) {
            setError(err.message || 'Failed to connect repository');
        } finally {
            setLoading(false);
        }
    }

    async function handleDisconnect() {
        if (!await confirm({
            title: t('app.repoConnectForm.disconnectRepository', 'Disconnect repository'),
            message: t('app.repoConnectForm.disconnectThisGitRepositoryThisWill', 'Disconnect this Git repository? This will not delete any files.'),
            confirmText: t('app.repoConnectForm.disconnect', 'Disconnect'),
        })) return;
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
            <div className="git-connect-status">
                <div className="git-connect-status__header">
                    <span className="git-connect-status__icon">
                        <GitBranch size={19} />
                    </span>
                    <div className="git-connect-status__title">
                        <strong>{t('app.repoConnectForm.repositoryConnected', 'Repository connected')}</strong>
                        <a
                            href={gitStatus.repo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="git-connect-status__url"
                        >
                            {gitStatus.repo_url}
                        </a>
                    </div>
                </div>

                <div className="git-connect-status__meta">
                    <div className="git-connect-status__meta-item">
                        <span>{t('common.labels.branch', 'Branch')}</span>
                        <strong>{gitStatus.branch}</strong>
                    </div>
                    <div className="git-connect-status__meta-item">
                        <span>{t('app.repoConnectForm.autoDeploy', 'Auto deploy')}</span>
                        <strong>{gitStatus.auto_deploy ? t('app.repoConnectForm.enabled', 'Enabled') : t('app.repoConnectForm.disabled', 'Disabled')}</strong>
                    </div>
                    {gitStatus.last_deploy_commit && (
                        <div className="git-connect-status__meta-item">
                            <span>{t('app.repoConnectForm.lastDeploy', 'Last deploy')}</span>
                            <strong className="mono">{gitStatus.last_deploy_commit.substring(0, 7)}</strong>
                        </div>
                    )}
                    {gitStatus.last_deploy_at && (
                        <div className="git-connect-status__meta-item">
                            <span>{t('app.repoConnectForm.deployedAt', 'Deployed At')}</span>
                            <strong>{new Date(gitStatus.last_deploy_at).toLocaleString()}</strong>
                        </div>
                    )}
                </div>

                <div className="git-connect-status__actions">
                    <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
                        <Unlink size={14} />
                        {loading ? t('app.repoConnectForm.disconnecting', 'Disconnecting…') : t('app.repoConnectForm.disconnect', 'Disconnect')}
                    </Button>
                </div>
            </div>
        );
    }

    const giteaRunning = giteaStatus?.installed && giteaStatus?.running;

    return (
        <form className="git-connect git-connect--card" onSubmit={handleConnect}>
            <div className="git-connect__intro">
                <span className="git-connect__intro-icon">
                    <GitBranch size={19} />
                </span>
                <div className="git-connect__intro-text">
                    <strong>{intro.title}</strong>
                    <span>{intro.subtitle}</span>
                </div>
            </div>

            <RepoProviderStrip
                detected={provider?.key}
                selected={selectedKey}
                onSelect={setSelectedKey}
                giteaStatus={giteaStatus}
            />

            {selectedKey === 'github' && enableGithub && (
                <>
                    <GithubRepoPicker onPick={handleRepoPick} />
                    <div className="git-connect__or"><span>{t('app.repoConnectForm.orPasteAUrl', 'or paste a URL')}</span></div>
                </>
            )}

            {selectedKey === 'gitlab' && (
                <>
                    <GitlabRepoPicker onPick={handleRepoPick} />
                    <div className="git-connect__or"><span>{t('app.repoConnectForm.orPasteAUrl', 'or paste a URL')}</span></div>
                </>
            )}

            {selectedKey === 'bitbucket' && (
                <>
                    <BitbucketRepoPicker onPick={handleRepoPick} />
                    <div className="git-connect__or"><span>{t('app.repoConnectForm.orPasteAUrl', 'or paste a URL')}</span></div>
                </>
            )}

            {selectedKey === 'gitea' && (
                <>
                    <GiteaRepoPicker onPick={handleRepoPick} />
                    {!giteaRunning && (
                        <div className="git-connect__or"><span>{t('app.repoConnectForm.orPasteAUrl', 'or paste a URL')}</span></div>
                    )}
                </>
            )}

            {error && <div className="error-message">{error}</div>}

            <div className="git-connect__field">
                <Label htmlFor={`${idPrefix}-repo-url`}>{t('app.repoConnectForm.repositoryUrl', 'Repository URL')}</Label>
                <Input
                    id={`${idPrefix}-repo-url`}
                    type="text"
                    name="repoUrl"
                    value={formData.repoUrl}
                    onChange={handleChange}
                    placeholder={selectedProvider.placeholder || urlPlaceholder}
                    required
                />
                {provider && <ProviderBadge provider={provider} />}
            </div>

            <div className="git-connect__field">
                <Label htmlFor={`${idPrefix}-branch`}>{t('common.labels.branch', 'Branch')}</Label>
                <Input
                    id={`${idPrefix}-branch`}
                    type="text"
                    name="branch"
                    value={formData.branch}
                    onChange={handleChange}
                    placeholder="main"
                />
            </div>

            {showPaths && (
                <PathSelector
                    id={`${idPrefix}-paths`}
                    paths={formData.paths}
                    onChange={handlePathsChange}
                    label={pathsLabel ?? t('app.repoConnectForm.trackedPaths', 'Tracked paths')}
                    hint={pathsHint}
                />
            )}

            <div className="git-connect__toggle">
                <div>
                    <strong>{t('app.repoConnectForm.autoDeployOnPush', 'Auto-deploy on push')}</strong>
                    <span>{t('app.repoConnectForm.automaticallyDeployWhenNewCommitsLand', 'Automatically deploy when new commits land on this branch.')}</span>
                </div>
                <Switch
                    checked={formData.autoDeploy}
                    onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, autoDeploy: checked }))
                    }
                />
            </div>

            <div className="git-connect__actions">
                <Button type="submit" disabled={loading}>
                    <GitBranch size={14} />
                    {loading ? t('app.repoConnectForm.connecting', 'Connecting…') : (submitLabel ?? t('app.repoConnectForm.connectRepository', 'Connect repository'))}
                </Button>
            </div>
        </form>
    );
};

export default RepoConnectForm;
