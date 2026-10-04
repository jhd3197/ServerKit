import { useState, useEffect, useCallback } from 'react';
import {
    ArrowRightLeft, ArrowLeft, ArrowRight, Camera, CheckCircle2, RotateCcw,
    AlertTriangle, Globe, RadioTower,
} from 'lucide-react';
import { Drawer, Pill } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import Spinner from '../Spinner';
import { useTranslation } from 'react-i18next';

// Per-domain reversible DNS cutover (plan 31 #5/#6). One shared slide-over,
// reached from the /domains detail drawer and from the Import wizard's final
// step, so the survey → migrate → cutover journey ends in the same place.
//
// Internal stages: target → review (snapshot + TTL guidance + dry-run diff) →
// verify (propagation check + one-click revert). Every write is snapshot-backed
// so it can always be rolled back.
//
//   <CutoverDrawer open={open} onClose={close} domain="example.com"
//                  providerZoneId="abc123" provider="cloudflare"
//                  initialTarget="203.0.113.10" />

const HEAD_ICON_SIZE = 18;
const DRAWER_WIDTH = 720;

// Record types a cutover can repoint. A/AAAA/CNAME cover the "point at the new
// box" case; the operator keeps everything else untouched.
const RECORD_TYPE_CHOICES = ['A', 'AAAA', 'CNAME'];

const STAGES = [
    { id: 'target', labelKey: 'common.labels.target', label: 'Target' },
    { id: 'review', labelKey: 'app.cutoverDrawer.review', label: 'Review' },
    { id: 'verify', labelKey: 'app.cutoverDrawer.verify', label: 'Verify' },
];

// The provider guards (NO_PROVIDER / NO_ZONE) come back as 501/400 with a code;
// surface a plain-language line instead of a raw request-failed toast.
function friendlyError(err) {
    const code = err?.data?.code;
    if (code === 'NO_PROVIDER') {
        return 'Connect a DNS provider first — the cutover reads and writes live records through it.';
    }
    if (code === 'NO_ZONE') {
        return 'This domain has no connected provider zone, so its records can\'t be read or repointed.';
    }
    if (code === 'PROVIDER_READ_FAILED') {
        return `Couldn't read the zone's live records: ${err.message}`;
    }
    return err?.message || 'Something went wrong.';
}

