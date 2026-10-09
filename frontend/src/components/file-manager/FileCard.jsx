import { memo } from 'react';
import { Check } from 'lucide-react';
import FileIcon from './FileIcon';
import ImageThumb from './ImageThumb';
import { getFileType, getFileExt } from './fileTypes';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

function FileCard({
    entry,
    selected,
    selectMode,
    onOpen,
    onToggleSelect,
    onContext,
    isS3 = false,
}) {
    const { t } = useTranslation();
    const ext = getFileExt(entry);
    const type = getFileType(entry);
    const showThumb = type === 'image' && entry.size && entry.size < 8 * 1024 * 1024;

    return (
        <div
            className={`file-card type-${type} ${selected ? 'selected' : ''} ${selectMode ? 'select-mode' : ''}`}
            onClick={(e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || selectMode) {
                    onToggleSelect(entry, e);
                } else {
                    onOpen(entry);
                }
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onOpen(entry);
            }}
            onContextMenu={(e) => onContext(e, entry)}
        >
            <SharedButton variant="unstyled" type="button"
                className="file-card-check"
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(entry, { ...e, ctrlKey: true });
                }}
                aria-label={selected ? t('app.fileCard.deselect', 'Deselect') : t('app.fileCard.select', 'Select')}
            >
                <span className={`checkbox ${selected ? 'checked' : ''}`}>
                    {selected && <Check size={12} />}
                </span>
            </SharedButton>

            <div className="file-card-thumb">
                {showThumb ? (
                    <ImageThumb path={entry.path} isS3={isS3} fallback={<FileIcon entry={entry} size={36} />} />
                ) : (
                    <FileIcon entry={entry} size={36} />
                )}
                {ext && <span className="ext-badge">{ext}</span>}
                {entry.is_link && <span className="link-badge">↗</span>}
            </div>
            <div className="file-card-body">
                <div className="file-card-name" title={entry.name}>{entry.name}</div>
                <div className="file-card-meta">
                    {entry.is_dir ? t('app.fileCard.folder', 'Folder') : entry.size_human}
                </div>
            </div>
        </div>
    );
}

export default memo(FileCard);
