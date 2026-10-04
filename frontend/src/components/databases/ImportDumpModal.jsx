import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle, Check, Database, FileCode2, HardDrive, Loader2,
    RefreshCw, ShieldAlert,
} from 'lucide-react';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SegControl } from '@/components/ds';
import { EngineIcon } from '../icons/DatabaseBrands';
import { formatBytes } from '@/utils/formatBytes';
import { ENGINE_META } from './dbAdapter';
import { useTranslation } from 'react-i18next';
import { translateLabel } from '@/i18n/labels';

// Import a SQL dump into an existing database.
//
// The backend contract this is built around (it is older than the design mock
// and does not match it):
//
//   POST /api/v1/databases/mysql/<name>/restore        { backup_path }
//   POST /api/v1/databases/postgresql/<name>/restore   { backup_path }
//
// `backup_path` is a path **on the server**. There is no upload endpoint, so a
// file sitting in the operator's browser cannot be imported — this modal says
// that rather than showing a file picker that would go nowhere. `.gz` is
// decompressed server-side. Both routes are admin-only, and neither takes a
// snapshot first, so the pre-import backup here is an explicit extra call.

const SOURCES = [
    { id: 'backup', labelKey: 'app.importDumpModal.aBackupOnThisServer', label: 'A backup on this server' },
    { id: 'path', labelKey: 'app.importDumpModal.aPathOnTheServer', label: 'A path on the server' },
];

// SQLite and containerised databases have no restore route at all.
const RESTORABLE = ['mysql', 'postgresql'];

