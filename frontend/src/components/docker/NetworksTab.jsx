import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import EmptyState from '../EmptyState';
import Modal from '@/components/Modal';
import { DataTable, DataTableFooter, Pill, SearchField, SegControl } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Network as NetworkIcon, Trash2, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    useServer,
    normalizeListResponse,
    shortId,
} from './dockerHelpers';

export const CreateNetworkButton = () => {
    const { t } = useTranslation();
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? t('app.networksTab.creatingNetworksIsOnlyAvailableOn', 'Creating networks is only available on the local Docker target right now') : t('app.networksTab.createNetwork', 'Create network')}
            >
                <span>+</span> {t('app.networksTab.createNetwork2', 'Create Network')}
            </Button>
            {showModal && <CreateNetworkModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

const networkName = (network) => network.name || network.Name || '';
const networkId = (network) => network.id || network.ID || '';

// bridge/host/none ship with the daemon and cannot be removed. That was already
// encoded here as a hidden delete button; promoting it to a column is what
// turns "why can't I delete this one" into something the table says out loud —
// and gives the view below a rule to stand on.
const BUILTIN_NETWORKS = ['bridge', 'host', 'none'];
const networkKind = (network) => (
    BUILTIN_NETWORKS.includes(networkName(network)) ? 'Built-in' : 'User-defined'
);

const NO_RULES = { match: 'all', rules: [] };
const PAGE_CLEAR = { search: '' };

const NETWORK_VIEWS = [
    {
        // Everything someone on this host created — the only rows with an
        // action, and the ones a stale compose project leaves behind.
        name: 'User-defined',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'dn1', field: 'kind', op: 'any', value: ['User-defined'] }],
            },
            page: PAGE_CLEAR,
        },
    },
    {
        // No rules, bucketed by driver: bridge networks are per-host, overlay
        // ones span the swarm, and mixing them in one list hides that.
        name: 'By driver',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: 'driver',
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
    {
        // The way back out of either of the above.
        name: 'All networks',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: NO_RULES,
            page: PAGE_CLEAR,
        },
    },
];

