import api from './api';

const BASE_PATH = '/wordpress/sites';

const wordpressApi = {
    // Site Management
    getSites: () => api.request(BASE_PATH),

    createSite: (data) => api.request(BASE_PATH, {
        method: 'POST',
        body: data
    }),

    getSite: (id) => api.request(`${BASE_PATH}/${id}`),

    deleteSite: (id) => api.request(`${BASE_PATH}/${id}`, {
        method: 'DELETE'
    }),

    // Environment Management
    getEnvironments: (siteId) => api.request(`${BASE_PATH}/${siteId}/environments`),

    createEnvironment: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/environments`, {
        method: 'POST',
        body: data
    }),

    deleteEnvironment: (siteId, envId) => api.request(`${BASE_PATH}/${siteId}/environments/${envId}`, {
        method: 'DELETE'
    }),

    syncEnvironment: (siteId, data = {}) => api.request(`${BASE_PATH}/${siteId}/sync`, {
        method: 'POST',
        body: data
    }),

    // Database Snapshots
    getSnapshots: (siteId) => api.request(`${BASE_PATH}/${siteId}/snapshots`),

    createSnapshot: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/snapshots`, {
        method: 'POST',
        body: data
    }),

    restoreSnapshot: (siteId, snapId) => api.request(`${BASE_PATH}/${siteId}/snapshots/${snapId}/restore`, {
        method: 'POST'
    }),

    deleteSnapshot: (siteId, snapId) => api.request(`${BASE_PATH}/${siteId}/snapshots/${snapId}`, {
        method: 'DELETE'
    }),

    // Git Integration
    getGitStatus: (siteId) => api.request(`${BASE_PATH}/${siteId}/git`),

    connectRepo: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/git`, {
        method: 'POST',
        body: data
    }),

    disconnectRepo: (siteId) => api.request(`${BASE_PATH}/${siteId}/git`, {
        method: 'DELETE'
    }),

    getCommits: (siteId, limit = 20) => api.request(`${BASE_PATH}/${siteId}/git/commits?limit=${limit}`),

    deployCommit: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/git/deploy`, {
        method: 'POST',
        body: data
    }),

    createDevFromCommit: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/git/dev-from-commit`, {
        method: 'POST',
        body: data
    }),

    // Plugins
    getPlugins: (siteId) => api.request(`${BASE_PATH}/${siteId}/plugins`),

    installPlugin: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/plugins`, {
        method: 'POST',
        body: data
    }),

    // Themes
    getThemes: (siteId) => api.request(`${BASE_PATH}/${siteId}/themes`),

    installTheme: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/themes`, {
        method: 'POST',
        body: data
    }),

    // WordPress Core Update
    updateCore: (siteId) => api.request(`${BASE_PATH}/${siteId}/update`, {
        method: 'POST'
    }),

    // Clone Database (for advanced use)
    cloneDatabase: (siteId, data) => api.request(`${BASE_PATH}/${siteId}/clone-db`, {
        method: 'POST',
        body: data
    }),

    // =========================================
    // Pipeline API (Environment Management v2)
    // =========================================
    PIPELINE_PATH: '/wordpress/projects',

    // Project listing
    getProjects: () => api.request('/wordpress/projects'),

    // Pipeline dashboard
    getProjectPipeline: (prodId) => api.request(`/wordpress/projects/${prodId}/pipeline`),

    // Environment CRUD
    createProjectEnvironment: (prodId, data) => api.request(`/wordpress/projects/${prodId}/environments`, {
        method: 'POST',
        body: data
    }),

    getProjectEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}`),

    deleteProjectEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}`, {
        method: 'DELETE'
    }),

    // Container lifecycle
    startEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/start`, {
        method: 'POST'
    }),

    stopEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/stop`, {
        method: 'POST'
    }),

    restartEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/restart`, {
        method: 'POST'
    }),

    // Promotion
    promoteEnvironment: (prodId, data) => api.request(`/wordpress/projects/${prodId}/promote`, {
        method: 'POST',
        body: data
    }),

    // Sync from production
    syncProjectEnvironment: (prodId, envId, data) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/sync`, {
        method: 'POST',
        body: data
    }),

    // Compare environments
    compareEnvironments: (prodId, envAId, envBId) =>
        api.request(`/wordpress/projects/${prodId}/compare?env_a=${envAId}&env_b=${envBId}`),

    // Locking
    lockEnvironment: (prodId, envId, data) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/lock`, {
        method: 'POST',
        body: data
    }),

    unlockEnvironment: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/lock`, {
        method: 'DELETE'
    }),

    // Activity log
    getProjectActivity: (prodId, params = {}) => {
        const query = new URLSearchParams(params).toString();
        return api.request(`/wordpress/projects/${prodId}/activity${query ? `?${query}` : ''}`);
    },

    // Container logs
    getEnvironmentLogs: (prodId, envId, params = {}) => {
        const query = new URLSearchParams(params).toString();
        return api.request(`/wordpress/projects/${prodId}/environments/${envId}/logs${query ? `?${query}` : ''}`);
    },

    // Promotion history
    getPromotionHistory: (prodId, params = {}) => {
        const query = new URLSearchParams(params).toString();
        return api.request(`/wordpress/projects/${prodId}/promotions${query ? `?${query}` : ''}`);
    },

    // Git branches (for multidev)
    getBranches: (prodId) => api.request(`/wordpress/projects/${prodId}/git/branches`),

    // Multidev cleanup
    cleanupMultidevs: (prodId, dryRun = true) => api.request(`/wordpress/projects/${prodId}/multidev/cleanup`, {
        method: 'POST',
        body: { dry_run: dryRun }
    }),

    // Sanitization Profiles
    getSanitizationProfiles: () => api.request('/wordpress/projects/sanitization-profiles'),

    createSanitizationProfile: (data) => api.request('/wordpress/projects/sanitization-profiles', {
        method: 'POST',
        body: data
    }),

    updateSanitizationProfile: (profileId, data) => api.request(`/wordpress/projects/sanitization-profiles/${profileId}`, {
        method: 'PUT',
        body: data
    }),

    deleteSanitizationProfile: (profileId) => api.request(`/wordpress/projects/sanitization-profiles/${profileId}`, {
        method: 'DELETE'
    }),

    // =========================================
    // Phase 7: Advanced Features
    // =========================================

    // Resource Limits
    updateResourceLimits: (prodId, envId, limits) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/resources`, {
        method: 'PUT',
        body: limits
    }),

    // Basic Auth
    enableBasicAuth: (prodId, envId, data = {}) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/auth`, {
        method: 'POST',
        body: data
    }),

    disableBasicAuth: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/auth`, {
        method: 'DELETE'
    }),

    getBasicAuthStatus: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/auth`),

    // WP-CLI
    executeWpCli: (prodId, envId, command) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/exec`, {
        method: 'POST',
        body: { command }
    }),

    // Health
    getEnvironmentHealth: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/health`),

    getProjectHealth: (prodId) => api.request(`/wordpress/projects/${prodId}/health`),

    // Disk Usage
    getEnvironmentDiskUsage: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/disk-usage`),

    getProjectDiskUsage: (prodId) => api.request(`/wordpress/projects/${prodId}/disk-usage`),

    // Bulk Operations
    executeBulkOperation: (prodId, operations) => api.request(`/wordpress/projects/${prodId}/bulk`, {
        method: 'POST',
        body: { operations }
    }),

    // Auto-Sync
    getAutoSyncSchedule: (prodId, envId) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/auto-sync`),

    updateAutoSyncSchedule: (prodId, envId, config) => api.request(`/wordpress/projects/${prodId}/environments/${envId}/auto-sync`, {
        method: 'PUT',
        body: config
    })
};

export default wordpressApi;
