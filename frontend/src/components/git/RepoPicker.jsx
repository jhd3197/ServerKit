import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';

/**
 * One repo picker for every git provider (plan 79 G1).
 *
 * Four near-identical components used to exist — GitHub, GitLab, Gitea and
 * Bitbucket — differing in which API functions they called, one URL shape, and
 * the provider's name in six strings. That is ~700 lines carrying four copies
 * of the same search box, the same "Loading repositories…", the same empty
 * state and the same branch selector.
 *
 * The copy duplication is the part that matters here: every one of those
 * strings would otherwise need translating four times, and drift between them
 * is invisible until someone reads all four files side by side.
 *
 * A provider supplies behaviour, not markup:
 *
 *   {
 *     id, name, Icon,
 *     cloneUrl(repo),
 *     getStatus(), listRepos(search), listBranches(fullName),
 *     isReady(status),            // when can we show the list?
 *     account(status, t),         // { name, detail, avatarUrl }
 *     unavailable(status, t),     // what to render when not ready
 *     connect?(),                 // OAuth start — omitted for local providers
 *   }
 *
 * It stays a selection helper: it calls onPick({ repoUrl, fullName, branch })
 * as the user chooses and the host form turns that into its own request.
 */
const RepoPicker = ({ provider, onPick }) => {
    const { t } = useTranslation();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [repos, setRepos] = useState([]);
    const [reposLoading, setReposLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [branches, setBranches] = useState([]);
    const [branch, setBranch] = useState('');

    const { Icon } = provider;
    const ready = provider.isReady(status);

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            setStatus(await provider.getStatus());
        } catch {
            setStatus(null);
        } finally {
            setLoading(false);
        }
    }, [provider]);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const loadRepos = useCallback(async (query = '') => {
        setReposLoading(true);
        try {
            setRepos(await provider.listRepos(query));
        } catch {
            setRepos([]);
        } finally {
            setReposLoading(false);
        }
    }, [provider]);

    useEffect(() => { if (ready) loadRepos(); }, [ready, loadRepos]);

    // Picking a repo defaults the branch, loads its branch list, and emits.
    useEffect(() => {
        if (!selected) return undefined;
        const next = selected.default_branch || 'main';
        setBranch(next);
        onPick?.({
            repoUrl: provider.cloneUrl(selected),
            fullName: selected.full_name,
            branch: next,
        });
        let cancelled = false;
        provider.listBranches(selected.full_name)
            .then((list) => { if (!cancelled) setBranches(list); })
            .catch(() => { if (!cancelled) setBranches([]); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected]);

    function pickBranch(next) {
        setBranch(next);
        if (selected) {
            onPick?.({
                repoUrl: provider.cloneUrl(selected),
                fullName: selected.full_name,
                branch: next,
            });
        }
    }

    if (loading) return null;

    if (!ready) {
        // Never blocks the paste-a-URL path the host form still renders.
        const blocked = provider.unavailable(status, t);
        if (!blocked) return null;
        if (blocked.action) {
            return (
                <div className="git-connect__gh git-connect__gh--connect">
                    <Icon size={18} aria-hidden="true" />
                    <div className="git-connect__gh-text">
                        <strong>{blocked.title}</strong>
                        <span>{blocked.message}</span>
                    </div>
                    <Button type="button" onClick={blocked.action.onClick}>
                        <Icon size={15} /> {blocked.action.label}
                    </Button>
                </div>
            );
        }
        return (
            <div className="git-connect__gh git-connect__gh--hint">
                <Icon size={15} aria-hidden="true" />
                <span>{blocked.message}</span>
            </div>
        );
    }

    const account = provider.account(status, t);

    return (
        <div className="git-connect__gh git-connect__gh--picker">
            <div className="git-connect__gh-account">
                {account.avatarUrl && <img src={account.avatarUrl} alt="" />}
                <span className="git-connect__gh-account-name">
                    <strong>{account.name}</strong>
                    <small>{account.detail}</small>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => loadRepos(search)}>
                    <RefreshCw size={14} className={reposLoading ? 'spinning' : ''} />
                    {' '}{t('common.actions.refresh', 'Refresh')}
                </Button>
            </div>

            <div className="git-connect__gh-search">
                <Search size={15} aria-hidden="true" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('git.picker.search', 'Search your repositories')}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); loadRepos(search); }
                    }}
                />
            </div>

            <div className="git-connect__gh-list">
                {reposLoading && (
                    <div className="git-connect__gh-state">
                        {t('git.picker.loading', 'Loading repositories…')}
                    </div>
                )}
                {!reposLoading && repos.length === 0 && (
                    <div className="git-connect__gh-state">
                        {t('git.picker.empty', 'No repositories found.')}
                    </div>
                )}
                {!reposLoading && repos.map((repo) => (
                    <Button variant="unstyled"
                        type="button"
                        key={repo.id}
                        className={`git-connect__gh-repo${selected?.id === repo.id ? ' is-active' : ''}`}
                        onClick={() => setSelected(repo)}
                    >
                        <span className="git-connect__gh-repo-main">
                            <strong>{repo.full_name}</strong>
                            <small>
                                {repo.description || repo.language
                                    || t('git.picker.noDescription', 'No description')}
                            </small>
                        </span>
                        <span className="git-connect__gh-repo-vis">
                            {repo.private
                                ? t('git.picker.private', 'Private')
                                : t('git.picker.public', 'Public')}
                        </span>
                        {selected?.id === repo.id && <Check size={15} />}
                    </Button>
                ))}
            </div>

            {selected && branches.length > 0 && (
                <div className="git-connect__gh-branch">
                    <label htmlFor={`${provider.id}-branch`}>
                        {t('git.picker.branch', 'Branch')}
                    </label>
                    <Select value={branch} onValueChange={pickBranch}>
                        <SelectTrigger id={`${provider.id}-branch`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {branches.map((name) => (
                                <SelectItem key={name} value={name}>{name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
        </div>
    );
};

export default RepoPicker;
