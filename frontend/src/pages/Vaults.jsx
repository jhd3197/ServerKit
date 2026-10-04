import { useCallback, useEffect, useMemo, useState  } from 'react';
import api from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Modal from '@/components/Modal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '../contexts/useToast.js';
import { ArrowLeft, Plus, MoreVertical, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import ResourceListPage from '../components/layouts/ResourceListPage';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { SearchField, ServiceTile } from '@/components/ds';
import { formatRelativeTime } from '@/utils/time';
import { useConfirm } from '@/hooks/useConfirm';
import { CopyButton } from '../components/CopyButton';
import { useWorkspace } from '../contexts/useWorkspace.js';
import { useTranslation } from 'react-i18next';

const formatDate = (d) => (d ? new Date(d).toLocaleString() : '—');

// Two tables, one chrome. The vault list and a vault's secrets are the same
// surface at two depths, so both go through ResourceListPage rather than the
// list being a table and the drill-down being a hand-rolled card.
const VAULT_VIEWS = [
    { name: 'All vaults', state: { search: '', sorts: [], hiddenKeys: [], columnFilters: null } },
    {
        name: 'Empty vaults',
        state: {
            search: '',
            sorts: [],
            hiddenKeys: [],
            columnFilters: { match: 'all', rules: [{ id: 'vv1', field: 'secrets', op: 'eq', value: 0 }] },
        },
    },
];

/**
 * Vaults — encrypted key/value stores for credentials and tokens. Rendered
 * inside the Organization tab group (alongside Projects / Shared Variables /
 * Workspaces), so it shows no PageTopbar of its own — TabGroupLayout supplies
 * the shared header and tabs. Inbound webhooks live on their own /webhooks page.
 */
export default function Vaults() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const { activeWorkspaceId: workspaceScopeId, isAllWorkspaces } = useWorkspace();

    const [vaults, setVaults] = useState([]);
    const [workspaces, setWorkspaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const activeWorkspaceId = isAllWorkspaces ? '' : workspaceScopeId;
    const [vaultForm, setVaultForm] = useState({ open: false, name: '', description: '', workspace_id: activeWorkspaceId });
    const [selectedVault, setSelectedVault] = useState(null);
    const [secretForm, setSecretForm] = useState({ open: false, name: '', value: '', description: '' });
    const [revealSecretId, setRevealSecretId] = useState(null);
    const [revealedValue, setRevealedValue] = useState('');
    const [search, setSearch] = useState('');

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const [v, w] = await Promise.all([
                api.listVaults(),
                api.getWorkspaces().catch(() => ({ workspaces: [] })),
            ]);
            setVaults(v.vaults || []);
            setWorkspaces(w.workspaces || []);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
    }, [loadAll]);


    async function createVault(e) {
        e.preventDefault();
        try {
            const payload = {
                name: vaultForm.name,
                description: vaultForm.description,
                workspace_id: vaultForm.workspace_id || undefined,
            };
            await api.createVault(payload);
            setVaultForm({ open: false, name: '', description: '', workspace_id: activeWorkspaceId });
            loadAll();
            toast.success(t('app.vaults.vaultCreated', 'Vault created'));
        } catch (err) {
            toast.error(t('app.vaults.failedToCreateVault', 'Failed to create vault: {{message}}', { message: err.message }));
        }
    }

    async function deleteVault(id) {
        if (!await confirm({
            title: t('app.vaults.deleteVault', 'Delete vault'),
            message: t('app.vaults.deleteThisVaultAndAllIts', 'Delete this vault and all its secrets?'),
            confirmText: t('app.vaults.deleteVault', 'Delete vault'),
        })) return;
        try {
            await api.deleteVault(id);
            if (selectedVault?.id === id) setSelectedVault(null);
            loadAll();
            toast.success(t('app.vaults.vaultDeleted', 'Vault deleted'));
        } catch (err) {
            toast.error(t('app.vaults.failedToDeleteVault', 'Failed to delete vault: {{message}}', { message: err.message }));
        }
    }

    async function createSecret(e) {
        e.preventDefault();
        try {
            await api.createSecret(selectedVault.id, {
                name: secretForm.name,
                value: secretForm.value,
                description: secretForm.description,
            });
            setSecretForm({ open: false, name: '', value: '', description: '' });
            openVault(selectedVault.id);
            toast.success(t('app.vaults.secretCreated', 'Secret created'));
        } catch (err) {
            toast.error(t('app.vaults.failedToCreateSecret', 'Failed to create secret: {{message}}', { message: err.message }));
        }
    }

    async function openVault(id) {
        try {
            const { vault } = await api.getVault(id);
            const { secrets } = await api.listSecrets(id);
            setSelectedVault({ ...vault, secrets });
        } catch (err) {
            toast.error(t('app.vaults.failedToLoadVault', 'Failed to load vault: {{message}}', { message: err.message }));
        }
    }

    async function revealSecret(secret) {
        try {
            const { secret: data } = await api.revealSecret(secret.id);
            setRevealSecretId(secret.id);
            setRevealedValue(data.value || '');
        } catch (err) {
            toast.error(t('app.vaults.revealFailed', 'Reveal failed: {{message}}', { message: err.message }));
        }
    }

    async function deleteSecret(id) {
        if (!await confirm({
            title: t('app.vaults.deleteSecret', 'Delete secret'),
            message: t('app.vaults.deleteThisSecret', 'Delete this secret?'),
            confirmText: t('app.vaults.deleteSecret', 'Delete secret'),
        })) return;
        try {
            await api.deleteSecret(id);
            openVault(selectedVault.id);
            toast.success(t('app.vaults.secretDeleted', 'Secret deleted'));
        } catch (err) {
            toast.error(t('app.vaults.failedToDeleteSecret', 'Failed to delete secret: {{message}}', { message: err.message }));
        }
    }

    // The top bar follows the depth: at the list it creates vaults, inside one
    // it goes back and adds secrets. Search is published here too so it lands
    // in the bar next to the filter and "⋮" the table hoists into it.
    useTopbarActions(() => (selectedVault ? (
        <>
            <Button variant="outline" size="sm" onClick={() => setSelectedVault(null)}>
                <ArrowLeft size={15} /> {t('app.vaults.allVaults', 'All vaults')}
            </Button>
            <Button size="sm" onClick={() => setSecretForm({ open: true, name: '', value: '', description: '' })}>
                <Plus size={15} /> {t('app.vaults.addSecret', 'Add secret')}
            </Button>
            <SearchField value={search} onSearch={setSearch} placeholder={t('app.vaults.searchSecrets', 'Search secrets…')} />
        </>
    ) : (
        <>
            <Button size="sm" onClick={() => setVaultForm({ open: true, name: '', description: '', workspace_id: activeWorkspaceId })}>
                <Plus size={15} /> {t('app.vaults.newVault', 'New vault')}
            </Button>
            <SearchField value={search} onSearch={setSearch} placeholder={t('app.vaults.searchVaults', 'Search vaults…')} />
        </>
    )), [selectedVault, search, activeWorkspaceId]);

    // Reset the query when changing depth — a term that matched a vault name is
    // almost never a secret name, and leaving it applied shows an empty table.
    useEffect(() => { setSearch(''); }, [selectedVault?.id]);

    const vaultRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return vaults;
        return vaults.filter((v) => (
            v.name?.toLowerCase().includes(q) || v.description?.toLowerCase().includes(q)
        ));
    }, [vaults, search]);

    const secretRows = useMemo(() => {
        const all = selectedVault?.secrets || [];
        const q = search.trim().toLowerCase();
        if (!q) return all;
        return all.filter((s) => (
            s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
        ));
    }, [selectedVault, search]);

    const vaultColumns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'app.vaults.vault', header: 'Vault',
            sortable: true,
            hideable: false,
            value: (v) => v.name,
            render: (v) => (
                <div className="sk-cell-name">
                    <ServiceTile name={v.name} size={30} className="wp-list__tile" aria-hidden="true" />
                    <span>{v.name}</span>
                </div>
            ),
        },
        {
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            value: (v) => v.description || '',
            render: (v) => v.description || <span className="wp-list__dash">—</span>,
        },
        {
            key: 'secrets',
            headerKey: 'app.vaults.secrets', header: 'Secrets',
            type: 'number',
            sortable: true,
            width: 100,
            cellClassName: 'sk-cell-dim',
            // `value` sorts and filters; `render` is what the cell shows —
            // DataTable falls back to row[key], and there is no `secrets` key.
            value: (v) => v.secret_count ?? 0,
            render: (v) => v.secret_count ?? 0,
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 56,
            className: 'text-right',
            render: (v) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon"><MoreVertical size={14} /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openVault(v.id)}>{t('common.actions.open', 'Open')}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => deleteVault(v.id)}>{t('common.actions.delete', 'Delete')}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], []);

    const secretColumns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'app.vaults.secret', header: 'Secret',
            sortable: true,
            hideable: false,
            value: (s) => s.name,
            cellClassName: 'sk-cell-mono',
        },
        {
            key: 'value',
            headerKey: 'common.labels.value', header: 'Value',
            sortable: false,
            filterable: false,
            render: (s) => (
                <code className="secrets__value">
                    {revealSecretId === s.id ? revealedValue : s.value}
                </code>
            ),
        },
        {
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            value: (s) => s.description || '',
            render: (s) => s.description || <span className="wp-list__dash">—</span>,
        },
        {
            key: 'updated',
            headerKey: 'app.vaults.updated', header: 'Updated',
            type: 'date',
            sortable: true,
            width: 130,
            cellClassName: 'sk-cell-dim',
            value: (s) => s.updated_at || null,
            render: (s) => (s.updated_at
                ? <span title={formatDate(s.updated_at)}>{formatRelativeTime(s.updated_at)}</span>
                : <span className="wp-list__dash">—</span>),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 120,
            className: 'text-right',
            render: (s) => {
                const revealed = revealSecretId === s.id;
                return (
                    <div onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => (revealed ? setRevealSecretId(null) : revealSecret(s))} title={revealed ? t('app.vaults.hide', 'Hide') : t('app.vaults.reveal', 'Reveal')}>
                            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                        <CopyButton
                            value={revealed ? revealedValue : s.value}
                            label={t('common.actions.copy', 'Copy')}
                            copiedLabel={t('app.copyField.copied', 'Copied')}
                        />
                        <Button variant="ghost" size="icon" className="text-destructive" title={t('common.actions.delete', 'Delete')} onClick={() => deleteSecret(s.id)}>
                            <Trash2 size={14} />
                        </Button>
                    </div>
                );
            },
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [revealSecretId, revealedValue]);

    const vaultTable = selectedVault ? (
        <ResourceListPage
            key="secrets"
            loading={false}
            storageKey="serverkit-list-secrets"
            viewPageKey="vault-secrets"
            noun="secrets"
            totalCount={(selectedVault.secrets || []).length}
            items={secretRows}
            columns={secretColumns}
            keyField="id"
            emptyIcon={KeyRound}
            emptyTitle="No secrets yet"
            emptyDescription={`Add your first secret to ${selectedVault.name}.`}
            emptyAction={(
                <Button onClick={() => setSecretForm({ open: true, name: '', value: '', description: '' })}>
                    <Plus size={16} /> {t('app.vaults.addSecret', 'Add secret')}
                </Button>
            )}
            filteredEmptyIcon={KeyRound}
            filteredEmptyTitle="No secrets found"
            filteredEmptyDescription="Try adjusting your search or filters."
        />
    ) : (
        <ResourceListPage
            key="vaults"
            loading={loading}
            loadingTitle="Loading vaults…"
            storageKey="serverkit-list-vaults"
            viewPageKey="vaults"
            noun="vaults"
            builtinViews={VAULT_VIEWS}
            totalCount={vaults.length}
            error={loadError}
            errorTitle={t('app.vaults.couldntLoadVaults', "Couldn't load vaults")}
            onRetry={loadAll}
            items={vaultRows}
            columns={vaultColumns}
            keyField="id"
            onRowClick={(v) => openVault(v.id)}
            emptyIcon={KeyRound}
            emptyTitle="No vaults yet"
            emptyDescription="A vault is an encrypted key/value store for credentials and tokens. Create one to start putting secrets in it."
            emptyAction={(
                <Button onClick={() => setVaultForm({ open: true, name: '', description: '', workspace_id: activeWorkspaceId })}>
                    <Plus size={16} /> {t('app.vaults.createYourFirstVault', 'Create your first vault')}
                </Button>
            )}
            filteredEmptyIcon={KeyRound}
            filteredEmptyTitle="No vaults found"
            filteredEmptyDescription="Try adjusting your search or filters."
        />
    );

    // ResourceListPage supplies the `sk-tabgroup__inner` wrapper itself, so the
    // page is just the active table plus the two dialogs.
    return (
        <>
            {vaultTable}

            <Modal open={vaultForm.open} onClose={() => setVaultForm({ ...vaultForm, open: false })} title={t('app.vaults.newVault2', 'New vault')}>
                <p className="sk-modal__subtitle">{t('app.vaults.createAnEncryptedVaultToGroup', 'Create an encrypted vault to group secrets.')}</p>
                <form onSubmit={createVault} className="space-y-4">
                        <div>
                            <Label htmlFor="vaultName">{t('common.labels.name', 'Name')}</Label>
                            <Input id="vaultName" value={vaultForm.name} onChange={(e) => setVaultForm({ ...vaultForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="vaultDesc">{t('common.labels.description', 'Description')}</Label>
                            <Textarea id="vaultDesc" value={vaultForm.description} onChange={(e) => setVaultForm({ ...vaultForm, description: e.target.value })} />
                        </div>
                        {workspaces.length > 0 && (
                            <div>
                                <Label htmlFor="vaultWorkspace">{t('common.labels.workspace', 'Workspace')}</Label>
                                <Select
                                    value={vaultForm.workspace_id || 'all'}
                                    onValueChange={(value) => setVaultForm({ ...vaultForm, workspace_id: value === 'all' ? '' : value })}
                                >
                                    <SelectTrigger id="vaultWorkspace">
                                        <SelectValue placeholder={t('app.vaults.selectWorkspace', 'Select workspace')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">{t('app.vaults.allWorkspaces', 'All workspaces')}</SelectItem>
                                        {workspaces.map((w) => (
                                            <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="modal-actions">
                            <Button type="submit">{t('app.vaults.createVault', 'Create vault')}</Button>
                        </div>
                    </form>
            </Modal>

            <Modal open={secretForm.open} onClose={() => setSecretForm({ ...secretForm, open: false })} title={t('app.vaults.addSecret3', 'Add secret')}>
                <p className="sk-modal__subtitle">{t('app.vaults.addAnEncryptedSecretTo', 'Add an encrypted secret to')} {selectedVault?.name}.</p>
                <form onSubmit={createSecret} className="space-y-4">
                        <div>
                            <Label htmlFor="secretName">{t('common.labels.name', 'Name')}</Label>
                            <Input id="secretName" value={secretForm.name} onChange={(e) => setSecretForm({ ...secretForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="secretValue">{t('common.labels.value', 'Value')}</Label>
                            <Textarea id="secretValue" value={secretForm.value} onChange={(e) => setSecretForm({ ...secretForm, value: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="secretDesc">{t('common.labels.description', 'Description')}</Label>
                            <Textarea id="secretDesc" value={secretForm.description} onChange={(e) => setSecretForm({ ...secretForm, description: e.target.value })} />
                        </div>
                        <div className="modal-actions">
                            <Button type="submit">{t('app.vaults.saveSecret', 'Save secret')}</Button>
                        </div>
                    </form>
            </Modal>
        </>
    );
}
