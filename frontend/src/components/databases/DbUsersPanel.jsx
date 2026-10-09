import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, UserRound } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import CopyField from '@/components/CopyField';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Users ServerKit created on a managed database (tracked rows merged with the
// live engine list). Create returns the password exactly once — it is shown
// until dismissed and never retrievable again.
export default function DbUsersPanel({ databaseId }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newGrants, setNewGrants] = useState('ALL');
    const [oneTimeSecret, setOneTimeSecret] = useState(null); // { username, password }

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getManagedDbUsers(databaseId);
            setUsers(data?.users || []);
        } catch (err) {
            toastError(toast, t('app.dbUsersPanel.failedToLoadDatabaseUsers', "Couldn't load database users."), err);
        } finally {
            setLoading(false);
        }
    }, [databaseId, t, toast]);

    useEffect(() => { load(); }, [load]);

    async function createUser(e) {
        e.preventDefault();
        setCreating(true);
        try {
            const grants = newGrants.split(',').map((g) => g.trim()).filter(Boolean);
            const data = await api.createManagedDbUser(databaseId, {
                username: newUsername.trim() || undefined,
                grants: grants.length ? grants : undefined,
            });
            setOneTimeSecret({ username: data.user.username, password: data.password });
            setNewUsername('');
            setNewGrants('ALL');
            await load();
        } catch (err) {
            toastError(toast, t('app.dbUsersPanel.failedToCreateUser', "Couldn't create the user."), err);
        } finally {
            setCreating(false);
        }
    }

    async function removeUser(user) {
        const ok = await confirm({
            title: t('app.dbUsersPanel.dropUser', 'Drop user "{{username}}"?', { username: user.username }),
            message: t('app.dbUsersPanel.thisDropsTheUserOnThe', 'This drops the user on the database server and stops tracking it.'),
            confirmText: t('app.dbUsersPanel.dropUser2', 'Drop user'),
            danger: true,
        });
        if (!ok) return;
        try {
            await api.deleteManagedDbUser(databaseId, user.id);
            toast.success(t('app.dbUsersPanel.userDropped', 'User dropped'));
            await load();
        } catch (err) {
            toastError(toast, t('app.dbUsersPanel.failedToDropUser', "Couldn't drop the user."), err);
        }
    }


    return (
        <div className="managed-db__users">
            {oneTimeSecret && (
                <div className="managed-db__secret">
                    <span className="managed-db__meta">
                        {t('app.dbUsersPanel.passwordFor', 'Password for')} <strong>{oneTimeSecret.username}</strong>{' '}
                        {t('app.dbUsersPanel.shownOnceSaveItNow', '(shown once). Save it now.')}
                    </span>
                    <CopyField
                        value={oneTimeSecret.password}
                        secret
                        onCopy={() => toast.success(t('app.dbUsersPanel.passwordCopied', 'Password copied'))}
                    />
                    <div className="managed-db__actions">
                        <Button type="button" size="sm" variant="ghost"
                            onClick={() => setOneTimeSecret(null)}>
                            {t('common.actions.dismiss', 'Dismiss')}
                        </Button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="managed-db__hint">{t('app.dbUsersPanel.loadingUsers', 'Loading users…')}</p>
            ) : users.length === 0 ? (
                <p className="managed-db__hint">{t('app.dbUsersPanel.noUsersTrackedForThisDatabase', 'No users tracked for this database yet.')}</p>
            ) : (
                <div className="managed-db__list">
                    {users.map((user) => (
                        <div key={user.id ?? `live-${user.username}`} className="managed-db__row">
                            <div className="managed-db__info">
                                <strong><UserRound size={13} /> {user.username}</strong>
                                <span className="managed-db__meta">
                                    {user.tracked === false
                                        ? t('app.dbUsersPanel.notCreatedByServerkit', 'exists on server, not created by ServerKit')
                                        : (user.grants || []).join(', ') || t('app.dbUsersPanel.noGrantsRecorded', 'no grants recorded')}
                                    {user.present === false ? ` · ${t('app.dbUsersPanel.missingOnServer', 'missing on server')}` : ''}
                                </span>
                            </div>
                            {user.tracked !== false && (
                                <div className="managed-db__actions">
                                    <Button type="button" size="sm" variant="ghost"
                                        onClick={() => removeUser(user)}
                                        aria-label={t('app.dbUsersPanel.dropUser4', 'Drop user {{username}}', { username: user.username })}>
                                        <Trash2 size={14} /> {t('app.dbUsersPanel.drop', 'Drop')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <form className="managed-db__user-form" onSubmit={createUser}>
                <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder={t('app.dbUsersPanel.usernameBlankGenerated', 'username (blank = generated)')}
                    aria-label={t('app.dbUsersPanel.newUserName', 'New user name')}
                />
                <input
                    type="text"
                    value={newGrants}
                    onChange={(e) => setNewGrants(e.target.value)}
                    placeholder={t('app.dbUsersPanel.grantsEGAllOrSelect', 'grants, e.g. ALL or SELECT, INSERT')}
                    aria-label={t('app.dbUsersPanel.grants', 'Grants')}
                />
                <Button type="submit" size="sm" variant="outline" disabled={creating}>
                    <Plus size={14} /> {creating ? t('app.dbUsersPanel.creating', 'Creating…') : t('app.dbUsersPanel.createUser', 'Create user')}
                </Button>
            </form>
        </div>
    );
}
