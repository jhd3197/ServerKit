import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { SegControl } from '@/components/ds';
import { cn } from '@/lib/utils';
import api from '../services/api';
import { normalizeDomain, isValidDomain, slugifyLabel, labelUnderBase } from '../utils/domains';

// The base domains rarely change while the panel is open, and several fields
// can mount on one screen, so they share one request.
let basesRequest = null;
function loadBases() {
    if (!basesRequest) {
        basesRequest = api.getSiteBaseDomains()
            .then((res) => res?.base_domains || [])
            .catch(() => {
                basesRequest = null;
                return [];
            });
    }
    return basesRequest;
}

/**
 * The one input for "which domain should this live on".
 *
 *   <DomainField value={fqdn} onChange={(fqdn, info) => …} />
 *
 * Two modes, shown as a toggle when both are allowed and a base domain exists:
 *   - subdomain: a label in front of a ServerKit-managed base domain
 *     (Settings → Sites). The status line says whether wildcard DNS already
 *     covers it or ServerKit will create the record.
 *   - custom: any hostname the user controls, with the existing ServerKit
 *     domains offered as suggestions.
 *
 * `onChange` receives the normalized hostname ('' while incomplete) and
 * `{ mode, valid, base, label, dnsMode, https }` so the caller can pick the
 * right API (give-subdomain vs create-domain) without re-deriving anything.
 */
