import api from './api';

/**
 * Attach what a DomainField reported to an app. A managed subdomain goes
 * through give-subdomain (vhost plus, in per-site mode, the DNS record); any
 * other hostname becomes a plain domain row. Throws on failure; returns the
 * API response.
 */
export async function attachDomain(applicationId, name, info, { isPrimary = false } = {}) {
    if (info?.mode === 'subdomain') {
        const res = await api.giveSubdomain(applicationId, info.label, info.base);
        if (!res?.success) throw new Error(res?.error || 'Failed to publish subdomain');
        return res;
    }
    return api.createDomain({
        name,
        application_id: applicationId,
        is_primary: isPrimary,
        ssl_enabled: false,
    });
}
