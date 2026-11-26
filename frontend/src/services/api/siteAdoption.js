// Site adoption (/api/v1/apps/host-sites) — register sites that already run on
// this host. Discovery is read-only; adopting records rows and never rewrites
// the running nginx / PHP-FPM config. Admin-only on the server.

export async function getHostSites() {
    return this.request('/apps/host-sites');
}

// A dry run unless `apply` is true: the server's default answer is the plan.
export async function adoptHostSite(site, { name, apply = false } = {}) {
    return this.request('/apps/host-sites/adopt', {
        method: 'POST',
        body: { site, name: name || undefined, dry_run: !apply },
    });
}
