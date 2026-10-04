import { useMemo } from 'react';
import {
    ChevronDown, Database, FolderKanban, Globe, Layers3, Lock, Network,
    Settings2, Zap, CheckCircle2,
} from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import BuildpackPreview from '@/components/buildpack/BuildpackPreview';
import ResourcePicker from '@/components/ResourcePicker';
import PortField from '@/components/PortField';
import { useWorkspace } from '@/contexts/useWorkspace.js';
import { useTranslation } from 'react-i18next';
import {
    APP_TYPE_OPTIONS, BUILD_METHOD_OPTIONS, formatAppType, formatBuildMethod,
} from './useNewServiceForm';
import { Button as SharedButton } from '@/components/ui/button';

// Step 3 — Review & deploy. Only renders cards that have real data; the core
// fields live in one grid, Advanced keeps the genuinely rare bits.
const ReviewStep = ({ form }) => {
    const { t } = useTranslation();
    const { activeWorkspaceId, isAllWorkspaces } = useWorkspace();
    const {
        sourceMode, activeManifest, activeManifestLoading, recommended,
        buildpackEligible, buildpack, buildpackLoading, buildpackOverrides, setBuildpackOverrides,
        serviceName, onNameChange, branch, setBranch, appType, setAppType,
        buildMethod, setBuildMethod, port, setPort, autoDeploy, setAutoDeploy,
        ingressPlane, setIngressPlane, ingressProxyEligible, advancedOpen, setAdvancedOpen,
        projects, selectedProjectId, setSelectedProjectId,
        selectedEnvironmentId, setSelectedEnvironmentId, projectEnvironments,
    } = form;

    const showBuild = sourceMode !== 'local' && sourceMode !== 'upload';
    const envList = activeManifest?.manifest_v1
        ? (activeManifest.manifest_v1.env_required || [])
        : (activeManifest?.env || []);
    const resourceScope = useMemo(() => ({
        workspaceId: isAllWorkspaces ? null : activeWorkspaceId,
    }), [activeWorkspaceId, isAllWorkspaces]);
    const noProjectOption = useMemo(() => ({
        type: 'project-option',
        id: 'none',
        label: t('app.reviewStep.noProject', 'No project'),
        sublabel: '',
        path: '/projects',
        scope: {},
        status: null,
        capabilities: [],
    }), [t]);
    const selectedProject = projects.find((project) => String(project.id) === selectedProjectId);
    const selectedProjectResource = selectedProjectId ? {
        type: 'project',
        id: selectedProjectId,
        label: selectedProject?.name || selectedProjectId,
        sublabel: selectedProject?.description || '',
        path: `/projects/${selectedProjectId}`,
        scope: {
            workspaceId: selectedProject?.workspace_id ?? resourceScope.workspaceId,
            projectId: Number(selectedProjectId),
        },
        status: null,
        capabilities: [],
    } : noProjectOption;
    const selectedEnvironment = projectEnvironments.find((environment) => (
        String(environment.id) === selectedEnvironmentId
    ));
    const selectedEnvironmentResource = selectedEnvironmentId ? {
        type: 'environment',
        id: selectedEnvironmentId,
        label: selectedEnvironment?.name || selectedEnvironmentId,
        sublabel: selectedProject?.name || '',
        path: `/projects/${selectedProjectId}`,
        scope: {
            ...resourceScope,
            projectId: Number(selectedProjectId),
            environmentId: Number(selectedEnvironmentId),
        },
        status: null,
        capabilities: [],
    } : null;

    const handleProjectChange = (resource) => {
        setSelectedEnvironmentId('');
        setSelectedProjectId(resource.type === 'project' ? resource.id : '');
    };

    return (
        <div className="new-service-page__step new-service-page__review" data-walkthrough="service-review">
            <div className="new-service-page__step-head">
                <h2>{t('app.reviewStep.reviewDeploy', 'Review and deploy')}</h2>
            </div>

            {/* Manifest detection — only when there's something to show. */}
            {(activeManifestLoading || activeManifest) && (
                <div className="new-service-page__manifest-card">
                    <div className="new-service-page__manifest-head">
                        <span><Zap size={16} /> {t('app.reviewStep.manifestDetection', 'Manifest detection')}</span>
                        <strong>
                            {activeManifestLoading
                                ? 'Inspecting'
                                : activeManifest?.strategy?.replace('_', ' ') || 'Detected'}
                        </strong>
                    </div>
                    {!activeManifestLoading && activeManifest && (
                        activeManifest.manifest_v1 ? (
                            <div className="new-service-page__manifest-v1">
                                <div className="new-service-page__manifest-services">
                                    {(activeManifest.manifest_v1.services || []).map(svc => (
                                        <div key={svc.name} className="new-service-page__manifest-service">
                                            <span className="new-service-page__manifest-service-name">{svc.name}</span>
                                            {(svc.type || svc.kind) && (
                                                <span className="new-service-page__manifest-badge">{svc.type || svc.kind}</span>
                                            )}
                                            {svc.port ? <span className="new-service-page__manifest-port">:{svc.port}</span> : null}
                                            {svc.auto_deploy && (
                                                <span className="new-service-page__manifest-chip">auto-deploy</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {(activeManifest.manifest_v1.databases || []).length > 0 && (
                                    <div className="new-service-page__manifest-row">
                                        <span className="new-service-page__manifest-row-label">
                                            <Database size={13} /> {t('common.labels.databases', 'Databases')}
                                        </span>
                                        <div className="new-service-page__manifest-tags">
                                            {activeManifest.manifest_v1.databases.map(db => <span key={db}>{db}</span>)}
                                        </div>
                                    </div>
                                )}
                                {(activeManifest.manifest_v1.domains || []).length > 0 && (
                                    <div className="new-service-page__manifest-row">
                                        <span className="new-service-page__manifest-row-label">
                                            <Globe size={13} /> {t('common.labels.domains', 'Domains')}
                                        </span>
                                        <div className="new-service-page__manifest-tags">
                                            {activeManifest.manifest_v1.domains.map(domain => (
                                                <span key={domain.host}>{domain.host}{domain.ssl ? ' · SSL' : ''}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="new-service-page__manifest-grid">
                                    <div><span>{t('common.labels.type', 'Type')}</span><strong>{formatAppType(recommended.app_type)}</strong></div>
                                    <div><span>{t('app.reviewStep.build', 'Build')}</span><strong>{formatBuildMethod(recommended.build_method)}</strong></div>
                                    <div><span>{t('common.labels.port', 'Port')}</span><strong>{recommended.port || 'Auto'}</strong></div>
                                </div>
                                {(activeManifest.manifests || []).length > 0 && (
                                    <div className="new-service-page__manifest-files">
                                        {activeManifest.manifests.slice(0, 5).map(manifest => (
                                            <span key={manifest.file}>
                                                <CheckCircle2 size={13} /> {manifest.file}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </>
                        )
                    )}
                </div>
            )}

            {/* Env requirements list — the one load-bearing note is folded in here. */}
            {envList.length > 0 && (
                <div className="new-service-page__env-card">
                    <div className="new-service-page__env-head">
                        <Lock size={15} /> {t('app.reviewStep.environmentVariables', 'Environment variables')}
                    </div>
                    <div className="new-service-page__env-preview">
                        {envList.map(env => (
                            <span
                                key={`${env.service || ''}.${env.key}`}
                                className={(env.secret || env.source === 'secret')
                                    ? 'new-service-page__env-preview-secret' : ''}
                            >
                                {env.service ? `${env.service}.` : ''}{env.key}{env.required ? ' *' : ''}
                            </span>
                        ))}
                    </div>
                    <p className="new-service-page__env-note">
                        {t('app.reviewStep.secretValuesStayEmptyUntilYou', 'Secret values stay empty until you add them to the service environment.')}
                    </p>
                </div>
            )}

            {buildpackEligible && (buildpackLoading || buildpack?.plan) && (
                <BuildpackPreview
                    plan={buildpack?.plan}
                    dockerfile={buildpack?.dockerfile}
                    overrides={buildpackOverrides}
                    onChange={setBuildpackOverrides}
                    loading={buildpackLoading}
                />
            )}

            {/* Core fields in one tidy grid. */}
            <div className="new-service-page__fields-grid">
                <div className="new-service-page__field">
                    <Label htmlFor="review-name">{t('app.reviewStep.serviceName', 'Service name')}</Label>
                    <Input
                        id="review-name"
                        value={serviceName}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="my-service"
                        minLength={2}
                        required
                    />
                </div>
                {showBuild && (
                    <div className="new-service-page__field">
                        <Label htmlFor="review-branch">{t('common.labels.branch', 'Branch')}</Label>
                        <Input
                            id="review-branch"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="main"
                        />
                    </div>
                )}
                <div className="new-service-page__field">
                    <Label htmlFor="review-type">{t('app.reviewStep.serviceType', 'Service type')}</Label>
                    <Select value={appType} onValueChange={setAppType}>
                        <SelectTrigger id="review-type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {sourceMode === 'upload' && <SelectItem value="auto">{t('app.reviewStep.autoDetect', 'Auto-detect')}</SelectItem>}
                            {APP_TYPE_OPTIONS.filter(o => o.value !== 'auto').map(option => (
                                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {showBuild && (
                    <div className="new-service-page__field">
                        <Label htmlFor="review-build">{t('app.reviewStep.buildMethod', 'Build method')}</Label>
                        <Select value={buildMethod} onValueChange={setBuildMethod}>
                            <SelectTrigger id="review-build"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {BUILD_METHOD_OPTIONS.map(option => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
                <div className="new-service-page__field">
                    <Label htmlFor="review-port">{t('app.reviewStep.runtimePort', 'Runtime port')}</Label>
                    <PortField
                        id="review-port"
                        value={port}
                        onChange={setPort}
                        placeholder="3000"
                    />
                </div>
                <div className="new-service-page__field">
                    <Label htmlFor="review-ingress">{t('app.reviewStep.ingress', 'Ingress')}</Label>
                    {ingressProxyEligible ? (
                        <Select value={ingressPlane} onValueChange={setIngressPlane}>
                            <SelectTrigger id="review-ingress"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="nginx">{t('app.reviewStep.hostNginxDefault', 'Host Nginx (default)')}</SelectItem>
                                <SelectItem value="proxy_stack">{t('app.reviewStep.proxyStackTraefikCaddy', 'Proxy stack (Traefik / Caddy)')}</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="new-service-page__note">
                            <Network size={16} />
                            <span>{t('app.reviewStep.servedByHostNginx', 'Served by host Nginx')}</span>
                        </div>
                    )}
                </div>
                {sourceMode !== 'local' && (
                    <div className="new-service-page__toggle">
                        <div>
                            <Label>{t('app.reviewStep.autoDeploy', 'Auto-deploy')}</Label>
                            <span>{sourceMode === 'upload' ? 'Deploy immediately after upload.' : 'Webhook deployment for this branch.'}</span>
                        </div>
                        <Switch checked={autoDeploy} onCheckedChange={setAutoDeploy} />
                    </div>
                )}
            </div>

            <div className="new-service-page__fields-grid">
                <div className="new-service-page__field">
                    <Label>
                        {t('common.labels.project', 'Project')} <span className="new-service-page__optional">(optional)</span>
                    </Label>
                    <ResourcePicker
                        value={selectedProjectResource}
                        onChange={handleProjectChange}
                        types={['project']}
                        scope={resourceScope}
                        staticOptions={[noProjectOption]}
                        icon={FolderKanban}
                        label={t('common.labels.project', 'Project')}
                        placeholder={t('app.reviewStep.noProject', 'No project')}
                        searchPlaceholder={t('app.projects.searchProjects', 'Search projects…')}
                        className="new-service-page__resource-picker"
                    />
                </div>
                {selectedProjectId && (
                    <div className="new-service-page__field">
                        <Label>{t('app.reviewStep.environment', 'Environment')}</Label>
                        <ResourcePicker
                            value={selectedEnvironmentResource}
                            onChange={(resource) => setSelectedEnvironmentId(resource.id)}
                            types={['environment']}
                            scope={{ ...resourceScope, projectId: selectedProjectId }}
                            icon={Layers3}
                            label={t('app.reviewStep.environment', 'Environment')}
                            placeholder={t('app.reviewStep.environment', 'Environment')}
                            searchPlaceholder={t('app.reviewStep.environment', 'Environment')}
                            className="new-service-page__resource-picker"
                        />
                    </div>
                )}
            </div>

            {/* Advanced keeps only the genuinely rare bits. */}
            {showBuild && (
                <>
                    <SharedButton variant="unstyled"
                        type="button"
                        className="new-service-page__advanced-toggle"
                        onClick={() => setAdvancedOpen(open => !open)}
                        aria-expanded={advancedOpen}
                    >
                        <span><Settings2 size={16} /> {t('app.reviewStep.advanced', 'Advanced')}</span>
                        <ChevronDown size={16} />
                    </SharedButton>
                    {advancedOpen && (
                        <div className="new-service-page__advanced">
                            <p className="new-service-page__advanced-note">
                                {t('app.reviewStep.detectedManifestSettingsDockerfilePathBuild', 'Detected manifest settings (Dockerfile path, build/start commands) are applied automatically when present. Override the fields above if the detection is wrong.')}
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default ReviewStep;
