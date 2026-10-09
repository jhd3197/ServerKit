import { useCallback, useState, useEffect  } from 'react';
import { GitMerge } from 'lucide-react';
import api from '../../services/api';
import EmptyState from '../EmptyState';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { InfoList, InfoItem } from '../InfoList';
import DeploymentTimeline from '../deployments/DeploymentTimeline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Pill, statusKind } from '@/components/ds';
import Modal from '@/components/Modal';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard } from '@/components/ui/card';
import { CardFooter as SharedCardFooter } from '@/components/ui/card';

// `embedded` renders this inside the Settings → Git & Deploy section, where the
// shared RepoConnectForm already owns the connect/disconnect + repo identity. In
// that mode we drop the empty-state CTA and the repo-config fields (repo/branch/
// auto-deploy) and surface only the deploy pipeline: run actions, deploy scripts,
// history and config checkpoints.
const DeployTab = ({ appId, embedded = false }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm: confirmDeploy } = useConfirm();
    const [config, setConfig] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [error, setError] = useState(null);

    const [configForm, setConfigForm] = useState({
        repoUrl: '',
        branch: 'main',
        autoDeploy: true,
        preDeployScript: '',
        postDeployScript: ''
    });

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [configRes, historyRes] = await Promise.all([
                api.getDeployConfig(appId),
                api.getDeploymentHistory(appId, 20)
            ]);

            if (configRes.configured) {
                setConfig(configRes.config);
                setConfigForm({
                    repoUrl: configRes.config.repo_url || '',
                    branch: configRes.config.branch || 'main',
                    autoDeploy: configRes.config.auto_deploy !== false,
                    preDeployScript: configRes.config.pre_deploy_script || '',
                    postDeployScript: configRes.config.post_deploy_script || ''
                });
            } else {
                setConfig(null);
            }

            setHistory(historyRes.deployments || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [appId]);

    useEffect(() => {
        loadData();
    }, [loadData]);


    async function handleConfigureDeployment(e) {
        e.preventDefault();
        try {
            await api.configureDeployment(
                appId,
                configForm.repoUrl,
                configForm.branch,
                configForm.autoDeploy,
                configForm.preDeployScript || null,
                configForm.postDeployScript || null
            );
            setShowConfigModal(false);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRemoveDeployment() {
        const confirmed = await confirmDeploy({ titleKey: 'app.deployTab.removeDeployment', title: 'Remove deployment', messageKey: 'app.deployTab.removeDeploymentConfigurationThisWillNot', message: 'Remove deployment settings? This will not delete the repository files.', variant: 'warning' });
        if (!confirmed) return;
        try {
            await api.removeDeployment(appId);
            setConfig(null);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDeploy(force = false) {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.triggerAppDeploy(appId, force);
            if (result.success) {
                toast.success(t('app.deployTab.deploymentCompletedSuccessfully', 'Deployment completed'));
            } else {
                setError(result.error || 'Deployment failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    async function handlePull() {
        setDeploying(true);
        setError(null);
        try {
            const result = await api.pullChanges(appId);
            if (result.success) {
                toast.success(t('app.deployTab.changesPulledSuccessfully', 'Changes pulled'));
            } else {
                setError(result.error || 'Pull failed');
            }
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeploying(false);
        }
    }

    if (loading) {
        return <EmptyState loading loadingVariant="form" title={t('app.deployTab.loadingDeploymentConfiguration', 'Loading deployment settings…')} />;
    }

    return (
        <div className="deploy-tab">
            {error && (
                <div className="alert alert-danger">
                    {error}
                    <Button variant="unstyled" type="button" onClick={() => setError(null)} className="alert-close">&times;</Button>
                </div>
            )}

            {!config ? (
                // Embedded: RepoConnectForm above handles connecting, so don't
                // duplicate the CTA — just show nothing until a repo is linked.
                embedded ? null : (
                <div className="deploy-setup">
                    <EmptyState
                        icon={GitMerge}
                        title={t('app.deployTab.gitDeploymentNotConfigured', 'Git deployment not configured')}
                        description={t('app.deployTab.connectAGitRepositoryToEnable', 'Connect a Git repository to enable automatic deployments via webhooks or manual triggers.')}
                        action={<Button onClick={() => setShowConfigModal(true)}>{t('app.deployTab.configureDeployment', 'Configure deployment')}</Button>}
                    />
                </div>
                )
            ) : (
                <>
                    <div className="deploy-header">
                        <div className="deploy-status-card">
                            <div className="deploy-repo-info">
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                                </svg>
                                {/* Embedded: the connect form above already shows the
                                    repo, so label the action instead of repeating it. */}
                                {embedded ? (
                                    <div>
                                        <span className="repo-url">{t('app.deployTab.manualDeploy', 'Manual deploy')}</span>
                                        <span className="repo-branch">{t('app.deployTab.pullLatestRedeploy', 'Pull latest and redeploy')} {config.branch}</span>
                                    </div>
                                ) : (
                                    <div>
                                        <span className="repo-url">{config.repo_url}</span>
                                        <span className="repo-branch">{t('app.deployTab.branch', 'Branch:')} {config.branch}</span>
                                    </div>
                                )}
                            </div>
                            <div className="deploy-actions">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handlePull}
                                    disabled={deploying}
                                >
                                    {t('app.deployTab.pullOnly', 'Pull only')}
                                </Button>
                                <Button
                                    onClick={() => handleDeploy(false)}
                                    disabled={deploying}
                                >
                                    {deploying ? t('app.deployTab.deploying', 'Deploying…') : t('app.deployTab.deployNow', 'Deploy now')}
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="deploy-grid">
                        <SharedCard variant="legacy" className="card">
                            <h3>{embedded ? t('app.deployTab.deployScripts', 'Deploy scripts') : t('app.deployTab.configuration', 'Configuration')}</h3>
                            {embedded ? (
                                <InfoList>
                                    <InfoItem label={t('app.deployTab.preDeploy', 'Pre-deploy')} value={config.pre_deploy_script || '—'} mono />
                                    <InfoItem label={t('app.deployTab.postDeploy', 'Post-deploy')} value={config.post_deploy_script || '—'} mono />
                                </InfoList>
                            ) : (
                                <InfoList>
                                    <InfoItem label={t('app.deployTab.repository', 'Repository')} value={config.repo_url} mono />
                                    <InfoItem label={t('common.labels.branch', 'Branch')} value={config.branch} />
                                    <InfoItem label={t('app.deployTab.autoDeploy', 'Auto deploy')} value={config.auto_deploy ? 'Enabled' : 'Disabled'} />
                                </InfoList>
                            )}
                            <SharedCardFooter variant="legacy" className="card-actions">
                                <Button variant="outline" size="sm" onClick={() => setShowConfigModal(true)}>
                                    {embedded ? t('app.deployTab.editScripts', 'Edit scripts') : t('common.actions.edit', 'Edit')}
                                </Button>
                                {!embedded && (
                                    <Button variant="destructive" size="sm" onClick={handleRemoveDeployment}>
                                        {t('common.actions.remove', 'Remove')}
                                    </Button>
                                )}
                            </SharedCardFooter>
                        </SharedCard>

                        {history.length > 0 && (
                            <SharedCard variant="legacy" className="card">
                                <h3>{t('app.deployTab.deploymentHistory', 'Deployment history')}</h3>
                                <div className="deployments-list">
                                    {history.slice(0, 5).map((dep, idx) => (
                                        <div key={idx} className="deployment-item">
                                            <Pill kind={statusKind(dep.status)}>{dep.status}</Pill>
                                            <span className="deployment-date">{new Date(dep.timestamp).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </SharedCard>
                        )}
                    </div>
                </>
            )}

            {/* Config snapshot timeline + diff — additive, independent of git
                config so it shows the deploy history & config changes for any app. */}
            <SharedCard variant="legacy" className="card deploy-timeline-card">
                <h3>{t('app.deployTab.configCheckpoints', 'Restore points')}</h3>
                <p className="deploy-timeline-card__hint">
                    {t('app.deployTab.anImmutableConfigCheckpointEnvKeys', 'An immutable restore point (env keys, domains, image, build method, volumes) is captured before each deployment. Secret values are masked. Open a restore point to diff it against the previous one or restore it.')}
                </p>
                <DeploymentTimeline appId={appId} />
            </SharedCard>

            <Modal open={showConfigModal} onClose={() => setShowConfigModal(false)} title={embedded ? t('app.deployTab.editDeployScripts', 'Edit deploy scripts') : t('app.deployTab.configureDeployment', 'Configure deployment')}>
                        <form onSubmit={handleConfigureDeployment}>
                            {/* In embedded mode repo/branch/auto-deploy are owned by the
                                RepoConnectForm above; only the deploy scripts are edited
                                here. The hidden fields stay seeded from `config` so saving
                                preserves them. */}
                            {!embedded && (
                            <>
                            <div className="form-group">
                                <label>{t('app.deployTab.repositoryUrl', 'Repository URL')}</label>
                                <Input
                                    type="text"
                                    value={configForm.repoUrl}
                                    onChange={e => setConfigForm({...configForm, repoUrl: e.target.value})}
                                    placeholder="https://github.com/user/repo.git"
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>{t('common.labels.branch', 'Branch')}</label>
                                <Input
                                    type="text"
                                    value={configForm.branch}
                                    onChange={e => setConfigForm({...configForm, branch: e.target.value})}
                                    placeholder="main"
                                />
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={configForm.autoDeploy}
                                        onChange={e => setConfigForm({...configForm, autoDeploy: e.target.checked})}
                                    />
                                    <span>{t('app.deployTab.enableAutoDeployOnPush', 'Enable auto-deploy on push')}</span>
                                </label>
                            </div>
                            </>
                            )}
                            <div className="form-group">
                                <label>{t('app.deployTab.preDeployScript', 'Pre-deploy script')}</label>
                                <Textarea
                                    value={configForm.preDeployScript}
                                    onChange={e => setConfigForm({...configForm, preDeployScript: e.target.value})}
                                    placeholder={t('app.deployTab.npmInstall', 'npm install')}
                                    rows={3}
                                />
                            </div>
                            <div className="form-group">
                                <label>{t('app.deployTab.postDeployScript', 'Post-deploy script')}</label>
                                <Textarea
                                    value={configForm.postDeployScript}
                                    onChange={e => setConfigForm({...configForm, postDeployScript: e.target.value})}
                                    placeholder={t('app.deployTab.npmRunBuild', 'npm run build')}
                                    rows={3}
                                />
                            </div>
                            <div className="modal-actions">
                                <Button type="button" variant="outline" onClick={() => setShowConfigModal(false)}>
                                    {t('common.actions.cancel', 'Cancel')}
                                </Button>
                                <Button type="submit">
                                    {t('app.deployTab.saveConfiguration', 'Save settings')}
                                </Button>
                            </div>
                        </form>
            </Modal>
        </div>
    );
};

export default DeployTab;
