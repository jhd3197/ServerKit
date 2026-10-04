import { useEffect, useMemo, useState } from 'react';
import { Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ResourcePicker from './ResourcePicker';
import api from '../services/api';
import { formatBytes } from '../utils/formatBytes';
import { LOCAL_SERVER_ID } from '../utils/serverTarget';

// The panel's server list rarely changes while a page is open, and several
// pickers can mount at once, so they share one request per page load.
let serversRequest = null;
function loadServers() {
    if (!serversRequest) {
        serversRequest = api.getAvailableServers()
            .then((data) => (Array.isArray(data) ? data : []))
            .catch(() => {
                serversRequest = null;
                return [];
            });
    }
    return serversRequest;
}

const enabledCapabilities = (server) => {
    const caps = Object.entries(server?.capabilities || {})
        .filter(([, enabled]) => enabled === true)
        .map(([name]) => name);
    if ((server?.is_local || server?.has_docker) && !caps.includes('docker')) caps.push('docker');
    return caps;
};

function capacityLabel(server) {
    const parts = [];
    if (server.cpu_cores) parts.push(`${server.cpu_cores} vCPU`);
    if (server.total_memory) parts.push(formatBytes(server.total_memory, { decimals: 0 }));
    return parts.join(' · ');
}

/**
 * The one server picker: "which machine does this run on".
 *
 *   <ServerPicker value={serverId} onChange={(id, server) => …} capability="docker" />
 *
 * `value` is a server id, or LOCAL_SERVER_ID for the panel host. `onChange`
 * gets the id and the full server row from /servers/available (allowed_paths,
 * os_type, agent dirs, …) or null for an `extraOptions` entry. Offline
 * servers are hidden unless `onlineOnly` is false; `capability` narrows the
 * list to servers that can do the job.
 */
export default function ServerPicker({
    value = LOCAL_SERVER_ID,
    onChange,
    capability,
    includeLocal = true,
    onlineOnly = true,
    extraOptions = [],
    label,
    disabled = false,
    className,
}) {
    const { t } = useTranslation();
    const [servers, setServers] = useState([]);

    useEffect(() => {
        let cancelled = false;
        loadServers().then((rows) => { if (!cancelled) setServers(rows); });
        return () => { cancelled = true; };
    }, []);

    const serverById = useMemo(
        () => new Map(servers.map((server) => [String(server.id), server])),
        [servers],
    );

    const localServer = servers.find((server) => server.is_local) || null;

    const describe = (server) => {
        const location = server.is_local
            ? t('app.serverPicker.thisPanel', 'this panel')
            : (server.group_name || t('app.serverPicker.remote', 'remote'));
        return [server.os_type ? `${location} · ${server.os_type}` : location, capacityLabel(server)]
            .filter(Boolean).join(' · ');
    };

    const localOption = useMemo(() => ({
        type: 'server-target',
        id: LOCAL_SERVER_ID,
        label: t('app.targetPicker.localThisServer', 'Local (this server)'),
        sublabel: localServer ? describe(localServer) : '',
        path: '/servers',
        scope: {},
        status: 'online',
        capabilities: localServer ? enabledCapabilities(localServer) : ['docker'],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [localServer, t]);

    const staticOptions = useMemo(() => [
        ...(includeLocal ? [localOption] : []),
        ...extraOptions.map((option) => ({
            type: 'server-target',
            id: String(option.value),
            label: option.label,
            sublabel: option.sublabel || '',
            path: '/servers',
            scope: {},
            status: null,
            capabilities: [],
        })),
    ], [extraOptions, includeLocal, localOption]);

    const selected = useMemo(() => {
        const id = String(value ?? LOCAL_SERVER_ID);
        const fromStatic = staticOptions.find((option) => option.id === id);
        if (fromStatic) return fromStatic;
        const server = serverById.get(id);
        if (!server) return null;
        return {
            type: 'server',
            id,
            label: server.name || server.hostname || id,
            sublabel: describe(server),
            path: `/servers/${id}`,
            scope: {},
            status: server.status || null,
            capabilities: enabledCapabilities(server),
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, staticOptions, serverById]);

    const decorateOption = (resource) => {
        const server = serverById.get(resource.id);
        if (!server || resource.type !== 'server') return resource;
        return {
            ...resource,
            sublabel: describe(server),
            capabilities: [...new Set([...resource.capabilities, ...enabledCapabilities(server)])],
        };
    };

    const filterOption = (resource) => {
        if (resource.type !== 'server') return true;
        if (serverById.get(resource.id)?.is_local) return false; // shown as "Local"
        if (onlineOnly && resource.status && resource.status !== 'online') return false;
        return true;
    };

    const pickerLabel = label || t('app.serverPicker.server', 'Server');

    return (
        <ResourcePicker
            value={selected}
            onChange={(resource) => {
                if (resource.type === 'server-target') {
                    onChange?.(resource.id, resource.id === LOCAL_SERVER_ID ? localServer : null);
                    return;
                }
                onChange?.(resource.id, serverById.get(resource.id) || null);
            }}
            types={['server']}
            capabilities={capability ? [capability] : []}
            staticOptions={staticOptions}
            filterOption={filterOption}
            decorateOption={decorateOption}
            icon={Server}
            disabled={disabled}
            label={pickerLabel}
            placeholder={pickerLabel}
            searchPlaceholder={t('app.serverPicker.findAServer', 'Find a server…')}
            emptyMessage={t('app.serverPicker.noServersMatch', 'No servers match.')}
            className={['sk-server-picker', className].filter(Boolean).join(' ')}
        />
    );
}
