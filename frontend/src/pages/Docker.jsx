import { useState, useEffect } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import EmptyState from '../components/EmptyState';
import { Button } from '@/components/ui/button';
import ServerPicker from '../components/ServerPicker';
import PageLayout from '@/layouts/PageLayout';
import { Box, Boxes, ChevronDown, Download, Power, RefreshCw, UserCheck, Layers, HardDrive, Network as NetworkIcon, Package } from 'lucide-react';
import {
    ServerContext,
    VALID_TABS,
    LOCAL_DOCKER_TARGET,
} from '../components/docker/dockerHelpers';
import ContainersTab from '../components/docker/ContainersTab';
import ComposeTab from '../components/docker/ComposeTab';
import ImagesTab from '../components/docker/ImagesTab';
import NetworksTab from '../components/docker/NetworksTab';
import VolumesTab from '../components/docker/VolumesTab';
import PruneButton from '../components/docker/PruneButton';
import RequiresDocker from '../components/RequiresDocker';
import { useTranslation } from 'react-i18next';

const Docker = () => {
    const { t } = useTranslation();
    const [activeTab] = useTabParam('/docker', VALID_TABS);
    const [dockerStatus, setDockerStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);
    const [selectedServer, setSelectedServer] = useState(LOCAL_DOCKER_TARGET);
    const [availableServers, setAvailableServers] = useState([LOCAL_DOCKER_TARGET]);
    useEffect(() => {
        checkDockerStatus();
    }, [selectedServer]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false;

        async function loadAvailableServers() {
            try {
                const data = await api.getAvailableServers();
                const servers = Array.isArray(data) && data.length > 0 ? data : [LOCAL_DOCKER_TARGET];
                if (cancelled) return;
                setAvailableServers(servers);
                setSelectedServer(prev => (
                    servers.some(server => server.id === prev.id)
                        ? prev
                        : (servers[0] || LOCAL_DOCKER_TARGET)
                ));
            } catch {
                if (cancelled) return;
                setAvailableServers([LOCAL_DOCKER_TARGET]);
                setSelectedServer(LOCAL_DOCKER_TARGET);
            }
        }

        loadAvailableServers();
        return () => { cancelled = true; };
    }, []);

    async function checkDockerStatus(silent = false) {
        if (!silent) setLoading(true);
        try {
            if (selectedServer.id === 'local') {
                const status = await api.getDockerStatus();
                setDockerStatus(status);
                if (status.installed) {
                    setLoading(false);
                } else {
                    setLoading(false);
                }
            } else {
                // For remote servers, check if the agent is online
                const serverData = await api.getServer(selectedServer.id);
                if (serverData.status === 'online' || serverData.server?.status === 'online') {
                    setDockerStatus({ installed: true, running: true });
                    setLoading(false);
                } else {
                    setDockerStatus({ installed: false, error: 'Server agent is offline' });
                    setLoading(false);
                }
            }
        } catch (err) {
            setDockerStatus({ installed: false, error: err.message });
            setLoading(false);
        }
    }

    async function retry() {
        setRetrying(true);
        await checkDockerStatus(true);
        setRetrying(false);
    }

    const tabs = [
        { id: 'containers', label: t('app.docker.containers', 'Containers'), icon: Box },
        { id: 'compose', label: t('app.docker.compose', 'Compose'), icon: Package },
        { id: 'images', label: t('app.docker.images', 'Images'), icon: Layers },
        { id: 'volumes', label: t('app.docker.volumes', 'Volumes'), icon: HardDrive },
        { id: 'networks', label: t('app.docker.networks', 'Networks'), icon: NetworkIcon },
    ].map(({ id, label, icon: Icon }) => ({ to: `/docker/${id}`, label, icon: <Icon size={15} /> }));

    if (loading) {
        return (
            <PageLayout className="docker-page" navLabel={t('common.labels.docker', 'Docker')} tabs={tabs}>
                <EmptyState loading loadingVariant="table" title={t('app.docker.checkingDockerStatus', 'Checking Docker status…')} />
            </PageLayout>
        );
    }

    if (!dockerStatus?.installed) {
        return (
            <PageLayout className="docker-page" icon={<Box size={18} />} title={t('common.labels.docker', 'Docker')}>
                <div className="docker-unavailable">
                    <div className="docker-unavailable-icon">
                        <Boxes size={32} />
                    </div>
                    <h2>{t('app.docker.dockerNotAvailable', 'Docker not available')}</h2>
                    <p className="docker-unavailable-message">
                        {t('app.docker.dockerIsNotInstalledOrNot', 'Docker is not installed or not running on this system.')}
                    </p>
                    <ul className="docker-unavailable-steps">
                        <li title={t('app.docker.ensureDockerDesktopIsInstalledAnd', 'Ensure Docker Desktop is installed and running')}>
                            <Download size={18} />
                            <span>{t('app.docker.installDocker', 'Install Docker')}</span>
                        </li>
                        <li title={t('app.docker.onLinuxMakeSureTheDocker', 'On Linux, make sure the Docker daemon is started')}>
                            <Power size={18} />
                            <span>{t('app.docker.startTheDaemon', 'Start the daemon')}</span>
                        </li>
                        <li title={t('app.docker.verifyTheUserHasPermissionsTo', 'Verify the user has permissions to access Docker')}>
                            <UserCheck size={18} />
                            <span>{t('app.docker.grantAccess', 'Grant access')}</span>
                        </li>
                    </ul>
                    <details className="docker-unavailable-disclosure">
                        <summary>
                            {t('app.docker.details', 'Details')}
                            <ChevronDown size={14} />
                        </summary>
                        <code>{dockerStatus?.error || t('app.docker.couldntConnectToDaemon', "Couldn't connect to the Docker daemon.")}</code>
                        <ul>
                            <li>{t('app.docker.ensureDockerDesktopIsInstalledAnd', 'Ensure Docker Desktop is installed and running')}</li>
                            <li>{t('app.docker.onLinuxMakeSureTheDocker', 'On Linux, make sure the Docker daemon is started')}</li>
                            <li>{t('app.docker.verifyTheUserHasPermissionsTo', 'Verify the user has permissions to access Docker')}</li>
                        </ul>
                    </details>
                    <Button onClick={retry} disabled={retrying}>
                        <RefreshCw size={16} className={retrying ? 'docker-unavailable-spin' : undefined} />
                        {t('app.docker.retryConnection', 'Retry connection')}
                    </Button>
                </div>
            </PageLayout>
        );
    }

    const hasMultipleTargets = availableServers.length > 1;

    const serverContextValue = {
        serverId: selectedServer.id,
        serverName: selectedServer.name,
        isRemote: selectedServer.id !== 'local'
    };

    return (
        <RequiresDocker what="Container management">
        <ServerContext.Provider value={serverContextValue}>
        <PageLayout
            className="docker-page"
            contentClassName="dx-page"
            fill
            // No title: like every tab group, the tab strip is the heading and
            // the sidebar already names the section.
            navLabel={t('common.labels.docker', 'Docker')}
            tabs={tabs}
            actions={(
                <>
                    {hasMultipleTargets && (
                        <ServerPicker
                            value={String(selectedServer.id)}
                            capability="docker"
                            label={t('app.docker.targets', 'Targets')}
                            onChange={(id, server) => setSelectedServer(
                                server
                                || availableServers.find(row => String(row.id) === String(id))
                                || LOCAL_DOCKER_TARGET
                            )}
                        />
                    )}
                    {/* Page-wide. Each tab publishes its own create button and
                        search after these (useListTopbar). */}
                    <PruneButton />
                </>
            )}
        >
            <div className="dx-panel">
                {activeTab === 'containers' && <ContainersTab />}
                {activeTab === 'compose' && <ComposeTab />}
                {activeTab === 'images' && <ImagesTab />}
                {activeTab === 'networks' && <NetworksTab />}
                {activeTab === 'volumes' && <VolumesTab />}
            </div>
        </PageLayout>
        </ServerContext.Provider>
        </RequiresDocker>
    );
};

export default Docker;