export default function DomainField({
    value = '',
    onChange,
    modes = ['subdomain', 'custom'],
    defaultLabel = '',
    exclude = [],
    disabled = false,
    autoFocus = false,
    id,
    className,
}) {
    const { t } = useTranslation();
    const fallbackId = useId();
    const inputId = id || fallbackId;
    const listId = `${inputId}-existing`;

    const [bases, setBases] = useState([]);
    const [basesLoaded, setBasesLoaded] = useState(false);
    const [existing, setExisting] = useState([]);
    const [mode, setMode] = useState(modes[0]);
    const [base, setBase] = useState('');
    const [label, setLabel] = useState(slugifyLabel(defaultLabel));
    const [custom, setCustom] = useState(value);
    const [touched, setTouched] = useState(false);
    const seeded = useRef(false);

    const allowSubdomain = modes.includes('subdomain') && bases.length > 0;
    const allowCustom = modes.includes('custom');
    const activeMode = mode === 'subdomain' && !allowSubdomain && allowCustom ? 'custom' : mode;

    useEffect(() => {
        let cancelled = false;
        if (modes.includes('subdomain')) {
            loadBases().then((rows) => {
                if (cancelled) return;
                setBases(rows);
                setBasesLoaded(true);
            });
        } else {
            setBasesLoaded(true);
        }
        if (modes.includes('custom')) {
            api.getDomains()
                .then((res) => { if (!cancelled) setExisting(res?.domains || []); })
                .catch(() => {});
        }
        return () => { cancelled = true; };
        // Load once per mount; the mode list is static for a given call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Seed from an incoming value once the bases are known: a value that sits
    // under a base opens in subdomain mode with its label filled in.
    useEffect(() => {
        if (!basesLoaded || seeded.current) return;
        seeded.current = true;
        const preferred = bases.find((b) => b.is_default) || bases[0];
        const owner = value ? bases.find((b) => labelUnderBase(value, b.domain)) : null;
        if (owner && modes.includes('subdomain')) {
            setMode('subdomain');
            setBase(owner.domain);
            setLabel(labelUnderBase(value, owner.domain));
        } else {
            setBase(preferred?.domain || '');
            if (value && modes.includes('custom')) setMode('custom');
        }
    }, [basesLoaded, bases, value, modes]);

    const baseRow = bases.find((b) => b.domain === base) || null;
    const fqdn = activeMode === 'subdomain'
        ? (label && base ? normalizeDomain(`${label.replace(/\.+$/, '')}.${base}`) : '')
        : normalizeDomain(custom);
    const valid = isValidDomain(fqdn);
    const existingRow = existing.find((d) => d.name === fqdn) || null;

    const lastEmitted = useRef(null);
    useEffect(() => {
        if (!basesLoaded) return;
        const info = {
            mode: activeMode,
            valid,
            base: activeMode === 'subdomain' ? base : null,
            label: activeMode === 'subdomain' ? label : null,
            dnsMode: activeMode === 'subdomain' ? baseRow?.dns_mode || null : null,
            https: activeMode === 'subdomain' ? !!baseRow?.https_enabled : !!existingRow?.ssl_enabled,
        };
        const key = `${fqdn}|${info.mode}|${info.valid}|${info.base}`;
        if (lastEmitted.current === key) return;
        lastEmitted.current = key;
        onChange?.(valid ? fqdn : '', info);
    }, [basesLoaded, activeMode, fqdn, valid, base, label, baseRow, existingRow, onChange]);

    const suggestions = useMemo(
        () => existing.filter((d) => !exclude.includes(d.name)),
        [existing, exclude],
    );

    let status = null;
    if (fqdn && !valid) {
        status = { tone: 'error', text: t('app.domainField.notAHostname', '{{name}} is not a valid hostname.', { name: fqdn }) };
    } else if (fqdn && activeMode === 'subdomain') {
        status = baseRow?.dns_mode === 'wildcard'
            ? { text: t('app.domainField.wildcardCovers', '{{name}} resolves right away; wildcard DNS on {{base}} already covers it.', { name: fqdn, base }) }
            : { text: t('app.domainField.recordCreated', 'ServerKit creates the DNS record for {{name}}.', { name: fqdn }) };
    } else if (fqdn && existingRow) {
        status = { text: t('app.domainField.alreadyInServerkit', 'Already in ServerKit.') };
    } else if (fqdn) {
        status = { text: t('app.domainField.pointARecord', 'Point an A record for {{name}} at this server.', { name: fqdn }) };
    } else if (activeMode === 'custom' && !allowSubdomain && modes.includes('subdomain') && basesLoaded) {
        status = { text: t('app.domainField.noBaseDomain', 'Add a base domain in Settings → Sites to hand out subdomains.') };
    }

    return (
        <div className={cn('sk-domain-field', className)}>
            {allowSubdomain && allowCustom && (
                <SegControl
                    className="sk-domain-field__modes"
                    value={activeMode}
                    onChange={(next) => { setMode(next); setTouched(false); }}
                    aria-label={t('app.domainField.domainKind', 'Domain kind')}
                    options={[
                        { value: 'subdomain', label: t('app.domainField.subdomain', 'Subdomain') },
                        { value: 'custom', label: t('app.domainField.ownDomain', 'Own domain') },
                    ]}
                />
            )}

            {activeMode === 'subdomain' ? (
                <div className="sk-domain-field__row">
                    <Input
                        id={inputId}
                        value={label}
                        onChange={(e) => setLabel(slugifyLabel(e.target.value))}
                        onBlur={() => setTouched(true)}
                        placeholder="my-app"
                        disabled={disabled}
                        autoFocus={autoFocus}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {bases.length > 1 ? (
                        <Select value={base} onValueChange={setBase} disabled={disabled}>
                            <SelectTrigger className="sk-domain-field__base" aria-label={t('app.domainField.baseDomain', 'Base domain')}>
                                <span className="sk-domain-field__dot">.</span><SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {bases.map((b) => (
                                    <SelectItem key={b.domain} value={b.domain}>{b.domain}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <span className="sk-domain-field__suffix">.{base}</span>
                    )}
                </div>
            ) : (
                <>
                    <Input
                        id={inputId}
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        onBlur={() => { setTouched(true); setCustom((v) => normalizeDomain(v)); }}
                        placeholder="app.example.com"
                        disabled={disabled}
                        autoFocus={autoFocus}
                        autoComplete="off"
                        spellCheck={false}
                        list={suggestions.length ? listId : undefined}
                        aria-invalid={touched && !!fqdn && !valid}
                    />
                    {suggestions.length > 0 && (
                        <datalist id={listId}>
                            {suggestions.map((d) => <option key={d.id ?? d.name} value={d.name} />)}
                        </datalist>
                    )}
                </>
            )}

            {status && (status.tone !== 'error' || touched) && (
                <p className={cn('sk-domain-field__status', status.tone === 'error' && 'is-error')}>
                    {status.text}
                    {!status.tone && fqdn && (activeMode === 'subdomain' ? baseRow?.https_enabled : existingRow?.ssl_enabled) && (
                        <> {t('app.domainField.httpsOn', 'HTTPS is on.')}</>
                    )}
                </p>
            )}
        </div>
    );
}
