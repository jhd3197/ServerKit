import { useState, useEffect, useCallback } from 'react';
import { Copy, ShieldCheck, Trash2, RefreshCw, Link2, Users } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Pill } from '../ds';
import AdminerSsoButton from './AdminerSsoButton';
import DbUsersPanel from './DbUsersPanel';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from 'react-i18next';

// Durable list of the databases ServerKit tracks (provisioned or adopted),
// beside the live explorer. Reveal/copy a real connection string (audited),
// protect it with a backup policy (real FK), or untrack/drop it.
export default function ManagedDatabasesPanel() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const { copy } = useClipboard();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [usersOpenId, setUsersOpenId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getManagedDatabases();
            setRows(data?.databases || []);
        } catch (err) {
            toast.error(err.message || t('app.managedDatabasesPanel.failedToLoadManagedDatabases', 'Failed to load managed databases'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => { load(); }, [load]);

    async function copyConnectionUri(row) {
        setBusyId(row.id);
        try {
            const data = await api.revealManagedConnectionUri(row.id);
            const uri = data?.connection_uri;
            // The string is fetched (and audited) on demand, so it is never
            // on screen; when the clipboard refuses, show it instead.
            if (uri && !(await copy(uri, t('app.managedDatabasesPanel.connectionStringCopiedRevealWasAudited', 'Connection string copied (reveal was audited)')))) {
                toast.info(uri);
            }
        } catch (err) {
            toast.error(err.message || t('app.managedDatabasesPanel.failedToRevealConnectionString', 'Failed to reveal connection string'));
        } finally {
            setBusyId(null);
        }
    }

    async function protect(row) {
        setBusyId(row.id);
        try {
            await api.protectManagedDatabase(row.id);
            toast.success(t('app.managedDatabasesPanel.backupPolicyCreatedTuneItUnder', 'Backup policy created. Tune it under Backups.'));
        } catch (err) {
            toast.error(err.message || t('app.managedDatabasesPanel.failedToProtectDatabase', 'Failed to protect database'));
        } finally {
            setBusyId(null);
        }
    }

    async function untrack(row, drop) {
        const ok = await confirm({
            title: drop ? t('app.managedDatabasesPanel.drop', 'Drop "{{name}}"?', { name: row.name }) : t('app.managedDatabasesPanel.untrack', 'Untrack "{{name}}"?', { name: row.name }),
            message: drop
                ? t('app.managedDatabasesPanel.thisDropsTheDatabaseOnThe', 'This DROPs the database on the server and removes tracking. This cannot be undone.')
                : t('app.managedDatabasesPanel.thisStopsTrackingTheDatabaseThe', 'This stops tracking the database. The database itself is left untouched.'),
            confirmText: drop ? t('app.managedDatabasesPanel.dropDatabase', 'Drop database') : t('app.managedDatabasesPanel.untrack2', 'Untrack'),
            danger: drop,
        });
        if (!ok) return;
        setBusyId(row.id);
        try {
            await api.deleteManagedDatabase(row.id, { drop });
            toast.success(drop ? t('app.managedDatabasesPanel.databaseDroppedAndUntracked', 'Database dropped and untracked') : t('app.managedDatabasesPanel.databaseUntracked', 'Database untracked'));
            await load();
        } catch (err) {
            toast.error(err.message || t('app.managedDatabasesPanel.failedToRemoveDatabase', 'Failed to delete database'));
        } finally {
            setBusyId(null);
        }
    }

    if (loading) {
        return <p className="managed-db__hint">{t('app.managedDatabasesPanel.loadingManagedDatabases', 'Loading managed databases…')}</p>;
    }

    return (
        <div className="managed-db">
            <div className="managed-db__head">
                <p className="managed-db__hint">
                    {t('app.managedDatabasesPanel.databasesServerkitTracksForBackupsAnd', 'Databases ServerKit tracks for backups and connection strings. The live explorer still shows everything on the server.')}
                </p>
                <Button type="button" size="sm" variant="ghost" onClick={load} aria-label={t('common.actions.refresh', 'Refresh')}>
                    <RefreshCw size={14} /> {t('common.actions.refresh', 'Refresh')}
                </Button>
            </div>

            {rows.length === 0 ? (
                <p className="managed-db__empty">
                    <Link2 size={15} /> {t('app.managedDatabasesPanel.noTrackedDatabasesYetProvisioningA', 'No tracked databases yet. Provisioning a database tracks it automatically; you can also adopt an existing one.')}
                </p>
            ) : (
                <div className="managed-db__list">
                    {rows.map((row) => (
                        <div key={row.id} className="managed-db__item">
                            <div className="managed-db__row">
                                <div className="managed-db__info">
                                    <strong>{row.name}</strong>
                                    <span className="managed-db__meta">
                                        {row.engine} · {row.host}:{row.port}
                                        {row.admin_username ? ` · ${row.admin_username}` : ''}
                                    </span>
                                </div>
                                <Pill kind={row.origin === 'provisioned' ? 'green' : 'gray'}>{row.origin}</Pill>
                                <div className="managed-db__actions">
                                    {(row.engine === 'mysql' || row.engine === 'postgresql') && (
                                        <AdminerSsoButton databaseId={row.id} disabled={busyId === row.id} />
                                    )}
                                    <Button type="button" size="sm" variant="outline" disabled={busyId === row.id}
                                        onClick={() => copyConnectionUri(row)}>
                                        <Copy size={14} /> {t('app.managedDatabasesPanel.connectionString', 'Connection string')}
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" disabled={busyId === row.id}
                                        onClick={() => protect(row)}>
                                        <ShieldCheck size={14} /> {t('app.managedDatabasesPanel.protect', 'Protect')}
                                    </Button>
                                    {(row.engine === 'mysql' || row.engine === 'postgresql') && (
                                        <Button type="button" size="sm" variant="ghost" disabled={busyId === row.id}
                                            onClick={() => setUsersOpenId(usersOpenId === row.id ? null : row.id)}
                                            aria-expanded={usersOpenId === row.id}>
                                            <Users size={14} /> {t('app.managedDatabasesPanel.users', 'Users')}
                                        </Button>
                                    )}
                                    <Button type="button" size="sm" variant="ghost" disabled={busyId === row.id}
                                        onClick={() => untrack(row, false)} aria-label={t('app.managedDatabasesPanel.untrack3', 'Untrack {{name}}', { name: row.name })}>
                                        <Trash2 size={14} /> {t('app.managedDatabasesPanel.untrack2', 'Untrack')}
                                    </Button>
                                </div>
                            </div>
                            {usersOpenId === row.id && <DbUsersPanel databaseId={row.id} />}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
