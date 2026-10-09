import { Button } from '@/components/ui/button';
import { Gauge } from '../ds';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from 'react-i18next';

export const SecurityAlertItem = ({ alert, onAcknowledge, onResolve }) => {
    const { t } = useTranslation();
    const sev = (alert.severity || 'info').toLowerCase();
    const tone =
        sev === 'critical' || sev === 'high' ? 'danger' :
        sev === 'medium' || sev === 'warning' ? 'warning' : 'info';
    const title = (alert.alert_type || 'alert').replace(/_/g, ' ');
    return (
        <li className={`notification notification--${tone}`}>
            <span className="notification__icon">
                {tone === 'info' ? <InfoCircleIcon /> : <AlertIcon />}
            </span>
            <div className="notification__body">
                <div className="notification__head">
                    <span className="notification__title">{title}</span>
                    <span className={`severity-badge ${sev}`}>{sev}</span>
                    <span className="notification__time">
                        {alert.created_at ? new Date(alert.created_at).toLocaleString() : ''}
                    </span>
                </div>
                <p className="notification__message">
                    {alert.source_ip && <><strong>{t('app.serverDetailShared.ip', 'IP:')}</strong> {alert.source_ip}{'  '}</>}
                    {alert.details?.message || ''}
                    {alert.details?.attempts
                        ? ` ${t('app.serverDetailShared.attempts', { count: alert.details.attempts, defaultValue_one: '(1 attempt)', defaultValue_other: '({{count}} attempts)' })}`
                        : ''}
                </p>
                <div className="notification__actions">
                    {alert.status === 'open' && (
                        <Button variant="outline" size="sm" onClick={() => onAcknowledge(alert.id)}>
                            {t('app.serverDetailShared.acknowledge', 'Acknowledge')}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => onResolve(alert.id)}>
                        {t('app.serverDetailShared.resolve', 'Resolve')}
                    </Button>
                </div>
            </div>
        </li>
    );
};


export const KpiTile = ({ icon, label, value, sub, tone }) => (
    <div className={`kpi-tile${tone ? ` kpi-tile--${tone}` : ''}`}>
        <div className="kpi-tile__head">
            <span className="kpi-tile__icon">{icon}</span>
            <span className="kpi-tile__label">{label}</span>
        </div>
        <div className="kpi-tile__value">{value}</div>
        {sub && <div className="kpi-tile__sub">{sub}</div>}
    </div>
);

export const KpiGauge = ({ icon, label, percent, color, sub }) => {
    const has = percent !== null && percent !== undefined && Number.isFinite(percent);
    const safe = has ? Math.min(Math.max(percent, 0), 100) : 0;
    const danger = safe > 85;
    const warn = safe > 70 && !danger;
    const fillColor = danger ? 'var(--red)' : warn ? 'var(--amber)' : color;

    return (
        <div className={`kpi-tile kpi-tile--gauge${danger ? ' kpi-tile--danger' : warn ? ' kpi-tile--warn' : ''}`}>
            <div className="kpi-tile__head">
                <span className="kpi-tile__icon">{icon}</span>
                <span className="kpi-tile__label">{label}</span>
            </div>
            <div className="kpi-tile__value">{has ? `${safe.toFixed(1)}%` : '—'}</div>
            <Gauge className="kpi-tile__meter" value={safe} color={fillColor} />
            {sub && <div className="kpi-tile__sub">{sub}</div>}
        </div>
    );
};

export const CopyChip = ({ label, value, title, mono }) => {
    const { t } = useTranslation();
    const { copy } = useClipboard();
    const handleCopy = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!value) return;
        copy(String(value), `${label[0].toUpperCase()}${label.slice(1)} copied`);
    };
    return (
        <Button variant="unstyled"
            type="button"
            className={`copy-chip${mono ? ' copy-chip--mono' : ''}`}
            onClick={handleCopy}
            title={title || t('app.serverDetailShared.copy', 'Copy {{label}}', { label: label })}
        >
            <span className="copy-chip__label">{label}</span>
            <code className="copy-chip__value">{value}</code>
            <CopyIcon />
        </Button>
    );
};

// Icons
export const FolderTinyIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
);

export const RefreshIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
);

export const TrashIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
);

export const KeyIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
    </svg>
);

export const OfflineIcon = () => (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
);

export const StopIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="6" width="12" height="12"/>
    </svg>
);

export const PlayIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
);

export const TerminalIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 17 10 11 4 5"/>
        <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
);

export const CopyIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
);

export const WindowsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
    </svg>
);

export const CpuIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
        <rect x="9" y="9" width="6" height="6"/>
        <line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/>
        <line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/>
        <line x1="20" y1="9" x2="22" y2="9"/><line x1="20" y1="14" x2="22" y2="14"/>
        <line x1="2" y1="9" x2="4" y2="9"/><line x1="2" y1="14" x2="4" y2="14"/>
    </svg>
);

export const MemoryIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="10" rx="2"/>
        <line x1="6" y1="7" x2="6" y2="17"/>
        <line x1="10" y1="7" x2="10" y2="17"/>
        <line x1="14" y1="7" x2="14" y2="17"/>
        <line x1="18" y1="7" x2="18" y2="17"/>
    </svg>
);

export const DiskIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3"/>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>
    </svg>
);

export const ClockIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
    </svg>
);

export const NetworkIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
);

export const ServerIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="7" rx="1"/>
        <rect x="2" y="14" width="20" height="7" rx="1"/>
        <line x1="6" y1="6.5" x2="6.01" y2="6.5"/>
        <line x1="6" y1="17.5" x2="6.01" y2="17.5"/>
    </svg>
);

export const HostIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
);

export const OsIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
);

export const ArchIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
    </svg>
);

export const ChipIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="5" width="14" height="14" rx="1"/>
        <rect x="9" y="9" width="6" height="6"/>
        <path d="M3 9h2M3 15h2M19 9h2M19 15h2M9 3v2M15 3v2M9 19v2M15 19v2"/>
    </svg>
);

export const AgentIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"/>
        <circle cx="9" cy="14" r="1"/>
        <circle cx="15" cy="14" r="1"/>
    </svg>
);

export const TagIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
        <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
);

export const HashIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="4" y1="9" x2="20" y2="9"/>
        <line x1="4" y1="15" x2="20" y2="15"/>
        <line x1="10" y1="3" x2="8" y2="21"/>
        <line x1="16" y1="3" x2="14" y2="21"/>
    </svg>
);

export const DockerMiniIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="10" width="3" height="3"/>
        <rect x="7" y="10" width="3" height="3"/>
        <rect x="11" y="10" width="3" height="3"/>
        <rect x="7" y="6" width="3" height="3"/>
        <rect x="11" y="6" width="3" height="3"/>
        <path d="M2 14c0 4 4 6 10 6s10-2 10-6"/>
    </svg>
);

export const PulseIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
);

export const AlertIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
);

export const InfoCircleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
);
