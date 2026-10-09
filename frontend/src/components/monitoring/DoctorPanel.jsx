import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import Modal from '@/components/Modal';
import { Pill, statusKind } from '@/components/ds';
import EmptyState from '../EmptyState';
import { ChevronDown, ChevronRight, HardDrive, Server, Stethoscope, Wrench } from 'lucide-react';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';
import { useOperations } from '@/contexts/OperationsContext';
import DiskReclaimModal from './DiskReclaimModal';
import { toastError } from '@/utils/errorMessage';


// The fleet sweep fans out across agents over the network, so it is a job
// (202 + job id) rather than a synchronous call — poll it to completion.
const SWEEP_POLL_MS = 3000;
const TERMINAL_JOB_STATUSES = ['succeeded', 'failed', 'cancelled'];

function formatRanAt(ranAt) {
    if (!ranAt) return null;
    return new Date(ranAt).toLocaleString();
}

/**
 * One finding. Rendering is driven entirely by the row's own fields
 * (`status` / `diff` / `repairable` + `repair_ref`), which is why the host
 * doctor and the fleet doctor can share it — a fleet check is the same shape,
 * its repair_ref just names a server.
 */
function DoctorCheck({ check, expanded, onToggleDiff, onRepair, disabled, action }) {
    const { t } = useTranslation();
    return (
        <article className={`doctor-check doctor-check--${check.status}`}>
            <div className="doctor-check__row">
                <Pill kind={statusKind(check.status)}>{check.status}</Pill>
                <div className="doctor-check__body">
                    <span className="doctor-check__title">{check.title}</span>
                    <span className="doctor-check__detail">{check.detail}</span>
                </div>
                {action}
                {check.diff && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="doctor-check__difftoggle"
                        onClick={onToggleDiff}
                    >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        diff
                    </Button>
                )}
                {check.repairable && check.repair_ref && (
                    <Button size="sm" variant="outline" disabled={disabled} onClick={onRepair}>
                        <Wrench size={13} />
                        {t('app.doctorPanel.repair', 'Repair')}
                    </Button>
                )}
            </div>
            {check.diff && expanded && <pre className="doctor-diff">{check.diff}</pre>}
        </article>
    );
}

