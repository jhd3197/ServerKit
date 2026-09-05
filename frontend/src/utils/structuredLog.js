const DOCKER_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/;

function normalizeLevel(value) {
    if (typeof value === 'number') {
        if (value >= 50) return 'error';
        if (value >= 40) return 'warn';
        if (value >= 30) return 'info';
        return 'debug';
    }

    if (typeof value !== 'string') return null;
    const level = value.toLowerCase();
    if (level === 'warning') return 'warn';
    if (level === 'fatal' || level === 'critical') return 'error';
    if (['error', 'warn', 'info', 'debug', 'trace'].includes(level)) {
        return level === 'trace' ? 'debug' : level;
    }
    return null;
}

export function parseStructuredLogLine(line) {
    const timestampMatch = line.match(DOCKER_TIMESTAMP);
    const timestamp = timestampMatch?.[1] || '';
    const content = timestampMatch?.[2] || line;

    if (!content.trimStart().startsWith('{')) {
        return {
            raw: line,
            searchable: line,
            structured: false,
            timestamp,
            level: null,
        };
    }

    try {
        const payload = JSON.parse(content);
        if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
            throw new TypeError('Structured log payload must be an object');
        }

        const formatted = JSON.stringify(payload, null, 2);
        return {
            raw: line,
            searchable: timestamp ? `${timestamp}\n${formatted}` : formatted,
            structured: true,
            timestamp,
            payload,
            formatted,
            level: normalizeLevel(payload.level),
        };
    } catch {
        return {
            raw: line,
            searchable: line,
            structured: false,
            timestamp,
            level: null,
        };
    }
}

