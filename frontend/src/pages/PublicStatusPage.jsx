import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import EmptyState from '../components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STATUS_META = {
    operational: { labelKey: 'app.publicStatusPage.operational', label: 'Operational', badge: 'success', icon: CheckCircle2 },
    degraded: { labelKey: 'app.publicStatusPage.degraded', label: 'Degraded', badge: 'warning', icon: AlertTriangle },
    partial_outage: { labelKey: 'app.publicStatusPage.partialOutage', label: 'Partial outage', badge: 'warning', icon: AlertTriangle },
    major_outage: { labelKey: 'app.publicStatusPage.majorOutage', label: 'Major outage', badge: 'destructive', icon: XCircle },
    maintenance: { labelKey: 'app.publicStatusPage.maintenance', label: 'Maintenance', badge: 'info', icon: Clock },
};

const IMPACT_META = {
    none: 'None',
    minor: 'Minor',
    major: 'Major',
    critical: 'Critical',
};

function formatDate(value) {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
}

function formatUptime(value) {
    if (typeof value !== 'number') return '100.00%';
    return `${value.toFixed(2)}%`;
}

function PublicStatusPage() {
    const { t } = useTranslation();
    const { slug } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function loadPage() {
            try {
                setLoading(true);
                setError(null);
                const response = await api.getPublicStatusPage(slug);
                setData(response);
            } catch (err) {
                setError(err.message || 'Status page not found');
            } finally {
                setLoading(false);
            }
        }

        loadPage();
    }, [slug]);

    const components = useMemo(() => {
        if (!data?.groups) return [];
        return Object.values(data.groups).flat();
    }, [data]);

    if (loading) {
        return (
            <main className="public-status-page">
                <EmptyState loading loadingVariant="detail" title={t('app.publicStatusPage.loadingStatus', 'Loading status')} />
            </main>
        );
    }

    if (error || !data) {
        return (
            <main className="public-status-page">
                <section className="public-status-shell public-status-shell--empty">
                    <XCircle size={32} />
                    <h1>{t('app.publicStatusPage.statusPageUnavailable', 'Status page unavailable')}</h1>
                    <p>{error || 'Status page not found'}</p>
                </section>
            </main>
        );
    }

    const { page, overall_status: overallStatus, active_incidents: activeIncidents = [], recent_incidents: recentIncidents = [] } = data;
    const overallMeta = STATUS_META[overallStatus] || STATUS_META.operational;
    const OverallIcon = overallMeta.icon;

    return (
        <main className="public-status-page">
            <section className={`public-status-hero public-status-hero--${overallStatus}`}>
                <div>
                    <h1>{page.name}</h1>
                    {page.description && <p>{page.description}</p>}
                </div>
                <Badge variant={overallMeta.badge} className="public-status-badge">
                    <OverallIcon size={16} />
                    {overallMeta.label}
                </Badge>
            </section>

            <section className="public-status-summary">
                <div>
                    <span>{t('app.publicStatusPage.components', 'Components')}</span>
                    <strong>{components.length}</strong>
                </div>
                <div>
                    <span>{t('app.publicStatusPage.activeIncidents', 'Active incidents')}</span>
                    <strong>{activeIncidents.length}</strong>
                </div>
                <div>
                    <span>{t('app.publicStatusPage.30DayUptime', '30 day uptime')}</span>
                    <strong>{formatUptime(
                        components.length
                            ? components.reduce((total, component) => total + (component.uptime_30d || 100), 0) / components.length
                            : 100
                    )}</strong>
                </div>
            </section>

            {activeIncidents.length > 0 && (
                <section className="public-status-section">
                    <header>
                        <h2>{t('app.publicStatusPage.activeIncidents2', 'Active incidents')}</h2>
                    </header>
                    <div className="public-incident-list">
                        {activeIncidents.map((incident) => (
                            <article key={incident.id} className="public-incident public-incident--active">
                                <div>
                                    <h3>{incident.title}</h3>
                                    <span>{formatDate(incident.created_at)}</span>
                                </div>
                                <Badge variant="warning">{IMPACT_META[incident.impact] || incident.impact}</Badge>
                                {incident.body && <p>{incident.body}</p>}
                            </article>
                        ))}
                    </div>
                </section>
            )}

            <section className="public-status-section">
                <header>
                    <h2>{t('app.publicStatusPage.components', 'Components')}</h2>
                </header>
                <div className="public-component-groups">
                    {Object.entries(data.groups || {}).map(([groupName, groupComponents]) => (
                        <div key={groupName} className="public-component-group">
                            <h3>{groupName}</h3>
                            <div className="public-component-list">
                                {groupComponents.map((component) => {
                                    const statusMeta = STATUS_META[component.status] || STATUS_META.operational;
                                    const StatusIcon = statusMeta.icon;
                                    return (
                                        <article key={component.id} className="public-component-row">
                                            <div>
                                                <StatusIcon size={18} />
                                                <span>{component.name}</span>
                                            </div>
                                            <div className="public-component-row__meta">
                                                <span>{formatUptime(component.uptime_30d)}</span>
                                                {component.last_response_time && <span>{component.last_response_time}ms</span>}
                                                <Badge variant={statusMeta.badge}>{statusMeta.label}</Badge>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {components.length === 0 && (
                        <div className="public-status-empty">
                            <Activity size={24} />
                            <span>{t('app.publicStatusPage.noComponentsPublished', 'No components published.')}</span>
                        </div>
                    )}
                </div>
            </section>

            {recentIncidents.length > 0 && (
                <section className="public-status-section">
                    <header>
                        <h2>{t('app.publicStatusPage.recentIncidents', 'Recent incidents')}</h2>
                    </header>
                    <div className="public-incident-list">
                        {recentIncidents.map((incident) => (
                            <article key={incident.id} className="public-incident">
                                <div>
                                    <h3>{incident.title}</h3>
                                    <span>{formatDate(incident.resolved_at || incident.created_at)}</span>
                                </div>
                                <Badge variant="success">{t('app.publicStatusPage.resolved', 'Resolved')}</Badge>
                            </article>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}

export default PublicStatusPage;
