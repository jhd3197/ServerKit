import useFileListingModel, { FILTER_OPTIONS } from '../components/file-manager/hooks/useFileListingModel';
import FileManagerDialogs from '../components/file-manager/FileManagerDialogs';
import FileManagerStatus from '../components/file-manager/FileManagerStatus';
import FileUploadTray from '../components/file-manager/FileUploadTray';
import FileManagerListing from '../components/file-manager/FileManagerListing';
import FileManagerToolbar from '../components/file-manager/FileManagerToolbar';
import FileManagerSidebar from '../components/file-manager/FileManagerSidebar';
import useFileActions from '../components/file-manager/hooks/useFileActions';
import useFileEditor from '../components/file-manager/hooks/useFileEditor';
import useDirectoryBrowser from '../components/file-manager/hooks/useDirectoryBrowser';
import useFileTransfers from '../components/file-manager/hooks/useFileTransfers';
import useFileVolumes from '../components/file-manager/hooks/useFileVolumes';
import useFileTree from '../components/file-manager/hooks/useFileTree';
import useFileSelection from '../components/file-manager/hooks/useFileSelection';
import useFilePreferences from '../components/file-manager/hooks/useFilePreferences';
import useFileTargets from '../components/file-manager/hooks/useFileTargets';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { createFileAdapter } from '../components/file-manager/fileAdapter';
import { useToast } from '../contexts/useToast.js';

