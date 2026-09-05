import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Rocket, CheckCircle2, XCircle, Globe, Database, ShieldCheck, ExternalLink } from 'lucide-react';
import { servicePortUrl } from '@/utils/serviceUrl';
import api from '../../services/api';
import { useDeployments } from '../../hooks/useDeployments';
import { getDeployStatus, formatRelativeTime, formatDuration } from '../../utils/serviceTypes';
import { formatBytes } from '../../utils/formatBytes';
import BandwidthSparkline from '../BandwidthSparkline';
import ScheduledTasksCard from '../ScheduledTasksCard';
import { KpiBand, MetricCard, Pill, Gauge, EnvTag, statusKind } from '@/components/ds';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { normalizeContainerStats, resolveAppContainerId } from '@/utils/containerMetrics';

// Live metrics cadence.
const METRICS_REFRESH_MS = 10000;


// Deployment status → tone comes from the ONE shared vocabulary (ds/status).
// environment_type → short EnvTag label
const ENV_LABEL = {
    production: 'PROD',
    development: 'DEV',
    staging: 'STAGING',
};

const OverviewTab = ({ app, deployConfig }) => {
    const { t } = useTranslation();
    const [metrics, setMetrics] = useState(null);
    const [metricsLoading, setMetricsLoading] = useState(true);
    const [bandwidth, setBandwidth] = useState(null);
    const [related, setRelated] = useState(null);
    const { deployments, loading: deploymentsLoading } = useDeployments(app.id);

    const isDocker = app.app_type === 'docker';
    const isPython = ['flask', 'django'].includes(app.app_type);

    // Load on mount and whenever the app changes; poll on top of that.
    useEffect(() => { loadMetrics(); }, [app.id]);
    usePolling(loadMetrics, METRICS_REFRESH_MS, { immediate: false });

    useEffect(() => {
        // Best-effort daily rollups; hide the card when there is no data.
        let cancelled = false;
        api.getAppBandwidth(app.id, 90)
            .then((data) => { if (!cancelled) setBandwidth(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id]);

    useEffect(() => {
        // Related resources (domains, DBs, backups, deploys). Member-visible.
        let cancelled = false;
        api.getAppRelatedResources(app.id)
            .then((data) => { if (!cancelled) setRelated(data); })
            // Settle to an empty result rather than staying null: null is
            // the card's "still loading" state, so swallowing the error
            // left it spinning forever.
            .catch(() => { if (!cancelled) setRelated({}); });
        return () => { cancelled = true; };
    }, [app.id]);

    async function loadMetrics() {
        try {
            if (isDocker) {
                const data = await api.getContainers(true);
                const runtimeId = resolveAppContainerId(app, data.containers || []);
                if (runtimeId) {
                    const containerStats = normalizeContainerStats(
                        await api.getContainerStats(runtimeId)
                    );
                    setMetrics({
                        cpu: containerStats.cpuPercent,
                        memory: containerStats.memoryPercent,
                        memUsage: containerStats.memoryUsage,
                        netIO: containerStats.networkIO,
                        pids: containerStats.pids,
                    });
                }
            } else if (isPython) {
                const data = await api.getPythonAppStatus(app.id);
                setMetrics({
                    active: data.active,
                    pid: data.pid,
                    memory: data.memory,
                    uptime: data.uptime,
                    workers: data.workers,
                });
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        } finally {
            setMetricsLoading(false);
        }
    }

    // No link when a domain fronts it — the Domain row above is the one to follow.
    const portUrl = app.domain ? null : servicePortUrl(app);

    const successfulDeploys = deployments.filter(d => d.status === 'success');
    const failedDeploys = deployments.filter(d => d.status === 'failed');

    return (
        <div className="overview-tab">
            {/* KPI Strip */}
            <KpiBand>
                <MetricCard
                    tone={app.isRunning ? 'green' : 'amber'}
                    icon={<Activity size={16} />}
                    value={app.isRunning ? 'Live' : 'Stopped'}
                    label={t('common.labels.status', 'Status')}
                />
                <MetricCard
                    tone="accent"
                    icon={<Rocket size={16} />}
                    value={deployments.length}
                    label={t('app.overviewTab.totalDeploys', 'Total Deploys')}
                />
                <MetricCard
                    tone="green"
                    icon={<CheckCircle2 size={16} />}
                    value={successfulDeploys.length}
                    label={t('app.overviewTab.successful', 'Successful')}
                />
                <MetricCard
                    tone="red"
                    icon={<XCircle size={16} />}
                    value={failedDeploys.length}
                    label={t('common.state.failed', 'Failed')}
                />
            </KpiBand>

            <div className="overview-tab__grid">
                {/* Service Info Card */}
                <div className="overview-tab__card">
                    <h3 className="overview-tab__card-title">{t('app.overviewTab.serviceInfo', 'Service Info')}</h3>
                    <div className="overview-tab__info-list">
                        <div className="sk-info-row">
                            <span className="k">{t('common.labels.type', 'Type')}</span>
                            <span className="v">
                                <span
                                    className="overview-tab__info-badge"
                                    style={{ backgroundColor: app.typeInfo.bgColor, color: app.typeInfo.color, borderColor: app.typeInfo.borderColor }}
                                >
                                    {app.typeInfo.label}
                                </span>
                            </span>
                        </div>
                        {app.domain && (
                            <div className="sk-info-row">
                                <span className="k">{t('common.labels.domain', 'Domain')}</span>
                                <span className="v">
                                    <a
                                        href={`https://${app.domain}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="overview-tab__info-link"
                                    >
                                        {app.domain}
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                            <polyline points="15 3 21 3 21 9"/>
                                            <line x1="10" y1="14" x2="21" y2="3"/>
                                        </svg>
                                    </a>
                                </span>
                            </div>
                        )}
                        {app.port && (
                            <div className="sk-info-row">
                                <span className="k">{t('common.labels.port', 'Port')}</span>
                                <span className="v">
                                    {/* A port with no domain in front of it is
                                        still reachable — the number alone made
                                        you assemble the URL yourself. */}
                                    {portUrl ? (
                                        <a
                                            href={portUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="overview-tab__info-link"
                                            title={t('app.overviewTab.open', 'Open {{portUrl}}', { portUrl: portUrl })}
                                        >
                                            {app.port}
                                            <ExternalLink size={10} />
                                        </a>
                                    ) : app.port}
                                </span>
                            </div>
                        )}
                        <div className="sk-info-row">
                            <span className="k">{t('common.labels.created', 'Created')}</span>
                            <span className="v">
                                {new Date(app.created_at).toLocaleDateString('en-US', {
                                    year: 'numeric', month: 'short', day: 'numeric'
                                })}
                            </span>
                        </div>
                        {deployConfig && (
                            <div className="sk-info-row">
                                <span className="k">{t('app.overviewTab.repository', 'Repository')}</span>
                                <span className="v">
                                    {extractRepoDisplay(deployConfig.repo_url)}
                                    <span className="overview-tab__branch">{deployConfig.branch || 'main'}</span>
                                </span>
                            </div>
                        )}
                        {app.environment_type && app.environment_type !== 'standalone' && (
                            <div className="sk-info-row">
                                <span className="k">{t('app.overviewTab.environment', 'Environment')}</span>
                                <span className="v">
                                    <EnvTag env={ENV_LABEL[app.environment_type] || app.environment_type.toUpperCase()} />
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Resource Usage Card */}
                <div className="overview-tab__card">
                    <h3 className="overview-tab__card-title">{t('app.overviewTab.resourceUsage', 'Resource Usage')}</h3>
                    {metricsLoading ? (
                        <div className="overview-tab__loading">{t('app.overviewTab.loadingMetrics', 'Loading metrics…')}</div>
                    ) : isDocker && metrics ? (
                        <div className="overview-tab__metrics">
                            <div className="overview-tab__metric">
                                <div className="overview-tab__metric-header">
                                    <span>CPU</span>
                                    <span className="overview-tab__metric-value">{metrics.cpu.toFixed(1)}%</span>
                                </div>
                                <Gauge value={metrics.cpu} />
                            </div>
                            <div className="overview-tab__metric">
                                <div className="overview-tab__metric-header">
                                    <span>{t('common.labels.memory', 'Memory')}</span>
                                    <span className="overview-tab__metric-value">{metrics.memory.toFixed(1)}%</span>
                                </div>
                                <Gauge value={metrics.memory} />
                                <span className="overview-tab__metric-detail">{metrics.memUsage}</span>
                            </div>
                            <div className="overview-tab__metric-row">
                                <div className="overview-tab__metric-item">
                                    <span className="overview-tab__metric-item-label">{t('app.overviewTab.networkIO', 'Network I/O')}</span>
                                    <span className="overview-tab__metric-item-value">{metrics.netIO}</span>
                                </div>
                                <div className="overview-tab__metric-item">
                                    <span className="overview-tab__metric-item-label">{t('app.overviewTab.processes', 'Processes')}</span>
                                    <span className="overview-tab__metric-item-value">{metrics.pids}</span>
                                </div>
                            </div>
                        </div>
                    ) : isPython && metrics ? (
                        <div className="overview-tab__metrics">
                            <div className="overview-tab__metric-row">
                                <div className="overview-tab__metric-item">
                                    <span className="overview-tab__metric-item-label">{t('common.labels.status', 'Status')}</span>
                                    <span className="overview-tab__metric-item-value">
                                        {metrics.active ? 'Active' : 'Inactive'}
                                    </span>
                                </div>
                                {metrics.pid && (
                                    <div className="overview-tab__metric-item">
                                        <span className="overview-tab__metric-item-label">PID</span>
                                        <span className="overview-tab__metric-item-value">{metrics.pid}</span>
                                    </div>
                                )}
                            </div>
                            {metrics.memory && (
                                <div className="overview-tab__metric-row">
                                    <div className="overview-tab__metric-item">
                                        <span className="overview-tab__metric-item-label">{t('common.labels.memory', 'Memory')}</span>
                                        <span className="overview-tab__metric-item-value">{metrics.memory}</span>
                                    </div>
                                    {metrics.workers && (
                                        <div className="overview-tab__metric-item">
                                            <span className="overview-tab__metric-item-label">{t('app.overviewTab.workers', 'Workers')}</span>
                                            <span className="overview-tab__metric-item-value">{metrics.workers}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                            {metrics.uptime && (
                                <div className="overview-tab__metric-row">
                                    <div className="overview-tab__metric-item">
                                        <span className="overview-tab__metric-item-label">{t('common.labels.uptime', 'Uptime')}</span>
                                        <span className="overview-tab__metric-item-value">{metrics.uptime}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="overview-tab__no-metrics">
                            <p>{app.isRunning ? 'No metrics available for this service type.' : 'Start the service to view metrics.'}</p>
                        </div>
                    )}
                </div>

                {/* Related Resources Card (member-visible: domains, DBs, backups, deploys) */}
                <RelatedResourcesCard app={app} related={related} />

                {/* Scheduled tasks (read-only cron summary; renders nothing for non-members) */}
                <ScheduledTasksCard appId={app.id} />
            </div>

            {/* Bandwidth (daily nginx rollups; hidden until data exists) */}
            {bandwidth?.series?.some(p => p.bytes_sent > 0) && (
                <div className="overview-tab__card overview-tab__card--full overview-tab__bandwidth">
                    <div className="overview-tab__card-header-row">
                        <h3 className="overview-tab__card-title">{t('app.overviewTab.bandwidth', 'Bandwidth')}</h3>
                        <span className="overview-tab__bandwidth-month">
                            {formatBytes(bandwidth.month_bytes)} {t('app.overviewTab.thisMonth', 'this month')}
                        </span>
                    </div>
                    <BandwidthSparkline
                        data={bandwidth.series.map(p => p.bytes_sent)}
                        width={600}
                        height={48}
                        className="bw-spark--wide"
                    />
                    <span className="overview-tab__bandwidth-caption">{t('app.overviewTab.last90Days', 'Last 90 days')}</span>
                </div>
            )}

            {/* Recent Deployments */}
            <div className="overview-tab__card overview-tab__card--full">
                <div className="overview-tab__card-header-row">
                    <h3 className="overview-tab__card-title">{t('app.overviewTab.recentDeployments', 'Recent Deployments')}</h3>
                    {deployments.length > 3 && (
                        <span className="overview-tab__see-all">
                            {deployments.length} total
                        </span>
                    )}
                </div>
                {deploymentsLoading ? (
                    <div className="overview-tab__loading">{t('common.loading', 'Loading…')}</div>
                ) : deployments.length === 0 ? (
                    <div className="overview-tab__no-deploys">
                        <p>{t('app.overviewTab.noDeploymentsYetDeployYourService', 'No deployments yet. Deploy your service to see history here.')}</p>
                    </div>
                ) : (
                    <div className="overview-tab__deploy-list">
                        {deployments.slice(0, 5).map((deploy, idx) => {
                            const statusInfo = getDeployStatus(deploy.status);
                            const tone = statusKind(deploy.status);
                            const isLatest = idx === 0 && deploy.status === 'success';
                            return (
                                <div key={deploy.id} className="overview-tab__deploy-row">
                                    <div className={`overview-tab__deploy-dot overview-tab__deploy-dot--${tone}`} />
                                    <div className="overview-tab__deploy-info">
                                        <span className="overview-tab__deploy-message">
                                            {deploy.commitMessage || deploy.version || `Deployment #${deployments.length - idx}`}
                                        </span>
                                        <span className="overview-tab__deploy-meta">
                                            {deploy.commitSha && (
                                                <span className="overview-tab__deploy-sha">{deploy.commitSha.substring(0, 7)}</span>
                                            )}
                                            {deploy.branch && <span>{deploy.branch}</span>}
                                            {deploy.duration && <span>{formatDuration(deploy.duration)}</span>}
                                            <span>{formatRelativeTime(deploy.timestamp)}</span>
                                        </span>
                                    </div>
                                    <Pill kind={isLatest ? 'green' : tone}>
                                        {isLatest ? 'Live' : statusInfo.label}
                                    </Pill>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// One member-visible card summarizing the app's related resources. Each row
// links only to a surface the caller can open; the backend already scopes what
// it returns to the caller's access, so an empty section simply renders nothing.
const RelatedResourcesCard = ({ app, related }) => {
    const { t } = useTranslation();
    const domains = related?.domains || [];
    const databases = related?.databases || [];
    const backup = related?.backup;
    const deployments = related?.deployments;

    const hasAny = domains.length || databases.length || backup?.enabled || deployments?.count;

    return (
        <div className="overview-tab__card">
            <h3 className="overview-tab__card-title">{t('app.overviewTab.relatedResources', 'Related Resources')}</h3>
            {!related ? (
                <div className="overview-tab__loading">{t('common.loading', 'Loading…')}</div>
            ) : !hasAny ? (
                <div className="overview-tab__no-metrics">
                    <p>{t('app.overviewTab.noRelatedResourcesYet', 'No related resources yet.')}</p>
                </div>
            ) : (
                <div className="overview-tab__related">
                    {domains.length > 0 && (
                        <div className="overview-tab__related-group">
                            <span className="overview-tab__related-label">
                                <Globe size={14} /> {t('common.labels.domains', 'Domains')}
                            </span>
                            <div className="overview-tab__related-items">
                                {domains.map((d) => (
                                    <Link key={d.id} to={`/services/${app.id}/settings/domain`} className="overview-tab__related-chip">
                                        {d.name}
                                        {d.ssl_enabled && <ShieldCheck size={12} className="overview-tab__related-ssl" />}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}
                    {databases.length > 0 && (
                        <div className="overview-tab__related-group">
                            <span className="overview-tab__related-label">
                                <Database size={14} /> {t('common.labels.databases', 'Databases')}
                            </span>
                            <div className="overview-tab__related-items">
                                {databases.map((m) => (
                                    <span key={m.id} className="overview-tab__related-chip">
                                        {m.name} <span className="overview-tab__related-muted">{m.engine}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {backup?.enabled && (
                        <div className="sk-info-row">
                            <span className="k">{t('common.labels.backups', 'Backups')}</span>
                            <span className="v">
                                {backup.frequency || 'scheduled'}
                                {backup.last_status && <Pill kind={backup.last_status === 'success' ? 'green' : 'amber'}>{backup.last_status}</Pill>}
                            </span>
                        </div>
                    )}
                    {deployments?.count > 0 && (
                        <div className="sk-info-row">
                            <span className="k">{t('app.overviewTab.deployments', 'Deployments')}</span>
                            <span className="v">
                                <Link to={`/services/${app.id}/events`}>{deployments.count} total</Link>
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

function extractRepoDisplay(url) {
    if (!url) return '';
    try {
        const cleaned = url.replace(/\.git$/, '');
        const parts = cleaned.split('/');
        return parts.slice(-2).join('/');
    } catch {
        return url;
    }
}

export default OverviewTab;
