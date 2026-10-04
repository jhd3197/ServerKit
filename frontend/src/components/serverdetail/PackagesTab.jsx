import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ListToolbar } from '../ds';
import JobProgressModal from '../JobProgressModal';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Quick-install presets — packages most users want first when setting
// up a new server. The agent's manager-detect handles distro mapping;
// for the few packages whose names actually differ across distros
// (docker.io vs docker-ce, php-fpm versioning) we keep the most common
// Debian/Ubuntu name and let the user override via the search field.
const QUICK_PRESETS = [
    { name: 'nginx', label: 'nginx' },
    { name: 'redis-server', label: 'redis' },
    { name: 'mariadb-server', label: 'mariadb' },
    { name: 'postgresql', label: 'postgresql' },
    { name: 'docker.io', label: 'docker' },
    { name: 'fail2ban', label: 'fail2ban' },
    { name: 'certbot', label: 'certbot' },
    { name: 'htop', label: 'htop' },
];

const PackagesTab = ({ serverId, serverStatus }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    const [installedRaw, setInstalledRaw] = useState('');
    const [manager, setManager] = useState('');
    const [loadingInstalled, setLoadingInstalled] = useState(true);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [searching, setSearching] = useState(false);

    const [job, setJob] = useState(null); // { channel, title }

    const loadInstalled = useCallback(async () => {
        try {
            const data = await api.getRemotePackages(serverId);
            setInstalledRaw(data?.output || '');
            setManager(data?.manager || '');
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.failedToLoadPackages', 'Failed to load packages'), err);
        } finally {
            setLoadingInstalled(false);
        }
    }, [serverId, t, toast]);

    useEffect(() => {
        if (serverStatus !== 'online') {
            setLoadingInstalled(false);
            return;
        }
        loadInstalled();
    }, [serverStatus, loadInstalled]);

    async function handleSearch(e) {
        e?.preventDefault?.();
        const q = searchQuery.trim();
        if (!q) {
            setSearchResults(null);
            return;
        }
        setSearching(true);
        try {
            const data = await api.searchRemotePackages(serverId, q, 100);
            setSearchResults(data?.results || []);
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.searchFailed', 'Search failed'), err);
            setSearchResults([]);
        } finally {
            setSearching(false);
        }
    }

    async function handleInstall(name) {
        try {
            const result = await api.installRemotePackages(serverId, [name]);
            const channel = result?.channel || `job:${result?.job_id}`;
            setJob({ channel, title: `Installing ${name}` });
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.failedToStartInstall', 'Failed to start install', {  }), err);
        }
    }

    async function handleRemove(name) {
        const ok = await confirm({
            title: t('app.serverPackagesTab.remove', 'Uninstall {{name}}', { name: name }),
            message: t('app.serverPackagesTab.uninstallFromThisServer', 'Uninstall {{name}} from this server?', { name: name }),
            confirmText: t('common.actions.uninstall', 'Uninstall'),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.removeRemotePackage(serverId, name);
            toast.success(`${name} removed`);
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.removeFailed', 'Uninstall failed'), err);
        }
    }

    async function handleUpdateCache() {
        try {
            await api.updateRemotePackageCache(serverId);
            toast.success(t('app.serverPackagesTab.packageCacheUpdated', 'Package cache updated ({{value}})', { value: manager || 'manager' }));
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.updateFailed', 'Update failed'), err);
        }
    }

    async function handleUpgradeAll() {
        const ok = await confirm({
            title: t('app.serverPackagesTab.upgradeAllPackages', 'Upgrade all packages'),
            message: t('app.serverPackagesTab.runAFullSystemUpgradeThis', 'Run a full system upgrade? This may take several minutes.'),
        });
        if (!ok) return;
        try {
            const result = await api.upgradeRemotePackages(serverId, { all: true });
            const channel = result?.channel || `job:${result?.job_id}`;
            setJob({ channel, titleKey: 'app.serverPackagesTab.upgradingAllPackages', title: 'Upgrading all packages' });
        } catch (err) {
            toastError(toast, t('app.serverPackagesTab.upgradeFailedToStart', 'Upgrade failed to start'), err);
        }
    }

    function handleJobComplete() {
        // Refresh the installed-list once an install/upgrade settles so
        // the user sees the new state without a manual reload.
        loadInstalled();
    }

    if (serverStatus !== 'online') {
        return (
            <div className="empty-state">
                <p>{t('app.serverPackagesTab.serverIsOfflineReconnectToManage', 'Server is offline. Reconnect to manage packages.')}</p>
            </div>
        );
    }

    return (
        <div className="server-packages">
            <ListToolbar
                tools={(
                    <div className="server-packages__actions">
                        <Button variant="outline" onClick={handleUpdateCache}>{t('app.serverPackagesTab.updateCache', 'Update cache')}</Button>
                        <Button variant="outline" onClick={handleUpgradeAll}>{t('app.serverPackagesTab.upgradeAll', 'Upgrade all')}</Button>
                    </div>
                )}
            >
                <form onSubmit={handleSearch} className="server-packages__search">
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('app.serverPackagesTab.searchPackages', 'Search packages…')}
                    />
                    <Button type="submit" variant="outline" disabled={searching}>
                        {searching ? 'Searching…' : 'Search'}
                    </Button>
                </form>
            </ListToolbar>

            <section className="server-packages__presets">
                <h3>{t('app.serverPackagesTab.quickInstall', 'Quick install')}</h3>
                <div className="server-packages__chips">
                    {QUICK_PRESETS.map((p) => (
                        <Button variant="unstyled"
                            key={p.name}
                            type="button"
                            className="server-packages__chip"
                            onClick={() => handleInstall(p.name)}
                        >
                            {p.label}
                        </Button>
                    ))}
                </div>
            </section>

            {searchResults !== null && (
                <section className="server-packages__results">
                    <h3>{t('app.serverPackagesTab.searchResults', 'Search results')} {manager && <Badge>{manager}</Badge>}</h3>
                    {searchResults.length === 0 ? (
                        <p className="text-muted-foreground">{t('app.serverPackagesTab.noMatches', 'No matches.')}</p>
                    ) : (
                        <ul className="server-packages__list">
                            {searchResults.map((line, i) => {
                                // First whitespace-separated token is the package name on
                                // every supported manager output format. Anything after is
                                // the description and gets truncated visually by CSS.
                                const name = line.split(/\s+/)[0]?.replace(/[-/].*/, '') || line;
                                return (
                                    <li key={`${name}-${i}`} className="server-packages__list-item">
                                        <span className="server-packages__list-name">{line}</span>
                                        <Button size="sm" variant="outline" onClick={() => handleInstall(name)}>
                                            {t('app.serverPackagesTab.install', 'Install')}
                                        </Button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            )}

            <section className="server-packages__installed">
                <h3>{t('app.serverPackagesTab.installedPackages', 'Installed packages')} {manager && <Badge>{manager}</Badge>}</h3>
                {loadingInstalled ? (
                    <p className="text-muted-foreground">{t('common.loading', 'Loading…')}</p>
                ) : (
                    <pre className="server-packages__raw">
                        {installedRaw || 'No packages reported.'}
                    </pre>
                )}
                <p className="server-packages__hint text-muted-foreground">
                    {t('app.serverPackagesTab.outputIsTheRawPackageManager', 'Output is the raw package-manager listing. Use search to find a specific package, then click Install.')}
                </p>
            </section>

            <JobProgressModal
                open={!!job}
                serverId={serverId}
                channel={job?.channel}
                title={job?.title}
                onClose={() => setJob(null)}
                onComplete={handleJobComplete}
            />

            <div className="server-packages__remove-tip text-muted-foreground">
                {t('app.serverPackagesTab.tipToRemoveASpecificPackage', "Tip: to uninstall a specific package, search for it and use the row's")}
                <em> {t('app.serverPackagesTab.install', 'Install')} </em>
                {t('app.serverPackagesTab.buttonToReinstallOrOpenA', 'button to reinstall, or open a terminal session for advanced operations. Direct uninstall from this UI:')}
                <RemoveByName onRemove={handleRemove} />
            </div>
        </div>
    );
};

// Small inline form for ad-hoc package removal. Kept separate so the
// main render stays readable.
function RemoveByName({ onRemove }) {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                onRemove(name.trim());
                setName('');
            }}
            className="server-packages__remove-form"
        >
            <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('app.serverPackagesTab.packageName', 'package name')}
                size="sm"
            />
            <Button type="submit" variant="outline" size="sm" disabled={!name.trim()}>
                {t('common.actions.uninstall', 'Uninstall')}
            </Button>
        </form>
    );
}

export default PackagesTab;
