import { useState, useEffect, useCallback } from 'react';
import { Mail, Plus, Trash2, Check, Star } from 'lucide-react';
import api from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PortField from './PortField';
import { useToast } from '../contexts/useToast.js';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const FIELD_LABELS = {
    host: 'Host', port: 'Port', username: 'Username', password: 'Password', use_tls: 'Use TLS',
    api_key: 'API key', server_token: 'Server token', access_key: 'Access key ID',
    secret_key: 'Secret access key', region: 'Region', domain: 'Domain',
};

function Field({ label, children }) {
    return (
        <div className="sk-eprov__field">
            <Label>{label}</Label>
            {children}
        </div>
    );
}

export default function EmailProviders() {
    const { t } = useTranslation();
    const toast = useToast();
    const [providers, setProviders] = useState([]);
    const [supported, setSupported] = useState({});
    const [loading, setLoading] = useState(true);
    const [type, setType] = useState('');
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);
    const [confirmId, setConfirmId] = useState(null);

    const load = useCallback(async () => {
        try {
            const data = await api.getEmailProviders();
            setProviders(data.providers || []);
            setSupported(data.supported || {});
        } catch {
            // leave state as-is
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const spec = supported[type];
    const adding = Boolean(type);

    const startAdd = (key) => { setType(key); setForm({ from_name: 'ServerKit', use_tls: true }); };
    const cancel = () => { setType(''); setForm({}); };
    const onField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

    const submit = async () => {
        setBusy(true);
        try {
            const payload = {
                provider: type,
                name: form.name || spec.name,
                from_address: form.from_address,
                from_name: form.from_name,
            };
            (spec.fields || []).forEach((f) => { if (form[f] !== undefined) payload[f] = form[f]; });
            const res = await api.addEmailProvider(payload);
            if (res?.test && res.test.success === false) {
                toast.warning(t('app.emailProviders.addedButTestFailed', 'Added, but test failed: {{value}}', { value: res.test.error || 'check credentials' }));
            } else {
                toast.success(t('app.emailProviders.emailProviderAdded', 'Email provider added'));
            }
            cancel();
            load();
        } catch (e) {
            toastError(toast, t('app.emailProviders.failedToAddProvider', 'Failed to add provider'), e);
        } finally {
            setBusy(false);
        }
    };

    const onTest = async (id) => {
        setBusy(true);
        try {
            const r = await api.testEmailProvider(id);
            if (r.success) toast.success(t('app.emailProviders.credentialsOk', 'Credentials OK')); else toastError(toast, t('app.emailProviders.testFailed', 'Test failed'), r.error);
            load();
        } catch (err) {
            toastError(toast, t('app.emailProviders.testFailed', 'Test failed'), err);
        } finally {
            setBusy(false);
        }
    };

    const onDefault = async (id) => {
        try { await api.setDefaultEmailProvider(id); toast.success(t('app.emailProviders.defaultTransportUpdated', 'Default transport updated')); load(); }
        catch (err) { toastError(toast, t('app.emailProviders.failedToSetDefault', 'Failed to set default'), err); }
    };

    const onDelete = async (id) => {
        try { await api.deleteEmailProvider(id); toast.success(t('app.emailProviders.providerRemoved', 'Provider deleted')); setConfirmId(null); load(); }
        catch (err) { toastError(toast, t('app.emailProviders.failedToRemove', 'Failed to delete'), err); }
    };

    return (
        <section className="sk-eprov">
            <header className="sk-eprov__head">
                <span className="sk-eprov__title"><Mail size={16} /> {t('app.emailProviders.emailTransport', 'Email transport')}</span>
                <span className="sk-eprov__sub">{t('app.emailProviders.howNotificationEmailsAreSent', 'How notification emails are sent')}</span>
            </header>

            {loading ? (
                <div className="sk-eprov__empty">{t('common.loading', 'Loading…')}</div>
            ) : (
                <>
                    {providers.length === 0 ? (
                        <div className="sk-eprov__empty">
                            {t('app.emailProviders.noProviderConfiguredEmailsFallBack', 'No provider configured. Emails fall back to the SMTP channel settings.')}
                        </div>
                    ) : (
                        <ul className="sk-eprov__list">
                            {providers.map((p) => (
                                <li key={p.id} className="sk-eprov__item">
                                    <div className="sk-eprov__meta">
                                        <span className="sk-eprov__name">
                                            {p.name}
                                            {p.is_default && <span className="sk-eprov__badge">{t('common.labels.default', 'Default')}</span>}
                                        </span>
                                        <span className="sk-eprov__type">
                                            {p.provider}
                                            {p.from_address ? ` · ${p.from_address}` : ''}
                                            {p.last_test_ok === true ? ' · ✓ tested' : ''}
                                            {p.last_test_ok === false ? ' · ✗ test failed' : ''}
                                        </span>
                                    </div>
                                    <div className="sk-eprov__actions">
                                        {!p.is_default && (
                                            <Button variant="ghost" size="sm" onClick={() => onDefault(p.id)}>
                                                <Star size={14} /> {t('common.labels.default', 'Default')}
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onTest(p.id)}>
                                            <Check size={14} /> {t('common.actions.test', 'Test')}
                                        </Button>
                                        {confirmId === p.id ? (
                                            <Button variant="destructive" size="sm" onClick={() => onDelete(p.id)}>{t('app.emailProviders.confirm', 'Confirm')}</Button>
                                        ) : (
                                            <Button variant="ghost" size="sm" onClick={() => setConfirmId(p.id)} aria-label={t('common.actions.delete', 'Delete')}>
                                                <Trash2 size={14} />
                                            </Button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}

                    {!adding ? (
                        <div className="sk-eprov__add">
                            {Object.entries(supported).map(([key, s]) => (
                                <Button key={key} variant="outline" size="sm" onClick={() => startAdd(key)}>
                                    <Plus size={14} /> {s.name}
                                </Button>
                            ))}
                        </div>
                    ) : (
                        <div className="sk-eprov__form">
                            <div className="sk-eprov__form-title">{t('common.actions.add', 'Add')} {spec?.name}</div>
                            <div className="sk-eprov__grid">
                                <Field label={t('app.emailProviders.displayName', 'Display name')}>
                                    <Input value={form.name || ''} onChange={(e) => onField('name', e.target.value)} placeholder={spec?.name} />
                                </Field>
                                <Field label={t('app.emailProviders.fromAddress', 'From address')}>
                                    <Input value={form.from_address || ''} onChange={(e) => onField('from_address', e.target.value)} placeholder="no-reply@yourdomain.com" />
                                </Field>
                                <Field label={t('app.emailProviders.fromName', 'From name')}>
                                    <Input value={form.from_name || ''} onChange={(e) => onField('from_name', e.target.value)} />
                                </Field>
                                {(spec?.fields || []).map((f) => (
                                    f === 'use_tls' ? (
                                        <Field key={f} label={FIELD_LABELS[f] || f}>
                                            <label className="sk-eprov__check">
                                                <input
                                                    type="checkbox"
                                                    checked={form.use_tls !== false}
                                                    onChange={(e) => onField('use_tls', e.target.checked)}
                                                />
                                                STARTTLS
                                            </label>
                                        </Field>
                                    ) : f === 'port' ? (
                                        // The relay's SMTP port (25/465/587): a remote port,
                                        // never one this host binds, so no host check.
                                        <Field key={f} label={FIELD_LABELS[f] || f}>
                                            <PortField
                                                host={false}
                                                allowPrivileged
                                                placeholder="587"
                                                value={form.port || ''}
                                                onChange={(v) => onField('port', v === '' ? '' : String(v))}
                                            />
                                        </Field>
                                    ) : (
                                        <Field key={f} label={FIELD_LABELS[f] || f}>
                                            <Input
                                                type={spec.secrets.includes(f) ? 'password' : 'text'}
                                                value={form[f] || ''}
                                                onChange={(e) => onField(f, e.target.value)}
                                            />
                                        </Field>
                                    )
                                ))}
                            </div>
                            <div className="sk-eprov__form-actions">
                                <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>{t('common.actions.cancel', 'Cancel')}</Button>
                                <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add & test'}</Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
