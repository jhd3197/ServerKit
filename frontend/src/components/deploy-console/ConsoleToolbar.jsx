import { ArrowDown, ArrowUp, Copy, Download, Maximize2, Minimize2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

const LEVELS = ['all', 'info', 'warn', 'error', 'debug'];

// Log toolbar: follow / wrap / timestamps toggles, error and warning counts that
// double as filters, a level filter, a client-side search box, match
// navigation, plus copy-all and download-.txt actions.
export default function ConsoleToolbar({
    follow, onToggleFollow,
    wrap, onToggleWrap,
    timestamps, onToggleTimestamps,
    level, onLevelChange,
    search, onSearchChange,
    onCopy, onDownload,
    errorCount = 0, warnCount = 0,
    navCount = 0, navPos = 0, navLabel = '', onNavPrev, onNavNext,
    focused = false, onToggleFocus,
}) {
    const { t } = useTranslation();
    // Clicking a count filters to it, and clicking again clears — the count is
    // worth seeing on its own, so it earns the space either way.
    const toggleLevel = (target) => onLevelChange(level === target ? 'all' : target);

    return (
        <div className="deploy-console__toolbar">
            <div className="deploy-console__toolbar-group">
                <SharedButton variant="unstyled"
                    type="button"
                    className={`deploy-console__toggle ${follow ? 'is-active' : ''}`}
                    onClick={onToggleFollow}
                    aria-pressed={follow}
                >
                    {t('app.consoleToolbar.follow', 'Follow')}
                </SharedButton>
                <SharedButton variant="unstyled"
                    type="button"
                    className={`deploy-console__toggle ${wrap ? 'is-active' : ''}`}
                    onClick={onToggleWrap}
                    aria-pressed={wrap}
                >
                    {t('app.consoleToolbar.wrap', 'Wrap')}
                </SharedButton>
                <SharedButton variant="unstyled"
                    type="button"
                    className={`deploy-console__toggle ${timestamps ? 'is-active' : ''}`}
                    onClick={onToggleTimestamps}
                    aria-pressed={timestamps}
                >
                    {t('app.consoleToolbar.timestamps', 'Timestamps')}
                </SharedButton>
                <div className="deploy-console__level">
                    <Select value={level} onValueChange={onLevelChange}>
                        <SelectTrigger aria-label={t('app.consoleToolbar.logLevel', 'Log level')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {LEVELS.map((l) => (
                                <SelectItem key={l} value={l}>{l === 'all' ? 'All levels' : l}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {errorCount > 0 && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`deploy-console__chip deploy-console__chip--error ${level === 'error' ? 'is-active' : ''}`}
                        onClick={() => toggleLevel('error')}
                        aria-pressed={level === 'error'}
                    >
                        {errorCount} error{errorCount === 1 ? '' : 's'}
                    </SharedButton>
                )}
                {warnCount > 0 && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`deploy-console__chip deploy-console__chip--warn ${level === 'warn' ? 'is-active' : ''}`}
                        onClick={() => toggleLevel('warn')}
                        aria-pressed={level === 'warn'}
                    >
                        {warnCount} warning{warnCount === 1 ? '' : 's'}
                    </SharedButton>
                )}
            </div>

            <div className="deploy-console__toolbar-group">
                <div className="deploy-console__search">
                    <Search size={14} />
                    <input
                        type="text"
                        placeholder={t('app.consoleToolbar.searchLogs', 'Search logs…')}
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>
                {/* With no search term these step through the errors, which is
                    what someone opening a failed deploy is looking for. */}
                <div className="deploy-console__nav">
                    <span className="deploy-console__nav-count">
                        {navCount ? `${Math.min(navPos + 1, navCount)}/${navCount}` : ''} {navLabel}
                    </span>
                    <SharedButton variant="unstyled"
                        type="button"
                        className="deploy-console__toggle"
                        onClick={onNavPrev}
                        disabled={!navCount}
                        title={t('app.consoleToolbar.previous', 'Previous {{value}}', { value: navLabel || 'match' })}
                    >
                        <ArrowUp size={14} />
                    </SharedButton>
                    <SharedButton variant="unstyled"
                        type="button"
                        className="deploy-console__toggle"
                        onClick={onNavNext}
                        disabled={!navCount}
                        title={t('app.consoleToolbar.next', 'Next {{value}}', { value: navLabel || 'match' })}
                    >
                        <ArrowDown size={14} />
                    </SharedButton>
                </div>
                <SharedButton variant="unstyled" type="button" className="deploy-console__toggle" onClick={onCopy} title={t('app.consoleToolbar.copyAllLogs', 'Copy all logs')}>
                    <Copy size={14} /> {t('common.actions.copy', 'Copy')}
                </SharedButton>
                <SharedButton variant="unstyled" type="button" className="deploy-console__toggle" onClick={onDownload} title={t('app.consoleToolbar.downloadLogsAsTxt', 'Download logs as .txt')}>
                    <Download size={14} /> {t('common.actions.download', 'Download')}
                </SharedButton>
                <SharedButton variant="unstyled"
                    type="button"
                    className={`deploy-console__toggle ${focused ? 'is-active' : ''}`}
                    onClick={onToggleFocus}
                    aria-pressed={focused}
                    title={focused ? t('app.consoleToolbar.showTheDeploymentDetailsAgain', 'Show the deployment details again') : t('app.consoleToolbar.giveTheLogTheWholePage', 'Give the log the whole page')}
                >
                    {focused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    {focused ? 'Exit' : 'Expand'}
                </SharedButton>
            </div>
        </div>
    );
}
