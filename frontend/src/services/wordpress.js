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
    })
};

export default wordpressApi;
