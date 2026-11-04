import { METRIC_LABELS } from './fleetMetrics.js';

// Plain-language title/detail for a metric alert. The backend's `metric` is
// either a threshold metric (cpu, memory, disk, network_*) or a health signal
// with no reading at all: `offline` (server stopped reporting) and
// `svc:<name>` (a watched service is down). Only the first kind has a value and
// limit, so only it may talk about going "over limit".
const SERVICE_PREFIX = 'svc:';

export function classifyAlertMetric(metric) {
    if (metric === 'offline') return { kind: 'offline' };
    if (typeof metric === 'string' && metric.startsWith(SERVICE_PREFIX)) {
        return { kind: 'service', service: metric.slice(SERVICE_PREFIX.length) || null };
    }
    return { kind: 'threshold' };
}

export function formatReading(value, digits = 1) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : null;
}

export function metricLabel(metric) {
    return METRIC_LABELS[metric] || metric || null;
}

// `t` is i18next's translate function (injected so this stays testable).
export function describeAlert(t, { metric, value, threshold, subject }) {
    const { kind, service } = classifyAlertMetric(metric);
    if (kind === 'offline') {
        return {
            title: t('app.alertCopy.offlineTitle', '{{subject}} is offline', { subject }),
            detail: t('app.alertCopy.offlineDetail', 'Stopped reporting'),
        };
    }
    if (kind === 'service') {
        return service
            ? {
                title: t('app.alertCopy.serviceDownTitle', '{{service}} is down on {{subject}}', { service, subject }),
                detail: t('app.alertCopy.serviceDownDetail', '{{service}} is not running', { service }),
            }
            : {
                title: t('app.alertCopy.serviceDownAnyTitle', 'A service is down on {{subject}}', { subject }),
                detail: t('app.alertCopy.serviceDownAnyDetail', 'Service not running'),
            };
    }
    const label = metricLabel(metric);
    const reading = formatReading(value);
    const limit = formatReading(threshold, 0);
    if (!label) {
        return { title: t('app.alertCopy.genericTitle', 'Alert on {{subject}}', { subject }), detail: '' };
    }
    let detail = label;
    if (reading && limit) {
        detail = t('app.alertCopy.readingOfLimit', '{{metric}} {{reading}} of {{limit}} limit', { metric: label, reading, limit });
    } else if (reading) {
        detail = t('app.alertCopy.readingOnly', '{{metric}} {{reading}}', { metric: label, reading });
    }
    return {
        title: t('app.alertCopy.overLimitTitle', '{{metric}} over limit on {{subject}}', { metric: label, subject }),
        detail,
    };
}
