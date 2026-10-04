import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { toastError } from '@/utils/errorMessage';

export const APP_TYPE_OPTIONS = [
    { value: 'auto', labelKey: 'app.useNewServiceForm.autoDetect', label: 'Auto-detect' },
    { value: 'docker', labelKey: 'app.useNewServiceForm.dockerCompose', label: 'Docker / Compose' },
    { value: 'flask', labelKey: 'app.useNewServiceForm.python', label: 'Python' },
    { value: 'django', labelKey: 'app.useNewServiceForm.django', label: 'Django' },
    { value: 'php', label: 'PHP' },
    { value: 'static', labelKey: 'app.useNewServiceForm.staticSite', label: 'Static site' },
];

export const BUILD_METHOD_OPTIONS = [
    { value: 'auto', labelKey: 'app.useNewServiceForm.autoBuild', label: 'Auto build' },
    { value: 'nixpacks', labelKey: 'app.useNewServiceForm.nixpacks', label: 'Nixpacks' },
    { value: 'dockerfile', labelKey: 'app.useNewServiceForm.dockerfile', label: 'Dockerfile' },
    { value: 'custom', labelKey: 'app.useNewServiceForm.customCommand', label: 'Custom command' },
];

const APP_TYPE_LABELS = Object.fromEntries(APP_TYPE_OPTIONS.map(o => [o.value, o.label]));
const BUILD_METHOD_LABELS = Object.fromEntries(BUILD_METHOD_OPTIONS.map(o => [o.value, o.label]));

// One inline "you'll need X" line per source — replaces the old three-part
// SOURCE_GUIDES explainer block.
export const SOURCE_NEEDS = {
    github: 'A GitHub account connected via OAuth (Settings → Connections).',
    manual: 'The repository URL, plus a deploy key or credentials if it is private.',
    local: 'The path on the server, and its compose file or systemd unit if any.',
    upload: 'A .zip of the project (with a Dockerfile/compose or a detectable runtime).',
};

export function slugify(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function repoNameFromUrl(value) {
    if (!value) return '';
    const cleaned = value.trim().replace(/\.git$/, '');
    const parts = cleaned.split(/[/:]/).filter(Boolean);
    return slugify(parts[parts.length - 1] || '');
}

export function normalizeManualRepo(value) {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}.git`;
    if (/^github\.com\//i.test(trimmed)) return `https://${trimmed.replace(/\.git$/, '')}.git`;
    return trimmed;
}

export function formatAppType(value) {
    return APP_TYPE_LABELS[value] || value || 'Auto-detect';
}

export function formatBuildMethod(value) {
    return BUILD_METHOD_LABELS[value] || value || 'Auto build';
}

/**
 * All state, derived values, and handlers for the New Service wizard. Kept in a
 * hook so the page component is just step orchestration + submit, and the step
 * components stay presentational. Submit payloads are byte-identical to the
 * pre-redesign monolith — this is a flow re-skin, not a backend change.
 */
