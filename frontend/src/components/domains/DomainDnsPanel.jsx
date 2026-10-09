// The DNS records section shown inside the Domains drawer — the single DNS surface.
// For a Cloudflare domain it shows the *live* zone records (tagged ServerKit-managed
// vs your own) so you see the real DNS without leaving the drawer; for a
// ServerKit/manual zone it shows the managed records. Admins can add records inline
// (the zone is adopted on demand), turn any A/AAAA record into a token-updatable
// Dynamic DNS host, export the zone, and check propagation. Deeper management links
// out to the Cloudflare ops surface.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Cloud, ShieldCheck, Radio, Download, Activity } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { ProviderBrandIcon } from '../icons/ProviderBrands';
import DdnsTokenCallout from './DdnsTokenCallout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormRow } from '../FormField';
import { DataTable, DataTableFooter } from '@/components/ds';
import { useConfirm } from '@/hooks/useConfirm';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { toastError } from '@/utils/errorMessage';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'CAA', 'NS'];
const PROXYABLE = ['A', 'AAAA', 'CNAME'];
const DYNAMIC_TYPES = ['A', 'AAAA']; // Dynamic DNS only makes sense for IP records.
const EMPTY_FORM = { record_type: 'A', name: '@', content: '', ttl: 3600, priority: '', proxied: false };

const norm = (s) => (s || '').toLowerCase().replace(/\.$/, '');

const normalizeLive = (r) => ({
    id: r.id, type: r.type, name: r.name, content: r.content,
    ttl: r.ttl, proxied: r.proxied, priority: r.priority, source: r.managed_by,
});
const normalizeManaged = (r) => ({
    id: r.id, type: r.record_type, name: r.name, content: r.content,
    ttl: r.ttl, proxied: r.proxied, priority: r.priority, source: 'serverkit',
});

