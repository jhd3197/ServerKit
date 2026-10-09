import { Link } from 'react-router-dom';
import { Trans } from 'react-i18next';
import { SiGithub, SiGitlab, SiGitea, SiBitbucket } from 'react-icons/si';
import api from '../../services/api';

// Provider behaviour for RepoPicker (plan 79 G1). Everything visual lives in
// the component; these describe only what actually differs between providers —
// which API to call, how a clone URL is shaped, and what to say when the
// provider is not usable yet.

const branchNames = (data) => (data.branches || []).map((b) => (typeof b === 'string' ? b : b.name));

/** OAuth-backed hosted providers: GitHub, GitLab, Bitbucket. */
function oauthProvider({ id, name, Icon, api: calls, cloneUrl }) {
    return {
        id,
        name,
        Icon,
        cloneUrl,
        getStatus: calls.status,
        listRepos: async (search) => (await calls.repos({ search, perPage: 80 })).repos || [],
        listBranches: async (fullName) => branchNames(await calls.branches(fullName)),

        isReady: (status) => Boolean(status?.configured && status?.connection),

        account: (status) => ({
            name: status.connection.display_name || status.connection.provider_username,
            detail: `@${status.connection.provider_username}`,
            avatarUrl: status.connection.avatar_url,
        }),

        unavailable: (status, t) => {
            if (!status?.configured) {
                // One key with the link inside it, not a prefix/suffix pair:
                // the link lands in a different place in the sentence in other
                // languages, and split keys cannot be reordered by a translator.
                return {
                    message: (
                        <Trans
                            i18nKey="git.picker.notConfigured"
                            defaults="Set up the {{provider}} connection in <0>Settings</0> to pick a repo in one click instead of pasting a URL."
                            values={{ provider: name }}
                            components={[<Link key="settings" to="/settings/connections" />]}
                        />
                    ),
                };
            }
            return {
                title: t('git.picker.connectTitle', 'Connect with {{provider}}', { provider: name }),
                message: t('git.picker.connectMessage',
                    'Authorize once, then choose a repository instead of pasting a URL.'),
                action: {
                    label: t('git.picker.connectAction', 'Connect {{provider}}', { provider: name }),
                    onClick: async () => {
                        try {
                            const redirectUri = `${window.location.origin}/connections/callback/${id}`;
                            sessionStorage.setItem(
                                'sourceConnectionReturnTo',
                                window.location.pathname + window.location.search,
                            );
                            const { auth_url } = await api.startSourceConnection(id, redirectUri);
                            window.location.href = auth_url;
                        } catch {
                            /* a retry surfaces the host's toast; nothing to do here */
                        }
                    },
                },
            };
        },
    };
}

export const githubProvider = oauthProvider({
    id: 'github',
    name: 'GitHub',
    Icon: SiGithub,
    cloneUrl: (repo) => repo.clone_url || `https://github.com/${repo.full_name}.git`,
    api: {
        status: () => api.getGithubSourceStatus(),
        repos: (params) => api.listGithubRepositories(params),
        branches: (fullName) => api.listGithubBranches(fullName),
    },
});

export const gitlabProvider = oauthProvider({
    id: 'gitlab',
    name: 'GitLab',
    Icon: SiGitlab,
    // GitLab's payload carries no clone_url, so it is built from full_name.
    cloneUrl: (repo) => `https://gitlab.com/${repo.full_name}.git`,
    api: {
        status: () => api.getGitlabSourceStatus(),
        repos: (params) => api.listGitlabRepositories(params),
        branches: (fullName) => api.listGitlabBranches(fullName),
    },
});

export const bitbucketProvider = oauthProvider({
    id: 'bitbucket',
    name: 'Bitbucket',
    Icon: SiBitbucket,
    cloneUrl: (repo) => repo.clone_url || `https://bitbucket.org/${repo.full_name}.git`,
    api: {
        status: () => api.getBitbucketSourceStatus(),
        repos: (params) => api.listBitbucketRepositories(params),
        branches: (fullName) => api.listBitbucketBranches(fullName),
    },
});

/**
 * Gitea is the local one: no OAuth, so readiness is installed+running rather
 * than configured+connected, and the branch API takes owner and repo
 * separately. It is why the contract asks providers for `isReady` instead of
 * assuming a connection object.
 */
export const giteaProvider = {
    id: 'gitea',
    name: 'Gitea',
    Icon: SiGitea,
    cloneUrl: (repo) => repo.clone_url || repo.html_url || repo.ssh_url || '',

    getStatus: () => api.getGiteaStatus(),

    listRepos: async (search) => {
        const data = await api.getGiteaRepositories(200);
        const list = data.repositories || data.repos || [];
        const query = search.trim().toLowerCase();
        if (!query) return list;
        return list.filter((repo) => (repo.full_name || repo.name || '').toLowerCase().includes(query));
    },

    listBranches: async (fullName) => {
        const parts = (fullName || '').split('/');
        if (parts.length < 2) return [];
        return branchNames(await api.getGiteaBranches(parts[0], parts.slice(1).join('/')));
    },

    isReady: (status) => Boolean(status?.installed && status?.running),

    account: (status, t) => ({
        name: t('git.picker.giteaAccount', 'Local Gitea'),
        detail: t('git.picker.giteaDetail', 'Repositories on the panel server'),
    }),

    unavailable: (status) => {
        if (!status?.installed) {
            return {
                message: (
                    <Trans
                        i18nKey="git.picker.giteaNotInstalled"
                        defaults="Install the ServerKit Git server in <0>Git</0> to pick a local repository instead of pasting a URL."
                        components={[<Link key="git" to="/git" />]}
                    />
                ),
            };
        }
        return {
            message: (
                <Trans
                    i18nKey="git.picker.giteaNotRunning"
                    defaults="Your Gitea server is installed but not running. Start it from <0>Git</0>."
                    components={[<Link key="git" to="/git" />]}
                />
            ),
        };
    },
};
