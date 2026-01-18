// Use relative URL in production (served from Flask), absolute in development
const API_BASE_URL = import.meta.env.VITE_API_URL ||
    (import.meta.env.PROD ? '/api/v1' : 'http://localhost:5000/api/v1');

class ApiService {
    constructor() {
        this.baseUrl = API_BASE_URL;
    }

    getToken() {
        return localStorage.getItem('access_token');
    }

    setTokens(accessToken, refreshToken) {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
    }

    clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const token = this.getToken();

        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` }),
                ...options.headers,
            },
            ...options,
        };

        if (options.body && typeof options.body === 'object') {
            config.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, config);

            if (response.status === 401) {
                const refreshed = await this.refreshToken();
                if (refreshed) {
                    config.headers.Authorization = `Bearer ${this.getToken()}`;
                    const retryResponse = await fetch(url, config);
                    return this.handleResponse(retryResponse);
                }
                this.clearTokens();
                window.location.href = '/login';
                throw new Error('Session expired');
            }

            return this.handleResponse(response);
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async handleResponse(response) {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }
        return data;
    }

    async refreshToken() {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) return false;

        try {
            const response = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${refreshToken}`,
                },
            });

            if (response.ok) {
                const data = await response.json();
                localStorage.setItem('access_token', data.access_token);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }

    // Auth endpoints
    async login(email, password) {
        const data = await this.request('/auth/login', {
            method: 'POST',
            body: { email, password },
        });
        this.setTokens(data.access_token, data.refresh_token);
        return data;
    }

    async register(email, username, password) {
        const data = await this.request('/auth/register', {
            method: 'POST',
            body: { email, username, password },
        });
        this.setTokens(data.access_token, data.refresh_token);
        return data;
    }

    async logout() {
        this.clearTokens();
    }

    async getCurrentUser() {
        return this.request('/auth/me');
    }

    async updateCurrentUser(data) {
        return this.request('/auth/me', {
            method: 'PUT',
            body: data
        });
    }

    // Apps endpoints
    async getApps() {
        return this.request('/apps');
    }

    async getApp(id) {
        return this.request(`/apps/${id}`);
    }

    async createApp(appData) {
        return this.request('/apps', {
            method: 'POST',
            body: appData,
        });
    }

    async updateApp(id, appData) {
        return this.request(`/apps/${id}`, {
            method: 'PUT',
            body: appData,
        });
    }

    async deleteApp(id) {
        return this.request(`/apps/${id}`, {
            method: 'DELETE',
        });
    }

    async startApp(id) {
        return this.request(`/apps/${id}/start`, { method: 'POST' });
    }

    async stopApp(id) {
        return this.request(`/apps/${id}/stop`, { method: 'POST' });
    }

    async restartApp(id) {
        return this.request(`/apps/${id}/restart`, { method: 'POST' });
    }

    // Domains endpoints
    async getDomains() {
        return this.request('/domains');
    }

    async getDomain(id) {
        return this.request(`/domains/${id}`);
    }

    async createDomain(domainData) {
        return this.request('/domains', {
            method: 'POST',
            body: domainData,
        });
    }

    async updateDomain(id, domainData) {
        return this.request(`/domains/${id}`, {
            method: 'PUT',
            body: domainData,
        });
    }

    async deleteDomain(id) {
        return this.request(`/domains/${id}`, {
            method: 'DELETE',
        });
    }

    async enableSsl(domainId, email) {
        return this.request(`/domains/${domainId}/ssl/enable`, {
            method: 'POST',
            body: { email }
        });
    }

    async disableSsl(domainId) {
        return this.request(`/domains/${domainId}/ssl/disable`, { method: 'POST' });
    }

    async renewDomainSsl(domainId) {
        return this.request(`/domains/${domainId}/ssl/renew`, { method: 'POST' });
    }

    async verifyDomain(domainId) {
        return this.request(`/domains/${domainId}/verify`);
    }

    async getDomainsNginxSites() {
        return this.request('/domains/nginx/sites');
    }

    async getDomainsSslStatus() {
        return this.request('/domains/ssl/status');
    }

    // System endpoints
    async getSystemMetrics() {
        return this.request('/system/metrics');
    }

    async getProcesses() {
        return this.request('/system/processes');
    }

    async getServices() {
        return this.request('/system/services');
    }

    async healthCheck() {
        return this.request('/system/health');
    }

    // Process endpoints
    async getProcesses(limit = 50, sortBy = 'cpu') {
        return this.request(`/processes?limit=${limit}&sort=${sortBy}`);
    }

    async getProcess(pid) {
        return this.request(`/processes/${pid}`);
    }

    async killProcess(pid, force = false) {
        return this.request(`/processes/${pid}?force=${force}`, { method: 'DELETE' });
    }

    async getServicesStatus() {
        return this.request('/processes/services');
    }

    async controlService(serviceName, action) {
        return this.request(`/processes/services/${serviceName}`, {
            method: 'POST',
            body: { action }
        });
    }

    // Nginx endpoints
    async getNginxStatus() {
        return this.request('/nginx/status');
    }

    async testNginxConfig() {
        return this.request('/nginx/test', { method: 'POST' });
    }

    async reloadNginx() {
        return this.request('/nginx/reload', { method: 'POST' });
    }

    async getNginxSites() {
        return this.request('/nginx/sites');
    }

    async createNginxSite(siteData) {
        return this.request('/nginx/sites', {
            method: 'POST',
            body: siteData
        });
    }

    async enableNginxSite(name) {
        return this.request(`/nginx/sites/${name}/enable`, { method: 'POST' });
    }

    async disableNginxSite(name) {
        return this.request(`/nginx/sites/${name}/disable`, { method: 'POST' });
    }

    async deleteNginxSite(name) {
        return this.request(`/nginx/sites/${name}`, { method: 'DELETE' });
    }

    // SSL endpoints
    async getSSLStatus() {
        return this.request('/ssl/status');
    }

    async getCertificates() {
        return this.request('/ssl/certificates');
    }

    async obtainCertificate(data) {
        return this.request('/ssl/certificates', {
            method: 'POST',
            body: data
        });
    }

    async renewCertificate(domain) {
        return this.request(`/ssl/certificates/${domain}/renew`, { method: 'POST' });
    }

    async renewAllCertificates() {
        return this.request('/ssl/certificates/renew-all', { method: 'POST' });
    }

    async revokeCertificate(domain) {
        return this.request(`/ssl/certificates/${domain}`, { method: 'DELETE' });
    }

    // Log endpoints
    async getLogFiles() {
        return this.request('/logs');
    }

    async readLog(filepath, lines = 100) {
        return this.request(`/logs/read?path=${encodeURIComponent(filepath)}&lines=${lines}`);
    }

    async searchLog(filepath, pattern, lines = 100) {
        return this.request(`/logs/search?path=${encodeURIComponent(filepath)}&pattern=${encodeURIComponent(pattern)}&lines=${lines}`);
    }

    async getAppLogs(appName, type = 'access', lines = 100) {
        return this.request(`/logs/app/${appName}?type=${type}&lines=${lines}`);
    }

    async getJournalLogs(unit, lines = 100) {
        const params = new URLSearchParams({ lines });
        if (unit) params.append('unit', unit);
        return this.request(`/logs/journal?${params}`);
    }

    async clearLog(filepath) {
        return this.request('/logs/clear', {
            method: 'POST',
            body: { path: filepath }
        });
    }

    // PHP endpoints
    async getPHPVersions() {
        return this.request('/php/versions');
    }

    async installPHPVersion(version) {
        return this.request(`/php/versions/${version}/install`, { method: 'POST' });
    }

    async setDefaultPHPVersion(version) {
        return this.request('/php/versions/default', {
            method: 'POST',
            body: { version }
        });
    }

    async getPHPExtensions(version) {
        return this.request(`/php/versions/${version}/extensions`);
    }

    async installPHPExtension(version, extension) {
        return this.request(`/php/versions/${version}/extensions`, {
            method: 'POST',
            body: { extension }
        });
    }

    async getPHPPools(version) {
        return this.request(`/php/versions/${version}/pools`);
    }

    async createPHPPool(version, poolData) {
        return this.request(`/php/versions/${version}/pools`, {
            method: 'POST',
            body: poolData
        });
    }

    async deletePHPPool(version, poolName) {
        return this.request(`/php/versions/${version}/pools/${poolName}`, { method: 'DELETE' });
    }

    async restartPHPFPM(version) {
        return this.request(`/php/versions/${version}/fpm/restart`, { method: 'POST' });
    }

    async getPHPFPMStatus(version) {
        return this.request(`/php/versions/${version}/fpm/status`);
    }

    // WordPress endpoints
    async installWordPress(config) {
        return this.request('/wordpress/install', {
            method: 'POST',
            body: config
        });
    }

    async getWordPressInfo(appId) {
        return this.request(`/wordpress/sites/${appId}/info`);
    }

    async updateWordPress(appId) {
        return this.request(`/wordpress/sites/${appId}/update`, { method: 'POST' });
    }

    async getWordPressPlugins(appId) {
        return this.request(`/wordpress/sites/${appId}/plugins`);
    }

    async installWordPressPlugin(appId, plugin, activate = true) {
        return this.request(`/wordpress/sites/${appId}/plugins`, {
            method: 'POST',
            body: { plugin, activate }
        });
    }

    async uninstallWordPressPlugin(appId, plugin) {
        return this.request(`/wordpress/sites/${appId}/plugins/${plugin}`, { method: 'DELETE' });
    }

    async activateWordPressPlugin(appId, plugin) {
        return this.request(`/wordpress/sites/${appId}/plugins/${plugin}/activate`, { method: 'POST' });
    }

    async deactivateWordPressPlugin(appId, plugin) {
        return this.request(`/wordpress/sites/${appId}/plugins/${plugin}/deactivate`, { method: 'POST' });
    }

    async updateWordPressPlugins(appId, plugins = null) {
        return this.request(`/wordpress/sites/${appId}/plugins/update`, {
            method: 'POST',
            body: plugins ? { plugins } : {}
        });
    }

    async getWordPressThemes(appId) {
        return this.request(`/wordpress/sites/${appId}/themes`);
    }

    async installWordPressTheme(appId, theme, activate = false) {
        return this.request(`/wordpress/sites/${appId}/themes`, {
            method: 'POST',
            body: { theme, activate }
        });
    }

    async activateWordPressTheme(appId, theme) {
        return this.request(`/wordpress/sites/${appId}/themes/${theme}/activate`, { method: 'POST' });
    }

    async createWordPressBackup(appId, includeDb = true) {
        return this.request(`/wordpress/sites/${appId}/backup`, {
            method: 'POST',
            body: { include_db: includeDb }
        });
    }

    async getWordPressBackups(appId) {
        return this.request(`/wordpress/sites/${appId}/backups`);
    }

    async restoreWordPressBackup(appId, backupName) {
        return this.request(`/wordpress/sites/${appId}/restore`, {
            method: 'POST',
            body: { backup_name: backupName }
        });
    }

    async deleteWordPressBackup(backupName) {
        return this.request(`/wordpress/backups/${backupName}`, { method: 'DELETE' });
    }

    async hardenWordPress(appId) {
        return this.request(`/wordpress/sites/${appId}/harden`, { method: 'POST' });
    }

    async optimizeWordPressDatabase(appId) {
        return this.request(`/wordpress/sites/${appId}/optimize`, { method: 'POST' });
    }

    async flushWordPressCache(appId) {
        return this.request(`/wordpress/sites/${appId}/flush-cache`, { method: 'POST' });
    }

    async searchReplaceWordPress(appId, search, replace, dryRun = true) {
        return this.request(`/wordpress/sites/${appId}/search-replace`, {
            method: 'POST',
            body: { search, replace, dry_run: dryRun }
        });
    }

    async createWordPressUser(appId, userData) {
        return this.request(`/wordpress/sites/${appId}/users`, {
            method: 'POST',
            body: userData
        });
    }

    async resetWordPressPassword(appId, user, password = null) {
        return this.request(`/wordpress/sites/${appId}/users/${user}/reset-password`, {
            method: 'POST',
            body: password ? { password } : {}
        });
    }

    // Python endpoints
    async getPythonVersions() {
        return this.request('/python/versions');
    }

    async createFlaskApp(data) {
        return this.request('/python/apps/flask', {
            method: 'POST',
            body: data
        });
    }

    async createDjangoApp(data) {
        return this.request('/python/apps/django', {
            method: 'POST',
            body: data
        });
    }

    async createPythonVenv(appId) {
        return this.request(`/python/apps/${appId}/venv`, { method: 'POST' });
    }

    async getPythonPackages(appId) {
        return this.request(`/python/apps/${appId}/packages`);
    }

    async installPythonPackages(appId, packages) {
        return this.request(`/python/apps/${appId}/packages`, {
            method: 'POST',
            body: { packages }
        });
    }

    async freezePythonRequirements(appId) {
        return this.request(`/python/apps/${appId}/requirements`, { method: 'POST' });
    }

    async getPythonEnvVars(appId) {
        return this.request(`/python/apps/${appId}/env`);
    }

    async setPythonEnvVars(appId, envVars) {
        return this.request(`/python/apps/${appId}/env`, {
            method: 'PUT',
            body: { env_vars: envVars }
        });
    }

    async deletePythonEnvVar(appId, key) {
        return this.request(`/python/apps/${appId}/env/${key}`, { method: 'DELETE' });
    }

    async startPythonApp(appId) {
        return this.request(`/python/apps/${appId}/start`, { method: 'POST' });
    }

    async stopPythonApp(appId) {
        return this.request(`/python/apps/${appId}/stop`, { method: 'POST' });
    }

    async restartPythonApp(appId) {
        return this.request(`/python/apps/${appId}/restart`, { method: 'POST' });
    }

    async getPythonAppStatus(appId) {
        return this.request(`/python/apps/${appId}/status`);
    }

    async getGunicornConfig(appId) {
        return this.request(`/python/apps/${appId}/gunicorn`);
    }

    async updateGunicornConfig(appId, content) {
        return this.request(`/python/apps/${appId}/gunicorn`, {
            method: 'PUT',
            body: { content }
        });
    }

    async runPythonMigrations(appId) {
        return this.request(`/python/apps/${appId}/migrate`, { method: 'POST' });
    }

    async collectPythonStatic(appId) {
        return this.request(`/python/apps/${appId}/collectstatic`, { method: 'POST' });
    }

    async runPythonCommand(appId, command) {
        return this.request(`/python/apps/${appId}/run`, {
            method: 'POST',
            body: { command }
        });
    }

    async deletePythonApp(appId, removeFiles = false) {
        return this.request(`/python/apps/${appId}`, {
            method: 'DELETE',
            body: { remove_files: removeFiles }
        });
    }

    // Docker endpoints
    async getDockerStatus() {
        return this.request('/docker/status');
    }

    async getDockerInfo() {
        return this.request('/docker/info');
    }

    async getDockerDiskUsage() {
        return this.request('/docker/disk-usage');
    }

    // Containers
    async getContainers(all = true) {
        return this.request(`/docker/containers?all=${all}`);
    }

    async getContainer(containerId) {
        return this.request(`/docker/containers/${containerId}`);
    }

    async createContainer(data) {
        return this.request('/docker/containers', {
            method: 'POST',
            body: data
        });
    }

    async runContainer(data) {
        return this.request('/docker/containers/run', {
            method: 'POST',
            body: data
        });
    }

    async startContainer(containerId) {
        return this.request(`/docker/containers/${containerId}/start`, { method: 'POST' });
    }

    async stopContainer(containerId, timeout = 10) {
        return this.request(`/docker/containers/${containerId}/stop`, {
            method: 'POST',
            body: { timeout }
        });
    }

    async restartContainer(containerId, timeout = 10) {
        return this.request(`/docker/containers/${containerId}/restart`, {
            method: 'POST',
            body: { timeout }
        });
    }

    async removeContainer(containerId, force = false, volumes = false) {
        return this.request(`/docker/containers/${containerId}`, {
            method: 'DELETE',
            body: { force, volumes }
        });
    }

    async getContainerLogs(containerId, tail = 100, since = null) {
        const params = new URLSearchParams({ tail });
        if (since) params.append('since', since);
        return this.request(`/docker/containers/${containerId}/logs?${params}`);
    }

    async getContainerStats(containerId) {
        return this.request(`/docker/containers/${containerId}/stats`);
    }

    async execContainer(containerId, command) {
        return this.request(`/docker/containers/${containerId}/exec`, {
            method: 'POST',
            body: { command }
        });
    }

    // Images
    async getImages() {
        return this.request('/docker/images');
    }

    async pullImage(image, tag = 'latest') {
        return this.request('/docker/images/pull', {
            method: 'POST',
            body: { image, tag }
        });
    }

    async removeImage(imageId, force = false) {
        return this.request(`/docker/images/${imageId}`, {
            method: 'DELETE',
            body: { force }
        });
    }

    async buildImage(path, tag, dockerfile = 'Dockerfile', noCache = false) {
        return this.request('/docker/images/build', {
            method: 'POST',
            body: { path, tag, dockerfile, no_cache: noCache }
        });
    }

    // Networks
    async getNetworks() {
        return this.request('/docker/networks');
    }

    async createNetwork(name, driver = 'bridge') {
        return this.request('/docker/networks', {
            method: 'POST',
            body: { name, driver }
        });
    }

    async removeNetwork(networkId) {
        return this.request(`/docker/networks/${networkId}`, { method: 'DELETE' });
    }

    // Volumes
    async getVolumes() {
        return this.request('/docker/volumes');
    }

    async createVolume(name, driver = 'local') {
        return this.request('/docker/volumes', {
            method: 'POST',
            body: { name, driver }
        });
    }

    async removeVolume(volumeName, force = false) {
        return this.request(`/docker/volumes/${volumeName}`, {
            method: 'DELETE',
            body: { force }
        });
    }

    // Docker Compose
    async composeUp(path, detach = true, build = false) {
        return this.request('/docker/compose/up', {
            method: 'POST',
            body: { path, detach, build }
        });
    }

    async composeDown(path, volumes = false, removeOrphans = true) {
        return this.request('/docker/compose/down', {
            method: 'POST',
            body: { path, volumes, remove_orphans: removeOrphans }
        });
    }

    async composePs(path) {
        return this.request('/docker/compose/ps', {
            method: 'POST',
            body: { path }
        });
    }

    async composeLogs(path, service = null, tail = 100) {
        return this.request('/docker/compose/logs', {
            method: 'POST',
            body: { path, service, tail }
        });
    }

    async composeRestart(path, service = null) {
        return this.request('/docker/compose/restart', {
            method: 'POST',
            body: { path, service }
        });
    }

    async composePull(path, service = null) {
        return this.request('/docker/compose/pull', {
            method: 'POST',
            body: { path, service }
        });
    }

    // Docker App
    async createDockerApp(data) {
        return this.request('/docker/apps', {
            method: 'POST',
            body: data
        });
    }

    async pruneDocker(all = false, volumes = false) {
        return this.request('/docker/prune', {
            method: 'POST',
            body: { all, volumes }
        });
    }

    // Database endpoints
    async getDatabaseStatus() {
        return this.request('/databases/status');
    }

    // MySQL
    async getMySQLDatabases(rootPassword = null) {
        const params = rootPassword ? `?root_password=${encodeURIComponent(rootPassword)}` : '';
        return this.request(`/databases/mysql${params}`);
    }

    async createMySQLDatabase(data) {
        return this.request('/databases/mysql', {
            method: 'POST',
            body: data
        });
    }

    async dropMySQLDatabase(name, rootPassword = null) {
        return this.request(`/databases/mysql/${name}`, {
            method: 'DELETE',
            body: { root_password: rootPassword }
        });
    }

    async getMySQLTables(database, rootPassword = null) {
        const params = rootPassword ? `?root_password=${encodeURIComponent(rootPassword)}` : '';
        return this.request(`/databases/mysql/${database}/tables${params}`);
    }

    async backupMySQLDatabase(database, rootPassword = null) {
        return this.request(`/databases/mysql/${database}/backup`, {
            method: 'POST',
            body: { root_password: rootPassword }
        });
    }

    async restoreMySQLDatabase(database, backupPath, rootPassword = null) {
        return this.request(`/databases/mysql/${database}/restore`, {
            method: 'POST',
            body: { backup_path: backupPath, root_password: rootPassword }
        });
    }

    async getMySQLUsers(rootPassword = null) {
        const params = rootPassword ? `?root_password=${encodeURIComponent(rootPassword)}` : '';
        return this.request(`/databases/mysql/users${params}`);
    }

    async createMySQLUser(data) {
        return this.request('/databases/mysql/users', {
            method: 'POST',
            body: data
        });
    }

    async dropMySQLUser(username, host = 'localhost', rootPassword = null) {
        return this.request(`/databases/mysql/users/${username}`, {
            method: 'DELETE',
            body: { host, root_password: rootPassword }
        });
    }

    async grantMySQLPrivileges(username, database, privileges = 'ALL', host = 'localhost', rootPassword = null) {
        return this.request(`/databases/mysql/users/${username}/grant`, {
            method: 'POST',
            body: { database, privileges, host, root_password: rootPassword }
        });
    }

    // PostgreSQL
    async getPostgreSQLDatabases() {
        return this.request('/databases/postgresql');
    }

    async createPostgreSQLDatabase(data) {
        return this.request('/databases/postgresql', {
            method: 'POST',
            body: data
        });
    }

    async dropPostgreSQLDatabase(name) {
        return this.request(`/databases/postgresql/${name}`, { method: 'DELETE' });
    }

    async getPostgreSQLTables(database) {
        return this.request(`/databases/postgresql/${database}/tables`);
    }

    async backupPostgreSQLDatabase(database) {
        return this.request(`/databases/postgresql/${database}/backup`, { method: 'POST' });
    }

    async restorePostgreSQLDatabase(database, backupPath) {
        return this.request(`/databases/postgresql/${database}/restore`, {
            method: 'POST',
            body: { backup_path: backupPath }
        });
    }

    async getPostgreSQLUsers() {
        return this.request('/databases/postgresql/users');
    }

    async createPostgreSQLUser(data) {
        return this.request('/databases/postgresql/users', {
            method: 'POST',
            body: data
        });
    }

    async dropPostgreSQLUser(username) {
        return this.request(`/databases/postgresql/users/${username}`, { method: 'DELETE' });
    }

    async grantPostgreSQLPrivileges(username, database, privileges = 'ALL') {
        return this.request(`/databases/postgresql/users/${username}/grant`, {
            method: 'POST',
            body: { database, privileges }
        });
    }

    // Backups
    async getDatabaseBackups(type = null) {
        const params = type ? `?type=${type}` : '';
        return this.request(`/databases/backups${params}`);
    }

    async deleteDatabaseBackup(filename) {
        return this.request(`/databases/backups/${filename}`, { method: 'DELETE' });
    }

    async generateDatabasePassword(length = 16) {
        return this.request(`/databases/generate-password?length=${length}`);
    }

    // Query Execution
    async executeMySQLQuery(database, query, readonly = true) {
        return this.request(`/databases/mysql/${database}/query`, {
            method: 'POST',
            body: { query, readonly }
        });
    }

    async executePostgreSQLQuery(database, query, readonly = true) {
        return this.request(`/databases/postgresql/${database}/query`, {
            method: 'POST',
            body: { query, readonly }
        });
    }

    async executeSQLiteQuery(path, query, readonly = true) {
        return this.request('/databases/sqlite/query', {
            method: 'POST',
            body: { path, query, readonly }
        });
    }

    async getMySQLTableStructure(database, table) {
        return this.request(`/databases/mysql/${database}/tables/${table}/structure`);
    }

    async getPostgreSQLTableStructure(database, table) {
        return this.request(`/databases/postgresql/${database}/tables/${table}/structure`);
    }

    async getSQLiteTableStructure(path, table) {
        return this.request(`/databases/sqlite/tables/${table}/structure?path=${encodeURIComponent(path)}`);
    }

    async getSQLiteDatabases() {
        return this.request('/databases/sqlite');
    }

    async getSQLiteTables(path) {
        return this.request(`/databases/sqlite/tables?path=${encodeURIComponent(path)}`);
    }

    // ========================================
    // Monitoring & Alerts endpoints
    // ========================================
    async getMonitoringStatus() {
        return this.request('/monitoring/status');
    }

    async getMonitoringMetrics() {
        return this.request('/monitoring/metrics');
    }

    async checkAlerts() {
        return this.request('/monitoring/alerts/check');
    }

    async getAlertHistory(limit = 100) {
        return this.request(`/monitoring/alerts/history?limit=${limit}`);
    }

    async getMonitoringConfig() {
        return this.request('/monitoring/config');
    }

    async updateMonitoringConfig(config) {
        return this.request('/monitoring/config', {
            method: 'PUT',
            body: config
        });
    }

    async getMonitoringThresholds() {
        return this.request('/monitoring/thresholds');
    }

    async updateMonitoringThresholds(thresholds) {
        return this.request('/monitoring/thresholds', {
            method: 'PUT',
            body: thresholds
        });
    }

    async startMonitoring() {
        return this.request('/monitoring/start', { method: 'POST' });
    }

    async stopMonitoring() {
        return this.request('/monitoring/stop', { method: 'POST' });
    }

    async testEmailAlert(email) {
        return this.request('/monitoring/test/email', {
            method: 'POST',
            body: { email }
        });
    }

    async testWebhookAlert(webhookUrl) {
        return this.request('/monitoring/test/webhook', {
            method: 'POST',
            body: { webhook_url: webhookUrl }
        });
    }

    // ========================================
    // Backup System endpoints
    // ========================================
    async getBackups(type = null) {
        const params = type ? `?type=${type}` : '';
        return this.request(`/backups${params}`);
    }

    async getBackupStats() {
        return this.request('/backups/stats');
    }

    async getBackupConfig() {
        return this.request('/backups/config');
    }

    async updateBackupConfig(config) {
        return this.request('/backups/config', {
            method: 'PUT',
            body: config
        });
    }

    async backupApplication(applicationId, includeDb = false, dbConfig = null) {
        return this.request('/backups/application', {
            method: 'POST',
            body: {
                application_id: applicationId,
                include_db: includeDb,
                db_config: dbConfig
            }
        });
    }

    async backupDatabase(dbType, dbName, user = null, password = null, host = 'localhost') {
        return this.request('/backups/database', {
            method: 'POST',
            body: { db_type: dbType, db_name: dbName, user, password, host }
        });
    }

    async restoreApplication(backupPath, restorePath = null) {
        return this.request('/backups/restore/application', {
            method: 'POST',
            body: { backup_path: backupPath, restore_path: restorePath }
        });
    }

    async restoreDatabase(backupPath, dbType, dbName, user = null, password = null, host = 'localhost') {
        return this.request('/backups/restore/database', {
            method: 'POST',
            body: { backup_path: backupPath, db_type: dbType, db_name: dbName, user, password, host }
        });
    }

    async deleteBackup(backupPath) {
        return this.request(`/backups/${encodeURIComponent(backupPath)}`, { method: 'DELETE' });
    }

    async cleanupBackups(retentionDays = null) {
        return this.request('/backups/cleanup', {
            method: 'POST',
            body: retentionDays ? { retention_days: retentionDays } : {}
        });
    }

    async getBackupSchedules() {
        return this.request('/backups/schedules');
    }

    async addBackupSchedule(name, backupType, target, scheduleTime, days = null) {
        return this.request('/backups/schedules', {
            method: 'POST',
            body: { name, backup_type: backupType, target, schedule_time: scheduleTime, days }
        });
    }

    async removeBackupSchedule(scheduleId) {
        return this.request(`/backups/schedules/${scheduleId}`, { method: 'DELETE' });
    }

    // ========================================
    // Git Deployment endpoints
    // ========================================
    async getDeployConfig(appId) {
        return this.request(`/deploy/apps/${appId}/config`);
    }

    async configureDeployment(appId, repoUrl, branch = 'main', autoDeploy = true, preDeployScript = null, postDeployScript = null) {
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

    async removeDeployment(appId) {
        return this.request(`/deploy/apps/${appId}/config`, { method: 'DELETE' });
    }

    async triggerDeploy(appId, force = false) {
        return this.request(`/deploy/apps/${appId}/deploy`, {
            method: 'POST',
            body: { force }
        });
    }

    async pullChanges(appId, branch = null) {
        return this.request(`/deploy/apps/${appId}/pull`, {
            method: 'POST',
            body: branch ? { branch } : {}
        });
    }

    async getGitStatus(appId) {
        return this.request(`/deploy/apps/${appId}/git-status`);
    }

    async getCommitInfo(appId) {
        return this.request(`/deploy/apps/${appId}/commit`);
    }

    async getDeploymentHistory(appId = null, limit = 50) {
        const params = new URLSearchParams({ limit });
        if (appId) params.append('app_id', appId);
        return this.request(`/deploy/history?${params}`);
    }

    async cloneRepository(appPath, repoUrl, branch = 'main') {
        return this.request('/deploy/clone', {
            method: 'POST',
            body: { app_path: appPath, repo_url: repoUrl, branch }
        });
    }

    async getAppBranches(appId) {
        return this.request(`/deploy/apps/${appId}/branches`);
    }

    async getBranchesFromUrl(repoUrl) {
        return this.request('/deploy/branches', {
            method: 'POST',
            body: { repo_url: repoUrl }
        });
    }

    async getWebhookLogs(appId = null, limit = 50) {
        const params = new URLSearchParams({ limit });
        if (appId) params.append('app_id', appId);
        return this.request(`/deploy/webhook-logs?${params}`);
    }

    // ========================================
    // Build & Deployment endpoints
    // ========================================
    async getBuildConfig(appId) {
        return this.request(`/builds/apps/${appId}/build-config`);
    }

    async configureBuild(appId, config) {
        return this.request(`/builds/apps/${appId}/build-config`, {
            method: 'POST',
            body: config
        });
    }

    async removeBuildConfig(appId) {
        return this.request(`/builds/apps/${appId}/build-config`, { method: 'DELETE' });
    }

    async detectBuildMethod(appId) {
        return this.request(`/builds/apps/${appId}/detect`);
    }

    async getNixpacksPlan(appId) {
        return this.request(`/builds/apps/${appId}/nixpacks-plan`);
    }

    async triggerBuild(appId, noCache = false) {
        return this.request(`/builds/apps/${appId}/build`, {
            method: 'POST',
            body: { no_cache: noCache }
        });
    }

    async getBuildLogs(appId, limit = 20) {
        return this.request(`/builds/apps/${appId}/build-logs?limit=${limit}`);
    }

    async getBuildLogDetail(appId, timestamp) {
        return this.request(`/builds/apps/${appId}/build-logs/${timestamp}`);
    }

    async clearBuildCache(appId) {
        return this.request(`/builds/apps/${appId}/clear-cache`, { method: 'POST' });
    }

    async deployApp(appId, options = {}) {
        return this.request(`/builds/apps/${appId}/deploy`, {
            method: 'POST',
            body: options
        });
    }

    async getDeployments(appId, limit = 20, offset = 0) {
        return this.request(`/builds/apps/${appId}/deployments?limit=${limit}&offset=${offset}`);
    }

    async getDeploymentDetail(deploymentId, includeLogs = false) {
        return this.request(`/builds/deployments/${deploymentId}?include_logs=${includeLogs}`);
    }

    async getDeploymentDiff(deploymentId) {
        return this.request(`/builds/deployments/${deploymentId}/diff`);
    }

    async rollback(appId, targetVersion = null) {
        return this.request(`/builds/apps/${appId}/rollback`, {
            method: 'POST',
            body: targetVersion ? { version: targetVersion } : {}
        });
    }

    async getCurrentDeployment(appId) {
        return this.request(`/builds/apps/${appId}/current-deployment`);
    }

    // ========================================
    // Template endpoints
    // ========================================
    async listTemplates(category = null, search = null) {
        const params = new URLSearchParams();
        if (category) params.append('category', category);
        if (search) params.append('search', search);
        const query = params.toString();
        return this.request(`/templates/${query ? '?' + query : ''}`);
    }

    async getTemplateCategories() {
        return this.request('/templates/categories');
    }

    async getTemplate(templateId) {
        return this.request(`/templates/${templateId}`);
    }

    async installTemplate(templateId, appName, variables = {}) {
        return this.request(`/templates/${templateId}/install`, {
            method: 'POST',
            body: { app_name: appName, variables }
        });
    }

    async validateTemplateInstall(templateId, appName, variables = {}) {
        return this.request('/templates/validate-install', {
            method: 'POST',
            body: { template_id: templateId, app_name: appName, variables }
        });
    }

    async checkAppUpdate(appId) {
        return this.request(`/templates/apps/${appId}/check-update`);
    }

    async updateAppFromTemplate(appId) {
        return this.request(`/templates/apps/${appId}/update`, { method: 'POST' });
    }

    async getAppTemplateInfo(appId) {
        return this.request(`/templates/apps/${appId}/template-info`);
    }

    async listTemplateRepos() {
        return this.request('/templates/repos');
    }

    async addTemplateRepo(name, url) {
        return this.request('/templates/repos', {
            method: 'POST',
            body: { name, url }
        });
    }

    async removeTemplateRepo(url) {
        return this.request('/templates/repos', {
            method: 'DELETE',
            body: { url }
        });
    }

    async syncTemplates() {
        return this.request('/templates/sync', { method: 'POST' });
    }

    // ========================================
    // File Manager endpoints
    // ========================================
    async browseFiles(path = '/home', showHidden = false) {
        const params = new URLSearchParams({ path, show_hidden: showHidden });
        return this.request(`/files/browse?${params}`);
    }

    async getFileInfo(path) {
        return this.request(`/files/info?path=${encodeURIComponent(path)}`);
    }

    async readFile(path) {
        return this.request(`/files/read?path=${encodeURIComponent(path)}`);
    }

    async writeFile(path, content, createBackup = true) {
        return this.request('/files/write', {
            method: 'POST',
            body: { path, content, create_backup: createBackup }
        });
    }

    async createFile(path, content = '') {
        return this.request('/files/create', {
            method: 'POST',
            body: { path, content }
        });
    }

    async createDirectory(path) {
        return this.request('/files/mkdir', {
            method: 'POST',
            body: { path }
        });
    }

    async deleteFile(path) {
        return this.request(`/files/delete?path=${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });
    }

    async renameFile(path, newName) {
        return this.request('/files/rename', {
            method: 'POST',
            body: { path, new_name: newName }
        });
    }

    async copyFile(src, dest) {
        return this.request('/files/copy', {
            method: 'POST',
            body: { src, dest }
        });
    }

    async moveFile(src, dest) {
        return this.request('/files/move', {
            method: 'POST',
            body: { src, dest }
        });
    }

    async changeFilePermissions(path, mode) {
        return this.request('/files/chmod', {
            method: 'POST',
            body: { path, mode }
        });
    }

    async searchFiles(directory, pattern, maxResults = 100) {
        const params = new URLSearchParams({ directory, pattern, max_results: maxResults });
        return this.request(`/files/search?${params}`);
    }

    async getDiskUsage(path = '/') {
        return this.request(`/files/disk-usage?path=${encodeURIComponent(path)}`);
    }

    async downloadFile(path) {
        const token = this.getToken();
        const url = `${this.baseUrl}/files/download?path=${encodeURIComponent(path)}`;
        window.open(`${url}&token=${token}`, '_blank');
    }

    async uploadFile(destination, file, onProgress = null) {
        const token = this.getToken();
        const formData = new FormData();
        formData.append('file', file);
        formData.append('destination', destination);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${this.baseUrl}/files/upload`);
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);

            if (onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        onProgress((e.loaded / e.total) * 100);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    reject(new Error(JSON.parse(xhr.responseText).error || 'Upload failed'));
                }
            };

            xhr.onerror = () => reject(new Error('Upload failed'));
            xhr.send(formData);
        });
    }

    // ========================================
    // FTP Server endpoints
    // ========================================
    async getFTPStatus() {
        return this.request('/ftp/status');
    }

    async controlFTPService(action, service = null) {
        return this.request(`/ftp/service/${action}`, {
            method: 'POST',
            body: service ? { service } : {}
        });
    }

    async getFTPConfig(service = null) {
        const params = service ? `?service=${service}` : '';
        return this.request(`/ftp/config${params}`);
    }

    async updateFTPConfig(config, service = null) {
        return this.request('/ftp/config', {
            method: 'POST',
            body: { config, service }
        });
    }

    async getFTPUsers() {
        return this.request('/ftp/users');
    }

    async createFTPUser(username, password = null, homeDir = null) {
        return this.request('/ftp/users', {
            method: 'POST',
            body: { username, password, home_dir: homeDir }
        });
    }

    async deleteFTPUser(username, deleteHome = false) {
        const params = deleteHome ? '?delete_home=true' : '';
        return this.request(`/ftp/users/${username}${params}`, {
            method: 'DELETE'
        });
    }

    async changeFTPPassword(username, password = null) {
        return this.request(`/ftp/users/${username}/password`, {
            method: 'POST',
            body: password ? { password } : {}
        });
    }

    async toggleFTPUser(username, enabled) {
        return this.request(`/ftp/users/${username}/toggle`, {
            method: 'POST',
            body: { enabled }
        });
    }

    async getFTPConnections() {
        return this.request('/ftp/connections');
    }

    async disconnectFTPSession(pid) {
        return this.request(`/ftp/connections/${pid}`, {
            method: 'DELETE'
        });
    }

    async getFTPLogs(lines = 100) {
        return this.request(`/ftp/logs?lines=${lines}`);
    }

    async installFTPServer(service = 'vsftpd') {
        return this.request('/ftp/install', {
            method: 'POST',
            body: { service }
        });
    }

    async testFTPConnection(host = 'localhost', port = 21, username = null, password = null) {
        return this.request('/ftp/test', {
            method: 'POST',
            body: { host, port, username, password }
        });
    }

    // ========================================
    // Firewall endpoints
    // ========================================
    async getFirewallStatus() {
        return this.request('/firewall/status');
    }

    async enableFirewall(firewall = null) {
        return this.request('/firewall/enable', {
            method: 'POST',
            body: firewall ? { firewall } : {}
        });
    }

    async disableFirewall(firewall = null) {
        return this.request('/firewall/disable', {
            method: 'POST',
            body: firewall ? { firewall } : {}
        });
    }

    async getFirewallRules(firewall = null) {
        const params = firewall ? `?firewall=${firewall}` : '';
        return this.request(`/firewall/rules${params}`);
    }

    async addFirewallRule(ruleData) {
        return this.request('/firewall/rules', {
            method: 'POST',
            body: ruleData
        });
    }

    async removeFirewallRule(ruleData) {
        return this.request('/firewall/rules', {
            method: 'DELETE',
            body: ruleData
        });
    }

    async blockIP(ip, permanent = true) {
        return this.request('/firewall/block-ip', {
            method: 'POST',
            body: { ip, permanent }
        });
    }

    async unblockIP(ip, permanent = true) {
        return this.request('/firewall/unblock-ip', {
            method: 'POST',
            body: { ip, permanent }
        });
    }

    async getBlockedIPs() {
        return this.request('/firewall/blocked-ips');
    }

    async allowPort(port, protocol = 'tcp', permanent = true) {
        return this.request('/firewall/allow-port', {
            method: 'POST',
            body: { port, protocol, permanent }
        });
    }

    async denyPort(port, protocol = 'tcp', permanent = true) {
        return this.request('/firewall/deny-port', {
            method: 'POST',
            body: { port, protocol, permanent }
        });
    }

    async getFirewallZones() {
        return this.request('/firewall/zones');
    }

    async setDefaultZone(zone) {
        return this.request('/firewall/zones/default', {
            method: 'POST',
            body: { zone }
        });
    }

    async installFirewall(firewall = 'ufw') {
        return this.request('/firewall/install', {
            method: 'POST',
            body: { firewall }
        });
    }

    // ========================================
    // Cron Job endpoints
    // ========================================
    async getCronStatus() {
        return this.request('/cron/status');
    }

    async getCronJobs() {
        return this.request('/cron/jobs');
    }

    async createCronJob(data) {
        return this.request('/cron/jobs', {
            method: 'POST',
            body: data
        });
    }

    async deleteCronJob(jobId) {
        return this.request(`/cron/jobs/${jobId}`, { method: 'DELETE' });
    }

    async toggleCronJob(jobId, enabled) {
        return this.request(`/cron/jobs/${jobId}/toggle`, {
            method: 'POST',
            body: { enabled }
        });
    }

    async runCronJob(jobId) {
        return this.request(`/cron/jobs/${jobId}/run`, { method: 'POST' });
    }

    async getCronPresets() {
        return this.request('/cron/presets');
    }

    // ========================================
    // Uptime Tracking endpoints
    // ========================================
    async getCurrentUptime() {
        return this.request('/uptime/current');
    }

    async getUptimeStats() {
        return this.request('/uptime/stats');
    }

    async getUptimeGraph(period = '24h') {
        return this.request(`/uptime/graph?period=${period}`);
    }

    async getUptimeHistory(hours = 24) {
        return this.request(`/uptime/history?hours=${hours}`);
    }

    async startUptimeTracking() {
        return this.request('/uptime/tracking/start', { method: 'POST' });
    }

    async stopUptimeTracking() {
        return this.request('/uptime/tracking/stop', { method: 'POST' });
    }

    async getUptimeTrackingStatus() {
        return this.request('/uptime/tracking/status');
    }

    // ========================================
    // Environment Variables endpoints
    // ========================================
    async getEnvVars(appId, maskSecrets = false) {
        const params = maskSecrets ? '?mask=true' : '';
        return this.request(`/apps/${appId}/env${params}`);
    }

    async getEnvVar(appId, key) {
        return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`);
    }

    async createEnvVar(appId, key, value, isSecret = false, description = null) {
        return this.request(`/apps/${appId}/env`, {
            method: 'POST',
            body: { key, value, is_secret: isSecret, description }
        });
    }

    async updateEnvVar(appId, key, data) {
        return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`, {
            method: 'PUT',
            body: data
        });
    }

    async deleteEnvVar(appId, key) {
        return this.request(`/apps/${appId}/env/${encodeURIComponent(key)}`, {
            method: 'DELETE'
        });
    }

    async bulkSetEnvVars(appId, envVars) {
        return this.request(`/apps/${appId}/env/bulk`, {
            method: 'POST',
            body: { env_vars: envVars }
        });
    }

    async importEnvFile(appId, content, overwrite = true) {
        return this.request(`/apps/${appId}/env/import`, {
            method: 'POST',
            body: { content, overwrite }
        });
    }

    async exportEnvFile(appId, includeSecrets = true) {
        const params = includeSecrets ? '' : '?include_secrets=false';
        return this.request(`/apps/${appId}/env/export${params}`);
    }

    async getEnvVarHistory(appId, limit = 50) {
        return this.request(`/apps/${appId}/env/history?limit=${limit}`);
    }

    async clearEnvVars(appId) {
        return this.request(`/apps/${appId}/env/clear`, {
            method: 'DELETE'
        });
    }

    // ========================================
    // Two-Factor Authentication endpoints
    // ========================================
    async get2FAStatus() {
        return this.request('/auth/2fa/status');
    }

    async initiate2FASetup() {
        return this.request('/auth/2fa/setup', { method: 'POST' });
    }

    async confirm2FASetup(code) {
        return this.request('/auth/2fa/setup/confirm', {
            method: 'POST',
            body: { code }
        });
    }

    async disable2FA(code) {
        return this.request('/auth/2fa/disable', {
            method: 'POST',
            body: { code }
        });
    }

    async regenerateBackupCodes(code) {
        return this.request('/auth/2fa/backup-codes/regenerate', {
            method: 'POST',
            body: { code }
        });
    }

    async verify2FA(tempToken, code) {
        return this.request('/auth/2fa/verify', {
            method: 'POST',
            body: { temp_token: tempToken, code }
        });
    }

    // ========================================
    // Notification Webhooks endpoints
    // ========================================
    async getNotificationsStatus() {
        return this.request('/notifications/status');
    }

    async getNotificationsConfig() {
        return this.request('/notifications/config');
    }

    async updateNotificationChannel(channel, settings) {
        return this.request(`/notifications/config/${channel}`, {
            method: 'PUT',
            body: settings
        });
    }

    async testNotificationChannel(channel) {
        return this.request(`/notifications/test/${channel}`, {
            method: 'POST'
        });
    }

    async testAllNotifications() {
        return this.request('/notifications/test', {
            method: 'POST'
        });
    }

    // User notification preferences
    async getUserNotificationPreferences() {
        return this.request('/notifications/preferences');
    }

    async updateUserNotificationPreferences(preferences) {
        return this.request('/notifications/preferences', {
            method: 'PUT',
            body: preferences
        });
    }

    async testUserNotification() {
        return this.request('/notifications/preferences/test', {
            method: 'POST'
        });
    }

    // ========================================
    // Security (ClamAV, File Integrity) endpoints
    // ========================================
    async getSecurityStatus() {
        return this.request('/security/status');
    }

    async getSecurityConfig() {
        return this.request('/security/config');
    }

    async updateSecurityConfig(config) {
        return this.request('/security/config', {
            method: 'PUT',
            body: config
        });
    }

    async getClamAVStatus() {
        return this.request('/security/clamav/status');
    }

    async installClamAV() {
        return this.request('/security/clamav/install', { method: 'POST' });
    }

    async updateVirusDefinitions() {
        return this.request('/security/clamav/update', { method: 'POST' });
    }

    async scanFile(path) {
        return this.request('/security/scan/file', {
            method: 'POST',
            body: { path }
        });
    }

    async scanDirectory(path, recursive = true) {
        return this.request('/security/scan/directory', {
            method: 'POST',
            body: { path, recursive }
        });
    }

    async getScanStatus() {
        return this.request('/security/scan/status');
    }

    async cancelScan() {
        return this.request('/security/scan/cancel', { method: 'POST' });
    }

    async getScanHistory(limit = 50) {
        return this.request(`/security/scan/history?limit=${limit}`);
    }

    async runQuickScan() {
        return this.request('/security/scan/quick', { method: 'POST' });
    }

    async runFullScan() {
        return this.request('/security/scan/full', { method: 'POST' });
    }

    async getQuarantinedFiles() {
        return this.request('/security/quarantine');
    }

    async quarantineFile(path) {
        return this.request('/security/quarantine', {
            method: 'POST',
            body: { path }
        });
    }

    async deleteQuarantinedFile(filename) {
        return this.request(`/security/quarantine/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
    }

    async initializeIntegrityDatabase(paths = null) {
        return this.request('/security/integrity/initialize', {
            method: 'POST',
            body: paths ? { paths } : {}
        });
    }

    async checkFileIntegrity() {
        return this.request('/security/integrity/check');
    }

    async getFailedLogins(hours = 24) {
        return this.request(`/security/failed-logins?hours=${hours}`);
    }

    async getSecurityEvents(limit = 100) {
        return this.request(`/security/events?limit=${limit}`);
    }
}

export const api = new ApiService();
export default api;
