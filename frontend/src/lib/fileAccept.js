// File checks behind FileDropzone. The `accept` string has the same grammar
// as <input accept>: comma-separated extensions (".zip"), wildcards
// ("image/*") and exact MIME types ("application/json"). The browser only
// applies it to the picker dialog — a dropped file skips it entirely — so the
// dropzone re-checks every file here.

export function parseAccept(accept) {
    if (!accept) return [];
    return accept.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
}

export function matchesAccept(file, accept) {
    const rules = Array.isArray(accept) ? accept : parseAccept(accept);
    if (!rules.length) return true;
    const name = (file.name || '').toLowerCase();
    const type = (file.type || '').toLowerCase();
    return rules.some((rule) => {
        if (rule.startsWith('.')) return name.endsWith(rule);
        if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
        return type === rule;
    });
}

/**
 * Split files into accepted and rejected. Each rejection carries a `reason`
 * code ('type' | 'size' | 'count') the UI turns into copy.
 */
export function validateFiles(files, { accept, maxSize, maxFiles, existingCount = 0 } = {}) {
    const rules = parseAccept(accept);
    const accepted = [];
    const rejected = [];
    for (const file of files) {
        if (!matchesAccept(file, rules)) {
            rejected.push({ file, reason: 'type' });
        } else if (Number.isFinite(maxSize) && file.size > maxSize) {
            rejected.push({ file, reason: 'size' });
        } else if (Number.isFinite(maxFiles) && existingCount + accepted.length >= maxFiles) {
            rejected.push({ file, reason: 'count' });
        } else {
            accepted.push(file);
        }
    }
    return { accepted, rejected };
}
