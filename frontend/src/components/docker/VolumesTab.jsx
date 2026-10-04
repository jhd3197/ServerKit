import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
import Modal from '@/components/Modal';
import { DataTable, DataTableFooter, Pill, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HardDrive, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    useServer,
    normalizeListResponse,
} from './dockerHelpers';

export const CreateVolumeButton = () => {
    const { t } = useTranslation();
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? t('app.volumesTab.creatingVolumesIsOnlyAvailableOn', 'Creating volumes is only available on the panel server right now') : t('app.volumesTab.createVolume', 'Create volume')}
            >
                <span>+</span> {t('app.volumesTab.createVolume2', 'Create volume')}
            </Button>
            {showModal && <CreateVolumeModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const volumeName = (volume) => volume.name || volume.Name || '';

// Docker names an implicitly-created volume with a 64-character hex digest;
// anything else was named by a human or a compose file. That split is the only
// stable axis this payload actually carries, and it is the useful one: a wall
// of hex is what a rebuilt stack leaves behind.
//
// There is deliberately no "Unused" view. `docker volume ls` reports no
// reference count and neither does the agent (name · driver · mountpoint, plus
// scope/created_at remotely), so a view by that name would be guessing.
const ANONYMOUS_NAME = /^[0-9a-f]{64}$/;
const volumeKind = (volume) => (ANONYMOUS_NAME.test(volumeName(volume)) ? 'Anonymous' : 'Named');

const NO_RULES = { match: 'all', rules: [] };
const PAGE_CLEAR = { search: '' };

const VOLUME_VIEWS = [
    {
        // The cleanup worklist: volumes nobody chose a name for, which is
        // usually nobody remembering what is in them either.
        name: 'Anonymous',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'dv1', field: 'kind', op: 'any', value: ['Anonymous'] }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // The other half — the ones a compose file or an operator declared, and
        // the ones you have to be careful with.
        name: 'Named',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'dv2', field: 'kind', op: 'any', value: ['Named'] }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // No rules: everything, bucketed by storage driver. On most hosts that
        // is one group — which is itself the answer when it is not.
        name: 'By driver',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: 'driver',
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
];

