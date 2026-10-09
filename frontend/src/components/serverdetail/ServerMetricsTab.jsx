import MetricsGraph from '../MetricsGraph';
import { formatBytes } from '@/utils/formatBytes';
import { useTranslation } from 'react-i18next';

const ServerMetricsTab = ({ serverId, metrics }) => {
    const { t } = useTranslation();
    return (
        <div className="metrics-tab">
            <MetricsGraph serverId={serverId} />

            {metrics && (
                <div className="metrics-live-stats">
                    <div className="live-stat-card">
                        <h4>{t('app.serverMetricsTab.currentSnapshot', 'Current snapshot')}</h4>
                        <div className="live-stats-grid">
                            <div className="live-stat">
                                <span className="live-stat-label">CPU</span>
                                <span className="live-stat-value">{(metrics.cpu_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">{t('common.labels.memory', 'Memory')}</span>
                                <span className="live-stat-value">{(metrics.memory_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">{t('common.labels.disk', 'Disk')}</span>
                                <span className="live-stat-value">{(metrics.disk_percent || 0).toFixed(1)}%</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">{t('app.serverMetricsTab.netTx', 'Net TX')}</span>
                                <span className="live-stat-value">{formatBytes(metrics.network_sent, { defaultValue: 'N/A' })}/s</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">{t('app.serverMetricsTab.netRx', 'Net RX')}</span>
                                <span className="live-stat-value">{formatBytes(metrics.network_recv, { defaultValue: 'N/A' })}/s</span>
                            </div>
                            <div className="live-stat">
                                <span className="live-stat-label">{t('app.serverMetricsTab.containers', 'Containers')}</span>
                                <span className="live-stat-value">{metrics.container_running || 0} / {metrics.container_count || 0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ServerMetricsTab;
