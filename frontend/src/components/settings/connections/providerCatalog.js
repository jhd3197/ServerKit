// The Connections catalog — the declarative source of truth for the integrations
// hub. Each provider belongs to a category and maps to a backend by its `kind`:
//   - kind 'source'    → /source-connections   (per-user OAuth: GitHub, GitLab)
//   - kind 'cloud'     → /cloud                 (server provisioning: DO, Hetzner, Vultr, Linode)
//   - kind 'dns'       → /email/dns-providers   (records + wildcard TLS: Cloudflare, Route 53, DO, GoDaddy)
//   - kind 'registrar' → /registrars            (domain ownership + expiry: GoDaddy)
//   - kind 'storage'   → /backups/storage       (offsite backups: S3-compatible, Backblaze B2)
// `comingSoon: true` renders a dimmed, actionless tile so the catalog reads as a
// complete surface. `manageHref` is the in-app page a live connection powers,
// surfaced as a quiet cross-link on the card.

export const CONNECTION_CATEGORIES = [
    { key: 'source', labelKey: 'app.providerCatalog.sourceCode', label: 'Source code', blurb: 'Create services straight from a repository instead of pasting clone URLs.' },
    { key: 'infra', labelKey: 'app.providerCatalog.infrastructure', label: 'Infrastructure', blurb: 'Cloud accounts ServerKit can provision and manage servers in.' },
    { key: 'registry', labelKey: 'app.providerCatalog.containerRegistries', label: 'Container registries', blurb: 'Store a login once so ServerKit can pull private images (GHCR, Docker Hub, GitLab, ECR).' },
    { key: 'dns', labelKey: 'app.providerCatalog.dnsDomains', label: 'DNS and domains', blurb: 'Let ServerKit manage DNS records and issue wildcard certificates automatically.' },
    { key: 'registrar', labelKey: 'app.providerCatalog.registrarsOwnership', label: 'Registrars and ownership', blurb: 'Track the domains you own and when their registration expires.' },
    { key: 'email', labelKey: 'app.providerCatalog.emailDelivery', label: 'Email and delivery', blurb: 'Outbound relays and deliverability for the mail server.' },
    { key: 'chat', labelKey: 'app.providerCatalog.chatWebhooks', label: 'Chat and webhooks', blurb: 'Send notifications to a shared chat room or webhook, filtered by category.' },
    { key: 'storage', labelKey: 'app.providerCatalog.storageBackups', label: 'Storage and backups', blurb: 'Off-site destinations for backups and large assets.' },
];

