import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
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
} from './dockerHelpers';

export const PullImageButton = () => {
    const { t } = useTranslation();
    const [showModal, setShowModal] = useState(false);
    return (
        <>
            <Button onClick={() => setShowModal(true)}>
                <span>+</span> {t('app.imagesTab.pullImage', 'Pull Image')}
            </Button>
            {showModal && <PullImageModal onClose={() => setShowModal(false)} onPulled={() => window.location.reload()} />}
        </>
    );
};

// The two transports describe the same image differently: `docker images`
// hands back repository/tag as separate strings, the agent hands back
// `repo_tags: ["nginx:latest"]` and nothing else. Every accessor below reads
// both, because a column that silently blanks on remote hosts is worse than no
// column at all.
const imageId = (image) => String(image.id || image.ID || '').replace(/^sha256:/, '');

const imageRef = (image) => {
    if (image.repository || image.tag) {
        return { repository: image.repository || '<none>', tag: image.tag || '<none>' };
    }
    const first = Array.isArray(image.repo_tags) ? image.repo_tags[0] : null;
    if (!first) return { repository: '<none>', tag: '<none>' };
    // A registry port ("registry:5000/app") puts a colon in the REPOSITORY
    // half, so the last colon is only the tag separator when no '/' follows it.
    const colon = first.lastIndexOf(':');
    if (colon > 0 && !first.slice(colon).includes('/')) {
        return { repository: first.slice(0, colon), tag: first.slice(colon + 1) };
    }
    return { repository: first, tag: '<none>' };
};

// Docker's CLI prints sizes in SI units ("142MB" = 142 * 10^6); the agent sends
// a byte count. Parsed to MEGABYTES rather than bytes because this number is
// also what the filter drawer and the chips show — "size is over 500 MB" is a
// question you can ask, "is over 500000000" is not. The cell still renders
// through the app's canonical formatter, so one host's images read the same way
// as another's.
const SIZE_MULTIPLIERS = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

const imageSizeBytes = (image) => {
    const raw = image.size ?? image.Size;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    const match = raw.trim().match(/^([\d.]+)\s*([a-z]+)?$/i);
    if (!match) return null;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return null;
    return amount * (SIZE_MULTIPLIERS[(match[2] || 'b').toLowerCase()] ?? 1);
};

// The number a filter rule compares against MUST be the number the cell shows,
// or "Size is over 400 MB" matches a row whose own cell reads "392.9 MB". The
// cell renders through the app-wide formatBytes, which is base-1024 with MB/GB
// labels, so the rule value is mebibytes too — not docker's base-1000 MB.
const imageSizeMb = (image) => {
    const bytes = imageSizeBytes(image);
    return bytes == null ? null : bytes / (1024 * 1024);
};

const imageCreatedMs = (image) => {
    const raw = image.created ?? image.CreatedAt ?? image.Created;
    // The agent sends epoch SECONDS, the CLI "2026-08-12 09:12:33 -0400 EDT".
    if (typeof raw === 'number') return raw > 1e11 ? raw : raw * 1000;
    const parsed = Date.parse(raw || '');
    return Number.isNaN(parsed) ? null : parsed;
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

    useEffect(() => {
        loadImages();
    }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadImages() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteImages(serverId);
                data = { images: normalizeListResponse(result, 'images') };
            } else {
                data = await api.getImages();
            }
            setImages(data.images || []);
        } catch (err) {
            console.error('Failed to load images:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(image) {
        const confirmed = await confirmImage({ titleKey: 'app.imagesTab.removeImage', title: 'Remove Image', messageKey: 'app.imagesTab.removeThisImage', message: 'Remove this image?' });
        if (!confirmed) return;

        try {
            const id = image.id || image.ID;
            if (isRemote) {
                await api.removeRemoteImage(serverId, id, true);
            } else {
                await api.removeImage(id, true);
            }
            toast.success(t('app.imagesTab.imageRemovedSuccessfully', 'Image removed successfully'));
            loadImages();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove image:', err);
            toast.error(t('app.imagesTab.failedToRemoveImageItMay', 'Failed to remove image. It may be in use by a container.'));
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
                    <span className="dx-muted-line" title={new Date(ms).toLocaleString()}>
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
                        title={t('app.imagesTab.removeImage2', 'Remove image')}
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
            {filteredImages.length === 0 ? (
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
                        className="dx-table-wrap"
                        tableClassName="dx-manager-table dx-plain-table"
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
        <Modal open onClose={onClose} title={t('app.imagesTab.pullImage', 'Pull Image')} size="md">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>{t('app.imagesTab.imageName', 'Image Name *')}</label>
                    <Input
                        type="text"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder={t('app.imagesTab.nginxMysqlRedis', 'nginx, mysql, redis')}
                        required
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.imagesTab.tag', 'Tag')}</label>
                    <Input
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
                        {loading ? 'Pulling...' : 'Pull Image'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default ImagesTab;
