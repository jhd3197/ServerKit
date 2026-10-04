import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import EmptyState from '../EmptyState';
import { DataTable, DataTableFooter } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// DataTable columns. Cell markup and classNames are identical to the
// hand-rolled table they replace, so _service-detail.scss keeps applying
// (.sk-cell-mono, .svc-pkg-name).
const PACKAGE_COLUMNS = [
    {
        key: 'name',
        headerKey: 'app.packagesTab.package', header: 'Package',
        sortable: true,
        hideable: false,
        cellClassName: 'sk-cell-mono svc-pkg-name',
        sortValue: (pkg) => pkg.name || '',
        render: (pkg) => pkg.name,
    },
    {
        key: 'version',
        headerKey: 'common.labels.version', header: 'Version',
        sortable: true,
        cellClassName: 'sk-cell-mono',
        sortValue: (pkg) => pkg.version || '',
        render: (pkg) => pkg.version,
    },
];

const PackagesTab = ({ appId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [newPackage, setNewPackage] = useState('');

    const loadPackages = useCallback(async () => {
        try {
            const data = await api.getPythonPackages(appId);
            setPackages(data.packages || []);
        } catch (err) {
            console.error('Failed to load packages:', err);
        } finally {
            setLoading(false);
        }
    }, [appId]);

    useEffect(() => {
        loadPackages();
    }, [loadPackages]);

    async function handleInstall(e) {
        e.preventDefault();
        if (!newPackage.trim()) return;

        setInstalling(true);
        try {
            await api.installPythonPackages(appId, [newPackage.trim()]);
            setNewPackage('');
            loadPackages();
        } catch (err) {
            console.error('Failed to install package:', err);
        } finally {
            setInstalling(false);
        }
    }

    async function handleFreeze() {
        try {
            await api.freezePythonRequirements(appId);
            toast.success(t('app.packagesTab.requirementsTxtUpdated', 'requirements.txt updated'));
        } catch (err) {
            toastError(toast, t('app.packagesTab.failedToFreezeRequirements', 'Failed to freeze requirements'), err);
        }
    }

    if (loading) {
        return <EmptyState loading title={t('app.packagesTab.loadingPackages', 'Loading packages…')} />;
    }

    return (
        <div>
            <div className="section-header">
                <h3 className="svc-eyebrow">
                    {t('app.packagesTab.installedPackages', 'Installed packages')} <span className="svc-eyebrow__count">&middot; {packages.length}</span>
                </h3>
                <Button variant="outline" size="sm" onClick={handleFreeze}>
                    {t('app.packagesTab.freezeToRequirementsTxt', 'Freeze to requirements.txt')}
                </Button>
            </div>

            <form className="install-form" onSubmit={handleInstall}>
                <Input
                    type="text"
                    value={newPackage}
                    onChange={(e) => setNewPackage(e.target.value)}
                    placeholder={t('app.packagesTab.packageNameEGRequestsFlask', 'Package name (e.g. requests, flask==2.0.0)')}
                />
                <Button type="submit" disabled={installing}>
                    {installing ? 'Installing...' : 'Install'}
                </Button>
            </form>

            <DataTable
                columns={PACKAGE_COLUMNS}
                data={packages}
                keyField="name"
                storageKey="serverkit-table-packages"
                className="svc-card"
                emptyTitle="No packages"
                emptyMessage={t('app.packagesTab.installAPackageAboveToGet', 'Install a package above.')}
                footer={<DataTableFooter shown={packages.length} total={packages.length} noun="package" />}
            />
        </div>
    );
};

export default PackagesTab;
