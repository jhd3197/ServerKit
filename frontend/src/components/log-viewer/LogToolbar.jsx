import { Search, RefreshCw, Download, Trash2, Maximize2, Minimize2, X, ArrowDownToLine, Hash, WrapText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

export default function LogToolbar({
    searchPattern, onSearchChange, onSearchSubmit, onSearchClear,
    lineCount, onLineCountChange, lineCountOptions = [50, 100, 200, 500, 1000, 5000],
    autoRefresh, onAutoRefreshToggle,
    showLineNumbers, onToggleLineNumbers,
    wrapLines, onToggleWrap,
    isFullscreen, onToggleFullscreen,
    onRefresh, onDownload, onClear, onScrollToBottom,
    canAct,
}) {
    const { t } = useTranslation();
    return (
        <div className="lv-toolbar">
            <div className="lv-toolbar-left">
                <div className="lv-search-field">
                    <Search size={13} className="lv-search-field-icon" />
                    <input
                        type="text"
                        placeholder={t('app.logToolbar.searchInLog', 'Search in log…')}
                        value={searchPattern}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                    />
                    {searchPattern && (
                        <SharedButton variant="unstyled" type="button" className="lv-search-field-clear" onClick={onSearchClear} title={t('common.actions.clear', 'Clear')}>
                            <X size={11} />
                        </SharedButton>
                    )}
                </div>
                <Select value={String(lineCount)} onValueChange={(v) => onLineCountChange(parseInt(v, 10))}>
                    <SelectTrigger
                        className="lv-select"
                        title={t('app.logToolbar.linesToFetch', 'Lines to fetch')}
                        aria-label={t('app.logToolbar.linesToFetch', 'Lines to fetch')}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {lineCountOptions.map((n) => (
                            <SelectItem key={n} value={String(n)}>{n.toLocaleString()} lines</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="lv-toolbar-right">
                <SharedButton variant="unstyled" type="button"
                    className={`lv-chip ${autoRefresh ? 'active' : ''}`}
                    onClick={onAutoRefreshToggle}
                    disabled={!canAct}
                    title={t('app.logToolbar.autoRefreshEvery3sAndFollow', 'Auto-refresh every 3s and follow tail')}
                >
                    <span className={`lv-pulse ${autoRefresh ? 'on' : ''}`} />
                    <span>{t('app.logToolbar.live', 'Live')}</span>
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className={`lv-icon-btn ${showLineNumbers ? 'active' : ''}`}
                    onClick={onToggleLineNumbers}
                    title={t('app.logToolbar.toggleLineNumbers', 'Toggle line numbers')}
                >
                    <Hash size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className={`lv-icon-btn ${wrapLines ? 'active' : ''}`}
                    onClick={onToggleWrap}
                    title={t('app.logToolbar.toggleWordWrap', 'Toggle word wrap')}
                >
                    <WrapText size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn"
                    onClick={onScrollToBottom}
                    disabled={!canAct}
                    title={t('app.logToolbar.jumpToEnd', 'Jump to end')}
                >
                    <ArrowDownToLine size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn"
                    onClick={onRefresh}
                    disabled={!canAct}
                    title={t('common.actions.refresh', 'Refresh')}
                >
                    <RefreshCw size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn"
                    onClick={onDownload}
                    disabled={!canAct}
                    title={t('common.actions.download', 'Download')}
                >
                    <Download size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn danger"
                    onClick={onClear}
                    disabled={!canAct}
                    title={t('app.logToolbar.truncateLogFile', 'Truncate log file')}
                >
                    <Trash2 size={13} />
                </SharedButton>
                <SharedButton variant="unstyled" type="button"
                    className="lv-icon-btn"
                    onClick={onToggleFullscreen}
                    title={isFullscreen ? t('app.logToolbar.exitFullscreen', 'Exit fullscreen') : t('app.logToolbar.fullscreen', 'Fullscreen')}
                >
                    {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </SharedButton>
            </div>
        </div>
    );
}
