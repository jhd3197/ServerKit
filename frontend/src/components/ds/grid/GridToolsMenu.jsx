import { useState } from 'react';
import { MoreVertical, Download, RefreshCw, History, Check, Link2, Rows2, Rows3 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { byKey, exportRows } from './fields';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// The toolbar's "⋮" — everything that is neither a filter nor a per-column
// action: export, refresh, row density, and discarding unsaved view changes.
// One button instead of four keeps the top bar the same shape on every page,
// which is the whole point of putting search there.
export function GridToolsMenu({
    cfg, columns, rows, selectedRows = [], viewName, noun = 'rows',
    onRefresh, onReset, onDensity, onExported, onCopyLink,
    // Off for hosts whose table auto-sizes its rows (<DataTable>) — showing a
    // density toggle that changes nothing is worse than not showing one.
    showDensity = true,
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [pane, setPane] = useState('root');   // root | export
    const [scope, setScope] = useState('view');
    const [copied, setCopied] = useState(null);
    const [allCols, setAllCols] = useState(false);

    const map = byKey(columns);
    const set = scope === 'picked' ? selectedRows : rows;
    const exportCols = allCols ? columns : cfg.cols.map((k) => map.get(k)).filter(Boolean);

    const close = () => { setOpen(false); setPane('root'); };

    const go = (format) => {
        const n = exportRows(
            set,
            exportCols,
            format,
            (viewName || noun).toLowerCase().replace(/\s+/g, '-'),
        );
        onExported?.(n, exportCols.length, format);
        close();
    };

    return (
        <Popover
            open={open}
            onOpenChange={(o) => { setOpen(o); if (!o) setPane('root'); }}
        >
            <PopoverTrigger asChild>
                <SharedButton variant="unstyled" type="button" className="sk-gridicon" aria-label={t('app.gridToolsMenu.moreTableOptions', 'More table options')}>
                    <MoreVertical size={16} />
                </SharedButton>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="ui-popover-panel sk-gridmenu">
                {pane === 'root' ? (
                    <>
                        {onCopyLink && (
                            <SharedButton variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt"
                                onClick={async () => {
                                    const res = await onCopyLink();
                                    setCopied(res?.copied ? 'ok' : 'fail');
                                    setTimeout(() => setCopied(null), 1800);
                                }}
                            >
                                {copied === 'ok' ? <Check size={13} /> : <Link2 size={13} />}
                                {copied === 'ok' ? t('app.gridToolsMenu.linkCopied', 'Link copied')
                                    : copied === 'fail' ? t('app.gridToolsMenu.copyFailed', "Couldn't copy the link. Check clipboard permissions.")
                                        : t('app.gridToolsMenu.copyLinkToThisView', 'Copy link to this view')}
                            </SharedButton>
                        )}
                        <SharedButton variant="unstyled" type="button" className="sk-gridmenu__opt" onClick={() => setPane('export')}>
                            <Download size={13} />{t('app.gridToolsMenu.export', 'Export…')}
                        </SharedButton>
                        {onRefresh && (
                            <SharedButton variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt"
                                onClick={() => { onRefresh(); close(); }}
                            >
                                <RefreshCw size={13} />{t('app.gridToolsMenu.refreshData', 'Refresh data')}
                            </SharedButton>
                        )}
                        {showDensity && (
                            <>
                                <div className="sk-gridmenu__sep" />
                                <div className="sk-gridmenu__head">{t('app.gridToolsMenu.rowDensity', 'Row density')}</div>
                                {[['cozy', 'Cozy', Rows2], ['compact', 'Compact', Rows3]].map(([value, text, Icon]) => (
                                    <SharedButton variant="unstyled"
                                        key={value}
                                        type="button"
                                        className={cn('sk-gridmenu__opt', cfg.density === value && 'is-on')}
                                        onClick={() => onDensity(value)}
                                    >
                                        <span className="sk-gridmenu__box"><Check size={11} /></span>
                                        <Icon size={13} />{text}
                                    </SharedButton>
                                ))}
                            </>
                        )}
                        <div className="sk-gridmenu__sep" />
                        <SharedButton variant="unstyled"
                            type="button"
                            className="sk-gridmenu__opt"
                            onClick={() => { onReset(); close(); }}
                        >
                            <History size={13} />{t('app.gridToolsMenu.resetViewChanges', 'Reset view changes')}
                        </SharedButton>
                    </>
                ) : (
                    <>
                        <div className="sk-gridmenu__head">{t('app.gridToolsMenu.export2', 'Export')}</div>
                        <SharedButton variant="unstyled"
                            type="button"
                            className={cn('sk-gridmenu__opt', scope === 'view' && 'is-on')}
                            onClick={() => setScope('view')}
                        >
                            <span className="sk-gridmenu__box"><Check size={11} /></span>
                            {t('app.gridToolsMenu.rowsInThisView', 'Rows in this view')}
                            <span className="sk-gridmenu__rest">{rows.length}</span>
                        </SharedButton>
                        <SharedButton variant="unstyled"
                            type="button"
                            className={cn('sk-gridmenu__opt', scope === 'picked' && 'is-on')}
                            disabled={!selectedRows.length}
                            onClick={() => setScope('picked')}
                        >
                            <span className="sk-gridmenu__box"><Check size={11} /></span>
                            {t('app.gridToolsMenu.selectedRows', 'Selected rows')}
                            <span className="sk-gridmenu__rest">{selectedRows.length}</span>
                        </SharedButton>
                        <div className="sk-gridmenu__sep" />
                        <SharedButton variant="unstyled"
                            type="button"
                            className={cn('sk-gridmenu__opt', allCols && 'is-on')}
                            onClick={() => setAllCols((v) => !v)}
                        >
                            <span className="sk-gridmenu__box"><Check size={11} /></span>
                            {t('app.gridToolsMenu.includeHiddenFields', 'Include hidden fields')}
                            <span className="sk-gridmenu__rest">{exportCols.length}</span>
                        </SharedButton>
                        <div className="sk-gridmenu__foot">
                            <SharedButton variant="unstyled" type="button" onClick={() => go('json')}>JSON</SharedButton>
                            <SharedButton variant="unstyled" type="button" className="is-primary" onClick={() => go('csv')}>{t('app.gridToolsMenu.downloadCsv', 'Download CSV')}</SharedButton>
                        </div>
                    </>
                )}
            </PopoverContent>
        </Popover>
    );
}

export default GridToolsMenu;
