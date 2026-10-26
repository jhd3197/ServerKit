import { createContext, useContext } from 'react';

// Server context for Docker operations
export const ServerContext = createContext({ serverId: 'local', serverName: 'Local' });
export const useServer = () => useContext(ServerContext);

export const VALID_TABS = ['containers', 'compose', 'images', 'volumes', 'networks'];
export const LOCAL_DOCKER_TARGET = { id: 'local', name: 'Local (this server)', status: 'online', is_local: true };

export const unwrapRemoteData = (response) => {
    if (response?.success && response.data !== undefined) {
        return response.data;
    }
    return response;
};

// formatPorts normalises Docker port data from the two shapes the agent
// returns: a comma-separated string (legacy `docker ps`-style output)
// or an array of `{ip, private_port, public_port, type}` objects from
// `docker inspect`. Always returns an array of human-readable strings,
// or `['-']` when there are no ports — both call sites (the container
// list grid and the inspector drawer) want array semantics. Rendering
// the raw inspect array directly triggered React error #31.
export function formatPorts(ports) {
    if (!ports) return ['-'];
    if (Array.isArray(ports)) {
        const formatted = ports
            .map((p) => {
                if (!p || typeof p !== 'object') return null;
                const proto = p.type || p.protocol || 'tcp';
                const priv = p.private_port ?? p.PrivatePort;
                const pub = p.public_port ?? p.PublicPort;
                const ip = p.ip || p.IP;
                if (pub) {
                    return `${ip ? `${ip}:` : ''}${pub}->${priv}/${proto}`;
                }
                return priv ? `${priv}/${proto}` : null;
            })
            .filter(Boolean);
        return formatted.length > 0 ? formatted : ['-'];
    }
    if (typeof ports !== 'string') return ['-'];
    const parts = ports.split(',').map((p) => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ['-'];
}

export const normalizeListResponse = (response, key) => {
    const data = unwrapRemoteData(response);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
};

export const shortId = (value) => value ? value.substring(0, 12) : '-';

export const getContainerId = (container) => (
    container?.id || container?.ID || container?.Id || ''
);

export const getContainerName = (container) => (
    container?.name || container?.Names || container?.Name || 'unnamed'
);

export const getContainerImage = (container) => (
    container?.image || container?.Image || container?.Config?.Image || '-'
);

export const getContainerStatus = (container) => (
    container?.status || container?.Status || container?.State?.Status || '-'
);

export const getContainerState = (container) => {
    const state = container?.state || container?.State?.Status || container?.State || '';
    return typeof state === 'string' ? state.toLowerCase() : '';
};

export const isContainerRunning = (container) => getContainerState(container) === 'running';

// ServerKit's own infrastructure containers run the panel itself, so we don't
// expose lifecycle controls (start/stop/restart/remove) for them — the backend
// rejects those calls anyway. Trust the backend `protected` flag when present;
// fall back to a name check for shapes (e.g. remote agents) that omit it.
export const SELF_CONTAINER_HINTS = ['serverkit-frontend', 'serverkit_frontend', 'serverkit-backend', 'serverkit_backend'];
export const isProtectedContainer = (container) => {
    if (container?.protected === true) return true;
    const name = getContainerName(container).toLowerCase().replace(/\//g, '');
    return SELF_CONTAINER_HINTS.some(hint => name.includes(hint));
};

export const getContainerStatusLabel = (container) => {
    if (isContainerRunning(container)) return 'Running';
    const state = getContainerState(container);
    if (state === 'exited') return 'Exited';
    if (state === 'created') return 'Created';
    return state || 'Unknown';
};

// Deterministic hue from a container name (demo's per-container accent color).
export const containerHue = (name = '') => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
};

export const getContainerProjectName = (container, details) => {
    const labels = details?.Config?.Labels || container?.Labels || {};
    return labels['com.docker.compose.project'] || labels['com.docker.compose.service'] || '-';
};

// The two transports describe the same image differently: `docker images`
// hands back repository/tag as separate strings, the agent hands back
// `repo_tags: ["nginx:latest"]` and nothing else. Every accessor below reads
// both, because a column that silently blanks on remote hosts is worse than no
// column at all.
export const imageId = (image) => String(image.id || image.ID || '').replace(/^sha256:/, '');

export const imageRef = (image) => {
    if (image.repository || image.tag) {
        return { repository: image.repository || '<none>', tag: image.tag || '<none>' };
    }
    const first = Array.isArray(image.repo_tags) ? image.repo_tags[0] : null;
    if (!first) return { repository: '<none>', tag: '<none>' };
    // A registry port ("registry:5000/app") puts a colon in the REPOSITORY
    // half, so the last colon is only the tag separator when no '/' follows it.
    const colon = first.lastIndexOf(':');
    if (colon > 0 && !first.slice(colon).includes('/')) {
        return { repository: first.slice(0, colon), tag: first.slice(colon + 1) };
    }
    return { repository: first, tag: '<none>' };
};

// Docker's CLI prints sizes in SI units ("142MB" = 142 * 10^6); the agent sends
// a byte count. Parsed to MEGABYTES rather than bytes because this number is
// also what the filter drawer and the chips show — "size is over 500 MB" is a
// question you can ask, "is over 500000000" is not. The cell still renders
// through the app's canonical formatter, so one host's images read the same way
// as another's.
const SIZE_MULTIPLIERS = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

export const imageSizeBytes = (image) => {
    const raw = image.size ?? image.Size;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    const match = raw.trim().match(/^([\d.]+)\s*([a-z]+)?$/i);
    if (!match) return null;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return null;
    return amount * (SIZE_MULTIPLIERS[(match[2] || 'b').toLowerCase()] ?? 1);
};

// The number a filter rule compares against MUST be the number the cell shows,
// or "Size is over 400 MB" matches a row whose own cell reads "392.9 MB". The
// cell renders through the app-wide formatBytes, which is base-1024 with MB/GB
// labels, so the rule value is mebibytes too — not docker's base-1000 MB.
export const imageSizeMb = (image) => {
    const bytes = imageSizeBytes(image);
    return bytes == null ? null : bytes / (1024 * 1024);
};

export const imageCreatedMs = (image) => {
    const raw = image.created ?? image.CreatedAt ?? image.Created;
    // The agent sends epoch SECONDS, the CLI "2026-08-12 09:12:33 -0400 EDT".
    if (typeof raw === 'number') return raw > 1e11 ? raw : raw * 1000;
    const parsed = Date.parse(raw || '');
    return Number.isNaN(parsed) ? null : parsed;
};
