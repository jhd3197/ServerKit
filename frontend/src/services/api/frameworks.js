// Framework picker API — "Start from a framework" in the New Service wizard.
// Backend blueprint mounted at /api/v1/frameworks.

// The data-driven registry: [{ id, name, description, language, available,
// php_version, database: { supported, default, label }, steps }].
export async function listFrameworks() {
    return this.request('/frameworks');
}

// Scaffold + provision + deploy. Body: { framework, name, domain?,
// add_database?, project_id?, environment_id? }. Returns { app, deploy_job_id }.
export async function scaffoldFramework(body) {
    return this.request('/frameworks/scaffold', {
        method: 'POST',
        body,
    });
}