export const CONNECTION_PROVIDERS = [
    // ── Source code ──
    {
        id: 'github', category: 'source', name: 'GitHub', kind: 'source', provider: 'github',
        blurb: 'List repositories over the GitHub API and import selected branches.',
        docUrl: 'https://github.com/settings/developers', manageHref: '/services/new',
    },
    {
        id: 'gitlab', category: 'source', name: 'GitLab', kind: 'source', provider: 'gitlab',
        blurb: 'Cloud GitLab repositories, imported the same way as GitHub.',
        docUrl: 'https://gitlab.com/-/profile/applications', manageHref: '/services/new',
    },
    {
        id: 'bitbucket', category: 'source', name: 'Bitbucket', kind: 'source', provider: 'bitbucket',
        blurb: 'Bitbucket Cloud repositories, imported the same way as GitHub.',
        docUrl: 'https://bitbucket.org/[workspace]/workspace/settings/oauth-consumers/new', manageHref: '/services/new',
    },

    // ── Infrastructure (cloud servers) ──
    {
        id: 'digitalocean', category: 'infra', name: 'DigitalOcean', kind: 'cloud', providerType: 'digitalocean',
        blurb: 'Provision and manage droplets as servers in your fleet.',
        docUrl: 'https://cloud.digitalocean.com/account/api/tokens', manageHref: '/servers',
    },
    {
        id: 'hetzner', category: 'infra', name: 'Hetzner Cloud', kind: 'cloud', providerType: 'hetzner',
        blurb: 'Provision and manage Hetzner Cloud servers.',
        docUrl: 'https://console.hetzner.cloud/', manageHref: '/servers',
    },
    {
        id: 'vultr', category: 'infra', name: 'Vultr', kind: 'cloud', providerType: 'vultr',
        blurb: 'Provision and manage Vultr instances.',
        docUrl: 'https://my.vultr.com/settings/#settingsapi', manageHref: '/servers',
    },
    {
        id: 'linode', category: 'infra', name: 'Linode', kind: 'cloud', providerType: 'linode',
        blurb: 'Provision and manage Linodes (Akamai).',
        docUrl: 'https://cloud.linode.com/profile/tokens', manageHref: '/servers',
    },

    // ── Container registries ──
    // One card holds every registry; the add modal has a provider selector
    // (GHCR / Docker Hub / GitLab / ECR / generic) that presets the login host.
    {
        id: 'container_registry', category: 'registry', name: 'Container registry', kind: 'registry',
        blurb: 'Store credentials for a private registry so services can deploy its images.',
        docUrl: 'https://docs.docker.com/engine/reference/commandline/login/', manageHref: '/services/new',
    },

    // ── DNS & domains ──
    {
        id: 'cloudflare', category: 'dns', name: 'Cloudflare', kind: 'dns', provider: 'cloudflare', supportsScope: true,
        blurb: 'Auto-create DNS records and wildcard TLS for the domains you manage.',
        docUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    },
    {
        id: 'route53', category: 'dns', name: 'Route 53', kind: 'dns', provider: 'route53',
        blurb: 'Manage records in AWS hosted zones with an access-key pair.',
        docUrl: 'https://console.aws.amazon.com/iam/home#/security_credentials',
    },
    {
        id: 'digitalocean_dns', category: 'dns', name: 'DigitalOcean DNS', kind: 'dns', provider: 'digitalocean',
        blurb: 'Manage records in DigitalOcean-hosted domains with an API token.',
        docUrl: 'https://cloud.digitalocean.com/account/api/tokens',
    },
    {
        id: 'godaddy_dns', category: 'dns', name: 'GoDaddy DNS', kind: 'dns', provider: 'godaddy',
        blurb: 'Manage DNS records in GoDaddy-hosted domains.',
        docUrl: 'https://developer.godaddy.com/keys',
    },

    // ── Registrars & ownership ──
    {
        id: 'godaddy', category: 'registrar', name: 'GoDaddy', kind: 'registrar', provider: 'godaddy',
        blurb: 'Track domains you own at GoDaddy and when they expire.',
        docUrl: 'https://developer.godaddy.com/keys', manageHref: '/domains',
    },
    {
        id: 'namecheap', category: 'registrar', name: 'Namecheap', kind: 'registrar', provider: 'namecheap',
        blurb: 'Track domains you own at Namecheap and when they expire.',
        docUrl: 'https://ap.www.namecheap.com/settings/tools/apiaccess/', manageHref: '/domains',
    },

    // ── Email & delivery ──
    {
        id: 'smtp', category: 'email', name: 'SMTP relay', kind: 'email',
        blurb: 'Send outbound mail through a provider like Postmark, SES or Mailgun.',
    },

    // ── Chat & webhooks ──
    // Org-level notification destinations. One card per kind; each holds many
    // connections (e.g. an #ops room and a #security room), routed by category.
    {
        id: 'chat_discord', category: 'chat', name: 'Discord', kind: 'chatwebhook', chatKind: 'discord',
        blurb: 'Post notifications to a Discord channel via an incoming webhook.',
        docUrl: 'https://support.discord.com/hc/en-us/articles/228383668', manageHref: '/settings/notifications',
    },
    {
        id: 'chat_slack', category: 'chat', name: 'Slack', kind: 'chatwebhook', chatKind: 'slack',
        blurb: 'Post notifications to a Slack channel via an incoming webhook.',
        docUrl: 'https://api.slack.com/messaging/webhooks', manageHref: '/settings/notifications',
    },
    {
        id: 'chat_telegram', category: 'chat', name: 'Telegram', kind: 'chatwebhook', chatKind: 'telegram',
        blurb: 'Send notifications to a Telegram chat through a bot.',
        docUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot', manageHref: '/settings/notifications',
    },
    {
        id: 'chat_webhook', category: 'chat', name: 'Generic webhook', kind: 'chatwebhook', chatKind: 'webhook',
        blurb: 'POST a signed JSON payload to any endpoint. Optional HMAC signature.',
        docUrl: null, manageHref: '/settings/notifications',
    },

    // ── Storage & backups ──
    {
        id: 's3', category: 'storage', name: 'S3 / object storage', kind: 'storage', storageProvider: 's3',
        blurb: 'Stream backups to any S3-compatible bucket (AWS, Wasabi, MinIO, Spaces).',
        docUrl: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html', manageHref: '/backups',
    },
    {
        id: 'b2', category: 'storage', name: 'Backblaze B2', kind: 'storage', storageProvider: 'b2',
        blurb: 'Stream backups to a Backblaze B2 bucket via its S3 endpoint.',
        docUrl: 'https://www.backblaze.com/docs/cloud-storage-application-keys', manageHref: '/backups',
    },
];