import { Upload, FolderPlus, X, Download, Edit3, Trash2, Check, Copy, Terminal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

import PreviewDrawer from '../components/file-manager/PreviewDrawer';
import ContextMenu from '../components/file-manager/ContextMenu';

import { formatBytes } from '../components/file-manager/fileTypes';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from 'react-i18next';
import { useTopbarActions, useTopbarChrome } from '@/hooks/useTopbarActions';
import FileSearchField from '../components/file-manager/FileSearchField';
import { useStableHandler } from '@/hooks/useStableHandler';

function FileManager() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    // ─── target ──────────────────────────────────────────
    // Local panel host by default. Switching to an agent re-routes the
    // browse/read/write verbs through /servers/<id>/files/* and disables
    // operations the agent can't serve yet.
    const [target, setTarget] = useState({ kind: 'local' });
    const isRemote = target.kind === 'agent';
    const isS3 = target.kind === 's3';
    const fileApi = useMemo(() => createFileAdapter(api, target), [target]);
    const { copy: copyText } = useClipboard({
        successMessage: t('app.fileManager.pathCopied', 'Path copied'),
        errorMessage: t('app.fileManager.couldNotCopyPath', "Couldn't copy the path."),
    });

    const { s3Options, quickAccess } = useFileTargets({ target, isRemote, t });

    const {
        selectedPaths,
        setSelectedPaths,
        selectMode,
        setSelectMode,
        setLastClickedPath,
        toggleSelect,
        clearSelection,
    } = useFileSelection();
    const handleToggleSelect = (entry, event) => toggleSelect(entry, event, sortedFiltered);

    const {
        viewMode,
        setViewMode,
        gridSize,
        sortBy,
        setSortBy,
        sortDir,
        setSortDir,
        activeFilter,
        setActiveFilter,
        sidebarVisible,
        setSidebarVisible,
        treeCollapsed,
        setTreeCollapsed,
    } = useFilePreferences();

    // ─── context menu ────────────────────────────────────
    const [contextMenu, setContextMenu] = useState(null);

    const toast = useToast();

    const remoteGuard = useCallback(
        (op) => {
            if (isRemote && !fileApi.supports(op)) {
                toast.error(
                    t(
                        'app.fileManager.isNotYetSupportedOnRemote',
                        '{{op}} is not yet supported on remote agents',
                        { op: op },
                    ),
                );
                return true;
            }
            if (isS3 && !fileApi.supports(op)) {
                toast.error(
                    t('app.fileManager.isnTAvailableOnS3Buckets', "{{op}} isn't available on S3 buckets", {
                        op: op,
                    }),
                );
                return true;
            }
            return false;
        },
        [isRemote, isS3, fileApi, t, toast],
    );

    const {
        previewFile,
        setPreviewFile,
        fileContent,
        setFileContent,
        editing,
        setEditing,
        openFile,
        handleSaveFile,
    } = useFileEditor({ fileApi, toast, t, onSaved: () => loadDirectory(currentPath) });

    const {
        currentPath,
        entries,
        parentPath,
        loading,
        dirError,
        showHidden,
        setShowHidden,
        searchQuery,
        setSearchQuery,
        searchResults,
        clearSearch,
        history,
        historyIdx,
        loadDirectory,
        handleSearch,
        navigateTo,
        goBack,
        goForward,
        goUp,
    } = useDirectoryBrowser({
        fileApi,
        target,
        resetSelection: clearSelection,
        onNavigate: () => {
            setPreviewFile(null);
            setEditing(false);
        },
        remoteGuard,
        toast,
        t,
    });

    const { treeExpanded, treeCache, refreshTree, treeLoading, toggleTreeExpand } = useFileTree({
        fileApi,
        currentPath,
    });

    const { diskMounts, diskLastUpdated, diskLoading, loadDiskMounts, activeMount } =
        useFileVolumes(currentPath);

    const {
        dialog,
        setDialog,
        closeDialog,
        handleCreateFolder,
        handleDelete,
        handleRename,
        handleChangePermissions,
        handleDownload,
        downloadSelected,
        openRenameModal,
        openPermissionsModal,
    } = useFileActions({
        fileApi,
        currentPath,
        remoteGuard,
        loadDirectory,
        refreshTree,
        previewFile,
        setPreviewFile,
        clearSelection,
        toast,
        t,
    });
    const handleOpen = (entry) => (entry.is_dir ? navigateTo(entry.path) : openFile(entry));

    const {
        uploads,
        setUploads,
        dragActive,
        fileInputRef,
        handleUploadInput,
        handleDragEnter,
        handleDragLeave,
        handleDragOver,
        handleDrop,
        activeUploads,
        totalUploadProgress,
    } = useFileTransfers({ fileApi, currentPath, remoteGuard, loadDirectory, toast, t });

    const {
        breadcrumbs,
        sortedFiltered,
        filterCounts,
        stats,
        sortValue,
        filterLabels,
        handleSortChange,
        selectedEntries,
    } = useFileListingModel({
        currentPath,
        entries,
        searchResults,
        activeFilter,
        sortBy,
        sortDir,
        selectedPaths,
        setSortBy,
        setSortDir,
        t,
    });

    // ─── shortcuts ───────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            const inInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
            if (inInput) return;
            if (e.key === 'Escape') {
                if (contextMenu) setContextMenu(null);
                else if (previewFile) setPreviewFile(null);
                else if (selectedPaths.size > 0) clearSelection();
            }
            if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selectedEntries.length > 0) {
                e.preventDefault();
                handleDelete(selectedEntries);
            }
            if (e.key === 'F2' && selectedEntries.length === 1) openRenameModal(selectedEntries[0]);
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                setSelectedPaths(new Set(sortedFiltered.map((x) => x.path)));
                setSelectMode(sortedFiltered.length > 0);
            }
            if (e.key === 'Backspace' && !e.metaKey && parentPath) {
                e.preventDefault();
                goUp();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedEntries, sortedFiltered, contextMenu, previewFile, parentPath, selectedPaths]); // eslint-disable-line

    // ─── close popovers ──────────────────────────────────
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => {
            setContextMenu(null);
        };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, [contextMenu]);

    const openContextMenu = (e, entry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedPaths.has(entry.path)) {
            setSelectedPaths(new Set([entry.path]));
            setSelectMode(true);
            setLastClickedPath(entry.path);
        }
        setContextMenu({ x: e.clientX, y: e.clientY, entry });
    };

    // Stable identities for the memoized rows/cards: a fresh handler on every
    // render made each keystroke or selection re-render every row.
    const rowOpen = useStableHandler(handleOpen);
    const rowToggleSelect = useStableHandler(handleToggleSelect);
    const rowContext = useStableHandler(openContextMenu);
    const rowDownload = useStableHandler(handleDownload);
    const rowRename = useStableHandler(openRenameModal);
    const rowPermissions = useStableHandler(openPermissionsModal);
    const rowDelete = useStableHandler((entry) => handleDelete(entry));

    const copyPathToClipboard = (path) => copyText(path);

    useTopbarActions(
        () => (
            <>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ kind: 'newFolder' })}
                    disabled={isRemote || isS3}
                >
                    <FolderPlus size={14} /> {t('app.fileManager.newFolder', 'New folder')}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRemote}
                >
                    <Upload size={14} /> {t('app.fileManager.upload', 'Upload')}
                </Button>
                {!isS3 && (
                    <Button type="button" size="sm" onClick={() => navigate('/terminal')}>
                        <Terminal size={14} /> {t('app.fileManager.terminal', 'Terminal')}
                    </Button>
                )}
            </>
        ),
        [isRemote, isS3, currentPath],
    );

    // Search rides in the top bar, right-most, like every other page's search.
    // Without a top bar (the page mounted on its own) it falls back to the
    // toolbar underneath.
    const { portal: searchPortal, actions: inlineSearch } = useTopbarChrome(
        <FileSearchField
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleSearch={handleSearch}
            searchResults={searchResults}
            clearSearch={clearSearch}
        />,
    );

    // ─── render ──────────────────────────────────────────
    return (
        <div
            className={`sk-tabgroup__fill file-manager-page file-manager fullscreen ${sidebarVisible ? 'sidebar-open' : ''} view-${viewMode} grid-${gridSize} ${selectMode ? 'select-mode' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <input type="file" ref={fileInputRef} multiple className="hidden" onChange={handleUploadInput} />
            {searchPortal}

            {isRemote && (
                <div className="file-manager-target-banner">
                    {t('app.fileManager.browsingOn', 'Browsing on')} <strong>{target.name}</strong>{' '}
                    {t(
                        'app.fileManager.readWriteOnlyMkdirDeleteRename',
                        "(read/write only). Mkdir/delete/rename/upload aren't yet supported on remote agents.",
                    )}
                </div>
            )}

            {isS3 && (
                <div className="file-manager-target-banner">
                    {t('app.fileManager.browsingYour', 'Browsing your')}{' '}
                    <strong>{t('app.fileManager.s3Bucket', 'S3 bucket')}</strong>.{' '}
                    {t(
                        'app.fileManager.s3SupportedOperations',
                        "Upload, download, edit and delete work; folders, rename and permissions don't apply to object storage.",
                    )}
                </div>
            )}

            <FileUploadTray
                uploads={uploads}
                activeUploads={activeUploads}
                totalUploadProgress={totalUploadProgress}
                setUploads={setUploads}
            />

            <FileManagerToolbar
                setSidebarVisible={setSidebarVisible}
                sidebarVisible={sidebarVisible}
                goBack={goBack}
                history={history}
                historyIdx={historyIdx}
                goForward={goForward}
                goUp={goUp}
                parentPath={parentPath}
                navigateTo={navigateTo}
                isS3={isS3}
                breadcrumbs={breadcrumbs}
                activeMount={activeMount}
                isRemote={isRemote}
                activeFilter={activeFilter}
                setActiveFilter={setActiveFilter}
                FILTER_OPTIONS={FILTER_OPTIONS}
                filterLabels={filterLabels}
                filterCounts={filterCounts}
                sortValue={sortValue}
                handleSortChange={handleSortChange}
                search={inlineSearch}
                viewMode={viewMode}
                setViewMode={setViewMode}
                showHidden={showHidden}
                setShowHidden={setShowHidden}
                loadDirectory={loadDirectory}
                currentPath={currentPath}
                loading={loading}
            />

            {selectedPaths.size > 0 && (
                <div className="bulk-bar">
                    <div className="bulk-bar-info">
                        <Check size={14} />
                        <span>
                            {selectedPaths.size} {t('app.fileManager.selected', 'selected ·')}{' '}
                            {formatBytes(stats.selectedBytes)}
                        </span>
                    </div>
                    <div className="bulk-bar-actions">
                        <Button
                            variant="unstyled"
                            type="button"
                            className="bulk-btn"
                            onClick={() => downloadSelected(selectedEntries)}
                        >
                            <Download size={14} /> {t('common.actions.download', 'Download')}
                        </Button>
                        {selectedEntries.length === 1 && (
                            <>
                                <Button
                                    variant="unstyled"
                                    type="button"
                                    className="bulk-btn"
                                    onClick={() => openRenameModal(selectedEntries[0])}
                                >
                                    <Edit3 size={14} /> {t('app.fileManager.rename', 'Rename')}
                                </Button>
                                <Button
                                    variant="unstyled"
                                    type="button"
                                    className="bulk-btn"
                                    onClick={() => copyPathToClipboard(selectedEntries[0].path)}
                                >
                                    <Copy size={14} /> {t('app.fileManager.copyPath', 'Copy path')}
                                </Button>
                            </>
                        )}
                        <Button
                            variant="unstyled"
                            type="button"
                            className="bulk-btn danger"
                            onClick={() => handleDelete(selectedEntries)}
                        >
                            <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                        </Button>
                        <Button
                            variant="unstyled"
                            type="button"
                            className="bulk-btn ghost"
                            onClick={clearSelection}
                        >
                            <X size={14} /> {t('common.actions.clear', 'Clear')}
                        </Button>
                    </div>
                </div>
            )}

            <div className={`file-manager-body ${previewFile ? 'has-preview' : ''}`}>
                <FileManagerSidebar
                    sidebarVisible={sidebarVisible}
                    setSidebarVisible={setSidebarVisible}
                    target={target}
                    setTarget={setTarget}
                    s3Options={s3Options}
                    isS3={isS3}
                    isRemote={isRemote}
                    loadDiskMounts={loadDiskMounts}
                    diskLoading={diskLoading}
                    diskMounts={diskMounts}
                    activeMount={activeMount}
                    navigateTo={navigateTo}
                    diskLastUpdated={diskLastUpdated}
                    quickAccess={quickAccess}
                    currentPath={currentPath}
                    setTreeCollapsed={setTreeCollapsed}
                    treeCollapsed={treeCollapsed}
                    setDialog={setDialog}
                    treeExpanded={treeExpanded}
                    treeCache={treeCache}
                    treeLoading={treeLoading}
                    toggleTreeExpand={toggleTreeExpand}
                />

                <FileManagerListing
                    fileApi={fileApi}
                    clearSelection={clearSelection}
                    dragActive={dragActive}
                    currentPath={currentPath}
                    loading={loading}
                    dirError={dirError}
                    searchResults={searchResults}
                    loadDirectory={loadDirectory}
                    sortedFiltered={sortedFiltered}
                    activeFilter={activeFilter}
                    viewMode={viewMode}
                    selectedPaths={selectedPaths}
                    selectMode={selectMode}
                    rowOpen={rowOpen}
                    rowToggleSelect={rowToggleSelect}
                    rowContext={rowContext}
                    isS3={isS3}
                    setSelectedPaths={setSelectedPaths}
                    setSelectMode={setSelectMode}
                    rowDownload={rowDownload}
                    rowRename={rowRename}
                    rowPermissions={rowPermissions}
                    rowDelete={rowDelete}
                />

                <PreviewDrawer
                    fileApi={fileApi}
                    inline
                    isS3={isS3}
                    file={previewFile}
                    fileContent={fileContent}
                    setFileContent={setFileContent}
                    editing={editing}
                    onStartEdit={() => setEditing(true)}
                    onCancelEdit={() => setEditing(false)}
                    onSave={handleSaveFile}
                    onClose={() => {
                        setPreviewFile(null);
                        setEditing(false);
                    }}
                    onDownload={handleDownload}
                    onRename={openRenameModal}
                    onPermissions={openPermissionsModal}
                    onCopyPath={copyPathToClipboard}
                    onDelete={(e) => handleDelete(e)}
                />
            </div>

            <FileManagerStatus stats={stats} />

            <ContextMenu
                menu={contextMenu}
                selectionCount={selectedEntries.length}
                onClose={() => setContextMenu(null)}
                onOpen={handleOpen}
                onDownload={handleDownload}
                onRename={openRenameModal}
                onPermissions={openPermissionsModal}
                onCopyPath={copyPathToClipboard}
                onDelete={(e) => handleDelete(selectedEntries.length > 1 ? selectedEntries : e)}
            />

            <FileManagerDialogs
                dialog={dialog}
                currentPath={currentPath}
                handleCreateFolder={handleCreateFolder}
                closeDialog={closeDialog}
                handleRename={handleRename}
                handleChangePermissions={handleChangePermissions}
            />
        </div>
    );
}

export default FileManager;
