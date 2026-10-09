// Applications, app linking, environment variables, private URLs,
// templates, builds, deployments

// Apps endpoints
export async function getApps(options = {}) {
    // allWorkspaces neutralizes the ambient X-Workspace-Id header (sends it empty)
    // so a cross-workspace view (e.g. resource management) sees every app, not just
    // the active workspace's.
    const config = options.allWorkspaces ? { headers: { 'X-Workspace-Id': '' } } : {};
    return this.request('/apps', config);
}

// "Services" is the user-facing term for what the backend calls Applications
// (§1 unification). These aliases let new code speak "services" while the
// API client and backend model keep the canonical `apps`/`Application` names.
export async function getAppServices(options = {}) {
    return getApps.call(this, options);
}

export async function getService(id) {
    return getApp.call(this, id);
}

// Reassign an application to a workspace (#33). Pass null to move it to Default.
export async function setAppWorkspace(appId, workspaceId) {
    return this.request(`/apps/${appId}/workspace`, {
        method: 'PUT',
        body: { workspace_id: workspaceId },
    });
}

// Per-resource access grants (#33 per-site ACL): share an app with a user.
export async function getAppGrants(appId) {
    return this.request(`/apps/${appId}/grants`);
}

export async function grantAppAccess(appId, userId, role) {
    return this.request(`/apps/${appId}/grants`, { method: 'POST', body: { user_id: userId, role } });
}

export async function revokeAppAccess(appId, grantId) {
    return this.request(`/apps/${appId}/grants/${grantId}`, { method: 'DELETE' });
}

export async function getApp(id) {
    return this.request(`/apps/${id}`);
}

// Member-visible summary of an app's related resources (domains, managed DBs,
// backup status, deployments). Read-only; any workspace member can load it.
export async function getAppRelatedResources(id) {
    return this.request(`/apps/${id}/related`);
}

export async function createApp(appData) {
    return this.request('/apps', {
        method: 'POST',
        body: appData,
    });
}

export async function createAppFromRepository(appData) {
    return this.request('/apps/from-repository', {
        method: 'POST',
        body: appData,
    });
}

export async function createManualApp(appData) {
    return this.request('/apps/manual', {
        method: 'POST',
        body: appData,
    });
}

export async function uploadAppZip(formData) {
    return this.request('/apps/upload', {
        method: 'POST',
        body: formData,
        headers: {},
    });
}

export async function getAppVersions(appId) {
    return this.request(`/apps/${appId}/versions`);
}

export async function rollbackAppVersion(appId, version) {
    return this.request(`/apps/${appId}/rollback`, {
        method: 'POST',
        body: { version },
    });
}

export async function updateApp(id, appData) {
    return this.request(`/apps/${id}`, {
        method: 'PUT',
        body: appData,
    });
}

export async function deleteApp(id) {
    return this.request(`/apps/${id}`, {
        method: 'DELETE',
    });
}

// Per-app managed volumes — first-class persistent storage that survives
// redeploys. Listing joins live Docker state (present/mountpoint/size).
export async function getAppVolumes(id) {
    return this.request(`/apps/${id}/volumes`);
}

export async function attachAppVolume(id, data) {
    return this.request(`/apps/${id}/volumes`, { method: 'POST', body: data });
}

export async function detachAppVolume(id, volumeId, { wipe = false } = {}) {
    const q = wipe ? '?wipe=true' : '';
    return this.request(`/apps/${id}/volumes/${volumeId}${q}`, { method: 'DELETE' });
}

export async function convertAppBindMount(id, data) {
    return this.request(`/apps/${id}/volumes/convert`, { method: 'POST', body: data });
}

// Per-app resource limits (Docker CPU/memory caps) + best-effort live usage.
export async function getAppResources(id) {
    return this.request(`/apps/${id}/resources`);
}

export async function updateAppResources(id, data) {
    return this.request(`/apps/${id}/resources`, { method: 'PUT', body: data });
}

// Per-site nginx micro-cache (short-TTL page cache with auth/admin/cart bypasses).
// ttl: whole seconds (1-300), null for the 10s default, undefined to leave as is.
export async function setMicroCache(id, enabled, ttl) {
    const body = ttl === undefined ? { enabled } : { enabled, ttl };
    return this.request(`/apps/${id}/micro-cache`, { method: 'PUT', body });
}

export async function purgeMicroCache(id) {
    return this.request(`/apps/${id}/micro-cache/purge`, { method: 'POST' });
}

export async function startApp(id) {
    return this.request(`/apps/${id}/start`, { method: 'POST' });
}

export async function stopApp(id) {
    return this.request(`/apps/${id}/stop`, { method: 'POST' });
}

