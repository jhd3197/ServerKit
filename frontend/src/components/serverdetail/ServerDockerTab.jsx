import { useCallback, useState, useEffect  } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableFooter, Pill } from '../ds';
import EmptyState from '../EmptyState';
import { Boxes, Container } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    OfflineIcon,
    RefreshIcon,
    StopIcon,
    PlayIcon,
    TrashIcon,
} from './serverDetailShared';
import { toastError } from '@/utils/errorMessage';

// The /servers/<id>/docker/* endpoints return raw arrays from Flask
// (route extracts result.get('data') before jsonify). The agent envelope's
// {success, data} shape is gone by the time it reaches the client, so unwrap
// both forms defensively.
const unwrapList = (response) => {
    if (Array.isArray(response)) return response;
    if (response?.success && Array.isArray(response.data)) return response.data;
    return [];
};

// Docker exposes container ports as an array of {ip, private_port,
// public_port, type} objects. Render a compact "host:container/proto"
// string per binding, or fall back to "container/proto" when the port
// isn't mapped to the host. Older agents may already send a string.
const formatPorts = (ports) => {
    if (!ports) return '-';
    if (typeof ports === 'string') return ports || '-';
    if (!Array.isArray(ports) || ports.length === 0) return '-';
    const parts = ports.map((p) => {
        if (!p || typeof p !== 'object') return String(p);
        const proto = p.type || 'tcp';
        if (p.public_port) {
            const host = p.ip && p.ip !== '0.0.0.0' && p.ip !== '::' ? `${p.ip}:` : '';
            return `${host}${p.public_port}->${p.private_port}/${proto}`;
        }
        return `${p.private_port}/${proto}`;
    });
    return parts.join(', ');
};

// docker prints image sizes as strings ("25.5MB", "1.2GB") — parse to bytes
// so the Size column sorts numerically instead of lexicographically.
const SIZE_UNITS = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 };
const parseDockerSize = (size) => {
    const match = /^([\d.]+)\s*(b|kb|mb|gb|tb)$/i.exec(size || '');
    if (!match) return null;
    return parseFloat(match[1]) * (SIZE_UNITS[match[2].toLowerCase()] || 1);
};

// Images table columns. Cell markup and classNames are identical to the
// hand-rolled table they replace so the .data-table SCSS keeps applying.
const IMAGE_COLUMNS = [
    {
        key: 'repository',
        headerKey: 'app.serverDockerTab.repository', header: 'Repository',
        sortable: true,
        hideable: false,
        sortValue: (image) => image.repository || '<none>',
        render: (image) => image.repository || '<none>',
    },
    {
        key: 'tag',
        headerKey: 'app.serverDockerTab.tag', header: 'Tag',
        sortable: true,
        sortValue: (image) => image.tag || '<none>',
        render: (image) => image.tag || '<none>',
    },
    {
        key: 'id',
        headerKey: 'app.serverDockerTab.imageId', header: 'Image ID',
        cellClassName: 'mono',
        render: (image) => image.id?.substring(0, 12),
    },
    {
        key: 'size',
        headerKey: 'common.labels.size', header: 'Size',
        sortable: true,
        sortValue: (image) => parseDockerSize(image.size),
        render: (image) => image.size,
    },
    {
        key: 'created',
        headerKey: 'common.labels.created', header: 'Created',
        sortable: true,
        sortValue: (image) => image.created || null,
        render: (image) => image.created,
    },
];

