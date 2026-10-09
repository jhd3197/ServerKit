import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Globe, Plus, ShieldCheck, RefreshCw, Trash2, ExternalLink,
    AlertTriangle, Lock, Search, ChevronRight,
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useAuth } from '../contexts/useAuth.js';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import Modal from '@/components/Modal';
import DomainField from '@/components/DomainField';
import { attachDomain } from '@/services/attachDomain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { SearchField, Pill, Drawer } from '@/components/ds';
import {
    DataGrid, GridViewPicker, GridChips, GridBulkBar, GridFooter,
    GridToolsMenu, GridFilterDrawer, GridFilterButton,
    useGridConfig, useGridRows, exportRows,
} from '@/components/ds/grid';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import { useConfirm } from '@/hooks/useConfirm';
import useFocusParam from '@/hooks/useFocusParam';
import RegistrarPortfolio from '../components/domains/RegistrarPortfolio';
import { ProviderBrandIcon } from '../components/icons/ProviderBrands';
import DomainDnsPanel from '../components/domains/DomainDnsPanel';
import PluginSlot from '../components/PluginSlot';
import { formatExpiry } from '../utils/expiry';
import { useTranslation } from 'react-i18next';
import { t } from '../i18n/t';
import { toastError } from '@/utils/errorMessage';

const DAY = 86400000;
const norm = (s) => (s || '').toLowerCase().replace(/\.$/, '');
const daysUntil = (iso) => {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? null : Math.round((t - Date.now()) / DAY);
};

// ── SSL state helpers ────────────────────────────────────────
// Module scope, not component scope: they are pure functions of a row, and the
// column list memoises on them.
const sslDays = (d) => {
    if (!d.ssl_enabled || !d.ssl_expires_at) return null;
    const ms = new Date(d.ssl_expires_at).getTime() - Date.now();
    return Number.isNaN(ms) ? null : Math.max(0, Math.round(ms / DAY));
};
const sslState = (d) => {
    if (d.source === 'provider') return 'n/a';
    if (!d.ssl_enabled) return 'none';
    const days = sslDays(d);
    return days != null && days < 30 ? 'expiring' : 'valid';
};
const sslPill = (d) => {
    const state = sslState(d);
    const days = sslDays(d);
    if (state === 'valid') return <Pill kind="green">{days != null ? t('app.domains.sslValidDays', 'Valid · {{days}}d', { days }) : t('app.domains.sslValid', 'Valid')}</Pill>;
    if (state === 'expiring') return <Pill kind="amber">{t('app.domains.sslExpires', 'Expires {{days}}d', { days })}</Pill>;
    if (state === 'n/a') return <span className="dom-dash">—</span>;
    return <Pill kind="gray">{t('app.domains.noSsl', 'No SSL')}</Pill>;
};
const rowStatus = (d) => (d.source === 'provider'
    ? (d.cfStatus || 'active')
    : (d.ssl_enabled ? 'active' : 'unconfigured'));

// Which columns the top-bar search scans. Module scope so the grid's memo
// chain keeps a stable identity across renders.
const SEARCH_FIELDS = ['name', 'site', 'provider', 'registrar'];

// Built-in views: the questions people actually open this page to answer. They
// are saved-view presets, not a separate filter mechanism — clicking one loads
// its config into the same grid state a personal view would, so you can tweak
// one and "Save as…" it without leaving the page.
const BUILTIN_VIEWS = [
    {
        name: 'Needs attention',
        state: {
            cols: ['name', 'ssl', 'sslDays', 'expDays', 'autoRenew', 'status'],
            sort: { key: 'sslDays', dir: 'asc' },
            filters: {
                match: 'any',
                rules: [
                    { id: 'a1', field: 'ssl', op: 'any', value: ['none', 'expiring'] },
                    { id: 'a2', field: 'status', op: 'any', value: ['unconfigured'] },
                ],
            },
            sub: [],
            density: 'cozy',
            group: null,
        },
    },
    {
        name: 'SSL expiring',
        state: {
            cols: ['name', 'ssl', 'sslDays', 'site', 'provider'],
            sort: { key: 'sslDays', dir: 'asc' },
            filters: { match: 'all', rules: [{ id: 's1', field: 'sslDays', op: 'lt', value: 30 }] },
            sub: [], density: 'cozy', group: null,
        },
    },
    {
        name: 'Renewals ≤ 60d',
        state: {
            cols: ['name', 'expiry', 'expDays', 'autoRenew', 'registrar'],
            sort: { key: 'expDays', dir: 'asc' },
            filters: { match: 'all', rules: [{ id: 'r1', field: 'expDays', op: 'lt', value: 60 }] },
            sub: [], density: 'cozy', group: null,
        },
    },
    {
        name: 'Unlinked',
        state: {
            cols: ['name', 'provider', 'registrar', 'expiry', 'status'],
            sort: { key: 'name', dir: 'asc' },
            filters: { match: 'all', rules: [{ id: 'u1', field: 'site', op: 'any', value: ['—'] }] },
            sub: [], density: 'cozy', group: null,
        },
    },
];

