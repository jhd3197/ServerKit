import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ds';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '@/hooks/useConfirm';
import { formatRelativeShort } from '@/utils/intl';

// A/B slot deploys (plan 87 §F). Shows which slot serves, which one is the
// standby and for how long it stays warm, with the instant switch back. When
// the feature is off it says why the app does or does not qualify.
function minutesLeft(until) {
    if (!until) return null;
    const ms = new Date(until).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function shortSha(sha) {
    return sha ? sha.slice(0, 7) : null;
}

export default function SlotsCard({ app }) {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [state, setState] = useState(null);
    const [switching, setSwitching] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const load = useCallback(() => {
        let cancelled = false;
        api.getAppSlots(app.id)
            .then((data) => { if (!cancelled) setState(data); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [app.id]);

    useEffect(() => load(), [load]);

    if (!state || app.app_type !== 'docker') return null;

    const live = state.slots.find((s) => s.slot === state.active_slot);
    const standby = state.slots.find((s) => s.slot !== state.active_slot
        && ['standby', 'stopped'].includes(s.state));

    async function handleSwitchBack() {
        if (!await confirm({
            title: t('app.slots.switchBack', 'Switch back'),
            message: t('app.slots.switchBackConfirm', 'Send traffic back to slot {{slot}} (v{{version}})? The database is not rolled back.', {
                slot: standby.slot.toUpperCase(), version: standby.version,
            }),
            confirmText: t('app.slots.switchBack', 'Switch back'),
        })) return;
        setSwitching(true);
        try {
            await api.switchBackAppSlot(app.id);
            toast.success(t('app.slots.switchedBack', 'Traffic is back on the previous release.'));
            load();
        } catch (err) {
            toast.error(err.message || t('app.slots.switchBackFailed', 'Switching back failed'));
        } finally {
            setSwitching(false);
        }
    }

    // Rolling code back never rolls the database back. This is the explicit
    // second step, with the data-loss warning where the choice is made.
    async function handleRestoreDb() {
        const offer = state.restorable_db;
        if (!await confirm({
            title: t('app.slots.restoreDb', 'Restore the database'),
            message: t('app.slots.restoreDbConfirm', 'Restore {{databases}} to the snapshot taken before v{{version}} ran its release command? Everything written to the database since then is lost.', {
                databases: offer.databases.join(', '), version: offer.version,
            }),
            confirmText: t('app.slots.restoreDbConfirmButton', 'Restore and lose later writes'),
            variant: 'danger',
        })) return;
        setRestoring(true);
        try {
            await api.restoreAppSlotDatabase(app.id, offer.deployment_id);
            toast.success(t('app.slots.restoredDb', 'Database restored to before v{{version}}', { version: offer.version }));
            load();
        } catch (err) {
            toast.error(err.message || t('app.slots.restoreDbFailed', 'Restoring the database failed'));
        } finally {
            setRestoring(false);
        }
    }

    function slotLine(slot) {
        const parts = [slot.slot.toUpperCase()];
        if (slot.version) parts.push(`v${slot.version}`);
        const sha = shortSha(slot.commit_sha);
        if (sha) parts.push(sha);
        return parts.join(' · ');
    }

    return (
        <div className="overview-tab__card overview-tab__card--full slots-card">
            <div className="overview-tab__card-header-row">
                <h3 className="overview-tab__card-title">{t('app.slots.title', 'Slot deploys')}</h3>
                <Pill kind={state.enabled ? 'green' : 'gray'}>
                    {state.enabled ? t('app.slots.on', 'On') : t('app.slots.off', 'Off')}
                </Pill>
            </div>

            {state.enabled && live ? (
                <dl className="slots-card__slots">
                    <div className="slots-card__row">
                        <dt>{t('app.slots.live', 'Live')}</dt>
                        <dd>
                            <span className="slots-card__release">{slotLine(live)}</span>
                            {live.started_at && (
                                <span className="slots-card__meta">{formatRelativeShort(live.started_at)}</span>
                            )}
                        </dd>
                    </div>
                    <div className="slots-card__row">
                        <dt>{t('app.slots.standby', 'Standby')}</dt>
                        <dd>
                            {standby ? (
                                <>
                                    <span className="slots-card__release">{slotLine(standby)}</span>
                                    <span className="slots-card__meta">
                                        {standby.state === 'standby'
                                            ? t('app.slots.warmLeft', 'warm, {{count}} min left', { count: minutesLeft(standby.standby_until) ?? 0 })
                                            : t('app.slots.stopped', 'stopped, starts on switch back')}
                                    </span>
                                    <Button variant="outline" size="sm" onClick={handleSwitchBack} disabled={switching}>
                                        {switching ? t('app.slots.switching', 'Switching…') : t('app.slots.switchBack', 'Switch back')}
                                    </Button>
                                </>
                            ) : (
                                <span className="slots-card__meta">
                                    {t('app.slots.noStandby', 'None yet. The next deploy boots beside the live release, and this one becomes the standby.')}
                                </span>
                            )}
                        </dd>
                    </div>
                </dl>
            ) : (
                <div className="slots-card__off">
                    <p className="slots-card__hint">
                        {t('app.slots.explain', 'A deploy boots the new release beside the live one, checks that it answers, then switches traffic over. A release that fails never replaces the working one, and the previous release stays ready for an instant switch back.')}
                    </p>
                    {state.eligibility.eligible ? (
                        <p className="slots-card__hint">
                            {t('app.slots.eligible', 'This service qualifies.')}{' '}
                            <Link to={`/services/${app.id}/settings/health`}>
                                {t('app.slots.turnOn', 'Turn it on in Settings')}
                            </Link>
                        </p>
                    ) : (
                        <ul className="slots-card__reasons">
                            {state.eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                        </ul>
                    )}
                </div>
            )}

            {state.enabled && state.restorable_db && (
                <div className="slots-card__restore">
                    <p className="slots-card__hint">
                        {t('app.slots.restoreDbHint', 'v{{version}} ran its release command before it was switched away from, so the database may still have its changes. The code went back; the database did not.', { version: state.restorable_db.version })}
                    </p>
                    <Button variant="outline" size="sm" onClick={handleRestoreDb} disabled={restoring}>
                        {restoring ? t('app.slots.restoringDb', 'Restoring…') : t('app.slots.restoreDb', 'Restore the database')}
                    </Button>
                </div>
            )}

            {state.enabled && state.eligibility.warnings.length > 0 && (
                <ul className="slots-card__reasons slots-card__reasons--warn">
                    {state.eligibility.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
            )}
        </div>
    );
}
