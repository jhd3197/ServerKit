// KEY=value parsing shared by EnvEditor and anything that imports a .env.

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvKey(key) {
    return KEY.test(String(key || ''));
}

function unquote(value) {
    const v = value.trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
        return v.slice(1, -1);
    }
    return v;
}

// "export A=1\n# note\nB='two'" -> [{ key: 'A', value: '1' }, { key: 'B', value: 'two' }]
export function parseDotenv(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => {
            const body = line.replace(/^export\s+/, '');
            const at = body.indexOf('=');
            return { key: body.slice(0, at).trim(), value: unquote(body.slice(at + 1)) };
        })
        .filter((row) => row.key);
}

export function envToObject(rows) {
    const out = {};
    for (const { key, value } of rows || []) {
        if (key && key.trim()) out[key.trim()] = value ?? '';
    }
    return out;
}

export function envFromObject(obj) {
    return Object.entries(obj || {}).map(([key, value]) => ({ key, value: value == null ? '' : String(value) }));
}

// Names that look like credentials, masked by default in editors.
export function looksSecret(key) {
    return /(PASS|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL|AUTH)/i.test(String(key || ''));
}