export default function DomainDnsPanel({ domain, isAdmin }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const toast = useToast();
    const { confirm } = useConfirm();
    const isCloudflare = domain?.provider === 'cloudflare';
    const canLive = isCloudflare && !!domain?.provider_zone_id && !!domain?.config_id;
    const base = norm(domain?.name);

    const [records, setRecords] = useState([]);
    const [state, setState] = useState('loading'); // loading | ready | none | error
    const [error, setError] = useState('');
    const [zoneId, setZoneId] = useState(domain?.zone_id || null); // local DNSZone id, once known
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    // Dynamic DNS hosts for this zone, the just-revealed token, and per-record busy.
    const [hosts, setHosts] = useState([]);
    const [revealedHost, setRevealedHost] = useState(null);
    const [busyKey, setBusyKey] = useState(null);

    // Power tools (moved from the retired DNS Zones page).
    const [exporting, setExporting] = useState(false);
    const [propOpen, setPropOpen] = useState(false);
    const [propLoading, setPropLoading] = useState(false);
    const [propResults, setPropResults] = useState(null);

    // ── FQDN helpers — reconcile live (FQDN) vs managed (relative) record names ──
    const recordFqdn = useCallback((r) => {
        const n = norm(r.name);
        if (!n || n === '@') return base;
        if (n === base || n.endsWith(`.${base}`)) return n;
        return `${n}.${base}`;
    }, [base]);
    const recordRelativeName = useCallback((r) => {
        const fq = recordFqdn(r);
        return fq === base ? '@' : fq.slice(0, -(base.length + 1));
    }, [recordFqdn, base]);

    const hostByFqdn = new Map(hosts.map((h) => [norm(h.hostname), h]));
    const hostFor = (r) => hostByFqdn.get(recordFqdn(r));

    const loadHosts = useCallback(async () => {
        try {
            const d = await api.getDdnsHosts();
            setHosts(d.hosts || []);
        } catch { /* best-effort: hosts just won't be tagged */ }
    }, []);

    const load = useCallback(async () => {
        if (!domain) return;
        setState('loading');
        setError('');
        setZoneId(domain.zone_id || null); // reset so a prior domain's id can't leak in
        loadHosts();
        try {
            if (canLive) {
                const res = await api.getProviderRecords(domain.config_id, domain.provider_zone_id);
                if (!res.success) { setError(res.error || 'Could not load records'); setState('error'); return; }
                setRecords((res.records || []).map(normalizeLive));
                setZoneId(domain.zone_id || null);
            } else if (domain.zone_id) {
                const res = await api.getDNSRecords(domain.zone_id);
                setRecords((res.records || []).map(normalizeManaged));
                setZoneId(domain.zone_id);
            } else {
                // App/manual domain without a provider zone — match a local zone by name.
                const zones = (await api.getDNSZones()).zones || [];
                const zone = zones.find((z) => z.domain === domain.name);
                if (!zone) { setState('none'); return; }
                const res = await api.getDNSRecords(zone.id);
                setRecords((res.records || []).map(normalizeManaged));
                setZoneId(zone.id);
            }
            setState('ready');
        } catch (e) {
            setError(e.message || 'Could not load records');
            setState('error');
        }
    }, [domain, canLive, loadHosts]);

    useEffect(() => {
        setShowAdd(false); setForm(EMPTY_FORM);
        setRevealedHost(null); setPropOpen(false); setPropResults(null);
        load();
    }, [load]);

    // Materialize the local zone row on demand (writes / Cloudflare ops need it).
    async function ensureZone() {
        if (zoneId) return zoneId;
        const zone = await api.adoptDnsZone(domain.name, domain.config_id);
        setZoneId(zone.id);
        return zone.id;
    }

    async function handleAdd() {
        setSaving(true);
        try {
            const zid = await ensureZone();
            await api.createDNSRecord(zid, {
                record_type: form.record_type,
                name: form.name || '@',
                content: form.content,
                ttl: Number(form.ttl) || 3600,
                priority: form.priority !== '' && form.priority != null ? Number(form.priority) : null,
                proxied: isCloudflare && PROXYABLE.includes(form.record_type) ? !!form.proxied : false,
            });
            toast.success(t('app.domainDnsPanel.recordAdded', 'Record added'));
            setShowAdd(false);
            setForm(EMPTY_FORM);
            await load();
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.failedToAddRecord', "Couldn't add the record."), e);
        } finally {
            setSaving(false);
        }
    }

    // ── Dynamic DNS — turn a record into a token-updatable host ───────────────
    async function handleMakeDynamic(r) {
        setBusyKey(recordFqdn(r));
        try {
            const zid = await ensureZone();
            const host = await api.createDdnsHost({ zone_id: zid, record_name: recordRelativeName(r) });
            setRevealedHost(host); // includes the one-time token
            toast.success(t('app.domainDnsPanel.dynamicDnsEnabled', 'Dynamic DNS enabled'));
            await loadHosts();
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.failedToEnableDynamicDns', "Couldn't turn on dynamic DNS."), e);
        } finally {
            setBusyKey(null);
        }
    }

    async function handleRegenerate(host) {
        try {
            const updated = await api.regenerateDdnsToken(host.id);
            setRevealedHost(updated);
            toast.success(t('app.domainDnsPanel.tokenRegenerated', 'Token regenerated'));
            await loadHosts();
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.failedToRegenerateToken', "Couldn't regenerate the token."), e);
        }
    }

    async function handleStopDynamic(host) {
        if (!await confirm({
            title: t('app.domainDnsPanel.disableDynamicDns', 'Disable dynamic DNS'),
            message: t('app.domainDnsPanel.disableDynamicDnsForItsUpdate', 'Disable dynamic DNS for {{hostname}}? Its update token will stop working.', { hostname: host.hostname }),
            confirmText: t('app.domainDnsPanel.disableDynamicDns', 'Disable dynamic DNS'),
        })) return;
        try {
            await api.deleteDdnsHost(host.id);
            if (revealedHost?.id === host.id) setRevealedHost(null);
            toast.success(t('app.domainDnsPanel.dynamicDnsDisabled', 'Dynamic DNS disabled'));
            await loadHosts();
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.failedToDisableDynamicDns', "Couldn't turn off dynamic DNS."), e);
        }
    }

    // ── Power tools ───────────────────────────────────────────────────────────
    async function handleExport() {
        setExporting(true);
        try {
            const zid = await ensureZone();
            const data = await api.exportDNSZone(zid);
            downloadBlob(data.zone_file || '', `${domain.name}.txt`);
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.exportFailed', "Couldn't export the records."), e);
        } finally {
            setExporting(false);
        }
    }

    async function handleCheckPropagation() {
        if (propOpen) { setPropOpen(false); return; }
        setPropOpen(true);
        setPropLoading(true);
        try {
            const d = await api.checkDNSPropagation(domain.name);
            setPropResults(d.results || []);
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.propagationCheckFailed', "Couldn't check propagation."), e);
            setPropResults([]);
        } finally {
            setPropLoading(false);
        }
    }

    async function openCloudflareOps() {
        try {
            const zid = await ensureZone();
            navigate(`/cloudflare/zones/${zid}`);
        } catch (e) {
            toastError(toast, t('app.domainDnsPanel.couldNotOpenCloudflare', "Couldn't open Cloudflare."), e);
        }
    }

    // A proxied A/AAAA/CNAME means Cloudflare terminates TLS at its edge — i.e. the
    // site is served over HTTPS with no separate certificate to manage here.
    const hasProxiedSSL = isCloudflare && records.some((r) => r.proxied && PROXYABLE.includes(r.type));
    const showActions = isAdmin || records.some((r) => !!hostFor(r));
    const canExport = state === 'ready' && records.length > 0 && (isAdmin || !!zoneId);

    // DataTable columns. Cell markup and classNames mirror the hand-rolled table
    // they replace, so _domains.scss keeps applying (.ddp__c-*, .ddp__content,
    // .dns-rtype). The hover titles move from the <td> onto an inner <span>
    // because DataTable renders the cells.
    const columns = [
        {
            key: 'type',
            headerKey: 'common.labels.type', header: 'Type',
            sortable: true,
            className: 'ddp__c-type',
            sortValue: (r) => r.type || '',
            render: (r) => <span className={`dns-rtype dns-rtype--${(r.type || '').toLowerCase()}`}>{r.type}</span>,
        },
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            className: 'ddp__c-name',
            cellClassName: 'sk-cell-mono ddp__c-name',
            sortValue: (r) => r.name || '',
            render: (r) => <span title={r.name}>{r.name}</span>,
        },
        {
            key: 'content',
            headerKey: 'app.domainDnsPanel.content', header: 'Content',
            sortable: true,
            cellClassName: 'sk-cell-mono ddp__content',
            sortValue: (r) => (r.priority ? `${r.priority} ${r.content || ''}` : r.content || ''),
            render: (r) => (
                <span title={r.content}>{r.priority ? `${r.priority} ` : ''}{r.content}</span>
            ),
        },
        {
            key: 'ttl',
            header: 'TTL',
            sortable: true,
            className: 'ddp__c-ttl',
            cellClassName: 'sk-cell-dim',
            sortValue: (r) => (r.ttl ?? null),
            render: (r) => (r.ttl === 1 ? 'Auto' : r.ttl),
        },
        ...(isCloudflare ? [{
            key: 'proxy',
            headerKey: 'app.domainDnsPanel.proxy', header: 'Proxy',
            sortable: true,
            className: 'ddp__c-proxy',
            sortValue: (r) => (r.proxied ? 1 : 0),
            render: (r) => (r.proxied
                ? <span className="ddp__proxy ddp__proxy--on"><Cloud size={12} /> {t('app.domainDnsPanel.proxied', 'Proxied')}</span>
                : <span className="ddp__proxy">{t('app.domainDnsPanel.dnsOnly', 'DNS only')}</span>),
        }] : []),
        ...(canLive ? [{
            key: 'source',
            headerKey: 'common.labels.source', header: 'Source',
            sortable: true,
            className: 'ddp__c-src',
            sortValue: (r) => (r.source === 'serverkit' ? 'ServerKit' : 'External'),
            render: (r) => (r.source === 'serverkit'
                ? <span className="ddp__src ddp__src--sk">{t('common.labels.serverKit', 'ServerKit')}</span>
                : <span className="ddp__src">{t('app.domainDnsPanel.external', 'External')}</span>),
        }] : []),
        ...(showActions ? [{
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            className: 'ddp__c-act',
            cellClassName: 'ddp__c-act',
            render: (r) => {
                const host = hostFor(r);
                const dynamicable = DYNAMIC_TYPES.includes(r.type);
                return host ? (
                    <span className="ddp__dynwrap">
                        <span className="ddp__dyn" title={host.last_ip ? t('app.domainDnsPanel.lastIp', 'Last IP {{lastip}}', { lastip: host.last_ip }) : t('app.domainDnsPanel.noUpdateYet', 'No update yet')}>
                            <Radio size={11} /> {t('app.domainDnsPanel.dynamic', 'Dynamic')}
                        </span>
                        {isAdmin && (
                            <>
                                <Button variant="ghost" size="sm" className="ddp__iconbtn" title={t('app.domainDnsPanel.regenerateToken', 'Regenerate token')} onClick={() => handleRegenerate(host)}>
                                    <RefreshCw size={13} />
                                </Button>
                                <Button variant="ghost" size="sm" className="ddp__stopbtn" title={t('app.domainDnsPanel.disableDynamicDns', 'Disable dynamic DNS')} onClick={() => handleStopDynamic(host)}>
                                    {t('common.actions.stop', 'Stop')}
                                </Button>
                            </>
                        )}
                    </span>
                ) : (
                    isAdmin && dynamicable && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleMakeDynamic(r)}
                            disabled={busyKey === recordFqdn(r)}
                        >
                            <Radio size={13} /> {busyKey === recordFqdn(r) ? t('app.domainDnsPanel.enabling', 'Enabling…') : t('app.domainDnsPanel.makeDynamic', 'Make dynamic')}
                        </Button>
                    )
                );
            },
        }] : []),
    ];

    return (
        <div className="ddp">
            <div className="ddp__head">
                <h3 className="ddp__title">
                    {t('app.domainDnsPanel.dnsRecords', 'DNS records')}{state === 'ready' && <span className="ddp__count"> · {records.length}</span>}
                </h3>
                <div className="ddp__head-actions">
                    <Button variant="ghost" size="sm" onClick={load} title={t('app.domainDnsPanel.refreshRecords', 'Refresh records')}>
                        <RefreshCw size={14} />
                    </Button>
                    {isAdmin && (state === 'ready' || state === 'none') && (
                        <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
                            <Plus size={14} /> {t('app.domainDnsPanel.addRecord', 'Add record')}
                        </Button>
                    )}
                </div>
            </div>

            {revealedHost && (
                <DdnsTokenCallout host={revealedHost} onDismiss={() => setRevealedHost(null)} />
            )}

            {canLive && (
                <p className="ddp__hint">
                    {t('app.domainDnsPanel.liveFromCloudflareRecordsServerkitManages', 'Live from Cloudflare. Records ServerKit manages are tagged; the rest are your own and shown read-only.')}
                </p>
            )}

            {state === 'ready' && hasProxiedSSL && (
                <p className="ddp__ssl">
                    <ShieldCheck size={13} /> {t('app.domainDnsPanel.httpsIsServedByCloudflareOn', 'HTTPS is served by Cloudflare on proxied records, so no separate certificate is needed.')}
                </p>
            )}

            {showAdd && isAdmin && (
                <div className="ddp__form">
                    <FormRow>
                        <FormField label={t('common.labels.type', 'Type')}>
                            <Select value={form.record_type} onValueChange={(v) => setForm({ ...form, record_type: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{RECORD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                            </Select>
                        </FormField>
                        <FormField label={t('common.labels.name', 'Name')}>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('app.domainDnsPanel.orSubdomain', '@ or subdomain')} />
                        </FormField>
                    </FormRow>
                    <FormField label={t('app.domainDnsPanel.content', 'Content')}>
                        <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={t('app.domainDnsPanel.ipAddressOrTarget', 'IP address or target')} />
                    </FormField>
                    <FormRow>
                        <FormField label="TTL">
                            <Input type="number" value={form.ttl} onChange={(e) => setForm({ ...form, ttl: e.target.value })} />
                        </FormField>
                        {(form.record_type === 'MX' || form.record_type === 'SRV') && (
                            <FormField label={t('app.domainDnsPanel.priority', 'Priority')}>
                                <Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
                            </FormField>
                        )}
                    </FormRow>
                    {isCloudflare && PROXYABLE.includes(form.record_type) && (
                        <label className="ddp__proxy-toggle">
                            <input type="checkbox" checked={!!form.proxied} onChange={(e) => setForm({ ...form, proxied: e.target.checked })} />
                            {t('app.domainDnsPanel.proxyThroughCloudflareOrangeCloud', 'Proxy through Cloudflare (orange cloud)')}
                        </label>
                    )}
                    <div className="ddp__form-actions">
                        <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button size="sm" disabled={!form.content || saving} onClick={handleAdd}>
                            {saving ? t('app.domainDnsPanel.adding', 'Adding…') : t('app.domainDnsPanel.addRecord', 'Add record')}
                        </Button>
                    </div>
                </div>
            )}

            {state === 'loading' && <p className="ddp__msg">{t('app.domainDnsPanel.loadingRecords', 'Loading records…')}</p>}
            {state === 'error' && <p className="ddp__msg ddp__msg--error">{error}</p>}
            {state === 'none' && <p className="ddp__msg">{t('app.domainDnsPanel.thisDomainIsnTSetUp', 'This domain isn\'t set up for DNS in ServerKit yet.')}</p>}

            {state === 'ready' && (
                records.length === 0 ? (
                    <p className="ddp__msg">{t('app.domainDnsPanel.noDnsRecordsYet', 'No DNS records yet.')}</p>
                ) : (
                    <DataTable
                        columns={columns}
                        data={records}
                        keyField="id"
                        storageKey="serverkit-table-domain-dns"
                        className="ddp__table-wrap"
                        tableClassName="ddp__table"
                        footer={<DataTableFooter shown={records.length} total={records.length} noun="record" />}
                    />
                )
            )}

            {propOpen && (
                <div className="ddp__prop">
                    {propLoading && <p className="ddp__msg">{t('app.domainDnsPanel.checkingPropagation', 'Checking propagation…')}</p>}
                    {!propLoading && (propResults?.length ? (
                        propResults.map((r, i) => (
                            <div key={i} className="ddp__prop-row">
                                <span className={`status-dot status-dot--${r.propagated ? 'success' : 'danger'}`} />
                                <strong>{r.nameserver}</strong>
                                <span className="ddp__prop-ip">({r.ip})</span>
                                <span className="ddp__prop-res">{r.result?.join(', ') || t('app.domainDnsPanel.noResult', 'No result')}</span>
                            </div>
                        ))
                    ) : (
                        <p className="ddp__msg">{t('app.domainDnsPanel.noPropagationData', 'No propagation data.')}</p>
                    ))}
                </div>
            )}

            <div className="ddp__foot">
                {canExport && (
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                        <Download size={14} /> {exporting ? t('app.domainDnsPanel.exporting', 'Exporting…') : t('common.actions.export', 'Export')}
                    </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleCheckPropagation}>
                    <Activity size={14} /> {propOpen ? t('app.domainDnsPanel.hidePropagation', 'Hide propagation') : t('app.domainDnsPanel.checkPropagation', 'Check propagation')}
                </Button>
                {isCloudflare && (
                    <Button variant="outline" size="sm" onClick={openCloudflareOps}>
                        <ProviderBrandIcon provider="cloudflare" size={14} /> {t('app.domainDnsPanel.openInCloudflare', 'Open in Cloudflare')}
                    </Button>
                )}
            </div>
        </div>
    );
}