const CutoverDrawer = ({ open, onClose, domain, providerZoneId, provider, initialTarget }) => {
    const { t } = useTranslation();
    const toast = useToast();

    const [stage, setStage] = useState('target');
    const [target, setTarget] = useState('');
    const [zoneId, setZoneId] = useState('');
    const [recordTypes, setRecordTypes] = useState(['A']);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const [snapshot, setSnapshot] = useState(null);
    const [ttl, setTtl] = useState(null);
    const [plan, setPlan] = useState(null);
    const [cutoverResult, setCutoverResult] = useState(null);
    const [verifyResult, setVerifyResult] = useState(null);
    const [revertResult, setRevertResult] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // Re-seed from props each time the drawer is opened, so a previous, possibly
    // abandoned cutover never leaks into the next domain.
    useEffect(() => {
        if (!open) return;
        setStage('target');
        setTarget(initialTarget || '');
        setZoneId(providerZoneId || '');
        setRecordTypes(['A']);
        setBusy(false);
        setError('');
        setSnapshot(null);
        setTtl(null);
        setPlan(null);
        setCutoverResult(null);
        setVerifyResult(null);
        setRevertResult(null);
        setConfirmOpen(false);
    }, [open, initialTarget, providerZoneId]);

    const toggleRecordType = (t) => {
        setRecordTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
    };

    // target → review: snapshot the live records, derive TTL guidance from them,
    // and compute the (provider-free) dry-run diff.
    const captureAndReview = async () => {
        setBusy(true);
        setError('');
        try {
            const snap = await api.snapshotDnsForCutover(domain, zoneId.trim(), provider || null);
            setSnapshot(snap);
            const [guidance, dry] = await Promise.all([
                api.getCutoverTtlGuidance(snap.records || []).catch(() => null),
                api.performDnsCutover(snap.id, target.trim(), { recordTypes, dryRun: true }),
            ]);
            setTtl(guidance);
            setPlan(dry.plan || null);
            setStage('review');
        } catch (err) {
            setError(friendlyError(err));
        } finally {
            setBusy(false);
        }
    };

    // review → verify: perform the real cutover through the guarded write path.
    const applyCutover = async () => {
        if (!snapshot) return;
        setConfirmOpen(false);
        setBusy(true);
        setError('');
        try {
            const res = await api.performDnsCutover(snapshot.id, target.trim(), { recordTypes, dryRun: false });
            setSnapshot(res.snapshot || snapshot);
            setCutoverResult(res.cutover || null);
            setStage('verify');
            if (res.cutover?.success) {
                toast.success(t('app.cutoverDrawer.cutoverAppliedNowPointsAt', 'Cutover applied. {{domain}} now points at {{value}}', { domain: domain, value: target.trim() }));
            } else {
                toast.error(t('app.cutoverDrawer.cutoverFinishedWithErrorsReviewThe', 'Cutover finished with errors. Review the results and consider reverting.'));
            }
        } catch (err) {
            const message = friendlyError(err);
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const checkPropagation = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const primaryType = recordTypes[0] || 'A';
            const res = await api.verifyDnsCutover(domain, {
                recordType: primaryType,
                expected: target.trim(),
                snapshotId: snapshot?.id || null,
            });
            setVerifyResult(res);
        } catch (err) {
            setError(friendlyError(err));
        } finally {
            setBusy(false);
        }
    }, [domain, recordTypes, target, snapshot]);

    const revert = async () => {
        if (!snapshot) return;
        setBusy(true);
        setError('');
        try {
            const res = await api.revertDnsCutover(snapshot.id);
            setSnapshot(res.snapshot || snapshot);
            setRevertResult(res.revert || null);
            if (res.revert?.success) {
                toast.success(t('app.cutoverDrawer.revertedRestoredSPreCutoverRecords', "Reverted: restored {{domain}}'s pre-cutover records", { domain: domain }));
            } else {
                toast.error(t('app.cutoverDrawer.revertFinishedWithErrorsCheckThe', 'Revert finished with errors. Check the results.'));
            }
        } catch (err) {
            const message = friendlyError(err);
            setError(message);
            toast.error(message);
        } finally {
            setBusy(false);
        }
    };

    const noZone = !zoneId.trim();
    const canCapture = !!target.trim() && !noZone && recordTypes.length > 0;
    const stageIndex = STAGES.findIndex((s) => s.id === stage);

    return (
        <Drawer
            open={open}
            onOpenChange={(v) => !v && onClose()}
            title={t('app.cutoverDrawer.dnsCutover', 'DNS cutover')}
            subtitle={<span className="mono">{domain}</span>}
            icon={<ArrowRightLeft size={HEAD_ICON_SIZE} />}
            width={DRAWER_WIDTH}
        >
            <div className="cutover">
                <ol className="cutover__stepper">
                    {STAGES.map((s, i) => (
                        <li
                            key={s.id}
                            className={`cutover__step${i === stageIndex ? ' is-active' : ''}${i < stageIndex ? ' is-done' : ''}`}
                        >
                            <span className="cutover__step-dot">
                                {i < stageIndex ? <CheckCircle2 size={13} aria-hidden="true" /> : i + 1}
                            </span>
                            {s.label}
                        </li>
                    ))}
                </ol>

                {error && (
                    <div className="cutover__callout cutover__callout--danger">
                        <AlertTriangle size={16} aria-hidden="true" />
                        <p>{error}</p>
                    </div>
                )}

                {/* Stage 1 — pick the target address + record types */}
                {stage === 'target' && (
                    <div className="cutover__stage">
                        <p className="cutover__lead">
                            {t('app.cutoverDrawer.repoint', 'Repoint')} <strong>{domain}</strong> {t('app.cutoverDrawer.atTheBoxWhereTheImported', 'at the server where the imported site now lives. Its current records are snapshotted first, so the switch can always be reverted.')}
                        </p>

                        <div className="cutover__field">
                            <Label htmlFor="cutover-target">{t('app.cutoverDrawer.newAddressTarget', 'New address (target)')}</Label>
                            <Input
                                id="cutover-target"
                                value={target}
                                onChange={(e) => setTarget(e.target.value)}
                                placeholder="203.0.113.10"
                                disabled={busy}
                            />
                            <span className="cutover__hint">{t('app.cutoverDrawer.theIpOrHostnameForCname', 'The IP (or hostname for CNAME) the records should point to.')}</span>
                        </div>

                        <div className="cutover__field">
                            <Label htmlFor="cutover-zone">{t('app.cutoverDrawer.providerZoneId', 'Provider zone id')}</Label>
                            <Input
                                id="cutover-zone"
                                value={zoneId}
                                onChange={(e) => setZoneId(e.target.value)}
                                placeholder={t('app.cutoverDrawer.theDnsProviderSZoneIdentifier', 'the DNS provider\'s zone identifier')}
                                disabled={busy}
                            />
                            {noZone && (
                                <span className="cutover__hint cutover__hint--warn">
                                    {t('app.cutoverDrawer.thisDomainHasNoConnectedProvider', 'This domain has no connected provider zone. Cutover needs one to read and write records.')}
                                </span>
                            )}
                        </div>

                        <div className="cutover__field">
                            <Label>{t('app.cutoverDrawer.recordTypes', 'Record types')}</Label>
                            <div className="cutover__types">
                                {RECORD_TYPE_CHOICES.map((t) => (
                                    <label key={t} className="cutover__type">
                                        <input
                                            type="checkbox"
                                            checked={recordTypes.includes(t)}
                                            onChange={() => toggleRecordType(t)}
                                            disabled={busy}
                                        />
                                        {t}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="cutover__actions">
                            <span />
                            <Button onClick={captureAndReview} disabled={busy || !canCapture}>
                                {busy ? <><Spinner size="sm" /> {t('app.cutoverDrawer.capturing', 'Capturing…')}</> : <><Camera size={14} /> {t('app.cutoverDrawer.snapshotPreview', 'Snapshot and preview')} <ArrowRight size={14} /></>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Stage 2 — snapshot summary, TTL guidance, dry-run diff */}
                {stage === 'review' && (
                    <div className="cutover__stage">
                        <div className="cutover__summary">
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{snapshot?.record_count ?? 0}</span>
                                <span className="cutover__stat-label">{t('app.cutoverDrawer.recordsCaptured', 'records captured')}</span>
                            </div>
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{target.trim()}</span>
                                <span className="cutover__stat-label">{t('app.cutoverDrawer.newTarget', 'new target')}</span>
                            </div>
                            <div className="cutover__stat">
                                <span className="cutover__stat-val">{recordTypes.join(', ')}</span>
                                <span className="cutover__stat-label">{t('app.cutoverDrawer.recordTypes2', 'record types')}</span>
                            </div>
                        </div>

                        {ttl && (
                            <div className={`cutover__callout${ttl.needs_lowering ? ' cutover__callout--warning' : ' cutover__callout--info'}`}>
                                <RadioTower size={16} aria-hidden="true" />
                                <p>{ttl.message}</p>
                            </div>
                        )}

                        <section className="cutover__section">
                            <h3><Globe size={15} aria-hidden="true" /> {t('app.cutoverDrawer.plannedChanges', 'Planned changes')}</h3>
                            {plan?.ops?.length ? (
                                <div className="cutover__table-wrap">
                                    <table className="cutover__table">
                                        <thead>
                                            <tr><th>{t('common.labels.type', 'Type')}</th><th>{t('common.labels.name', 'Name')}</th><th>{t('common.labels.action', 'Action')}</th><th>{t('common.labels.current', 'Current')}</th><th>{t('app.cutoverDrawer.new', 'New')}</th></tr>
                                        </thead>
                                        <tbody>
                                            {plan.ops.map((op, i) => (
                                                <tr key={`${op.record_type}-${op.name}-${i}`}>
                                                    <td>{op.record_type}</td>
                                                    <td>{op.name}</td>
                                                    <td>
                                                        <Pill kind={op.action === 'create' ? 'cyan' : 'amber'}>{op.action}</Pill>
                                                    </td>
                                                    <td><code>{op.old_content || '—'}</code></td>
                                                    <td><code>{op.new_content}</code></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="cutover__muted">{t('app.cutoverDrawer.noChangesToApplyForThe', 'No changes to apply for the selected record types.')}</p>
                            )}
                        </section>

                        <div className="cutover__actions">
                            <Button variant="outline" onClick={() => setStage('target')} disabled={busy}>
                                <ArrowLeft size={14} /> {t('common.actions.back', 'Back')}
                            </Button>
                            <Button onClick={() => setConfirmOpen(true)} disabled={busy || !plan?.ops?.length}>
                                {busy ? <><Spinner size="sm" /> {t('app.cutoverDrawer.applying', 'Applying…')}</> : <><ArrowRightLeft size={14} /> {t('app.cutoverDrawer.applyCutover', 'Apply cutover')}</>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Stage 3 — cutover result, verify, revert */}
                {stage === 'verify' && (
                    <div className="cutover__stage">
                        {cutoverResult && (
                            <div className={`cutover__callout${cutoverResult.success ? ' cutover__callout--success' : ' cutover__callout--danger'}`}>
                                {cutoverResult.success
                                    ? <CheckCircle2 size={16} aria-hidden="true" />
                                    : <AlertTriangle size={16} aria-hidden="true" />}
                                <p>
                                    {cutoverResult.success
                                        ? <>{t('app.cutoverDrawer.cutoverApplied', 'Cutover applied:')} <strong>{domain}</strong> {t('app.cutoverDrawer.nowPointsAt', 'now points at')} <code>{target.trim()}</code>.</>
                                        : <>{t('app.cutoverDrawer.cutoverFinishedWithErrorsReviewBelow', 'Cutover finished with errors. Review below and revert if needed.')}</>}
                                </p>
                            </div>
                        )}

                        <section className="cutover__section">
                            <h3><RadioTower size={15} aria-hidden="true" /> {t('app.cutoverDrawer.propagation', 'Propagation')}</h3>
                            <p className="cutover__muted">
                                {t('app.cutoverDrawer.publicResolversCacheTheOldAddress', 'Public resolvers cache the old address until their TTL expires. Check where the new address has taken effect.')}
                            </p>

                            {verifyResult && (
                                <div className="cutover__verify-head">
                                    {verifyResult.matches_expected != null && (
                                        <Pill kind={verifyResult.matches_expected ? 'green' : 'amber'}>
                                            {verifyResult.matches_expected ? t('app.cutoverDrawer.matchesNewTarget', 'Matches new target') : t('app.cutoverDrawer.notFullyPropagated', 'Not fully propagated')}
                                        </Pill>
                                    )}
                                    <Pill kind={verifyResult.propagated ? 'green' : 'gray'}>
                                        {verifyResult.propagated ? t('app.cutoverDrawer.propagated', 'Propagated') : t('app.cutoverDrawer.propagating', 'Propagating')}
                                    </Pill>
                                </div>
                            )}

                            {verifyResult?.resolvers?.length > 0 && (
                                <div className="cutover__table-wrap">
                                    <table className="cutover__table">
                                        <thead>
                                            <tr><th>{t('app.cutoverDrawer.resolver', 'Resolver')}</th><th>{t('app.cutoverDrawer.answer', 'Answer')}</th><th>{t('common.labels.status', 'Status')}</th></tr>
                                        </thead>
                                        <tbody>
                                            {verifyResult.resolvers.map((r, i) => (
                                                <tr key={`${r.nameserver}-${i}`}>
                                                    <td>{r.nameserver}</td>
                                                    <td><code>{(r.result || []).join(', ') || '—'}</code></td>
                                                    <td>
                                                        <Pill kind={r.propagated ? 'green' : 'gray'}>
                                                            {r.propagated ? 'live' : 'stale'}
                                                        </Pill>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <Button variant="outline" size="sm" onClick={checkPropagation} disabled={busy}>
                                {busy ? <><Spinner size="sm" /> {t('common.checking', 'Checking…')}</> : <><RadioTower size={14} /> {t('app.cutoverDrawer.checkPropagation', 'Check propagation')}</>}
                            </Button>
                        </section>

                        <section className="cutover__section cutover__section--revert">
                            <h3><RotateCcw size={15} aria-hidden="true" /> {t('app.cutoverDrawer.rollBack', 'Roll back')}</h3>
                            {revertResult ? (
                                <div className={`cutover__callout${revertResult.success ? ' cutover__callout--success' : ' cutover__callout--danger'}`}>
                                    {revertResult.success
                                        ? <CheckCircle2 size={16} aria-hidden="true" />
                                        : <AlertTriangle size={16} aria-hidden="true" />}
                                    <p>
                                        {t('app.cutoverDrawer.restoredRecords', { count: revertResult.results?.length ?? 0, defaultValue_one: 'Restored 1 record.', defaultValue_other: 'Restored {{count}} records.' })}
                                        {revertResult.deleted_count
                                            ? ` ${t('app.cutoverDrawer.deletedCreatedRecords', { count: revertResult.deleted_count, defaultValue_one: 'Deleted 1 record the cutover created.', defaultValue_other: 'Deleted {{count}} records the cutover created.' })}`
                                            : ''}
                                    </p>
                                </div>
                            ) : (
                                <p className="cutover__muted">
                                    {t('app.cutoverDrawer.oneClickRestoresTheSnapshotCaptured', 'One click restores the snapshot captured before this cutover, including deleting any records the cutover created.')}
                                </p>
                            )}
                            <Button variant="outline" size="sm" onClick={revert} disabled={busy || !!revertResult}>
                                {busy ? <><Spinner size="sm" /> {t('app.cutoverDrawer.reverting', 'Reverting…')}</> : <><RotateCcw size={14} /> {t('app.cutoverDrawer.revertCutover', 'Revert cutover')}</>}
                            </Button>
                        </section>

                        <div className="cutover__actions">
                            <span />
                            <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.actions.done', 'Done')}</Button>
                        </div>
                    </div>
                )}

                <ConfirmDialog
                    isOpen={confirmOpen}
                    title={t('app.cutoverDrawer.applyDnsCutover', 'Apply DNS cutover?')}
                    message={t('app.cutoverDrawer.repointsRecords', { count: recordTypes.length, types: recordTypes.join(', '), domain: domain, target: target.trim(), defaultValue_one: 'This repoints the {{types}} record for {{domain}} at {{target}}. The snapshot lets you revert.', defaultValue_other: 'This repoints the {{types}} records for {{domain}} at {{target}}. The snapshot lets you revert.' })}
                    confirmText={t('app.cutoverDrawer.applyCutover', 'Apply cutover')}
                    variant="danger"
                    onConfirm={applyCutover}
                    onCancel={() => setConfirmOpen(false)}
                />
            </div>
        </Drawer>
    );
};

export default CutoverDrawer;
