import { useLockBodyScroll } from '@/hooks/useLockBodyScroll';
import { X, Edit3, Download, EyeOff, Lock, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import FileIcon from './FileIcon';
import ImageThumb from './ImageThumb';
import { getFileType } from './fileTypes';
import { highlightLine, fileExt } from './highlight';
import { useTranslation } from 'react-i18next';

// Above this the highlighted view would render too many DOM nodes — fall back
// to the plain read-only textarea.
const MAX_HIGHLIGHT_LINES = 4000;

export default function PreviewDrawer({
    file,
    fileContent,
    setFileContent,
    editing,
    onStartEdit,
    onCancelEdit,
    onSave,
    onClose,
    onDownload,
    onRename,
    onPermissions,
    onDelete,
    onCopyPath,
    // When true, render as a flush inline pane (file-manager 3rd column)
    // instead of a fixed-position drawer-over-scrim.
    inline = false,
    isS3 = false,
}) {
    const { t } = useTranslation();
    // Lock body scroll only for the overlay drawer; the inline pane scrolls
    // within its own column and must not freeze the page.
    useLockBodyScroll(Boolean(file) && !inline);

    if (!file) return null;

    const type = getFileType(file);
    const isImage = type === 'image';

    return (
        <>
            {!inline && <div className="preview-drawer-backdrop" onClick={onClose} />}
            <aside
                className={inline ? 'preview-drawer file-preview-pane' : 'preview-drawer'}
                role={inline ? 'complementary' : 'dialog'}
                aria-label={t('app.previewDrawer.filePreview', 'File preview')}
            >
                <header className="preview-drawer-header">
                    <FileIcon entry={file} size={20} />
                    <div className="preview-drawer-title">
                        <h3>{file.name}</h3>
                        <p className="preview-drawer-path">{file.path}</p>
                    </div>
                    <Button variant="unstyled" type="button" className="preview-drawer-close" onClick={onClose} aria-label={t('common.actions.close', 'Close')}>
                        <X size={18} />
                    </Button>
                </header>

                <div className="preview-drawer-meta">
                    <div className="meta-item">
                        <span className="meta-label">{t('common.labels.size', 'Size')}</span>
                        <span className="meta-value">{file.size_human}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">{t('app.previewDrawer.owner', 'Owner')}</span>
                        <span className="meta-value">{file.owner}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">{t('app.previewDrawer.group', 'Group')}</span>
                        <span className="meta-value">{file.group}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">{t('common.labels.permissions', 'Permissions')}</span>
                        <span className="meta-value mono">{file.permissions}</span>
                    </div>
                    {file.mime_type && (
                        <div className="meta-item meta-item-wide">
                            <span className="meta-label">MIME</span>
                            <span className="meta-value mono">{file.mime_type}</span>
                        </div>
                    )}
                    <div className="meta-item meta-item-wide">
                        <span className="meta-label">{t('app.previewDrawer.modified', 'Modified')}</span>
                        <span className="meta-value">{new Date(file.modified).toLocaleString()}</span>
                    </div>
                </div>

                <div className="preview-drawer-actions">
                    {!file.is_dir && (
                        <Button variant="unstyled" type="button" className="drawer-action-btn" onClick={() => onDownload(file)}>
                            <Download size={14} /> {t('common.actions.download', 'Download')}
                        </Button>
                    )}
                    <Button variant="unstyled" type="button" className="drawer-action-btn" onClick={() => onCopyPath(file.path)}>
                        <Copy size={14} /> {t('app.previewDrawer.copyPath', 'Copy path')}
                    </Button>
                    <Button variant="unstyled" type="button" className="drawer-action-btn" onClick={() => onRename(file)}>
                        <Edit3 size={14} /> {t('app.previewDrawer.rename', 'Rename')}
                    </Button>
                    <Button variant="unstyled" type="button" className="drawer-action-btn" onClick={() => onPermissions(file)}>
                        <Lock size={14} /> {t('common.labels.permissions', 'Permissions')}
                    </Button>
                    <Button variant="unstyled" type="button" className="drawer-action-btn danger" onClick={() => onDelete(file)}>
                        <Trash2 size={14} /> {t('common.actions.delete', 'Delete')}
                    </Button>
                </div>

                <div className="preview-drawer-body">
                    {isImage ? (
                        <div className="preview-image-wrap">
                            <ImageThumb
                                path={file.path}
                                isS3={isS3}
                                fallback={
                                    <div className="preview-unavailable">
                                        <EyeOff size={48} strokeWidth={1.5} />
                                        <p>{t('app.previewDrawer.imagePreviewUnavailable', 'Image preview unavailable')}</p>
                                    </div>
                                }
                            />
                        </div>
                    ) : file.is_editable ? (
                        <div className="editor-wrap">
                            <div className="editor-toolbar">
                                <span className="editor-status">{editing ? 'Editing' : 'Read-only'}</span>
                                <div className="editor-buttons">
                                    {!editing ? (
                                        <Button size="sm" onClick={onStartEdit}>
                                            <Edit3 size={14} /> {t('common.actions.edit', 'Edit')}
                                        </Button>
                                    ) : (
                                        <>
                                            <Button variant="outline" size="sm" onClick={onCancelEdit}>
                                                {t('common.actions.cancel', 'Cancel')}
                                            </Button>
                                            <Button size="sm" onClick={onSave}>{t('common.actions.save', 'Save')}</Button>
                                        </>
                                    )}
                                </div>
                            </div>
                            {(() => {
                                if (editing) {
                                    return (
                                        <textarea
                                            className="file-editor"
                                            value={fileContent}
                                            onChange={(e) => setFileContent(e.target.value)}
                                            spellCheck={false}
                                        />
                                    );
                                }
                                const lines = (fileContent ?? '').split('\n');
                                if (lines.length > MAX_HIGHLIGHT_LINES) {
                                    return (
                                        <textarea
                                            className="file-editor"
                                            value={fileContent}
                                            readOnly
                                            spellCheck={false}
                                        />
                                    );
                                }
                                const ext = fileExt(file.name);
                                return (
                                    <div className="pv-code" aria-label={t('app.previewDrawer.fileContents', 'File contents')}>
                                        {lines.map((l, i) => (
                                            <div className="pv-code__line" key={i}>
                                                <span className="pv-code__n">{i + 1}</span>
                                                <span
                                                    className="pv-code__c"
                                                    dangerouslySetInnerHTML={{ __html: highlightLine(l, ext) || '&nbsp;' }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                    ) : (
                        <div className="preview-unavailable">
                            <EyeOff size={48} strokeWidth={1.5} />
                            <p>{t('app.previewDrawer.previewNotAvailableForThisFile', 'Preview not available for this file type')}</p>
                            <Button onClick={() => onDownload(file)}>
                                <Download size={16} /> {t('app.previewDrawer.downloadFile', 'Download file')}
                            </Button>
                        </div>
                    )}
                </div>
            </aside>
        </>
    );
}
