function containerId(container) {
    return container?.id ?? container?.Id ?? container?.ID ?? null;
}

function containerNames(container) {
    const raw = container?.name ?? container?.Names ?? '';
    return Array.isArray(raw) ? raw : String(raw).split(',').filter(Boolean);
}

/**
 * Resolve an application's runtime without dropping support for legacy
 * container-list payloads and compose labels.
 */
export function resolveAppContainerId(app, containers = []) {
    if (app?.container_id) return app.container_id;

    const appName = String(app?.name || '').toLowerCase();
    const generatedName = app?.id ? `serverkit-app-${app.id}` : '';
    const match = containers.find((container) => {
        const names = containerNames(container).map((name) => name.toLowerCase());
        const labels = container?.Labels ?? container?.labels ?? {};
        const composeProject = typeof labels === 'object'
            ? labels['com.docker.compose.project']
            : '';

        return (generatedName && names.some((name) => name === generatedName))
            || (appName && names.some((name) => name.includes(appName)))
            || (appName && String(composeProject || '').toLowerCase() === appName);
    });

    return containerId(match);
}

function percent(value) {
    const parsed = Number.parseFloat(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Accept both the wrapped API response and the historical raw Docker shape. */
export function normalizeContainerStats(response) {
    const stats = response?.stats ?? response ?? {};
    return {
        cpuPercent: percent(stats.cpu_percent ?? stats.CPUPerc),
        memoryPercent: percent(stats.memory_percent ?? stats.MemPerc),
        memoryUsage: stats.memory_usage ?? stats.MemUsage ?? 'N/A',
        networkIO: stats.net_io ?? stats.NetIO ?? 'N/A',
        blockIO: stats.block_io ?? stats.BlockIO ?? 'N/A',
        pids: stats.pids ?? stats.PIDs ?? 'N/A',
    };
}
