// Shared vocabulary for the monitor surfaces (list, detail, overview, incidents).
// Keeping the status mapping in one place stops the list and the detail page
// disagreeing about what "degraded" looks like.

import { statusKind } from '@/components/ds/status';

export const CHECK_TYPES = [
    { value: 'http', label: 'HTTP', hintKey: 'app.monitorShared.statusCodeOfAUrl', hint: 'status code of a URL' },
    { value: 'keyword', labelKey: 'app.monitorShared.keyword', label: 'Keyword', hintKey: 'app.monitorShared.urlMustContainAPhrase', hint: 'URL must contain a phrase' },
    { value: 'tcp', labelKey: 'common.labels.port', label: 'Port', hintKey: 'app.monitorShared.hostPortAcceptsAConnection', hint: 'host:port accepts a connection' },
    { value: 'ping', labelKey: 'app.monitorShared.ping', label: 'Ping', hintKey: 'app.monitorShared.hostAnswersIcmp', hint: 'host answers ICMP' },
    { value: 'dns', label: 'DNS', hintKey: 'app.monitorShared.nameResolves', hint: 'name resolves' },
    { value: 'smtp', label: 'SMTP', hintKey: 'app.monitorShared.mailServerGreets', hint: 'mail server greets' },
];

export const MONITOR_STATUS = [
    { value: 'operational', labelKey: 'app.monitorShared.operational', label: 'Operational' },
    { value: 'degraded', labelKey: 'app.monitorShared.degraded', label: 'Degraded' },
    { value: 'major_outage', labelKey: 'app.monitorShared.down', label: 'Down' },
    { value: 'maintenance', labelKey: 'app.monitorShared.maintenance', label: 'Maintenance' },
    { value: 'paused', labelKey: 'app.monitorShared.paused', label: 'Paused' },
];

// Paused is deliberately not a `status` on the model — it is its own flag, so a
// paused monitor keeps the last thing it knew rather than looking like an
// outage. Resolve it here, once.
export function monitorStateOf(monitor) {
    if (!monitor) return { key: 'unknown', labelKey: 'app.monitorShared.unknown', label: 'Unknown', tone: 'gray' };
    if (monitor.is_paused) return { key: 'paused', labelKey: 'app.monitorShared.paused', label: 'Paused', tone: 'gray' };
    switch (monitor.status) {
        case 'operational':
            return { key: 'up', labelKey: 'app.monitorShared.operational', label: 'Operational', tone: 'green' };
        case 'degraded':
        case 'partial_outage':
            return { key: 'degraded', labelKey: 'app.monitorShared.degraded', label: 'Degraded', tone: 'amber' };
        case 'major_outage':
            return { key: 'down', labelKey: 'app.monitorShared.down', label: 'Down', tone: 'red' };
        case 'maintenance':
            return { key: 'maintenance', labelKey: 'app.monitorShared.maintenance', label: 'Maintenance', tone: 'cyan' };
        default:
            return monitor.status
                ? { key: 'unknown', label: monitor.status, tone: 'gray' }
                : { key: 'unknown', labelKey: 'app.monitorShared.unknown', label: 'Unknown', tone: 'gray' };
    }
}

export const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'];

// Impact levels ride the shared vocabulary (plan 77 D3).
export const impactTone = (impact) => statusKind(impact);