const ServerDockerTab = ({ serverId, serverStatus, server }) => {
    const { t } = useTranslation();
    const [containers, setContainers] = useState([]);
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [subTab, setSubTab] = useState('containers');
    const toast = useToast();
    const { confirm: confirmDocker } = useConfirm();

    const loadDockerData = useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
            const [containersRes, imagesRes] = await Promise.all([
                api.getRemoteContainers(serverId, true),
                api.getRemoteImages(serverId)
            ]);

            setContainers(unwrapList(containersRes));
            setImages(unwrapList(imagesRes));
        } catch (err) {
            console.error('Failed to load Docker data:', err);
            setLoadError(err.message || 'Failed to load Docker data');
        } finally {
            setLoading(false);
        }
    }, [serverId]);

    useEffect(() => {
        if (serverStatus === 'online') {
            loadDockerData();
        } else {
            setLoading(false);
        }
    }, [loadDockerData, serverStatus]);


    // If the agent reports docker capability false (Docker daemon not
    // reachable from the agent process — common on Windows when the
    // service hasn't been started, or on hosts where the agent user
    // isn't in the docker group), explain that instead of pretending
    // there are no containers.
    const dockerCapability = server?.capabilities?.docker;
    if (serverStatus === 'online' && server && dockerCapability === false) {
        return (
            <div className="docker-empty-state">
                <EmptyState
                    icon={Container}
                    title={t('app.serverDockerTab.dockerNotReachableFromThisAgent', 'Docker not reachable from this agent')}
                    description={t('app.serverDockerTab.theAgentConnectedButCouldNot', 'The agent connected but could not talk to a Docker daemon. Make sure Docker is running on the host (and the agent user is in the docker group on Linux), then click Refresh on the Overview tab to re-probe capabilities.')}
                />
                <ul className="docker-empty-state__causes">
                    <li>{t('app.serverDockerTab.dockerDesktopDockerdIsNotRunning', 'Docker Desktop / dockerd is not running on the host')}</li>
                    <li>{t('app.serverDockerTab.theAgentUserIsnTIn', 'The agent user isn\'t in the')} <code>docker</code> {t('app.serverDockerTab.groupLinux', 'group (Linux)')}</li>
                    <li>{t('app.serverDockerTab.theNpipeSocket', 'The npipe socket')} <code>{'//./pipe/docker_engine'}</code> {t('app.serverDockerTab.isnTAccessibleWindows', 'isn\'t accessible (Windows)')}</li>
                </ul>
            </div>
        );
    }

    async function handleContainerAction(containerId, action) {
        try {
            if (action === 'start') {
                await api.startRemoteContainer(serverId, containerId);
                toast.success(t('app.serverDockerTab.containerStarted', 'Container started'));
            } else if (action === 'stop') {
                await api.stopRemoteContainer(serverId, containerId);
                toast.success(t('app.serverDockerTab.containerStopped', 'Container stopped'));
            } else if (action === 'restart') {
                await api.restartRemoteContainer(serverId, containerId);
                toast.success(t('app.serverDockerTab.containerRestarted', 'Container restarted'));
            } else if (action === 'remove') {
                const removeConfirmed = await confirmDocker({ titleKey: 'app.serverDockerTab.removeContainer', title: 'Delete container', messageKey: 'app.serverDockerTab.removeThisContainer', message: 'Delete this container?', confirmText: t('common.actions.delete', 'Delete') });
                if (!removeConfirmed) return;
                await api.removeRemoteContainer(serverId, containerId, true);
                toast.success(t('app.serverDockerTab.containerRemoved', 'Container deleted'));
            }
            loadDockerData();
        } catch (err) {
            toastError(toast, t('app.serverDockerTab.failedToContainer', 'Failed to {{action}} container', { action: action }), err);
        }
    }

    if (serverStatus !== 'online') {
        return (
            <div className="offline-notice">
                <OfflineIcon />
                <h4>{t('app.serverDockerTab.serverOffline', 'Server offline')}</h4>
                <p>{t('app.serverDockerTab.dockerManagementRequiresTheServerTo', 'Docker management requires the server to be online.')}</p>
            </div>
        );
    }

    if (loading) {
        return <EmptyState loading title={t('app.serverDockerTab.loadingDockerData', 'Loading Docker data')} />;
    }

    // Containers table columns. Cell markup and classNames are identical to
    // the hand-rolled table they replace so the .data-table SCSS (and the
    // .server-detail-page dense-table overrides) keeps applying.
    const containerColumns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            sortValue: (container) => container.name || '',
            render: (container) => (
                <>
                    <span className="container-name">{container.name}</span>
                    <span className="container-id">{container.id?.substring(0, 12)}</span>
                </>
            ),
        },
        {
            key: 'image',
            headerKey: 'app.serverDockerTab.image', header: 'Image',
            sortable: true,
            sortValue: (container) => container.image || '',
            render: (container) => container.image,
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            sortValue: (container) => container.state || '',
            render: (container) => {
                const isRunning = container.state === 'running';
                return (
                    <Pill kind={isRunning ? 'green' : container.state === 'paused' || container.state === 'restarting' ? 'amber' : 'gray'}>
                        {container.state}
                    </Pill>
                );
            },
        },
        {
            key: 'ports',
            headerKey: 'app.serverDockerTab.ports', header: 'Ports',
            sortable: true,
            sortValue: (container) => {
                const text = formatPorts(container.ports);
                return text === '-' ? null : text;
            },
            render: (container) => formatPorts(container.ports),
        },
        {
            key: 'actions',
            headerKey: 'common.labels.actions', header: 'Actions',
            sortable: false,
            hideable: false,
            cellClassName: 'actions-cell',
            render: (container) => {
                const isRunning = container.state === 'running';
                return isRunning ? (
                    <>
                        <Button variant="unstyled" type="button"
                            className="btn-icon"
                            onClick={() => handleContainerAction(container.id, 'restart')}
                            title={t('common.actions.restart', 'Restart')}
                        >
                            <RefreshIcon />
                        </Button>
                        <Button variant="unstyled" type="button"
                            className="btn-icon danger"
                            onClick={() => handleContainerAction(container.id, 'stop')}
                            title={t('common.actions.stop', 'Stop')}
                        >
                            <StopIcon />
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="unstyled" type="button"
                            className="btn-icon success"
                            onClick={() => handleContainerAction(container.id, 'start')}
                            title={t('common.actions.start', 'Start')}
                        >
                            <PlayIcon />
                        </Button>
                        <Button variant="unstyled" type="button"
                            className="btn-icon danger"
                            onClick={() => handleContainerAction(container.id, 'remove')}
                            title={t('common.actions.delete', 'Delete')}
                        >
                            <TrashIcon />
                        </Button>
                    </>
                );
            },
        },
    ];

    return (
        <div className="docker-tab">
            {loadError && (
                <div className="docker-tab__error">
                    <strong>{t('app.serverDockerTab.couldnTLoadDockerData', 'Couldn\'t load Docker data:')}</strong> {loadError}
                    <Button size="sm" variant="outline" onClick={loadDockerData}>{t('common.actions.retry', 'Retry')}</Button>
                </div>
            )}
            <div className="docker-sub-tabs">
                <Button variant="unstyled" type="button"
                    className={`sub-tab ${subTab === 'containers' ? 'active' : ''}`}
                    onClick={() => setSubTab('containers')}
                >
                    {t('app.serverDockerTab.containers', 'Containers (')}{containers.length})
                </Button>
                <Button variant="unstyled" type="button"
                    className={`sub-tab ${subTab === 'images' ? 'active' : ''}`}
                    onClick={() => setSubTab('images')}
                >
                    {t('app.serverDockerTab.images', 'Images (')}{images.length})
                </Button>
            </div>

            {subTab === 'containers' && (
                <div className="containers-list">
                    {containers.length === 0 ? (
                        <EmptyState icon={Container} title={t('app.serverDockerTab.noContainers', 'No containers')} description={t('app.serverDockerTab.noContainersAreRunningOnThis', 'No containers are running on this server.')} />
                    ) : (
                        <DataTable
                            columns={containerColumns}
                            data={containers}
                            keyField="id"
                            storageKey="serverkit-table-sd-docker-containers"
                            tableClassName="data-table"
                            footer={(
                                <DataTableFooter
                                    shown={containers.length}
                                    total={containers.length}
                                    noun="container"
                                />
                            )}
                        />
                    )}
                </div>
            )}

            {subTab === 'images' && (
                <div className="images-list">
                    {images.length === 0 ? (
                        <EmptyState icon={Boxes} title={t('app.serverDockerTab.noImages', 'No images')} description={t('app.serverDockerTab.noDockerImagesArePresentOn', 'No Docker images are present on this server.')} />
                    ) : (
                        <DataTable
                            columns={IMAGE_COLUMNS}
                            data={images}
                            keyField="id"
                            storageKey="serverkit-table-sd-docker-images"
                            tableClassName="data-table"
                            footer={(
                                <DataTableFooter
                                    shown={images.length}
                                    total={images.length}
                                    noun="image"
                                />
                            )}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default ServerDockerTab;
