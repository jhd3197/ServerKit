import * as React from 'react';
import { AlertCircle, CheckCircle2, FileText, RotateCcw, UploadCloud, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProgressBar } from '@/components/ProgressBar';
import { useFieldProps } from '@/components/ui/field-context';
import { validateFiles } from '@/lib/fileAccept';
import { formatBytes } from '@/utils/formatBytes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-dropzone*, .ui-upload-list*).

/**
 * Drop target + browse button. It validates and hands files over; uploading
 * is the caller's job (show progress with FileUploadList).
 *
 *   <FileDropzone accept=".zip,.tar.gz" maxSize={512 * MB}
 *       onFiles={(accepted) => startUpload(accepted)}
 *       onReject={(rejected) => …} />
 *
 * `accept` uses <input accept> grammar and is re-checked on drop (the browser
 * only filters its own picker). Rejections carry a reason ('type' | 'size' |
 * 'count'); with no `onReject` they are listed inside the zone. The whole
 * zone is one button: Enter / Space opens the picker.
 */
const FileDropzone = React.forwardRef(({
    accept,
    maxSize,
    maxFiles,
    existingCount = 0,
    multiple = true,
    onFiles,
    onReject,
    disabled = false,
    title,
    hint,
    compact = false,
    className,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const fieldProps = useFieldProps(props);
    const inputRef = React.useRef(null);
    const depth = React.useRef(0);
    const [dragging, setDragging] = React.useState(false);
    const [rejections, setRejections] = React.useState([]);
    const hintId = React.useId();

    const take = (fileList) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const { accepted, rejected } = validateFiles(multiple ? files : files.slice(0, 1), {
            accept, maxSize, maxFiles, existingCount,
        });
        if (accepted.length) onFiles?.(accepted);
        if (onReject) onReject(rejected);
        else setRejections(rejected);
    };

    const reasonText = ({ file, reason }) => {
        if (reason === 'size') {
            return t('common.controls.fileTooLarge', '{{name}} is larger than {{max}}.', { name: file.name, max: formatBytes(maxSize) });
        }
        if (reason === 'count') {
            return t('common.controls.tooManyFiles', '{{name}} was not added: the limit is {{max}} files.', { name: file.name, max: maxFiles });
        }
        return t('common.controls.fileTypeNotAllowed', '{{name}} is not an allowed file type.', { name: file.name });
    };

    const open = () => { if (!disabled) inputRef.current?.click(); };

    const limits = [
        accept && accept.split(',').map((part) => part.trim()).join(', '),
        Number.isFinite(maxSize) && t('common.controls.upToSize', 'up to {{size}}', { size: formatBytes(maxSize) }),
    ].filter(Boolean).join(' · ');

    return (
        <div className={cn('ui-dropzone-field', className)}>
            <div
                ref={ref}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled || undefined}
                aria-describedby={[hintId, fieldProps['aria-describedby']].filter(Boolean).join(' ')}
                id={fieldProps.id}
                className={cn(
                    'ui-dropzone',
                    compact && 'ui-dropzone--compact',
                    dragging && 'is-dragging',
                    disabled && 'is-disabled',
                    fieldProps['aria-invalid'] && 'is-invalid',
                )}
                onClick={open}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
                }}
                onDragEnter={(event) => {
                    event.preventDefault();
                    if (disabled) return;
                    // dragenter/leave fire for every child crossed; count depth
                    // so the highlight does not flicker over the icon and text.
                    depth.current += 1;
                    setDragging(true);
                }}
                onDragOver={(event) => {
                    event.preventDefault();
                    if (!disabled) event.dataTransfer.dropEffect = 'copy';
                }}
                onDragLeave={() => {
                    depth.current = Math.max(0, depth.current - 1);
                    if (depth.current === 0) setDragging(false);
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    depth.current = 0;
                    setDragging(false);
                    if (!disabled) take(event.dataTransfer.files);
                }}
            >
                <UploadCloud className="ui-dropzone__icon" aria-hidden="true" />
                <span className="ui-dropzone__copy">
                    <span className="ui-dropzone__title">
                        {dragging
                            ? t('common.controls.dropToUpload', 'Drop to add')
                            : (title || t('common.controls.dropOrBrowse', 'Drop files here or browse'))}
                    </span>
                    <span id={hintId} className="ui-dropzone__hint">{hint || limits}</span>
                </span>
            </div>
            {/* Outside the zone: input.click() bubbles, and a click reaching
                the zone would open the picker a second time. */}
            <input
                ref={inputRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                accept={accept}
                multiple={multiple}
                disabled={disabled}
                onChange={(event) => { take(event.target.files); event.target.value = ''; }}
            />
            {rejections.length > 0 && (
                <ul className="ui-dropzone__rejections" role="alert">
                    {rejections.map((rejection) => (
                        <li key={`${rejection.file.name}-${rejection.reason}`}>
                            <AlertCircle aria-hidden="true" />
                            <span>{reasonText(rejection)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
});
FileDropzone.displayName = 'FileDropzone';

const ITEM_ICONS = { done: CheckCircle2, error: AlertCircle };

/**
 * The files of an upload and where each one is.
 *
 *   <FileUploadList items={uploads} onRetry={retry} onRemove={remove} />
 *
 * Items are `{ id, name, size, status, progress?, error? }` with status
 * 'queued' | 'uploading' | 'done' | 'error'. Retry shows on errors, remove on
 * anything not mid-upload (pass `onCancel` to offer cancelling those).
 */
function FileUploadList({ items = [], onRetry, onRemove, onCancel, className }) {
    const { t } = useTranslation();
    if (!items.length) return null;
    const statusText = (item) => {
        if (item.status === 'uploading') {
            return t('common.controls.uploadingPercent', 'Uploading {{percent}}%', { percent: Math.round(item.progress || 0) });
        }
        if (item.status === 'done') return t('common.controls.uploaded', 'Uploaded');
        if (item.status === 'error') return item.error || t('common.controls.uploadFailed', 'Upload failed');
        return t('common.controls.queued', 'Queued');
    };
    return (
        <ul className={cn('ui-upload-list', className)}>
            {items.map((item) => {
                const Icon = ITEM_ICONS[item.status] || FileText;
                const busy = item.status === 'uploading';
                return (
                    <li key={item.id} className={cn('ui-upload-list__item', `is-${item.status || 'queued'}`)}>
                        <Icon className="ui-upload-list__icon" aria-hidden="true" />
                        <div className="ui-upload-list__body">
                            <div className="ui-upload-list__row">
                                <span className="ui-upload-list__name" title={item.name}>{item.name}</span>
                                {Number.isFinite(item.size) && (
                                    <span className="ui-upload-list__size">{formatBytes(item.size)}</span>
                                )}
                            </div>
                            {busy && (
                                <ProgressBar
                                    percent={item.progress || 0}
                                    label={t('common.controls.uploadingName', 'Uploading {{name}}', { name: item.name })}
                                />
                            )}
                            <span className="ui-upload-list__status" aria-live={busy ? 'off' : 'polite'}>
                                {statusText(item)}
                            </span>
                        </div>
                        <div className="ui-upload-list__actions">
                            {item.status === 'error' && onRetry && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="ui-upload-list__action"
                                    aria-label={t('common.controls.retryItem', 'Retry {{name}}', { name: item.name })}
                                    onClick={() => onRetry(item)}
                                >
                                    <RotateCcw aria-hidden="true" />
                                </Button>
                            )}
                            {(busy ? onCancel : onRemove) && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="ui-upload-list__action"
                                    aria-label={busy
                                        ? t('common.controls.cancelItem', 'Cancel {{name}}', { name: item.name })
                                        : t('common.controls.removeItem', 'Remove {{label}}', { label: item.name })}
                                    onClick={() => (busy ? onCancel(item) : onRemove(item))}
                                >
                                    <X aria-hidden="true" />
                                </Button>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

export { FileDropzone, FileUploadList };
