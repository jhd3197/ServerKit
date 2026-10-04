import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/useToast.js';
import { useOperations } from '@/contexts/OperationsContext';
import formatBytes from '@/utils/formatBytes';
import { toastError } from '@/utils/errorMessage';

/**
 * Curated "safe" disk reclaim. Shows what a fresh measurement says can be
 * freed, then hands the run to Operations as a background job — a reclaim can
 * take minutes when Docker pruning or a VACUUM is involved. The backend
 * re-validates every key against its own fresh scan before deleting anything,
 * so this list is a preview, not the authority.
 */
const DiskReclaimModal = ({ open, onClose }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { openRun } = useOperations();
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [running, setRunning] = useState(false);

    const loadReport = useCallback(() => {
        setLoading(true);
        setError(null);
        api.getDiskReclaimReport()
            .then(setReport)
            .catch((err) => setError(err.message || t('app.diskReclaim.couldNotMeasure', 'Could not measure reclaimable space')))
            .finally(() => setLoading(false));
    }, [t]);

    useEffect(() => {
        if (open) loadReport();
        else {
            setReport(null);
            setError(null);
            setRunning(false);
        }
    }, [open, loadReport]);

    // Only reviewed-safe candidates with something actually to free are shown;
    // 'review' items (telemetry retention) stay CLI-only by design.
    const candidates = (report?.candidates || []).filter(
        (c) => c.safety === 'safe' && (c.bytes || 0) > 0
    );
    const total = candidates.reduce((sum, c) => sum + (c.bytes || 0), 0);

    const reclaim = async () => {
        try {
            setRunning(true);
            const res = await api.runDiskReclaim(
                candidates.map((c) => c.key),
                { wait: false }
            );
            openRun('job', res.job_id);
            toast.success(
                t('app.diskReclaim.reclaimStartedFollowProgressIn', 'Reclaim started. Follow progress in Operations.'),
                {
                    duration: 10000,
                    action: {
                        label: t('app.diskReclaim.viewJob', 'View job'),
                        onClick: () => openRun('job', res.job_id),
                    },
                }
            );
            onClose();
        } catch (err) {
            toastError(toast, t('app.diskReclaim.reclaimFailed', 'Reclaim failed'), err);
            setRunning(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('app.diskReclaim.title', 'Reclaim disk space')}
            footer={(
                <>
                    <Button variant="outline" onClick={onClose} disabled={running}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button onClick={reclaim} disabled={running || loading || Boolean(error) || candidates.length === 0}>
                        <HardDrive size={14} />
                        {running
                            ? t('app.diskReclaim.reclaiming', 'Reclaiming…')
                            : t('app.diskReclaim.reclaimNow', 'Reclaim now')}
                    </Button>
                </>
            )}
        >
            <p className="sk-modal__subtitle">
                {t('app.diskReclaim.onlyReviewedSafeCandidatesAreOffered', 'Only reviewed-safe cleanup is offered: upgrade snapshots beyond the newest one, abandoned update staging, oversized logs, package caches, old journal entries and Docker build cache. Nothing here touches your services or databases.')}
            </p>

            {loading ? (
                <p className="disk-reclaim__state">{t('app.diskReclaim.measuring', 'Measuring what can be freed…')}</p>
            ) : error ? (
                <div className="disk-reclaim__state disk-reclaim__state--error">
                    <p>{error}</p>
                    <Button size="sm" variant="outline" onClick={loadReport}>
                        {t('common.actions.retry', 'Retry')}
                    </Button>
                </div>
            ) : candidates.length === 0 ? (
                <p className="disk-reclaim__state">
                    {t('app.diskReclaim.nothingToReclaimRightNowTheCurated', 'Nothing to reclaim right now. The curated candidates are all clear.')}
                </p>
            ) : (
                <>
                    <ul className="disk-reclaim__list">
                        {candidates.map((c) => (
                            <li key={c.key} className="disk-reclaim__item">
                                <span className="disk-reclaim__item-title">{c.title}</span>
                                <span className="disk-reclaim__item-detail">{c.detail}</span>
                                <span className="disk-reclaim__item-size">{formatBytes(c.bytes)}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="disk-reclaim__total">
                        <span>{t('app.diskReclaim.totalReclaimable', 'Total reclaimable')}</span>
                        <span className="disk-reclaim__total-size">{formatBytes(total)}</span>
                    </div>
                </>
            )}
        </Modal>
    );
};

export default DiskReclaimModal;
