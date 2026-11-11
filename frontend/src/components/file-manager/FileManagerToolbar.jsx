import {
    File,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Search,
    X,
    RefreshCw,
    Eye,
    EyeOff,
    HardDrive,
    PanelLeftClose,
    PanelLeftOpen,
    LayoutGrid,
    List,
    Home,
    ArrowUpDown,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

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
    searchQuery,
    setSearchQuery,
    handleSearch,
    searchResults,
    clearSearch,
    viewMode,
    setViewMode,
    showHidden,
    setShowHidden,
    loadDirectory,
    currentPath,
    loading,
}) {
    const { t } = useTranslation();
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
                            title="Up"
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
                                {idx > 0 && <span className="crumb-separator">/</span>}
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
                    <Select value={activeFilter} onValueChange={setActiveFilter}>
                        <SelectTrigger
                            className="file-toolbar-select"
                            title={t('app.fileManager.types', 'Types')}
                            aria-label={t('app.fileManager.types', 'Types')}
                        >
                            <File size={13} aria-hidden="true" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FILTER_OPTIONS.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                    {filterLabels[option.id]} ({filterCounts[option.id] ?? 0})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={sortValue} onValueChange={handleSortChange}>
                        <SelectTrigger
                            className="file-toolbar-select"
                            title={t('app.fileManager.sort', 'Sort')}
                            aria-label={t('app.fileManager.sort', 'Sort')}
                        >
                            <ArrowUpDown size={13} aria-hidden="true" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="name-asc">
                                {t('app.fileManager.nameAZ', 'Name A-Z')}
                            </SelectItem>
                            <SelectItem value="name-desc">
                                {t('app.fileManager.nameZA', 'Name Z-A')}
                            </SelectItem>
                            <SelectItem value="modified-desc">
                                {t('app.fileManager.newest', 'Newest')}
                            </SelectItem>
                            <SelectItem value="modified-asc">
                                {t('app.fileManager.oldest', 'Oldest')}
                            </SelectItem>
                            <SelectItem value="size-desc">
                                {t('app.fileManager.largest', 'Largest')}
                            </SelectItem>
                            <SelectItem value="size-asc">
                                {t('app.fileManager.smallest', 'Smallest')}
                            </SelectItem>
                            <SelectItem value="type-asc">{t('common.labels.type', 'Type')}</SelectItem>
                            <SelectItem value="type-desc">
                                {t('app.fileManager.typeZA', 'Type Z-A')}
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="search-field">
                        <Search size={14} className="search-field-icon" />
                        <input
                            type="text"
                            placeholder={t('app.fileManager.searchFiles', 'Search files…')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                        {(searchResults || searchQuery) && (
                            <Button
                                variant="unstyled"
                                type="button"
                                className="search-field-clear"
                                onClick={clearSearch}
                                title={t('common.actions.clear', 'Clear')}
                            >
                                <X size={12} />
                            </Button>
                        )}
                    </div>
                    <div className="view-toggle">
                        <Button
                            variant="unstyled"
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            title={t('app.fileManager.gridView', 'Grid view')}
                        >
                            <LayoutGrid size={14} />
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                            onClick={() => setViewMode('list')}
                            title={t('app.fileManager.listView', 'List view')}
                        >
                            <List size={14} />
                        </Button>
                    </div>
                    <Button
                        variant="unstyled"
                        type="button"
                        className={`toolbar-icon-btn ${showHidden ? 'active' : ''}`}
                        onClick={() => setShowHidden(!showHidden)}
                        title={t('app.fileManager.toggleHiddenFiles', 'Toggle hidden files')}
                    >
                        {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </Button>
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
