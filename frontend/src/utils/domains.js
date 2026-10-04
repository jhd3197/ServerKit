// Hostname helpers shared by every place a user types a domain. Before this,
// the same regex was copied into the service settings tab and two WordPress
// screens, and none of them stripped a pasted "https://" or trailing path.

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const WILDCARD_HOSTNAME = /^\*\.(?=.{1,251}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// "HTTPS://Shop.Example.com/path?q" -> "shop.example.com"
export function normalizeDomain(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/[/?#].*$/, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '');
}

export function isValidDomain(input, { allowWildcard = false } = {}) {
    const name = normalizeDomain(input);
    if (HOSTNAME.test(name)) return true;
    return allowWildcard && WILDCARD_HOSTNAME.test(name);
}

// What a user may type in front of a base domain: one or more labels.
// "My App!" -> "my-app"
export function slugifyLabel(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/\.{2,}/g, '.')
        .replace(/^[-.]+/, '');
}

// "blog.acme.dev" under base "acme.dev" -> "blog"; null when it is not under it.
export function labelUnderBase(fqdn, base) {
    const name = normalizeDomain(fqdn);
    const suffix = `.${normalizeDomain(base)}`;
    if (!base || !name.endsWith(suffix)) return null;
    const label = name.slice(0, -suffix.length);
    return label || null;
}
