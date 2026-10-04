import { useState, useEffect, useMemo } from 'react';
import {
    ShieldCheck, RefreshCw, Plus, Lock, MoreVertical,
    Settings, Download, Upload,
} from 'lucide-react';
import api from '../services/api';
import Modal from '@/components/Modal';
import { Pill, SearchField } from '@/components/ds';
import ResourceListPage from '../components/layouts/ResourceListPage';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import DomainField from '../components/DomainField';
import { formatExpiry } from '../utils/expiry';
import { useTranslation } from 'react-i18next';

const DAY = 86400000;

// The same horizon the backend's `openssl x509 -checkend 2592000` uses, so the
// Status column and /ssl/status can never disagree about what "expiring" means.
const EXPIRING_DAYS = 30;

const STATE_KIND = {
    valid: 'green',
    expiring: 'amber',
    expired: 'red',
    unknown: 'gray',
};

// Neither expiry string the API returns is ISO-8601: certbot prints
// "2024-03-15 12:00:00+00:00" and the custom-cert walker strftimes
// "%Y-%m-%d %H:%M:%S%z" ("+0000"). Normalise once, here, or every Date the
// column builds is browser-dependent.
function certExpiryIso(raw) {
    if (!raw) return null;
    const iso = String(raw).trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// A certbot cert carries no issuer field — certbot is only ever pointed at its
// default ACME server, so the CA is known. An uploaded cert does carry one, as
// an RFC 4514 string ("CN=…,O=…"), of which only the common name is readable.
function issuerLabel(cert) {
    if (!cert.issuer) return "Let's Encrypt";
    const cn = /(?:^|,)\s*CN=([^,]+)/.exec(cert.issuer)?.[1]
        || /(?:^|,)\s*O=([^,]+)/.exec(cert.issuer)?.[1];
    return (cn || cert.issuer).replace(/\\,/g, ',').trim();
}

const STATE = (...value) => ({ match: 'all', rules: [{ id: 'ss', field: 'state', op: 'any', value }] });

// Built-in saved views — the three questions this page gets opened to answer.
// They are presets over the Status column's own rules, so each one shows a live
// count, combines with a search and can be tweaked and saved as your own.
const SSL_BUILTIN_VIEWS = [
    {
        // The one that matters: what will break if nobody touches it this month.
        name: 'Expiring soon',
        state: {
            search: '', groupBy: null, hiddenKeys: [],
            sorts: [{ key: 'expiresAt', direction: 'asc' }],
            columnFilters: STATE('expiring'),
        },
    },
    {
        name: 'Valid',
        state: {
            search: '', groupBy: null, hiddenKeys: [],
            sorts: [{ key: 'expiresAt', direction: 'desc' }],
            columnFilters: STATE('valid'),
        },
    },
    {
        // A cert certbot reports as INVALID and one whose expiry we could not
        // read at all are the same operational fact — the domain is serving
        // nothing usable — so they share a worklist instead of each getting one.
        name: 'Failed or missing',
        state: {
            search: '', groupBy: null, hiddenKeys: [],
            sorts: [{ key: 'name', direction: 'asc' }],
            columnFilters: STATE('expired', 'unknown'),
        },
    },
];

const SSLCertificates = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [renewingDomain, setRenewingDomain] = useState(null);
    const [search, setSearch] = useState('');

    // Modal states
    const [showObtainModal, setShowObtainModal] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);

    // Form states — Obtain (HTTP-01 or wildcard DNS-01)
    const [domains, setDomains] = useState('');
    const [email, setEmail] = useState('');
    const [useNginx, setUseNginx] = useState(true);
    const [webrootPath, setWebrootPath] = useState('');
    const [wildcard, setWildcard] = useState(false);
    const [dnsProvider, setDnsProvider] = useState('cloudflare');
    const [dnsToken, setDnsToken] = useState('');
    const [awsAccessKey, setAwsAccessKey] = useState('');
    const [awsSecretKey, setAwsSecretKey] = useState('');

    // Form states — Upload custom certificate
    const [uploadDomain, setUploadDomain] = useState('');
    const [uploadCert, setUploadCert] = useState('');
    const [uploadKey, setUploadKey] = useState('');
    const [uploadChain, setUploadChain] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const data = await api.getSSLStatus();
            setStatus(data);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleObtainCertificate(e) {
        e.preventDefault();
        const domainList = domains.split(',').map(d => d.trim()).filter(Boolean);
        if (domainList.length === 0) return;

        try {
            setActionLoading(true);
            let result;
            if (wildcard) {
                // Wildcard certs need DNS-01 validation via a DNS provider.
                const credentials = dnsProvider === 'cloudflare'
                    ? { dns_cloudflare_api_token: dnsToken }
                    : { aws_access_key_id: awsAccessKey, aws_secret_access_key: awsSecretKey };
                result = await api.issueWildcardCert(domainList[0], dnsProvider, credentials);
            } else {
                if (!email) return;
                const data = { domains: domainList, email, use_nginx: useNginx };
                if (!useNginx && webrootPath) data.webroot_path = webrootPath;
                result = await api.obtainCertificate(data);
            }
            if (result.success) {
                toast.success(wildcard ? t('app.sSLCertificates.wildcardCertificateIssued', 'Wildcard certificate issued') : t('app.sSLCertificates.certificateObtainedSuccessfully', 'Certificate obtained'));
                setShowObtainModal(false);
                setDomains('');
                setEmail('');
                setDnsToken('');
                setAwsAccessKey('');
                setAwsSecretKey('');
                setWildcard(false);
                loadData();
            } else {
                toast.error(result.error || t('app.sSLCertificates.failedToObtainCertificate', 'Failed to obtain certificate'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.failedToObtainCertificate', 'Failed to obtain certificate'));
        } finally {
            setActionLoading(false);
        }
    }

    async function handleUploadCertificate(e) {
        e.preventDefault();
        if (!uploadDomain || !uploadCert || !uploadKey) return;
        try {
            setActionLoading(true);
            const result = await api.uploadCustomCert(uploadDomain.trim(), uploadCert, uploadKey, uploadChain || null);
            // upload returns the saved cert paths (no `success` envelope).
            if (result && (result.cert_path || result.success)) {
                toast.success(t('app.sSLCertificates.certificateUploadedFor', 'Certificate uploaded for {{uploadDomain}}', { uploadDomain: uploadDomain }));
                setShowUploadModal(false);
                setUploadDomain('');
                setUploadCert('');
                setUploadKey('');
                setUploadChain('');
                loadData();
            } else {
                toast.error(result?.error || t('app.sSLCertificates.failedToUploadCertificate', 'Failed to upload certificate'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.failedToUploadCertificate', 'Failed to upload certificate'));
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRenewCertificate(domain) {
        try {
            setRenewingDomain(domain);
            const result = await api.renewCertificate(domain);
            if (result.success) {
                toast.success(t('app.sSLCertificates.certificateForRenewed', 'Certificate for {{domain}} renewed', { domain: domain }));
                loadData();
            } else {
                toast.error(result.error || t('app.sSLCertificates.renewalFailed', 'Renewal failed'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.renewalFailed', 'Renewal failed'));
        } finally {
            setRenewingDomain(null);
        }
    }

    async function handleRenewAll() {
        try {
            setActionLoading(true);
            const result = await api.renewAllCertificates();
            if (result.success) {
                toast.success(t('app.sSLCertificates.allCertificatesRenewed', 'All certificates renewed'));
                loadData();
            } else {
                toast.error(result.error || t('app.sSLCertificates.renewalFailed', 'Renewal failed'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.renewalFailed', 'Renewal failed'));
        } finally {
            setActionLoading(false);
        }
    }

    async function handleRevokeCertificate(domain) {
        const confirmed = await confirm({ title: t('app.sSLCertificates.revokeCertificate', 'Revoke certificate'), message: t('app.sSLCertificates.revokeAndDeleteTheCertificateFor', 'Revoke and delete the certificate for {{domain}}? This cannot be undone.', { domain: domain }) });
        if (!confirmed) return;

        try {
            setActionLoading(true);
            const result = await api.revokeCertificate(domain);
            if (result.success) {
                toast.success(t('app.sSLCertificates.certificateForRevoked', 'Certificate for {{domain}} revoked', { domain: domain }));
                loadData();
            } else {
                toast.error(result.error || t('app.sSLCertificates.revocationFailed', 'Revocation failed'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.revocationFailed', 'Revocation failed'));
        } finally {
            setActionLoading(false);
        }
    }

    async function handleSetupAutoRenewal() {
        try {
            setActionLoading(true);
            const result = await api.setupAutoRenewal();
            if (result.success) {
                toast.success(result.message || t('app.sSLCertificates.autoRenewalConfigured', 'Auto-renewal configured'));
            } else {
                toast.error(result.error || t('app.sSLCertificates.failedToSetupAutoRenewal', 'Failed to setup auto-renewal'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.failedToSetupAutoRenewal', 'Failed to setup auto-renewal'));
        } finally {
            setActionLoading(false);
        }
    }

    async function handleInstallCertbot() {
        try {
            setActionLoading(true);
            toast.info(t('app.sSLCertificates.installingCertbotThisMayTakeA', 'Installing Certbot… This may take a moment.'));
            const result = await api.installCertbot();
            if (result.success) {
                toast.success(t('app.sSLCertificates.certbotInstalledSuccessfully', 'Certbot installed'));
                loadData();
            } else {
                toast.error(result.error || t('app.sSLCertificates.failedToInstallCertbot', 'Failed to install Certbot'));
            }
        } catch (err) {
            toast.error(err.message || t('app.sSLCertificates.failedToInstallCertbot', 'Failed to install Certbot'));
        } finally {
            setActionLoading(false);
        }
    }

    const certbotInstalled = status?.certbot_installed ?? false;
    // Only a status the server actually returned can say Certbot is missing;
    // a failed request must not turn into an "Install Certbot" prompt.
    const certbotMissing = status != null && !certbotInstalled;

    // Every derived field lands on the row itself rather than in a column
    // accessor: the table renders `row[key]` when a column has no `render`, and
    // a filter rule that reads one thing while the cell shows another is how a
    // view ends up matching rows the eye says it shouldn't.
    const certificates = useMemo(() => {
        // The backend flags "expiring" by running openssl against
        // /etc/letsencrypt/live, so an uploaded cert is never in that list —
        // the date-derived horizon below is what covers those.
        const flagged = new Set(status?.expiring_soon || []);
        return (status?.certificates || []).map((cert) => {
            const source = cert.source || 'certbot';
            const expiresAt = certExpiryIso(cert.expiry);
            const days = expiresAt == null
                ? null
                : Math.round((new Date(expiresAt).getTime() - Date.now()) / DAY);

            let state;
            if (cert.expiry_valid === false || (days != null && days < 0)) state = 'expired';
            else if (days == null) state = 'unknown';
            else if (days <= EXPIRING_DAYS || flagged.has(cert.name)) state = 'expiring';
            else state = 'valid';

            return {
                ...cert,
                // certbot and the custom-cert dir can both hold a `example.com`,
                // so the name alone is not a key.
                id: `${source}:${cert.name}`,
                source,
                expiresAt,
                state,
                issuedBy: issuerLabel(cert),
                // certbot re-issues from its own renewal config; an uploaded
                // cert has none anywhere, so that one is on the operator.
                renewal: source === 'certbot' ? 'certbot' : 'manual',
            };
        });
    }, [status]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return certificates;
        return certificates.filter((c) => (
            c.name?.toLowerCase().includes(q)
            || c.issuedBy?.toLowerCase().includes(q)
            || (c.domains || []).some((d) => d.toLowerCase().includes(q))
        ));
    }, [certificates, search]);

    const columns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'common.labels.domain', header: 'Domain',
            sortable: true,
            hideable: false,
            value: (c) => c.name,
            render: (c) => {
                const extra = (c.domains || []).filter((d) => d !== c.name);
                const sub = [c.badge, extra.join(', ')].filter(Boolean).join(' · ');
                return (
                    <div className="sk-cell-name">
                        {/* The tile carries the state too. A fixed green shield
                            next to an expired certificate is the row telling
                            you the opposite of what its Status cell says. */}
                        <span className={`ssl-row__ico is-${c.state}`}><ShieldCheck size={15} /></span>
                        <span>
                            <div>{c.name}</div>
                            {sub && <div className="sk-cell-sub">{sub}</div>}
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'issuedBy',
            headerKey: 'app.sSLCertificates.issuer', header: 'Issuer',
            type: 'enum',
            sortable: true,
            width: 200,
        },
        {
            key: 'state',
            headerKey: 'common.labels.status', header: 'Status',
            type: 'enum',
            sortable: true,
            groupable: true,
            width: 130,
            enumOrder: ['valid', 'expiring', 'expired', 'unknown'],
            render: (c) => <Pill kind={STATE_KIND[c.state]}>{c.state}</Pill>,
        },
        {
            key: 'expiresAt',
            headerKey: 'app.sSLCertificates.expires', header: 'Expires',
            type: 'date',
            sortable: true,
            width: 165,
            render: (c) => {
                const exp = formatExpiry(c.expiresAt);
                if (!exp) return <span className="ssl-dash">—</span>;
                // The relative form is what you judge a cert by; the exact
                // moment is one hover away for when you need to plan around it.
                return (
                    <span
                        className={`ssl-expiry ssl-expiry--${exp.tone}`}
                        title={new Date(c.expiresAt).toLocaleString()}
                    >
                        {exp.relative}
                    </span>
                );
            },
        },
        {
            key: 'renewal',
            headerKey: 'app.sSLCertificates.autoRenew', header: 'Auto-renew',
            type: 'enum',
            sortable: true,
            width: 145,
            enumOrder: ['certbot', 'manual'],
            render: (c) => (c.renewal === 'certbot'
                ? <Pill kind="green" title={t('app.sSLCertificates.reissuedByCertbotSetTheTimer', 'Reissued by certbot. Set up the timer with Auto-renew')}>certbot</Pill>
                : <Pill kind="gray" title={t('app.sSLCertificates.uploadedByHandReUploadIt', 'Uploaded by hand. Re-upload it before it expires')}>manual</Pill>),
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            width: 56,
            className: 'text-right',
            render: (c) => {
                const renewing = renewingDomain === c.name;
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" disabled={renewing || actionLoading}>
                                {renewing ? <RefreshCw size={14} className="spin" /> : <MoreVertical size={14} />}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleRenewCertificate(c.name)}>
                                {t('app.sSLCertificates.renewNow', 'Renew now')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleRevokeCertificate(c.name)}
                            >
                                {t('app.sSLCertificates.revokeDelete', 'Revoke and delete')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [renewingDomain, actionLoading]);

    // Install Certbot only shows when it is missing — the certbot-only actions
    // next to it are disabled in that state, so the bar always offers the one
    // thing that can be done. Search goes last: the fixed bar order is
    // [page actions] [search] [filter] [⋮], and the table hoists the last two.
    useTopbarActions(() => (
        <>
            {certbotMissing && (
                <Button size="sm" onClick={handleInstallCertbot} disabled={actionLoading}>
                    <Download size={15} />
                    {t('app.sSLCertificates.installCertbot', 'Install Certbot')}
                </Button>
            )}
            <Button
                variant="outline"
                size="sm"
                onClick={handleSetupAutoRenewal}
                disabled={actionLoading || !certbotInstalled}
                title={t('app.sSLCertificates.configureAutomaticRenewalViaSystemdOr', 'Configure automatic renewal via systemd or cron')}
            >
                <Settings size={15} />
                {t('app.sSLCertificates.autoRenew2', 'Auto-renew')}
            </Button>
            {certificates.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleRenewAll} disabled={actionLoading}>
                    <RefreshCw size={15} />
                    {t('app.sSLCertificates.renewAll', 'Renew all')}
                </Button>
            )}
            <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw size={15} />
                {t('common.actions.refresh', 'Refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowUploadModal(true)}>
                <Upload size={15} />
                {t('app.sSLCertificates.upload', 'Upload')}
            </Button>
            <Button size="sm" onClick={() => setShowObtainModal(true)} disabled={!certbotInstalled}>
                <Plus size={15} />
                {t('app.sSLCertificates.newCertificate', 'New certificate')}
            </Button>
            <SearchField value={search} onSearch={setSearch} placeholder={t('app.sSLCertificates.searchCertificates', 'Search certificates…')} />
        </>
    ), [actionLoading, certbotInstalled, certbotMissing, certificates.length, search]);

    return (
        <>
            <ResourceListPage
                className="ssl-page"
                loading={loading}
                loadingTitle="Loading certificates…"
                storageKey="serverkit-list-ssl"
                viewPageKey="ssl"
                noun="certificates"
                builtinViews={SSL_BUILTIN_VIEWS}
                totalCount={certificates.length}
                error={loadError}
                errorTitle={t('app.sSLCertificates.couldntLoadCertificates', "Couldn't load certificates")}
                onRetry={loadData}
                items={rows}
                columns={columns}
                keyField="id"
                searchTerm={search}
                onSearchChange={setSearch}
                searchInTopbar
                emptyIcon={Lock}
                emptyTitle="No SSL certificates"
                emptyDescription="Obtain your first Let's Encrypt certificate to secure your domains."
                emptyAction={certbotInstalled ? (
                    <Button onClick={() => setShowObtainModal(true)}>
                        <Plus size={16} />
                        {t('app.sSLCertificates.newCertificate', 'New certificate')}
                    </Button>
                ) : (
                    <Button onClick={handleInstallCertbot} disabled={actionLoading}>
                        <Download size={16} />
                        {t('app.sSLCertificates.installCertbotFirst', 'Install Certbot first')}
                    </Button>
                )}
                filteredEmptyIcon={Lock}
                filteredEmptyTitle="No certificates found"
                filteredEmptyDescription="Try adjusting your search or filters."
            />

            {/* Obtain Certificate Modal */}
            <Modal open={showObtainModal} onClose={() => setShowObtainModal(false)} title={t('app.sSLCertificates.obtainSslCertificate', 'Obtain SSL certificate')}>
                        <form onSubmit={handleObtainCertificate}>
                            <div className="ssl-info-box">
                                <ShieldCheck size={32} />
                                <div>
                                    <h4>{t('app.sSLCertificates.freeSslFromLetSEncrypt', 'Free SSL from Let\'s Encrypt')}</h4>
                                    <p>{t('app.sSLCertificates.obtainAFreeAutomaticallyRenewedSsl', 'Obtain a free, automatically-renewed SSL certificate for your domains.')}</p>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="checkbox-label">
                                    <Checkbox
                                        checked={wildcard}
                                        onCheckedChange={setWildcard}
                                    />
                                    {t('app.sSLCertificates.wildcardCertificateDns01Validation', 'Wildcard certificate (DNS-01 validation)')}
                                </label>
                                <p className="hint">{t('app.sSLCertificates.issues', 'Issues')} <code>domain</code> + <code>*.domain</code> {t('app.sSLCertificates.viaYourDnsProvider', 'via your DNS provider.')}</p>
                            </div>
                            <div className="form-group">
                                <Label htmlFor="ssl-domains">{wildcard ? 'Base Domain' : 'Domains'}</Label>
                                {/* A wildcard cert covers one base domain; HTTP-01
                                    takes a comma-separated list, so it keeps a plain input. */}
                                {wildcard ? (
                                    <DomainField
                                        id="ssl-domains"
                                        modes={['custom']}
                                        value={domains}
                                        onChange={(fqdn) => setDomains(fqdn)}
                                    />
                                ) : (
                                    <Input
                                        id="ssl-domains"
                                        type="text"
                                        placeholder={t('app.sSLCertificates.exampleComWwwExampleCom', 'example.com, www.example.com')}
                                        value={domains}
                                        onChange={e => setDomains(e.target.value)}
                                        required
                                    />
                                )}
                                <p className="hint">{wildcard ? 'A single base domain for the wildcard cert' : 'Comma-separated list of domains'}</p>
                            </div>
                            {!wildcard && (
                                <>
                                    <div className="form-group">
                                        <Label>{t('app.sSLCertificates.emailAddress', 'Email address')}</Label>
                                        <Input
                                            type="email"
                                            placeholder="admin@example.com"
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                            required={!wildcard}
                                        />
                                        <p className="hint">{t('app.sSLCertificates.forCertificateExpirationNotifications', 'For certificate expiration notifications')}</p>
                                    </div>
                                    <div className="form-group">
                                        <label className="checkbox-label">
                                            <Checkbox
                                                checked={useNginx}
                                                onCheckedChange={setUseNginx}
                                            />
                                            {t('app.sSLCertificates.useNginxPluginRecommended', 'Use Nginx plugin (recommended)')}
                                        </label>
                                    </div>
                                    {!useNginx && (
                                        <div className="form-group">
                                            <Label>{t('app.sSLCertificates.webrootPath', 'Webroot path')}</Label>
                                            <Input
                                                type="text"
                                                placeholder="/var/www/html"
                                                value={webrootPath}
                                                onChange={e => setWebrootPath(e.target.value)}
                                                required={!useNginx}
                                            />
                                            <p className="hint">{t('app.sSLCertificates.documentRootForHttpValidation', 'Document root for HTTP validation')}</p>
                                        </div>
                                    )}
                                </>
                            )}
                            {wildcard && (
                                <>
                                    <div className="form-group">
                                        <Label htmlFor="ssl-dns-provider">{t('app.sSLCertificates.dnsProvider', 'DNS provider')}</Label>
                                        <Select value={dnsProvider} onValueChange={setDnsProvider}>
                                            <SelectTrigger id="ssl-dns-provider"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="cloudflare">{t('app.sSLCertificates.cloudflare', 'Cloudflare')}</SelectItem>
                                                <SelectItem value="route53">{t('app.sSLCertificates.awsRoute53', 'AWS Route 53')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {dnsProvider === 'cloudflare' ? (
                                        <div className="form-group">
                                            <Label>{t('app.sSLCertificates.cloudflareApiToken', 'Cloudflare API token')}</Label>
                                            <Input
                                                type="password"
                                                placeholder={t('app.sSLCertificates.apiTokenWithDnsEditRights', 'API token with DNS edit rights')}
                                                value={dnsToken}
                                                onChange={e => setDnsToken(e.target.value)}
                                                required={wildcard}
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="form-group">
                                                <Label>{t('app.sSLCertificates.awsAccessKeyId', 'AWS access key ID')}</Label>
                                                <Input
                                                    type="text"
                                                    value={awsAccessKey}
                                                    onChange={e => setAwsAccessKey(e.target.value)}
                                                    required={wildcard}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <Label>{t('app.sSLCertificates.awsSecretAccessKey', 'AWS secret access key')}</Label>
                                                <Input
                                                    type="password"
                                                    value={awsSecretKey}
                                                    onChange={e => setAwsSecretKey(e.target.value)}
                                                    required={wildcard}
                                                />
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                            <div className="modal-actions">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setShowObtainModal(false)}
                                >
                                    {t('common.actions.cancel', 'Cancel')}
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={actionLoading || (wildcard && !domains)}
                                >
                                    {actionLoading ? 'Obtaining...' : 'Obtain Certificate'}
                                </Button>
                            </div>
                        </form>
            </Modal>

            {/* Upload Custom Certificate Modal */}
            <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} title={t('app.sSLCertificates.uploadCustomCertificate', 'Upload custom certificate')}>
                <form onSubmit={handleUploadCertificate}>
                    <div className="ssl-info-box">
                        <Upload size={32} />
                        <div>
                            <h4>{t('app.sSLCertificates.bringYourOwnCertificate', 'Bring your own certificate')}</h4>
                            <p>{t('app.sSLCertificates.pasteAPemCertificatePrivateKey', 'Paste a PEM certificate, private key, and (optional) chain issued elsewhere.')}</p>
                        </div>
                    </div>
                    <div className="form-group">
                        <Label htmlFor="ssl-upload-domain">{t('common.labels.domain', 'Domain')}</Label>
                        <DomainField
                            id="ssl-upload-domain"
                            modes={['custom']}
                            value={uploadDomain}
                            onChange={(fqdn) => setUploadDomain(fqdn)}
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('app.sSLCertificates.certificatePem', 'Certificate (PEM)')}</Label>
                        <textarea
                            className="ui-textarea ssl-pem-input"
                            rows={5}
                            placeholder={t('app.sSLCertificates.beginCertificate', '-----BEGIN CERTIFICATE-----')}
                            value={uploadCert}
                            onChange={e => setUploadCert(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('app.sSLCertificates.privateKeyPem', 'Private key (PEM)')}</Label>
                        <textarea
                            className="ui-textarea ssl-pem-input"
                            rows={5}
                            placeholder={t('app.sSLCertificates.beginPrivateKey', '-----BEGIN PRIVATE KEY-----')}
                            value={uploadKey}
                            onChange={e => setUploadKey(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <Label>{t('app.sSLCertificates.chainPemOptional', 'Chain (PEM, optional)')}</Label>
                        <textarea
                            className="ui-textarea ssl-pem-input"
                            rows={4}
                            placeholder={t('app.sSLCertificates.beginCertificateIntermediateChain', '-----BEGIN CERTIFICATE----- (intermediate chain)')}
                            value={uploadChain}
                            onChange={e => setUploadChain(e.target.value)}
                        />
                    </div>
                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={() => setShowUploadModal(false)}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" disabled={actionLoading || !uploadDomain}>
                            {actionLoading ? 'Uploading...' : 'Upload Certificate'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </>
    );
};

export default SSLCertificates;
