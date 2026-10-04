import { formatBytes } from '@/utils/formatBytes';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowDownToLine, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock,
    Database, Globe, Link2, Package, RotateCcw, Server, Trash2, AlertTriangle,
    Upload, Users,
} from 'lucide-react';
import api from '../services/api';
import HtaccessConverter from '../components/apps/HtaccessConverter';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import { Pill, statusKind } from '@/components/ds';
import PageLayout from '../layouts/PageLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Spinner from '../components/Spinner';
import ErrorState from '../components/ErrorState';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

const POLL_MS = 2000;

const SOURCE_TYPES = [
    {
        id: 'cpanel',
        name: 'cPanel full backup',
        descriptionKey: 'app.importWizard.aCpmoveBackupTarGzArchive', description: 'A cpmove / backup-*.tar.gz archive from cPanel\'s Full Account Backup.',
    },
    {
        id: 'directadmin',
        name: 'DirectAdmin',
        descriptionKey: 'app.importWizard.aUserBackupArchiveCreatedBy', description: 'A user backup archive created by DirectAdmin\'s Create/Restore Backups.',
    },
    {
        id: 'hestia',
        name: 'Hestia',
        descriptionKey: 'app.importWizard.aVBackupUserArchiveFrom', description: 'A v-backup-user archive from HestiaCP (also fits VestaCP layouts).',
    },
];

const STEPS = ['Source', 'Backup', 'Analyse', 'Review', 'Run'];

// Import status -> Pill colour comes from the ONE shared vocabulary
// (ds/status), shared by the run pane and the history list.
function StatusPill({ status }) {
    return <Pill kind={statusKind(status)}>{status}</Pill>;
}