export async function restartApp(id) {
    return this.request(`/apps/${id}/restart`, { method: 'POST' });
}

// App linking endpoints
export async function linkApp(appId, targetAppId, asEnvironment, options = {}) {
    return this.request(`/apps/${appId}/link`, {
        method: 'POST',
        body: {
            target_app_id: targetAppId,
            as_environment: asEnvironment,
            propagate_credentials: options.propagateCredentials !== false,
            table_prefix: options.tablePrefix
        }
    });
}

export async function getLinkedApps(appId) {
    return this.request(`/apps/${appId}/linked`);
}

export async function unlinkApp(appId) {
    return this.request(`/apps/${appId}/link`, {
        method: 'DELETE'
    });
}

export async function updateAppEnvironment(appId, environmentType) {
    return this.request(`/apps/${appId}/environment`, {
        method: 'PUT',
        body: { environment_type: environmentType }
    });
}

// Private URL endpoints
export async function enablePrivateUrl(appId, slug = null) {
    return this.request(`/apps/${appId}/private-url`, {
        method: 'POST',
        body: slug ? { slug } : {}
    });
}

export async function getPrivateUrl(appId) {
    return this.request(`/apps/${appId}/private-url`);
}

export async function updatePrivateUrl(appId, slug) {
    return this.request(`/apps/${appId}/private-url`, {
        method: 'PUT',
        body: { slug }
    });
}

export async function disablePrivateUrl(appId) {
    return this.request(`/apps/${appId}/private-url`, {
        method: 'DELETE'
    });
}

export async function regeneratePrivateUrl(appId) {
    return this.request(`/apps/${appId}/private-url/regenerate`, {
        method: 'POST'
    });
}

// Environment Variables endpoints
export async function getEnvVars(appId, maskSecrets = false) {
    const params = maskSecrets ? '?mask=true' : '';
    return this.request(`/apps/${appId}/env${params}`);
}

export async function getEnvVar(appId, key) {
    return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`);
}

export async function createEnvVar(appId, key, value, isSecret = false, description = null, targetService = null) {
    const body = { key, value, is_secret: isSecret, description };
    // Only send target_service when set; empty/null means "all services".
    if (targetService) body.target_service = targetService;
    return this.request(`/apps/${appId}/env`, {
        method: 'POST',
        body
    });
}

export async function updateEnvVar(appId, key, data) {
    return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: data
    });
}

export async function deleteEnvVar(appId, key) {
    return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`, {
        method: 'DELETE'
    });
}

export async function bulkSetEnvVars(appId, envVars) {
    return this.request(`/apps/${appId}/env/bulk`, {
        method: 'POST',
        body: { env_vars: envVars }
    });
}

export async function importEnvFile(appId, content, overwrite = true) {
    return this.request(`/apps/${appId}/env/import`, {
        method: 'POST',
        body: { content, overwrite }
    });
}

export async function exportEnvFile(appId, includeSecrets = true) {
    const params = includeSecrets ? '' : '?include_secrets=false';
    return this.request(`/apps/${appId}/env/export${params}`);
}

export async function getEnvVarHistory(appId, limit = 50) {
    return this.request(`/apps/${appId}/env/history?limit=${encodeURIComponent(limit)}`);
}

export async function clearEnvVars(appId) {
    return this.request(`/apps/${appId}/env/clear`, {
        method: 'DELETE'
    });
}

// Compose service names for an app (empty list for non-compose apps).
// Used to target an env var at a single compose service.
export async function getComposeServices(appId) {
    return this.request(`/apps/${appId}/compose-services`);
}

// Docker App Logs and Status
export async function getDockerAppLogs(appId, lines = 100) {
    return this.request(`/apps/${appId}/logs?lines=${encodeURIComponent(lines)}`);
}

export async function getDockerAppStatus(appId) {
    return this.request(`/apps/${appId}/status`);
}

// Template endpoints
export async function listTemplates(category = null, search = null) {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (search) params.append('search', search);
    const query = params.toString();
    return this.request(`/templates/${query ? '?' + query : ''}`);
}

export async function getTemplateCategories() {
    return this.request('/templates/categories');
}

export async function getTemplate(templateId) {
    return this.request(`/templates/${templateId}`);
}

// Inspect a repo-kind template's public repository for deploy manifests.
// Returns { manifest, source: 'repo' | 'template-hints' }.
export async function inspectTemplateManifest(templateId, branch = null) {
    const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
    return this.request(`/templates/${templateId}/manifest${query}`);
}

