import { METRIC_LABELS } from './fleetMetrics.js';

const SERVICE_PREFIX = 'svc:';

const isNumber = (value) => typeof value === 'number' && !Number.isNaN(value);
const hasValue = (value) => value !== null && value !== undefined && value !== '';

// Wording for a fleet alert row. Threshold alerts read "<metric> over limit";
// host-offline and service-down alerts have no limit, so they never say it.
// `detail` drops every missing fragment instead of printing "—" or "null".
export function fleetAlertText(t, alert, subject) {
    const { metric, value, threshold } = alert;

    if (metric === 'offline') {
        return {
            title: t('app.incidents.hostOffline', 'Host offline'),
            detail: t('app.incidents.hostOfflineDetail', '{{subject}} stopped reporting', { subject }),
        };
    }

    if (typeof metric === 'string' && metric.startsWith(SERVICE_PREFIX)) {
        const service = metric.slice(SERVICE_PREFIX.length);
        return {
            title: t('app.incidents.serviceDown', '{{service}} is down', { service }),
            detail: t('app.incidents.serviceDownDetail', 'on {{subject}}', { subject }),
        };
    }

    const label = METRIC_LABELS[metric] || metric;
    const parts = [];
    if (isNumber(value)) parts.push(`${label} ${value.toFixed(1)}`);
    if (hasValue(threshold)) parts.push(t('app.incidents.limitValue', 'Limit: {{value}}', { value: threshold }));
    return {
        title: t('app.incidents.overLimitOn', '{{metric}} over limit on {{subject}}', { metric: label, subject }),
        detail: parts.join(' · ') || label,
    };
}
