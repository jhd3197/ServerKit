import { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
import { ErrorState } from '../ErrorState';
import Modal from '@/components/Modal';
import { DataTable, DataTableFooter, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layers, Trash2 } from 'lucide-react';
import { formatBytes } from '@/utils/formatBytes';
import { formatRelativeTime } from '@/utils/time';
import { useTranslation } from 'react-i18next';
import {
    useServer,
    normalizeListResponse,
    imageId,
    imageRef,
    imageSizeBytes,
    imageSizeMb,
    imageCreatedMs,
} from './dockerHelpers';
import { toastError } from '@/utils/errorMessage';
import { formatDateTime } from '@/utils/intl';

export const PullImageButton = () => {
    const { t } = useTranslation();
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
                <span>+</span> {t('app.imagesTab.pullImage', 'Pull image')}
            </Button>
            {showModal && <PullImageModal onClose={() => setShowModal(false)} onPulled={() => window.location.reload()} />}
        </>
    );
};

// Built-in views. Dangling is the one axis this payload really has: docker
// reports an untagged layer as repository `<none>`, on both transports, so the
// rule below is reading a fact rather than a guess. There is deliberately no
// "unused" view — the image list carries no reference count, and inventing one
// from the container list would be a different question answered quietly.
const NO_RULES = { match: 'all', rules: [] };
const PAGE_CLEAR = { search: '' };

