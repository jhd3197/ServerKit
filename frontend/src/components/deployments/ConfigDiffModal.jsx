import { useEffect, useState } from 'react';
import { AlertTriangle, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ds';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

function displayValue(value, notSet) {
    if (value === null || value === undefined || value === '') return notSet;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function DiffList({ title, added = [], removed = [], changed = [] }) {
    const { t } = useTranslation();
    const hasAny = added.length || removed.length || changed.length;
    if (!hasAny) {
        return (
            <div className="config-diff__section">
                <h4 className="config-diff__section-title">{title}</h4>
                <p className="config-diff__none">{t('app.configDiffModal.noChanges', 'No changes')}</p>
            </div>
        );
    }
    return (
        <div className="config-diff__section">
            <h4 className="config-diff__section-title">{title}</h4>
            <ul className="config-diff__lines">
                {added.map((key) => (
                    <li key={`a-${key}`} className="config-diff__line config-diff__line--add">
                        <span className="config-diff__sign">+</span> {key}
                    </li>
                ))}
                {removed.map((key) => (
                    <li key={`r-${key}`} className="config-diff__line config-diff__line--remove">
                        <span className="config-diff__sign">-</span> {key}
                    </li>
                ))}
                {changed.map((key) => (
                    <li key={`c-${key}`} className="config-diff__line config-diff__line--change">
                        <span className="config-diff__sign">~</span> {key}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function ScalarDiff({ title, oldVal, newVal, changed }) {
    const { t } = useTranslation();
    const notSet = t('app.configDiffModal.notSet', 'Not set');
    return (
        <div className="config-diff__section">
            <h4 className="config-diff__section-title">{title}</h4>
            {changed ? (
                <div className="config-diff__scalar">
                    <span className="config-diff__old">{displayValue(oldVal, notSet)}</span>
                    <span className="config-diff__arrow" aria-hidden="true">→</span>
                    <span className="config-diff__new">{displayValue(newVal, notSet)}</span>
                </div>
            ) : (
                <p className="config-diff__none">
                    {t('app.configDiffModal.noChangeValue', 'No change ({{value}})', {
                        value: displayValue(newVal, notSet),
                    })}
                </p>
            )}
        </div>
    );
}

function entries(value) {
    if (Array.isArray(value)) return value.map((item, index) => [String(index + 1), item]);
    if (value && typeof value === 'object') return Object.entries(value);
    return value === undefined || value === null || value === '' ? [] : [['', value]];
}

function GenericDiff({ title, diff }) {
    const { t } = useTranslation();
    const notSet = t('app.configDiffModal.notSet', 'Not set');
    const added = entries(diff?.added);
    const removed = entries(diff?.removed);
    const changed = entries(diff?.changed);
    const hasChanges = added.length || removed.length || changed.length;

    return (
        <div className="config-diff__section">
            <h4 className="config-diff__section-title">{title}</h4>
            {!hasChanges ? (
                <p className="config-diff__none">{t('app.configDiffModal.noChanges', 'No changes')}</p>
            ) : (
                <ul className="config-diff__lines">
                    {added.map(([key, value]) => (
                        <li key={`added-${key}-${displayValue(value, notSet)}`} className="config-diff__line config-diff__line--add">
                            <span className="config-diff__sign">+</span>
                            <span className="config-diff__path">{key || t('app.configDiffModal.value', 'Value')}</span>
                            <span className="config-diff__value">{displayValue(value, notSet)}</span>
                        </li>
                    ))}
                    {removed.map(([key, value]) => (
                        <li key={`removed-${key}-${displayValue(value, notSet)}`} className="config-diff__line config-diff__line--remove">
                            <span className="config-diff__sign">-</span>
                            <span className="config-diff__path">{key || t('app.configDiffModal.value', 'Value')}</span>
                            <span className="config-diff__value">{displayValue(value, notSet)}</span>
                        </li>
                    ))}
                    {changed.map(([key, value]) => {
                        const isPair = value && typeof value === 'object'
                            && Object.prototype.hasOwnProperty.call(value, 'old')
                            && Object.prototype.hasOwnProperty.call(value, 'new');
                        return (
                            <li key={`changed-${key}`} className="config-diff__line config-diff__line--change">
                                <span className="config-diff__sign">~</span>
                                <span className="config-diff__path">{key || t('app.configDiffModal.value', 'Value')}</span>
                                <span className="config-diff__value">
                                    {isPair
                                        ? `${displayValue(value.old, notSet)} → ${displayValue(value.new, notSet)}`
                                        : displayValue(value, notSet)}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

const ConfigDiffModal = ({
    appId,
    snapId,
    restorePointId,
    restorePoint,
    against = 'previous',
    onClose,
    onRestored,
}) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const isRestorePoint = Boolean(restorePointId);
    const [diff, setDiff] = useState(null);
    const [meta, setMeta] = useState(null);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [restoring, setRestoring] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                setPreviewError(null);
                if (restorePointId) {
                    const [diffResult, previewResult] = await Promise.allSettled([
                        api.getRestorePointDiff(restorePointId, against),
                        api.previewRestorePoint(restorePointId),
                    ]);
                    if (cancelled) return;
                    if (diffResult.status === 'fulfilled') {
                        const diffRes = diffResult.value;
                        setDiff(diffRes.diff || null);
                        setMeta({
                            hasChanges: diffRes.has_changes,
                            againstId: diffRes.against_point_id,
                        });
                    } else {
                        setDiff(null);
                        setMeta(null);
                        setError(diffResult.reason?.message || t('app.configDiffModal.diffUnavailable', 'Diff unavailable'));
                    }
                    if (previewResult.status === 'fulfilled') {
                        setPreview(previewResult.value);
                    } else {
                        setPreview(null);
                        setPreviewError(previewResult.reason?.message || t('app.configDiffModal.previewUnavailable', 'Restore preview unavailable'));
                    }
                } else {
                    const res = await api.getSnapshotDiff(appId, snapId, against);
                    if (cancelled) return;
                    setDiff(res.diff);
                    setMeta({
                        summary: res.summary,
                        hasChanges: res.has_changes,
                        againstId: res.against_id,
                    });
                    setPreview(null);
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [against, appId, restorePointId, snapId, t]);

    async function handleRestore() {
        const confirmed = await confirm({
            title: isRestorePoint
                ? t('app.configDiffModal.restoreRestorePoint', 'Restore this restore point?')
                : t('app.configDiffModal.restoreConfiguration', 'Restore this configuration?'),
            message: isRestorePoint
                ? t('app.configDiffModal.restorePointConfirmation', 'ServerKit will capture the current managed state first, then apply the recoverable values from this restore point.')
                : t('app.configDiffModal.restoreConfigurationConfirmation', 'This configuration will be restored and a redeploy will start.'),
            confirmText: t('app.configDiffModal.confirmRestore', 'Confirm restore'),
            variant: 'danger',
        });
        if (!confirmed) return;

        setRestoring(true);
        try {
            const res = isRestorePoint
                ? await api.restoreRestorePoint(restorePointId)
                : await api.restoreSnapshot(appId, snapId);
            if (res.success) {
                toast.success(isRestorePoint
                    ? t('app.configDiffModal.restorePointRestored', 'Restore point applied')
                    : t('app.configDiffModal.configurationRestoredRedeployTriggered', 'Configuration restored. Redeploy triggered.'));
                onRestored?.(res);
            } else {
                toastError(toast, t('app.configDiffModal.restoreFailed', "Couldn't restore the config."), res.error);
            }
        } catch (err) {
            toastError(toast, t('app.configDiffModal.restoreFailed', "Couldn't restore the config."), err);
        } finally {
            setRestoring(false);
        }
    }

    const footer = (
        <>
            <Button variant="outline" onClick={onClose} disabled={restoring}>
                {t('common.actions.close', 'Close')}
            </Button>
            <Button
                onClick={handleRestore}
                disabled={loading || restoring || (isRestorePoint ? (!preview || !preview.can_restore) : Boolean(error))}
            >
                <RotateCcw size={14} />
                {restoring
                    ? t('app.configDiffModal.restoring', 'Restoring…')
                    : (isRestorePoint
                        ? t('app.configDiffModal.applyRestorePoint', 'Apply restore point')
                        : t('app.configDiffModal.restoreThisConfig', 'Restore this config'))}
            </Button>
        </>
    );

    return (
        <Modal
            open
            onClose={onClose}
            title={isRestorePoint
                ? t('app.configDiffModal.restorePointPreview', 'Restore point preview')
                : t('app.configDiffModal.configurationDiff', 'Configuration diff')}
            size="xl"
            className="config-diff"
            footer={footer}
        >
            <div className="config-diff__body">
                {loading && (
                    <p className="config-diff__loading" role="status" aria-live="polite">
                        {t('app.configDiffModal.loadingDiff', 'Loading diff…')}
                    </p>
                )}
                {error && !isRestorePoint && <div className="alert alert-danger">{error}</div>}

                {!loading && !error && diff && !isRestorePoint && (
                    <>
                        {meta && (
                            <div className="config-diff__summary-banner" role="status">
                                <Info size={16} className="config-diff__summary-icon" />
                                <div className="config-diff__summary-text">
                                    <span className="config-diff__summary-label">
                                        {t('app.configDiffModal.inPlainLanguage', 'In plain language')}
                                    </span>
                                    <p className="config-diff__summary">
                                        {meta.hasChanges && meta.summary
                                            ? meta.summary
                                            : t('app.configDiffModal.noConfigurationChanges', 'No configuration changes compared with this restore point.')}
                                    </p>
                                </div>
                            </div>
                        )}

                        <DiffList
                            title={t('app.configDiffModal.environmentVariables', 'Environment variables')}
                            added={diff.env?.added}
                            removed={diff.env?.removed}
                            changed={diff.env?.changed}
                        />
                        <DiffList
                            title={t('common.labels.domains', 'Domains')}
                            added={diff.domains?.added}
                            removed={diff.domains?.removed}
                        />
                        <DiffList
                            title={t('app.configDiffModal.volumes', 'Volumes')}
                            added={diff.volumes?.added}
                            removed={diff.volumes?.removed}
                        />
                        <ScalarDiff
                            title={t('app.configDiffModal.imageTag', 'Image / tag')}
                            oldVal={diff.image?.old}
                            newVal={diff.image?.new}
                            changed={diff.image?.changed}
                        />
                        <ScalarDiff
                            title={t('app.configDiffModal.buildMethod', 'Build method')}
                            oldVal={diff.build_method?.old}
                            newVal={diff.build_method?.new}
                            changed={diff.build_method?.changed}
                        />
                    </>
                )}

                {!loading && isRestorePoint && (
                    <>
                        <div className="config-diff__point-meta">
                            <div>
                                <span className="config-diff__summary-label">
                                    {t('app.configDiffModal.savedCheckpoint', 'Saved restore point')}
                                </span>
                                <p className="config-diff__summary">
                                    {restorePoint?.label || t('app.configDiffModal.unlabelledRestorePoint', 'Unlabelled restore point')}
                                </p>
                            </div>
                            <Pill kind={previewError ? 'amber' : (preview?.can_restore ? 'green' : 'red')} dot={false}>
                                {previewError
                                    ? t('app.configDiffModal.previewUnavailable', 'Restore preview unavailable')
                                    : (preview?.can_restore
                                        ? t('app.configDiffModal.readyToRestore', 'Ready to restore')
                                        : t('app.configDiffModal.restoreBlocked', 'Restore blocked'))}
                            </Pill>
                        </div>

                        <div className="config-diff__group">
                            <div className="config-diff__group-heading">
                                <h3>{t('app.configDiffModal.currentRestorePreview', 'Current restore preview')}</h3>
                                <p>{t('app.configDiffModal.currentRestorePreviewDescription', 'These changes compare the current state with the selected restore point.')}</p>
                            </div>
                            {previewError ? (
                                <div className="alert alert-warning" role="status">{previewError}</div>
                            ) : (
                                <GenericDiff
                                    title={t('app.configDiffModal.changesToApply', 'Changes to apply')}
                                    diff={preview?.diff}
                                />
                            )}
                        </div>

                        <div className="config-diff__coverage">
                            <div className="config-diff__coverage-heading">
                                <ShieldCheck size={17} />
                                <div>
                                    <h3>{t('app.configDiffModal.coverageAndLimits', 'Coverage and limits')}</h3>
                                    <p>{t('app.configDiffModal.coverageDescription', 'Review what this restore point does not restore before continuing.')}</p>
                                </div>
                            </div>
                            {((preview?.outside_checkpoint || restorePoint?.coverage || []).length > 0) ? (
                                <ul>
                                    {(preview?.outside_checkpoint || restorePoint?.coverage || []).map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="config-diff__none">
                                    {t('app.configDiffModal.noCoverageGaps', 'The restore point reported nothing outside its coverage.')}
                                </p>
                            )}
                        </div>

                        {preview?.refusals?.length > 0 && (
                            <div className="config-diff__refusals" role="alert">
                                <AlertTriangle size={17} />
                                <div>
                                    <h3>{t('app.configDiffModal.restoreRefusals', 'Restore blockers')}</h3>
                                    <ul>
                                        {preview.refusals.map((item) => <li key={item}>{item}</li>)}
                                    </ul>
                                </div>
                            </div>
                        )}

                        <div className="config-diff__group">
                            <div className="config-diff__group-heading">
                                <h3>{t('app.configDiffModal.historicalDiff', 'Historical diff')}</h3>
                                <p>{error
                                    ? t('app.configDiffModal.historicalDiffUnavailable', 'The comparison with the previous restore point could not be loaded.')
                                    : (meta?.againstId
                                        ? t('app.configDiffModal.historicalDiffDescription', 'These changes compare this restore point with the one captured before it.')
                                        : t('app.configDiffModal.firstRestorePoint', 'This is the first restore point in this scope.'))}</p>
                            </div>
                            {error ? (
                                <div className="alert alert-warning" role="status">{error}</div>
                            ) : (
                                <GenericDiff
                                    title={t('app.configDiffModal.savedChanges', 'Saved changes')}
                                    diff={diff}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default ConfigDiffModal;