export function getProvider(id) {
    return CONNECTION_PROVIDERS.find((p) => p.id === id) || null;
}

// Container-registry provider presets for the add-registry form. `url` presets
// the login host; `usernameHint`/`secretHint` label the credential fields per
// provider. `urlLocked` means the host is fixed (Docker Hub / GHCR); a generic
// registry lets the operator type any host.
export const REGISTRY_PROVIDERS = [
    { id: 'ghcr', name: 'GitHub (GHCR)', url: 'ghcr.io', urlLocked: true, usernameHint: 'GitHub username', secretHint: 'Personal access token (read:packages)' },
    { id: 'dockerhub', name: 'Docker Hub', url: '', urlLocked: true, usernameHint: 'Docker Hub username', secretHint: 'Access token or password' },
    { id: 'gitlab', name: 'GitLab', url: 'registry.gitlab.com', urlLocked: false, usernameHint: 'GitLab username', secretHint: 'Deploy token or PAT (read_registry)' },
    { id: 'ecr', name: 'AWS ECR', url: '', urlLocked: false, usernameHint: 'Leave blank (uses AWS)', secretHint: 'ACCESS_KEY_ID:SECRET_ACCESS_KEY' },
    { id: 'generic', name: 'Other / generic', url: '', urlLocked: false, usernameHint: 'Registry username', secretHint: 'Password or token' },
];

// Access-level ("scope") derivation for DNS-provider records. Cloudflare with an
// account email uses a Global API Key (full account); without one it's a scoped
// token. Route 53 / GoDaddy keys derive scope from IAM / account policy we can't
// introspect, so they're labeled neutrally. DigitalOcean uses a single token.
// Returns { label, tone, hint } or null.
export function deriveScope(record) {
    if (!record) return null;
    if (record.provider === 'cloudflare') {
        return record.api_email
            ? { labelKey: 'app.providerCatalog.globalKey', label: 'Global key', tone: 'warn', hintKey: 'app.providerCatalog.fullAccountAccess', hint: 'Full account access' }
            : { labelKey: 'app.providerCatalog.scopedToken', label: 'Scoped token', tone: 'ok', hintKey: 'app.providerCatalog.leastPrivilege', hint: 'Least privilege' };
    }
    if (record.provider === 'route53') {
        return { labelKey: 'app.providerCatalog.accessKey', label: 'Access key', tone: 'neutral', hintKey: 'app.providerCatalog.scopeSetByIamPolicy', hint: 'Scope set by IAM policy' };
    }
    if (record.provider === 'digitalocean') {
        return { labelKey: 'app.providerCatalog.apiToken', label: 'API token', tone: 'ok', hintKey: 'app.providerCatalog.digitaloceanPersonalAccessToken', hint: 'DigitalOcean personal access token' };
    }
    if (record.provider === 'godaddy') {
        return { labelKey: 'app.providerCatalog.apiKey', label: 'API key', tone: 'neutral', hintKey: 'app.providerCatalog.godaddyAccountApiKey', hint: 'GoDaddy account API key' };
    }
    return null;
}

// Collapse a list of scope descriptors to unique labels so a card with three
// scoped tokens shows one "Scoped token" chip, not three.
export function dedupeScopes(scopes) {
    const seen = new Set();
    const out = [];
    for (const s of scopes) {
        if (!s || seen.has(s.label)) continue;
        seen.add(s.label);
        out.push(s);
    }
    return out;
}
