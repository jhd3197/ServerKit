import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { FolderOpen, CloudUpload, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';

import FileCard from './FileCard';
import FileRow from './FileRow';

import { useTranslation } from 'react-i18next';

export default function FileManagerListing({
    fileApi,
    clearSelection,
    dragActive,
    currentPath,
    loading,
    dirError,
    searchResults,
    loadDirectory,
    sortedFiltered,
    activeFilter,
    viewMode,
    selectedPaths,
    selectMode,
    rowOpen,
    rowToggleSelect,
    rowContext,
    isS3,
    setSelectedPaths,
    setSelectMode,
    rowDownload,
    rowRename,
    rowPermissions,
    rowDelete,
}) {
    const { t } = useTranslation();
    return (
        <>
            <main className="file-manager-main">
                <div
                    className="file-list-container"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) clearSelection();
                    }}
                >
                    {dragActive && (
                        <div className="drag-overlay">
                            <div className="drag-overlay-inner">
                                <CloudUpload size={56} strokeWidth={1.5} />
                                <h3>{t('app.fileManager.dropToUpload', 'Drop to upload')}</h3>
                                <p>
                                    {t('app.fileManager.filesWillBeUploadedTo', 'Files will be uploaded to')}{' '}
                                    <code>{currentPath}</code>
                                </p>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <EmptyState
                            loading
                            loadingVariant="tree"
                            title={t('app.fileManager.loadingFiles', 'Loading files')}
                        />
                    ) : dirError && !searchResults ? (
                        <ErrorState
                            title={t('app.fileManager.couldntOpenThisFolder', "Couldn't open this folder.")}
                            error={dirError}
                            onRetry={() => loadDirectory(currentPath)}
                        />
                    ) : sortedFiltered.length === 0 ? (
                        <EmptyState
                            icon={FolderOpen}
                            title={
                                searchResults
                                    ? t('app.fileManager.noMatches', 'No matches')
                                    : activeFilter !== 'all'
                                      ? t('app.fileManager.noFiles', 'No {{activeFilter}} files', {
                                            activeFilter: activeFilter,
                                        })
                                      : t('app.fileManager.thisFolderIsEmpty', 'This folder is empty')
                            }
                            description={
                                searchResults
                                    ? t(
                                          'app.fileManager.tryADifferentSearchTermOr',
                                          'Try a different search term or browse another folder.',
                                      )
                                    : activeFilter !== 'all'
                                      ? t('app.fileManager.tryADifferentFilter', 'Try a different filter.')
                                      : t(
                                            'app.fileManager.dropFilesHereOrUseThe',
                                            'Drop files here, or use the buttons above to create something new.',
                                        )
                            }
                        />
                    ) : viewMode === 'grid' ? (
                        <div className="file-grid">
                            {sortedFiltered.map((entry) => (
                                <FileCard
                                    key={entry.path}
                                    entry={entry}
                                    selected={selectedPaths.has(entry.path)}
                                    selectMode={selectMode}
                                    onOpen={rowOpen}
                                    onToggleSelect={rowToggleSelect}
                                    onContext={rowContext}
                                    isS3={isS3}
                                    fileApi={fileApi}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="file-list">
                            <div className="file-list-header">
                                <span className="col-check">
                                    <Button
                                        variant="unstyled"
                                        type="button"
                                        className="checkbox-btn"
                                        aria-label={t('app.dataTable.selectAll', 'Select all')}
                                        aria-pressed={selectedPaths.size === sortedFiltered.length && sortedFiltered.length > 0}
                                        onClick={() => {
                                            if (selectedPaths.size === sortedFiltered.length)
                                                clearSelection();
                                            else {
                                                setSelectedPaths(new Set(sortedFiltered.map((x) => x.path)));
                                                setSelectMode(sortedFiltered.length > 0);
                                            }
                                        }}
                                    >
                                        <span
                                            className={`checkbox ${selectedPaths.size === sortedFiltered.length && sortedFiltered.length > 0 ? 'checked' : ''}`}
                                        >
                                            {selectedPaths.size === sortedFiltered.length &&
                                                sortedFiltered.length > 0 && <Check size={12} />}
                                        </span>
                                    </Button>
                                </span>
                                <span className="col-name">{t('common.labels.name', 'Name')}</span>
                                <span className="col-size">{t('common.labels.size', 'Size')}</span>
                                <span className="col-modified">
                                    {t('app.fileManager.modified', 'Modified')}
                                </span>
                                <span className="col-permissions">
                                    {t('common.labels.permissions', 'Permissions')}
                                </span>
                                <span className="col-owner">{t('app.fileManager.owner', 'Owner')}</span>
                                <span className="col-actions">{t('common.labels.actions', 'Actions')}</span>
                            </div>
                            {sortedFiltered.map((entry) => (
                                <FileRow
                                    key={entry.path}
                                    entry={entry}
                                    selected={selectedPaths.has(entry.path)}
                                    selectMode={selectMode}
                                    onOpen={rowOpen}
                                    onToggleSelect={rowToggleSelect}
                                    onContext={rowContext}
                                    onDownload={rowDownload}
                                    onRename={rowRename}
                                    onPermissions={rowPermissions}
                                    onDelete={rowDelete}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </>
    );
}