export function useNewServiceForm() {
    const navigate = useNavigate();
    const toast = useToast();
    const { t } = useTranslation();
    const [searchParams] = useSearchParams();

    const [step, setStep] = useState(1);
    const [sourceMode, setSourceMode] = useState('github');

    const [githubStatus, setGithubStatus] = useState(null);
    const [repos, setRepos] = useState([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [repoSearch, setRepoSearch] = useState('');
    const [selectedRepo, setSelectedRepo] = useState(null);

    const [branches, setBranches] = useState([]);
    const [branchesLoading, setBranchesLoading] = useState(false);
    const [repoManifest, setRepoManifest] = useState(null);
    const [repoManifestLoading, setRepoManifestLoading] = useState(false);
    const [manualRepoUrl, setManualRepoUrl] = useState('');

    const [name, setName] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [branch, setBranch] = useState('main');
    const [appType, setAppType] = useState('auto');
    const [buildMethod, setBuildMethod] = useState('auto');
    const [port, setPort] = useState('');
    const [ingressPlane, setIngressPlane] = useState('nginx');
    const [autoDeploy, setAutoDeploy] = useState(true);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const [buildpack, setBuildpack] = useState(null);
    const [buildpackLoading, setBuildpackLoading] = useState(false);
    const [buildpackOverrides, setBuildpackOverrides] = useState({});

    const [localPath, setLocalPath] = useState('');
    const [composeFile, setComposeFile] = useState('');
    const [systemdUnit, setSystemdUnit] = useState('');
    const [managedBy, setManagedBy] = useState('auto');

    const [uploadFile, setUploadFile] = useState(null);
    const [uploadDragOver, setUploadDragOver] = useState(false);

    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState('');
    const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
    const [projectEnvironments, setProjectEnvironments] = useState([]);

    const githubConnection = githubStatus?.connection;
    const githubConfigured = githubStatus?.configured;
    const normalizedManualRepo = useMemo(() => normalizeManualRepo(manualRepoUrl), [manualRepoUrl]);

    const activeManifest = repoManifest;
    const activeManifestLoading = repoManifestLoading;
    const recommended = activeManifest?.recommended || {};

    const detectedServiceName = useMemo(() => {
        if (sourceMode === 'github' && selectedRepo) return slugify(selectedRepo.name || '');
        return repoNameFromUrl(normalizedManualRepo);
    }, [normalizedManualRepo, selectedRepo, sourceMode]);

    const serviceName = nameTouched ? name : detectedServiceName;

    const canSubmit = sourceMode === 'github'
        ? Boolean(githubConnection && selectedRepo && serviceName?.length >= 2)
        : sourceMode === 'local'
            ? Boolean(serviceName?.length >= 2 && localPath?.length >= 1)
            : sourceMode === 'upload'
                ? Boolean(serviceName?.length >= 2 && uploadFile)
                : Boolean(normalizedManualRepo && serviceName?.length >= 2);

    // Whether step 2 (Connect) has enough input to move on to Review.
    const canProceedFromConnect = sourceMode === 'github'
        ? Boolean(githubConnection && selectedRepo)
        : sourceMode === 'local'
            ? Boolean(localPath?.length >= 1)
            : sourceMode === 'upload'
                ? Boolean(uploadFile)
                : Boolean(normalizedManualRepo);

    const buildSummary = buildMethod === 'auto' && recommended.build_method
        ? `Auto → ${formatBuildMethod(recommended.build_method)}`
        : formatBuildMethod(buildMethod);

    const ingressProxyEligible = appType === 'docker'
        || appType === 'auto'
        || (sourceMode === 'local' && managedBy === 'docker_compose');

    const buildpackEligible = (buildMethod === 'auto' || buildMethod === 'nixpacks')
        && (sourceMode === 'github' || sourceMode === 'manual');

    const loadGithubStatus = useCallback(async () => {
        try {
            const data = await api.getGithubSourceStatus();
            setGithubStatus(data);
        } catch (err) {
            toastError(toast, t('app.useNewServiceForm.failedToLoadGithubConnection', 'Failed to load GitHub connection'), err);
        }
    }, [t, toast]);

    const loadGithubRepos = useCallback(async (search = '') => {
        setReposLoading(true);
        try {
            const data = await api.listGithubRepositories({ search, perPage: 80 });
            setRepos(data.repos || []);
        } catch (err) {
            toastError(toast, t('app.useNewServiceForm.failedToLoadGithubRepositories', 'Failed to load GitHub repositories'), err);
        } finally {
            setReposLoading(false);
        }
    }, [t, toast]);

    const loadBranches = useCallback(async (fullName) => {
        setBranchesLoading(true);
        try {
            const data = await api.listGithubBranches(fullName);
            setBranches(data.branches || []);
        } catch (err) {
            setBranches([]);
            toastError(toast, t('app.useNewServiceForm.failedToLoadBranches', 'Failed to load branches'), err);
        } finally {
            setBranchesLoading(false);
        }
    }, [t, toast]);

    useEffect(() => { loadGithubStatus(); }, [loadGithubStatus]);

    useEffect(() => {
        if (!ingressProxyEligible && ingressPlane !== 'nginx') {
            setIngressPlane('nginx');
        }
    }, [ingressProxyEligible, ingressPlane]);

    useEffect(() => {
        let cancelled = false;
        api.getProjects()
            .then(data => {
                if (cancelled) return;
                setProjects(Array.isArray(data?.projects) ? data.projects : []);
            })
            .catch(() => { if (!cancelled) setProjects([]); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        setProjectEnvironments([]);
        setSelectedEnvironmentId('');
        if (!selectedProjectId) {
            return undefined;
        }
        let cancelled = false;
        api.getProject(selectedProjectId)
            .then(data => {
                if (cancelled) return;
                const envs = Array.isArray(data?.project?.environments) ? data.project.environments : [];
                setProjectEnvironments(envs);
                const def = envs.find(e => e.is_default) || envs[0];
                setSelectedEnvironmentId(def ? String(def.id) : '');
            })
            .catch(() => {
                if (!cancelled) {
                    setProjectEnvironments([]);
                    setSelectedEnvironmentId('');
                }
            });
        return () => { cancelled = true; };
    }, [selectedProjectId]);

    useEffect(() => {
        if (sourceMode === 'github' && githubConnection) {
            loadGithubRepos();
        }
    }, [sourceMode, githubConnection, loadGithubRepos]);

    useEffect(() => {
        if (selectedRepo) {
            setBranch(selectedRepo.default_branch || 'main');
            loadBranches(selectedRepo.full_name);
        }
    }, [selectedRepo, loadBranches]);

    useEffect(() => {
        if (sourceMode !== 'github' || !selectedRepo) {
            setRepoManifest(null);
            setRepoManifestLoading(false);
            return undefined;
        }
        let cancelled = false;
        setRepoManifestLoading(true);
        api.inspectGithubRepositoryManifest(selectedRepo.full_name, branch || selectedRepo.default_branch || 'main')
            .then((data) => {
                if (cancelled) return;
                const manifest = data.manifest || null;
                setRepoManifest(manifest);
                const detectedPort = manifest?.recommended?.port;
                if (!port && detectedPort) setPort(String(detectedPort));
            })
            .catch((err) => {
                if (!cancelled) {
                    setRepoManifest(null);
                    toastError(toast, t('app.useNewServiceForm.failedToInspectManifests', 'Failed to inspect repository manifests'), err);
                }
            })
            .finally(() => { if (!cancelled) setRepoManifestLoading(false); });
        return () => { cancelled = true; };
    }, [branch, port, selectedRepo, sourceMode, t, toast]);

    useEffect(() => {
        if (selectedRepo && !nameTouched) {
            setName(slugify(selectedRepo.name || ''));
        }
    }, [selectedRepo, nameTouched]);

    // Build-pack detection (zero-Dockerfile). Only repo-based sources.
    useEffect(() => {
        if (!buildpackEligible) {
            setBuildpack(null);
            setBuildpackLoading(false);
            return undefined;
        }
        const body = { branch: branch || 'main', name: detectedServiceName || 'app' };
        if (sourceMode === 'github' && selectedRepo && githubConnection) {
            body.source_connection_id = githubConnection.id;
            body.repository_full_name = selectedRepo.full_name;
            body.repo_url = `https://github.com/${selectedRepo.full_name}.git`;
        } else if (sourceMode === 'manual' && normalizedManualRepo) {
            body.repo_url = normalizedManualRepo;
        } else {
            setBuildpack(null);
            return undefined;
        }
        let cancelled = false;
        setBuildpackLoading(true);
        setBuildpackOverrides({});
        api.detectBuildpack(body)
            .then((data) => { if (!cancelled) setBuildpack(data); })
            .catch(() => { if (!cancelled) setBuildpack(null); })
            .finally(() => { if (!cancelled) setBuildpackLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [buildpackEligible, sourceMode, selectedRepo, normalizedManualRepo, branch, githubConnection]);

    async function handleConnectGithub() {
        try {
            const redirectUri = `${window.location.origin}/connections/callback/github`;
            sessionStorage.setItem('sourceConnectionReturnTo', '/services/new');
            const { auth_url } = await api.startSourceConnection('github', redirectUri);
            window.location.href = auth_url;
        } catch (err) {
            toastError(toast, t('app.useNewServiceForm.failedToStartGithubConnection', 'Failed to start GitHub connection'), err);
        }
    }

    function selectSource(mode) {
        setSourceMode(mode);
        if (mode === 'local') setAppType('docker');
        if (mode === 'upload') setAppType('auto');
        window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
            detail: { type: 'service-source-selected', mode },
        }));
    }

    // Pick a template by id (deep link or list click): fetch its detail, then apply.
    function handleManualRepoChange(value) {
        setManualRepoUrl(value);
        if (!nameTouched) setName(repoNameFromUrl(normalizeManualRepo(value)));
    }

    function onNameChange(value) {
        setNameTouched(true);
        setName(slugify(value));
    }

    function onUploadFile(file) {
        if (!file) return;
        setUploadFile(file);
        if (!nameTouched) setName(slugify(file.name.replace(/\.zip$/i, '')));
    }

    // Deep links: ?source=<mode> lands preloaded on the Connect step. Runs once
    // on mount.
    //
    // ?template=<id> is kept working but forwarded: templates now deploy from
    // the drawer on /templates, so an old link lands on the same surface the
    // catalog's own cards open rather than a second, different one.
    useEffect(() => {
        const templateId = searchParams.get('template');
        const source = searchParams.get('source');
        if (templateId) {
            navigate(`/templates?install=${encodeURIComponent(templateId)}`, { replace: true });
            return;
        }
        if (source && ['github', 'manual', 'local', 'upload'].includes(source)) {
            selectSource(source);
            setStep(2);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function handleSubmit(e) {
        if (e) e.preventDefault();
        if (!canSubmit) {
            const msg = sourceMode === 'github'
                ? 'Select a GitHub repository'
                : sourceMode === 'template'
                    ? 'Select a service template'
                    : sourceMode === 'local'
                        ? 'Service name and server path are required'
                        : sourceMode === 'upload'
                            ? 'Service name and a zip file are required'
                            : 'Repository URL is required';
            toast.error(msg);
            return;
        }

        setSubmitting(true);
        const projectEnvPayload = {};
        if (selectedProjectId) {
            projectEnvPayload.project_id = Number(selectedProjectId);
            if (selectedEnvironmentId) projectEnvPayload.environment_id = Number(selectedEnvironmentId);
        }
        try {
            if (sourceMode === 'local') {
                const payload = {
                    name: serviceName,
                    app_type: appType,
                    root_path: localPath.trim(),
                    compose_file: composeFile.trim() || undefined,
                    systemd_unit: systemdUnit.trim() || undefined,
                    managed_by: managedBy === 'auto' ? undefined : managedBy,
                    ingress_plane: ingressProxyEligible ? ingressPlane : 'nginx',
                    ...projectEnvPayload,
                };
                const result = await api.createManualApp(payload);
                window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                    detail: { type: 'service-created', appId: result.app.id },
                }));
                toast.success(t('app.useNewServiceForm.manualServiceRegistered', 'Manual service registered'));
                navigate(`/services/${result.app.id}`);
            } else if (sourceMode === 'upload') {
                const formData = new FormData();
                formData.append('file', uploadFile);
                formData.append('name', serviceName);
                formData.append('app_type', appType);
                formData.append('auto_deploy', autoDeploy ? 'true' : 'false');
                formData.append('ingress_plane', ingressProxyEligible ? ingressPlane : 'nginx');
                if (projectEnvPayload.project_id) formData.append('project_id', projectEnvPayload.project_id);
                if (projectEnvPayload.environment_id) formData.append('environment_id', projectEnvPayload.environment_id);
                const result = await api.uploadAppZip(formData);
                window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                    detail: { type: 'service-created', appId: result.app.id },
                }));
                toast.success(t('app.useNewServiceForm.uploadServiceCreated', 'Upload service created'));
                navigate(`/services/${result.app.id}`);
            } else {
                const payload = {
                    name: serviceName,
                    branch: branch.trim() || null,
                    app_type: appType,
                    build_method: buildMethod,
                    port: port ? Number(port) : null,
                    auto_deploy: autoDeploy,
                    ingress_plane: ingressProxyEligible ? ingressPlane : 'nginx',
                    ...projectEnvPayload,
                };
                if (recommended.dockerfile_path) payload.dockerfile_path = recommended.dockerfile_path;
                if (recommended.custom_build_cmd) payload.custom_build_cmd = recommended.custom_build_cmd;
                if (recommended.custom_start_cmd) payload.custom_start_cmd = recommended.custom_start_cmd;
                if (buildpackEligible && buildpack?.plan) {
                    payload.buildpack_plan = buildpack.plan;
                    if (Object.keys(buildpackOverrides).length > 0) {
                        payload.buildpack_overrides = buildpackOverrides;
                    }
                }

                if (sourceMode === 'github') {
                    payload.source_connection_id = githubConnection.id;
                    payload.repository_full_name = selectedRepo.full_name;
                    payload.repo_url = `https://github.com/${selectedRepo.full_name}.git`;
                } else {
                    payload.repo_url = normalizedManualRepo;
                }

                const result = await api.createAppFromRepository(payload);
                window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                    detail: { type: 'service-created', appId: result.app?.id },
                }));
                if (result.deploy_job_id) {
                    // A deploy job was queued — take the user straight to the
                    // full-page Deploy Console to watch the build/startup live.
                    toast.success(t('app.useNewServiceForm.repositoryServiceCreatedDeploying', 'Repository service created. Deploying…'));
                    navigate(`/deployments/${result.deploy_job_id}`);
                } else {
                    toast.success(t('app.useNewServiceForm.repositoryServiceCreated', 'Repository service created'));
                    toast.warning(t('app.useNewServiceForm.serviceCreatedWithoutAutoDeploy', 'Service was created without auto-deploy. Start it manually from the service page.'));
                    navigate(`/services/${result.app.id}`);
                }
            }
        } catch (err) {
            toastError(toast, t('app.useNewServiceForm.failedToCreateService', 'Failed to create service'), err);
        } finally {
            setSubmitting(false);
        }
    }

    return {
        // step control
        step, setStep,
        // source
        sourceMode, selectSource,
        // github
        githubStatus, githubConnection, githubConfigured,
        repos, reposLoading, repoSearch, setRepoSearch, selectedRepo, setSelectedRepo,
        loadGithubRepos, handleConnectGithub, branches, branchesLoading,
        // manual / local / upload
        manualRepoUrl, handleManualRepoChange, normalizedManualRepo,
        localPath, setLocalPath, composeFile, setComposeFile,
        systemdUnit, setSystemdUnit, managedBy, setManagedBy,
        uploadFile, onUploadFile, uploadDragOver, setUploadDragOver,
        // core fields
        name, serviceName, onNameChange, nameTouched,
        branch, setBranch, appType, setAppType, buildMethod, setBuildMethod,
        port, setPort, ingressPlane, setIngressPlane, autoDeploy, setAutoDeploy,
        advancedOpen, setAdvancedOpen,
        // manifest / buildpack
        activeManifest, activeManifestLoading, recommended, buildSummary,
        buildpack, buildpackLoading, buildpackOverrides, setBuildpackOverrides, buildpackEligible,
        // projects
        projects, selectedProjectId, setSelectedProjectId,
        selectedEnvironmentId, setSelectedEnvironmentId, projectEnvironments,
        // derived + submit
        ingressProxyEligible, canSubmit, canProceedFromConnect, submitting, handleSubmit,
    };
}
