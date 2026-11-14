import {
    FolderPlus,
    X,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    HardDrive,
    Clock,
    Zap,
    FolderTree as FolderTreeIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import FolderTree from './FolderTree';

import ServerPicker from '@/components/ServerPicker';
import { serverTarget, targetServerId } from '@/utils/serverTarget';

import { TREE_ROOTS } from './fileTypes';

import { useTranslation } from 'react-i18next';

import { formatTime } from '@/utils/intl';
function mountDisplayName(mount) {
    if (!mount?.mountpoint || mount.mountpoint === '/') return null;
    const parts = mount.mountpoint.split('/').filter(Boolean);
    const leaf = parts[parts.length - 1] || mount.mountpoint;
    return leaf === 'docker-desktop-user-distro' ? 'docker-desktop' : leaf;
}


export default function FileManagerSidebar({
    sidebarVisible,
    setSidebarVisible,
    target,
    setTarget,
    s3Options,
    isS3,
    isRemote,
    loadDiskMounts,
    diskLoading,
    diskMounts,
    activeMount,
    navigateTo,
    diskLastUpdated,
    quickAccess,
    currentPath,
    setTreeCollapsed,
    treeCollapsed,
    setDialog,
    treeExpanded,
    treeCache,
    treeLoading,
    toggleTreeExpand,
}) {
    const getDiskColor = (percent) => {
        if (percent >= 90) return 'critical';
        if (percent >= 70) return 'warning';
        return 'healthy';
    };

    const { t } = useTranslation();
    return (
        <>
            {sidebarVisible && (
                <aside className="file-manager-sidebar left">
                    <div className="file-manager-source">
                        <Button
                            variant="unstyled"
                            type="button"
                            className="file-manager-source__close"
                            onClick={() => setSidebarVisible(false)}
                            aria-label={t('app.fileManager.hideSidebar', 'Hide sidebar')}
                        >
                            <X size={14} />
                        </Button>
                        <ServerPicker
                            capability="files"
                            value={targetServerId(target)}
                            onChange={(id, server) =>
                                setTarget(serverTarget(id, server || (id === 's3' ? null : {})))
                            }
                            extraOptions={s3Options}
                            className="file-manager-source__picker"
                        />
                        <div className="file-manager-source__meta">
                            <span
                                className={`file-manager-source__dot${isS3 ? ' is-cloud' : ''}`}
                                aria-hidden="true"
                            />
                            <span>
                                {isRemote
                                    ? t('app.fileManager.remoteAgent', 'Remote agent')
                                    : isS3
                                      ? t('app.fileManager.objectStorage', 'Object storage')
                                      : t('app.fileManager.localPanelHost', 'Panel server')}
                            </span>
                        </div>
                    </div>

                    {!isRemote && !isS3 && (
                        <div className="sidebar-section sidebar-section--volumes">
                            <div className="sidebar-section-header sidebar-section-header--split">
                                <span
                                    className="sidebar-section-title"
                                    title={t('app.fileManager.diskUsage', 'Disk usage')}
                                >
                                    <HardDrive size={13} />
                                    <span>{t('app.fileManager.volumes', 'Volumes')}</span>
                                </span>
                                <Button
                                    variant="unstyled"
                                    type="button"
                                    className="sidebar-action-btn"
                                    onClick={loadDiskMounts}
                                    disabled={diskLoading}
                                    title={t('common.actions.refresh', 'Refresh')}
                                    aria-label={t('common.actions.refresh', 'Refresh')}
                                >
                                    <RefreshCw size={12} className={diskLoading ? 'spinning' : ''} />
                                </Button>
                            </div>
                            <div className="sidebar-section-content disk-mount-list">
                                {diskMounts.map((mount) => (
                                    <Button
                                        variant="unstyled"
                                        type="button"
                                        key={`${mount.device}:${mount.mountpoint}`}
                                        className={`disk-mount-item${activeMount?.mountpoint === mount.mountpoint ? ' active' : ''}`}
                                        onClick={() => navigateTo(mount.mountpoint)}
                                        title={`${mount.device} · ${mount.used_human} / ${mount.total_human}`}
                                    >
                                        <div className="disk-mount-header">
                                            <span className="disk-mount-point">
                                                {mount.mountpoint === '/'
                                                    ? t('app.fileManager.rootDisk', 'Root disk')
                                                    : mountDisplayName(mount)}
                                            </span>
                                            <span className={`disk-percent ${getDiskColor(mount.percent)}`}>
                                                {mount.percent}%
                                            </span>
                                        </div>
                                        <div className={`disk-progress ${getDiskColor(mount.percent)}`}>
                                            <span
                                                className="disk-progress-fill"
                                                style={{ width: `${mount.percent}%` }}
                                            />
                                        </div>
                                    </Button>
                                ))}
                                {diskLastUpdated && (
                                    <span className="disk-updated disk-updated--footer">
                                        <Clock size={11} />
                                        {t('app.fileManager.updatedAt', 'Updated {{time}}', {
                                            time: formatTime(diskLastUpdated, { seconds: true }),
                                        })}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {!isS3 && (
                        <>
                            <div className="sidebar-section">
                                <div className="sidebar-section-header static">
                                    <Zap size={16} />
                                    <span>{t('app.fileManager.quickAccess', 'Quick access')}</span>
                                </div>
                                <div className="sidebar-section-content quick-access-list">
                                    {quickAccess.map((q) => (
                                        <Button
                                            variant="unstyled"
                                            type="button"
                                            key={q.label}
                                            className={`quick-access-item ${currentPath === q.path ? 'active' : ''}`}
                                            onClick={() => navigateTo(q.path)}
                                        >
                                            <q.icon size={14} />
                                            <span>{q.label}</span>
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            <div className="sidebar-section">
                                <div className="sidebar-section-header sidebar-section-header--split">
                                    <Button
                                        variant="unstyled"
                                        type="button"
                                        className="sidebar-section-toggle"
                                        onClick={() => setTreeCollapsed(!treeCollapsed)}
                                        title={t('app.fileManager.folders', 'Folders')}
                                    >
                                        <FolderTreeIcon size={16} />
                                        <span>{t('app.fileManager.fileSystem', 'File system')}</span>
                                        {treeCollapsed ? (
                                            <ChevronRight size={16} />
                                        ) : (
                                            <ChevronDown size={16} />
                                        )}
                                    </Button>
                                    <Button
                                        variant="unstyled"
                                        type="button"
                                        className="sidebar-action-btn"
                                        onClick={() => setDialog({ kind: 'newFolder' })}
                                        disabled={isRemote}
                                        title={t('app.fileManager.newFolder', 'New folder')}
                                    >
                                        <FolderPlus size={14} />
                                    </Button>
                                </div>
                                {!treeCollapsed && (
                                    <div className="sidebar-section-content tree-content">
                                        <FolderTree
                                            roots={TREE_ROOTS}
                                            expanded={treeExpanded}
                                            treeCache={treeCache}
                                            treeLoading={treeLoading}
                                            currentPath={currentPath}
                                            onNavigate={navigateTo}
                                            onToggle={toggleTreeExpand}
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </aside>
            )}
        </>
    );
}