// Volumes Tab
const VolumesTab = ({ onStatsChange }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmVolume } = useConfirm();
    const [volumes, setVolumes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'name', direction: 'asc' }],
        storageKey: 'serverkit-table-docker-volumes-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-docker-volumes-cols',
    });
    const [groupBy, setGroupBy] = useState(null);

    useEffect(() => {
        loadVolumes();
    }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadVolumes() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteVolumes(serverId);
                data = { volumes: normalizeListResponse(result, 'volumes') };
            } else {
                data = await api.getVolumes();
            }
            setVolumes(data.volumes || []);
        } catch (err) {
            console.error('Failed to load volumes:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(volume) {
        const confirmed = await confirmVolume({ titleKey: 'app.volumesTab.removeVolume', title: 'Delete volume', messageKey: 'app.volumesTab.removeThisVolumeAllDataWill', message: 'Delete this volume? All data will be lost.', confirmText: t('common.actions.delete', 'Delete') });
        if (!confirmed) return;

        try {
            if (isRemote) {
                await api.removeRemoteVolume(serverId, volumeName(volume), true);
            } else {
                await api.removeVolume(volumeName(volume), true);
            }
            toast.success(t('app.volumesTab.volumeRemovedSuccessfully', 'Volume deleted'));
            loadVolumes();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove volume:', err);
            toast.error(t('app.volumesTab.failedToRemoveVolumeItMay', 'Failed to delete volume. It may be in use.'));
        }
    }

    const filteredVolumes = useMemo(() => {
        const search = searchTerm.toLowerCase();
        if (!search) return volumes;
        return volumes.filter((volume) => (
            volumeName(volume).toLowerCase().includes(search) ||
            String(volume.mountpoint || volume.Mountpoint || '').toLowerCase().includes(search)
        ));
    }, [volumes, searchTerm]);

    // Every derived column carries BOTH `value` (rules, grouping, export) and
    // `render` (the cell). One without the other renders blank.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: volumeName,
            sortValue: volumeName,
            render: (volume) => (
                <span className="dx-name-line" title={volumeName(volume)}>
                    <span>{volumeName(volume)}</span>
                </span>
            ),
        },
        {
            key: 'kind',
            headerKey: 'common.labels.kind', header: 'Kind',
            sortable: true,
            // Declared: a host with only named volumes has a single distinct
            // value, which infers as text and turns the view above into a
            // typed-fragment match instead of a pick-list.
            type: 'enum',
            enumOrder: ['Anonymous', 'Named'],
            width: 110,
            value: volumeKind,
            sortValue: volumeKind,
            render: (volume) => (
                <Pill kind={volumeKind(volume) === 'Anonymous' ? 'amber' : 'gray'} dot={false}>
                    {volumeKind(volume)}
                </Pill>
            ),
        },
        {
            key: 'driver',
            headerKey: 'app.volumesTab.driver', header: 'Driver',
            sortable: true,
            type: 'enum',
            groupable: true,
            width: 120,
            value: (volume) => volume.driver || volume.Driver || '-',
            groupValue: (volume) => volume.driver || volume.Driver || '-',
            sortValue: (volume) => volume.driver || volume.Driver || '-',
            render: (volume) => (
                <span className="dx-muted-line">{volume.driver || volume.Driver || '-'}</span>
            ),
        },
        {
            key: 'mountpoint',
            headerKey: 'app.volumesTab.mountpoint', header: 'Mountpoint',
            sortable: true,
            type: 'text',
            value: (volume) => volume.mountpoint || volume.Mountpoint || '',
            sortValue: (volume) => volume.mountpoint || volume.Mountpoint || '',
            render: (volume) => (
                <span className="dx-muted-line mono" title={volume.mountpoint || volume.Mountpoint || ''}>
                    {volume.mountpoint || volume.Mountpoint || '-'}
                </span>
            ),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 72,
            className: 'text-right',
            render: (volume) => (
                <div className="dx-row-actions">
                    <Button variant="unstyled"
                        type="button"
                        className="dx-row-action is-danger"
                        onClick={() => handleRemove(volume)}
                        title={t('app.volumesTab.removeVolume2', 'Delete volume')}
                    >
                        <Trash2 size={13} />
                    </Button>
                </div>
            ),
        },
    ];

    const viewPageState = useMemo(() => ({ search: searchTerm }), [searchTerm]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.search !== undefined) setSearchTerm(saved.search);
    }, []);

    // Chrome INLINE in the picker's `actions` — the Docker page owns the top bar
    // above this panel. `urlScope` because that one route renders five of these
    // tables, and the link params (`view`, `sort`, `hide`, `f`…) are global
    // names: unscoped, the volumes sort would arrive as the images sort.
    const chrome = useTableChrome({
        columns,
        rows: filteredVolumes,
        viewPageKey: 'docker-volumes',
        urlScope: 'volumes',
        builtinViews: VOLUME_VIEWS,
        noun: 'volumes',
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
                <div className="docker-loading">{t('app.volumesTab.loadingVolumes', 'Loading volumes…')}</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-list-pane">
            <GridViewPicker
                views={chrome.views}
                label="volumes"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder={t('app.volumesTab.filterNameOrMountpoint', 'Filter name or mountpoint…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadVolumes} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {filteredVolumes.length === 0 ? (
                <EmptyState
                    icon={HardDrive}
                    title={volumes.length === 0 ? t('app.volumesTab.noVolumes', 'No volumes') : t('app.volumesTab.noMatchingVolumes', 'No matching volumes')}
                    description={volumes.length === 0
                        ? t('app.volumesTab.createAVolumeForPersistentData', 'Create a volume for persistent data storage.')
                        : t('app.volumesTab.noVolumesMatchTheCurrentSearch', 'No volumes match the current search.')}
                />
            ) : (
                <section className="dx-resource-list">
                    <DataTable
                        {...chrome.tableProps}
                        columns={chrome.columns}
                        data={filteredVolumes}
                        keyField={(volume) => volumeName(volume)}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        className="dx-table-wrap"
                        tableClassName="dx-manager-table dx-plain-table"
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={volumes.length}
                                noun="volume"
                            />
                        )}
                    />
                </section>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

const CreateVolumeModal = ({ onClose, onCreated }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createVolume(name);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create volume');
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.volumesTab.createVolume2', 'Create volume')} size="md">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>{t('app.volumesTab.volumeName', 'Volume name *')}</label>
                    <Input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="my-volume"
                        required
                    />
                </div>

                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Volume'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default VolumesTab;
