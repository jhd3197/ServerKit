import { useMemo, useState } from 'react';
import { Search, RefreshCw, ChevronDown, ChevronRight, FileText, AlertTriangle, Activity, Database, Globe, Mail, Shield, Server } from 'lucide-react';
import { LOG_GROUPS, categoriseLog, logKindFromPath, formatBytes, formatRelativeTime } from './logHelpers';
import { translateLabel } from '@/i18n/labels';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import ErrorState from '@/components/ErrorState';

const GROUP_ICONS = {
    web: Globe,
    app: Activity,
    database: Database,
    system: Server,
    mail: Mail,
    security: Shield,
    other: FileText,
};

// `error` (string or Error) is the failure of the file-list request itself;
// with no files loaded it replaces the "No log files found" hint.
export default function LogFileList({ files, selectedPath, onSelect, onRefresh, loading, error }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [collapsed, setCollapsed] = useState(new Set());

    const groups = useMemo(() => {
        const filtered = files.filter((f) => {
            if (!query.trim()) return true;
            const q = query.toLowerCase();
            return f.name?.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q);
        });
        const buckets = new Map();
        for (const f of filtered) {
            const id = categoriseLog(f);
            if (!buckets.has(id)) buckets.set(id, []);
            buckets.get(id).push(f);
        }
        // Order groups, putting empty ones last
        const order = [...LOG_GROUPS.map((g) => g.id), 'other'];
        return order
            .map((id) => ({
                id,
                label: id === 'other'
                    ? t('app.logFileList.other', 'Other')
                    : translateLabel(t, LOG_GROUPS.find((g) => g.id === id)),
                files: (buckets.get(id) || []).sort((a, b) => (b.size || 0) - (a.size || 0)),
            }))
            .filter((g) => g.files.length > 0);
    }, [files, query, t]);

    const toggleGroup = (id) => {
        const next = new Set(collapsed);
        if (next.has(id)) next.delete(id); else next.add(id);
        setCollapsed(next);
    };

    return (
        <div className="lv-sidebar">
            <div className="lv-sidebar-header">
                <div className="lv-search">
                    <Search size={13} className="lv-search-icon" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('app.logFileList.filterLogFiles', 'Filter log files…')}
                    />
                </div>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn"
                    onClick={onRefresh}
                    disabled={loading}
                    title={t('app.logFileList.reloadList', 'Reload list')}
                >
                    <RefreshCw size={13} className={loading ? 'spinning' : ''} />
                </SharedButton>
            </div>

            <div className="lv-sidebar-body">
                {loading && files.length === 0 ? (
                    <div className="lv-empty-hint" role="status" aria-busy="true">
                        <p>{t('app.logFileList.loadingLogFiles', 'Loading log files…')}</p>
                    </div>
                ) : error && files.length === 0 ? (
                    <ErrorState
                        compact
                        error={typeof error === 'string' ? undefined : error}
                        message={typeof error === 'string' ? error : undefined}
                        onRetry={onRefresh}
                    />
                ) : files.length === 0 ? (
                    <div className="lv-empty-hint">
                        <AlertTriangle size={20} />
                        <p>{t('app.logFileList.noLogFilesFound', 'No log files found.')}</p>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="lv-empty-hint">
                        <p>{t('app.logFileList.noMatchesFor', 'No matches for "{{query}}".', { query })}</p>
                    </div>
                ) : (
                    groups.map((group) => {
                        const Icon = GROUP_ICONS[group.id] || FileText;
                        const isCollapsed = collapsed.has(group.id);
                        return (
                            <div key={group.id} className="lv-group">
                                <SharedButton variant="unstyled" type="button"
                                    className="lv-group-header"
                                    onClick={() => toggleGroup(group.id)}
                                >
                                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                    <Icon size={13} className="lv-group-icon" />
                                    <span>{group.label}</span>
                                    <span className="lv-group-count">{group.files.length}</span>
                                </SharedButton>
                                {!isCollapsed && (
                                    <div className="lv-group-files">
                                        {group.files.map((log) => {
                                            const kind = logKindFromPath(log.path || log.name);
                                            const isActive = selectedPath === log.path;
                                            return (
                                                <SharedButton variant="unstyled" type="button"
                                                    key={log.path}
                                                    className={`lv-file ${isActive ? 'active' : ''}`}
                                                    onClick={() => onSelect(log)}
                                                    title={log.path}
                                                >
                                                    <span className={`lv-file-dot kind-${kind}`} />
                                                    <span className="lv-file-name">{log.name}</span>
                                                    <span className="lv-file-size">{formatBytes(log.size)}</span>
                                                    {log.modified && (
                                                        <span className="lv-file-time">
                                                            {formatRelativeTime(log.modified)}
                                                        </span>
                                                    )}
                                                </SharedButton>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
