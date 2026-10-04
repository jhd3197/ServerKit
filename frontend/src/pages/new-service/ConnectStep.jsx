import { Link } from 'react-router-dom';
import {
    FileArchive, Info, RefreshCw, Search, Settings2,
} from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { SOURCE_NEEDS } from './useNewServiceForm';
import { useTranslation } from 'react-i18next';

// Step 2 — Connect. Only the source-specific input, plus the editable detected
// service name + branch shown inline (not buried in Advanced).
const ConnectStep = ({ form }) => {
    const { t } = useTranslation();
    const {
        sourceMode, githubConnection, githubConfigured, reposLoading, repos, repoSearch,
        setRepoSearch, selectedRepo, setSelectedRepo, loadGithubRepos, handleConnectGithub,
        manualRepoUrl, handleManualRepoChange, localPath, setLocalPath, composeFile,
        setComposeFile, systemdUnit, setSystemdUnit, managedBy, setManagedBy,
        uploadFile, onUploadFile, uploadDragOver, setUploadDragOver,
        serviceName, onNameChange, branch, setBranch, branches, branchesLoading,
    } = form;

    const showBranch = sourceMode !== 'local' && sourceMode !== 'upload';

    return (
        <div className="new-service-page__step">
            <div className="new-service-page__step-head">
                <h2>
                    {sourceMode === 'github' ? 'Pick a repository'
                            : sourceMode === 'local' ? 'Point at the service'
                                : sourceMode === 'upload' ? 'Upload the archive'
                                    : 'Connect the remote'}
                </h2>
                {SOURCE_NEEDS[sourceMode] && (
                    <p className="new-service-page__need">
                        <Info size={14} />
                        {SOURCE_NEEDS[sourceMode]}
                    </p>
                )}
            </div>

            {sourceMode === 'github' && (
                <div className="new-service-page__pane">
                    {githubConnection ? (
                        <>
                            <div className="new-service-page__github-account">
                                {githubConnection.avatar_url && <img src={githubConnection.avatar_url} alt="" />}
                                <div>
                                    <strong>{githubConnection.display_name || githubConnection.provider_username}</strong>
                                    <span>@{githubConnection.provider_username}</span>
                                </div>
                                <Button type="button" variant="outline" onClick={() => loadGithubRepos()}>
                                    <RefreshCw size={16} className={reposLoading ? 'spinning' : ''} />
                                    {t('common.actions.refresh', 'Refresh')}
                                </Button>
                            </div>
                            <div className="new-service-page__repo-search">
                                <Search size={16} />
                                <Input
                                    value={repoSearch}
                                    onChange={(e) => setRepoSearch(e.target.value)}
                                    placeholder={t('app.connectStep.searchRepositories', 'Search repositories')}
                                />
                                <Button type="button" variant="outline" onClick={() => loadGithubRepos(repoSearch)}>
                                    {t('app.connectStep.search', 'Search')}
                                </Button>
                            </div>
                            <div className="new-service-page__repo-list">
                                {reposLoading && <div className="new-service-page__repo-state">{t('app.connectStep.loadingRepositories', 'Loading repositories…')}</div>}
                                {!reposLoading && repos.length === 0 && (
                                    <div className="new-service-page__repo-state">{t('app.connectStep.noRepositoriesFound', 'No repositories found.')}</div>
                                )}
                                {!reposLoading && repos.map(repo => (
                                    <Button variant="unstyled"
                                        key={repo.id}
                                        type="button"
                                        className={`new-service-page__repo-row ${selectedRepo?.id === repo.id ? 'new-service-page__repo-row--active' : ''}`}
                                        onClick={() => setSelectedRepo(repo)}
                                    >
                                        <span>
                                            <strong>{repo.full_name}</strong>
                                            <small>{repo.description || repo.language || 'No description'}</small>
                                        </span>
                                        <em>{repo.private ? 'Private' : 'Public'}</em>
                                    </Button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="new-service-page__connect-empty">
                            <span className="new-service-page__connect-icon">
                                <SiGithub size={20} />
                            </span>
                            <div>
                                <h3>{githubConfigured ? 'Connect GitHub' : 'GitHub connection is not configured'}</h3>
                                <p>
                                    {githubConfigured
                                        ? 'Authorize ServerKit once, then choose a repository from your GitHub account.'
                                        : 'Add the GitHub OAuth app credentials in Settings before connecting.'}
                                </p>
                            </div>
                            <div className="new-service-page__connect-actions">
                                <Button type="button" onClick={handleConnectGithub} disabled={!githubConfigured}>
                                    <SiGithub size={16} />
                                    {t('app.connectStep.connectGithub', 'Connect GitHub')}
                                </Button>
                                <Button type="button" variant="outline" asChild>
                                    <Link to="/settings/connections">
                                        <Settings2 size={16} />
                                        {t('common.labels.settings', 'Settings')}
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {sourceMode === 'local' && (
                <div className="new-service-page__pane">
                    <div className="new-service-page__field">
                        <Label htmlFor="local-path">{t('app.connectStep.pathOnServer', 'Path on server')}</Label>
                        <Input
                            id="local-path"
                            value={localPath}
                            onChange={(e) => setLocalPath(e.target.value)}
                            placeholder="/opt/my-service"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="compose-file">{t('app.connectStep.composeFileOptional', 'Compose file (optional)')}</Label>
                        <Input
                            id="compose-file"
                            value={composeFile}
                            onChange={(e) => setComposeFile(e.target.value)}
                            placeholder="docker-compose.yml"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="systemd-unit">{t('app.connectStep.systemdUnitOptional', 'systemd unit (optional)')}</Label>
                        <Input
                            id="systemd-unit"
                            value={systemdUnit}
                            onChange={(e) => setSystemdUnit(e.target.value)}
                            placeholder="my-service"
                            autoComplete="off"
                        />
                    </div>
                    <div className="new-service-page__field">
                        <Label htmlFor="managed-by">{t('app.connectStep.managedBy', 'Managed by')}</Label>
                        <Select value={managedBy} onValueChange={setManagedBy}>
                            <SelectTrigger id="managed-by"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="auto">{t('app.connectStep.autoDetect', 'Auto-detect')}</SelectItem>
                                <SelectItem value="docker_compose">{t('app.connectStep.dockerCompose', 'Docker Compose')}</SelectItem>
                                <SelectItem value="systemd">systemd</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {sourceMode === 'upload' && (
                <div className="new-service-page__pane">
                    <div
                        className={`new-service-page__upload-drop ${uploadDragOver ? 'new-service-page__upload-drop--over' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setUploadDragOver(true); }}
                        onDragLeave={() => setUploadDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setUploadDragOver(false);
                            onUploadFile(e.dataTransfer.files[0]);
                        }}
                        onClick={() => document.getElementById('upload-zip')?.click()}
                    >
                        <FileArchive size={32} />
                        <span>{uploadFile ? uploadFile.name : 'Drag a zip here or click to browse'}</span>
                        <input
                            id="upload-zip"
                            type="file"
                            accept=".zip,application/zip,application/x-zip-compressed"
                            className="sr-only"
                            onChange={(e) => onUploadFile(e.target.files[0])}
                        />
                    </div>
                </div>
            )}

            {sourceMode === 'manual' && (
                <div className="new-service-page__pane">
                    <div className="new-service-page__field">
                        <Label htmlFor="manual-repo-url">{t('app.connectStep.repositoryUrl', 'Repository URL')}</Label>
                        <Input
                            id="manual-repo-url"
                            value={manualRepoUrl}
                            onChange={(e) => handleManualRepoChange(e.target.value)}
                            placeholder="git@gitea.example.com:owner/repo.git"
                            autoComplete="off"
                        />
                    </div>
                </div>
            )}

            {/* Detected service name + branch, editable inline. */}
            <div className="new-service-page__inline-fields">
                <div className="new-service-page__field">
                    <Label htmlFor="service-name-inline">{t('app.connectStep.serviceName', 'Service name')}</Label>
                    <Input
                        id="service-name-inline"
                        value={serviceName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="my-service"
                        minLength={2}
                    />
                </div>
                {showBranch && (
                    <div className="new-service-page__field">
                        <Label htmlFor="branch-inline">{t('common.labels.branch', 'Branch')}</Label>
                        {sourceMode === 'github' && branches.length > 0 ? (
                            <Select value={branch} onValueChange={setBranch} disabled={branchesLoading}>
                                <SelectTrigger id="branch-inline"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {branches.map(option => (
                                        <SelectItem key={option.name} value={option.name}>{option.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input
                                id="branch-inline"
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                placeholder="main"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConnectStep;
