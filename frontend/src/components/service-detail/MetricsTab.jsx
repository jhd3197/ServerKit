import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Gauge } from '@/components/ds';
import EmptyState from '../EmptyState';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { normalizeContainerStats, resolveAppContainerId } from '@/utils/containerMetrics';

// Live metrics cadence.
const METRICS_REFRESH_MS = 10000;


const MetricsTab = ({ app }) => {
    const { t } = useTranslation();
    const [stats, setStats] = useState(null);
    const [processInfo, setProcessInfo] = useState(null);
    const [loading, setLoading] = useState(true);

    const isDocker = app.app_type === 'docker';
    const isPython = ['flask', 'django'].includes(app.app_type);

    // Load on mount and whenever the app changes; poll on top of that.
    useEffect(() => { loadMetrics(); }, [app.id]);
    usePolling(loadMetrics, METRICS_REFRESH_MS, { immediate: false });

    async function loadMetrics() {
        try {
            if (isDocker) {
                const data = await api.getContainers(true);
                const runtimeId = resolveAppContainerId(app, data.containers || []);
                if (runtimeId) {
                    setStats(normalizeContainerStats(
                        await api.getContainerStats(runtimeId)
                    ));
                }
            } else if (isPython) {
                const data = await api.getPythonAppStatus(app.id);
                setProcessInfo(data);
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <EmptyState loading title={t('app.metricsTab.loadingMetrics', 'Loading metrics…')} />;
    }

    if (isDocker && stats) {
        const cpuPercent = stats.cpuPercent;
        const memPercent = stats.memoryPercent;
        const memUsage = stats.memoryUsage;
        const netIO = stats.networkIO;
        const blockIO = stats.blockIO;
        const pids = stats.pids;

        return (
            <div className="metrics-tab">
                <div className="metrics-tab__grid">
                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.cpuUsage', 'CPU Usage')}</h4>
                            <span>{cpuPercent.toFixed(1)}%</span>
                        </div>
                        <Gauge value={cpuPercent} />
                    </div>

                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.memoryUsage', 'Memory Usage')}</h4>
                            <span>{memPercent.toFixed(1)}%</span>
                        </div>
                        <Gauge value={memPercent} />
                        <div className="metrics-tab__info">{memUsage}</div>
                    </div>

                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.networkIO', 'Network I/O')}</h4>
                        </div>
                        <div className="metrics-tab__info">{netIO}</div>
                    </div>

                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.blockIO', 'Block I/O')}</h4>
                        </div>
                        <div className="metrics-tab__info">{blockIO}</div>
                    </div>

                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.processes', 'Processes')}</h4>
                            <span>{pids}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isPython && processInfo) {
        return (
            <div className="metrics-tab">
                <div className="metrics-tab__grid">
                    <div className="metrics-tab__card">
                        <div className="metrics-tab__card-header">
                            <h4>{t('app.metricsTab.serviceStatus', 'Service Status')}</h4>
                        </div>
                        <div className="metrics-tab__info">
                            {processInfo.active ? 'Active (running)' : 'Inactive'}
                        </div>
                    </div>

                    {processInfo.pid && (
                        <div className="metrics-tab__card">
                            <div className="metrics-tab__card-header">
                                <h4>{t('app.metricsTab.processId', 'Process ID')}</h4>
                                <span>{processInfo.pid}</span>
                            </div>
                        </div>
                    )}

                    {processInfo.memory && (
                        <div className="metrics-tab__card">
                            <div className="metrics-tab__card-header">
                                <h4>{t('common.labels.memory', 'Memory')}</h4>
                                <span>{processInfo.memory}</span>
                            </div>
                        </div>
                    )}

                    {processInfo.uptime && (
                        <div className="metrics-tab__card">
                            <div className="metrics-tab__card-header">
                                <h4>{t('common.labels.uptime', 'Uptime')}</h4>
                            </div>
                            <div className="metrics-tab__info">{processInfo.uptime}</div>
                        </div>
                    )}

                    {processInfo.workers && (
                        <div className="metrics-tab__card">
                            <div className="metrics-tab__card-header">
                                <h4>{t('app.metricsTab.workers', 'Workers')}</h4>
                                <span>{processInfo.workers}</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="events-tab__empty">
            <h3>{t('app.metricsTab.noMetricsAvailable', 'No metrics available')}</h3>
            <p>{t('app.metricsTab.startTheServiceToViewResource', 'Start the service to view resource metrics.')}</p>
        </div>
    );
};

export default MetricsTab;
