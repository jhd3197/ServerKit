// What ServerPicker reports, turned into the operational "target" object the
// file manager and terminal tools pass around: { kind: 'local' } for the
// panel host, { kind: 'agent', server_id, … } for a remote server, or
// { kind: <id> } for a non-server source such as an S3 bucket.

export const LOCAL_SERVER_ID = 'local';

export function serverTarget(id, server) {
    const key = String(id ?? LOCAL_SERVER_ID);
    if (key === LOCAL_SERVER_ID) return { kind: 'local' };
    if (!server) return { kind: key };
    return {
        kind: 'agent',
        server_id: key,
        name: server.name || server.hostname || key,
        allowedPaths: server.allowed_paths || [],
        os_type: server.os_type || null,
        agentInstallDir: server.agent_install_dir || null,
        agentConfigDir: server.agent_config_dir || null,
    };
}

// The ServerPicker value for a target object.
export function targetServerId(target) {
    if (!target || target.kind === 'local') return LOCAL_SERVER_ID;
    if (target.kind === 'agent') return String(target.server_id);
    return String(target.kind);
}