// Analysis report (step 3): domains/databases tables, db users, crontab,
// warnings + unsupported callouts. Pure render off the contract's shape.
function AnalysisReport({ analysis }) {
    const { t } = useTranslation();
    const domains = analysis.domains || [];
    const databases = analysis.databases || [];
    const dbUsers = analysis.db_users || [];
    const crontab = analysis.crontab || [];
    const warnings = analysis.warnings || [];
    const unsupported = analysis.unsupported || [];

    return (
        <div className="import-wizard__report">
            <div className="import-wizard__report-meta">
                <span>{t('app.importWizard.format', 'Format')} <code>{analysis.format || '—'}</code></span>
                <span>PHP <code>{analysis.php_version || '—'}</code></span>
                <span>{t('app.importWizard.mailAccounts', 'Mail accounts')} <code>{analysis.mail_accounts_count ?? 0}</code></span>
            </div>

            {unsupported.length > 0 && (
                <div className="import-wizard__callout import-wizard__callout--danger">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div>
                        <strong>{t('app.importWizard.notSupportedTheseItemsWillBe', 'Not supported — these items will be skipped:')}</strong>
                        <ul>{unsupported.map((u, i) => <li key={i}>{u}</li>)}</ul>
                    </div>
                </div>
            )}
            {warnings.length > 0 && (
                <div className="import-wizard__callout import-wizard__callout--warning">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <div>
                        <strong>{t('app.importWizard.warnings', 'Warnings:')}</strong>
                        <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                </div>
            )}

            <section className="import-wizard__report-section">
                <h3><Globe size={15} aria-hidden="true" /> {t('app.importWizard.domains', 'Domains (')}{domains.length})</h3>
                {domains.length === 0 ? (
                    <p className="import-wizard__muted">{t('app.importWizard.noDomainsFoundInTheArchive', 'No domains found in the archive.')}</p>
                ) : (
                    <div className="import-wizard__table-wrap">
                        <table className="import-wizard__table">
                            <thead>
                                <tr><th>{t('common.labels.domain', 'Domain')}</th><th>{t('common.labels.type', 'Type')}</th><th>{t('app.importWizard.docroot', 'Docroot')}</th></tr>
                            </thead>
                            <tbody>
                                {domains.map((d) => (
                                    <tr key={d.domain}>
                                        <td>{d.domain}</td>
                                        <td>{d.type || '—'}</td>
                                        <td><code>{d.docroot || '—'}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="import-wizard__report-section">
                <h3><Database size={15} aria-hidden="true" /> {t('app.importWizard.databases', 'Databases (')}{databases.length})</h3>
                {databases.length === 0 ? (
                    <p className="import-wizard__muted">{t('app.importWizard.noDatabaseDumpsFound', 'No database dumps found.')}</p>
                ) : (
                    <div className="import-wizard__table-wrap">
                        <table className="import-wizard__table">
                            <thead>
                                <tr><th>{t('common.labels.name', 'Name')}</th><th>{t('app.importWizard.engine', 'Engine')}</th><th>{t('common.labels.size', 'Size')}</th><th>{t('app.importWizard.dump', 'Dump')}</th></tr>
                            </thead>
                            <tbody>
                                {databases.map((db) => (
                                    <tr key={db.name}>
                                        <td>{db.name}</td>
                                        <td>{db.engine || '—'}</td>
                                        <td>{formatBytes(db.size)}</td>
                                        <td><code>{db.dump_path || '—'}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {dbUsers.length > 0 && (
                <section className="import-wizard__report-section">
                    <h3><Users size={15} aria-hidden="true" /> {t('app.importWizard.databaseUsers', 'Database users (')}{dbUsers.length})</h3>
                    <div className="import-wizard__chips">
                        {dbUsers.map((u) => (
                            <span key={u.user} className="import-wizard__chip">
                                {u.user}
                                {u.hash_format && <em>{u.hash_format}</em>}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {crontab.length > 0 && (
                <section className="import-wizard__report-section">
                    <h3><Clock size={15} aria-hidden="true" /> {t('app.importWizard.crontab', 'Crontab (')}{crontab.length})</h3>
                    <pre className="import-wizard__cron">{crontab.join('\n')}</pre>
                </section>
            )}
        </div>
    );
}

function ImportWizard() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();

    // Wizard position: 1 source · 2 backup · 3 analyse · 4 review · 5 run
    const [step, setStep] = useState(1);
    const [sourceType, setSourceType] = useState(null);

    // Step 2 — the backup archive (file upload or fetch-by-URL)
    const [inputMode, setInputMode] = useState('upload');
    const [file, setFile] = useState(null);
    const [sourceUrl, setSourceUrl] = useState('');
    const [uploadProgress, setUploadProgress] = useState(null);
    const [dragActive, setDragActive] = useState(false);
    const [busy, setBusy] = useState(false);
    const dragCounter = useRef(0);
    const fileInputRef = useRef(null);

    // The server-side import record, polled while analyzing/running
    const [imp, setImp] = useState(null);

    // Step 4 — dry-run options
    const [skipDb, setSkipDb] = useState(false);
    const [skipCrontab, setSkipCrontab] = useState(false);

    // Previous imports (history list)
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyError, setHistoryError] = useState(null);
    // Set while polling the active import fails; cleared by the next good poll.
    const [pollError, setPollError] = useState(null);

    const logRef = useRef(null);

    const loadHistory = useCallback(async () => {
        try {
            const data = await api.getImports();
            setHistory(data.imports || []);
            setHistoryError(null);
        } catch (err) {
            setHistoryError(err);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    useEffect(() => { loadHistory(); }, [loadHistory]);

    // Poll the active import every 2s while the backend is working on it.
    const status = imp?.status;
    // 'created' is only polled right after we fire analyze, so a slow status
    // flip to 'analyzing' doesn't strand the wizard.
    usePolling(async () => {
        try {
            const data = await api.getImport(imp.id);
            if (data.import) setImp(data.import);
            setPollError(null);
        } catch (err) {
            // Keep polling (it may be transient), but say the status shown is
            // stale rather than letting it sit there looking live.
            setPollError(err);
        }
    }, POLL_MS, {
        enabled: Boolean(imp?.id)
            && (status === 'analyzing' || status === 'running' || status === 'created'),
        immediate: false,
    });

    // Autoscroll the live log pane as new lines arrive.
    const logText = imp?.log_text;
    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logText]);

    // Refresh history when a run settles so the list's pills stay honest.
    useEffect(() => {
        if (status === 'completed' || status === 'failed' || status === 'analyzed') loadHistory();
    }, [status, loadHistory]);

    const resetWizard = () => {
        setStep(1);
        setSourceType(null);
        setFile(null);
        setSourceUrl('');
        setUploadProgress(null);
        setImp(null);
        setSkipDb(false);
        setSkipCrontab(false);
    };

    const pickSource = (typeId) => {
        setSourceType(typeId);
        setStep(2);
    };

    // Step 2 → 3: upload (or hand over the URL), create the import record,
    // kick off analysis, then let the poller carry the status forward.
    const startAnalyse = async () => {
        setBusy(true);
        try {
            let source;
            if (inputMode === 'upload') {
                setUploadProgress(0);
                const uploaded = await api.uploadImportArchive(file, (pct) => setUploadProgress(pct));
                source = { upload_path: uploaded.upload_path };
            } else {
                source = { url: sourceUrl.trim() };
            }
            const created = await api.createImport(sourceType, source);
            const record = created.import;
            setImp(record);
            setStep(3);
            await api.analyzeImport(record.id);
            // Reflect the analyze kick-off immediately; the poller takes over.
            setImp((prev) => (prev ? { ...prev, status: 'analyzing' } : prev));
        } catch (error) {
            toast.error(t('app.importWizard.importFailedToStart', 'Import failed to start: {{message}}', { message: error.message }));
        } finally {
            setBusy(false);
            setUploadProgress(null);
        }
    };

    const startRun = async (fromStep = null) => {
        if (!imp?.id) return;
        setBusy(true);
        try {
            await api.runImport(imp.id, fromStep, { skip_db: skipDb, skip_crontab: skipCrontab });
            setImp((prev) => (prev ? { ...prev, status: 'running', error: null } : prev));
            setStep(5);
        } catch (error) {
            toast.error(t('app.importWizard.failedToStartTheImportRun', 'Failed to start the import run: {{message}}', { message: error.message }));
        } finally {
            setBusy(false);
        }
    };

    // Re-open a previous import at the right step for its status.
    const resumeImport = async (record) => {
        try {
            const data = await api.getImport(record.id);
            const full = data.import || record;
            setImp(full);
            setSourceType(full.source_type);
            if (full.status === 'running' || full.status === 'completed' || full.status === 'failed') {
                setStep(5);
            } else {
                setStep(3);
            }
        } catch (error) {
            toast.error(t('app.importWizard.failedToLoadImport', 'Failed to load import: {{message}}', { message: error.message }));
        }
    };

    const removeImport = async (record) => {
        const ok = await confirm({
            title: t('app.importWizard.deleteImport', 'Delete import?'),
            message: t('app.importWizard.thisRemovesTheImportRecordAnd', 'This removes the import record{{value}} and its uploaded archive.', { value: record.status === 'running' ? ' (currently running)' : '' }),
            confirmText: t('common.actions.delete', 'Delete'),
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.deleteImport(record.id);
            if (imp?.id === record.id) resetWizard();
            await loadHistory();
            toast.success(t('app.importWizard.importDeleted', 'Import deleted'));
        } catch (error) {
            toast.error(t('app.importWizard.failedToDeleteImport', 'Failed to delete import: {{message}}', { message: error.message }));
        }
    };

    // ── drag & drop (FileManager idiom: counter-based enter/leave) ──
    const onDragEnter = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current += 1;
        if (e.dataTransfer.items?.length > 0) setDragActive(true);
    };
    const onDragLeave = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current -= 1;
        if (dragCounter.current === 0) setDragActive(false);
    };
    const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e) => {
        e.preventDefault(); e.stopPropagation();
        dragCounter.current = 0;
        setDragActive(false);
        if (e.dataTransfer.files?.length > 0) setFile(e.dataTransfer.files[0]);
    };

    const analysis = imp?.analysis || null;
    const canContinueFromBackup = inputMode === 'upload' ? !!file : sourceUrl.trim() !== '';

    // Dry-run figures for step 4, derived from the analysis + toggles.
    const domainCount = analysis?.domains?.length || 0;
    const dbCount = skipDb ? 0 : (analysis?.databases?.length || 0);
    const cronCount = skipCrontab ? 0 : (analysis?.crontab?.length || 0);

    const stepperIndex = step - 1;

    return (
        <PageLayout
            icon={<ArrowDownToLine size={18} />}
            title={t('app.importWizard.importASite', 'Import a site')}
            meta="Bring a site over from another control panel"
            actions={(
                <>
                    {/* Imported sites often carry .htaccess rules — offer the translator here. */}
                    <HtaccessConverter />
                    {step > 1 && (
                        <Button variant="outline" size="sm" onClick={resetWizard}>
                            {t('app.importWizard.startOver', 'Start over')}
                        </Button>
                    )}
                </>
            )}
        >
            <div className="import-wizard">
                {/* Stepper */}
                <ol className="import-wizard__stepper">
                    {STEPS.map((label, i) => (
                        <li
                            key={label}
                            className={`import-wizard__step${i === stepperIndex ? ' is-active' : ''}${i < stepperIndex ? ' is-done' : ''}`}
                        >
                            <span className="import-wizard__step-dot">
                                {i < stepperIndex ? <CheckCircle2 size={14} aria-hidden="true" /> : i + 1}
                            </span>
                            {label}
                        </li>
                    ))}
                </ol>

                {/* Step 1 — source type */}
                {step === 1 && (
                    <div className="import-wizard__panel">
                        <h2>{t('app.importWizard.whereIsTheSiteComingFrom', 'Where is the site coming from?')}</h2>
                        <div className="import-wizard__sources">
                            {SOURCE_TYPES.map((s) => (
                                <Button variant="unstyled"
                                    key={s.id}
                                    type="button"
                                    className="import-wizard__source-card"
                                    onClick={() => pickSource(s.id)}
                                >
                                    <span className="import-wizard__source-ico"><Package size={18} aria-hidden="true" /></span>
                                    <strong>{s.name}</strong>
                                    <p>{s.description}</p>
                                    <ChevronRight size={16} className="import-wizard__source-chev" aria-hidden="true" />
                                </Button>
                            ))}
                            <Link to="/wordpress/ssh-import" className="import-wizard__source-card import-wizard__source-card--link">
                                <span className="import-wizard__source-ico"><Server size={18} aria-hidden="true" /></span>
                                <strong>{t('app.importWizard.wordpressOverSsh', 'WordPress over SSH')}</strong>
                                <p>{t('app.importWizard.pullALiveWordpressSiteStraight', 'Pull a live WordPress site straight from its current server. Opens the WordPress import surface.')}</p>
                                <ChevronRight size={16} className="import-wizard__source-chev" aria-hidden="true" />
                            </Link>
                        </div>
                    </div>
                )}

                {/* Step 2 — backup archive */}
                {step === 2 && (
                    <div className="import-wizard__panel">
                        <h2>{t('app.importWizard.provideTheBackupArchive', 'Provide the backup archive')}</h2>
                        <div className="import-wizard__mode">
                            <Button variant="unstyled"
                                type="button"
                                className={`import-wizard__mode-btn${inputMode === 'upload' ? ' is-active' : ''}`}
                                onClick={() => setInputMode('upload')}
                            >
                                <Upload size={14} aria-hidden="true" /> {t('app.importWizard.uploadAFile', 'Upload a file')}
                            </Button>
                            <Button variant="unstyled"
                                type="button"
                                className={`import-wizard__mode-btn${inputMode === 'url' ? ' is-active' : ''}`}
                                onClick={() => setInputMode('url')}
                            >
                                <Link2 size={14} aria-hidden="true" /> {t('app.importWizard.fetchFromUrl', 'Fetch from URL')}
                            </Button>
                        </div>

                        {inputMode === 'upload' ? (
                            <div
                                className={`import-wizard__dropzone${dragActive ? ' is-drag' : ''}`}
                                onDragEnter={onDragEnter}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                onClick={() => fileInputRef.current?.click()}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".tar,.gz,.tgz,.tar.gz,.zip"
                                    className="import-wizard__file-input"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                />
                                <Upload size={22} aria-hidden="true" />
                                {file ? (
                                    <p><strong>{file.name}</strong> · {formatBytes(file.size)}</p>
                                ) : (
                                    <p>{t('app.importWizard.dragTheBackupArchiveHereOr', 'Drag the backup archive here, or click to browse')}</p>
                                )}
                                <span className="import-wizard__muted">.tar.gz / .tgz / .zip — the full panel backup, not a partial export</span>
                                {uploadProgress != null && (
                                    <div className="import-wizard__progress">
                                        {/* Inline width is the dynamic-progress pattern used by uploads elsewhere */}
                                        <div className="import-wizard__progress-fill" style={{ width: `${uploadProgress}%` }} />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="import-wizard__url">
                                <Label htmlFor="import-url">{t('app.importWizard.archiveUrl', 'Archive URL')}</Label>
                                <Input
                                    id="import-url"
                                    type="url"
                                    value={sourceUrl}
                                    onChange={(e) => setSourceUrl(e.target.value)}
                                    placeholder="https://old-server.example.com/backup-user.tar.gz"
                                    disabled={busy}
                                />
                                <span className="import-wizard__muted">{t('app.importWizard.thePanelDownloadsTheArchiveServer', 'The panel downloads the archive server-side — handy when the backup is too large to route through your browser.')}</span>
                            </div>
                        )}

                        <div className="import-wizard__actions">
                            <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                                <ArrowLeft size={14} /> {t('common.actions.back', 'Back')}
                            </Button>
                            <Button onClick={startAnalyse} disabled={busy || !canContinueFromBackup}>
                                {busy ? <><Spinner size="sm" /> {inputMode === 'upload' ? 'Uploading…' : 'Starting…'}</> : <>{t('app.importWizard.analyseBackup', 'Analyse backup')} <ArrowRight size={14} /></>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 3 — analysis */}
                {step === 3 && (
                    <div className="import-wizard__panel">
                        <h2>{t('app.importWizard.analysis', 'Analysis')} {imp && <StatusPill status={imp.status} />}</h2>
                        {(status === 'analyzing' || status === 'created') && (
                            <div className="import-wizard__waiting">
                                <Spinner size="sm" />
                                <span>{t('app.importWizard.unpackingAndInspectingTheArchiveThis', 'Unpacking and inspecting the archive… this can take a few minutes for large backups.')}</span>
                            </div>
                        )}
                        {status === 'failed' && (
                            <div className="import-wizard__callout import-wizard__callout--danger">
                                <AlertTriangle size={16} aria-hidden="true" />
                                <div>
                                    <strong>{t('app.importWizard.analysisFailed', 'Analysis failed.')}</strong>
                                    <p>{imp.error || 'The archive could not be analysed.'}</p>
                                </div>
                            </div>
                        )}
                        {pollError && (
                            <ErrorState
                                compact
                                message={t('app.importWizard.couldntRefreshImportStatus', "Couldn't refresh the import status. {{reason}}", { reason: pollError.message })}
                            />
                        )}
                        {analysis && <AnalysisReport analysis={analysis} />}
                        <div className="import-wizard__actions">
                            <Button variant="outline" onClick={resetWizard}>
                                <ArrowLeft size={14} /> {t('app.importWizard.startOver', 'Start over')}
                            </Button>
                            {status === 'failed' && (
                                <Button variant="outline" onClick={async () => {
                                    try {
                                        await api.analyzeImport(imp.id);
                                        setImp((prev) => (prev ? { ...prev, status: 'analyzing', error: null } : prev));
                                    } catch (error) {
                                        toast.error(t('app.importWizard.failedToReAnalyse', 'Failed to re-analyse: {{message}}', { message: error.message }));
                                    }
                                }}>
                                    <RotateCcw size={14} /> {t('app.importWizard.reAnalyse', 'Re-analyse')}
                                </Button>
                            )}
                            <Button onClick={() => setStep(4)} disabled={status !== 'analyzed'}>
                                {t('app.importWizard.reviewImport', 'Review import')} <ArrowRight size={14} />
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 4 — dry-run summary */}
                {step === 4 && (
                    <div className="import-wizard__panel">
                        <h2>{t('app.importWizard.whatWillBeCreated', 'What will be created')}</h2>
                        <ul className="import-wizard__plan">
                            <li>
                                <Globe size={15} aria-hidden="true" />
                                <span><strong>{domainCount}</strong> {t('app.importWizard.appContainer', 'app container')}{domainCount === 1 ? '' : 's'} {t('app.importWizard.onePerDomainDocrootCopiedIn', '— one per domain, docroot copied in and served behind Nginx')}</span>
                            </li>
                            <li className={skipDb ? 'is-skipped' : ''}>
                                <Database size={15} aria-hidden="true" />
                                <span><strong>{dbCount}</strong> {t('app.importWizard.managedDatabase', 'managed database')}{dbCount === 1 ? '' : 's'} {t('app.importWizard.restoredFromTheArchiveSDumps', 'restored from the archive\'s dumps')}{skipDb && ' (skipped)'}</span>
                            </li>
                            <li className={skipCrontab ? 'is-skipped' : ''}>
                                <Clock size={15} aria-hidden="true" />
                                <span><strong>{cronCount}</strong> {t('app.importWizard.cronEntr', 'cron entr')}{cronCount === 1 ? 'y' : 'ies'} {t('app.importWizard.recreatedAsScheduledJobs', 'recreated as scheduled jobs')}{skipCrontab && ' (skipped)'}</span>
                            </li>
                        </ul>
                        {(analysis?.mail_accounts_count || 0) > 0 && (
                            <div className="import-wizard__callout import-wizard__callout--warning">
                                <AlertTriangle size={16} aria-hidden="true" />
                                <div>
                                    <p>{analysis.mail_accounts_count} {t('app.importWizard.mailAccount', 'mail account')}{analysis.mail_accounts_count === 1 ? '' : 's'} {t('app.importWizard.foundInTheBackupWillNot', 'found in the backup will not be imported — mail is handled by the mail extension.')}</p>
                                </div>
                            </div>
                        )}

                        <div className="import-wizard__options">
                            <label className="checkbox-label">
                                <input type="checkbox" checked={skipDb} onChange={(e) => setSkipDb(e.target.checked)} />
                                {t('app.importWizard.skipDatabaseImport', 'Skip database import')}
                            </label>
                            <label className="checkbox-label">
                                <input type="checkbox" checked={skipCrontab} onChange={(e) => setSkipCrontab(e.target.checked)} />
                                {t('app.importWizard.skipCrontabEntries', 'Skip crontab entries')}
                            </label>
                        </div>

                        <div className="import-wizard__actions">
                            <Button variant="outline" onClick={() => setStep(3)} disabled={busy}>
                                <ArrowLeft size={14} /> {t('app.importWizard.backToReport', 'Back to report')}
                            </Button>
                            <Button onClick={() => startRun()} disabled={busy}>
                                {busy ? <><Spinner size="sm" /> {t('app.importWizard.starting', 'Starting…')}</> : <>{t('app.importWizard.runImport', 'Run import')} <ArrowRight size={14} /></>}
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 5 — run with live log */}
                {step === 5 && imp && (
                    <div className="import-wizard__panel">
                        <h2>
                            {t('app.importWizard.importRun', 'Import run')} <StatusPill status={imp.status} />
                            {imp.current_step && imp.status === 'running' && (
                                <span className="import-wizard__current-step">step: <code>{imp.current_step}</code></span>
                            )}
                        </h2>

                        {imp.status === 'failed' && (
                            <div className="import-wizard__callout import-wizard__callout--danger">
                                <AlertTriangle size={16} aria-hidden="true" />
                                <div>
                                    <strong>{t('app.importWizard.failedAtStep', 'Failed at step')} <code>{imp.current_step || 'unknown'}</code>.</strong>
                                    <p>{imp.error || 'The import run failed.'}</p>
                                </div>
                            </div>
                        )}
                        {imp.status === 'completed' && (
                            <div className="import-wizard__callout import-wizard__callout--success">
                                <CheckCircle2 size={16} aria-hidden="true" />
                                <div>
                                    <p>{t('app.importWizard.importCompletedTheNewServicesAre', 'Import completed. The new services are on the')} <Link to="/services">{t('common.labels.services', 'Services')}</Link> page.</p>
                                </div>
                            </div>
                        )}

                        {pollError && (
                            <ErrorState
                                compact
                                message={t('app.importWizard.couldntRefreshImportStatus', "Couldn't refresh the import status. {{reason}}", { reason: pollError.message })}
                            />
                        )}

                        <pre ref={logRef} className="import-wizard__log">
                            {imp.log_text || 'Waiting for log output…'}
                        </pre>

                        <div className="import-wizard__actions">
                            <Button variant="outline" onClick={resetWizard}>
                                <ArrowLeft size={14} /> {t('app.importWizard.newImport', 'New import')}
                            </Button>
                            {imp.status === 'failed' && (
                                <Button onClick={() => startRun(imp.current_step)} disabled={busy}>
                                    {busy ? <><Spinner size="sm" /> {t('app.importWizard.starting', 'Starting…')}</> : <><RotateCcw size={14} /> {t('app.importWizard.retryFromFailedStep', 'Retry from failed step')}</>}
                                </Button>
                            )}
                            {imp.status === 'completed' && (
                                <Button asChild>
                                    <Link to="/services">{t('app.importWizard.goToServices', 'Go to Services')}</Link>
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {/* Previous imports */}
                <section className="import-wizard__history">
                    <h2>{t('app.importWizard.previousImports', 'Previous imports')}</h2>
                    {historyError && history.length > 0 && (
                        <ErrorState compact error={historyError} onRetry={loadHistory} />
                    )}
                    {historyLoading ? (
                        <p className="import-wizard__muted">{t('common.loading', 'Loading…')}</p>
                    ) : historyError && history.length === 0 ? (
                        <ErrorState
                            title={t('app.importWizard.couldntLoadPreviousImports', "Couldn't load previous imports")}
                            error={historyError}
                            onRetry={loadHistory}
                        />
                    ) : history.length === 0 ? (
                        <p className="import-wizard__muted">{t('app.importWizard.noImportsYet', 'No imports yet.')}</p>
                    ) : (
                        <ul className="import-wizard__history-list">
                            {history.map((rec) => (
                                <li key={rec.id} className="import-wizard__history-item">
                                    <StatusPill status={rec.status} />
                                    <span className="import-wizard__history-src">{rec.source_type}</span>
                                    <span className="import-wizard__history-when">
                                        {rec.created_at ? new Date(rec.created_at).toLocaleString() : '—'}
                                    </span>
                                    <span className="import-wizard__history-actions">
                                        <Button variant="ghost" size="sm" onClick={() => resumeImport(rec)}>
                                            {rec.status === 'running' || rec.status === 'analyzing' ? 'Resume' : 'View'}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => removeImport(rec)} aria-label={t('app.importWizard.deleteImport3', 'Delete import')}>
                                            <Trash2 size={14} />
                                        </Button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </PageLayout>
    );
}

export default ImportWizard;
