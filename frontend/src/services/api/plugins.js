// Plugin management API methods

export async function getInstalledPlugins(status) {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.request(`/plugins/${params}`);
}

export async function getPlugin(pluginId) {
    return this.request(`/plugins/${pluginId}`);
}

// Preview a GitHub/zip extension without installing. Returns the manifest
// metadata (slug, version, permissions, panel gate), the resolved download URL,
// its sha256, and any warnings — used to render the consent card.
export async function previewPlugin(url) {
    return this.request('/plugins/preview', {
        method: 'POST',
        body: JSON.stringify({ url }),
    });
}

// Install a plugin from a URL. Pass `sha256` (from previewPlugin) to pin the
// install to the exact previewed bytes, and `signature` (the preview's
// signature object) so the install re-verifies the detached ed25519 signature
// against those pinned bytes.
export async function installPlugin(url, sha256 = null, signature = null) {
    const body = { url };
    if (sha256) body.sha256 = sha256;
    if (signature && signature.signature) {
        body.signature = signature.signature;
        if (signature.key_id) body.publisher_key_id = signature.key_id;
    }
    return this.request('/plugins/install', {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

export async function installPluginFromPath(path) {
    return this.request('/plugins/install-local', {
        method: 'POST',
        body: JSON.stringify({ path }),
    });
}

export async function installPluginFromZip(file) {
    const form = new FormData();
    form.append('file', file);
    return this.request('/plugins/install-upload', {
        method: 'POST',
        body: form,
    });
}

// Uninstall a plugin. When `purge` is true the backend also drops the
// extension's own database tables (?purge=true); otherwise data is kept so the
// extension can be reinstalled later.
export async function uninstallPlugin(pluginId, purge = false) {
    const query = purge ? '?purge=true' : '';
    return this.request(`/plugins/${pluginId}${query}`, {
        method: 'DELETE',
    });
}

export async function enablePlugin(pluginId) {
    return this.request(`/plugins/${pluginId}/enable`, {
        method: 'POST',
    });
}

export async function disablePlugin(pluginId) {
    return this.request(`/plugins/${pluginId}/disable`, {
        method: 'POST',
    });
}

// Returns the merged contribution envelope for active plugins:
//   { nav, routes, page_titles, command_palette, widgets, layouts }
// Each list item carries a `plugin` slug field so the UI can resolve
// `component` references against the right plugin module.
export async function getPluginContributions() {
    return this.request('/plugins/contributions');
}

// Fetch a plugin frontend asset (e.g. a runtime ESM bundle) as raw bytes, with
// auth. Used by the runtime loader (fetch → sha256 verify → blob-import). Unlike
// request(), this returns the body verbatim (ArrayBuffer) instead of JSON-parsing
// it, so the digest matches the backend's byte-for-byte sha256.
export async function getPluginAssetBytes(slug, assetPath) {
    const clean = String(assetPath)
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
    const url = `${this.baseUrl}/plugins/${encodeURIComponent(slug)}/assets/${clean}`;
    const token = this.getToken();
    const resp = await fetch(url, {
        headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (!resp.ok) {
        const err = new Error(`Failed to fetch ${slug} asset ${assetPath} (${resp.status})`);
        err.status = resp.status;
        throw err;
    }
    return resp.arrayBuffer();
}

// Returns extensions bundled with the repo at builtin-extensions/.
// Each entry: { folder, path, slug, manifest, installed, install_id, status }.
export async function getBuiltinExtensions() {
    return this.request('/plugins/builtin');
}

// Setup wizard: extensions recommended for the selected onboarding use cases.
// Returns { recommendations: [{ slug, display_name, description, category,
// source: 'builtin'|'registry', installed, status }] }.
export async function getRecommendedExtensions(useCases = []) {
    const list = (useCases || []).filter(Boolean);
    const q = list.length ? `?use_cases=${encodeURIComponent(list.join(','))}` : '';
    return this.request(`/plugins/recommendations${q}`);
}

// One-click install for a bundled extension by slug.
export async function installBuiltinExtension(slug) {
    return this.request(`/plugins/builtin/${encodeURIComponent(slug)}/install`, {
        method: 'POST',
    });
}

// Saved config values for an installed plugin (admin):
//   { config: {...}, config_schema: {...} }
export async function getPluginConfig(pluginId) {
    return this.request(`/plugins/${pluginId}/config`);
}

// Persist a plugin's config values (admin). The plugin reads them via
// plugins_sdk.config(slug) on the backend.
export async function updatePluginConfig(pluginId, config) {
    return this.request(`/plugins/${pluginId}/config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
    });
}

// Declared vs actually-observed permission use for one installed extension
// (admin-only):
//   { slug, permissions: [ { permission, declared, observable, used, uses,
//                            first_used_at, last_used_at, denied? } ],
//     unused_observable, undeclared_attempts, observable_count,
//     declaration_only_count }
//
// `observable` is the load-bearing field. It is true only for capabilities whose
// every use has to pass through the SDK gate (today just `agent.command:<action>`);
// for the declaration-only ones (docker, shell, filesystem, network, db) the panel
// owns no gate, so `used: false` there means "no evidence either way" and must
// never be rendered as "unused". Rows with `declared: false` were refused at the
// gate — attempts, not uses.
export async function getPluginPermissions(pluginId) {
    return this.request(`/plugins/${pluginId}/permissions`);
}

// Python dependencies an install declined to pip-install for one extension
// (admin-only):
//   { slug, pending, pip_enabled, env_var, path, content, packages, truncated }
// `pending: true` means the packages were NOT installed and the requirements
// file is sitting next to the extension. Read-only — there is no install route
// behind this by design.
export async function getPluginRequirements(pluginId) {
    return this.request(`/plugins/${pluginId}/requirements`);
}

// Returns available updates for installed plugins:
//   { updates: [ { slug, plugin_id, installed_version, available_version,
//                  update_available, compatible, source } ] }
export async function getPluginUpdates({ refresh = false } = {}) {
    return this.request(`/plugins/updates${refresh ? '?refresh=1' : ''}`);
}

// Updates an installed plugin in place; returns the updated plugin dict.
// Pass { acknowledge_risk: true } to proceed past the 409 consent gate
// (unsigned/untrusted-key/unreviewed registry versions — audit M2).
export async function updatePlugin(pluginId, body) {
    return this.request(`/plugins/${pluginId}/update`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
    });
}