const DoctorPanel = () => {
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { openRun } = useOperations();
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [expanded, setExpanded] = useState({});
    // { items: [repair_ref...], title, diff, scope } — pending confirmation.
    // `scope` picks the repair endpoint: 'host' (panel box) or 'fleet' (agent).
    const [confirm, setConfirm] = useState(null);

    const [fleet, setFleet] = useState(null);
    const [fleetLoading, setFleetLoading] = useState(true);
    const [sweeping, setSweeping] = useState(false);
    const [sweepJobId, setSweepJobId] = useState(null);
    // The disk.headroom finding offers its own fix: a curated safe reclaim.
    const [reclaimOpen, setReclaimOpen] = useState(false);

    const loadFleet = useCallback(async () => {
        try {
            const res = await api.getFleetDoctorReport();
            setFleet(res.report);
        } catch {
            // Admin-only endpoint; the empty state covers a missing report.
            setFleet(null);
        } finally {
            setFleetLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        api.getDoctorReport()
            .then((res) => { if (!cancelled) setReport(res.report); })
            .catch(() => { /* no stored report yet — the empty state covers it */ })
            .finally(() => { if (!cancelled) setLoading(false); });
        loadFleet();
        return () => { cancelled = true; };
    }, [loadFleet]);

    const runDiagnosis = async () => {
        try {
            setRunning(true);
            const res = await api.runDoctor();
            setReport(res.report);
            const bad = (res.report?.checks || []).filter((c) => c.status !== 'ok').length;
            toast[bad > 0 ? 'warning' : 'success'](
                bad > 0
                    ? t('app.doctorPanel.diagnosisFindings', { count: bad, defaultValue_one: 'Diagnosis finished: 1 finding', defaultValue_other: 'Diagnosis finished: {{count}} findings' })
                    : t('app.doctorPanel.diagnosisClear', 'Diagnosis finished: all clear')
            );
        } catch (err) {
            toastError(toast, t('app.doctorPanel.diagnosisFailed', "Couldn't run the diagnosis."), err);
        } finally {
            setRunning(false);
        }
    };

    // The job id IS the "are we polling" state, so the poll is declarative and
    // the hook owns starting, stopping, and not overlapping ticks.
    const pollSweep = useCallback((jobId) => setSweepJobId(jobId), []);

    usePolling(async () => {
        try {
            const res = await api.getJob(sweepJobId);
            const job = res.job || res;
            if (!TERMINAL_JOB_STATUSES.includes(job.status)) return;
            setSweepJobId(null);
            setSweeping(false);
            if (job.status === 'succeeded') {
                await loadFleet();
                toast.success(t('app.doctorPanel.fleetSweepFinished', 'Fleet sweep finished'));
            } else {
                toastError(toast, t('app.doctorPanel.fleetSweepDidNotFinish', 'Fleet sweep did not finish'), job.error_message);
            }
        } catch {
            // Transient poll failure — the next tick retries.
        }
    }, SWEEP_POLL_MS, { enabled: Boolean(sweepJobId), immediate: false });

    const runSweep = async () => {
        try {
            setSweeping(true);
            const res = await api.runFleetSweep();
            toast.info(t('app.doctorPanel.fleetSweepQueuedProbingEveryConnected', 'Fleet sweep queued. Probing every connected agent.'));
            pollSweep(res.job_id);
        } catch (err) {
            setSweeping(false);
            toastError(toast, t('app.doctorPanel.couldNotQueueTheFleetSweep', "Couldn't queue the fleet sweep."), err);
        }
    };

    const doRepair = async ({ items, scope }) => {
        try {
            setRepairing(true);
            const res = scope === 'fleet'
                ? await api.repairFleetItems(items)
                : await api.repairDoctorItems(items);
            if (scope !== 'fleet' && res.job_id) {
                openRun('job', res.job_id);
                toast.success(t(
                    'app.doctorPanel.repairQueuedInOperations',
                    'Repair queued. Follow progress in Operations.',
                ));
                return;
            }
            const results = res.results || [];
            const failed = results.filter((r) => !r.success);
            // Some repairs run as a background job rather than inline — a
            // restore drill, for one. Those have been QUEUED, not completed,
            // and reporting them as "repaired" would claim an outcome that
            // has not happened yet.
            const queued = results.filter((r) => r.success && r.job_id);
            if (failed.length > 0) {
                toastError(toast, t('app.doctorPanel.repairsFailed', { count: failed.length, defaultValue_one: "Couldn't finish 1 repair.", defaultValue_other: "Couldn't finish {{count}} repairs." }),
                    failed[0].error || t('app.doctorPanel.seeReport', 'See the report for details.'));
            } else if (queued.length > 0) {
                toast.success(
                    t('app.doctorPanel.startedJobs', { count: queued.length, defaultValue_one: 'Started 1 background job. The repair finishes there.', defaultValue_other: 'Started {{count}} background jobs. The repair finishes there.' }),
                    {
                        duration: 10000,
                        action: { label: t('app.doctorPanel.viewJobs', 'View jobs'), onClick: () => navigate('/monitoring/jobs') },
                    },
                );
            } else {
                toast.success(t('app.doctorPanel.repairedItems', { count: items.length, defaultValue_one: 'Repaired 1 item', defaultValue_other: 'Repaired {{count}} items' }));
            }
            if (scope === 'fleet') {
                // Rows only change when a sweep re-probes; re-read what we have.
                await loadFleet();
            } else {
                // Re-diagnose so the list reflects the new on-disk state.
                const fresh = await api.runDoctor();
                setReport(fresh.report);
            }
        } catch (err) {
            toastError(toast, t('app.doctorPanel.repairFailed2', "Couldn't repair it."), err);
        } finally {
            setRepairing(false);
            setConfirm(null);
        }
    };

    const checks = report?.checks || [];
    const repairable = checks.filter((c) => c.repairable && c.repair_ref);
    const fleetServers = fleet?.servers || [];

    const toggleDiff = (key) => {
        setExpanded((cur) => ({ ...cur, [key]: !cur[key] }));
    };

    return (
        <div className="doctor-panel">
            <section className="monitoring-panel">
                <div className="monitoring-panel__header">
                    <h3>{t('app.doctorPanel.serverDoctor', 'Server doctor')}</h3>
                    <div className="doctor-panel__actions">
                        {repairable.length > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={repairing || running}
                                onClick={() => setConfirm({
                                    items: repairable.map((c) => c.repair_ref),
                                    title: t('app.doctorPanel.repairAllItems', { count: repairable.length, defaultValue_one: 'Repair 1 repairable item?', defaultValue_other: 'Repair all {{count}} repairable items?' }),
                                    diff: null,
                                    scope: 'host',
                                })}
                            >
                                <Wrench size={14} />
                                {t('app.doctorPanel.repairAll', 'Repair all (')}{repairable.length})
                            </Button>
                        )}
                        <Button size="sm" onClick={runDiagnosis} disabled={running || repairing}>
                            <Stethoscope size={14} />
                            {running ? t('app.doctorPanel.diagnosing', 'Diagnosing…') : t('app.doctorPanel.runDiagnosis', 'Run diagnosis')}
                        </Button>
                    </div>
                </div>

                <p className="doctor-panel__blurb">
                    {t('app.doctorPanel.oneSweepAcrossManagedConfigurationDrift', 'One sweep across managed configuration drift, core services, certificates, disk headroom and the database. Nothing is repaired automatically; every fix is a button you press.')}
                    {report?.ran_at && <span className="doctor-panel__ranat"> {t('app.doctorPanel.lastRun', 'Last run')} {formatRanAt(report.ran_at)}.</span>}
                </p>

                {loading ? (
                    <EmptyState loading loadingVariant="detail" title={t('app.doctorPanel.loadingLastReport', 'Loading last report')} />
                ) : checks.length === 0 ? (
                    <EmptyState
                        icon={Stethoscope}
                        title={t('app.doctorPanel.noDiagnosisYet', 'No diagnosis yet')}
                        description={t('app.doctorPanel.runADiagnosisToCheckThis', 'Run a diagnosis to check this server\'s managed configuration and core health.')}
                    />
                ) : (
                    <div className="doctor-check-list">
                        {checks.map((check) => (
                            <DoctorCheck
                                key={check.key}
                                check={check}
                                expanded={Boolean(expanded[check.key])}
                                disabled={repairing || running}
                                onToggleDiff={() => toggleDiff(check.key)}
                                onRepair={() => setConfirm({
                                    items: [check.repair_ref],
                                    title: t('app.doctorPanel.repairCheck', 'Repair "{{title}}"?', { title: check.title }),
                                    diff: check.diff || null,
                                    scope: 'host',
                                })}
                                action={check.key === 'disk.headroom' && check.status !== 'ok' ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setReclaimOpen(true)}
                                    >
                                        <HardDrive size={13} />
                                        {t('app.diskReclaim.reclaimSpace', 'Reclaim space')}
                                    </Button>
                                ) : undefined}
                            />
                        ))}
                    </div>
                )}
            </section>

            <section className="monitoring-panel">
                <div className="monitoring-panel__header">
                    <h3>{t('app.doctorPanel.fleetDoctor', 'Fleet doctor')}</h3>
                    <div className="doctor-panel__actions">
                        <Button size="sm" onClick={runSweep} disabled={sweeping || repairing}>
                            <Stethoscope size={14} />
                            {sweeping ? t('app.doctorPanel.sweeping', 'Sweeping…') : t('app.doctorPanel.runFleetSweep', 'Run fleet sweep')}
                        </Button>
                    </div>
                </div>

                <p className="doctor-panel__blurb">
                    {t('app.doctorPanel.theSameHealthSweepAcrossEvery', 'The same health sweep across every paired server. It runs as a background job because it talks to each agent over the network; a server that is offline keeps its last known findings instead of dropping out.')}
                    {fleet?.ran_at && <span className="doctor-panel__ranat"> {t('app.doctorPanel.lastSweep', 'Last sweep')} {formatRanAt(fleet.ran_at)}.</span>}
                </p>

                {fleetLoading ? (
                    <EmptyState loading loadingVariant="cards" title={t('app.doctorPanel.loadingFleetReport', 'Loading fleet report')} />
                ) : fleetServers.length === 0 ? (
                    <EmptyState
                        icon={Server}
                        title={t('app.doctorPanel.noServersInTheFleet', 'No servers in the fleet')}
                        description={t('app.doctorPanel.pairAnAgentFromServersTo', 'Pair an agent from Servers to include that server in the fleet sweep.')}
                    />
                ) : (
                    fleetServers.map((entry) => (
                        <div key={entry.server_id} className="doctor-fleet-group">
                            <div className="doctor-fleet-group__head">
                                <span className="doctor-fleet-group__name">{entry.name}</span>
                                <Pill kind={entry.connected ? 'green' : 'gray'}>
                                    {entry.connected ? 'connected' : 'offline'}
                                </Pill>
                                {entry.hostname && (
                                    <span className="doctor-fleet-group__host">{entry.hostname}</span>
                                )}
                                <div className="doctor-fleet-group__counts">
                                    {['fail', 'warn', 'ok'].map((status) => (
                                        entry.counts?.[status] > 0 && (
                                            <span key={status} className="doctor-fleet-group__count">
                                                {entry.counts[status]} {status}
                                            </span>
                                        )
                                    ))}
                                </div>
                            </div>

                            {entry.checks.length === 0 ? (
                                <p className="doctor-fleet-group__hint">
                                    {t('app.doctorPanel.noSweepResultsYetForThis', 'No sweep results yet for this server.')}
                                </p>
                            ) : (
                                <div className="doctor-check-list">
                                    {entry.checks.map((check) => {
                                        const rowKey = `${entry.server_id}:${check.key}`;
                                        return (
                                            <DoctorCheck
                                                key={rowKey}
                                                check={check}
                                                expanded={Boolean(expanded[rowKey])}
                                                disabled={repairing || sweeping}
                                                onToggleDiff={() => toggleDiff(rowKey)}
                                                onRepair={() => setConfirm({
                                                    items: [check.repair_ref],
                                                    title: t('app.doctorPanel.repairCheckOnServer', 'Repair "{{title}}" on {{server}}?', { title: check.title, server: entry.name }),
                                                    diff: check.diff || null,
                                                    scope: 'fleet',
                                                })}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </section>

            <DiskReclaimModal open={reclaimOpen} onClose={() => setReclaimOpen(false)} />

            <Modal
                open={Boolean(confirm)}
                onClose={() => setConfirm(null)}
                title={confirm?.title}
                className="doctor-confirm"
            >
                <p className="sk-modal__subtitle">
                    {confirm?.scope === 'fleet'
                        ? t('app.doctorPanel.fleetRepairNote', 'This restarts the service on the remote server through its agent. The action is allowlisted and written to the audit log.')
                        : t('app.doctorPanel.localRepairNote', "This rewrites the managed files from ServerKit's configuration and reloads the affected service. Manual edits to those files will be lost.")}
                </p>
                {confirm?.diff && (
                    <pre className="doctor-diff doctor-diff--modal">{confirm.diff}</pre>
                )}
                <div className="doctor-confirm__actions">
                    <Button variant="outline" onClick={() => setConfirm(null)} disabled={repairing}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button onClick={() => doRepair(confirm)} disabled={repairing}>
                        <Wrench size={14} />
                        {repairing ? t('app.doctorPanel.repairing', 'Repairing…') : t('app.doctorPanel.repair', 'Repair')}
                    </Button>
                </div>
            </Modal>
        </div>
    );
};

export default DoctorPanel;