// Networks Tab
const NetworksTab = ({ onStatsChange }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmNetwork } = useConfirm();
    const [networks, setNetworks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'name', direction: 'asc' }],
        storageKey: 'serverkit-table-docker-networks-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-docker-networks-cols',
    });
    const [groupBy, setGroupBy] = useState(null);

    useEffect(() => {
        loadNetworks();
    }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadNetworks() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteNetworks(serverId);
                data = { networks: normalizeListResponse(result, 'networks') };
            } else {
                data = await api.getNetworks();
            }
            setNetworks(data.networks || []);
        } catch (err) {
            console.error('Failed to load networks:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleRemove(network) {
        const confirmed = await confirmNetwork({ titleKey: 'app.networksTab.removeNetwork', title: 'Remove Network', messageKey: 'app.networksTab.removeThisNetwork', message: 'Remove this network?' });
        if (!confirmed) return;

        try {
            if (isRemote) {
                await api.removeRemoteNetwork(serverId, networkId(network));
            } else {
                await api.removeNetwork(networkId(network));
            }
            toast.success(t('app.networksTab.networkRemovedSuccessfully', 'Network removed successfully'));
            loadNetworks();
            onStatsChange?.();
        } catch (err) {
            console.error('Failed to remove network:', err);
            toast.error(t('app.networksTab.failedToRemoveNetworkItMay', 'Failed to remove network. It may be in use.'));
        }
    }

    const filteredNetworks = useMemo(() => {
        const search = searchTerm.toLowerCase();
        if (!search) return networks;
        return networks.filter((network) => (
            networkName(network).toLowerCase().includes(search) ||
            networkId(network).toLowerCase().includes(search)
        ));
    }, [networks, searchTerm]);

    // Every derived column carries BOTH `value` (rules, grouping, export) and
    // `render` (the cell). One without the other renders blank.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: networkName,
            sortValue: networkName,
            render: (network) => (
                <div className="dx-name-stack">
                    <span className="dx-name-line">
                        <span title={networkName(network)}>{networkName(network)}</span>
                    </span>
                    <span className="dx-muted-line mono">{shortId(networkId(network))}</span>
                </div>
            ),
        },
        {
            key: 'kind',
            headerKey: 'common.labels.kind', header: 'Kind',
            sortable: true,
            // Declared: three built-ins plus one custom network is a two-value
            // column that infers as text, which would turn the view above into a
            // typed fragment rather than a pick-list.
            type: 'enum',
            enumOrder: ['User-defined', 'Built-in'],
            width: 130,
            value: networkKind,
            sortValue: networkKind,
            render: (network) => (
                <Pill kind={networkKind(network) === 'Built-in' ? 'gray' : 'cyan'} dot={false}>
                    {networkKind(network)}
                </Pill>
            ),
        },
        {
            key: 'driver',
            headerKey: 'app.networksTab.driver', header: 'Driver',
            sortable: true,
            type: 'enum',
            groupable: true,
            width: 130,
            value: (network) => network.driver || network.Driver || '-',
            groupValue: (network) => network.driver || network.Driver || '-',
            sortValue: (network) => network.driver || network.Driver || '-',
            render: (network) => (
                <span className="dx-code-pill">{network.driver || network.Driver || '-'}</span>
            ),
        },
        {
            key: 'scope',
            headerKey: 'app.networksTab.scope', header: 'Scope',
            sortable: true,
            type: 'enum',
            width: 110,
            value: (network) => network.scope || network.Scope || '-',
            sortValue: (network) => network.scope || network.Scope || '-',
            render: (network) => (
                <span className="dx-muted-line">{network.scope || network.Scope || '-'}</span>
            ),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 110,
            className: 'text-right',
            render: (network) => (
                <div className="dx-row-actions">
                    {networkKind(network) === 'Built-in' ? (
                        <span className="dx-row-protected" title={t('app.networksTab.shipsWithTheDockerDaemonIt', 'Ships with the Docker daemon — it cannot be removed')}>
                            <Lock size={11} /> {t('common.labels.system', 'System')}
                        </span>
                    ) : (
                        <Button variant="unstyled"
                            type="button"
                            className="dx-row-action is-danger"
                            onClick={() => handleRemove(network)}
                            title={t('app.networksTab.removeNetwork2', 'Remove network')}
                        >
                            <Trash2 size={13} />
                        </Button>
                    )}
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
    // names: unscoped, the networks view would arrive as the images view.
    const chrome = useTableChrome({
        columns,
        rows: filteredNetworks,
        viewPageKey: 'docker-networks',
        urlScope: 'networks',
        builtinViews: NETWORK_VIEWS,
        noun: 'networks',
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
                <div className="docker-loading">{t('app.networksTab.loadingNetworks', 'Loading networks…')}</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-list-pane">
            <GridViewPicker
                views={chrome.views}
                label="networks"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <SearchField
                            value={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder={t('app.networksTab.filterNameOrId', 'Filter name or ID…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadNetworks} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {filteredNetworks.length === 0 ? (
                <EmptyState
                    icon={NetworkIcon}
                    title={networks.length === 0 ? t('app.networksTab.noNetworks', 'No networks') : t('app.networksTab.noMatchingNetworks', 'No matching networks')}
                    description={networks.length === 0
                        ? t('app.networksTab.createANetworkToConnectContainers', 'Create a network to connect containers.')
                        : t('app.networksTab.noNetworksMatchTheCurrentSearch', 'No networks match the current search.')}
                />
            ) : (
                <section className="dx-resource-list">
                    <DataTable
                        {...chrome.tableProps}
                        columns={chrome.columns}
                        data={filteredNetworks}
                        keyField={(network) => networkId(network) || networkName(network)}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        className="dx-table-wrap"
                        tableClassName="dx-manager-table dx-plain-table"
                        footer={(
                            <DataTableFooter
                                shown={chrome.shownCount}
                                total={networks.length}
                                noun="network"
                            />
                        )}
                    />
                </section>
            )}

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

const CreateNetworkModal = ({ onClose, onCreated }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [driver, setDriver] = useState('bridge');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await api.createNetwork(name, driver);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create network');
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.networksTab.createNetwork2', 'Create Network')} size="md">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>{t('app.networksTab.networkName', 'Network Name *')}</label>
                    <Input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="my-network"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.networksTab.driver', 'Driver')}</label>
                    <SegControl
                        aria-label={t('app.networksTab.driver', 'Driver')}
                        value={driver}
                        onChange={setDriver}
                        options={['bridge', 'overlay', 'macvlan']}
                    />
                </div>

                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Network'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

export default NetworksTab;
