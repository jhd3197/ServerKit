import { Search, RefreshCw, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

export function LogViewer({
    files = [],
    selectedPath,
    onSelectFile,
    onRefreshFiles,
    content,
    contentLoading = false,
    contentEmpty,
    searchPattern = '',
    onSearchChange,
    onSearchSubmit,
    lineCount,
    onLineCountChange,
    lineCountOptions = [50, 100, 200, 500, 1000],
    autoRefresh = false,
    onAutoRefreshChange,
    onRefreshContent,
    onDownload,
    onClear,
    formatFileSize = defaultFormatFileSize,
    getLogIconType = () => 'default',
}) {
    const { t } = useTranslation();
    return (
        <div className="logs-layout">
            <div className="logs-sidebar">
                <div className="sidebar-header">
                    <h3>{t('app.logViewer.logFiles', 'Log files')}</h3>
                    {onRefreshFiles && (
                        <Button variant="outline" size="sm" onClick={onRefreshFiles}>
                            <RefreshCw size={14} />
                        </Button>
                    )}
                </div>
                <div className="log-files-list">
                    {files.length === 0 ? (
                        <div className="empty-hint">{t('app.logViewer.noLogFilesFound', 'No log files found')}</div>
                    ) : (
                        files.map((log) => (
                            <div
                                key={log.path}
                                className={`log-file-item ${selectedPath === log.path ? 'active' : ''}`}
                                onClick={() => onSelectFile?.(log)}
                            >
                                <div className={`log-icon ${getLogIconType(log)}`}>
                                    <FileText size={16} />
                                </div>
                                <div className="log-file-info">
                                    <span className="log-file-name">{log.name}</span>
                                    <span className="log-file-path">{log.path}</span>
                                </div>
                                <span className="log-file-size">{formatFileSize(log.size)}</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="logs-viewer">
                <div className="viewer-toolbar">
                    <div className="toolbar-left">
                        <div className="search-input">
                            <Search size={16} />
                            <Input
                                type="text"
                                value={searchPattern}
                                onChange={(e) => onSearchChange?.(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit?.()}
                                placeholder={t('app.logViewer.searchPattern', 'Search pattern…')}
                            />
                        </div>
                        {onLineCountChange && (
                            <Select
                                value={String(lineCount)}
                                onValueChange={(v) => onLineCountChange(parseInt(v, 10))}
                            >
                                <SelectTrigger
                                    className="lines-select"
                                    aria-label={t('app.logViewer.linesToShow', 'Lines to show')}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {lineCountOptions.map(n => (
                                        <SelectItem key={n} value={String(n)}>{n} lines</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <div className="toolbar-right">
                        {onAutoRefreshChange && (
                            <label className="auto-refresh-toggle">
                                <Switch
                                    checked={autoRefresh}
                                    onCheckedChange={onAutoRefreshChange}
                                />
                                <span>{t('app.logViewer.autoRefresh', 'Auto-refresh')}</span>
                            </label>
                        )}
                        {onRefreshContent && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onRefreshContent}
                                disabled={!selectedPath || contentLoading}
                            >
                                {t('common.actions.refresh', 'Refresh')}
                            </Button>
                        )}
                        {onDownload && (
                            <Button variant="outline" size="sm" onClick={onDownload} disabled={!content}>
                                {t('common.actions.download', 'Download')}
                            </Button>
                        )}
                        {onClear && (
                            <Button variant="destructive" size="sm" onClick={onClear} disabled={!selectedPath}>
                                {t('common.actions.clear', 'Clear')}
                            </Button>
                        )}
                    </div>
                </div>
                <div className="log-content">
                    {contentLoading ? (
                        <div className="logs-viewer__loading">{t('common.loading', 'Loading…')}</div>
                    ) : !content ? (
                        <div className="logs-viewer__empty">
                            {contentEmpty ?? 'Select a log file to view its contents.'}
                        </div>
                    ) : (
                        <pre>{content}</pre>
                    )}
                </div>
            </div>
        </div>
    );
}

function defaultFormatFileSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default LogViewer;