export async function installTemplate(templateId, appName, variables = {}, options = {}) {
    const body = {
        app_name: appName,
        variables,
        server_id: options.serverId || 'local',
        wait: options.wait || false,
    };
    // Only sent when the drawer actually promised a <name>.<base> hostname;
    // omitted otherwise so the template's own auto_domain setting decides.
    if (options.autoDomain != null) {
        body.auto_domain = !!options.autoDomain;
    }
    return this.request(`/templates/${templateId}/install`, { method: 'POST', body });
}

export async function validateTemplateInstall(templateId, appName, variables = {}, serverId = null) {
    return this.request('/templates/validate-install', {
        method: 'POST',
        body: { template_id: templateId, app_name: appName, variables, server_id: serverId }
    });
}

// Whether a template fits on a server: what it typically needs, against what
// that server has free. Advisory — a poor verdict never blocks an install.
export async function getTemplateCapacity(templateId, serverId = null) {
    const query = serverId && serverId !== 'local' ? `?server_id=${encodeURIComponent(serverId)}` : '';
    return this.request(`/templates/${templateId}/capacity${query}`);
}

export async function testDatabaseConnection(config) {
    return this.request('/templates/test-db-connection', {
        method: 'POST',
        body: config
    });
}

export async function checkAppUpdate(appId) {
    return this.request(`/templates/apps/${appId}/check-update`);
}

export async function updateAppFromTemplate(appId) {
    return this.request(`/templates/apps/${appId}/update`, { method: 'POST' });
}

export async function getAppTemplateInfo(appId) {
    return this.request(`/templates/apps/${appId}/template-info`);
}

export async function listTemplateRepos() {
    return this.request('/templates/repos');
}

export async function addTemplateRepo(name, url) {
    return this.request('/templates/repos', {
        method: 'POST',
        body: { name, url }
    });
}

export async function removeTemplateRepo(url) {
    return this.request('/templates/repos', {
        method: 'DELETE',
        body: { url }
    });
}

export async function syncTemplates() {
    return this.request('/templates/sync', { method: 'POST' });
}

// Git Deployment endpoints
export async function getDeployConfig(appId) {
    return this.request(`/deploy/apps/${appId}/config`);
}

export async function configureDeployment(appId, repoUrl, branch = 'main', autoDeploy = true, preDeployScript = null, postDeployScript = null) {
    return this.request(`/deploy/apps/${appId}/config`, {
        method: 'POST',
        body: {
            repo_url: repoUrl,
            branch,
            auto_deploy: autoDeploy,
            pre_deploy_script: preDeployScript,
            post_deploy_script: postDeployScript
        }
    });
}

export async function removeDeployment(appId) {
    return this.request(`/deploy/apps/${appId}/config`, { method: 'DELETE' });
}

export async function triggerAppDeploy(appId, force = false) {
    return this.request(`/deploy/apps/${appId}/deploy`, {
        method: 'POST',
        body: { force }
    });
}

export async function pullChanges(appId, branch = null) {
    return this.request(`/deploy/apps/${appId}/pull`, {
        method: 'POST',
        body: branch ? { branch } : {}
    });
}

export async function getAppGitStatus(appId) {
    return this.request(`/deploy/apps/${appId}/git-status`);
}

export async function getCommitInfo(appId) {
    return this.request(`/deploy/apps/${appId}/commit`);
}

export async function getDeploymentHistory(appId = null, limit = 50) {
    const params = new URLSearchParams({ limit });
    if (appId) params.append('app_id', appId);
    return this.request(`/deploy/history?${params}`);
}

export async function cloneRepository(appPath, repoUrl, branch = 'main') {
    return this.request('/deploy/clone', {
        method: 'POST',
        body: { app_path: appPath, repo_url: repoUrl, branch }
    });
}

export async function getAppBranches(appId) {
    return this.request(`/deploy/apps/${appId}/branches`);
}

export async function getBranchesFromUrl(repoUrl) {
    return this.request('/deploy/branches', {
        method: 'POST',
        body: { repo_url: repoUrl }
    });
}

export async function getWebhookLogs(appId = null, limit = 50) {
    const params = new URLSearchParams({ limit });
    if (appId) params.append('app_id', appId);
    return this.request(`/deploy/webhook-logs?${params}`);
}

// Build & Deployment endpoints
export async function getBuildConfig(appId) {
    return this.request(`/builds/apps/${appId}/build-config`);
}

export async function configureBuild(appId, config) {
    return this.request(`/builds/apps/${appId}/build-config`, {
        method: 'POST',
        body: config
    });
}

export async function removeBuildConfig(appId) {
    return this.request(`/builds/apps/${appId}/build-config`, { method: 'DELETE' });
}

export async function detectBuildMethod(appId) {
    return this.request(`/builds/apps/${appId}/detect`);
}