export default function ImportDumpModal({ preset, isAdmin = false, onClose, onImported }) {
    const { t } = useTranslation();
    const [databases, setDatabases] = useState(null); // null while loading
    const [loadFailed, setLoadFailed] = useState(false);
    const [targetKey, setTargetKey] = useState('');
    const [source, setSource] = useState('backup');
    const [backups, setBackups] = useState([]);
    const [backupsLoading, setBackupsLoading] = useState(true);
    const [picked, setPicked] = useState('');
    const [manualPath, setManualPath] = useState('');
    const [backupFirst, setBackupFirst] = useState(true);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState('');
    const [result, setResult] = useState(null); // { ok, message, detail }

    const presetName = preset?.conn?.dbType === 'mysql' || preset?.conn?.dbType === 'postgresql'
        ? `${preset.conn.dbType}:${preset.conn.name}`
        : '';

    const load = useCallback(async () => {
        setDatabases(null);
        setLoadFailed(false);
        const [my, pg] = await Promise.allSettled([
            api.getMySQLDatabases(),
            api.getPostgreSQLDatabases(),
        ]);
        const out = [];
        if (my.status === 'fulfilled') {
            (my.value?.databases || []).forEach((db) => out.push({ key: `mysql:${db.name}`, engine: 'mysql', name: db.name }));
        }
        if (pg.status === 'fulfilled') {
            (pg.value?.databases || []).forEach((db) => out.push({ key: `postgresql:${db.name}`, engine: 'postgresql', name: db.name }));
        }
        if (my.status === 'rejected' && pg.status === 'rejected') setLoadFailed(true);
        setDatabases(out);
        setTargetKey((cur) => {
            if (out.some((d) => d.key === cur)) return cur;
            if (out.some((d) => d.key === presetName)) return presetName;
            return out[0]?.key || '';
        });
    }, [presetName]);

    const loadBackups = useCallback(async () => {
        setBackupsLoading(true);
        try {
            const data = await api.getDatabaseBackups();
            setBackups(data.backups || []);
        } catch {
            // A missing backup directory is not an error worth a red panel —
            // the path field still works.
            setBackups([]);
        } finally {
            setBackupsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadBackups(); }, [loadBackups]);

    const target = useMemo(
        () => (databases || []).find((d) => d.key === targetKey) || null,
        [databases, targetKey],
    );

    const chosen = backups.find((b) => b.filename === picked) || null;
    const backupPath = source === 'backup' ? (chosen?.path || '') : manualPath.trim();
    const mismatch = Boolean(chosen && target && chosen.type !== target.engine);
    const confirmed = Boolean(target) && confirmText.trim() === target.name;
    const ready = Boolean(target && backupPath && confirmed && isAdmin && !result?.ok);

    async function run() {
        if (!ready || busy) return;
        setBusy(true);
        setResult(null);
        try {
            if (backupFirst) {
                setStep(`Backing up ${target.name}…`);
                const safety = target.engine === 'mysql'
                    ? await api.backupMySQLDatabase(target.name)
                    : await api.backupPostgreSQLDatabase(target.name);
                if (!safety?.success) {
                    setResult({
                        ok: false,
                        messageKey: 'app.importDumpModal.thePreImportBackupFailedSo', message: "Couldn't back up before importing, so nothing was imported.",
                        detail: safety?.error || 'The backup endpoint did not report success.',
                    });
                    return;
                }
            }
            setStep(`Importing into ${target.name}…`);
            const res = target.engine === 'mysql'
                ? await api.restoreMySQLDatabase(target.name, backupPath)
                : await api.restorePostgreSQLDatabase(target.name, backupPath);
            if (res?.success) {
                setResult({ ok: true, message: res.message || `Dump imported into ${target.name}.` });
                onImported?.(target);
            } else {
                setResult({ ok: false, messageKey: 'app.importDumpModal.theImportFailed', message: "Couldn't import the dump.", detail: res?.error || 'The server did not say why.' });
            }
        } catch (err) {
            setResult({
                ok: false,
                message: err?.status === 403
                    ? 'Your account is not an administrator, so ServerKit will not import dumps for it.'
                    : 'The import failed.',
                detail: err?.status === 403 ? null : (err?.message || 'The request failed.'),
            });
        } finally {
            setStep('');
            setBusy(false);
        }
    }

    const footer = (
        <>
            <Button type="button" variant="outline" onClick={onClose}>{result?.ok ? 'Done' : 'Cancel'}</Button>
            <Button type="button" variant="danger" onClick={run} disabled={!ready || busy}>
                {busy
                    ? <Loader2 size={14} className="dbx-spin" aria-hidden="true" />
                    : <FileCode2 size={14} aria-hidden="true" />}
                {busy ? (step || 'Working…') : 'Import and overwrite'}
            </Button>
        </>
    );

    return (
        <Modal open onClose={onClose} title={t('app.importDumpModal.importSqlDump', 'Import SQL dump')} size="lg" footer={footer}>
            {databases === null ? (
                <p className="dbx-builder__loading">
                    <Loader2 size={15} className="dbx-spin" aria-hidden="true" /> {t('app.importDumpModal.lookingForDatabases', 'Looking for databases…')}
                </p>
            ) : !databases.length ? (
                <div className="dbx-notice dbx-notice--info">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <div>
                        <strong>{t('app.importDumpModal.noDatabaseCanAcceptADump', 'No database can accept a dump right now.')}</strong>
                        <p>
                            {loadFailed
                                ? 'Neither MySQL nor PostgreSQL answered. Check that the server is running, then try again.'
                                : `Importing is only wired for ${RESTORABLE.map((e) => ENGINE_META[e].short).join(' and ')} databases on this host — SQLite files and containerised databases have no restore route.`}
                        </p>
                        <Button variant="unstyled" type="button" className="dbx-inline-link" onClick={load}>
                            <RefreshCw size={13} aria-hidden="true" /> {t('app.importDumpModal.tryAgain', 'Try again')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="dbx-import">
                    {!isAdmin && (
                        <div className="dbx-notice dbx-notice--warn">
                            <ShieldAlert size={15} aria-hidden="true" />
                            <div>
                                <strong>{t('app.importDumpModal.readOnlyAccount', 'Read-only account.')}</strong>
                                <p>{t('app.importDumpModal.importingADumpRewritesADatabase', 'Importing a dump rewrites a database, and only administrators may do that.')}</p>
                            </div>
                        </div>
                    )}

                    <div className="dbx-field">
                        <label className="dbx-field__label" htmlFor="dbx-import-target">{t('app.importDumpModal.importInto', 'Import into')}</label>
                        <Select value={targetKey} onValueChange={setTargetKey}>
                            <SelectTrigger id="dbx-import-target" className="dbx-select">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {databases.map((d) => (
                                    <SelectItem key={d.key} value={d.key}>
                                        {ENGINE_META[d.engine].short} · {d.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {target && (
                            <p className="dbx-field-hint">
                                <span className="dbx-builder__target-ico"><EngineIcon engine={target.engine} size={13} /></span>
                                {' '}{t('app.importDumpModal.theDumpIsPipedInto', 'The dump is piped into')} <code>{target.name}</code> {t('app.importDumpModal.onThisServerS', 'on this server\'s')}
                                {' '}{ENGINE_META[target.engine].short} {t('app.importDumpModal.asTheDatabaseSuperuser', 'as the database superuser.')}
                            </p>
                        )}
                    </div>

                    <div className="dbx-field">
                        <span className="dbx-field__label">{t('app.importDumpModal.dumpFile', 'Dump file')}</span>
                        <SegControl
                            className="dbx-choice"
                            aria-label={t('app.importDumpModal.whereTheDumpLives', 'Where the dump lives')}
                            value={source}
                            onChange={setSource}
                            options={SOURCES.map((s) => ({ value: s.id, label: translateLabel(t, s) }))}
                        />

                        {source === 'backup' ? (
                            <div className="dbx-dumps">
                                {backupsLoading ? (
                                    <p className="dbx-dumps__empty">
                                        <Loader2 size={14} className="dbx-spin" aria-hidden="true" /> {t('app.importDumpModal.readingTheBackupDirectory', 'Reading the backup directory…')}
                                    </p>
                                ) : !backups.length ? (
                                    <p className="dbx-dumps__empty">
                                        <HardDrive size={14} aria-hidden="true" />
                                        {t('app.importDumpModal.noDumpsInServerkitSBackup', 'No dumps in ServerKit\'s backup directory yet. Back up a database, or point at a path below.')}
                                    </p>
                                ) : backups.map((b) => (
                                    <Button variant="unstyled"
                                        key={b.filename}
                                        type="button"
                                        className={`dbx-dump${picked === b.filename ? ' is-on' : ''}`}
                                        onClick={() => setPicked(b.filename)}
                                        aria-pressed={picked === b.filename}
                                    >
                                        <span className="dbx-dump__main">
                                            <span className="dbx-dump__name">{b.filename}</span>
                                            <span className="dbx-dump__meta">
                                                {b.database} · {formatBytes(b.size, { decimals: 1, defaultValue: '0 B' })}
                                                {' · '}{new Date(b.created_at).toLocaleString()}
                                            </span>
                                        </span>
                                        <span className={`dbx-dump__tag is-${b.type}`}>
                                            {ENGINE_META[b.type]?.short || b.type}
                                        </span>
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <>
                                <div className="dbx-input">
                                    <Database size={15} aria-hidden="true" />
                                    <input
                                        value={manualPath}
                                        onChange={(e) => setManualPath(e.target.value)}
                                        placeholder="/var/backups/serverkit/app_prod.sql.gz"
                                        spellCheck="false"
                                        aria-label={t('app.importDumpModal.pathToTheDumpFileOn', 'Path to the dump file on the server')}
                                    />
                                </div>
                                <p className="dbx-field-hint">
                                    {t('app.importDumpModal.anAbsolutePathOnTheServer', 'An absolute path on the panel server. There is no upload endpoint, so a file on your own machine has to be copied across first (scp, the file manager, or a backup taken here).')} <code>.gz</code> {t('app.importDumpModal.isDecompressedAutomatically', 'is decompressed automatically.')}
                                </p>
                            </>
                        )}
                    </div>

                    {mismatch && (
                        <div className="dbx-notice dbx-notice--warn">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <div>
                                <p>
                                    {t('app.importDumpModal.thatDumpWasTakenFrom', 'That dump was taken from')} {ENGINE_META[chosen.type]?.short || chosen.type} {t('app.importDumpModal.andYouAreImportingInto', 'and you are importing into')} {ENGINE_META[target.engine].short}. The statements are unlikely to apply cleanly.
                                </p>
                            </div>
                        </div>
                    )}

                    <label className="dbx-check">
                        <input type="checkbox" checked={backupFirst} onChange={(e) => setBackupFirst(e.target.checked)} />
                        <span>
                            <span className="dbx-check__title">{t('app.importDumpModal.backUp', 'Back up')} {target?.name || 'the database'} first</span>
                            <span className="dbx-check__sub">
                                {t('app.importDumpModal.takesADumpThroughServerkitS', 'Takes a dump through ServerKit\'s own backup route before importing. If it fails, the import does not run.')}
                            </span>
                        </span>
                    </label>

                    <div className="dbx-notice dbx-notice--danger">
                        <AlertTriangle size={15} aria-hidden="true" />
                        <div>
                            <strong>{t('app.importDumpModal.thisRewrites', 'This rewrites')} {target?.name || 'the database'}.</strong>
                            <p>
                                {t('app.importDumpModal.everyStatementInTheDumpIs', 'Every statement in the dump is executed against it. Tables the dump recreates lose whatever they hold now, and there is no undo beyond the backup above.')}
                            </p>
                        </div>
                    </div>

                    <div className="dbx-field">
                        <label className="dbx-field__label" htmlFor="dbx-import-confirm">
                            {t('common.labels.type', 'Type')} <code>{target?.name}</code> {t('app.importDumpModal.toConfirm', 'to confirm')}
                        </label>
                        <div className="dbx-input">
                            <Check size={15} aria-hidden="true" />
                            <input
                                id="dbx-import-confirm"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder={target?.name}
                                spellCheck="false"
                                autoComplete="off"
                            />
                        </div>
                        {!backupPath && (
                            <p className="dbx-field-hint">{t('app.importDumpModal.pickADumpFileAboveBefore', 'Pick a dump file above before importing.')}</p>
                        )}
                    </div>

                    {result && (
                        <div className={`dbx-notice ${result.ok ? 'dbx-notice--ok' : 'dbx-notice--error'}`}>
                            {result.ok
                                ? <Check size={15} aria-hidden="true" />
                                : <AlertTriangle size={15} aria-hidden="true" />}
                            <div>
                                <strong>{result.message}</strong>
                                {result.detail && <pre className="dbx-notice__detail">{result.detail}</pre>}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}
