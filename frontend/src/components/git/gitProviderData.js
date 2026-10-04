import { SiGithub, SiGitlab, SiBitbucket, SiGitea } from 'react-icons/si';
import { GitBranch } from 'lucide-react';

// Ordered list rendered in the provider strip. `match` recognizes a clone URL's
// host; the trailing "other" entry is the catch-all (self-hosted, SSH, anything
// unrecognized).
// `oauth` marks hosts that support a one-click connection (a backend OAuth app);
// `placeholder` is the URL hint shown when that provider is chosen.
export const GIT_PROVIDERS = [
    { key: 'github', labelKey: 'app.gitProviders.github', label: 'GitHub', Icon: SiGithub, hintKey: 'app.gitProviders.oneClickOrUrl', hint: 'One-click or URL', match: /github\.com/i, oauth: true, placeholder: 'https://github.com/user/repo.git' },
    { key: 'gitlab', labelKey: 'app.gitProviders.gitlab', label: 'GitLab', Icon: SiGitlab, hintKey: 'app.gitProviders.cloudOrSelfManaged', hint: 'Cloud or self-managed', match: /gitlab\./i, oauth: true, placeholder: 'https://gitlab.com/group/project.git' },
    { key: 'bitbucket', labelKey: 'app.gitProviders.bitbucket', label: 'Bitbucket', Icon: SiBitbucket, hintKey: 'app.gitProviders.oneClickOrUrl', hint: 'One-click or URL', match: /bitbucket\.org/i, oauth: true, placeholder: 'https://bitbucket.org/user/repo.git' },
    { key: 'gitea', labelKey: 'app.gitProviders.gitea', label: 'Gitea', Icon: SiGitea, hintKey: 'app.gitProviders.selfHosted', hint: 'Self-hosted', match: /gitea/i, local: true, placeholder: 'https://gitea.example.com/user/repo.git' },
    { key: 'other', labelKey: 'app.gitProviders.sshOther', label: 'SSH / other', Icon: GitBranch, hintKey: 'app.gitProviders.anyGitRemote', hint: 'Any Git remote', match: null, placeholder: 'git@host:user/repo.git' },
];

const OTHER_PROVIDER = GIT_PROVIDERS[GIT_PROVIDERS.length - 1];

// Resolve a clone URL to a provider. Returns null for an empty field (so callers
// can render a neutral, nothing-detected state) and the "other" catch-all when a
// non-empty URL matches no known host.
export function detectProvider(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) return null;
    return GIT_PROVIDERS.find((p) => p.match && p.match.test(trimmed)) || OTHER_PROVIDER;
}