export async function getNixpacksPlan(appId) {
    return this.request(`/builds/apps/${appId}/nixpacks-plan`);
}

export async function triggerBuild(appId, noCache = false) {
    return this.request(`/builds/apps/${appId}/build`, {
        method: 'POST',
        body: { no_cache: noCache }
    });
}

export async function getBuildLogs(appId, limit = 20) {
    return this.request(`/builds/apps/${appId}/build-logs?limit=${encodeURIComponent(limit)}`);
}

export async function getBuildLogDetail(appId, timestamp) {
    return this.request(`/builds/apps/${appId}/build-logs/${timestamp}`);
}

export async function clearBuildCache(appId) {
    return this.request(`/builds/apps/${appId}/clear-cache`, { method: 'POST' });
}

export async function deployApp(appId, options = {}) {
    return this.request(`/builds/apps/${appId}/deploy`, {
        method: 'POST',
        body: options
    });
}

export async function getDeployments(appId, limit = 20, offset = 0) {
    return this.request(`/builds/apps/${appId}/deployments?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
}

export async function getDeploymentDetail(deploymentId, includeLogs = false) {
    return this.request(`/builds/deployments/${deploymentId}?include_logs=${encodeURIComponent(includeLogs)}`);
}

export async function getDeploymentDiff(deploymentId) {
    return this.request(`/builds/deployments/${deploymentId}/diff`);
}

export async function rollback(appId, targetVersion = null) {
    return this.request(`/builds/apps/${appId}/rollback`, {
        method: 'POST',
        body: targetVersion ? { version: targetVersion } : {}
    });
}

export async function getCurrentDeployment(appId) {
    return this.request(`/builds/apps/${appId}/current-deployment`);
}

// Services an app uses (plan 86 §C4): storage (own bucket + scoped key),
// cache and queue (env references to an installed engine).
export async function getAppAttachments(appId) {
    return this.request(`/apps/${appId}/attachments`);
}

export async function getAttachableServices(kind) {
    return this.request(`/apps/attachments/services?kind=${encodeURIComponent(kind)}`);
}

export async function attachService(appId, kind, serviceAppId) {
    return this.request(`/apps/${appId}/attachments/${encodeURIComponent(kind)}`, {
        method: 'POST',
        body: { service_app_id: serviceAppId },
    });
}

export async function detachService(appId, attachmentId) {
    return this.request(`/apps/${appId}/attachments/${attachmentId}`, { method: 'DELETE' });
}

// Opt-in PgBouncer beside an installed PostgreSQL (plan 86 §D1).
export async function getAppPooler(appId) {
    return this.request(`/apps/${appId}/pooler`);
}

export async function setAppPooler(appId, enabled) {
    return this.request(`/apps/${appId}/pooler`, { method: 'PUT', body: { enabled } });
}

// Rule-based bottleneck hints for an app (plan 86 §A5).
export async function getAppHints(appId) {
    return this.request(`/apps/${appId}/hints`);
}

// Long-cache fingerprinted assets in the vhost (plan 86 §B2).
export async function setImmutableAssets(appId, enabled) {
    return this.request(`/apps/${appId}/immutable-assets`, { method: 'PUT', body: { enabled } });
}

// A/B slot deploys (plan 87): slot state + eligibility, the opt-in, and the
// instant switch back to the standby.
export async function getAppSlots(appId) {
    return this.request(`/apps/${appId}/slots`);
}

export async function setAppSlots(appId, enabled) {
    return this.request(`/apps/${appId}/slots`, { method: 'PUT', body: { enabled } });
}

export async function switchBackAppSlot(appId) {
    return this.request(`/apps/${appId}/slots/switch-back`, { method: 'POST' });
}

export async function restoreAppSlotDatabase(appId, deploymentId) {
    return this.request(`/apps/${appId}/slots/restore-db`, {
        method: 'POST', body: { deployment_id: deploymentId },
    });
}

// Compose slot apps with a database move it once into a shared data project.
export async function previewAppComposeSplit(appId) {
    return this.request(`/apps/${appId}/slots/compose-split`);
}

export async function applyAppComposeSplit(appId) {
    return this.request(`/apps/${appId}/slots/compose-split`, { method: 'POST', body: { confirm: true } });
}

// Host-port checks behind the shared PortField: is it valid, free, and who
// holds it; and the next free port at or above `start`.
export async function checkPort(port) {
    return this.request(`/ports/check?port=${encodeURIComponent(port)}`);
}

export async function suggestPort(start = 8000) {
    return this.request(`/ports/suggest?start=${encodeURIComponent(start)}`);
}