const Domains = () => {
    const { t } = useTranslation();
    const { confirm } = useConfirm();
    const toast = useToast();
    const { isAdmin } = useAuth();
    const [domains, setDomains] = useState([]);
    const [apps, setApps] = useState([]);
    const [portfolio, setPortfolio] = useState([]);          // zones across connected DNS providers
    const [portfolioErrors, setPortfolioErrors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState(null);
    const [search, setSearch] = useState('');
    const [drawerDomain, setDrawerDomain] = useState(null);
    const [regInfo, setRegInfo] = useState(null);            // lazy registration lookup for the open drawer
    const [searchParams, setSearchParams] = useSearchParams();

    const [picked, setPicked] = useState([]);
    const [filterOpen, setFilterOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [perPage, setPerPage] = useState(25);

    // Modal states
    const [showAddModal, setShowAddModal] = useState(false);
    useFocusParam('create', () => setShowAddModal(true));
    const [showSslModal, setShowSslModal] = useState(false);
    const [selectedDomain, setSelectedDomain] = useState(null);

    // Form states
    // What DomainField last reported: the hostname ('' until valid) and
    // whether it is a managed subdomain or the user's own domain.
    const [domainName, setDomainName] = useState('');
    const [domainInfo, setDomainInfo] = useState(null);
    const [selectedAppId, setSelectedAppId] = useState('');
    const [isPrimary, setIsPrimary] = useState(false);
    const [sslEmail, setSslEmail] = useState('');
    const [acmeContact, setAcmeContact] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => { loadData(); }, []);

    // The panel remembers one Let's Encrypt contact; this modal used to ask
    // for it on every single certificate. Best-effort — an unreachable
    // setting just leaves the field empty, as before.
    useEffect(() => {
        let cancelled = false;
        api.getAcmeContact()
            .then(({ email }) => { if (!cancelled && email) setAcmeContact(email); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Lazily resolve registration (expiry/registrar) for the open provider domain:
    // use the provider value if present, else fall back to a one-off RDAP lookup.
    useEffect(() => {
        if (!drawerDomain || drawerDomain.source === 'app') { setRegInfo(null); return undefined; }
        if (drawerDomain.expires_at) {
            setRegInfo({
                expires_at: drawerDomain.expires_at,
                auto_renew: drawerDomain.auto_renew,
                registrar: drawerDomain.registrar,
                source: drawerDomain.registrar ? 'cache' : 'provider',
            });
            return undefined;
        }
        let cancelled = false;
        setRegInfo({ loading: true });
        api.getDomainRegistration(drawerDomain.name)
            .then((r) => {
                if (cancelled) return;
                setRegInfo(r && r.success
                    ? { expires_at: r.expires_at, registrar: r.registrar, source: 'rdap' }
                    : { error: (r && r.error) || 'not found' });
            })
            .catch(() => { if (!cancelled) setRegInfo({ error: 'lookup failed' }); });
        return () => { cancelled = true; };
    }, [drawerDomain]);

    async function loadData() {
        try {
            setLoading(true);
            const timeout = (promise, ms) => Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), ms)),
            ]);
            // Each source fails on its own: a dead DNS provider must not hide
            // the app-linked domains. A failed source keeps its last good rows
            // and is recorded, so it can never read as "no domains".
            const failures = [];
            const settle = (promise, ms) => timeout(promise, ms).catch((err) => {
                failures.push(err);
                return null;
            });
            const [domainsData, appsData, portfolioData] = await Promise.all([
                settle(api.getDomains(), 10000),
                settle(api.getApps(), 10000),
                settle(api.getDnsPortfolio(), 15000),
            ]);
            if (domainsData) setDomains(domainsData.domains || []);
            if (appsData) setApps(appsData.apps || []);
            if (portfolioData) {
                setPortfolio(portfolioData.domains || []);
                setPortfolioErrors(portfolioData.errors || []);
            }
            setLoadError(failures[0] || null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAddDomain(e) {
        e.preventDefault();
        if (!domainName || !selectedAppId) return;
        const appId = parseInt(selectedAppId, 10);
        try {
            setActionLoading(true);
            await attachDomain(appId, domainName, domainInfo, { isPrimary });
            setShowAddModal(false);
            setDomainName('');
            setSelectedAppId('');
            setIsPrimary(false);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDeleteDomain(domain) {
        if (!await confirm({
            title: t('app.domains.deleteDomain', 'Delete domain'),
            message: t('app.domains.delete', 'Delete {{name}}?', { name: domain.name }),
            confirmText: t('app.domains.deleteDomain', 'Delete domain'),
        })) return;
        try {
            await api.deleteDomain(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleEnableSsl(e) {
        e.preventDefault();
        // Mirrors the input's display fallback: an untouched field submits the
        // stored contact rather than nothing.
        const email = sslEmail || acmeContact;
        if (!selectedDomain || !email) return;
        try {
            setActionLoading(true);
            await api.enableSsl(selectedDomain.id, email);
            setShowSslModal(false);
            setSslEmail('');
            setSelectedDomain(null);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleDisableSsl(domain) {
        if (!await confirm({
            title: t('app.domains.disableSsl', 'Disable SSL'),
            message: t('app.domains.disableSslFor', 'Disable SSL for {{name}}?', { name: domain.name }),
            confirmText: t('app.domains.disableSsl', 'Disable SSL'),
        })) return;
        try {
            await api.disableSsl(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleRenewSsl(domain) {
        try {
            setActionLoading(true);
            await api.renewDomainSsl(domain.id);
            loadData();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    }

    async function handleVerifyDomain(domain) {
        try {
            const result = await api.verifyDomain(domain.id);
            if (!result.verified) {
                toast.error(t('app.domains.domainVerificationFailed', "Couldn't verify the domain. {{error}}", { error: result.error }));
            } else if (result.warning) {
                // The name resolves, but something about it will break
                // issuance later (a stray AAAA record, today). A green
                // "verified" toast here is how that stayed invisible.
                toast.warning(result.warning, { duration: 15000 });
            } else {
                toast.success(t('app.domains.domainVerifiedIp', 'Domain verified. IP: {{ipaddress}}', { ipaddress: result.ip_address }));
            }
        } catch (err) {
            setError(err.message);
        }
    }

    const appName = useCallback(
        (id) => apps.find((a) => a.id === id)?.name || 'Unknown',
        [apps],
    );

    // One unified list: ServerKit's app-linked domains + every zone in a connected
    // DNS provider. A domain that is both keeps its app row and gains the provider
    // badge, expiry, and quick actions; provider-only zones become their own rows.
    const rows = useMemo(() => {
        const providerByDomain = new Map(portfolio.map((z) => [norm(z.domain), z]));
        const appNames = new Set(domains.map((d) => norm(d.name)));
        return [
            ...domains.map((d) => {
                const p = providerByDomain.get(norm(d.name));
                return {
                    ...d,
                    key: `app:${d.id}`,
                    source: 'app',
                    provider: p?.provider || null,
                    config_id: p?.config_id ?? null,
                    config_name: p?.config_name ?? null,
                    provider_zone_id: p?.provider_zone_id ?? null,
                    adopted: p?.adopted ?? false,
                    zone_id: p?.zone_id ?? null,
                    expires_at: p?.expires_at ?? null,
                    auto_renew: p?.auto_renew ?? null,
                    registrar: p?.registrar ?? null,
                };
            }),
            ...portfolio
                .filter((z) => !appNames.has(norm(z.domain)))
                .map((z) => ({
                    key: `prov:${z.provider}:${z.domain}`,
                    source: 'provider',
                    name: z.domain,
                    provider: z.provider,
                    config_id: z.config_id,
                    config_name: z.config_name,
                    provider_zone_id: z.provider_zone_id,
                    adopted: z.adopted,
                    zone_id: z.zone_id,
                    cfStatus: z.status,
                    expires_at: z.expires_at,
                    auto_renew: z.auto_renew,
                    registrar: z.registrar,
                    application_id: null,
                    ssl_enabled: false,
                    is_primary: false,
                })),
        ].sort((a, b) => a.name.localeCompare(b.name));
    }, [domains, portfolio]);

    // ── columns ───────────────────────────────────────────────
    // `type` picks the operator set and the filter UI in the header menu;
    // `width` is a CSS grid track. Only fields the API actually returns are
    // listed — there is no DNSSEC or record-count column because nothing in
    // /domains or /dns/portfolio carries them.
    const columns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'common.labels.domain', header: 'Domain',
            type: 'text',
            width: 'minmax(250px,1.8fr)',
            locked: true,
            value: (d) => d.name,
            render: (d) => (
                <>
                    {d.name}
                    {d.is_primary && <span className="dom-primary">{t('app.domains.primary', 'Primary')}</span>}
                    {d.source === 'provider' && d.adopted && <span className="dom-managed">{t('app.domains.managed', 'Managed')}</span>}
                </>
            ),
        },
        {
            key: 'site',
            headerKey: 'app.domains.linkedSite', header: 'Linked service',
            type: 'enum',
            width: 'minmax(140px,1fr)',
            value: (d) => (d.application_id ? appName(d.application_id) : '—'),
            render: (d) => (d.application_id
                ? <span className="sk-tag">{appName(d.application_id)}</span>
                : <span className="dom-dash">—</span>),
        },
        {
            key: 'provider',
            headerKey: 'app.domains.dnsProvider', header: 'DNS provider',
            type: 'enum',
            width: '150px',
            defaultVisible: false,
            value: (d) => d.config_name || d.provider || '—',
        },
        {
            key: 'registrar',
            headerKey: 'app.domains.registrar', header: 'Registrar',
            type: 'enum',
            width: '150px',
            defaultVisible: false,
            value: (d) => d.registrar || '—',
        },
        {
            key: 'ssl',
            header: 'SSL',
            type: 'enum',
            width: '160px',
            enumOrder: ['valid', 'expiring', 'none', 'n/a'],
            value: sslState,
            render: sslPill,
        },
        {
            key: 'sslDays',
            headerKey: 'app.domains.sslExpiry', header: 'SSL expiry',
            type: 'num',
            width: '155px',
            unit: 'd',
            defaultVisible: false,
            quick: [
                { op: 'lt', value: 15, labelKey: 'app.domains.under15', label: 'under 15' },
                { op: 'lt', value: 30, labelKey: 'app.domains.under30', label: 'under 30' },
            ],
            // -1 keeps "no certificate" sorting as the most urgent thing, which
            // is what someone sorting by SSL expiry is looking for.
            value: (d) => (sslDays(d) == null ? -1 : sslDays(d)),
            render: (d) => {
                const days = sslDays(d);
                if (days == null) return <span className="dom-dash">—</span>;
                const pct = Math.max(4, Math.min(100, (days / 90) * 100));
                const tone = days < 15 ? 'var(--red)' : days < 40 ? 'var(--amber)' : 'var(--green)';
                return (
                    <div className="dom-meter">
                        <span style={{ color: tone }}>{days}d</span>
                        <span className="dom-meter__bar">
                            <i style={{ width: `${pct}%`, background: tone }} />
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'expiry',
            headerKey: 'app.domains.registration', header: 'Registration',
            type: 'date',
            width: '165px',
            value: (d) => d.expires_at || null,
            render: (d) => {
                const exp = formatExpiry(d.expires_at);
                if (!exp) return <span className="dom-dash">—</span>;
                return (
                    <div>
                        <div className={`dom-expiry dom-expiry--${exp.tone}`}>{exp.absolute}</div>
                        <div className="dom-expiry__rel">{exp.relative}</div>
                    </div>
                );
            },
        },
        {
            key: 'expDays',
            headerKey: 'app.domains.renewsIn', header: 'Renews in',
            type: 'num',
            width: '135px',
            unit: 'd',
            align: 'right',
            defaultVisible: false,
            quick: [
                { op: 'lt', value: 30, labelKey: 'app.domains.under30', label: 'under 30' },
                { op: 'lt', value: 60, labelKey: 'app.domains.under60', label: 'under 60' },
            ],
            value: (d) => daysUntil(d.expires_at),
            render: (d) => {
                const days = daysUntil(d.expires_at);
                if (days == null) return <span className="dom-dash">—</span>;
                return <span className={days < 40 ? 'dom-expiry--amber' : undefined}>{days}d</span>;
            },
        },
        {
            key: 'autoRenew',
            headerKey: 'app.domains.autoRenew', header: 'Auto-renew',
            type: 'bool',
            width: '142px',
            value: (d) => d.auto_renew,
            render: (d) => (d.auto_renew == null
                ? <span className="dom-dash">—</span>
                : d.auto_renew ? <Pill kind="green">on</Pill> : <Pill kind="gray">off</Pill>),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            type: 'enum',
            width: '135px',
            value: rowStatus,
            render: (d) => {
                const state = rowStatus(d);
                return <Pill kind={state === 'active' ? 'green' : 'amber'}>{state}</Pill>;
            },
        },
    ], [appName, t]);

    const grid = useGridConfig({
        page: 'domains',
        columns,
        builtinViews: BUILTIN_VIEWS,
        initial: {
            cols: ['name', 'site', 'ssl', 'expiry', 'autoRenew', 'status'],
            sort: { key: 'name', dir: 'asc' },
            // No default sub-line: an unknown registrar rendered "Registrar —"
            // under every row. It stays one click away as a column.
            sub: [],
        },
    });
    const { cfg } = grid;

    const view = useGridRows({
        rows,
        columns,
        cfg,
        search,
        searchFields: SEARCH_FIELDS,
        page,
        perPage,
    });

    // Any change to what is being shown resets to page 1 — otherwise a filter
    // that shrinks the set below the current page leaves you on a blank page.
    const filterSig = JSON.stringify(cfg.filters);
    useEffect(() => { setPage(1); }, [filterSig, search, perPage, cfg.group]);

    // ⌘F / Ctrl+F opens the filter drawer; "/" focuses the top-bar search.
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setFilterOpen(true);
            }
            if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
                e.preventDefault();
                document.querySelector('.sk-topbar .sk-searchfield__input')?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Deep-link: /domains?open=<domain> opens that domain's drawer once data has
    // loaded — keeps links sensible now that this is the single DNS surface.
    useEffect(() => {
        const want = searchParams.get('open');
        if (!want || loading || drawerDomain) return;
        const row = rows.find((d) => norm(d.name) === norm(want));
        if (row) {
            setDrawerDomain(row);
            const next = new URLSearchParams(searchParams);
            next.delete('open');
            setSearchParams(next, { replace: true });
        }
    }, [loading, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

    const pickedRows = useMemo(
        () => view.filtered.filter((d) => picked.includes(d.key)),
        [view.filtered, picked],
    );

    const toggleRow = useCallback((key, on) => {
        setPicked((prev) => (on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
    }, []);
    const toggleAll = useCallback((on, keys) => {
        setPicked((prev) => (on ? [...new Set([...prev, ...keys])] : prev.filter((k) => !keys.includes(k))));
    }, []);

    const createView = (name, fromCurrent) => {
        if (!fromCurrent) grid.setCfg(grid.base);
        grid.views.saveView(name)
            .then(() => toast.success(t('app.domains.viewSaved', 'View "{{name}}" saved', { name: name })))
            .catch((err) => toastError(toast, t('app.domains.couldNotSaveTheView', "Couldn't save the view."), err));
    };

    // ── top bar ──────────────────────────────────────────────
    // Fixed shape on every page: page actions, then search, then the filter
    // icon, then the overflow "⋮". The search box must not move when a page
    // adds or removes an action, so it sits AFTER the actions and before the
    // two fixed-width icon buttons.
    useTopbarActions(() => (
        <>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
                <Plus size={15} /> {t('app.domains.addDomain', 'Add domain')}
            </Button>
            <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw size={15} /> {t('app.domains.checkDns', 'Check DNS')}
            </Button>
            <SearchField value={search} onSearch={setSearch} placeholder={t('app.domains.searchDomains', 'Search domains…')} />
            <GridFilterButton count={cfg.filters.rules.length} onClick={() => setFilterOpen(true)} />
            <GridToolsMenu
                cfg={cfg}
                columns={columns}
                rows={view.filtered}
                selectedRows={pickedRows}
                viewName={grid.views.activeView?.name || 'domains'}
                noun="domains"
                onRefresh={loadData}
                onReset={grid.resetToView}
                onCopyLink={grid.copyLink}
                onDensity={grid.setDensity}
                onExported={(n, fields, format) => toast.success(t('app.domains.rowsFields', '{{n}} rows · {{fields}} fields · {{value}}', { n: n, fields: fields, value: format.toUpperCase() }))}
            />
        </>
    ), [search, cfg, columns, view.filtered, pickedRows, grid.views.activeView]);

    return (
        <div className="sk-tabgroup__inner domains-page">
            <RegistrarPortfolio />

            {error && (
                <div className="error-banner">
                    {error}
                    <Button variant="unstyled" type="button" className="error-banner__close" onClick={() => setError('')} aria-label={t('app.domains.dismissError', 'Dismiss error')}>×</Button>
                </div>
            )}

            {loading ? (
                <EmptyState loading loadingVariant="table" title={t('app.domains.loadingDomains', 'Loading domains…')} />
            ) : loadError && rows.length === 0 ? (
                <ErrorState
                    title={t('app.domains.couldntLoadDomains', "Couldn't load domains.")}
                    error={loadError}
                    onRetry={loadData}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    icon={Globe}
                    title={t('app.domains.noDomainsYet', 'No domains yet')}
                    description={t('app.domains.attachADomainToAnApplication', 'Attach a domain to a service, or connect a DNS provider to see its zones here.')}
                    action={<Button onClick={() => setShowAddModal(true)}><Plus size={16} /> {t('app.domains.addDomain2', 'Add domain')}</Button>}
                />
            ) : (
                <div className="domains-body">
                    {loadError && <ErrorState compact error={loadError} onRetry={loadData} />}

                    <GridViewPicker
                        views={grid.views}
                        label="domains"
                        onCreate={createView}
                    />

                    <GridChips
                        cfg={cfg}
                        columns={columns}
                        onRemove={grid.removeRule}
                        onClear={grid.clearRules}
                        onMatchChange={grid.setMatch}
                    />

                    <GridBulkBar count={picked.length} noun="domain" onClear={() => setPicked([])}>
                        <Button variant="unstyled" type="button" onClick={loadData}>
                            <RefreshCw size={13} /> {t('app.domains.checkDns', 'Check DNS')}
                        </Button>
                        <Button variant="unstyled"
                            type="button"
                            onClick={() => {
                                const n = exportRows(
                                    pickedRows,
                                    cfg.cols.map((k) => columns.find((c) => c.key === k)).filter(Boolean),
                                    'csv',
                                    'domains',
                                );
                                toast.success(t('app.domains.rowsCsv', '{{n}} rows · CSV', { n: n }));
                            }}
                        >
                            <ExternalLink size={13} /> {t('app.domains.exportCsv', 'Export CSV')}
                        </Button>
                    </GridBulkBar>

                    {portfolioErrors.length > 0 && (
                        <div className="dom-portfolio-note">
                            <AlertTriangle size={14} />
                            <span>
                                {portfolioErrors.length === 1
                                    ? `${portfolioErrors[0].config_name}: ${portfolioErrors[0].error}`
                                    : t('app.domains.zonesListFailed', { count: portfolioErrors.length, defaultValue_one: "{{count}} DNS connection couldn't list its zones", defaultValue_other: "{{count}} DNS connections couldn't list their zones" })}
                                {' — '}{t('app.domains.aCloudflareTokenNeeds', 'a Cloudflare token needs')} <strong>{t('app.domains.zoneRead', 'Zone:Read')}</strong> {t('app.domains.onAllZonesToListThe', 'on all zones to list the whole account.')}
                            </span>
                        </div>
                    )}

                    <DataGrid
                        columns={columns}
                        groups={view.groups}
                        allRows={rows}
                        cfg={cfg}
                        grid={grid}
                        keyField="key"
                        selectable
                        selectedKeys={picked}
                        onToggleRow={toggleRow}
                        onToggleAll={toggleAll}
                        onRowClick={setDrawerDomain}
                        rowLeading={(d) => (d.provider
                            ? <ProviderBrandIcon provider={d.provider} size={15} />
                            : <Globe size={15} />)}
                        rowActions={() => <ChevronRight size={15} className="dom-chev" />}
                        empty={(
                            <EmptyState
                                icon={Globe}
                                title={search ? t('app.domains.noDomainsMatch', 'No domains match "{{value}}".', { value: search.trim() }) : t('app.domains.noDomainsMatchThisView', 'No domains match this view.')}
                                action={(
                                    <Button variant="outline" onClick={() => { setSearch(''); grid.clearRules(); }}>
                                        {t('common.actions.clearFilters', 'Clear filters')}
                                    </Button>
                                )}
                            />
                        )}
                        footer={(
                            <GridFooter
                                from={view.from}
                                to={view.to}
                                total={view.total}
                                noun="domains"
                                cfg={cfg}
                                columns={columns}
                                page={view.page}
                                pageCount={view.pageCount}
                                perPage={perPage}
                                onPage={setPage}
                                onPerPage={setPerPage}
                            />
                        )}
                    />
                </div>
            )}

            <GridFilterDrawer
                open={filterOpen}
                onOpenChange={setFilterOpen}
                columns={columns}
                rows={rows}
                cfg={cfg}
                grid={grid}
                noun="domains"
            />

            {/* ── Detail drawer ──────────────────────────────── */}
            <Drawer
                open={!!drawerDomain}
                onOpenChange={(open) => { if (!open) setDrawerDomain(null); }}
                icon={drawerDomain?.provider ? <ProviderBrandIcon provider={drawerDomain.provider} size={18} /> : <Globe size={18} />}
                iconColor="var(--accent-bright)"
                title={drawerDomain?.name || ''}
                subtitle={drawerDomain
                    ? (drawerDomain.source === 'app'
                        ? `${drawerDomain.application_id ? appName(drawerDomain.application_id) : 'unlinked'} · ${sslState(drawerDomain)}`
                        : `${drawerDomain.config_name || drawerDomain.provider || 'DNS'} zone${drawerDomain.cfStatus ? ` · ${drawerDomain.cfStatus}` : ''}`)
                    : ''}
                width={1100}
                headerExtra={drawerDomain && (
                    <div className="dom-drawer__headeractions">
                        <Button variant="outline" size="sm" asChild>
                            <a href={`${drawerDomain.ssl_enabled ? 'https' : 'http'}://${drawerDomain.name}`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink size={14} /> {t('app.domains.visit', 'Visit')}
                            </a>
                        </Button>
                        {drawerDomain.source === 'app' && (
                            <>
                                <Button variant="outline" size="sm" onClick={() => handleVerifyDomain(drawerDomain)}>
                                    <Search size={14} /> {t('app.domains.verifyDns', 'Verify DNS')}
                                </Button>
                                {drawerDomain.ssl_enabled ? (
                                    <>
                                        <Button variant="outline" size="sm" disabled={actionLoading} onClick={() => handleRenewSsl(drawerDomain)}>
                                            <RefreshCw size={14} /> {t('app.domains.renewSsl', 'Renew SSL')}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => handleDisableSsl(drawerDomain)}>
                                            <Lock size={14} /> {t('app.domains.disableSsl', 'Disable SSL')}
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" onClick={() => { setSelectedDomain(drawerDomain); setShowSslModal(true); setDrawerDomain(null); }}>
                                        <Lock size={14} /> {t('app.domains.enableSsl', 'Enable SSL')}
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                )}
            >
                {drawerDomain && (
                    <div className="dom-drawer">
                        <div className="dom-specs">
                            {drawerDomain.source === 'app' ? (
                                <>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('app.domains.sslCertificate', 'SSL certificate')}</div>
                                        <div className="dom-specs__value">{sslPill(drawerDomain)}</div>
                                        <div className="sk-spec-card__sub">
                                            {drawerDomain.ssl_enabled
                                                ? (drawerDomain.ssl_expires_at ? t('app.domains.sslExpiresOn', 'Expires {{date}}', { date: new Date(drawerDomain.ssl_expires_at).toLocaleDateString() }) : t('app.domains.letsEncrypt', "Let's Encrypt"))
                                                : t('app.domains.notIssued', 'Not issued')}
                                        </div>
                                    </div>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('app.domains.linkedSite', 'Linked service')}</div>
                                        <div className="sk-spec-card__value">{drawerDomain.application_id ? appName(drawerDomain.application_id) : t('app.domains.unlinked', 'Unlinked')}</div>
                                        <div className="sk-spec-card__sub">{drawerDomain.is_primary ? t('app.domains.primaryDomain', 'Primary domain') : t('app.domains.alias', 'Alias')}</div>
                                    </div>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('common.labels.status', 'Status')}</div>
                                        <div className="dom-specs__value">
                                            <Pill kind={drawerDomain.ssl_enabled ? 'green' : 'amber'}>{drawerDomain.ssl_enabled ? 'active' : 'unconfigured'}</Pill>
                                        </div>
                                        <div className="sk-spec-card__sub">{t('app.domains.autoRenew', 'Auto-renew')} {drawerDomain.ssl_auto_renew ? 'on' : 'off'}</div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('app.domains.dnsProvider', 'DNS provider')}</div>
                                        <div className="sk-spec-card__value">{drawerDomain.config_name || drawerDomain.provider}</div>
                                        <div className="sk-spec-card__sub">{drawerDomain.adopted ? t('app.domains.managedInServerKit', 'Managed in ServerKit') : t('app.domains.readOnly', 'Read-only')}</div>
                                    </div>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('app.domains.zoneStatus', 'Zone status')}</div>
                                        <div className="dom-specs__value">
                                            <Pill kind={drawerDomain.cfStatus === 'active' ? 'green' : 'amber'}>{drawerDomain.cfStatus || 'active'}</Pill>
                                        </div>
                                        <div className="sk-spec-card__sub">{drawerDomain.provider}</div>
                                    </div>
                                    <div className="sk-spec-card">
                                        <div className="sk-spec-card__label">{t('app.domains.registration', 'Registration')}</div>
                                        <div className="sk-spec-card__value">
                                            {regInfo?.loading ? t('app.domains.lookingUp', 'Looking up…') : (formatExpiry(regInfo?.expires_at)?.relative || '—')}
                                        </div>
                                        <div className="sk-spec-card__sub">
                                            {regInfo?.loading ? t('app.domains.whoisRdapLookup', 'WHOIS / RDAP lookup') : (() => {
                                                const exp = formatExpiry(regInfo?.expires_at);
                                                if (!exp) return regInfo?.error ? t('app.domains.lookupUnavailable', 'Lookup unavailable') : '—';
                                                return [exp.absolute, regInfo?.registrar].filter(Boolean).join(' · ');
                                            })()}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="dom-drawer__section">
                            <DomainDnsPanel domain={drawerDomain} isAdmin={isAdmin} />
                        </div>

                        {drawerDomain.source === 'app' && (
                            <div className="dom-drawer__danger">
                                <Button variant="outline" size="sm" className="dom-delete-btn" onClick={() => { handleDeleteDomain(drawerDomain); setDrawerDomain(null); }}>
                                    <Trash2 size={14} /> {t('app.domains.deleteDomain', 'Delete domain')}
                                </Button>
                            </div>
                        )}

                        {/* Extension slot: panels contributed to the domain drawer */}
                        <PluginSlot name="domain.drawer.panel" context={{ domain: drawerDomain }} />
                    </div>
                )}
            </Drawer>

            {/* ── Add Domain Modal ───────────────────────────── */}
            <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title={t('app.domains.addDomain2', 'Add domain')}>
                <form onSubmit={handleAddDomain}>
                    <div className="form-group">
                        <Label>{t('app.domains.application', 'Service')}</Label>
                        <Select value={selectedAppId} onValueChange={setSelectedAppId} required>
                            <SelectTrigger><SelectValue placeholder={t('app.domains.selectAnApplication', 'Select a service')} /></SelectTrigger>
                            <SelectContent>
                                {apps.map(app => (
                                    <SelectItem key={app.id} value={String(app.id)}>{app.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="form-group">
                        <Label>{t('common.labels.domain', 'Domain')}</Label>
                        {showAddModal && (
                            <DomainField
                                exclude={domains.map((d) => d.name)}
                                rejectExisting
                                onChange={(name, info) => { setDomainName(name); setDomainInfo(info); }}
                                disabled={actionLoading}
                            />
                        )}
                    </div>
                    {domainInfo?.mode !== 'subdomain' && (
                        <div className="form-group">
                            <label className="checkbox-label">
                                <Checkbox checked={isPrimary} onCheckedChange={setIsPrimary} />
                                {t('app.domains.setAsPrimaryDomain', 'Set as primary domain')}
                            </label>
                        </div>
                    )}
                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button type="submit" disabled={actionLoading || !domainName || !selectedAppId}>{actionLoading ? t('app.domains.adding', 'Adding…') : t('app.domains.addDomain', 'Add domain')}</Button>
                    </div>
                </form>
            </Modal>

            {/* ── Enable SSL Modal ───────────────────────────── */}
            <Modal open={showSslModal && Boolean(selectedDomain)} onClose={() => setShowSslModal(false)} title={t('app.domains.enableSslCertificate', 'Enable SSL certificate')}>
                {selectedDomain && (
                    <form onSubmit={handleEnableSsl}>
                        <div className="ssl-info-box">
                            <ShieldCheck size={32} />
                            <div>
                                <h4>{t('app.domains.freeSslFromLetSEncrypt', 'Free SSL from Let\'s Encrypt')}</h4>
                                <p>{t('app.domains.aFreeSslCertificateWillBe', 'A free SSL certificate will be obtained for')} <strong>{selectedDomain.name}</strong></p>
                            </div>
                        </div>
                        <div className="form-group">
                            <Label>{t('app.domains.emailAddress', 'Email address')}</Label>
                            <Input
                                type="email"
                                placeholder={acmeContact || 'admin@example.com'}
                                value={sslEmail || acmeContact}
                                onChange={e => setSslEmail(e.target.value)}
                                required
                            />
                            <p className="hint">
                                {acmeContact
                                    ? t('app.domains.acmeContactSaved', 'Certificate expiry notices go here. Saved from the last certificate you issued; change it to use a different address.')
                                    : t('app.domains.acmeContactRequired', 'Required for certificate expiry notices. It is remembered for the next certificate.')}
                            </p>
                        </div>
                        <div className="modal-actions">
                            <Button type="button" variant="outline" onClick={() => setShowSslModal(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                            <Button type="submit" disabled={actionLoading}>{actionLoading ? t('app.domains.obtainingCertificate', 'Obtaining certificate…') : t('app.domains.enableSsl', 'Enable SSL')}</Button>
                        </div>
                    </form>
                )}
            </Modal>
        </div>
    );
};

export default Domains;