const IMAGE_VIEWS = [
    {
        // What Prune would take, biggest first: an untagged layer left behind
        // by a rebuild is pure reclaimable disk.
        name: 'Dangling',
        state: {
            sorts: [{ key: 'size', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'di1', field: 'repository', op: 'is', value: '<none>' }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // The disk question. No rules — the whole library, ordered by what it
        // costs you.
        name: 'Largest first',
        state: {
            sorts: [{ key: 'size', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
    {
        // Every tag of a repository together, which is how you notice you are
        // still holding four versions of the same base image.
        name: 'By repository',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: 'repository',
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
    {
        // The way back out of any of the above.
        name: 'Newest first',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
];

// Images Tab
const ImagesTab = ({ onStatsChange }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmImage } = useConfirm();
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'repository', direction: 'asc' }],
        storageKey: 'serverkit-table-docker-images-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-docker-images-cols',
    });
    const [groupBy, setGroupBy] = useState(null);
    // Only the newest load may write: see ContainersTab.
    const loadSeq = useRef(0);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        loadImages();
    }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadImages() {
        const seq = ++loadSeq.current;
        setLoading(true);
        setLoadError(null);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteImages(serverId);
                data = { images: normalizeListResponse(result, 'images') };
            } else {
                data = await api.getImages();
            }
            if (seq !== loadSeq.current) return;
            setImages(data.images || []);
            setLoading(false);
        } catch (err) {
            if (seq !== loadSeq.current) return;
            setImages([]);
            setLoadError(err);
            setLoading(false);
        }
    }

    async function handleRemove(image) {
        const confirmed = await confirmImage({ titleKey: 'app.imagesTab.removeImage', title: 'Delete image', messageKey: 'app.imagesTab.removeThisImage', message: 'Delete this image?', confirmText: t('common.actions.delete', 'Delete') });
        if (!confirmed) return;

        try {
            const id = image.id || image.ID;
            if (isRemote) {
                await api.removeRemoteImage(serverId, id, true);
            } else {
                await api.removeImage(id, true);
            }
            toast.success(t('app.imagesTab.imageRemovedSuccessfully', 'Image deleted'));
            loadImages();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove image:', err);
            toastError(toast, t('app.imagesTab.failedToRemoveImageItMay', "Couldn't delete the image. A container may still use it."), err);
        }
    }

    const filteredImages = useMemo(() => {
        const search = searchTerm.toLowerCase();
        if (!search) return images;
        return images.filter((image) => {
            const { repository, tag } = imageRef(image);
            return repository.toLowerCase().includes(search) ||
                tag.toLowerCase().includes(search) ||
                imageId(image).toLowerCase().includes(search);
        });
    }, [images, searchTerm]);

    // Two accessors per derived column on purpose: `value` is what the column
    // menu, the filter rules and the export read, `render` is the cell. A
    // derived column with only one of them renders blank (see ds/DataTable).
    const columns = [
        {
            key: 'repository',
            headerKey: 'app.imagesTab.repository', header: 'Repository',
            sortable: true,
            hideable: false,
            type: 'text',
            // Grouping is the whole point of the "By repository" view, and
            // `groupValue` has to be spelled out too: the grouper falls back to
            // row[key], which the agent's payload does not have.
            groupable: true,
            value: (image) => imageRef(image).repository,
            groupValue: (image) => imageRef(image).repository,
            sortValue: (image) => imageRef(image).repository,
            render: (image) => (
                <div className="dx-name-stack">
                    <span className="dx-name-line">
                        <span title={imageRef(image).repository}>{imageRef(image).repository}</span>
                    </span>
                    <span className="dx-muted-line mono">{imageId(image).substring(0, 12) || '-'}</span>
                </div>
            ),
        },
        {
            key: 'tag',
            headerKey: 'app.imagesTab.tag', header: 'Tag',
            sortable: true,
            // Declared: a host whose tags all read "8.0"/"20" would infer `num`
            // and offer "is under 20" instead of a text match.
            type: 'text',
            value: (image) => imageRef(image).tag,
            sortValue: (image) => imageRef(image).tag,
            render: (image) => <span className="dx-code-pill">{imageRef(image).tag}</span>,
        },
        {
            key: 'size',
            headerKey: 'common.labels.size', header: 'Size',
            sortable: true,
            type: 'num',
            unit: ' MB',
            width: 110,
            value: imageSizeMb,
            sortValue: imageSizeMb,
            render: (image) => (
                <span className="dx-muted-line">{formatBytes(imageSizeBytes(image))}</span>
            ),
        },
        {
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            // Declared: `sortValue` is epoch ms, and letting that number type the
            // column would offer "is under 1754…" instead of a date picker.
            type: 'date',
            width: 120,
            value: (image) => {
                const ms = imageCreatedMs(image);
                return ms == null ? null : new Date(ms).toISOString();
            },
            sortValue: imageCreatedMs,
            render: (image) => {
                const ms = imageCreatedMs(image);
                if (ms == null) return <span className="dx-muted-line">-</span>;
                const iso = new Date(ms).toISOString();
                return (
                    <span className="dx-muted-line" title={formatDateTime(ms)}>
                        {formatRelativeTime(iso)}
                    </span>
                );
            },
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 72,
            className: 'text-right',
            render: (image) => (
                <div className="dx-row-actions">
                    <Button variant="unstyled"
                        type="button"
                        className="dx-row-action is-danger"
                        onClick={() => handleRemove(image)}
                        title={t('app.imagesTab.removeImage2', 'Delete image')}
                    >
                        <Trash2 size={13} />
                    </Button>
                </div>
            ),
        },
    ];

    // The page-private half of a saved view: the search box is the one piece of
    // state the envelope's common keys cannot describe.
    const viewPageState = useMemo(() => ({ search: searchTerm }), [searchTerm]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearchTerm(saved.search);
    }, []);

    // Chrome stays INLINE in the picker's `actions`: the Docker page owns the
    // top bar above this panel, and hoisting from here would hijack it for
    // whichever resource tab happened to be open. `urlScope` because that one
    // route renders five of these tables — unscoped, the images view name would
    // arrive in the volumes table's ?view=.
    const chrome = useTableChrome({
        columns,
        rows: filteredImages,
        viewPageKey: 'docker-images',
        urlScope: 'images',
        builtinViews: IMAGE_VIEWS,
        noun: 'images',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (loading) {
        return (
            <div className="dx-tab-pane">
                <div className="docker-loading">{t('app.imagesTab.loadingImages', 'Loading images…')}</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-list-pane">
            <GridViewPicker
                views={chrome.views}
                label="images"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder={t('app.imagesTab.filterRepositoryTagOrId', 'Filter repository, tag, or ID…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadImages} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {/* Only the SEARCH can empty the pane outright. A column rule that
                matches nothing keeps the table mounted — the header menu that
                undoes it lives in the header. */}
            {loadError ? (
                <ErrorState
                    error={loadError}
                    onRetry={loadImages}
                />
            ) : filteredImages.length === 0 ? (
                <EmptyState
                    icon={Layers}
                    title={images.length === 0 ? t('app.imagesTab.noImages', 'No images') : t('app.imagesTab.noMatchingImages', 'No matching images')}
                    description={images.length === 0
                        ? t('app.imagesTab.pullAnImageToSeeIt', 'Pull an image to see it here.')
                        : t('app.imagesTab.noImagesMatchTheCurrentSearch', 'No images match the current search.')}
                />
            ) : (
                <section className="dx-resource-list">
                    <DataTable
                        {...chrome.tableProps}
                        columns={chrome.columns}
                        data={filteredImages}
                        keyField={(image) => imageId(image)}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        className="dx-table-wrap sk-dtable-wrap--sticky"
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={images.length}
                                noun="image"
                            />
                        )}
                    />
                </section>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

const PullImageModal = ({ onClose, onPulled }) => {
    const fieldId = useId();
    const { t } = useTranslation();
    const { serverId, isRemote } = useServer();
    const [image, setImage] = useState('');
    const [tag, setTag] = useState('latest');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isRemote) {
                const fullImage = tag ? `${image}:${tag}` : image;
                await api.pullRemoteImage(serverId, fullImage);
            } else {
                await api.pullImage(image, tag);
            }
            onPulled();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to pull image');
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.imagesTab.pullImage', 'Pull image')} size="md">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor={`${fieldId}-image`}>{t('app.imagesTab.imageName', 'Image name *')}</label>
                    <Input
                        id={`${fieldId}-image`}
                        type="text"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder={t('app.imagesTab.nginxMysqlRedis', 'nginx, mysql, redis')}
                        required
                    />
                </div>

                <div className="form-group">
                    <label htmlFor={`${fieldId}-tag`}>{t('app.imagesTab.tag', 'Tag')}</label>
                    <Input
                        id={`${fieldId}-tag`}
                        type="text"
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                        placeholder="latest"
                    />
                </div>

                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={loading}>
                        {loading ? t('app.imagesTab.pulling', 'Pulling…') : t('app.imagesTab.pullImage', 'Pull image')}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default ImagesTab;
