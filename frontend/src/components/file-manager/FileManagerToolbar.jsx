import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Check,
    RefreshCw,
    HardDrive,
    PanelLeftClose,
    PanelLeftOpen,
    LayoutGrid,
    List,
    Home,
    SlidersHorizontal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { useTranslation } from 'react-i18next';

export default function FileManagerToolbar({
    history,
    setSidebarVisible,
    sidebarVisible,
    goBack,
    historyIdx,
    goForward,
    goUp,
    parentPath,
    navigateTo,
    isS3,
    breadcrumbs,
    activeMount,
    isRemote,
    activeFilter,
    setActiveFilter,
    FILTER_OPTIONS,
    filterLabels,
    filterCounts,
    sortValue,
    handleSortChange,
    // The search box, only when the page has no top bar to host it.
    search,
    viewMode,
    setViewMode,
    showHidden,
    setShowHidden,
    loadDirectory,
    currentPath,
    loading,
}) {
    const { t } = useTranslation();
    const [sortKey, sortDir] = String(sortValue || 'name-asc').split('-');
    // What the listing can be sorted by, with the direction a fresh pick
    // starts in (newest and largest first; names and types A to Z).
    const sortKeys = [
        { key: 'name', label: t('common.labels.name', 'Name'), first: 'asc' },
        { key: 'modified', label: t('app.fileManager.modified', 'Modified'), first: 'desc' },
        { key: 'size', label: t('common.labels.size', 'Size'), first: 'desc' },
        { key: 'type', label: t('common.labels.type', 'Type'), first: 'asc' },
    ];
    // Anything other than "everything, hidden files off" is worth a mark on
    // the button, since the menu is closed most of the time.
    const viewIsNarrowed = activeFilter !== FILTER_OPTIONS[0]?.id || showHidden;
    return (
        <>
            <div className="file-manager-toolbar">
                <div className="toolbar-left">
                    <Button
                        variant="unstyled"
                        type="button"
                        className="toolbar-icon-btn"
                        onClick={() => setSidebarVisible(!sidebarVisible)}
                        title={
                            sidebarVisible
                                ? t('app.fileManager.hideSidebar', 'Hide sidebar')
                                : t('app.fileManager.showSidebar', 'Show sidebar')
                        }
                    >
                        {sidebarVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                    </Button>
                    <div className="nav-buttons">
                        <Button
                            variant="unstyled"
                            type="button"
                            className="nav-btn"
                            onClick={goBack}
                            disabled={historyIdx === 0}
                            disabledReason={t('app.fileManager.nothingToGoBackTo', 'Nothing to go back to')}
                            title={t('common.actions.back', 'Back')}
                        >
                            <ArrowLeft size={14} />
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className="nav-btn"
                            onClick={goForward}
                            disabled={historyIdx >= history.length - 1}
                            disabledReason={t('app.fileManager.nothingToGoForwardTo', 'Nothing to go forward to')}
                            title={t('app.fileManager.forward', 'Forward')}
                        >
                            <ArrowRight size={14} />
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className="nav-btn"
                            onClick={goUp}
                            disabled={!parentPath}
                            disabledReason={t('app.fileManager.alreadyAtTheTopFolder', 'Already at the top folder')}
                            title={t('app.fileManager.up', 'Up')}
                        >
                            <ArrowUp size={14} />
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className="nav-btn"
                            onClick={() => navigateTo(isS3 ? '/' : '/home')}
                            title={t('app.fileManager.home', 'Home')}
                        >
                            <Home size={14} />
                        </Button>
                    </div>
                    <div className="path-breadcrumb">
                        {breadcrumbs.map((crumb, idx) => (
                            <span key={crumb.path + idx} className="crumb-segment">
                                {/* The root crumb is itself "/", so the one after it needs no separator. */}
                                {idx > 0 && breadcrumbs[idx - 1].name !== '/' && <span className="crumb-separator">/</span>}
                                <Button
                                    variant="unstyled"
                                    type="button"
                                    className={`crumb ${idx === breadcrumbs.length - 1 ? 'crumb-active' : ''}`}
                                    onClick={() => navigateTo(crumb.path)}
                                >
                                    {crumb.name}
                                </Button>
                            </span>
                        ))}
                    </div>
                    {activeMount && !isRemote && !isS3 && (
                        <span
                            className="file-mount-chip"
                            title={`${activeMount.device} · ${activeMount.total_human}`}
                        >
                            <HardDrive size={12} />
                            <span>
                                {activeMount.mountpoint === '/'
                                    ? t('app.fileManager.rootDisk', 'Root disk')
                                    : activeMount.mountpoint}
                            </span>
                        </span>
                    )}
                </div>
                <div className="toolbar-right">
                    {search}
                    <div className="view-toggle">
                        <Button
                            variant="unstyled"
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            aria-pressed={viewMode === 'grid'}
                            title={t('app.fileManager.gridView', 'Grid view')}
                        >
                            <LayoutGrid size={14} />
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                            aria-pressed={viewMode === 'list'}
                            title={t('app.fileManager.listView', 'List view')}
                        >
                            <List size={14} />
                        </Button>
                    </div>
                    {/* One menu for how the listing is shown: which kinds, in what
                        order, hidden files or not. They were two selects and an
                        icon, each as wide as the control it sat beside. */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="unstyled"
                                type="button"
                                className={cn('toolbar-icon-btn toolbar-view-btn', viewIsNarrowed && 'active')}
                                title={t('app.fileManager.viewOptions', 'View options')}
                                aria-label={t('app.fileManager.viewOptions', 'View options')}
                            >
                                <SlidersHorizontal size={14} />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={6} className="ui-popover-panel sk-gridmenu">
                            <div className="sk-gridmenu__head">{t('app.fileManager.show', 'Show')}</div>
                            {FILTER_OPTIONS.map((option) => (
                                <Button
                                    variant="unstyled"
                                    key={option.id}
                                    type="button"
                                    className={cn('sk-gridmenu__opt', activeFilter === option.id && 'is-on')}
                                    onClick={() => setActiveFilter(option.id)}
                                >
                                    <span className="sk-gridmenu__box"><Check size={11} /></span>
                                    {filterLabels[option.id]}
                                    <span className="sk-gridmenu__rest">{filterCounts[option.id] ?? 0}</span>
                                </Button>
                            ))}

                            <div className="sk-gridmenu__sep" />
                            <div className="sk-gridmenu__head">{t('app.fileManager.sortBy', 'Sort by')}</div>
                            {sortKeys.map((option) => (
                                <Button
                                    variant="unstyled"
                                    key={option.key}
                                    type="button"
                                    className={cn('sk-gridmenu__opt', sortKey === option.key && 'is-on')}
                                    onClick={() => handleSortChange(`${option.key}-${option.first}`)}
                                >
                                    <span className="sk-gridmenu__box"><Check size={11} /></span>
                                    {option.label}
                                </Button>
                            ))}
                            <Button
                                variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt"
                                onClick={() => handleSortChange(`${sortKey}-${sortDir === 'asc' ? 'desc' : 'asc'}`)}
                            >
                                {sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                                {sortDir === 'asc'
                                    ? t('app.fileManager.ascending', 'Ascending')
                                    : t('app.fileManager.descending', 'Descending')}
                            </Button>

                            <div className="sk-gridmenu__sep" />
                            <Button
                                variant="unstyled"
                                type="button"
                                className={cn('sk-gridmenu__opt', showHidden && 'is-on')}
                                aria-pressed={showHidden}
                                onClick={() => setShowHidden(!showHidden)}
                            >
                                <span className="sk-gridmenu__box"><Check size={11} /></span>
                                {t('app.fileManager.showHiddenFiles', 'Show hidden files')}
                            </Button>
                        </PopoverContent>
                    </Popover>
                    <Button
                        variant="unstyled"
                        type="button"
                        className="toolbar-icon-btn"
                        onClick={() => loadDirectory(currentPath)}
                        title={t('common.actions.refresh', 'Refresh')}
                    >
                        <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                    </Button>
                </div>
            </div>
        </>
    );
}
